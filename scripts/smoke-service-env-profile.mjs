import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
      }
    },
    null,
    2
  )
);
process.stdout.write("\nService env profile smoke passed\n");
