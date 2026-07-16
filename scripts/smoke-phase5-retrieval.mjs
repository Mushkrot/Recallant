import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecallantDb } from "@recallant/db";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";
import pg from "pg";

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "recallant_dev_password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();

const developerId = randomUUID();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-phase5-retrieval-"));

async function assertCliMcpServerLifecycle() {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_PATH: projectPath
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  let exit = null;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (exit) {
    throw new Error(
      `CLI mcp-server exited before client close: ${JSON.stringify({ exit, stderr })}`
    );
  }
  child.kill();
  await once(child, "close");
  return { alive_for_ms: 800, stopped_by_test: true };
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const mcpEnvKeys = [
  "RECALLANT_DATABASE_URL",
  "RECALLANT_DEVELOPER_ID",
  "RECALLANT_PROJECT_ID",
  "RECALLANT_PROJECT_PATH"
];
const mcpEnvSnapshot = snapshotEnv(mcpEnvKeys);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
delete process.env.RECALLANT_PROJECT_ID;
process.env.RECALLANT_PROJECT_PATH = projectPath;

await assertCliMcpServerLifecycle();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({
  name: "recallant-phase5-smoke",
  version: "0.0.0"
});
const mcpDb = new RecallantDb({ databaseUrl, developerId, projectPath });
const mcpServer = createRecallantMcpServer({
  developerId,
  projectPath,
  getDatabase: () => mcpDb
});
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

async function callTool(id, name, args) {
  const response = await mcpClient.callTool({ name, arguments: args }, undefined, {
    timeout: 5_000
  });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(String(text));
}

/*
Use SDK in-memory transport for deterministic tool calls. The CLI mcp-server lifecycle remains
covered above without depending on this runner's unreliable child-stdin behavior.
*/

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectPath,
  session_label: "phase5-smoke",
  resume_policy: "normal"
});
const sessionProject = await client.query("SELECT project_id FROM sessions WHERE id = $1", [
  started.session_id
]);
const sessionProjectId = sessionProject.rows[0]?.project_id;
if (!sessionProjectId) throw new Error("Phase 5 session project was not persisted");

await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase5 deterministic retrieval smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    sessionProjectId,
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
const scopedDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: sessionProjectId,
  projectPath
});
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

const scopedImports = [
  {
    token: "environment_scope_exclusion_token",
    scope_kind: "environment",
    scope_id: "server:other-instance",
    audience: [{ kind: "context_pack", id: null }],
    result_class: "environment_fact"
  },
  {
    token: "client_adapter_scope_exclusion_token",
    scope_kind: "client_adapter",
    scope_id: "claude_code",
    audience: [{ kind: "specific_client", id: "claude_code" }],
    result_class: "startup_instruction"
  },
  {
    token: "connector_scope_exclusion_token",
    scope_kind: "connector_account",
    scope_id: "google-drive:personal",
    audience: [{ kind: "connector", id: "google-drive" }],
    result_class: "connector_account_binding"
  }
];
const scopedResults = new Map();
for (const scopedImport of scopedImports) {
  const result = await scopedDb.importSource({
    project_path: projectPath,
    source_path: `phase5/${scopedImport.scope_kind}.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${scopedImport.token} is a deliberately unrelated scoped retrieval fixture.`,
    bounded_excerpt: scopedImport.token,
    result_class: scopedImport.result_class,
    scope_kind: scopedImport.scope_kind,
    scope_id: scopedImport.scope_id,
    audience: scopedImport.audience,
    risk: "low",
    risks: [],
    secret_references: []
  });
  scopedResults.set(scopedImport.token, result);
}

const sourceFilteredA = await scopedDb.attachProjectSource({
  project_id: sessionProjectId,
  source_kind: "document_collection",
  label: "Raw Search Source A",
  uri: "docs/raw-search-source-a.md",
  metadata: { source_path: "docs/raw-search-source-a.md" }
});
const sourceFilteredB = await scopedDb.attachProjectSource({
  project_id: sessionProjectId,
  source_kind: "document_collection",
  label: "Raw Search Source B",
  uri: "docs/raw-search-source-b.md",
  metadata: { source_path: "docs/raw-search-source-b.md" }
});
if (!sourceFilteredA?.id || !sourceFilteredB?.id) {
  throw new Error(
    `Source-filter fixtures failed: ${JSON.stringify({ sourceFilteredA, sourceFilteredB })}`
  );
}
const sourceAImport = await scopedDb.importSource({
  project_path: projectPath,
  source_path: "docs/raw-search-source-a.md",
  source_type: "smoke_fixture",
  source_sha256: randomUUID(),
  import_text: "source_filter_shared_raw_token belongs to source A only.",
  bounded_excerpt: "source_filter_shared_raw_token source A",
  result_class: "environment_fact",
  scope_kind: "project",
  scope_id: sessionProjectId,
  audience: [{ kind: "all_agents", id: null }],
  risk: "low",
  risks: [],
  secret_references: [],
  metadata: { project_source_id: sourceFilteredA.id }
});
const sourceBImport = await scopedDb.importSource({
  project_path: projectPath,
  source_path: "docs/raw-search-source-b.md",
  source_type: "smoke_fixture",
  source_sha256: randomUUID(),
  import_text: "source_filter_shared_raw_token belongs to source B only.",
  bounded_excerpt: "source_filter_shared_raw_token source B",
  result_class: "environment_fact",
  scope_kind: "project",
  scope_id: sessionProjectId,
  audience: [{ kind: "all_agents", id: null }],
  risk: "low",
  risks: [],
  secret_references: [],
  metadata: { project_source_id: sourceFilteredB.id }
});
await callTool(50, "memory_link", {
  src_kind: "chunk",
  src_id: sourceAImport.chunk_ids[0],
  dst_kind: "chunk",
  dst_id: sourceBImport.chunk_ids[0],
  relation_type: "related",
  weight: 1,
  metadata: { smoke: "source-filter-graph-guard" }
});
const sourceFilteredRaw = await callTool(51, "memory_search", {
  session_id: started.session_id,
  source_id: sourceFilteredA.id,
  query: "source_filter_shared_raw_token",
  mode: "lexical_only",
  top_k: 5,
  graph_expand: true,
  graph_budget_nodes: 4,
  max_chars_total: 2000
});
if (
  sourceFilteredRaw.source_filter?.source_id !== sourceFilteredA.id ||
  !sourceFilteredRaw.hits.some((hit) => hit.source_event_id === sourceAImport.event_id) ||
  sourceFilteredRaw.hits.some((hit) => hit.source_event_id === sourceBImport.event_id) ||
  !sourceFilteredRaw.hits.some(
    (hit) => hit.provenance?.source_path === "docs/raw-search-source-a.md"
  )
) {
  throw new Error(`Source-filtered raw search failed: ${JSON.stringify(sourceFilteredRaw)}`);
}

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

for (const [index, scopedImport] of scopedImports.entries()) {
  const hiddenByDefault = await callTool(10 + index * 2, "memory_search", {
    session_id: started.session_id,
    query: scopedImport.token,
    mode: "lexical_only",
    top_k: 5,
    max_chars_total: 2000
  });
  if (hiddenByDefault.hits.length !== 0) {
    throw new Error(
      `Default retrieval leaked ${scopedImport.scope_kind}/${scopedImport.audience[0].kind}: ${JSON.stringify(hiddenByDefault)}`
    );
  }

  const explicitScoped = await callTool(11 + index * 2, "memory_search", {
    session_id: started.session_id,
    query: scopedImport.token,
    mode: "lexical_only",
    scope_kind: scopedImport.scope_kind,
    audience: scopedImport.audience[0].kind,
    top_k: 5,
    max_chars_total: 2000
  });
  const imported = scopedResults.get(scopedImport.token);
  if (!explicitScoped.hits.some((hit) => imported.chunk_ids.includes(hit.chunk_id))) {
    throw new Error(
      `Explicit ${scopedImport.scope_kind}/${scopedImport.audience[0].kind} retrieval failed: ${JSON.stringify(explicitScoped)}`
    );
  }
}

const broad = await callTool(20, "memory_search", {
  session_id: started.session_id,
  query: "project",
  mode: "hybrid",
  top_k: 8,
  max_chars_total: 2000
});
if (
  broad.rejected !== true ||
  broad.error_code !== "BROAD_STARTUP_QUERY" ||
  !broad.warnings?.some((warning) => warning.includes("memory_get_context_pack")) ||
  broad.hits.length !== 0
) {
  throw new Error(`Broad startup query was not rejected: ${JSON.stringify(broad)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT access_count FROM chunks WHERE source_event_id = $1 ORDER BY chunk_index LIMIT 1) AS rare_access_count,
        (SELECT access_count FROM chunks WHERE source_event_id = $2 ORDER BY chunk_index LIMIT 1) AS network_access_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $3 AND purpose = 'query_embedding' AND status = 'success') AS query_embedding_calls
    `,
    [rare.event_id, network.event_id, sessionProjectId]
  );
  const row = checks.rows[0];
  if (row.rare_access_count < 1 || row.network_access_count < 1 || row.query_embedding_calls < 2) {
    throw new Error(`Retrieval access/model audit failed: ${JSON.stringify(row)}`);
  }
} finally {
  await scopedDb.close();
  await unrelatedDb.close();
  await client.end();
}

await mcpClient.close().catch(() => undefined);
await mcpServer.close().catch(() => undefined);
await mcpDb.close();
restoreEnv(mcpEnvSnapshot);

process.stdout.write("Phase 5 retrieval smoke passed\n");
