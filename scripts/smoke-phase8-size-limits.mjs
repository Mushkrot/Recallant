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
const projectPath = await mkdtemp(join(tmpdir(), "recallant-phase8-limits-"));

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_PATH: projectPath,
    RECALLANT_APPEND_TURN_MAX_CHARS: "64",
    RECALLANT_APPEND_EVENT_TEXT_MAX_CHARS: "64",
    RECALLANT_RAW_ARTIFACT_EXCERPT_MAX_CHARS: "32"
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

function assertValidationError(response, label) {
  const text = response.error?.message ?? response.result?.content?.[0]?.text ?? "";
  if (response.result?.isError !== true || !text.includes("VALIDATION_ERROR")) {
    throw new Error(`${label} did not return VALIDATION_ERROR: ${JSON.stringify(response)}`);
  }
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-phase8-size-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectPath,
  session_label: "phase8-size-smoke",
  resume_policy: "normal"
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const sessionProject = await client.query("SELECT project_id FROM sessions WHERE id = $1", [
  started.session_id
]);
const sessionProjectId = sessionProject.rows[0]?.project_id;
if (!sessionProjectId) throw new Error("Phase 8 limits session project was not persisted");
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
      model: "deterministic-phase8-limits",
      dims: 768
    })
  ]
);

async function counts() {
  const result = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE project_id = $1) AS events,
        (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1) AS raw_artifacts,
        (SELECT count(*)::int FROM ingest_dedup_keys WHERE project_id = $1) AS dedup_keys
    `,
    [sessionProjectId]
  );
  return result.rows[0];
}

try {
  const before = await counts();
  assertValidationError(
    await callToolRaw(3, "memory_append_turn", {
      session_id: started.session_id,
      client_kind: "codex",
      role: "user",
      text: "T".repeat(65),
      dedup_key: `too-large-turn-${randomUUID()}`
    }),
    "turn size limit"
  );
  const afterTurn = await counts();
  assertValidationError(
    await callToolRaw(4, "memory_append_event", {
      session_id: started.session_id,
      client_kind: "codex",
      event_kind: "terminal_output",
      text: "E".repeat(65),
      metadata: {},
      raw_artifacts: [],
      dedup_key: `too-large-event-${randomUUID()}`
    }),
    "event text size limit"
  );
  const afterEvent = await counts();
  assertValidationError(
    await callToolRaw(5, "memory_append_event", {
      session_id: started.session_id,
      client_kind: "codex",
      event_kind: "terminal_output",
      text: "short",
      metadata: {},
      raw_artifacts: [
        {
          artifact_kind: "terminal_output",
          storage_backend: "external",
          uri: "smoke://oversize-excerpt",
          sha256: "1".repeat(64),
          size_bytes: 1024,
          content_type: "text/plain",
          excerpt: "X".repeat(33),
          metadata: {}
        }
      ],
      dedup_key: `too-large-artifact-${randomUUID()}`
    }),
    "raw artifact excerpt size limit"
  );
  const afterArtifact = await counts();

  if (
    JSON.stringify(before) !== JSON.stringify(afterTurn) ||
    JSON.stringify(before) !== JSON.stringify(afterEvent) ||
    JSON.stringify(before) !== JSON.stringify(afterArtifact)
  ) {
    throw new Error(
      `Validation failures wrote DB rows: ${JSON.stringify({
        before,
        afterTurn,
        afterEvent,
        afterArtifact
      })}`
    );
  }

  const hugeArtifact = await callTool(6, "memory_append_event", {
    session_id: started.session_id,
    client_kind: "codex",
    event_kind: "tool_result",
    text: "huge_raw_artifact_token stored as pointer",
    metadata: { original_chars: 1_000_000 },
    raw_artifacts: [
      {
        artifact_kind: "tool_output",
        storage_backend: "external",
        uri: "smoke://huge-raw-artifact",
        sha256: "2".repeat(64),
        size_bytes: 1_000_000,
        content_type: "text/plain",
        excerpt: "huge artifact bounded excerpt",
        metadata: { original_chars: 1_000_000 }
      }
    ],
    dedup_key: `huge-raw-artifact-${randomUUID()}`
  });
  const hugeCounts = await client.query(
    "SELECT size_bytes::int, length(excerpt) AS excerpt_chars FROM raw_artifacts WHERE source_event_id = $1",
    [hugeArtifact.event_id]
  );
  const hugeRow = hugeCounts.rows[0];
  const boundedSearch = await callTool(7, "memory_search", {
    session_id: started.session_id,
    query: "huge_raw_artifact_token",
    mode: "lexical_only",
    top_k: 3,
    max_chars_total: 48
  });
  const boundedChars = boundedSearch.hits.reduce(
    (total, hit) => total + (hit.text_excerpt?.length ?? hit.excerpt?.length ?? 0),
    0
  );
  if (
    hugeArtifact.status !== "created" ||
    hugeRow?.size_bytes !== 1_000_000 ||
    hugeRow?.excerpt_chars > 32 ||
    boundedSearch.hits.length === 0 ||
    boundedChars > 48 ||
    JSON.stringify(boundedSearch).length > 5000
  ) {
    throw new Error(
      `Huge raw artifact bounded response failed: ${JSON.stringify({
        hugeArtifact,
        hugeRow,
        boundedSearch,
        boundedChars
      })}`
    );
  }
} finally {
  await client.end();
  child.stdin.end();
  child.kill();
  await once(child, "close");
}

process.stdout.write("Phase 8 size-limit smoke passed\n");
