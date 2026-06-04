import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { rm, mkdir, mkdtemp } from "node:fs/promises";
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

  const attach = parseJson(
    run(recallant, ["attach", ".", "--sandbox", "--format", "json"], {
      cwd: projectDir,
      env: baseEnv
    }),
    "managed install attach"
  );
  assert(attach.status === "attached", `Attach failed: ${JSON.stringify(attach)}`);

  const connectDryRun = parseJson(
    run(recallant, ["connect", "codex", "--project-dir", projectDir, "--dry-run", "--format", "json"], {
      env: baseEnv
    }),
    "managed install connect dry-run"
  );
  assert(
    connectDryRun.dry_run === true || connectDryRun.writes_files === false,
    `Connect dry-run was not safe: ${JSON.stringify(connectDryRun)}`
  );

  const start = parseJson(
    run(
      recallant,
      ["agent-start", "--project-dir", projectDir, "--task-hint", "public managed install smoke"],
      {
        env: baseEnv
      }
    ),
    "managed install agent-start"
  );
  assert(start.session_id, `agent-start failed: ${JSON.stringify(start)}`);

  const event = parseJson(
    run(
      recallant,
      [
        "agent-event",
        "--project-dir",
        projectDir,
        "--kind",
        "decision",
        "--text",
        "Public managed install smoke captured a decision."
      ],
      { env: baseEnv }
    ),
    "managed install agent-event"
  );
  assert(event.memory?.memory_id, `agent-event did not write memory: ${JSON.stringify(event)}`);

  const checkpoint = parseJson(
    run(
      recallant,
      [
        "agent-checkpoint",
        "--project-dir",
        projectDir,
        "--summary",
        "Public managed install smoke checkpoint."
      ],
      {
        env: baseEnv
      }
    ),
    "managed install checkpoint"
  );
  assert(
    checkpoint.ok === true &&
      checkpoint.event_id &&
      checkpoint.project_log_update?.status === "updated",
    `checkpoint failed: ${JSON.stringify(checkpoint)}`
  );

  parseJson(
    run(
      recallant,
      [
        "agent-closeout",
        "--project-dir",
        projectDir,
        "--summary",
        "Public managed install smoke closeout."
      ],
      {
        env: baseEnv
      }
    ),
    "managed install closeout"
  );

  const ready = parseJson(
    run(
      recallant,
      ["doctor", "--project-dir", projectDir, "--require-capture", "--format", "json"],
      {
        env: baseEnv
      }
    ),
    "managed install require-capture doctor"
  );
  assert(
    ready.owner_summary?.actually_recording === true,
    `Require-capture doctor did not prove recording: ${JSON.stringify(ready.owner_summary)}`
  );

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        clean_root: cleanRoot,
        postgres_port: port,
        container_name: containerName,
        compose_project: composeProject,
        project_dir: projectDir
      },
      null,
      2
    ) + "\n"
  );
} finally {
  spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8" });
  await rm(cleanRoot, { recursive: true, force: true });
}
