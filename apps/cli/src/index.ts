#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { createRecallantDbFromEnv } from "@recallant/db";
import type { JsonObject, ProjectSourceKind, RawArtifactInput } from "@recallant/db";
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
import { clientTargetConfig } from "./client-targets.js";
import { runDetach } from "./detach.js";
import { runLocalCleanup } from "./local-cleanup.js";

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
    "--title",
    "--context-profile",
    "--override-reason",
    "--reason",
    "--name",
    "--project-kind",
    "--memory-domain",
    "--primary-path",
    "--project-id",
    "--source-kind",
    "--source-id",
    "--label",
    "--uri"
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

const closeoutTriggers = [
  { phrase: "exit", intent: "manual_exit", language: "en", confidence: 0.98 },
  { phrase: "quit", intent: "manual_exit", language: "en", confidence: 0.95 },
  { phrase: "close out", intent: "task_complete", language: "en", confidence: 0.94 },
  { phrase: "closeout", intent: "task_complete", language: "en", confidence: 0.94 },
  { phrase: "wrap up", intent: "task_complete", language: "en", confidence: 0.9 },
  { phrase: "end session", intent: "manual_exit", language: "en", confidence: 0.93 },
  { phrase: "finish session", intent: "task_complete", language: "en", confidence: 0.9 },
  { phrase: "pause here", intent: "pause", language: "en", confidence: 0.9 },
  { phrase: "save and stop", intent: "pause", language: "en", confidence: 0.92 },
  { phrase: "закрой сессию", intent: "manual_exit", language: "ru", confidence: 0.97 },
  { phrase: "закрыть сессию", intent: "manual_exit", language: "ru", confidence: 0.95 },
  { phrase: "заверши сессию", intent: "task_complete", language: "ru", confidence: 0.95 },
  { phrase: "завершить сессию", intent: "task_complete", language: "ru", confidence: 0.95 },
  { phrase: "закрой работу", intent: "task_complete", language: "ru", confidence: 0.9 },
  { phrase: "заканчиваем", intent: "task_complete", language: "ru", confidence: 0.9 },
  { phrase: "пауза", intent: "pause", language: "ru", confidence: 0.86 },
  { phrase: "сохрани и закончи", intent: "pause", language: "ru", confidence: 0.92 }
] as const;

const ambiguousCloseoutPhrases = [
  "later",
  "tomorrow",
  "next time",
  "continue later",
  "вернемся",
  "потом",
  "позже",
  "завтра",
  "в следующий раз"
];

const riskyCloseoutActionPhrases = [
  "delete",
  "erase",
  "forget forever",
  "deploy",
  "restart",
  "firewall",
  "public",
  "paid api",
  "secret",
  "удал",
  "навсегда",
  "деплой",
  "перезапу",
  "публич",
  "секрет",
  "платн"
];

function normalizeIntentMessage(message: string) {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function classifyCloseoutIntent(message: string, hasActiveSession: boolean) {
  const normalized = normalizeIntentMessage(message);
  const language = /[а-яё]/iu.test(message) ? "ru" : "en";
  const risky = riskyCloseoutActionPhrases.some((phrase) => normalized.includes(phrase));
  const trigger = closeoutTriggers.find((entry) => normalized.includes(entry.phrase));
  const ambiguous = ambiguousCloseoutPhrases.some((phrase) => normalized.includes(phrase));
  const modelRouting = {
    default_order: [
      "rules",
      "local_model",
      "active_agent",
      "subscription_worker",
      "paid_api_provider"
    ],
    paid_api_requires_confirmation: true,
    paid_api_used: false
  };
  if (trigger) {
    return {
      ok: true,
      action: "closeout_intent",
      language: trigger.language,
      closeout_trigger: hasActiveSession,
      can_run_closeout: hasActiveSession,
      closeout_intent: trigger.intent,
      confidence: trigger.confidence,
      confirmation_required: risky || !hasActiveSession,
      destructive_or_sensitive: risky,
      understanding_source: "rules",
      reason: hasActiveSession
        ? "Configured closeout phrase matched while a session is active."
        : "Configured closeout phrase matched, but no active session context is available.",
      model_routing: modelRouting
    };
  }
  if (ambiguous) {
    return {
      ok: true,
      action: "closeout_intent",
      language,
      closeout_trigger: false,
      can_run_closeout: false,
      closeout_intent: null,
      confidence: 0.45,
      confirmation_required: true,
      destructive_or_sensitive: risky,
      understanding_source: "confirmation_required",
      reason:
        "Wording may mean pause/closeout, but is ambiguous. Ask the owner to confirm before calling memory_closeout.",
      model_routing: {
        ...modelRouting,
        next_route: "local_model_or_active_agent_if_available"
      }
    };
  }
  return {
    ok: true,
    action: "closeout_intent",
    language,
    closeout_trigger: false,
    can_run_closeout: false,
    closeout_intent: null,
    confidence: message.trim() ? 0.3 : 0,
    confirmation_required: risky,
    destructive_or_sensitive: risky,
    understanding_source: "rules",
    reason: risky
      ? "Risky/non-routine wording requires confirmation before any action."
      : "No configured closeout phrase matched.",
    model_routing: modelRouting
  };
}

function eventKindForAgentKind(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "prompt" || normalized === "user_prompt") return "turn_user";
  if (normalized === "assistant_response" || normalized === "assistant") return "turn_assistant";
  if (normalized === "tool" || normalized === "tool_result" || normalized === "command_result") {
    return "tool_result";
  }
  if (normalized === "test" || normalized === "verification") return "tool_result";
  if (normalized === "file_change") return "file_change";
  if (normalized === "checkpoint") return "checkpoint";
  if (
    normalized === "context_read" ||
    normalized === "closeout" ||
    normalized === "pre_compaction" ||
    normalized === "stop"
  ) {
    return "system";
  }
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

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function pathPresent(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function upsertMemorySection(existing: string | null) {
  if (!existing) return `# Agent Instructions\n\n${memorySection}`;
  const pattern = /## Memory \(Recallant\)[\s\S]*?(?=\n## |\n# |$)/;
  if (pattern.test(existing)) return existing.replace(pattern, memorySection.trimEnd());
  return `${existing.trimEnd()}\n\n${memorySection}`;
}

async function upsertGitignore(projectDir: string) {
  const path = join(projectDir, ".gitignore");
  const existing = await readOptional(path);
  if (existing === null) return ".recallant/\n";
  const lines = existing.split("\n").map((line) => line.trim());
  if (lines.includes(".recallant/") || lines.includes(".recallant")) return existing;
  return `${existing.trimEnd()}\n.recallant/\n`;
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

type ContextPolicyProfile = "compact" | "standard" | "expanded" | "custom";

type ContextLintPolicy = {
  profile: ContextPolicyProfile;
  source: "default" | "project_settings" | "cli";
  override_reason: string | null;
  limits: {
    agents_max_chars: number;
    project_log_max_chars: number;
  };
  size_excess: "error" | "warn";
};

const contextPolicyProfiles: Record<
  ContextPolicyProfile,
  Omit<ContextLintPolicy, "source" | "override_reason">
> = {
  compact: {
    profile: "compact",
    limits: { agents_max_chars: 12_000, project_log_max_chars: 16_000 },
    size_excess: "error"
  },
  standard: {
    profile: "standard",
    limits: { agents_max_chars: 24_000, project_log_max_chars: 32_000 },
    size_excess: "error"
  },
  expanded: {
    profile: "expanded",
    limits: { agents_max_chars: 48_000, project_log_max_chars: 64_000 },
    size_excess: "warn"
  },
  custom: {
    profile: "custom",
    limits: { agents_max_chars: 48_000, project_log_max_chars: 64_000 },
    size_excess: "warn"
  }
};

function contextPolicyFromProfile(
  profile: string | null | undefined,
  source: ContextLintPolicy["source"],
  overrideReason: string | null
): ContextLintPolicy {
  const selected = profile && profile in contextPolicyProfiles ? profile : "standard";
  const base = contextPolicyProfiles[selected as ContextPolicyProfile];
  return { ...base, source, override_reason: overrideReason };
}

async function readProjectConfig(projectDir: string) {
  const content = await readOptional(join(projectDir, ".recallant", "config"));
  if (!content) return null;
  try {
    return JSON.parse(content) as { project_id?: string; recallant_server_url?: string };
  } catch {
    return null;
  }
}

function captureStatusFromState(state: AgentSessionState | null) {
  if (!state) return "not_observed";
  if (state.last_context_read_at && state.last_memory_write_at && state.last_checkpoint_at) {
    return "capture_active";
  }
  if (state.last_context_read_at || state.last_memory_write_at || state.last_checkpoint_at) {
    return "capture_partial";
  }
  return state.status === "active" ? "session_started" : "not_observed";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function checkCaptureReadiness(input: {
  projectDir: string;
  database: NonNullable<ReturnType<typeof createRecallantDbFromEnv>> | null;
}) {
  const config = await readProjectConfig(input.projectDir);
  const localState = await readAgentSessionState(input.projectDir).catch(() => null);
  const localStatus = captureStatusFromState(localState);
  let databaseReadiness: Record<string, unknown> | null = null;
  let databaseError: string | null = null;
  if (config?.project_id && input.database) {
    try {
      const dashboard = await input.database.getReviewDashboard({ project_id: config.project_id });
      const readiness = objectValue(dashboard.project_readiness);
      const dbReady = Boolean(
        readiness.last_context_read_at &&
        readiness.last_memory_write_at &&
        readiness.checkpoint_updated_at
      );
      databaseReadiness = {
        ready: dbReady,
        project_registered: Boolean(readiness.project_registered),
        last_context_read_at: readiness.last_context_read_at ?? null,
        last_memory_write_at: readiness.last_memory_write_at ?? null,
        checkpoint_updated_at: readiness.checkpoint_updated_at ?? null,
        capture_event_count: readiness.capture_event_count ?? 0,
        captured_decision_count: readiness.captured_decision_count ?? 0,
        active_sessions: readiness.active_sessions ?? 0,
        interrupted_sessions: readiness.interrupted_sessions ?? 0
      };
    } catch (error) {
      databaseError = error instanceof Error ? error.message : String(error);
    }
  }
  const localReady = localStatus === "capture_active";
  const databaseReady = databaseReadiness?.ready === true;
  const ready = localReady || databaseReady;
  const missing: string[] = [];
  if (!config?.project_id) missing.push("project config");
  if (!localReady && !databaseReady) missing.push("context read + memory write + checkpoint");
  if (!input.database && !localReady) missing.push("database connection or local capture state");
  return {
    required: false,
    ready,
    status: ready
      ? "capture_active"
      : localStatus === "capture_partial" || localStatus === "session_started"
        ? "capture_partial"
        : config?.project_id
          ? "registered_only"
          : "not_attached",
    missing,
    project_config: {
      present: Boolean(config?.project_id),
      project_id: config?.project_id ?? null,
      recallant_server_url: config?.recallant_server_url ?? null
    },
    local_state: localState
      ? {
          status: localState.status,
          capture_status: localStatus,
          session_id: localState.session_id,
          last_context_read_at: localState.last_context_read_at ?? null,
          last_memory_write_at: localState.last_memory_write_at ?? null,
          last_checkpoint_at: localState.last_checkpoint_at ?? null,
          updated_at: localState.updated_at
        }
      : { status: "missing", capture_status: "not_observed" },
    database_readiness: databaseReadiness,
    database_error: databaseError
  };
}

async function readProjectContextProfile(projectDir: string) {
  if (!process.env.RECALLANT_DATABASE_URL) return null;
  const config = await readProjectConfig(projectDir);
  if (!config?.project_id) return null;
  const client = new pg.Client({ connectionString: process.env.RECALLANT_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'context_budget_profile'",
      [config.project_id]
    );
    const value = result.rows[0]?.value;
    return typeof value === "string" ? value : null;
  } finally {
    await client.end();
  }
}

async function resolveContextLintPolicy(
  projectDir: string,
  argv: readonly string[]
): Promise<ContextLintPolicy> {
  const cliProfile = parseFlag(argv, "--context-profile");
  const overrideReason =
    parseFlag(argv, "--override-reason") ?? parseFlag(argv, "--reason") ?? null;
  if (cliProfile) return contextPolicyFromProfile(cliProfile, "cli", overrideReason);
  const projectProfile = await readProjectContextProfile(projectDir).catch(() => null);
  if (projectProfile) return contextPolicyFromProfile(projectProfile, "project_settings", null);
  return contextPolicyFromProfile("standard", "default", null);
}

function containsSecretValue(content: string) {
  return /^\s*[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|DSN|DATABASE_URL)[A-Z0-9_]*\s*=\s*\S+/im.test(
    content
  );
}

function looksLikeHistoryDump(content: string) {
  const signals = [
    ...(content.match(/^#{2,4}\s+(Session|Current Session|History|Handoff)\b/gim) ?? []),
    ...(content.match(/\b(Current focus|Next step|Last updated|Status):/gim) ?? [])
  ];
  return signals.length >= 8;
}

function adapterFiles(projectDir: string) {
  return [
    join(projectDir, "CLAUDE.md"),
    join(projectDir, ".cursor", "SESSION_HANDOFF.md"),
    join(projectDir, ".cursor", "rules", "memory.md")
  ];
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
  const targetConfig = clientTargetConfig(options.target, projectId, developerId);
  const plan = {
    action: "init",
    target: targetConfig.target,
    dry_run: options.dryRun,
    project_dir: options.projectDir,
    project_id: projectId,
    developer_id: developerId,
    capture_profile: options.captureProfile,
    files: [
      ".recallant/config",
      targetConfig.config_file,
      ".gitignore",
      "AGENTS.md",
      "PROJECT_LOG.md"
    ],
    import_candidates: await detectImportCandidates(options.projectDir),
    target_config: targetConfig,
    mcp_config: targetConfig.mcp_config
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
  await writeFile(
    join(options.projectDir, targetConfig.config_file),
    `${JSON.stringify(targetConfig.mcp_config, null, 2)}\n`
  );
  await writeFile(
    join(options.projectDir, ".gitignore"),
    await upsertGitignore(options.projectDir)
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
  const policy = await resolveContextLintPolicy(projectDir, argv);
  const agents = await readOptional(join(projectDir, "AGENTS.md"));
  const projectLog = await readOptional(join(projectDir, "PROJECT_LOG.md"));
  const failures: Array<{ code: string; file: string; message: string }> = [];
  const warnings: Array<{ code: string; file: string; message: string }> = [];
  const noteSizeExcess = (file: string, length: number, limit: number) => {
    const item = {
      code: "context_budget_exceeded",
      file,
      message: `${file} has ${length} characters; policy ${policy.profile} allows ${limit}.`
    };
    if (policy.size_excess === "warn") warnings.push(item);
    else failures.push(item);
  };
  if (
    policy.source === "cli" &&
    (policy.profile === "expanded" || policy.profile === "custom") &&
    !policy.override_reason
  ) {
    failures.push({
      code: "override_reason_required",
      file: "context_policy",
      message: "Expanded/custom context policy overrides require --override-reason."
    });
  }
  if (agents && agents.length > policy.limits.agents_max_chars) {
    noteSizeExcess("AGENTS.md", agents.length, policy.limits.agents_max_chars);
  }
  if (agents && (agents.match(/## Memory \(Recallant\)/g)?.length ?? 0) > 1) {
    failures.push({
      code: "duplicated_memory_section",
      file: "AGENTS.md",
      message: "AGENTS.md contains duplicated Memory (Recallant) sections."
    });
  }
  if (agents && looksLikeHistoryDump(agents)) {
    failures.push({
      code: "history_dump",
      file: "AGENTS.md",
      message: "AGENTS.md appears to contain copied historical/session log material."
    });
  }
  if (agents && containsSecretValue(agents)) {
    failures.push({
      code: "secret_value",
      file: "AGENTS.md",
      message: "AGENTS.md contains a secret-like environment value."
    });
  }
  if (projectLog && projectLog.length > policy.limits.project_log_max_chars) {
    noteSizeExcess("PROJECT_LOG.md", projectLog.length, policy.limits.project_log_max_chars);
  }
  if (projectLog && looksLikeHistoryDump(projectLog) && projectLog.length > 12_000) {
    failures.push({
      code: "project_log_archive",
      file: "PROJECT_LOG.md",
      message: "PROJECT_LOG.md appears to be an archive instead of a compact current checkpoint."
    });
  }
  if (projectLog && containsSecretValue(projectLog)) {
    failures.push({
      code: "secret_value",
      file: "PROJECT_LOG.md",
      message: "PROJECT_LOG.md contains a secret-like environment value."
    });
  }
  for (const adapterPath of adapterFiles(projectDir)) {
    const adapterContent = await readOptional(adapterPath);
    if (!adapterContent) continue;
    if (adapterContent.includes("## Memory (Recallant)") || looksLikeHistoryDump(adapterContent)) {
      failures.push({
        code: "adapter_rule_duplication",
        file: adapterPath.slice(projectDir.length + 1),
        message: "Adapter file duplicates Recallant bootstrap/history instead of pointing to it."
      });
    }
    if (containsSecretValue(adapterContent)) {
      failures.push({
        code: "secret_value",
        file: adapterPath.slice(projectDir.length + 1),
        message: "Adapter file contains a secret-like environment value."
      });
    }
  }
  const result = {
    ok: failures.length === 0,
    failures,
    warnings,
    policy,
    project_dir: projectDir
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function runContext(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for context preview");
  let sessionId: string | null = null;
  let shouldCloseSession = false;
  try {
    const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
    const explicitSessionId = parseFlag(argv, "--session-id");
    if (explicitSessionId) {
      sessionId = explicitSessionId;
    } else {
      const started = await database.startSession({
        client_kind: "codex",
        project_path: projectDir,
        session_label: "context-preview",
        resume_policy: "normal"
      });
      sessionId = started.session_id ? String(started.session_id) : null;
      shouldCloseSession = true;
    }
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
    if (sessionId && shouldCloseSession) await database.closeSession(sessionId, "client_exit");
    await database.close();
  }
}

async function runCloseoutIntent(argv: readonly string[]) {
  const text = parseFlag(argv, "--text") ?? positionalArgs(argv).join(" ");
  const dir = projectDir(argv);
  const state = await readAgentSessionState(dir);
  const hasActiveSession =
    argv.includes("--has-active-session") ||
    (state?.status === "active" && typeof state.session_id === "string");
  const result = {
    ...classifyCloseoutIntent(text, hasActiveSession),
    project_dir: dir,
    active_session_id:
      state?.status === "active" && typeof state.session_id === "string" ? state.session_id : null
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.confirmation_required && result.closeout_trigger) {
    process.exitCode = 2;
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

async function checkOwnerServerDeployment() {
  const plannedPort = Number(process.env.RECALLANT_PORT ?? "3005");
  const portsFile = process.env.RECALLANT_PORTS_FILE ?? "/ai/PORTS.yaml";
  const securityPath = process.env.RECALLANT_SECURITY_PATH ?? "/ai/SECURITY";
  const portsContent = await readOptional(portsFile);
  const portsRegistered = Boolean(
    portsContent &&
    portsContent.toLowerCase().includes("recallant") &&
    portsContent.includes(String(plannedPort))
  );
  const securityPresent = await pathPresent(securityPath);
  const warnings = [];
  if (!portsRegistered) {
    warnings.push(
      `Planned Recallant service port ${plannedPort} is not registered in ${portsFile}.`
    );
  }
  warnings.push(
    `${securityPath} must be consulted before exposure, firewall, Cloudflare, service, or secret changes.`
  );
  return {
    planned_service: {
      name: "recallant",
      port: plannedPort,
      bind_host: process.env.RECALLANT_HOST ?? "127.0.0.1"
    },
    ports_file: {
      path: portsFile,
      present: portsContent !== null,
      registered: portsRegistered
    },
    security_baseline: {
      path: securityPath,
      present: securityPresent,
      must_consult_before_exposure: true
    },
    warnings
  };
}

function systemctlValue(args: readonly string[]) {
  const result = spawnSync("systemctl", [...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function systemdBackupTimerStatus() {
  const active = systemctlValue(["is-active", "recallant-backup.timer"]);
  const enabled = systemctlValue(["is-enabled", "recallant-backup.timer"]);
  return {
    enabled: active === "active" || enabled === "enabled",
    status: [active, enabled].filter(Boolean).join("/") || "unknown",
    source: "systemd"
  };
}

async function latestBackupVerificationStatus() {
  const envStatus = process.env.RECALLANT_LATEST_BACKUP_VERIFICATION_STATUS;
  if (envStatus) return { status: envStatus, ok: envStatus === "passed", source: "env" };

  const verificationPath =
    process.env.RECALLANT_LATEST_BACKUP_VERIFICATION_FILE ??
    "/ai/recallant-data/backups/latest-verification.json";
  try {
    const parsed = JSON.parse(await readFile(verificationPath, "utf8")) as Record<string, unknown>;
    const status = String(parsed.restore_verification ?? parsed.status ?? "unknown");
    return {
      status,
      ok: status === "passed" && parsed.production_overwritten !== true,
      source: "latest-verification-file",
      path: verificationPath,
      verified_at: parsed.verified_at ?? null,
      manifest_path: parsed.manifest_path ?? null
    };
  } catch {
    const manifestPath =
      process.env.RECALLANT_LATEST_BACKUP_MANIFEST ??
      "/ai/recallant-data/backups/latest-manifest.json";
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as {
        restore_verification?: { status?: string };
      };
      const status = parsed.restore_verification?.status ?? "unknown";
      return { status, ok: status === "passed", source: "manifest", path: manifestPath };
    } catch {
      return { status: "unknown", ok: false, source: "missing" };
    }
  }
}

async function checkProductionReadiness(postgresReachable: boolean) {
  const bindHost = process.env.RECALLANT_HOST ?? "127.0.0.1";
  const cloudflareMode = process.env.RECALLANT_CLOUDFLARE_MODE ?? "disabled";
  const edgeAuth = process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH ?? "disabled";
  const envBackupTimerEnabled =
    process.env.RECALLANT_BACKUP_TIMER_ENABLED === "true" ||
    process.env.RECALLANT_BACKUP_TIMER_STATUS === "enabled";
  const backupTimer = process.env.RECALLANT_BACKUP_TIMER_STATUS
    ? {
        enabled: envBackupTimerEnabled,
        status: process.env.RECALLANT_BACKUP_TIMER_STATUS,
        source: "env"
      }
    : envBackupTimerEnabled
      ? { enabled: true, status: "enabled", source: "env" }
      : systemdBackupTimerStatus();
  const latestBackupVerification = await latestBackupVerificationStatus();
  let duplicateRecallantProjectRows: number | null = null;
  let unintendedPaidApiSuccessCalls30d: number | null = null;
  if (process.env.RECALLANT_DATABASE_URL) {
    const client = new pg.Client({ connectionString: process.env.RECALLANT_DATABASE_URL });
    const developerId = process.env.RECALLANT_DEVELOPER_ID ?? null;
    await client.connect();
    try {
      const checks = await client.query(
        `
          SELECT
            (
              SELECT count(*)::int
              FROM projects
              WHERE primary_path = '/ai/recallant'
                AND ($1::uuid IS NULL OR developer_id = $1::uuid)
            ) AS recallant_project_rows,
            (
              SELECT count(*)::int
              FROM model_calls c
              JOIN projects p ON p.id = c.project_id
              WHERE p.primary_path = '/ai/recallant'
                AND ($1::uuid IS NULL OR p.developer_id = $1::uuid)
                AND c.route_class = 'paid_api_provider'
                AND c.status = 'success'
                AND c.created_at >= now() - interval '30 days'
            ) AS paid_api_success_calls
        `,
        [developerId]
      );
      duplicateRecallantProjectRows = Number(checks.rows[0]?.recallant_project_rows ?? 0);
      unintendedPaidApiSuccessCalls30d = Number(checks.rows[0]?.paid_api_success_calls ?? 0);
    } catch {
      duplicateRecallantProjectRows = null;
      unintendedPaidApiSuccessCalls30d = null;
    } finally {
      await client.end();
    }
  }
  const localhostOnlyOrigin =
    bindHost === "127.0.0.1" || bindHost === "::1" || bindHost.endsWith(".tailnet");
  return {
    doctor_ok: postgresReachable,
    local_stdio_mcp_smoke: {
      required: true,
      command: "npm run mcp:smoke"
    },
    review_ui_cloudflare_access: {
      required: true,
      mode: cloudflareMode,
      edge_auth_required: edgeAuth === "required",
      admin_email_count: (
        process.env.RECALLANT_ADMIN_EMAILS ??
        process.env.RECALLANT_ADMIN_EMAIL ??
        ""
      )
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean).length
    },
    localhost_only_origin: {
      bind_host: bindHost,
      ok: localhostOnlyOrigin
    },
    backup_timer: {
      enabled: backupTimer.enabled,
      status: backupTimer.status,
      source: backupTimer.source
    },
    latest_backup_verification: latestBackupVerification,
    recallant_project_rows: duplicateRecallantProjectRows,
    no_duplicate_recallant_project_rows:
      duplicateRecallantProjectRows === null ? null : duplicateRecallantProjectRows <= 1,
    unintended_paid_api_success_calls_30d: unintendedPaidApiSuccessCalls30d,
    no_unintended_paid_api_use:
      unintendedPaidApiSuccessCalls30d === null ? null : unintendedPaidApiSuccessCalls30d === 0,
    ready:
      postgresReachable &&
      localhostOnlyOrigin &&
      cloudflareMode === "enabled" &&
      edgeAuth === "required" &&
      backupTimer.enabled &&
      latestBackupVerification.ok &&
      duplicateRecallantProjectRows !== null &&
      duplicateRecallantProjectRows <= 1 &&
      unintendedPaidApiSuccessCalls30d !== null &&
      unintendedPaidApiSuccessCalls30d === 0
  };
}

async function runDoctor(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const requireCapture = argv.includes("--require-capture");
  let postgres = { configured: Boolean(process.env.RECALLANT_DATABASE_URL), reachable: false };
  try {
    if (database) {
      try {
        await database.ensureProject(process.env.RECALLANT_PROJECT_PATH ?? projectDir);
        postgres = { configured: true, reachable: true };
      } catch {
        postgres = { configured: true, reachable: false };
      }
    }
    const captureReadiness = await checkCaptureReadiness({ projectDir, database });
    const result = {
      ...describeCliBoundary(),
      postgres,
      project_config: {
        path: join(projectDir, ".recallant", "config"),
        present: (await readOptional(join(projectDir, ".recallant", "config"))) !== null
      },
      capture_readiness: {
        ...captureReadiness,
        required: requireCapture
      },
      local_model: await checkOllama(),
      model_routes: {
        local_model: { enabled: true, provider: "ollama", route_class: "local_model" },
        active_agent: {
          enabled: true,
          route_class: "active_agent",
          before_paid_api: true
        },
        subscription_worker: {
          enabled: false,
          route_class: "subscription_worker",
          before_paid_api: true,
          limit_behavior: {
            rate_limited: "defer_or_downgrade_or_ask",
            exhausted: "defer_or_downgrade_or_ask",
            silent_paid_api_fallthrough: false
          }
        },
        paid_api_provider: {
          enabled: false,
          route_class: "paid_api_provider",
          default_provider: "openai",
          requires_approval: true,
          default_mode: "confirm_each",
          denied_or_expired_behavior: "defer_or_downgrade_without_provider_call",
          auto_with_caps: {
            enabled: false,
            requires_explicit_project_task_profile: true
          },
          default_models: {
            openai_baseline: "openai/gpt-5.4-mini",
            gemini_cost: "gemini/gemini-2.5-flash-lite",
            gemini_balanced: "gemini/gemini-2.5-flash",
            claude_cheap: "anthropic/claude-haiku-4-5"
          },
          explicit_opt_in_required_for: [
            "preview_models",
            "gemini/gemini-3.5-flash",
            "claude-sonnet",
            "claude-opus"
          ]
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
        auto_with_caps_requires_explicit_enablement: true,
        browser_automation_allowed: false,
        scraping_allowed: false,
        hidden_api_routes_allowed: false,
        limit_bypass_routes_allowed: false,
        preview_models_require_opt_in: true,
        gemini_3_5_flash_requires_opt_in: true,
        claude_sonnet_opus_require_quality_profile: true,
        starts_local_services: false
      },
      owner_server_deployment: await checkOwnerServerDeployment(),
      production_readiness: await checkProductionReadiness(postgres.reachable),
      owner_server_notes: [
        "/ai/PORTS.yaml must be checked before service start",
        "/ai/SECURITY must be consulted before public exposure"
      ]
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (requireCapture && !captureReadiness.ready) {
      process.exitCode = 2;
    }
  } finally {
    if (database) {
      await database.close();
    }
  }
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
  const localSpoolStatus = await getLocalSpoolStatus(argv);
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
    local_spool_status: localSpoolStatus
  });
  const contextRead = await database.appendEvent({
    session_id: sessionId,
    client_kind: clientKind,
    event_kind: "system",
    text: `Context pack read for task: ${taskHint}`,
    metadata: {
      capture_kind: "context_read",
      context_pack_id: pack.context_pack_id,
      task_hint: taskHint,
      local_spool_status: localSpoolStatus
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
    const event = await database.appendEvent({
      session_id: state.session_id,
      client_kind: state.client_kind,
      event_kind: "system",
      text: `Closeout: ${String(payload.summary ?? payload.current_focus)}`,
      metadata: { capture_kind: "agent_closeout", checkpoint_payload: payload },
      raw_artifacts: [],
      dedup_key: dedupHash("agent-closeout", {
        session_id: state.session_id,
        payload,
        created_at: new Date().toISOString()
      })
    });
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
      last_checkpoint_at: now,
      last_memory_write_at: now,
      last_event_id: String(event.event_id)
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

async function resolveConnectDeveloperId(input: { projectId: string }) {
  if (process.env.RECALLANT_DEVELOPER_ID) return process.env.RECALLANT_DEVELOPER_ID;
  const database = createRecallantDbFromEnv();
  if (!database) {
    throw new Error(
      "VALIDATION_ERROR: connect requires RECALLANT_DEVELOPER_ID or RECALLANT_DATABASE_URL"
    );
  }
  try {
    const binding = await database.getProjectBinding(input.projectId);
    if (!binding) {
      throw new Error(
        `VALIDATION_ERROR: project ${input.projectId} is not registered in Recallant`
      );
    }
    return binding.developer_id;
  } finally {
    await database.close();
  }
}

function failSoftHookScript(input: { command: string; stdinText?: boolean }) {
  const stdin = input.stdinText ? 'TEXT="$(cat)"' : 'TEXT="${RECALLANT_HOOK_TEXT:-hook event}"';
  return `#!/usr/bin/env sh
set +e

PROJECT_DIR="\${RECALLANT_PROJECT_DIR:-$(pwd)}"
TIMEOUT_SECONDS="\${RECALLANT_HOOK_TIMEOUT_SECONDS:-2}"
${stdin}

if ! command -v recallant >/dev/null 2>&1; then
  exit 0
fi

if command -v timeout >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" ${input.command} >/dev/null 2>&1
else
  ${input.command} >/dev/null 2>&1
fi

exit 0
`;
}

function localHookKitFiles() {
  const eventScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --kind "${1:-action}" --text "$TEXT"',
    stdinText: true
  });
  const promptScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --kind prompt --title "User prompt captured by hook" --text "$TEXT"',
    stdinText: true
  });
  const toolResultScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --kind tool_result --title "Tool result captured by hook" --text "$TEXT"',
    stdinText: true
  });
  const startScript = failSoftHookScript({
    command:
      'recallant agent-start --project-dir "$PROJECT_DIR" --task-hint "${1:-hook session start}"'
  });
  const checkpointScript = failSoftHookScript({
    command:
      'recallant agent-checkpoint --project-dir "$PROJECT_DIR" --status "${RECALLANT_HOOK_STATUS:-in_progress}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Continue from Recallant context.}"',
    stdinText: true
  });
  const closeoutScript = failSoftHookScript({
    command:
      'recallant agent-closeout --project-dir "$PROJECT_DIR" --status "${RECALLANT_HOOK_STATUS:-closed}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Continue from Recallant context.}" --summary "$TEXT"',
    stdinText: true
  });
  const preCompactionScript = failSoftHookScript({
    command:
      'recallant agent-checkpoint --project-dir "$PROJECT_DIR" --status "${RECALLANT_HOOK_STATUS:-in_progress}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Resume after compaction from Recallant context.}"',
    stdinText: true
  });
  const stopScript = failSoftHookScript({
    command:
      'recallant agent-closeout --project-dir "$PROJECT_DIR" --status "${RECALLANT_HOOK_STATUS:-closed}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Resume from Recallant context in the next session.}" --summary "$TEXT"',
    stdinText: true
  });
  const readme = `# Recallant Local Hook Kit

These project-local hook scripts are optional client integration helpers.

They are fail-soft by design:

- if \`recallant\` is unavailable, they exit 0;
- if a hook times out, they exit 0;
- they never write global client config;
- set \`RECALLANT_PROJECT_DIR\` when a client runs hooks outside the project folder;
- set \`RECALLANT_HOOK_TIMEOUT_SECONDS\` to tune the default 2 second timeout.

Client integrations can call:

- \`start-session.sh "<task hint>"\` at session start;
- \`user-prompt.sh < prompt.txt\` when the owner sends a prompt;
- \`tool-result.sh < result.txt\` after meaningful tool/command results;
- \`capture-event.sh action|decision|test < input.txt\` for generic capture;
- \`pre-compaction.sh < summary.txt\` before context compaction;
- \`checkpoint.sh < summary.txt\` before pause or handoff;
- \`stop-session.sh < summary.txt\` or \`closeout.sh < summary.txt\` when a session stops.
`;
  return [
    {
      path: ".recallant/hooks/README.md",
      content: readme,
      executable: false
    },
    {
      path: ".recallant/hooks/start-session.sh",
      content: startScript,
      executable: true
    },
    {
      path: ".recallant/hooks/user-prompt.sh",
      content: promptScript,
      executable: true
    },
    {
      path: ".recallant/hooks/tool-result.sh",
      content: toolResultScript,
      executable: true
    },
    {
      path: ".recallant/hooks/capture-event.sh",
      content: eventScript,
      executable: true
    },
    {
      path: ".recallant/hooks/pre-compaction.sh",
      content: preCompactionScript,
      executable: true
    },
    {
      path: ".recallant/hooks/checkpoint.sh",
      content: checkpointScript,
      executable: true
    },
    {
      path: ".recallant/hooks/stop-session.sh",
      content: stopScript,
      executable: true
    },
    {
      path: ".recallant/hooks/closeout.sh",
      content: closeoutScript,
      executable: true
    }
  ];
}

function parseJsonObjectOrEmpty(text: string | null) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mergeMcpServers(
  existingText: string | null,
  desiredConfig: { mcpServers: Record<string, unknown> }
) {
  const existingObject = parseJsonObjectOrEmpty(existingText);
  const existingServers =
    existingObject.mcpServers &&
    typeof existingObject.mcpServers === "object" &&
    !Array.isArray(existingObject.mcpServers)
      ? (existingObject.mcpServers as Record<string, unknown>)
      : {};
  return {
    ...existingObject,
    mcpServers: {
      ...existingServers,
      ...desiredConfig.mcpServers
    }
  };
}

async function runConnect(argv: readonly string[]) {
  const dir = projectDir(argv);
  const target = parseFlag(argv, "--target") ?? argv[3] ?? "codex";
  const dryRun = argv.includes("--dry-run");
  const installLocalHooks = argv.includes("--install-local-hooks") || argv.includes("--hook-kit");
  const config = await readProjectConfig(dir);
  if (!config?.project_id) {
    throw new Error(
      "VALIDATION_ERROR: connect requires an attached project with .recallant/config"
    );
  }
  const developerId = await resolveConnectDeveloperId({
    projectId: config.project_id
  });
  const targetConfig = clientTargetConfig(target, config.project_id, developerId);
  const targetPath = join(dir, targetConfig.config_file);
  const existing = await readOptional(targetPath);
  const desiredConfig = targetConfig.merge_mcp_servers
    ? mergeMcpServers(existing, targetConfig.mcp_config)
    : targetConfig.mcp_config;
  const desired = `${JSON.stringify(desiredConfig, null, 2)}\n`;
  const same = existing === desired;
  const hookFiles = installLocalHooks ? localHookKitFiles() : [];
  const hookFilePlans = [];
  for (const hookFile of hookFiles) {
    const hookPath = join(dir, hookFile.path);
    const current = await readOptional(hookPath);
    hookFilePlans.push({
      ...hookFile,
      absolute_path: hookPath,
      same: current === hookFile.content
    });
  }
  const localHookKitPresent =
    (await readOptional(join(dir, ".recallant", "hooks", "capture-event.sh"))) !== null;
  const state = await readAgentSessionState(dir);
  const backupPath =
    existing && !same
      ? join(
          recallantDir(dir),
          "backups",
          `connect-${new Date().toISOString().replace(/[:.]/g, "-")}`,
          targetConfig.config_file.replace(/[\\/]/g, "__")
        )
      : null;
  const plannedChanges = same
    ? [{ action: "no_change", path: targetConfig.config_file }]
    : [
        ...(backupPath ? [{ action: "backup_file", path: backupPath }] : []),
        {
          action: targetConfig.merge_mcp_servers ? "merge_file" : "write_file",
          path: targetConfig.config_file
        }
      ];
  const hookChanges = hookFilePlans.map((hookFile) =>
    hookFile.same
      ? { action: "no_change", path: hookFile.path }
      : { action: "write_file", path: hookFile.path }
  );
  if (!dryRun && !same) {
    if (backupPath && existing !== null) {
      await mkdir(backupPath.split("/").slice(0, -1).join("/"), { recursive: true });
      await writeFile(backupPath, existing);
    }
    await mkdir(join(dir, targetConfig.config_file).split("/").slice(0, -1).join("/"), {
      recursive: true
    });
    await writeFile(targetPath, desired);
  }
  if (!dryRun && installLocalHooks) {
    for (const hookFile of hookFilePlans) {
      if (!hookFile.same) {
        await mkdir(hookFile.absolute_path.split("/").slice(0, -1).join("/"), { recursive: true });
        await writeFile(hookFile.absolute_path, hookFile.content);
      }
      if (hookFile.executable) await chmod(hookFile.absolute_path, 0o755);
    }
  }
  const hookStatus = installLocalHooks
    ? dryRun
      ? "local_hook_kit_planned"
      : "local_hook_kit_installed"
    : localHookKitPresent
      ? "local_hook_kit_installed"
      : "not_installed";
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "connect",
        dry_run: dryRun,
        client: targetConfig.target,
        project_id: config.project_id,
        developer_id: developerId,
        connection_status: "mcp_only",
        hook_status: hookStatus,
        capture_status: captureStatusFromState(state),
        writes_files: !dryRun && (!same || hookFilePlans.some((hookFile) => !hookFile.same)),
        writes_global_config: false,
        planned_changes: [...plannedChanges, ...hookChanges],
        config_file: targetConfig.config_file,
        config_format: targetConfig.format,
        client_specific: targetConfig.client_specific,
        merge_mcp_servers: targetConfig.merge_mcp_servers,
        setup_hint: targetConfig.setup_hint,
        hook_integration: {
          mode: installLocalHooks || localHookKitPresent ? "local_hook_kit" : "none",
          fail_soft: true,
          writes_global_config: false,
          installed_files: hookFilePlans.map((hookFile) => hookFile.path),
          timeout_seconds_env: "RECALLANT_HOOK_TIMEOUT_SECONDS",
          project_dir_env: "RECALLANT_PROJECT_DIR"
        },
        mcp_config: desiredConfig
      },
      null,
      2
    )}\n`
  );
}

function parseProjectSourceKind(raw: string | undefined): ProjectSourceKind {
  const value = raw ?? "workspace_path";
  const allowed: ProjectSourceKind[] = [
    "workspace_path",
    "repo",
    "server_path",
    "document_collection",
    "connector",
    "manual",
    "virtual",
    "other"
  ];
  if (!allowed.includes(value as ProjectSourceKind)) {
    throw new Error(`VALIDATION_ERROR: invalid source kind ${value}`);
  }
  return value as ProjectSourceKind;
}

function parseProjectKind(raw: string | undefined) {
  const value = raw ?? "other";
  const allowed = ["repo", "subproject", "workspace", "personal_domain", "other"];
  if (!allowed.includes(value)) throw new Error(`VALIDATION_ERROR: invalid project kind ${value}`);
  return value as "repo" | "subproject" | "workspace" | "personal_domain" | "other";
}

async function runMemorySpace(argv: readonly string[]) {
  const subcommand = argv[3] ?? "list";
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for memory-space commands");
  try {
    if (subcommand === "create") {
      const name =
        parseFlag(argv, "--name") ?? positionalArgs(argv).find((arg) => arg !== "create");
      if (!name) throw new Error("VALIDATION_ERROR: memory-space create requires --name");
      const primaryPath = parseFlag(argv, "--primary-path");
      const space = await database.createMemorySpace({
        name,
        projectKind: parseProjectKind(parseFlag(argv, "--project-kind")),
        memoryDomain: parseFlag(argv, "--memory-domain") ?? "agent_work",
        primaryPath: primaryPath ? resolve(primaryPath) : null
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "memory_space_create",
            memory_space: space,
            writes_database: true
          },
          null,
          2
        )}\n`
      );
      return;
    }
    if (subcommand === "list") {
      const spaces = await database.listMemorySpaces();
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "memory_space_list",
            count: spaces.length,
            memory_spaces: spaces
          },
          null,
          2
        )}\n`
      );
      return;
    }
    throw new Error("VALIDATION_ERROR: memory-space supports create|list");
  } finally {
    await database.close();
  }
}

async function runSourceCommand(argv: readonly string[]) {
  const subcommand = argv[3] ?? "list";
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for source commands");
  try {
    if (subcommand === "attach") {
      const projectId = parseFlag(argv, "--project-id");
      if (!projectId) throw new Error("VALIDATION_ERROR: source attach requires --project-id");
      const sourceKind = parseProjectSourceKind(parseFlag(argv, "--source-kind"));
      const rawUri = parseFlag(argv, "--uri");
      const uri =
        rawUri && ["workspace_path", "server_path"].includes(sourceKind) ? resolve(rawUri) : rawUri;
      const label =
        parseFlag(argv, "--label") ??
        (uri ? uri.split("/").filter(Boolean).at(-1) : undefined) ??
        `${sourceKind} source`;
      const source = await database.attachProjectSource({
        project_id: projectId,
        source_kind: sourceKind,
        label,
        uri: uri ?? null,
        is_primary: argv.includes("--primary"),
        status: "active",
        metadata: { created_by: "recallant-cli" }
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "source_attach",
            source,
            writes_database: true
          },
          null,
          2
        )}\n`
      );
      return;
    }
    if (subcommand === "list") {
      const projectId = parseFlag(argv, "--project-id");
      if (!projectId) throw new Error("VALIDATION_ERROR: source list requires --project-id");
      const sources = await database.listProjectSources(projectId);
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "source_list",
            project_id: projectId,
            count: sources.length,
            sources
          },
          null,
          2
        )}\n`
      );
      return;
    }
    if (subcommand === "detach") {
      const sourceId = parseFlag(argv, "--source-id");
      if (!sourceId) throw new Error("VALIDATION_ERROR: source detach requires --source-id");
      const source = await database.detachProjectSource({
        source_id: sourceId,
        reason: parseFlag(argv, "--reason") ?? "recallant source detach"
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: Boolean(source),
            action: "source_detach",
            source,
            writes_database: Boolean(source)
          },
          null,
          2
        )}\n`
      );
      return;
    }
    throw new Error("VALIDATION_ERROR: source supports attach|list|detach");
  } finally {
    await database.close();
  }
}

async function main(argv: readonly string[]) {
  const command = argv[2];

  if (command === "mcp-server") {
    await runRecallantStdioServer();
    return;
  }
  if (command === "doctor") return runDoctor(argv);
  if (command === "attach") return runAttach(argv);
  if (command === "connect") return runConnect(argv);
  if (command === "detach" || command === "project-detach") return runDetach(argv);
  if (command === "memory-space" || command === "memory-spaces") return runMemorySpace(argv);
  if (command === "source" || command === "project-source") return runSourceCommand(argv);
  if (command === "local-cleanup" || command === "sandbox-local-cleanup")
    return runLocalCleanup(argv);
  if (command === "init") return runInit(argv);
  if (command === "discover") return runDiscover(argv);
  if (command === "import") return runImport(argv);
  if (command === "lint-context") return runLintContext(argv);
  if (command === "context") return runContext(argv);
  if (command === "closeout-intent") return runCloseoutIntent(argv);
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
    "Usage: recallant <mcp-server|doctor|attach|connect|detach|memory-space|source|local-cleanup|init|discover|import|lint-context|context|closeout-intent|backup|backup-verify|restore-plan|analyze|cleanup|agent-start|agent-event|agent-checkpoint|agent-closeout|spool-append|sync-spool|prune-spool>\n"
  );
  process.exitCode = 1;
}

await loadDefaultEnv();
await main(process.argv);
