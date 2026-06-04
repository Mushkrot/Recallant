import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const execFileAsync = promisify(execFile);

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const reportDir = join(tmpdir(), "recallant-pilot-reports");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function runCli(args, expectStatus = 0) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId
    },
    maxBuffer: 8 * 1024 * 1024
  }).catch((error) => error);
  const status = result.code ?? 0;
  if (status !== expectStatus) {
    throw new Error(
      `Command status mismatch: recallant ${args.join(" ")}\nexpected=${expectStatus} actual=${status}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`
    );
  }
  return {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

async function runCliJson(args) {
  const result = await runCli(args);
  return JSON.parse(result.stdout);
}

async function countProjectRows(client, id) {
  const result = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM projects WHERE id = $1) AS projects,
        (SELECT count(*)::int FROM sessions WHERE project_id = $1) AS sessions,
        (SELECT count(*)::int FROM events WHERE project_id = $1) AS events,
        (SELECT count(*)::int FROM chunks WHERE project_id = $1) AS chunks,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1) AS agent_memories,
        (SELECT count(*)::int FROM project_sources WHERE project_id = $1) AS project_sources,
        (SELECT count(*)::int FROM project_settings WHERE project_id = $1) AS project_settings
    `,
    [id]
  );
  return result.rows[0];
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-stage5-cleanup-"));
const readmePath = join(projectDir, "README.md");
await writeFile(
  readmePath,
  ["# Recallant Stage 5 Cleanup Matrix", "", "Temporary project fixture. Do not persist."].join(
    "\n"
  )
);
const beforeFileHash = await sha256File(readmePath);

const database = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath: projectDir
});
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await database.registerProject({
    projectId,
    developerId,
    projectPath: projectDir,
    name: "stage5-cleanup-matrix"
  });
  const session = await database.startSession({
    client_kind: "codex",
    client_version: "stage5-cleanup-matrix",
    project_path: projectDir
  });
  const appended = await database.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text: `Stage 5 cleanup matrix proof ${randomUUID()}`,
    dedup_key: `stage5-cleanup-${randomUUID()}`
  });
  await database.setCheckpoint(projectId, {
    current_status: "stage5 cleanup matrix",
    current_focus: "detach source review forget boundaries",
    next_step: "verify cleanup report",
    open_questions: []
  });

  const sourceAttach = await runCliJson([
    "source",
    "attach",
    "--project-id",
    projectId,
    "--source-kind",
    "manual",
    "--label",
    "Temporary manual source",
    "--uri",
    "manual://stage5-cleanup-matrix"
  ]);
  const sourceId = sourceAttach.source?.id;
  assert(sourceAttach.ok === true && sourceId, `source attach failed: ${JSON.stringify(sourceAttach)}`);

  const sourceDetach = await runCliJson([
    "source",
    "detach",
    "--source-id",
    sourceId,
    "--reason",
    "stage5 cleanup matrix source detach"
  ]);
  assert(
    sourceDetach.ok === true && sourceDetach.source?.status === "detached",
    `source detach failed: ${JSON.stringify(sourceDetach)}`
  );
  const sourceListAfterDetach = await runCliJson(["source", "list", "--project-id", projectId]);
  assert(
    sourceListAfterDetach.sources.some(
      (source) => source.id === sourceId && source.status === "detached"
    ),
    `detached source was not retained for audit: ${JSON.stringify(sourceListAfterDetach)}`
  );

  const makeMemory = (title, body) =>
    database.createAgentMemory({
      project_id: projectId,
      memory_type: "decision",
      scope: "project",
      title,
      body,
      confidence: 0.9,
      created_by: "agent",
      source_refs: [
        {
          source_kind: "event",
          source_id: appended.event_id,
          quote: body,
          metadata: { project_source_id: sourceId, stage5_cleanup_matrix: true }
        }
      ]
    });

  const rejectedMemory = await makeMemory(
    "Stage 5 reject target",
    "This memory should become rejected, not deleted."
  );
  const archivedMemory = await makeMemory(
    "Stage 5 archive target",
    "This memory should become archived, not deleted."
  );
  const forgottenMemory = await makeMemory(
    "Stage 5 forget target",
    "This memory contains sensitive cleanup matrix text and must be redacted only after confirmation."
  );

  const rejected = await database.reviewAgentMemory({
    memory_id: rejectedMemory.memory_id,
    action: "reject",
    actor_kind: "user",
    note: "stage5 cleanup matrix"
  });
  const archived = await database.reviewAgentMemory({
    memory_id: archivedMemory.memory_id,
    action: "archive",
    actor_kind: "user",
    note: "stage5 cleanup matrix"
  });
  assert(
    rejected.status === "rejected" && rejected.use_policy === "do_not_use",
    `reject review failed: ${JSON.stringify(rejected)}`
  );
  assert(archived.status === "archived", `archive review failed: ${JSON.stringify(archived)}`);

  const forgetDryRun = await database.forget({
    target: { kind: "agent_memory", id: forgottenMemory.memory_id, selector: {} },
    reason: "stage5 cleanup matrix dry-run",
    dry_run: true,
    confirmation: { confirmed: false }
  });
  assert(
    forgetDryRun.status === "pending_confirmation" &&
      forgetDryRun.requires_confirmation === true &&
      forgetDryRun.affected?.agent_memories === 1,
    `forget dry-run failed: ${JSON.stringify(forgetDryRun)}`
  );

  const forgetConfirmed = await database.forget({
    target: { kind: "agent_memory", id: forgottenMemory.memory_id, selector: {} },
    reason: "stage5 cleanup matrix confirmed forget",
    dry_run: false,
    confirmation: { confirmed: true, confirmation_token: "stage5-cleanup-matrix" }
  });
  assert(
    forgetConfirmed.status === "completed" &&
      forgetConfirmed.redacted_receipt?.affected?.agent_memories === 1,
    `confirmed forget failed: ${JSON.stringify(forgetConfirmed)}`
  );

  const blockedDetachForget = await runCli(
    ["detach", "--project-id", projectId, "--project-dir", projectDir, "--forget-forever"],
    1
  );
  assert(
    blockedDetachForget.stderr.includes("POLICY_BLOCKED"),
    `detach --forget-forever was not policy-blocked: ${blockedDetachForget.stderr}`
  );

  await client.connect();
  const countsBeforeDetach = await countProjectRows(client, projectId);
  const detachDryRun = await runCliJson([
    "detach",
    "--project-id",
    projectId,
    "--project-dir",
    projectDir,
    "--mode",
    "live",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert(
    detachDryRun.status === "pending_confirmation" &&
      detachDryRun.dry_run === true &&
      detachDryRun.writes_database === false &&
      detachDryRun.warnings.some((warning) => warning.includes("not permanent erasure")),
    `detach dry-run failed: ${JSON.stringify(detachDryRun)}`
  );

  const detachConfirmed = await runCliJson([
    "detach",
    "--project-id",
    projectId,
    "--project-dir",
    projectDir,
    "--mode",
    "live",
    "--confirm",
    "--format",
    "json"
  ]);
  assert(
    detachConfirmed.status === "detached" &&
      detachConfirmed.changes?.physically_deleted_records === 0 &&
      detachConfirmed.changes?.files_changed === 0,
    `confirmed detach did not preserve records/files: ${JSON.stringify(detachConfirmed)}`
  );
  const countsAfterDetach = await countProjectRows(client, projectId);
  assert(
    countsAfterDetach.projects === countsBeforeDetach.projects &&
      countsAfterDetach.events === countsBeforeDetach.events &&
      countsAfterDetach.agent_memories === countsBeforeDetach.agent_memories &&
      countsAfterDetach.project_sources === countsBeforeDetach.project_sources,
    `ordinary detach deleted tracked records: ${JSON.stringify({ countsBeforeDetach, countsAfterDetach })}`
  );

  const verification = await client.query(
    `
      SELECT
        (SELECT status FROM agent_memories WHERE id = $1) AS rejected_status,
        (SELECT use_policy FROM agent_memories WHERE id = $1) AS rejected_policy,
        (SELECT status FROM agent_memories WHERE id = $2) AS archived_status,
        (SELECT title FROM agent_memories WHERE id = $3) AS forgotten_title,
        (SELECT body FROM agent_memories WHERE id = $3) AS forgotten_body,
        (SELECT status FROM agent_memories WHERE id = $3) AS forgotten_status,
        (SELECT use_policy FROM agent_memories WHERE id = $3) AS forgotten_policy,
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $3 AND quote IS NULL) AS forgotten_redacted_refs,
        (SELECT value->>'visibility' FROM project_settings WHERE project_id = $4 AND key = 'project_lifecycle') AS lifecycle_visibility,
        (SELECT value->>'searchable' FROM project_settings WHERE project_id = $4 AND key = 'project_lifecycle') AS lifecycle_searchable
    `,
    [rejectedMemory.memory_id, archivedMemory.memory_id, forgottenMemory.memory_id, projectId]
  );
  const row = verification.rows[0];
  assert(
    row.rejected_status === "rejected" &&
      row.rejected_policy === "do_not_use" &&
      row.archived_status === "archived" &&
      row.forgotten_title === "[REDACTED]" &&
      row.forgotten_body === "[REDACTED]" &&
      row.forgotten_status === "archived" &&
      row.forgotten_policy === "do_not_use" &&
      row.forgotten_redacted_refs === 1 &&
      row.lifecycle_visibility === "hidden" &&
      row.lifecycle_searchable === "false",
    `cleanup matrix DB verification failed: ${JSON.stringify(row)}`
  );

  const afterFileHash = await sha256File(readmePath);
  assert(beforeFileHash === afterFileHash, "temporary project file changed during cleanup matrix");

  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `stage5-cleanup-matrix-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`);
  const report = {
    ok: true,
    stage: 5,
    goal: "5.5 Cleanup Matrix",
    project: {
      project_id: projectId,
      project_path_redacted: true,
      files_untouched: true
    },
    source_detach: {
      source_id: sourceId,
      status: sourceDetach.source.status,
      memory_space_remained: sourceListAfterDetach.project_id === projectId
    },
    review_records: {
      rejected: { memory_id: rejectedMemory.memory_id, status: row.rejected_status },
      archived: { memory_id: archivedMemory.memory_id, status: row.archived_status }
    },
    forget_forever: {
      dry_run_status: forgetDryRun.status,
      requires_confirmation: forgetDryRun.requires_confirmation,
      confirmed_status: forgetConfirmed.status,
      redacted: row.forgotten_title === "[REDACTED]" && row.forgotten_body === "[REDACTED]",
      detach_forget_forever_blocked: true
    },
    project_detach: {
      dry_run_status: detachDryRun.status,
      confirmed_status: detachConfirmed.status,
      physically_deleted_records: detachConfirmed.changes.physically_deleted_records,
      files_changed: detachConfirmed.changes.files_changed,
      visibility: row.lifecycle_visibility,
      searchable: row.lifecycle_searchable
    },
    counts: {
      before_detach: countsBeforeDetach,
      after_detach: countsAfterDetach
    },
    report_path: reportPath
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Stage 5 cleanup matrix smoke passed\n${reportPath}\n`);
} finally {
  await client.end().catch(() => {});
  await database.close();
}
