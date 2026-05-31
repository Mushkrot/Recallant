#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { createRecallantDbFromEnv } from "@recallant/db";
import type { JsonObject, RawArtifactInput } from "@recallant/db";
import { runRecallantStdioServer } from "@recallant/mcp";
import pg from "pg";
import {
  detectImportCandidates,
  discoveryCandidateForImport,
  discoveryResult,
  formatDiscoveryText,
  readImportTextForCandidate
} from "./discovery.js";
import { runAttach } from "./attach.js";
import { runDetach } from "./detach.js";

const memorySection = `## Memory (Recallant)

- At session start: call \`memory_start_session\`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call \`memory_get_context_pack\` with the current task hint.
- Use \`memory_search\` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in \`memory_search\`, not broad ones. One call per session start is usually enough.
- After meaningful progress: write meaningful events/memories through \`memory_append_event\` or \`memory_create_agent_memory\`, update checkpoint via \`memory_set_checkpoint\`, and update \`PROJECT_LOG.md\` to match fields \`current_focus\` and \`next_step\`.
- On clear pause/exit/closeout intent: call \`memory_closeout\` and update \`PROJECT_LOG.md\` from the closeout payload.
- To reuse a pattern from another project: search explicitly for source-linked examples, adapt the pattern locally, and create current-project memory with source refs after applying it.
- Never paste secrets into memory tools.
- If direct MCP use is unavailable, use the CLI capture fallback: \`recallant agent-start\`,
  \`recallant agent-event\`, \`recallant agent-checkpoint\`, and \`recallant agent-closeout\`.
  If the server is unavailable, the CLI writes local spool for later \`recallant sync-spool\`.
`;

function parseEnvValue(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadDefaultEnv() {
  const envFile = process.env.RECALLANT_ENV_FILE ?? "/opt/secure-configs/recallant.env";
  if (!process.env.RECALLANT_ENV_FILE && process.env.RECALLANT_DATABASE_URL) return;
  try {
    const content = await readFile(envFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [rawKey, ...rawValueParts] = trimmed.split("=");
      const key = rawKey?.trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = parseEnvValue(rawValueParts.join("="));
    }
  } catch {
    // Fresh checkouts may not have a server env file yet.
  }
}

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

function positionalArgs(argv: readonly string[]) {
  const flagsWithValues = new Set([
    "--project-dir",
    "--server-url",
    "--target",
    "--capture-profile",
    "--task-hint",
    "--manifest",
    "--remap",
    "--target",
    "--spool-dir",
    "--kind",
    "--role",
    "--text",
    "--event-kind",
    "--raw-artifact-json",
    "--dedup-key",
    "--not-accessed",
    "--older-than",
    "--limit",
    "--format",
    "--client-kind",
    "--client-version",
    "--session-label",
    "--session-id",
    "--status",
    "--focus",
    "--next-step",
    "--summary",
    "--title"
  ]);
  const args: string[] = [];
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    args.push(arg);
  }
  return args;
}

function spoolDir(argv: readonly string[]) {
  return resolve(
    parseFlag(argv, "--spool-dir") ??
      process.env.RECALLANT_SPOOL_DIR ??
      join(process.cwd(), ".recallant", "spool")
  );
}

function spoolPath(argv: readonly string[]) {
  return join(spoolDir(argv), "spool.jsonl");
}

function spoolManifestPath(argv: readonly string[]) {
  return join(spoolDir(argv), "sync-manifest.json");
}

async function readJsonl(path: string) {
  const content = await readOptional(path);
  if (!content?.trim()) return [];
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readSpoolManifest(argv: readonly string[]) {
  const content = await readOptional(spoolManifestPath(argv));
  if (!content) return { synced: {} as Record<string, unknown> };
  const parsed = JSON.parse(content) as { synced?: Record<string, unknown> };
  return { synced: parsed.synced ?? {} };
}

async function getLocalSpoolStatus(argv: readonly string[]) {
  const records = await readJsonl(spoolPath(argv));
  const manifest = await readSpoolManifest(argv);
  const unsynced = records.filter((record) => !manifest.synced[String(record.local_id)]);
  return {
    status: unsynced.length > 0 ? "unsynced" : records.length > 0 ? "synced" : "empty",
    spool_path: spoolPath(argv),
    manifest_path: spoolManifestPath(argv),
    record_count: records.length,
    unsynced_count: unsynced.length,
    checked_at: new Date().toISOString()
  };
}

type AgentSessionState = {
  schema_version: 1;
  status: "active" | "closed" | "offline";
  session_id: string;
  project_id?: string | null;
  project_dir: string;
  client_kind: string;
  client_version?: string | null;
  task_hint?: string | null;
  started_at: string;
  updated_at: string;
  context_pack_id?: string | null;
  last_context_read_at?: string | null;
  last_memory_write_at?: string | null;
  last_checkpoint_at?: string | null;
  last_event_id?: string | null;
  last_memory_id?: string | null;
};

function projectDir(argv: readonly string[]) {
  return resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
}

function recallantDir(projectDir: string) {
  return join(projectDir, ".recallant");
}

function currentSessionPathFor(projectDir: string) {
  return join(recallantDir(projectDir), "current-session.json");
}

async function readAgentSessionState(projectDir: string): Promise<AgentSessionState | null> {
  const content = await readOptional(currentSessionPathFor(projectDir));
  if (!content) return null;
  return JSON.parse(content) as AgentSessionState;
}

async function writeAgentSessionState(projectDir: string, state: AgentSessionState) {
  await mkdir(recallantDir(projectDir), { recursive: true });
  await writeFile(currentSessionPathFor(projectDir), `${JSON.stringify(state, null, 2)}\n`);
}

function summarizeText(text: string, max = 88) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function dedupHash(prefix: string, payload: Record<string, unknown>) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function eventKindForAgentKind(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "test" || normalized === "verification") return "tool_result";
  if (normalized === "file_change") return "file_change";
  if (normalized === "checkpoint") return "checkpoint";
  if (normalized === "context_read" || normalized === "closeout") return "system";
  return "other";
}

function checkpointPayloadFromFlags(argv: readonly string[], fallbackSummary?: string): JsonObject {
  return {
    schema_version: 1,
    status: parseFlag(argv, "--status") ?? "in_progress",
    current_focus: parseFlag(argv, "--focus") ?? fallbackSummary ?? "Recallant-backed agent work",
    next_step: parseFlag(argv, "--next-step") ?? "Continue from Recallant context.",
    summary: parseFlag(argv, "--summary") ?? fallbackSummary ?? null,
    updated_at: new Date().toISOString(),
    source: "recallant-cli-agent-capture"
  };
}

function renderProjectLogSession(payload: JsonObject) {
  return `## Current Session

Status: ${String(payload.status ?? "in_progress")}.
Current focus: ${String(payload.current_focus ?? "Recallant-backed agent work")}.
Next step: ${String(payload.next_step ?? "Continue from Recallant context.")}.
Last updated: ${String(payload.updated_at ?? new Date().toISOString())}.
`;
}

async function updateProjectLogCheckpoint(projectDir: string, payload: JsonObject) {
  const projectLogPath = join(projectDir, "PROJECT_LOG.md");
  const existing = await readOptional(projectLogPath);
  const rendered = renderProjectLogSession(payload);
  if (!existing) {
    await writeFile(
      projectLogPath,
      `# Project Log

${rendered}
## Notes

- Recallant is the main source of truth for durable memory.
- This file is a compact fallback/checkpoint.
`
    );
    return { status: "created", path: projectLogPath };
  }
  const pattern = /## Current Session[\s\S]*?(?=\n## |\n# |$)/;
  const next = pattern.test(existing)
    ? existing.replace(pattern, rendered.trimEnd())
    : `${existing.trimEnd()}\n\n${rendered}`;
  await writeFile(projectLogPath, next.endsWith("\n") ? next : `${next}\n`);
  return { status: "updated", path: projectLogPath };
}

async function appendSpoolRecord(
  argv: readonly string[],
  recordKind: string,
  payload: Record<string, unknown>,
  dedupKey?: string
) {
  const finalDedupKey = dedupKey ?? dedupHash("spool", payload);
  const record = {
    local_id: randomUUID(),
    created_at: new Date().toISOString(),
    record_kind: recordKind,
    dedup_key: finalDedupKey,
    payload: { ...payload, dedup_key: finalDedupKey }
  };
  await mkdir(spoolDir(argv), { recursive: true });
  await appendFile(spoolPath(argv), `${JSON.stringify(record)}\n`);
  return record;
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

function audiencePreviewToJson(audience: string) {
  if (audience.startsWith("specific_client:")) {
    return [{ kind: "specific_client", id: audience.split(":")[1] ?? null }];
  }
  if (audience === "import_pipeline") {
    return [
      { kind: "import_pipeline", id: null },
      { kind: "review_ui", id: null }
    ];
  }
  return [{ kind: "all_agents", id: null }];
}

function contentTypeForPath(path: string) {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.includes(".env") || path.endsWith(".example")) return "text/plain";
  return "text/plain";
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
    try {
      await database.registerProject({
        projectId,
        developerId,
        projectPath: options.projectDir,
        captureProfile: options.captureProfile
      });
    } finally {
      await database.close();
    }
  }

  process.stdout.write(
    `${JSON.stringify({ ...plan, dry_run: false, status: "created" }, null, 2)}\n`
  );
}

async function runDiscover(argv: readonly string[]) {
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const result = discoveryResult(projectDir, await detectImportCandidates(projectDir));
  const format = parseFlag(argv, "--format") ?? (argv.includes("--text") ? "text" : "json");
  process.stdout.write(
    format === "text" ? formatDiscoveryText(result) : `${JSON.stringify(result, null, 2)}\n`
  );
}

async function runImport(argv: readonly string[]) {
  const target = positionalArgs(argv)[0];
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const candidate = target ? await discoveryCandidateForImport(projectDir, target) : null;
  const dryRun = argv.includes("--dry-run");
  let writeResult = null;
  if (!dryRun) {
    if (!target || !candidate) {
      throw new Error("recallant import requires an existing source path");
    }
    const database = createRecallantDbFromEnv();
    if (!database) throw new Error("RECALLANT_DATABASE_URL is required for confirmed import");
    try {
      writeResult = await database.importSource({
        project_path: projectDir,
        client_kind: "recallant-cli",
        source_path: candidate.path,
        source_type: candidate.source_type,
        source_sha256: candidate.source_ref.sha256,
        source_size_bytes: candidate.source_ref.size_bytes,
        content_type: contentTypeForPath(candidate.path),
        import_text: await readImportTextForCandidate(projectDir, candidate),
        bounded_excerpt: candidate.bounded_excerpt,
        result_class: candidate.result_class,
        result_classes: candidate.result_classes,
        scope_kind: candidate.scope.scope_kind,
        scope_id: candidate.scope.scope_id,
        audience: audiencePreviewToJson(candidate.provisional_audience),
        risk: candidate.risk,
        risks: candidate.risks,
        secret_references: candidate.secret_references,
        metadata: {
          import_command: "recallant import",
          import_preview_version: 1,
          promotes_instruction_grade: false
        }
      });
    } finally {
      await database.close();
    }
  }
  const result = {
    action: "import",
    dry_run: dryRun,
    target,
    writes_memory: !dryRun,
    result_class: candidate?.result_class ?? "import_source",
    result_classes: candidate?.result_classes ?? ["import_source"],
    provisional_scope: candidate?.provisional_scope ?? "project",
    scope: candidate?.scope ?? { scope_kind: "project", scope_id: null },
    provisional_audience: candidate?.provisional_audience ?? "all_agents",
    source_ref: candidate?.source_ref ?? null,
    source_refs: candidate?.source_ref ? [candidate.source_ref] : [],
    risks: candidate?.risks ?? [],
    risk: candidate?.risk ?? "low",
    bounded_excerpt: candidate?.bounded_excerpt ?? null,
    secret_references: candidate?.secret_references ?? [],
    planned_changes: dryRun
      ? [
          {
            action: "none",
            writes_database: false,
            writes_memory: false,
            promotes_instruction_grade: false,
            reason: "Dry run only."
          }
        ]
      : [
          {
            action: "confirmed_import",
            writes_database: true,
            writes_memory: true,
            promotes_instruction_grade: false,
            reason:
              "Creates import_batch event, raw artifact pointer, chunks, and reviewable import candidate memory."
          }
        ],
    write_result: writeResult,
    warning: dryRun
      ? "Preview only. No import_batch events, active memories, or instruction-grade records were created."
      : "Confirmed import wrote reviewable source-linked records without instruction-grade promotion."
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
  let sessionId: string | null = null;
  try {
    const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
    const started = await database.startSession({
      client_kind: "codex",
      project_path: projectDir,
      session_label: "context-preview",
      resume_policy: "normal"
    });
    sessionId = started.session_id ? String(started.session_id) : null;
    if (!sessionId) throw new Error("context preview did not start a session");
    const pack = await database.getContextPack({
      session_id: sessionId,
      task_hint: parseFlag(argv, "--task-hint") ?? "context preview",
      include_raw_evidence: "auto",
      include_recovery: true,
      local_spool_status: await getLocalSpoolStatus(argv)
    });
    process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
  } finally {
    if (sessionId) await database.closeSession(sessionId, "client_exit");
    await database.close();
  }
}

async function checkOllama() {
  const url = process.env.RECALLANT_OLLAMA_URL ?? "http://localhost:11434";
  const expectedModels = (
    process.env.RECALLANT_EXPECTED_OLLAMA_MODELS ?? "nomic-embed-text,gpt-oss:20b"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(new URL("/api/tags", url), { signal: controller.signal });
    if (!response.ok) {
      return {
        provider: "ollama",
        url,
        reachable: false,
        starts_service: false,
        expected_models: expectedModels,
        missing_models: expectedModels,
        fallback_route: "active_agent_or_defer",
        error: `HTTP ${response.status}`
      };
    }
    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    const available = new Set<string>();
    for (const model of payload.models ?? []) {
      if (!model.name) continue;
      available.add(model.name);
      if (model.name.endsWith(":latest")) available.add(model.name.slice(0, -":latest".length));
      else available.add(`${model.name}:latest`);
    }
    return {
      provider: "ollama",
      url,
      reachable: true,
      starts_service: false,
      expected_models: expectedModels,
      missing_models: expectedModels.filter((model) => !available.has(model)),
      fallback_route: "active_agent_or_defer"
    };
  } catch (error) {
    return {
      provider: "ollama",
      url,
      reachable: false,
      starts_service: false,
      expected_models: expectedModels,
      missing_models: expectedModels,
      fallback_route: "active_agent_or_defer",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDoctor(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  let postgres = { configured: Boolean(process.env.RECALLANT_DATABASE_URL), reachable: false };
  if (database) {
    try {
      await database.ensureProject(process.env.RECALLANT_PROJECT_PATH ?? projectDir);
      postgres = { configured: true, reachable: true };
    } catch {
      postgres = { configured: true, reachable: false };
    } finally {
      await database.close();
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ...describeCliBoundary(),
        postgres,
        project_config: {
          path: join(projectDir, ".recallant", "config"),
          present: (await readOptional(join(projectDir, ".recallant", "config"))) !== null
        },
        local_model: await checkOllama(),
        model_routes: {
          local_model: { enabled: true, provider: "ollama", route_class: "local" },
          active_agent: { enabled: true, route_class: "active_agent" },
          subscription_worker: { enabled: false, route_class: "subscription_worker" },
          paid_api_provider: {
            enabled: false,
            route_class: "paid_api_provider",
            default_provider: "openai",
            requires_approval: true
          },
          escalation_order: [
            "local_model",
            "active_agent",
            "subscription_worker",
            "paid_api_provider"
          ]
        },
        paid_api_mode: "confirm_each",
        policy: {
          paid_api_requires_approval: true,
          browser_automation_allowed: false,
          hidden_api_routes_allowed: false,
          starts_local_services: false
        },
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

async function snapshotTables(client: pg.Client) {
  const tableNames = [
    "developers",
    "projects",
    "sessions",
    "events",
    "raw_artifacts",
    "chunks",
    "embeddings",
    "edges",
    "checkpoints",
    "agent_memories",
    "agent_memory_source_refs",
    "agent_memory_review_actions",
    "recall_traces",
    "ingest_dedup_keys",
    "erasure_requests",
    "paid_api_approval_requests",
    "model_calls",
    "system_settings",
    "developer_settings",
    "project_settings",
    "session_overrides",
    "client_adapter_settings",
    "settings_audit_events"
  ];
  const tables: Record<string, unknown[]> = {};
  for (const table of tableNames) {
    const result = await client.query(`SELECT * FROM ${table}`);
    tables[table] = result.rows;
  }
  return tables;
}

function rowsOf(tables: Record<string, unknown[]>, table: string) {
  return (tables[table] ?? []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
  );
}

async function runBackup(argv: readonly string[]) {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for backup");
  const targetDir = resolve(parseFlag(argv, "--target") ?? join(process.cwd(), "backups"));
  const backupId = `recallant-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
  const backupDir = join(targetDir, backupId);
  await mkdir(backupDir, { recursive: true });
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await snapshotTables(client);
    const tablesJson = `${JSON.stringify(tables, null, 2)}\n`;
    const tablesHash = createHash("sha256").update(tablesJson).digest("hex");
    await writeFile(join(backupDir, "tables.json"), tablesJson);
    const manifest = {
      backup_id: backupId,
      created_at: new Date().toISOString(),
      recallant_version: "0.0.0",
      schema_version: "0001_initial",
      included_dbs: ["recallant_agent_work"],
      raw_artifact_roots: [],
      files: [{ path: "tables.json", sha256: tablesHash, size_bytes: tablesJson.length }],
      target: { kind: "local_directory", path: backupDir, future_ssh_tailscale_supported: true },
      encryption: { status: "not_enabled_local_dev" },
      restore_verification: { status: "not_run" },
      secret_policy: "manifest excludes provider keys and raw secrets"
    };
    await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: true, manifest_path: join(backupDir, "manifest.json"), ...manifest }, null, 2)}\n`
    );
  } finally {
    await client.end();
  }
}

async function runBackupVerify(argv: readonly string[]) {
  const manifestPath = parseFlag(argv, "--manifest");
  if (!manifestPath) throw new Error("--manifest is required");
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for backup verification");
  const resolvedManifest = await realpath(resolve(manifestPath));
  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
    schema_version: string;
  };
  const tablesJson = await readFile(join(resolvedManifest, "..", "tables.json"), "utf8");
  const actualHash = createHash("sha256").update(tablesJson).digest("hex");
  const expectedHash = manifest.files.find((file) => file.path === "tables.json")?.sha256;
  if (actualHash !== expectedHash) throw new Error("Backup hash verification failed");
  const tables = JSON.parse(tablesJson) as Record<string, unknown[]>;
  const checkpoints = rowsOf(tables, "checkpoints");
  const chunks = rowsOf(tables, "chunks");
  const agentMemories = rowsOf(tables, "agent_memories");
  const rawArtifacts = rowsOf(tables, "raw_artifacts");
  const searchQuery = parseFlag(argv, "--query")?.toLowerCase();
  const boundedSearchMatches = searchQuery
    ? chunks.filter((chunk) =>
        String(chunk.text ?? "")
          .toLowerCase()
          .includes(searchQuery)
      ).length
    : chunks.length;
  const rawArtifactPointerIssues = rawArtifacts.filter(
    (artifact) =>
      artifact.storage_backend !== "postgres_inline" && !artifact.uri && !artifact.sha256
  ).length;
  if (rawArtifactPointerIssues > 0) {
    throw new Error("Backup raw artifact pointer verification failed");
  }
  if (searchQuery && boundedSearchMatches === 0) {
    throw new Error("Backup bounded search verification failed");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `verify_${randomUUID().replaceAll("-", "_")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}.backup_snapshot (payload jsonb)`);
    await client.query(`INSERT INTO ${schema}.backup_snapshot (payload) VALUES ($1)`, [
      JSON.stringify(tables)
    ]);
    const checks = await client.query(
      `
        SELECT
          jsonb_array_length(payload->'projects') AS project_count,
          jsonb_array_length(payload->'checkpoints') AS checkpoint_count,
          jsonb_array_length(payload->'chunks') AS chunk_count,
          jsonb_array_length(payload->'agent_memories') AS governed_memory_count,
          jsonb_array_length(payload->'raw_artifacts') AS raw_artifact_count
        FROM ${schema}.backup_snapshot
        LIMIT 1
      `
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          restore_verification: "passed",
          temporary_schema: schema,
          project_count: checks.rows[0]?.project_count ?? 0,
          latest_checkpoint_present: checkpoints.length > 0,
          governed_memory_count: checks.rows[0]?.governed_memory_count ?? agentMemories.length,
          chunk_count: checks.rows[0]?.chunk_count ?? chunks.length,
          raw_artifact_count: checks.rows[0]?.raw_artifact_count ?? rawArtifacts.length,
          raw_artifact_pointer_issues: rawArtifactPointerIssues,
          bounded_search_checked: true,
          bounded_search_query: searchQuery ?? null,
          bounded_search_matches: boundedSearchMatches,
          schema_version: manifest.schema_version,
          production_overwritten: false
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

async function runRestorePlan(argv: readonly string[]) {
  const manifestPath = parseFlag(argv, "--manifest");
  if (!manifestPath) throw new Error("--manifest is required");
  const remapPath = parseFlag(argv, "--remap");
  const resolvedManifest = await realpath(resolve(manifestPath));
  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
    schema_version: string;
  };
  const tablesJson = await readFile(join(resolvedManifest, "..", "tables.json"), "utf8");
  const actualHash = createHash("sha256").update(tablesJson).digest("hex");
  const expectedHash = manifest.files.find((file) => file.path === "tables.json")?.sha256;
  if (actualHash !== expectedHash) throw new Error("Backup hash verification failed");
  const tables = JSON.parse(tablesJson) as Record<string, unknown[]>;
  const remap = remapPath
    ? (JSON.parse(await readFile(resolve(remapPath), "utf8")) as Record<string, unknown>)
    : {};
  const projectRoots =
    remap.project_roots && typeof remap.project_roots === "object"
      ? (remap.project_roots as Record<string, string>)
      : {};
  const rawArtifactRoots =
    remap.raw_artifact_roots && typeof remap.raw_artifact_roots === "object"
      ? (remap.raw_artifact_roots as Record<string, string>)
      : {};
  const projects = rowsOf(tables, "projects").map((project) => {
    const oldPrimaryPath = String(project.primary_path ?? "");
    return {
      project_id: project.id,
      name: project.name,
      old_primary_path: oldPrimaryPath,
      new_primary_path: projectRoots[oldPrimaryPath] ?? oldPrimaryPath,
      needs_mapping: oldPrimaryPath.length > 0 && projectRoots[oldPrimaryPath] === undefined
    };
  });
  const rawArtifacts = rowsOf(tables, "raw_artifacts");
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "restore_plan",
        writes_database: false,
        production_overwritten: false,
        schema_version: manifest.schema_version,
        projects,
        raw_artifacts: {
          count: rawArtifacts.length,
          remapped_roots: rawArtifactRoots
        },
        secret_references: remap.secret_refs ?? {},
        connector_accounts: remap.connector_accounts ?? {},
        environment_facts: remap.environment_facts ?? {},
        port_assignments: remap.ports ?? {},
        warnings: projects.some((project) => project.needs_mapping)
          ? ["Some project roots have no remap entry."]
          : []
      },
      null,
      2
    )}\n`
  );
}

function parseDaysFlag(argv: readonly string[], name: string, fallback: number) {
  const raw = parseFlag(argv, name);
  if (!raw) return fallback;
  const normalized = raw.endsWith("d") ? raw.slice(0, -1) : raw;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function queryCleanupCandidates(argv: readonly string[]) {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for cleanup analysis");
  const notAccessedDays = parseDaysFlag(argv, "--not-accessed", 90);
  const olderThanDays = parseDaysFlag(argv, "--older-than", 180);
  const limit = Number.parseInt(parseFlag(argv, "--limit") ?? "50", 10);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const stale = await client.query(
      `
        SELECT id AS chunk_id, project_id, source_event_id, left(text, 180) AS excerpt,
               created_at, last_accessed_at, access_count
        FROM chunks
        WHERE archived_at IS NULL
          AND (
            created_at < now() - ($1::int * interval '1 day')
            OR (last_accessed_at IS NULL AND created_at < now() - ($2::int * interval '1 day'))
            OR last_accessed_at < now() - ($2::int * interval '1 day')
          )
        ORDER BY created_at ASC
        LIMIT $3::int
      `,
      [olderThanDays, notAccessedDays, Number.isFinite(limit) ? limit : 50]
    );
    const duplicates = await client.query(
      `
        WITH duplicate_text AS (
          SELECT text
          FROM chunks
          WHERE archived_at IS NULL
          GROUP BY text
          HAVING count(*) > 1
          LIMIT $1::int
        )
        SELECT c.id AS chunk_id, c.project_id, c.source_event_id, left(c.text, 180) AS excerpt,
               c.created_at, c.last_accessed_at, c.access_count
        FROM chunks c
        JOIN duplicate_text d ON d.text = c.text
        WHERE c.archived_at IS NULL
        ORDER BY c.text, c.created_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const superseded = await client.query(
      `
        SELECT c.id AS chunk_id, c.project_id, c.source_event_id, left(c.text, 180) AS excerpt,
               e.src_id AS superseded_by, c.created_at, c.last_accessed_at, c.access_count
        FROM edges e
        JOIN chunks c ON c.id::text = e.dst_id
        WHERE e.relation_type = 'supersedes'
          AND e.dst_kind = 'chunk'
          AND c.archived_at IS NULL
        ORDER BY e.created_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const lowValue = await client.query(
      `
        SELECT id AS chunk_id, project_id, source_event_id, left(text, 180) AS excerpt,
               created_at, last_accessed_at, access_count, token_count_est
        FROM chunks
        WHERE archived_at IS NULL
          AND access_count = 0
          AND token_count_est <= 4
        ORDER BY created_at ASC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const staleMemories = await client.query(
      `
        SELECT id AS memory_id, project_id, scope, memory_type, title, status, use_policy,
               updated_at, superseded_by
        FROM agent_memories
        WHERE status IN ('stale', 'superseded')
        ORDER BY updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const duplicateMemories = await client.query(
      `
        WITH duplicate_memory AS (
          SELECT lower(title) AS normalized_title
          FROM agent_memories
          WHERE status NOT IN ('rejected', 'archived', 'superseded')
          GROUP BY lower(title)
          HAVING count(*) > 1
          LIMIT $1::int
        )
        SELECT m.id AS memory_id, m.project_id, m.scope, m.memory_type, m.title,
               m.status, m.use_policy, m.updated_at
        FROM agent_memories m
        JOIN duplicate_memory d ON d.normalized_title = lower(m.title)
        WHERE m.status NOT IN ('rejected', 'archived', 'superseded')
        ORDER BY lower(m.title), m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const poorProvenanceMemories = await client.query(
      `
        SELECT m.id AS memory_id, m.project_id, m.scope, m.scope_kind, m.scope_id,
               m.memory_type, m.title, m.status, m.use_policy, m.created_by, m.updated_at
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE m.status NOT IN ('rejected', 'archived', 'superseded')
        GROUP BY m.id
        HAVING count(r.memory_id) = 0
        ORDER BY m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const conflictingConnectorMemories = await client.query(
      `
        WITH connector_groups AS (
          SELECT scope_kind, scope_id, lower(title) AS normalized_title
          FROM agent_memories
          WHERE status IN ('accepted', 'needs_review', 'candidate')
            AND scope_kind = 'connector_account'
            AND scope_id IS NOT NULL
          GROUP BY scope_kind, scope_id, lower(title)
          HAVING count(DISTINCT body) > 1
          LIMIT $1::int
        )
        SELECT m.id AS memory_id, m.project_id, m.scope, m.scope_kind, m.scope_id,
               m.memory_type, m.title, m.status, m.use_policy, m.updated_at
        FROM agent_memories m
        JOIN connector_groups g
          ON g.scope_kind = m.scope_kind
         AND g.scope_id = m.scope_id
         AND g.normalized_title = lower(m.title)
        WHERE m.status IN ('accepted', 'needs_review', 'candidate')
        ORDER BY m.scope_id, lower(m.title), m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    return {
      policy: {
        not_accessed_days: notAccessedDays,
        older_than_days: olderThanDays,
        limit: Number.isFinite(limit) ? limit : 50
      },
      stale_chunks: stale.rows,
      duplicate_chunks: duplicates.rows,
      superseded_chunks: superseded.rows,
      low_value_chunks: lowValue.rows,
      stale_or_superseded_memories: staleMemories.rows,
      duplicate_memories: duplicateMemories.rows,
      poor_provenance_memories: poorProvenanceMemories.rows,
      conflicting_connector_memories: conflictingConnectorMemories.rows
    };
  } finally {
    await client.end();
  }
}

async function runAnalyze(argv: readonly string[]) {
  const report = await queryCleanupCandidates(argv);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "analyze",
        dry_run: argv.includes("--dry-run"),
        writes_database: false,
        report,
        summary: {
          stale_chunks: report.stale_chunks.length,
          duplicate_chunks: report.duplicate_chunks.length,
          superseded_chunks: report.superseded_chunks.length,
          low_value_chunks: report.low_value_chunks.length,
          stale_or_superseded_memories: report.stale_or_superseded_memories.length,
          duplicate_memories: report.duplicate_memories.length,
          poor_provenance_memories: report.poor_provenance_memories.length,
          conflicting_connector_memories: report.conflicting_connector_memories.length
        }
      },
      null,
      2
    )}\n`
  );
}

async function runCleanup(argv: readonly string[]) {
  if (argv.includes("--delete-archived")) {
    throw new Error(
      "POLICY_BLOCKED: cleanup hard delete must route through confirmed erasure policy"
    );
  }
  const dryRun = argv.includes("--dry-run");
  const archiveRequested = argv.includes("--archive");
  const confirmed = argv.includes("--confirm");
  if (!dryRun && (!archiveRequested || !confirmed)) {
    throw new Error("POLICY_BLOCKED: cleanup writes require --archive --confirm");
  }
  const report = await queryCleanupCandidates(argv);
  const candidates = [
    ...report.stale_chunks.map((candidate) => ({ ...candidate, reason: "stale_or_not_accessed" })),
    ...report.duplicate_chunks.map((candidate) => ({ ...candidate, reason: "duplicate_text" })),
    ...report.superseded_chunks.map((candidate) => ({ ...candidate, reason: "superseded" }))
  ];
  const uniqueChunkIds = Array.from(new Set(candidates.map((candidate) => candidate.chunk_id)));
  if (!dryRun && uniqueChunkIds.length > 0) {
    const databaseUrl = process.env.RECALLANT_DATABASE_URL;
    if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for cleanup");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `
          UPDATE chunks
          SET archived_at = coalesce(archived_at, now())
          WHERE id = ANY($1::uuid[])
        `,
        [uniqueChunkIds]
      );
    } finally {
      await client.end();
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "cleanup",
        dry_run: dryRun,
        writes_database: !dryRun,
        archive_requested: archiveRequested,
        archived_chunk_ids: dryRun ? [] : uniqueChunkIds,
        candidates,
        warnings: dryRun
          ? [
              "Dry run only. No chunks, embeddings, L0 events, raw artifacts, or governed memories were changed."
            ]
          : [
              "Only derived chunks were archived. L0 events, raw artifacts, embeddings, and governed memories were not deleted."
            ]
      },
      null,
      2
    )}\n`
  );
}

async function startAgentSession(
  database: NonNullable<ReturnType<typeof createRecallantDbFromEnv>>,
  argv: readonly string[]
) {
  const dir = projectDir(argv);
  const clientKind = parseFlag(argv, "--client-kind") ?? "codex";
  const clientVersion = parseFlag(argv, "--client-version") ?? null;
  const taskHint = parseFlag(argv, "--task-hint") ?? "Recallant-backed agent work";
  const started = await database.startSession({
    client_kind: clientKind,
    client_version: clientVersion,
    project_path: dir,
    session_label: parseFlag(argv, "--session-label") ?? "recallant-agent-session",
    resume_policy: "normal"
  });
  const sessionId = String(started.session_id);
  const pack = await database.getContextPack({
    session_id: sessionId,
    task_hint: taskHint,
    include_raw_evidence: "auto",
    include_recovery: true,
    local_spool_status: await getLocalSpoolStatus(argv)
  });
  const contextRead = await database.appendEvent({
    session_id: sessionId,
    client_kind: clientKind,
    event_kind: "system",
    text: `Context pack read for task: ${taskHint}`,
    metadata: {
      capture_kind: "context_read",
      context_pack_id: pack.context_pack_id,
      task_hint: taskHint
    },
    dedup_key: dedupHash("agent-context-read", {
      session_id: sessionId,
      context_pack_id: pack.context_pack_id
    })
  });
  const now = new Date().toISOString();
  const state: AgentSessionState = {
    schema_version: 1,
    status: "active",
    session_id: sessionId,
    project_id: String(started.project_id),
    project_dir: dir,
    client_kind: clientKind,
    client_version: clientVersion,
    task_hint: taskHint,
    started_at: now,
    updated_at: now,
    context_pack_id: String(pack.context_pack_id),
    last_context_read_at: now,
    last_memory_write_at: now,
    last_event_id: String(contextRead.event_id)
  };
  await writeAgentSessionState(dir, state);
  return { state, pack, context_read: contextRead, start_result: started };
}

async function ensureOfflineAgentSession(argv: readonly string[], reason: string) {
  const dir = projectDir(argv);
  const existing = await readAgentSessionState(dir);
  if (existing?.status === "offline" || existing?.status === "active") return existing;
  const now = new Date().toISOString();
  const state: AgentSessionState = {
    schema_version: 1,
    status: "offline",
    session_id: `local-${randomUUID()}`,
    project_id: null,
    project_dir: dir,
    client_kind: parseFlag(argv, "--client-kind") ?? "codex",
    client_version: parseFlag(argv, "--client-version") ?? null,
    task_hint: parseFlag(argv, "--task-hint") ?? reason,
    started_at: now,
    updated_at: now
  };
  await writeAgentSessionState(dir, state);
  return state;
}

async function loadActiveAgentState(argv: readonly string[]) {
  const state = await readAgentSessionState(projectDir(argv));
  if (state?.status === "active") return state;
  return null;
}

async function runAgentStart(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) {
    const state = await ensureOfflineAgentSession(argv, "RECALLANT_DATABASE_URL is not configured");
    const record = await appendSpoolRecord(argv, "event", {
      client_kind: state.client_kind,
      event_kind: "system",
      text: "Offline Recallant agent session started; server database is not configured.",
      metadata: { capture_kind: "agent_start_offline", local_session_id: state.session_id },
      raw_artifacts: []
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "agent_start",
          mode: "offline_spool",
          state_path: currentSessionPathFor(state.project_dir),
          spool_path: spoolPath(argv),
          local_id: record.local_id,
          warning: "Server database is unavailable; capture records will sync later."
        },
        null,
        2
      )}\n`
    );
    return;
  }
  try {
    const result = await startAgentSession(database, argv);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "agent_start",
          mode: "server",
          project_id: result.state.project_id,
          session_id: result.state.session_id,
          context_pack_id: result.state.context_pack_id,
          state_path: currentSessionPathFor(result.state.project_dir),
          previous_unclosed_session: result.start_result.previous_unclosed_session,
          recommended_next_action:
            "Use recallant agent-event after meaningful decisions/actions/tests."
        },
        null,
        2
      )}\n`
    );
  } finally {
    await database.close();
  }
}

async function runAgentEvent(argv: readonly string[]) {
  const kind = parseFlag(argv, "--kind") ?? "action";
  const text = parseFlag(argv, "--text") ?? positionalArgs(argv).join(" ");
  if (!text.trim()) throw new Error("VALIDATION_ERROR: agent-event requires --text");
  const dir = projectDir(argv);
  const database = createRecallantDbFromEnv();
  let state = await loadActiveAgentState(argv);
  const title = parseFlag(argv, "--title") ?? summarizeText(text, 72);
  const clientKind = state?.client_kind ?? parseFlag(argv, "--client-kind") ?? "codex";
  const metadata = {
    capture_kind: `agent_${kind}`,
    project_dir: dir,
    title
  };
  const dedupKey =
    parseFlag(argv, "--dedup-key") ??
    dedupHash("agent-event", {
      session_id: state?.session_id ?? null,
      kind,
      text,
      created_at: new Date().toISOString()
    });

  if (database) {
    try {
      if (!state) {
        const started = await startAgentSession(database, argv);
        state = started.state;
      }
      const event = await database.appendEvent({
        session_id: state.session_id,
        client_kind: clientKind,
        event_kind: eventKindForAgentKind(kind),
        text,
        metadata,
        raw_artifacts: [],
        dedup_key: dedupKey
      });
      let memory = null;
      if (kind === "decision") {
        memory = await database.createAgentMemory({
          project_path: dir,
          memory_type: "decision",
          scope: "project",
          scope_kind: "project",
          title,
          body: text,
          confidence: 0.9,
          created_by: "agent",
          source_refs: [
            {
              source_kind: "event",
              source_id: String(event.event_id),
              quote: summarizeText(text, 500),
              metadata: { capture_kind: "agent_decision" }
            }
          ],
          metadata: { created_from: "recallant_agent_event" }
        });
      }
      const now = new Date().toISOString();
      state = {
        ...state,
        updated_at: now,
        last_memory_write_at: now,
        last_event_id: String(event.event_id),
        last_memory_id: memory ? String(memory.memory_id) : state.last_memory_id
      };
      await writeAgentSessionState(dir, state);
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "agent_event",
            mode: "server",
            kind,
            project_id: state.project_id,
            session_id: state.session_id,
            event_id: event.event_id,
            memory
          },
          null,
          2
        )}\n`
      );
      return;
    } catch (error) {
      state = await ensureOfflineAgentSession(
        argv,
        error instanceof Error ? error.message : "server unavailable"
      );
    } finally {
      await database.close();
    }
  } else {
    state = await ensureOfflineAgentSession(argv, "RECALLANT_DATABASE_URL is not configured");
  }

  const record = await appendSpoolRecord(argv, "event", {
    session_id: state.session_id,
    client_kind: clientKind,
    event_kind: eventKindForAgentKind(kind),
    text,
    metadata: { ...metadata, local_session_id: state.session_id },
    raw_artifacts: []
  });
  const now = new Date().toISOString();
  await writeAgentSessionState(dir, {
    ...state,
    status: "offline",
    updated_at: now,
    last_memory_write_at: now,
    last_event_id: String(record.local_id)
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "agent_event",
        mode: "offline_spool",
        kind,
        local_id: record.local_id,
        spool_path: spoolPath(argv),
        warning: "Server write failed or is unavailable; event was spooled locally."
      },
      null,
      2
    )}\n`
  );
}

async function runAgentCheckpoint(argv: readonly string[]) {
  const dir = projectDir(argv);
  const payload = checkpointPayloadFromFlags(argv);
  const projectLogUpdate = await updateProjectLogCheckpoint(dir, payload);
  const database = createRecallantDbFromEnv();
  let state = await loadActiveAgentState(argv);
  if (database) {
    try {
      if (!state) {
        const started = await startAgentSession(database, argv);
        state = started.state;
      }
      const checkpoint = await database.setCheckpoint(state.project_id, payload);
      const event = await database.appendEvent({
        session_id: state.session_id,
        client_kind: state.client_kind,
        event_kind: "checkpoint",
        text: `Checkpoint: ${String(payload.current_focus)} Next: ${String(payload.next_step)}`,
        metadata: { capture_kind: "agent_checkpoint", checkpoint_payload: payload },
        raw_artifacts: [],
        dedup_key: dedupHash("agent-checkpoint", {
          session_id: state.session_id,
          payload,
          created_at: new Date().toISOString()
        })
      });
      const now = new Date().toISOString();
      await writeAgentSessionState(dir, {
        ...state,
        updated_at: now,
        last_checkpoint_at: now,
        last_memory_write_at: now,
        last_event_id: String(event.event_id)
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "agent_checkpoint",
            mode: "server",
            project_id: state.project_id,
            session_id: state.session_id,
            checkpoint_updated_at: checkpoint.updated_at,
            event_id: event.event_id,
            project_log_update: projectLogUpdate
          },
          null,
          2
        )}\n`
      );
      return;
    } catch (error) {
      state = await ensureOfflineAgentSession(
        argv,
        error instanceof Error ? error.message : "server unavailable"
      );
    } finally {
      await database.close();
    }
  } else {
    state = await ensureOfflineAgentSession(argv, "RECALLANT_DATABASE_URL is not configured");
  }
  const record = await appendSpoolRecord(argv, "event", {
    session_id: state.session_id,
    client_kind: state.client_kind,
    event_kind: "checkpoint",
    text: `Checkpoint: ${String(payload.current_focus)} Next: ${String(payload.next_step)}`,
    metadata: { capture_kind: "agent_checkpoint", checkpoint_payload: payload },
    raw_artifacts: []
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "agent_checkpoint",
        mode: "offline_spool",
        local_id: record.local_id,
        spool_path: spoolPath(argv),
        project_log_update: projectLogUpdate
      },
      null,
      2
    )}\n`
  );
}

async function runAgentCloseout(argv: readonly string[]) {
  const dir = projectDir(argv);
  const state = await loadActiveAgentState(argv);
  if (!state) throw new Error("VALIDATION_ERROR: no active Recallant agent session");
  const payload = checkpointPayloadFromFlags(
    argv,
    parseFlag(argv, "--summary") ?? "Session closeout"
  );
  const projectLogUpdate = await updateProjectLogCheckpoint(dir, payload);
  const database = createRecallantDbFromEnv();
  if (!database) {
    const record = await appendSpoolRecord(argv, "event", {
      session_id: state.session_id,
      client_kind: state.client_kind,
      event_kind: "system",
      text: `Closeout: ${String(payload.summary ?? payload.current_focus)}`,
      metadata: { capture_kind: "agent_closeout", checkpoint_payload: payload },
      raw_artifacts: []
    });
    await writeAgentSessionState(dir, {
      ...state,
      status: "offline",
      updated_at: new Date().toISOString(),
      last_event_id: String(record.local_id)
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "agent_closeout",
          mode: "offline_spool",
          local_id: record.local_id,
          spool_path: spoolPath(argv),
          project_log_update: projectLogUpdate
        },
        null,
        2
      )}\n`
    );
    return;
  }
  try {
    const closeout = await database.closeout(
      state.session_id,
      payload,
      "closeout",
      await getLocalSpoolStatus(argv)
    );
    const now = new Date().toISOString();
    await writeAgentSessionState(dir, {
      ...state,
      status: "closed",
      updated_at: now,
      last_checkpoint_at: now
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "agent_closeout",
          mode: "server",
          project_id: state.project_id,
          session_id: state.session_id,
          closeout,
          project_log_update: projectLogUpdate
        },
        null,
        2
      )}\n`
    );
  } finally {
    await database.close();
  }
}

async function runSpoolAppend(argv: readonly string[]) {
  const recordKind = parseFlag(argv, "--kind") ?? "turn";
  const role = parseFlag(argv, "--role") ?? "user";
  const text = parseFlag(argv, "--text") ?? "";
  const eventKind = parseFlag(argv, "--event-kind") ?? "other";
  const rawArtifactJson = parseFlag(argv, "--raw-artifact-json");
  const rawArtifacts = rawArtifactJson ? JSON.parse(rawArtifactJson) : [];
  const payload: Record<string, unknown> =
    recordKind === "event"
      ? {
          client_kind: "codex",
          event_kind: eventKind,
          text,
          metadata: {},
          raw_artifacts: rawArtifacts
        }
      : { client_kind: "codex", role, text };
  const dedupKey =
    parseFlag(argv, "--dedup-key") ??
    `spool:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const record = await appendSpoolRecord(argv, recordKind, payload, dedupKey);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "spool_append",
        spool_path: spoolPath(argv),
        local_id: record.local_id,
        dedup_key: dedupKey,
        synced: false
      },
      null,
      2
    )}\n`
  );
}

async function runSyncSpool(argv: readonly string[]) {
  const records = await readJsonl(spoolPath(argv));
  const manifest = await readSpoolManifest(argv);
  const unsynced = records.filter((record) => !manifest.synced[String(record.local_id)]);
  if (argv.includes("--dry-run")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "sync_spool",
          dry_run: true,
          writes_database: false,
          unsynced_count: unsynced.length,
          records: unsynced.map((record) => ({
            local_id: record.local_id,
            record_kind: record.record_kind,
            dedup_key: record.dedup_key
          }))
        },
        null,
        2
      )}\n`
    );
    return;
  }
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for sync-spool");
  const synced = { ...manifest.synced };
  let syncSessionId: string | null = null;
  try {
    const syncSession =
      unsynced.length > 0
        ? await database.startSession({
            client_kind: "recallant-cli",
            project_path: projectDir(argv),
            session_label: "spool-sync",
            resume_policy: "normal"
          })
        : null;
    syncSessionId = syncSession?.session_id ? String(syncSession.session_id) : null;
    for (const record of unsynced) {
      const payload = record.payload as Record<string, unknown>;
      const result =
        record.record_kind === "event"
          ? await database.appendEvent({
              session_id: syncSessionId,
              client_kind: String(payload.client_kind ?? "codex"),
              event_kind: String(payload.event_kind ?? "other"),
              text: (payload.text as string | null | undefined) ?? null,
              metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
              raw_artifacts: (payload.raw_artifacts as RawArtifactInput[] | undefined) ?? [],
              dedup_key: String(payload.dedup_key ?? record.dedup_key)
            })
          : await database.appendTurn({
              session_id: syncSessionId,
              client_kind: String(payload.client_kind ?? "codex"),
              role: payload.role === "assistant" ? "assistant" : "user",
              text: String(payload.text ?? ""),
              dedup_key: String(payload.dedup_key ?? record.dedup_key)
            });
      synced[String(record.local_id)] = {
        server_event_id: result.event_id,
        status: result.status,
        synced_at: new Date().toISOString()
      };
    }
  } finally {
    if (syncSessionId) await database.closeSession(syncSessionId, "client_exit");
    await database.close();
  }
  await mkdir(spoolDir(argv), { recursive: true });
  await writeFile(spoolManifestPath(argv), `${JSON.stringify({ synced }, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "sync_spool",
        dry_run: false,
        synced_count: unsynced.length,
        manifest_path: spoolManifestPath(argv),
        mappings: synced
      },
      null,
      2
    )}\n`
  );
}

async function runPruneSpool(argv: readonly string[]) {
  if (!argv.includes("--synced")) {
    throw new Error("POLICY_BLOCKED: prune-spool requires --synced");
  }
  const records = await readJsonl(spoolPath(argv));
  const manifest = await readSpoolManifest(argv);
  const kept = records.filter((record) => !manifest.synced[String(record.local_id)]);
  await mkdir(spoolDir(argv), { recursive: true });
  await writeFile(
    spoolPath(argv),
    kept.map((record) => JSON.stringify(record)).join("\n") + (kept.length ? "\n" : "")
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "prune_spool",
        pruned_count: records.length - kept.length,
        kept_unsynced_count: kept.length,
        spool_path: spoolPath(argv)
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
  if (command === "doctor") return runDoctor(argv);
  if (command === "attach") return runAttach(argv);
  if (command === "detach" || command === "project-detach") return runDetach(argv);
  if (command === "init") return runInit(argv);
  if (command === "discover") return runDiscover(argv);
  if (command === "import") return runImport(argv);
  if (command === "lint-context") return runLintContext(argv);
  if (command === "context") return runContext(argv);
  if (command === "backup") return runBackup(argv);
  if (command === "backup-verify") return runBackupVerify(argv);
  if (command === "restore-plan") return runRestorePlan(argv);
  if (command === "analyze") return runAnalyze(argv);
  if (command === "cleanup") return runCleanup(argv);
  if (command === "agent-start") return runAgentStart(argv);
  if (command === "agent-event") return runAgentEvent(argv);
  if (command === "agent-checkpoint") return runAgentCheckpoint(argv);
  if (command === "agent-closeout") return runAgentCloseout(argv);
  if (command === "spool-append") return runSpoolAppend(argv);
  if (command === "sync-spool") return runSyncSpool(argv);
  if (command === "prune-spool") return runPruneSpool(argv);

  process.stderr.write(
    "Usage: recallant <mcp-server|doctor|attach|detach|init|discover|import|lint-context|context|backup|backup-verify|restore-plan|analyze|cleanup|agent-start|agent-event|agent-checkpoint|agent-closeout|spool-append|sync-spool|prune-spool>\n"
  );
  process.exitCode = 1;
}

await loadDefaultEnv();
await main(process.argv);
