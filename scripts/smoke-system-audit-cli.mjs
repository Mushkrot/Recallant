import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(value, forbidden) {
  const serialized = JSON.stringify(value);
  return forbidden.some((marker) => serialized.includes(marker));
}

function commandEnv(extra = {}, options = {}) {
  const env = {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: "",
    RECALLANT_PROJECT_PATH: "",
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
    ...extra
  };
  if (options.omitDatabaseUrl) delete env.RECALLANT_DATABASE_URL;
  return env;
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(options.env, options),
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  const expectedStatus = options.expectedStatus ?? 0;
  if (result.status !== expectedStatus) {
    throw new Error(
      `Command status ${result.status}, expected ${expectedStatus}: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result;
}

function runCliJson(args, options = {}) {
  const result = runCli(args, options);
  return JSON.parse(result.stdout);
}

async function writeProjectFixture(projectDir) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "README.md"),
    "# System Audit CLI Smoke\n\nTemporary fixture for CLI audit logging.\n"
  );
  await writeFile(
    join(projectDir, "AGENTS.md"),
    "# Agent Instructions\n\nUse Recallant for temporary audit smoke context.\n"
  );
  await writeFile(
    join(projectDir, "PROJECT_LOG.md"),
    "# Project Log\n\n## Current Session\n\nStatus: fixture.\n"
  );
}

async function readJsonl(path) {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function queryCliAuditRows(sinceIso, operations) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT operation, status, error_code, duration_ms, related_ids, redacted_metadata,
               trace_id, error_message, project_id, developer_id, session_id
        FROM system_activity_events
        WHERE surface = 'cli'
          AND started_at >= $1::timestamptz
          AND operation = ANY($2::text[])
          AND (
            developer_id = $3::uuid
            OR (
              developer_id IS NULL
              AND redacted_metadata->'argv'->>'project_dir_basename' = $4
            )
          )
        ORDER BY started_at ASC
      `,
      [sinceIso, operations, developerId, projectDir.split("/").filter(Boolean).at(-1)]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-system-audit-cli-"));
const offlineProjectDir = await mkdtemp(join(tmpdir(), "recallant-system-audit-cli-offline-"));
const offlineSpoolDir = await mkdtemp(join(tmpdir(), "recallant-system-audit-cli-spool-"));
const offlineHome = await mkdtemp(join(tmpdir(), "recallant-system-audit-cli-home-"));
await writeProjectFixture(projectDir);
await writeProjectFixture(offlineProjectDir);

const fakeApiKey = `sk-cli-audit-${randomUUID().replaceAll("-", "")}`;
const fakeBearer = `Bearer ${randomUUID().replaceAll("-", "")}`;
const fakePassword = `fixture-password-${randomUUID().slice(0, 8)}`;
const fakeDatabaseUrl = `postgres://recallant:${fakePassword}@127.0.0.1/recallant_agent_work`;
const forbiddenMarkers = [
  fakeApiKey,
  fakeBearer,
  fakePassword,
  fakeDatabaseUrl,
  projectDir,
  offlineProjectDir
];
const requiredOperations = [
  "onboard",
  "doctor",
  "project-sanitize",
  "context",
  "ask",
  "agent-start",
  "agent-event",
  "agent-observe",
  "agent-checkpoint"
];
const sinceIso = new Date(Date.now() - 1000).toISOString();

const onboard = runCliJson([
  "onboard",
  projectDir,
  "--skip-vcs-safety",
  "--dry-run",
  "--no-client",
  "--format",
  "json"
]);
assert(
  onboard.status === "plan_only",
  `onboard dry-run did not succeed: ${JSON.stringify(onboard)}`
);

const doctor = runCliJson(["doctor", "--project-dir", projectDir, "--format", "json"]);
assert(
  doctor.postgres?.reachable === true,
  `doctor did not reach postgres: ${JSON.stringify(doctor.postgres)}`
);

const agentStart = runCliJson([
  "agent-start",
  "--project-dir",
  projectDir,
  "--client-kind",
  "codex",
  "--task-hint",
  "system audit cli smoke"
]);
assert(
  agentStart.ok === true && agentStart.project_id,
  `agent-start failed: ${JSON.stringify(agentStart)}`
);

const agentEvent = runCliJson([
  "agent-event",
  "--project-dir",
  projectDir,
  "--kind",
  "decision",
  "--dedup-key",
  `cli-audit-${randomUUID()}`,
  "--text",
  "System audit CLI smoke recorded a durable decision."
]);
assert(
  agentEvent.ok === true && agentEvent.mode === "server",
  `agent-event failed: ${JSON.stringify(agentEvent)}`
);

const duplicateEvent = runCliJson([
  "agent-event",
  "--project-dir",
  projectDir,
  "--kind",
  "action",
  "--dedup-key",
  `cli-audit-duplicate-${randomUUID()}`,
  "--text",
  "System audit CLI smoke recorded an idempotent-keyed action."
]);
assert(
  duplicateEvent.ok === true && duplicateEvent.mode === "server",
  `duplicate-key agent-event failed: ${JSON.stringify(duplicateEvent)}`
);

const observation = runCliJson([
  "agent-observe",
  "--project-dir",
  projectDir,
  "--kind",
  "terminal_command",
  "--title",
  "Inspect scoped CLI audit",
  "--text",
  "Run the bounded CLI audit verification fixture.",
  "--rationale",
  "Verify the new observation command and project scope."
]);
assert(
  observation.ok === true &&
    observation.mode === "server" &&
    observation.observation?.kind === "terminal_command",
  `agent-observe failed: ${JSON.stringify(observation)}`
);

const checkpoint = runCliJson([
  "agent-checkpoint",
  "--project-dir",
  projectDir,
  "--status",
  "in_progress",
  "--focus",
  "system audit CLI smoke",
  "--next-step",
  "verify CLI ledger rows"
]);
assert(
  checkpoint.ok === true && checkpoint.mode === "server",
  `agent-checkpoint failed: ${JSON.stringify(checkpoint)}`
);

const context = runCliJson([
  "context",
  "--project-dir",
  projectDir,
  "--task-hint",
  "system audit cli smoke"
]);
assert(context.sections, `context output did not include sections: ${JSON.stringify(context)}`);

const ask = runCliJson([
  "ask",
  "--project-id",
  agentStart.project_id,
  "--query",
  "system audit CLI smoke durable decision",
  "--format",
  "json"
]);
assert(ask.ok === true, `ask did not succeed: ${JSON.stringify(ask)}`);

const sanitize = runCliJson([
  "project-sanitize",
  "--project-dir",
  projectDir,
  "--mode",
  "purge",
  "--dry-run",
  "--format",
  "json"
]);
assert(
  sanitize.database?.status === "pending_confirmation",
  `project-sanitize dry-run failed: ${JSON.stringify(sanitize.database)}`
);

runCli(["agent-event", "--project-dir", projectDir, "--kind", "action", "--text", ""], {
  expectedStatus: 1
});

runCli(
  [
    "agent-event",
    "--project-dir",
    offlineProjectDir,
    "--spool-dir",
    offlineSpoolDir,
    "--kind",
    "action",
    "--text",
    `Offline audit fallback must redact ${fakeApiKey} ${fakeBearer} ${fakeDatabaseUrl}`
  ],
  {
    omitDatabaseUrl: true,
    env: {
      HOME: offlineHome,
      RECALLANT_ENV_FILE: join(offlineProjectDir, "missing-recallant.env")
    }
  }
);

const rows = await queryCliAuditRows(sinceIso, requiredOperations);
const successByOperation = Object.fromEntries(
  requiredOperations.map((operation) => [
    operation,
    rows.some((row) => row.operation === operation && row.status === "success")
  ])
);
for (const [operation, hasSuccess] of Object.entries(successByOperation)) {
  assert(hasSuccess, `missing successful CLI audit row for ${operation}: ${JSON.stringify(rows)}`);
}
const validationErrorRow = rows.find(
  (row) => row.operation === "agent-event" && row.error_code === "VALIDATION_ERROR"
);
assert(validationErrorRow, `missing validation error audit row: ${JSON.stringify(rows)}`);
const keyedOutcomeRow = rows.find(
  (row) =>
    row.operation === "agent-event" && row.redacted_metadata?.outcome_kind === "idempotent_keyed"
);
assert(keyedOutcomeRow, `missing idempotent-keyed outcome row: ${JSON.stringify(rows)}`);
assert(!containsAny(rows, forbiddenMarkers), "CLI durable audit rows leaked raw sensitive markers");

const auditSpool = await readJsonl(join(offlineSpoolDir, "audit.jsonl"));
const fallbackRecord = auditSpool.at(-1);
assert(
  fallbackRecord?.record_kind === "cli_audit",
  `missing cli audit spool record: ${JSON.stringify(auditSpool)}`
);
assert(
  fallbackRecord.payload?.durable_status?.status === "pending_durable_audit",
  `fallback audit did not report pending durable audit: ${JSON.stringify(fallbackRecord)}`
);
assert(
  fallbackRecord.payload?.status === "success",
  `fallback audit did not finish success: ${JSON.stringify(fallbackRecord)}`
);
assert(
  !containsAny(auditSpool, forbiddenMarkers),
  "CLI fallback audit spool leaked raw sensitive markers"
);

const successRows = rows.filter((row) => row.status === "success");
const scopedSuccessRows = successRows.filter((row) => row.operation !== "onboard");
assert(
  scopedSuccessRows.every(
    (row) => row.project_id === agentStart.project_id && row.developer_id === developerId
  ),
  `CLI audit rows were not project scoped: ${JSON.stringify(scopedSuccessRows)}`
);
const agentStartAudit = scopedSuccessRows.find((row) => row.operation === "agent-start");
assert(
  agentStartAudit?.session_id === agentStart.session_id,
  `agent-start audit was not session scoped: ${JSON.stringify(agentStartAudit)}`
);
process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      durable_success_operations: Object.keys(successByOperation).filter(
        (operation) => successByOperation[operation]
      ),
      success_row_count: successRows.length,
      project_scoped_success_count: scopedSuccessRows.length,
      agent_start_session_scoped: agentStartAudit?.session_id === agentStart.session_id,
      validation_error_row: {
        operation: validationErrorRow.operation,
        status: validationErrorRow.status,
        error_code: validationErrorRow.error_code
      },
      idempotent_outcome_row: {
        operation: keyedOutcomeRow.operation,
        outcome_kind: keyedOutcomeRow.redacted_metadata?.outcome_kind,
        arg_count: keyedOutcomeRow.redacted_metadata?.argv?.arg_count
      },
      fallback_spool: {
        record_kind: fallbackRecord.record_kind,
        operation: fallbackRecord.payload?.operation,
        status: fallbackRecord.payload?.status,
        durable_status: fallbackRecord.payload?.durable_status?.status
      },
      onboarding_summary: {
        status: onboard.status,
        documentation_posture: onboard.documentation_posture?.status ?? null,
        writes_database: onboard.attach_details?.writes_database ?? null
      },
      sanitize_summary: {
        status: sanitize.database?.status,
        writes_database: sanitize.database?.writes_database,
        local_writes_files: sanitize.local_cleanup?.writes_files
      },
      raw_marker_count: 0
    },
    null,
    2
  )}\n`
);
