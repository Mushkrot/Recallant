import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const otherProjectId = randomUUID();
const projectPath = `/tmp/recallant-system-audit-report-${randomUUID()}`;
const otherProjectPath = `/tmp/recallant-system-audit-report-other-${randomUUID()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function commandEnv(extra = {}) {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: "",
    RECALLANT_PROJECT_PATH: "",
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    ...extra
  };
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(options.env),
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  const expectedStatus = options.expectedStatus ?? 0;
  if (result.status !== expectedStatus) {
    throw new Error(
      `Command status ${result.status}, expected ${expectedStatus}: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

function runCliJson(args, options = {}) {
  return JSON.parse(runCli(args, options));
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedActivity(db, input, finish) {
  const started = await db.startSystemActivity({
    actor_kind: "system",
    actor_id: "system-audit-report-smoke",
    client_kind: "smoke",
    project_id: projectId,
    ...input
  });
  if (finish) {
    await db.finishSystemActivity({ id: started.id, ...finish });
  }
  return started;
}

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
const otherDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: otherProjectId,
  projectPath: otherProjectPath
});
await db.ensureProject(projectPath);
await otherDb.ensureProject(otherProjectPath);
const session = await db.startSession({
  client_kind: "report-smoke",
  project_path: projectPath,
  session_label: "system audit report smoke",
  resume_policy: "force_new"
});
const event = await db.appendEvent({
  session_id: session.session_id,
  client_kind: "report-smoke",
  event_kind: "tool_result",
  text: "System audit report smoke event.",
  metadata: {},
  raw_artifacts: []
});
await db.setCheckpoint(projectId, {
  current_focus: "system audit report smoke",
  next_step: "verify report filters"
});
const success = await seedActivity(
  db,
  { surface: "mcp", operation: "memory_start_session", session_id: session.session_id },
  { status: "success", metadata: { smoke: "success" } }
);
await seedActivity(
  db,
  { surface: "cli", operation: "onboard", session_id: session.session_id },
  { status: "error", error_code: "OLLAMA_UNAVAILABLE", metadata: { smoke: "error" } }
);
await seedActivity(
  db,
  { surface: "workbench_http", operation: "workbench.review", session_id: session.session_id },
  { status: "skipped", error_code: "HTTP_401", metadata: { status_code: 401 } }
);
await seedActivity(db, { surface: "cli", operation: "agent-event", session_id: session.session_id }, null);
const old = await seedActivity(
  db,
  { surface: "cli", operation: "old.outside_default_window", session_id: session.session_id },
  { status: "success", metadata: { smoke: "old" } }
);
await otherDb.startSystemActivity({
  surface: "cli",
  operation: "other.project",
  project_id: otherProjectId,
  actor_kind: "system",
  actor_id: "other-project-smoke"
});
const oldIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
await withClient(async (client) => {
  await client.query(
    `
      UPDATE system_activity_events
      SET started_at = $2::timestamptz,
          finished_at = $2::timestamptz + interval '1 second',
          updated_at = $2::timestamptz + interval '1 second'
      WHERE id = $1
    `,
    [old.id, oldIso]
  );
  await client.query(
    `
      INSERT INTO model_calls (
        developer_id, project_id, session_id, memory_domain, route_class, provider, model, purpose,
        routing_reason, confirmation_status, latency_ms, status, error_code, metadata
      )
      VALUES ($1, $2, $3, 'agent_work', 'local_model', 'ollama', 'nomic-embed-text',
              'report smoke', 'system audit report smoke', 'not_required', 42, 'failed',
              'OLLAMA_UNAVAILABLE', '{}'::jsonb)
    `,
    [developerId, projectId, session.session_id]
  );
  await client.query(
    `
      INSERT INTO recall_traces (
        developer_id, project_id, session_id, tool_name, query, returned_chunk_ids,
        returned_memory_ids, metadata
      )
      VALUES ($1, $2, $3, 'report_smoke', 'report smoke query', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)
    `,
    [developerId, projectId, session.session_id]
  );
  await client.query(
    `
      INSERT INTO chunks (
        project_id, developer_id, source_event_id, text, chunk_index, embed_status
      )
      VALUES ($1, $2, $3, 'pending embedding report smoke chunk', 99, 'pending')
    `,
    [projectId, developerId, event.event_id]
  );
});

const jsonReport = runCliJson([
  "audit",
  "--project-id",
  projectId,
  "--format",
  "json",
  "--limit",
  "50"
]);
assert(jsonReport.summary?.total >= 4, `audit JSON summary missing rows: ${JSON.stringify(jsonReport.summary)}`);
assert(Array.isArray(jsonReport.timeline), "audit JSON missing timeline");
assert(Array.isArray(jsonReport.failures), "audit JSON missing failures");
assert(jsonReport.model_provider?.failed_calls >= 1, `audit JSON missing model failure: ${JSON.stringify(jsonReport.model_provider)}`);
assert(jsonReport.capture?.pending_embeddings >= 1, `audit JSON missing pending embeddings: ${JSON.stringify(jsonReport.capture)}`);
assert(Array.isArray(jsonReport.recommendations), "audit JSON missing recommendations");
assert(
  jsonReport.timeline.some((row) => row.activity_id && row.trace_id && row.links?.activity_id),
  "timeline rows do not include traceable ids"
);
assert(
  !jsonReport.timeline.some((row) => row.operation === "old.outside_default_window"),
  "default bounded window included old activity"
);
assert(
  !jsonReport.timeline.some((row) => row.operation === "other.project"),
  "project filter included other project rows"
);

const byProjectDir = runCliJson([
  "audit",
  "--project-dir",
  projectPath,
  "--format",
  "json",
  "--limit",
  "50"
]);
assert(
  byProjectDir.filters?.project_id === projectId && byProjectDir.summary?.total >= 4,
  `project-dir filter failed: ${JSON.stringify(byProjectDir.filters)}`
);

const surfaceFilter = runCliJson([
  "audit",
  "--project-id",
  projectId,
  "--surface",
  "cli",
  "--format",
  "json",
  "--limit",
  "50"
]);
assert(
  surfaceFilter.timeline.length > 0 && surfaceFilter.timeline.every((row) => row.surface === "cli"),
  `surface filter failed: ${JSON.stringify(surfaceFilter.timeline)}`
);

const statusFilter = runCliJson([
  "audit",
  "--project-id",
  projectId,
  "--status",
  "error",
  "--format",
  "json",
  "--limit",
  "50"
]);
assert(
  statusFilter.timeline.length > 0 && statusFilter.timeline.every((row) => row.status === "error"),
  `status filter failed: ${JSON.stringify(statusFilter.timeline)}`
);

const wideWindow = runCliJson([
  "audit",
  "--project-id",
  projectId,
  "--since",
  new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  "--until",
  new Date(Date.now() + 60_000).toISOString(),
  "--format",
  "json",
  "--limit",
  "50"
]);
assert(
  wideWindow.timeline.some((row) => row.operation === "old.outside_default_window"),
  "explicit since/until window did not include old activity"
);

const textReport = runCli([
  "audit",
  "--project-id",
  projectId,
  "--format",
  "text",
  "--limit",
  "8"
]);
for (const marker of [
  "Recallant audit report",
  "Summary",
  "Failures",
  "Model/provider",
  "Recommendations",
  "JSON output: recallant audit --format json"
]) {
  assert(textReport.includes(marker), `text report missing ${marker}: ${textReport}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      json_excerpt: {
        summary: jsonReport.summary,
        failure_count: jsonReport.failures.length,
        model_provider: jsonReport.model_provider,
        capture: jsonReport.capture,
        recommendation_count: jsonReport.recommendations.length,
        first_timeline_row: jsonReport.timeline[0]
      },
      text_excerpt: textReport.split("\n").slice(0, 18),
      filters: {
        project_id_total: jsonReport.summary.total,
        project_dir_project_id: byProjectDir.filters.project_id,
        surface_filter_surfaces: [...new Set(surfaceFilter.timeline.map((row) => row.surface))],
        status_filter_statuses: [...new Set(statusFilter.timeline.map((row) => row.status))],
        explicit_time_included_old_row: wideWindow.timeline.some(
          (row) => row.operation === "old.outside_default_window"
        ),
        default_time_excluded_old_row: !jsonReport.timeline.some(
          (row) => row.operation === "old.outside_default_window"
        )
      },
      traceable_ids_present: Boolean(success.id)
    },
    null,
    2
  )}\n`
);

await db.close();
await otherDb.close();
