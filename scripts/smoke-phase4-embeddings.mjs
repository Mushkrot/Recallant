import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecallantDb } from "@recallant/db";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";
import pg from "pg";

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "recallant_dev_password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();

const developerId = randomUUID();
const defaultProjectId = randomUUID();
const projectId = randomUUID();

async function assertCliMcpServerLifecycle() {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId,
      RECALLANT_PROJECT_PATH: process.cwd()
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  let exit = null;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (exit) {
    throw new Error(
      `CLI mcp-server exited before client close: ${JSON.stringify({ exit, stderr })}`
    );
  }
  child.kill();
  await once(child, "close");
  return { alive_for_ms: 800, stopped_by_test: true };
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const mcpEnvKeys = [
  "RECALLANT_DATABASE_URL",
  "RECALLANT_DEVELOPER_ID",
  "RECALLANT_PROJECT_ID",
  "RECALLANT_PROJECT_PATH"
];
const mcpEnvSnapshot = snapshotEnv(mcpEnvKeys);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = process.cwd();

const cliLifecycle = await assertCliMcpServerLifecycle();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({
  name: "recallant-phase4-smoke",
  version: "0.0.0"
});
const mcpServer = createRecallantMcpServer();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);
const initializeEvidence = {
  server: mcpClient.getServerVersion(),
  capabilities: mcpClient.getServerCapabilities()
};

async function callToolRaw(_id, name, args) {
  return mcpClient.callTool({ name, arguments: args }, undefined, { timeout: 5_000 });
}

async function callTool(id, name, args) {
  const response = await callToolRaw(id, name, args);
  const text = response.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(String(text));
}

/*
The old harness spawned `recallant mcp-server` and wrote JSON-RPC into child stdin. In this runner
the child stdin pipe is not a reliable request channel, so the embedding contract now uses the same
SDK in-memory transport as `mcp:smoke` while the CLI lifecycle is checked separately above.
*/

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "phase4-smoke",
  resume_policy: "normal"
});

const defaultDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: defaultProjectId,
  projectPath: `/tmp/${defaultProjectId}`
});
const defaultSession = await defaultDb.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: `/tmp/${defaultProjectId}`,
  session_label: "phase4-default-route",
  resume_policy: "normal"
});
const defaultRouteAppend = await defaultDb.appendTurn({
  session_id: defaultSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "Default route should resolve to local Ollama and remain pending if unavailable.",
  dedup_key: `phase4-default-${randomUUID()}`
});
if (
  !["pending", "embedded"].includes(defaultRouteAppend.embedding?.status) ||
  defaultRouteAppend.embedding?.provider !== "ollama" ||
  defaultRouteAppend.embedding?.model !== "nomic-embed-text"
) {
  throw new Error(`Default embedding route failed: ${JSON.stringify(defaultRouteAppend)}`);
}
await defaultDb.close();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase4 deterministic embedding smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    projectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v1",
      dims: 16
    })
  ]
);

const banana = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "banana banana yellow fruit smoothie marker_banana",
  dedup_key: `phase4-banana-${randomUUID()}`
});
const network = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "router switch vlan latency packet marker_network",
  dedup_key: `phase4-network-${randomUUID()}`
});
if (banana.embedding?.status !== "embedded" || network.embedding?.status !== "embedded") {
  throw new Error(`Deterministic embedding failed: ${JSON.stringify({ banana, network })}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      mcp: {
        initialize: initializeEvidence,
        cli_lifecycle: cliLifecycle,
        deterministic_tool_call: {
          status: banana.embedding.status,
          provider: banana.embedding.provider,
          model: banana.embedding.model
        }
      }
    },
    null,
    2
  )}\n`
);

const search = await callTool(5, "memory_search", {
  session_id: started.session_id,
  query: "banana fruit",
  mode: "vector_only",
  top_k: 1,
  max_chars_total: 2000
});
if (search.hits?.[0]?.source_event_id !== banana.event_id || search.hits?.[0]?.path !== "vector") {
  throw new Error(`Vector search did not return expected hit: ${JSON.stringify(search)}`);
}

await client.query(
  `
    UPDATE project_settings
    SET value = $2, updated_at = now()
    WHERE project_id = $1 AND key = 'embedding_route'
  `,
  [
    projectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v2",
      dims: 16
    })
  ]
);
const blockedSwitch = await callToolRaw(6, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "model switch should require explicit reindex",
  dedup_key: `phase4-switch-${randomUUID()}`
});
const blockedSwitchText = blockedSwitch.content?.[0]?.text ?? "";
let blockedSwitchBody = null;
try {
  blockedSwitchBody = JSON.parse(String(blockedSwitchText));
} catch {
  // Keep the original text in the failure message below.
}
if (
  blockedSwitch.isError !== true ||
  blockedSwitchBody?.ok !== false ||
  !blockedSwitchText.includes("requires explicit reindex")
) {
  throw new Error(`Embedding model switch was not blocked: ${JSON.stringify(blockedSwitch)}`);
}

const paidProjectId = randomUUID();
const paidDeveloperId = randomUUID();
const paidDb = new RecallantDb({
  databaseUrl,
  developerId: paidDeveloperId,
  projectId: paidProjectId,
  projectPath: `/tmp/${paidProjectId}`
});
await paidDb.ensureProject(`/tmp/${paidProjectId}`);
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase4 paid approval smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    paidProjectId,
    JSON.stringify({
      route_class: "paid_api_provider",
      provider: "openai",
      model: "text-embedding-3-small",
      dims: 1536
    })
  ]
);
const paidSession = await paidDb.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: `/tmp/${paidProjectId}`,
  session_label: "phase4-paid-api",
  resume_policy: "normal"
});
const paidAppend = await paidDb.appendTurn({
  session_id: paidSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "paid route should create approval and avoid provider call",
  dedup_key: `phase4-paid-${randomUUID()}`
});
if (
  paidAppend.embedding?.status !== "pending_approval" ||
  paidAppend.embedding?.provider !== "openai" ||
  !paidAppend.embedding?.approval_request_id
) {
  throw new Error(`Paid API approval path failed: ${JSON.stringify(paidAppend)}`);
}
await client.query(
  `
    UPDATE paid_api_approval_requests
    SET status = 'denied', decided_by = 'smoke', decision_note = 'phase4 denied approval smoke', decided_at = now()
    WHERE id = $1
  `,
  [paidAppend.embedding.approval_request_id]
);
const deniedPaidAppend = await paidDb.appendTurn({
  session_id: paidSession.session_id,
  client_kind: "codex",
  role: "user",
  text: "denied paid approval should defer or downgrade without provider call",
  dedup_key: `phase4-paid-denied-${randomUUID()}`
});
if (
  deniedPaidAppend.embedding?.status !== "deferred" ||
  deniedPaidAppend.embedding?.reason !== "paid_api_approval_denied" ||
  deniedPaidAppend.embedding?.approval_request_id !== paidAppend.embedding.approval_request_id
) {
  throw new Error(`Denied paid API approval path failed: ${JSON.stringify(deniedPaidAppend)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = $1) AS embedding_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $1 AND provider = 'deterministic' AND status = 'success') AS deterministic_calls,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $3 AND provider = 'ollama' AND model = 'nomic-embed-text') AS default_ollama_calls,
        (SELECT count(*)::int FROM system_settings WHERE key = 'embedding_fallback_candidates' AND value::text LIKE '%openai%' AND value::text LIKE '%gemini%') AS fallback_settings,
        (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $2 AND provider = 'openai') AS paid_approval_count,
        (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $2 AND provider = 'openai' AND status = 'denied') AS denied_paid_approval_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $2 AND provider = 'openai' AND confirmation_status = 'required_pending' AND status = 'cancelled') AS blocked_paid_calls,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $2 AND provider = 'openai' AND confirmation_status = 'denied' AND status = 'cancelled' AND error_code = 'paid_api_approval_denied') AS denied_paid_calls,
        (SELECT count(*)::int FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = $2) AS paid_embedding_count
    `,
    [projectId, paidProjectId, defaultProjectId]
  );
  const row = checks.rows[0];
  if (
    row.embedding_count < 2 ||
    row.deterministic_calls < 2 ||
    row.default_ollama_calls < 1 ||
    row.fallback_settings !== 1 ||
    row.paid_approval_count !== 1 ||
    row.denied_paid_approval_count !== 1 ||
    row.blocked_paid_calls !== 1 ||
    row.denied_paid_calls !== 1 ||
    row.paid_embedding_count !== 0
  ) {
    throw new Error(`Unexpected Phase 4 database state: ${JSON.stringify(row)}`);
  }
} finally {
  await paidDb.close();
  await client.end();
}

await mcpClient.close().catch(() => undefined);
await mcpServer.close().catch(() => undefined);
restoreEnv(mcpEnvSnapshot);

process.stdout.write("Phase 4 embedding smoke passed\n");
