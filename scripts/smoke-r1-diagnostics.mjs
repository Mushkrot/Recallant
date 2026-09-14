import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { buildRecallantReadinessContract } from "../packages/contracts/dist/index.js";
import { mergeDoctorReadinessContract } from "../apps/cli/dist/readiness.js";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function fixtureManifest(backupId, createdAt) {
  return {
    backup_id: backupId,
    backup_kind: "postgresql_custom",
    created_at: createdAt,
    artifact: { path: "database.dump", sha256: `sha256-${backupId}`, size_bytes: 42 }
  };
}

function fixtureReport(manifestPath, createdAt, backupId) {
  return {
    ok: true,
    status: "passed",
    backup_kind: "postgresql_custom",
    backup_created_at: createdAt,
    verified_at: createdAt,
    restore_verified_at: createdAt,
    restore_verification: "passed",
    manifest_path: manifestPath,
    backup_id: backupId,
    artifact_sha256_verified: true,
    production_fingerprint_unchanged: true,
    production_overwritten: false,
    disposable_database_removed: true,
    missing_tables: [],
    unexpected_tables: [],
    row_count_mismatches: []
  };
}

function runDoctor(projectDir, serviceEnvFile, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", projectDir, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: "",
        RECALLANT_ENV_FILE: "",
        RECALLANT_SERVICE_ENV_FILE: serviceEnvFile,
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1",
        ...extraEnv
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  assert(
    result.status === 0,
    `doctor failed (${result.status}): ${result.stderr}\n${result.stdout}`
  );
  assert(
    result.stdout.trim().length > 0,
    `doctor produced no JSON (status=${result.status}, signal=${result.signal}): ${result.stderr}`
  );
  return JSON.parse(result.stdout);
}

async function backupPathFixture() {
  const root = await mkdtemp(join(tmpdir(), "recallant-r1-backup-path-"));
  const dataDir = join(root, "data");
  const backupTarget = join(dataDir, "backups");
  const staleTarget = join(root, "retired-backups");
  await mkdir(backupTarget, { recursive: true });
  await mkdir(staleTarget, { recursive: true });
  const freshCreatedAt = new Date().toISOString();
  const freshId = `fresh-${randomUUID()}`;
  const freshManifestPath = join(backupTarget, `${freshId}.manifest.json`);
  const freshManifestAlias = join(backupTarget, "latest-manifest.json");
  const freshReportPath = join(backupTarget, "latest-verification.json");
  await writeFile(freshManifestPath, JSON.stringify(fixtureManifest(freshId, freshCreatedAt)));
  await writeFile(freshManifestAlias, JSON.stringify(fixtureManifest(freshId, freshCreatedAt)));
  await writeFile(
    freshReportPath,
    JSON.stringify(fixtureReport(freshManifestPath, freshCreatedAt, freshId))
  );

  const staleCreatedAt = isoHoursAgo(48);
  const staleId = `stale-${randomUUID()}`;
  const staleManifestPath = join(staleTarget, `${staleId}.manifest.json`);
  await writeFile(staleManifestPath, JSON.stringify(fixtureManifest(staleId, staleCreatedAt)));
  await writeFile(
    join(staleTarget, "latest-manifest.json"),
    JSON.stringify(fixtureManifest(staleId, staleCreatedAt))
  );
  const staleReportPath = join(staleTarget, "latest-verification.json");
  await writeFile(
    staleReportPath,
    JSON.stringify(fixtureReport(staleManifestPath, staleCreatedAt, staleId))
  );

  const envFile = join(root, "recallant.env");
  const env = [
    "RECALLANT_BACKUP_TIMER_STATUS=enabled",
    "RECALLANT_BACKUP_JOB_RESULT=success",
    "RECALLANT_BACKUP_JOB_EXIT_STATUS=0",
    `RECALLANT_BACKUP_JOB_COMPLETED_AT=${freshCreatedAt}`,
    "RECALLANT_BACKUP_MAX_AGE_HOURS=30",
    "RECALLANT_RESTORE_VERIFICATION_MAX_AGE_HOURS=30",
    "RECALLANT_SERVICE_HEALTH_STATUS=200",
    `RECALLANT_DATA_DIR=${dataDir}`,
    `RECALLANT_BACKUP_TARGET=${backupTarget}`,
    `RECALLANT_LATEST_BACKUP_VERIFICATION_FILE=${staleReportPath}`,
    `RECALLANT_LATEST_BACKUP_MANIFEST=${join(staleTarget, "latest-manifest.json")}`
  ].join("\n");
  await writeFile(envFile, `${env}\n`);

  const mismatched = runDoctor(root, envFile, {
    RECALLANT_DATA_DIR: dataDir,
    RECALLANT_BACKUP_TARGET: backupTarget,
    RECALLANT_LATEST_BACKUP_VERIFICATION_FILE: staleReportPath,
    RECALLANT_LATEST_BACKUP_MANIFEST: join(staleTarget, "latest-manifest.json")
  });
  const mismatch = mismatched.production_readiness?.latest_backup_verification;
  assert(
    mismatch?.reason === "backup_profile_path_mismatch",
    `stale backup profile was accepted or misclassified: ${JSON.stringify(mismatch)}`
  );
  assert(mismatch.ok === false, "stale backup profile did not fail closed");

  const aligned = runDoctor(root, envFile, {
    RECALLANT_DATA_DIR: dataDir,
    RECALLANT_BACKUP_TARGET: backupTarget,
    RECALLANT_LATEST_BACKUP_VERIFICATION_FILE: freshReportPath,
    RECALLANT_LATEST_BACKUP_MANIFEST: freshManifestAlias
  });
  const verified = aligned.production_readiness?.latest_backup_verification;
  assert(
    verified?.ok === true,
    `canonical backup profile did not pass: ${JSON.stringify(verified)}`
  );
  assert(verified?.backup?.fresh === true, "canonical backup report was not fresh");

  await rm(freshReportPath);
  const missing = runDoctor(root, envFile, {
    RECALLANT_DATA_DIR: dataDir,
    RECALLANT_BACKUP_TARGET: backupTarget,
    RECALLANT_LATEST_BACKUP_VERIFICATION_FILE: freshReportPath,
    RECALLANT_LATEST_BACKUP_MANIFEST: freshManifestAlias
  });
  const missingVerification = missing.production_readiness?.latest_backup_verification;
  assert(
    missingVerification?.reason === "backup_verification_missing_or_invalid" &&
      missingVerification.ok === false,
    `missing canonical backup report did not fail closed: ${JSON.stringify(missingVerification)}`
  );

  await writeFile(
    freshReportPath,
    JSON.stringify(fixtureReport(freshManifestPath, staleCreatedAt, freshId))
  );
  const overdue = runDoctor(root, envFile, {
    RECALLANT_DATA_DIR: dataDir,
    RECALLANT_BACKUP_TARGET: backupTarget,
    RECALLANT_LATEST_BACKUP_VERIFICATION_FILE: freshReportPath,
    RECALLANT_LATEST_BACKUP_MANIFEST: freshManifestAlias
  });
  const overdueVerification = overdue.production_readiness?.latest_backup_verification;
  assert(
    overdueVerification?.reason === "backup_stale" && overdueVerification.ok === false,
    `overdue canonical backup report did not fail closed: ${JSON.stringify(overdueVerification)}`
  );

  return {
    status: "pass",
    stale_reason: mismatch.reason,
    canonical_ok: verified.ok,
    missing_reason: missingVerification.reason,
    overdue_reason: overdueVerification.reason
  };
}

async function doctorScopeFixture() {
  const capturedAt = new Date().toISOString();
  const fallback = buildRecallantReadinessContract({
    configured: true,
    context_ready: false,
    semantic_memory_ready: false,
    memory_loop_ready: false,
    remote_mcp_ready: false,
    last_automatic_capture_at: null,
    automatic_capture_source: null
  });
  const projectWide = buildRecallantReadinessContract({
    configured: true,
    context_ready: true,
    semantic_memory_ready: true,
    memory_loop_ready: true,
    remote_mcp_ready: false,
    last_context_read_at: capturedAt,
    last_memory_write_at: capturedAt,
    last_checkpoint_at: capturedAt,
    last_automatic_capture_at: capturedAt,
    automatic_capture_source: "codex_native_hook"
  });
  const merged = mergeDoctorReadinessContract(fallback, {
    readiness_contract: projectWide
  });
  assert(
    merged.capture_active === false,
    `project-wide capture incorrectly activated client-local contract: ${JSON.stringify(merged)}`
  );
  assert(
    merged.evidence.last_automatic_capture_at === null,
    "project-wide automatic capture leaked into client-local evidence"
  );
  return {
    status: "pass",
    local_capture_active: merged.capture_active,
    project_capture_observed: true
  };
}

async function localDoctorUnavailableDatabaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "recallant-r1-local-doctor-"));
  const unavailableDatabaseUrl = "postgres://fixture:fixture@127.0.0.1:1/does_not_exist";
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", root, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: unavailableDatabaseUrl,
        RECALLANT_ENV_FILE: "",
        RECALLANT_SERVICE_ENV_FILE: "",
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1",
        RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER: "123456789"
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  assert(
    result.status === 0,
    `local doctor should return readable JSON when Postgres is unavailable (status=${result.status}, error=${result.error?.message ?? "none"}): ${result.stderr}\n${result.stdout}`
  );
  assert(result.stdout.trim().length > 0, "local doctor produced no JSON after DB failure");
  const json = JSON.parse(result.stdout);
  assert(
    json.postgres?.configured === true && json.postgres?.reachable === false,
    `local doctor did not preserve configured/unreachable DB status: ${JSON.stringify(json.postgres)}`
  );
  assert(
    json.production_readiness?.database_probe?.attempted === true &&
      json.production_readiness?.deployment_project_rows === null,
    `local doctor did not report the failed production DB probe safely: ${JSON.stringify(json.production_readiness)}`
  );
  assert(
    json.production_readiness?.physical_target?.status === "unknown" &&
      json.production_readiness?.physical_target?.ok === false &&
      json.production_readiness?.physical_target?.differences?.includes(
        "database_system_identifier_unobserved"
      ),
    `local doctor did not fail closed for an unobserved expected PostgreSQL identity: ${JSON.stringify(json.production_readiness?.physical_target)}`
  );
  return {
    status: "pass",
    postgres: json.postgres,
    database_probe: json.production_readiness.database_probe,
    physical_target: json.production_readiness.physical_target
  };
}

async function localAuditSpoolUnavailableFixture() {
  const root = await mkdtemp(join(tmpdir(), "recallant-r1-audit-spool-"));
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", root, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: "",
        RECALLANT_ENV_FILE: "",
        RECALLANT_SERVICE_ENV_FILE: "",
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_SPOOL_DIR: "/dev/null",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1"
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  assert(
    result.status === 0,
    `doctor should remain readable when the CLI audit spool is unavailable (status=${result.status}, error=${result.error?.message ?? "none"}): ${result.stderr}\n${result.stdout}`
  );
  assert(result.stdout.trim().length > 0, "doctor produced no JSON with an unavailable audit spool");
  const json = JSON.parse(result.stdout);
  assert(
    json.postgres?.configured === false &&
      json.local_spool_status?.status === "empty",
    `doctor changed its readable no-storage result when audit spool was unavailable: ${JSON.stringify({ postgres: json.postgres, local_spool_status: json.local_spool_status })}`
  );
  return {
    status: "pass",
    audit_spool: "unavailable",
    doctor_readable: true,
    postgres: json.postgres
  };
}

async function remoteDoctorWithoutLocalDatabaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "recallant-r1-remote-doctor-"));
  const recallantDir = join(root, ".recallant");
  await mkdir(recallantDir, { recursive: true });
  await writeFile(
    join(recallantDir, "remote-consent.json"),
    JSON.stringify({
      schema_version: 1,
      kind: "recallant_remote_agent_consent",
      created_at: new Date().toISOString(),
      approval_mode: "trusted_device",
      consent_scope: {
        destination: { server_url: "http://127.0.0.1:9", endpoint_path: "/api/mcp" },
        credential_scope: {
          project_id: "doctor-remote-project",
          developer_id: "doctor-remote-developer",
          client_id: "doctor-remote-client",
          credential_prefix: null
        },
        allowed_context: [],
        redaction_boundary: [],
        not_sent: [],
        recommended_next_call: "memory_get_context_pack",
        recommended_next_proof_call: "memory_create_agent_memory",
        recommended_next_proof_followup_call: "memory_recall_agent_memories"
      },
      credential_ref: null,
      credential_store_path: null,
      no_raw_credentials_or_private_keys: true
    })
  );
  const unavailableDatabaseUrl = "postgres://fixture:fixture@127.0.0.1:1/does_not_exist";
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", root, "--format", "json"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: unavailableDatabaseUrl,
        RECALLANT_ENV_FILE: "",
        RECALLANT_SERVICE_ENV_FILE: "",
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1"
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  assert(
    result.status === 0,
    `remote-only doctor should not require local Postgres (status=${result.status}, error=${result.error?.message ?? "none"}): ${result.stderr}\n${result.stdout}`
  );
  assert(
    result.stdout.trim().length > 0,
    `remote-only doctor produced no JSON (error=${result.error?.message ?? "none"}): ${result.stderr}`
  );
  const json = JSON.parse(result.stdout);
  assert(
    json.remote_project?.status === "remote_mcp_ready",
    `remote-only doctor did not expose remote readiness: ${result.stdout}`
  );
  assert(
    json.postgres?.configured === false && json.postgres?.reachable === false,
    `remote-only doctor probed or selected local Postgres: ${JSON.stringify(json.postgres)}`
  );
  const gated = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "doctor",
      "--project-dir",
      root,
      "--require-capture",
      "--format",
      "json"
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: unavailableDatabaseUrl,
        RECALLANT_ENV_FILE: "",
        RECALLANT_SERVICE_ENV_FILE: "",
        RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
        RECALLANT_OLLAMA_URL: "http://127.0.0.1:1"
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  assert(
    gated.status === 2,
    `remote-only --require-capture should fail honestly with exit 2 (status=${gated.status}, error=${gated.error?.message ?? "none"}): ${gated.stderr}\n${gated.stdout}`
  );
  const gatedJson = JSON.parse(gated.stdout);
  assert(
    gatedJson.postgres?.configured === false &&
      gatedJson.readiness_contract?.scope === "client_session" &&
      gatedJson.owner_summary?.actually_recording === false,
    `remote-only capture gate changed scope or probed local Postgres: ${gated.stdout}`
  );
  return {
    status: "pass",
    remote_project: json.remote_project.status,
    postgres: json.postgres,
    require_capture_exit: gated.status
  };
}

const mode = process.argv[2] ?? "all";
const backup = mode === "scope" || mode === "remote" ? null : await backupPathFixture();
const scope = mode === "backup" || mode === "remote" ? null : await doctorScopeFixture();
const localDoctor =
  mode === "backup" || mode === "scope" || mode === "remote"
    ? null
    : await localDoctorUnavailableDatabaseFixture();
const auditSpool =
  mode === "backup" || mode === "scope" || mode === "remote"
    ? null
    : await localAuditSpoolUnavailableFixture();
const remoteDoctor =
  mode === "backup" || mode === "scope" ? null : await remoteDoctorWithoutLocalDatabaseFixture();
process.stdout.write(
  `${JSON.stringify({ status: "pass", backup, scope, localDoctor, auditSpool, remoteDoctor }, null, 2)}\n`
);
