import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-system-audit-http-${randomUUID()}`;
const token = `http-audit-token-${randomUUID()}`;
const fakeApiKey = `sk-http-audit-${randomUUID().replaceAll("-", "")}`;
const fakeBearer = `Bearer ${randomUUID().replaceAll("-", "")}`;
const fakeCookie = `recallant_session=${randomUUID().replaceAll("-", "")}`;
const fakeJwt = `jwt-${randomUUID().replaceAll("-", "")}`;
const fakeChatBody = `Do not store this raw chat body ${fakeApiKey} ${fakeBearer}`;
const forbiddenMarkers = [
  token,
  fakeApiKey,
  fakeBearer,
  fakeCookie,
  fakeJwt,
  fakeChatBody,
  databaseUrl,
  projectPath
];
const operations = [
  "workbench.review",
  "workbench.api.review_dashboard",
  "workbench.management_chat",
  "workbench.review_action",
  "workbench.settings_update",
  "workbench.project_sanitize"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(value, forbidden) {
  const serialized = JSON.stringify(value);
  return forbidden.some((marker) => serialized.includes(marker));
}

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...extra
  };
}

async function queryHttpRows(sinceIso) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT operation, status, error_code, duration_ms, project_id, related_ids,
               redacted_metadata, trace_id, error_message
        FROM system_activity_events
        WHERE surface = 'workbench_http'
          AND started_at >= $1::timestamptz
          AND operation = ANY($2::text[])
        ORDER BY started_at ASC
      `,
      [sinceIso, operations]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

async function queryHttpRowsUntil(sinceIso, predicate) {
  let rows = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    rows = await queryHttpRows(sinceIso);
    if (predicate(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return rows;
}

async function skippedHealthRowCount(sinceIso) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT count(*)::int AS count
        FROM system_activity_events
        WHERE surface = 'workbench_http'
          AND started_at >= $1::timestamptz
          AND redacted_metadata->>'route_template' = '/health'
      `,
      [sinceIso]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = projectPath;
process.env.RECALLANT_AUTH_TOKEN = token;
process.env.RECALLANT_SESSION_SECRET = `http-audit-session-${randomUUID()}`;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
delete process.env.RECALLANT_CLOUDFLARE_MODE;
delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
delete process.env.RECALLANT_ADMIN_EMAILS;

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
await db.ensureProject(projectPath);
const started = await db.startSession({
  client_kind: "http-audit-smoke",
  project_path: projectPath,
  session_label: "HTTP audit smoke",
  resume_policy: "force_new"
});
const event = await db.appendEvent({
  session_id: started.session_id,
  client_kind: "http-audit-smoke",
  event_kind: "turn_assistant",
  text: "HTTP audit smoke review fixture.",
  metadata: {},
  raw_artifacts: []
});
const memory = await db.createAgentMemory({
  project_path: projectPath,
  memory_type: "decision",
  scope: "project",
  title: "HTTP audit review action fixture",
  body: "This memory exists so the HTTP audit smoke can accept it through Workbench.",
  created_by: "agent",
  source_refs: [
    {
      source_kind: "event",
      source_id: String(event.event_id),
      quote: "HTTP audit smoke review fixture."
    }
  ]
});

const server = createRecallantHttpServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to get HTTP smoke server address");
const baseUrl = `http://127.0.0.1:${address.port}`;
const sinceIso = new Date(Date.now() - 1000).toISOString();

try {
  const health = await fetch(`${baseUrl}/health`, {
    headers: { authorization: fakeBearer, cookie: fakeCookie }
  });
  assert(health.status === 200, `health should remain available: ${health.status}`);
  await health.text();

  const unauthorized = await fetch(`${baseUrl}/review?project_id=${projectId}`, {
    headers: {
      authorization: fakeBearer,
      cookie: fakeCookie,
      "cf-access-jwt-assertion": fakeJwt,
      "cf-access-authenticated-user-email": "owner@example.test"
    }
  });
  assert(unauthorized.status === 401, `unauthorized review should return 401: ${unauthorized.status}`);
  await unauthorized.text();

  const review = await fetch(`${baseUrl}/review?project_id=${projectId}&view=review`, {
    headers: authHeaders()
  });
  assert(review.status === 200, `review page failed: ${review.status}`);
  await review.text();

  const dashboard = await fetch(`${baseUrl}/api/review-dashboard?project_id=${projectId}`, {
    headers: authHeaders()
  });
  assert(dashboard.status === 200, `review dashboard failed: ${dashboard.status}`);
  await dashboard.text();

  const chat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ project_id: projectId, message: fakeChatBody })
  });
  assert(chat.status === 200, `management chat failed: ${chat.status}`);
  await chat.text();

  const reviewAction = await fetch(`${baseUrl}/api/review-action`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      memory_id: memory.memory_id,
      action: "accept",
      actor_kind: "user",
      note: "HTTP audit smoke accepted this memory."
    })
  });
  assert(reviewAction.status === 200, `review action failed: ${reviewAction.status}`);
  await reviewAction.text();

  const setting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      project_id: projectId,
      key: "review_sensitivity",
      value: "strict",
      reason: `HTTP audit setting smoke ${fakeApiKey}`,
      actor_kind: "user",
      confirmation: { confirmed: true }
    })
  });
  assert(setting.status === 200, `project setting failed: ${setting.status}`);
  await setting.text();

  const sanitize = await fetch(`${baseUrl}/api/project-sanitize`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      project_id: projectId,
      mode: "purge",
      reason: `HTTP audit sanitize dry-run ${fakeApiKey}`,
      confirmation: { confirmed: false }
    })
  });
  assert(sanitize.status === 200, `project sanitize failed: ${sanitize.status}`);
  await sanitize.text();

  const rows = await queryHttpRowsUntil(sinceIso, (candidateRows) =>
    candidateRows.some(
      (row) => row.operation === "workbench.project_sanitize" && row.status === "success"
    )
  );
  const routeCoverage = {
    unauthorized_review: rows.some(
      (row) =>
        row.operation === "workbench.review" &&
        row.status === "skipped" &&
        row.error_code === "HTTP_401"
    ),
    review_page: rows.some(
      (row) =>
        row.operation === "workbench.review" &&
        row.status === "success" &&
        row.project_id === projectId
    ),
    review_dashboard: rows.some(
      (row) => row.operation === "workbench.api.review_dashboard" && row.status === "success"
    ),
    management_chat: rows.some(
      (row) => row.operation === "workbench.management_chat" && row.status === "success"
    ),
    review_action: rows.some(
      (row) => row.operation === "workbench.review_action" && row.status === "success"
    ),
    settings_update: rows.some(
      (row) => row.operation === "workbench.settings_update" && row.status === "success"
    ),
    project_sanitize: rows.some(
      (row) => row.operation === "workbench.project_sanitize" && row.status === "success"
    )
  };
  for (const [route, covered] of Object.entries(routeCoverage)) {
    assert(covered, `missing HTTP audit coverage for ${route}: ${JSON.stringify(rows)}`);
  }
  assert(!containsAny(rows, forbiddenMarkers), "HTTP audit rows leaked raw sensitive markers");
  const healthAuditRows = await skippedHealthRowCount(sinceIso);
  assert(healthAuditRows === 0, `health route should be skipped by audit policy: ${healthAuditRows}`);

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        route_coverage: routeCoverage,
        row_count: rows.length,
        unauthorized_row: rows
          .filter((row) => row.operation === "workbench.review" && row.error_code === "HTTP_401")
          .map((row) => ({
            operation: row.operation,
            status: row.status,
            error_code: row.error_code,
            auth_mode: row.redacted_metadata?.auth_mode,
            header_flags: {
              access_header_seen: row.redacted_metadata?.headers?.access_header_seen,
              browser_session_header_seen:
                row.redacted_metadata?.headers?.browser_session_header_seen,
              edge_assertion_header_seen: row.redacted_metadata?.headers?.edge_assertion_header_seen
            }
          }))[0],
        redaction: {
          raw_marker_count: 0,
          stores_body_text: false,
          stores_auth_material: false
        },
        skip_policy: {
          health_static_noisy: "health, favicon, and robots probes are skipped",
          health_audit_row_count: healthAuditRows
        }
      },
      null,
      2
    )}\n`
  );
} finally {
  server.close();
  await db.close();
}
