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
const projectPath = await mkdtemp(join(tmpdir(), "recallant-phase9-archive-"));

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
    clientInfo: { name: "recallant-phase9-archive-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectPath,
  session_label: "phase9-archive-smoke",
  resume_policy: "normal"
});
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO developer_settings (developer_id, key, value, updated_by)
    VALUES ($1, 'embedding_route', $2, 'smoke')
    ON CONFLICT (developer_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    developerId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-phase9-archive",
      dims: 768
    })
  ]
);

const token = `archive_unique_token_${randomUUID().replaceAll("-", "_")}`;
const appended = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: `Phase 9 archive smoke searchable chunk ${token}.`,
  dedup_key: `phase9-archive-${randomUUID()}`
});
const chunkId = appended.chunk_ids[0];

const before = await callTool(4, "memory_search", {
  session_id: started.session_id,
  query: token,
  mode: "lexical_only",
  top_k: 3,
  max_chars_total: 1000
});
if (!before.hits.some((hit) => hit.chunk_id === chunkId)) {
  throw new Error(`Chunk missing before archive: ${JSON.stringify(before)}`);
}

const archived = await callTool(5, "memory_archive", {
  chunk_id: chunkId,
  action: "archive"
});
if (archived.ok !== true || !archived.archived_at) {
  throw new Error(`Archive failed: ${JSON.stringify(archived)}`);
}

const excluded = await callTool(6, "memory_search", {
  session_id: started.session_id,
  query: token,
  mode: "lexical_only",
  top_k: 3,
  max_chars_total: 1000
});
if (excluded.hits.some((hit) => hit.chunk_id === chunkId)) {
  throw new Error(`Archived chunk appeared in ordinary search: ${JSON.stringify(excluded)}`);
}

const included = await callTool(7, "memory_search", {
  session_id: started.session_id,
  query: token,
  mode: "lexical_only",
  top_k: 3,
  max_chars_total: 1000,
  include_archived: true
});
if (!included.hits.some((hit) => hit.chunk_id === chunkId)) {
  throw new Error(`Archived chunk missing with include_archived=true: ${JSON.stringify(included)}`);
}

const unarchived = await callTool(8, "memory_archive", {
  chunk_id: chunkId,
  action: "unarchive"
});
if (unarchived.ok !== true || unarchived.archived_at !== null) {
  throw new Error(`Unarchive failed: ${JSON.stringify(unarchived)}`);
}

const restored = await callTool(9, "memory_search", {
  session_id: started.session_id,
  query: token,
  mode: "lexical_only",
  top_k: 3,
  max_chars_total: 1000
});
if (!restored.hits.some((hit) => hit.chunk_id === chunkId)) {
  throw new Error(`Unarchived chunk missing from ordinary search: ${JSON.stringify(restored)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE id = $1) AS event_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS raw_artifact_count
    `,
    [appended.event_id]
  );
  const row = checks.rows[0];
  if (row.event_count !== 1 || row.raw_artifact_count !== 0) {
    throw new Error(`Archive touched L0/raw artifact records: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
  child.stdin.end();
  child.kill();
  await once(child, "close");
}

process.stdout.write("Phase 9 archive smoke passed\n");
