import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

async function hashSelectedFiles(root, relativePaths) {
  const entries = {};
  for (const relative of relativePaths) {
    const content = await readFile(join(root, relative));
    entries[relative] = createHash("sha256").update(content).digest("hex");
  }
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

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function workbenchSnapshot(dashboard) {
  const readiness = dashboard.project_readiness ?? {};
  const sourceFilters = dashboard.source_filters ?? {};
  const sources = rows(sourceFilters.sources);
  const healthRows = sources.map((source) => source.source_health ?? {});
  const ready = healthRows.filter((health) => health.status === "ready").length;
  const detached = healthRows.filter((health) => health.status === "detached").length;
  const needsAttention = healthRows.filter((health) => {
    const status = String(health.status ?? "");
    return status.length > 0 && status !== "ready" && status !== "detached";
  }).length;
  return {
    capture_ready: Boolean(
      readiness.last_context_read_at &&
      readiness.last_memory_write_at &&
      readiness.checkpoint_updated_at
    ),
    last_context_read_at: readiness.last_context_read_at ?? null,
    last_memory_write_at: readiness.last_memory_write_at ?? null,
    checkpoint_updated_at: readiness.checkpoint_updated_at ?? null,
    review_counts: {
      import_candidates: rows(dashboard.import_candidates).length,
      inbox: rows(dashboard.inbox).length,
      conflicts_or_duplicates: rows(dashboard.duplicate_conflicts).length,
      active_rules: rows(dashboard.rules).length
    },
    source_health: {
      total: sources.length,
      ready,
      needs_attention: needsAttention,
      detached
    },
    recent_activity_count: rows(dashboard.recent_activity).length
  };
}

function statusMark(value) {
  return value ? "PASS" : "FAIL";
}

function bulletList(values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (list.length === 0) return "- none";
  return list.map((value) => `- ${String(value)}`).join("\n");
}

function pilotMarkdownSummary(report) {
  const clean = report.pilots.clean_empty_project;
  const copied = report.pilots.copied_existing_sandbox;
  const sampleProduction = report.pilots.sample_production_sandbox;
  const production = report.pilots.production_sensitive_dry_run;
  const sampleProductionDryRun = report.pilots.sample_production_dry_run;
  const cross = report.pilots.cross_project_recall;
  const qa = report.qa_summary;
  return [
    "# Recallant Pilot Report",
    "",
    `Generated: ${report.generated_at}`,
    `Overall: ${statusMark(qa.all_required_scenarios_passed)}`,
    "",
    "## QA Summary",
    "",
    `- Clean attach/capture/recall/detach: ${statusMark(qa.clean_attach_capture_recall_detach)}`,
    `- Copied sandbox original untouched: ${statusMark(qa.copied_sandbox_original_untouched)}`,
    `- Sample production sandbox original untouched: ${statusMark(qa.sample_production_sandbox_original_untouched)}`,
    `- Workbench capture visible: ${statusMark(qa.workbench_capture_visible)}`,
    `- Production-sensitive preflight safe: ${statusMark(qa.production_sensitive_preflight_safe)}`,
    `- Sample production dry-run safe: ${statusMark(qa.sample_production_dry_run_safe)}`,
    `- Cross-project recall source-linked: ${statusMark(qa.cross_project_recall_source_linked)}`,
    "",
    "## Clean Empty Project",
    "",
    `- Attached: ${statusMark(clean.attached)}`,
    `- Imported sources: ${clean.imported_sources}`,
    `- Remembered marker: ${clean.capture.remembered_marker}`,
    `- Public proof marker: ${clean.public_proof_flow.marker}`,
    `- Public proof doctor status: ${clean.public_proof_flow.doctor_status}`,
    `- Public proof ask recalled: ${statusMark(clean.public_proof_flow.ask_recalled)}`,
    `- Recalled later: ${statusMark(clean.capture.recalled_in_later_session)}`,
    `- Hook decision recalled: ${statusMark(clean.connect.recalled_hook_decision)}`,
    `- Doctor status: ${clean.capture.doctor_status}`,
    `- Detached: ${clean.cleanup.confirmed_status}`,
    `- Left untouched: ${clean.untouched_original}`,
    "",
    "## Copied Existing Sandbox",
    "",
    `- Sandbox attached: ${statusMark(copied.attached)}`,
    `- Original project untouched: ${statusMark(copied.untouched_original)}`,
    `- Local backup created: ${statusMark(copied.local_backup_created)}`,
    `- Imported sources: ${copied.imported_sources}`,
    bulletList(copied.imported_paths),
    `- Remembered marker: ${copied.capture.remembered_marker}`,
    `- Recalled later: ${statusMark(copied.capture.recalled_in_later_session)}`,
    `- Hook decision recalled: ${statusMark(copied.connect.recalled_hook_decision)}`,
    `- Detached: ${copied.cleanup.confirmed_status}`,
    "",
    "## Sample Production Sandbox",
    "",
    `- Sandbox attached: ${statusMark(sampleProduction.attached)}`,
    `- Original key files untouched: ${statusMark(sampleProduction.untouched_original_key_files)}`,
    `- Imported sources: ${sampleProduction.imported_sources}`,
    "- Copied source files:",
    bulletList(sampleProduction.copied_files),
    `- Remembered marker: ${sampleProduction.capture.remembered_marker}`,
    `- Recalled later: ${statusMark(sampleProduction.capture.recalled_in_later_session)}`,
    `- Hook decision recalled: ${statusMark(sampleProduction.connect.recalled_hook_decision)}`,
    `- Detached: ${sampleProduction.cleanup.confirmed_status}`,
    "",
    "## Production-Sensitive Dry Run",
    "",
    `- Status: ${production.status}`,
    `- Effective mode: ${production.effective_mode}`,
    `- Wrote project files: ${production.writes_files}`,
    `- Wrote database: ${production.writes_database}`,
    `- Project files untouched: ${statusMark(production.untouched_project_files)}`,
    "- Detected signals:",
    bulletList(production.detected_signals),
    "",
    "## Sample Production Dry Run",
    "",
    `- Status: ${sampleProductionDryRun.status}`,
    `- Effective mode: ${sampleProductionDryRun.effective_mode}`,
    `- Wrote project files: ${sampleProductionDryRun.writes_files}`,
    `- Wrote database: ${sampleProductionDryRun.writes_database}`,
    `- Service restarts: ${sampleProductionDryRun.service_restarts}`,
    `- Owner confirmation required: ${statusMark(sampleProductionDryRun.owner_confirmation_required)}`,
    `- Key files untouched: ${statusMark(sampleProductionDryRun.untouched_key_files)}`,
    "- Detected signals:",
    bulletList(sampleProductionDryRun.detected_signals),
    "",
    "## Cross-Project Recall",
    "",
    `- Active recall hides detached sandbox: ${statusMark(cross.active_search_hides_detached_project)}`,
    `- Include detached finds source-linked example: ${statusMark(cross.include_detached_finds_source_linked_example)}`,
    `- Cross-project examples are binding rules: ${cross.cross_project_results_are_binding_rules}`,
    `- Applicability: ${cross.applicability}`,
    "",
    "## Artifact Paths",
    "",
    `- JSON: ${report.report_path}`,
    `- Markdown: ${report.markdown_report_path}`
  ].join("\n");
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

async function runConnectHookEvidence(projectDir, marker, label) {
  const hookMarker = `${marker}-HOOK`;
  const dryRun = await cli(projectDir, [
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
    "--install-local-hooks",
    "--format",
    "json"
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

  const doctor = await cli(projectDir, [
    "doctor",
    "--require-memory-loop",
    "--format",
    "json"
  ]);
  assert(
    doctor.capture_readiness?.ready === true &&
      doctor.client_connection?.status === "mcp_and_hooks_ready",
    `${label}: doctor did not prove the memory loop with MCP+hooks: ${JSON.stringify(doctor)}`
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

async function runPublicProofFlow(projectDir, marker, label) {
  const demo = await cli(projectDir, [
    "demo-capture",
    "--marker",
    marker,
    "--format",
    "json"
  ]);
  assert(
    demo.proof?.session_started === true &&
      demo.proof?.memory_written === true &&
      demo.proof?.checkpoint_exists === true &&
      demo.proof?.later_recall_works === true,
    `${label}: demo-capture did not prove the public capture flow: ${JSON.stringify(demo)}`
  );
  const doctor = await cli(projectDir, [
    "doctor",
    "--project-dir",
    projectDir,
    "--require-memory-loop",
    "--format",
    "json"
  ]);
  assert(
    doctor.capture_readiness?.ready === true &&
      doctor.capture_readiness?.status === "memory_loop_ready",
    `${label}: doctor --require-memory-loop did not pass after demo-capture: ${JSON.stringify(doctor)}`
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
    `${label}: ask did not recall the demo marker: ${JSON.stringify(ask)}`
  );
  return {
    command_sequence: [
      "recallant demo-capture --project-dir .",
      "recallant doctor --project-dir . --require-memory-loop",
      'recallant ask "what did the agent remember?" --project-dir .'
    ],
    marker,
    session_started: demo.proof.session_started,
    memory_written: demo.proof.memory_written,
    checkpoint_exists: demo.proof.checkpoint_exists,
    later_recall_works: demo.proof.later_recall_works,
    doctor_status: doctor.capture_readiness.status,
    ask_recalled: ask.recalled
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

  const doctor = await cli(projectDir, [
    "doctor",
    "--require-memory-loop",
    "--format",
    "json"
  ]);
  assert(doctor.capture_readiness?.ready === true, `${label}: doctor did not prove memory loop`);

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
  const publicProofMarker = `DEMO-SMOKE-${randomUUID()}`;
  const attach = await cli(projectDir, ["attach", ".", "--sandbox", "--format", "json"]);
  assert(attach.status === "attached", `clean pilot attach failed: ${JSON.stringify(attach)}`);
  assert(
    attach.discovery_summary?.selected_for_import === 0,
    "clean pilot should not import files"
  );

  const publicProof = await runPublicProofFlow(projectDir, publicProofMarker, "clean pilot");
  const connect = await runConnectHookEvidence(projectDir, marker, "clean pilot");
  const capture = await runCapturedSession(projectDir, attach.project_id, marker, "clean pilot");
  const workbench = workbenchSnapshot(await dashboardFor(attach.project_id, projectDir));
  assert(
    workbench.capture_ready === true,
    "clean pilot Workbench snapshot did not show capture ready"
  );
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
    public_proof_flow: publicProof,
    capture,
    workbench,
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
  const attach = await cli(sandboxDir, ["attach", sandboxDir, "--sandbox", "--format", "json"]);
  assert(attach.status === "attached", `copied pilot attach failed: ${JSON.stringify(attach)}`);
  assert(attach.imported?.length >= 4, "copied pilot should import existing source files");
  assert(attach.backup?.manifest_path, "copied pilot should create local backup before file edits");

  const capture = await runCapturedSession(sandboxDir, attach.project_id, marker, "copied pilot");
  const connect = await runConnectHookEvidence(sandboxDir, marker, "copied pilot");
  const workbench = workbenchSnapshot(await dashboardFor(attach.project_id, sandboxDir));
  assert(
    workbench.capture_ready === true,
    "copied pilot Workbench snapshot did not show capture ready"
  );
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
    workbench,
    cleanup: {
      dry_run_first: detachDryRun.status,
      confirmed_status: detach.status,
      files_changed: detach.changes?.files_changed ?? null,
      physically_deleted_records: detach.changes?.physically_deleted_records ?? null
    },
    untouched_original: true
  };
}

async function writeProductionLikeProjectFixture(projectDir) {
  await mkdir(join(projectDir, "Docs"), { recursive: true });
  await mkdir(join(projectDir, ".cursor"), { recursive: true });
  await writeFile(
    join(projectDir, "README.md"),
    [
      "# Sample Production Project",
      "",
      "This fixture represents a deployed service with production runbooks and agent handoffs.",
      "It is synthetic and contains no owner infrastructure."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Project Rules",
      "",
      "Use the deployment runbook before changing public-service behavior.",
      "Never write raw secrets into memory or project documentation."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "PROJECT_LOG.md"),
    [
      "# Project Log",
      "",
      "## Current Session",
      "",
      "Status: production-like fixture.",
      "Current focus: safe Recallant migration.",
      "Next step: run sandbox-only onboarding.",
      "",
      "## Historical Log",
      "",
      "2025-03-10: sample deployment review.",
      "2025-04-10: sample agent handoff."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "Docs", "PRD.md"),
    "# Product Notes\nThis sample service has user-facing production behavior.\n"
  );
  await writeFile(
    join(projectDir, "Docs", "Deploy_Runbook.md"),
    [
      "# Deploy Runbook",
      "",
      "Production deploys require owner approval, rollback notes, and private access checks.",
      "Use placeholder domains and generic providers only in public fixtures."
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "Docs", "Commands for testing.md"),
    "# Commands For Testing\nRun deterministic smoke checks before deploy.\n"
  );
  await writeFile(
    join(projectDir, ".cursor", "SESSION_HANDOFF.md"),
    "# Session Handoff\nPrevious agent paused before production-sensitive deploy review.\n"
  );
  await writeFile(
    join(projectDir, "config.yaml"),
    "service:\n  mode: production-like-fixture\n  public_exposure: private-by-default\n"
  );
}

async function runSampleProductionSandboxPilot() {
  const originalDir = await makeTempDir("recallant-pilot-sample-production-original-");
  await writeProductionLikeProjectFixture(originalDir);
  const selectedFiles = [
    "README.md",
    "AGENTS.md",
    "PROJECT_LOG.md",
    "Docs/PRD.md",
    "Docs/Deploy_Runbook.md",
    "Docs/Commands for testing.md",
    ".cursor/SESSION_HANDOFF.md"
  ];
  const before = await hashSelectedFiles(originalDir, selectedFiles);
  const sandboxDir = await makeTempDir("recallant-pilot-sample-production-copy-");
  for (const relative of selectedFiles) {
    await mkdir(dirname(join(sandboxDir, relative)), { recursive: true });
    await cp(join(originalDir, relative), join(sandboxDir, relative));
  }
  const marker = `PILOT-SAMPLE-PRODUCTION-${randomUUID()}`;
  const attach = await cli(sandboxDir, ["attach", sandboxDir, "--sandbox", "--format", "json"]);
  assert(
    attach.status === "attached",
    `sample production sandbox attach failed: ${JSON.stringify(attach)}`
  );
  assert(
    attach.imported?.length >= 4,
    `sample production sandbox should import selected source files: ${JSON.stringify(attach.imported)}`
  );
  const capture = await runCapturedSession(
    sandboxDir,
    attach.project_id,
    marker,
    "sample production sandbox pilot"
  );
  const connect = await runConnectHookEvidence(
    sandboxDir,
    marker,
    "sample production sandbox pilot"
  );
  const workbench = workbenchSnapshot(await dashboardFor(attach.project_id, sandboxDir));
  assert(
    workbench.capture_ready === true,
    "sample production sandbox Workbench snapshot did not show capture ready"
  );
  const detachDryRun = await cli(sandboxDir, [
    "detach",
    "--project-id",
    attach.project_id,
    "--mode",
    "sandbox",
    "--dry-run"
  ]);
  const detach = await cli(sandboxDir, [
    "detach",
    "--project-id",
    attach.project_id,
    "--mode",
    "sandbox",
    "--confirm"
  ]);
  assert(detach.status === "detached", "sample production sandbox detach failed");
  const after = await hashSelectedFiles(originalDir, selectedFiles);
  assert(sameHashTree(before, after), "sample production sandbox pilot changed original key files");
  return {
    original_project_name: "sample-production",
    original_project_path_redacted: true,
    sandbox_copy_name: basename(sandboxDir),
    copied_files: selectedFiles,
    project_id: attach.project_id,
    attached: true,
    imported_sources: attach.imported?.length ?? 0,
    imported_paths: attach.imported?.map((item) => item.path) ?? [],
    connect,
    capture,
    workbench,
    cleanup: {
      dry_run_first: detachDryRun.status,
      confirmed_status: detach.status,
      files_changed: detach.changes?.files_changed ?? null,
      physically_deleted_records: detach.changes?.physically_deleted_records ?? null
    },
    untouched_original_key_files: true
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
    "autopilot",
    "--format",
    "json"
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

async function runSampleProductionDryRun() {
  const projectDir = await makeTempDir("recallant-pilot-sample-production-dryrun-");
  await writeProductionLikeProjectFixture(projectDir);
  const selectedFiles = [
    "README.md",
    "AGENTS.md",
    "PROJECT_LOG.md",
    "Docs/Deploy_Runbook.md",
    "config.yaml"
  ];
  const before = await hashSelectedFiles(projectDir, selectedFiles);
  const preflight = await cli(projectDir, [
    "attach",
    projectDir,
    "--target",
    "codex",
    "--mode",
    "autopilot",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert(
    preflight.status === "needs_confirmation" &&
      preflight.effective_mode === "guided" &&
      preflight.writes_files === false &&
      preflight.writes_database === false,
    `sample production dry-run did not stop safely: ${JSON.stringify(preflight)}`
  );
  assert(
    preflight.production_sensitive?.production_sensitive === true,
    "sample production dry-run did not detect production signals"
  );
  const after = await hashSelectedFiles(projectDir, selectedFiles);
  assert(sameHashTree(before, after), "sample production dry-run changed key files");
  return {
    project_name: "sample-production",
    project_path_redacted: true,
    requested_mode: preflight.requested_mode,
    effective_mode: preflight.effective_mode,
    status: preflight.status,
    writes_files: preflight.writes_files,
    writes_database: preflight.writes_database,
    service_restarts: 0,
    production_sensitive: preflight.production_sensitive?.production_sensitive === true,
    detected_signals: preflight.production_sensitive?.signals ?? [],
    owner_confirmation_required: true,
    untouched_key_files: true
  };
}

async function runCrossProjectRecallEvidence(cleanPilot, copiedPilot) {
  const database = new RecallantDb({
    databaseUrl,
    developerId,
    projectId: cleanPilot.project_id,
    projectPath: cleanPilot.project_name
  });
  try {
    const copiedMarker = copiedPilot.capture.remembered_marker;
    const activeOnly = await database.crossProjectRecall({
      query: copiedMarker,
      mode: "similar_projects",
      top_k: 5
    });
    const activeHit = activeOnly.results.find(
      (result) => result.source_project?.project_id === copiedPilot.project_id
    );
    assert(
      !activeHit,
      "detached copied pilot should not appear in active cross-project recall by default"
    );

    const includeDetached = await database.crossProjectRecall({
      query: copiedMarker,
      mode: "similar_projects",
      include_detached: true,
      top_k: 5
    });
    const detachedHit = includeDetached.results.find(
      (result) =>
        result.source_project?.project_id === copiedPilot.project_id &&
        String(result.body).includes(copiedMarker)
    );
    assert(
      detachedHit?.applicability === "example_only" &&
        detachedHit?.promotion_policy &&
        includeDetached.policy?.cross_project_results_are_binding_rules === false,
      `detached cross-project recall did not return a source-linked example: ${JSON.stringify(includeDetached)}`
    );

    return {
      active_search_hides_detached_project: true,
      include_detached_finds_source_linked_example: true,
      source_project_id: copiedPilot.project_id,
      source_project_name: copiedPilot.sandbox_copy_name,
      recalled_marker: copiedMarker,
      applicability: detachedHit.applicability,
      cross_project_results_are_binding_rules:
        includeDetached.policy.cross_project_results_are_binding_rules,
      trace_id: includeDetached.trace_id
    };
  } finally {
    await database.close();
  }
}

try {
  const generatedAt = new Date().toISOString();
  const reportDir =
    process.env.RECALLANT_PILOT_REPORT_DIR ?? join(tmpdir(), "recallant-pilot-reports");
  const reportPath = join(
    reportDir,
    `pilot-report-${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`
  );
  const markdownReportPath = reportPath.replace(/\.json$/u, ".md");
  const report = {
    ok: true,
    action: "pilot_report_smoke",
    generated_at: generatedAt,
    developer_id: developerId,
    pilots: {}
  };
  report.pilots.clean_empty_project = await runCleanEmptyPilot();
  report.pilots.copied_existing_sandbox = await runCopiedExistingPilot();
  report.pilots.sample_production_sandbox = await runSampleProductionSandboxPilot();
  report.pilots.cross_project_recall = await runCrossProjectRecallEvidence(
    report.pilots.clean_empty_project,
    report.pilots.copied_existing_sandbox
  );
  report.pilots.production_sensitive_dry_run = await runProductionSensitivePreflight();
  report.pilots.sample_production_dry_run = await runSampleProductionDryRun();
  report.qa_summary = {
    scenario_count: Object.keys(report.pilots).length,
    clean_attach_capture_recall_detach:
      report.pilots.clean_empty_project.capture.recalled_in_later_session === true &&
      report.pilots.clean_empty_project.public_proof_flow.session_started === true &&
      report.pilots.clean_empty_project.public_proof_flow.memory_written === true &&
      report.pilots.clean_empty_project.public_proof_flow.checkpoint_exists === true &&
      report.pilots.clean_empty_project.public_proof_flow.later_recall_works === true &&
      report.pilots.clean_empty_project.public_proof_flow.ask_recalled === true &&
      report.pilots.clean_empty_project.connect.recalled_hook_decision === true &&
      report.pilots.clean_empty_project.connect.client_connection === "mcp_and_hooks_ready" &&
      report.pilots.clean_empty_project.cleanup.dry_run_first === "pending_confirmation" &&
      report.pilots.clean_empty_project.cleanup.confirmed_status === "detached",
    copied_sandbox_original_untouched:
      report.pilots.copied_existing_sandbox.untouched_original === true &&
      report.pilots.copied_existing_sandbox.connect.recalled_hook_decision === true &&
      report.pilots.copied_existing_sandbox.connect.client_connection === "mcp_and_hooks_ready" &&
      report.pilots.copied_existing_sandbox.local_backup_created === true,
    sample_production_sandbox_original_untouched:
      report.pilots.sample_production_sandbox.untouched_original_key_files === true &&
      report.pilots.sample_production_sandbox.imported_sources >= 4 &&
      report.pilots.sample_production_sandbox.capture.recalled_in_later_session === true &&
      report.pilots.sample_production_sandbox.connect.recalled_hook_decision === true &&
      report.pilots.sample_production_sandbox.cleanup.confirmed_status === "detached",
    workbench_capture_visible:
      report.pilots.clean_empty_project.workbench.capture_ready === true &&
      report.pilots.copied_existing_sandbox.workbench.capture_ready === true &&
      report.pilots.sample_production_sandbox.workbench.capture_ready === true &&
      report.pilots.clean_empty_project.workbench.source_health.total >= 1 &&
      report.pilots.copied_existing_sandbox.workbench.source_health.total >= 1 &&
      report.pilots.sample_production_sandbox.workbench.source_health.total >= 1,
    production_sensitive_preflight_safe:
      report.pilots.production_sensitive_dry_run.status === "needs_confirmation" &&
      report.pilots.production_sensitive_dry_run.writes_files === false &&
      report.pilots.production_sensitive_dry_run.writes_database === false,
    sample_production_dry_run_safe:
      report.pilots.sample_production_dry_run.status === "needs_confirmation" &&
      report.pilots.sample_production_dry_run.effective_mode === "guided" &&
      report.pilots.sample_production_dry_run.writes_files === false &&
      report.pilots.sample_production_dry_run.writes_database === false &&
      report.pilots.sample_production_dry_run.service_restarts === 0 &&
      report.pilots.sample_production_dry_run.untouched_key_files === true,
    cross_project_recall_source_linked:
      report.pilots.cross_project_recall.active_search_hides_detached_project === true &&
      report.pilots.cross_project_recall.include_detached_finds_source_linked_example === true &&
      report.pilots.cross_project_recall.cross_project_results_are_binding_rules === false,
    all_required_scenarios_passed: true
  };
  report.qa_summary.all_required_scenarios_passed =
    report.qa_summary.clean_attach_capture_recall_detach &&
    report.qa_summary.copied_sandbox_original_untouched &&
    report.qa_summary.sample_production_sandbox_original_untouched &&
    report.qa_summary.workbench_capture_visible &&
    report.qa_summary.production_sensitive_preflight_safe &&
    report.qa_summary.sample_production_dry_run_safe &&
    report.qa_summary.cross_project_recall_source_linked;
  assert(report.qa_summary.all_required_scenarios_passed, "pilot report QA summary was not green");
  report.report_path = reportPath;
  report.markdown_report_path = markdownReportPath;
  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownReportPath, `${pilotMarkdownSummary(report)}\n`);
  const persisted = JSON.parse(await readFile(reportPath, "utf8"));
  assert(
    persisted.qa_summary?.all_required_scenarios_passed === true,
    "persisted pilot report did not preserve QA summary"
  );
  const markdown = await readFile(markdownReportPath, "utf8");
  for (const required of [
    "# Recallant Pilot Report",
    "## Clean Empty Project",
    "## Copied Existing Sandbox",
    "## Sample Production Sandbox",
    "## Production-Sensitive Dry Run",
    "## Sample Production Dry Run",
    "## Cross-Project Recall",
    "Attached",
    "Imported sources",
    "Remembered marker",
    "Public proof marker",
    "Public proof ask recalled",
    "Recalled later",
    "Detached",
    "Left untouched",
    "Original project untouched",
    "Original key files untouched",
    "Key files untouched"
  ]) {
    assert(markdown.includes(required), `pilot Markdown report missing ${required}`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
}
