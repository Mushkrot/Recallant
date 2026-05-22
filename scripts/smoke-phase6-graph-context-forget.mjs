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
    clientInfo: { name: "recallant-phase6-graph-context-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "phase6-graph-context-smoke",
  resume_policy: "normal"
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase6 deterministic graph smoke', 'smoke')
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

await callTool(3, "memory_set_checkpoint", {
  payload: {
    current_status: "phase6 graph context smoke",
    current_focus: "context pack",
    next_step: "verify graph and forget",
    open_questions: []
  }
});

const alpha = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "alpha_anchor graph seed chunk",
  dedup_key: `phase6-alpha-${randomUUID()}`
});
const beta = await callTool(5, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "beta_neighbor graph expanded chunk",
  dedup_key: `phase6-beta-${randomUUID()}`
});

await callTool(6, "memory_link", {
  src_kind: "chunk",
  src_id: alpha.chunk_ids[0],
  dst_kind: "chunk",
  dst_id: beta.chunk_ids[0],
  relation_type: "related",
  weight: 1,
  metadata: { smoke: true }
});

const graph = await callTool(7, "memory_search", {
  session_id: started.session_id,
  query: "alpha_anchor",
  mode: "lexical_only",
  top_k: 1,
  graph_expand: true,
  graph_budget_nodes: 1,
  max_chars_total: 2000
});
if (
  !graph.hits.some((hit) => hit.source_event_id === alpha.event_id) ||
  !graph.hits.some((hit) => hit.source_event_id === beta.event_id && hit.why === "graph")
) {
  throw new Error(`Graph expansion failed: ${JSON.stringify(graph)}`);
}

const rule = await callTool(8, "memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Context pack smoke rule",
  body: "Context packs must separate instruction-grade binding rules from ordinary working memory.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: alpha.event_id, quote: "Context pack" }]
});
await callTool(9, "memory_review_agent_memory", {
  memory_id: rule.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "phase6 context pack smoke"
});

const pack = await callTool(10, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: "alpha context pack",
  include_raw_evidence: "always",
  include_recovery: true,
  max_chars_total: 3000
});
if (
  pack.sections?.checkpoint?.payload?.current_focus !== "context pack" ||
  !pack.sections?.binding_rules?.some((memory) => memory.memory_id === rule.memory_id) ||
  !pack.sections?.evidence_excerpts?.some((hit) => hit.source_event_id === alpha.event_id)
) {
  throw new Error(`Context pack composition failed: ${JSON.stringify(pack)}`);
}

const dryRun = await callTool(11, "memory_forget", {
  target: { kind: "chunk", id: beta.chunk_ids[0], selector: {} },
  reason: "phase6 smoke dry run",
  dry_run: true,
  confirmation: { confirmed: false }
});
if (dryRun.status !== "pending_confirmation" || dryRun.affected?.chunks !== 1) {
  throw new Error(`Forget dry run failed: ${JSON.stringify(dryRun)}`);
}

const erased = await callTool(12, "memory_forget", {
  target: { kind: "chunk", id: beta.chunk_ids[0], selector: {} },
  reason: "phase6 smoke confirmed",
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-smoke" }
});
if (erased.status !== "completed" || erased.redacted_receipt?.affected?.chunks !== 1) {
  throw new Error(`Confirmed forget failed: ${JSON.stringify(erased)}`);
}

const fetched = await callTool(13, "memory_fetch_chunk", {
  chunk_id: beta.chunk_ids[0],
  max_chars: 2000
});
if (fetched.text !== "[REDACTED]" || fetched.archived_at === null) {
  throw new Error(`Fetch after forget did not return redacted archived chunk: ${JSON.stringify(fetched)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM edges WHERE src_id = $1 AND dst_id = $2) AS edge_count,
        (SELECT count(*)::int FROM erasure_requests WHERE status = 'completed') AS erasure_count,
        (SELECT count(*)::int FROM embeddings WHERE chunk_id = $2::uuid) AS erased_embedding_count
    `,
    [alpha.chunk_ids[0], beta.chunk_ids[0]]
  );
  const row = checks.rows[0];
  if (row.edge_count !== 1 || row.erasure_count < 1 || row.erased_embedding_count !== 0) {
    throw new Error(`Graph/context/forget DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 6 graph/context/forget smoke passed\n");
