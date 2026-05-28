import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const repoRoot = process.cwd();

const backupRoot = await mkdtemp(join(tmpdir(), "recallant-phase8-backup-"));
const projectId = randomUUID();
const developerId = randomUUID();
const projectPath = `/tmp/recallant-phase8-${projectId}`;
const searchNeedle = "portable-quartz-signal";

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
try {
  await db.ensureProject(projectPath);
  const session = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectPath,
    session_label: "phase8-backup-smoke",
    resume_policy: "normal"
  });
  const event = await db.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text: `Phase 8 backup smoke creates searchable chunk ${searchNeedle}.`,
    dedup_key: `phase8-backup-turn-${randomUUID()}`
  });
  await db.appendEvent({
    session_id: session.session_id,
    client_kind: "codex",
    event_kind: "terminal_output",
    text: "Phase 8 backup smoke raw artifact pointer event.",
    metadata: { smoke: true },
    raw_artifacts: [
      {
        artifact_kind: "terminal_output",
        storage_backend: "external",
        uri: "smoke://phase8-backup-artifact",
        sha256: "2".repeat(64),
        size_bytes: 2048,
        content_type: "text/plain",
        excerpt: "bounded backup artifact excerpt",
        metadata: { smoke: true }
      }
    ],
    dedup_key: `phase8-backup-artifact-${randomUUID()}`
  });
  await db.setCheckpoint(projectId, {
    current_status: "phase8 backup smoke",
    current_focus: "backup verification",
    next_step: "continue hardening",
    open_questions: []
  });
  await db.createAgentMemory({
    memory_type: "work_log",
    scope: "project",
    title: "Phase 8 backup smoke memory",
    body: `Backup verification should preserve governed memory around ${searchNeedle}.`,
    confidence: 0.9,
    created_by: "agent",
    source_refs: [{ source_kind: "event", source_id: event.event_id, quote: searchNeedle }]
  });
} finally {
  await db.close();
}

function run(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

const backup = run(["backup", "--target", backupRoot]);
if (
  backup.ok !== true ||
  !backup.manifest_path ||
  backup.restore_verification?.status !== "not_run" ||
  backup.secret_policy !== "manifest excludes provider keys and raw secrets"
) {
  throw new Error(`Backup output failed: ${JSON.stringify(backup)}`);
}

const manifest = JSON.parse(await readFile(backup.manifest_path, "utf8"));
const tablesPath = join(backup.manifest_path, "..", "tables.json");
const tablesJson = await readFile(tablesPath, "utf8");
const tables = JSON.parse(tablesJson);
const tablesHash = createHash("sha256").update(tablesJson).digest("hex");
const manifestTables = manifest.files.find((file) => file.path === "tables.json");

if (
  manifest.backup_id !== backup.backup_id ||
  manifest.schema_version !== "0001_initial" ||
  manifestTables?.sha256 !== tablesHash ||
  !Array.isArray(tables.embeddings) ||
  !Array.isArray(tables.edges) ||
  !Array.isArray(tables.model_calls) ||
  !Array.isArray(tables.settings_audit_events) ||
  !tables.projects.some((project) => project.id === projectId) ||
  !tables.checkpoints.some((checkpoint) => checkpoint.project_id === projectId) ||
  !tables.chunks.some(
    (chunk) => chunk.project_id === projectId && chunk.text.includes(searchNeedle)
  ) ||
  !tables.agent_memories.some((memory) => memory.project_id === projectId) ||
  !tables.raw_artifacts.some(
    (artifact) => artifact.project_id === projectId && artifact.sha256 === "2".repeat(64)
  )
) {
  throw new Error(`Backup manifest/tables failed: ${JSON.stringify({ manifest, tablesHash })}`);
}

const forbiddenFragments = [
  "fixture-secret-value",
  "fixture-password",
  "sk-fixturetoken123456",
  "ANTHROPIC_API_KEY=real",
  "GEMINI_API_KEY=real"
];
const combined = `${JSON.stringify(manifest)}\n${tablesJson}`;
for (const fragment of forbiddenFragments) {
  if (combined.includes(fragment)) {
    throw new Error(`Backup leaked forbidden secret fragment: ${fragment}`);
  }
}

const latestManifestPath = join(backupRoot, "latest-manifest.json");
await symlink(backup.manifest_path, latestManifestPath);

const verify = run(["backup-verify", "--manifest", latestManifestPath, "--query", searchNeedle]);
if (
  verify.ok !== true ||
  verify.restore_verification !== "passed" ||
  verify.production_overwritten !== false ||
  Number(verify.project_count) < 1 ||
  verify.latest_checkpoint_present !== true ||
  Number(verify.governed_memory_count) < 1 ||
  Number(verify.chunk_count) < 1 ||
  Number(verify.raw_artifact_count) < 1 ||
  verify.raw_artifact_pointer_issues !== 0 ||
  Number(verify.bounded_search_matches) < 1
) {
  throw new Error(`Backup verification failed: ${JSON.stringify(verify)}`);
}

const remapPath = join(backupRoot, "restore-remap.json");
const newProjectPath = `/new-server/projects/recallant-phase8-${projectId}`;
await writeFile(
  remapPath,
  `${JSON.stringify(
    {
      project_roots: { [projectPath]: newProjectPath },
      raw_artifact_roots: { "smoke://": "restored-smoke://" },
      secret_refs: { OPENAI_API_KEY: "target-secret-store:OPENAI_API_KEY" },
      connector_accounts: { github: "reauthorize-on-target" },
      environment_facts: { ollama: "recheck-on-target" },
      ports: { recallant_http: 3005 }
    },
    null,
    2
  )}\n`
);
const restorePlan = run(["restore-plan", "--manifest", latestManifestPath, "--remap", remapPath]);
if (
  restorePlan.ok !== true ||
  restorePlan.writes_database !== false ||
  restorePlan.production_overwritten !== false ||
  !restorePlan.projects.some(
    (project) =>
      project.project_id === projectId &&
      project.old_primary_path === projectPath &&
      project.new_primary_path === newProjectPath &&
      project.needs_mapping === false
  ) ||
  restorePlan.secret_references.OPENAI_API_KEY !== "target-secret-store:OPENAI_API_KEY" ||
  restorePlan.connector_accounts.github !== "reauthorize-on-target" ||
  restorePlan.environment_facts.ollama !== "recheck-on-target"
) {
  throw new Error(`Restore remap plan failed: ${JSON.stringify(restorePlan)}`);
}

process.stdout.write("Phase 8 backup smoke passed\n");
