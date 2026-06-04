import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const codeProjectId = randomUUID();
const codeProjectPath = await mkdtemp(join(tmpdir(), "recallant-stage6-manual-code-"));
const marker = `stage6-manual-workflow-${randomUUID()}`;
const env = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: codeProjectId,
  RECALLANT_PROJECT_PATH: codeProjectPath
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cli(args) {
  const output = execFileSync(process.execPath, [cliPath, ...args, "--format", "json"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: codeProjectId,
  projectPath: codeProjectPath
});

try {
  await db.ensureProject(codeProjectPath);
  const created = cli([
    "memory-space",
    "create",
    "--name",
    "Manual Human Memory Workflow Smoke",
    "--project-kind",
    "personal_domain",
    "--memory-domain",
    "personal_life"
  ]);
  const projectId = created.memory_space?.project_id;
  assert(projectId, `memory-space create failed: ${JSON.stringify(created)}`);

  const remembered = cli([
    "memory-space",
    "remember",
    "--project-id",
    projectId,
    "--title",
    "Manual human workflow memory",
    "--text",
    `Manual human memory ${marker} should be recalled only when this virtual space is explicit.`
  ]);
  const memoryId = remembered.memory?.memory_id;
  assert(
    remembered.passive_capture === false &&
      remembered.reversible === "review_or_archive" &&
      memoryId,
    `memory-space remember did not prove manual governed write: ${JSON.stringify(remembered)}`
  );

  const answer = cli(["ask", marker, "--project-id", projectId]);
  assert(
    answer.recall_scope === "explicit_project_id" &&
      answer.recalled === true &&
      answer.memories?.some((memory) => String(memory.body ?? "").includes(marker)),
    `explicit ask did not recall manual human memory: ${JSON.stringify(answer)}`
  );

  const codeSession = await db.startSession({
    client_kind: "codex",
    client_version: "stage6-smoke",
    project_path: codeProjectPath,
    session_label: "stage6-manual-workflow"
  });
  const codeContext = await db.getContextPack({
    session_id: codeSession.session_id,
    task_hint: `coding context should not include ${marker}`,
    include_raw_evidence: "never"
  });
  assert(
    !JSON.stringify(codeContext).includes(marker),
    `manual human memory leaked into coding context: ${JSON.stringify(codeContext)}`
  );

  const archived = await db.reviewAgentMemory({
    memory_id: memoryId,
    action: "archive",
    actor_kind: "user",
    note: "stage6 manual workflow archive proof"
  });
  assert(
    archived.status === "archived",
    `archive review action failed: ${JSON.stringify(archived)}`
  );
  const unarchived = await db.reviewAgentMemory({
    memory_id: memoryId,
    action: "unarchive",
    actor_kind: "user",
    note: "stage6 manual workflow reversibility proof"
  });
  assert(
    unarchived.status === "accepted",
    `unarchive review action failed: ${JSON.stringify(unarchived)}`
  );
} finally {
  await db.close();
  await rm(codeProjectPath, { recursive: true, force: true });
}

process.stdout.write("Stage 6 manual human-memory workflow smoke passed\n");
