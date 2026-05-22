import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
    RECALLANT_PROJECT_PATH: process.cwd()
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
  const deadline = Date.now() + 5000;
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
  project_path: process.cwd(),
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
  text: "bounded excerpt",
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

await callTool(7, "memory_closeout", {
  session_id: started.session_id,
  closeout_intent: "task_complete",
  summary: "Phase 3 smoke complete.",
  checkpoint_payload: {
    current_status: "phase3 smoke complete",
    current_focus: "session lifecycle",
    next_step: "continue implementation",
    open_questions: []
  },
  governed_memory_candidates: [],
  artifact_refs: []
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE session_id = $1) AS event_count,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $2) AS chunk_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $3) AS raw_artifact_count,
        (SELECT status FROM sessions WHERE id = $1) AS session_status,
        (SELECT last_heartbeat_at IS NOT NULL FROM sessions WHERE id = $1) AS has_heartbeat,
        (SELECT count(*)::int FROM checkpoints WHERE project_id = $4) AS checkpoint_count
    `,
    [started.session_id, appended.event_id, workflowEvent.event_id, projectId]
  );
  const row = checks.rows[0];
  if (
    row.event_count !== 2 ||
    row.chunk_count < 1 ||
    row.raw_artifact_count !== 1 ||
    row.session_status !== "closed" ||
    row.has_heartbeat !== true ||
    row.checkpoint_count !== 1
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
