import { execFileSync, spawnSync } from "node:child_process";
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

function runCliRaw(args) {
  const output = spawnSync("node", ["apps/cli/dist/index.js", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    status: output.status,
    stdout: output.stdout,
    stderr: output.stderr,
    json: output.stdout.trim() ? JSON.parse(output.stdout) : null
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });

const attached = runCli(["attach", projectDir, "--sandbox", "--format", "json"]);
assert(attached.status === "attached", `Attach failed: ${JSON.stringify(attached)}`);
assert(attached.project_id, `Attach did not return project_id: ${JSON.stringify(attached)}`);

const requireCaptureBefore = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--require-capture"
]);
assert(
  requireCaptureBefore.status === 2,
  `doctor --require-capture should fail before capture: ${requireCaptureBefore.stdout} ${requireCaptureBefore.stderr}`
);
assert(
  requireCaptureBefore.json?.capture_readiness?.ready === false &&
    requireCaptureBefore.json?.capture_readiness?.required === true,
  `doctor --require-capture missing failed readiness: ${JSON.stringify(requireCaptureBefore.json)}`
);

const dryRun = runCli(["connect", "codex", "--project-dir", projectDir, "--dry-run"]);
assert(dryRun.dry_run === true, `Connect dry-run flag missing: ${JSON.stringify(dryRun)}`);
assert(dryRun.client === "codex", `Codex target mismatch: ${JSON.stringify(dryRun)}`);
assert(
  dryRun.connection_status === "mcp_only",
  `Connect should be MCP-only first slice: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.hook_status === "not_installed",
  `Hooks should not be installed yet: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.capture_status === "not_observed",
  `Unexpected capture status: ${JSON.stringify(dryRun)}`
);
assert(dryRun.writes_files === false, `Dry-run should not write files: ${JSON.stringify(dryRun)}`);
assert(
  dryRun.writes_global_config === false,
  `Connect smoke must not write global config: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.planned_changes.some((change) => change.action === "no_change"),
  `Attach already writes the Codex project MCP config, so connect should be idempotent: ${JSON.stringify(dryRun)}`
);

const connected = runCli(["connect", "codex", "--project-dir", projectDir]);
assert(
  connected.writes_files === false,
  `Codex connect should be idempotent after attach: ${JSON.stringify(connected)}`
);
const writtenConfig = JSON.parse(await readFile(`${projectDir}/.recallant/codex-mcp.json`, "utf8"));
assert(
  writtenConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
  `Codex MCP config missing Recallant server: ${JSON.stringify(writtenConfig)}`
);

const idempotent = runCli(["connect", "codex", "--project-dir", projectDir]);
assert(
  idempotent.writes_files === false,
  `Second connect should be idempotent: ${JSON.stringify(idempotent)}`
);
assert(
  idempotent.planned_changes.some((change) => change.action === "no_change"),
  `Second connect should report no_change: ${JSON.stringify(idempotent)}`
);

const claudeDryRun = runCli(["connect", "claude-code", "--project-dir", projectDir, "--dry-run"]);
assert(
  claudeDryRun.client === "claude_code",
  `Claude alias mismatch: ${JSON.stringify(claudeDryRun)}`
);
assert(
  claudeDryRun.config_file === ".recallant/generic-mcp.json",
  `Claude first slice should use generic config fallback: ${JSON.stringify(claudeDryRun)}`
);
assert(
  claudeDryRun.planned_changes.some((change) => change.action === "write_file"),
  `Claude/generic dry-run should show config write: ${JSON.stringify(claudeDryRun)}`
);

const hookDryRun = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--install-local-hooks",
  "--dry-run"
]);
assert(
  hookDryRun.hook_status === "local_hook_kit_planned" &&
    hookDryRun.writes_files === false &&
    hookDryRun.writes_global_config === false,
  `Hook dry-run should plan only local fail-soft hook files: ${JSON.stringify(hookDryRun)}`
);
assert(
  hookDryRun.planned_changes.some((change) => change.path === ".recallant/hooks/capture-event.sh"),
  `Hook dry-run missing capture-event script: ${JSON.stringify(hookDryRun)}`
);
assert(
  hookDryRun.hook_integration?.fail_soft === true &&
    hookDryRun.hook_integration?.mode === "local_hook_kit",
  `Hook dry-run missing fail-soft integration summary: ${JSON.stringify(hookDryRun)}`
);

const hookConnect = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--install-local-hooks"
]);
assert(
  hookConnect.hook_status === "local_hook_kit_installed" &&
    hookConnect.writes_global_config === false,
  `Hook connect should install local hook kit only: ${JSON.stringify(hookConnect)}`
);
const hookScript = await readFile(`${projectDir}/.recallant/hooks/capture-event.sh`, "utf8");
assert(
  hookScript.includes("exit 0") &&
    hookScript.includes("timeout") &&
    hookScript.includes("agent-event"),
  `Capture hook should be fail-soft and call agent-event: ${hookScript}`
);
const hookFailSoft = spawnSync(`${projectDir}/.recallant/hooks/capture-event.sh`, ["action"], {
  input: "hook smoke should not break agent workflow",
  env: { PATH: "/bin:/usr/bin", RECALLANT_PROJECT_DIR: projectDir },
  encoding: "utf8"
});
assert(
  hookFailSoft.status === 0,
  `Hook script should exit 0 when recallant is unavailable: ${hookFailSoft.stderr}`
);

runCli(["agent-start", "--project-dir", projectDir, "--task-hint", "connect smoke capture"]);
runCli([
  "agent-event",
  "--project-dir",
  projectDir,
  "--kind",
  "decision",
  "--text",
  "Connect smoke decision: doctor --require-capture must prove actual Recallant capture."
]);
runCli([
  "agent-checkpoint",
  "--project-dir",
  projectDir,
  "--focus",
  "Connect smoke captured a real session",
  "--next-step",
  "Use doctor --require-capture as an automated readiness gate."
]);
const requireCaptureAfter = runCliRaw(["doctor", "--project-dir", projectDir, "--require-capture"]);
assert(
  requireCaptureAfter.status === 0,
  `doctor --require-capture should pass after capture: ${requireCaptureAfter.stdout} ${requireCaptureAfter.stderr}`
);
assert(
  requireCaptureAfter.json?.capture_readiness?.ready === true &&
    requireCaptureAfter.json?.capture_readiness?.status === "capture_active",
  `doctor --require-capture missing active readiness: ${JSON.stringify(requireCaptureAfter.json)}`
);

process.stdout.write("Connect CLI smoke passed\n");
