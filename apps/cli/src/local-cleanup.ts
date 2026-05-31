import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRecallantDbFromEnv } from "@recallant/db";

type LocalCleanupConfig = {
  project_id?: string;
};

type PlannedChange = {
  action: "remove_path";
  path: string;
  reason: string;
};

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseProjectArg(argv: readonly string[]) {
  const flagsWithValues = new Set(["--project-dir"]);
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(projectDir: string) {
  try {
    return JSON.parse(
      await readFile(join(projectDir, ".recallant", "config"), "utf8")
    ) as LocalCleanupConfig;
  } catch {
    return null;
  }
}

function settingValue(settings: unknown, key: string) {
  if (!Array.isArray(settings)) return null;
  const row = settings.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as { key?: unknown }).key === key;
  });
  if (!row || typeof row !== "object") return null;
  return (row as { value?: unknown }).value ?? null;
}

async function resolveLifecycle(projectId: string | null) {
  const database = createRecallantDbFromEnv();
  if (!database || !projectId) return null;
  try {
    const dashboard = await database.getReviewDashboard({ project_id: projectId });
    const lifecycle = settingValue(dashboard.settings, "project_lifecycle");
    return lifecycle && typeof lifecycle === "object"
      ? (lifecycle as Record<string, unknown>)
      : null;
  } finally {
    await database.close();
  }
}

function lifecycleAllowsCleanup(lifecycle: Record<string, unknown> | null) {
  const status = String(lifecycle?.status ?? "active");
  const visibility = String(lifecycle?.visibility ?? "active");
  return (
    (status === "detached" || status === "sandbox_cleaned") &&
    (visibility === "hidden" || visibility === "detached")
  );
}

async function plannedChanges(projectDir: string, includeBackups: boolean) {
  const candidates: PlannedChange[] = [
    {
      action: "remove_path",
      path: ".recallant/config",
      reason: "Local project pointer; Recallant records are already detached separately."
    },
    {
      action: "remove_path",
      path: ".recallant/codex-mcp.json",
      reason: "Generated local MCP hint for this project."
    },
    {
      action: "remove_path",
      path: ".recallant/current-session.json",
      reason: "Local runtime session pointer."
    }
  ];
  if (includeBackups) {
    candidates.push({
      action: "remove_path",
      path: ".recallant/backups",
      reason: "Optional local attach backups; not removed unless explicitly requested."
    });
  }
  const existing = [];
  for (const candidate of candidates) {
    if (await pathExists(join(projectDir, candidate.path))) existing.push(candidate);
  }
  return existing;
}

async function removeEmptyRecallantDir(projectDir: string) {
  const recallantDir = join(projectDir, ".recallant");
  try {
    const entries = await readdir(recallantDir);
    if (entries.length === 0) {
      await rm(recallantDir, { recursive: true, force: true });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function runLocalCleanup(argv: readonly string[]) {
  const projectDir = resolve(
    parseFlag(argv, "--project-dir") ?? parseProjectArg(argv) ?? process.cwd()
  );
  const dryRun = argv.includes("--dry-run") || !argv.includes("--confirm");
  const includeBackups = argv.includes("--include-backups");
  const config = await readConfig(projectDir);
  const projectId = config?.project_id ?? null;
  const lifecycle = await resolveLifecycle(projectId);
  const allowed = lifecycleAllowsCleanup(lifecycle);
  const changes = await plannedChanges(projectDir, includeBackups);
  const warnings = [
    "Local cleanup never deletes Recallant database records; run detach first.",
    "AGENTS.md, PROJECT_LOG.md, .gitignore, and source files are not modified by this command."
  ];

  if (!allowed) {
    warnings.unshift(
      "Confirmed local cleanup is blocked until the project is detached in Recallant."
    );
  }

  if (!dryRun && !allowed) {
    throw new Error(
      "POLICY_BLOCKED: local cleanup requires a detached or sandbox-cleaned Recallant project. Run recallant detach --dry-run, then confirm detach first."
    );
  }

  const removed: string[] = [];
  if (!dryRun) {
    for (const change of changes) {
      await rm(join(projectDir, change.path), { recursive: true, force: true });
      removed.push(change.path);
    }
    if (await removeEmptyRecallantDir(projectDir)) removed.push(".recallant/");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "local_cleanup",
        status: dryRun ? (allowed ? "ready_for_confirmation" : "blocked_until_detach") : "cleaned",
        dry_run: dryRun,
        writes_files: !dryRun,
        project_dir: projectDir,
        project_id: projectId,
        lifecycle_status: lifecycle?.status ?? null,
        include_backups: includeBackups,
        planned_changes: changes,
        removed_paths: removed,
        warnings
      },
      null,
      2
    )}\n`
  );
}
