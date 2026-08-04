import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm, mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: "utf8",
    timeout: options.timeout ?? 120000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`
    );
  }
  return result.stdout;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error}\n${text}`);
  }
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to allocate free local port");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

if (process.env.RECALLANT_RUN_MANAGED_INSTALL_SMOKE !== "1") {
  process.stdout.write(
    "Public managed install smoke skipped; set RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 to run Docker-backed validation.\n"
  );
  process.exit(0);
}

const cleanRoot = await mkdtemp(join(tmpdir(), "recallant-managed-install-"));
const envFile = join(cleanRoot, "etc", "recallant.env");
const dataDir = join(cleanRoot, "data");
const prefix = join(cleanRoot, "bin");
const projectDir = join(cleanRoot, "project");
const port = String(await getFreePort());
const id = randomUUID().slice(0, 8);
const containerName = `recallant-managed-install-${id}`;
const composeProject = `recallant-managed-install-${id}`;

try {
  await mkdir(projectDir, { recursive: true });
  run(
    "/bin/bash",
    [
      "scripts/install-recallant.sh",
      "--profile",
      "managed-server",
      "--env-file",
      envFile,
      "--data-dir",
      dataDir,
      "--install-cli-prefix",
      prefix,
      "--postgres-port",
      port,
      "--postgres-container-name",
      containerName,
      "--compose-project-name",
      composeProject,
      "--run-user",
      "recallant-managed-install-smoke",
      "--no-systemd"
    ],
    {
      env: {
        RECALLANT_ENV_FILE: "",
        RECALLANT_DATA_DIR: "",
        INSTALL_CLI_PREFIX: ""
      },
      timeout: 240000
    }
  );

  const recallant = join(prefix, "recallant");
  const baseEnv = {
    RECALLANT_ENV_FILE: envFile
  };
  const doctor = parseJson(
    run(recallant, ["doctor", "--format", "json"], { env: baseEnv }),
    "managed install doctor"
  );
  assert(
    doctor.postgres?.reachable === true,
    `Postgres was not reachable: ${JSON.stringify(doctor)}`
  );

  const onboard = parseJson(
    run(recallant, ["onboard", projectDir, "--yes", "--format", "json"], { env: baseEnv }),
    "managed install onboard"
  );
  assert(onboard.status === "completed", `Onboard failed: ${JSON.stringify(onboard)}`);
  assert(
    onboard.client === "codex" &&
      onboard.install_local_hooks === true &&
      onboard.verify_requested === true,
    `Managed install onboard should keep beginner defaults implicit: ${JSON.stringify(onboard)}`
  );
  assert(
    onboard.storage?.reachable === true,
    `Onboard storage was not ready: ${JSON.stringify(onboard.storage)}`
  );
  assert(
    onboard.attached?.status === "attached",
    `Onboard attach failed: ${JSON.stringify(onboard)}`
  );
  assert(
    onboard.connected?.status === "connected",
    `Onboard connect failed: ${JSON.stringify(onboard)}`
  );
  assert(
    onboard.verify?.status === "passed" &&
      onboard.verify?.memory_loop_ready === true &&
      onboard.verify?.capture_active === false &&
      onboard.verify?.evidence?.context_read === true &&
      onboard.verify?.evidence?.memory_write === true &&
      onboard.verify?.evidence?.checkpoint === true &&
      onboard.verify?.evidence?.recall === true,
    `Onboard verify did not prove capture and recall: ${JSON.stringify(onboard.verify)}`
  );
  assert(
    onboard.workbench?.available === true &&
      onboard.workbench?.auth_required === true &&
      onboard.workbench?.private_by_default === true,
    `Onboard Workbench outcome was not private and available: ${JSON.stringify(onboard.workbench)}`
  );

  const ready = parseJson(
    run(
      recallant,
      ["doctor", "--project-dir", projectDir, "--require-memory-loop", "--format", "json"],
      {
        env: baseEnv
      }
    ),
    "managed install require-memory-loop doctor"
  );
  assert(
    ready.owner_summary?.memory_loop_ready === true &&
      ready.owner_summary?.actually_recording === false,
    `Require-memory-loop doctor did not prove the governed loop: ${JSON.stringify(ready.owner_summary)}`
  );
  const config = JSON.parse(await readFile(join(projectDir, ".recallant", "config"), "utf8"));

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        onboarding_command: "recallant connect <project>",
        project_id: config.project_id ?? null,
        clean_root: "[temporary-directory-removed]",
        postgres_port: port,
        container_name: containerName,
        compose_project: composeProject,
        memory_loop_ready: ready.owner_summary?.memory_loop_ready === true,
        workbench_private: onboard.workbench?.private_by_default === true
      },
      null,
      2
    ) + "\n"
  );
} finally {
  spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8" });
  await rm(cleanRoot, { recursive: true, force: true });
}
