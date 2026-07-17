import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import pg from "pg";
import { assertSafeRehearsalDatabase } from "./recallant-backup-safety.mjs";

const baseDatabaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const baseUrl = new URL(baseDatabaseUrl);
const postgresUser = decodeURIComponent(baseUrl.username);
const containerName =
  process.env.RECALLANT_POSTGRES_CONTAINER_NAME ??
  (baseUrl.port === "15433" ? "recallant-dev-postgres-1" : "recallant-postgres");
const testDatabase = `recallant_backup_smoke_${randomUUID().replaceAll("-", "_")}`;
const searchNeedle = "portable-quartz-signal";
const backupRoot = await mkdtemp(join(tmpdir(), "recallant-phase8-native-backup-"));

function urlFor(databaseName) {
  const parsed = new URL(baseDatabaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return result;
}

function runJson(command, args, env = {}) {
  const result = run(command, args, env);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const admin = new pg.Client({ connectionString: urlFor("postgres") });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${testDatabase}" TEMPLATE template0`);
  const databaseUrl = urlFor(testDatabase);
  const migration = await readFile("packages/db/migrations/0001_initial.sql", "utf8");
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query(migration);
    const developerId = randomUUID();
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const eventId = randomUUID();
    await database.query("INSERT INTO developers (id, name) VALUES ($1, $2)", [
      developerId,
      "Backup smoke developer"
    ]);
    await database.query(
      "INSERT INTO projects (id, developer_id, name, primary_path) VALUES ($1, $2, $3, $4)",
      [projectId, developerId, "Backup smoke project", "/tmp/recallant-backup-smoke"]
    );
    await database.query(
      "INSERT INTO project_sources (project_id, source_kind, label, is_primary) VALUES ($1, 'workspace_path', $2, true)",
      [projectId, "smoke source"]
    );
    await database.query(
      "INSERT INTO sessions (id, project_id, client_kind) VALUES ($1, $2, 'codex')",
      [sessionId, projectId]
    );
    await database.query(
      "INSERT INTO events (id, project_id, session_id, ingest_source, kind, occurred_at, payload) VALUES ($1, $2, $3, 'smoke', 'turn_user', now(), $4)",
      [eventId, projectId, sessionId, JSON.stringify({ text: searchNeedle })]
    );
    await database.query(
      "INSERT INTO chunks (project_id, developer_id, source_event_id, text, chunk_index) VALUES ($1, $2, $3, $4, 0)",
      [projectId, developerId, eventId, searchNeedle]
    );
    await database.query("INSERT INTO checkpoints (project_id, payload) VALUES ($1, $2)", [
      projectId,
      JSON.stringify({ current_status: "backup smoke" })
    ]);
    await database.query(
      "INSERT INTO agent_memories (developer_id, project_id, memory_type, title, body, created_by) VALUES ($1, $2, 'work_log', $3, $4, 'agent')",
      [developerId, projectId, "Backup smoke", searchNeedle]
    );
    await database.query(
      `
        INSERT INTO agent_observations (
          project_id, developer_id, session_id, run_id, turn_id, trace_id,
          source_event_id, sequence_number, run_sequence_number, kind, status,
          occurred_at, title, body, resolution_status, capture_profile, client_kind
        )
        VALUES ($1, $2, $3, $3, $4, $5, $6, 1, 1, 'user_prompt', 'success',
                now(), 'Backup observation', $7, 'not_applicable', 'standard', 'codex')
      `,
      [projectId, developerId, sessionId, randomUUID(), randomUUID(), eventId, searchNeedle]
    );
  } finally {
    await database.end();
  }

  const env = {
    RECALLANT_DATABASE_URL: databaseUrl,
    POSTGRES_DB: testDatabase,
    POSTGRES_USER: postgresUser,
    RECALLANT_POSTGRES_CONTAINER_NAME: containerName,
    RECALLANT_BACKUP_TARGET: backupRoot,
    RECALLANT_DATA_DIR: dirname(backupRoot)
  };
  const beforeRehearsals = await admin.query(
    "SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'recallant_rehearsal_%'"
  );
  const report = runJson("sh", ["scripts/recallant-production-backup.sh"], env);
  assert(report.ok === true, "Native backup did not report success");
  assert(report.backup_kind === "postgresql_custom", "Backup kind is not native PostgreSQL");
  assert(report.restore_verification === "passed", "Relational restore rehearsal did not pass");
  assert(report.production_overwritten === false, "Production overwrite safety flag failed");
  assert(report.production_fingerprint_unchanged === true, "Production fingerprint changed");
  assert(report.disposable_database_removed === true, "Disposable database was not removed");
  assert(report.missing_tables.length === 0, "Restored database is missing source tables");
  assert(report.unexpected_tables.length === 0, "Restored database has unexpected tables");
  assert(report.row_count_mismatches.length === 0, "Restored row counts differ from source");
  assert(
    Object.values(report.schema_probes).every(Boolean),
    `Schema probes failed: ${JSON.stringify(report.schema_probes)}`
  );
  assert(
    Object.values(report.semantic_probes).every(Boolean),
    `Semantic probes failed: ${JSON.stringify(report.semantic_probes)}`
  );
  assertSafeRehearsalDatabase(`recallant_rehearsal_${"a".repeat(32)}`, testDatabase);
  let productionTargetRejected = false;
  try {
    assertSafeRehearsalDatabase(testDatabase, testDatabase);
  } catch {
    productionTargetRejected = true;
  }
  assert(productionTargetRejected, "Production database target was not rejected");

  const manifest = JSON.parse(await readFile(report.manifest_path, "utf8"));
  const dumpPath = join(dirname(report.manifest_path), manifest.artifact.path);
  const dumpHeader = (await readFile(dumpPath)).subarray(0, 5).toString("ascii");
  assert(dumpHeader === "PGDMP", "Artifact is not PostgreSQL custom format");
  const manifestMode = (await stat(report.manifest_path)).mode & 0o777;
  const dumpMode = (await stat(dumpPath)).mode & 0o777;
  const backupDirMode = (await stat(dirname(report.manifest_path))).mode & 0o777;
  assert(manifestMode === 0o600, `Manifest mode is ${manifestMode.toString(8)}`);
  assert(dumpMode === 0o600, `Dump mode is ${dumpMode.toString(8)}`);
  assert(backupDirMode === 0o700, `Backup directory mode is ${backupDirMode.toString(8)}`);
  const manifestText = JSON.stringify(manifest);
  assert(!manifestText.includes(baseDatabaseUrl), "Manifest leaked database URL");
  assert(!manifestText.includes(decodeURIComponent(baseUrl.password)), "Manifest leaked credential");
  const canonicalTables = [
    ...migration.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)
  ]
    .map((match) => match[1])
    .sort();
  const coveredTables = manifest.source_table_inventory.map((entry) => entry.table).sort();
  const missingCanonicalTables = canonicalTables.filter((table) => !coveredTables.includes(table));
  assert(missingCanonicalTables.length === 0, `Missing canonical tables: ${missingCanonicalTables}`);
  for (const table of [
    "project_sources",
    "graph_candidates",
    "graph_candidate_source_refs",
    "remote_mcp_credentials",
    "remote_connect_requests",
    "settings_audit_events",
    "system_activity_events",
    "agent_observations"
  ]) {
    assert(coveredTables.includes(table), `Backup inventory omitted ${table}`);
  }

  const logicalRoot = join(backupRoot, "logical");
  await mkdir(logicalRoot, { recursive: true });
  const logicalBackup = runJson(
    process.execPath,
    ["apps/cli/dist/index.js", "backup", "--target", logicalRoot],
    env
  );
  const logicalVerify = runJson(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "backup-verify",
      "--manifest",
      logicalBackup.manifest_path,
      "--query",
      searchNeedle
    ],
    env
  );
  assert(logicalVerify.snapshot_verification === "passed", "Logical integrity did not pass");
  assert(
    logicalVerify.restore_verification === "not_performed",
    "Logical JSON verification falsely claimed relational restore success"
  );

  const explicitEnvFile = join(backupRoot, "explicit.env");
  await writeFile(
    explicitEnvFile,
    [
      `RECALLANT_DATABASE_URL=${databaseUrl}`,
      `POSTGRES_DB=${testDatabase}`,
      `POSTGRES_USER=${postgresUser}`,
      `RECALLANT_POSTGRES_CONTAINER_NAME=${containerName}`,
      `RECALLANT_BACKUP_TARGET=${backupRoot}`,
      `RECALLANT_DATA_DIR=${dirname(backupRoot)}`
    ].join("\n") + "\n",
    { mode: 0o600 }
  );
  const explicitEnvVerify = runJson(
    "sh",
    ["scripts/recallant-production-backup.sh", "--verify-manifest", report.manifest_path],
    {
      RECALLANT_DATABASE_URL: "",
      POSTGRES_DB: "",
      POSTGRES_USER: "",
      RECALLANT_POSTGRES_CONTAINER_NAME: "",
      RECALLANT_BACKUP_TARGET: "",
      RECALLANT_DATA_DIR: "",
      RECALLANT_ENV_FILE: explicitEnvFile
    }
  );
  assert(explicitEnvVerify.restore_verification === "passed", "Explicit env file was not honored");

  const latestBeforeFailure = await readFile(join(backupRoot, "latest-verification.json"), "utf8");
  const corruptDir = join(backupRoot, "corrupt");
  await mkdir(corruptDir, { recursive: true, mode: 0o700 });
  const corruptDump = join(corruptDir, "database.dump");
  const corruptManifest = join(corruptDir, "manifest.json");
  await copyFile(dumpPath, corruptDump);
  await copyFile(report.manifest_path, corruptManifest);
  await chmod(corruptDump, 0o600);
  const handle = await open(corruptDump, "r+");
  try {
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, 0);
    byte[0] ^= 0xff;
    await handle.write(byte, 0, 1, 0);
  } finally {
    await handle.close();
  }
  const corruptResult = run(
    process.execPath,
    ["scripts/recallant-production-backup.mjs", "--verify-manifest", corruptManifest],
    env
  );
  assert(corruptResult.status !== 0, "Corrupt artifact unexpectedly passed verification");
  assert(
    corruptResult.stderr.includes("hash verification failed"),
    "Corrupt artifact did not fail at the hash gate"
  );
  const latestAfterFailure = await readFile(join(backupRoot, "latest-verification.json"), "utf8");
  assert(latestAfterFailure === latestBeforeFailure, "Failed verification advanced latest report");

  const restoreFailureDir = join(backupRoot, "restore-failure");
  await mkdir(restoreFailureDir, { recursive: true, mode: 0o700 });
  const restoreFailureDump = join(restoreFailureDir, "database.dump");
  const restoreFailureManifest = join(restoreFailureDir, "manifest.json");
  await copyFile(dumpPath, restoreFailureDump);
  const restoreFailureHandle = await open(restoreFailureDump, "r+");
  try {
    const bytes = Buffer.from("not-a-valid-postgresql-dump");
    await restoreFailureHandle.truncate(0);
    await restoreFailureHandle.write(bytes, 0, bytes.length, 0);
  } finally {
    await restoreFailureHandle.close();
  }
  const restoreFailureBytes = await readFile(restoreFailureDump);
  const restoreFailureHash = createHash("sha256").update(restoreFailureBytes).digest("hex");
  await writeFile(
    restoreFailureManifest,
    `${JSON.stringify({
      ...manifest,
      artifact: {
        ...manifest.artifact,
        sha256: restoreFailureHash,
        size_bytes: restoreFailureBytes.length
      }
    })}\n`,
    { mode: 0o600 }
  );
  const restoreFailureResult = run(
    process.execPath,
    ["scripts/recallant-production-backup.mjs", "--verify-manifest", restoreFailureManifest],
    env
  );
  assert(restoreFailureResult.status !== 0, "Invalid dump unexpectedly restored");
  assert(
    restoreFailureResult.stderr.includes("pg_restore:"),
    `Restore failure did not reach pg_restore: ${restoreFailureResult.stderr}`
  );
  const latestAfterRestoreFailure = await readFile(
    join(backupRoot, "latest-verification.json"),
    "utf8"
  );
  assert(
    latestAfterRestoreFailure === latestBeforeFailure,
    "Restore failure advanced latest passed verification"
  );

  const afterRehearsals = await admin.query(
    "SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'recallant_rehearsal_%'"
  );
  assert(
    afterRehearsals.rows[0].count === beforeRehearsals.rows[0].count,
    "A disposable rehearsal database was left behind"
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        native_restore: "passed",
        dump_format_header: dumpHeader,
        postgresql_tool_version: manifest.postgresql_tool_version,
        artifact_sha256_verified: report.artifact_sha256_verified,
        file_modes: { directory: "0700", manifest: "0600", artifact: "0600" },
        env_profiles: { preloaded: "passed", explicit_file: "passed" },
        failed_latest_publication: "unchanged",
        logical_restore_claim: logicalVerify.restore_verification,
        canonical_expected_tables: canonicalTables.length,
        covered_tables: coveredTables.length,
        missing_canonical_tables: missingCanonicalTables,
        production_target_rejected_by_namespace_guard: true,
        schema_probes: report.schema_probes,
        semantic_probes: report.semantic_probes,
        source_restored_table_counts: {
          source: report.source_table_count,
          restored: report.restored_table_count,
          mismatches: report.row_count_mismatches
        },
        production_fingerprint_unchanged: report.production_fingerprint_unchanged,
        disposable_cleanup_success: true,
        disposable_cleanup_failure: true,
        corrupt_artifact_rejected: true,
        restore_failure_rejected: true
      },
      null,
      2
    )}\nPhase 8 backup smoke passed\n`
  );
} finally {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [testDatabase]
  );
  await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  await admin.end();
}
