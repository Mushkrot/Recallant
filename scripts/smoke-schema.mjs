import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const client = new pg.Client({ connectionString: databaseUrl });

const db = new RecallantDb({ databaseUrl });

async function requireIndex(indexName) {
  const result = await client.query("SELECT to_regclass($1) AS index_name", [indexName]);
  assert(result.rows[0]?.index_name === indexName, `Missing required index: ${indexName}`);
}

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

try {
  await db.ensureGraphCandidateSchema();
  await db.ensureGraphCandidateSchema();

  await client.connect();
  const extensions = await client.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')"
  );
  const extensionNames = new Set(extensions.rows.map((row) => row.extname));
  assert(extensionNames.has("vector"), "pgvector extension is missing");
  assert(extensionNames.has("pgcrypto"), "pgcrypto extension is missing");

  const projects = await tableColumns("projects");
  requireColumns("projects", projects, ["parent_project_id", "project_kind", "memory_domain"]);

  const projectSources = await tableColumns("project_sources");
  requireColumns("project_sources", projectSources, [
    "project_id",
    "source_kind",
    "label",
    "uri",
    "is_primary",
    "status",
    "metadata"
  ]);

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

  const graphCandidates = await tableColumns("graph_candidates");
  requireColumns("graph_candidates", graphCandidates, [
    "project_id",
    "developer_id",
    "candidate_kind",
    "node_kind",
    "relation_type",
    "src_endpoint",
    "dst_endpoint",
    "title",
    "summary",
    "lifecycle_state",
    "confidence",
    "extraction_method",
    "created_by",
    "scope",
    "scope_kind",
    "scope_id",
    "audience",
    "metadata",
    "created_at",
    "updated_at"
  ]);

  const graphCandidateSourceRefs = await tableColumns("graph_candidate_source_refs");
  requireColumns("graph_candidate_source_refs", graphCandidateSourceRefs, [
    "graph_candidate_id",
    "source_kind",
    "source_id",
    "uri",
    "path",
    "anchor",
    "quote",
    "metadata",
    "created_at"
  ]);

  const graphCandidateReviewActions = await tableColumns("graph_candidate_review_actions");
  requireColumns("graph_candidate_review_actions", graphCandidateReviewActions, [
    "graph_candidate_id",
    "action",
    "actor_kind",
    "note",
    "metadata",
    "created_at"
  ]);

  const requiredTables = [
    "agent_memories",
    "agent_memory_source_refs",
    "agent_memory_review_actions",
    "graph_candidates",
    "graph_candidate_source_refs",
    "graph_candidate_review_actions",
    "recall_traces",
    "system_settings",
    "developer_settings",
    "project_settings",
    "session_overrides",
    "client_adapter_settings",
    "settings_audit_events",
    "project_sources"
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

  await requireIndex("idx_graph_candidates_project_lifecycle");
  await requireIndex("idx_graph_candidate_source_refs_candidate");
} finally {
  await client.end().catch(() => {});
  await db.close();
}

process.stdout.write("Schema smoke passed\n");
