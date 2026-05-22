import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const expectedTools = [
  "memory_start_session",
  "memory_heartbeat",
  "memory_get_context_pack",
  "memory_append_turn",
  "memory_append_event",
  "memory_search",
  "memory_fetch_chunk",
  "memory_link",
  "memory_promote",
  "memory_archive",
  "memory_forget",
  "memory_get_checkpoint",
  "memory_set_checkpoint",
  "memory_create_agent_memory",
  "memory_review_agent_memory",
  "memory_list_agent_memories",
  "memory_get_agent_memory",
  "memory_recall_agent_memories",
  "memory_report_recall_usage",
  "memory_closeout"
];

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
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

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-smoke", version: "0.0.0" }
  }
});

const init = await waitForResponse(1);
if (init.result?.serverInfo?.name !== "recallant") {
  throw new Error(`Unexpected server name: ${JSON.stringify(init)}`);
}

send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

const list = await waitForResponse(2);
const actualTools = new Set(list.result?.tools?.map((tool) => tool.name) ?? []);
const missingTools = expectedTools.filter((name) => !actualTools.has(name));
if (missingTools.length > 0) {
  throw new Error(`Missing MCP tools: ${missingTools.join(", ")}`);
}

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "memory_heartbeat",
    arguments: {
      session_id: "00000000-0000-4000-8000-000000000001",
      status: "active"
    }
  }
});

const call = await waitForResponse(3);
const text = call.result?.content?.[0]?.text ?? "";
const heartbeat = JSON.parse(text);
if (heartbeat.tool !== "memory_heartbeat" && heartbeat.ok !== true) {
  throw new Error(`Unexpected tool call response: ${JSON.stringify(call)}`);
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("MCP smoke passed\n");
