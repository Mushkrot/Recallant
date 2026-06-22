import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { RecallantDb } from "../packages/db/dist/index.js";

const execFileAsync = promisify(execFile);

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const missingEnvFile = join(tmpdir(), `recallant-missing-env-${randomUUID()}`);

function env(extra = {}) {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: "",
    RECALLANT_PROJECT_PATH: "",
    ...extra
  };
}

async function cli(cwd, args, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: env(extraEnv),
    maxBuffer: 8 * 1024 * 1024
  });
  if (stderr.trim()) process.stderr.write(stderr);
  return JSON.parse(stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const onlineProject = await mkdtemp(join(tmpdir(), "recallant-agent-capture-online-"));
const offlineProject = await mkdtemp(join(tmpdir(), "recallant-agent-capture-offline-"));
const marker = `CAPTURE-SMOKE-${randomUUID()}`;

try {
  const attach = await cli(onlineProject, ["attach", ".", "--format", "json"]);
  assert(attach.status === "attached", `attach failed: ${JSON.stringify(attach)}`);
  assert(
    attach.requested_mode === "autopilot" && attach.effective_mode === "autopilot",
    `ordinary attach did not use autopilot: ${JSON.stringify(attach)}`
  );

  const started = await cli(onlineProject, [
    "agent-start",
    "--task-hint",
    `${marker} readiness decision`
  ]);
  assert(started.mode === "server", `agent-start did not use server mode: ${JSON.stringify(started)}`);
  assert(started.session_id, "agent-start did not return a session id");
  assert(
    started.project_id === attach.project_id,
    `agent-start used a different project id than attach: ${JSON.stringify({ attach, started })}`
  );

  const decisionText = `Owner decision ${marker}: Recallant readiness requires proven agent capture before project readiness can be claimed.`;
  const decision = await cli(onlineProject, [
    "agent-event",
    "--kind",
    "decision",
    "--title",
    `${marker} readiness decision`,
    "--text",
    decisionText
  ]);
  assert(decision.event_id, "decision event was not written");
  assert(
    decision.project_id === attach.project_id,
    `decision event used a different project id than attach: ${JSON.stringify(decision)}`
  );
  assert(decision.memory?.status === "accepted", `decision memory was not accepted: ${JSON.stringify(decision)}`);

  const action = await cli(onlineProject, [
    "agent-event",
    "--kind",
    "action",
    "--text",
    `Agent action ${marker}: wrote the capture loop smoke decision.`
  ]);
  assert(action.event_id, "action event was not written");
  assert(
    action.project_id === attach.project_id,
    `action event used a different project id than attach: ${JSON.stringify(action)}`
  );

  const verification = await cli(onlineProject, [
    "agent-event",
    "--kind",
    "test",
    "--text",
    `Verification ${marker}: decision, action, and checkpoint are expected to be recalled later.`
  ]);
  assert(verification.event_id, "verification event was not written");

  const checkpoint = await cli(onlineProject, [
    "agent-checkpoint",
    "--status",
    "capture_smoke",
    "--focus",
    `Capture smoke for ${marker}`,
    "--next-step",
    `Start a new session and recall ${marker}`,
    "--summary",
    `Checkpoint for ${marker}`
  ]);
  assert(checkpoint.event_id, "checkpoint event was not written");
  assert(
    checkpoint.project_id === attach.project_id,
    `checkpoint used a different project id than attach: ${JSON.stringify(checkpoint)}`
  );
  assert(
    checkpoint.memory?.status === "accepted",
    `checkpoint memory was not accepted: ${JSON.stringify(checkpoint)}`
  );
  assert(checkpoint.project_log_update?.status, "PROJECT_LOG checkpoint was not updated");

  const checkpointAsk = await cli(onlineProject, [
    "ask",
    `checkpoint ${marker}`,
    "--format",
    "json"
  ]);
  assert(
    checkpointAsk.memories?.some((memory) => String(memory.body ?? "").includes(marker)),
    `ask did not recall checkpoint memory: ${JSON.stringify(checkpointAsk)}`
  );

  const closeout = await cli(onlineProject, [
    "agent-closeout",
    "--status",
    "closed",
    "--focus",
    `Capture smoke for ${marker}`,
    "--next-step",
    `Recall ${marker} from the next session`,
    "--summary",
    `Closed capture smoke for ${marker}`
  ]);
  assert(closeout.closeout?.report_required === false, `closeout reported warnings: ${JSON.stringify(closeout)}`);

  const secondStart = await cli(onlineProject, [
    "agent-start",
    "--task-hint",
    `${marker} readiness decision`
  ]);
  assert(secondStart.session_id !== started.session_id, "second session reused the first session id");
  assert(
    secondStart.project_id === attach.project_id,
    `second agent-start used a different project id than attach: ${JSON.stringify(secondStart)}`
  );

  const context = await cli(onlineProject, ["context", "--task-hint", `${marker} readiness decision`]);
  const working = context.sections?.working_memories ?? [];
  assert(
    working.some((memory) => String(memory.body).includes(marker)),
    `context pack did not recall captured decision: ${JSON.stringify(context)}`
  );
  assert(
    String(context.sections?.checkpoint?.payload?.next_step ?? "").includes(marker),
    "context pack did not include the latest checkpoint"
  );

  const secondCloseout = await cli(onlineProject, [
    "agent-closeout",
    "--status",
    "closed",
    "--focus",
    `Completed recall verification for ${marker}`,
    "--next-step",
    "No follow-up for smoke project.",
    "--summary",
    `Closed recall verification session for ${marker}`
  ]);
  assert(
    secondCloseout.closeout?.report_required === false,
    `second closeout reported warnings: ${JSON.stringify(secondCloseout)}`
  );

  const db = new RecallantDb({
    databaseUrl,
    developerId,
    projectId: attach.project_id,
    projectPath: onlineProject
  });
  try {
    const dashboard = await db.getReviewDashboard({ project_id: attach.project_id });
    assert(
      dashboard.project_readiness?.last_context_read_at,
      "dashboard readiness is missing last context read"
    );
    assert(
      dashboard.project_readiness?.last_memory_write_at,
      "dashboard readiness is missing last memory write"
    );
    assert(
      dashboard.project_readiness?.checkpoint_updated_at,
      "dashboard readiness is missing checkpoint timestamp"
    );
    assert(
      Number(dashboard.project_readiness?.capture_event_count ?? 0) >= 3,
      "dashboard readiness did not count capture events"
    );
    assert(
      Number(dashboard.project_readiness?.active_sessions ?? 0) === 0,
      `dashboard readiness still has active sessions: ${JSON.stringify(dashboard.project_readiness)}`
    );
  } finally {
    await db.close();
  }

  const projectLog = await readFile(join(onlineProject, "PROJECT_LOG.md"), "utf8");
  assert(projectLog.includes(marker), "PROJECT_LOG was not updated with checkpoint marker");

  const detachDryRun = await cli(onlineProject, [
    "detach",
    "--project-id",
    attach.project_id,
    "--dry-run"
  ]);
  assert(
    detachDryRun.status === "pending_confirmation" && detachDryRun.writes_database === false,
    `detach dry-run changed state or skipped confirmation: ${JSON.stringify(detachDryRun)}`
  );

  const detach = await cli(onlineProject, ["detach", "--project-id", attach.project_id, "--confirm"]);
  assert(
    detach.status === "detached" &&
      detach.writes_database === true &&
      detach.changes?.physically_deleted_records === 0 &&
      detach.changes?.files_changed === 0 &&
      detach.lifecycle?.visibility === "hidden" &&
      detach.lifecycle?.searchable === false,
    `detach did not safely remove project from active Recallant views: ${JSON.stringify(detach)}`
  );
  const configAfterDetach = await readFile(join(onlineProject, ".recallant", "config"), "utf8");
  assert(
    configAfterDetach.includes(attach.project_id),
    "detach unexpectedly removed or rewrote local project config"
  );

  const offlineStart = await cli(
    offlineProject,
    ["agent-start", "--task-hint", `${marker} offline capture`],
    { RECALLANT_DATABASE_URL: "", RECALLANT_ENV_FILE: missingEnvFile }
  );
  assert(offlineStart.mode === "offline_spool", "offline agent-start did not use spool mode");

  const offlineEvent = await cli(
    offlineProject,
    ["agent-event", "--kind", "action", "--text", `Offline action ${marker}: spool fallback works.`],
    { RECALLANT_DATABASE_URL: "", RECALLANT_ENV_FILE: missingEnvFile }
  );
  assert(offlineEvent.mode === "offline_spool", "offline agent-event did not spool");

  const dryRun = await cli(offlineProject, ["sync-spool", "--dry-run"]);
  assert(dryRun.unsynced_count >= 2, `sync-spool dry-run missed offline records: ${JSON.stringify(dryRun)}`);

  const synced = await cli(offlineProject, ["sync-spool"]);
  assert(synced.synced_count >= 2, `sync-spool did not upload offline records: ${JSON.stringify(synced)}`);

  const syncedAgain = await cli(offlineProject, ["sync-spool"]);
  assert(syncedAgain.synced_count === 0, "repeat sync-spool created duplicate work");
} finally {
  await rm(onlineProject, { recursive: true, force: true });
  await rm(offlineProject, { recursive: true, force: true });
}

process.stdout.write("Product acceptance smoke passed\n");
