import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
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
const orphanDir = await mkdtemp(join(tmpdir(), "recallant-local-cleanup-orphan-"));
const staleDir = await mkdtemp(join(tmpdir(), "recallant-local-cleanup-stale-"));
await mkdir(join(projectDir, "docs"), { recursive: true });
await mkdir(join(orphanDir, ".recallant"), { recursive: true });
await mkdir(join(orphanDir, ".recallant", "hooks"), { recursive: true });
await mkdir(join(orphanDir, ".recallant", "spool"), { recursive: true });
await mkdir(join(orphanDir, ".codex"), { recursive: true });
await mkdir(join(staleDir, "docs"), { recursive: true });
await writeFile(
  join(projectDir, "AGENTS.md"),
  ["# Agent Instructions", "", "Keep local cleanup fixture rules intact.", ""].join("\n")
);
await writeFile(
  join(projectDir, "PROJECT_LOG.md"),
  ["# Project Log", "", "## Current Session", "", "Status: fixture before attach.", ""].join("\n")
);
const originalProjectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
await writeFile(join(projectDir, "docs", "README.md"), "# Fixture Docs\n");
await writeFile(join(orphanDir, "README.md"), "# Orphan Local Fixture\n");
await writeFile(join(staleDir, "README.md"), "# Stale Local Fixture\n");
await writeFile(join(staleDir, "docs", "README.md"), "# Stale Fixture Docs\n");
await writeFile(join(orphanDir, ".codex", "config.toml"), "[settings]\nmode = \"fixture\"\n");
await writeFile(
  join(orphanDir, ".recallant", "config"),
  `${JSON.stringify({ project_id: randomUUID() }, null, 2)}\n`
);
await writeFile(
  join(orphanDir, ".recallant", "current-session.json"),
  `${JSON.stringify({ session_id: "orphan-local-session" }, null, 2)}\n`
);
await writeFile(join(orphanDir, ".recallant", "hooks", "start-session.sh"), "#!/usr/bin/env sh\n");
await writeFile(join(orphanDir, ".recallant", "spool", "spool.jsonl"), "{}\n");

const attach = runJson([
  "attach",
  projectDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
if (attach.status !== "attached" || !attach.backup?.path) {
  throw new Error(`Attach did not prepare cleanup fixture: ${JSON.stringify(attach)}`);
}
await writeFile(join(projectDir, ".recallant", "generic-mcp.json"), "{}\n");

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
await mkdir(join(projectDir, ".recallant", "hooks"), { recursive: true });
await mkdir(join(projectDir, ".recallant", "spool"), { recursive: true });
await writeFile(join(projectDir, ".recallant", "hooks", "start-session.sh"), "#!/usr/bin/env sh\n");
await writeFile(join(projectDir, ".recallant", "spool", "spool.jsonl"), "{}\n");

const activeDryRun = runJson(["local-cleanup", "--project-dir", projectDir, "--dry-run"]);
if (activeDryRun.status !== "blocked_until_detach" || activeDryRun.writes_files !== false) {
  throw new Error(
    `active local cleanup dry-run should be blocked: ${JSON.stringify(activeDryRun)}`
  );
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
  !detachedDryRun.planned_changes.some((change) => change.path === ".codex/config.toml") ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/generic-mcp.json") ||
  !detachedDryRun.planned_changes.some(
    (change) => change.path === ".recallant/current-session.json"
  ) ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/hooks") ||
  !detachedDryRun.planned_changes.some((change) => change.path === ".recallant/spool")
) {
  throw new Error(`detached local cleanup dry-run failed: ${JSON.stringify(detachedDryRun)}`);
}

const cleanup = runJson(["local-cleanup", "--project-dir", projectDir, "--confirm"]);
if (
  cleanup.status !== "cleaned" ||
  cleanup.removed_paths.length < 3 ||
  (await exists(join(projectDir, ".recallant", "config"))) ||
  (await exists(join(projectDir, ".codex", "config.toml"))) ||
  (await exists(join(projectDir, ".recallant", "generic-mcp.json"))) ||
  (await exists(join(projectDir, ".recallant", "current-session.json"))) ||
  (await exists(join(projectDir, ".recallant", "hooks"))) ||
  (await exists(join(projectDir, ".recallant", "spool")))
) {
  throw new Error(`confirmed local cleanup failed: ${JSON.stringify(cleanup)}`);
}

const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
if (
  !agents.includes("Memory (Recallant)") ||
  projectLog !== originalProjectLog ||
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
  throw new Error(
    `include-backups dry-run did not report backups: ${JSON.stringify(backupDryRun)}`
  );
}

const orphanBlocked = runJson(["local-cleanup", "--project-dir", orphanDir, "--dry-run"]);
if (
  orphanBlocked.status !== "blocked_until_detach" ||
  orphanBlocked.writes_files !== false ||
  orphanBlocked.local_only !== false
) {
  throw new Error(`orphan cleanup should be blocked without opt-in: ${JSON.stringify(orphanBlocked)}`);
}
const orphanDryRun = runJson([
  "local-cleanup",
  "--project-dir",
  orphanDir,
  "--allow-orphan-local",
  "--dry-run"
]);
if (
  orphanDryRun.status !== "ready_for_confirmation" ||
  orphanDryRun.local_only !== true ||
  orphanDryRun.writes_database !== false ||
  orphanDryRun.writes_files !== false ||
  !orphanDryRun.planned_changes.some((change) => change.path === ".recallant/config") ||
  !orphanDryRun.planned_changes.some(
    (change) => change.path === ".recallant/current-session.json"
  ) ||
  !orphanDryRun.planned_changes.some((change) => change.path === ".recallant/hooks") ||
  !orphanDryRun.planned_changes.some((change) => change.path === ".recallant/spool") ||
  !orphanDryRun.warnings.some((warning) => /no database records/i.test(warning))
) {
  throw new Error(`orphan local cleanup dry-run failed: ${JSON.stringify(orphanDryRun)}`);
}
const orphanCleanup = runJson([
  "local-cleanup",
  "--project-dir",
  orphanDir,
  "--allow-orphan-local",
  "--confirm"
]);
const orphanCodex = await readFile(join(orphanDir, ".codex", "config.toml"), "utf8");
if (
  orphanCleanup.status !== "cleaned" ||
  orphanCleanup.local_only !== true ||
  orphanCleanup.writes_database !== false ||
  orphanCleanup.writes_files !== true ||
  (await exists(join(orphanDir, ".recallant", "config"))) ||
  (await exists(join(orphanDir, ".recallant", "current-session.json"))) ||
  (await exists(join(orphanDir, ".recallant", "hooks"))) ||
  (await exists(join(orphanDir, ".recallant", "spool"))) ||
  !(await exists(join(orphanDir, "README.md"))) ||
  !orphanCodex.includes("mode = \"fixture\"")
) {
  throw new Error(`confirmed orphan local cleanup failed: ${JSON.stringify(orphanCleanup)}`);
}

const staleAttach = runJson([
  "attach",
  staleDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
if (staleAttach.status !== "attached" || !staleAttach.project_id) {
  throw new Error(`stale fixture attach failed: ${JSON.stringify(staleAttach)}`);
}
const staleProjectId = randomUUID();
await writeFile(
  join(staleDir, ".recallant", "config"),
  `${JSON.stringify({ project_id: staleProjectId }, null, 2)}\n`
);
const staleSanitize = runJson([
  "project-sanitize",
  "--project-dir",
  staleDir,
  "--mode",
  "detach",
  "--detach-mode",
  "sandbox",
  "--confirm",
  "--format",
  "json"
]);
if (
  staleSanitize.status !== "detached" ||
  staleSanitize.database?.target_resolution?.resolved_by !== "project_path_fallback" ||
  staleSanitize.database?.target_resolution?.stale_project_id !== staleProjectId
) {
  throw new Error(`stale fixture sanitize did not use path fallback: ${JSON.stringify(staleSanitize)}`);
}
const staleDryRun = runJson(["local-cleanup", "--project-dir", staleDir, "--dry-run"]);
if (
  staleDryRun.status !== "ready_for_confirmation" ||
  staleDryRun.target_resolution?.resolved_by !== "project_path_fallback" ||
  staleDryRun.target_resolution?.stale_project_id !== staleProjectId ||
  !staleDryRun.planned_changes.some((change) => change.path === ".recallant/config")
) {
  throw new Error(`stale local cleanup dry-run failed: ${JSON.stringify(staleDryRun)}`);
}
const staleCleanup = runJson(["local-cleanup", "--project-dir", staleDir, "--confirm"]);
if (
  staleCleanup.status !== "cleaned" ||
  staleCleanup.target_resolution?.resolved_by !== "project_path_fallback" ||
  (await exists(join(staleDir, ".recallant", "config")))
) {
  throw new Error(`confirmed stale local cleanup failed: ${JSON.stringify(staleCleanup)}`);
}

process.stdout.write("Local cleanup smoke passed\n");
