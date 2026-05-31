import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const developerId = randomUUID();

function commandEnv(extra = {}) {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
    ...extra
  };
}

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(),
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

function runBlocked(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(),
    encoding: "utf8"
  });
  if (result.status === 0 || !result.stderr.includes("POLICY_BLOCKED")) {
    throw new Error(`Expected policy block: recallant ${args.join(" ")}\n${result.stderr}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-local-cleanup-"));
await mkdir(join(projectDir, "docs"), { recursive: true });
await writeFile(
  join(projectDir, "AGENTS.md"),
  ["# Agent Instructions", "", "Keep local cleanup fixture rules intact.", ""].join("\n")
);
await writeFile(
  join(projectDir, "PROJECT_LOG.md"),
  ["# Project Log", "", "## Current Session", "", "Status: fixture before attach.", ""].join("\n")
);
await writeFile(join(projectDir, "docs", "README.md"), "# Fixture Docs\n");

const attach = runJson(["attach", projectDir, "--target", "codex", "--sandbox"]);
if (attach.status !== "attached" || !attach.backup?.path) {
  throw new Error(`Attach did not prepare cleanup fixture: ${JSON.stringify(attach)}`);
}

const start = runJson([
  "agent-start",
  "--project-dir",
  projectDir,
  "--task-hint",
  "local cleanup smoke"
]);
if (!start.session_id) throw new Error(`agent-start failed: ${JSON.stringify(start)}`);

const closeout = runJson([
  "agent-closeout",
  "--project-dir",
  projectDir,
  "--summary",
  "Local cleanup smoke session closed"
]);
if (closeout.closeout?.report_required !== false) {
  throw new Error(`closeout reported warnings: ${JSON.stringify(closeout)}`);
}

const activeDryRun = runJson(["local-cleanup", "--project-dir", projectDir, "--dry-run"]);
if (activeDryRun.status !== "blocked_until_detach" || activeDryRun.writes_files !== false) {
  throw new Error(`active local cleanup dry-run should be blocked: ${JSON.stringify(activeDryRun)}`);
}
runBlocked(["local-cleanup", "--project-dir", projectDir, "--confirm"]);

const detach = runJson([
  "detach",
  "--project-id",
  attach.project_id,
  "--mode",
  "sandbox",
  "--confirm"
]);
if (detach.status !== "detached" || detach.changes?.files_changed !== 0) {
  throw new Error(`detach failed before local cleanup: ${JSON.stringify(detach)}`);
}

const detachedDryRun = runJson(["local-cleanup", "--project-dir", projectDir, "--dry-run"]);
if (
  detachedDryRun.status !== "ready_for_confirmation" ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/config") ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/codex-mcp.json") ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/current-session.json")
) {
  throw new Error(`detached local cleanup dry-run failed: ${JSON.stringify(detachedDryRun)}`);
}

const cleanup = runJson(["local-cleanup", "--project-dir", projectDir, "--confirm"]);
if (
  cleanup.status !== "cleaned" ||
  cleanup.removed_paths.length < 3 ||
  (await exists(join(projectDir, ".recallant", "config"))) ||
  (await exists(join(projectDir, ".recallant", "codex-mcp.json"))) ||
  (await exists(join(projectDir, ".recallant", "current-session.json")))
) {
  throw new Error(`confirmed local cleanup failed: ${JSON.stringify(cleanup)}`);
}

const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
if (
  !agents.includes("Memory (Recallant)") ||
  !projectLog.includes("Local cleanup smoke session closed") ||
  !(await exists(join(projectDir, ".recallant", "backups")))
) {
  throw new Error("local cleanup removed bootstrap files or backups unexpectedly");
}

const backupDryRun = runJson([
  "local-cleanup",
  "--project-dir",
  projectDir,
  "--include-backups",
  "--dry-run"
]);
if (!backupDryRun.planned_changes.some((change) => change.path === ".recallant/backups")) {
  throw new Error(`include-backups dry-run did not report backups: ${JSON.stringify(backupDryRun)}`);
}

process.stdout.write("Local cleanup smoke passed\n");
