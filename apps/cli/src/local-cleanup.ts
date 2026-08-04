import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRecallantDbFromEnv } from "@recallant/db";
import { generatedMcpConfigFiles } from "./client-targets.js";

type LocalCleanupConfig = {
  project_id?: string;
};

type PlannedChange = {
  action: "remove_path" | "update_file";
  path: string;
  reason: string;
  next_content?: string;
};

type LocalCleanupOptions = {
  projectDir: string;
  dryRun: boolean;
  includeBackups: boolean;
  allowWithoutDetached?: boolean;
  includeBootstrapFiles?: boolean;
  orphanLocal?: boolean;
};

type LifecycleResolution = {
  lifecycle: Record<string, unknown> | null;
  projectId: string | null;
  resolvedBy: "project_id" | "project_path" | "project_path_fallback" | "not_found" | null;
  staleProjectId?: string | null;
  warning?: string | null;
};

type AttachBackup = {
  root: string;
  manifest: {
    changed_existing_agent_files?: unknown;
    redaction_notices?: unknown;
  };
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

function lifecycleObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function resolveLifecycle(
  projectId: string | null,
  projectDir: string
): Promise<LifecycleResolution> {
  const database = createRecallantDbFromEnv();
  if (!database) {
    return { lifecycle: null, projectId, resolvedBy: null };
  }
  try {
    const resolved = await database.resolveProjectLifecycleForCleanup({
      project_id: projectId,
      project_path: projectDir
    });
    return {
      lifecycle: lifecycleObject(resolved.lifecycle),
      projectId: resolved.target_resolution.resolved_project_id ?? projectId,
      resolvedBy: resolved.target_resolution.resolved_by,
      staleProjectId: resolved.target_resolution.stale_project_id ?? null,
      warning: resolved.warnings[0] ?? null
    };
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

function removeTomlTable(existing: string, tableName: string) {
  const tablePattern = new RegExp(
    `(^|\\n)\\[${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`
  );
  return existing.replace(tablePattern, "").trimEnd();
}

function removeRecallantMemorySection(existing: string) {
  const pattern = /(^|\n)## Memory \(Recallant\)\s*\n[\s\S]*?(?=\n## |\n# |$)/;
  return existing.replace(pattern, "").trimEnd();
}

function removeRecallantGitignoreLine(existing: string) {
  const nextLines = existing.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed !== ".recallant" && trimmed !== ".recallant/";
  });
  return nextLines.join("\n").trimEnd();
}

function generatedAgentsFileAfterSectionRemoval(existing: string, next: string) {
  const normalized = next.replace(/^# Agent Instructions\s*/i, "").replace(/\s+/g, "");
  return existing.includes("## Memory (Recallant)") && normalized.length === 0;
}

function generatedProjectLog(existing: string) {
  return (
    existing.includes("Status: attached to Recallant.") &&
    existing.includes("## Recallant") &&
    existing.includes("Recallant is the main source of truth for durable memory.")
  );
}

async function latestAttachBackup(projectDir: string): Promise<AttachBackup | null> {
  const backupsDir = join(projectDir, ".recallant", "backups");
  let entries;
  try {
    entries = await readdir(backupsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const attachBackups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("attach-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const entry of attachBackups) {
    const root = join(backupsDir, entry);
    try {
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as {
        changed_existing_agent_files?: unknown;
        redaction_notices?: unknown;
      };
      return { root, manifest };
    } catch {
      // Ignore malformed backup manifests; cleanup should remain conservative.
    }
  }
  return null;
}

function backupChangedFile(backup: AttachBackup | null, path: string) {
  const files = Array.isArray(backup?.manifest.changed_existing_agent_files)
    ? backup.manifest.changed_existing_agent_files.map(String)
    : [];
  return files.includes(path);
}

function backupRedactedFile(backup: AttachBackup | null, path: string) {
  const notices = Array.isArray(backup?.manifest.redaction_notices)
    ? backup.manifest.redaction_notices.map(String)
    : [];
  return notices.some((notice) => notice.startsWith(`${path} contained secret-like values`));
}

async function backupRestoreChange(
  projectDir: string,
  backup: AttachBackup | null,
  path: string
): Promise<PlannedChange | null> {
  if (!backupChangedFile(backup, path) || backupRedactedFile(backup, path)) return null;
  try {
    const nextContent = await readFile(join(backup!.root, path), "utf8");
    return {
      action: "update_file",
      path,
      reason: "Restore pre-attach file from a local Recallant backup.",
      next_content: nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`
    };
  } catch {
    return null;
  }
}

async function codexConfigCleanupChange(projectDir: string): Promise<PlannedChange | null> {
  const path = ".codex/config.toml";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return null;
  }
  if (!/^\s*\[mcp_servers\.recallant\]\s*$/m.test(existing)) return null;
  const next = removeTomlTable(existing, "mcp_servers.recallant");
  if (!next.trim()) {
    return {
      action: "remove_path",
      path,
      reason: "Generated Recallant MCP section was the only Codex project config."
    };
  }
  return {
    action: "update_file",
    path,
    reason:
      "Remove only the generated Recallant MCP section while preserving other Codex settings.",
    next_content: `${next}\n`
  };
}

async function gitignoreCleanupChange(projectDir: string): Promise<PlannedChange | null> {
  const path = ".gitignore";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return null;
  }
  const next = removeRecallantGitignoreLine(existing);
  if (next === existing.trimEnd()) return null;
  if (!next.trim()) {
    return {
      action: "remove_path",
      path,
      reason: "Generated ignore file only contained Recallant's local state rule."
    };
  }
  return {
    action: "update_file",
    path,
    reason: "Remove only Recallant's .recallant/ ignore rule.",
    next_content: `${next}\n`
  };
}

async function agentsCleanupChange(projectDir: string): Promise<PlannedChange | null> {
  const path = "AGENTS.md";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return null;
  }
  if (!existing.includes("## Memory (Recallant)")) return null;
  const next = removeRecallantMemorySection(existing);
  if (generatedAgentsFileAfterSectionRemoval(existing, next)) {
    return {
      action: "remove_path",
      path,
      reason: "Generated Recallant-only agent instructions file."
    };
  }
  return {
    action: "update_file",
    path,
    reason: "Remove only the generated Recallant memory section.",
    next_content: `${next}\n`
  };
}

async function projectLogCleanupChange(
  projectDir: string,
  backup: AttachBackup | null
): Promise<{ change: PlannedChange | null; warning: string | null }> {
  const path = "PROJECT_LOG.md";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return { change: null, warning: null };
  }
  if (!generatedProjectLog(existing)) return { change: null, warning: null };
  const restore = await backupRestoreChange(projectDir, backup, path);
  if (restore) return { change: restore, warning: null };
  if (backupChangedFile(backup, path) && backupRedactedFile(backup, path)) {
    return {
      change: null,
      warning:
        "PROJECT_LOG.md was overwritten during attach, but the available backup was redacted; review it manually instead of automatic restore."
    };
  }
  return {
    change: {
      action: "remove_path",
      path,
      reason: "Generated Recallant project log for a disconnected project."
    },
    warning: null
  };
}

async function plannedChanges(input: {
  projectDir: string;
  includeBackups: boolean;
  includeBootstrapFiles: boolean;
}) {
  const { projectDir, includeBackups, includeBootstrapFiles } = input;
  const candidates: PlannedChange[] = [
    {
      action: "remove_path",
      path: ".recallant/config",
      reason: "Local project pointer; Recallant records are already detached separately."
    },
    {
      action: "remove_path",
      path: generatedMcpConfigFiles[0],
      reason: "Generated local MCP hint for this project."
    },
    {
      action: "remove_path",
      path: generatedMcpConfigFiles[1],
      reason: "Generated generic local MCP hint for this project."
    },
    {
      action: "remove_path",
      path: ".recallant/current-session.json",
      reason: "Local runtime session pointer."
    },
    {
      action: "remove_path",
      path: ".recallant/hooks",
      reason: "Generated local hook scripts for this project."
    },
    {
      action: "remove_path",
      path: ".recallant/spool",
      reason: "Local offline capture spool for this project."
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
  const codexChange = await codexConfigCleanupChange(projectDir);
  if (codexChange) existing.push(codexChange);
  const warnings = [];
  if (includeBootstrapFiles) {
    const backup = await latestAttachBackup(projectDir);
    const gitignoreChange = await gitignoreCleanupChange(projectDir);
    if (gitignoreChange) existing.push(gitignoreChange);
    const agentsChange = await agentsCleanupChange(projectDir);
    if (agentsChange) existing.push(agentsChange);
    const projectLog = await projectLogCleanupChange(projectDir, backup);
    if (projectLog.change) existing.push(projectLog.change);
    if (projectLog.warning) warnings.push(projectLog.warning);
  }
  return { changes: existing, warnings };
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

function publicPlannedChange(change: PlannedChange) {
  return {
    action: change.action,
    path: change.path,
    reason: change.reason
  };
}

export async function cleanupLocalProject(options: LocalCleanupOptions) {
  const projectDir = options.projectDir;
  const dryRun = options.dryRun;
  const includeBackups = options.includeBackups;
  const config = await readConfig(projectDir);
  const configuredProjectId = config?.project_id ?? null;
  const lifecycleResolution =
    options.allowWithoutDetached === true
      ? ({
          lifecycle: null,
          projectId: configuredProjectId,
          resolvedBy: null
        } satisfies LifecycleResolution)
      : await resolveLifecycle(configuredProjectId, projectDir);
  const projectId = lifecycleResolution.projectId ?? configuredProjectId;
  const lifecycle = lifecycleResolution.lifecycle;
  const allowed = options.allowWithoutDetached === true || lifecycleAllowsCleanup(lifecycle);
  const planned = await plannedChanges({
    projectDir,
    includeBackups,
    includeBootstrapFiles: options.includeBootstrapFiles === true
  });
  const changes = planned.changes;
  const warnings = [
    "Local cleanup never deletes Recallant database records; run detach first.",
    options.includeBootstrapFiles
      ? "AGENTS.md, PROJECT_LOG.md, and .gitignore are modified only when Recallant-generated content can be removed or safely restored."
      : "AGENTS.md, PROJECT_LOG.md, .gitignore, and source files are not modified by this command.",
    ".codex/config.toml is modified only to remove Recallant's own MCP section.",
    ...(lifecycleResolution.warning ? [lifecycleResolution.warning] : []),
    ...planned.warnings
  ];
  if (options.orphanLocal === true) {
    warnings.unshift(
      "Orphan local cleanup only removes Recallant-generated local artifacts; no database records will be changed."
    );
  }

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
  const updated: string[] = [];
  if (!dryRun) {
    for (const change of changes) {
      if (change.action === "update_file" && typeof change.next_content === "string") {
        await writeFile(join(projectDir, change.path), change.next_content);
        updated.push(change.path);
      } else {
        await rm(join(projectDir, change.path), { recursive: true, force: true });
        removed.push(change.path);
      }
    }
    if (await removeEmptyRecallantDir(projectDir)) removed.push(".recallant/");
  }

  return {
    ok: true,
    action: "local_cleanup",
    status: dryRun ? (allowed ? "ready_for_confirmation" : "blocked_until_detach") : "cleaned",
    dry_run: dryRun,
    writes_files: !dryRun,
    writes_database: false,
    local_only: options.orphanLocal === true,
    project_dir: projectDir,
    project_id: projectId,
    local_config_project_id: configuredProjectId,
    target_resolution: {
      requested_project_id: configuredProjectId,
      requested_project_path: projectDir,
      resolved_project_id: projectId,
      resolved_by: lifecycleResolution.resolvedBy,
      stale_project_id: lifecycleResolution.staleProjectId ?? null
    },
    lifecycle_status: lifecycle?.status ?? null,
    include_backups: includeBackups,
    include_bootstrap_files: options.includeBootstrapFiles === true,
    planned_changes: changes.map(publicPlannedChange),
    removed_paths: removed,
    updated_paths: updated,
    warnings
  };
}

export async function runLocalCleanup(argv: readonly string[]) {
  const projectDir = resolve(
    parseFlag(argv, "--project-dir") ?? parseProjectArg(argv) ?? process.cwd()
  );
  const dryRun = argv.includes("--dry-run") || !argv.includes("--confirm");
  const includeBackups = argv.includes("--include-backups");
  const allowOrphanLocal = argv.includes("--allow-orphan-local");
  const result = await cleanupLocalProject({
    projectDir,
    dryRun,
    includeBackups,
    allowWithoutDetached: allowOrphanLocal,
    orphanLocal: allowOrphanLocal,
    includeBootstrapFiles: argv.includes("--include-bootstrap-files")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
