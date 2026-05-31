import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { RecallantDb } from "@recallant/db";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const defaultProjectId = randomUUID();
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
    clientInfo: { name: "recallant-phase4-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "phase4-smoke",
  resume_policy: "normal"
});

const defaultDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: defaultProjectId,
  projectPath: `/tmp/${defaultProjectId}`
});
const defaultSession = await defaultDb.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: `/tmp/${defaultProjectId}`,
  session_label: "phase4-default-route",
  resume_policy: "normal"
});
const defaultRouteAppend = await defaultDb.appendTurn({
  session_id: defaultSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "Default route should resolve to local Ollama and remain pending if unavailable.",
  dedup_key: `phase4-default-${randomUUID()}`
});
if (
  !["pending", "embedded"].includes(defaultRouteAppend.embedding?.status) ||
  defaultRouteAppend.embedding?.provider !== "ollama" ||
  defaultRouteAppend.embedding?.model !== "nomic-embed-text"
) {
  throw new Error(`Default embedding route failed: ${JSON.stringify(defaultRouteAppend)}`);
}
await defaultDb.close();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase4 deterministic embedding smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    projectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v1",
      dims: 16
    })
  ]
);

const banana = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "banana banana yellow fruit smoothie marker_banana",
  dedup_key: `phase4-banana-${randomUUID()}`
});
const network = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "router switch vlan latency packet marker_network",
  dedup_key: `phase4-network-${randomUUID()}`
});
if (banana.embedding?.status !== "embedded" || network.embedding?.status !== "embedded") {
  throw new Error(`Deterministic embedding failed: ${JSON.stringify({ banana, network })}`);
}

const search = await callTool(5, "memory_search", {
  session_id: started.session_id,
  query: "banana fruit",
  mode: "vector_only",
  top_k: 1,
  max_chars_total: 2000
});
if (search.hits?.[0]?.source_event_id !== banana.event_id || search.hits?.[0]?.path !== "vector") {
  throw new Error(`Vector search did not return expected hit: ${JSON.stringify(search)}`);
}

await client.query(
  `
    UPDATE project_settings
    SET value = $2, updated_at = now()
    WHERE project_id = $1 AND key = 'embedding_route'
  `,
  [
    projectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v2",
      dims: 16
    })
  ]
);
const blockedSwitch = await callToolRaw(6, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "model switch should require explicit reindex",
  dedup_key: `phase4-switch-${randomUUID()}`
});
const blockedSwitchText =
  blockedSwitch.error?.message ?? blockedSwitch.result?.content?.[0]?.text ?? "";
if (
  blockedSwitch.result?.isError !== true ||
  !blockedSwitchText.includes("requires explicit reindex")
) {
  throw new Error(`Embedding model switch was not blocked: ${JSON.stringify(blockedSwitch)}`);
}

const paidProjectId = randomUUID();
const paidDeveloperId = randomUUID();
const paidDb = new RecallantDb({
  databaseUrl,
  developerId: paidDeveloperId,
  projectId: paidProjectId,
  projectPath: `/tmp/${paidProjectId}`
});
await paidDb.ensureProject(`/tmp/${paidProjectId}`);
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase4 paid approval smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    paidProjectId,
    JSON.stringify({
      route_class: "paid_api_provider",
      provider: "openai",
      model: "text-embedding-3-small",
      dims: 1536
    })
  ]
);
const paidSession = await paidDb.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: `/tmp/${paidProjectId}`,
  session_label: "phase4-paid-api",
  resume_policy: "normal"
});
const paidAppend = await paidDb.appendTurn({
  session_id: paidSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "paid route should create approval and avoid provider call",
  dedup_key: `phase4-paid-${randomUUID()}`
});
if (
  paidAppend.embedding?.status !== "pending_approval" ||
  paidAppend.embedding?.provider !== "openai" ||
  !paidAppend.embedding?.approval_request_id
) {
  throw new Error(`Paid API approval path failed: ${JSON.stringify(paidAppend)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = $1) AS embedding_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $1 AND provider = 'deterministic' AND status = 'success') AS deterministic_calls,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $3 AND provider = 'ollama' AND model = 'nomic-embed-text') AS default_ollama_calls,
        (SELECT count(*)::int FROM system_settings WHERE key = 'embedding_fallback_candidates' AND value::text LIKE '%openai%' AND value::text LIKE '%gemini%') AS fallback_settings,
        (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $2 AND provider = 'openai' AND status = 'pending') AS paid_approval_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $2 AND provider = 'openai' AND confirmation_status = 'required_pending' AND status = 'cancelled') AS blocked_paid_calls,
        (SELECT count(*)::int FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = $2) AS paid_embedding_count
    `,
    [projectId, paidProjectId, defaultProjectId]
  );
  const row = checks.rows[0];
  if (
    row.embedding_count < 2 ||
    row.deterministic_calls < 2 ||
    row.default_ollama_calls < 1 ||
    row.fallback_settings !== 1 ||
    row.paid_approval_count !== 1 ||
    row.blocked_paid_calls !== 1 ||
    row.paid_embedding_count !== 0
  ) {
    throw new Error(`Unexpected Phase 4 database state: ${JSON.stringify(row)}`);
  }
} finally {
  await paidDb.close();
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 4 embedding smoke passed\n");
