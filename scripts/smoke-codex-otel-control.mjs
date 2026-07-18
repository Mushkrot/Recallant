import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import pg from "pg";

import { codexOtelLogsEndpointPath } from "../packages/contracts/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-otel-control-${projectId}`;
const clientId = "codex-otel-smoke";
const externalSessionId = `codex-${randomUUID()}`;
const externalCallId = `call-${randomUUID()}`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
const sql = new pg.Client({ connectionString: databaseUrl });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function otlpRecord(input) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "codex_cli_rs" } }]
        },
        scopeLogs: [
          {
            scope: { attributes: [] },
            logRecords: [
              {
                timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
                body: { stringValue: input.rawBody ?? "must not be stored" },
                attributes: [
                  { key: "event.name", value: { stringValue: input.eventName } },
                  {
                    key: "conversation.id",
                    value: { stringValue: input.conversationId }
                  },
                  { key: "call_id", value: { stringValue: input.callId } },
                  { key: "tool_name", value: { stringValue: input.toolName } },
                  { key: "success", value: { boolValue: input.success } },
                  { key: "output", value: { stringValue: "secret-tool-output" } }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

await sql.connect();
let server;
try {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS remote_mcp_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
      client_id TEXT,
      label TEXT,
      credential_prefix TEXT NOT NULL,
      credential_hash TEXT NOT NULL,
      hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
      created_by TEXT NOT NULL DEFAULT 'cli',
      rotated_from_credential_id UUID REFERENCES remote_mcp_credentials(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `);
  const project = await db.ensureProject();
  const started = await db.startSession({
    project_id: project.projectId,
    client_kind: "codex",
    client_version: "otel-control-smoke"
  });
  await db.appendAgentObservation({
    session_id: started.session_id,
    kind: "tool_result",
    status: "success",
    title: "Native tool result",
    tool_name: "exec_command",
    metadata: {
      adapter: "codex_native_hook",
      hook_event_name: "PostToolUse",
      external_session_id: externalSessionId,
      external_tool_use_id: externalCallId
    },
    client_kind: "codex"
  });
  const credential = await db.createRemoteMcpCredential({
    projectId,
    developerId,
    clientId,
    label: "OTel smoke",
    createdBy: "smoke"
  });
  server = createRecallantHttpServer({ remoteMcpDatabase: db, workbenchDatabase: db });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const endpoint = `http://127.0.0.1:${address.port}${codexOtelLogsEndpointPath}`;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${credential.secret}`,
    "x-recallant-project-id": projectId,
    "x-recallant-developer-id": developerId,
    "x-recallant-client-id": clientId
  };
  const matchedBody = otlpRecord({
    eventName: "codex.tool_result",
    conversationId: externalSessionId,
    callId: externalCallId,
    toolName: "exec_command",
    success: true
  });

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-recallant-project-id": projectId,
      "x-recallant-developer-id": developerId,
      "x-recallant-client-id": clientId
    },
    body: JSON.stringify(matchedBody)
  });
  assert(unauthorized.status === 401, `unauthorized status was ${unauthorized.status}`);
  const binary = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/x-protobuf" },
    body: "binary"
  });
  assert(binary.status === 415, `binary status was ${binary.status}`);
  const accepted = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(matchedBody)
  });
  assert(accepted.status === 200, `accepted status was ${accepted.status}`);
  const duplicate = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(matchedBody)
  });
  assert(duplicate.status === 200, `duplicate status was ${duplicate.status}`);
  const compressed = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-encoding": "gzip" },
    body: gzipSync(JSON.stringify(matchedBody))
  });
  assert(compressed.status === 200, `gzip status was ${compressed.status}`);
  const malformedGzip = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-encoding": "gzip" },
    body: "not-gzip"
  });
  assert(malformedGzip.status === 400, `malformed gzip status was ${malformedGzip.status}`);
  const compressedBomb = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-encoding": "gzip" },
    body: gzipSync("x".repeat(1_048_577))
  });
  assert(compressedBomb.status === 413, `compressed bomb status was ${compressedBomb.status}`);

  const missingHook = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(
      otlpRecord({
        eventName: "codex.user_prompt",
        conversationId: `missing-${randomUUID()}`,
        callId: `prompt-${randomUUID()}`,
        toolName: "none",
        success: true,
        rawBody: "private user prompt"
      })
    )
  });
  assert(missingHook.status === 200, `missing-hook status was ${missingHook.status}`);

  const rows = await sql.query(
    `SELECT match_status, content_discarded, safe_attributes::text AS attributes,
            count(*) OVER ()::int AS total
     FROM agent_otel_control_events WHERE project_id = $1 ORDER BY created_at`,
    [projectId]
  );
  assert(rows.rows.length === 2, `expected two deduplicated rows, got ${rows.rows.length}`);
  assert(rows.rows.some((row) => row.match_status === "matched"), "matched row is missing");
  assert(rows.rows.some((row) => row.match_status === "missing_hook"), "gap row is missing");
  const serialized = JSON.stringify(rows.rows);
  assert(!serialized.includes("secret-tool-output"), "raw tool output leaked");
  assert(!serialized.includes("private user prompt"), "raw prompt leaked");
  const coverage = await db.getOtelControlCoverage(projectId);
  assert(coverage.configured === true, "real receipt did not mark OTel configured");
  assert(coverage.matched_count === 1, `matched count was ${coverage.matched_count}`);
  assert(coverage.missing_hook_count === 1, `missing-hook count was ${coverage.missing_hook_count}`);
  const freshReadiness = await db.getProjectReadiness({ project_id: projectId });
  assert(
    freshReadiness.readiness_contract.capture_active === true &&
      freshReadiness.readiness_contract.evidence.automatic_capture_source ===
        "codex_native_hook",
    `fresh native capture was not active: ${JSON.stringify(freshReadiness.readiness_contract)}`
  );
  await sql.query(
    `UPDATE agent_observations
     SET occurred_at = now() - interval '25 hours'
     WHERE project_id = $1 AND redacted_metadata->>'adapter' = 'codex_native_hook'`,
    [projectId]
  );
  const staleReadiness = await db.getProjectReadiness({ project_id: projectId });
  assert(
    staleReadiness.readiness_contract.capture_active === false &&
      staleReadiness.readiness_contract.capture_fresh === false &&
      staleReadiness.readiness_contract.evidence.last_automatic_capture_at !== null,
    `stale native capture remained active: ${JSON.stringify(staleReadiness.readiness_contract)}`
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        endpoint: codexOtelLogsEndpointPath,
        unauthorized: unauthorized.status,
        unsupported_binary: binary.status,
        accepted: accepted.status,
        gzip_accepted: compressed.status,
        malformed_gzip: malformedGzip.status,
        compressed_bomb: compressedBomb.status,
        deduplicated_events: rows.rows.length,
        matched: coverage.matched_count,
        missing_hook: coverage.missing_hook_count,
        fresh_capture_active: freshReadiness.readiness_contract.capture_active,
        stale_capture_active: staleReadiness.readiness_contract.capture_active,
        raw_content_stored: false
      },
      null,
      2
    )}\n`
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sql.query("DELETE FROM developers WHERE id = $1", [developerId]).catch(() => undefined);
  await sql.end();
  await db.close();
}
