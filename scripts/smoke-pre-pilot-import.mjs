import { spawnSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const developerId = randomUUID();
const fixtureSource = join(repoRoot, "tests", "fixtures", "pre-pilot-discovery");
const projectDir = await mkdtemp(join(tmpdir(), "recallant-prepilot-import-"));
await cp(fixtureSource, projectDir, { recursive: true });

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_EMBEDDING_PROVIDER: "deterministic",
      RECALLANT_EMBEDDING_DIMS: "8"
    },
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

const envPreview = runJson(["import", "--dry-run", ".env.example", "--project-dir", projectDir]);
if (JSON.stringify(envPreview).includes("fixture-secret-value")) {
  throw new Error(`Import dry-run leaked secret value: ${JSON.stringify(envPreview)}`);
}

const envImport = runJson(["import", ".env.example", "--project-dir", projectDir]);
if (
  envImport.writes_memory !== true ||
  envImport.write_result?.status !== "created" ||
  envImport.write_result?.chunk_ids?.length < 1 ||
  envImport.write_result?.memory_ids?.length !== 1 ||
  JSON.stringify(envImport).includes("fixture-secret-value") ||
  JSON.stringify(envImport).includes("fixture-password")
) {
  throw new Error(`Confirmed env import failed: ${JSON.stringify(envImport)}`);
}

const envDuplicate = runJson(["import", ".env.example", "--project-dir", projectDir]);
if (
  envDuplicate.write_result?.status !== "duplicate" ||
  envDuplicate.write_result?.event_id !== envImport.write_result.event_id
) {
  throw new Error(`Import idempotency failed: ${JSON.stringify(envDuplicate)}`);
}

const handoffImport = runJson(["import", "PROJECT_LOG.md", "--project-dir", projectDir]);
if (
  handoffImport.write_result?.status !== "created" ||
  handoffImport.result_classes.includes("handoff_checkpoint") !== true
) {
  throw new Error(`Handoff import failed: ${JSON.stringify(handoffImport)}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE id = $1 AND kind = 'import_batch') AS env_event_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS env_raw_artifacts,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $1) AS env_chunks,
        (SELECT string_agg(text, E'\n') FROM chunks WHERE source_event_id = $1) AS env_chunk_text,
        (SELECT count(*)::int FROM events WHERE id = $2 AND kind = 'import_batch') AS handoff_event_count,
        (SELECT count(*)::int FROM chunks WHERE source_event_id = $2) AS handoff_chunks,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', m.id,
            'status', m.status,
            'use_policy', m.use_policy,
            'created_by', m.created_by,
            'source_ref_count', (
              SELECT count(*)::int FROM agent_memory_source_refs r WHERE r.memory_id = m.id
            )
          ))
          FROM agent_memories m
          WHERE m.id = ANY($3::uuid[])
        ) AS memories
    `,
    [
      envImport.write_result.event_id,
      handoffImport.write_result.event_id,
      [...envImport.write_result.memory_ids, ...handoffImport.write_result.memory_ids]
    ]
  );
  const row = checks.rows[0];
  const memories = row.memories ?? [];
  if (
    row.env_event_count !== 1 ||
    row.env_raw_artifacts !== 1 ||
    row.env_chunks < 1 ||
    row.handoff_event_count !== 1 ||
    row.handoff_chunks < 1 ||
    memories.length !== 2
  ) {
    throw new Error(`Import DB records missing: ${JSON.stringify(row)}`);
  }
  if (
    String(row.env_chunk_text).includes("fixture-secret-value") ||
    String(row.env_chunk_text).includes("fixture-password")
  ) {
    throw new Error(`Imported chunk leaked secret value: ${row.env_chunk_text}`);
  }
  for (const memory of memories) {
    if (
      memory.created_by !== "import" ||
      memory.use_policy === "instruction_grade" ||
      !["candidate", "needs_review"].includes(memory.status) ||
      memory.source_ref_count < 1
    ) {
      throw new Error(`Imported memory policy failed: ${JSON.stringify(memories)}`);
    }
  }
} finally {
  await client.end();
}

process.stdout.write("Pre-Pilot import smoke passed\n");
