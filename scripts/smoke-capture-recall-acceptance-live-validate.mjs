#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";
import { validateLiveCaptureRecallAcceptance } from "./validate-capture-recall-acceptance-live.mjs";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-capture-recall-acceptance-${randomUUID()}`;
const traceId = randomUUID();
const runId = randomUUID();
const marker = `remote acceptance ${traceId}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeAudit(db, operation, sessionId = null, metadata = {}) {
  const activity = await db.startSystemActivity({
    trace_id: traceId,
    developer_id: developerId,
    project_id: projectId,
    session_id: sessionId,
    surface: "remote_mcp",
    operation,
    actor_kind: "remote_client",
    actor_id: "remote-client:smoke",
    client_kind: "codex",
    client_version: "acceptance-smoke",
    metadata
  });
  await db.finishSystemActivity({
    id: activity.id,
    status: "success",
    related_ids: { project_id: projectId, session_id: sessionId },
    metadata
  });
}

function baseEvidence(firstSessionId, nextSessionId, memoryId) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_id: runId,
    trace_id: traceId,
    session_id: firstSessionId,
    external_host: {
      hostname_hash: "hosthash",
      platform: "linux",
      os_type: "Linux",
      os_release: "6.0.0",
      arch: process.arch,
      node: process.version,
      project_dir_hash: "projecthash"
    },
    project_dir: {
      basename: "capture-recall-acceptance-smoke",
      hash: "projecthash"
    },
    clean_project_before: {
      entry_count: 1,
      entries: ["README.md"],
      codex_config_present: false,
      recallant_codex_config_entries: 0,
      recallant_remote_bridge_configured: false,
      forbidden: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    inferred_inputs: [],
    bootstrap: {
      command: "bash install-recallant-client-bootstrap.sh --credential [REDACTED_CREDENTIAL]",
      exit_code: 0,
      stdout: "Config written. Remote doctor passed.",
      stderr: ""
    },
    client_config: {
      entry_count: 2,
      entries: [".codex", "README.md"],
      codex_config_present: true,
      recallant_codex_config_entries: 1,
      recallant_remote_bridge_configured: true,
      forbidden: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    remote_doctor: {
      exit_code: 0,
      json: {
        overall: { status: "pass" },
        stages: [
          { id: "mcp_initialize", status: "pass", code: "mcp_initialize_ok" },
          { id: "tools_list", status: "pass", code: "tools_list_ok" },
          { id: "semantic_memory_proof", status: "pass", code: "semantic_memory_proof_ok" }
        ]
      }
    },
    remote_mcp: {
      status: "pass",
      tools: [
        "memory_start_session",
        "memory_get_context_pack",
        "memory_create_agent_memory",
        "memory_set_checkpoint",
        "memory_recall_agent_memories"
      ],
      required_tools: [
        "memory_start_session",
        "memory_get_context_pack",
        "memory_create_agent_memory",
        "memory_set_checkpoint",
        "memory_recall_agent_memories"
      ],
      marker,
      start_session: {
        is_error: false,
        session_id: firstSessionId
      },
      context_pack: {
        is_error: false,
        context_pack_id: "smoke-context-pack"
      },
      memory_write: {
        is_error: false,
        memory_id: memoryId,
        status: "accepted"
      },
      checkpoint: {
        is_error: false,
        updated_at: new Date().toISOString()
      },
      recall: {
        is_error: false,
        marker_found: true,
        trace_id: randomUUID()
      },
      next_session: {
        start_is_error: false,
        session_id: nextSessionId,
        context_pack_is_error: false,
        context_pack_id: "smoke-next-context-pack",
        recall_is_error: false,
        marker_found: true,
        trace_id: randomUUID()
      },
      call_tool: "memory_recall_agent_memories",
      call_is_error: false,
      stderr: ""
    },
    capture_recall: {
      requested: true,
      doctor_stage: {
        id: "semantic_memory_proof",
        status: "pass",
        code: "semantic_memory_proof_ok"
      }
    },
    forbidden_artifacts: {
      status: "pass",
      checks: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    redaction: {
      status: "pass",
      raw_credential_present: false
    },
    result: {
      status: "pass"
    }
  };
}

process.env.RECALLANT_DATABASE_URL = databaseUrl;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
const temp = await mkdtemp(join(tmpdir(), "recallant-capture-recall-live-"));

try {
  await db.ensureProject(projectPath);
  const first = await db.startSession({
    client_kind: "codex",
    client_version: "acceptance-smoke",
    project_id: projectId,
    session_label: "capture recall acceptance smoke",
    resume_policy: "force_new"
  });
  await db.appendEvent({
    session_id: first.session_id,
    client_kind: "codex",
    event_kind: "tool_result",
    text: `Context read for ${marker}`,
    metadata: { capture_kind: "context_read", trace_id: traceId }
  });
  const created = await db.createAgentMemory({
    project_id: projectId,
    memory_type: "work_log",
    scope: "project",
    title: "Capture recall acceptance smoke marker",
    body: marker,
    confidence: 1,
    source_refs: [
      {
        source_kind: "external",
        source_id: traceId,
        quote: null,
        metadata: { source: "capture_recall_acceptance_smoke" }
      }
    ],
    created_by: "agent",
    metadata: { trace_id: traceId }
  });
  await db.pool.query("UPDATE agent_memories SET status = 'accepted' WHERE id = $1", [
    created.memory_id
  ]);
  await db.setCheckpoint(projectId, {
    current_status: "capture recall acceptance smoke",
    current_focus: marker,
    next_step: "Validate strict acceptance.",
    open_questions: []
  });
  const next = await db.startSession({
    client_kind: "codex",
    client_version: "acceptance-smoke",
    project_id: projectId,
    session_label: "capture recall acceptance smoke follow-up",
    resume_policy: "force_new"
  });
  await db.appendEvent({
    session_id: next.session_id,
    client_kind: "codex",
    event_kind: "tool_result",
    text: `Second session recall found ${marker}`,
    metadata: { capture_kind: "agent_recall", trace_id: traceId }
  });
  for (const [operation, sessionId] of [
    ["remote_mcp.initialize", null],
    ["remote_mcp.tools/list", null],
    ["remote_mcp.tools/call", first.session_id],
    ["remote_mcp.tools/call", first.session_id],
    ["remote_mcp.tools/call", first.session_id],
    ["remote_mcp.tools/call", first.session_id],
    ["remote_mcp.tools/call", first.session_id],
    ["remote_mcp.tools/call", next.session_id],
    ["remote_mcp.tools/call", next.session_id],
    ["remote_mcp.tools/call", next.session_id]
  ]) {
    await writeAudit(db, operation, sessionId, {
      trace_id: traceId,
      audit_policy: "remote_mcp_redacted_no_raw_body_no_auth_headers"
    });
  }

  const evidence = baseEvidence(first.session_id, next.session_id, created.memory_id);
  const evidencePath = join(temp, "capture-recall.evidence.json");
  const rawText = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(evidencePath, rawText);
  const report = await validateLiveCaptureRecallAcceptance(evidence, rawText, evidencePath);
  assert(report.status === "pass", "live capture/recall acceptance validator did not pass");
  assert(report.first_session_id === first.session_id, "first session mismatch");
  assert(report.next_session_id === next.session_id, "next session mismatch");
  assert(report.memory_id === created.memory_id, "memory mismatch");
  assert(
    report.checks.includes("audit_coverage_remote_mcp_envelope"),
    "validator did not accept the remote MCP audit envelope"
  );
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        checks: report.checks
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await db.close();
}
