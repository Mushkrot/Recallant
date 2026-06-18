import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";

const originalDatabaseUrl = process.env.RECALLANT_DATABASE_URL;
delete process.env.RECALLANT_DATABASE_URL;

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
let contextPosture = null;
let contextCanon = null;
let contextSectionKeys = [];
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
  const contextCall = await client.callTool(
    {
      name: "memory_get_context_pack",
      arguments: {
        session_id: "00000000-0000-4000-8000-000000000002",
        project_id: "00000000-0000-4000-8000-000000000003",
        task_hint: "stub documentation posture"
      }
    },
    undefined,
    { timeout: 5_000 }
  );
  const contextText = contextCall.content?.[0]?.text ?? "";
  const contextPack = JSON.parse(contextText);
  const expectedSectionKeys = [
    "checkpoint",
    "documentation_posture",
    "canon_capability_context",
    "recovery",
    "binding_rules",
    "working_memories",
    "operational_bindings",
    "local_spool_status",
    "evidence_excerpts",
    "suggested_next_fetches"
  ];
  contextSectionKeys = Object.keys(contextPack.sections ?? {});
  const missingSections = expectedSectionKeys.filter(
    (section) => !Object.hasOwn(contextPack.sections ?? {}, section)
  );
  if (missingSections.length > 0) {
    throw new Error(
      `MCP stub context pack missing sections: ${JSON.stringify({
        missing: missingSections,
        actual: contextSectionKeys
      })}`
    );
  }
  contextPosture = contextPack.sections?.documentation_posture ?? null;
  if (
    contextPosture?.status !== "not_recorded" ||
    contextPosture?.authority?.key !== "documentation_posture" ||
    contextPosture?.authority?.instruction_grade !== false
  ) {
    throw new Error(`MCP stub context pack missing safe posture: ${JSON.stringify(contextPack)}`);
  }
  contextCanon = contextPack.sections?.canon_capability_context ?? null;
  const canonCategories = [
    "environment_facts",
    "capability_references",
    "secret_references",
    "server_canon_links",
    "documentation_authority_map"
  ];
  const missingCanonCategories = canonCategories.filter(
    (category) => !Array.isArray(contextCanon?.[category])
  );
  if (
    contextCanon?.schema_version !== 1 ||
    contextCanon?.authority?.instruction_grade !== false ||
    missingCanonCategories.length > 0
  ) {
    throw new Error(
      `MCP stub context pack missing safe canon/capability section: ${JSON.stringify({
        missingCanonCategories,
        contextCanon
      })}`
    );
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

if (originalDatabaseUrl !== undefined) process.env.RECALLANT_DATABASE_URL = originalDatabaseUrl;

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      documentation_posture_stub: {
        status: contextPosture?.status,
        authority_key: contextPosture?.authority?.key,
        instruction_grade: contextPosture?.authority?.instruction_grade
      },
      canon_capability_context_stub: {
        status: contextCanon?.status,
        categories: {
          environment_facts: contextCanon?.environment_facts?.length,
          capability_references: contextCanon?.capability_references?.length,
          secret_references: contextCanon?.secret_references?.length,
          server_canon_links: contextCanon?.server_canon_links?.map((item) => item.kind),
          documentation_authority_map: contextCanon?.documentation_authority_map?.length
        },
        instruction_grade: contextCanon?.authority?.instruction_grade
      },
      context_section_keys: {
        has_required_sections: true,
        count: contextSectionKeys.length
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("MCP smoke passed\n");
