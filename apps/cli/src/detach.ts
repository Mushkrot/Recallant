import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRecallantDbFromEnv } from "@recallant/db";

type DetachMode = "live" | "sandbox";

type DetachOptions = {
  projectId?: string | null;
  projectDir: string;
  mode: DetachMode;
  dryRun: boolean;
  confirm: boolean;
  reason?: string | null;
  format: "json" | "text";
};

type DetachConfig = {
  project_id?: string;
};

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseDetachProjectArg(argv: readonly string[]) {
  const flagsWithValues = new Set([
    "--project-id",
    "--project-dir",
    "--mode",
    "--reason",
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

function parseMode(argv: readonly string[]): DetachMode {
  const raw = parseFlag(argv, "--mode");
  if (raw === "live" || raw === "sandbox") return raw;
  if (raw) throw new Error(`Invalid --mode: ${raw}`);
  if (argv.includes("--sandbox") || argv.includes("--test")) return "sandbox";
  return "live";
}

function parseDetachOptions(argv: readonly string[]): DetachOptions {
  const format = parseFlag(argv, "--format") ?? "json";
  if (format !== "json" && format !== "text") throw new Error(`Invalid --format: ${format}`);
  return {
    projectId: parseFlag(argv, "--project-id") ?? null,
    projectDir: resolve(
      parseFlag(argv, "--project-dir") ?? parseDetachProjectArg(argv) ?? process.cwd()
    ),
    mode: parseMode(argv),
    dryRun: argv.includes("--dry-run") || !argv.includes("--confirm"),
    confirm: argv.includes("--confirm"),
    reason: parseFlag(argv, "--reason") ?? null,
    format
  };
}

async function readExistingConfig(projectDir: string) {
  try {
    return JSON.parse(
      await readFile(join(projectDir, ".recallant", "config"), "utf8")
    ) as DetachConfig;
  } catch {
    return null;
  }
}

function textReport(result: Record<string, unknown>) {
  const affected = result.affected as Record<string, unknown> | undefined;
  const changes = result.changes as Record<string, unknown> | undefined;
  const project = result.project as Record<string, unknown> | null | undefined;
  return (
    [
      `Recallant detach: ${result.status}`,
      `Project: ${project?.name ?? project?.project_id ?? "not found"}`,
      `Mode: ${result.mode ?? "n/a"}`,
      `Dry run: ${result.dry_run}`,
      `Affected: ${affected?.events ?? 0} events, ${affected?.chunks ?? 0} chunks, ${affected?.agent_memories ?? 0} memories`,
      `Changed: ${changes ? `${changes.closed_active_sessions ?? 0} sessions closed, ${changes.archived_chunks ?? 0} chunks archived, ${changes.physically_deleted_records ?? 0} records deleted` : "none"}`,
      "Files: no project files changed",
      "Sensitive/wrong memory: use the separate forget-forever workflow"
    ].join("\n") + "\n"
  );
}

export async function runDetach(argv: readonly string[]) {
  if (
    argv.includes("--delete") ||
    argv.includes("--hard-delete") ||
    argv.includes("--forget-forever")
  ) {
    throw new Error(
      "POLICY_BLOCKED: project detach does not perform permanent erasure. Use the separate confirmed forget workflow for sensitive or wrong memory."
    );
  }
  const options = parseDetachOptions(argv);
  const config = await readExistingConfig(options.projectDir);
  const projectId = options.projectId ?? config?.project_id ?? null;
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for project detach");
  try {
    const result = await database.detachProject({
      project_id: projectId,
      project_path: projectId ? null : options.projectDir,
      mode: options.mode,
      dry_run: options.dryRun,
      reason: options.reason,
      actor_kind: "system",
      actor_id: "recallant-cli",
      confirmation: { confirmed: options.confirm }
    });
    process.stdout.write(
      options.format === "text" ? textReport(result) : `${JSON.stringify(result, null, 2)}\n`
    );
  } finally {
    await database.close();
  }
}
