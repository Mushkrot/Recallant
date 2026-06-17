import http from "node:http";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import { RecallantDb } from "@recallant/db";
import pg from "pg";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "recallant_dev_password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();
const dims = 4;
const requestLog = [];
let scenario = null;

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method !== "POST" || path !== "/api/embeddings") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  await readRequestBody(request);
  const active = scenario;
  if (!active) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "missing_scenario" }));
    return;
  }

  active.calls += 1;
  const action =
    active.actions[Math.min(active.calls - 1, active.actions.length - 1)] ?? active.actions.at(-1);
  if (action?.delay_ms) await delay(action.delay_ms);

  const status = action?.status ?? 200;
  requestLog.push({ scenario: active.name, call: active.calls, status });
  response.writeHead(status, { "content-type": "application/json" });
  if (status >= 400) {
    response.end(JSON.stringify({ error: `fake_${status}` }));
    return;
  }
  response.end(JSON.stringify({ embedding: [0.5, 0.25, 0.125, 0.0625] }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object", "Fake Ollama server did not expose a TCP address");
const fakeOllamaUrl = `http://127.0.0.1:${address.port}`;

const envSnapshot = snapshotEnv([
  "RECALLANT_OLLAMA_URL",
  "RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS",
  "RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS",
  "RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS",
  "RECALLANT_OLLAMA_EMBED_TIMEOUT_MS"
]);
process.env.RECALLANT_OLLAMA_URL = fakeOllamaUrl;
process.env.RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS = "3";
process.env.RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS = "10";
process.env.RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS = "25";
process.env.RECALLANT_OLLAMA_EMBED_TIMEOUT_MS = "1000";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function configureOllamaRoute(projectId) {
  await client.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'embedding_route', $2, 'cold Ollama embedding smoke', 'smoke')
      ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [
      projectId,
      JSON.stringify({
        route_class: "local_model",
        provider: "ollama",
        model: "fake-ollama-embed",
        dims
      })
    ]
  );
}

async function runScenario(name, actions, text) {
  scenario = { name, actions, calls: 0 };
  const projectId = randomUUID();
  const developerId = randomUUID();
  const db = new RecallantDb({
    databaseUrl,
    developerId,
    projectId,
    projectPath: `/tmp/${projectId}`
  });
  await db.ensureProject(`/tmp/${projectId}`);
  await configureOllamaRoute(projectId);
  const session = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: `/tmp/${projectId}`,
    session_label: `cold-ollama-${name}`,
    resume_policy: "normal"
  });
  const startedAt = Date.now();
  const append = await db.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text,
    dedup_key: `cold-ollama-${name}-${randomUUID()}`
  });
  const elapsedMs = Date.now() - startedAt;
  const chunk = await client.query(
    `
      SELECT
        c.embed_status,
        c.embed_model,
        count(e.chunk_id)::int AS embedding_rows
      FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE c.project_id = $1 AND c.source_event_id = $2
      GROUP BY c.embed_status, c.embed_model
    `,
    [projectId, append.event_id]
  );
  const modelCalls = await client.query(
    `
      SELECT status, error_code, metadata
      FROM model_calls
      WHERE project_id = $1 AND purpose = 'chunk_embedding'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [projectId]
  );
  const paidChecks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1) AS paid_approval_count,
        (SELECT count(*)::int FROM model_calls WHERE project_id = $1 AND provider <> 'ollama') AS non_ollama_model_calls
    `,
    [projectId]
  );
  await db.close();
  return {
    name,
    project_id: projectId,
    elapsed_ms: elapsedMs,
    append_embedding: append.embedding,
    chunk: chunk.rows[0],
    model_call: modelCalls.rows[0],
    paid_fallback: paidChecks.rows[0],
    requests: requestLog.filter((entry) => entry.scenario === name)
  };
}

try {
  const transient = await runScenario(
    "transient_retry",
    [{ status: 503 }, { status: 200 }],
    "Transient cold Ollama should retry once and embed this memory."
  );
  assert(transient.append_embedding?.status === "embedded", JSON.stringify(transient));
  assert(transient.append_embedding?.retry_count === 1, JSON.stringify(transient));
  assert(transient.chunk?.embed_status === "embedded", JSON.stringify(transient.chunk));
  assert(transient.chunk?.embedding_rows === 1, JSON.stringify(transient.chunk));
  assert(transient.model_call?.status === "success", JSON.stringify(transient.model_call));
  assert(transient.model_call?.metadata?.retry_count === 1, JSON.stringify(transient.model_call));

  const slow = await runScenario(
    "slow_success",
    [{ status: 200, delay_ms: 150 }],
    "Slow but healthy cold Ollama should stay bounded and embed."
  );
  assert(slow.append_embedding?.status === "embedded", JSON.stringify(slow));
  assert(slow.elapsed_ms < 2_500, JSON.stringify(slow));
  assert(slow.model_call?.metadata?.attempt_count === 1, JSON.stringify(slow.model_call));

  const persistent = await runScenario(
    "persistent_failure",
    [{ status: 503 }, { status: 503 }, { status: 503 }],
    "Persistent fake Ollama failure should leave the chunk pending without losing the event."
  );
  assert(persistent.append_embedding?.status === "pending", JSON.stringify(persistent));
  assert(persistent.append_embedding?.error === "UNAVAILABLE", JSON.stringify(persistent));
  assert(persistent.chunk?.embed_status === "pending", JSON.stringify(persistent.chunk));
  assert(persistent.chunk?.embedding_rows === 0, JSON.stringify(persistent.chunk));
  assert(persistent.model_call?.status === "failed", JSON.stringify(persistent.model_call));
  assert(
    persistent.model_call?.error_code === "UNAVAILABLE",
    JSON.stringify(persistent.model_call)
  );
  assert(persistent.model_call?.metadata?.retry_count === 2, JSON.stringify(persistent.model_call));
  assert(
    persistent.model_call?.metadata?.retry_exhausted === true,
    JSON.stringify(persistent.model_call)
  );

  for (const result of [transient, slow, persistent]) {
    assert(result.paid_fallback?.paid_approval_count === 0, JSON.stringify(result.paid_fallback));
    assert(
      result.paid_fallback?.non_ollama_model_calls === 0,
      JSON.stringify(result.paid_fallback)
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        fake_ollama: {
          transient_retry: {
            append_embedding: transient.append_embedding,
            chunk: transient.chunk,
            model_call: transient.model_call,
            requests: transient.requests
          },
          slow_success: {
            elapsed_ms: slow.elapsed_ms,
            append_embedding: slow.append_embedding,
            model_call: slow.model_call,
            requests: slow.requests
          },
          persistent_failure: {
            append_embedding: persistent.append_embedding,
            chunk: persistent.chunk,
            model_call: persistent.model_call,
            requests: persistent.requests
          },
          paid_fallback: {
            transient_retry: transient.paid_fallback,
            slow_success: slow.paid_fallback,
            persistent_failure: persistent.paid_fallback
          }
        }
      },
      null,
      2
    )}\n`
  );
  process.stdout.write("Cold Ollama embedding smoke passed\n");
} finally {
  scenario = null;
  await client.end().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  restoreEnv(envSnapshot);
}
