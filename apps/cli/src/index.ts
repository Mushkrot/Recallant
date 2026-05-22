#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { createRecallantDbFromEnv } from "@recallant/db";
import { runRecallantStdioServer } from "@recallant/mcp";

const memorySection = `## Memory (Recallant)

- At session start: call \`memory_start_session\`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call \`memory_get_context_pack\` with the current task hint.
- Use \`memory_search\` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in \`memory_search\`, not broad ones. One call per session start is usually enough.
- After meaningful progress: update checkpoint via \`memory_set_checkpoint\` and update \`PROJECT_LOG.md\` to match fields \`current_focus\` and \`next_step\`.
- On clear pause/exit/closeout intent: call \`memory_closeout\` and update \`PROJECT_LOG.md\` from the closeout payload.
- To share a pattern across projects: call \`memory_promote\` on the relevant chunk or create a governed memory proposal.
- Never paste secrets into memory tools.
- If MCP is unavailable: update \`PROJECT_LOG.md\` and, when available, write local spool.
`;

type InitOptions = {
  target: string;
  dryRun: boolean;
  captureProfile: "light" | "standard" | "detailed" | "custom";
  projectDir: string;
  serverUrl: string;
};

export function describeCliBoundary() {
  return {
    core: getRecallantCoreInfo(),
    supportedClientKinds
  };
}

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseInitOptions(argv: readonly string[]): InitOptions {
  const captureProfile = parseFlag(argv, "--capture-profile") ?? "standard";
  if (!["light", "standard", "detailed", "custom"].includes(captureProfile)) {
    throw new Error(`Invalid --capture-profile: ${captureProfile}`);
  }
  return {
    target: parseFlag(argv, "--target") ?? "codex",
    dryRun: argv.includes("--dry-run"),
    captureProfile: captureProfile as InitOptions["captureProfile"],
    projectDir: resolve(parseFlag(argv, "--project-dir") ?? process.cwd()),
    serverUrl:
      parseFlag(argv, "--server-url") ?? process.env.RECALLANT_SERVER_URL ?? "http://127.0.0.1:3005"
  };
}

function configJson(projectId: string, serverUrl: string) {
  return `${JSON.stringify({ project_id: projectId, recallant_server_url: serverUrl }, null, 2)}\n`;
}

function codexMcpConfig(projectId: string, developerId: string) {
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["mcp-server"],
        env: {
          RECALLANT_PROJECT_ID: projectId,
          RECALLANT_DEVELOPER_ID: developerId,
          RECALLANT_DATABASE_URL: "${RECALLANT_DATABASE_URL}"
        }
      }
    }
  };
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function upsertMemorySection(existing: string | null) {
  if (!existing) return `# Agent Instructions\n\n${memorySection}`;
  const pattern = /## Memory \(Recallant\)[\s\S]*?(?=\n## |\n# |$)/;
  if (pattern.test(existing)) return existing.replace(pattern, memorySection.trimEnd());
  return `${existing.trimEnd()}\n\n${memorySection}`;
}

function projectLog(projectName: string) {
  return `# Project Log

## Current Session

Status: initialized with Recallant.
Current focus: project onboarding.
Next step: start a Recallant-backed agent session.

## Open Questions

- None recorded.

## Notes

- Long history belongs in Recallant memory, not this file.
- Project: ${projectName}
`;
}

async function detectImportCandidates(projectDir: string) {
  const candidates = [];
  for (const file of ["PROJECT_LOG.md", "AGENTS.md", "CLAUDE.md", ".env.example"]) {
    const path = join(projectDir, file);
    const content = await readOptional(path);
    if (content !== null) {
      candidates.push({
        path: file,
        sha256: createHash("sha256").update(content).digest("hex"),
        suggested_command: `recallant import --dry-run ${file}`
      });
    }
  }
  return candidates;
}

async function runInit(argv: readonly string[]) {
  const options = parseInitOptions(argv);
  const projectId = randomUUID();
  const developerId = process.env.RECALLANT_DEVELOPER_ID ?? randomUUID();
  const plan = {
    action: "init",
    target: options.target,
    dry_run: options.dryRun,
    project_dir: options.projectDir,
    project_id: projectId,
    developer_id: developerId,
    capture_profile: options.captureProfile,
    files: [".recallant/config", "AGENTS.md", "PROJECT_LOG.md"],
    import_candidates: await detectImportCandidates(options.projectDir),
    mcp_config: codexMcpConfig(projectId, developerId)
  };

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  await mkdir(join(options.projectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(options.projectDir, ".recallant", "config"),
    configJson(projectId, options.serverUrl)
  );
  const agentsPath = join(options.projectDir, "AGENTS.md");
  await writeFile(agentsPath, upsertMemorySection(await readOptional(agentsPath)));
  const projectLogPath = join(options.projectDir, "PROJECT_LOG.md");
  if ((await readOptional(projectLogPath)) === null) {
    await writeFile(
      projectLogPath,
      projectLog(options.projectDir.split("/").filter(Boolean).at(-1) ?? "project")
    );
  }

  const database = createRecallantDbFromEnv();
  if (database) {
    await database.registerProject({
      projectId,
      developerId,
      projectPath: options.projectDir,
      captureProfile: options.captureProfile
    });
  }

  process.stdout.write(
    `${JSON.stringify({ ...plan, dry_run: false, status: "created" }, null, 2)}\n`
  );
}

async function runDiscover(argv: readonly string[]) {
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const result = {
    action: "discover",
    dry_run: argv.includes("--dry-run"),
    project_dir: projectDir,
    candidates: await detectImportCandidates(projectDir),
    writes_memory: false,
    promotes_instruction_grade: false
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runImport(argv: readonly string[]) {
  const target = argv.find((arg, index) => index > 2 && !arg.startsWith("--"));
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const path = target ? join(projectDir, target) : null;
  const content = path ? await readOptional(path) : null;
  const isEnvExample = target?.endsWith(".env.example") ?? false;
  const result = {
    action: "import",
    dry_run: argv.includes("--dry-run"),
    target,
    writes_memory: false,
    result_class: isEnvExample ? "secret_reference_names_only" : "source_preview",
    provisional_scope: "project",
    provisional_audience: target === "CLAUDE.md" ? "specific_client:claude_code" : "all_agents",
    source_ref: content
      ? { path: target, sha256: createHash("sha256").update(content).digest("hex") }
      : null,
    warning: argv.includes("--dry-run")
      ? "Preview only. No import_batch events, active memories, or instruction-grade records were created."
      : "Write imports are not enabled in this implementation slice."
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runLintContext(argv: readonly string[]) {
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const agents = await readOptional(join(projectDir, "AGENTS.md"));
  const projectLog = await readOptional(join(projectDir, "PROJECT_LOG.md"));
  const failures = [];
  if (agents && agents.length > 24_000 && !agents.includes("large-project override")) {
    failures.push("AGENTS.md exceeds configured bootstrap context budget");
  }
  if (agents && (agents.match(/## Memory \(Recallant\)/g)?.length ?? 0) > 1) {
    failures.push("AGENTS.md contains duplicated Memory (Recallant) sections");
  }
  if (projectLog && projectLog.length > 32_000 && !projectLog.includes("large-project override")) {
    failures.push("PROJECT_LOG.md appears to contain long historical archive");
  }
  const result = { ok: failures.length === 0, failures, project_dir: projectDir };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function runContext(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for context preview");
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const started = await database.startSession({
    client_kind: "codex",
    project_path: projectDir,
    session_label: "context-preview",
    resume_policy: "normal"
  });
  const pack = await database.getContextPack({
    session_id: String(started.session_id),
    task_hint: parseFlag(argv, "--task-hint") ?? "context preview",
    include_raw_evidence: "auto",
    include_recovery: true
  });
  process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
}

async function runDoctor() {
  const database = createRecallantDbFromEnv();
  let postgres = { configured: Boolean(process.env.RECALLANT_DATABASE_URL), reachable: false };
  if (database) {
    try {
      await database.ensureProject(process.env.RECALLANT_PROJECT_PATH ?? process.cwd());
      postgres = { configured: true, reachable: true };
    } catch {
      postgres = { configured: true, reachable: false };
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ...describeCliBoundary(),
        postgres,
        local_model: {
          provider: "ollama",
          url: process.env.RECALLANT_OLLAMA_URL ?? "http://localhost:11434",
          starts_service: false
        },
        paid_api_mode: "confirm_each",
        owner_server_notes: [
          "/ai/PORTS.yaml must be checked before service start",
          "/ai/SECURITY must be consulted before public exposure"
        ]
      },
      null,
      2
    )}\n`
  );
}

async function main(argv: readonly string[]) {
  const command = argv[2];

  if (command === "mcp-server") {
    await runRecallantStdioServer();
    return;
  }
  if (command === "doctor") return runDoctor();
  if (command === "init") return runInit(argv);
  if (command === "discover") return runDiscover(argv);
  if (command === "import") return runImport(argv);
  if (command === "lint-context") return runLintContext(argv);
  if (command === "context") return runContext(argv);

  process.stderr.write(
    "Usage: recallant <mcp-server|doctor|init|discover|import|lint-context|context>\n"
  );
  process.exitCode = 1;
}

await main(process.argv);
