import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRecallantDbFromEnv } from "@recallant/db";
import { cleanupLocalProject } from "./local-cleanup.js";

type ProjectSanitizeMode = "detach" | "purge";

type ProjectSanitizeOptions = {
  projectId?: string | null;
  projectDir: string;
  mode: ProjectSanitizeMode;
  detachMode: "live" | "sandbox";
  dryRun: boolean;
  confirmToken?: string | null;
  confirmDetach: boolean;
  includeLocal: boolean;
  includeBackups: boolean;
  allowOrphanLocal: boolean;
  reason?: string | null;
  format: "json" | "text";
};

type ProjectSanitizeConfig = {
  project_id?: string;
};

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseProjectArg(argv: readonly string[]) {
  const flagsWithValues = new Set([
    "--project-id",
    "--project-dir",
    "--mode",
    "--detach-mode",
    "--reason",
    "--confirm-token",
    "--format"
  ]);
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

function parseMode(raw: string | undefined): ProjectSanitizeMode {
  if (!raw) return "purge";
  if (raw === "detach" || raw === "purge") return raw;
  throw new Error(`Invalid --mode: ${raw}`);
}

function parseDetachMode(raw: string | undefined) {
  if (!raw) return "live";
  if (raw === "live" || raw === "sandbox") return raw;
  throw new Error(`Invalid --detach-mode: ${raw}`);
}

function parseProjectSanitizeOptions(argv: readonly string[]): ProjectSanitizeOptions {
  const format = parseFlag(argv, "--format") ?? "json";
  if (format !== "json" && format !== "text") throw new Error(`Invalid --format: ${format}`);
  const mode = parseMode(parseFlag(argv, "--mode"));
  const confirmToken = parseFlag(argv, "--confirm-token") ?? null;
  const dryRun =
    argv.includes("--dry-run") || (mode === "purge" ? !confirmToken : !argv.includes("--confirm"));
  const projectDir = resolve(
    parseFlag(argv, "--project-dir") ?? parseProjectArg(argv) ?? process.cwd()
  );
  return {
    projectId: parseFlag(argv, "--project-id") ?? null,
    projectDir,
    mode,
    detachMode: parseDetachMode(parseFlag(argv, "--detach-mode")),
    dryRun,
    confirmToken,
    confirmDetach: argv.includes("--confirm"),
    includeLocal: !argv.includes("--no-local"),
    includeBackups: argv.includes("--include-backups"),
    allowOrphanLocal: argv.includes("--allow-orphan-local"),
    reason: parseFlag(argv, "--reason") ?? null,
    format
  };
}

async function readExistingConfig(projectDir: string) {
  try {
    return JSON.parse(
      await readFile(join(projectDir, ".recallant", "config"), "utf8")
    ) as ProjectSanitizeConfig;
  } catch {
    return null;
  }
}

function textReport(result: Record<string, unknown>) {
  const database = result.database as Record<string, unknown> | undefined;
  const local = result.local_cleanup as Record<string, unknown> | undefined;
  const project = database?.project as Record<string, unknown> | null | undefined;
  const affected = database?.affected as Record<string, unknown> | undefined;
  const confirmation = database?.confirmation as Record<string, unknown> | undefined;
  const changes = database?.changes as Record<string, unknown> | undefined;
  const lines = [
    `Recallant project sanitize: ${database?.status ?? result.status}`,
    `Mode: ${database?.mode ?? result.mode}`,
    `Project: ${project?.name ?? project?.project_id ?? "not found"}`,
    `Dry run: ${database?.dry_run ?? result.dry_run}`,
    `Database writes: ${database?.writes_database ?? false}`,
    `Local writes: ${local?.writes_files ?? false}`,
    `Affected: ${affected?.events ?? 0} events, ${affected?.chunks ?? 0} chunks, ${affected?.agent_memories ?? 0} memories`,
    `Deleted records: ${changes?.physically_deleted_records ?? 0}`
  ];
  if (confirmation?.token) lines.push(`Confirm token: ${confirmation.token}`);
  if (local?.planned_changes) {
    const planned = Array.isArray(local.planned_changes) ? local.planned_changes.length : 0;
    lines.push(`Local planned changes: ${planned}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runProjectSanitize(argv: readonly string[]) {
  const options = parseProjectSanitizeOptions(argv);
  const config = await readExistingConfig(options.projectDir);
  const explicitProjectId = options.projectId ?? null;
  const projectId = explicitProjectId ?? config?.project_id ?? null;
  const projectPath = explicitProjectId ? null : options.projectDir;
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for project sanitize");

  let databaseResult: Record<string, unknown>;
  try {
    databaseResult = (await database.sanitizeProject({
      project_id: projectId,
      project_path: projectPath,
      mode: options.mode,
      detach_mode: options.detachMode,
      dry_run: options.dryRun,
      reason: options.reason,
      actor_kind: "system",
      actor_id: "recallant-cli",
      request_source: "cli",
      confirmation: {
        confirmed: options.mode === "purge" ? Boolean(options.confirmToken) : options.confirmDetach,
        confirmation_token: options.confirmToken
      }
    })) as Record<string, unknown>;
  } finally {
    await database.close();
  }

  const shouldPlanLocal = options.includeLocal && options.projectDir && options.mode === "purge";
  const databasePurged = databaseResult.status === "purged" && databaseResult.dry_run === false;
  const orphanLocalRequested =
    options.allowOrphanLocal === true && databaseResult.status === "not_found";
  const orphanLocalConfirmed = orphanLocalRequested && options.confirmDetach === true;
  const shouldWriteLocal =
    shouldPlanLocal && (databasePurged || (orphanLocalRequested && orphanLocalConfirmed));
  const localCleanup = shouldPlanLocal
    ? await cleanupLocalProject({
        projectDir: options.projectDir,
        dryRun: !shouldWriteLocal,
        includeBackups: options.includeBackups,
        allowWithoutDetached: options.mode === "purge" || databasePurged || orphanLocalRequested,
        orphanLocal: orphanLocalRequested,
        includeBootstrapFiles: true
      })
    : {
        ok: true,
        action: "local_cleanup",
        status: "skipped",
        dry_run: true,
        writes_files: false,
        reason: options.includeLocal
          ? "Local cleanup is available only when a project directory is known."
          : "Local cleanup disabled by --no-local.",
        warnings: []
      };

  const result = {
    ok: (Boolean(databaseResult.ok) || orphanLocalRequested) && Boolean(localCleanup.ok),
    action: "project_sanitize",
    status:
      orphanLocalRequested && localCleanup.status === "cleaned"
        ? "orphan_local_cleaned"
        : databaseResult.status,
    mode: options.mode,
    dry_run: Boolean(databaseResult.dry_run) && !shouldWriteLocal,
    writes_database: Boolean(databaseResult.writes_database),
    writes_files: Boolean(localCleanup.writes_files),
    local_only_cleanup: orphanLocalRequested,
    project_dir: options.projectDir,
    database: databaseResult,
    local_cleanup: localCleanup,
    warnings: [
      ...((Array.isArray(databaseResult.warnings) ? databaseResult.warnings : []) as unknown[]).map(
        String
      ),
      ...localCleanup.warnings
    ]
  };

  process.stdout.write(
    options.format === "text" ? textReport(result) : `${JSON.stringify(result, null, 2)}\n`
  );
}
