import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { URL } from "node:url";

const repoRoot = process.cwd();

function databaseUrlFixture({ username, password, host, port, database }) {
  const url = new URL(`postgres://${host}`);
  url.username = username;
  url.password = password;
  url.port = port;
  url.pathname = `/${database}`;
  return url.toString();
}

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  databaseUrlFixture({
    username: "recallant",
    password: ["recallant", "dev", "password"].join("_"),
    host: "127.0.0.1",
    port: "15433",
    database: "recallant_agent_work"
  });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runDoctor(projectDir, serviceEnvFile, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", projectDir, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: databaseUrl,
        RECALLANT_SERVICE_ENV_FILE: serviceEnvFile,
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1",
        ...extraEnv
      },
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    throw new Error(`doctor failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return { json: JSON.parse(result.stdout), raw: result.stdout };
}

async function runDoctorAsync(projectDir, serviceEnvFile, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", projectDir, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: databaseUrl,
        RECALLANT_SERVICE_ENV_FILE: serviceEnvFile,
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1",
        ...extraEnv
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`doctor failed (${code}): ${stderr}\n${stdout}`);
  }
  return { json: JSON.parse(stdout), raw: stdout };
}

function assertRedacted(raw, forbiddenValues) {
  for (const value of forbiddenValues) {
    assert(!raw.includes(value), `doctor output leaked forbidden value: ${value}`);
  }
  assert(!/postgres(?:ql)?:\/\/[^ <>"')]+:[^ <>"')]+@/i.test(raw), "doctor output leaked DSN");
}

const alignedDir = await mkdtemp(join(tmpdir(), "recallant-service-env-aligned-"));
const alignedEnv = join(alignedDir, "recallant.env");
await writeFile(alignedEnv, `RECALLANT_DATABASE_URL=${databaseUrl}\n`);
const aligned = runDoctor(alignedDir, alignedEnv);
assert(aligned.json.service_env_profile?.status === "aligned", "aligned profile was not aligned");
assert(aligned.json.service_env_profile?.ok === true, "aligned profile was not ok");
assert(
  aligned.json.production_readiness?.service_env_profile?.ok === true,
  "aligned production readiness profile was not ok"
);
assertRedacted(aligned.raw, ["recallant_dev_password"]);

const mismatchDir = await mkdtemp(join(tmpdir(), "recallant-service-env-mismatch-"));
const mismatchEnv = join(mismatchDir, "recallant.env");
const mismatchPassword = ["service", "env", "mismatch", "password"].join("_");
await writeFile(
  mismatchEnv,
  `RECALLANT_DATABASE_URL=${databaseUrlFixture({
    username: "other_user",
    password: mismatchPassword,
    host: "db.example.invalid",
    port: "6543",
    database: "other_database"
  })}\n`
);
const mismatch = runDoctor(mismatchDir, mismatchEnv);
const differences = mismatch.json.service_env_profile?.differences ?? [];
assert(
  mismatch.json.service_env_profile?.status === "mismatch",
  "mismatch profile was not mismatch"
);
assert(mismatch.json.service_env_profile?.ok === false, "mismatch profile was not marked not ok");
for (const expected of ["username", "host", "port", "database", "credential"]) {
  assert(differences.includes(expected), `mismatch differences missing ${expected}`);
}
assert(
  mismatch.json.production_readiness?.service_env_profile?.ok === false,
  "mismatch production readiness profile was not marked not ok"
);
assert(
  mismatch.json.service_env_profile?.warnings?.some((warning) =>
    warning.includes("profiles differ")
  ),
  "mismatch profile did not expose a redacted warning"
);
assertRedacted(mismatch.raw, [mismatchPassword, "postgres://other_user"]);

const plain = runDoctor(mismatchDir, mismatchEnv, { RECALLANT_SERVICE_ENV_FILE: "" });
assert(
  plain.json.service_env_profile?.status === "not_configured",
  "doctor without service env file should remain backwards-compatible"
);

async function withAuthOrigin(callback) {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "content-type": "text/plain" });
    response.end("auth required");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to allocate auth origin");
  try {
    return await callback(`http://127.0.0.1:${address.port}/review`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const publicEnvDir = await mkdtemp(join(tmpdir(), "recallant-service-env-public-"));
const publicEnv = join(publicEnvDir, "recallant.env");
const adminEmail = "admin@example.invalid";
const publicReadiness = await withAuthOrigin(async (originUrl) => {
  await writeFile(
    publicEnv,
    [
      `RECALLANT_DATABASE_URL=${databaseUrl}`,
      "RECALLANT_PUBLIC_WORKBENCH_URL=https://recallant.example.invalid/review",
      `RECALLANT_WORKBENCH_ORIGIN_URL=${originUrl}`,
      "RECALLANT_CLOUDFLARE_MODE=enabled",
      "RECALLANT_CLOUDFLARE_EDGE_AUTH=required",
      `RECALLANT_ADMIN_EMAILS=${adminEmail}`
    ].join("\n")
  );
  return runDoctorAsync(publicEnvDir, publicEnv, {
    RECALLANT_PUBLIC_WORKBENCH_URL: "",
    RECALLANT_WORKBENCH_ORIGIN_URL: "",
    RECALLANT_CLOUDFLARE_MODE: "",
    RECALLANT_CLOUDFLARE_EDGE_AUTH: "",
    RECALLANT_ADMIN_EMAILS: ""
  });
});
assert(
  publicReadiness.json.service_env_profile?.production_env?.configured_keys?.includes(
    "RECALLANT_PUBLIC_WORKBENCH_URL"
  ),
  "service env production keys did not include public Workbench URL"
);
assert(
  publicReadiness.json.production_readiness?.public_workbench_readiness?.status === "auth_ready" &&
    publicReadiness.json.production_readiness?.public_workbench_readiness?.ready === true,
  `service-env supplied public readiness was not auth_ready: ${JSON.stringify(
    publicReadiness.json.production_readiness?.public_workbench_readiness
  )}`
);
assert(
  publicReadiness.json.production_readiness?.production_env?.source === "explicit_env" &&
    publicReadiness.json.production_readiness?.production_env?.configured_keys?.includes(
      "RECALLANT_ADMIN_EMAILS"
    ),
  "production readiness did not report redacted service-env key metadata"
);
assertRedacted(publicReadiness.raw, [adminEmail, "recallant_dev_password"]);

process.stdout.write(
  JSON.stringify(
    {
      aligned: {
        status: aligned.json.service_env_profile.status,
        ok: aligned.json.service_env_profile.ok,
        cli_database: aligned.json.service_env_profile.cli_database
      },
      mismatch: {
        status: mismatch.json.service_env_profile.status,
        ok: mismatch.json.service_env_profile.ok,
        differences
      },
      unconfigured: {
        status: plain.json.service_env_profile.status,
        ok: plain.json.service_env_profile.ok
      },
      service_env_public_readiness: {
        status: publicReadiness.json.production_readiness.public_workbench_readiness.status,
        ready: publicReadiness.json.production_readiness.public_workbench_readiness.ready,
        source: publicReadiness.json.production_readiness.production_env.source,
        configured_keys:
          publicReadiness.json.production_readiness.production_env.configured_keys
      }
    },
    null,
    2
  )
);
process.stdout.write("\nService env profile smoke passed\n");
