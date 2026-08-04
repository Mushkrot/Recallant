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

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plannedCount(local: Record<string, unknown> | undefined) {
  return Array.isArray(local?.planned_changes) ? local.planned_changes.length : 0;
}

function targetRequestSource(input: {
  explicitProjectId: string | null;
  orphanLocalRequested: boolean;
}) {
  if (input.orphanLocalRequested) return "orphan_local_artifacts";
  return input.explicitProjectId ? "--project-id" : "--project-dir";
}

function buildSanitizeReceipt(input: {
  options: ProjectSanitizeOptions;
  config: ProjectSanitizeConfig | null;
  explicitProjectId: string | null;
  databaseResult: Record<string, unknown>;
  localCleanup: Record<string, unknown>;
  orphanLocalRequested: boolean;
}) {
  const database = input.databaseResult;
  const local = input.localCleanup;
  const project = objectValue(database.project);
  const plan = objectValue(database.plan);
  const changes = objectValue(database.changes);
  const resolution = objectValue(database.target_resolution);
  const deleteRecords = objectValue(plan.delete_records);
  const deidentifyRecords = objectValue(plan.deidentify_records);
  const confirmation = objectValue(database.confirmation);
  const erasureId = typeof database.erasure_id === "string" ? database.erasure_id : null;
  const resolvedProjectId =
    typeof resolution.resolved_project_id === "string"
      ? resolution.resolved_project_id
      : typeof project.project_id === "string"
        ? project.project_id
        : null;
  const projectPath =
    typeof project.primary_path === "string" ? project.primary_path : input.options.projectDir;
  return {
    target: {
      requested_via: targetRequestSource({
        explicitProjectId: input.explicitProjectId,
        orphanLocalRequested: input.orphanLocalRequested
      }),
      matching_mode: String(resolution.resolved_by ?? "unknown"),
      requested_project_id:
        typeof resolution.requested_project_id === "string"
          ? resolution.requested_project_id
          : null,
      requested_project_path:
        typeof resolution.requested_project_path === "string"
          ? resolution.requested_project_path
          : null,
      stale_project_id:
        typeof resolution.stale_project_id === "string" ? resolution.stale_project_id : null,
      resolved_project_id: resolvedProjectId,
      project_id: resolvedProjectId,
      project_path: projectPath,
      local_project_dir: input.options.projectDir,
      local_config_project_id: input.config?.project_id ?? null,
      database_project_found: Boolean(project.project_id)
    },
    database_action: {
      mode: input.options.mode,
      status: String(database.status ?? "unknown"),
      dry_run: Boolean(database.dry_run),
      writes_database: Boolean(database.writes_database),
      records_to_delete: Object.values(deleteRecords).reduce(
        (total: number, value) => total + numberValue(value),
        0
      ),
      records_to_deidentify: Object.values(deidentifyRecords).reduce(
        (total: number, value) => total + numberValue(value),
        0
      ),
      physically_deleted_records: numberValue(changes.physically_deleted_records),
      deidentified_records: numberValue(changes.deidentified_records),
      confirmation_required: Boolean(confirmation.required),
      confirmation_token: typeof confirmation.token === "string" ? confirmation.token : null,
      erasure_id: erasureId
    },
    local_action: {
      included: input.options.includeLocal,
      status: String(local.status ?? "unknown"),
      dry_run: Boolean(local.dry_run),
      writes_files: Boolean(local.writes_files),
      local_only: Boolean(local.local_only),
      planned_changes: plannedCount(local),
      removed_paths: Array.isArray(local.removed_paths) ? local.removed_paths.map(String) : [],
      updated_paths: Array.isArray(local.updated_paths) ? local.updated_paths.map(String) : []
    },
    retained_governance_receipt: {
      planned_or_retained: input.options.mode === "purge" && !input.orphanLocalRequested,
      retained: Boolean(erasureId),
      redacted: input.options.mode === "purge",
      table: "erasure_requests",
      erasure_id: erasureId
    },
    cleanup_scope: {
      operation: "remove_recallant_from_target_project",
      not_product_repo_cleanup: true,
      removes_recallant_database_records:
        input.options.mode === "purge" && database.status === "purged",
      disconnects_local_recallant_artifacts: Boolean(local.writes_files),
      preserves_source_files: true,
      preserves_secrets: true,
      preserves_downloads: true,
      preserves_dependencies: true,
      refuses_unmarked_data: true
    }
  };
}

function textReport(result: Record<string, unknown>) {
  const database = result.database as Record<string, unknown> | undefined;
  const local = result.local_cleanup as Record<string, unknown> | undefined;
  const receipt = objectValue(result.receipt);
  const target = objectValue(receipt.target);
  const databaseAction = objectValue(receipt.database_action);
  const localAction = objectValue(receipt.local_action);
  const cleanupScope = objectValue(receipt.cleanup_scope);
  const project = database?.project as Record<string, unknown> | null | undefined;
  const affected = database?.affected as Record<string, unknown> | undefined;
  const confirmation = database?.confirmation as Record<string, unknown> | undefined;
  const changes = database?.changes as Record<string, unknown> | undefined;
  const lines = [
    `Recallant project sanitize: ${database?.status ?? result.status}`,
    `Mode: ${database?.mode ?? result.mode}`,
    `Target source: ${String(target.requested_via ?? "unknown")}`,
    `Target match: ${String(target.matching_mode ?? "unknown")}`,
    `Resolved project id: ${String(target.resolved_project_id ?? "none")}`,
    `Project path: ${String(target.project_path ?? result.project_dir)}`,
    `Cleanup scope: ${String(cleanupScope.operation ?? "remove_recallant_from_target_project")}`,
    `Product repo cleanup: ${cleanupScope.not_product_repo_cleanup ? "no" : "unknown"}`,
    `Project: ${project?.name ?? project?.project_id ?? "not found"}`,
    `Dry run: ${database?.dry_run ?? result.dry_run}`,
    `Database action: ${databaseAction.status ?? database?.status ?? "unknown"}, writes=${database?.writes_database ?? false}`,
    `Local action: ${localAction.status ?? local?.status ?? "unknown"}, writes=${local?.writes_files ?? false}`,
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
  const receipt = buildSanitizeReceipt({
    options,
    config,
    explicitProjectId,
    databaseResult,
    localCleanup,
    orphanLocalRequested
  });

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
    receipt,
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
