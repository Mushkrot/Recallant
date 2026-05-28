import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const repoRoot = process.cwd();

const developerId = randomUUID();
const projectId = randomUUID();
const sessionId = randomUUID();
const oldEventId = randomUUID();
const duplicateEventId = randomUUID();
const replacementEventId = randomUUID();
const oldChunkId = randomUUID();
const duplicateChunkId = randomUUID();
const replacementChunkId = randomUUID();
const lowValueChunkId = randomUUID();
const lowValueEventId = randomUUID();
const staleMemoryId = randomUUID();
const duplicateMemoryA = randomUUID();
const duplicateMemoryB = randomUUID();
const poorProvenanceMemoryId = randomUUID();
const connectorConflictA = randomUUID();
const connectorConflictB = randomUUID();
const duplicateText = `Phase 9 cleanup duplicate fixture ${randomUUID()}.`;
const duplicateMemoryTitle = `Phase 9 duplicate governed memory ${randomUUID()}`;
const connectorTitle = `Phase 9 connector binding ${randomUUID()}`;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("INSERT INTO developers (id, name) VALUES ($1, 'phase9 cleanup developer')", [
    developerId
  ]);
  await client.query(
    "INSERT INTO projects (id, developer_id, primary_path, name) VALUES ($1, $2, $3, 'phase9-cleanup')",
    [projectId, developerId, `/tmp/recallant-phase9-cleanup-${projectId}`]
  );
  await client.query(
    "INSERT INTO sessions (id, project_id, client_kind, client_version, status) VALUES ($1, $2, 'codex', 'smoke', 'active')",
    [sessionId, projectId]
  );
  await client.query(
    `
      INSERT INTO events (id, project_id, session_id, ingest_source, kind, occurred_at, payload)
      VALUES
        ($1, $4, $5, 'fixture', 'turn_user', now() - interval '400 days', $6),
        ($2, $4, $5, 'fixture', 'turn_user', now() - interval '10 days', $7),
        ($3, $4, $5, 'fixture', 'turn_user', now(), $8),
        ($9, $4, $5, 'fixture', 'turn_user', now() - interval '5 days', $10)
    `,
    [
      oldEventId,
      duplicateEventId,
      replacementEventId,
      projectId,
      sessionId,
      JSON.stringify({ text: "old stale cleanup fixture" }),
      JSON.stringify({ text: duplicateText }),
      JSON.stringify({ text: duplicateText }),
      lowValueEventId,
      JSON.stringify({ text: "ok" })
    ]
  );
  await client.query(
    `
      INSERT INTO chunks (id, project_id, developer_id, source_event_id, text, chunk_index, token_count_est, scope, created_at, last_accessed_at)
      VALUES
        ($1, $4, $5, $6, 'Phase 9 stale cleanup fixture', 0, 20, 'project', now() - interval '400 days', NULL),
        ($2, $4, $5, $7, $9, 0, 20, 'project', now() - interval '10 days', NULL),
        ($3, $4, $5, $8, $9, 0, 20, 'project', now(), now()),
        ($10, $4, $5, $11, 'ok', 0, 1, 'project', now() - interval '5 days', NULL)
    `,
    [
      oldChunkId,
      duplicateChunkId,
      replacementChunkId,
      projectId,
      developerId,
      oldEventId,
      duplicateEventId,
      replacementEventId,
      duplicateText,
      lowValueChunkId,
      lowValueEventId
    ]
  );
  await client.query(
    `
      INSERT INTO edges (project_id, src_kind, src_id, dst_kind, dst_id, relation_type, weight, metadata)
      VALUES ($1, 'chunk', $2, 'chunk', $3, 'supersedes', 1, $4)
    `,
    [projectId, replacementChunkId, duplicateChunkId, JSON.stringify({ smoke: true })]
  );
  await client.query(
    `
      INSERT INTO agent_memories (
        id, developer_id, project_id, scope, scope_kind, scope_id, memory_type, title, body,
        status, use_policy, confidence, created_by
      )
      VALUES
        ($1, $8, $9, 'project', NULL, NULL, 'decision', 'Phase 9 stale governed memory', 'Stale governed memory fixture.', 'stale', 'evidence_only', 0.8, 'agent'),
        ($2, $8, $9, 'project', NULL, NULL, 'decision', $4, 'Duplicate governed memory A.', 'accepted', 'recall_allowed', 0.9, 'agent'),
        ($3, $8, $9, 'project', NULL, NULL, 'decision', $4, 'Duplicate governed memory B.', 'accepted', 'recall_allowed', 0.9, 'agent'),
        ($5, $8, $9, 'project', NULL, NULL, 'decision', 'Phase 9 poor provenance memory', 'No source refs by fixture design.', 'accepted', 'recall_allowed', 0.9, 'user'),
        ($6, $8, $9, 'project', 'connector_account', 'github:owner/repo', 'constraint', $10, 'Use GitHub account alpha.', 'accepted', 'recall_allowed', 0.9, 'user'),
        ($7, $8, $9, 'project', 'connector_account', 'github:owner/repo', 'constraint', $10, 'Use GitHub account beta.', 'accepted', 'recall_allowed', 0.9, 'user')
    `,
    [
      staleMemoryId,
      duplicateMemoryA,
      duplicateMemoryB,
      duplicateMemoryTitle,
      poorProvenanceMemoryId,
      connectorConflictA,
      connectorConflictB,
      developerId,
      projectId,
      connectorTitle
    ]
  );
} finally {
  await client.end();
}

function run(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: { ...process.env, RECALLANT_DATABASE_URL: databaseUrl },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

const analyze = run(["analyze", "--dry-run", "--older-than", "180d", "--not-accessed", "90d"]);
if (
  analyze.ok !== true ||
  analyze.writes_database !== false ||
  analyze.summary.stale_chunks < 1 ||
  analyze.summary.duplicate_chunks < 2 ||
  analyze.summary.superseded_chunks < 1 ||
  analyze.summary.low_value_chunks < 1 ||
  analyze.summary.stale_or_superseded_memories < 1 ||
  analyze.summary.duplicate_memories < 2 ||
  analyze.summary.poor_provenance_memories < 1 ||
  analyze.summary.conflicting_connector_memories < 2
) {
  throw new Error(`Analyze dry-run report failed: ${JSON.stringify(analyze)}`);
}

const cleanup = run([
  "cleanup",
  "--archive",
  "--not-accessed",
  "90d",
  "--older-than",
  "180d",
  "--dry-run"
]);
if (
  cleanup.ok !== true ||
  cleanup.dry_run !== true ||
  cleanup.writes_database !== false ||
  cleanup.candidates.length < 3 ||
  !cleanup.warnings.some((warning) => warning.includes("Dry run only"))
) {
  throw new Error(`Cleanup dry-run report failed: ${JSON.stringify(cleanup)}`);
}

const blockedDelete = spawnSync(
  process.execPath,
  ["apps/cli/dist/index.js", "cleanup", "--delete-archived", "--confirm"],
  {
    cwd: repoRoot,
    env: { ...process.env, RECALLANT_DATABASE_URL: databaseUrl },
    encoding: "utf8"
  }
);
if (blockedDelete.status === 0 || !blockedDelete.stderr.includes("POLICY_BLOCKED")) {
  throw new Error(`Cleanup hard-delete was not policy-blocked: ${blockedDelete.stderr}`);
}

const archived = run([
  "cleanup",
  "--archive",
  "--confirm",
  "--not-accessed",
  "90d",
  "--older-than",
  "180d"
]);
if (
  archived.ok !== true ||
  archived.dry_run !== false ||
  archived.writes_database !== true ||
  !archived.archived_chunk_ids.includes(oldChunkId) ||
  !archived.archived_chunk_ids.includes(duplicateChunkId)
) {
  throw new Error(`Cleanup archive execution failed: ${JSON.stringify(archived)}`);
}

const verify = new pg.Client({ connectionString: databaseUrl });
await verify.connect();
try {
  const checks = await verify.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE id = ANY($1::uuid[])) AS event_count,
        (SELECT count(*)::int FROM chunks WHERE id = ANY($2::uuid[]) AND archived_at IS NOT NULL) AS archived_chunk_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = ANY($1::uuid[])) AS raw_artifact_count
    `,
    [
      [oldEventId, duplicateEventId, replacementEventId],
      [oldChunkId, duplicateChunkId, replacementChunkId]
    ]
  );
  const row = checks.rows[0];
  if (row.event_count !== 3 || row.archived_chunk_count < 2 || row.raw_artifact_count !== 0) {
    throw new Error(`Cleanup archive changed wrong data: ${JSON.stringify(row)}`);
  }
} finally {
  await verify.end();
}

process.stdout.write("Phase 9 cleanup smoke passed\n");
