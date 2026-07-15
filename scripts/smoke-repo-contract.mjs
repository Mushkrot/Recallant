import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecallantDb } from "@recallant/db";
import {
  connectClientTargetConfig,
  renderClientTargetConfig
} from "../apps/cli/dist/client-targets.js";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";
import pg from "pg";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "recallant_dev_password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function callTool(client, name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(String(text));
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();
const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = await mkdtemp(join(tmpdir(), "recallant-repo-contract-"));
const projectLogPath = join(projectDir, "PROJECT_LOG.md");
const projectLogBefore = `# Project Log

## Current Session

Status: old
Current focus: old focus
Next step: old step

## Open Questions

- old question

## Notes

- Preserve this note.
`;
await writeFile(projectLogPath, projectLogBefore);

const generatedConfig = renderClientTargetConfig(
  null,
  connectClientTargetConfig("codex", projectId, developerId, projectDir)
);
assert(
  generatedConfig.includes("RECALLANT_PROJECT_PATH") && generatedConfig.includes(projectDir),
  `Generated MCP config did not include project path: ${generatedConfig}`
);

const setupDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath: projectDir
});
await setupDb.ensureProject(projectDir);
await setupDb.close();

const envSnapshot = snapshotEnv([
  "RECALLANT_DATABASE_URL",
  "RECALLANT_DEVELOPER_ID",
  "RECALLANT_PROJECT_ID",
  "RECALLANT_PROJECT_PATH",
  "RECALLANT_EMBEDDING_PROVIDER",
  "RECALLANT_EMBEDDING_DIMS"
]);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_EMBEDDING_PROVIDER = "deterministic";
process.env.RECALLANT_EMBEDDING_DIMS = "8";
delete process.env.RECALLANT_PROJECT_PATH;

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({
  name: "recallant-repo-contract-smoke",
  version: "0.0.0"
});
const server = createRecallantMcpServer({ projectId });

let checkpointSet;
let defaultCheckpointSet;
let checkpointGet;
let closeout;
let started;
let contextPack;
let appendedEvent;
let projectLogAfterCheckpoint;
let projectLogAfterCloseout;
let absentLogSet;
let pathVerification;
let projectIdentityMismatch;
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  started = await callTool(client, "memory_start_session", {
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectDir,
    session_label: "repo-contract-smoke",
    resume_policy: "normal"
  });
  assert(
    started.project_id === projectId,
    `Session started against wrong project: ${JSON.stringify(started)}`
  );

  contextPack = await callTool(client, "memory_get_context_pack", {
    session_id: started.session_id,
    task_hint: "verify attached project path propagation",
    max_chars_total: 4000
  });
  assert(
    contextPack.project_id === projectId && contextPack.session_id === started.session_id,
    `Context pack resolved wrong project/session: ${JSON.stringify(contextPack)}`
  );

  appendedEvent = await callTool(client, "memory_append_event", {
    session_id: started.session_id,
    client_kind: "codex",
    event_kind: "other",
    text: "Repo contract MCP append event must stay scoped to the attached temp project.",
    metadata: { smoke: "repo-contract-path-propagation" },
    raw_artifacts: [],
    dedup_key: `repo-contract-path-${randomUUID()}`
  });
  assert(
    appendedEvent.status === "created" && appendedEvent.event_id,
    `Append event failed: ${JSON.stringify(appendedEvent)}`
  );

  const checkpoint = {
    current_status: "repo contract smoke synced",
    current_focus: "repo checkpoint mirror",
    next_step: "continue implementation",
    open_questions: ["How often should async sync retry?"]
  };
  defaultCheckpointSet = await callTool(client, "memory_set_checkpoint", { payload: checkpoint });
  assert(
    defaultCheckpointSet.ok === true &&
      defaultCheckpointSet.repo_sync?.status === "disabled" &&
      (await readFile(projectLogPath, "utf8")) === projectLogBefore,
    `Default checkpoint unexpectedly edited PROJECT_LOG.md: ${JSON.stringify(defaultCheckpointSet)}`
  );

  await mkdir(join(projectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(projectDir, ".recallant", "config"),
    `${JSON.stringify({ project_id: projectId, project_log_sync: "managed_block" }, null, 2)}\n`
  );
  await writeFile(
    projectLogPath,
    `# Project Log\n\nOwner notes stay byte-for-byte unchanged.\n\n<!-- recallant:checkpoint:start -->\nold managed checkpoint\n<!-- recallant:checkpoint:end -->\n\n## Human section\n\n- Preserve this note.\n`
  );
  checkpointSet = await callTool(client, "memory_set_checkpoint", { payload: checkpoint });
  assert(
    checkpointSet.ok === true &&
      checkpointSet.repo_sync?.status === "updated" &&
      checkpointSet.repo_sync?.project_path_source === "database_primary_path",
    `Managed checkpoint repo sync failed: ${JSON.stringify(checkpointSet)}`
  );
  checkpointGet = await callTool(client, "memory_get_checkpoint", {});
  assert(
    checkpointGet.payload?.current_focus === checkpoint.current_focus &&
      checkpointGet.payload?.next_step === checkpoint.next_step,
    `Checkpoint readback failed: ${JSON.stringify(checkpointGet)}`
  );
  projectLogAfterCheckpoint = await readFile(projectLogPath, "utf8");
  assert(
    projectLogAfterCheckpoint.includes("Current focus: repo checkpoint mirror") &&
      projectLogAfterCheckpoint.includes("Next step: continue implementation") &&
      projectLogAfterCheckpoint.includes("- How often should async sync retry?") &&
      projectLogAfterCheckpoint.includes("<!-- recallant:checkpoint:start -->") &&
      projectLogAfterCheckpoint.includes("<!-- recallant:checkpoint:end -->") &&
      projectLogAfterCheckpoint.includes("Owner notes stay byte-for-byte unchanged.") &&
      projectLogAfterCheckpoint.includes("- Preserve this note."),
    `PROJECT_LOG.md was not synced correctly:\n${projectLogAfterCheckpoint}`
  );

  const closeoutCheckpoint = {
    current_status: "repo contract closeout synced",
    current_focus: "repo closeout mirror",
    next_step: "continue closeout implementation",
    open_questions: []
  };
  closeout = await callTool(client, "memory_closeout", {
    session_id: started.session_id,
    closeout_intent: "task_complete",
    summary: "Repo contract closeout sync smoke complete.",
    checkpoint_payload: closeoutCheckpoint,
    governed_memory_candidates: [],
    artifact_refs: []
  });
  assert(
    closeout.ok === true &&
      closeout.project_log_update?.status === "updated" &&
      closeout.project_log_update?.project_path_source === "context",
    `Closeout repo sync failed: ${JSON.stringify(closeout)}`
  );
  projectLogAfterCloseout = await readFile(projectLogPath, "utf8");
  assert(
    projectLogAfterCloseout.includes("Status: repo contract closeout synced") &&
      projectLogAfterCloseout.includes("Current focus: repo closeout mirror") &&
      projectLogAfterCloseout.includes("Next step: continue closeout implementation") &&
      projectLogAfterCloseout.includes("<!-- recallant:checkpoint:start -->") &&
      projectLogAfterCloseout.includes("<!-- recallant:checkpoint:end -->") &&
      projectLogAfterCloseout.includes("- Preserve this note."),
    `PROJECT_LOG.md was not closeout-synced correctly:\n${projectLogAfterCloseout}`
  );

  const verificationClient = new pg.Client({ connectionString: databaseUrl });
  await verificationClient.connect();
  try {
    const verified = await verificationClient.query(
      `
        SELECT
          (SELECT primary_path FROM projects WHERE id = $2) AS primary_path,
          (SELECT count(*)::int FROM sessions WHERE id = $1 AND project_id = $2) AS session_rows,
          (SELECT count(*)::int FROM events WHERE id = $3 AND project_id = $2) AS event_rows,
          (SELECT count(*)::int FROM checkpoints WHERE project_id = $2 AND payload->>'current_focus' = $4) AS checkpoint_rows
      `,
      [started.session_id, projectId, appendedEvent.event_id, closeoutCheckpoint.current_focus]
    );
    pathVerification = verified.rows[0];
  } finally {
    await verificationClient.end();
  }
  assert(
    pathVerification.primary_path === projectDir &&
      pathVerification.session_rows === 1 &&
      pathVerification.event_rows === 1 &&
      pathVerification.checkpoint_rows === 1,
    `MCP calls did not stay scoped to temp project: ${JSON.stringify(pathVerification)}`
  );

  await unlink(projectLogPath);
  absentLogSet = await callTool(client, "memory_set_checkpoint", {
    payload: {
      current_status: "repo contract absent log skipped",
      current_focus: "absent log",
      next_step: "do not edit manually",
      open_questions: []
    }
  });
  assert(
    absentLogSet.ok === true &&
      absentLogSet.repo_sync?.status === "skipped" &&
      absentLogSet.repo_sync?.reason === "migration_required",
    `Absent PROJECT_LOG migration gate was not precise: ${JSON.stringify(absentLogSet)}`
  );

  const mismatchProjectDir = await mkdtemp(join(tmpdir(), "recallant-project-id-mismatch-"));
  await mkdir(join(mismatchProjectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(mismatchProjectDir, ".recallant", "config"),
    `${JSON.stringify({ project_id: randomUUID(), project_log_sync: "managed_block" }, null, 2)}\n`
  );
  let mismatchError = null;
  try {
    const mismatchResponse = await callTool(client, "memory_start_session", {
      client_kind: "codex",
      client_version: "smoke",
      project_path: mismatchProjectDir,
      session_label: "must-not-start"
    });
    mismatchError = JSON.stringify(mismatchResponse);
  } catch (error) {
    mismatchError = error instanceof Error ? error.message : String(error);
  }
  projectIdentityMismatch = mismatchError;
  assert(
    mismatchError?.includes("PROJECT_ID_PATH_MISMATCH"),
    `Project-id/path mismatch was not rejected before session creation: ${mismatchError}`
  );
} finally {
  await client.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  restoreEnv(envSnapshot);
}

process.stdout.write(
  `${JSON.stringify(
    {
      repo_contract: {
        mcp_config_excerpt: generatedConfig
          .split("\n")
          .filter((line) => line.includes("RECALLANT_PROJECT_") || line.startsWith("[mcp_servers")),
        default_checkpoint_repo_sync: defaultCheckpointSet.repo_sync,
        checkpoint_repo_sync: checkpointSet.repo_sync,
        path_propagation: {
          project_dir: projectDir,
          started_project_id: started.project_id,
          context_pack_project_id: contextPack.project_id,
          append_event_id: appendedEvent.event_id,
          database_verification: pathVerification
        },
        checkpoint_readback: {
          current_focus: checkpointGet.payload?.current_focus,
          next_step: checkpointGet.payload?.next_step
        },
        project_log_before: projectLogBefore.split("\n").slice(0, 9),
        project_log_after_checkpoint: projectLogAfterCheckpoint.split("\n").slice(0, 9),
        closeout_project_log_update: closeout.project_log_update,
        project_log_after_closeout: projectLogAfterCloseout.split("\n").slice(0, 9),
        absent_log_repo_sync: absentLogSet.repo_sync,
        project_identity_mismatch: projectIdentityMismatch
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("Repo contract smoke passed\n");
