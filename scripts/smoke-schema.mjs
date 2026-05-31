import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const client = new pg.Client({ connectionString: databaseUrl });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function tableColumns(tableName) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function requireColumns(tableName, actual, expected) {
  const missing = expected.filter((column) => !actual.has(column));
  assert(missing.length === 0, `${tableName} missing columns: ${missing.join(", ")}`);
}

await client.connect();
try {
  const extensions = await client.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')"
  );
  const extensionNames = new Set(extensions.rows.map((row) => row.extname));
  assert(extensionNames.has("vector"), "pgvector extension is missing");
  assert(extensionNames.has("pgcrypto"), "pgcrypto extension is missing");

  const projects = await tableColumns("projects");
  requireColumns("projects", projects, ["parent_project_id", "project_kind", "memory_domain"]);

  const rawArtifacts = await tableColumns("raw_artifacts");
  requireColumns("raw_artifacts", rawArtifacts, [
    "source_event_id",
    "storage_backend",
    "uri",
    "sha256",
    "metadata"
  ]);

  const sessions = await tableColumns("sessions");
  requireColumns("sessions", sessions, [
    "last_heartbeat_at",
    "heartbeat_status",
    "heartbeat_metadata"
  ]);

  const chunks = await tableColumns("chunks");
  requireColumns("chunks", chunks, ["scope_kind", "scope_id", "audience"]);

  const agentMemories = await tableColumns("agent_memories");
  requireColumns("agent_memories", agentMemories, ["scope_kind", "scope_id", "audience"]);

  const requiredTables = [
    "agent_memories",
    "agent_memory_source_refs",
    "agent_memory_review_actions",
    "recall_traces",
    "system_settings",
    "developer_settings",
    "project_settings",
    "session_overrides",
    "client_adapter_settings",
    "settings_audit_events"
  ];
  const tables = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [requiredTables]
  );
  const presentTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((tableName) => !presentTables.has(tableName));
  assert(missingTables.length === 0, `Missing required tables: ${missingTables.join(", ")}`);
} finally {
  await client.end();
}

process.stdout.write("Schema smoke passed\n");
