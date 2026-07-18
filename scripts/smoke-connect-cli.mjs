import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectDir = `/tmp/recallant-connect-smoke-${randomUUID()}`;
const smokeHome = `${projectDir}/home`;
const env = {
  ...process.env,
  HOME: smokeHome,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
};

function runCli(args) {
  const output = execFileSync("node", ["apps/cli/dist/index.js", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function runCliRaw(args, { parseJson = true } = {}) {
  const output = spawnSync("node", ["apps/cli/dist/index.js", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    status: output.status,
    stdout: output.stdout,
    stderr: output.stderr,
    json: parseJson && output.stdout.trim() ? JSON.parse(output.stdout) : null
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await rm(projectDir, { recursive: true, force: true });
await mkdir(smokeHome, { recursive: true });

const attached = runCli(["attach", projectDir, "--sandbox", "--format", "json"]);
assert(attached.status === "attached", `Attach failed: ${JSON.stringify(attached)}`);
assert(attached.project_id, `Attach did not return project_id: ${JSON.stringify(attached)}`);

const requireCaptureBefore = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--require-memory-loop",
  "--format",
  "json"
]);
assert(
  requireCaptureBefore.status === 0,
  `doctor --require-memory-loop should pass after attach startup smoke: ${requireCaptureBefore.stdout} ${requireCaptureBefore.stderr}`
);
assert(
  requireCaptureBefore.json?.capture_readiness?.ready === true &&
    requireCaptureBefore.json?.capture_readiness?.required === true,
  `doctor --require-memory-loop missing attach startup proof: ${JSON.stringify(requireCaptureBefore.json)}`
);
assert(
  requireCaptureBefore.json?.client_connection?.status === "mcp_only" &&
    requireCaptureBefore.json?.client_connection?.hook_kit?.status === "not_installed" &&
    requireCaptureBefore.json?.client_connection?.hook_kit?.manifest?.status === "missing",
  `doctor should report MCP-only before hook installation: ${JSON.stringify(requireCaptureBefore.json?.client_connection)}`
);
assert(
  requireCaptureBefore.json?.owner_summary?.status === "configured_not_recording" &&
    requireCaptureBefore.json?.owner_summary?.actually_recording === false &&
    requireCaptureBefore.json?.owner_summary?.memory_loop_ready === true &&
    requireCaptureBefore.json?.owner_summary?.client_configured === true &&
    requireCaptureBefore.json?.owner_summary?.hook_capture_ready === false &&
    requireCaptureBefore.json?.owner_summary?.headline.includes("active capture is not proven"),
  `doctor owner summary should separate startup memory-loop proof: ${JSON.stringify(requireCaptureBefore.json?.owner_summary)}`
);

const legacyOnlyDir = `${projectDir}-legacy-only`;
await mkdir(`${legacyOnlyDir}/.recallant`, { recursive: true });
await writeFile(
  `${legacyOnlyDir}/.recallant/config`,
  `${JSON.stringify({ project_id: attached.project_id, recallant_server_url: "http://127.0.0.1:3005" }, null, 2)}\n`
);
await writeFile(
  `${legacyOnlyDir}/.recallant/codex-mcp.json`,
  `${JSON.stringify({ mcpServers: { recallant: { command: "recallant", args: ["mcp-server"] } } }, null, 2)}\n`
);
const legacyOnlyDoctor = runCliRaw(["doctor", "--project-dir", legacyOnlyDir, "--format", "json"]);
assert(
  legacyOnlyDoctor.status === 0 &&
    legacyOnlyDoctor.json?.client_connection?.mcp_configured === false &&
    legacyOnlyDoctor.json?.client_connection?.mcp_configs?.some(
      (config) =>
        config.path === ".recallant/codex-mcp.json" &&
        config.present === true &&
        config.configured === false
    ),
  `Legacy Codex JSON should be reported as reference-only, not configured: ${legacyOnlyDoctor.stdout} ${legacyOnlyDoctor.stderr}`
);

const invalidHooksDir = `${projectDir}-invalid-hooks`;
await mkdir(`${invalidHooksDir}/.recallant`, { recursive: true });
await mkdir(`${invalidHooksDir}/.codex`, { recursive: true });
await writeFile(
  `${invalidHooksDir}/.recallant/config`,
  `${JSON.stringify(
    { project_id: attached.project_id, recallant_server_url: "http://127.0.0.1:3005" },
    null,
    2
  )}\n`
);
await writeFile(`${invalidHooksDir}/.codex/hooks.json`, "{ user-owned invalid json\n");
const invalidHooksConnect = runCliRaw([
  "connect",
  "codex",
  "--project-dir",
  invalidHooksDir,
  "--install-local-hooks",
  "--format",
  "json"
]);
assert(
  invalidHooksConnect.status !== 0 &&
    invalidHooksConnect.stderr.includes("did not overwrite") &&
    (await readFile(`${invalidHooksDir}/.codex/hooks.json`, "utf8")) ===
      "{ user-owned invalid json\n",
  `Invalid user hook config must be preserved: ${invalidHooksConnect.stdout} ${invalidHooksConnect.stderr}`
);

const dryRun = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--no-local-hooks",
  "--dry-run",
  "--format",
  "json"
]);
const dryRunText = runCliRaw(
  ["connect", "codex", "--project-dir", projectDir, "--no-local-hooks", "--dry-run"],
  {
    parseJson: false
  }
);
assert(
  dryRunText.status === 0 &&
    dryRunText.stdout.includes("Recallant connect") &&
    dryRunText.stdout.includes("Agent client: codex") &&
    dryRunText.stdout.includes("Local hooks: skipped") &&
    dryRunText.stdout.includes("Capture configured/proven: configured_without_local_hooks") &&
    dryRunText.stdout.includes("Verification command: recallant doctor --project-dir") &&
    dryRunText.stdout.includes("Next command: recallant connect codex --project-dir") &&
    dryRunText.stdout.includes("JSON output: recallant connect codex"),
  `Connect human dry-run output failed: ${dryRunText.stdout} ${dryRunText.stderr}`
);
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
  dryRun.hook_integration?.native_hooks?.some(
    (entry) => entry.client === "codex" && entry.status === "not_configured"
  ) &&
    dryRun.hook_integration?.native_hooks?.some(
      (entry) => entry.client === "cursor" && entry.status === "unsupported_native_hooks"
    ) &&
    dryRun.client_connection?.hook_installation_status === "not_configured",
  `Connect dry-run should expose native hook installer status matrix: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.memory_loop_status === "not_observed" &&
    dryRun.mandatory_startup_layer?.automatic_agent_audit_active === false,
  `Unexpected readiness status: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.mandatory_startup_layer?.status === "mcp_only" &&
    dryRun.mandatory_startup_layer?.capture_targets?.includes("user_prompt") &&
    dryRun.mandatory_startup_layer?.proof_command?.includes("--require-agent-audit"),
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

const globalConfigPath = `${smokeHome}/.codex/config.toml`;
const globalDryRun = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--global",
  "--dry-run",
  "--format",
  "json"
]);
const globalDryRunText = runCliRaw(
  ["connect", "codex", "--project-dir", projectDir, "--global", "--dry-run"],
  { parseJson: false }
);
assert(
  globalDryRunText.status === 0 &&
    globalDryRunText.stdout.includes("Global client config preview") &&
    globalDryRunText.stdout.includes(globalConfigPath) &&
    globalDryRunText.stdout.includes("writes global config now: no"),
  `Global connect human dry-run output should show exact target and no-write policy: ${globalDryRunText.stdout} ${globalDryRunText.stderr}`
);
assert(
  globalDryRun.dry_run === true &&
    globalDryRun.config_scope === "project_local_and_global_dry_run" &&
    globalDryRun.writes_files === false &&
    globalDryRun.writes_global_config === false,
  `Global connect dry-run should not write files or global config: ${JSON.stringify(globalDryRun)}`
);
assert(
  globalDryRun.project_local_config?.scope === "project_local_config" &&
    globalDryRun.project_local_config?.config_file === ".codex/config.toml",
  `Global dry-run should distinguish project-local config: ${JSON.stringify(globalDryRun)}`
);
assert(
  globalDryRun.global_config?.scope === "global_client_config" &&
    globalDryRun.global_config?.target_file === globalConfigPath &&
    globalDryRun.global_config?.planned_merge?.server_name === "recallant" &&
    globalDryRun.global_config?.planned_merge?.preserve_existing_client_settings === true &&
    globalDryRun.global_config?.safety?.this_goal_writes_global_config === false,
  `Global dry-run should show exact target file and planned merge: ${JSON.stringify(globalDryRun)}`
);
assert(
  globalDryRun.planned_changes.some(
    (change) =>
      change.action === "preview_global_merge" &&
      change.path === globalConfigPath &&
      change.scope === "global_client_config" &&
      change.writes_file === false
  ),
  `Global dry-run planned changes should include no-write global preview: ${JSON.stringify(globalDryRun)}`
);
const globalBlocked = runCliRaw(["connect", "codex", "--project-dir", projectDir, "--global"], {
  parseJson: false
});
assert(
  globalBlocked.status !== 0 && globalBlocked.stderr.includes("Run --global --dry-run first"),
  `connect --global without dry-run must be blocked: ${globalBlocked.stdout} ${globalBlocked.stderr}`
);
assert(
  spawnSync("test", ["!", "-e", globalConfigPath]).status === 0,
  `Global dry-run must not create ${globalConfigPath}`
);

const connected = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--no-local-hooks",
  "--format",
  "json"
]);
assert(
  connected.writes_files === false,
  `Codex connect should be idempotent after attach: ${JSON.stringify(connected)}`
);
const writtenConfig = await readFile(`${projectDir}/.codex/config.toml`, "utf8");
assert(
  writtenConfig.includes("[mcp_servers.recallant]") &&
    writtenConfig.includes('command = "recallant"') &&
    writtenConfig.includes('env_vars = ["RECALLANT_DATABASE_URL"]'),
  `Codex config missing Recallant MCP server: ${writtenConfig}`
);

const idempotent = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--no-local-hooks",
  "--format",
  "json"
]);
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

const claudeDryRun = runCli([
  "connect",
  "claude-code",
  "--project-dir",
  projectDir,
  "--dry-run",
  "--format",
  "json"
]);
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

const claudeConnected = runCli([
  "connect",
  "claude-code",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
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
const claudeIdempotent = runCli([
  "connect",
  "claude-code",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
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

const cursorDryRun = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--dry-run",
  "--format",
  "json"
]);
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

const cursorConnected = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
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
const cursorIdempotent = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
assert(
  cursorIdempotent.writes_files === false &&
    cursorIdempotent.planned_changes.some((change) => change.action === "no_change"),
  `Cursor second connect should be idempotent: ${JSON.stringify(cursorIdempotent)}`
);

const cursorGlobalPath = `${smokeHome}/.cursor/mcp.json`;
await mkdir(`${smokeHome}/.cursor`, { recursive: true });
const cursorGlobalOriginal = {
  mcpServers: {
    global_existing: {
      command: "global-helper",
      args: ["stdio"]
    }
  },
  uiPreferences: {
    preserve_me: true
  }
};
await writeFile(`${cursorGlobalPath}`, `${JSON.stringify(cursorGlobalOriginal, null, 2)}\n`);
const cursorGlobalDryRun = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--global",
  "--dry-run",
  "--format",
  "json"
]);
assert(
  cursorGlobalDryRun.global_config?.writer_supported === true &&
    cursorGlobalDryRun.global_config?.target_file === cursorGlobalPath &&
    cursorGlobalDryRun.global_config?.backup_path &&
    cursorGlobalDryRun.global_config?.restore_command?.includes("--restore-global-backup") &&
    cursorGlobalDryRun.global_config?.confirmation_command?.includes("--previewed-global-target") &&
    cursorGlobalDryRun.writes_global_config === false &&
    cursorGlobalDryRun.planned_changes.some(
      (change) =>
        change.action === "preview_global_merge" &&
        change.path === cursorGlobalPath &&
        change.writes_file === false
    ),
  `Cursor global dry-run should show target, backup, restore, and no-write merge: ${JSON.stringify(cursorGlobalDryRun)}`
);
const cursorGlobalAfterDryRun = JSON.parse(await readFile(cursorGlobalPath, "utf8"));
assert(
  cursorGlobalAfterDryRun.mcpServers?.recallant === undefined &&
    cursorGlobalAfterDryRun.mcpServers?.global_existing?.command === "global-helper",
  `Cursor global dry-run changed the global file: ${JSON.stringify(cursorGlobalAfterDryRun)}`
);
const cursorGlobalWriteWithoutPreview = runCliRaw(
  ["connect", "cursor", "--project-dir", projectDir, "--global", "--confirm-global-write"],
  { parseJson: false }
);
assert(
  cursorGlobalWriteWithoutPreview.status !== 0 &&
    cursorGlobalWriteWithoutPreview.stderr.includes("--previewed-global-target"),
  `Cursor global write should require exact dry-run target confirmation: ${cursorGlobalWriteWithoutPreview.stdout} ${cursorGlobalWriteWithoutPreview.stderr}`
);
const cursorGlobalWrite = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--global",
  "--confirm-global-write",
  "--previewed-global-target",
  cursorGlobalPath,
  "--format",
  "json"
]);
assert(
  cursorGlobalWrite.writes_global_config === true &&
    cursorGlobalWrite.global_config?.backup_path &&
    cursorGlobalWrite.planned_changes.some(
      (change) =>
        change.action === "backup_global_file" &&
        change.scope === "global_client_config" &&
        change.writes_file === true
    ) &&
    cursorGlobalWrite.planned_changes.some(
      (change) =>
        change.action === "write_global_file" &&
        change.path === cursorGlobalPath &&
        change.writes_file === true
    ),
  `Cursor global write should be explicit, audited, and backed up: ${JSON.stringify(cursorGlobalWrite)}`
);
const cursorGlobalMerged = JSON.parse(await readFile(cursorGlobalPath, "utf8"));
assert(
  cursorGlobalMerged.mcpServers?.global_existing?.command === "global-helper" &&
    cursorGlobalMerged.mcpServers?.recallant?.args?.includes("mcp-server") &&
    cursorGlobalMerged.uiPreferences?.preserve_me === true,
  `Cursor global merge did not preserve existing config and add Recallant: ${JSON.stringify(cursorGlobalMerged)}`
);
const cursorGlobalBackupPath = cursorGlobalWrite.global_config.backup_path;
assert(
  spawnSync("test", ["-f", cursorGlobalBackupPath]).status === 0,
  `Cursor global write should create backup before changing config: ${cursorGlobalBackupPath}`
);
const cursorGlobalBackup = JSON.parse(await readFile(cursorGlobalBackupPath, "utf8"));
assert(
  cursorGlobalBackup.mcpServers?.global_existing?.command === "global-helper" &&
    cursorGlobalBackup.mcpServers?.recallant === undefined,
  `Cursor global backup should contain original config: ${JSON.stringify(cursorGlobalBackup)}`
);
const cursorGlobalWriteAgain = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--global",
  "--confirm-global-write",
  "--previewed-global-target",
  cursorGlobalPath,
  "--format",
  "json"
]);
assert(
  cursorGlobalWriteAgain.writes_global_config === false &&
    cursorGlobalWriteAgain.planned_changes.some(
      (change) => change.action === "no_change" && change.scope === "global_client_config"
    ),
  `Second Cursor global write should be idempotent: ${JSON.stringify(cursorGlobalWriteAgain)}`
);
await writeFile(
  cursorGlobalPath,
  `${JSON.stringify({ mcpServers: { recallant: { command: "broken" } } }, null, 2)}\n`
);
const cursorGlobalRestore = runCli([
  "connect",
  "cursor",
  "--project-dir",
  projectDir,
  "--global",
  "--restore-global-backup",
  cursorGlobalBackupPath,
  "--format",
  "json"
]);
assert(
  cursorGlobalRestore.writes_global_config === true &&
    cursorGlobalRestore.planned_changes.some(
      (change) =>
        change.action === "restore_global_backup" &&
        change.backup_path === cursorGlobalBackupPath &&
        change.path === cursorGlobalPath
    ),
  `Cursor global restore should report restored backup: ${JSON.stringify(cursorGlobalRestore)}`
);
const cursorGlobalRestored = JSON.parse(await readFile(cursorGlobalPath, "utf8"));
assert(
  cursorGlobalRestored.mcpServers?.global_existing?.command === "global-helper" &&
    cursorGlobalRestored.mcpServers?.recallant === undefined &&
    cursorGlobalRestored.uiPreferences?.preserve_me === true,
  `Cursor global restore did not restore the original config: ${JSON.stringify(cursorGlobalRestored)}`
);

const userCodexHookConfig = {
  description: "User-owned Codex hooks.",
  custom_setting: { preserve_me: true },
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "user-owned-pre-tool-hook", timeout: 17 }]
      }
    ],
    UserPromptSubmit: [
      {
        hooks: [{ type: "command", command: "user-owned-prompt-hook" }]
      }
    ]
  }
};
await writeFile(
  `${projectDir}/.codex/hooks.json`,
  `${JSON.stringify(userCodexHookConfig, null, 2)}\n`
);

const hookDryRun = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--dry-run",
  "--format",
  "json"
]);
assert(
  hookDryRun.hook_status === "local_hook_kit_planned" &&
    hookDryRun.connection_status === "mcp_and_hooks_planned" &&
    hookDryRun.mandatory_startup_layer?.status === "mcp_and_hooks_planned" &&
    hookDryRun.writes_files === false &&
    hookDryRun.writes_global_config === false,
  `Hook dry-run should plan only local fail-soft hook files: ${JSON.stringify(hookDryRun)}`
);
assert(
  hookDryRun.planned_changes.some(
    (change) => change.path === ".recallant/hooks/capture-event.sh"
  ) &&
    hookDryRun.planned_changes.some(
      (change) => change.action === "merge_file" && change.path === ".codex/hooks.json"
    ) &&
    hookDryRun.planned_changes.some(
      (change) =>
        change.action === "backup_file" && String(change.path).endsWith(".codex__hooks.json")
    ),
  `Hook dry-run missing helper/native hook plans: ${JSON.stringify(hookDryRun)}`
);
assert(
  hookDryRun.hook_integration?.fail_soft === true &&
    hookDryRun.hook_integration?.mode === "codex_native_hooks_with_helper_kit" &&
    hookDryRun.native_hook_config?.status === "configured_planned" &&
    hookDryRun.native_hook_config?.preserved_handler_count === 2 &&
    hookDryRun.native_hook_config?.trust_action?.includes("/hooks") &&
    hookDryRun.hook_integration?.native_hooks?.some(
      (entry) => entry.client === "claude_code" && entry.ready === false
    ),
  `Hook dry-run missing fail-soft integration summary: ${JSON.stringify(hookDryRun)}`
);

const hookConnect = runCli(["connect", "codex", "--project-dir", projectDir, "--format", "json"]);
assert(
  hookConnect.hook_status === "local_hook_kit_installed" &&
    hookConnect.connection_status === "mcp_and_hooks_ready" &&
    hookConnect.mandatory_startup_layer?.status === "mcp_and_hooks_ready" &&
    hookConnect.mandatory_startup_layer?.capture_targets?.includes("pre_compaction_checkpoint") &&
    hookConnect.mandatory_startup_layer?.automatic_capture_events?.includes("Stop") &&
    hookConnect.client_connection?.hook_installation_status === "configured_unobserved" &&
    hookConnect.client_connection?.automatic_agent_audit?.configured === true &&
    hookConnect.client_connection?.automatic_agent_audit?.capture_active === false &&
    hookConnect.native_hook_config?.backup_path &&
    hookConnect.writes_global_config === false,
  `Hook connect should install helper and native project hooks: ${JSON.stringify(hookConnect)}`
);
const mergedCodexHooks = JSON.parse(await readFile(`${projectDir}/.codex/hooks.json`, "utf8"));
assert(
  mergedCodexHooks.description === "User-owned Codex hooks." &&
    mergedCodexHooks.custom_setting?.preserve_me === true &&
    mergedCodexHooks.hooks?.PreToolUse?.some((group) =>
      group.hooks?.some((handler) => handler.command === "user-owned-pre-tool-hook")
    ) &&
    mergedCodexHooks.hooks?.UserPromptSubmit?.some((group) =>
      group.hooks?.some((handler) => handler.command === "user-owned-prompt-hook")
    ),
  `Native hook merge did not preserve user configuration: ${JSON.stringify(mergedCodexHooks)}`
);
for (const eventName of [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop"
]) {
  assert(
    mergedCodexHooks.hooks?.[eventName]?.some((group) =>
      group.hooks?.some(
        (handler) =>
          handler.type === "command" &&
          handler.command === "recallant codex-hook" &&
          handler.timeout === 5
      )
    ),
    `Native hook event ${eventName} is not configured: ${JSON.stringify(mergedCodexHooks)}`
  );
}
const backedUpCodexHooks = JSON.parse(
  await readFile(hookConnect.native_hook_config.backup_path, "utf8")
);
assert(
  backedUpCodexHooks.custom_setting?.preserve_me === true && !backedUpCodexHooks.hooks?.Stop,
  `Native hook backup does not contain the original file: ${JSON.stringify(backedUpCodexHooks)}`
);
const requireAgentAuditBefore = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--require-agent-audit",
  "--format",
  "json"
]);
assert(
  requireAgentAuditBefore.status === 2 &&
    requireAgentAuditBefore.json?.agent_audit?.status === "configured_unobserved" &&
    requireAgentAuditBefore.json?.agent_audit?.configured === true &&
    requireAgentAuditBefore.json?.agent_audit?.capture_active === false &&
    requireAgentAuditBefore.json?.agent_audit?.trust_action?.includes("/hooks"),
  `Agent audit must remain unobserved until codex-hook runs: ${requireAgentAuditBefore.stdout} ${requireAgentAuditBefore.stderr}`
);
const hookIdempotentDryRun = runCli([
  "connect",
  "codex",
  "--project-dir",
  projectDir,
  "--dry-run",
  "--format",
  "json"
]);
assert(
  hookIdempotentDryRun.hook_status === "local_hook_kit_installed" &&
    hookIdempotentDryRun.connection_status === "mcp_and_hooks_ready" &&
    hookIdempotentDryRun.mandatory_startup_layer?.status === "mcp_and_hooks_ready" &&
    hookIdempotentDryRun.writes_files === false &&
    hookIdempotentDryRun.planned_changes.every((change) => change.action === "no_change"),
  `Hook dry-run should report ready when all local hook files are already installed: ${JSON.stringify(
    hookIdempotentDryRun
  )}`
);
const hookScript = await readFile(`${projectDir}/.recallant/hooks/capture-event.sh`, "utf8");
const promptHookScript = await readFile(`${projectDir}/.recallant/hooks/user-prompt.sh`, "utf8");
const assistantHookScript = await readFile(
  `${projectDir}/.recallant/hooks/assistant-response.sh`,
  "utf8"
);
const toolCallHookScript = await readFile(`${projectDir}/.recallant/hooks/tool-call.sh`, "utf8");
const toolHookScript = await readFile(`${projectDir}/.recallant/hooks/tool-result.sh`, "utf8");
const errorHookScript = await readFile(`${projectDir}/.recallant/hooks/error.sh`, "utf8");
const verificationHookScript = await readFile(
  `${projectDir}/.recallant/hooks/verification.sh`,
  "utf8"
);
const preCompactionHookScript = await readFile(
  `${projectDir}/.recallant/hooks/pre-compaction.sh`,
  "utf8"
);
const stopHookScript = await readFile(`${projectDir}/.recallant/hooks/stop-session.sh`, "utf8");
const closeoutHookScript = await readFile(`${projectDir}/.recallant/hooks/closeout.sh`, "utf8");
const hookReadme = await readFile(`${projectDir}/.recallant/hooks/README.md`, "utf8");
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
  promptHookScript.includes("--kind prompt") &&
    promptHookScript.includes("--turn-id") &&
    assistantHookScript.includes("--kind assistant_response") &&
    toolCallHookScript.includes("--kind tool_call") &&
    toolHookScript.includes("--kind tool_result") &&
    errorHookScript.includes("--kind error") &&
    verificationHookScript.includes("--resolution-status resolved"),
  `Prompt/tool hooks should target explicit capture kinds: ${promptHookScript} ${toolHookScript}`
);
assert(
  stopHookScript.includes("agent-closeout") && closeoutHookScript.includes("agent-closeout"),
  `Stop/closeout hooks should route to agent-closeout: ${stopHookScript} ${closeoutHookScript}`
);
assert(
  preCompactionHookScript.includes("agent-checkpoint") &&
    !preCompactionHookScript.includes("agent-closeout"),
  `Pre-compaction hook should be checkpoint state, not closeout: ${preCompactionHookScript}`
);
assert(
  hookReadme.includes("pre-compaction.sh") &&
    hookReadme.includes("records state only") &&
    hookReadme.includes("not semantic closeout proof") &&
    hookReadme.includes("normal helper-script closeout gate") &&
    hookReadme.includes("Native Codex `Stop` is turn-scoped") &&
    hookReadme.includes("`recallant codex-hook` directly"),
  `Hook README should label checkpoint versus closeout semantics: ${hookReadme}`
);
assert(
  hookManifest.fail_soft === true &&
    hookManifest.writes_global_config === false &&
    hookManifest.targets?.user_prompt?.script === ".recallant/hooks/user-prompt.sh" &&
    hookManifest.targets?.assistant_response?.script === ".recallant/hooks/assistant-response.sh" &&
    hookManifest.targets?.tool_call?.script === ".recallant/hooks/tool-call.sh" &&
    hookManifest.targets?.tool_result?.script === ".recallant/hooks/tool-result.sh" &&
    hookManifest.targets?.error?.script === ".recallant/hooks/error.sh" &&
    hookManifest.targets?.retry?.script === ".recallant/hooks/retry.sh" &&
    hookManifest.targets?.remediation?.script === ".recallant/hooks/remediation.sh" &&
    hookManifest.targets?.verification?.script === ".recallant/hooks/verification.sh" &&
    hookManifest.targets?.pre_compaction_checkpoint?.input?.includes("state-only") &&
    hookManifest.targets?.checkpoint?.input?.includes("not semantic closeout proof") &&
    hookManifest.targets?.stop_closeout?.input?.includes("normal closeout") &&
    hookManifest.ready_proof?.includes("--require-memory-loop"),
  `Hook manifest should expose machine-readable startup targets: ${JSON.stringify(hookManifest)}`
);

await writeFile(
  `${projectDir}/.recallant/hooks/manifest.json`,
  `${JSON.stringify({ ...hookManifest, fail_soft: false }, null, 2)}\n`
);
const invalidManifestDoctor = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
assert(
  invalidManifestDoctor.status === 0 &&
    invalidManifestDoctor.json?.client_connection?.status === "mcp_and_hooks_ready" &&
    invalidManifestDoctor.json?.client_connection?.hook_kit?.status === "invalid_manifest" &&
    invalidManifestDoctor.json?.client_connection?.hook_kit?.ready === false &&
    invalidManifestDoctor.json?.client_connection?.automatic_agent_audit?.configured === true,
  `Invalid helper manifest should not disable native hook readiness: ${JSON.stringify(
    invalidManifestDoctor.json?.client_connection
  )}`
);
await writeFile(
  `${projectDir}/.recallant/hooks/manifest.json`,
  `${JSON.stringify(hookManifest, null, 2)}\n`
);

await chmod(`${projectDir}/.recallant/hooks/tool-result.sh`, 0o644);
const invalidPermissionDoctor = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--format",
  "json"
]);
assert(
  invalidPermissionDoctor.status === 0 &&
    invalidPermissionDoctor.json?.client_connection?.status === "mcp_and_hooks_ready" &&
    invalidPermissionDoctor.json?.client_connection?.hook_kit?.status === "invalid_permissions" &&
    invalidPermissionDoctor.json?.client_connection?.hook_kit?.ready === false &&
    invalidPermissionDoctor.json?.client_connection?.automatic_agent_audit?.configured === true,
  `Non-executable helper should not disable native hook readiness: ${JSON.stringify(
    invalidPermissionDoctor.json?.client_connection
  )}`
);
await chmod(`${projectDir}/.recallant/hooks/tool-result.sh`, 0o755);

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
  RECALLANT_PROJECT_DIR: projectDir,
  RECALLANT_HOOK_TIMEOUT_SECONDS: "45"
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

function runHook(name, args = [], input = "", extraEnv = {}) {
  const result = spawnSync(`${projectDir}/.recallant/hooks/${name}`, args, {
    input,
    env: { ...hookEnv, ...extraEnv },
    encoding: "utf8"
  });
  assert(result.status === 0, `${name} should exit 0: ${result.stderr}`);
}

runHook("start-session.sh", ["connect smoke hook session"]);
const hookTurnId = randomUUID();
const hookToolTraceId = randomUUID();
const hookErrorTraceId = randomUUID();
runHook("user-prompt.sh", [], "Owner prompt captured through the Recallant local hook kit.", {
  RECALLANT_HOOK_TURN_ID: hookTurnId
});
runHook(
  "assistant-response.sh",
  [],
  "Assistant response captured through the Recallant local hook kit.",
  { RECALLANT_HOOK_TURN_ID: hookTurnId }
);
runHook("tool-call.sh", ["fixture_tool"], "Tool call captured through the hook kit.", {
  RECALLANT_HOOK_TRACE_ID: hookToolTraceId
});
runHook("tool-result.sh", [], "Tool result captured through the Recallant local hook kit.", {
  RECALLANT_HOOK_TRACE_ID: hookToolTraceId
});
runHook("error.sh", ["FIXTURE_ERROR"], "Recoverable hook fixture error.", {
  RECALLANT_HOOK_TRACE_ID: hookErrorTraceId
});
runHook("retry.sh", [], "Retry the hook fixture.", {
  RECALLANT_HOOK_TRACE_ID: hookErrorTraceId,
  RECALLANT_HOOK_ATTEMPT: "2"
});
runHook("remediation.sh", [], "Repair the hook fixture.", {
  RECALLANT_HOOK_TRACE_ID: hookErrorTraceId
});
runHook("verification.sh", [], "Hook fixture recovery verified.", {
  RECALLANT_HOOK_TRACE_ID: hookErrorTraceId
});
runHook(
  "pre-compaction.sh",
  [],
  "Pre-compaction checkpoint captured through the Recallant local hook kit."
);
const requireCaptureAfter = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--require-memory-loop",
  "--format",
  "json"
]);
assert(
  requireCaptureAfter.status === 0,
  `doctor --require-memory-loop should pass after memory-loop capture: ${requireCaptureAfter.stdout} ${requireCaptureAfter.stderr}`
);
assert(
  requireCaptureAfter.json?.capture_readiness?.ready === true &&
    requireCaptureAfter.json?.capture_readiness?.status === "memory_loop_ready",
  `doctor --require-memory-loop missing readiness: ${JSON.stringify(requireCaptureAfter.json)}`
);
assert(
  requireCaptureAfter.json?.client_connection?.status === "mcp_and_hooks_ready" &&
    requireCaptureAfter.json?.client_connection?.hook_kit?.ready === true &&
    requireCaptureAfter.json?.client_connection?.hook_kit?.manifest?.valid === true,
  `doctor should report MCP+hooks after hook installation: ${JSON.stringify(requireCaptureAfter.json?.client_connection)}`
);
assert(
  requireCaptureAfter.json?.owner_summary?.status === "configured_not_recording" &&
    requireCaptureAfter.json?.owner_summary?.actually_recording === false &&
    requireCaptureAfter.json?.owner_summary?.memory_loop_ready === true &&
    requireCaptureAfter.json?.owner_summary?.client_configured === true &&
    requireCaptureAfter.json?.owner_summary?.hook_capture_ready === true &&
    requireCaptureAfter.json?.owner_summary?.automatic_agent_audit_configured === true &&
    requireCaptureAfter.json?.owner_summary?.automatic_agent_audit_active === false &&
    requireCaptureAfter.json?.owner_summary?.proof.includes("capture_active requires a fresh"),
  `doctor owner summary should separate memory-loop and automatic capture: ${JSON.stringify(requireCaptureAfter.json?.owner_summary)}`
);
runHook("stop-session.sh", [], "Stop hook closeout captured through Recallant.");

const nativeHookCanary = spawnSync(
  "node",
  [`${process.cwd()}/apps/cli/dist/index.js`, "codex-hook"],
  {
    cwd: projectDir,
    env,
    input: JSON.stringify({
      session_id: "connect-smoke-native-session",
      cwd: projectDir,
      hook_event_name: "UserPromptSubmit",
      turn_id: "connect-smoke-native-turn",
      model: "gpt-5",
      transcript_path: "/tmp/ignored-connect-smoke-transcript.jsonl",
      prompt: "Native Codex hook smoke."
    }),
    encoding: "utf8"
  }
);
assert(
  nativeHookCanary.status === 0 && nativeHookCanary.stdout === "" && nativeHookCanary.stderr === "",
  `Native codex-hook canary must be silent and successful: ${nativeHookCanary.stdout} ${nativeHookCanary.stderr}`
);
const requireAgentAuditAfter = runCliRaw([
  "doctor",
  "--project-dir",
  projectDir,
  "--require-agent-audit",
  "--format",
  "json"
]);
assert(
  requireAgentAuditAfter.status === 0 &&
    requireAgentAuditAfter.json?.agent_audit?.status === "observed_server" &&
    requireAgentAuditAfter.json?.agent_audit?.capture_active === true &&
    requireAgentAuditAfter.json?.agent_audit?.last_event_name === "UserPromptSubmit" &&
    requireAgentAuditAfter.json?.owner_summary?.automatic_agent_audit_active === true,
  `Agent audit should become observed after the native path runs: ${requireAgentAuditAfter.stdout} ${requireAgentAuditAfter.stderr}`
);

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
  const observations = await client.query(
    `
      SELECT kind, trace_id::text, resolution_status
      FROM agent_observations
      WHERE project_id = $1
      ORDER BY sequence_number ASC
    `,
    [attached.project_id]
  );
  const observedKinds = new Set(observations.rows.map((row) => row.kind));
  for (const expected of [
    "user_prompt",
    "assistant_response",
    "tool_call",
    "tool_result",
    "error",
    "retry",
    "remediation",
    "verification",
    "closeout"
  ]) {
    assert(
      observedKinds.has(expected),
      `Observation hook capture missing ${expected}: ${JSON.stringify(observations.rows)}`
    );
  }
  const errorRow = observations.rows.find((row) => row.kind === "error");
  const verificationRow = observations.rows.find((row) => row.kind === "verification");
  assert(
    errorRow?.trace_id === verificationRow?.trace_id &&
      verificationRow?.resolution_status === "resolved",
    `Hook error recovery chain was not correlated: ${JSON.stringify(observations.rows)}`
  );
} finally {
  await client.end();
}

process.stdout.write("Connect CLI smoke passed\n");
