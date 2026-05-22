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
    RECALLANT_PROJECT_PATH: process.cwd(),
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
  project_path: process.cwd(),
  session_label: "phase8-size-smoke",
  resume_policy: "normal"
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function counts() {
  const result = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE project_id = $1) AS events,
        (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1) AS raw_artifacts,
        (SELECT count(*)::int FROM ingest_dedup_keys WHERE project_id = $1) AS dedup_keys
    `,
    [projectId]
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
} finally {
  await client.end();
  child.stdin.end();
  child.kill();
  await once(child, "close");
}

process.stdout.write("Phase 8 size-limit smoke passed\n");
