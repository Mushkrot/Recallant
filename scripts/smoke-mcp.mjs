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
  "memory_agent_checkpoint",
  "memory_create_agent_memory",
  "memory_review_agent_memory",
  "memory_list_agent_memories",
  "memory_get_agent_memory",
  "memory_recall_agent_memories",
  "memory_cross_project_recall",
  "memory_report_recall_usage",
  "memory_closeout"
];

const safeSemanticMarker = "recallant_safe_semantic_marker_example";
const validationSecretFixture = "sk-phase6-local-validation-secret";
const forbiddenOutputFixtures = [
  validationSecretFixture,
  "postgres://phase6:secret@example.invalid/recallant",
  "BEGIN PRIVATE KEY",
  "customer@example.invalid"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} missing marker: ${marker}`);
  }
}

function mustNotContain(text, markers, label) {
  for (const marker of markers) {
    assert(!text.includes(marker), `${label} leaked forbidden fixture: ${marker}`);
  }
}

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
let stateOnly = null;
let highLevelCheckpoint = null;
let governedMemoryToolsListExcerpt = null;
let governedMemoryValidationErrors = {};
let governedMemoryExamples = {};
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

  const agentCheckpointTool = list.tools?.find((tool) => tool.name === "memory_agent_checkpoint");
  const agentCheckpointProperties = agentCheckpointTool?.inputSchema?.properties ?? {};
  for (const property of ["session_id", "client_kind", "project_id", "project_path", "payload"]) {
    if (!Object.hasOwn(agentCheckpointProperties, property)) {
      throw new Error(
        `memory_agent_checkpoint schema is missing ${property}: ${JSON.stringify(
          agentCheckpointTool
        )}`
      );
    }
  }

  const createMemoryTool = list.tools?.find((tool) => tool.name === "memory_create_agent_memory");
  const recallMemoryTool = list.tools?.find((tool) => tool.name === "memory_recall_agent_memories");
  assert(createMemoryTool, "tools/list missing memory_create_agent_memory");
  assert(recallMemoryTool, "tools/list missing memory_recall_agent_memories");
  const createProperties = createMemoryTool.inputSchema?.properties ?? {};
  const recallProperties = recallMemoryTool.inputSchema?.properties ?? {};
  const createToolExcerptText = JSON.stringify(
    {
      description: createMemoryTool.description,
      properties: {
        title: createProperties.title,
        body: createProperties.body,
        created_by: createProperties.created_by,
        audience: createProperties.audience
      }
    },
    null,
    2
  );
  mustInclude(
    createToolExcerptText,
    [
      "Required fields",
      "all_agents",
      "id",
      "title",
      "body",
      "created_by",
      "audience",
      "Safe semantic marker example",
      safeSemanticMarker,
      "raw secrets",
      "credentials",
      "customer data",
      "private keys",
      "backups",
      "raw artifacts",
      "large logs"
    ],
    "memory_create_agent_memory tools/list excerpt"
  );
  mustInclude(
    JSON.stringify(recallMemoryTool),
    ["Safe recall query example", safeSemanticMarker, "memory_types", "work_log"],
    "memory_recall_agent_memories tools/list excerpt"
  );
  mustInclude(
    JSON.stringify(recallProperties.query ?? {}),
    ["marker", "synthetic"],
    "memory_recall_agent_memories query schema"
  );
  governedMemoryToolsListExcerpt = {
    name: createMemoryTool.name,
    description: createMemoryTool.description,
    required: createMemoryTool.inputSchema?.required ?? [],
    properties: {
      title: createProperties.title,
      body: createProperties.body,
      created_by: createProperties.created_by,
      audience: createProperties.audience
    }
  };
  governedMemoryExamples = {
    safe_marker_memory: {
      memory_type: "work_log",
      scope: "project",
      audience: [{ kind: "all_agents", id: null }],
      title: "Safe Recallant semantic marker",
      body: `Synthetic non-secret marker ${safeSemanticMarker} for create+recall proof.`,
      confidence: 1,
      source_refs: [],
      created_by: "agent",
      metadata: { diagnostic_marker: true, contains_raw_secret: false }
    },
    safe_recall_query: {
      query: safeSemanticMarker,
      scope: "project",
      memory_types: ["work_log"],
      include_candidates: true,
      include_needs_review: true,
      top_k: 5,
      max_chars_total: 4000
    }
  };

  async function expectCreateMemoryValidationError(label, args, markers) {
    let sawValidationError = false;
    let output = "";
    try {
      const result = await client.callTool(
        {
          name: "memory_create_agent_memory",
          arguments: args
        },
        undefined,
        { timeout: 5_000 }
      );
      output = JSON.stringify(result);
      sawValidationError = Boolean(result.isError);
    } catch (error) {
      sawValidationError = true;
      output = error instanceof Error ? error.message : String(error);
    }
    assert(sawValidationError, `${label} should have failed validation`);
    mustInclude(output, markers, label);
    mustNotContain(output, forbiddenOutputFixtures, label);
    return output.slice(0, 1000);
  }

  const validCreateMemoryArgs = {
    memory_type: "work_log",
    scope: "project",
    scope_kind: "project",
    scope_id: null,
    audience: [{ kind: "all_agents", id: null }],
    title: "Safe local MCP schema UX marker",
    body: `Synthetic non-secret marker ${safeSemanticMarker}. ${validationSecretFixture}`,
    confidence: 1,
    source_refs: [],
    created_by: "agent",
    metadata: { smoke: true }
  };
  governedMemoryValidationErrors = {
    wrong_audience: await expectCreateMemoryValidationError(
      "wrong audience validation",
      { ...validCreateMemoryArgs, audience: "all_agents" },
      ["audience", "array of objects", "all_agents", "id"]
    ),
    missing_title: await expectCreateMemoryValidationError(
      "missing title validation",
      { ...validCreateMemoryArgs, title: undefined },
      ["title", "required", "short non-secret"]
    ),
    missing_body: await expectCreateMemoryValidationError(
      "missing body validation",
      { ...validCreateMemoryArgs, body: undefined },
      ["body", "required", "raw secrets"]
    )
  };

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

  const stateOnlyCall = await client.callTool(
    {
      name: "memory_set_checkpoint",
      arguments: {
        payload: {
          current_status: "stub checkpoint state",
          current_focus: "phase4 state-only proof",
          next_step: "call memory_agent_checkpoint for searchable checkpoint memory"
        }
      }
    },
    undefined,
    { timeout: 5_000 }
  );
  stateOnly = JSON.parse(stateOnlyCall.content?.[0]?.text ?? "{}");
  if (
    stateOnly.checkpoint_state_only !== true ||
    stateOnly.searchable_memory_created !== false ||
    stateOnly.memory_id !== null
  ) {
    throw new Error(
      `memory_set_checkpoint did not report state-only output: ${JSON.stringify(stateOnly)}`
    );
  }

  const highLevelCheckpointCall = await client.callTool(
    {
      name: "memory_agent_checkpoint",
      arguments: {
        payload: {
          current_status: "stub checkpoint closeout",
          current_focus: "phase4 searchable checkpoint proof",
          next_step: "recall checkpoint memory by focus text"
        }
      }
    },
    undefined,
    { timeout: 5_000 }
  );
  highLevelCheckpoint = JSON.parse(highLevelCheckpointCall.content?.[0]?.text ?? "{}");
  if (
    highLevelCheckpoint.searchable_memory_created !== true ||
    highLevelCheckpoint.checkpoint_state_only !== false ||
    highLevelCheckpoint.memory?.memory_type !== "checkpoint"
  ) {
    throw new Error(
      `memory_agent_checkpoint did not report searchable checkpoint memory: ${JSON.stringify(
        highLevelCheckpoint
      )}`
    );
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
      },
      checkpoint_parity_stub: {
        memory_set_checkpoint_state_only: stateOnly.checkpoint_state_only,
        memory_agent_checkpoint_searchable: highLevelCheckpoint.searchable_memory_created,
        high_level_memory_type: highLevelCheckpoint.memory?.memory_type
      },
      governed_memory_schema_ux: {
        tools_list_excerpt: governedMemoryToolsListExcerpt,
        invalid_call_errors: governedMemoryValidationErrors,
        safe_examples: governedMemoryExamples,
        forbidden_secret_values_leaked: false
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("MCP smoke passed\n");
