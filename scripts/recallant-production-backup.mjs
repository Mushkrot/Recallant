import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { URL } from "node:url";
import pg from "pg";
import { assertSafeRehearsalDatabase } from "./recallant-backup-safety.mjs";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const containerPattern = /^[A-Za-z0-9_.-]+$/;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!identifierPattern.test(name)) throw new Error("Configured database name is invalid");
  return name;
}

function databaseUrlFor(databaseUrl, databaseName) {
  if (!identifierPattern.test(databaseName)) throw new Error("Database name is invalid");
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error("Unsafe SQL identifier");
  return `"${value}"`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${command} failed (${result.status})${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeJsonAtomic(path, value, mode = 0o600) {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporaryPath, path);
  await chmod(path, mode);
}

async function inventory(client) {
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  const rows = [];
  for (const { tablename } of tables.rows) {
    if (!identifierPattern.test(tablename)) throw new Error("Unsafe table name in database inventory");
    const count = await client.query(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(tablename)}`);
    rows.push({ table: tablename, rows: String(count.rows[0]?.count ?? "0") });
  }
  return rows;
}

function inventoryFingerprint(rows) {
  return `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
}

function compareInventories(expected, restored) {
  const restoredByTable = new Map(restored.map((entry) => [entry.table, entry.rows]));
  const expectedNames = new Set(expected.map((entry) => entry.table));
  return {
    missing_tables: expected.filter((entry) => !restoredByTable.has(entry.table)).map((entry) => entry.table),
    unexpected_tables: restored.filter((entry) => !expectedNames.has(entry.table)).map((entry) => entry.table),
    row_count_mismatches: expected
      .filter(
        (entry) => restoredByTable.has(entry.table) && restoredByTable.get(entry.table) !== entry.rows
      )
      .map((entry) => ({
        table: entry.table,
        expected: entry.rows,
        restored: restoredByTable.get(entry.table)
      }))
  };
}

function semanticProbes(expectedRows, restoredRows) {
  const expected = new Map(expectedRows.map((entry) => [entry.table, Number(entry.rows)]));
  const restored = new Map(restoredRows.map((entry) => [entry.table, Number(entry.rows)]));
  const preserved = (table) =>
    restored.has(table) && (Number(expected.get(table) ?? 0) === 0 || Number(restored.get(table)) > 0);
  return {
    projects: preserved("projects"),
    checkpoints: preserved("checkpoints"),
    chunks: preserved("chunks"),
    governed_memories: preserved("agent_memories"),
    agent_observations: preserved("agent_observations"),
    graph: preserved("graph_candidates") && preserved("graph_candidate_source_refs"),
    remote_access: preserved("remote_mcp_credentials") && preserved("remote_connect_requests"),
    settings: preserved("system_settings") && preserved("project_settings"),
    system_activity: preserved("system_activity_events")
  };
}

async function databaseExists(adminClient, databaseName) {
  const result = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  return result.rowCount > 0;
}

async function dropDisposableDatabase(adminClient, databaseName) {
  if (!databaseName.startsWith("recallant_rehearsal_")) {
    throw new Error("Refusing to drop a database outside the rehearsal namespace");
  }
  await adminClient.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName]
  );
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
}

async function restoreRehearsal({
  databaseUrl,
  sourceDatabaseName,
  postgresUser,
  containerName,
  dumpPath,
  expectedInventory,
  expectedSha256,
  sourceClient
}) {
  const actualSha256 = await sha256File(dumpPath);
  if (actualSha256 !== expectedSha256) throw new Error("Backup artifact hash verification failed");

  const rehearsalDatabase = `recallant_rehearsal_${randomUUID().replaceAll("-", "_")}`;
  assertSafeRehearsalDatabase(rehearsalDatabase, sourceDatabaseName);
  const admin = new pg.Client({ connectionString: databaseUrlFor(databaseUrl, "postgres") });
  const containerDumpPath = `/tmp/${basename(dumpPath)}-${randomUUID()}`;
  let restoredInventory = [];
  let schemaProbes = null;
  let removed = false;
  let created = false;
  let cleanupError = null;
  let operationError = null;
  let rehearsalResult = null;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(rehearsalDatabase)} TEMPLATE template0`);
    created = true;
    run("docker", ["cp", dumpPath, `${containerName}:${containerDumpPath}`]);
    run("docker", [
      "exec",
      containerName,
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "-U",
      postgresUser,
      "-d",
      rehearsalDatabase,
      containerDumpPath
    ]);
    const restored = new pg.Client({
      connectionString: databaseUrlFor(databaseUrl, rehearsalDatabase)
    });
    await restored.connect();
    try {
      restoredInventory = await inventory(restored);
      const schemaChecks = await restored.query(`
        SELECT
          (SELECT count(*)::int FROM pg_extension WHERE extname IN ('pgcrypto', 'vector')) AS required_extensions,
          (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS foreign_keys,
          (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public') AS indexes
      `);
      schemaProbes = {
        required_extensions: Number(schemaChecks.rows[0]?.required_extensions ?? 0) === 2,
        foreign_keys: Number(schemaChecks.rows[0]?.foreign_keys ?? 0) > 0,
        indexes: Number(schemaChecks.rows[0]?.indexes ?? 0) > 0
      };
    } finally {
      await restored.end();
    }
    const comparison = compareInventories(expectedInventory, restoredInventory);
    if (
      comparison.missing_tables.length > 0 ||
      comparison.unexpected_tables.length > 0 ||
      comparison.row_count_mismatches.length > 0
    ) {
      throw new Error("Restored database inventory does not match the backup snapshot");
    }
    if (!schemaProbes || Object.values(schemaProbes).some((value) => value !== true)) {
      throw new Error("Restored database schema probe failed");
    }
    const probes = semanticProbes(expectedInventory, restoredInventory);
    if (Object.values(probes).some((value) => value !== true)) {
      throw new Error("Restored database semantic probe failed");
    }
    const sourceAfter = sourceClient ? await inventory(sourceClient) : expectedInventory;
    const sourceUnchanged =
      inventoryFingerprint(sourceAfter) === inventoryFingerprint(expectedInventory);
    if (!sourceUnchanged) throw new Error("Production snapshot fingerprint changed during rehearsal");
    rehearsalResult = {
      comparison,
      probes,
      schemaProbes,
      sourceUnchanged,
      restoredInventory,
      rehearsalDatabaseCreated: true
    };
  } catch (error) {
    operationError = error;
  } finally {
    try {
      run("docker", ["exec", containerName, "rm", "-f", containerDumpPath]);
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (created) await dropDisposableDatabase(admin, rehearsalDatabase);
      removed = !(await databaseExists(admin, rehearsalDatabase));
    } catch (error) {
      cleanupError ??= error;
    } finally {
      await admin.end();
    }
    if (!removed) cleanupError ??= new Error("Disposable rehearsal database cleanup failed");
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;
  return rehearsalResult;
}

async function createBackup() {
  const databaseUrl = requiredEnv("RECALLANT_DATABASE_URL");
  const sourceDatabaseName = process.env.POSTGRES_DB?.trim() || databaseNameFromUrl(databaseUrl);
  const postgresUser = process.env.POSTGRES_USER?.trim() || decodeURIComponent(new URL(databaseUrl).username);
  const containerName = process.env.RECALLANT_POSTGRES_CONTAINER_NAME?.trim() || "recallant-postgres";
  if (!identifierPattern.test(sourceDatabaseName)) throw new Error("POSTGRES_DB is invalid");
  if (!identifierPattern.test(postgresUser)) throw new Error("POSTGRES_USER is invalid");
  if (!containerPattern.test(containerName)) throw new Error("Postgres container name is invalid");

  const dataDir = resolve(process.env.RECALLANT_DATA_DIR?.trim() || "/var/lib/recallant");
  const backupTarget = resolve(process.env.RECALLANT_BACKUP_TARGET?.trim() || join(dataDir, "backups"));
  const backupId = `recallant-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
  const backupDir = join(backupTarget, backupId);
  const dumpPath = join(backupDir, "database.dump");
  const manifestPath = join(backupDir, "manifest.json");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);

  const source = new pg.Client({ connectionString: databaseUrl });
  await source.connect();
  let transactionOpen = false;
  try {
    await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const snapshot = await source.query("SELECT pg_export_snapshot() AS snapshot");
    const snapshotId = String(snapshot.rows[0]?.snapshot ?? "");
    if (!snapshotId) throw new Error("Could not export PostgreSQL backup snapshot");
    const sourceInventory = await inventory(source);

    const dumpHandle = await open(dumpPath, "w", 0o600);
    try {
      run(
        "docker",
        [
          "exec",
          containerName,
          "pg_dump",
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          `--snapshot=${snapshotId}`,
          "-U",
          postgresUser,
          "-d",
          sourceDatabaseName
        ],
        { stdio: ["ignore", dumpHandle.fd, "pipe"] }
      );
    } finally {
      await dumpHandle.close();
    }
    await chmod(dumpPath, 0o600);
    const dumpStat = await stat(dumpPath);
    const dumpSha256 = await sha256File(dumpPath);
    const createdAt = new Date().toISOString();
    const version = run("docker", ["exec", containerName, "pg_dump", "--version"]).stdout.trim();
    const manifest = {
      backup_id: backupId,
      backup_kind: "postgresql_custom",
      created_at: createdAt,
      postgresql_tool_version: version,
      schema_scope: "complete_database",
      artifact: {
        path: "database.dump",
        sha256: dumpSha256,
        size_bytes: dumpStat.size
      },
      source_table_inventory: sourceInventory,
      source_table_count: sourceInventory.length,
      source_fingerprint: inventoryFingerprint(sourceInventory),
      portability: { no_owner: true, no_privileges: true },
      secret_policy: "manifest contains metadata only; database backup remains private"
    };
    await writeJsonAtomic(manifestPath, manifest);

    const rehearsal = await restoreRehearsal({
      databaseUrl,
      sourceDatabaseName,
      postgresUser,
      containerName,
      dumpPath,
      expectedInventory: sourceInventory,
      expectedSha256: dumpSha256,
      sourceClient: source
    });
    const restoreVerifiedAt = new Date().toISOString();
    const report = {
      ok: true,
      status: "passed",
      backup_kind: "postgresql_custom",
      backup_created_at: createdAt,
      verified_at: restoreVerifiedAt,
      restore_verified_at: restoreVerifiedAt,
      restore_verification: "passed",
      manifest_path: manifestPath,
      artifact_sha256_verified: true,
      source_table_count: sourceInventory.length,
      restored_table_count: rehearsal.restoredInventory.length,
      missing_tables: rehearsal.comparison.missing_tables,
      unexpected_tables: rehearsal.comparison.unexpected_tables,
      row_count_mismatches: rehearsal.comparison.row_count_mismatches,
      semantic_probes: rehearsal.probes,
      schema_probes: rehearsal.schemaProbes,
      production_fingerprint_unchanged: rehearsal.sourceUnchanged,
      production_overwritten: false,
      disposable_database_removed: true
    };
    await source.query("COMMIT");
    transactionOpen = false;
    await writeJsonAtomic(join(backupDir, "verification.json"), report);
    await writeJsonAtomic(join(backupTarget, "latest-verification.json"), report);
    await writeJsonAtomic(join(backupTarget, "latest-manifest.json"), manifest);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (transactionOpen) await source.query("ROLLBACK").catch(() => undefined);
    await source.end();
  }
}

async function verifyManifest(manifestArgument) {
  const manifestPath = resolve(manifestArgument);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.backup_kind !== "postgresql_custom") {
    throw new Error("Manifest is not a production PostgreSQL backup");
  }
  const databaseUrl = requiredEnv("RECALLANT_DATABASE_URL");
  const sourceDatabaseName = process.env.POSTGRES_DB?.trim() || databaseNameFromUrl(databaseUrl);
  const postgresUser = process.env.POSTGRES_USER?.trim() || decodeURIComponent(new URL(databaseUrl).username);
  const containerName = process.env.RECALLANT_POSTGRES_CONTAINER_NAME?.trim() || "recallant-postgres";
  const dumpPath = resolve(dirname(manifestPath), manifest.artifact.path);
  const source = new pg.Client({ connectionString: databaseUrl });
  await source.connect();
  try {
    await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const currentInventory = await inventory(source);
    const rehearsal = await restoreRehearsal({
      databaseUrl,
      sourceDatabaseName,
      postgresUser,
      containerName,
      dumpPath,
      expectedInventory: manifest.source_table_inventory,
      expectedSha256: manifest.artifact.sha256,
      sourceClient: null
    });
    await source.query("ROLLBACK");
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        restore_verification: "passed",
        source_current_table_count: currentInventory.length,
        restored_table_count: rehearsal.restoredInventory.length,
        production_overwritten: false,
        disposable_database_removed: true
      })}\n`
    );
  } finally {
    await source.end();
  }
}

try {
  const verifyIndex = process.argv.indexOf("--verify-manifest");
  if (verifyIndex >= 0) {
    const manifestPath = process.argv[verifyIndex + 1];
    if (!manifestPath) throw new Error("--verify-manifest requires a path");
    await verifyManifest(manifestPath);
  } else {
    await createBackup();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
