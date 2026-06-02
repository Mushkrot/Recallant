import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";

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
  "memory_cross_project_recall",
  "memory_report_recall_usage",
  "memory_closeout"
];

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({
  name: "recallant-smoke",
  version: "0.0.0"
});
const server = createRecallantMcpServer();

let completed = false;
let runError = null;
let cleanupError = null;
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const list = await client.listTools({}, { timeout: 5_000 });
  const actualTools = new Set(list.tools?.map((tool) => tool.name) ?? []);
  const missingTools = expectedTools.filter((name) => !actualTools.has(name));
  const extraTools = [...actualTools].filter((name) => !expectedTools.includes(name));
  if (missingTools.length > 0 || extraTools.length > 0) {
    throw new Error(
      `Unexpected MCP tools: ${JSON.stringify({
        missing: missingTools,
        extra: extraTools,
        actual: [...actualTools].sort()
      })}`
    );
  }

  const searchTool = list.tools?.find((tool) => tool.name === "memory_search");
  const searchProperties = searchTool?.inputSchema?.properties ?? {};
  if (!Object.hasOwn(searchProperties, "source_id")) {
    throw new Error(`memory_search schema is missing source_id: ${JSON.stringify(searchTool)}`);
  }

  const call = await client.callTool(
    {
      name: "memory_heartbeat",
      arguments: {
        session_id: "00000000-0000-4000-8000-000000000001",
        status: "active"
      }
    },
    undefined,
    { timeout: 5_000 }
  );
  const text = call.content?.[0]?.text ?? "";
  const heartbeat = JSON.parse(text);
  if (heartbeat.tool !== "memory_heartbeat" && heartbeat.ok !== true) {
    throw new Error(`Unexpected tool call response: ${JSON.stringify(call)}`);
  }
  completed = true;
} catch (error) {
  runError = error;
}

try {
  await client.close();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!completed || !message.includes("Connection closed")) cleanupError = error;
}

try {
  await server.close();
} catch (error) {
  cleanupError ??= error;
}

if (runError) throw runError;
if (cleanupError) throw cleanupError;

process.stdout.write("MCP smoke passed\n");
