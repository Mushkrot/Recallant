import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: randomUUID(),
    RECALLANT_PROJECT_ID: randomUUID(),
    RECALLANT_PROJECT_PATH: process.cwd(),
    RECALLANT_APPEND_EVENT_TEXT_MAX_CHARS: "20",
    RECALLANT_MCP_RATE_LIMIT_PER_MINUTE: "2"
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

async function callToolRaw(id, name, args) {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return waitForResponse(id);
}

function parseToolError(response) {
  if (response.result?.isError !== true) {
    throw new Error(`Expected MCP tool error: ${JSON.stringify(response)}`);
  }
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`Missing structured error text: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-phase8-errors-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const invalidEvent = parseToolError(
  await callToolRaw(2, "memory_append_event", {
    session_id: "00000000-0000-4000-8000-000000000001",
    client_kind: "codex",
    event_kind: "other",
    text: "This workflow evidence body intentionally exceeds the configured smoke limit."
  })
);
if (
  invalidEvent.ok !== false ||
  invalidEvent.error?.code !== "VALIDATION_ERROR" ||
  invalidEvent.error?.retryable !== false ||
  invalidEvent.tool !== "memory_append_event"
) {
  throw new Error(`Structured validation error failed: ${JSON.stringify(invalidEvent)}`);
}

await callToolRaw(3, "memory_heartbeat", {
  session_id: "00000000-0000-4000-8000-000000000001",
  status: "active"
});
await callToolRaw(4, "memory_heartbeat", {
  session_id: "00000000-0000-4000-8000-000000000001",
  status: "active"
});
const limited = parseToolError(
  await callToolRaw(5, "memory_heartbeat", {
    session_id: "00000000-0000-4000-8000-000000000001",
    status: "active"
  })
);
if (
  limited.ok !== false ||
  limited.error?.code !== "RATE_LIMITED" ||
  limited.error?.retryable !== true ||
  limited.tool !== "memory_heartbeat"
) {
  throw new Error(`Structured rate-limit error failed: ${JSON.stringify(limited)}`);
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 8 structured error/rate-limit smoke passed\n");
