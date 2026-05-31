import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();

function commandEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005"
  };
}

function runJson(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(extraEnv),
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

function runExpectBlocked(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(),
    encoding: "utf8"
  });
  if (result.status === 0 || !result.stderr.includes("POLICY_BLOCKED")) {
    throw new Error(`Expected policy block: recallant ${args.join(" ")}\n${result.stderr}`);
  }
}

async function writeFixture(projectDir, marker) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Project Rules",
      "",
      `Keep ${marker} searchable through Recallant during attach smoke.`,
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "PROJECT_LOG.md"),
    [
      "# Project Log",
      "",
      "## Current Session",
      "",
      `Status: existing ${marker} project fixture.`,
      ""
    ].join("\n")
  );
  await writeFile(join(projectDir, "README.md"), `# ${marker}\nSafe fixture for detach.\n`);
}

async function lifecycleFor(projectId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'project_lifecycle'",
      [projectId]
    );
    return result.rows[0]?.value ?? null;
  } finally {
    await client.end();
  }
}

async function activeChunkCount(projectId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM chunks WHERE project_id = $1 AND archived_at IS NULL",
      [projectId]
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

async function searchProject(projectId, projectPath, query) {
  const database = new RecallantDb({
    databaseUrl,
    developerId,
    projectId,
    projectPath
  });
  try {
    return await database.search({ query, mode: "lexical_only", top_k: 5 });
  } finally {
    await database.close();
  }
}

const sandboxDir = await mkdtemp(join(tmpdir(), "recallant-phase10-detach-sandbox-"));
const liveDir = await mkdtemp(join(tmpdir(), "recallant-phase10-detach-live-"));
const activeDir = await mkdtemp(join(tmpdir(), "recallant-phase10-detach-active-"));
await writeFixture(sandboxDir, "sandboxmarker");
await writeFixture(liveDir, "livemarker");
await writeFixture(activeDir, "activemarker");

const sandboxAttach = runJson(["attach", sandboxDir, "--target", "codex", "--sandbox"]);
const liveAttach = runJson(["attach", liveDir, "--target", "codex", "--sandbox"]);
const activeAttach = runJson(["attach", activeDir, "--target", "codex", "--sandbox"]);

const sandboxSearchBefore = await searchProject(
  sandboxAttach.project_id,
  sandboxDir,
  "sandboxmarker"
);
if (sandboxSearchBefore.hits.length === 0) {
  throw new Error(`Sandbox project was not searchable before detach: ${JSON.stringify(sandboxSearchBefore)}`);
}

const dryRun = runJson([
  "detach",
  "--project-id",
  sandboxAttach.project_id,
  "--mode",
  "sandbox",
  "--dry-run"
]);
const lifecycleAfterDryRun = await lifecycleFor(sandboxAttach.project_id);
if (
  dryRun.status !== "pending_confirmation" ||
  dryRun.writes_database !== false ||
  dryRun.affected?.events < 1 ||
  lifecycleAfterDryRun?.status !== "active"
) {
  throw new Error(`Detach dry-run failed: ${JSON.stringify({ dryRun, lifecycleAfterDryRun })}`);
}

runExpectBlocked(["detach", "--project-id", sandboxAttach.project_id, "--hard-delete", "--confirm"]);

const sandboxDetach = runJson([
  "detach",
  "--project-id",
  sandboxAttach.project_id,
  "--mode",
  "sandbox",
  "--confirm"
]);
const sandboxLifecycle = await lifecycleFor(sandboxAttach.project_id);
const sandboxSearchAfter = await searchProject(
  sandboxAttach.project_id,
  sandboxDir,
  "sandboxmarker"
);
if (
  sandboxDetach.status !== "detached" ||
  sandboxDetach.changes?.physically_deleted_records !== 0 ||
  sandboxDetach.changes?.files_changed !== 0 ||
  sandboxLifecycle?.status !== "sandbox_cleaned" ||
  sandboxLifecycle?.visibility !== "hidden" ||
  sandboxSearchAfter.hits.length !== 0 ||
  !sandboxSearchAfter.warnings?.some((warning) => warning.includes("detached"))
) {
  throw new Error(
    `Sandbox detach failed: ${JSON.stringify({ sandboxDetach, sandboxLifecycle, sandboxSearchAfter })}`
  );
}

const configStillPresent = await readFile(join(sandboxDir, ".recallant", "config"), "utf8");
if (!configStillPresent.includes(sandboxAttach.project_id)) {
  throw new Error("Sandbox detach unexpectedly removed local Recallant config.");
}

const liveActiveChunksBefore = await activeChunkCount(liveAttach.project_id);
const liveDetach = runJson([
  "detach",
  "--project-id",
  liveAttach.project_id,
  "--mode",
  "live",
  "--confirm"
]);
const liveLifecycle = await lifecycleFor(liveAttach.project_id);
const liveActiveChunksAfter = await activeChunkCount(liveAttach.project_id);
if (
  liveDetach.status !== "detached" ||
  liveLifecycle?.status !== "detached" ||
  liveActiveChunksBefore < 1 ||
  liveActiveChunksAfter !== liveActiveChunksBefore
) {
  throw new Error(
    `Live detach should hide without archiving chunks: ${JSON.stringify({
      liveDetach,
      liveLifecycle,
      liveActiveChunksBefore,
      liveActiveChunksAfter
    })}`
  );
}

const activeSearch = await searchProject(activeAttach.project_id, activeDir, "activemarker");
if (activeSearch.hits.length === 0) {
  throw new Error(`Unrelated active project was affected: ${JSON.stringify(activeSearch)}`);
}

const dashboardDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: activeAttach.project_id,
  projectPath: activeDir
});
try {
  const dashboard = await dashboardDb.getReviewDashboard({ project_id: activeAttach.project_id });
  const projectIds = dashboard.projects.map((project) => project.project_id);
  if (
    projectIds.includes(sandboxAttach.project_id) ||
    projectIds.includes(liveAttach.project_id) ||
    !projectIds.includes(activeAttach.project_id) ||
    !dashboard.project_cleanup?.dry_run_first
  ) {
    throw new Error(`Dashboard did not hide detached projects: ${JSON.stringify(dashboard.projects)}`);
  }
} finally {
  await dashboardDb.close();
}

process.stdout.write("Phase 10 detach smoke passed\n");
