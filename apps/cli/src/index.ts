#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { RecallantDb, createRecallantDbFromEnv, redactSystemActivityValue } from "@recallant/db";
import type { JsonObject, ProjectSourceKind, RawArtifactInput } from "@recallant/db";
import { runRecallantRemoteBridge, runRecallantStdioServer } from "@recallant/mcp";
import pg from "pg";
import {
  detectImportCandidates,
  discoveryCandidateForImport,
  discoveryResult,
  formatDiscoveryText,
  readImportTextForCandidate
} from "./discovery.js";
import {
  analyzeProjectDocumentationPosture,
  summarizeDocumentationPostureForOnboard,
  type DocumentationPosture
} from "./documentation-posture.js";
import { runAttach } from "./attach.js";
import {
  clientTargetConfig,
  codexConfigHasRecallantMcp,
  connectClientTargetConfig,
  remoteClientTargetConfig,
  remoteMcpProvisioningOutput,
  renderClientTargetConfig,
  renderRemoteClientTargetConfig
} from "./client-targets.js";
import { validateRemoteMcpBridgeConfig } from "@recallant/contracts";
import { runDetach } from "./detach.js";
import { runLocalCleanup } from "./local-cleanup.js";
import { runProjectSanitize } from "./project-sanitize.js";
import { runRemoteDoctor } from "./remote-doctor.js";

const recallantCliVersion = "0.0.0";

const memorySection = `## Memory (Recallant)

- At session start: call \`memory_start_session\`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call \`memory_get_context_pack\` with the current task hint.
- Use \`memory_search\` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in \`memory_search\`, not broad ones. One call per session start is usually enough.
- After meaningful progress: write meaningful events/memories through \`memory_append_event\` or \`memory_create_agent_memory\`, then call \`memory_set_checkpoint\`; Recallant syncs the compact \`PROJECT_LOG.md\` fallback when it exists.
- On clear pause/exit/closeout intent: call \`memory_closeout\`; rely on its repo-sync result instead of editing \`PROJECT_LOG.md\` by hand.
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

function envValueIsSet(value: string | undefined) {
  return value !== undefined && value.trim() !== "";
}

type EnvLoadState = {
  status:
    | "not_checked"
    | "explicit_database_url"
    | "loaded_env_file"
    | "env_file_missing"
    | "env_file_unreadable";
  source: "none" | "explicit_env" | "default_env_file" | "explicit_env_file";
  env_file_loaded: boolean;
  database_url_present_before: boolean;
  database_url_present_after: boolean;
};

let envLoadState: EnvLoadState = {
  status: "not_checked",
  source: "none",
  env_file_loaded: false,
  database_url_present_before: false,
  database_url_present_after: false
};

async function loadDefaultEnv() {
  const envFile =
    process.env.RECALLANT_ENV_FILE ?? join(homedir(), ".config", "recallant", "recallant.env");
  const explicitEnvFile = envValueIsSet(process.env.RECALLANT_ENV_FILE);
  const databaseUrlBefore = envValueIsSet(process.env.RECALLANT_DATABASE_URL);
  if (!explicitEnvFile && databaseUrlBefore) {
    envLoadState = {
      status: "explicit_database_url",
      source: "explicit_env",
      env_file_loaded: false,
      database_url_present_before: true,
      database_url_present_after: true
    };
    return;
  }
  try {
    const content = await readFile(envFile, "utf8");
    const loadedKeys: string[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [rawKey, ...rawValueParts] = trimmed.split("=");
      const key = rawKey?.trim();
      if (!key || envValueIsSet(process.env[key])) continue;
      process.env[key] = parseEnvValue(rawValueParts.join("="));
      loadedKeys.push(key);
    }
    const databaseUrlAfter = envValueIsSet(process.env.RECALLANT_DATABASE_URL);
    envLoadState = {
      status: databaseUrlAfter && !databaseUrlBefore ? "loaded_env_file" : "explicit_database_url",
      source: explicitEnvFile ? "explicit_env_file" : "default_env_file",
      env_file_loaded: loadedKeys.length > 0,
      database_url_present_before: databaseUrlBefore,
      database_url_present_after: databaseUrlAfter
    };
  } catch {
    envLoadState = {
      status: "env_file_missing",
      source: explicitEnvFile ? "explicit_env_file" : "default_env_file",
      env_file_loaded: false,
      database_url_present_before: databaseUrlBefore,
      database_url_present_after: envValueIsSet(process.env.RECALLANT_DATABASE_URL)
    };
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
    "--text",
    "--context-profile",
    "--override-reason",
    "--reason",
    "--name",
    "--project-kind",
    "--memory-domain",
    "--primary-path",
    "--project-id",
    "--developer-id",
    "--client-id",
    "--credential-id",
    "--expires-at",
    "--source-kind",
    "--source-id",
    "--label",
    "--uri",
    "--query",
    "--since",
    "--until",
    "--surface",
    "--slow-ms",
    "--top-k",
    "--marker",
    "--previewed-global-target"
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

function parseProjectArg(argv: readonly string[], start = 3) {
  const flagsWithValues = new Set(["--project-dir", "--format", "--client"]);
  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return null;
}

type OnboardOptions = {
  projectDir: string;
  client: string | null;
  clientExplicit: boolean;
  installLocalHooks: boolean;
  installLocalHooksExplicit: boolean;
  verify: boolean;
  verifyExplicit: boolean;
  dryRun: boolean;
  yes: boolean;
  cancel: boolean;
  initGit: boolean;
  skipVcsSafety: boolean;
  format: "text" | "json";
};

type OnboardStorageStep = {
  status: "ready" | "missing" | "unreachable" | "storage_blocked";
  configured: boolean;
  reachable: boolean;
  env_file_loaded: boolean;
  env_source: EnvLoadState["source"];
  setup_mode: "not_needed" | "guided" | "non_interactive";
  message: string;
  error_code: "storage_blocked" | null;
  offline_spool: {
    available: true;
    role: "fail_soft_capture_fallback";
    complete_onboarding: false;
  };
  setup_choices: Array<{
    id: "single_user_storage" | "existing_private_profile" | "stop_without_changes";
    label: string;
    description: string;
  }>;
};

type OnboardVerifyEvidence = {
  context_read: boolean;
  memory_write: boolean;
  checkpoint: boolean;
  recall: boolean;
};

type OnboardVerifyPayload = {
  status: "passed" | "skipped" | "failed";
  ask_answer: string | null;
  failed_stage: "capture" | "readiness" | "recall" | null;
  message: string | null;
  capture_active: boolean;
  evidence: OnboardVerifyEvidence;
  proof: {
    demo: "done" | "skipped" | "failed";
    doctor: "done" | "skipped" | "failed";
    ask: "done" | "skipped" | "failed";
  };
  stages: {
    capture: { status: "done" | "skipped" | "failed"; detail: string | null };
    readiness: {
      status: "done" | "skipped" | "failed";
      detail: string | null;
      evidence: OnboardVerifyEvidence;
    };
    recall: { status: "done" | "skipped" | "failed"; detail: string | null };
  };
};

type OnboardEmbeddingRecoveryPayload = {
  status:
    | "skipped"
    | "no_pending"
    | "recovered"
    | "still_pending"
    | "model_unavailable"
    | "unknown";
  attempted: boolean;
  project_id: string | null;
  pending_before: number | null;
  attempted_chunks: number;
  recovered_chunks: number;
  remaining_pending: number | null;
  limit: number;
  recovery_available: boolean;
  latest_failure: unknown;
  warning: string | null;
  recommendation: string;
  scope: {
    project_scoped: true;
    bounded: true;
    limit: number;
  };
};

type OnboardWorkbenchOutcome = {
  available: boolean;
  url: string | null;
  auth_required: boolean;
  private_by_default: boolean;
  project_visible: boolean | null;
  migration_review_queue: {
    import_candidate_count: number | null;
    pending_review: number | null;
    review_needed: boolean | null;
  };
  message: string;
};

type OnboardVersionControlStep = {
  status:
    | "ready"
    | "initialized"
    | "needs_choice"
    | "skipped"
    | "git_missing"
    | "dry_run_planned"
    | "failed";
  git_available: boolean;
  repository_ready: boolean;
  initialized: boolean;
  writes_files: boolean;
  message: string;
  refusal_available: true;
  choices: Array<{
    id: "initialize_git" | "continue_without_git" | "install_git";
    label: string;
    description: string;
  }>;
  warnings: string[];
};

type OnboardAttachedStep = {
  status: "attached" | "skipped" | "needs_confirmation" | "failed" | "unknown";
  command: string | null;
  details?: string;
};

type OnboardConnectedStep = {
  status: "connected" | "skipped" | "failed" | "needed";
  command: string | null;
  details?: string;
};

function parseOnboardOptions(argv: readonly string[]): OnboardOptions {
  const rawClient = parseFlag(argv, "--client");
  const clientDisabled = argv.includes("--no-client");
  const installHooksRequested =
    argv.includes("--install-local-hooks") || argv.includes("--hook-kit");
  const installHooksDisabled =
    argv.includes("--no-install-local-hooks") || argv.includes("--no-local-hooks");
  const verifyRequested = argv.includes("--verify");
  const verifyDisabled = argv.includes("--no-verify");
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  if (clientDisabled && rawClient) {
    throw new Error("Use either --client <name> or --no-client, not both.");
  }
  if (installHooksRequested && installHooksDisabled) {
    throw new Error("Use either --install-local-hooks or --no-local-hooks, not both.");
  }
  if (verifyRequested && verifyDisabled) {
    throw new Error("Use either --verify or --no-verify, not both.");
  }
  if (clientDisabled && installHooksRequested) {
    throw new Error("--install-local-hooks requires a client; remove --no-client first.");
  }
  if (clientDisabled && verifyRequested) {
    throw new Error("--verify requires a client; remove --no-client first.");
  }
  const client = clientDisabled ? null : rawClient && rawClient.trim() ? rawClient.trim() : "codex";
  const clientEnabled = client !== null;
  return {
    projectDir: resolve(parseFlag(argv, "--project-dir") ?? parseProjectArg(argv) ?? process.cwd()),
    client,
    clientExplicit: Boolean(rawClient || clientDisabled),
    installLocalHooks: clientEnabled && !installHooksDisabled,
    installLocalHooksExplicit: installHooksRequested || installHooksDisabled,
    verify: clientEnabled && !verifyDisabled,
    verifyExplicit: verifyRequested || verifyDisabled,
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    cancel: argv.includes("--cancel"),
    initGit: argv.includes("--init-git"),
    skipVcsSafety: argv.includes("--skip-vcs-safety"),
    format
  };
}

function spoolDir(argv: readonly string[]) {
  return resolve(
    parseFlag(argv, "--spool-dir") ??
      process.env.RECALLANT_SPOOL_DIR ??
      join(projectDir(argv), ".recallant", "spool")
  );
}

function spoolPath(argv: readonly string[]) {
  return join(spoolDir(argv), "spool.jsonl");
}

function spoolManifestPath(argv: readonly string[]) {
  return join(spoolDir(argv), "sync-manifest.json");
}

function auditSpoolPath(argv: readonly string[]) {
  return join(spoolDir(argv), "audit.jsonl");
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
  const lastRecord = records.at(-1) ?? null;
  const lastUnsynced = unsynced.at(-1) ?? null;
  return {
    status: unsynced.length > 0 ? "unsynced" : records.length > 0 ? "synced" : "empty",
    spool_path: spoolPath(argv),
    manifest_path: spoolManifestPath(argv),
    record_count: records.length,
    unsynced_count: unsynced.length,
    last_write_at:
      typeof lastRecord?.created_at === "string"
        ? lastRecord.created_at
        : typeof lastRecord?.createdAt === "string"
          ? lastRecord.createdAt
          : null,
    last_unsynced_local_id: lastUnsynced ? String(lastUnsynced.local_id ?? "") : null,
    replay_command: `recallant sync-spool --project-dir ${projectDir(argv)} --spool-dir ${spoolDir(argv)} --dry-run`,
    sync_command: `recallant sync-spool --project-dir ${projectDir(argv)} --spool-dir ${spoolDir(argv)}`,
    prune_command: `recallant prune-spool --spool-dir ${spoolDir(argv)} --synced`,
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

const auditedCliCommands = new Set([
  "agent-checkpoint",
  "agent-event",
  "agent-start",
  "audit",
  "ask",
  "context",
  "doctor",
  "onboard",
  "project-sanitize",
  "sanitize",
  "project-purge"
]);

type CliAuditStatus = {
  durable: boolean;
  surface: "cli";
  operation: string;
  status: "recorded" | "pending_durable_audit" | "failed";
  activity_id?: string;
  trace_id?: string;
  spool_path?: string;
  local_id?: string;
  error_code?: string;
  reason?: string;
};

type CliAuditContext = {
  command: string;
  database: RecallantDb | null;
  activityId: string | null;
  traceId: string | null;
  startStatus: CliAuditStatus;
};

function shouldAuditCliCommand(command: string | undefined) {
  return Boolean(command && auditedCliCommands.has(command));
}

function commandUsesRemoteOnlyBootstrap(command: string | undefined) {
  return command === "remote-bridge" || command === "connect-remote" || command === "remote-doctor";
}

function createCliAuditDb() {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) return null;
  return new RecallantDb({
    databaseUrl,
    developerId: process.env.RECALLANT_DEVELOPER_ID,
    projectId: process.env.RECALLANT_PROJECT_ID,
    projectPath: process.env.RECALLANT_PROJECT_PATH
  });
}

function cliAuditCodeFromError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("VALIDATION_ERROR:")) return "VALIDATION_ERROR";
  if (message.startsWith("POLICY_BLOCKED:")) return "POLICY_BLOCKED";
  if (message.startsWith("RATE_LIMITED:")) return "RATE_LIMITED";
  return "CLI_ERROR";
}

function safeCliErrorMessage(error: unknown) {
  return String(redactSystemActivityValue(error instanceof Error ? error.message : String(error)));
}

function hashForAudit(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function summarizeCliArg(value: string) {
  if (/^(\/|~\/|[a-z]:\\)/i.test(value)) {
    return { type: "path", hash: hashForAudit(resolve(value)) };
  }
  return redactSystemActivityValue(value);
}

function summarizeCliArgs(argv: readonly string[]) {
  const command = argv[2] ?? "unknown";
  const args = argv.slice(3).map((arg) => summarizeCliArg(arg));
  const project = parseFlag(argv, "--project-dir") ?? parseProjectArg(argv) ?? null;
  return {
    command,
    arg_count: Math.max(0, argv.length - 3),
    args,
    flags: argv
      .slice(3)
      .filter((arg) => arg.startsWith("--"))
      .sort(),
    project_dir_hash: hashForAudit(project ? resolve(project) : null),
    project_dir_basename: project ? resolve(project).split("/").filter(Boolean).at(-1) : null,
    dry_run: argv.includes("--dry-run"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    confirm_token_present: Boolean(parseFlag(argv, "--confirm-token")),
    dedup_key_present: Boolean(parseFlag(argv, "--dedup-key"))
  };
}

function cliOutcomeKind(argv: readonly string[], exitCode: number, error?: unknown) {
  if (error) return "thrown_error";
  if (exitCode !== 0) return "blocked_or_failed";
  if (argv.includes("--dry-run")) return "dry_run";
  if (parseFlag(argv, "--confirm-token")) return "confirmed_write";
  if (parseFlag(argv, "--dedup-key")) return "idempotent_keyed";
  return "completed";
}

function currentCliExitCode(error?: unknown) {
  if (typeof process.exitCode === "number") return process.exitCode;
  if (typeof process.exitCode === "string") {
    const parsed = Number.parseInt(process.exitCode, 10);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return error ? 1 : 0;
}

async function appendCliAuditSpool(
  argv: readonly string[],
  payload: Record<string, unknown>
): Promise<CliAuditStatus> {
  const record = {
    local_id: randomUUID(),
    created_at: new Date().toISOString(),
    record_kind: "cli_audit",
    payload: redactSystemActivityValue(payload)
  };
  await mkdir(spoolDir(argv), { recursive: true });
  await appendFile(auditSpoolPath(argv), `${JSON.stringify(record)}\n`);
  return {
    durable: false,
    surface: "cli",
    operation: String(payload.operation ?? argv[2] ?? "unknown"),
    status: "pending_durable_audit",
    spool_path: auditSpoolPath(argv),
    local_id: record.local_id
  };
}

async function startCliAudit(argv: readonly string[]): Promise<CliAuditContext | null> {
  const command = argv[2];
  if (!shouldAuditCliCommand(command)) return null;
  const operation = command ?? "unknown";
  const database = createCliAuditDb();
  if (!database) {
    return {
      command: operation,
      database: null,
      activityId: null,
      traceId: null,
      startStatus: {
        durable: false,
        surface: "cli",
        operation,
        status: "pending_durable_audit",
        reason: "Recallant storage is not configured for this CLI process."
      }
    };
  }
  try {
    const activity = await database.startSystemActivity({
      surface: "cli",
      operation,
      actor_kind: "user",
      actor_id: "recallant-cli",
      client_kind: "recallant-cli",
      client_version: recallantCliVersion,
      related_ids: {
        project_id: process.env.RECALLANT_PROJECT_ID ?? null,
        session_id: parseFlag(argv, "--session-id") ?? null
      },
      metadata: {
        env_source: envLoadState.source,
        env_status: envLoadState.status,
        argv: summarizeCliArgs(argv)
      }
    });
    return {
      command: operation,
      database,
      activityId: activity.id,
      traceId: activity.trace_id,
      startStatus: {
        durable: true,
        surface: "cli",
        operation,
        status: "recorded",
        activity_id: activity.id,
        trace_id: activity.trace_id
      }
    };
  } catch (error) {
    await database.close().catch(() => undefined);
    return {
      command: operation,
      database: null,
      activityId: null,
      traceId: null,
      startStatus: {
        durable: false,
        surface: "cli",
        operation,
        status: "failed",
        error_code: cliAuditCodeFromError(error),
        reason: safeCliErrorMessage(error)
      }
    };
  }
}

async function finishCliAudit(
  argv: readonly string[],
  audit: CliAuditContext | null,
  error?: unknown
) {
  if (!audit) return null;
  const exitCode = currentCliExitCode(error);
  const status = error ? "error" : exitCode === 0 ? "success" : "skipped";
  const metadata = {
    exit_code: exitCode,
    outcome_kind: cliOutcomeKind(argv, exitCode, error),
    argv: summarizeCliArgs(argv)
  };
  if (!audit.database || !audit.activityId) {
    return appendCliAuditSpool(argv, {
      surface: "cli",
      operation: audit.command,
      status,
      error_code: error
        ? cliAuditCodeFromError(error)
        : exitCode === 0
          ? null
          : `CLI_EXIT_${exitCode}`,
      error_message: error ? safeCliErrorMessage(error) : null,
      durable_status: audit.startStatus,
      metadata
    });
  }
  try {
    const finished = await audit.database.finishSystemActivity({
      id: audit.activityId,
      status,
      error_code: error
        ? cliAuditCodeFromError(error)
        : exitCode === 0
          ? null
          : `CLI_EXIT_${exitCode}`,
      error_message: error ? safeCliErrorMessage(error) : null,
      metadata
    });
    return {
      durable: true,
      surface: "cli" as const,
      operation: audit.command,
      status: "recorded" as const,
      activity_id: finished?.id ?? audit.activityId,
      trace_id: finished?.trace_id ?? audit.traceId ?? undefined
    };
  } catch (finishError) {
    return appendCliAuditSpool(argv, {
      surface: "cli",
      operation: audit.command,
      status,
      durable_status: {
        ...audit.startStatus,
        status: "failed",
        error_code: cliAuditCodeFromError(finishError),
        reason: safeCliErrorMessage(finishError)
      },
      metadata
    });
  } finally {
    await audit.database.close().catch(() => undefined);
  }
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

const captureTargetNames = [
  "session_start",
  "user_prompt",
  "tool_result",
  "generic_event",
  "pre_compaction_checkpoint",
  "checkpoint",
  "stop_closeout"
] as const;

async function hookKitReadiness(projectDir: string) {
  const files = localHookKitFiles();
  const checked = [];
  for (const file of files) {
    const filePath = join(projectDir, file.path);
    const fileStat = await stat(filePath).catch(() => null);
    const present = fileStat !== null;
    const executableExpected = file.executable === true;
    const executable = !executableExpected || Boolean(fileStat && (fileStat.mode & 0o111) !== 0);
    checked.push({
      path: file.path,
      present,
      executable_expected: executableExpected,
      executable
    });
  }
  const presentCount = checked.filter((file) => file.present).length;
  const allFilesPresent = presentCount === files.length;
  const executableReady = checked.every((file) => file.executable);
  const manifestPath = ".recallant/hooks/manifest.json";
  const manifestContent = await readOptional(join(projectDir, manifestPath));
  let manifest = {
    path: manifestPath,
    status: "missing",
    valid: false,
    fail_soft: false,
    writes_global_config: true,
    ready_proof: ""
  };
  if (manifestContent) {
    try {
      const parsed = JSON.parse(manifestContent) as Record<string, unknown>;
      const targets = objectValue(parsed.targets);
      const valid =
        parsed.fail_soft === true &&
        parsed.writes_global_config === false &&
        typeof parsed.ready_proof === "string" &&
        parsed.ready_proof.includes("--require-capture") &&
        captureTargetNames.every((target) => objectValue(targets[target]).script);
      manifest = {
        path: manifestPath,
        status: valid ? "valid" : "invalid",
        valid,
        fail_soft: parsed.fail_soft === true,
        writes_global_config: parsed.writes_global_config === true,
        ready_proof: typeof parsed.ready_proof === "string" ? parsed.ready_proof : ""
      };
    } catch {
      manifest = { ...manifest, status: "invalid_json" };
    }
  }
  const ready = allFilesPresent && executableReady && manifest.valid;
  const status = ready
    ? "installed"
    : presentCount === 0
      ? "not_installed"
      : allFilesPresent && !executableReady
        ? "invalid_permissions"
        : allFilesPresent && !manifest.valid
          ? "invalid_manifest"
          : "partial";
  return {
    status,
    ready,
    installed_count: presentCount,
    expected_count: files.length,
    capture_targets: captureTargetNames,
    manifest,
    files: checked
  };
}

async function clientConnectionReadiness(projectDir: string) {
  const candidates = [
    { client: "codex", path: ".codex/config.toml", legacy_reference_only: false },
    { client: "codex", path: ".recallant/codex-mcp.json", legacy_reference_only: true },
    { client: "cursor", path: ".cursor/mcp.json", legacy_reference_only: false },
    { client: "claude_code", path: ".mcp.json", legacy_reference_only: false },
    { client: "generic", path: ".recallant/generic-mcp.json", legacy_reference_only: false }
  ];
  const configs = [];
  for (const candidate of candidates) {
    const content = await readOptional(join(projectDir, candidate.path));
    const present = content !== null;
    const configured =
      present &&
      !candidate.legacy_reference_only &&
      (candidate.client === "codex" ? codexConfigHasRecallantMcp(content) : true);
    configs.push({
      ...candidate,
      present,
      configured,
      note: candidate.legacy_reference_only
        ? "Legacy generated reference only; Codex does not auto-load this path."
        : candidate.client === "codex"
          ? "Codex project config is ready only when it contains [mcp_servers.recallant]."
          : null
    });
  }
  const mcpConfigured = configs.some((config) => config.configured);
  const hookKit = await hookKitReadiness(projectDir);
  const nativeHooks = [
    {
      client: "codex",
      status: "local_hook_kit_supported",
      ready: hookKit.ready,
      install_command: `recallant connect codex --project-dir ${projectDir} --install-local-hooks`,
      note: "Codex currently uses the Recallant project-local fail-soft hook kit. Native global hook wiring is not written automatically."
    },
    {
      client: "cursor",
      status: "unsupported_native_hooks",
      ready: false,
      install_command: null,
      note: "Cursor MCP config is supported, but native hook capture is not installed by Recallant yet."
    },
    {
      client: "claude_code",
      status: "manual_or_unsupported_native_hooks",
      ready: false,
      install_command: null,
      note: "Claude Code project MCP config is supported; native hook capture still needs a later dedicated installer."
    },
    {
      client: "generic",
      status: "unsupported_native_hooks",
      ready: false,
      install_command: null,
      note: "Generic MCP clients can use MCP config plus the local hook kit manually if the client supports external hooks."
    }
  ];
  return {
    status:
      mcpConfigured && hookKit.ready
        ? "mcp_and_hooks_ready"
        : mcpConfigured
          ? "mcp_only"
          : hookKit.ready
            ? "hooks_without_mcp"
            : "not_configured",
    mcp_configured: mcpConfigured,
    mcp_configs: configs,
    hook_kit: hookKit,
    native_hooks: nativeHooks,
    hook_installation_status: hookKit.ready
      ? "local_hook_kit_ready"
      : hookKit.status === "not_installed"
        ? "mcp_only_or_manual_hooks"
        : hookKit.status,
    fail_soft: true,
    writes_global_config: false,
    proof_command: `recallant doctor --project-dir ${projectDir} --require-capture`,
    note: "Client must be configured to call the MCP server and hook scripts; capture-active is proven by context read + memory write + checkpoint."
  };
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function runLocalCliSubcommand(args: readonly string[], parseJson = true) {
  const entrypoint = process.argv[1];
  if (!entrypoint) throw new Error("Internal error: CLI entrypoint path is not available.");
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  let json: Record<string, unknown> | null = null;
  if (parseJson && stdout.trim()) {
    try {
      json = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  return {
    status: result.status ?? 0,
    stdout,
    stderr,
    json
  };
}

function summarizeSubcommandFailure(result: ReturnType<typeof runLocalCliSubcommand>) {
  const combined = `${result.stderr}\n${result.stdout}`;
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("at ") &&
        !line.startsWith("Node.js ") &&
        !line.startsWith("(") &&
        !line.includes("node:internal/")
    );
  const candidate =
    lines.find((line) =>
      /^(error:|Error:|VALIDATION_ERROR|POLICY_BLOCKED|REMOTE_|Failed\b)/i.test(line)
    ) ??
    lines.at(-1) ??
    `exit status ${result.status}`;
  const redacted = String(redactSystemActivityValue(candidate));
  return redacted.length > 320 ? `${redacted.slice(0, 317)}...` : redacted;
}

function formatCommandHint(input: readonly string[]) {
  return input.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ");
}

function formatOnboardRerunCommand(options: OnboardOptions, targetClient: string) {
  const args = ["recallant", "onboard", options.projectDir];
  if (!options.client) args.push("--no-client");
  if (options.client && targetClient !== "codex") args.push("--client", targetClient);
  if (options.client && !options.installLocalHooks) args.push("--no-local-hooks");
  if (!options.verify) args.push("--no-verify");
  if (options.yes) args.push("--yes");
  if (options.dryRun) args.push("--dry-run");
  if (options.cancel) args.push("--cancel");
  if (options.initGit) args.push("--init-git");
  if (options.skipVcsSafety) args.push("--skip-vcs-safety");
  return formatCommandHint(args);
}

function gitSafetyChoices(): OnboardVersionControlStep["choices"] {
  return [
    {
      id: "initialize_git",
      label: "Initialize Git here",
      description:
        "Run git init before onboarding writes files. Recallant will not stage or commit project files."
    },
    {
      id: "continue_without_git",
      label: "Continue without Git",
      description:
        "Use Recallant local backups only. This is allowed, but rollback safety is weaker."
    },
    {
      id: "install_git",
      label: "Install Git first",
      description: "Install Git with your operating system package manager, then rerun onboarding."
    }
  ];
}

function unavailableGitStep(): OnboardVersionControlStep {
  return {
    status: "git_missing",
    git_available: false,
    repository_ready: false,
    initialized: false,
    writes_files: false,
    message:
      "Git is not available in this environment. Install Git first or continue with Recallant local backups only.",
    refusal_available: true,
    choices: gitSafetyChoices(),
    warnings: [
      "Recallant does not install system packages automatically.",
      "No project files were changed by the version-control preflight."
    ]
  };
}

function runGit(projectDir: string, args: readonly string[]) {
  return spawnSync("git", ["-C", projectDir, ...args], {
    cwd: projectDir,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function canPromptForOnboarding(options: OnboardOptions) {
  return options.format === "text" && process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function promptYesNo(question: string, defaultAnswer: boolean) {
  const suffix = defaultAnswer ? " [Y/n] " : " [y/N] ";
  process.stdout.write(`${question}${suffix}`);
  return await new Promise<boolean>((resolvePrompt) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once("data", (chunk) => {
      if (wasRaw) process.stdin.setRawMode?.(true);
      process.stdin.pause();
      const answer = String(chunk).trim().toLowerCase();
      if (!answer) {
        resolvePrompt(defaultAnswer);
        return;
      }
      resolvePrompt(answer === "y" || answer === "yes");
    });
  });
}

function initializedGitStep(projectDir: string, choices: OnboardVersionControlStep["choices"]) {
  const initialized = runGit(projectDir, ["init"]);
  if (initialized.status !== 0) {
    return {
      status: "failed" as const,
      git_available: true,
      repository_ready: false,
      initialized: false,
      writes_files: false,
      message: "Recallant tried to initialize Git before onboarding, but git init failed.",
      refusal_available: true as const,
      choices,
      warnings: [initialized.stderr.trim() || "git init failed without stderr output."]
    };
  }
  return {
    status: "initialized" as const,
    git_available: true,
    repository_ready: true,
    initialized: true,
    writes_files: true,
    message:
      "Recallant initialized Git before onboarding. No files were staged or committed automatically.",
    refusal_available: true as const,
    choices,
    warnings: [
      "Git was initialized for rollback visibility, but Recallant did not stage secrets, data, or project files."
    ]
  };
}

async function resolveOnboardVersionControl(
  options: OnboardOptions
): Promise<OnboardVersionControlStep> {
  const choices = gitSafetyChoices();
  const version = spawnSync("git", ["--version"], {
    cwd: options.projectDir,
    env: { ...process.env },
    encoding: "utf8"
  });
  if (version.error || version.status !== 0) {
    if (options.skipVcsSafety) {
      return {
        ...unavailableGitStep(),
        status: "skipped",
        message:
          "Git is not available; onboarding will continue with Recallant local backups only.",
        warnings: ["Version-control safety was explicitly skipped."]
      };
    }
    if (canPromptForOnboarding(options)) {
      const continueWithoutGit = await promptYesNo(
        "Git is not available. Continue with Recallant local backups only?",
        false
      );
      if (continueWithoutGit) {
        return {
          ...unavailableGitStep(),
          status: "skipped",
          message:
            "Git is not available; onboarding will continue with Recallant local backups only.",
          warnings: ["Version-control safety was declined by the user."]
        };
      }
    }
    return unavailableGitStep();
  }

  const ready = runGit(options.projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (ready.status === 0 && ready.stdout.trim() === "true") {
    return {
      status: "ready",
      git_available: true,
      repository_ready: true,
      initialized: false,
      writes_files: false,
      message: "Project already has a usable Git work tree.",
      refusal_available: true,
      choices,
      warnings: []
    };
  }

  if (options.skipVcsSafety) {
    return {
      status: "skipped",
      git_available: true,
      repository_ready: false,
      initialized: false,
      writes_files: false,
      message:
        "No usable Git work tree was found; onboarding will continue with local backups only.",
      refusal_available: true,
      choices,
      warnings: ["Version-control safety was explicitly skipped."]
    };
  }

  if (options.dryRun) {
    return {
      status: "dry_run_planned",
      git_available: true,
      repository_ready: false,
      initialized: false,
      writes_files: false,
      message: "No usable Git work tree was found. Dry-run would offer to initialize Git.",
      refusal_available: true,
      choices,
      warnings: ["Dry-run did not run git init."]
    };
  }

  if (options.yes || options.initGit) {
    const initialized = initializedGitStep(options.projectDir, choices);
    if (initialized.status === "failed") {
      return {
        ...initialized
      };
    }
    return initialized;
  }

  if (canPromptForOnboarding(options)) {
    const initialize = await promptYesNo(
      "No usable Git work tree was found. Initialize Git before onboarding?",
      true
    );
    if (initialize) return initializedGitStep(options.projectDir, choices);
    const continueWithoutGit = await promptYesNo(
      "Continue without Git using Recallant local backups only?",
      false
    );
    if (continueWithoutGit) {
      return {
        status: "skipped",
        git_available: true,
        repository_ready: false,
        initialized: false,
        writes_files: false,
        message:
          "No usable Git work tree was found; onboarding will continue with local backups only.",
        refusal_available: true,
        choices,
        warnings: ["Version-control safety was declined by the user."]
      };
    }
  }

  return {
    status: "needs_choice",
    git_available: true,
    repository_ready: false,
    initialized: false,
    writes_files: false,
    message:
      "No usable Git work tree was found. Choose whether Recallant should initialize Git before changing project files.",
    refusal_available: true,
    choices,
    warnings: ["No project files were changed by the version-control preflight."]
  };
}

function offlineSpoolFallback() {
  return {
    available: true as const,
    role: "fail_soft_capture_fallback" as const,
    complete_onboarding: false as const
  };
}

function storageSetupChoices(): OnboardStorageStep["setup_choices"] {
  return [
    {
      id: "single_user_storage",
      label: "Set up local single-user storage",
      description:
        "Create a private local Recallant storage profile for this user, then continue onboarding."
    },
    {
      id: "existing_private_profile",
      label: "Use an existing private profile",
      description:
        "Load a private environment profile that points Recallant at an existing database."
    },
    {
      id: "stop_without_changes",
      label: "Stop without changing the project",
      description: "Leave project files untouched until storage is ready."
    }
  ];
}

function recallantHomeDir() {
  return resolve(process.env.RECALLANT_HOME ?? process.cwd());
}

async function singleUserStorageInstallerPath() {
  const candidate = join(recallantHomeDir(), "scripts", "install-recallant.sh");
  try {
    const file = await stat(candidate);
    return file.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function runSingleUserStorageInstaller(installerPath: string) {
  return spawnSync("bash", [installerPath, "--profile", "single-user"], {
    cwd: recallantHomeDir(),
    env: { ...process.env },
    stdio: "inherit"
  });
}

function blockedStorageStep(input: {
  status: "missing" | "unreachable" | "storage_blocked";
  configured: boolean;
  setupMode: "guided" | "non_interactive";
  message: string;
}): OnboardStorageStep {
  return {
    status: input.status,
    configured: input.configured,
    reachable: false,
    env_file_loaded: envLoadState.env_file_loaded,
    env_source: envLoadState.source,
    setup_mode: input.setupMode,
    message: input.message,
    error_code: "storage_blocked",
    offline_spool: offlineSpoolFallback(),
    setup_choices: storageSetupChoices()
  };
}

async function readyStorageStep(): Promise<OnboardStorageStep | null> {
  if (!envValueIsSet(process.env.RECALLANT_DATABASE_URL)) return null;
  const client = new pg.Client({ connectionString: process.env.RECALLANT_DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return {
      status: "ready",
      configured: true,
      reachable: true,
      env_file_loaded: envLoadState.env_file_loaded,
      env_source: envLoadState.source,
      setup_mode: "not_needed",
      message: envLoadState.env_file_loaded
        ? "Recallant storage is ready from the loaded private environment profile."
        : "Recallant storage is ready from the current environment.",
      error_code: null,
      offline_spool: offlineSpoolFallback(),
      setup_choices: []
    };
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function maybeRunInteractiveStorageSetup(options: OnboardOptions) {
  if (options.dryRun || options.yes || !canPromptForOnboarding(options)) return null;
  if (envValueIsSet(process.env.RECALLANT_ENV_FILE)) return null;
  const installerPath = await singleUserStorageInstallerPath();
  if (!installerPath) return null;
  const setupStorage = await promptYesNo(
    "Recallant storage is not configured. Set up local single-user storage now?",
    true
  );
  if (!setupStorage) return null;
  const result = runSingleUserStorageInstaller(installerPath);
  if (result.error || result.status !== 0) {
    return blockedStorageStep({
      status: "storage_blocked",
      configured: false,
      setupMode: "guided",
      message:
        "Recallant tried to set up local single-user storage, but the installer did not complete. No project files were changed."
    });
  }
  await loadDefaultEnv();
  const ready = await readyStorageStep();
  if (ready) return ready;
  return blockedStorageStep({
    status: "storage_blocked",
    configured: envValueIsSet(process.env.RECALLANT_DATABASE_URL),
    setupMode: "guided",
    message:
      "Recallant set up local single-user storage, but the database is not reachable yet. No project files were changed."
  });
}

async function resolveOnboardStorage(options: OnboardOptions): Promise<OnboardStorageStep> {
  const configured = envValueIsSet(process.env.RECALLANT_DATABASE_URL);
  const setupMode = options.yes ? "non_interactive" : "guided";
  if (!configured) {
    const interactiveSetup = await maybeRunInteractiveStorageSetup(options);
    if (interactiveSetup) return interactiveSetup;
    return blockedStorageStep({
      status: options.yes ? "storage_blocked" : "missing",
      configured: false,
      setupMode,
      message: options.yes
        ? "Recallant needs private storage before onboarding can finish. Automatic setup was requested, but no reachable storage profile is available in this runtime. No project files were changed."
        : "Recallant needs private storage before onboarding can finish. Choose a setup path, then rerun onboarding; no project files were changed."
    });
  }

  const ready = await readyStorageStep();
  if (ready) return ready;
  return blockedStorageStep({
    status: "unreachable",
    configured: true,
    setupMode,
    message:
      "Recallant found a private storage profile, but the database is not reachable. No project files were changed."
  });
}

function safeAttachDetailsForOnboard(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  const ownerReport = objectValue(payload.owner_report);
  return {
    status: payload.status ?? null,
    requested_mode: payload.requested_mode ?? null,
    effective_mode: payload.effective_mode ?? null,
    dry_run: Boolean(payload.dry_run),
    writes_files: payload.writes_files === true,
    writes_database: payload.writes_database === true,
    production_sensitive: payload.production_sensitive ?? null,
    planned_changes: Array.isArray(payload.planned_changes) ? payload.planned_changes : [],
    documentation_posture: (payload.documentation_posture ?? null) as DocumentationPosture | null,
    starter_docs: payload.starter_docs ?? null,
    discovery_summary: payload.discovery_summary ?? null,
    migration_summary: ownerReport.migration_summary ?? null,
    secret_findings: payload.secret_findings ?? null,
    backup: payload.backup ?? null,
    owner_report: {
      ready_status: ownerReport.ready_status ?? null,
      what_was_done: ownerReport.what_was_done ?? null,
      what_needs_attention: ownerReport.what_needs_attention ?? null,
      how_to_check: ownerReport.how_to_check ?? null
    }
  };
}

function attachDetailObject(value: unknown) {
  return objectValue(value);
}

function attachRiskSignals(attachDetails: unknown) {
  const production = attachDetailObject(attachDetailObject(attachDetails).production_sensitive);
  const signals = production.signals;
  return Array.isArray(signals) ? signals.map(String) : [];
}

function plannedWritePaths(attachDetails: unknown) {
  const changes = attachDetailObject(attachDetails).planned_changes;
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((change) => String(objectValue(change).action ?? "").includes("write_file"))
    .map((change) => objectValue(change).path)
    .filter((path): path is string => typeof path === "string" && path.trim() !== "");
}

function migrationSummaryObject(attachDetails: unknown) {
  return attachDetailObject(attachDetailObject(attachDetails).migration_summary);
}

function documentationPostureFromOnboard(result: {
  documentation_posture?: DocumentationPosture | null;
  attach_details?: ReturnType<typeof safeAttachDetailsForOnboard> | null;
}) {
  return (
    result.documentation_posture ??
    (attachDetailObject(result.attach_details).documentation_posture as DocumentationPosture | null)
  );
}

function documentationPostureHumanLines(posture: DocumentationPosture | null | undefined) {
  if (!posture) return [];
  const summary = summarizeDocumentationPostureForOnboard(posture);
  return [
    `Documentation posture: ${summary.status}`,
    `Found: ${summary.found}.`,
    `Workbench: ${summary.workbench}.`
  ];
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

function doctorOwnerSummary(input: {
  projectDir: string;
  postgres: { configured: boolean; reachable: boolean };
  captureReadiness: Awaited<ReturnType<typeof checkCaptureReadiness>>;
  clientConnection: Awaited<ReturnType<typeof clientConnectionReadiness>>;
  requireCapture: boolean;
}) {
  const attached = Boolean(input.captureReadiness.project_config.present);
  const captureReady = input.captureReadiness.ready === true;
  const hookKit = objectValue(input.clientConnection.hook_kit);
  const configured =
    attached &&
    (input.clientConnection.mcp_configured === true ||
      hookKit.ready === true ||
      input.clientConnection.status === "mcp_and_hooks_ready");
  const hookCaptureReady = hookKit.ready === true;
  const clientConfigured = input.clientConnection.mcp_configured === true;
  const connectionStatus =
    typeof input.clientConnection.status === "string"
      ? input.clientConnection.status
      : "not_configured";
  const status = captureReady
    ? "recording"
    : attached
      ? configured
        ? "configured_not_recording"
        : "not_configured"
      : "not_attached";
  const headline = captureReady
    ? "Recallant capture is active for this project."
    : status === "configured_not_recording"
      ? "Recallant is configured, but active capture is not proven yet."
      : status === "not_configured"
        ? "Project is attached, but the agent client is not fully connected yet."
        : "Project is not attached to Recallant yet.";
  const nextStep = captureReady
    ? "No startup-layer action is required. Continue normal work and close out the session when done."
    : !attached
      ? `Run recallant attach ${input.projectDir} --sandbox --dry-run first.`
      : input.clientConnection.status !== "mcp_and_hooks_ready"
        ? `Run recallant connect codex --project-dir ${input.projectDir} --install-local-hooks --dry-run, then install after review.`
        : "Start an agent session through Recallant, read context, write memory, and checkpoint; then rerun doctor --require-capture.";
  return {
    status,
    headline,
    project_attached: attached,
    client_configured: clientConfigured,
    hook_capture_ready: hookCaptureReady,
    connection_status: connectionStatus,
    configured,
    actually_recording: captureReady,
    require_capture_gate: input.requireCapture,
    next_step: nextStep,
    proof:
      "Recording means Recallant has observed context read, memory write, and checkpoint evidence.",
    postgres_ready: input.postgres.reachable
  };
}

function okNo(value: boolean) {
  return value ? "yes" : "no";
}

function doctorHumanReport(result: {
  owner_summary: ReturnType<typeof doctorOwnerSummary>;
  postgres: { configured: boolean; reachable: boolean };
  project_config: { path: string; present: boolean };
  capture_readiness: Awaited<ReturnType<typeof checkCaptureReadiness>> & { required: boolean };
  client_connection: Awaited<ReturnType<typeof clientConnectionReadiness>>;
  local_spool_status: Awaited<ReturnType<typeof getLocalSpoolStatus>>;
  local_model: Awaited<ReturnType<typeof checkOllama>>;
  service_env_profile: Awaited<ReturnType<typeof checkServiceEnvProfile>>;
  pending_embeddings: Awaited<ReturnType<typeof checkPendingEmbeddingStatus>>;
}) {
  const summary = result.owner_summary;
  const localModelReady = result.local_model.reachable === true;
  const localModelStatus = localModelReady
    ? "available"
    : result.local_model.error
      ? `not available (${result.local_model.error})`
      : "not available";
  const databaseStatus = result.postgres.reachable
    ? "available"
    : result.postgres.configured
      ? "configured but not reachable"
      : "not configured";
  const captureConfigured =
    summary.configured ||
    summary.client_configured ||
    summary.hook_capture_ready ||
    summary.actually_recording;
  const spool = result.local_spool_status;
  const pendingEmbeddingCount = finiteNumberValue(result.pending_embeddings.pending_chunks);
  const semanticIndexingStatus =
    pendingEmbeddingCount === null
      ? "unknown"
      : pendingEmbeddingCount > 0
        ? `catching up (${pendingEmbeddingCount} pending); capture/recall remain available`
        : "current";
  const lines = [
    "Recallant doctor",
    "",
    `Status: ${summary.headline}`,
    "",
    "Checks:",
    `- Recallant CLI: installed`,
    `- Database: ${databaseStatus}`,
    `- Local model: ${localModelStatus}`,
    `- Pending embeddings: ${result.pending_embeddings.pending_chunks ?? "unknown"}`,
    `- Semantic indexing: ${semanticIndexingStatus}`,
    `- Service env profile: ${result.service_env_profile.status}`,
    `- Current project: ${summary.project_attached ? "attached" : "not attached"}`,
    `- Agent capture configured: ${okNo(captureConfigured)}`,
    `- Agent capture active: ${okNo(summary.actually_recording)}`,
    `- Local spool: ${spool.status}, ${spool.unsynced_count} pending`,
    "",
    `Next command: ${summary.next_step}`,
    "",
    "Details:",
    `- Project config: ${result.project_config.present ? result.project_config.path : "not found"}`,
    `- Client connection: ${summary.connection_status}`,
    `- Capture status: ${result.capture_readiness.status}`,
    `- Embedding recovery: ${result.pending_embeddings.recommendation}`,
    `- Spool path: ${spool.spool_path}`,
    `- Spool replay dry-run: ${spool.replay_command}`,
    `- JSON output: recallant doctor --format json`
  ];
  return `${lines.join("\n")}\n`;
}

function onboardHumanReport(result: {
  status?: string;
  project_dir: string;
  storage: OnboardStorageStep;
  version_control?: OnboardVersionControlStep | null;
  documentation_posture?: DocumentationPosture | null;
  project_already_attached: boolean;
  attach_details?: ReturnType<typeof safeAttachDetailsForOnboard> | null;
  embedding_recovery?: OnboardEmbeddingRecoveryPayload | null;
  workbench?: OnboardWorkbenchOutcome | null;
  attached: {
    status: OnboardAttachedStep["status"];
    command: string | null;
    details?: string | null;
  };
  connected: {
    status: OnboardConnectedStep["status"];
    command: string | null;
    details?: string | null;
  };
  verify: OnboardVerifyPayload | null;
  next_command: string;
}) {
  const lines = [
    "Recallant onboard",
    "",
    result.status ? `Status: ${result.status}` : null,
    `Project: ${result.project_dir}`,
    `Storage: ${result.storage.status}`,
    `  - ${result.storage.message}`,
    `  - Offline spool: fail-soft capture fallback, not completed onboarding`
  ].filter((line) => line !== null) as string[];
  if (result.version_control) {
    lines.push(
      `Version control: ${result.version_control.status}`,
      `  - ${result.version_control.message}`
    );
    for (const warning of result.version_control.warnings) lines.push(`  - ${warning}`);
  }
  lines.push(...documentationPostureHumanLines(documentationPostureFromOnboard(result)));
  lines.push(
    `Project already attached: ${result.project_already_attached ? "yes" : "no"}`,
    `Attach: ${result.attached.status}`
  );
  if (result.attached.details) lines.push(`  - ${result.attached.details}`);
  lines.push(`Connect: ${result.connected.status}`);
  if (result.connected.details) lines.push(`  - ${result.connected.details}`);
  if (result.attach_details && result.attached.status === "needs_confirmation") {
    const signals = attachRiskSignals(result.attach_details);
    const writePaths = plannedWritePaths(result.attach_details);
    const migrationSummary = migrationSummaryObject(result.attach_details);
    lines.push(
      "",
      "Production-sensitive onboarding review",
      `Project path: ${result.project_dir}`,
      "Risk reason:",
      ...(signals.length
        ? signals.map((signal) => `  - ${signal}`)
        : ["  - project requested review"]),
      "Planned writes:",
      ...(writePaths.length ? writePaths.map((path) => `  - ${path}`) : ["  - none"]),
      "Backup behavior:",
      "  - Existing agent files are backed up locally before overwrite; backup copies are redacted when needed.",
      "Import/review behavior:",
      `  - Selected imports: ${String(migrationSummary.selected_imports ?? 0)}`,
      `  - Review needed: ${String(migrationSummary.review_needed ?? 0)}`,
      `  - Raw secret findings: ${String(migrationSummary.raw_secret_findings ?? 0)}`,
      "Continue/cancel prompt:",
      "  - In an interactive terminal, answer the next question. In automation, use --yes only after approving this plan."
    );
  }
  if (result.verify) {
    lines.push(`Verify: ${result.verify.status}`);
    if (result.verify.status === "passed") {
      lines.push(
        "Capture active: yes — context read, memory write, checkpoint, and recall proof are present."
      );
    }
    if (result.verify.status === "failed") {
      lines.push(
        `Onboarding incomplete: proof failed at ${result.verify.failed_stage ?? "unknown"} stage.`
      );
      if (result.verify.message) lines.push(`Proof issue: ${result.verify.message}`);
    }
    if (result.verify.ask_answer) {
      lines.push(`Proof memory: ${result.verify.ask_answer}`);
    }
    lines.push(
      `Proof stages: capture=${result.verify.stages.capture.status}, readiness=${result.verify.stages.readiness.status}, recall=${result.verify.stages.recall.status}`
    );
  } else {
    lines.push("Verify: skipped");
  }
  if (result.embedding_recovery) {
    const recovery = result.embedding_recovery;
    const summary =
      recovery.status === "no_pending"
        ? "current"
        : recovery.status === "recovered"
          ? `recovered ${recovery.recovered_chunks} pending chunk(s)`
          : recovery.status === "model_unavailable"
            ? `${recovery.remaining_pending ?? "some"} pending chunk(s); local model unavailable`
            : recovery.status === "still_pending"
              ? `${recovery.remaining_pending ?? "some"} pending chunk(s); retry remains bounded`
              : recovery.status;
    lines.push(`Embedding recovery: ${summary}`);
    if (
      recovery.status === "model_unavailable" ||
      recovery.status === "still_pending" ||
      recovery.status === "unknown"
    ) {
      lines.push(`  - ${recovery.recommendation}`);
    }
  }
  if (result.workbench) {
    lines.push(
      result.workbench.available && result.workbench.url
        ? `Workbench: ${result.workbench.url} (${result.workbench.auth_required ? "auth required" : "private access depends on deployment profile"})`
        : `Workbench: ${result.workbench.message}`
    );
    if (result.workbench.available) {
      lines.push(
        `Workbench project visible: ${result.workbench.project_visible ? "yes" : "no"}`,
        `Workbench review queue: ${String(result.workbench.migration_review_queue.pending_review ?? 0)} pending review item(s)`
      );
    }
  }
  if (result.storage.error_code === "storage_blocked") {
    lines.push("", "Setup choices:");
    for (const choice of result.storage.setup_choices) {
      lines.push(`- ${choice.label}: ${choice.description}`);
    }
    lines.push(
      "",
      "Next action: Prepare private Recallant storage, then rerun this same onboarding command.",
      `Rerun command: ${result.next_command}`
    );
  } else if (
    result.version_control &&
    ["needs_choice", "git_missing", "failed"].includes(result.version_control.status)
  ) {
    lines.push("", "Version-control safety choices:");
    for (const choice of result.version_control.choices) {
      lines.push(`- ${choice.label}: ${choice.description}`);
    }
    lines.push(
      "",
      "Next action: initialize Git before onboarding, or explicitly continue with Recallant local backups only.",
      `Initialize Git: ${result.next_command} --init-git`,
      `Continue without Git: ${result.next_command} --skip-vcs-safety`
    );
  } else {
    lines.push("", `Next command: ${result.next_command}`);
    lines.push("", `JSON output: recallant onboard ${result.project_dir} --format json`);
  }
  return `${lines.join("\n")}\n`;
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
  const targetConfig = clientTargetConfig(
    options.target,
    projectId,
    developerId,
    options.projectDir
  );
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
  await mkdir(
    join(options.projectDir, targetConfig.config_file).split("/").slice(0, -1).join("/"),
    {
      recursive: true
    }
  );
  await writeFile(
    join(options.projectDir, targetConfig.config_file),
    renderClientTargetConfig(
      await readOptional(join(options.projectDir, targetConfig.config_file)),
      targetConfig
    )
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

async function checkPendingEmbeddingStatus(
  database: ReturnType<typeof createRecallantDbFromEnv>,
  projectDir: string
) {
  if (!database) {
    return {
      status: "unavailable",
      pending_chunks: null,
      recovery_available: false,
      recommendation: "Configure Recallant storage before checking embedding recovery."
    };
  }
  try {
    const status = await database.pendingEmbeddingStatus({ project_path: projectDir });
    return {
      status: "ok",
      ...status
    };
  } catch (error) {
    return {
      status: "unknown",
      pending_chunks: null,
      recovery_available: false,
      recommendation: "Run recallant doctor again after storage is reachable.",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkDeploymentProfile(env: ProductionReadinessEnvValues = process.env) {
  const plannedPort = Number(productionEnvValue(env, "RECALLANT_PORT") ?? "3005");
  const inventoryFile =
    productionEnvValue(env, "RECALLANT_SERVER_INVENTORY_FILE") ??
    productionEnvValue(env, "RECALLANT_PORTS_FILE") ??
    null;
  const securityPath =
    productionEnvValue(env, "RECALLANT_SECURITY_BASELINE_PATH") ??
    productionEnvValue(env, "RECALLANT_SECURITY_PATH") ??
    null;
  const inventoryContent = inventoryFile ? await readOptional(inventoryFile) : null;
  const inventoryRegistered = Boolean(
    inventoryContent &&
    inventoryContent.toLowerCase().includes("recallant") &&
    inventoryContent.includes(String(plannedPort))
  );
  const securityPresent = securityPath ? await pathPresent(securityPath) : false;
  const warnings = [];
  if (!inventoryFile) {
    warnings.push(
      "No server inventory file configured; set RECALLANT_SERVER_INVENTORY_FILE before service start."
    );
  } else if (!inventoryRegistered) {
    warnings.push(
      `Planned Recallant service port ${plannedPort} is not registered in the configured server inventory file.`
    );
  }
  if (securityPath) {
    warnings.push(
      "Configured security baseline must be consulted before exposure, firewall, private access, service, or secret changes."
    );
  } else {
    warnings.push(
      "No security baseline path configured; set RECALLANT_SECURITY_BASELINE_PATH before public exposure."
    );
  }
  return {
    planned_service: {
      name: "recallant",
      port: plannedPort,
      bind_host: productionEnvValue(env, "RECALLANT_HOST") ?? "127.0.0.1"
    },
    server_inventory: {
      path_configured: Boolean(inventoryFile),
      configured: Boolean(inventoryFile),
      present: inventoryContent !== null,
      registered: inventoryRegistered
    },
    security_baseline: {
      path_configured: Boolean(securityPath),
      configured: Boolean(securityPath),
      present: securityPresent,
      must_consult_before_exposure: true
    },
    warnings
  };
}

function shortHash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

function defaultDatabasePort(protocol: string) {
  return protocol === "postgres" || protocol === "postgresql" ? "5432" : null;
}

type DatabaseUrlProfile = {
  configured: boolean;
  status: "missing" | "parsed" | "invalid";
  safe_fingerprint: string | null;
  components: {
    scheme: string;
    host: string | null;
    port: string | null;
    database: string | null;
    username_hash: string | null;
  } | null;
  credential: string | null;
};

const productionReadinessEnvKeys = [
  "RECALLANT_PUBLIC_WORKBENCH_URL",
  "RECALLANT_PUBLIC_URL",
  "RECALLANT_WORKBENCH_ORIGIN_URL",
  "RECALLANT_WORKBENCH_ORIGIN_STATUS",
  "RECALLANT_CLOUDFLARE_MODE",
  "RECALLANT_CLOUDFLARE_EDGE_AUTH",
  "RECALLANT_ADMIN_EMAILS",
  "RECALLANT_ADMIN_EMAIL",
  "RECALLANT_BACKUP_TIMER_ENABLED",
  "RECALLANT_BACKUP_TIMER_STATUS",
  "RECALLANT_LATEST_BACKUP_VERIFICATION_STATUS",
  "RECALLANT_LATEST_BACKUP_VERIFICATION_FILE",
  "RECALLANT_LATEST_BACKUP_MANIFEST",
  "RECALLANT_SERVER_INVENTORY_FILE",
  "RECALLANT_PORTS_FILE",
  "RECALLANT_SECURITY_BASELINE_PATH",
  "RECALLANT_SECURITY_PATH",
  "RECALLANT_PRODUCTION_PROJECT_PATH",
  "RECALLANT_HOST",
  "RECALLANT_PORT",
  "RECALLANT_SYSTEMD_SERVICE_NAME",
  "RECALLANT_SERVICE_ACTIVE_STATUS",
  "RECALLANT_SERVICE_ENABLED_STATUS",
  "RECALLANT_SERVICE_RESTART_POLICY",
  "RECALLANT_SERVICE_HEALTH_URL",
  "RECALLANT_SERVICE_HEALTH_STATUS",
  "RECALLANT_PUBLIC_WORKBENCH_CHECK_URL",
  "RECALLANT_PUBLIC_WORKBENCH_ROUTE_STATUS"
] as const;

type ProductionReadinessEnvKey = (typeof productionReadinessEnvKeys)[number];
type ProductionReadinessEnvValues = Partial<Record<ProductionReadinessEnvKey, string | undefined>>;

type ConfiguredServiceEnvFile = {
  source_env_var: string | null;
  path: string;
  source: "explicit_env" | "systemd";
};

type LoadedServiceEnv = {
  configured: boolean;
  source_env_var: string | null;
  source: "none" | "explicit_env" | "systemd";
  present: boolean;
  values: Record<string, string> | null;
};

function parseDatabaseUrlProfile(value: string | undefined): DatabaseUrlProfile {
  if (!envValueIsSet(value)) {
    return {
      configured: false,
      status: "missing",
      safe_fingerprint: null,
      components: null,
      credential: null
    };
  }
  try {
    const parsed = new URL(String(value));
    const scheme = parsed.protocol.replace(/:$/, "");
    const username = parsed.username ? decodeURIComponent(parsed.username) : "";
    const host = parsed.hostname || null;
    const port = parsed.port || defaultDatabasePort(scheme);
    const database = parsed.pathname
      ? decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || null
      : null;
    const components = {
      scheme,
      host,
      port,
      database,
      username_hash: username ? shortHash({ username }) : null
    };
    return {
      configured: true,
      status: "parsed",
      safe_fingerprint: shortHash(components),
      components,
      credential: parsed.password ? decodeURIComponent(parsed.password) : null
    };
  } catch {
    return {
      configured: true,
      status: "invalid",
      safe_fingerprint: null,
      components: null,
      credential: null
    };
  }
}

function publicDatabaseProfile(profile: DatabaseUrlProfile) {
  return {
    configured: profile.configured,
    status: profile.status,
    safe_fingerprint: profile.safe_fingerprint,
    components: profile.components
  };
}

function parseEnvFileContent(content: string) {
  const values: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValueParts] = trimmed.split("=");
    let key = rawKey?.trim() ?? "";
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (!key) continue;
    values[key] = parseEnvValue(rawValueParts.join("="));
  }
  return values;
}

function systemctlValue(args: readonly string[]) {
  const result = spawnSync("systemctl", [...args], { encoding: "utf8" });
  if (result.error) return null;
  return result.stdout.trim() || null;
}

function parseSystemdEnvironmentFilePath(value: string | null) {
  if (!value) return null;
  for (const token of value.split(/\s+/)) {
    const cleaned = token.trim();
    if (!cleaned || cleaned.startsWith("(")) continue;
    const path = cleaned.startsWith("-") ? cleaned.slice(1) : cleaned;
    if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) return path;
  }
  return null;
}

function configuredServiceEnvFile(): ConfiguredServiceEnvFile | null {
  if (envValueIsSet(process.env.RECALLANT_SERVICE_ENV_FILE)) {
    return {
      source_env_var: "RECALLANT_SERVICE_ENV_FILE",
      path: process.env.RECALLANT_SERVICE_ENV_FILE as string,
      source: "explicit_env"
    };
  }
  if (envValueIsSet(process.env.RECALLANT_SYSTEMD_ENV_FILE)) {
    return {
      source_env_var: "RECALLANT_SYSTEMD_ENV_FILE",
      path: process.env.RECALLANT_SYSTEMD_ENV_FILE as string,
      source: "explicit_env"
    };
  }
  if (process.env.RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY === "true") return null;
  const serviceName = process.env.RECALLANT_SYSTEMD_SERVICE_NAME ?? "recallant.service";
  const environmentFiles = systemctlValue([
    "show",
    serviceName,
    "-p",
    "EnvironmentFiles",
    "--value"
  ]);
  const discovered = parseSystemdEnvironmentFilePath(environmentFiles);
  if (discovered) {
    return {
      source_env_var: null,
      path: discovered,
      source: "systemd"
    };
  }
  return null;
}

async function loadConfiguredServiceEnv(): Promise<LoadedServiceEnv> {
  const configured = configuredServiceEnvFile();
  if (!configured) {
    return {
      configured: false,
      source_env_var: null,
      source: "none",
      present: false,
      values: null
    };
  }
  const content = await readOptional(configured.path);
  if (content === null) {
    return {
      configured: true,
      source_env_var: configured.source_env_var,
      source: configured.source,
      present: false,
      values: null
    };
  }
  return {
    configured: true,
    source_env_var: configured.source_env_var,
    source: configured.source,
    present: true,
    values: parseEnvFileContent(content)
  };
}

function configuredProductionEnvKeys(values: Record<string, string> | null) {
  if (!values) return [];
  return productionReadinessEnvKeys.filter((key) => envValueIsSet(values[key])).sort();
}

async function productionReadinessEnvSnapshot() {
  const serviceEnv = await loadConfiguredServiceEnv();
  const values: ProductionReadinessEnvValues = {};
  for (const key of productionReadinessEnvKeys) {
    const current = process.env[key];
    const fromService = serviceEnv.values?.[key];
    if (envValueIsSet(current)) values[key] = current;
    else if (envValueIsSet(fromService)) values[key] = fromService;
  }
  return {
    values,
    service_env: {
      configured: serviceEnv.configured,
      present: serviceEnv.present,
      source: serviceEnv.source,
      source_env_var: serviceEnv.source_env_var,
      configured_keys: configuredProductionEnvKeys(serviceEnv.values)
    }
  };
}

function productionEnvValue(values: ProductionReadinessEnvValues, key: ProductionReadinessEnvKey) {
  const value = values[key];
  return envValueIsSet(value) ? value : undefined;
}

function serviceProfileDifferences(cli: DatabaseUrlProfile, service: DatabaseUrlProfile) {
  const differences: string[] = [];
  if (!cli.components || !service.components) return differences;
  if (cli.components.scheme !== service.components.scheme) differences.push("scheme");
  if (cli.components.username_hash !== service.components.username_hash)
    differences.push("username");
  if (cli.components.host !== service.components.host) differences.push("host");
  if (cli.components.port !== service.components.port) differences.push("port");
  if (cli.components.database !== service.components.database) differences.push("database");
  if (cli.credential !== service.credential) differences.push("credential");
  return differences;
}

async function checkServiceEnvProfile() {
  const loaded = await loadConfiguredServiceEnv();
  const cliProfile = parseDatabaseUrlProfile(process.env.RECALLANT_DATABASE_URL);
  if (!loaded.configured) {
    return {
      configured: false,
      status: "not_configured",
      source_env_var: null,
      service_env_file: { configured: false, present: false, source: "none" },
      production_env: { configured_keys: [] as string[] },
      cli_database: publicDatabaseProfile(cliProfile),
      service_database: null,
      differences: [] as string[],
      credential_match: null,
      ok: true,
      warnings: [] as string[]
    };
  }

  if (!loaded.present || !loaded.values) {
    return {
      configured: true,
      status: "service_env_file_unreadable_or_missing",
      source_env_var: loaded.source_env_var,
      service_env_file: { configured: true, present: false, source: loaded.source },
      production_env: { configured_keys: [] as string[] },
      cli_database: publicDatabaseProfile(cliProfile),
      service_database: null,
      differences: [] as string[],
      credential_match: null,
      ok: false,
      warnings: ["Configured service env file is missing or unreadable."]
    };
  }

  const serviceEnv = loaded.values;
  const serviceProfile = parseDatabaseUrlProfile(serviceEnv.RECALLANT_DATABASE_URL);
  if (cliProfile.status !== "parsed" || serviceProfile.status !== "parsed") {
    const status =
      cliProfile.status !== "parsed"
        ? "cli_database_url_missing_or_invalid"
        : "service_database_url_missing_or_invalid";
    return {
      configured: true,
      status,
      source_env_var: loaded.source_env_var,
      service_env_file: { configured: true, present: true, source: loaded.source },
      production_env: { configured_keys: configuredProductionEnvKeys(serviceEnv) },
      cli_database: publicDatabaseProfile(cliProfile),
      service_database: publicDatabaseProfile(serviceProfile),
      differences: [] as string[],
      credential_match: null,
      ok: false,
      warnings: [
        cliProfile.status !== "parsed"
          ? "CLI database profile is missing or invalid."
          : "Service env database profile is missing or invalid."
      ]
    };
  }

  const differences = serviceProfileDifferences(cliProfile, serviceProfile);
  const aligned = differences.length === 0;
  return {
    configured: true,
    status: aligned ? "aligned" : "mismatch",
    source_env_var: loaded.source_env_var,
    service_env_file: { configured: true, present: true, source: loaded.source },
    production_env: { configured_keys: configuredProductionEnvKeys(serviceEnv) },
    cli_database: publicDatabaseProfile(cliProfile),
    service_database: publicDatabaseProfile(serviceProfile),
    differences,
    credential_match: cliProfile.credential === serviceProfile.credential,
    ok: aligned,
    warnings: aligned
      ? ([] as string[])
      : [
          "CLI and service env database profiles differ; align them before treating the public Workbench origin as production-ready."
        ]
  };
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

function bindHostIsPrivate(bindHost: string) {
  return bindHost === "127.0.0.1" || bindHost === "::1" || bindHost.endsWith(".tailnet");
}

function httpStatusReadiness(status: number | null) {
  if (status === null) return { status: "not_checked", ok: null };
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return { status: "auth_required", ok: true };
  }
  if (status === 502) return { status: "bad_gateway", ok: false };
  if (status >= 200 && status < 300) return { status: "anonymous_access", ok: false };
  if (status >= 500) return { status: "server_error", ok: false };
  return { status: "unexpected_status", ok: false };
}

async function checkHttpStatus(url: string) {
  const timeout = AbortSignal.timeout(1200);
  try {
    const response = await fetch(url, { redirect: "manual", signal: timeout });
    return { http_status: response.status, error: null };
  } catch (error) {
    return {
      http_status: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function serviceHealthReadiness(
  env: ProductionReadinessEnvValues,
  plannedPort: number,
  originConfigured: string | undefined
) {
  const fixtureStatus = productionEnvValue(env, "RECALLANT_SERVICE_HEALTH_STATUS");
  if (fixtureStatus) {
    const parsed = Number(fixtureStatus);
    return {
      configured: true,
      source: "env",
      http_status: Number.isFinite(parsed) ? parsed : null,
      status: Number.isFinite(parsed) && parsed >= 200 && parsed < 300 ? "healthy" : "unhealthy",
      ok: Number.isFinite(parsed) && parsed >= 200 && parsed < 300,
      error: Number.isFinite(parsed) ? null : "invalid_status"
    };
  }
  const healthUrl = productionEnvValue(env, "RECALLANT_SERVICE_HEALTH_URL");
  let url = healthUrl;
  if (!url && originConfigured) {
    try {
      const parsed = new URL(originConfigured);
      parsed.pathname = "/health";
      parsed.search = "";
      url = parsed.toString();
    } catch {
      url = undefined;
    }
  }
  if (!url) url = `http://127.0.0.1:${plannedPort}/health`;
  const local = localhostOriginUrl(url, plannedPort);
  if (!local.valid || !local.local_only || !local.url) {
    return {
      configured: true,
      source: healthUrl ? "env" : "derived",
      http_status: null,
      status: "invalid_or_non_private_health_url",
      ok: false,
      error: "invalid_or_non_private_health_url"
    };
  }
  const checked = await checkHttpStatus(local.url);
  if (checked.http_status === null && !healthUrl && !originConfigured) {
    return {
      configured: false,
      source: "default",
      http_status: null,
      status: "not_checked",
      ok: null,
      error: checked.error
    };
  }
  return {
    configured: Boolean(healthUrl || originConfigured),
    source: healthUrl ? "env" : originConfigured ? "derived" : "default",
    http_status: checked.http_status,
    status:
      checked.http_status !== null && checked.http_status >= 200 && checked.http_status < 300
        ? "healthy"
        : checked.http_status === null
          ? "down"
          : "unhealthy",
    ok: checked.http_status !== null && checked.http_status >= 200 && checked.http_status < 300,
    error: checked.error
  };
}

async function publicRouteReadiness(env: ProductionReadinessEnvValues) {
  const fixtureStatus = productionEnvValue(env, "RECALLANT_PUBLIC_WORKBENCH_ROUTE_STATUS");
  if (fixtureStatus) {
    const parsed = Number(fixtureStatus);
    const readiness = httpStatusReadiness(Number.isFinite(parsed) ? parsed : null);
    return {
      configured: true,
      source: "env",
      http_status: Number.isFinite(parsed) ? parsed : null,
      status: readiness.status,
      ok: readiness.ok === true,
      error: Number.isFinite(parsed) ? null : "invalid_status"
    };
  }
  const checkUrl =
    productionEnvValue(env, "RECALLANT_PUBLIC_WORKBENCH_CHECK_URL") ??
    productionEnvValue(env, "RECALLANT_PUBLIC_WORKBENCH_URL") ??
    productionEnvValue(env, "RECALLANT_PUBLIC_URL");
  if (!checkUrl) {
    return {
      configured: false,
      source: "not_configured",
      http_status: null,
      status: "not_checked",
      ok: null,
      error: null
    };
  }
  const checked = await checkHttpStatus(checkUrl);
  const readiness = httpStatusReadiness(checked.http_status);
  return {
    configured: true,
    source: productionEnvValue(env, "RECALLANT_PUBLIC_WORKBENCH_CHECK_URL")
      ? "check_url"
      : "public_url",
    http_status: checked.http_status,
    status: checked.http_status === null ? "down" : readiness.status,
    ok: checked.http_status === null ? false : readiness.ok === true,
    error: checked.error
  };
}

async function checkServiceRuntimeReadiness(input: {
  env: ProductionReadinessEnvValues;
  plannedPort: number;
  bindHost: string;
  serviceEnvProfile: Awaited<ReturnType<typeof checkServiceEnvProfile>>;
  publicWorkbenchReadiness: Awaited<ReturnType<typeof checkPublicWorkbenchReadiness>>;
}) {
  const serviceName =
    productionEnvValue(input.env, "RECALLANT_SYSTEMD_SERVICE_NAME") ?? "recallant.service";
  const activeStatus =
    productionEnvValue(input.env, "RECALLANT_SERVICE_ACTIVE_STATUS") ??
    systemctlValue(["is-active", serviceName]);
  const enabledStatus =
    productionEnvValue(input.env, "RECALLANT_SERVICE_ENABLED_STATUS") ??
    systemctlValue(["is-enabled", serviceName]);
  const restartPolicy =
    productionEnvValue(input.env, "RECALLANT_SERVICE_RESTART_POLICY") ??
    systemctlValue(["show", serviceName, "-p", "Restart", "--value"]);
  const originConfigured = productionEnvValue(input.env, "RECALLANT_WORKBENCH_ORIGIN_URL");
  const health = await serviceHealthReadiness(input.env, input.plannedPort, originConfigured);
  const public_route = await publicRouteReadiness(input.env);
  const activeOk = activeStatus === null || activeStatus === "active";
  const enabledOk =
    enabledStatus === null ||
    enabledStatus === "enabled" ||
    enabledStatus === "static" ||
    enabledStatus === "generated";
  const restartOk = restartPolicy === null || restartPolicy === "" || restartPolicy !== "no";
  const privateBindOk = bindHostIsPrivate(input.bindHost);
  const serviceEnvMissing =
    input.serviceEnvProfile.configured === true &&
    input.serviceEnvProfile.service_env_file.present !== true;
  const publicProtected = input.publicWorkbenchReadiness.ready === true;
  const observed = Boolean(
    activeStatus ||
    enabledStatus ||
    restartPolicy ||
    health.configured ||
    public_route.configured ||
    input.serviceEnvProfile.configured ||
    input.publicWorkbenchReadiness.configured
  );
  let status = observed ? "ready" : "not_checked";
  let ok = true;
  let operatorAction = observed
    ? "Service runtime readiness is satisfied."
    : "Configure service runtime checks before claiming service-level production readiness.";
  if (!activeOk) {
    status = "service_inactive";
    ok = false;
    operatorAction =
      "Start or repair the Recallant service before sending users to the public Workbench.";
  } else if (!enabledOk) {
    status = "service_disabled";
    ok = false;
    operatorAction = "Enable the Recallant service or document an equivalent supervised lifecycle.";
  } else if (!restartOk) {
    status = "restart_policy_disabled";
    ok = false;
    operatorAction = "Configure a restart policy so Recallant recovers after process failures.";
  } else if (!privateBindOk) {
    status = "wrong_bind_host";
    ok = false;
    operatorAction = "Keep the Recallant origin bound to localhost or a private network interface.";
  } else if (serviceEnvMissing) {
    status = "service_env_missing";
    ok = false;
    operatorAction =
      "Repair the configured service env file before treating the public Workbench as ready.";
  } else if (health.configured && health.ok !== true) {
    status = "health_failed";
    ok = false;
    operatorAction =
      "Repair the local Recallant /health endpoint before sending users to the public Workbench.";
  } else if (public_route.configured && public_route.ok !== true) {
    status =
      public_route.status === "bad_gateway"
        ? "public_bad_gateway"
        : public_route.status === "anonymous_access"
          ? "public_anonymous_access"
          : "public_route_unhealthy";
    ok = false;
    operatorAction = "Repair the public Workbench route or authenticated access layer.";
  } else if (input.publicWorkbenchReadiness.configured && !publicProtected) {
    status = "public_workbench_not_ready";
    ok = false;
    operatorAction = input.publicWorkbenchReadiness.operator_action;
  }
  return {
    configured: observed,
    status,
    ok,
    service: {
      name: serviceName,
      active_status: activeStatus ?? "unknown",
      enabled_status: enabledStatus ?? "unknown",
      restart_policy: restartPolicy ?? "unknown"
    },
    bind: {
      host: input.bindHost,
      private: privateBindOk
    },
    service_env_file: input.serviceEnvProfile.service_env_file,
    health,
    public_route,
    operator_action: operatorAction
  };
}

async function latestBackupVerificationStatus(env: ProductionReadinessEnvValues = process.env) {
  const envStatus = productionEnvValue(env, "RECALLANT_LATEST_BACKUP_VERIFICATION_STATUS");
  if (envStatus) return { status: envStatus, ok: envStatus === "passed", source: "env" };

  const verificationPath = productionEnvValue(env, "RECALLANT_LATEST_BACKUP_VERIFICATION_FILE");
  if (!verificationPath) {
    return { status: "unknown", ok: false, source: "not_configured", file_configured: false };
  }
  try {
    const parsed = JSON.parse(await readFile(verificationPath, "utf8")) as Record<string, unknown>;
    const status = String(parsed.restore_verification ?? parsed.status ?? "unknown");
    return {
      status,
      ok: status === "passed" && parsed.production_overwritten !== true,
      source: "latest-verification-file",
      file_configured: true,
      verified_at: parsed.verified_at ?? null,
      manifest_configured: Boolean(parsed.manifest_path)
    };
  } catch {
    const manifestPath = productionEnvValue(env, "RECALLANT_LATEST_BACKUP_MANIFEST");
    if (!manifestPath)
      return { status: "unknown", ok: false, source: "missing", file_configured: true };
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as {
        restore_verification?: { status?: string };
      };
      const status = parsed.restore_verification?.status ?? "unknown";
      return {
        status,
        ok: status === "passed",
        source: "manifest",
        file_configured: true,
        manifest_configured: true
      };
    } catch {
      return { status: "unknown", ok: false, source: "missing", file_configured: true };
    }
  }
}

function publicWorkbenchAccessConfig(env: ProductionReadinessEnvValues = process.env) {
  const cloudflareMode = productionEnvValue(env, "RECALLANT_CLOUDFLARE_MODE") ?? "disabled";
  const edgeAuth = productionEnvValue(env, "RECALLANT_CLOUDFLARE_EDGE_AUTH") ?? "disabled";
  const adminEmailCount = (
    productionEnvValue(env, "RECALLANT_ADMIN_EMAILS") ??
    productionEnvValue(env, "RECALLANT_ADMIN_EMAIL") ??
    ""
  )
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean).length;
  return {
    mode: cloudflareMode,
    edge_auth_required: edgeAuth === "required",
    admin_email_count: adminEmailCount,
    ok: cloudflareMode === "enabled" && edgeAuth === "required" && adminEmailCount > 0
  };
}

function localhostOriginUrl(raw: string | null, plannedPort: number) {
  const value = raw ?? `http://127.0.0.1:${plannedPort}/review`;
  try {
    const parsed = new URL(value);
    if (parsed.pathname === "/" || parsed.pathname === "") parsed.pathname = "/review";
    const localHost =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";
    return {
      url: parsed.toString(),
      host: parsed.hostname,
      local_only: localHost,
      valid: true
    };
  } catch {
    return {
      url: null,
      host: null,
      local_only: false,
      valid: false
    };
  }
}

async function checkPublicWorkbenchReadiness(
  plannedPort: number,
  env: ProductionReadinessEnvValues = process.env
) {
  const access = publicWorkbenchAccessConfig(env);
  const publicUrl =
    productionEnvValue(env, "RECALLANT_PUBLIC_WORKBENCH_URL") ??
    productionEnvValue(env, "RECALLANT_PUBLIC_URL") ??
    null;
  const originConfigured = productionEnvValue(env, "RECALLANT_WORKBENCH_ORIGIN_URL") ?? null;
  const shouldCheck =
    envValueIsSet(publicUrl ?? undefined) ||
    envValueIsSet(originConfigured ?? undefined) ||
    access.mode === "enabled";
  const origin = localhostOriginUrl(originConfigured, plannedPort);

  if (!shouldCheck) {
    return {
      configured: false,
      status: "not_configured",
      ready: false,
      public_url_configured: false,
      cloudflare_access: access,
      origin: {
        configured: false,
        local_only: origin.local_only,
        status: "not_checked",
        http_status: null,
        error: null
      },
      operator_action:
        "Configure the public Workbench URL and protected private origin before claiming public UI readiness."
    };
  }

  if (!origin.valid || !origin.url) {
    return {
      configured: true,
      status: "invalid_origin_url",
      ready: false,
      public_url_configured: envValueIsSet(publicUrl ?? undefined),
      cloudflare_access: access,
      origin: {
        configured: envValueIsSet(originConfigured ?? undefined),
        local_only: false,
        status: "invalid_url",
        http_status: null,
        error: "invalid_origin_url"
      },
      operator_action: "Fix the configured private Workbench origin URL."
    };
  }

  if (!origin.local_only) {
    return {
      configured: true,
      status: "origin_not_private",
      ready: false,
      public_url_configured: envValueIsSet(publicUrl ?? undefined),
      cloudflare_access: access,
      origin: {
        configured: envValueIsSet(originConfigured ?? undefined),
        local_only: false,
        status: "not_localhost",
        http_status: null,
        error: null
      },
      operator_action:
        "Keep the Workbench origin on a private localhost listener and put Cloudflare Access in front of it."
    };
  }

  const originStatusFixture = productionEnvValue(env, "RECALLANT_WORKBENCH_ORIGIN_STATUS");
  if (originStatusFixture) {
    const parsed = Number(originStatusFixture);
    const httpStatus = Number.isFinite(parsed) ? parsed : null;
    const originStatus =
      httpStatus === 401 || httpStatus === 403
        ? "auth_required"
        : httpStatus !== null && httpStatus >= 300 && httpStatus < 400
          ? "redirect"
          : httpStatus !== null && httpStatus >= 200 && httpStatus < 300
            ? "anonymous_access"
            : httpStatus === null
              ? "invalid_status"
              : "unexpected_status";
    const authRequired = originStatus === "auth_required" || originStatus === "redirect";
    const ready = authRequired && access.ok;
    return {
      configured: true,
      status: ready
        ? "auth_ready"
        : !access.ok
          ? "cloudflare_access_not_required"
          : originStatus === "anonymous_access"
            ? "origin_allows_anonymous_access"
            : "origin_unexpected_status",
      ready,
      public_url_configured: envValueIsSet(publicUrl ?? undefined),
      cloudflare_access: access,
      origin: {
        configured: envValueIsSet(originConfigured ?? undefined),
        local_only: true,
        status: originStatus,
        http_status: httpStatus,
        error: httpStatus === null ? "invalid_origin_status" : null
      },
      operator_action: ready
        ? "Public Workbench readiness is satisfied when users authenticate through the protected public URL."
        : !access.ok
          ? "Require Cloudflare Access edge auth and configure an admin allowlist for the public Workbench."
          : originStatus === "anonymous_access"
            ? "Require Workbench authentication at the private origin before public exposure."
            : "Repair the private Workbench origin response before claiming public readiness."
    };
  }

  const timeout = AbortSignal.timeout(1200);
  try {
    const response = await fetch(origin.url, {
      redirect: "manual",
      signal: timeout
    });
    const originStatus =
      response.status === 401 || response.status === 403
        ? "auth_required"
        : response.status >= 300 && response.status < 400
          ? "redirect"
          : response.status >= 200 && response.status < 300
            ? "anonymous_access"
            : "unexpected_status";
    const authRequired = originStatus === "auth_required" || originStatus === "redirect";
    const ready = authRequired && access.ok;
    return {
      configured: true,
      status: ready
        ? "auth_ready"
        : !access.ok
          ? "cloudflare_access_not_required"
          : originStatus === "anonymous_access"
            ? "origin_allows_anonymous_access"
            : "origin_unexpected_status",
      ready,
      public_url_configured: envValueIsSet(publicUrl ?? undefined),
      cloudflare_access: access,
      origin: {
        configured: envValueIsSet(originConfigured ?? undefined),
        local_only: true,
        status: originStatus,
        http_status: response.status,
        error: null
      },
      operator_action: ready
        ? "Public Workbench readiness is satisfied when users authenticate through the protected public URL."
        : !access.ok
          ? "Require Cloudflare Access edge auth and configure an admin allowlist for the public Workbench."
          : originStatus === "anonymous_access"
            ? "Require Workbench authentication at the private origin before public exposure."
            : "Repair the private Workbench origin response before claiming public readiness."
    };
  } catch (error) {
    return {
      configured: true,
      status: "origin_unreachable",
      ready: false,
      public_url_configured: envValueIsSet(publicUrl ?? undefined),
      cloudflare_access: access,
      origin: {
        configured: envValueIsSet(originConfigured ?? undefined),
        local_only: true,
        status: "down",
        http_status: null,
        error: error instanceof Error ? error.message : String(error)
      },
      operator_action: "Repair the private Workbench origin that serves the protected public route."
    };
  }
}

async function checkProductionReadiness(
  postgresReachable: boolean,
  projectDir: string,
  serviceEnvProfile: Awaited<ReturnType<typeof checkServiceEnvProfile>>,
  deploymentProfile: Awaited<ReturnType<typeof checkDeploymentProfile>>
) {
  const productionEnv = await productionReadinessEnvSnapshot();
  const env = productionEnv.values;
  const bindHost = productionEnvValue(env, "RECALLANT_HOST") ?? "127.0.0.1";
  const publicWorkbenchReadiness = await checkPublicWorkbenchReadiness(
    Number(productionEnvValue(env, "RECALLANT_PORT") ?? "3005"),
    env
  );
  const plannedPort = Number(productionEnvValue(env, "RECALLANT_PORT") ?? "3005");
  const envBackupTimerEnabled =
    productionEnvValue(env, "RECALLANT_BACKUP_TIMER_ENABLED") === "true" ||
    productionEnvValue(env, "RECALLANT_BACKUP_TIMER_STATUS") === "enabled";
  const backupTimer = productionEnvValue(env, "RECALLANT_BACKUP_TIMER_STATUS")
    ? {
        enabled: envBackupTimerEnabled,
        status: productionEnvValue(env, "RECALLANT_BACKUP_TIMER_STATUS"),
        source: "env"
      }
    : envBackupTimerEnabled
      ? { enabled: true, status: "enabled", source: "env" }
      : systemdBackupTimerStatus();
  const latestBackupVerification = await latestBackupVerificationStatus(env);
  let deploymentProjectRows: number | null = null;
  let unintendedPaidApiSuccessCalls30d: number | null = null;
  const readinessProjectPath =
    productionEnvValue(env, "RECALLANT_PRODUCTION_PROJECT_PATH") ?? projectDir;
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
              WHERE primary_path = $2
                AND ($1::uuid IS NULL OR developer_id = $1::uuid)
            ) AS recallant_project_rows,
            (
              SELECT count(*)::int
              FROM model_calls c
              JOIN projects p ON p.id = c.project_id
              WHERE p.primary_path = $2
                AND ($1::uuid IS NULL OR p.developer_id = $1::uuid)
                AND c.route_class = 'paid_api_provider'
                AND c.status = 'success'
                AND c.created_at >= now() - interval '30 days'
            ) AS paid_api_success_calls
        `,
        [developerId, readinessProjectPath]
      );
      deploymentProjectRows = Number(checks.rows[0]?.recallant_project_rows ?? 0);
      unintendedPaidApiSuccessCalls30d = Number(checks.rows[0]?.paid_api_success_calls ?? 0);
    } catch {
      deploymentProjectRows = null;
      unintendedPaidApiSuccessCalls30d = null;
    } finally {
      await client.end();
    }
  }
  const localhostOnlyOrigin = bindHostIsPrivate(bindHost);
  const serviceRuntime = await checkServiceRuntimeReadiness({
    env,
    plannedPort,
    bindHost,
    serviceEnvProfile,
    publicWorkbenchReadiness
  });
  return {
    doctor_ok: postgresReachable,
    local_stdio_mcp_smoke: {
      required: true,
      command: "npm run mcp:smoke"
    },
    review_ui_cloudflare_access: publicWorkbenchReadiness.cloudflare_access,
    public_workbench_readiness: publicWorkbenchReadiness,
    service_runtime: serviceRuntime,
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
    deployment_project_path: readinessProjectPath,
    deployment_project_rows: deploymentProjectRows,
    no_duplicate_deployment_project_rows:
      deploymentProjectRows === null ? null : deploymentProjectRows <= 1,
    unintended_paid_api_success_calls_30d: unintendedPaidApiSuccessCalls30d,
    no_unintended_paid_api_use:
      unintendedPaidApiSuccessCalls30d === null ? null : unintendedPaidApiSuccessCalls30d === 0,
    service_env_profile: {
      required_when_configured: true,
      status: serviceEnvProfile.status,
      ok: serviceEnvProfile.ok,
      differences: serviceEnvProfile.differences
    },
    deployment_profile: {
      server_inventory: deploymentProfile.server_inventory,
      security_baseline: deploymentProfile.security_baseline,
      warnings: deploymentProfile.warnings
    },
    production_env: productionEnv.service_env,
    ready:
      postgresReachable &&
      localhostOnlyOrigin &&
      serviceEnvProfile.ok &&
      publicWorkbenchReadiness.ready &&
      serviceRuntime.ok &&
      deploymentProfile.server_inventory.registered &&
      deploymentProfile.security_baseline.present &&
      backupTimer.enabled &&
      latestBackupVerification.ok &&
      deploymentProjectRows !== null &&
      deploymentProjectRows <= 1 &&
      unintendedPaidApiSuccessCalls30d !== null &&
      unintendedPaidApiSuccessCalls30d === 0
  };
}

async function runDoctor(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const requireCapture = argv.includes("--require-capture");
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
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
    const clientConnection = await clientConnectionReadiness(projectDir);
    const localSpoolStatus = await getLocalSpoolStatus(argv);
    const serviceEnvProfile = await checkServiceEnvProfile();
    const productionEnv = await productionReadinessEnvSnapshot();
    const deploymentProfile = await checkDeploymentProfile(productionEnv.values);
    const pendingEmbeddingStatus = await checkPendingEmbeddingStatus(database, projectDir);
    const result = {
      ...describeCliBoundary(),
      owner_summary: doctorOwnerSummary({
        projectDir,
        postgres,
        captureReadiness,
        clientConnection,
        requireCapture
      }),
      postgres,
      project_config: {
        path: join(projectDir, ".recallant", "config"),
        present: (await readOptional(join(projectDir, ".recallant", "config"))) !== null
      },
      capture_readiness: {
        ...captureReadiness,
        required: requireCapture
      },
      client_connection: clientConnection,
      local_spool_status: localSpoolStatus,
      local_model: await checkOllama(),
      pending_embeddings: pendingEmbeddingStatus,
      service_env_profile: serviceEnvProfile,
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
      deployment_profile: deploymentProfile,
      production_readiness: await checkProductionReadiness(
        postgres.reachable,
        projectDir,
        serviceEnvProfile,
        deploymentProfile
      ),
      deployment_notes: [
        "Set RECALLANT_SERVER_INVENTORY_FILE before service start.",
        "Set RECALLANT_SECURITY_BASELINE_PATH before public exposure."
      ]
    };
    process.stdout.write(
      format === "json" ? `${JSON.stringify(result, null, 2)}\n` : doctorHumanReport(result)
    );
    if (requireCapture && !captureReadiness.ready) {
      process.exitCode = 2;
    }
  } finally {
    if (database) {
      await database.close();
    }
  }
}

function auditArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function auditHumanReport(report: Record<string, unknown>) {
  const filters = objectValue(report.filters);
  const summary = objectValue(report.summary);
  const capture = objectValue(report.capture);
  const modelProvider = objectValue(report.model_provider);
  const failures = auditArray(report.failures).map((row) => objectValue(row));
  const recommendations = auditArray(report.recommendations).map((row) => objectValue(row));
  const topErrors = auditArray(report.top_errors).map((row) => objectValue(row));
  const timeline = auditArray(report.timeline).map((row) => objectValue(row));
  const lines = [
    "Recallant audit report",
    "",
    `Window: ${String(filters.since ?? "unknown")} to ${String(filters.until ?? "unknown")}`,
    `Project: ${String(filters.project_id ?? filters.project_path ?? "all projects")}`,
    `Filters: surface=${String(filters.surface ?? "all")} status=${String(filters.status ?? "all")} limit=${String(filters.limit ?? "default")}`,
    "",
    "Summary",
    `- Activity rows: ${String(summary.total ?? 0)}`,
    `- Failures/skips needing attention: ${String(summary.failures ?? 0)}`,
    `- Slow operations: ${String(summary.slow_operations ?? 0)}`,
    `- Open started rows: ${String(summary.pending_started ?? 0)}`,
    "",
    "Capture",
    `- Sessions started: ${String(capture.sessions_started ?? 0)}`,
    `- Events: ${String(capture.events ?? 0)}`,
    `- Checkpoints: ${String(capture.checkpoints ?? 0)}`,
    `- Recall traces: ${String(capture.recall_traces ?? 0)}`,
    `- Pending embeddings: ${String(capture.pending_embeddings ?? 0)}`,
    "",
    "Model/provider",
    `- Model calls: ${String(modelProvider.total_calls ?? 0)}`,
    `- Failed model calls: ${String(modelProvider.failed_calls ?? 0)}`,
    "",
    "Failures"
  ];
  if (failures.length === 0) {
    lines.push("- none");
  } else {
    for (const row of failures.slice(0, 8)) {
      lines.push(
        `- ${String(row.surface ?? "surface")}/${String(row.operation ?? "operation")}: ${String(row.status ?? "unknown")} ${String(row.error_code ?? "")} trace=${String(row.trace_id ?? "none")}`
      );
    }
  }
  lines.push("", "Top errors");
  if (topErrors.length === 0) {
    lines.push("- none");
  } else {
    for (const row of topErrors.slice(0, 8)) {
      lines.push(`- ${String(row.error_code ?? "unknown")}: ${String(row.count ?? 0)}`);
    }
  }
  lines.push("", "Recent timeline");
  if (timeline.length === 0) {
    lines.push("- none");
  } else {
    for (const row of timeline.slice(0, 8)) {
      lines.push(
        `- ${String(row.started_at ?? "unknown")} ${String(row.surface ?? "surface")}/${String(row.operation ?? "operation")} ${String(row.status ?? "unknown")} trace=${String(row.trace_id ?? "none")}`
      );
    }
  }
  lines.push("", "Recommendations");
  for (const recommendation of recommendations.slice(0, 8)) {
    lines.push(
      `- ${String(recommendation.severity ?? "info")}: ${String(recommendation.message ?? "No recommendation text.")}`
    );
  }
  lines.push("", "JSON output: recallant audit --format json");
  return `${lines.join("\n")}\n`;
}

async function runAudit(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for audit reports");
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  const rawLimit = parseFlag(argv, "--limit");
  const rawSlowMs = parseFlag(argv, "--slow-ms");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const slowMs = rawSlowMs ? Number.parseInt(rawSlowMs, 10) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  if (slowMs !== undefined && (!Number.isFinite(slowMs) || slowMs <= 0)) {
    throw new Error("--slow-ms must be a positive integer");
  }
  try {
    const report = await database.getSystemAuditReport({
      project_id: parseFlag(argv, "--project-id") ?? null,
      project_path: parseFlag(argv, "--project-id")
        ? null
        : resolve(parseFlag(argv, "--project-dir") ?? process.cwd()),
      since: parseFlag(argv, "--since") ?? null,
      until: parseFlag(argv, "--until") ?? null,
      surface: parseFlag(argv, "--surface") ?? null,
      status: parseFlag(argv, "--status") ?? null,
      limit,
      slow_ms: slowMs
    });
    process.stdout.write(
      format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : auditHumanReport(report as Record<string, unknown>)
    );
  } finally {
    await database.close();
  }
}

function recoverEmbeddingsHumanReport(result: Record<string, unknown>) {
  const status = String(result.status ?? "unknown");
  const lines = [
    "Recallant embedding recovery",
    "",
    `Status: ${status}`,
    `Project: ${String(result.project_id ?? "unknown")}`,
    `Limit: ${String(result.limit ?? "unknown")}`,
    `Attempted chunks: ${String(result.attempted_chunks ?? result.eligible_chunks ?? 0)}`,
    `Recovered chunks: ${String(result.recovered_chunks ?? 0)}`,
    `Remaining pending: ${String(result.remaining_pending ?? result.pending_before ?? "unknown")}`
  ];
  if (result.warning) lines.push(`Warning: ${String(result.warning)}`);
  lines.push("", "JSON output: recallant recover-embeddings --format json");
  return `${lines.join("\n")}\n`;
}

async function runRecoverEmbeddings(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for embedding recovery");
  const projectId = parseFlag(argv, "--project-id") ?? null;
  const projectDir = projectId ? null : resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const rawLimit = parseFlag(argv, "--limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  try {
    const result = await database.recoverPendingEmbeddings({
      project_id: projectId,
      project_path: projectDir,
      limit,
      dry_run: argv.includes("--dry-run")
    });
    process.stdout.write(
      format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : recoverEmbeddingsHumanReport(result)
    );
  } finally {
    await database.close();
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
    "settings_audit_events",
    "system_activity_events"
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
          jsonb_array_length(payload->'raw_artifacts') AS raw_artifact_count,
          jsonb_array_length(payload->'system_activity_events') AS system_activity_event_count
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
          system_activity_event_count: checks.rows[0]?.system_activity_event_count ?? 0,
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

async function runDemoCapture(argv: readonly string[]) {
  const dir = projectDir(argv);
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  const config = await readProjectConfig(dir);
  if (!config?.project_id) {
    throw new Error("VALIDATION_ERROR: demo-capture requires an attached project");
  }
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for demo-capture");
  const marker = parseFlag(argv, "--marker") ?? `DEMO-CAPTURE-${randomUUID()}`;
  const taskHint = parseFlag(argv, "--task-hint") ?? `Recallant demo capture ${marker}`;
  const rememberedText =
    parseFlag(argv, "--text") ??
    `The agent remembered this Recallant demo memory: ${marker}. This proves session start, memory write, checkpoint, and later recall.`;
  let sessionId = "";
  try {
    const started = await startAgentSession(database, [
      argv[0] ?? "",
      argv[1] ?? "",
      "agent-start",
      "--project-dir",
      dir,
      "--task-hint",
      taskHint,
      "--session-label",
      "recallant-demo-capture"
    ]);
    sessionId = started.state.session_id;
    const event = await database.appendEvent({
      session_id: sessionId,
      client_kind: started.state.client_kind,
      event_kind: "other",
      text: rememberedText,
      metadata: {
        capture_kind: "agent_demo_memory",
        project_dir: dir,
        marker
      },
      raw_artifacts: [],
      dedup_key: dedupHash("demo-capture-event", {
        project_id: config.project_id,
        marker,
        rememberedText
      })
    });
    const memory = await database.createAgentMemory({
      project_path: dir,
      memory_type: "decision",
      scope: "project",
      scope_kind: "project",
      title: `Demo capture memory ${marker}`,
      body: rememberedText,
      confidence: 0.95,
      created_by: "agent",
      source_refs: [
        {
          source_kind: "event",
          source_id: String(event.event_id),
          quote: summarizeText(rememberedText, 500),
          metadata: { capture_kind: "agent_demo_memory" }
        }
      ],
      metadata: { created_from: "recallant_demo_capture", marker }
    });
    const checkpointPayload: JsonObject = {
      schema_version: 1,
      status: "demo_capture_complete",
      current_focus: `Demo capture for ${marker}`,
      next_step: `Run recallant ask "what did the agent remember?" --project-dir ${dir}`,
      summary: `Demo capture wrote and checkpointed ${marker}.`,
      updated_at: new Date().toISOString(),
      source: "recallant-demo-capture"
    };
    const checkpoint = await database.setCheckpoint(String(config.project_id), checkpointPayload);
    const checkpointEvent = await database.appendEvent({
      session_id: sessionId,
      client_kind: started.state.client_kind,
      event_kind: "checkpoint",
      text: `Demo checkpoint for ${marker}: ${rememberedText}`,
      metadata: { capture_kind: "agent_checkpoint", checkpoint_payload: checkpointPayload },
      raw_artifacts: [],
      dedup_key: dedupHash("demo-capture-checkpoint", {
        project_id: config.project_id,
        marker,
        checkpointPayload
      })
    });
    await updateProjectLogCheckpoint(dir, checkpointPayload);
    const now = new Date().toISOString();
    await writeAgentSessionState(dir, {
      ...started.state,
      status: "closed",
      updated_at: now,
      last_memory_write_at: now,
      last_checkpoint_at: now,
      last_event_id: String(checkpointEvent.event_id),
      last_memory_id: String(memory.memory_id)
    });
    await database.closeout(
      sessionId,
      checkpointPayload,
      "closeout",
      await getLocalSpoolStatus(argv)
    );
    const recall = await database.recallAgentMemories({
      project_id: String(config.project_id),
      query: "what did the agent remember",
      top_k: 5
    });
    const recalled = recall.memories.some((item: Record<string, unknown>) =>
      String(item.body ?? "").includes(marker)
    );
    const result = {
      ok: true,
      action: "demo_capture",
      project_dir: dir,
      project_id: config.project_id,
      marker,
      session_id: sessionId,
      context_pack_id: started.state.context_pack_id,
      memory_id: memory.memory_id,
      checkpoint_updated_at: checkpoint.updated_at,
      recalled,
      proof: {
        session_started: Boolean(sessionId),
        memory_written: Boolean(memory.memory_id),
        checkpoint_exists: Boolean(checkpoint.updated_at),
        later_recall_works: recalled
      },
      next_commands: [
        `recallant doctor --project-dir ${dir} --require-capture`,
        `recallant ask "what did the agent remember?" --project-dir ${dir}`
      ]
    };
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          "Recallant demo capture",
          "",
          "Status: memory capture proof written.",
          `Project: ${dir}`,
          `Session started: ${result.proof.session_started ? "yes" : "no"}`,
          `Memory written: ${result.proof.memory_written ? "yes" : "no"}`,
          `Checkpoint exists: ${result.proof.checkpoint_exists ? "yes" : "no"}`,
          `Later recall works: ${result.proof.later_recall_works ? "yes" : "no"}`,
          `Marker: ${marker}`,
          "",
          "Next commands:",
          `- ${result.next_commands[0]}`,
          `- ${result.next_commands[1]}`,
          "",
          `JSON output: recallant demo-capture --project-dir ${dir} --format json`
        ].join("\n") + "\n"
      );
    }
  } finally {
    await database.close();
  }
}

async function runAsk(argv: readonly string[]) {
  const dir = projectDir(argv);
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  const query =
    parseFlag(argv, "--query") ??
    positionalArgs(argv)
      .filter((arg) => arg !== "ask")
      .join(" ");
  if (!query.trim()) throw new Error("VALIDATION_ERROR: ask requires a question");
  const explicitProjectId = parseFlag(argv, "--project-id");
  const config = explicitProjectId ? null : await readProjectConfig(dir);
  const projectId = explicitProjectId ?? config?.project_id;
  if (!projectId) {
    throw new Error("VALIDATION_ERROR: ask requires an attached project or --project-id");
  }
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for ask");
  try {
    const recall = await database.recallAgentMemories({
      project_id: String(projectId),
      query,
      top_k: Number(parseFlag(argv, "--top-k") ?? 5)
    });
    const memories = recall.memories.map((memory: Record<string, unknown>) => ({
      memory_id: memory.memory_id,
      title: memory.title,
      body: memory.body,
      updated_at: memory.updated_at,
      source_refs: memory.source_refs
    }));
    const result = {
      ok: true,
      action: "ask",
      project_dir: explicitProjectId ? null : dir,
      project_id: projectId,
      recall_scope: explicitProjectId ? "explicit_project_id" : "attached_project",
      question: query,
      recalled: memories.length > 0,
      memories,
      trace_id: recall.trace_id ?? null,
      warnings: recall.warnings ?? []
    };
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const lines = [
        "Recallant answer",
        "",
        `Question: ${query}`,
        memories.length > 0
          ? "Recallant found memory for this project:"
          : "Recallant did not find matching project memory."
      ];
      for (const memory of memories) {
        lines.push("", String(memory.title ?? "Memory"), String(memory.body ?? ""));
      }
      lines.push(
        "",
        `JSON output: recallant ask ${JSON.stringify(query)} ${
          explicitProjectId ? `--project-id ${projectId}` : `--project-dir ${dir}`
        } --format json`
      );
      process.stdout.write(`${lines.join("\n")}\n`);
    }
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

async function runSpoolStatus(argv: readonly string[]) {
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  const status = await getLocalSpoolStatus(argv);
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ ok: true, action: "spool_status", ...status }, null, 2)}\n`
    );
    return;
  }
  process.stdout.write(
    [
      "Recallant local spool",
      "",
      `Status: ${status.status}`,
      `Pending records: ${status.unsynced_count}`,
      `Total records: ${status.record_count}`,
      `Last write: ${status.last_write_at ?? "none"}`,
      `Spool file: ${status.spool_path}`,
      "",
      `Preview replay: ${status.replay_command}`,
      `Replay now: ${status.sync_command}`,
      `Prune synced records: ${status.prune_command}`,
      "",
      `JSON output: recallant spool-status --project-dir ${projectDir(argv)} --format json`
    ].join("\n") + "\n"
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

function failSoftHookScript(input: {
  command: string;
  stdinText?: boolean;
  fallbackEventKind?: string;
}) {
  const stdin = input.stdinText ? 'TEXT="$(cat)"' : 'TEXT="${RECALLANT_HOOK_TEXT:-hook event}"';
  const fallbackEventKind = input.fallbackEventKind ?? "hook_event";
  return `#!/usr/bin/env sh
set +e

PROJECT_DIR="\${RECALLANT_PROJECT_DIR:-$(pwd)}"
TIMEOUT_SECONDS="\${RECALLANT_HOOK_TIMEOUT_SECONDS:-2}"
FALLBACK_EVENT_KIND="\${RECALLANT_HOOK_FALLBACK_EVENT_KIND:-${fallbackEventKind}}"
${stdin}

if ! command -v recallant >/dev/null 2>&1; then
  exit 0
fi

if command -v timeout >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" ${input.command} >/dev/null 2>&1
  PRIMARY_STATUS="$?"
else
  ${input.command} >/dev/null 2>&1
  PRIMARY_STATUS="$?"
fi

if [ "$PRIMARY_STATUS" -ne 0 ]; then
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_SECONDS" recallant spool-append --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --kind event --event-kind "$FALLBACK_EVENT_KIND" --text "$TEXT" >/dev/null 2>&1
  else
    recallant spool-append --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --kind event --event-kind "$FALLBACK_EVENT_KIND" --text "$TEXT" >/dev/null 2>&1
  fi
fi

exit 0
`;
}

function localHookKitFiles() {
  const eventScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --kind "${1:-action}" --text "$TEXT"',
    stdinText: true,
    fallbackEventKind: "agent_hook_event"
  });
  const promptScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --kind prompt --title "User prompt captured by hook" --text "$TEXT"',
    stdinText: true,
    fallbackEventKind: "agent_prompt"
  });
  const toolResultScript = failSoftHookScript({
    command:
      'recallant agent-event --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --kind tool_result --title "Tool result captured by hook" --text "$TEXT"',
    stdinText: true,
    fallbackEventKind: "agent_tool_result"
  });
  const startScript = failSoftHookScript({
    command:
      'recallant agent-start --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --task-hint "${1:-hook session start}"',
    fallbackEventKind: "agent_session_start"
  });
  const checkpointScript = failSoftHookScript({
    command:
      'recallant agent-checkpoint --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --status "${RECALLANT_HOOK_STATUS:-in_progress}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Continue from Recallant context.}"',
    stdinText: true,
    fallbackEventKind: "agent_checkpoint"
  });
  const closeoutScript = failSoftHookScript({
    command:
      'recallant agent-closeout --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --status "${RECALLANT_HOOK_STATUS:-closed}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Continue from Recallant context.}" --summary "$TEXT"',
    stdinText: true,
    fallbackEventKind: "agent_closeout"
  });
  const preCompactionScript = failSoftHookScript({
    command:
      'recallant agent-checkpoint --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --status "${RECALLANT_HOOK_STATUS:-in_progress}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Resume after compaction from Recallant context.}"',
    stdinText: true,
    fallbackEventKind: "agent_pre_compaction"
  });
  const stopScript = failSoftHookScript({
    command:
      'recallant agent-closeout --project-dir "$PROJECT_DIR" --spool-dir "$PROJECT_DIR/.recallant/spool" --status "${RECALLANT_HOOK_STATUS:-closed}" --focus "$TEXT" --next-step "${RECALLANT_HOOK_NEXT_STEP:-Resume from Recallant context in the next session.}" --summary "$TEXT"',
    stdinText: true,
    fallbackEventKind: "agent_closeout"
  });
  const readme = `# Recallant Local Hook Kit

These project-local hook scripts are optional client integration helpers.

They are fail-soft by design:

- if \`recallant\` is unavailable, they exit 0;
- if a hook times out, they exit 0;
- if the primary capture command fails while \`recallant\` is available, they try
  to write a local spool record under \`.recallant/spool/\`;
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
  const manifest = `${JSON.stringify(
    {
      schema_version: 1,
      name: "Recallant Local Hook Kit",
      fail_soft: true,
      writes_global_config: false,
      project_dir_env: "RECALLANT_PROJECT_DIR",
      timeout_seconds_env: "RECALLANT_HOOK_TIMEOUT_SECONDS",
      spool_dir: ".recallant/spool",
      ready_proof: "recallant doctor --project-dir <project> --require-capture",
      targets: {
        session_start: {
          script: ".recallant/hooks/start-session.sh",
          input: "optional task hint argument"
        },
        user_prompt: {
          script: ".recallant/hooks/user-prompt.sh",
          input: "owner prompt on stdin"
        },
        tool_result: {
          script: ".recallant/hooks/tool-result.sh",
          input: "meaningful tool or command result on stdin"
        },
        generic_event: {
          script: ".recallant/hooks/capture-event.sh",
          input: "event kind argument plus event body on stdin"
        },
        pre_compaction_checkpoint: {
          script: ".recallant/hooks/pre-compaction.sh",
          input: "compact handoff summary on stdin"
        },
        checkpoint: {
          script: ".recallant/hooks/checkpoint.sh",
          input: "checkpoint summary on stdin"
        },
        stop_closeout: {
          script: ".recallant/hooks/stop-session.sh",
          input: "closeout summary on stdin"
        }
      }
    },
    null,
    2
  )}\n`;
  return [
    {
      path: ".recallant/hooks/README.md",
      content: readme,
      executable: false
    },
    {
      path: ".recallant/hooks/manifest.json",
      content: manifest,
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

function globalClientConfigDryRunPlan(input: {
  target: string;
  targetConfig: ReturnType<typeof connectClientTargetConfig>;
  existingText?: string | null;
}) {
  const home = homedir();
  const targetFiles: Record<string, string> = {
    codex: join(home, ".codex", "config.toml"),
    claude_code: join(home, ".claude.json"),
    cursor: join(home, ".cursor", "mcp.json"),
    windsurf: join(home, ".codeium", "windsurf", "mcp_config.json"),
    generic: join(home, ".config", "recallant", "generic-mcp.json"),
    other: join(home, ".config", "recallant", "generic-mcp.json")
  };
  const targetFile = targetFiles[input.target] ?? targetFiles.generic;
  const writerSupported = input.target === "cursor";
  const desiredGlobalConfig =
    input.targetConfig.format === "codex_config_toml"
      ? {
          mcp_servers: {
            recallant: {
              command: "recallant",
              args: ["mcp-server"],
              env: {
                RECALLANT_PROJECT_ID:
                  input.targetConfig.mcp_config.mcpServers.recallant.env.RECALLANT_PROJECT_ID,
                RECALLANT_DEVELOPER_ID:
                  input.targetConfig.mcp_config.mcpServers.recallant.env.RECALLANT_DEVELOPER_ID
              },
              env_vars: ["RECALLANT_DATABASE_URL"]
            }
          }
        }
      : mergeMcpServers(input.existingText ?? null, input.targetConfig.mcp_config);
  const desiredGlobalText = renderClientTargetConfig(
    input.existingText ?? null,
    input.targetConfig
  );
  return {
    mode: writerSupported ? "dry_run_or_confirmed_write" : "dry_run_only",
    scope: "global_client_config",
    writes_global_config: false,
    target_file: targetFile,
    target_format:
      input.target === "codex"
        ? "codex_global_toml"
        : input.target === "claude_code"
          ? "claude_code_user_json"
          : input.target === "cursor"
            ? "cursor_user_mcp_json"
            : "generic_user_mcp_json",
    project_local_config_file: input.targetConfig.config_file,
    planned_merge: {
      operation: "add_or_replace_recallant_mcp_server",
      preserve_existing_client_settings: true,
      preserve_existing_mcp_servers: true,
      server_name: "recallant",
      mcp_server: input.targetConfig.mcp_config.mcpServers.recallant
    },
    desired_config: desiredGlobalConfig,
    desired_config_text: desiredGlobalText,
    writer_supported: writerSupported,
    supported_writer_client: "cursor",
    safety: {
      this_goal_writes_global_config: false,
      actual_global_write_requires_explicit_confirmation: writerSupported,
      actual_global_write_requires_backup: writerSupported,
      unsupported_clients_remain_dry_run_only: !writerSupported
    },
    note: "This is a preview only. It shows the global client file and MCP server merge Recallant would use later; it does not write the global file."
  };
}

function connectHumanReport(result: Record<string, unknown>) {
  const client = String(result.client ?? "agent");
  const connectionStatus = String(result.connection_status ?? "unknown");
  const hookStatus = String(result.hook_status ?? "unknown");
  const dryRun = result.dry_run === true;
  const projectId = String(result.project_id ?? "");
  const projectDir = String(result.project_dir ?? "<project>");
  const configFile = String(result.config_file ?? "");
  const plannedChanges = Array.isArray(result.planned_changes)
    ? result.planned_changes
        .map((change) =>
          change && typeof change === "object" ? (change as Record<string, unknown>) : null
        )
        .filter((change): change is Record<string, unknown> => change !== null)
    : [];
  const changedLines = plannedChanges.length
    ? plannedChanges.map(
        (change) => `  - ${String(change.action ?? "change")}: ${String(change.path ?? "")}`
      )
    : ["  - none"];
  const globalConfig =
    result.global_config && typeof result.global_config === "object"
      ? (result.global_config as Record<string, unknown>)
      : null;
  const writesGlobalConfig = result.writes_global_config === true;
  const clientConnection = objectValue(result.client_connection);
  const nativeHooks = Array.isArray(clientConnection.native_hooks)
    ? clientConnection.native_hooks
        .map((entry) =>
          entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null
        )
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const nativeHookForClient = nativeHooks.find((entry) => String(entry.client) === client);
  const globalLines = globalConfig
    ? [
        "",
        `Global client config ${writesGlobalConfig ? "change" : "preview"}:`,
        `  - target file: ${String(globalConfig.target_file ?? "not reported")}`,
        `  - planned merge: ${String(
          (globalConfig.planned_merge as Record<string, unknown> | undefined)?.operation ??
            "not reported"
        )}`,
        `  - writer supported now: ${globalConfig.writer_supported === true ? "yes, with explicit confirmation" : "no, dry-run only"}`,
        `  - backup path: ${String(globalConfig.backup_path ?? "created only before confirmed write")}`,
        `  - writes global config now: ${writesGlobalConfig ? "yes" : "no"}`
      ]
    : [];
  const hooksText =
    hookStatus === "local_hook_kit_installed"
      ? "installed"
      : hookStatus === "local_hook_kit_planned"
        ? "planned"
        : hookStatus === "not_installed"
          ? "skipped"
          : hookStatus;
  const proofCommand = String(
    (result.mandatory_startup_layer as Record<string, unknown> | undefined)?.proof_command ??
      `recallant doctor --project-dir ${projectDir} --require-capture`
  );
  const captureState = String(
    String(objectValue(result.mandatory_startup_layer).status ?? "unknown") ===
      "mcp_and_hooks_ready"
      ? "configured_and_ready_for_capture"
      : String(objectValue(result.client_connection).status ?? "unknown").includes("mcp")
        ? "configured_without_local_hooks"
        : connectionStatus === "hooks_without_mcp"
          ? "hooks_without_client_config"
          : "not_configured"
  );
  const installCommand = dryRun
    ? `recallant connect ${client} --project-dir ${projectDir}${hookStatus === "local_hook_kit_planned" ? " --install-local-hooks" : ""}`
    : proofCommand;
  return (
    [
      "Recallant connect",
      "",
      `Status: ${dryRun ? "planned" : "agent client configured"}`,
      `Agent client: ${client}`,
      `Project id: ${projectId}`,
      `Client config: ${configFile || "not reported"}`,
      `Local hooks: ${hooksText}`,
      `Native hooks: ${String(nativeHookForClient?.status ?? "not reported")}`,
      "",
      "Files:",
      ...changedLines,
      ...globalLines,
      "",
      `Capture configured/proven: ${captureState}`,
      `Verification command: ${proofCommand}`,
      `Next command: ${installCommand}`,
      "",
      `JSON output: recallant connect ${client} --project-dir <project> --format json`
    ].join("\n") + "\n"
  );
}

function requiredFlag(argv: readonly string[], name: string) {
  const value = parseFlag(argv, name);
  if (!value?.trim()) throw new Error(`VALIDATION_ERROR: ${name} is required`);
  return value;
}

function remoteConnectHumanReport(result: {
  target: string;
  config_file: string;
  target_file?: string;
  writes_files?: boolean;
  setup_hint: string;
  rendered_config: string;
}) {
  return (
    [
      "Recallant connect-remote",
      "",
      `Agent client: ${result.target}`,
      `Config file: ${result.config_file}`,
      result.target_file ? `Target file: ${result.target_file}` : null,
      `Writes files: ${result.writes_files === true ? "yes" : "no"}`,
      result.setup_hint,
      "",
      result.writes_files === true
        ? "Remote MCP config written. The rendered config is omitted from text output because it may contain a scoped credential; use --format json only for trusted automation."
        : result.rendered_config.trimEnd(),
      ""
    ].join("\n") + "\n"
  );
}

function repoRootFromCliModule() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function runNodeHelperScript(scriptRelativePath: string, args: readonly string[]) {
  const script = join(repoRootFromCliModule(), scriptRelativePath);
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  process.exit(typeof result.status === "number" ? result.status : 1);
}

function runRemoteAcceptance(argv: readonly string[]) {
  const subcommand = argv[3];
  if (subcommand === "validate" || subcommand === "verify") {
    return runNodeHelperScript(
      "scripts/validate-remote-mcp-separate-machine-evidence.mjs",
      argv.slice(4)
    );
  }
  const args = subcommand === "run" ? argv.slice(4) : argv.slice(3);
  return runNodeHelperScript("scripts/remote-mcp-separate-machine-evidence.mjs", args);
}

async function runConnectRemote(argv: readonly string[]) {
  const target = parseFlag(argv, "--target") ?? argv[3] ?? "codex";
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  const writeConfig = argv.includes("--write");
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const config = validateRemoteMcpBridgeConfig({
    serverUrl: requiredFlag(argv, "--server-url"),
    credential: requiredFlag(argv, "--credential"),
    projectId: requiredFlag(argv, "--project-id"),
    developerId: requiredFlag(argv, "--developer-id"),
    clientId: requiredFlag(argv, "--client-id"),
    sessionId: parseFlag(argv, "--session-id"),
    traceId: parseFlag(argv, "--trace-id")
  });
  const targetConfig = remoteClientTargetConfig(target, config);
  const targetFile = resolve(projectDir, targetConfig.config_file);
  const existing = writeConfig ? await readOptional(targetFile) : null;
  const rendered = renderRemoteClientTargetConfig(existing, targetConfig);
  if (writeConfig) {
    await mkdir(dirname(targetFile), { recursive: true });
    await writeFile(targetFile, rendered);
  }
  const result = {
    ok: true,
    action: "connect_remote",
    remote: true,
    target: targetConfig.target,
    config_file: targetConfig.config_file,
    project_dir: projectDir,
    target_file: targetFile,
    format: targetConfig.format,
    setup_hint: targetConfig.setup_hint,
    writes_files: writeConfig,
    writes_database: false,
    uses_local_storage: false,
    required_scope: {
      project_id: config.projectId,
      developer_id: config.developerId,
      client_id: config.clientId,
      session_id: config.sessionId,
      trace_id: config.traceId
    },
    mcp_config: targetConfig.mcp_config,
    rendered_config: rendered,
    safety: {
      command: "recallant remote-bridge",
      uses_https_mcp_endpoint: true,
      requires_recallant_database_url: false,
      exposes_postgres: false,
      exposes_workbench_or_admin_auth: false,
      exposes_raw_artifacts_or_backups: false,
      exposes_provider_secrets: false
    }
  };
  process.stdout.write(
    format === "json" ? `${JSON.stringify(result, null, 2)}\n` : remoteConnectHumanReport(result)
  );
}

function remoteCredentialProvisioningServerUrl(argv: readonly string[]) {
  return (
    parseFlag(argv, "--server-url") ??
    process.env.RECALLANT_REMOTE_MCP_URL ??
    "<https-recallant-server>"
  );
}

function remoteCredentialProvisioningTarget(argv: readonly string[]) {
  return parseFlag(argv, "--target") ?? "codex";
}

function remoteCredentialProvisioningBridgeClientId(
  argv: readonly string[],
  clientId?: string | null
) {
  return parseFlag(argv, "--bridge-client-id") ?? clientId ?? "remote-agent";
}

function remoteCredentialProvisioningHumanReport(input: {
  title: string;
  provisioning: ReturnType<typeof remoteMcpProvisioningOutput>;
}) {
  const { provisioning } = input;
  return (
    [
      input.title,
      `id: ${provisioning.credential.id}`,
      `status: ${provisioning.credential.status}`,
      `project_id: ${provisioning.scope.project_id}`,
      `developer_id: ${provisioning.scope.developer_id}`,
      `credential_client_id: ${provisioning.scope.credential_client_id ?? ""}`,
      `bridge_client_id: ${provisioning.scope.bridge_client_id}`,
      `credential_prefix: ${provisioning.credential.credential_prefix}`,
      provisioning.previous_credential
        ? `previous_id: ${provisioning.previous_credential.id}`
        : null,
      provisioning.one_time_secret.shown
        ? `secret: ${provisioning.one_time_secret.value ?? ""}`
        : "secret: [redacted]",
      "",
      "Copy/paste the full remote client bootstrap command. The bootstrap URL by itself only prints the script and does not connect the project.",
      "",
      "Remote client bootstrap command:",
      provisioning.provisioning.command,
      "",
      "Remote doctor command:",
      provisioning.provisioning.doctor_command,
      "",
      `Local runtime: Docker=${provisioning.provisioning.local_runtime.requires_docker}, Postgres=${provisioning.provisioning.local_runtime.requires_postgres}`,
      "",
      `Config file: ${provisioning.provisioning.config_file}`,
      provisioning.provisioning.rendered_config.trimEnd(),
      ""
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n"
  );
}

async function runConnect(argv: readonly string[]) {
  const dir = projectDir(argv);
  const target = parseFlag(argv, "--target") ?? argv[3] ?? "codex";
  const dryRun = argv.includes("--dry-run");
  const globalConfigRequested = argv.includes("--global");
  const confirmGlobalWrite = argv.includes("--confirm-global-write");
  const restoreGlobalBackup = parseFlag(argv, "--restore-global-backup");
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  if ((confirmGlobalWrite || restoreGlobalBackup) && !globalConfigRequested) {
    throw new Error("VALIDATION_ERROR: global write/restore requires --global");
  }
  if (globalConfigRequested && !dryRun && !confirmGlobalWrite && !restoreGlobalBackup) {
    throw new Error(
      "POLICY_BLOCKED: connect --global writes require --confirm-global-write or --restore-global-backup. Run --global --dry-run first."
    );
  }
  if (dryRun && (confirmGlobalWrite || restoreGlobalBackup)) {
    throw new Error("VALIDATION_ERROR: dry-run cannot be combined with global write or restore");
  }
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
  const targetConfig = connectClientTargetConfig(target, config.project_id, developerId, dir);
  if (
    globalConfigRequested &&
    (confirmGlobalWrite || restoreGlobalBackup) &&
    targetConfig.target !== "cursor"
  ) {
    throw new Error(
      "POLICY_BLOCKED: confirmed global config writes are currently enabled only for cursor"
    );
  }
  const targetPath = join(dir, targetConfig.config_file);
  const existing = await readOptional(targetPath);
  const desired = renderClientTargetConfig(existing, targetConfig);
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
  const globalTargetPath = globalConfigRequested
    ? String(
        globalClientConfigDryRunPlan({
          target: targetConfig.target,
          targetConfig
        }).target_file
      )
    : null;
  const existingGlobal = globalTargetPath ? await readOptional(globalTargetPath) : null;
  const globalConfigPlan = globalConfigRequested
    ? {
        ...globalClientConfigDryRunPlan({
          target: targetConfig.target,
          targetConfig,
          existingText: existingGlobal
        }),
        backup_path:
          existingGlobal && targetConfig.target === "cursor"
            ? join(
                recallantDir(dir),
                "backups",
                `connect-global-${new Date().toISOString().replace(/[:.]/g, "-")}`,
                "cursor__mcp.json"
              )
            : null,
        restore_command:
          existingGlobal && targetConfig.target === "cursor"
            ? `recallant connect cursor --project-dir ${dir} --global --restore-global-backup <backup-path>`
            : null,
        confirmation_command:
          targetConfig.target === "cursor"
            ? `recallant connect cursor --project-dir ${dir} --global --confirm-global-write --previewed-global-target ${globalTargetPath}`
            : null
      }
    : null;
  const desiredGlobal =
    typeof globalConfigPlan?.desired_config_text === "string"
      ? globalConfigPlan.desired_config_text
      : globalConfigPlan?.desired_config && typeof globalConfigPlan.desired_config === "object"
        ? `${JSON.stringify(globalConfigPlan.desired_config, null, 2)}\n`
        : null;
  const globalSame = Boolean(
    globalTargetPath && desiredGlobal !== null && existingGlobal === desiredGlobal
  );
  const globalBackupPath =
    typeof globalConfigPlan?.backup_path === "string" ? globalConfigPlan.backup_path : null;
  const globalRestoreTarget = globalTargetPath;
  const globalConfigRestored = Boolean(restoreGlobalBackup && globalRestoreTarget);
  const globalConfigWritten = Boolean(
    confirmGlobalWrite && globalTargetPath && desiredGlobal !== null && !globalSame
  );
  const previewedGlobalTarget = parseFlag(argv, "--previewed-global-target");
  if (confirmGlobalWrite && previewedGlobalTarget !== globalTargetPath) {
    throw new Error(
      `POLICY_BLOCKED: confirmed global write requires --previewed-global-target ${globalTargetPath}. Run --global --dry-run first and confirm the exact target file.`
    );
  }
  const globalChanges = globalConfigPlan
    ? restoreGlobalBackup
      ? [
          {
            action: "restore_global_backup",
            path: globalTargetPath,
            backup_path: restoreGlobalBackup,
            scope: "global_client_config",
            writes_file: true
          }
        ]
      : [
          ...(globalBackupPath && confirmGlobalWrite && !globalSame
            ? [
                {
                  action: "backup_global_file",
                  path: globalBackupPath,
                  source_path: globalTargetPath,
                  scope: "global_client_config",
                  writes_file: true
                }
              ]
            : []),
          globalSame
            ? {
                action: "no_change",
                path: globalTargetPath,
                scope: "global_client_config",
                writes_file: false
              }
            : {
                action: confirmGlobalWrite ? "write_global_file" : "preview_global_merge",
                path: globalTargetPath,
                scope: "global_client_config",
                writes_file: confirmGlobalWrite
              }
        ]
    : [];
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
  if (restoreGlobalBackup && globalRestoreTarget) {
    const backupText = await readFile(restoreGlobalBackup, "utf8");
    await mkdir(globalRestoreTarget.split("/").slice(0, -1).join("/"), { recursive: true });
    await writeFile(globalRestoreTarget, backupText);
  } else if (confirmGlobalWrite && globalTargetPath && desiredGlobal !== null && !globalSame) {
    if (existingGlobal !== null && globalBackupPath) {
      await mkdir(globalBackupPath.split("/").slice(0, -1).join("/"), { recursive: true });
      await writeFile(globalBackupPath, existingGlobal);
    }
    await mkdir(globalTargetPath.split("/").slice(0, -1).join("/"), { recursive: true });
    await writeFile(globalTargetPath, desiredGlobal);
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
  const clientConnection = await clientConnectionReadiness(dir);
  const mcpConfigWillExist = clientConnection.mcp_configured || !same;
  const hookKitWillExist = hookStatus !== "not_installed";
  const mandatoryStartupLayerStatus =
    installLocalHooks && dryRun
      ? "mcp_and_hooks_planned"
      : mcpConfigWillExist && hookKitWillExist
        ? "mcp_and_hooks_ready"
        : mcpConfigWillExist
          ? "mcp_only"
          : hookKitWillExist
            ? "hooks_without_mcp"
            : "not_configured";
  const result = {
    ok: true,
    action: "connect",
    dry_run: dryRun,
    client: targetConfig.target,
    project_dir: dir,
    project_id: config.project_id,
    developer_id: developerId,
    connection_status: mandatoryStartupLayerStatus,
    hook_status: hookStatus,
    capture_status: captureStatusFromState(state),
    mandatory_startup_layer: {
      status: mandatoryStartupLayerStatus,
      mcp_configured_or_planned: mcpConfigWillExist,
      hook_kit_status: hookStatus,
      fail_soft: true,
      writes_global_config: false,
      capture_targets: captureTargetNames,
      proof_command: `recallant doctor --project-dir ${dir} --require-capture`,
      ready_definition:
        "MCP config plus hook targets are installed/planned; capture-active still requires context read, memory write, and checkpoint evidence."
    },
    client_connection: clientConnection,
    writes_files: !dryRun && (!same || hookFilePlans.some((hookFile) => !hookFile.same)),
    writes_global_config: globalConfigWritten || globalConfigRestored,
    config_scope: globalConfigRequested ? "project_local_and_global_dry_run" : "project_local",
    project_local_config: {
      scope: "project_local_config",
      config_file: targetConfig.config_file,
      planned_changes: plannedChanges,
      writes_files: !dryRun && !same
    },
    global_config: globalConfigPlan,
    planned_changes: [...plannedChanges, ...globalChanges, ...hookChanges],
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
      native_hooks: clientConnection.native_hooks,
      timeout_seconds_env: "RECALLANT_HOOK_TIMEOUT_SECONDS",
      project_dir_env: "RECALLANT_PROJECT_DIR"
    },
    mcp_config: targetConfig.mcp_config,
    rendered_config: desired
  };
  process.stdout.write(
    format === "json" ? `${JSON.stringify(result, null, 2)}\n` : connectHumanReport(result)
  );
}

function inferTargetClient(input: { client: string | null }) {
  return input.client && input.client.trim() ? input.client : "codex";
}

function emptyOnboardVerifyEvidence(): OnboardVerifyEvidence {
  return {
    context_read: false,
    memory_write: false,
    checkpoint: false,
    recall: false
  };
}

function onboardVerifyEvidenceFromDoctor(doctorJson: Record<string, unknown> | null) {
  const readiness = objectValue(doctorJson?.capture_readiness);
  const databaseReadiness = objectValue(readiness.database_readiness);
  const localState = objectValue(readiness.local_state);
  return {
    context_read: Boolean(
      databaseReadiness.last_context_read_at ?? localState.last_context_read_at
    ),
    memory_write: Boolean(
      databaseReadiness.last_memory_write_at ?? localState.last_memory_write_at
    ),
    checkpoint: Boolean(databaseReadiness.checkpoint_updated_at ?? localState.last_checkpoint_at),
    recall: false
  };
}

const onboardEmbeddingRecoveryLimit = 50;

function finiteNumberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function baseOnboardEmbeddingRecovery(input: {
  status: OnboardEmbeddingRecoveryPayload["status"];
  projectId: string | null;
  pendingBefore: number | null;
  attempted?: boolean;
  attemptedChunks?: number;
  recoveredChunks?: number;
  remainingPending?: number | null;
  recoveryAvailable?: boolean;
  latestFailure?: unknown;
  warning?: string | null;
  recommendation: string;
}): OnboardEmbeddingRecoveryPayload {
  return {
    status: input.status,
    attempted: input.attempted ?? false,
    project_id: input.projectId,
    pending_before: input.pendingBefore,
    attempted_chunks: input.attemptedChunks ?? 0,
    recovered_chunks: input.recoveredChunks ?? 0,
    remaining_pending: input.remainingPending ?? input.pendingBefore,
    limit: onboardEmbeddingRecoveryLimit,
    recovery_available: input.recoveryAvailable ?? true,
    latest_failure: input.latestFailure ?? null,
    warning: input.warning ?? null,
    recommendation: input.recommendation,
    scope: {
      project_scoped: true,
      bounded: true,
      limit: onboardEmbeddingRecoveryLimit
    }
  };
}

function createUncachedRecallantDbFromEnv() {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) return null;
  return new RecallantDb({
    databaseUrl,
    developerId: process.env.RECALLANT_DEVELOPER_ID,
    projectId: process.env.RECALLANT_PROJECT_ID,
    projectPath: process.env.RECALLANT_PROJECT_PATH
  });
}

async function recoverOnboardPendingEmbeddings(
  projectDir: string,
  doctorJson: Record<string, unknown> | null
): Promise<OnboardEmbeddingRecoveryPayload> {
  const pending = objectValue(doctorJson?.pending_embeddings);
  const projectId = typeof pending.project_id === "string" ? pending.project_id : null;
  const pendingBefore = finiteNumberValue(pending.pending_chunks);
  const latestFailure =
    pending.latest_failure ?? objectValue(pending.recovery).latest_failure ?? null;
  if (pendingBefore !== null && pendingBefore <= 0) {
    return baseOnboardEmbeddingRecovery({
      status: "no_pending",
      projectId,
      pendingBefore,
      remainingPending: 0,
      latestFailure,
      recommendation: "Semantic embeddings are current."
    });
  }
  if (pendingBefore === null) {
    return baseOnboardEmbeddingRecovery({
      status: "unknown",
      projectId,
      pendingBefore,
      recoveryAvailable: false,
      latestFailure,
      warning: "Pending embedding state could not be read from doctor output.",
      recommendation:
        "Capture and recall remain available; rerun Recallant readiness after storage is reachable."
    });
  }
  const database = createUncachedRecallantDbFromEnv();
  if (!database) {
    return baseOnboardEmbeddingRecovery({
      status: "skipped",
      projectId,
      pendingBefore,
      recoveryAvailable: false,
      latestFailure,
      warning: "Recallant storage is not configured for embedding recovery.",
      recommendation:
        "Capture and recall remain available; semantic indexing will wait until storage is configured."
    });
  }
  try {
    const recovery = await database.recoverPendingEmbeddings({
      project_path: projectDir,
      limit: onboardEmbeddingRecoveryLimit
    });
    const embedding = objectValue(recovery.embedding);
    const attemptedChunks = finiteNumberValue(recovery.attempted_chunks) ?? 0;
    const recoveredChunks = finiteNumberValue(recovery.recovered_chunks) ?? 0;
    const remainingPending = finiteNumberValue(recovery.remaining_pending) ?? pendingBefore;
    const unavailable =
      embedding.error === "UNAVAILABLE" ||
      String(recovery.warning ?? "")
        .toLowerCase()
        .includes("provider is unavailable");
    const status =
      remainingPending <= 0 && recoveredChunks > 0
        ? "recovered"
        : remainingPending <= 0
          ? "no_pending"
          : unavailable
            ? "model_unavailable"
            : "still_pending";
    return baseOnboardEmbeddingRecovery({
      status,
      projectId: typeof recovery.project_id === "string" ? recovery.project_id : projectId,
      pendingBefore,
      attempted: attemptedChunks > 0,
      attemptedChunks,
      recoveredChunks,
      remainingPending,
      latestFailure,
      warning: typeof recovery.warning === "string" ? recovery.warning : null,
      recommendation:
        status === "recovered" || status === "no_pending"
          ? "Semantic embeddings are current."
          : "Capture and recall are ready; semantic embeddings are waiting for local model recovery."
    });
  } catch (error) {
    return baseOnboardEmbeddingRecovery({
      status: "unknown",
      projectId,
      pendingBefore,
      recoveryAvailable: false,
      latestFailure,
      warning: error instanceof Error ? error.message : String(error),
      recommendation:
        "Capture and recall remain available; semantic indexing recovery should be retried by Recallant readiness."
    });
  } finally {
    await database.close();
  }
}

function unavailableWorkbenchOutcome(message: string): OnboardWorkbenchOutcome {
  return {
    available: false,
    url: null,
    auth_required: true,
    private_by_default: true,
    project_visible: null,
    migration_review_queue: {
      import_candidate_count: null,
      pending_review: null,
      review_needed: null
    },
    message
  };
}

function buildWorkbenchUrl(projectId: string) {
  const baseUrl =
    process.env.RECALLANT_WORKBENCH_URL ??
    process.env.RECALLANT_SERVER_URL ??
    `http://${process.env.RECALLANT_HOST ?? "127.0.0.1"}:${process.env.RECALLANT_PORT ?? "3005"}`;
  try {
    const url = new URL("/review", baseUrl);
    url.searchParams.set("project_id", projectId);
    url.searchParams.set("view", "review");
    return url.toString();
  } catch {
    return null;
  }
}

async function resolveOnboardWorkbenchOutcome(
  projectDir: string
): Promise<OnboardWorkbenchOutcome> {
  const config = await readProjectConfig(projectDir);
  if (!config?.project_id) {
    return unavailableWorkbenchOutcome(
      "Workbench needs an attached project before it can show review state."
    );
  }
  const url = buildWorkbenchUrl(config.project_id);
  if (!url) {
    return unavailableWorkbenchOutcome("Workbench URL is not valid in the current environment.");
  }
  const database = createRecallantDbFromEnv();
  if (!database) {
    return unavailableWorkbenchOutcome(
      "Workbench needs Recallant storage before it can show review state."
    );
  }
  try {
    const dashboard = await database.getReviewDashboard({ project_id: config.project_id });
    const projectVisible = dashboard.projects.some(
      (project) => project.project_id === config.project_id
    );
    const importCandidateCount = Array.isArray(dashboard.import_candidates)
      ? dashboard.import_candidates.length
      : null;
    const pendingReview =
      typeof dashboard.critical?.pending_review === "number"
        ? dashboard.critical.pending_review
        : null;
    return {
      available: true,
      url,
      auth_required: true,
      private_by_default: true,
      project_visible: projectVisible,
      migration_review_queue: {
        import_candidate_count: importCandidateCount,
        pending_review: pendingReview,
        review_needed:
          importCandidateCount === null && pendingReview === null
            ? null
            : (importCandidateCount ?? 0) > 0 || (pendingReview ?? 0) > 0
      },
      message: projectVisible
        ? "Workbench can show this project with capture and review state."
        : "Workbench is reachable, but this project was not visible in the review dashboard."
    };
  } catch {
    return unavailableWorkbenchOutcome("Workbench review state could not be checked.");
  } finally {
    await database.close();
  }
}

async function runOnboard(argv: readonly string[]) {
  const options = parseOnboardOptions(argv);
  const targetClient = inferTargetClient({ client: options.client });
  const documentationPosture = await analyzeProjectDocumentationPosture(options.projectDir);
  const steps: { attached: OnboardAttachedStep; connected: OnboardConnectedStep } = {
    attached: {
      command: formatCommandHint(["recallant", "attach", "--project-dir", options.projectDir]),
      status: "skipped"
    },
    connected: {
      command: formatCommandHint([
        "recallant",
        "connect",
        targetClient,
        "--project-dir",
        options.projectDir
      ]),
      status: "skipped"
    }
  };
  const existingConfig = await readProjectConfig(options.projectDir);
  const storage = await resolveOnboardStorage(options);
  if (!storage.reachable) {
    const payload = {
      action: "onboard",
      status: "storage_blocked",
      project_dir: options.projectDir,
      format: options.format,
      storage,
      version_control: null,
      attach_details: null,
      documentation_posture: documentationPosture,
      project_already_attached: Boolean(existingConfig?.project_id),
      client: options.client ? targetClient : null,
      install_local_hooks: options.installLocalHooks,
      verify_requested: options.verify,
      attached: {
        status: "skipped" as const,
        command: null,
        details: "storage is not ready"
      },
      connected: {
        status: "skipped" as const,
        command: null,
        details: "storage is not ready"
      },
      verify: null,
      next_command: formatOnboardRerunCommand(options, targetClient)
    };
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(payload, null, 2)}\n`
        : onboardHumanReport(payload)
    );
    process.exitCode = 2;
    return;
  }
  const versionControl = await resolveOnboardVersionControl(options);
  const versionControlBlocks = ["needs_choice", "git_missing", "failed"].includes(
    versionControl.status
  );
  const needAttach = !existingConfig?.project_id;
  if (options.verify && !options.client) {
    throw new Error(
      `onboard --verify requires a client. Run the beginner flow with: recallant onboard ${options.projectDir}`
    );
  }
  const verifyResult: OnboardVerifyPayload = {
    status: "skipped",
    ask_answer: null,
    failed_stage: null,
    message: null,
    capture_active: false,
    evidence: emptyOnboardVerifyEvidence(),
    proof: { demo: "skipped", doctor: "skipped", ask: "skipped" },
    stages: {
      capture: { status: "skipped", detail: null },
      readiness: {
        status: "skipped",
        detail: null,
        evidence: emptyOnboardVerifyEvidence()
      },
      recall: { status: "skipped", detail: null }
    }
  };
  let onboardStatus: "completed" | "needs_confirmation" | "plan_only" | "cancelled" | "incomplete" =
    "completed";
  let attachDetails: ReturnType<typeof safeAttachDetailsForOnboard> | null = null;
  let embeddingRecovery: OnboardEmbeddingRecoveryPayload | null = null;

  if (versionControlBlocks) {
    const payload = {
      action: "onboard",
      status: "vcs_blocked",
      project_dir: options.projectDir,
      format: options.format,
      storage,
      version_control: versionControl,
      attach_details: null,
      documentation_posture: documentationPosture,
      project_already_attached: Boolean(existingConfig?.project_id),
      client: options.client ? targetClient : null,
      install_local_hooks: options.installLocalHooks,
      verify_requested: options.verify,
      attached: {
        status: "skipped" as const,
        command: null,
        details: "version-control safety needs a choice before project files are changed"
      },
      connected: {
        status: "skipped" as const,
        command: null,
        details: "version-control safety needs a choice before project files are changed"
      },
      verify: null,
      next_command: formatOnboardRerunCommand(options, targetClient)
    };
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(payload, null, 2)}\n`
        : onboardHumanReport(payload)
    );
    process.exitCode = 2;
    return;
  }

  const buildAttachPlanPayload = (status: typeof onboardStatus, nextCommand: string) => ({
    action: "onboard",
    status,
    project_dir: options.projectDir,
    format: options.format,
    storage,
    version_control: versionControl,
    attach_details: attachDetails,
    documentation_posture: attachDetails?.documentation_posture ?? documentationPosture,
    project_already_attached: Boolean(existingConfig?.project_id),
    client: options.client ? targetClient : null,
    install_local_hooks: options.installLocalHooks,
    verify_requested: options.verify,
    attached: {
      status: steps.attached.status,
      command: steps.attached.command,
      details: steps.attached.details ?? null
    },
    connected: {
      status: "skipped" as const,
      command: steps.connected.command,
      details: "waiting for onboard attach confirmation"
    },
    verify: null,
    next_command: nextCommand
  });

  const emitAttachPlan = (status: typeof onboardStatus, exitCode: number) => {
    onboardStatus = status;
    const payload = buildAttachPlanPayload(
      onboardStatus,
      status === "cancelled"
        ? formatOnboardRerunCommand({ ...options, yes: false, cancel: false }, targetClient)
        : formatOnboardRerunCommand({ ...options, yes: true, cancel: false }, targetClient)
    );
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(payload, null, 2)}\n`
        : onboardHumanReport(payload)
    );
    process.exitCode = exitCode;
  };

  const emitVerifyFailure = (
    failedStage: NonNullable<OnboardVerifyPayload["failed_stage"]>,
    message: string
  ) => {
    onboardStatus = "incomplete";
    verifyResult.status = "failed";
    verifyResult.failed_stage = failedStage;
    verifyResult.message = message;
    const payload = {
      action: "onboard",
      status: onboardStatus,
      project_dir: options.projectDir,
      format: options.format,
      storage,
      version_control: versionControl,
      attach_details: attachDetails,
      documentation_posture: attachDetails?.documentation_posture ?? documentationPosture,
      project_already_attached: Boolean(existingConfig?.project_id),
      client: options.client ? targetClient : null,
      install_local_hooks: options.installLocalHooks,
      verify_requested: options.verify,
      attached: {
        status: needAttach ? steps.attached.status : ("skipped" as const),
        command: steps.attached.command,
        details: steps.attached.details ?? null
      },
      connected: {
        status: steps.connected.status,
        command: steps.connected.command,
        details: steps.connected.details ?? null
      },
      verify: verifyResult,
      embedding_recovery: embeddingRecovery,
      next_command: formatOnboardRerunCommand(options, targetClient)
    };
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(payload, null, 2)}\n`
        : onboardHumanReport(payload)
    );
    process.exitCode = 2;
  };

  if (needAttach) {
    const attachCommand = [
      "attach",
      "--project-dir",
      options.projectDir,
      "--target",
      targetClient,
      "--format",
      "json"
    ];
    if (options.dryRun) attachCommand.push("--dry-run");
    const attachResult = runLocalCliSubcommand(attachCommand);
    steps.attached.command = formatCommandHint(attachCommand);
    if (attachResult.status !== 0) {
      steps.attached.status = "failed";
      const issue = summarizeSubcommandFailure(attachResult);
      steps.attached.details = issue;
      throw new Error(`onboard attach failed: ${issue}. Fix the reported issue and rerun onboard.`);
    }
    let attachPayload = attachResult.json;
    let attachStatus = String(attachPayload?.status ?? "unknown");
    attachDetails = safeAttachDetailsForOnboard(attachPayload);
    if (options.dryRun && attachStatus === "plan_only") {
      steps.attached.status = "skipped";
      steps.attached.details = "dry-run plan; no project files or database rows changed";
      emitAttachPlan("plan_only", 0);
      return;
    }
    if (attachStatus === "needs_confirmation") {
      steps.attached.status = "needs_confirmation";
      steps.attached.details = "production-sensitive plan needs onboard confirmation";
      if (options.cancel) {
        steps.attached.details = "cancelled by user; no project files or database rows changed";
        emitAttachPlan("cancelled", 3);
        return;
      }
      if (options.dryRun) {
        steps.attached.details = "dry-run plan; no project files or database rows changed";
        emitAttachPlan("plan_only", 0);
        return;
      }
      let attachApproved = options.yes;
      if (!attachApproved) {
        if (canPromptForOnboarding(options)) {
          const reviewPayload = buildAttachPlanPayload(
            "needs_confirmation",
            "Answer the prompt below."
          );
          process.stdout.write(onboardHumanReport(reviewPayload));
          const continueOnboarding = await promptYesNo(
            "Continue onboarding and apply these planned changes?",
            false
          );
          if (!continueOnboarding) {
            steps.attached.details = "cancelled by user; no project files or database rows changed";
            emitAttachPlan("cancelled", 3);
            return;
          }
          attachApproved = true;
        } else {
          emitAttachPlan("needs_confirmation", 2);
          return;
        }
      }
      if (!attachApproved) {
        emitAttachPlan("needs_confirmation", 2);
        return;
      }
      const confirmedCommand = [...attachCommand, "--confirm"];
      const confirmedResult = runLocalCliSubcommand(confirmedCommand);
      if (confirmedResult.status !== 0) {
        steps.attached.status = "failed";
        const issue = summarizeSubcommandFailure(confirmedResult);
        steps.attached.details = issue;
        throw new Error(
          `onboard attach confirmation failed: ${issue}. Fix the reported issue and rerun onboard.`
        );
      }
      attachPayload = confirmedResult.json;
      attachStatus = String(attachPayload?.status ?? "unknown");
      attachDetails = safeAttachDetailsForOnboard(attachPayload);
    }
    if (attachStatus !== "attached" && attachStatus !== "plan_only") {
      steps.attached.status = "failed";
      throw new Error(`onboard attach failed with status '${attachStatus}'. Rerun onboard.`);
    }
    steps.attached.status = attachStatus === "attached" ? "attached" : "failed";
    steps.attached.details = `status=${attachStatus}`;
  } else {
    steps.attached.status = "skipped";
    steps.attached.details = "recallant attach already has .recallant/config";
  }

  let alreadyConnected = false;
  if (options.client) {
    const clientConnection = await clientConnectionReadiness(options.projectDir);
    const clientHasConfig = clientConnection.mcp_configs.some(
      (entry) => entry.client === targetClient && entry.present
    );
    const hooksReady = clientConnection.hook_kit.ready;
    alreadyConnected = clientHasConfig && (options.installLocalHooks ? hooksReady : true);
    if (!alreadyConnected) {
      const connectCommand = [
        "connect",
        targetClient,
        "--project-dir",
        options.projectDir,
        "--format",
        "json"
      ];
      if (options.installLocalHooks) connectCommand.push("--install-local-hooks");
      if (options.dryRun) connectCommand.push("--dry-run");
      const connectResult = runLocalCliSubcommand(connectCommand);
      steps.connected.command = formatCommandHint(connectCommand);
      if (connectResult.status !== 0) {
        steps.connected.status = "failed";
        const issue = summarizeSubcommandFailure(connectResult);
        steps.connected.details = issue;
        throw new Error(
          `onboard connect failed: ${issue}. Run again after fixing: ${steps.connected.command}`
        );
      }
      const connectPayload = connectResult.json;
      const connectionStatus = String(
        connectPayload?.connection_status ??
          objectValue(connectPayload?.mandatory_startup_layer).status ??
          "not_configured"
      );
      steps.connected.status =
        connectionStatus === "mcp_only" || connectionStatus === "mcp_and_hooks_ready"
          ? "connected"
          : "needed";
      steps.connected.details = `connection_status=${connectionStatus}`;
      if (steps.connected.status === "needed") {
        throw new Error(
          options.installLocalHooks
            ? `onboard connect installed partial setup without hooks. Run: ${steps.connected.command}`
            : `onboard connect is configured but not fully ready. Run: ${steps.connected.command}`
        );
      }
    } else {
      steps.connected.status = "connected";
      steps.connected.details = `client=${targetClient} already connected`;
    }
  } else {
    steps.connected.status = "skipped";
    steps.connected.details = "no --client set, skipped connect";
  }

  if (options.verify) {
    const marker = `onboard-${randomUUID()}`;
    const demoCommand = [
      "demo-capture",
      "--project-dir",
      options.projectDir,
      "--format",
      "json",
      "--marker",
      marker
    ];
    const demoResult = runLocalCliSubcommand(demoCommand);
    if (demoResult.status !== 0) {
      verifyResult.proof.demo = "failed";
      verifyResult.stages.capture.status = "failed";
      verifyResult.stages.capture.detail = "capture proof did not complete";
      verifyResult.ask_answer = "not available";
      emitVerifyFailure("capture", "capture proof did not complete");
      return;
    }
    verifyResult.proof.demo = "done";
    verifyResult.stages.capture.status = "done";
    verifyResult.stages.capture.detail = "context read, memory write, and checkpoint were written";
    const doctorCommand = [
      "doctor",
      "--project-dir",
      options.projectDir,
      "--require-capture",
      "--format",
      "json"
    ];
    const doctorResult = runLocalCliSubcommand(doctorCommand);
    verifyResult.evidence = onboardVerifyEvidenceFromDoctor(doctorResult.json);
    verifyResult.stages.readiness.evidence = verifyResult.evidence;
    if (doctorResult.status !== 0) {
      verifyResult.proof.doctor = "failed";
      verifyResult.stages.readiness.status = "failed";
      verifyResult.stages.readiness.detail = "capture readiness proof did not complete";
      emitVerifyFailure("readiness", "capture readiness proof did not complete");
      return;
    }
    const captureReady = Boolean(objectValue(doctorResult.json?.capture_readiness).ready);
    if (!captureReady) {
      verifyResult.proof.doctor = "failed";
      verifyResult.stages.readiness.status = "failed";
      verifyResult.stages.readiness.detail = "capture is not active yet; onboarding is incomplete";
      emitVerifyFailure("readiness", "capture is not active yet; onboarding is incomplete");
      return;
    }
    verifyResult.proof.doctor = "done";
    verifyResult.stages.readiness.status = "done";
    verifyResult.stages.readiness.detail = "capture readiness is active";
    verifyResult.capture_active = true;
    embeddingRecovery = await recoverOnboardPendingEmbeddings(
      options.projectDir,
      doctorResult.json
    );

    const query = "what did you remember?";
    const askCommand = [
      "ask",
      "--project-dir",
      options.projectDir,
      "--format",
      "json",
      "--query",
      query
    ];
    const askResult = runLocalCliSubcommand(askCommand);
    if (askResult.status !== 0) {
      verifyResult.proof.ask = "failed";
      verifyResult.stages.recall.status = "failed";
      verifyResult.stages.recall.detail = "recall proof did not complete";
      emitVerifyFailure("recall", "recall proof did not complete");
      return;
    }
    verifyResult.proof.ask = "done";
    const memories = objectValue(askResult.json).memories;
    const firstMemory =
      Array.isArray(memories) && memories.length > 0
        ? (memories[0] as Record<string, unknown>)
        : null;
    const answer = firstMemory && typeof firstMemory.body === "string" ? firstMemory.body : null;
    verifyResult.ask_answer = answer;
    verifyResult.status = answer ? "passed" : "failed";
    if (verifyResult.status === "failed") {
      verifyResult.proof.ask = "failed";
      verifyResult.stages.recall.status = "failed";
      verifyResult.stages.recall.detail = "recall proof did not return the captured memory";
      emitVerifyFailure("recall", "recall proof did not return the captured memory");
      return;
    }
    verifyResult.evidence = { ...verifyResult.evidence, recall: true };
    verifyResult.stages.readiness.evidence = verifyResult.evidence;
    verifyResult.stages.recall.status = "done";
    verifyResult.stages.recall.detail = "captured memory was recalled";
  }

  const workbench = await resolveOnboardWorkbenchOutcome(options.projectDir);
  const verifyNextOptions: OnboardOptions = {
    ...options,
    client: options.client ?? "codex",
    installLocalHooks: options.client ? options.installLocalHooks : true,
    verify: true,
    dryRun: false,
    yes: false,
    cancel: false
  };
  const nextCommand = options.verify
    ? "Start normal work in your agent client."
    : formatOnboardRerunCommand(verifyNextOptions, options.client ? targetClient : "codex");
  const payload = {
    action: "onboard",
    status: onboardStatus,
    project_dir: options.projectDir,
    format: options.format,
    storage,
    version_control: versionControl,
    attach_details: attachDetails,
    documentation_posture: attachDetails?.documentation_posture ?? documentationPosture,
    workbench,
    project_already_attached: Boolean(existingConfig?.project_id),
    client: options.client ? targetClient : null,
    install_local_hooks: options.installLocalHooks,
    verify_requested: options.verify,
    attached: {
      status: needAttach ? steps.attached.status : ("skipped" as const),
      command: steps.attached.command,
      details: steps.attached.details ?? null
    },
    connected: {
      status:
        options.client && !needAttach
          ? steps.connected.status
          : needAttach
            ? steps.connected.status
            : options.client
              ? steps.connected.status
              : "skipped",
      command: steps.connected.command,
      details: steps.connected.details ?? null
    },
    verify: options.verify ? verifyResult : null,
    embedding_recovery: embeddingRecovery,
    next_command: nextCommand
  };
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(payload, null, 2)}\n`
      : onboardHumanReport(payload)
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

function isRemoteSourceReference(value: string) {
  return (
    /^(?:[a-z][a-z0-9+.-]*:\/\/|[a-z][a-z0-9+.-]*:|[A-Za-z0-9_.-]+:~?\/)/i.test(value) &&
    !/^[A-Za-z]:[\\/]/.test(value)
  );
}

function normalizeSourceUri(sourceKind: ProjectSourceKind, rawUri: string | undefined) {
  if (!rawUri) return rawUri;
  if (sourceKind === "workspace_path") return resolve(rawUri);
  if (sourceKind === "server_path") {
    return isRemoteSourceReference(rawUri) ? rawUri : resolve(rawUri);
  }
  return rawUri;
}

function cliOutputFormat(argv: readonly string[]) {
  const format = argv.includes("--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "text" && format !== "json") throw new Error(`Invalid --format: ${format}`);
  return format;
}

function writeCliPayload(payload: Record<string, unknown>, format: "text" | "json", text: string) {
  process.stdout.write(format === "json" ? `${JSON.stringify(payload, null, 2)}\n` : text);
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
    if (subcommand === "remember") {
      const projectId = parseFlag(argv, "--project-id");
      if (!projectId)
        throw new Error("VALIDATION_ERROR: memory-space remember requires --project-id");
      const text =
        parseFlag(argv, "--text") ??
        positionalArgs(argv)
          .filter((arg) => arg !== "remember")
          .join(" ");
      if (!text.trim()) throw new Error("VALIDATION_ERROR: memory-space remember requires --text");
      const title = parseFlag(argv, "--title") ?? "Manual human memory";
      const memory = await database.createAgentMemory({
        project_id: projectId,
        memory_type: "decision",
        scope: "project",
        scope_kind: "domain",
        scope_id: projectId,
        audience: [{ kind: "owner", id: process.env.RECALLANT_DEVELOPER_ID ?? null }],
        title,
        body: text,
        confidence: 0.9,
        created_by: "user",
        source_refs: [
          {
            source_kind: "external",
            source_id: `manual:${createHash("sha256").update(`${projectId}:${title}:${text}`).digest("hex").slice(0, 16)}`,
            quote: summarizeText(text, 500),
            metadata: {
              source_policy: "manual_owner_supplied",
              memory_space_project_id: projectId
            }
          }
        ],
        metadata: {
          created_from: "recallant_memory_space_remember",
          write_policy: "manual_owner_or_agent_mediated",
          passive_capture: false,
          reversible_via_review_archive: true
        }
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "memory_space_remember",
            project_id: projectId,
            memory,
            writes_database: true,
            passive_capture: false,
            reversible: "review_or_archive"
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
    throw new Error("VALIDATION_ERROR: memory-space supports create|remember|list");
  } finally {
    await database.close();
  }
}

async function runRemoteCredential(argv: readonly string[]) {
  const subcommand = argv[3] ?? "list";
  const format = cliOutputFormat(argv);
  const database = createRecallantDbFromEnv();
  if (!database) {
    throw new Error("RECALLANT_DATABASE_URL is required for remote-credential commands");
  }
  try {
    if (subcommand === "create") {
      const projectId = parseFlag(argv, "--project-id");
      const developerId = parseFlag(argv, "--developer-id");
      if (!projectId || !developerId) {
        throw new Error(
          "VALIDATION_ERROR: remote-credential create requires --project-id and --developer-id"
        );
      }
      const result = await database.createRemoteMcpCredential({
        projectId,
        developerId,
        clientId: parseFlag(argv, "--client-id") ?? null,
        label: parseFlag(argv, "--label") ?? null,
        expiresAt: parseFlag(argv, "--expires-at") ?? null,
        createdBy: "recallant-cli"
      });
      const provisioning = remoteMcpProvisioningOutput({
        action: "create",
        target: remoteCredentialProvisioningTarget(argv),
        serverUrl: remoteCredentialProvisioningServerUrl(argv),
        credential: result.credential,
        bridgeClientId: remoteCredentialProvisioningBridgeClientId(
          argv,
          result.credential.client_id
        ),
        credentialSecret: result.secret,
        includeSecret: true,
        sessionId: parseFlag(argv, "--session-id"),
        traceId: parseFlag(argv, "--trace-id")
      });
      writeCliPayload(
        {
          ok: true,
          action: "remote_credential_create",
          credential: result.credential,
          secret: result.secret,
          provisioning,
          secret_print_policy: "shown_once_create_output_only",
          writes_database: true
        },
        format,
        remoteCredentialProvisioningHumanReport({
          title: "Remote MCP credential created.",
          provisioning
        })
      );
      return;
    }
    if (subcommand === "list") {
      const projectId = parseFlag(argv, "--project-id");
      const developerId = parseFlag(argv, "--developer-id");
      if (!projectId || !developerId) {
        throw new Error(
          "VALIDATION_ERROR: remote-credential list requires --project-id and --developer-id"
        );
      }
      const credentials = await database.listRemoteMcpCredentials({
        projectId,
        developerId,
        clientId: parseFlag(argv, "--client-id") ?? null,
        includeRevoked: argv.includes("--include-revoked")
      });
      const provisioning = credentials.map((credential) =>
        remoteMcpProvisioningOutput({
          action: "list",
          target: remoteCredentialProvisioningTarget(argv),
          serverUrl: remoteCredentialProvisioningServerUrl(argv),
          credential,
          bridgeClientId: remoteCredentialProvisioningBridgeClientId(argv, credential.client_id),
          includeSecret: false,
          sessionId: parseFlag(argv, "--session-id"),
          traceId: parseFlag(argv, "--trace-id")
        })
      );
      writeCliPayload(
        {
          ok: true,
          action: "remote_credential_list",
          count: credentials.length,
          credentials,
          provisioning
        },
        format,
        [
          `Remote MCP credentials: ${credentials.length}`,
          ...credentials.map((credential, index) =>
            [
              `- id: ${credential.id}`,
              `  status: ${credential.status}`,
              `  project_id: ${credential.project_id}`,
              `  developer_id: ${credential.developer_id}`,
              `  client_id: ${credential.client_id ?? ""}`,
              `  credential_prefix: ${credential.credential_prefix}`,
              `  remote_client_bootstrap_command: ${provisioning[index]?.provisioning.command ?? ""}`,
              `  remote_doctor_command: ${provisioning[index]?.provisioning.doctor_command ?? ""}`,
              `  created_at: ${credential.created_at.toISOString()}`,
              `  last_used_at: ${credential.last_used_at?.toISOString() ?? ""}`,
              `  expires_at: ${credential.expires_at?.toISOString() ?? ""}`,
              `  revoked_at: ${credential.revoked_at?.toISOString() ?? ""}`,
              `  rotated_from_credential_id: ${credential.rotated_from_credential_id ?? ""}`
            ].join("\n")
          ),
          ""
        ].join("\n")
      );
      return;
    }
    if (subcommand === "rotate") {
      const credentialId = parseFlag(argv, "--credential-id");
      if (!credentialId) {
        throw new Error("VALIDATION_ERROR: remote-credential rotate requires --credential-id");
      }
      const result = await database.rotateRemoteMcpCredential({
        credentialId,
        expiresAt: parseFlag(argv, "--expires-at") ?? null,
        rotatedBy: "recallant-cli"
      });
      const provisioning = remoteMcpProvisioningOutput({
        action: "rotate",
        target: remoteCredentialProvisioningTarget(argv),
        serverUrl: remoteCredentialProvisioningServerUrl(argv),
        credential: result.credential,
        previousCredential: result.previous,
        bridgeClientId: remoteCredentialProvisioningBridgeClientId(
          argv,
          result.credential.client_id
        ),
        credentialSecret: result.secret,
        includeSecret: true,
        sessionId: parseFlag(argv, "--session-id"),
        traceId: parseFlag(argv, "--trace-id")
      });
      writeCliPayload(
        {
          ok: true,
          action: "remote_credential_rotate",
          previous: result.previous,
          credential: result.credential,
          secret: result.secret,
          provisioning,
          secret_print_policy: "shown_once_rotate_output_only",
          writes_database: true
        },
        format,
        remoteCredentialProvisioningHumanReport({
          title: "Remote MCP credential rotated.",
          provisioning
        })
      );
      return;
    }
    if (subcommand === "revoke") {
      const credentialId = parseFlag(argv, "--credential-id");
      if (!credentialId) {
        throw new Error("VALIDATION_ERROR: remote-credential revoke requires --credential-id");
      }
      const credential = await database.revokeRemoteMcpCredential({
        credentialId,
        revokedBy: "recallant-cli"
      });
      const provisioning = remoteMcpProvisioningOutput({
        action: "revoke",
        target: remoteCredentialProvisioningTarget(argv),
        serverUrl: remoteCredentialProvisioningServerUrl(argv),
        credential,
        bridgeClientId: remoteCredentialProvisioningBridgeClientId(argv, credential.client_id),
        includeSecret: false,
        sessionId: parseFlag(argv, "--session-id"),
        traceId: parseFlag(argv, "--trace-id")
      });
      writeCliPayload(
        {
          ok: true,
          action: "remote_credential_revoke",
          credential,
          provisioning,
          writes_database: true
        },
        format,
        remoteCredentialProvisioningHumanReport({
          title: "Remote MCP credential revoked.",
          provisioning
        })
      );
      return;
    }
    throw new Error("VALIDATION_ERROR: remote-credential supports create|list|rotate|revoke");
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
      const uri = normalizeSourceUri(sourceKind, rawUri);
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

function usageText(command?: string) {
  if (command === "onboard") {
    return [
      "Usage: recallant onboard <project-dir> [--client <codex|cursor|claude-code|generic>] [--install-local-hooks] [--verify] [--dry-run] [--yes] [--format json]",
      "",
      "Beginner flow: prepare private storage, attach the project, configure the agent client, install fail-soft local hooks when supported, prove capture/recall, and print the private Workbench outcome.",
      ""
    ].join("\n");
  }
  if (command === "connect") {
    return [
      "Usage: recallant connect <client> --project-dir <project-dir> [--install-local-hooks] [--dry-run] [--global] [--format json]",
      "",
      "Configure a supported agent client to call `recallant mcp-server` for an attached project.",
      ""
    ].join("\n");
  }
  if (command === "connect-remote") {
    return [
      "Usage: recallant connect-remote <codex|cursor|claude-code|generic> --server-url <https-url> --credential <token> --project-id <id> --developer-id <id> --client-id <id> [--project-dir <path>] [--write] [--session-id <id>] [--trace-id <id>] [--format json|text]",
      "",
      "Preview a supported agent client config that runs `recallant remote-bridge` against a scoped central /api/mcp endpoint without local database access.",
      "Add --write --project-dir <path> to merge the remote MCP config into the project-local client config.",
      ""
    ].join("\n");
  }
  if (command === "remote-doctor") {
    return [
      "Usage: recallant remote-doctor --server-url <https-url> --credential <scoped-token> --project-id <id> --developer-id <id> --client-id <id> [--session-id <id>] [--trace-id <id>] [--timeout-ms <ms>] [--capture-proof] [--format json|text]",
      "",
      "Diagnose HTTPS /api/mcp reachability, edge/access posture, scoped credential auth, project/developer/client scope, MCP initialize, tools/list, and optional capture proof without local database access.",
      "",
      "Example: recallant remote-doctor --server-url https://recallant.example.com --credential <scoped-token> --project-id <project-id> --developer-id <developer-id> --client-id <client-id> --format json",
      ""
    ].join("\n");
  }
  if (command === "remote-acceptance") {
    return [
      "Usage: recallant remote-acceptance --server-url <https-url> --credential <scoped-token> --project-id <id> --developer-id <id> --client-id <id> --project-dir <path> [--capture-proof] [--output-dir <path>]",
      "",
      "Run the external-machine acceptance gate: bootstrap remote client config, remote-doctor, remote MCP session/context/write/checkpoint/recall, and redacted evidence output without local Docker/Postgres.",
      "",
      "Validate a saved evidence file:",
      "  recallant remote-acceptance validate --evidence <path>",
      ""
    ].join("\n");
  }
  if (command === "project-sanitize" || command === "sanitize" || command === "project-purge") {
    return [
      "Usage: recallant project-sanitize [--project-id <id>|--project-dir <dir>] [--mode <detach|purge>] [--detach-mode <live|sandbox>] [--dry-run] [--confirm-token <token>] [--no-local] [--format json|text]",
      "",
      "Preview and confirm project cleanup. Detach hides a project from active Recallant views. Purge is the clean-slate path: it physically removes project-scoped Recallant records, writes a redacted receipt, and disconnects local Recallant artifacts when a project directory is known.",
      "",
      "Dry-run is the default. Confirmed purge requires the exact token printed by the dry-run.",
      ""
    ].join("\n");
  }
  if (command === "audit") {
    return [
      "Usage: recallant audit [--project-id <id>|--project-dir <dir>] [--since <iso>] [--until <iso>] [--surface <name>] [--status <name>] [--limit <n>] [--format json|text]",
      "",
      "Build an owner-readable system activity report from the Recallant audit ledger.",
      ""
    ].join("\n");
  }
  if (command === "recover-embeddings") {
    return [
      "Usage: recallant recover-embeddings [--project-id <id>|--project-dir <dir>] [--limit <n>] [--dry-run] [--format json|text]",
      "",
      "Recover pending project chunk embeddings with a bounded local-model pass. This is project-scoped by default and does not reindex the whole database.",
      ""
    ].join("\n");
  }
  if (command === "remote-credential" || command === "remote-credentials") {
    return [
      "Usage: recallant remote-credential <create|list|rotate|revoke> [--project-id <id>] [--developer-id <id>] [--client-id <id>] [--credential-id <id>] [--label <text>] [--expires-at <iso>] [--server-url <https-url>] [--target <codex|cursor|claude-code|generic>] [--bridge-client-id <id>] [--include-revoked] [--format json|text]",
      "",
      "Create, list, rotate, or revoke scoped remote MCP credentials. Create and rotate print the credential secret only in that command output and include a remote bridge command/config preview; list and revoke never print raw secrets.",
      ""
    ].join("\n");
  }
  if (command === "remote-bridge") {
    return [
      "Usage: recallant remote-bridge --server-url <https-url> --credential <token> --project-id <id> --developer-id <id> --client-id <id> [--session-id <id>] [--trace-id <id>]",
      "",
      "Run a stdio MCP bridge that forwards scoped memory calls to a central Recallant /api/mcp endpoint without local database access.",
      ""
    ].join("\n");
  }
  return "Usage: recallant <mcp-server|remote-bridge|connect-remote|remote-doctor|remote-acceptance|doctor|audit|attach|connect|onboard|recover-embeddings|remote-credential|project-sanitize|detach|memory-space|source|local-cleanup|init|discover|import|lint-context|context|closeout-intent|backup|backup-verify|restore-plan|analyze|cleanup|agent-start|agent-event|agent-checkpoint|agent-closeout|demo-capture|ask|spool-append|spool-status|sync-spool|prune-spool>\n";
}

function wantsHelp(argv: readonly string[]) {
  return argv.includes("--help") || argv.includes("-h");
}

async function main(argv: readonly string[]) {
  const command = argv[2];

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`recallant ${recallantCliVersion}\n`);
    return;
  }
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(usageText());
    return;
  }
  if (wantsHelp(argv)) {
    process.stdout.write(usageText(command));
    return;
  }
  if (command === "mcp-server") {
    await runRecallantStdioServer();
    return;
  }
  if (command === "remote-bridge") {
    await runRecallantRemoteBridge(argv);
    return;
  }
  if (command === "remote-doctor") return runRemoteDoctor(argv);
  if (command === "remote-acceptance") return runRemoteAcceptance(argv);
  if (command === "doctor") return runDoctor(argv);
  if (command === "audit") return runAudit(argv);
  if (command === "attach") return runAttach(argv);
  if (command === "connect") return runConnect(argv);
  if (command === "connect-remote") return runConnectRemote(argv);
  if (command === "onboard") return runOnboard(argv);
  if (command === "recover-embeddings") return runRecoverEmbeddings(argv);
  if (command === "remote-credential" || command === "remote-credentials")
    return runRemoteCredential(argv);
  if (command === "project-sanitize" || command === "sanitize" || command === "project-purge")
    return runProjectSanitize(argv);
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
  if (command === "demo-capture") return runDemoCapture(argv);
  if (command === "ask") return runAsk(argv);
  if (command === "spool-append") return runSpoolAppend(argv);
  if (command === "spool-status") return runSpoolStatus(argv);
  if (command === "sync-spool") return runSyncSpool(argv);
  if (command === "prune-spool") return runPruneSpool(argv);

  process.stderr.write(usageText());
  process.exitCode = 1;
}

const remoteOnlyBootstrap = commandUsesRemoteOnlyBootstrap(process.argv[2]);
if (!remoteOnlyBootstrap) {
  await loadDefaultEnv();
}
const cliAudit = remoteOnlyBootstrap ? null : await startCliAudit(process.argv);
try {
  await main(process.argv);
  await finishCliAudit(process.argv, cliAudit);
} catch (error) {
  await finishCliAudit(process.argv, cliAudit, error);
  throw error;
}
