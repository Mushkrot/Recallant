import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectDir = `/tmp/recallant-connect-smoke-${randomUUID()}`;
const env = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId
};

function runCli(args) {
  const output = execFileSync("node", ["apps/cli/dist/index.js", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });

const attached = runCli(["attach", projectDir, "--sandbox", "--format", "json"]);
assert(attached.status === "attached", `Attach failed: ${JSON.stringify(attached)}`);
assert(attached.project_id, `Attach did not return project_id: ${JSON.stringify(attached)}`);

const dryRun = runCli(["connect", "codex", "--project-dir", projectDir, "--dry-run"]);
assert(dryRun.dry_run === true, `Connect dry-run flag missing: ${JSON.stringify(dryRun)}`);
assert(dryRun.client === "codex", `Codex target mismatch: ${JSON.stringify(dryRun)}`);
assert(dryRun.connection_status === "mcp_only", `Connect should be MCP-only first slice: ${JSON.stringify(dryRun)}`);
assert(dryRun.hook_status === "not_installed", `Hooks should not be installed yet: ${JSON.stringify(dryRun)}`);
assert(dryRun.capture_status === "not_observed", `Unexpected capture status: ${JSON.stringify(dryRun)}`);
assert(dryRun.writes_files === false, `Dry-run should not write files: ${JSON.stringify(dryRun)}`);
assert(dryRun.writes_global_config === false, `Connect smoke must not write global config: ${JSON.stringify(dryRun)}`);
assert(
  dryRun.planned_changes.some((change) => change.action === "no_change"),
  `Attach already writes the Codex project MCP config, so connect should be idempotent: ${JSON.stringify(dryRun)}`
);

const connected = runCli(["connect", "codex", "--project-dir", projectDir]);
assert(connected.writes_files === false, `Codex connect should be idempotent after attach: ${JSON.stringify(connected)}`);
const writtenConfig = JSON.parse(await readFile(`${projectDir}/.recallant/codex-mcp.json`, "utf8"));
assert(
  writtenConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
  `Codex MCP config missing Recallant server: ${JSON.stringify(writtenConfig)}`
);

const idempotent = runCli(["connect", "codex", "--project-dir", projectDir]);
assert(idempotent.writes_files === false, `Second connect should be idempotent: ${JSON.stringify(idempotent)}`);
assert(
  idempotent.planned_changes.some((change) => change.action === "no_change"),
  `Second connect should report no_change: ${JSON.stringify(idempotent)}`
);

const claudeDryRun = runCli(["connect", "claude-code", "--project-dir", projectDir, "--dry-run"]);
assert(claudeDryRun.client === "claude_code", `Claude alias mismatch: ${JSON.stringify(claudeDryRun)}`);
assert(
  claudeDryRun.config_file === ".recallant/generic-mcp.json",
  `Claude first slice should use generic config fallback: ${JSON.stringify(claudeDryRun)}`
);
assert(
  claudeDryRun.planned_changes.some((change) => change.action === "write_file"),
  `Claude/generic dry-run should show config write: ${JSON.stringify(claudeDryRun)}`
);

process.stdout.write("Connect CLI smoke passed\n");
