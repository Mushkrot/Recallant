import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

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
assert(
  requireCaptureBefore.json?.client_connection?.status === "mcp_only" &&
    requireCaptureBefore.json?.client_connection?.hook_kit?.status === "not_installed",
  `doctor should report MCP-only before hook installation: ${JSON.stringify(requireCaptureBefore.json?.client_connection)}`
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
assert(
  dryRun.mandatory_startup_layer?.status === "mcp_only" &&
    dryRun.mandatory_startup_layer?.capture_targets?.includes("user_prompt") &&
    dryRun.mandatory_startup_layer?.proof_command?.includes("--require-capture"),
  `Connect dry-run missing mandatory startup diagnostics: ${JSON.stringify(dryRun)}`
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

await writeFile(
  `${projectDir}/.mcp.json`,
  `${JSON.stringify(
    {
      mcpServers: {
        existing_docs: {
          command: "docs-helper",
          args: ["serve"]
        }
      }
    },
    null,
    2
  )}\n`
);

const claudeDryRun = runCli(["connect", "claude-code", "--project-dir", projectDir, "--dry-run"]);
assert(
  claudeDryRun.client === "claude_code",
  `Claude alias mismatch: ${JSON.stringify(claudeDryRun)}`
);
assert(
  claudeDryRun.config_file === ".mcp.json" &&
    claudeDryRun.config_format === "claude_code_mcp_json" &&
    claudeDryRun.client_specific === true &&
    claudeDryRun.merge_mcp_servers === true,
  `Claude connect should use project-local dedicated .mcp.json merge: ${JSON.stringify(claudeDryRun)}`
);
assert(
  claudeDryRun.planned_changes.some((change) => change.action === "backup_file") &&
    claudeDryRun.planned_changes.some(
      (change) => change.action === "merge_file" && change.path === ".mcp.json"
    ) &&
    claudeDryRun.writes_files === false,
  `Claude dry-run should show local backup plus .mcp.json merge without writing: ${JSON.stringify(claudeDryRun)}`
);

const claudeConnected = runCli(["connect", "claude-code", "--project-dir", projectDir]);
assert(
  claudeConnected.writes_files === true &&
    claudeConnected.planned_changes.some((change) => change.action === "backup_file") &&
    claudeConnected.planned_changes.some((change) => change.action === "merge_file"),
  `Claude connect should merge local .mcp.json with backup: ${JSON.stringify(claudeConnected)}`
);
const claudeConfig = JSON.parse(await readFile(`${projectDir}/.mcp.json`, "utf8"));
assert(
  claudeConfig.mcpServers?.existing_docs?.command === "docs-helper" &&
    claudeConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
  `Claude .mcp.json merge did not preserve existing server and add Recallant: ${JSON.stringify(claudeConfig)}`
);
const claudeIdempotent = runCli(["connect", "claude-code", "--project-dir", projectDir]);
assert(
  claudeIdempotent.writes_files === false &&
    claudeIdempotent.planned_changes.some((change) => change.action === "no_change"),
  `Claude second connect should be idempotent: ${JSON.stringify(claudeIdempotent)}`
);

await mkdir(`${projectDir}/.cursor`, { recursive: true });
await writeFile(
  `${projectDir}/.cursor/mcp.json`,
  `${JSON.stringify(
    {
      mcpServers: {
        existing_search: {
          command: "search-helper",
          args: ["stdio"]
        }
      }
    },
    null,
    2
  )}\n`
);

const cursorDryRun = runCli(["connect", "cursor", "--project-dir", projectDir, "--dry-run"]);
assert(
  cursorDryRun.config_file === ".cursor/mcp.json" &&
    cursorDryRun.config_format === "cursor_mcp_json" &&
    cursorDryRun.client_specific === true &&
    cursorDryRun.merge_mcp_servers === true &&
    cursorDryRun.writes_files === false,
  `Cursor connect should use project-local dedicated .cursor/mcp.json merge: ${JSON.stringify(cursorDryRun)}`
);
assert(
  cursorDryRun.planned_changes.some((change) => change.action === "backup_file") &&
    cursorDryRun.planned_changes.some(
      (change) => change.action === "merge_file" && change.path === ".cursor/mcp.json"
    ),
  `Cursor dry-run should show local backup plus .cursor/mcp.json merge: ${JSON.stringify(cursorDryRun)}`
);

const cursorConnected = runCli(["connect", "cursor", "--project-dir", projectDir]);
assert(
  cursorConnected.writes_files === true &&
    cursorConnected.planned_changes.some((change) => change.action === "backup_file") &&
    cursorConnected.planned_changes.some((change) => change.action === "merge_file"),
  `Cursor connect should merge local .cursor/mcp.json with backup: ${JSON.stringify(cursorConnected)}`
);
const cursorConfig = JSON.parse(await readFile(`${projectDir}/.cursor/mcp.json`, "utf8"));
assert(
  cursorConfig.mcpServers?.existing_search?.command === "search-helper" &&
    cursorConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
  `Cursor .cursor/mcp.json merge did not preserve existing server and add Recallant: ${JSON.stringify(cursorConfig)}`
);
const cursorIdempotent = runCli(["connect", "cursor", "--project-dir", projectDir]);
assert(
  cursorIdempotent.writes_files === false &&
    cursorIdempotent.planned_changes.some((change) => change.action === "no_change"),
  `Cursor second connect should be idempotent: ${JSON.stringify(cursorIdempotent)}`
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
    hookDryRun.mandatory_startup_layer?.status === "mcp_and_hooks_planned" &&
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
    hookConnect.mandatory_startup_layer?.status === "mcp_and_hooks_ready" &&
    hookConnect.mandatory_startup_layer?.capture_targets?.includes("pre_compaction_checkpoint") &&
    hookConnect.writes_global_config === false,
  `Hook connect should install local hook kit only: ${JSON.stringify(hookConnect)}`
);
const hookScript = await readFile(`${projectDir}/.recallant/hooks/capture-event.sh`, "utf8");
const promptHookScript = await readFile(`${projectDir}/.recallant/hooks/user-prompt.sh`, "utf8");
const toolHookScript = await readFile(`${projectDir}/.recallant/hooks/tool-result.sh`, "utf8");
const hookManifest = JSON.parse(
  await readFile(`${projectDir}/.recallant/hooks/manifest.json`, "utf8")
);
assert(
  hookScript.includes("exit 0") &&
    hookScript.includes("timeout") &&
    hookScript.includes("agent-event"),
  `Capture hook should be fail-soft and call agent-event: ${hookScript}`
);
assert(
  promptHookScript.includes("--kind prompt") && toolHookScript.includes("--kind tool_result"),
  `Prompt/tool hooks should target explicit capture kinds: ${promptHookScript} ${toolHookScript}`
);
assert(
  hookManifest.fail_soft === true &&
    hookManifest.writes_global_config === false &&
    hookManifest.targets?.user_prompt?.script === ".recallant/hooks/user-prompt.sh" &&
    hookManifest.targets?.tool_result?.script === ".recallant/hooks/tool-result.sh" &&
    hookManifest.ready_proof?.includes("--require-capture"),
  `Hook manifest should expose machine-readable startup targets: ${JSON.stringify(hookManifest)}`
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

const hookBin = `${projectDir}/hook-bin`;
await mkdir(hookBin, { recursive: true });
const wrapperPath = `${hookBin}/recallant`;
await writeFile(
  wrapperPath,
  `#!/usr/bin/env sh\nexec node ${JSON.stringify(`${process.cwd()}/apps/cli/dist/index.js`)} "$@"\n`
);
await chmod(wrapperPath, 0o755);
const hookEnv = {
  ...env,
  PATH: `${hookBin}:${process.env.PATH ?? ""}`,
  RECALLANT_PROJECT_DIR: projectDir
};

const hookSpoolFallback = spawnSync(`${projectDir}/.recallant/hooks/tool-result.sh`, [], {
  input: "Tool result spooled locally after primary hook capture failed.",
  env: {
    ...hookEnv,
    RECALLANT_DATABASE_URL: "postgres://recallant:bad@127.0.0.1:1/recallant_agent_work"
  },
  encoding: "utf8"
});
assert(
  hookSpoolFallback.status === 0,
  `Hook fallback should still exit 0 when primary capture fails: ${hookSpoolFallback.stderr}`
);
const hookSpoolText = await readFile(`${projectDir}/.recallant/spool/spool.jsonl`, "utf8");
assert(
  hookSpoolText.includes("Tool result spooled locally") &&
    hookSpoolText.includes("agent_tool_result"),
  `Hook fallback did not write local spool JSONL: ${hookSpoolText}`
);

function runHook(name, args = [], input = "") {
  const result = spawnSync(`${projectDir}/.recallant/hooks/${name}`, args, {
    input,
    env: hookEnv,
    encoding: "utf8"
  });
  assert(result.status === 0, `${name} should exit 0: ${result.stderr}`);
}

runHook("start-session.sh", ["connect smoke hook session"]);
runHook(
  "user-prompt.sh",
  [],
  "Owner prompt captured through the Recallant local hook kit."
);
runHook(
  "tool-result.sh",
  [],
  "Tool result captured through the Recallant local hook kit."
);
runHook(
  "pre-compaction.sh",
  [],
  "Pre-compaction checkpoint captured through the Recallant local hook kit."
);
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
assert(
  requireCaptureAfter.json?.client_connection?.status === "mcp_and_hooks_ready" &&
    requireCaptureAfter.json?.client_connection?.hook_kit?.ready === true,
  `doctor should report MCP+hooks after hook installation: ${JSON.stringify(requireCaptureAfter.json?.client_connection)}`
);
runHook("stop-session.sh", [], "Stop hook closeout captured through Recallant.");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const captured = await client.query(
    `
      SELECT kind, payload->'metadata'->>'capture_kind' AS capture_kind
      FROM events
      WHERE project_id = $1
      ORDER BY created_at ASC
    `,
    [attached.project_id]
  );
  const capturedPairs = new Set(
    captured.rows.map((row) => `${row.kind}:${row.capture_kind ?? ""}`)
  );
  for (const expected of [
    "turn_user:agent_prompt",
    "tool_result:agent_tool_result",
    "checkpoint:agent_checkpoint",
    "system:agent_closeout"
  ]) {
    assert(
      capturedPairs.has(expected),
      `Hook capture missing ${expected}: ${JSON.stringify(captured.rows)}`
    );
  }
} finally {
  await client.end();
}

process.stdout.write("Connect CLI smoke passed\n");
