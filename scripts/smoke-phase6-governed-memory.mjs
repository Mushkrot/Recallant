import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

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

async function callToolRaw(id, name, args) {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return waitForResponse(id);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-phase6-governed-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "phase6-governed-smoke",
  resume_policy: "normal"
});

const event = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "Phase 6 source event for governed memory smoke.",
  dedup_key: `phase6-source-${randomUUID()}`
});

const invalid = await callToolRaw(4, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Invalid agent memory",
  body: "Missing source refs should fail.",
  created_by: "agent",
  source_refs: []
});
const invalidText = invalid.error?.message ?? invalid.result?.content?.[0]?.text ?? "";
if (invalid.result?.isError !== true || !invalidText.includes("VALIDATION_ERROR")) {
  throw new Error(`Agent memory without source refs did not fail: ${JSON.stringify(invalid)}`);
}

const ordinary = await callTool(5, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Recallant keeps governed memory in v1",
  body: "Governed memory is part of the v1 core and can be recalled when accepted.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "governed memory smoke" }]
});
if (ordinary.status !== "accepted" || ordinary.use_policy !== "recall_allowed") {
  throw new Error(`Ordinary governed memory policy failed: ${JSON.stringify(ordinary)}`);
}

const candidate = await callTool(6, "memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "developer",
  title: "Always run governed memory smoke",
  body: "Always run governed memory smoke before changing memory policy.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "Always run" }]
});
if (candidate.status !== "candidate" || candidate.use_policy !== "recall_allowed") {
  throw new Error(`Candidate rule policy failed: ${JSON.stringify(candidate)}`);
}

const inbox = await callTool(7, "memory_list_agent_memories", {
  view: "inbox",
  limit: 20
});
if (
  !inbox.memories.some((memory) => memory.memory_id === candidate.memory_id) ||
  inbox.memories.some((memory) => memory.memory_id === ordinary.memory_id)
) {
  throw new Error(`Inbox filtering failed: ${JSON.stringify(inbox)}`);
}

const promoted = await callTool(8, "memory_review_agent_memory", {
  memory_id: candidate.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "phase6 smoke promotion"
});
if (promoted.status !== "accepted" || promoted.use_policy !== "instruction_grade") {
  throw new Error(`Instruction promotion failed: ${JSON.stringify(promoted)}`);
}

const rules = await callTool(9, "memory_list_agent_memories", {
  view: "rules",
  limit: 20
});
if (!rules.memories.some((memory) => memory.memory_id === candidate.memory_id)) {
  throw new Error(`Rules view failed: ${JSON.stringify(rules)}`);
}

const detail = await callTool(10, "memory_get_agent_memory", {
  memory_id: candidate.memory_id
});
if (detail.source_refs.length !== 1 || detail.review_actions.length < 1) {
  throw new Error(`Source/review detail failed: ${JSON.stringify(detail)}`);
}

const recall = await callTool(11, "memory_recall_agent_memories", {
  query: "governed memory",
  scope: "project",
  top_k: 5,
  max_chars_total: 2000
});
if (
  !recall.trace_id ||
  !recall.memories.some((memory) => memory.memory_id === ordinary.memory_id) ||
  recall.memories.some((memory) => memory.status !== "accepted")
) {
  throw new Error(`Governed recall failed: ${JSON.stringify(recall)}`);
}

await callTool(12, "memory_report_recall_usage", {
  trace_id: recall.trace_id,
  used_memory_ids: [ordinary.memory_id],
  ignored_memory_ids: [candidate.memory_id],
  note: "phase6 smoke usage"
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $1) AS source_ref_count,
        (SELECT count(*)::int FROM agent_memory_review_actions WHERE memory_id = $2 AND action = 'promote_instruction') AS promotion_count,
        (SELECT used_memory_ids FROM recall_traces WHERE id = $3) AS used_memory_ids,
        (SELECT ignored_memory_ids FROM recall_traces WHERE id = $3) AS ignored_memory_ids
    `,
    [ordinary.memory_id, candidate.memory_id, recall.trace_id]
  );
  const row = checks.rows[0];
  if (
    row.source_ref_count !== 1 ||
    row.promotion_count !== 1 ||
    !JSON.stringify(row.used_memory_ids).includes(ordinary.memory_id) ||
    !JSON.stringify(row.ignored_memory_ids).includes(candidate.memory_id)
  ) {
    throw new Error(`Governed memory DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 6 governed memory smoke passed\n");
