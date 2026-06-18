import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  RecallantDb,
  redactSystemActivityValue,
  redactedSystemActivityObject
} from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const requiredColumns = [
  "id",
  "trace_id",
  "parent_trace_id",
  "developer_id",
  "project_id",
  "session_id",
  "surface",
  "operation",
  "actor_kind",
  "actor_id",
  "client_kind",
  "client_version",
  "status",
  "duration_ms",
  "error_code",
  "error_message",
  "related_ids",
  "redacted_metadata",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at"
];
const requiredIndexes = [
  "idx_system_activity_project_time",
  "idx_system_activity_trace",
  "idx_system_activity_parent_trace",
  "idx_system_activity_surface_status_time",
  "idx_system_activity_error_time"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(value, forbidden) {
  const serialized = JSON.stringify(value);
  return forbidden.some((marker) => serialized.includes(marker));
}

const fakeApiKey = `sk-schema-redaction-${randomUUID().replaceAll("-", "")}`;
const fakeBearer = `Bearer ${randomUUID().replaceAll("-", "")}`;
const fakePassword = `fixture-password-${randomUUID().slice(0, 8)}`;
const fakeCookie = `sid=${randomUUID().replaceAll("-", "")}`;
const fakeDatabaseUrl = `postgres://recallant:${fakePassword}@127.0.0.1/recallant_agent_work`;
const fakePath = `/tmp/recallant-system-audit-${randomUUID()}`;
const forbiddenMarkers = [fakeApiKey, fakeBearer, fakePassword, fakeCookie, fakeDatabaseUrl, fakePath];
const redactionFixture = {
  args: ["onboard", fakePath, "--provider-api-key", fakeApiKey],
  headers: {
    authorization: fakeBearer,
    cookie: fakeCookie
  },
  paths: {
    project_path: fakePath,
    relative_hint: "docs/RUNBOOK.md"
  },
  database_url: fakeDatabaseUrl,
  nested: {
    password: fakePassword,
    note: `failed with token=${fakeBearer}`
  }
};
const redactedFixture = redactedSystemActivityObject(redactionFixture);
assert(!containsAny(redactedFixture, forbiddenMarkers), "redaction fixture leaked raw values");

const client = new pg.Client({ connectionString: databaseUrl });
const db = new RecallantDb({ databaseUrl });

await client.connect();
try {
  await db.ensureSystemActivitySchema();
  const started = await db.startSystemActivity({
    surface: "schema_smoke",
    operation: "redaction_contract",
    actor_kind: "system",
    actor_id: "system-audit-schema-smoke",
    client_kind: "smoke",
    client_version: "schema",
    related_ids: {
      project_path: fakePath,
      request_id: randomUUID()
    },
    metadata: redactionFixture
  });
  const finished = await db.finishSystemActivity({
    id: started.id,
    status: "error",
    error_code: "schema_smoke_redaction",
    error_message: `connection failed for ${fakeDatabaseUrl} with ${fakeBearer}`,
    metadata: {
      retry_headers: { authorization: fakeBearer, cookie: fakeCookie },
      raw_error_path: fakePath
    }
  });
  assert(finished, "finishSystemActivity did not return the updated row");
  assert(finished?.status === "error", "activity status was not updated");
  assert(typeof finished?.duration_ms === "number", "activity duration was not recorded");

  const columns = await client.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'system_activity_events'
      ORDER BY ordinal_position
    `
  );
  const columnNames = columns.rows.map((row) => row.column_name);
  const missingColumns = requiredColumns.filter((column) => !columnNames.includes(column));
  assert(missingColumns.length === 0, `system_activity_events missing: ${missingColumns.join(", ")}`);

  const indexes = await client.query(
    `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'system_activity_events'
      ORDER BY indexname
    `
  );
  const indexNames = indexes.rows.map((row) => row.indexname);
  const missingIndexes = requiredIndexes.filter((indexName) => !indexNames.includes(indexName));
  assert(missingIndexes.length === 0, `system_activity_events missing indexes: ${missingIndexes.join(", ")}`);

  const stored = await client.query(
    `
      SELECT related_ids, redacted_metadata, error_message
      FROM system_activity_events
      WHERE id = $1
    `,
    [started.id]
  );
  const row = stored.rows[0];
  assert(row, "system activity smoke row was not stored");
  assert(!containsAny(row, forbiddenMarkers), "system activity row leaked raw values");

  const redactedError = redactSystemActivityValue(`Bearer ${fakePassword}`);
  assert(String(redactedError).includes("[REDACTED]"), "error text redaction did not redact");

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        table: "system_activity_events",
        column_count: columnNames.length,
        required_columns: requiredColumns,
        indexes: indexNames.filter((indexName) => indexName.startsWith("idx_system_activity_")),
        activity: {
          id_recorded: Boolean(started.id),
          trace_recorded: Boolean(started.trace_id),
          finish_status: finished?.status,
          duration_recorded: typeof finished?.duration_ms === "number",
          redaction_forbidden_marker_count: 0
        },
        redaction_fixture: {
          before_keys: Object.keys(redactionFixture),
          after: redactedFixture
        }
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
  await client.end();
}
