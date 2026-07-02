import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase3-db-"));

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
    RECALLANT_PROJECT_PATH: projectDir
  },
  stdio: ["pipe", "pipe", "pipe"]
});

const lines = createInterface({ input: child.stdout });
const responses = new Map();

lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id !== undefined) responses.set(message.id, message);
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitForResponse(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for MCP response id=${id}. stderr=${stderr}`);
}

async function callTool(id, name, args) {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const response = await waitForResponse(id);
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-phase3-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectDir,
  session_label: "phase3-smoke",
  resume_policy: "normal"
});

const dedupKey = `phase3-smoke-${randomUUID()}`;
const appended = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "Phase 3 smoke turn writes one event and at least one chunk.",
  dedup_key: dedupKey
});
const duplicate = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "This duplicate retry must not create a second event.",
  dedup_key: dedupKey
});
if (duplicate.event_id !== appended.event_id || duplicate.status !== "duplicate") {
  throw new Error(`Dedup failed: ${JSON.stringify({ appended, duplicate })}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'capture_profile', $2, 'phase3 smoke profile switch', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [projectId, JSON.stringify("detailed")]
);

await callTool(5, "memory_heartbeat", {
  session_id: started.session_id,
  status: "running_tests",
  note: "phase3 smoke",
  metadata: { smoke: true }
});

const workflowEvent = await callTool(6, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "terminal_output",
  text: "D".repeat(9000),
  metadata: { command: "echo smoke" },
  raw_artifacts: [
    {
      artifact_kind: "terminal_output",
      storage_backend: "external",
      uri: "smoke://terminal-output",
      sha256: "0".repeat(64),
      size_bytes: 2048,
      content_type: "text/plain",
      excerpt: "bounded excerpt",
      metadata: { smoke: true }
    }
  ]
});
if (workflowEvent.capture_profile !== "detailed" || workflowEvent.captured_text_chars !== 8000) {
  throw new Error(`Project capture profile was not applied: ${JSON.stringify(workflowEvent)}`);
}
if (!workflowEvent.chunk_ids?.length || workflowEvent.embedding?.status === "skipped") {
  throw new Error(`Workflow event text was not indexed: ${JSON.stringify(workflowEvent)}`);
}

await client.query(
  `
    INSERT INTO session_overrides (session_id, key, value, reason, created_by)
    VALUES ($1, 'capture_profile', $2, 'phase3 smoke session override', 'smoke')
  `,
  [started.session_id, JSON.stringify("light")]
);

const lightEvent = await callTool(7, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "terminal_output",
  text: "L".repeat(9000),
  metadata: { command: "echo light" },
  raw_artifacts: []
});
if (lightEvent.capture_profile !== "light" || lightEvent.captured_text_chars !== 500) {
  throw new Error(`Session capture override was not applied: ${JSON.stringify(lightEvent)}`);
}
if (!lightEvent.chunk_ids?.length || lightEvent.embedding?.status === "skipped") {
  throw new Error(`Light workflow event text was not indexed: ${JSON.stringify(lightEvent)}`);
}

const closeout = await callTool(8, "memory_closeout", {
  session_id: started.session_id,
  closeout_intent: "task_complete",
  summary: "Phase 3 smoke complete.",
  checkpoint_payload: {
    current_status: "phase3 smoke complete",
    current_focus: "session lifecycle",
    next_step: "continue implementation",
    open_questions: []
  },
  governed_memory_candidates: [
    {
      memory_type: "procedure",
      title: "Closeout candidate fixture",
      body: "Closeout should preserve governed-memory candidates for review.",
      confidence: 0.9,
      source_refs: []
    }
  ],
  artifact_refs: [],
  local_spool_status: {
    status: "unsynced",
    unsynced_count: 1,
    spool_path: "/tmp/recallant-spool-smoke/spool.jsonl"
  }
});
if (
  closeout.report_required !== true ||
  closeout.spool_sync_status !== "unsynced" ||
  !closeout.warnings?.some((warning) => warning.includes("unsynced")) ||
  !closeout.warnings?.some((warning) => warning.includes("requiring review"))
) {
  throw new Error(`Closeout did not report required attention: ${JSON.stringify(closeout)}`);
}
if (closeout.created_memory_ids?.length !== 1 || closeout.needs_review_ids?.length !== 1) {
  throw new Error(`Closeout did not create governed-memory candidate: ${JSON.stringify(closeout)}`);
}

await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'stale_session_threshold_minutes', $2, 'phase3 smoke stale recovery', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [projectId, JSON.stringify(0)]
);

const unclosed = await callTool(9, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectDir,
  session_label: "phase3-unclosed",
  resume_policy: "normal"
});
const recovery = await callTool(10, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectDir,
  session_label: "phase3-recovery",
  resume_policy: "normal"
});
if (
  recovery.previous_unclosed_session?.session_id !== unclosed.session_id ||
  recovery.previous_unclosed_session?.is_stale !== true ||
  recovery.previous_unclosed_session?.stale_after_minutes !== 0 ||
  recovery.previous_session_recovery?.status !== "interrupted" ||
  !String(recovery.previous_session_recovery?.agent_message ?? "").includes("interrupted")
) {
  throw new Error(`Stale-session recovery metadata failed: ${JSON.stringify(recovery)}`);
}

await callTool(11, "memory_closeout", {
  session_id: recovery.session_id,
  closeout_intent: "task_complete",
  summary: "Phase 3 stale recovery smoke complete.",
  checkpoint_payload: {
    current_status: "phase3 recovery smoke complete",
    current_focus: "session lifecycle",
    next_step: "continue implementation",
    open_questions: []
  },
  governed_memory_candidates: [],
  artifact_refs: []
});

let nextToolId = 12;
const extraClientSessionIds = [];
for (const extraClientKind of ["cursor", "claude_code", "windsurf"]) {
  const extraSession = await callTool(nextToolId++, "memory_start_session", {
    client_kind: extraClientKind,
    client_version: "smoke",
    project_path: join(projectDir, extraClientKind),
    session_label: `phase3-${extraClientKind}`,
    resume_policy: "normal"
  });
  if (
    !extraSession.session_id ||
    extraSession.recommended_next_calls?.[0] !== "memory_get_context_pack"
  ) {
    throw new Error(
      `Universal client session contract failed for ${extraClientKind}: ${JSON.stringify(
        extraSession
      )}`
    );
  }
  extraClientSessionIds.push(extraSession.session_id);
  await callTool(nextToolId++, "memory_closeout", {
    session_id: extraSession.session_id,
    closeout_intent: "task_complete",
    summary: `Phase 3 ${extraClientKind} universal client smoke complete.`,
    checkpoint_payload: {
      current_status: "phase3 universal client smoke complete",
      current_focus: extraClientKind,
      next_step: "continue implementation",
      open_questions: []
    },
    governed_memory_candidates: [],
    artifact_refs: []
  });
}

await client.query(
  `
    INSERT INTO developer_settings (developer_id, key, value, updated_by)
    VALUES ($1, 'capture_profile', $2, 'smoke')
    ON CONFLICT (developer_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [developerId, JSON.stringify("detailed")]
);
const developerPolicySession = await callTool(nextToolId++, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: join(projectDir, "developer-policy"),
  session_label: "phase3-developer-policy",
  resume_policy: "normal"
});
const developerPolicyEvent = await callTool(nextToolId++, "memory_append_event", {
  session_id: developerPolicySession.session_id,
  client_kind: "codex",
  event_kind: "terminal_output",
  text: "P".repeat(9000),
  metadata: { command: "developer capture policy" },
  raw_artifacts: []
});
if (
  developerPolicyEvent.capture_profile !== "detailed" ||
  developerPolicyEvent.captured_text_chars !== 8000
) {
  throw new Error(
    `Developer capture policy was not applied: ${JSON.stringify(developerPolicyEvent)}`
  );
}
await callTool(nextToolId++, "memory_closeout", {
  session_id: developerPolicySession.session_id,
  closeout_intent: "task_complete",
  summary: "Phase 3 developer capture policy smoke complete.",
  checkpoint_payload: {
    current_status: "phase3 developer policy smoke complete",
    current_focus: "capture policy",
    next_step: "continue implementation",
    open_questions: []
  },
  governed_memory_candidates: [],
  artifact_refs: []
});

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE session_id = $1) AS event_count,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $2) AS chunk_count,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $3) AS workflow_chunk_count,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $4) AS light_chunk_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $3) AS raw_artifact_count,
        (SELECT payload->'capture'->>'profile' FROM events WHERE id = $2) AS turn_profile,
        (SELECT payload->'capture'->>'profile' FROM events WHERE id = $3) AS workflow_profile,
        (SELECT length(payload->>'text') FROM events WHERE id = $4) AS light_text_length,
        (SELECT status FROM sessions WHERE id = $1) AS session_status,
        (SELECT status FROM sessions WHERE id = $6) AS unclosed_status,
        (SELECT status FROM sessions WHERE id = $7) AS recovery_status,
        (SELECT last_heartbeat_at IS NOT NULL FROM sessions WHERE id = $1) AS has_heartbeat,
        (SELECT count(*)::int FROM checkpoints WHERE project_id = $5) AS checkpoint_count,
        (SELECT payload->>'current_status' FROM checkpoints WHERE project_id = $5) AS checkpoint_status,
        (SELECT payload->>'next_step' FROM checkpoints WHERE project_id = $5) AS checkpoint_next_step,
        (
          SELECT count(*)::int
          FROM agent_memories
          WHERE id = ANY($8::uuid[])
            AND project_id = $5
            AND status IN ('candidate', 'needs_review')
            AND metadata->>'created_from' = 'memory_closeout'
        ) AS closeout_memory_count,
        (
          SELECT count(*)::int
          FROM agent_memory_source_refs
          WHERE memory_id = ANY($8::uuid[])
            AND source_kind = 'checkpoint'
            AND source_id = $1::text
        ) AS closeout_source_ref_count,
        (
          SELECT count(*)::int
          FROM sessions
          WHERE id = ANY($9::uuid[])
            AND client_kind IN ('cursor', 'claude_code', 'windsurf')
            AND status = 'closed'
        ) AS extra_client_session_count,
        (
          SELECT payload->'capture'->>'profile'
          FROM events
          WHERE id = $10
        ) AS developer_policy_profile
    `,
    [
      started.session_id,
      appended.event_id,
      workflowEvent.event_id,
      lightEvent.event_id,
      projectId,
      unclosed.session_id,
      recovery.session_id,
      closeout.created_memory_ids,
      extraClientSessionIds,
      developerPolicyEvent.event_id
    ]
  );
  const row = checks.rows[0];
  if (
    row.event_count !== 4 ||
    row.chunk_count < 1 ||
    row.workflow_chunk_count < 1 ||
    row.light_chunk_count < 1 ||
    row.raw_artifact_count !== 1 ||
    row.turn_profile !== "standard" ||
    row.workflow_profile !== "detailed" ||
    row.light_text_length !== 500 ||
    row.session_status !== "closed" ||
    row.unclosed_status !== "interrupted" ||
    row.recovery_status !== "closed" ||
    row.has_heartbeat !== true ||
    row.checkpoint_count !== 1 ||
    row.checkpoint_status !== "phase3 recovery smoke complete" ||
    row.checkpoint_next_step !== "continue implementation" ||
    row.closeout_memory_count !== 1 ||
    row.closeout_source_ref_count !== 1 ||
    row.extra_client_session_count !== 3 ||
    row.developer_policy_profile !== "detailed"
  ) {
    throw new Error(`Unexpected database state: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 3 DB smoke passed\n");
