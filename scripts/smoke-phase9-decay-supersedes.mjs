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
const sessionId = randomUUID();
const oldEventId = randomUUID();
const freshEventId = randomUUID();
const oldChunkId = randomUUID();
const freshChunkId = randomUUID();
const token = `decaytoken${randomUUID().replaceAll("-", "")}`;
const sharedText = `Phase 9 decay and supersedes fixture contains ${token}.`;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("INSERT INTO developers (id, name) VALUES ($1, 'phase9 decay developer')", [
    developerId
  ]);
  await client.query(
    "INSERT INTO projects (id, developer_id, primary_path, name) VALUES ($1, $2, $3, 'phase9-decay')",
    [projectId, developerId, `/tmp/recallant-phase9-decay-${projectId}`]
  );
  await client.query(
    "INSERT INTO sessions (id, project_id, client_kind, client_version, status) VALUES ($1, $2, 'codex', 'smoke', 'active')",
    [sessionId, projectId]
  );
  await client.query(
    `
      INSERT INTO events (id, project_id, session_id, ingest_source, kind, occurred_at, payload)
      VALUES
        ($1, $3, $4, 'fixture', 'turn_user', now() - interval '120 days', $5),
        ($2, $3, $4, 'fixture', 'turn_user', now(), $6)
    `,
    [
      oldEventId,
      freshEventId,
      projectId,
      sessionId,
      JSON.stringify({ text: sharedText, age: "old" }),
      JSON.stringify({ text: sharedText, age: "fresh" })
    ]
  );
  await client.query(
    `
      INSERT INTO chunks (id, project_id, developer_id, source_event_id, text, chunk_index, token_count_est, scope)
      VALUES
        ($1, $3, $4, $5, $7, 0, 20, 'project'),
        ($2, $3, $4, $6, $7, 0, 20, 'project')
    `,
    [oldChunkId, freshChunkId, projectId, developerId, oldEventId, freshEventId, sharedText]
  );
} finally {
  await client.end();
}

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
    RECALLANT_PROJECT_PATH: process.cwd(),
    RECALLANT_DECAY_HALFLIFE_DAYS: "1",
    RECALLANT_DECAY_MIN: "0.01",
    RECALLANT_SUPERSEDES_SCORE_MULTIPLIER: "0.1"
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

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "recallant-phase9-decay-smoke", version: "0.0.0" }
    }
  });
  await waitForResponse(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const beforeSupersedes = await callTool(2, "memory_search", {
    session_id: sessionId,
    query: token,
    mode: "lexical_only",
    top_k: 5,
    max_chars_total: 2000
  });
  const fresh = beforeSupersedes.hits.find((hit) => hit.chunk_id === freshChunkId);
  const old = beforeSupersedes.hits.find((hit) => hit.chunk_id === oldChunkId);
  if (!fresh || !old || !(fresh.score > old.score)) {
    throw new Error(`Decay did not rank fresh chunk higher: ${JSON.stringify(beforeSupersedes)}`);
  }

  await callTool(3, "memory_link", {
    src_kind: "chunk",
    src_id: freshChunkId,
    dst_kind: "chunk",
    dst_id: oldChunkId,
    relation_type: "supersedes",
    weight: 1,
    metadata: { smoke: true }
  });

  const afterSupersedes = await callTool(4, "memory_search", {
    session_id: sessionId,
    query: token,
    mode: "lexical_only",
    top_k: 5,
    max_chars_total: 2000
  });
  const supersededOld = afterSupersedes.hits.find((hit) => hit.chunk_id === oldChunkId);
  if (
    !supersededOld ||
    supersededOld.superseded_by !== freshChunkId ||
    !supersededOld.path.includes("superseded") ||
    !(supersededOld.score < old.score)
  ) {
    throw new Error(
      `Supersedes penalty failed: ${JSON.stringify({ beforeSupersedes, afterSupersedes })}`
    );
  }
} finally {
  child.stdin.end();
  child.kill();
  await once(child, "close");
}

process.stdout.write("Phase 9 decay/supersedes smoke passed\n");
