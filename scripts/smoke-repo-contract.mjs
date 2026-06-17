import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
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
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 5_000 });
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
  "RECALLANT_PROJECT_PATH"
]);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
delete process.env.RECALLANT_PROJECT_PATH;

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({
  name: "recallant-repo-contract-smoke",
  version: "0.0.0"
});
const server = createRecallantMcpServer();

let checkpointSet;
let checkpointGet;
let closeout;
let projectLogAfterCheckpoint;
let projectLogAfterCloseout;
let absentLogSet;
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const started = await callTool(client, "memory_start_session", {
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectDir,
    session_label: "repo-contract-smoke",
    resume_policy: "normal"
  });

  const checkpoint = {
    current_status: "repo contract smoke synced",
    current_focus: "repo checkpoint mirror",
    next_step: "continue implementation",
    open_questions: ["How often should async sync retry?"]
  };
  checkpointSet = await callTool(client, "memory_set_checkpoint", { payload: checkpoint });
  assert(
    checkpointSet.ok === true &&
      checkpointSet.repo_sync?.status === "updated" &&
      checkpointSet.repo_sync?.project_path_source === "database_primary_path",
    `Checkpoint repo sync failed: ${JSON.stringify(checkpointSet)}`
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
      projectLogAfterCheckpoint.includes(
        "Next step: continue implementation\n\n## Open Questions"
      ) &&
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
      closeout.project_log_update?.project_path_source === "database_primary_path",
    `Closeout repo sync failed: ${JSON.stringify(closeout)}`
  );
  projectLogAfterCloseout = await readFile(projectLogPath, "utf8");
  assert(
    projectLogAfterCloseout.includes("Status: repo contract closeout synced") &&
      projectLogAfterCloseout.includes("Current focus: repo closeout mirror") &&
      projectLogAfterCloseout.includes("Next step: continue closeout implementation") &&
      projectLogAfterCloseout.includes(
        "Next step: continue closeout implementation\n\n## Open Questions"
      ) &&
      projectLogAfterCloseout.includes("- Preserve this note."),
    `PROJECT_LOG.md was not closeout-synced correctly:\n${projectLogAfterCloseout}`
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
      String(absentLogSet.repo_sync?.reason ?? "").includes("PROJECT_LOG.md is not present"),
    `Absent PROJECT_LOG skip was not precise: ${JSON.stringify(absentLogSet)}`
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
        checkpoint_repo_sync: checkpointSet.repo_sync,
        checkpoint_readback: {
          current_focus: checkpointGet.payload?.current_focus,
          next_step: checkpointGet.payload?.next_step
        },
        project_log_before: projectLogBefore.split("\n").slice(0, 9),
        project_log_after_checkpoint: projectLogAfterCheckpoint.split("\n").slice(0, 9),
        closeout_project_log_update: closeout.project_log_update,
        project_log_after_closeout: projectLogAfterCloseout.split("\n").slice(0, 9),
        absent_log_repo_sync: absentLogSet.repo_sync
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("Repo contract smoke passed\n");
