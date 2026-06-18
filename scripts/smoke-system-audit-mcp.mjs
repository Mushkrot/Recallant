import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-system-audit-mcp-${randomUUID()}`;
const fakeApiKey = `sk-mcp-audit-${randomUUID().replaceAll("-", "")}`;
const fakeBearer = `Bearer ${randomUUID().replaceAll("-", "")}`;
const forbiddenMarkers = [fakeApiKey, fakeBearer, projectPath];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(value, forbidden) {
  const serialized = JSON.stringify(value);
  return forbidden.some((marker) => serialized.includes(marker));
}

async function withMcpClient(fn) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "system-audit-mcp-smoke", version: "0.0.0" });
  const server = createRecallantMcpServer();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function callTool(client, name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 5_000 });
  const text = response.content?.[0]?.text ?? "";
  return JSON.parse(text);
}

async function callToolError(client, name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 5_000 });
  assert(response.isError === true, `Expected MCP error response: ${JSON.stringify(response)}`);
  const text = response.content?.[0]?.text ?? "";
  return JSON.parse(text);
}

async function queryAuditRows(sinceIso) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT operation, status, error_code, duration_ms, related_ids, redacted_metadata,
               trace_id, error_message
        FROM system_activity_events
        WHERE surface = 'mcp'
          AND started_at >= $1::timestamptz
          AND operation = ANY($2::text[])
        ORDER BY started_at ASC
      `,
      [
        sinceIso,
        ["memory_start_session", "memory_create_agent_memory", "memory_heartbeat"]
      ]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = projectPath;
process.env.RECALLANT_EMBEDDING_PROVIDER = "deterministic";
process.env.RECALLANT_EMBEDDING_DIMS = "8";
process.env.RECALLANT_MCP_RATE_LIMIT_PER_MINUTE = "2";

const sinceIso = new Date().toISOString();
let successPayload;
let validationPayload;
let rateLimitPayload;

await withMcpClient(async (client) => {
  successPayload = await callTool(client, "memory_start_session", {
    client_kind: "codex",
    client_version: "system-audit-smoke",
    project_path: projectPath,
    session_label: "system audit MCP smoke",
    resume_policy: "force_new"
  });
  assert(successPayload.audit?.durable === true, "success payload did not report durable audit");

  validationPayload = await callToolError(client, "memory_create_agent_memory", {
    memory_type: "decision",
    scope: "project",
    title: "Invalid source-free memory",
    body: "This should produce a structured validation error.",
    created_by: "agent",
    source_refs: [],
    metadata: {
      api_key: fakeApiKey,
      headers: { authorization: fakeBearer },
      project_path: projectPath
    }
  });
  assert(
    validationPayload.error?.code === "VALIDATION_ERROR" &&
      validationPayload.audit?.durable === true,
    `validation audit response failed: ${JSON.stringify(validationPayload)}`
  );

  await callTool(client, "memory_heartbeat", {
    session_id: successPayload.session_id,
    status: "active"
  });
  await callTool(client, "memory_heartbeat", {
    session_id: successPayload.session_id,
    status: "active"
  });
  rateLimitPayload = await callToolError(client, "memory_heartbeat", {
    session_id: successPayload.session_id,
    status: "active"
  });
  assert(
    rateLimitPayload.error?.code === "RATE_LIMITED" && rateLimitPayload.audit?.durable === true,
    `rate-limit audit response failed: ${JSON.stringify(rateLimitPayload)}`
  );
});

const rows = await queryAuditRows(sinceIso);
const successRow = rows.find(
  (row) => row.operation === "memory_start_session" && row.status === "success"
);
const validationRow = rows.find(
  (row) => row.operation === "memory_create_agent_memory" && row.error_code === "VALIDATION_ERROR"
);
const rateLimitRow = rows.find(
  (row) => row.operation === "memory_heartbeat" && row.error_code === "RATE_LIMITED"
);
assert(successRow, `Missing successful MCP audit row: ${JSON.stringify(rows)}`);
assert(validationRow, `Missing validation-error MCP audit row: ${JSON.stringify(rows)}`);
assert(rateLimitRow, `Missing rate-limit MCP audit row: ${JSON.stringify(rows)}`);
assert(!containsAny(rows, forbiddenMarkers), "MCP audit rows leaked raw argument values");

delete process.env.RECALLANT_DATABASE_URL;
delete process.env.RECALLANT_MCP_RATE_LIMIT_PER_MINUTE;
const stubPayload = await withMcpClient((client) => callTool(client, "memory_get_checkpoint", {}));
assert(
  stubPayload.audit?.durable === false && stubPayload.audit?.status === "unavailable",
  `stub MCP audit status failed: ${JSON.stringify(stubPayload)}`
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      success_row: {
        operation: successRow.operation,
        status: successRow.status,
        duration_recorded: typeof successRow.duration_ms === "number",
        related_id_keys: Object.keys(successRow.related_ids ?? {}).sort(),
        trace_recorded: Boolean(successRow.trace_id)
      },
      validation_error_row: {
        operation: validationRow.operation,
        status: validationRow.status,
        error_code: validationRow.error_code,
        redacted_metadata_keys: Object.keys(validationRow.redacted_metadata ?? {}).sort()
      },
      rate_limit_row: {
        operation: rateLimitRow.operation,
        status: rateLimitRow.status,
        error_code: rateLimitRow.error_code
      },
      stub_audit_status: stubPayload.audit,
      raw_marker_count: 0
    },
    null,
    2
  )}\n`
);
