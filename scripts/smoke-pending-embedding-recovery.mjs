import http from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { RecallantDb } from "@recallant/db";
import pg from "pg";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function runCli(args, env) {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(
      `CLI failed: ${args.join(" ")}\nstatus=${code}\nstdout=${stdout}\nstderr=${stderr}`
    );
  }
  return JSON.parse(stdout);
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
  const status = active.statuses[Math.min(active.calls - 1, active.statuses.length - 1)] ?? 503;
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
  "RECALLANT_DATABASE_URL",
  "RECALLANT_OLLAMA_URL",
  "RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS",
  "RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS",
  "RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS",
  "RECALLANT_OLLAMA_EMBED_TIMEOUT_MS"
]);
const smokeEnv = {
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_OLLAMA_URL: fakeOllamaUrl,
  RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS: "3",
  RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS: "10",
  RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS: "25",
  RECALLANT_OLLAMA_EMBED_TIMEOUT_MS: "1000"
};
Object.assign(process.env, smokeEnv);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function configureOllamaRoute(projectId) {
  await client.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'embedding_route', $2, 'pending embedding recovery smoke', 'smoke')
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

async function createPendingProject(name) {
  const projectId = randomUUID();
  const developerId = randomUUID();
  const projectPath = await mkdtemp(join(tmpdir(), `recallant-pending-recovery-${name}-`));
  await writeFile(join(projectPath, "README.md"), `# Pending embedding recovery ${name}\n`);
  await mkdir(join(projectPath, ".recallant"), { recursive: true });
  await writeFile(
    join(projectPath, ".recallant", "config"),
    `${JSON.stringify({ project_id: projectId, recallant_server_url: "http://127.0.0.1:3005" }, null, 2)}\n`
  );
  const db = new RecallantDb({
    databaseUrl,
    developerId,
    projectId,
    projectPath
  });
  await db.ensureProject(projectPath);
  await configureOllamaRoute(projectId);
  const session = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectPath,
    session_label: `pending-recovery-${name}`,
    resume_policy: "normal"
  });
  scenario = { name: `${name}_initial_failure`, statuses: [503, 503, 503], calls: 0 };
  const append = await db.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text: `Pending embedding recovery fixture for ${name}.`,
    dedup_key: `pending-recovery-${name}-${randomUUID()}`
  });
  await db.close();
  assert(append.embedding?.status === "pending", JSON.stringify(append));
  return { projectId, developerId, projectPath, eventId: append.event_id };
}

async function embeddingRows(projectId) {
  const result = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND embed_status = 'pending') AS pending_chunks,
        (SELECT count(*)::int FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = $1) AS embedding_rows,
        (SELECT count(*)::int FROM chunks c WHERE c.project_id = $1 AND EXISTS (SELECT 1 FROM embeddings e WHERE e.chunk_id = c.id)) AS chunks_with_embeddings
    `,
    [projectId]
  );
  return result.rows[0];
}

try {
  const recoverable = await createPendingProject("recoverable");
  const recoverableEnv = {
    ...smokeEnv,
    RECALLANT_DEVELOPER_ID: recoverable.developerId,
    RECALLANT_PROJECT_ID: recoverable.projectId,
    RECALLANT_PROJECT_PATH: recoverable.projectPath
  };
  const dbForDashboard = new RecallantDb({
    databaseUrl,
    developerId: recoverable.developerId,
    projectId: recoverable.projectId,
    projectPath: recoverable.projectPath
  });
  const dashboardBefore = await dbForDashboard.getReviewDashboard({
    project_id: recoverable.projectId
  });
  await dbForDashboard.close();
  const doctorBefore = await runCli(
    ["doctor", "--project-dir", recoverable.projectPath, "--format", "json"],
    recoverableEnv
  );
  assert(doctorBefore.pending_embeddings?.pending_chunks === 1, JSON.stringify(doctorBefore));
  assert(
    dashboardBefore.critical?.pending_embeddings === 1,
    JSON.stringify(dashboardBefore.critical)
  );

  scenario = { name: "recoverable_recovery", statuses: [200], calls: 0 };
  const recovery = await runCli(
    [
      "recover-embeddings",
      "--project-id",
      recoverable.projectId,
      "--limit",
      "1",
      "--format",
      "json"
    ],
    recoverableEnv
  );
  const recoveryDebugCalls = await client.query(
    `
      SELECT provider, model, status, error_code, metadata
      FROM model_calls
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT 3
    `,
    [recoverable.projectId]
  );
  assert(
    recovery.status === "completed",
    JSON.stringify({
      recovery,
      requestLog,
      recoverable_ollama_url: recoverableEnv.RECALLANT_OLLAMA_URL,
      model_calls: recoveryDebugCalls.rows
    })
  );
  assert(recovery.recovered_chunks === 1, JSON.stringify({ recovery, requestLog }));
  assert(recovery.remaining_pending === 0, JSON.stringify({ recovery, requestLog }));
  const afterRecoveryRows = await embeddingRows(recoverable.projectId);
  assert(afterRecoveryRows.pending_chunks === 0, JSON.stringify(afterRecoveryRows));
  assert(afterRecoveryRows.embedding_rows === 1, JSON.stringify(afterRecoveryRows));

  scenario = { name: "recoverable_second_pass", statuses: [200], calls: 0 };
  const secondRecovery = await runCli(
    [
      "recover-embeddings",
      "--project-id",
      recoverable.projectId,
      "--limit",
      "1",
      "--format",
      "json"
    ],
    recoverableEnv
  );
  const afterSecondRows = await embeddingRows(recoverable.projectId);
  assert(secondRecovery.status === "nothing_to_do", JSON.stringify(secondRecovery));
  assert(afterSecondRows.embedding_rows === 1, JSON.stringify(afterSecondRows));
  assert(afterSecondRows.chunks_with_embeddings === 1, JSON.stringify(afterSecondRows));

  const onboardFlow = await createPendingProject("onboard-flow");
  const onboardFlowEnv = {
    ...smokeEnv,
    RECALLANT_DEVELOPER_ID: onboardFlow.developerId,
    RECALLANT_PROJECT_ID: onboardFlow.projectId,
    RECALLANT_PROJECT_PATH: onboardFlow.projectPath
  };
  scenario = {
    name: "onboard_flow_recovery",
    statuses: [200, 200, 200, 200, 200, 200, 200, 200],
    calls: 0
  };
  const onboardRecovery = await runCli(
    [
      "onboard",
      onboardFlow.projectPath,
      "--client",
      "codex",
      "--skip-vcs-safety",
      "--format",
      "json"
    ],
    onboardFlowEnv
  );
  assert(
    onboardRecovery.status === "completed" &&
      onboardRecovery.verify?.status === "passed" &&
      onboardRecovery.embedding_recovery?.status === "recovered" &&
      onboardRecovery.embedding_recovery?.pending_before >= 1 &&
      onboardRecovery.embedding_recovery?.recovered_chunks >= 1 &&
      onboardRecovery.embedding_recovery?.remaining_pending === 0 &&
      onboardRecovery.embedding_recovery?.scope?.project_scoped === true &&
      onboardRecovery.embedding_recovery?.scope?.bounded === true,
    `onboard flow did not recover pending embeddings: ${JSON.stringify(onboardRecovery)}`
  );
  const afterOnboardRows = await embeddingRows(onboardFlow.projectId);
  assert(afterOnboardRows.pending_chunks === 0, JSON.stringify(afterOnboardRows));
  assert(afterOnboardRows.embedding_rows >= 1, JSON.stringify(afterOnboardRows));

  const onboardUnavailable = await createPendingProject("onboard-unavailable");
  const onboardUnavailableEnv = {
    ...smokeEnv,
    RECALLANT_DEVELOPER_ID: onboardUnavailable.developerId,
    RECALLANT_PROJECT_ID: onboardUnavailable.projectId,
    RECALLANT_PROJECT_PATH: onboardUnavailable.projectPath
  };
  scenario = {
    name: "onboard_flow_unavailable",
    statuses: Array.from({ length: 40 }, () => 503),
    calls: 0
  };
  const onboardUnavailableResult = await runCli(
    [
      "onboard",
      onboardUnavailable.projectPath,
      "--client",
      "codex",
      "--skip-vcs-safety",
      "--format",
      "json"
    ],
    onboardUnavailableEnv
  );
  assert(
    onboardUnavailableResult.status === "completed" &&
      onboardUnavailableResult.verify?.status === "passed" &&
      onboardUnavailableResult.embedding_recovery?.status === "model_unavailable" &&
      onboardUnavailableResult.embedding_recovery?.remaining_pending >= 1 &&
      onboardUnavailableResult.embedding_recovery?.recommendation.includes(
        "Capture and recall are ready"
      ),
    `onboard flow did not warn on unavailable embeddings: ${JSON.stringify(
      onboardUnavailableResult
    )}`
  );
  const afterOnboardUnavailableRows = await embeddingRows(onboardUnavailable.projectId);
  assert(afterOnboardUnavailableRows.pending_chunks >= 1, JSON.stringify(afterOnboardUnavailableRows));
  assert(afterOnboardUnavailableRows.embedding_rows === 0, JSON.stringify(afterOnboardUnavailableRows));

  const persistent = await createPendingProject("persistent");
  const persistentEnv = {
    ...smokeEnv,
    RECALLANT_DEVELOPER_ID: persistent.developerId,
    RECALLANT_PROJECT_ID: persistent.projectId,
    RECALLANT_PROJECT_PATH: persistent.projectPath
  };
  scenario = { name: "persistent_recovery_failure", statuses: [503, 503, 503], calls: 0 };
  const failedRecovery = await runCli(
    [
      "recover-embeddings",
      "--project-id",
      persistent.projectId,
      "--limit",
      "1",
      "--format",
      "json"
    ],
    persistentEnv
  );
  assert(failedRecovery.status === "pending", JSON.stringify(failedRecovery));
  assert(failedRecovery.warning?.includes("unavailable"), JSON.stringify(failedRecovery));
  const persistentRows = await embeddingRows(persistent.projectId);
  assert(persistentRows.pending_chunks === 1, JSON.stringify(persistentRows));
  assert(persistentRows.embedding_rows === 0, JSON.stringify(persistentRows));

  process.stdout.write(
    `${JSON.stringify(
      {
        pending_embedding_recovery: {
          doctor_before: {
            pending_chunks: doctorBefore.pending_embeddings.pending_chunks,
            recommendation: doctorBefore.pending_embeddings.recommendation
          },
          dashboard_before: {
            pending_embeddings: dashboardBefore.critical.pending_embeddings
          },
          recovery,
          no_duplicate_query: {
            after_recovery: afterRecoveryRows,
            after_second_recovery: afterSecondRows
          },
          onboard_flow_recovery: {
            status: onboardRecovery.embedding_recovery.status,
            pending_before: onboardRecovery.embedding_recovery.pending_before,
            recovered_chunks: onboardRecovery.embedding_recovery.recovered_chunks,
            remaining_pending: onboardRecovery.embedding_recovery.remaining_pending,
            scope: onboardRecovery.embedding_recovery.scope,
            rows: afterOnboardRows
          },
          onboard_flow_unavailable: {
            status: onboardUnavailableResult.embedding_recovery.status,
            pending_before: onboardUnavailableResult.embedding_recovery.pending_before,
            remaining_pending: onboardUnavailableResult.embedding_recovery.remaining_pending,
            recommendation: onboardUnavailableResult.embedding_recovery.recommendation,
            rows: afterOnboardUnavailableRows
          },
          persistent_failure: {
            recovery: failedRecovery,
            rows: persistentRows
          },
          requests: requestLog
        }
      },
      null,
      2
    )}\n`
  );
  process.stdout.write("Pending embedding recovery smoke passed\n");
} finally {
  scenario = null;
  await client.end().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  restoreEnv(envSnapshot);
}
