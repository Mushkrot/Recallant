import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: "",
      RECALLANT_REMOTE_MCP_CREDENTIAL: ""
    }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const remoteProject = await mkdtemp(join(tmpdir(), "recallant-remote-cleanup-"));
await mkdir(join(remoteProject, ".codex"), { recursive: true });
await mkdir(join(remoteProject, ".recallant"), { recursive: true });
const credentialStorePath = join(remoteProject, "remote-mcp-credentials.json");
await writeFile(
  credentialStorePath,
  JSON.stringify(
    {
      version: "remote-mcp-credential-store-v1",
      credentials: {
        rclcred_cleanup: {
          credential: "rcl_mcp_secret",
          credential_prefix: "cleanup",
          server_url: "https://recallant.example.com",
          project_id: "project",
          developer_id: "developer",
          client_id: "client",
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-22T00:00:00.000Z"
        }
      }
    },
    null,
    2
  )
);
await writeFile(
  join(remoteProject, ".codex", "config.toml"),
  [
    "[mcp_servers.unrelated]",
    'command = "other"',
    'args = ["serve"]',
    "",
    "[mcp_servers.recallant]",
    'command = "recallant"',
    'args = ["remote-bridge"]',
    `env = { RECALLANT_REMOTE_MCP_URL = "https://recallant.example.com", RECALLANT_REMOTE_MCP_CREDENTIAL_REF = "rclcred_cleanup", RECALLANT_REMOTE_MCP_CREDENTIAL_STORE = "${credentialStorePath}", RECALLANT_PROJECT_ID = "project", RECALLANT_DEVELOPER_ID = "developer", RECALLANT_REMOTE_MCP_CLIENT_ID = "client" }`,
    ""
  ].join("\n")
);
await writeFile(join(remoteProject, ".recallant", "config"), "{}\n");

const dryRun = runJson(["remote-cleanup", "--project-dir", remoteProject, "--format", "json"]);
if (
  dryRun.status !== "ready_for_confirmation" ||
  dryRun.writes_files !== false ||
  dryRun.touches_local_storage !== false ||
  dryRun.touches_docker_or_postgres !== false ||
  !dryRun.planned_changes.some((change) => change.path === ".codex/config.toml")
) {
  throw new Error(`remote-cleanup dry-run failed: ${JSON.stringify(dryRun)}`);
}
const beforeConfirm = await readFile(join(remoteProject, ".codex", "config.toml"), "utf8");
if (!beforeConfirm.includes("[mcp_servers.recallant]")) {
  throw new Error("remote-cleanup dry-run changed the project config");
}

const cleanup = runJson([
  "remote-cleanup",
  "--project-dir",
  remoteProject,
  "--confirm",
  "--format",
  "json"
]);
const afterConfirm = await readFile(join(remoteProject, ".codex", "config.toml"), "utf8");
if (
  cleanup.status !== "cleaned" ||
  cleanup.updated_paths[0] !== ".codex/config.toml" ||
  afterConfirm.includes("[mcp_servers.recallant]") ||
  !afterConfirm.includes("[mcp_servers.unrelated]") ||
  !(await exists(join(remoteProject, ".recallant", "config"))) ||
  !(await exists(credentialStorePath))
) {
  throw new Error(`remote-cleanup confirm failed: ${JSON.stringify(cleanup)}`);
}

const localProject = await mkdtemp(join(tmpdir(), "recallant-remote-cleanup-local-"));
await mkdir(join(localProject, ".codex"), { recursive: true });
await writeFile(
  join(localProject, ".codex", "config.toml"),
  [
    "[mcp_servers.recallant]",
    'command = "recallant"',
    'args = ["mcp-server"]',
    'env = { RECALLANT_PROJECT_ID = "project", RECALLANT_DEVELOPER_ID = "developer", RECALLANT_PROJECT_PATH = "/tmp/project" }',
    'env_vars = ["RECALLANT_DATABASE_URL"]',
    ""
  ].join("\n")
);
const localDryRun = runJson([
  "remote-cleanup",
  "--project-dir",
  localProject,
  "--confirm",
  "--format",
  "json"
]);
const localConfig = await readFile(join(localProject, ".codex", "config.toml"), "utf8");
if (
  localDryRun.planned_changes.length !== 0 ||
  !localDryRun.warnings.some((warning) => warning.includes("does not look like a remote-bridge")) ||
  !localConfig.includes('args = ["mcp-server"]')
) {
  throw new Error(
    `remote-cleanup should preserve local MCP config: ${JSON.stringify(localDryRun)}`
  );
}

const cliProject = await mkdtemp(join(tmpdir(), "recallant-remote-cleanup-cli-"));
const cliPath = join(cliProject, "bin", "recallant");
await mkdir(join(cliProject, "bin"), { recursive: true });
await writeFile(
  cliPath,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'export RECALLANT_HOME="${RECALLANT_HOME:-/tmp/recallant-client-cli}"',
    'exec node "$RECALLANT_HOME/apps/cli/dist/index.js" "$@"',
    ""
  ].join("\n")
);
const cliDryRun = runJson([
  "remote-cleanup",
  "--project-dir",
  cliProject,
  "--remove-cli-wrapper",
  "--cli-path",
  cliPath,
  "--format",
  "json"
]);
if (
  cliDryRun.writes_files !== false ||
  !cliDryRun.planned_changes.some((change) => change.path === cliPath) ||
  !(await exists(cliPath))
) {
  throw new Error(`remote-cleanup CLI dry-run failed: ${JSON.stringify(cliDryRun)}`);
}
const cliCleanup = runJson([
  "remote-cleanup",
  "--project-dir",
  cliProject,
  "--remove-cli-wrapper",
  "--cli-path",
  cliPath,
  "--confirm",
  "--format",
  "json"
]);
if (cliCleanup.status !== "cleaned" || (await exists(cliPath))) {
  throw new Error(`remote-cleanup CLI confirm failed: ${JSON.stringify(cliCleanup)}`);
}

process.stdout.write("Remote client cleanup smoke passed\n");
