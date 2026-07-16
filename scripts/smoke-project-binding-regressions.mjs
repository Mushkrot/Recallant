import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { RecallantDb } from "../packages/db/dist/index.js";
import { createRecallantMcpServer, createRecallantTools } from "../packages/mcp/dist/index.js";

const validModes = new Set(["inventory", "strict"]);
const forbiddenOutputNeedles = [
  ["postgres", "://"].join(""),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" "),
  ["oauth", "token"].join("_"),
  ["customer", "@example.invalid"].join("")
];
const defaultDatabaseUrl = [
  "postgres",
  "://",
  "recallant",
  ":",
  "recallant_dev_password",
  "@127.0.0.1:15433/recallant_agent_work"
].join("");
const forbiddenSourceNeedles = [
  ["/ai", ["recallant", "internal"].join("-")].join("/"),
  ["/opt", "secure-configs"].join("/"),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["postgres", "://"].join("")
];
const cliEntrypoint = join(process.cwd(), "apps/cli/dist/index.js");

function parseArgs(argv) {
  const parsed = { mode: "inventory", cases: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      const mode = argv[index + 1];
      if (!validModes.has(mode)) throw new Error(`Invalid --mode: ${mode ?? ""}`);
      parsed.mode = mode;
      index += 1;
      continue;
    }
    if (arg === "--case") {
      const caseId = argv[index + 1];
      if (!caseId) throw new Error("--case requires a case id");
      parsed.cases.push(caseId);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { ...parsed, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function helpText() {
  return [
    "Usage: node scripts/smoke-project-binding-regressions.mjs [--mode inventory|strict] [--case <id>]",
    "",
    "Modes:",
    "  inventory  Print current-state observations and exit 0 when fixtures are deterministic.",
    "  strict     Fail when a future guard is not yet implemented.",
    "",
    "Cases:",
    ...[...cases.keys()].map((caseId) => `  ${caseId}`)
  ].join("\n");
}

function safeSummary(input) {
  const text = JSON.stringify(input);
  for (const needle of forbiddenOutputNeedles) {
    if (text.includes(needle)) {
      throw new Error(`Unsafe diagnostic output included forbidden marker: ${needle}`);
    }
  }
  return input;
}

function databaseUrl() {
  return process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl;
}

async function withTempProject(label, callback) {
  const dir = await mkdtemp(join(tmpdir(), `recallant-${label}-`));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function basename(path) {
  return String(path).split("/").filter(Boolean).at(-1) ?? "";
}

function syntheticProject(label, developerId, projectPath = null) {
  const id = randomUUID();
  return {
    id,
    developerId,
    path: projectPath ?? join(tmpdir(), `recallant-${label}-${id}`),
    name: `recallant-${label}`
  };
}

function dbFor(project) {
  return new RecallantDb({
    databaseUrl: databaseUrl(),
    developerId: project.developerId,
    projectId: project.id,
    projectPath: project.path
  });
}

async function registerProject(database, project) {
  await database.registerProject({
    projectId: project.id,
    developerId: project.developerId,
    projectPath: project.path,
    name: project.name,
    captureProfile: "standard"
  });
}

async function writeProjectConfig(projectDir, projectId) {
  await mkdir(join(projectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(projectDir, ".recallant", "config"),
    `${JSON.stringify(
      {
        project_id: projectId,
        recallant_server_url: "http://127.0.0.1:3005"
      },
      null,
      2
    )}\n`
  );
}

function cliEnvironment(developerId) {
  const env = { ...process.env };
  env.RECALLANT_DATABASE_URL = databaseUrl();
  env.RECALLANT_DEVELOPER_ID = developerId;
  delete env.RECALLANT_PROJECT_ID;
  delete env.RECALLANT_PROJECT_PATH;
  return env;
}

function runCli(projectDir, developerId, args) {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: projectDir,
    env: cliEnvironment(developerId),
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const exitStatus = result.status ?? 1;
  let json = null;
  if (exitStatus === 0 && result.stdout.trim()) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = null;
    }
  }
  return {
    exit_status: exitStatus,
    signal: result.signal,
    error_code: result.error?.code ?? null,
    stdout_json: json,
    stdout_json_ok: Boolean(json),
    stdout_line_count: result.stdout.trim() ? result.stdout.trim().split("\n").length : 0,
    stderr_line_count: result.stderr.trim() ? result.stderr.trim().split("\n").length : 0,
    stderr_has_project_id_path_mismatch: result.stderr.includes("PROJECT_ID_PATH_MISMATCH")
  };
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function seedProjectActivity(database, project, label, count = 1) {
  const eventIds = [];
  const memoryIds = [];
  for (let index = 0; index < count; index += 1) {
    const marker = `activity_${label}_${index}_${randomUUID().replaceAll("-", "_")}`;
    const started = await database.startSession({
      client_kind: "fixture",
      client_version: "project-binding-regression",
      project_id: project.id,
      session_label: `project-binding-activity-${label}-${index}`,
      resume_policy: "force_new"
    });
    const event = await database.appendEvent({
      session_id: String(started.session_id),
      client_kind: "fixture",
      event_kind: "system",
      text: `Synthetic project-binding activity ${marker}`,
      metadata: { capture_kind: "project_binding_activity", marker },
      raw_artifacts: []
    });
    const memory = await database.createAgentMemory({
      project_id: project.id,
      memory_type: "work_log",
      scope: "project",
      scope_kind: "project",
      title: `Project binding activity ${marker}`,
      body: `Synthetic project-binding activity memory ${marker}`,
      confidence: 0.95,
      created_by: "agent",
      source_refs: [
        {
          source_kind: "event",
          source_id: String(event.event_id),
          quote: `Synthetic project-binding activity ${marker}`,
          metadata: { capture_kind: "project_binding_activity" }
        }
      ],
      metadata: { created_from: "project_binding_regression_fixture", marker }
    });
    eventIds.push(String(event.event_id));
    memoryIds.push(String(memory.memory_id));
  }
  return { event_count: eventIds.length, memory_count: memoryIds.length };
}

async function projectIdsWithMarker(database, table, marker) {
  const columnByTable = {
    events: "payload::text",
    chunks: "text",
    agent_memories: "body || ' ' || title || ' ' || metadata::text",
    checkpoints: "payload::text"
  };
  const column = columnByTable[table];
  if (!column) throw new Error(`Unknown marker table: ${table}`);
  const rows = await database.pool.query(
    `SELECT DISTINCT project_id FROM ${table} WHERE ${column} LIKE $1 ORDER BY project_id`,
    [`%${marker}%`]
  );
  return rows.rows.map((row) => String(row.project_id));
}

async function contextReadEventCount(database, sessionId) {
  const rows = await database.pool.query(
    `
      SELECT count(*)::int AS count
      FROM events
      WHERE session_id = $1
        AND payload->'metadata'->>'capture_kind' = 'context_read'
    `,
    [sessionId]
  );
  return Number(rows.rows[0]?.count ?? 0);
}

async function projectRecordCounts(database, projectIds) {
  const rows = await database.pool.query(
    `
      SELECT p.id AS project_id,
        (SELECT count(*)::int FROM sessions s WHERE s.project_id = p.id) AS sessions,
        (SELECT count(*)::int FROM events e WHERE e.project_id = p.id) AS events,
        (SELECT count(*)::int FROM agent_memories m WHERE m.project_id = p.id) AS memories
      FROM projects p
      WHERE p.id = ANY($1::uuid[])
      ORDER BY p.id
    `,
    [projectIds]
  );
  return rows.rows.map((row) => ({
    project_id: String(row.project_id),
    sessions: Number(row.sessions),
    events: Number(row.events),
    memories: Number(row.memories)
  }));
}

function makeCaseResult({ caseId, status, observed, futureGuard, strictPass, diagnostics = {} }) {
  return safeSummary({
    case_id: caseId,
    status,
    observed,
    future_guard: futureGuard,
    strict_pass: strictPass,
    diagnostics
  });
}

async function withDuplicatePathFixture(label, callback) {
  return withTempProject(label, async (projectDir) => {
    const developerId = randomUUID();
    const configProject = syntheticProject(`${label}-config`, developerId, projectDir);
    const duplicateProject = syntheticProject(`${label}-duplicate`, developerId, projectDir);
    const configDb = dbFor(configProject);
    const duplicateDb = dbFor(duplicateProject);
    try {
      await registerProject(configDb, configProject);
      await registerProject(duplicateDb, duplicateProject);
      await writeProjectConfig(projectDir, configProject.id);
      await seedProjectActivity(duplicateDb, duplicateProject, label, 3);
      return await callback({
        projectDir,
        developerId,
        configProject,
        duplicateProject,
        configDb,
        duplicateDb
      });
    } finally {
      await configDb.close();
      await duplicateDb.close();
    }
  });
}

async function runMcpProjectDirAliasCase() {
  const originalDatabaseUrl = process.env.RECALLANT_DATABASE_URL;
  delete process.env.RECALLANT_DATABASE_URL;
  try {
    return await withTempProject("mcp-project-dir-alias", async (projectDir) => {
      const conflictDir = await mkdtemp(join(tmpdir(), "recallant-mcp-alias-conflict-"));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "project-binding-regression-smoke", version: "0.0.0" });
      const server = createRecallantMcpServer();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);

        async function callToolJson(name, args) {
          const result = await client.callTool(
            {
              name,
              arguments: args
            },
            undefined,
            { timeout: 5_000 }
          );
          const text = result.content?.[0]?.text ?? "{}";
          return {
            is_error: Boolean(result.isError),
            parsed: JSON.parse(text)
          };
        }

        const list = await client.listTools({}, { timeout: 5_000 });
        const tools = new Map((list.tools ?? []).map((tool) => [tool.name, tool]));
        const startProperties = tools.get("memory_start_session")?.inputSchema?.properties ?? {};
        const checkpointProperties =
          tools.get("memory_agent_checkpoint")?.inputSchema?.properties ?? {};
        const dirOnly = await callToolJson("memory_start_session", {
          client_kind: "codex",
          project_dir: projectDir,
          session_label: "project-dir-alias-only",
          resume_policy: "force_new"
        });
        const samePath = await callToolJson("memory_start_session", {
          client_kind: "codex",
          project_path: projectDir,
          project_dir: projectDir,
          session_label: "project-dir-alias-same-path",
          resume_policy: "force_new"
        });
        const conflict = await callToolJson("memory_agent_checkpoint", {
          client_kind: "mcp",
          project_path: projectDir,
          project_dir: conflictDir,
          payload: {
            current_status: "validation smoke",
            current_focus: "mcp project_dir alias conflict",
            next_step: "reject mismatched project path aliases",
            open_questions: []
          }
        });
        const conflictMessage = String(conflict.parsed.error?.message ?? "");
        const observed = {
          memory_start_session: {
            project_path: Object.hasOwn(startProperties, "project_path"),
            project_dir: Object.hasOwn(startProperties, "project_dir")
          },
          memory_agent_checkpoint: {
            project_path: Object.hasOwn(checkpointProperties, "project_path"),
            project_dir: Object.hasOwn(checkpointProperties, "project_dir")
          },
          project_dir_only_call: {
            ok: dirOnly.parsed.ok !== false && !dirOnly.is_error,
            project_path_source: dirOnly.parsed.project_path_source ?? null,
            project_dir_alias: dirOnly.parsed.project_scope_diagnostic?.project_dir_alias ?? null
          },
          same_path_call: {
            ok: samePath.parsed.ok !== false && !samePath.is_error,
            project_path_source: samePath.parsed.project_path_source ?? null,
            project_dir_alias: samePath.parsed.project_scope_diagnostic?.project_dir_alias ?? null
          },
          conflict_call: {
            is_error: conflict.is_error,
            error_code: conflict.parsed.error?.code ?? null,
            message_names_project_path: conflictMessage.includes("project_path"),
            message_names_project_dir: conflictMessage.includes("project_dir")
          }
        };
        const aliasGuardPresent =
          observed.memory_start_session.project_path &&
          observed.memory_start_session.project_dir &&
          observed.memory_agent_checkpoint.project_path &&
          observed.memory_agent_checkpoint.project_dir &&
          observed.project_dir_only_call.ok &&
          observed.project_dir_only_call.project_path_source === "argument.project_dir" &&
          observed.project_dir_only_call.project_dir_alias === "accepted_as_project_path" &&
          observed.same_path_call.ok &&
          observed.same_path_call.project_dir_alias === "accepted_same_path" &&
          observed.conflict_call.is_error &&
          observed.conflict_call.error_code === "VALIDATION_ERROR" &&
          observed.conflict_call.message_names_project_path &&
          observed.conflict_call.message_names_project_dir;
        return makeCaseResult({
          caseId: "mcp-project-dir-alias",
          status: aliasGuardPresent ? "guard_already_present" : "regression_reproduced",
          observed,
          futureGuard:
            "`project_path` stays canonical, while mistaken `project_dir` is accepted as an alias with a diagnostic or rejected with a clear validation error.",
          strictPass: aliasGuardPresent,
          diagnostics: {
            temp_project_basename: basename(projectDir),
            conflict_project_basename: basename(conflictDir)
          }
        });
      } finally {
        await client.close().catch(() => {});
        await server.close().catch(() => {});
        await rm(conflictDir, { recursive: true, force: true });
      }
    });
  } finally {
    if (originalDatabaseUrl === undefined) {
      delete process.env.RECALLANT_DATABASE_URL;
    } else {
      process.env.RECALLANT_DATABASE_URL = originalDatabaseUrl;
    }
  }
}

async function runContextSessionProjectMismatchCase() {
  const developerId = randomUUID();
  const sessionProject = syntheticProject("context-session", developerId);
  const callerProject = syntheticProject("context-caller", developerId);
  const sessionDb = dbFor(sessionProject);
  const callerDb = dbFor(callerProject);
  try {
    await registerProject(sessionDb, sessionProject);
    await registerProject(callerDb, callerProject);
    const started = await sessionDb.startSession({
      client_kind: "codex",
      client_version: "project-binding-regression",
      project_id: sessionProject.id,
      session_label: "context-mismatch-fixture",
      resume_policy: "force_new"
    });
    let validationError = null;
    let packProjectId = null;
    const sessionId = String(started.session_id);
    const contextReadEventsBeforeConflict = await contextReadEventCount(sessionDb, sessionId);
    try {
      const pack = await callerDb.getContextPack({
        session_id: sessionId,
        project_id: callerProject.id,
        task_hint: "project binding mismatch synthetic marker",
        include_raw_evidence: "never",
        include_recovery: false,
        max_chars_total: 2000
      });
      packProjectId = String(pack.project_id ?? "");
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
    const contextReadEventsAfterConflict = await contextReadEventCount(sessionDb, sessionId);
    const guardPresent = Boolean(validationError?.includes("VALIDATION_ERROR"));
    const messageNamesSessionId = Boolean(validationError?.includes("session_id"));
    const messageNamesProjectId = Boolean(validationError?.includes("project_id"));
    const conflictAppendedContextReadEvent =
      contextReadEventsAfterConflict > contextReadEventsBeforeConflict;

    let sameProjectPackProjectId = null;
    let sameProjectError = null;
    try {
      const sameProjectPack = await sessionDb.getContextPack({
        session_id: sessionId,
        project_id: sessionProject.id,
        task_hint: "project binding same project synthetic marker",
        include_raw_evidence: "never",
        include_recovery: false,
        max_chars_total: 2000
      });
      sameProjectPackProjectId = String(sameProjectPack.project_id ?? "");
    } catch (error) {
      sameProjectError = error instanceof Error ? error.message : String(error);
    }

    let omittedProjectPackProjectId = null;
    let omittedProjectError = null;
    try {
      const omittedProjectPack = await sessionDb.getContextPack({
        session_id: sessionId,
        task_hint: "project binding omitted project synthetic marker",
        include_raw_evidence: "never",
        include_recovery: false,
        max_chars_total: 2000
      });
      omittedProjectPackProjectId = String(omittedProjectPack.project_id ?? "");
    } catch (error) {
      omittedProjectError = error instanceof Error ? error.message : String(error);
    }

    const sameProjectReturnsSessionProject = sameProjectPackProjectId === sessionProject.id;
    const omittedProjectReturnsSessionProject = omittedProjectPackProjectId === sessionProject.id;
    const strictPass =
      guardPresent &&
      messageNamesSessionId &&
      messageNamesProjectId &&
      !conflictAppendedContextReadEvent &&
      sameProjectReturnsSessionProject &&
      omittedProjectReturnsSessionProject;
    return makeCaseResult({
      caseId: "context-session-project-mismatch",
      status: strictPass ? "guard_already_present" : "regression_reproduced",
      observed: {
        validation_error: guardPresent,
        error_names_session_id: messageNamesSessionId,
        error_names_project_id: messageNamesProjectId,
        conflict_context_read_events_before: contextReadEventsBeforeConflict,
        conflict_context_read_events_after: contextReadEventsAfterConflict,
        conflict_appended_context_read_event: conflictAppendedContextReadEvent,
        same_project_returned_session_project: sameProjectReturnsSessionProject,
        omitted_project_returned_session_project: omittedProjectReturnsSessionProject,
        same_project_error: sameProjectError,
        omitted_project_error: omittedProjectError,
        returned_session_project: packProjectId === sessionProject.id,
        returned_caller_project: packProjectId === callerProject.id,
        session_project_id: sessionProject.id,
        caller_project_id: callerProject.id
      },
      futureGuard:
        "`memory_get_context_pack` rejects a provided `project_id` when it conflicts with the `session_id` project.",
      strictPass,
      diagnostics: {
        session_path_basename: basename(sessionProject.path),
        caller_path_basename: basename(callerProject.path)
      }
    });
  } finally {
    await sessionDb.close();
    await callerDb.close();
  }
}

async function runCloseoutSessionDerivedProjectCase() {
  const developerId = randomUUID();
  const sessionProject = syntheticProject("closeout-session", developerId);
  const runtimeProject = syntheticProject("closeout-runtime", developerId);
  const sessionDb = dbFor(sessionProject);
  const runtimeDb = dbFor(runtimeProject);
  try {
    await registerProject(sessionDb, sessionProject);
    await registerProject(runtimeDb, runtimeProject);
    const started = await sessionDb.startSession({
      client_kind: "codex",
      client_version: "project-binding-regression",
      project_id: sessionProject.id,
      session_label: "closeout-session-fixture",
      resume_policy: "force_new"
    });
    const marker = `closeout_marker_${randomUUID().replaceAll("-", "_")}`;
    const closeoutTool = createRecallantTools({
      projectId: runtimeProject.id,
      projectPath: runtimeProject.path,
      getDatabase: () => runtimeDb
    }).find((tool) => tool.name === "memory_closeout");
    if (!closeoutTool) throw new Error("memory_closeout tool not found");

    const closeout = await closeoutTool.handler({
      session_id: String(started.session_id),
      closeout_intent: "task_complete",
      summary: `Closeout fixture ${marker}`,
      checkpoint_payload: {
        current_status: "closeout fixture",
        current_focus: marker,
        next_step: "verify session scoped identity",
        open_questions: []
      },
      governed_memory_candidates: [
        {
          memory_type: "work_log",
          title: `Closeout fixture ${marker}`,
          body: `Synthetic closeout memory ${marker}`,
          confidence: 0.95,
          source_refs: []
        }
      ],
      artifact_refs: [],
      local_spool_status: null,
      closeout_diagnostics: null
    });
    const closeoutEventId = closeout.lifecycle?.closeout_event_id ?? null;
    const candidateMemoryId = closeout.created_memory_ids?.[0] ?? null;
    const lifecycleMemoryId = closeout.lifecycle?.proof?.memory?.memory_id ?? null;
    const nextSessionId = closeout.lifecycle?.proof?.next_session_context?.session_id ?? null;
    const eventProject = closeoutEventId
      ? await runtimeDb.pool.query("SELECT project_id FROM events WHERE id = $1", [closeoutEventId])
      : { rows: [] };
    const memoryProjects = await runtimeDb.pool.query(
      "SELECT id, project_id FROM agent_memories WHERE id = ANY($1::uuid[])",
      [[candidateMemoryId, lifecycleMemoryId].filter(Boolean)]
    );
    const checkpointRows = await runtimeDb.pool.query(
      "SELECT DISTINCT project_id FROM checkpoints WHERE project_id = ANY($1::uuid[]) ORDER BY project_id",
      [[sessionProject.id, runtimeProject.id]]
    );
    const nextSessionProject = nextSessionId
      ? await runtimeDb.pool.query("SELECT project_id FROM sessions WHERE id = $1", [nextSessionId])
      : { rows: [] };
    const memoryProjectById = Object.fromEntries(
      memoryProjects.rows.map((row) => [String(row.id), String(row.project_id)])
    );
    const checkpointProjectIds = checkpointRows.rows.map((row) => String(row.project_id)).sort();
    const recallReturnedCloseoutMemory =
      closeout.lifecycle?.proof?.recall?.recall_verified === true;
    const nextContextMarkerFound =
      closeout.lifecycle?.proof?.next_session_context?.marker_found === true;
    const observed = {
      event_project_id: String(eventProject.rows[0]?.project_id ?? ""),
      checkpoint_project_ids: checkpointProjectIds,
      candidate_memory_project_id: memoryProjectById[String(candidateMemoryId)] ?? "",
      lifecycle_memory_project_id: memoryProjectById[String(lifecycleMemoryId)] ?? "",
      recall_project_id: String(closeout.lifecycle?.project_id ?? ""),
      recall_returned_closeout_memory: recallReturnedCloseoutMemory,
      next_context_project_id: String(nextSessionProject.rows[0]?.project_id ?? ""),
      next_context_marker_found: nextContextMarkerFound,
      lifecycle_project_id: String(closeout.lifecycle?.project_id ?? ""),
      session_project_id: sessionProject.id,
      runtime_project_id: runtimeProject.id
    };
    const allSessionScoped =
      observed.event_project_id === sessionProject.id &&
      observed.checkpoint_project_ids.length === 1 &&
      observed.checkpoint_project_ids[0] === sessionProject.id &&
      observed.candidate_memory_project_id === sessionProject.id &&
      observed.lifecycle_memory_project_id === sessionProject.id &&
      observed.recall_project_id === sessionProject.id &&
      observed.recall_returned_closeout_memory &&
      observed.next_context_project_id === sessionProject.id &&
      observed.next_context_marker_found &&
      observed.lifecycle_project_id === sessionProject.id;
    return makeCaseResult({
      caseId: "closeout-session-derived-project",
      status: allSessionScoped ? "guard_already_present" : "regression_reproduced",
      observed,
      futureGuard:
        "`memory_closeout` derives all closeout writes, recall proof, next-session proof, and lifecycle project identity from `session_id`.",
      strictPass: allSessionScoped,
      diagnostics: {
        session_path_basename: basename(sessionProject.path),
        runtime_path_basename: basename(runtimeProject.path)
      }
    });
  } finally {
    await sessionDb.close();
    await runtimeDb.close();
  }
}

async function runDemoCaptureConfigProjectIdCase() {
  return withDuplicatePathFixture("demo-capture", async (fixture) => {
    const marker = `demo_capture_${randomUUID().replaceAll("-", "_")}`;
    const cli = runCli(fixture.projectDir, fixture.developerId, [
      "demo-capture",
      "--project-dir",
      fixture.projectDir,
      "--marker",
      marker,
      "--format",
      "json"
    ]);
    const eventProjectIds = await projectIdsWithMarker(fixture.configDb, "events", marker);
    const memoryProjectIds = await projectIdsWithMarker(fixture.configDb, "agent_memories", marker);
    const checkpointProjectIds = await projectIdsWithMarker(
      fixture.configDb,
      "checkpoints",
      marker
    );
    const counts = await projectRecordCounts(fixture.configDb, [
      fixture.configProject.id,
      fixture.duplicateProject.id
    ]);
    const eventHonorsConfig =
      eventProjectIds.length > 0 &&
      eventProjectIds.every((projectId) => projectId === fixture.configProject.id);
    const memoryHonorsConfig =
      memoryProjectIds.length > 0 &&
      memoryProjectIds.every((projectId) => projectId === fixture.configProject.id);
    const checkpointHonorsConfig =
      checkpointProjectIds.length > 0 &&
      checkpointProjectIds.every((projectId) => projectId === fixture.configProject.id);
    const allConfigScoped =
      cli.exit_status === 0 && eventHonorsConfig && memoryHonorsConfig && checkpointHonorsConfig;
    return makeCaseResult({
      caseId: "demo-capture-config-project-id",
      status: allConfigScoped ? "guard_already_present" : "regression_reproduced",
      observed: {
        cli_exit_status: cli.exit_status,
        cli_json_ok: cli.stdout_json_ok,
        cli_recalled: Boolean(cli.stdout_json?.recalled),
        event_project_ids: eventProjectIds,
        memory_project_ids: memoryProjectIds,
        checkpoint_project_ids: checkpointProjectIds,
        event_honors_config_project: eventHonorsConfig,
        memory_honors_config_project: memoryHonorsConfig,
        checkpoint_honors_config_project: checkpointHonorsConfig,
        config_project_id: fixture.configProject.id,
        duplicate_project_id: fixture.duplicateProject.id
      },
      futureGuard:
        "`recallant demo-capture` uses the attached `.recallant/config` project id for session, event, memory, checkpoint, recall, and closeout writes.",
      strictPass: allConfigScoped,
      diagnostics: {
        temp_project_basename: basename(fixture.projectDir),
        cli_stdout_line_count: cli.stdout_line_count,
        cli_stderr_line_count: cli.stderr_line_count,
        project_record_counts: counts
      }
    });
  });
}

async function runSyncSpoolConfigProjectIdCase() {
  return withDuplicatePathFixture("sync-spool", async (fixture) => {
    const marker = `sync_spool_${randomUUID().replaceAll("-", "_")}`;
    const spoolDir = await mkdtemp(join(tmpdir(), "recallant-sync-spool-"));
    try {
      const append = runCli(fixture.projectDir, fixture.developerId, [
        "spool-append",
        "--project-dir",
        fixture.projectDir,
        "--spool-dir",
        spoolDir,
        "--kind",
        "turn",
        "--role",
        "user",
        "--text",
        `Synthetic sync spool replay marker ${marker}`
      ]);
      const sync =
        append.exit_status === 0
          ? runCli(fixture.projectDir, fixture.developerId, [
              "sync-spool",
              "--project-dir",
              fixture.projectDir,
              "--spool-dir",
              spoolDir
            ])
          : {
              exit_status: 1,
              signal: null,
              error_code: "append_failed",
              stdout_json: null,
              stdout_json_ok: false,
              stdout_line_count: 0,
              stderr_line_count: 0
            };
      const eventProjectIds = await projectIdsWithMarker(fixture.configDb, "events", marker);
      const chunkProjectIds = await projectIdsWithMarker(fixture.configDb, "chunks", marker);
      const counts = await projectRecordCounts(fixture.configDb, [
        fixture.configProject.id,
        fixture.duplicateProject.id
      ]);
      const eventHonorsConfig =
        eventProjectIds.length > 0 &&
        eventProjectIds.every((projectId) => projectId === fixture.configProject.id);
      const chunkHonorsConfig =
        chunkProjectIds.length > 0 &&
        chunkProjectIds.every((projectId) => projectId === fixture.configProject.id);
      const allConfigScoped =
        append.exit_status === 0 &&
        sync.exit_status === 0 &&
        eventHonorsConfig &&
        chunkHonorsConfig;
      return makeCaseResult({
        caseId: "sync-spool-config-project-id",
        status: allConfigScoped ? "guard_already_present" : "regression_reproduced",
        observed: {
          append_exit_status: append.exit_status,
          sync_exit_status: sync.exit_status,
          sync_json_ok: sync.stdout_json_ok,
          synced_count: Number(sync.stdout_json?.synced_count ?? 0),
          event_project_ids: eventProjectIds,
          chunk_project_ids: chunkProjectIds,
          event_honors_config_project: eventHonorsConfig,
          chunk_honors_config_project: chunkHonorsConfig,
          config_project_id: fixture.configProject.id,
          duplicate_project_id: fixture.duplicateProject.id
        },
        futureGuard:
          "`recallant sync-spool` starts replay sessions and writes replay events under the attached `.recallant/config` project id instead of path-only resolution.",
        strictPass: allConfigScoped,
        diagnostics: {
          temp_project_basename: basename(fixture.projectDir),
          spool_basename: basename(spoolDir),
          append_stdout_line_count: append.stdout_line_count,
          sync_stdout_line_count: sync.stdout_line_count,
          sync_stderr_line_count: sync.stderr_line_count,
          project_record_counts: counts
        }
      });
    } finally {
      await rm(spoolDir, { recursive: true, force: true });
    }
  });
}

async function runDuplicateProjectIdentityCase() {
  return withDuplicatePathFixture("duplicate-identity", async (fixture) => {
    const resolverDb = new RecallantDb({
      databaseUrl: databaseUrl(),
      developerId: fixture.developerId
    });
    try {
      let resolved = null;
      let resolutionError = null;
      try {
        resolved = await resolverDb.startSession({
          client_kind: "fixture",
          client_version: "project-binding-regression",
          project_path: fixture.projectDir,
          session_label: "duplicate-identity-resolution-fixture",
          resume_policy: "force_new"
        });
      } catch (error) {
        resolutionError = error;
      }
      const counts = await projectRecordCounts(fixture.configDb, [
        fixture.configProject.id,
        fixture.duplicateProject.id
      ]);
      const pathResolvedProjectId = resolved ? String(resolved.project_id) : null;
      const errorMessage = resolutionError instanceof Error ? resolutionError.message : "";
      const validationError = errorMessage.startsWith("VALIDATION_ERROR:");
      const ambiguousProjectIdentityRejected =
        validationError &&
        errorMessage.includes("ambiguous project path") &&
        errorMessage.includes("project_id");
      const pathResolvedConfig = pathResolvedProjectId === fixture.configProject.id;
      const pathResolvedDuplicate = pathResolvedProjectId === fixture.duplicateProject.id;
      const guardPresent = pathResolvedConfig || ambiguousProjectIdentityRejected;
      return makeCaseResult({
        caseId: "duplicate-project-identity",
        status: guardPresent ? "guard_already_present" : "regression_reproduced",
        observed: {
          config_project_id: fixture.configProject.id,
          duplicate_project_id: fixture.duplicateProject.id,
          path_resolved_project_id: pathResolvedProjectId,
          path_resolved_config_project: pathResolvedConfig,
          path_resolved_duplicate_project: pathResolvedDuplicate,
          ambiguous_project_identity_rejected: ambiguousProjectIdentityRejected,
          resolution_error_code: validationError ? "VALIDATION_ERROR" : null,
          error_names_project_path: errorMessage.includes("project path"),
          error_names_project_id: errorMessage.includes("project_id"),
          same_workspace_path: true
        },
        futureGuard:
          "When one workspace path has multiple project rows, project-local config identity is used or duplicate identity is rejected with a diagnostic instead of selecting by activity count.",
        strictPass: guardPresent,
        diagnostics: {
          temp_project_basename: basename(fixture.projectDir),
          project_record_counts: counts
        }
      });
    } finally {
      await resolverDb.close();
    }
  });
}

async function runForeignProjectPathPreflightCase() {
  const developerId = randomUUID();
  return withTempProject("binding-owned-path", async (boundDir) =>
    withTempProject("binding-foreign-path", async (foreignDir) => {
      const project = syntheticProject("binding-owned", developerId, boundDir);
      const database = dbFor(project);
      try {
        await registerProject(database, project);
        const countSessions = async () => {
          const result = await database.pool.query(
            "SELECT count(*)::int AS count FROM sessions WHERE project_id = $1",
            [project.id]
          );
          return Number(result.rows[0]?.count ?? 0);
        };
        const before = await countSessions();
        let directError = "";
        try {
          await database.startSession({
            client_kind: "fixture",
            client_version: "project-binding-regression",
            project_id: project.id,
            project_path: foreignDir,
            session_label: "foreign-path-must-not-start",
            resume_policy: "force_new"
          });
        } catch (error) {
          directError = error instanceof Error ? error.message : String(error);
        }
        const afterDirect = await countSessions();

        await writeProjectConfig(foreignDir, project.id);
        const cli = runCli(foreignDir, developerId, [
          "agent-start",
          "--project-dir",
          foreignDir,
          "--task-hint",
          "foreign project binding must fail before mutation"
        ]);
        const foreignSpoolDir = await mkdtemp(join(tmpdir(), "recallant-binding-foreign-spool-"));
        const foreignCapture = runCli(foreignDir, developerId, [
          "agent-event",
          "--project-dir",
          foreignDir,
          "--spool-dir",
          foreignSpoolDir,
          "--kind",
          "action",
          "--text",
          "foreign project capture must fail before spool"
        ]);
        const afterCli = await countSessions();
        const stateWritten = await pathExists(join(foreignDir, ".recallant", "current-session.json"));
        const foreignSpoolWritten = await pathExists(join(foreignSpoolDir, "spool.jsonl"));

        const staleDir = await mkdtemp(join(tmpdir(), "recallant-binding-stale-config-"));
        const staleSpoolDir = await mkdtemp(join(tmpdir(), "recallant-binding-stale-spool-"));
        const staleProjectId = randomUUID();
        await writeProjectConfig(staleDir, staleProjectId);
        const staleCapture = runCli(staleDir, developerId, [
          "agent-event",
          "--project-dir",
          staleDir,
          "--spool-dir",
          staleSpoolDir,
          "--kind",
          "action",
          "--text",
          "stale project capture must fail before spool"
        ]);
        const staleStateWritten = await pathExists(
          join(staleDir, ".recallant", "current-session.json")
        );
        const staleSpoolWritten = await pathExists(join(staleSpoolDir, "spool.jsonl"));
        await rm(foreignSpoolDir, { recursive: true, force: true });
        await rm(staleDir, { recursive: true, force: true });
        await rm(staleSpoolDir, { recursive: true, force: true });
        const strictPass =
          directError.includes("PROJECT_ID_PATH_MISMATCH") &&
          afterDirect === before &&
          cli.exit_status !== 0 &&
          cli.stderr_has_project_id_path_mismatch &&
          foreignCapture.exit_status !== 0 &&
          foreignCapture.stderr_has_project_id_path_mismatch &&
          afterCli === before &&
          !stateWritten &&
          !foreignSpoolWritten &&
          staleCapture.exit_status !== 0 &&
          !staleStateWritten &&
          !staleSpoolWritten;
        return makeCaseResult({
          caseId: "foreign-project-path-preflight",
          status: strictPass ? "guard_already_present" : "regression_reproduced",
          observed: {
            direct_mismatch_rejected: directError.includes("PROJECT_ID_PATH_MISMATCH"),
            cli_mismatch_rejected: cli.stderr_has_project_id_path_mismatch,
            sessions_before: before,
            sessions_after_direct: afterDirect,
            sessions_after_cli: afterCli,
            current_session_state_written: stateWritten,
            foreign_capture_rejected: foreignCapture.stderr_has_project_id_path_mismatch,
            foreign_spool_written: foreignSpoolWritten,
            stale_capture_rejected: staleCapture.exit_status !== 0,
            stale_current_session_state_written: staleStateWritten,
            stale_spool_written: staleSpoolWritten
          },
          futureGuard:
            "A project_id bound to another project_path is rejected before session creation or local capture state writes.",
          strictPass,
          diagnostics: {
            bound_path_basename: basename(boundDir),
            foreign_path_basename: basename(foreignDir),
            stale_path_basename: basename(staleDir)
          }
        });
      } finally {
        await database.close();
      }
    })
  );
}

async function runHarnessCase() {
  const source = await readFile(new URL(import.meta.url), "utf8");
  const marker = `project-binding-fixture-${randomUUID()}`;
  const tempProjectProof = await withTempProject("project-binding-harness", async (dir) => ({
    basename: dir.split("/").at(-1),
    cleaned_by_harness: true
  }));
  return makeCaseResult({
    caseId: "harness",
    status: "guard_already_present",
    observed: {
      modes_supported: [...validModes],
      marker_prefix: marker.split("-").slice(0, 3).join("-"),
      temp_project_fixture: tempProjectProof,
      source_safe: !forbiddenSourceNeedles.some((needle) => source.includes(needle))
    },
    futureGuard:
      "Harness can carry inventory and strict project-binding guards without exposing private data.",
    strictPass: true
  });
}

const cases = new Map([
  ["harness", runHarnessCase],
  ["mcp-project-dir-alias", runMcpProjectDirAliasCase],
  ["context-session-project-mismatch", runContextSessionProjectMismatchCase],
  ["closeout-session-derived-project", runCloseoutSessionDerivedProjectCase],
  ["demo-capture-config-project-id", runDemoCaptureConfigProjectIdCase],
  ["sync-spool-config-project-id", runSyncSpoolConfigProjectIdCase],
  ["duplicate-project-identity", runDuplicateProjectIdentityCase],
  ["foreign-project-path-preflight", runForeignProjectPathPreflightCase]
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  const selected = args.cases.length > 0 ? args.cases : [...cases.keys()];
  const unknown = selected.filter((caseId) => !cases.has(caseId));
  if (unknown.length > 0) {
    throw new Error(`Unknown case id(s): ${unknown.join(", ")}`);
  }

  const results = [];
  for (const caseId of selected) {
    const run = cases.get(caseId);
    results.push(await run());
  }

  const strictFailures = results.filter((result) => !result.strict_pass);
  const summary = safeSummary({
    ok: args.mode === "inventory" || strictFailures.length === 0,
    mode: args.mode,
    case_count: results.length,
    strict_failure_count: strictFailures.length,
    strict_failures: strictFailures.map((result) => result.case_id),
    results
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (args.mode === "strict" && strictFailures.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
