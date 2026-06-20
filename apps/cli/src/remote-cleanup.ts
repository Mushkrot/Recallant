import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeClientTarget } from "./client-targets.js";

type PlannedChange = {
  action: "remove_path" | "update_file";
  path: string;
  reason: string;
  next_content?: string;
};

type Warning = {
  code: string;
  message: string;
};

type RemoteCleanupOptions = {
  projectDir: string;
  target: string;
  confirm: boolean;
  removeCliWrapper: boolean;
  cliPath: string;
};

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function tablePattern(tableName: string) {
  return new RegExp(
    `(^|\\n)\\[${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`
  );
}

function findTomlTable(existing: string, tableName: string) {
  const match = existing.match(tablePattern(tableName));
  return match?.[0] ?? null;
}

function removeTomlTable(existing: string, tableName: string) {
  return existing.replace(tablePattern(tableName), "").trimEnd();
}

function isRemoteRecallantText(text: string) {
  return (
    text.includes("remote-bridge") ||
    text.includes("RECALLANT_REMOTE_MCP_URL") ||
    text.includes("RECALLANT_REMOTE_MCP_CREDENTIAL")
  );
}

function isLocalRecallantText(text: string) {
  return text.includes("mcp-server") || text.includes("RECALLANT_DATABASE_URL");
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRemoteRecallantJson(value: unknown) {
  const object = jsonObject(value);
  if (!object) return false;
  return isRemoteRecallantText(JSON.stringify(object));
}

async function codexCleanupChange(
  projectDir: string
): Promise<{ change: PlannedChange | null; warnings: Warning[] }> {
  const path = ".codex/config.toml";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return { change: null, warnings: [] };
  }
  const table = findTomlTable(existing, "mcp_servers.recallant");
  if (!table) return { change: null, warnings: [] };
  if (!isRemoteRecallantText(table)) {
    return {
      change: null,
      warnings: [
        {
          code: "recallant_codex_entry_not_remote",
          message:
            "Found [mcp_servers.recallant], but it does not look like a remote-bridge entry, so it was preserved."
        }
      ]
    };
  }
  const next = removeTomlTable(existing, "mcp_servers.recallant");
  if (!next.trim()) {
    return {
      change: {
        action: "remove_path",
        path,
        reason: "Remove generated remote Recallant Codex config; it was the only config entry."
      },
      warnings: []
    };
  }
  return {
    change: {
      action: "update_file",
      path,
      reason:
        "Remove only the generated remote Recallant MCP section while preserving other Codex settings.",
      next_content: `${next}\n`
    },
    warnings: []
  };
}

async function jsonCleanupChange(input: {
  projectDir: string;
  path: string;
}): Promise<{ change: PlannedChange | null; warnings: Warning[] }> {
  const { projectDir, path } = input;
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return { change: null, warnings: [] };
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(existing) as unknown;
    const object = jsonObject(value);
    if (!object) return { change: null, warnings: [] };
    parsed = object;
  } catch {
    return {
      change: null,
      warnings: [
        {
          code: "client_config_not_json",
          message: `${path} is not valid JSON; remote cleanup did not edit it.`
        }
      ]
    };
  }
  const servers = jsonObject(parsed.mcpServers);
  const recallant = servers?.recallant;
  if (!servers || !recallant) return { change: null, warnings: [] };
  if (!isRemoteRecallantJson(recallant)) {
    return {
      change: null,
      warnings: [
        {
          code: "recallant_json_entry_not_remote",
          message: `${path} has a Recallant MCP entry, but it does not look like a remote-bridge entry, so it was preserved.`
        }
      ]
    };
  }
  const nextServers = { ...servers };
  delete nextServers.recallant;
  const nextObject = { ...parsed };
  if (Object.keys(nextServers).length === 0) {
    delete nextObject.mcpServers;
  } else {
    nextObject.mcpServers = nextServers;
  }
  if (Object.keys(nextObject).length === 0) {
    return {
      change: {
        action: "remove_path",
        path,
        reason: "Remove generated remote Recallant MCP config; it was the only config entry."
      },
      warnings: []
    };
  }
  return {
    change: {
      action: "update_file",
      path,
      reason: "Remove only the generated remote Recallant MCP server entry.",
      next_content: `${JSON.stringify(nextObject, null, 2)}\n`
    },
    warnings: []
  };
}

async function genericRemoteCleanupChange(projectDir: string) {
  const path = ".recallant/generic-remote-mcp.json";
  let existing: string;
  try {
    existing = await readFile(join(projectDir, path), "utf8");
  } catch {
    return null;
  }
  if (!isRemoteRecallantText(existing) || isLocalRecallantText(existing)) return null;
  return {
    action: "remove_path" as const,
    path,
    reason: "Remove generated generic remote MCP config."
  };
}

function targetConfigPath(target: string) {
  const normalized = normalizeClientTarget(target);
  if (normalized === "codex") return ".codex/config.toml";
  if (normalized === "cursor") return ".cursor/mcp.json";
  if (normalized === "claude_code") return ".mcp.json";
  return ".recallant/generic-remote-mcp.json";
}

async function clientConfigCleanup(input: { projectDir: string; target: string }) {
  const target = normalizeClientTarget(input.target);
  if (target === "codex") return codexCleanupChange(input.projectDir);
  if (target === "cursor")
    return jsonCleanupChange({ projectDir: input.projectDir, path: ".cursor/mcp.json" });
  if (target === "claude_code")
    return jsonCleanupChange({ projectDir: input.projectDir, path: ".mcp.json" });
  return {
    change: await genericRemoteCleanupChange(input.projectDir),
    warnings: [] as Warning[]
  };
}

async function cliWrapperCleanupChange(path: string): Promise<{
  change: PlannedChange | null;
  warnings: Warning[];
}> {
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    return { change: null, warnings: [] };
  }
  const looksRecallantWrapper =
    existing.includes("RECALLANT_HOME=") &&
    existing.includes("apps/cli/dist/index.js") &&
    existing.includes("exec node");
  if (!looksRecallantWrapper) {
    return {
      change: null,
      warnings: [
        {
          code: "cli_wrapper_not_owned",
          message: `CLI wrapper was not removed because ${path} does not look like a Recallant wrapper.`
        }
      ]
    };
  }
  return {
    change: {
      action: "remove_path",
      path,
      reason:
        "Remove the local Recallant CLI wrapper; project files and central records are preserved."
    },
    warnings: []
  };
}

function publicChange(change: PlannedChange) {
  return {
    action: change.action,
    path: change.path,
    reason: change.reason
  };
}

async function removeEmptyDir(path: string) {
  try {
    await rm(path, { recursive: false });
    return true;
  } catch {
    return false;
  }
}

export async function cleanupRemoteClient(options: RemoteCleanupOptions) {
  const warnings: Warning[] = [];
  const changes: PlannedChange[] = [];
  const clientConfig = await clientConfigCleanup({
    projectDir: options.projectDir,
    target: options.target
  });
  warnings.push(...clientConfig.warnings);
  if (clientConfig.change) changes.push(clientConfig.change);
  if (options.removeCliWrapper) {
    const cli = await cliWrapperCleanupChange(options.cliPath);
    warnings.push(...cli.warnings);
    if (cli.change) changes.push(cli.change);
  }

  const removedPaths: string[] = [];
  const updatedPaths: string[] = [];
  if (options.confirm) {
    for (const change of changes) {
      const absolute =
        change.path.startsWith("/") || change.path.startsWith("~")
          ? change.path
          : join(options.projectDir, change.path);
      if (change.action === "update_file" && typeof change.next_content === "string") {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, change.next_content);
        updatedPaths.push(change.path);
      } else {
        await rm(absolute, { recursive: true, force: true });
        removedPaths.push(change.path);
      }
    }
    if (
      options.target === "codex" &&
      !(await pathExists(join(options.projectDir, ".codex", "config.toml")))
    ) {
      await removeEmptyDir(join(options.projectDir, ".codex"));
    }
  }

  return {
    ok: true,
    action: "remote_client_cleanup",
    status: options.confirm ? "cleaned" : "ready_for_confirmation",
    dry_run: !options.confirm,
    writes_files: options.confirm,
    writes_database: false,
    touches_local_storage: false,
    touches_docker_or_postgres: false,
    project_dir: options.projectDir,
    target: normalizeClientTarget(options.target),
    target_config: targetConfigPath(options.target),
    remove_cli_wrapper: options.removeCliWrapper,
    cli_path: options.cliPath,
    planned_changes: changes.map(publicChange),
    removed_paths: removedPaths,
    updated_paths: updatedPaths,
    preserved: [
      "source files",
      ".recallant local storage",
      "central Recallant server records",
      "Docker/Postgres",
      "Workbench/admin auth"
    ],
    warnings: warnings.map((warning) => warning.message)
  };
}

function humanReport(result: Awaited<ReturnType<typeof cleanupRemoteClient>>) {
  const planned = result.planned_changes.length
    ? result.planned_changes.map((change) => `- ${change.action}: ${change.path}`)
    : ["- none"];
  return (
    [
      "Recallant remote-cleanup",
      "",
      `Status: ${result.status}`,
      `Project: ${result.project_dir}`,
      `Target: ${result.target}`,
      `Writes files: ${result.writes_files ? "yes" : "no"}`,
      "",
      "Planned changes:",
      ...planned,
      "",
      "Preserved:",
      ...result.preserved.map((item) => `- ${item}`),
      result.warnings.length ? "" : null,
      result.warnings.length ? "Warnings:" : null,
      ...result.warnings.map((warning) => `- ${warning}`),
      "",
      result.dry_run
        ? "Next step: rerun with --confirm to remove only the remote client config entry."
        : "Remote client cleanup complete."
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n"
  );
}

export async function runRemoteCleanup(argv: readonly string[]) {
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "json" && format !== "text") throw new Error(`Invalid --format: ${format}`);
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const positionalTarget = argv[3] && !argv[3].startsWith("--") ? argv[3] : undefined;
  const target = parseFlag(argv, "--target") ?? positionalTarget ?? "codex";
  const result = await cleanupRemoteClient({
    projectDir,
    target,
    confirm: argv.includes("--confirm"),
    removeCliWrapper: argv.includes("--remove-cli-wrapper"),
    cliPath: resolve(parseFlag(argv, "--cli-path") ?? join(homedir(), ".local", "bin", "recallant"))
  });
  process.stdout.write(
    format === "json" ? `${JSON.stringify(result, null, 2)}\n` : humanReport(result)
  );
}
