import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { RecallantDb } from "@recallant/db";
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

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-phase5-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "phase5-smoke",
  resume_policy: "normal"
});

await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase5 deterministic retrieval smoke', 'smoke')
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

const rare = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "The rare_xylophone_token belongs to the import parser decision.",
  dedup_key: `phase5-rare-${randomUUID()}`
});
const network = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "Network latency packet routing investigation for the Tailnet service.",
  dedup_key: `phase5-network-${randomUUID()}`
});
await callTool(5, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "Banana yellow fruit smoothie note for deterministic vector contrast.",
  dedup_key: `phase5-banana-${randomUUID()}`
});

const unrelatedProjectId = randomUUID();
const unrelatedDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: unrelatedProjectId,
  projectPath: `/tmp/${unrelatedProjectId}`
});
await unrelatedDb.ensureProject(`/tmp/${unrelatedProjectId}`);
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase5 unrelated fixture', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    unrelatedProjectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v1",
      dims: 16
    })
  ]
);
const unrelatedSession = await unrelatedDb.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: `/tmp/${unrelatedProjectId}`,
  session_label: "phase5-unrelated",
  resume_policy: "normal"
});
const unrelated = await unrelatedDb.appendTurn({
  session_id: unrelatedSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "secret_unrelated_scope_token should be excluded from project-scoped retrieval.",
  dedup_key: `phase5-unrelated-${randomUUID()}`
});

const lexical = await callTool(6, "memory_search", {
  session_id: started.session_id,
  query: "rare_xylophone_token",
  mode: "lexical_only",
  top_k: 1,
  max_chars_total: 2000
});
if (lexical.hits?.[0]?.source_event_id !== rare.event_id || lexical.hits?.[0]?.why !== "lexical") {
  throw new Error(`Rare-token lexical retrieval failed: ${JSON.stringify(lexical)}`);
}

const vector = await callTool(7, "memory_search", {
  session_id: started.session_id,
  query: "connectivity delay",
  mode: "vector_only",
  top_k: 1,
  max_chars_total: 2000
});
if (vector.hits?.[0]?.source_event_id !== network.event_id || vector.hits?.[0]?.why !== "vector") {
  throw new Error(`Paraphrase vector retrieval failed: ${JSON.stringify(vector)}`);
}

const capped = await callTool(8, "memory_search", {
  session_id: started.session_id,
  query: "routing fruit parser",
  mode: "hybrid",
  top_k: 3,
  max_chars_total: 40
});
const cappedChars = capped.hits.reduce(
  (total, hit) => total + (hit.text_excerpt?.length ?? hit.excerpt?.length ?? 0),
  0
);
if (cappedChars > 40) {
  throw new Error(`Retrieval response exceeded cap: ${JSON.stringify(capped)}`);
}

const excluded = await callTool(9, "memory_search", {
  session_id: started.session_id,
  query: "secret_unrelated_scope_token",
  mode: "hybrid",
  scope: "project",
  top_k: 3,
  max_chars_total: 2000
});
if (excluded.hits.some((hit) => hit.source_event_id === unrelated.event_id)) {
  throw new Error(`Project-scoped retrieval leaked unrelated project: ${JSON.stringify(excluded)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT access_count FROM chunks WHERE source_event_id = $1 ORDER BY chunk_index LIMIT 1) AS rare_access_count,
        (SELECT access_count FROM chunks WHERE source_event_id = $2 ORDER BY chunk_index LIMIT 1) AS network_access_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $3 AND purpose = 'query_embedding' AND status = 'success') AS query_embedding_calls
    `,
    [rare.event_id, network.event_id, projectId]
  );
  const row = checks.rows[0];
  if (row.rare_access_count < 1 || row.network_access_count < 1 || row.query_embedding_calls < 2) {
    throw new Error(`Retrieval access/model audit failed: ${JSON.stringify(row)}`);
  }
} finally {
  await unrelatedDb.close();
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 5 retrieval smoke passed\n");
