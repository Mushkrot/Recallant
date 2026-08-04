#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RecallantDb, createRecallantDbFromEnv } from "../packages/db/dist/index.js";
import { validateEvidence } from "./validate-remote-mcp-separate-machine-evidence.mjs";

const forbiddenPattern =
  /rcl_mcp_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|postgres(?:ql)?:\/\/|RECALLANT_DATABASE_URL|DATABASE_URL|pgvector|recallant-postgres|sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{16,}/i;

function usage() {
  process.stdout.write(`Usage: node scripts/validate-capture-recall-acceptance-live.mjs --evidence <path>

Validates strict Capture/Recall Acceptance against the central Recallant database:
external evidence, next-session recall, Workbench readiness, and redacted audit rows.
Requires RECALLANT_DATABASE_URL on the server. Prints no secrets.\n`);
}

function parseArgs(argv) {
  const input = { evidencePath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") {
      input.evidencePath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!input.evidencePath) throw new Error("missing required --evidence path");
  return input;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stringValue(value, label) {
  assert(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
  return value;
}

function assertNoSecrets(value, label) {
  const serialized = JSON.stringify(value);
  assert(!forbiddenPattern.test(serialized), `${label} contains forbidden secret-like or local DB text`);
}

const requiredCaptureRecallOperations = [
  "memory_start_session",
  "memory_get_context_pack",
  "memory_create_agent_memory",
  "memory_set_checkpoint",
  "memory_recall_agent_memories"
];

function assertAuditCoversCaptureRecall(auditRows) {
  const operations = new Set(auditRows.map((row) => row.operation));
  const directToolRowsPresent = requiredCaptureRecallOperations.every((operation) =>
    operations.has(operation)
  );
  if (directToolRowsPresent) return "direct_tool_operations";

  assert(operations.has("remote_mcp.initialize"), "audit ledger missing remote_mcp.initialize");
  assert(operations.has("remote_mcp.tools/list"), "audit ledger missing remote_mcp.tools/list");
  assert(operations.has("remote_mcp.tools/call"), "audit ledger missing remote_mcp.tools/call");
  const toolCallCount = auditRows.filter((row) => row.operation === "remote_mcp.tools/call").length;
  assert(
    toolCallCount >= requiredCaptureRecallOperations.length,
    "audit ledger missing enough remote_mcp.tools/call rows"
  );
  return "remote_mcp_envelope";
}

function redactError(text) {
  return String(text)
    .replace(forbiddenPattern, "[REDACTED]")
    .replaceAll(process.cwd(), "[REPO_ROOT]");
}

async function sessionScope(db, sessionId) {
  const result = await db.pool.query(
    `
      SELECT s.id AS session_id, s.project_id, p.developer_id, s.status, s.started_at
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1
    `,
    [sessionId]
  );
  const row = result.rows[0];
  assert(row, `session not found: ${sessionId}`);
  return row;
}

async function queryAuditRows(db, evidence, projectId, sessionIds) {
  const traceId = stringValue(evidence.trace_id, "evidence.trace_id");
  const result = await db.pool.query(
    `
      SELECT trace_id, surface, operation, status, error_code, error_message, project_id,
             developer_id, session_id, actor_kind, actor_id, client_kind, related_ids,
             redacted_metadata, started_at, finished_at
      FROM system_activity_events
      WHERE project_id = $1
        AND (
          trace_id = $2::uuid
          OR session_id = ANY($3::uuid[])
        )
      ORDER BY started_at ASC
    `,
    [projectId, traceId, sessionIds]
  );
  return result.rows;
}

async function validateLiveCaptureRecallAcceptance(evidence, rawText, evidenceFile) {
  const evidenceReport = validateEvidence(evidence, rawText);
  const db = createRecallantDbFromEnv();
  assert(db, "RECALLANT_DATABASE_URL is required for live capture/recall acceptance validation");
  try {
    const firstSessionId = stringValue(
      evidence.remote_mcp?.start_session?.session_id,
      "remote_mcp.start_session.session_id"
    );
    const nextSessionId = stringValue(
      evidence.remote_mcp?.next_session?.session_id,
      "remote_mcp.next_session.session_id"
    );
    assert(firstSessionId !== nextSessionId, "first and next session ids must differ");
    const memoryId = stringValue(
      evidence.remote_mcp?.memory_write?.memory_id,
      "remote_mcp.memory_write.memory_id"
    );
    const marker = stringValue(evidence.remote_mcp?.marker, "remote_mcp.marker");

    const firstSession = await sessionScope(db, firstSessionId);
    const nextSession = await sessionScope(db, nextSessionId);
    assert(
      firstSession.project_id === nextSession.project_id,
      "first and next sessions must belong to the same project"
    );
    assert(
      firstSession.developer_id === nextSession.developer_id,
      "first and next sessions must belong to the same developer"
    );

    const memory = await db.pool.query(
      `
        SELECT id, project_id, developer_id, status, memory_type, title, body, metadata
        FROM agent_memories
        WHERE id = $1
      `,
      [memoryId]
    );
    const memoryRow = memory.rows[0];
    assert(memoryRow, `memory not found: ${memoryId}`);
    assert(memoryRow.project_id === firstSession.project_id, "memory project does not match session project");
    assert(memoryRow.developer_id === firstSession.developer_id, "memory developer does not match session developer");
    assert(memoryRow.status === "accepted", "memory must be accepted");
    assert(String(memoryRow.body ?? "").includes(marker), "memory body must contain acceptance marker");

    const dashboardDb = new RecallantDb({
      databaseUrl: process.env.RECALLANT_DATABASE_URL,
      developerId: firstSession.developer_id,
      projectId: firstSession.project_id,
      projectPath: "remote://capture-recall-acceptance"
    });
    let dashboard;
    try {
      dashboard = await dashboardDb.getReviewDashboard({ project_id: firstSession.project_id });
    } finally {
      await dashboardDb.close();
    }
    const readiness = dashboard.project_readiness ?? {};
    assert(readiness.project_registered === true, "Workbench project readiness must show registered project");
    assert(readiness.last_context_read_at, "Workbench readiness is missing last context read");
    assert(readiness.last_memory_write_at, "Workbench readiness is missing last memory write");
    assert(readiness.checkpoint_updated_at, "Workbench readiness is missing checkpoint timestamp");
    assert(Number(readiness.capture_event_count ?? 0) >= 1, "Workbench readiness must count capture events");
    assert(
      Number(readiness.accepted_memory_count ?? 0) >= 1,
      "Workbench readiness must count accepted memory"
    );
    const projectVisible = (dashboard.projects ?? []).some(
      (project) => project.project_id === firstSession.project_id
    );
    assert(projectVisible, "Workbench project chooser must include the accepted project");
    const activityKinds = new Set((dashboard.recent_activity ?? []).map((row) => row.activity_kind));
    assert(activityKinds.has("context_read"), "Workbench recent activity must include context_read");
    assert(activityKinds.has("memory_write"), "Workbench recent activity must include memory_write");
    assert(activityKinds.has("checkpoint"), "Workbench recent activity must include checkpoint");

    const auditRows = await queryAuditRows(db, evidence, firstSession.project_id, [
      firstSessionId,
      nextSessionId
    ]);
    assert(auditRows.length >= 5, "audit ledger must include the capture/recall operation rows");
    const auditCoverage = assertAuditCoversCaptureRecall(auditRows);
    assert(
      auditRows.every((row) => row.status === "success"),
      "capture/recall audit rows must all be successful"
    );
    assertNoSecrets(auditRows, "audit rows");

    return {
      status: "pass",
      evidence_file: basename(evidenceFile),
      evidence_run_id: evidenceReport.run_id,
      trace_id: evidenceReport.trace_id,
      project_id: firstSession.project_id,
      first_session_id: firstSessionId,
      next_session_id: nextSessionId,
      memory_id: memoryId,
      checks: [
        "external_evidence_valid",
        "next_session_recall_valid",
        "workbench_project_visible",
        "workbench_context_write_checkpoint_visible",
        `audit_coverage_${auditCoverage}`,
        "audit_rows_successful",
        "audit_rows_redacted"
      ]
    };
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = parseArgs(process.argv.slice(2));
  try {
    const rawText = await readFile(input.evidencePath, "utf8");
    const evidence = JSON.parse(rawText);
    const report = await validateLiveCaptureRecallAcceptance(evidence, rawText, input.evidencePath);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Recallant capture/recall acceptance validation failed: ${redactError(
        error instanceof Error ? error.message : String(error)
      )}\n`
    );
    process.exit(1);
  }
}

export { validateLiveCaptureRecallAcceptance };
