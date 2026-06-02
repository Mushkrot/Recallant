import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { RecallantDb } from "../packages/db/dist/index.js";

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
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashTree(root) {
  const entries = {};
  async function walk(dir, prefix = "") {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, child.name);
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) {
        await walk(path, relative);
        continue;
      }
      const content = await readFile(path);
      entries[relative] = createHash("sha256").update(content).digest("hex");
    }
  }
  await walk(root);
  return entries;
}

function sameHashTree(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeExistingProjectFixture(projectDir) {
  await mkdir(join(projectDir, ".cursor", "rules"), { recursive: true });
  await mkdir(join(projectDir, "docs"), { recursive: true });
  await writeFile(
    join(projectDir, "README.md"),
    [
      "# Existing Pilot Fixture",
      "",
      "This safe fixture acts like an existing project with local agent files."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Project Rules",
      "",
      "Keep the existing-pilot formatter deterministic.",
      "Use source-linked memory before changing shared workflow rules."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "PROJECT_LOG.md"),
    [
      "# Project Log",
      "",
      "## Current Session",
      "",
      "Status: existing project fixture.",
      "Current focus: safe Recallant migration.",
      "Next step: attach a sandbox copy only.",
      "",
      "## Historical Log",
      "",
      "2025-01-10: old local handoff.",
      "2025-02-10: old local handoff."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, ".cursor", "SESSION_HANDOFF.md"),
    "# Cursor Handoff\nKeep this as local historical evidence only.\n"
  );
  await writeFile(
    join(projectDir, ".cursor", "rules", "memory.mdc"),
    "# Memory Rule\nUse Recallant after migration.\n"
  );
  await writeFile(join(projectDir, "docs", "README.md"), "# Docs\nExisting project docs.\n");
}

async function dashboardFor(projectId, projectPath) {
  const database = new RecallantDb({
    databaseUrl,
    developerId,
    projectId,
    projectPath
  });
  try {
    return await database.getReviewDashboard({ project_id: projectId });
  } finally {
    await database.close();
  }
}

async function installHookCliWrapper(projectDir) {
  const hookBin = join(projectDir, ".recallant", "hook-bin");
  await mkdir(hookBin, { recursive: true });
  const wrapperPath = join(hookBin, "recallant");
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env sh\nexec node ${JSON.stringify(cliPath)} "$@"\n`
  );
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

async function runConnectHookEvidence(projectDir, marker, label) {
  const hookMarker = `${marker}-HOOK`;
  const dryRun = await cli(projectDir, [
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--dry-run"
  ]);
  assert(
    dryRun.dry_run === true &&
      dryRun.writes_files === false &&
      dryRun.mandatory_startup_layer?.status === "mcp_and_hooks_planned",
    `${label}: connect dry-run did not plan MCP+hooks safely: ${JSON.stringify(dryRun)}`
  );

  const connected = await cli(projectDir, [
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks"
  ]);
  assert(
    connected.hook_status === "local_hook_kit_installed" &&
      connected.mandatory_startup_layer?.status === "mcp_and_hooks_ready" &&
      connected.writes_global_config === false,
    `${label}: connect did not install project-local hooks safely: ${JSON.stringify(connected)}`
  );

  const hookEnv = await installHookCliWrapper(projectDir);
  runProjectHook(projectDir, hookEnv, "start-session.sh", [`${hookMarker} hook session`]);
  runProjectHook(
    projectDir,
    hookEnv,
    "user-prompt.sh",
    [],
    `Owner prompt ${hookMarker}: verify Recallant hook capture.`
  );
  runProjectHook(
    projectDir,
    hookEnv,
    "tool-result.sh",
    [],
    `Tool result ${hookMarker}: command completed and should be captured.`
  );
  runProjectHook(
    projectDir,
    hookEnv,
    "capture-event.sh",
    ["decision"],
    `Hook decision ${hookMarker}: connect hooks must write durable memory before owner QA.`
  );
  runProjectHook(
    projectDir,
    hookEnv,
    "pre-compaction.sh",
    [],
    `Pre-compaction checkpoint ${hookMarker}: resume from Recallant context.`
  );

  const context = await cli(projectDir, ["context", "--task-hint", `${hookMarker} hook recall`]);
  const workingMemories = context.sections?.working_memories ?? [];
  assert(
    workingMemories.some((memory) => String(memory.body).includes(hookMarker)),
    `${label}: hook-captured decision was not recalled in a later context pack`
  );

  const doctor = await cli(projectDir, ["doctor", "--require-capture"]);
  assert(
    doctor.capture_readiness?.ready === true &&
      doctor.client_connection?.status === "mcp_and_hooks_ready",
    `${label}: doctor did not prove MCP+hooks capture active: ${JSON.stringify(doctor)}`
  );

  return {
    connect_dry_run: {
      status: dryRun.mandatory_startup_layer.status,
      writes_files: dryRun.writes_files,
      writes_global_config: dryRun.writes_global_config
    },
    connect_installed: {
      status: connected.mandatory_startup_layer.status,
      hook_status: connected.hook_status,
      writes_global_config: connected.writes_global_config
    },
    hook_targets_exercised: [
      "session_start",
      "user_prompt",
      "tool_result",
      "decision",
      "pre_compaction_checkpoint"
    ],
    remembered_marker: hookMarker,
    recalled_hook_decision: true,
    doctor_status: doctor.capture_readiness.status,
    client_connection: doctor.client_connection.status
  };
}

async function runCapturedSession(projectDir, projectId, marker, label) {
  const started = await cli(projectDir, ["agent-start", "--task-hint", `${marker} ${label}`]);
  assert(started.session_id, `${label}: agent-start did not return a session id`);

  const decision = await cli(projectDir, [
    "agent-event",
    "--kind",
    "decision",
    "--title",
    `${label} decision`,
    "--text",
    `Pilot decision ${marker}: Recallant must prove capture and later recall before asking the owner to inspect.`
  ]);
  assert(decision.memory?.status === "accepted", `${label}: decision memory was not accepted`);

  const action = await cli(projectDir, [
    "agent-event",
    "--kind",
    "action",
    "--text",
    `Pilot action ${marker}: recorded attach, capture, and cleanup evidence.`
  ]);
  assert(action.event_id, `${label}: action event was not written`);

  const test = await cli(projectDir, [
    "agent-event",
    "--kind",
    "test",
    "--text",
    `Pilot verification ${marker}: a later context pack must recall this marker.`
  ]);
  assert(test.event_id, `${label}: test event was not written`);

  const checkpoint = await cli(projectDir, [
    "agent-checkpoint",
    "--status",
    "pilot_report",
    "--focus",
    `Pilot report for ${marker}`,
    "--next-step",
    `Recall ${marker} in a later session`,
    "--summary",
    `Pilot checkpoint ${marker}`
  ]);
  assert(checkpoint.event_id, `${label}: checkpoint was not written`);

  const closeout = await cli(projectDir, [
    "agent-closeout",
    "--status",
    "closed",
    "--focus",
    `Closed pilot report for ${marker}`,
    "--next-step",
    `Start a new session and recall ${marker}`,
    "--summary",
    `Closed pilot report ${marker}`
  ]);
  assert(closeout.closeout?.report_required === false, `${label}: closeout reported warnings`);

  const secondStart = await cli(projectDir, ["agent-start", "--task-hint", `${marker} recall`]);
  assert(
    secondStart.session_id !== started.session_id,
    `${label}: second session reused the first session id`
  );

  const context = await cli(projectDir, ["context", "--task-hint", `${marker} recall`]);
  const workingMemories = context.sections?.working_memories ?? [];
  assert(
    workingMemories.some((memory) => String(memory.body).includes(marker)),
    `${label}: later context pack did not recall captured memory`
  );
  assert(
    String(context.sections?.checkpoint?.payload?.next_step ?? "").includes(marker),
    `${label}: later context pack did not recall checkpoint`
  );

  await cli(projectDir, [
    "agent-closeout",
    "--status",
    "closed",
    "--focus",
    `Verified recall for ${marker}`,
    "--next-step",
    "Pilot smoke complete.",
    "--summary",
    `Verified recall ${marker}`
  ]);

  const doctor = await cli(projectDir, ["doctor", "--require-capture"]);
  assert(doctor.capture_readiness?.ready === true, `${label}: doctor did not prove capture active`);

  const dashboard = await dashboardFor(projectId, projectDir);
  assert(
    dashboard.project_readiness?.last_context_read_at &&
      dashboard.project_readiness?.last_memory_write_at &&
      dashboard.project_readiness?.checkpoint_updated_at,
    `${label}: dashboard did not show capture readiness`
  );

  return {
    started_session: started.session_id,
    remembered_marker: marker,
    remembered: ["decision", "action", "test", "checkpoint"],
    recalled_in_later_session: true,
    doctor_status: doctor.capture_readiness.status,
    dashboard_capture_events: Number(dashboard.project_readiness.capture_event_count ?? 0),
    dashboard_decisions: Number(dashboard.project_readiness.captured_decision_count ?? 0)
  };
}

async function runCleanEmptyPilot() {
  const projectDir = await makeTempDir("recallant-pilot-clean-");
  const marker = `PILOT-CLEAN-${randomUUID()}`;
  const attach = await cli(projectDir, ["attach", "."]);
  assert(attach.status === "attached", `clean pilot attach failed: ${JSON.stringify(attach)}`);
  assert(
    attach.discovery_summary?.selected_for_import === 0,
    "clean pilot should not import files"
  );

  const capture = await runCapturedSession(projectDir, attach.project_id, marker, "clean pilot");
  const connect = await runConnectHookEvidence(projectDir, marker, "clean pilot");
  const detachDryRun = await cli(projectDir, [
    "detach",
    "--project-id",
    attach.project_id,
    "--dry-run"
  ]);
  assert(
    detachDryRun.status === "pending_confirmation" && detachDryRun.writes_database === false,
    "clean pilot detach dry-run changed state"
  );
  const detach = await cli(projectDir, ["detach", "--project-id", attach.project_id, "--confirm"]);
  assert(detach.status === "detached", "clean pilot detach failed");

  return {
    project_name: basename(projectDir),
    project_id: attach.project_id,
    attached: true,
    sources_detected: attach.discovery_summary?.candidates ?? 0,
    imported_sources: attach.imported?.length ?? 0,
    connect,
    capture,
    cleanup: {
      dry_run_first: detachDryRun.status,
      confirmed_status: detach.status,
      files_changed: detach.changes?.files_changed ?? null,
      physically_deleted_records: detach.changes?.physically_deleted_records ?? null
    },
    untouched_original: "not applicable: clean isolated temp project"
  };
}

async function runCopiedExistingPilot() {
  const originalDir = await makeTempDir("recallant-pilot-existing-original-");
  await writeExistingProjectFixture(originalDir);
  const before = await hashTree(originalDir);

  const sandboxDir = await makeTempDir("recallant-pilot-existing-copy-");
  await cp(originalDir, sandboxDir, { recursive: true });
  const marker = `PILOT-COPY-${randomUUID()}`;
  const attach = await cli(sandboxDir, ["attach", sandboxDir, "--sandbox"]);
  assert(attach.status === "attached", `copied pilot attach failed: ${JSON.stringify(attach)}`);
  assert(attach.imported?.length >= 4, "copied pilot should import existing source files");
  assert(attach.backup?.manifest_path, "copied pilot should create local backup before file edits");

  const capture = await runCapturedSession(sandboxDir, attach.project_id, marker, "copied pilot");
  const connect = await runConnectHookEvidence(sandboxDir, marker, "copied pilot");
  const detachDryRun = await cli(sandboxDir, [
    "detach",
    "--project-id",
    attach.project_id,
    "--mode",
    "sandbox",
    "--dry-run"
  ]);
  assert(detachDryRun.status === "pending_confirmation", "copied pilot detach dry-run failed");
  const detach = await cli(sandboxDir, [
    "detach",
    "--project-id",
    attach.project_id,
    "--mode",
    "sandbox",
    "--confirm"
  ]);
  assert(detach.status === "detached", "copied pilot detach failed");

  const after = await hashTree(originalDir);
  assert(sameHashTree(before, after), "copied pilot modified the original project fixture");
  const sandboxConfig = await readFile(join(sandboxDir, ".recallant", "config"), "utf8");
  assert(sandboxConfig.includes(attach.project_id), "copied pilot detach removed local config");

  return {
    original_project_name: basename(originalDir),
    sandbox_copy_name: basename(sandboxDir),
    project_id: attach.project_id,
    attached: true,
    sources_detected: attach.discovery_summary?.candidates ?? 0,
    imported_sources: attach.imported?.length ?? 0,
    imported_paths: attach.imported?.map((item) => item.path) ?? [],
    local_backup_created: Boolean(attach.backup?.manifest_path),
    connect,
    capture,
    cleanup: {
      dry_run_first: detachDryRun.status,
      confirmed_status: detach.status,
      files_changed: detach.changes?.files_changed ?? null,
      physically_deleted_records: detach.changes?.physically_deleted_records ?? null
    },
    untouched_original: true
  };
}

async function runProductionSensitivePreflight() {
  const projectDir = await makeTempDir("recallant-pilot-production-preflight-");
  await writeFile(
    join(projectDir, "README.md"),
    "# Production Fixture\nThis live project deploys through Cloudflare and production services.\n"
  );
  await writeFile(
    join(projectDir, "AGENTS.md"),
    "# Live Agent Instructions\nProduction token example: OPENAI_API_KEY=sk-livefixture123456\n"
  );
  const before = await hashTree(projectDir);
  const preflight = await cli(projectDir, [
    "attach",
    projectDir,
    "--target",
    "codex",
    "--mode",
    "autopilot"
  ]);
  assert(
    preflight.status === "needs_confirmation" &&
      preflight.effective_mode === "guided" &&
      preflight.writes_files === false &&
      preflight.writes_database === false,
    `production-sensitive preflight did not stop safely: ${JSON.stringify(preflight)}`
  );
  assert(
    preflight.production_sensitive?.production_sensitive === true,
    "production-sensitive preflight did not detect production signals"
  );
  const after = await hashTree(projectDir);
  assert(sameHashTree(before, after), "production-sensitive preflight changed project files");

  return {
    project_name: basename(projectDir),
    requested_mode: preflight.requested_mode,
    effective_mode: preflight.effective_mode,
    status: preflight.status,
    writes_files: preflight.writes_files,
    writes_database: preflight.writes_database,
    production_sensitive: preflight.production_sensitive?.production_sensitive === true,
    detected_signals: preflight.production_sensitive?.signals ?? [],
    untouched_project_files: true
  };
}

try {
  const generatedAt = new Date().toISOString();
  const reportDir = process.env.RECALLANT_PILOT_REPORT_DIR ?? join(tmpdir(), "recallant-pilot-reports");
  const reportPath = join(
    reportDir,
    `pilot-report-${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`
  );
  const report = {
    ok: true,
    action: "pilot_report_smoke",
    generated_at: generatedAt,
    developer_id: developerId,
    pilots: {
      clean_empty_project: await runCleanEmptyPilot(),
      copied_existing_sandbox: await runCopiedExistingPilot(),
      production_sensitive_dry_run: await runProductionSensitivePreflight()
    }
  };
  report.qa_summary = {
    scenario_count: Object.keys(report.pilots).length,
    clean_attach_capture_recall_detach:
      report.pilots.clean_empty_project.capture.recalled_in_later_session === true &&
      report.pilots.clean_empty_project.connect.recalled_hook_decision === true &&
      report.pilots.clean_empty_project.connect.client_connection === "mcp_and_hooks_ready" &&
      report.pilots.clean_empty_project.cleanup.dry_run_first === "pending_confirmation" &&
      report.pilots.clean_empty_project.cleanup.confirmed_status === "detached",
    copied_sandbox_original_untouched:
      report.pilots.copied_existing_sandbox.untouched_original === true &&
      report.pilots.copied_existing_sandbox.connect.recalled_hook_decision === true &&
      report.pilots.copied_existing_sandbox.connect.client_connection === "mcp_and_hooks_ready" &&
      report.pilots.copied_existing_sandbox.local_backup_created === true,
    production_sensitive_preflight_safe:
      report.pilots.production_sensitive_dry_run.status === "needs_confirmation" &&
      report.pilots.production_sensitive_dry_run.writes_files === false &&
      report.pilots.production_sensitive_dry_run.writes_database === false,
    all_required_scenarios_passed: true
  };
  report.qa_summary.all_required_scenarios_passed =
    report.qa_summary.clean_attach_capture_recall_detach &&
    report.qa_summary.copied_sandbox_original_untouched &&
    report.qa_summary.production_sensitive_preflight_safe;
  assert(report.qa_summary.all_required_scenarios_passed, "pilot report QA summary was not green");
  report.report_path = reportPath;
  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const persisted = JSON.parse(await readFile(reportPath, "utf8"));
  assert(
    persisted.qa_summary?.all_required_scenarios_passed === true,
    "persisted pilot report did not preserve QA summary"
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
}
