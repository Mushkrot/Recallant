import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`
    );
  }
  return result;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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

function rollback(args, options = {}) {
  return run("/bin/bash", ["scripts/rollback-recallant-install.sh", ...args], options);
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} missing ${marker}\n${text}`);
  }
}

const cleanRoot = await mkdtemp(join(tmpdir(), "recallant-public-rollback-"));
const envFile = join(cleanRoot, "etc", "recallant.env");
const dataDir = join(cleanRoot, "data");
const prefix = join(cleanRoot, "bin");
const cliPath = join(prefix, "recallant");

try {
  const dryRun = rollback([
    "--dry-run",
    "--env-file",
    envFile,
    "--data-dir",
    dataDir,
    "--cli-path",
    cliPath,
    "--postgres-container-name",
    "recallant-rollback-smoke",
    "--compose-project-name",
    "recallant-rollback-smoke",
    "--remove-env-file",
    "--remove-data-dir",
    "--remove-cli",
    "--remove-container"
  ]);
  mustInclude(
    dryRun.stdout,
    [
      "Recallant rollback plan",
      `env_file: ${envFile}`,
      `data_dir: ${dataDir}`,
      `cli_path: ${cliPath}`,
      "will_remove_env_file: true",
      "will_remove_data_dir: true",
      "data_dir_marker_present: no",
      "will_remove_cli: true",
      "will_remove_container: true",
      "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
    ],
    "rollback dry-run"
  );
  assert(!(await exists(envFile)), "Rollback dry-run created env file");
  assert(!(await exists(dataDir)), "Rollback dry-run created data dir");
  assert(!(await exists(cliPath)), "Rollback dry-run created CLI path");

  await mkdir(join(dataDir, "postgres"), { recursive: true });
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await mkdir(prefix, { recursive: true });
  await mkdir(join(cleanRoot, "etc"), { recursive: true });
  await writeFile(envFile, "RECALLANT_DATABASE_URL=postgres://example\n");
  await writeFile(
    join(dataDir, ".recallant-install-marker"),
    "profile=single-user\ndata_dir=rollback-smoke\n"
  );
  await writeFile(
    cliPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'export RECALLANT_HOME="${RECALLANT_HOME:-/tmp/recallant}"',
      'exec node "$RECALLANT_HOME/apps/cli/dist/index.js" "$@"',
      ""
    ].join("\n")
  );
  rollback([
    "--env-file",
    envFile,
    "--data-dir",
    dataDir,
    "--cli-path",
    cliPath,
    "--remove-env-file",
    "--remove-data-dir",
    "--remove-cli",
    "--confirm-token",
    "rollback-recallant-install"
  ]);
  assert(!(await exists(envFile)), "Confirmed rollback did not remove env file");
  assert(!(await exists(dataDir)), "Confirmed rollback did not remove marked data dir");
  assert(!(await exists(cliPath)), "Confirmed rollback did not remove owned CLI wrapper");

  const unmarkedDataDir = join(cleanRoot, "unmarked-data");
  await mkdir(unmarkedDataDir, { recursive: true });
  const refused = rollback(
    [
      "--data-dir",
      unmarkedDataDir,
      "--remove-data-dir",
      "--confirm-token",
      "rollback-recallant-install"
    ],
    { allowFailure: true }
  );
  assert(refused.status !== 0, "Rollback should refuse unmarked data dir removal");
  assert(await exists(unmarkedDataDir), "Rollback removed an unmarked data dir");

  if (process.env.RECALLANT_RUN_MANAGED_INSTALL_SMOKE === "1") {
    const installRoot = await mkdtemp(join(tmpdir(), "recallant-rollback-managed-"));
    const managedEnv = join(installRoot, "etc", "recallant.env");
    const managedData = join(installRoot, "data");
    const managedPrefix = join(installRoot, "bin");
    const managedProject = join(installRoot, "project");
    const id = randomUUID().slice(0, 8);
    const containerName = `recallant-rollback-${id}`;
    const composeProject = `recallant-rollback-${id}`;
    const port = String(await getFreePort());
    try {
      await mkdir(managedProject, { recursive: true });
      run(
        "/bin/bash",
        [
          "scripts/install-recallant.sh",
          "--profile",
          "managed-server",
          "--env-file",
          managedEnv,
          "--data-dir",
          managedData,
          "--install-cli-prefix",
          managedPrefix,
          "--postgres-port",
          port,
          "--postgres-container-name",
          containerName,
          "--compose-project-name",
          composeProject,
          "--run-user",
          "recallant-rollback-smoke",
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
      assert(await exists(managedEnv), "Managed install did not create env file");
      assert(await exists(managedData), "Managed install did not create data dir");
      assert(await exists(join(managedPrefix, "recallant")), "Managed install did not create CLI");
      rollback([
        "--env-file",
        managedEnv,
        "--data-dir",
        managedData,
        "--install-cli-prefix",
        managedPrefix,
        "--postgres-container-name",
        containerName,
        "--compose-project-name",
        composeProject,
        "--remove-env-file",
        "--remove-data-dir",
        "--remove-cli",
        "--remove-container",
        "--confirm-token",
        "rollback-recallant-install"
      ]);
      assert(!(await exists(managedEnv)), "Managed rollback left env file behind");
      assert(!(await exists(managedData)), "Managed rollback left data dir behind");
      assert(!(await exists(join(managedPrefix, "recallant"))), "Managed rollback left CLI behind");
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8" });
      await rm(installRoot, { recursive: true, force: true });
    }
  }

  process.stdout.write("Public install rollback smoke passed\n");
} finally {
  await rm(cleanRoot, { recursive: true, force: true });
}
