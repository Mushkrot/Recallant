import { execFile, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const tempRoots = [];

function commandEnv(extra = {}) {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: "",
    RECALLANT_PROJECT_PATH: "",
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    ...extra
  };
}

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function cli(cwd, args, extraEnv = {}, expectStatus = 0) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: commandEnv(extraEnv),
    maxBuffer: 12 * 1024 * 1024
  }).catch((error) => error);
  if (result.code !== undefined && result.code !== expectStatus) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`
    );
  }
  const stdout = result.stdout ?? "";
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashTree(root) {
  const entries = {};
  async function walk(dir, prefix = "") {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = join(dir, child.name);
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) {
        await walk(childPath, relative);
        continue;
      }
      const content = await readFile(childPath);
      entries[relative] = createHash("sha256").update(content).digest("hex");
    }
  }
  await walk(root);
  return entries;
}

function diffTrees(before, after) {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  return {
    added: [...afterKeys].filter((key) => !beforeKeys.has(key)).sort(),
    removed: [...beforeKeys].filter((key) => !afterKeys.has(key)).sort(),
    changed: [...afterKeys]
      .filter((key) => beforeKeys.has(key) && before[key] !== after[key])
      .sort()
  };
}

async function installHookCliWrapper(projectDir) {
  const hookBin = join(projectDir, ".recallant", "hook-bin");
  await mkdir(hookBin, { recursive: true });
  const wrapperPath = join(hookBin, "recallant");
  await writeFile(wrapperPath, `#!/usr/bin/env sh\nexec node ${JSON.stringify(cliPath)} "$@"\n`);
  await chmod(wrapperPath, 0o755);
  return {
    ...commandEnv(),
    PATH: `${hookBin}:${process.env.PATH ?? ""}`,
    RECALLANT_PROJECT_DIR: projectDir
  };
}

function runProjectHook(projectDir, hookEnv, name, args = [], input = "") {
  const result = spawnSync(join(projectDir, ".recallant", "hooks", name), args, {
    input,
    env: hookEnv,
    encoding: "utf8"
  });
  assert(
    result.status === 0,
    `hook ${name} should be fail-soft and exit 0: ${result.stderr}\n${result.stdout}`
  );
}

function assertStartupMatrix(doctor, label) {
  const connection = doctor.client_connection;
  const nativeHooks = connection?.native_hooks ?? [];
  const clients = new Set(nativeHooks.map((entry) => entry.client));
  assert(
    connection?.proof_command?.includes("--require-capture"),
    `${label}: proof command missing`
  );
  assert(
    ["codex", "cursor", "claude_code", "generic"].every((client) => clients.has(client)),
    `${label}: native hook matrix missing clients: ${JSON.stringify(nativeHooks)}`
  );
  assert(
    nativeHooks.some(
      (entry) => entry.client === "codex" && entry.status === "local_hook_kit_supported"
    ),
    `${label}: Codex hook-kit status missing: ${JSON.stringify(nativeHooks)}`
  );
  assert(
    nativeHooks.some(
      (entry) => entry.client === "cursor" && entry.status === "unsupported_native_hooks"
    ),
    `${label}: Cursor unsupported-native status missing: ${JSON.stringify(nativeHooks)}`
  );
  assert(
    nativeHooks.some(
      (entry) =>
        entry.client === "claude_code" && entry.status === "manual_or_unsupported_native_hooks"
    ),
    `${label}: Claude Code manual-native status missing: ${JSON.stringify(nativeHooks)}`
  );
  assert(
    nativeHooks.some(
      (entry) => entry.client === "generic" && entry.status === "unsupported_native_hooks"
    ),
    `${label}: generic fallback native status missing: ${JSON.stringify(nativeHooks)}`
  );
  const captureTargets = connection?.capture_targets ?? connection?.hook_kit?.capture_targets ?? [];
  assert(
    captureTargets.includes("user_prompt") && captureTargets.includes("pre_compaction_checkpoint"),
    `${label}: capture targets missing: ${JSON.stringify(connection)}`
  );
  assert(doctor.local_spool_status?.status, `${label}: local spool status missing`);
  assert(
    typeof doctor.owner_summary?.proof === "string" &&
      doctor.owner_summary.proof.includes("context read") &&
      typeof doctor.owner_summary?.headline === "string",
    `${label}: owner summary does not distinguish configured from recording`
  );
}

async function runLifecycle(projectDir, marker, label) {
  const started = await cli(projectDir, ["agent-start", "--task-hint", `${label} ${marker}`]);
  assert(started.session_id, `${label}: session did not start`);

  await cli(projectDir, ["context", "--task-hint", `${label} context read ${marker}`]);

  const decision = await cli(projectDir, [
    "agent-event",
    "--kind",
    "decision",
    "--title",
    `${label} remembered decision`,
    "--text",
    `Stage 4 ${label} memory ${marker}: capture must be proven before owner QA.`
  ]);
  assert(decision.memory?.status === "accepted", `${label}: memory was not written`);

  const checkpoint = await cli(projectDir, [
    "agent-checkpoint",
    "--status",
    "stage4_acceptance",
    "--focus",
    `Stage 4 ${label} checkpoint ${marker}`,
    "--next-step",
    `Recall ${marker} later`,
    "--summary",
    `Stage 4 ${label} checkpoint ${marker}`
  ]);
  assert(checkpoint.event_id, `${label}: checkpoint missing`);

  await cli(projectDir, [
    "agent-closeout",
    "--status",
    "closed",
    "--focus",
    `Closed ${label} ${marker}`,
    "--next-step",
    `Later recall should find ${marker}`,
    "--summary",
    `Closed Stage 4 ${label} ${marker}`
  ]);

  const later = await cli(projectDir, [
    "agent-start",
    "--task-hint",
    `${label} later recall ${marker}`
  ]);
  assert(later.session_id !== started.session_id, `${label}: later session did not start fresh`);

  const context = await cli(projectDir, [
    "context",
    "--task-hint",
    `${label} later recall ${marker}`
  ]);
  assert(
    (context.sections?.working_memories ?? []).some((memory) =>
      String(memory.body).includes(marker)
    ),
    `${label}: later context did not recall memory ${marker}`
  );
  assert(
    String(context.sections?.checkpoint?.payload?.next_step ?? "").includes(marker),
    `${label}: later context did not recall checkpoint ${marker}`
  );

  const ask = await cli(projectDir, [
    "ask",
    "what did the agent remember?",
    "--project-dir",
    projectDir,
    "--format",
    "json"
  ]);
  assert(
    ask.recalled === true &&
      ask.memories?.some((memory) => String(memory.body ?? "").includes(marker)),
    `${label}: ask did not recall memory ${marker}: ${JSON.stringify(ask)}`
  );

  const doctor = await cli(projectDir, ["doctor", "--require-capture", "--format", "json"]);
  assert(
    doctor.capture_readiness?.ready === true &&
      doctor.capture_readiness?.status === "capture_active" &&
      doctor.owner_summary?.actually_recording === true,
    `${label}: doctor --require-capture did not prove capture active: ${JSON.stringify(doctor)}`
  );
  assertStartupMatrix(doctor, `${label} after capture`);

  return {
    started_session: started.session_id,
    later_session: later.session_id,
    memory_written: true,
    checkpoint_exists: true,
    later_context_recalled: true,
    ask_recalled: true,
    doctor_status: doctor.capture_readiness.status,
    client_connection_status: doctor.client_connection.status,
    owner_summary_status: doctor.owner_summary.status
  };
}

async function runCodexControlledPath() {
  const projectDir = await makeTempDir("recallant-stage4-codex-");
  const marker = `STAGE4-CODEX-${randomUUID()}`;
  const before = await hashTree(projectDir);
  const attach = await cli(projectDir, ["attach", projectDir, "--sandbox", "--format", "json"]);
  assert(attach.status === "attached", `Codex path attach failed: ${JSON.stringify(attach)}`);

  const doctorBefore = await cli(
    projectDir,
    ["doctor", "--project-dir", projectDir, "--require-capture", "--format", "json"],
    {},
    2
  );
  assert(
    doctorBefore.owner_summary?.status === "configured_not_recording" &&
      doctorBefore.owner_summary?.actually_recording === false,
    `Codex path should start configured but not recording: ${JSON.stringify(doctorBefore.owner_summary)}`
  );
  assertStartupMatrix(doctorBefore, "Codex before capture");

  const connectDryRun = await cli(projectDir, [
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert(
    connectDryRun.mandatory_startup_layer?.status === "mcp_and_hooks_planned" &&
      connectDryRun.writes_global_config === false,
    `Codex dry-run did not plan local hooks safely: ${JSON.stringify(connectDryRun)}`
  );

  const connect = await cli(projectDir, [
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--format",
    "json"
  ]);
  assert(
    connect.hook_status === "local_hook_kit_installed" &&
      connect.client_connection?.hook_installation_status === "local_hook_kit_ready" &&
      connect.writes_global_config === false,
    `Codex connect did not install local hook kit safely: ${JSON.stringify(connect)}`
  );

  const hookEnv = await installHookCliWrapper(projectDir);
  runProjectHook(projectDir, hookEnv, "start-session.sh", [`Codex Stage 4 ${marker}`]);
  runProjectHook(projectDir, hookEnv, "user-prompt.sh", [], `Prompt ${marker}: remember this.`);
  runProjectHook(
    projectDir,
    hookEnv,
    "capture-event.sh",
    ["decision"],
    `Codex hook decision ${marker}: project-local hooks captured memory.`
  );
  runProjectHook(
    projectDir,
    hookEnv,
    "pre-compaction.sh",
    [],
    `Codex hook checkpoint ${marker}: resume from Recallant.`
  );
  runProjectHook(projectDir, hookEnv, "stop-session.sh", [], `Codex hook closeout ${marker}`);

  const hookContext = await cli(projectDir, ["context", "--task-hint", `${marker} hook recall`]);
  assert(
    (hookContext.sections?.working_memories ?? []).some((memory) =>
      String(memory.body).includes(marker)
    ),
    "Codex hook-captured memory was not recalled"
  );

  const lifecycle = await runLifecycle(projectDir, marker, "Codex controlled path");
  const after = await hashTree(projectDir);

  return {
    client: "codex",
    automation_mode: "project_local_hook_kit",
    project_name: basename(projectDir),
    project_id: attach.project_id,
    attached: true,
    connect_status: connect.client_connection.status,
    hook_status: connect.hook_status,
    hook_targets_exercised: [
      "session_start",
      "user_prompt",
      "decision",
      "pre_compaction_checkpoint",
      "stop_closeout"
    ],
    lifecycle,
    changed_files: diffTrees(before, after),
    untouched_files: [],
    no_global_config_modified: connect.writes_global_config === false
  };
}

async function runCursorEquivalentPath() {
  const originalDir = await makeTempDir("recallant-stage4-cursor-original-");
  await mkdir(join(originalDir, ".cursor"), { recursive: true });
  await writeFile(
    join(originalDir, "README.md"),
    "# Cursor Fixture\nSecond-client Stage 4 fixture.\n"
  );
  await writeFile(
    join(originalDir, ".cursor", "mcp.json"),
    `${JSON.stringify({ mcpServers: { existing_search: { command: "search-helper" } } }, null, 2)}\n`
  );
  const originalBefore = await hashTree(originalDir);

  const projectDir = await makeTempDir("recallant-stage4-cursor-copy-");
  await cp(originalDir, projectDir, { recursive: true });
  const before = await hashTree(projectDir);
  const marker = `STAGE4-CURSOR-${randomUUID()}`;

  const attach = await cli(projectDir, ["attach", projectDir, "--sandbox", "--format", "json"]);
  assert(
    attach.status === "attached",
    `Cursor equivalent attach failed: ${JSON.stringify(attach)}`
  );

  const connectDryRun = await cli(projectDir, [
    "connect",
    "cursor",
    "--project-dir",
    projectDir,
    "--dry-run",
    "--format",
    "json"
  ]);
  assert(
    connectDryRun.client === "cursor" &&
      connectDryRun.writes_files === false &&
      connectDryRun.planned_changes.some((change) => change.action === "backup_file") &&
      connectDryRun.planned_changes.some((change) => change.path === ".cursor/mcp.json"),
    `Cursor dry-run did not preview project-local merge safely: ${JSON.stringify(connectDryRun)}`
  );

  const connect = await cli(projectDir, [
    "connect",
    "cursor",
    "--project-dir",
    projectDir,
    "--format",
    "json"
  ]);
  assert(
    connect.client === "cursor" &&
      connect.writes_global_config === false &&
      connect.client_connection?.native_hooks?.some(
        (entry) => entry.client === "cursor" && entry.ready === false
      ),
    `Cursor connect should be project-local config with unsupported native hooks: ${JSON.stringify(connect)}`
  );
  const cursorConfig = JSON.parse(await readFile(join(projectDir, ".cursor", "mcp.json"), "utf8"));
  assert(
    cursorConfig.mcpServers?.existing_search?.command === "search-helper" &&
      cursorConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
    `Cursor project config did not preserve existing server and add Recallant: ${JSON.stringify(cursorConfig)}`
  );

  const lifecycle = await runLifecycle(projectDir, marker, "Cursor equivalent path");
  const after = await hashTree(projectDir);
  const originalAfter = await hashTree(originalDir);
  assert(
    JSON.stringify(originalBefore) === JSON.stringify(originalAfter),
    "Cursor equivalent pilot modified original fixture"
  );

  return {
    client: "cursor",
    automation_mode: "documented_equivalent_project_local_mcp_plus_cli_capture",
    equivalent_reason:
      "The real Cursor desktop client is not safely automatable in this headless smoke; the fixture proves project-local Cursor MCP merge, unsupported-native-hook reporting, capture lifecycle, and later recall.",
    project_name: basename(projectDir),
    project_id: attach.project_id,
    attached: true,
    connect_status: connect.client_connection.status,
    native_hook_ready: false,
    lifecycle,
    changed_files: diffTrees(before, after),
    untouched_original_files: Object.keys(originalBefore).sort(),
    no_global_config_modified: connect.writes_global_config === false
  };
}

async function runGlobalCursorSafetyFixture() {
  const projectDir = await makeTempDir("recallant-stage4-global-project-");
  const homeDir = await makeTempDir("recallant-stage4-global-home-");
  const cursorDir = join(homeDir, ".cursor");
  await mkdir(cursorDir, { recursive: true });
  const globalConfigPath = join(cursorDir, "mcp.json");
  const originalConfig = {
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
  await writeFile(globalConfigPath, `${JSON.stringify(originalConfig, null, 2)}\n`);
  const attach = await cli(projectDir, ["attach", projectDir, "--sandbox", "--format", "json"], {
    HOME: homeDir
  });
  assert(attach.status === "attached", `global fixture attach failed: ${JSON.stringify(attach)}`);

  const dryRun = await cli(
    projectDir,
    ["connect", "cursor", "--project-dir", projectDir, "--global", "--dry-run", "--format", "json"],
    { HOME: homeDir }
  );
  assert(
    dryRun.writes_global_config === false &&
      dryRun.global_config?.target_file === globalConfigPath &&
      dryRun.global_config?.confirmation_command?.includes("--previewed-global-target"),
    `Cursor global dry-run did not expose safe preview: ${JSON.stringify(dryRun)}`
  );
  const afterDryRun = JSON.parse(await readFile(globalConfigPath, "utf8"));
  assert(
    afterDryRun.mcpServers.recallant === undefined,
    "Cursor global dry-run changed global config"
  );

  const write = await cli(
    projectDir,
    [
      "connect",
      "cursor",
      "--project-dir",
      projectDir,
      "--global",
      "--confirm-global-write",
      "--previewed-global-target",
      globalConfigPath,
      "--format",
      "json"
    ],
    { HOME: homeDir }
  );
  assert(
    write.writes_global_config === true && write.global_config?.backup_path,
    `Cursor global write did not create audited backup: ${JSON.stringify(write)}`
  );
  const merged = JSON.parse(await readFile(globalConfigPath, "utf8"));
  assert(
    merged.mcpServers.global_existing?.command === "global-helper" &&
      merged.mcpServers.recallant?.args?.includes("mcp-server") &&
      merged.uiPreferences?.preserve_me === true,
    `Cursor global merge did not preserve existing config: ${JSON.stringify(merged)}`
  );

  const restore = await cli(
    projectDir,
    [
      "connect",
      "cursor",
      "--project-dir",
      projectDir,
      "--global",
      "--restore-global-backup",
      write.global_config.backup_path,
      "--format",
      "json"
    ],
    { HOME: homeDir }
  );
  assert(
    restore.writes_global_config === true,
    `Cursor global restore failed: ${JSON.stringify(restore)}`
  );
  const restored = JSON.parse(await readFile(globalConfigPath, "utf8"));
  assert(
    JSON.stringify(restored) === JSON.stringify(originalConfig),
    `Cursor global restore did not restore original file: ${JSON.stringify(restored)}`
  );

  return {
    client: "cursor",
    global_target: globalConfigPath,
    dry_run_wrote_global_config: dryRun.writes_global_config,
    write_was_explicit: write.writes_global_config === true,
    backup_created: Boolean(write.global_config.backup_path),
    rollback_restored_original: true,
    unrelated_settings_preserved: true,
    fixture_home: homeDir
  };
}

async function runSpoolFallbackProof() {
  const projectDir = await makeTempDir("recallant-stage4-spool-");
  const spoolDir = join(projectDir, ".recallant", "spool");
  const marker = `STAGE4-SPOOL-${randomUUID()}`;
  const attach = await cli(projectDir, ["attach", projectDir, "--sandbox", "--format", "json"]);
  assert(attach.status === "attached", `spool fixture attach failed: ${JSON.stringify(attach)}`);

  const spooled = await cli(
    projectDir,
    [
      "spool-append",
      "--project-dir",
      projectDir,
      "--spool-dir",
      spoolDir,
      "--kind",
      "event",
      "--event-kind",
      "action",
      "--text",
      `Stage 4 spool fallback ${marker}`
    ],
    { RECALLANT_DATABASE_URL: "" }
  );
  assert(spooled.local_id, `spool append did not return local id: ${JSON.stringify(spooled)}`);

  const status = await cli(projectDir, [
    "spool-status",
    "--project-dir",
    projectDir,
    "--spool-dir",
    spoolDir,
    "--format",
    "json"
  ]);
  assert(
    status.status === "unsynced" &&
      status.unsynced_count === 1 &&
      status.replay_command?.includes("--dry-run"),
    `spool-status did not expose replay diagnostics: ${JSON.stringify(status)}`
  );

  const doctor = await cli(projectDir, [
    "doctor",
    "--project-dir",
    projectDir,
    "--spool-dir",
    spoolDir,
    "--format",
    "json"
  ]);
  assert(
    doctor.local_spool_status?.status === "unsynced" &&
      doctor.local_spool_status?.unsynced_count === 1,
    `doctor did not expose local spool diagnostics: ${JSON.stringify(doctor.local_spool_status)}`
  );

  return {
    spooled_local_id: spooled.local_id,
    spool_status: status.status,
    unsynced_count: status.unsynced_count,
    doctor_exposes_spool: true,
    replay_command: status.replay_command
  };
}

try {
  const generatedAt = new Date().toISOString();
  const reportDir =
    process.env.RECALLANT_STAGE4_ACCEPTANCE_REPORT_DIR ??
    join(tmpdir(), "recallant-stage4-acceptance-reports");
  const reportPath = join(
    reportDir,
    `stage4-acceptance-${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`
  );
  const report = {
    ok: true,
    action: "stage4_acceptance_smoke",
    generated_at: generatedAt,
    developer_id: developerId,
    evidence: {}
  };

  report.evidence.codex_controlled_path = await runCodexControlledPath();
  report.evidence.cursor_equivalent_path = await runCursorEquivalentPath();
  report.evidence.cursor_global_safety_fixture = await runGlobalCursorSafetyFixture();
  report.evidence.spool_fallback = await runSpoolFallbackProof();

  report.acceptance_summary = {
    clean_attached_project:
      report.evidence.codex_controlled_path.attached === true &&
      report.evidence.codex_controlled_path.lifecycle.doctor_status === "capture_active",
    project_local_connect:
      report.evidence.codex_controlled_path.connect_status === "mcp_and_hooks_ready" &&
      report.evidence.cursor_equivalent_path.connect_status === "mcp_only",
    safe_global_dry_run_backup_rollback:
      report.evidence.cursor_global_safety_fixture.dry_run_wrote_global_config === false &&
      report.evidence.cursor_global_safety_fixture.backup_created === true &&
      report.evidence.cursor_global_safety_fixture.rollback_restored_original === true,
    hook_capture_and_spool_fallback:
      report.evidence.codex_controlled_path.hook_status === "local_hook_kit_installed" &&
      report.evidence.spool_fallback.doctor_exposes_spool === true,
    codex_plus_second_client_path:
      report.evidence.codex_controlled_path.client === "codex" &&
      report.evidence.cursor_equivalent_path.client === "cursor" &&
      report.evidence.cursor_equivalent_path.automation_mode.includes("documented_equivalent"),
    closeout_and_later_recall:
      report.evidence.codex_controlled_path.lifecycle.later_context_recalled === true &&
      report.evidence.codex_controlled_path.lifecycle.ask_recalled === true &&
      report.evidence.cursor_equivalent_path.lifecycle.later_context_recalled === true &&
      report.evidence.cursor_equivalent_path.lifecycle.ask_recalled === true,
    startup_readiness_matrix:
      report.evidence.codex_controlled_path.lifecycle.owner_summary_status === "recording" &&
      report.evidence.cursor_equivalent_path.lifecycle.owner_summary_status === "recording",
    no_unrelated_global_config_modified:
      report.evidence.codex_controlled_path.no_global_config_modified === true &&
      report.evidence.cursor_equivalent_path.no_global_config_modified === true &&
      report.evidence.cursor_global_safety_fixture.rollback_restored_original === true,
    agent_work_fail_soft: report.evidence.spool_fallback.unsynced_count === 1,
    all_stage4_requirements_passed: true
  };

  report.acceptance_summary.all_stage4_requirements_passed =
    report.acceptance_summary.clean_attached_project &&
    Boolean(report.acceptance_summary.project_local_connect) &&
    report.acceptance_summary.safe_global_dry_run_backup_rollback &&
    report.acceptance_summary.hook_capture_and_spool_fallback &&
    report.acceptance_summary.codex_plus_second_client_path &&
    report.acceptance_summary.closeout_and_later_recall &&
    report.acceptance_summary.startup_readiness_matrix &&
    report.acceptance_summary.no_unrelated_global_config_modified &&
    report.acceptance_summary.agent_work_fail_soft;

  assert(
    report.acceptance_summary.all_stage4_requirements_passed === true,
    "Stage 4 acceptance summary was not green"
  );
  report.report_path = reportPath;
  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const persisted = JSON.parse(await readFile(reportPath, "utf8"));
  assert(
    persisted.acceptance_summary?.all_stage4_requirements_passed === true,
    "persisted Stage 4 acceptance report did not preserve green summary"
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
}
