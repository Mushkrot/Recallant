import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const repoRoot = resolve(".");
const reportDir = join(tmpdir(), "recallant-pilot-reports");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const database = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath: repoRoot
});

try {
  await database.registerProject({
    projectId,
    developerId,
    projectPath: repoRoot,
    name: "recallant-dogfood-stage5"
  });

  const session = await database.startSession({
    client_kind: "codex",
    client_version: "stage5-dogfood-loop",
    project_path: repoRoot
  });
  assert(session.session_id && session.project_id === projectId, "dogfood session did not start");

  const contextRead = await database.appendEvent({
    session_id: session.session_id,
    client_kind: "codex",
    event_kind: "system",
    text: "Context pack read for Stage 5 dogfood loop on Recallant itself.",
    metadata: {
      capture_kind: "context_read",
      task_hint: "Stage 5 dogfood Recallant development loop",
      dogfood_stage: "5.6"
    },
    dedup_key: `stage5-dogfood-context-${randomUUID()}`
  });
  assert(contextRead.status === "created", `context read was not captured: ${JSON.stringify(contextRead)}`);

  const turn = await database.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "assistant",
    text:
      "Dogfood decision: keep Stage 5 cleanup proof as a focused cleanup-matrix smoke instead of expanding the broader pilot report.",
    dedup_key: `stage5-dogfood-turn-${randomUUID()}`
  });
  assert(turn.status === "created" && turn.chunk_ids.length > 0, `dogfood turn was not captured: ${JSON.stringify(turn)}`);

  const marker = `DOGFOOD_STAGE5_${randomUUID().replaceAll("-", "_")}`;
  const memory = await database.createAgentMemory({
    project_id: projectId,
    memory_type: "decision",
    scope: "project",
    title: "Stage 5 dogfood cleanup matrix decision",
    body: `Recallant dogfood memory ${marker}: Stage 5 cleanup proof should stay focused and report detach/source/review/forget boundaries separately from the broad pilot report.`,
    confidence: 0.92,
    created_by: "agent",
    source_refs: [
      {
        source_kind: "event",
        source_id: turn.event_id,
        quote: "keep Stage 5 cleanup proof as a focused cleanup-matrix smoke",
        metadata: { source_path: "scripts/smoke-stage5-cleanup-matrix.mjs", dogfood_stage: "5.6" }
      }
    ]
  });
  assert(memory.memory_id && memory.status === "accepted", `dogfood memory write failed: ${JSON.stringify(memory)}`);

  await database.setCheckpoint(projectId, {
    current_status: "stage5 dogfood loop captured",
    current_focus: "Recallant development loop memory proof",
    next_step: "close session and verify later recall",
    open_questions: []
  });

  const activeDashboard = await database.getReviewDashboard({ project_id: projectId });
  assert(
    activeDashboard.project_readiness?.active_sessions === 1 &&
      activeDashboard.project_readiness?.last_context_read_at &&
      activeDashboard.project_readiness?.last_memory_write_at &&
      activeDashboard.project_readiness?.checkpoint_updated_at &&
      activeDashboard.recent_activity.some((row) => row.activity_kind === "session") &&
      activeDashboard.recent_activity.some((row) => row.activity_kind === "context_read") &&
      activeDashboard.recent_activity.some((row) => row.activity_kind === "memory_write") &&
      activeDashboard.recent_activity.some((row) => row.activity_kind === "checkpoint"),
    `Workbench activity did not show active dogfood capture: ${JSON.stringify({
      readiness: activeDashboard.project_readiness,
      recent_activity: activeDashboard.recent_activity
    })}`
  );

  const closeout = await database.closeout(
    session.session_id,
    {
      current_status: "stage5 dogfood loop closed",
      current_focus: "later recall verification",
      next_step: "write pilot evidence index",
      open_questions: []
    },
    "closeout"
  );
  assert(closeout.updated_at, `dogfood closeout did not update checkpoint: ${JSON.stringify(closeout)}`);

  const recalled = await database.recallAgentMemories({
    project_id: projectId,
    query: marker,
    top_k: 5,
    max_chars_total: 2000
  });
  assert(
    recalled.memories.some(
      (row) => row.memory_id === memory.memory_id && String(row.body ?? "").includes(marker)
    ),
    `later recall did not return dogfood marker: ${JSON.stringify(recalled)}`
  );

  const closedDashboard = await database.getReviewDashboard({ project_id: projectId });
  assert(
    closedDashboard.project_readiness?.closed_sessions >= 1 &&
      closedDashboard.project_readiness?.active_sessions === 0,
    `closed dogfood session was not reflected in Workbench readiness: ${JSON.stringify(closedDashboard.project_readiness)}`
  );

  await mkdir(reportDir, { recursive: true });
  const reportPath = join(
    reportDir,
    `stage5-dogfood-loop-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`
  );
  const report = {
    ok: true,
    stage: 5,
    goal: "5.6 Dogfood Recallant Development Loop",
    project: {
      project_id: projectId,
      project_path: "/ai/recallant",
      isolated_test_developer: true,
      repository_files_changed: false
    },
    proof: {
      session_started: Boolean(session.session_id),
      context_read: contextRead.status === "created",
      memory_written: memory.status === "accepted",
      checkpoint_exists: Boolean(activeDashboard.project_readiness?.checkpoint_updated_at),
      workbench_capture_active_before_closeout: activeDashboard.project_readiness?.active_sessions === 1,
      workbench_activity_visible: activeDashboard.recent_activity.length >= 4,
      closeout_recorded: Boolean(closeout.updated_at),
      later_recall_works: recalled.memories.some((row) => row.memory_id === memory.memory_id)
    },
    artifacts: {
      memory_id: memory.memory_id,
      context_event_id: contextRead.event_id,
      turn_event_id: turn.event_id,
      report_path: reportPath
    }
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Stage 5 dogfood loop smoke passed\n${reportPath}\n`);
} finally {
  await database.close();
}
