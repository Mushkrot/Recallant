import { readFile } from "node:fs/promises";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(path, "utf8");
}

function mustInclude(text, marker, label) {
  assert(text.includes(marker), `${label} missing marker: ${marker}`);
}

function mustNotContain(text, forbidden, label) {
  assert(!text.includes(forbidden), `${label} must not contain: ${forbidden}`);
}

const {
  remoteMcpEndpointPath,
  remoteMcpHeaders,
  remoteMcpErrorCodes,
  remoteMcpRequiredHeaders,
  remoteMcpOptionalHeaders,
  remoteMcpTransport,
  remoteMcpRateLimits,
  remoteMcpPayloadLimits,
  remoteMcpAuthSchemes,
  remoteMcpForbiddenSurfaces
} = await import("../packages/contracts/dist/index.js");

const mcpSpec = await read("docs/MCP_SPEC.md");
const primaryMcpSpecMarkers = [
  "first authenticated `POST /api/mcp` JSON-RPC endpoint slice",
  remoteMcpEndpointPath,
  "Local stdio MCP",
  "Remote clients must not receive RECALLANT_DATABASE_URL",
  remoteMcpTransport,
  "Rate Limits And Payload Size"
];
for (const marker of primaryMcpSpecMarkers) {
  mustInclude(mcpSpec, marker, "docs/MCP_SPEC.md");
}

const remoteClientSection = await read("docs/CLIENT_SETUP.md");
for (const marker of [
  "Remote Project Access",
  "first authenticated `POST /api/mcp`",
  remoteMcpEndpointPath,
  "local MCP stdio"
]) {
  mustInclude(remoteClientSection, marker, "docs/CLIENT_SETUP.md");
}

const architecture = await read("docs/ARCHITECTURE.md");
for (const marker of [
  remoteMcpEndpointPath,
  "Protected public Workbench access is a human management path",
  "default agent path remains local stdio MCP"
]) {
  mustInclude(architecture, marker, "docs/ARCHITECTURE.md");
}

const contractStatus = await read("docs/CONTRACT_STATUS.md");
for (const marker of [
  "Working endpoint, scoped credential, provisioning UX, stdio-to-HTTPS bridge, CLI-first diagnostics",
  "Remote project access to a central server",
  "remote-mcp-contract:smoke",
  "remote-mcp-provisioning:smoke",
  "remote-mcp-bridge:smoke",
  "remote-mcp-doctor:smoke"
]) {
  mustInclude(contractStatus, marker, "docs/CONTRACT_STATUS.md");
}

const roadmap = await read("docs/ROADMAP.md");
for (const marker of [
  "Remote project access to a central Recallant server",
  "first authenticated `POST /api/mcp`"
]) {
  mustInclude(roadmap, marker, "docs/ROADMAP.md");
}

mustInclude(mcpSpec, [remoteMcpEndpointPath], "docs/MCP_SPEC.md endpoint");
for (const header of remoteMcpRequiredHeaders) {
  mustInclude(mcpSpec, header, "docs/MCP_SPEC.md required header");
}
for (const header of remoteMcpOptionalHeaders) {
  mustInclude(mcpSpec, header, "docs/MCP_SPEC.md optional header");
}
for (const errorCode of Object.keys(remoteMcpErrorCodes)) {
  mustInclude(mcpSpec, errorCode, `docs/MCP_SPEC.md contract error ${errorCode}`);
}
mustInclude(
  mcpSpec,
  String(remoteMcpRateLimits.startupPerMinute),
  "docs/MCP_SPEC.md startup rate limit"
);
mustInclude(mcpSpec, String(remoteMcpRateLimits.toolPerMinute), "docs/MCP_SPEC.md tool rate limit");
mustInclude(
  mcpSpec,
  String(remoteMcpPayloadLimits.requestHardBytes),
  "docs/MCP_SPEC.md request hard payload limit"
);

for (const scheme of remoteMcpAuthSchemes) {
  mustInclude(mcpSpec, scheme, "docs/MCP_SPEC.md auth scheme");
}
mustInclude(
  mcpSpec,
  "No unauthenticated public route should expose",
  "docs/MCP_SPEC.md auth policy"
);

const forbidden = remoteMcpForbiddenSurfaces.find(
  (value) => typeof value === "string" && value.includes("RECALLANT_DATABASE_URL")
);
if (forbidden) {
  mustInclude(mcpSpec, "RECALLANT_DATABASE_URL", "docs/MCP_SPEC.md database-url boundary");
  mustNotContain(mcpSpec, "Remote clients require RECALLANT_DATABASE_URL", "docs/MCP_SPEC.md");
} else {
  throw new Error("remoteMcpForbiddenSurfaces missing RECALLANT_DATABASE_URL");
}

const statusBounded =
  remoteClientSection.includes("local stdio") &&
  remoteClientSection.includes("recallant remote-doctor") &&
  remoteClientSection.includes("external-client");
assert(statusBounded, "Client setup must distinguish current local MCP from remaining remote work");

assert(
  !mcpSpec.includes("RECALLANT_DATABASE_URL as required input"),
  "MCP spec must not require RECALLANT_DATABASE_URL for remote client calls"
);

process.stdout.write(
  JSON.stringify(
    {
      remote_mcp_contract: {
        endpoint: remoteMcpEndpointPath,
        required_headers: remoteMcpHeaders.required,
        optional_headers: remoteMcpHeaders.optional,
        error_codes: Object.keys(remoteMcpErrorCodes),
        startup_per_minute: remoteMcpRateLimits.startupPerMinute,
        tool_per_minute: remoteMcpRateLimits.toolPerMinute,
        payload_hard_bytes: remoteMcpPayloadLimits.requestHardBytes
      }
    },
    null,
    2
  ) + "\n"
);

const projectId = "11111111-1111-4111-8111-111111111111";
const developerId = "22222222-2222-4222-8222-222222222222";
const clientId = "remote-smoke-client";
const sessionId = "33333333-3333-4333-8333-333333333333";
const token = ["remote", "smoke", "token"].join("-");
const wrongToken = ["wrong", "token"].join("-");
const forbiddenDbUrl = ["postgres", "://", "secret"].join("");
const credential = {
  id: "44444444-4444-4444-8444-444444444444",
  project_id: projectId,
  developer_id: developerId,
  client_id: clientId,
  credential_prefix: "remote-smoke",
  status: "active"
};
let bindingDeveloperId = developerId;
const activityRows = [];
const agentMemories = [];

const fakeDb = {
  async verifyRemoteMcpCredential(input) {
    if (input.bearerToken !== token) {
      return {
        ok: false,
        code: "invalid_token",
        message: "Remote MCP credential is not valid."
      };
    }
    if (input.projectId !== credential.project_id) {
      return {
        ok: false,
        code: "wrong_project",
        message: "Remote MCP credential rejected: wrong_project.",
        credential
      };
    }
    if (input.developerId !== credential.developer_id) {
      return {
        ok: false,
        code: "wrong_developer",
        message: "Remote MCP credential rejected: wrong_developer.",
        credential
      };
    }
    if (input.clientId !== credential.client_id) {
      return {
        ok: false,
        code: "wrong_client",
        message: "Remote MCP credential rejected: wrong_client.",
        credential
      };
    }
    return { ok: true, credential };
  },
  async getProjectBinding(requestProjectId) {
    if (requestProjectId !== projectId) return null;
    return {
      project_id: projectId,
      developer_id: bindingDeveloperId,
      name: "Remote MCP smoke project",
      primary_path: "/tmp/recallant-remote-mcp-smoke"
    };
  },
  async projectPrimaryPath(requestProjectId) {
    return requestProjectId === projectId ? "/tmp/recallant-remote-mcp-smoke" : null;
  },
  async startSystemActivity(input) {
    const row = {
      id: `activity-${activityRows.length + 1}`,
      trace_id: input.trace_id ?? `trace-${activityRows.length + 1}`,
      parent_trace_id: input.parent_trace_id ?? null,
      developer_id: input.developer_id ?? null,
      project_id: input.project_id ?? null,
      session_id: input.session_id ?? null,
      surface: input.surface,
      operation: input.operation,
      actor_kind: input.actor_kind ?? "agent",
      actor_id: input.actor_id ?? null,
      client_kind: input.client_kind ?? null,
      client_version: input.client_version ?? null,
      status: "started",
      duration_ms: null,
      error_code: null,
      error_message: null,
      related_ids: input.related_ids ?? {},
      redacted_metadata: input.metadata ?? {},
      started_at: new Date(),
      finished_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    activityRows.push(row);
    return row;
  },
  async finishSystemActivity(input) {
    const row = activityRows.find((candidate) => candidate.id === input.id);
    if (!row) return null;
    row.status = input.status;
    row.error_code = input.error_code ?? null;
    row.error_message = input.error_message ?? null;
    row.redacted_metadata = { ...row.redacted_metadata, ...(input.metadata ?? {}) };
    row.finished_at = new Date();
    row.duration_ms = 1;
    return row;
  },
  async startSession(input) {
    assert(
      input.project_id === projectId,
      "remote memory_start_session did not use scoped project_id"
    );
    return {
      session_id: sessionId,
      project_id: projectId,
      checkpoint: { payload: null, updated_at: null },
      previous_unclosed_session: null,
      recommended_next_calls: ["memory_get_context_pack"]
    };
  },
  async getContextPack(input) {
    assert(
      input.project_id === projectId,
      "remote memory_get_context_pack did not use scoped project_id"
    );
    return {
      context_pack_id: "remote-context-pack",
      project_id: projectId,
      session_id: input.session_id,
      sections: { working_memories: [] },
      truncated: false
    };
  },
  async createAgentMemory(input) {
    assert(
      input.project_id === projectId,
      "remote memory_create_agent_memory did not use scoped project_id"
    );
    assert(
      Array.isArray(input.source_refs) && input.source_refs.length > 0,
      "remote memory_create_agent_memory did not add a governed source ref"
    );
    assert(
      input.source_refs[0]?.source_kind === "external",
      "remote memory_create_agent_memory fallback source ref should be external"
    );
    const memory = {
      memory_id: `memory-${agentMemories.length + 1}`,
      memory_type: input.memory_type,
      title: input.title,
      body: input.body,
      status: "accepted",
      use_policy: "recall_allowed",
      source_refs: input.source_refs
    };
    agentMemories.push(memory);
    return {
      memory_id: memory.memory_id,
      status: memory.status,
      use_policy: memory.use_policy,
      review_reason: "accepted"
    };
  },
  async recallAgentMemories(input) {
    assert(
      input.project_id === projectId,
      "remote memory_recall_agent_memories did not use scoped project_id"
    );
    return {
      trace_id: "remote-recall-trace",
      memories: agentMemories.filter((memory) => memory.body.includes(input.query)),
      truncated: false
    };
  },
  async heartbeat(requestSessionId, status, note, metadata) {
    return {
      id: requestSessionId,
      status,
      note: note ?? null,
      metadata: metadata ?? {},
      last_seen_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    };
  }
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Remote MCP smoke could not determine server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error?.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      if (error) reject(error);
      else resolve();
    });
  });
}

function scopedHeaders(overrides = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-recallant-project-id": projectId,
    "x-recallant-developer-id": developerId,
    "x-recallant-client-id": clientId,
    "x-recallant-session-id": sessionId,
    "x-recallant-trace-id": "remote-smoke-trace",
    ...overrides
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[key];
  }
  return headers;
}

async function rpc(baseUrl, body, headers = scopedHeaders()) {
  const response = await fetch(`${baseUrl}${remoteMcpEndpointPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}

function assertError(result, status, code, label) {
  assert(result.status === status, `${label} expected HTTP ${status}, got ${result.status}`);
  assert(result.body?.error?.data?.code === code, `${label} expected code ${code}`);
  assert(result.body?.jsonrpc === "2.0", `${label} missing JSON-RPC version`);
}

function assertRemoteMcpAuditRowSafe(row, label) {
  assert(row.surface === "remote_mcp", `${label} audit row surface mismatch`);
  assert(row.operation?.startsWith("remote_mcp."), `${label} audit row operation mismatch`);
  assert(["success", "skipped", "error"].includes(row.status), `${label} audit row status invalid`);
  assert(typeof row.redacted_metadata === "object", `${label} audit row missing redacted metadata`);
  const text = JSON.stringify(row);
  for (const forbiddenValue of [
    token,
    wrongToken,
    forbiddenDbUrl,
    "Bearer remote-smoke-token",
    "Bearer wrong-token",
    "raw_request_body",
    "forbidden-db-url"
  ]) {
    mustNotContain(text, forbiddenValue, `${label} audit row`);
  }
  assert(!/postgres:\/\/[^"<\s]+/.test(text), `${label} audit row leaked a database URL`);
}

const originalAuthToken = process.env.RECALLANT_AUTH_TOKEN;
delete process.env.RECALLANT_AUTH_TOKEN;

const server = createRecallantHttpServer({ remoteMcpDatabase: fakeDb });
const endpointCases = [];
try {
  const baseUrl = await listen(server);

  let result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "unauthorized", method: "initialize", params: {} },
    scopedHeaders({ authorization: undefined })
  );
  assertError(result, 401, "UNAUTHORIZED", "unauthorized request");
  endpointCases.push("unauthorized");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "missing-scope", method: "initialize", params: {} },
    { "content-type": "application/json", authorization: `Bearer ${token}` }
  );
  assertError(result, 400, "MISSING_PROJECT_OR_DEVELOPER_SCOPE", "missing scope headers");
  endpointCases.push("missing_scope");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "wrong-token", method: "initialize", params: {} },
    scopedHeaders({ authorization: `Bearer ${wrongToken}` })
  );
  assertError(result, 401, "INVALID_SCOPE_TOKEN", "wrong token");
  endpointCases.push("wrong_token");

  bindingDeveloperId = "99999999-9999-4999-8999-999999999999";
  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "project-mismatch",
    method: "initialize",
    params: {}
  });
  assertError(result, 403, "PROJECT_SCOPE_MISMATCH", "project/developer mismatch");
  bindingDeveloperId = developerId;
  endpointCases.push("project_developer_mismatch");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "forbidden-db-url",
    method: "initialize",
    params: { RECALLANT_DATABASE_URL: forbiddenDbUrl }
  });
  assertError(result, 400, "FORBIDDEN_HEADER", "forbidden client database URL");
  endpointCases.push("forbidden_database_url");

  result = await rpc(baseUrl, { jsonrpc: "2.0", id: "init", method: "initialize", params: {} });
  assert(result.status === 200, "initialize expected HTTP 200");
  assert(result.body?.result?.serverInfo?.name === "recallant", "initialize missing server info");
  mustNotContain(result.text, "RECALLANT_DATABASE_URL", "initialize response");
  endpointCases.push("initialize_happy_path");

  result = await rpc(baseUrl, { jsonrpc: "2.0", id: "list", method: "tools/list", params: {} });
  assert(result.status === 200, "tools/list expected HTTP 200");
  assert(
    result.body?.result?.tools?.some((tool) => tool.name === "memory_heartbeat"),
    "tools/list missing memory_heartbeat"
  );
  endpointCases.push("tools_list_happy_path");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "heartbeat",
    method: "tools/call",
    params: {
      name: "memory_heartbeat",
      arguments: {
        session_id: sessionId,
        status: "active",
        note: null,
        metadata: { smoke: true }
      }
    }
  });
  assert(result.status === 200, "tools/call expected HTTP 200");
  assert(result.body?.result?.structuredContent?.ok === true, "tools/call heartbeat missing ok");
  mustNotContain(result.text, "RECALLANT_DATABASE_URL", "tools/call response");
  endpointCases.push("tools_call_memory_heartbeat_happy_path");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "start-session",
    method: "tools/call",
    params: {
      name: "memory_start_session",
      arguments: {
        client_kind: "codex",
        client_version: null,
        project_path: null,
        session_label: "remote smoke"
      }
    }
  });
  assert(result.status === 200, `memory_start_session expected HTTP 200: ${result.text}`);
  assert(
    result.body?.result?.structuredContent?.project_id === projectId,
    "memory_start_session did not return scoped project id"
  );
  endpointCases.push("tools_call_memory_start_session_scoped_project");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "context-pack",
    method: "tools/call",
    params: {
      name: "memory_get_context_pack",
      arguments: {
        session_id: sessionId,
        task_hint: "remote smoke context",
        max_chars_total: 12000
      }
    }
  });
  assert(result.status === 200, "memory_get_context_pack expected HTTP 200");
  assert(
    result.body?.result?.structuredContent?.project_id === projectId,
    "memory_get_context_pack did not use scoped project id"
  );
  endpointCases.push("tools_call_memory_get_context_pack_scoped_project");

  const remoteMemoryFact = "remote onboarding test from Vadim Mac Resume passed on 2026-06-20";
  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "create-agent-memory",
    method: "tools/call",
    params: {
      name: "memory_create_agent_memory",
      arguments: {
        memory_type: "work_log",
        scope: "project",
        scope_kind: "project",
        scope_id: null,
        audience: [{ kind: "all_agents", id: null }],
        title: "Remote onboarding Mac test passed",
        body: remoteMemoryFact,
        confidence: 1,
        source_refs: [],
        created_by: "agent",
        metadata: { smoke: true }
      }
    }
  });
  assert(result.status === 200, "memory_create_agent_memory expected HTTP 200");
  assert(
    result.body?.result?.structuredContent?.memory_id === "memory-1",
    "memory_create_agent_memory did not return created memory"
  );
  mustNotContain(result.text, "RECALLANT_DATABASE_URL", "memory_create_agent_memory response");
  endpointCases.push("tools_call_memory_create_agent_memory_scoped_project");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "create-agent-memory-invalid-type",
    method: "tools/call",
    params: {
      name: "memory_create_agent_memory",
      arguments: {
        memory_type: "fact",
        scope: "project",
        scope_kind: "project",
        scope_id: null,
        audience: [{ kind: "all_agents", id: null }],
        title: "Invalid remote fact type",
        body: remoteMemoryFact,
        confidence: 1,
        source_refs: [],
        created_by: "agent",
        metadata: { smoke: true }
      }
    }
  });
  assert(result.status === 400, `invalid memory_type should return HTTP 400: ${result.text}`);
  assert(
    result.body?.error?.code === -32600 &&
      result.body?.error?.data?.code === "VALIDATION_ERROR" &&
      String(result.body?.error?.message ?? "").includes("memory_type") &&
      String(result.body?.error?.message ?? "").includes("work_log") &&
      !String(result.body?.error?.message ?? "").includes("-32053"),
    `invalid memory_type should return actionable validation error: ${result.text}`
  );
  mustNotContain(result.text, "RECALLANT_DATABASE_URL", "invalid memory_type response");
  endpointCases.push("tools_call_memory_create_agent_memory_invalid_type_validation");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "recall-agent-memory",
    method: "tools/call",
    params: {
      name: "memory_recall_agent_memories",
      arguments: {
        query: remoteMemoryFact,
        scope: "project",
        memory_types: ["work_log"],
        include_candidates: true,
        include_needs_review: true,
        top_k: 5,
        max_chars_total: 12000
      }
    }
  });
  assert(result.status === 200, "memory_recall_agent_memories expected HTTP 200");
  assert(
    result.body?.result?.structuredContent?.memories?.some((memory) =>
      memory.body.includes(remoteMemoryFact)
    ),
    "memory_recall_agent_memories did not return the created remote memory"
  );
  endpointCases.push("tools_call_memory_recall_agent_memories_readback");

  assert(
    activityRows.some((row) => row.surface === "remote_mcp" && row.status === "success"),
    "remote_mcp audit success row missing"
  );
  const successRow = activityRows.find(
    (row) => row.surface === "remote_mcp" && row.status === "success"
  );
  assertRemoteMcpAuditRowSafe(successRow, "success");
  assert(
    successRow.related_ids?.credential_id === credential.id,
    "success audit row missing credential id"
  );
  assert(
    successRow.related_ids?.credential_prefix === credential.credential_prefix,
    "success audit row missing credential prefix"
  );
  assert(
    successRow.redacted_metadata?.http_status === 200,
    "success audit row missing redacted HTTP status"
  );
  const failedRows = activityRows.filter(
    (row) => row.surface === "remote_mcp" && row.status === "skipped"
  );
  assert(failedRows.length >= 4, "remote_mcp audit failure rows missing");
  for (const row of failedRows) assertRemoteMcpAuditRowSafe(row, `failed ${row.operation}`);
  assert(
    failedRows.some((row) => row.error_code === "INVALID_SCOPE_TOKEN"),
    "remote_mcp audit missing invalid credential/scope failure"
  );
  assert(
    failedRows.some((row) => row.error_code === "MISSING_PROJECT_OR_DEVELOPER_SCOPE"),
    "remote_mcp audit missing missing-scope failure"
  );
  assert(
    activityRows.every((row) => !JSON.stringify(row).includes(forbiddenDbUrl)),
    "remote_mcp audit leaked forbidden DB URL"
  );
} finally {
  await close(server);
  if (originalAuthToken === undefined) delete process.env.RECALLANT_AUTH_TOKEN;
  else process.env.RECALLANT_AUTH_TOKEN = originalAuthToken;
}

process.stdout.write(
  JSON.stringify(
    {
      remote_mcp_endpoint_behavior: {
        cases: endpointCases,
        audit_rows: activityRows.length,
        surface: "remote_mcp",
        audit_row_fields: [
          "surface",
          "operation",
          "status",
          "error_code",
          "related_ids.credential_id",
          "related_ids.credential_prefix",
          "redacted_metadata.http_status",
          "redacted_metadata.audit_policy"
        ],
        redacted_audit_failure_rows: activityRows.filter(
          (row) => row.surface === "remote_mcp" && row.status === "skipped"
        ).length
      }
    },
    null,
    2
  ) + "\n"
);

process.stdout.write("Remote MCP contract smoke passed\n");
