import type { RecallantDb } from "@recallant/db";

type DashboardRow = Record<string, unknown>;

type DashboardLike = {
  current_project_id?: unknown;
  current_project?: DashboardRow | null;
  projects?: DashboardRow[];
  critical?: DashboardRow | null;
  inbox?: DashboardRow[];
  import_candidates?: DashboardRow[];
  duplicate_conflicts?: DashboardRow[];
  rules?: DashboardRow[];
  costs?: DashboardRow[];
  settings?: DashboardRow[];
  source_filters?: DashboardRow | null;
  project_readiness?: DashboardRow | null;
  recent_activity?: DashboardRow[];
  project_cleanup?: DashboardRow | null;
};

type ChatTargetProject = {
  project_id: string;
  project_name: string;
  current_project_id: string;
  current_project_name: string;
  reason: string;
  switched: boolean;
  ambiguous: boolean;
};

export type ManagementChatLanguage = "en" | "ru";

export type ManagementChatIntent =
  | "status"
  | "next_steps"
  | "cleanup"
  | "settings"
  | "cost"
  | "context_pack"
  | "cross_project"
  | "source_management"
  | "provenance"
  | "review"
  | "global_rule"
  | "connection_check"
  | "memory_summary"
  | "rule_diagnostics"
  | "general";

export type ManagementChatAction = {
  label: string;
  kind: "read_only" | "dry_run" | "confirmation_required";
  command?: string;
  reason: string;
};

export type ManagementChatResultType =
  | "read_only_answer"
  | "safe_action"
  | "dry_run_required"
  | "confirmation_required"
  | "blocked_by_policy"
  | "needs_clarification";

export type ManagementChatResponse = {
  language: ManagementChatLanguage;
  intent: ManagementChatIntent;
  result_type: ManagementChatResultType;
  understanding: {
    source: "local_ai" | "rules";
    model?: string;
    confidence: number;
    summary: string;
    error?: string;
  };
  answer: string;
  confirmation_required: boolean;
  destructive_or_sensitive: boolean;
  policy_block_reason?: string;
  global_rule_result?: {
    status: "created" | "needs_review" | "skipped";
    memory_id?: string;
    rule_text?: string;
    scope?: "developer";
    use_policy?: string;
    reason: string;
  };
  facts: {
    project_id: string;
    project_name: string;
    current_project_id: string;
    current_project_name: string;
    target_project_id: string;
    target_project_name: string;
    target_project_reason: string;
    target_project_switched: boolean;
    target_project_ambiguous: boolean;
    pending_review: number;
    import_candidates: number;
    conflicts_or_duplicates: number;
    active_rules: number;
    pending_paid_approvals: number;
    interrupted_sessions: number;
    capture_ready: boolean;
    last_context_read_at: string;
    last_memory_write_at: string;
    last_checkpoint_at: string;
    capture_events: number;
    captured_decisions: number;
    memory_count: number;
    source_count: number;
    selected_source_name: string;
  };
  proposed_actions: ManagementChatAction[];
};

type ChatInterpretation = {
  source: "local_ai" | "rules";
  model?: string;
  language: ManagementChatLanguage;
  intent: ManagementChatIntent;
  confidence: number;
  summary: string;
  target_hint: "current" | "sandbox" | "none" | "ambiguous";
  destructive_or_sensitive: boolean;
  global_rule_request: boolean;
  rule_text?: string;
  answer?: string;
  error?: string;
};

export async function buildManagementChatResponse(input: {
  message: string;
  dashboard: DashboardLike;
  database?: RecallantDb;
}): Promise<ManagementChatResponse> {
  const message = input.message.trim();
  const dashboard = input.dashboard;
  const interpretation = await interpretMessage(message, dashboard);
  const language = interpretation.language;
  const intent = interpretation.intent;
  const targetProject = resolveTargetProject(message, dashboard, interpretation);
  const facts = dashboardFacts(dashboard, targetProject);
  const policyBlockReason = blockedByPolicyReason(message, language);
  const destructiveOrSensitive =
    Boolean(policyBlockReason) ||
    isDestructiveOrSensitive(message, intent) ||
    interpretation.destructive_or_sensitive;
  const globalRuleResult =
    intent === "global_rule" && !policyBlockReason
      ? await maybeCreateGlobalRule({
          message,
          dashboard,
          facts,
          interpretation,
          database: input.database
        })
      : undefined;
  const confirmationRequired =
    !policyBlockReason && (destructiveOrSensitive || globalRuleResult?.status === "needs_review");
  const resultType = resultTypeForIntent({
    intent,
    targetProject,
    destructiveOrSensitive,
    confirmationRequired,
    policyBlockReason,
    globalRuleResult
  });
  const proposedActions = actionsForIntent(
    intent,
    dashboard,
    facts,
    targetProject,
    language,
    destructiveOrSensitive,
    globalRuleResult,
    policyBlockReason
  );
  const answer = answerForIntent(
    intent,
    facts,
    language,
    destructiveOrSensitive,
    interpretation,
    globalRuleResult,
    policyBlockReason
  );
  return {
    language,
    intent,
    result_type: resultType,
    understanding: {
      source: interpretation.source,
      model: interpretation.model,
      confidence: interpretation.confidence,
      summary: interpretation.summary,
      error: interpretation.error
    },
    answer,
    confirmation_required: confirmationRequired,
    destructive_or_sensitive: destructiveOrSensitive,
    policy_block_reason: policyBlockReason,
    global_rule_result: globalRuleResult,
    facts,
    proposed_actions: proposedActions
  };
}

function detectLanguage(message: string): ManagementChatLanguage {
  return /[а-яё]/iu.test(message) ? "ru" : "en";
}

function includesAny(message: string, words: string[]) {
  const normalized = message.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function detectIntent(message: string): ManagementChatIntent {
  if (!message) return "general";
  if (detectGlobalRuleRequest(message)) return "global_rule";
  if (
    includesAny(message, ["почему", "why"]) &&
    includesAny(message, ["правил", "rule", "applied", "примен"])
  ) {
    return "rule_diagnostics";
  }
  if (
    includesAny(message, ["что", "show", "покажи", "какие"]) &&
    includesAny(message, ["запомн", "remembered", "memorized", "memory"])
  ) {
    return "memory_summary";
  }
  if (
    includesAny(message, ["проверь", "check", "verify", "подключ", "connect", "capture"]) &&
    includesAny(message, ["проект", "project", "норм", "normal", "работ", "recording", "capture"])
  ) {
    return "connection_check";
  }
  if (
    includesAny(message, [
      "удал",
      "отцеп",
      "очист",
      "forget",
      "delete",
      "erase",
      "detach",
      "cleanup",
      "clean up"
    ])
  ) {
    return "cleanup";
  }
  if (includesAny(message, ["стоим", "платн", "api", "cost", "paid", "token", "approval"])) {
    return "cost";
  }
  if (includesAny(message, ["настрой", "setting", "settings", "profile", "route"])) {
    return "settings";
  }
  if (includesAny(message, ["context pack", "контекст", "startup", "запуск", "следующему агент"])) {
    return "context_pack";
  }
  if (
    includesAny(message, [
      "откуда",
      "происхожд",
      "source of",
      "where did",
      "where is this from",
      "provenance",
      "evidence excerpt",
      "evidence excerpts",
      "source ref",
      "source refs"
    ])
  ) {
    return "provenance";
  }
  if (
    includesAny(message, [
      "источник",
      "sources",
      "source",
      "memory space",
      "memory spaces",
      "пространств",
      "подключи папку",
      "подключить папку",
      "attach source",
      "attach folder",
      "создай вирту",
      "virtual space"
    ])
  ) {
    return "source_management";
  }
  if (
    includesAny(message, [
      "других проект",
      "другого проект",
      "cross-project",
      "cross project",
      "similar project",
      "пример",
      "google drive",
      "gdrive",
      "гугл",
      "драйв"
    ])
  ) {
    return "cross_project";
  }
  if (includesAny(message, ["review", "провер", "кандидат", "правил", "memory", "памят"])) {
    return "review";
  }
  if (includesAny(message, ["что дальше", "next", "следующ", "делать", "recommend", "рекоменду"])) {
    return "next_steps";
  }
  if (includesAny(message, ["status", "статус", "состоя", "health"])) return "status";
  return "general";
}

function detectGlobalRuleRequest(message: string) {
  const normalized = message.toLowerCase();
  const wantsRule = includesAny(normalized, [
    "зафикс",
    "сохрани",
    "запомни",
    "правило",
    "rule",
    "remember",
    "save"
  ]);
  const wantsGlobal = includesAny(normalized, [
    "для всех проектов",
    "во всех проектах",
    "всех проектов",
    "везде",
    "global",
    "all projects",
    "every project",
    "developer-wide"
  ]);
  return wantsRule && wantsGlobal;
}

function fallbackInterpretation(message: string): ChatInterpretation {
  const language = detectLanguage(message);
  const intent = detectIntent(message);
  return {
    source: "rules",
    language,
    intent,
    confidence: message ? 0.55 : 0.3,
    summary:
      language === "ru"
        ? "Понято локальными правилами без AI-модели."
        : "Understood by local rules without an AI model.",
    target_hint: messageWantsSandbox(message) ? "sandbox" : "current",
    destructive_or_sensitive: isDestructiveOrSensitive(message, intent),
    global_rule_request: intent === "global_rule",
    rule_text: intent === "global_rule" ? extractRuleText(message) : undefined
  };
}

function aiEnabled() {
  return !["0", "false", "off", "disabled"].includes(
    String(process.env.RECALLANT_MANAGEMENT_CHAT_AI ?? "on").toLowerCase()
  );
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function normalizeIntent(value: unknown, fallback: ManagementChatIntent): ManagementChatIntent {
  const candidate = String(value ?? "");
  const allowed: ManagementChatIntent[] = [
    "status",
    "next_steps",
    "cleanup",
    "settings",
    "cost",
    "context_pack",
    "cross_project",
    "source_management",
    "provenance",
    "review",
    "global_rule",
    "connection_check",
    "memory_summary",
    "rule_diagnostics",
    "general"
  ];
  return allowed.includes(candidate as ManagementChatIntent)
    ? (candidate as ManagementChatIntent)
    : fallback;
}

function normalizeLanguage(value: unknown, fallback: ManagementChatLanguage) {
  return value === "ru" || value === "en" ? value : fallback;
}

function normalizeTargetHint(value: unknown, fallback: ChatInterpretation["target_hint"]) {
  return value === "current" || value === "sandbox" || value === "none" || value === "ambiguous"
    ? value
    : fallback;
}

async function interpretMessage(
  message: string,
  dashboard: DashboardLike
): Promise<ChatInterpretation> {
  const fallback = fallbackInterpretation(message);
  if (!message || !aiEnabled()) return fallback;

  const configuredModel =
    process.env.RECALLANT_MANAGEMENT_CHAT_MODEL ?? process.env.RECALLANT_CHAT_MODEL;
  const models = Array.from(
    new Set(
      [configuredModel, "mistral-small:24b", "qwen2.5-coder:14b", "qwen2.5-coder:7b"].filter(
        (item): item is string => Boolean(item)
      )
    )
  );
  const url = process.env.RECALLANT_OLLAMA_URL ?? "http://127.0.0.1:11434";
  const timeoutMs = Number(process.env.RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS ?? 65_000);
  let lastError: string | undefined;
  try {
    const projects = asRows(dashboard.projects)
      .slice(0, 20)
      .map((project) => ({
        project_id: projectId(project, ""),
        name: projectName(project, ""),
        primary_path: stringValue(project.primary_path)
      }));
    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(new URL("/api/chat", url), {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: "json",
            keep_alive: process.env.RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE ?? "10m",
            messages: [
              {
                role: "system",
                content: [
                  "You are Recallant's local intent interpreter for a private memory-management UI.",
                  "Return strict JSON only.",
                  "Do not execute actions.",
                  "Classify the owner's message by meaning, including Russian text and typos.",
                  "Use these intents only: status,next_steps,cleanup,settings,cost,context_pack,cross_project,source_management,provenance,review,global_rule,connection_check,memory_summary,rule_diagnostics,general.",
                  "Set global_rule_request=true only when the owner asks to save a rule for all projects/everywhere/developer-wide.",
                  "Set destructive_or_sensitive=true for delete/detach/erase/secrets/public access/paid API/deploy/security/model-provider changes.",
                  "target_hint should be current,sandbox,none,or ambiguous.",
                  "If this is a global rule request, extract rule_text as the instruction that should apply across projects.",
                  "Keep answer short and factual. Safety policy will be enforced by deterministic code."
                ].join(" ")
              },
              {
                role: "user",
                content: JSON.stringify({
                  message,
                  current_project: dashboard.current_project ?? null,
                  projects
                })
              }
            ]
          })
        });
        if (!response.ok) throw new Error(`Ollama ${model} HTTP ${response.status}`);
        const payload = (await response.json()) as { message?: { content?: string } };
        const parsed = parseJsonObject(String(payload.message?.content ?? ""));
        const intent = normalizeIntent(parsed.intent, fallback.intent);
        const language = normalizeLanguage(parsed.language, fallback.language);
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
        return {
          source: "local_ai",
          model,
          language,
          intent,
          confidence,
          summary:
            stringValue(parsed.summary) ||
            (language === "ru"
              ? "Понято локальной AI-моделью."
              : "Understood by the local AI model."),
          target_hint: normalizeTargetHint(parsed.target_hint, fallback.target_hint),
          destructive_or_sensitive: Boolean(parsed.destructive_or_sensitive),
          global_rule_request: Boolean(parsed.global_rule_request) || intent === "global_rule",
          rule_text:
            typeof parsed.rule_text === "string" && parsed.rule_text.trim()
              ? parsed.rule_text.trim()
              : fallback.rule_text,
          answer:
            typeof parsed.answer === "string" && parsed.answer.trim()
              ? parsed.answer.trim()
              : undefined
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(lastError ?? "No local chat model succeeded");
  } catch (error) {
    return {
      ...fallback,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isDestructiveOrSensitive(message: string, intent: ManagementChatIntent) {
  if (intent === "cleanup") return true;
  return includesAny(message, [
    "навсегда",
    "permanent",
    "forever",
    "секрет",
    "secret",
    "security",
    "deploy",
    "deployment",
    "public",
    "cloudflare",
    "firewall",
    "paid api",
    "auto_with_caps",
    "connector",
    "account",
    "global setting",
    "developer setting",
    "model",
    "provider",
    "безопас",
    "деплой",
    "публич",
    "коннектор",
    "аккаунт",
    "глобаль",
    "модель",
    "провайдер"
  ]);
}

function blockedByPolicyReason(message: string, language: ManagementChatLanguage) {
  const asksToRevealSecret =
    includesAny(message, [
      "show secret",
      "print secret",
      "read secret",
      "reveal secret",
      "show password",
      "print password",
      "read password",
      "show token",
      "print token",
      "read token",
      "show api key",
      "print api key",
      "read api key",
      "покажи секрет",
      "выведи секрет",
      "прочитай секрет",
      "раскрой секрет",
      "покажи пароль",
      "выведи пароль",
      "прочитай пароль",
      "покажи токен",
      "выведи токен",
      "прочитай токен",
      "покажи api key",
      "выведи api key"
    ]) ||
    (includesAny(message, [
      "secret",
      "password",
      "token",
      "api key",
      "секрет",
      "пароль",
      "токен"
    ]) &&
      includesAny(message, [
        "show",
        "print",
        "read",
        "reveal",
        "покажи",
        "выведи",
        "прочитай",
        "раскрой"
      ]));
  if (!asksToRevealSecret) return undefined;
  return language === "ru"
    ? "Recallant не раскрывает секреты, пароли, токены или API keys из памяти или настроек. Можно проверить, что ссылка на секрет существует, но не показывать значение."
    : "Recallant does not reveal secrets, passwords, tokens, or API keys from memory or settings. It can verify that a secret reference exists, but it must not show the value.";
}

function resultTypeForIntent(input: {
  intent: ManagementChatIntent;
  targetProject: ChatTargetProject;
  destructiveOrSensitive: boolean;
  confirmationRequired: boolean;
  policyBlockReason?: string;
  globalRuleResult?: ManagementChatResponse["global_rule_result"];
}): ManagementChatResultType {
  if (input.policyBlockReason) return "blocked_by_policy";
  if (input.targetProject.ambiguous && input.destructiveOrSensitive) return "needs_clarification";
  if (input.intent === "global_rule") {
    if (input.globalRuleResult?.status === "created") return "safe_action";
    if (input.globalRuleResult?.status === "needs_review") return "confirmation_required";
    return "needs_clarification";
  }
  if (input.destructiveOrSensitive && input.intent === "cleanup") return "dry_run_required";
  if (input.confirmationRequired) return "confirmation_required";
  return "read_only_answer";
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function asRows(value: unknown) {
  return Array.isArray(value) ? (value as DashboardRow[]) : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DashboardRow) : {};
}

function projectId(row: DashboardRow | null | undefined, fallback: unknown) {
  return String(row?.project_id ?? row?.id ?? fallback ?? "");
}

function projectName(row: DashboardRow | null | undefined, fallback: unknown) {
  return (
    stringValue(row?.name) ||
    stringValue(row?.title) ||
    stringValue(row?.primary_path) ||
    shortId(row?.project_id ?? row?.id ?? fallback)
  );
}

function messageWantsSandbox(message: string, interpretation?: ChatInterpretation) {
  return (
    interpretation?.target_hint === "sandbox" ||
    includesAny(message, ["sandbox", "песочн", "тестов", "test project", "pilot"])
  );
}

function isSandboxProject(row: DashboardRow) {
  const name = projectName(row, row.project_id).toLowerCase();
  const path = stringValue(row.primary_path).toLowerCase();
  const kind = stringValue(row.project_kind).toLowerCase();
  return (
    name.includes("sandbox") ||
    name.includes("pilot") ||
    path.includes("/recallant-pilots/") ||
    path.includes("sandbox") ||
    kind.includes("sandbox")
  );
}

function resolveTargetProject(
  message: string,
  dashboard: DashboardLike,
  interpretation?: ChatInterpretation
): ChatTargetProject {
  const projects = asRows(dashboard.projects);
  const currentProject = dashboard.current_project ?? {};
  const currentProjectId = projectId(currentProject, dashboard.current_project_id);
  const currentProjectName = projectName(currentProject, dashboard.current_project_id);
  const currentTarget = {
    project_id: currentProjectId,
    project_name: currentProjectName || "current project",
    current_project_id: currentProjectId,
    current_project_name: currentProjectName || "current project",
    reason: "current_project",
    switched: false,
    ambiguous: false
  };

  if (!messageWantsSandbox(message, interpretation) || isSandboxProject(currentProject)) {
    return currentTarget;
  }

  const sandboxProjects = projects.filter(isSandboxProject);
  if (sandboxProjects.length === 1) {
    const target = sandboxProjects[0] ?? {};
    return {
      project_id: projectId(target, currentProjectId),
      project_name: projectName(target, currentProjectId) || "sandbox project",
      current_project_id: currentProjectId,
      current_project_name: currentProjectName || "current project",
      reason: "message_asked_for_sandbox",
      switched: true,
      ambiguous: false
    };
  }

  return {
    ...currentTarget,
    reason: sandboxProjects.length > 1 ? "multiple_sandbox_projects" : "sandbox_project_not_found",
    ambiguous: true
  };
}

function dashboardFacts(
  dashboard: DashboardLike,
  targetProject: ChatTargetProject
): ManagementChatResponse["facts"] {
  const currentProject = dashboard.current_project ?? {};
  const critical = dashboard.critical ?? {};
  const readiness = dashboard.project_readiness ?? {};
  const lastContextRead = stringValue(readiness.last_context_read_at);
  const lastMemoryWrite = stringValue(readiness.last_memory_write_at);
  const lastCheckpoint = stringValue(readiness.checkpoint_updated_at);
  const captureReady = Boolean(lastContextRead && lastMemoryWrite && lastCheckpoint);
  const sourceFilters = dashboard.source_filters ?? {};
  const sources = asRows(sourceFilters.sources);
  const selectedSource = asRecord(sourceFilters.selected_source);
  const selectedSourceName =
    stringValue(selectedSource.display_label) ||
    stringValue(selectedSource.label) ||
    stringValue(selectedSource.uri) ||
    "all sources";
  return {
    project_id: targetProject.project_id,
    project_name: targetProject.project_name,
    current_project_id: projectId(currentProject, dashboard.current_project_id),
    current_project_name: projectName(currentProject, dashboard.current_project_id),
    target_project_id: targetProject.project_id,
    target_project_name: targetProject.project_name,
    target_project_reason: targetProject.reason,
    target_project_switched: targetProject.switched,
    target_project_ambiguous: targetProject.ambiguous,
    pending_review: asNumber(critical.pending_review),
    import_candidates: asRows(dashboard.import_candidates).length,
    conflicts_or_duplicates: asRows(dashboard.duplicate_conflicts).length,
    active_rules: asRows(dashboard.rules).length,
    pending_paid_approvals: asNumber(critical.pending_paid_approvals),
    interrupted_sessions: asNumber(critical.interrupted_sessions),
    capture_ready: captureReady,
    last_context_read_at: lastContextRead || "not yet",
    last_memory_write_at: lastMemoryWrite || "not yet",
    last_checkpoint_at: lastCheckpoint || "not yet",
    capture_events: asNumber(readiness.capture_event_count),
    captured_decisions: asNumber(readiness.captured_decision_count),
    memory_count: asNumber(currentProject.memory_count),
    source_count: sources.length,
    selected_source_name: selectedSourceName
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function shortId(value: unknown) {
  return String(value ?? "").slice(0, 8);
}

function extractRuleText(message: string) {
  return message
    .replace(/зафиксируй/giu, "")
    .replace(/сохрани/giu, "")
    .replace(/запомни/giu, "")
    .replace(/правило/giu, "")
    .replace(/для всех проектов/giu, "")
    .replace(/во всех проектах/giu, "")
    .replace(/всех проектов/giu, "")
    .replace(/from now on/giu, "")
    .replace(/save this rule/giu, "")
    .replace(/remember this rule/giu, "")
    .replace(/for all projects/giu, "")
    .replace(/all projects/giu, "")
    .replace(/developer-wide/giu, "")
    .replace(/[:：-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleTitle(ruleText: string, language: ManagementChatLanguage) {
  const compact = ruleText.replace(/\s+/g, " ").trim();
  const prefix = language === "ru" ? "Правило для всех проектов" : "Rule for all projects";
  return `${prefix}: ${compact.slice(0, 80) || "owner guidance"}`;
}

function currentProjectPath(dashboard: DashboardLike) {
  return (
    stringValue(dashboard.current_project?.primary_path) ||
    stringValue(dashboard.current_project?.path) ||
    process.env.RECALLANT_PROJECT_PATH ||
    "/ai/recallant"
  );
}

async function maybeCreateGlobalRule(input: {
  message: string;
  dashboard: DashboardLike;
  facts: ManagementChatResponse["facts"];
  interpretation: ChatInterpretation;
  database?: RecallantDb;
}): Promise<ManagementChatResponse["global_rule_result"]> {
  const ruleText = (
    input.interpretation.rule_text?.trim() || extractRuleText(input.message)
  ).trim();
  if (!ruleText) {
    return {
      status: "skipped",
      scope: "developer",
      reason: "No usable rule text was found in the owner message."
    };
  }
  if (!input.database) {
    return {
      status: "skipped",
      scope: "developer",
      rule_text: ruleText,
      reason: "Database is unavailable, so the rule was not saved."
    };
  }
  const created = await input.database.createAgentMemory({
    project_path: currentProjectPath(input.dashboard),
    memory_type: "procedure",
    scope: "developer",
    scope_kind: "developer",
    scope_id: null,
    audience: [{ kind: "all_agents", id: null }],
    title: ruleTitle(ruleText, input.interpretation.language),
    body: ruleText,
    confidence: 1,
    created_by: "user",
    metadata: {
      management_chat: true,
      owner_confirmed_global_rule: true,
      source_project_id: input.facts.current_project_id,
      source_project_name: input.facts.current_project_name,
      source_message: input.message
    }
  });
  return {
    status: created.use_policy === "instruction_grade" ? "created" : "needs_review",
    memory_id: created.memory_id,
    rule_text: ruleText,
    scope: "developer",
    use_policy: created.use_policy,
    reason:
      created.use_policy === "instruction_grade"
        ? "Owner explicitly requested a developer-wide rule; it is active for future context packs."
        : "The rule was saved but still needs review before becoming binding."
  };
}

function answerForIntent(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  language: ManagementChatLanguage,
  destructiveOrSensitive: boolean,
  interpretation: ChatInterpretation,
  globalRuleResult?: ManagementChatResponse["global_rule_result"],
  policyBlockReason?: string
) {
  if (language === "ru")
    return answerRu(
      intent,
      facts,
      destructiveOrSensitive,
      interpretation,
      globalRuleResult,
      policyBlockReason
    );
  return answerEn(
    intent,
    facts,
    destructiveOrSensitive,
    interpretation,
    globalRuleResult,
    policyBlockReason
  );
}

function targetLineRu(facts: ManagementChatResponse["facts"]) {
  if (facts.target_project_ambiguous) {
    return `Открытый проект: ${facts.current_project_name}. Запрос похож на sandbox, но целевой sandbox-проект не определен однозначно.`;
  }
  if (facts.target_project_switched) {
    return `Открытый проект: ${facts.current_project_name}. Целевой проект для этого запроса: ${facts.target_project_name}.`;
  }
  return `Проект: ${facts.project_name}.`;
}

function targetLineEn(facts: ManagementChatResponse["facts"]) {
  if (facts.target_project_ambiguous) {
    return `Open project: ${facts.current_project_name}. The request looks sandbox-related, but the target sandbox project is not unambiguous.`;
  }
  if (facts.target_project_switched) {
    return `Open project: ${facts.current_project_name}. Target project for this request: ${facts.target_project_name}.`;
  }
  return `Project: ${facts.project_name}.`;
}

function answerRu(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  destructiveOrSensitive: boolean,
  interpretation: ChatInterpretation,
  globalRuleResult?: ManagementChatResponse["global_rule_result"],
  policyBlockReason?: string
) {
  const baseline = `${targetLineRu(facts)} На проверке: ${facts.pending_review}, импорт-кандидатов: ${facts.import_candidates}, конфликтов/дубликатов: ${facts.conflicts_or_duplicates}, активных правил: ${facts.active_rules}.`;
  if (policyBlockReason) {
    return `${baseline}\n\n${policyBlockReason}`;
  }
  if (intent === "global_rule") {
    if (globalRuleResult?.status === "created") {
      return `${baseline}\n\nЯ понял это как правило для всех проектов и сохранил его как активное developer-wide правило. Новые агентские сессии в подключенных проектах будут получать его в стартовом Context Pack как обязательное правило.\n\nПравило: ${globalRuleResult.rule_text}`;
    }
    if (globalRuleResult?.status === "needs_review") {
      return `${baseline}\n\nЯ понял это как правило для всех проектов, но оно затрагивает рискованную область. Я сохранил его для review, но не сделал обязательным для всех агентов до подтверждения.\n\nПравило: ${globalRuleResult.rule_text}`;
    }
    return `${baseline}\n\nЯ понял запрос как правило для всех проектов, но не смог сохранить его автоматически: ${globalRuleResult?.reason ?? "нет текста правила"}.`;
  }
  if (facts.target_project_ambiguous && destructiveOrSensitive) {
    return `${baseline}\n\nЯ не буду подставлять открытый проект в опасную команду, потому что запрос похож на sandbox cleanup, а целевой sandbox-проект не выбран однозначно. Сначала выбери нужный проект слева или уточни название.`;
  }
  if (destructiveOrSensitive) {
    const switchNote = facts.target_project_switched
      ? " Я не подставляю открытый проект в команду, потому что запрос явно похож на sandbox cleanup."
      : "";
    return `${baseline}\n\nЭто похоже на действие, которое может удалить, отцепить проект, открыть доступ, затронуть секреты или расходы.${switchNote} Я не выполняю такие действия прямо из чата. Сначала нужна предварительная проверка без изменений, затем явное подтверждение через обычный безопасный путь Recallant.`;
  }
  switch (intent) {
    case "next_steps":
      if (facts.pending_review > 0) {
        return `${baseline}\n\nСледующий оптимальный шаг: разобрать Review Inbox. Начни с импортированных кандидатов и конфликтов, оставляя старые проектные файлы как evidence-only, пока ты явно не решишь сделать из них активные правила.`;
      }
      return `${baseline}\n\nСрочных решений нет. Следующий полезный шаг: запустить обычную рабочую сессию агента и проверить, что он берет стартовый контекст из Recallant без ручного чтения старых логов.`;
    case "cleanup":
      return `${baseline}\n\nДля очистки безопасный порядок такой: сначала предварительная проверка без изменений, потом подтверждение. Обычное отцепление проекта не удаляет память навсегда; чувствительную или ошибочную память нужно отправлять в отдельный workflow полного удаления.`;
    case "settings":
      return `${baseline}\n\nНастройки проекта управляются на стороне Recallant. Опасные изменения, например paid API auto mode или сильное расширение capture/context, должны идти через подтверждение и audit.`;
    case "cost":
      if (facts.pending_paid_approvals > 0) {
        return `${baseline}\n\nЕсть ожидающие paid API approvals: ${facts.pending_paid_approvals}. Пока они не подтверждены, Recallant не должен делать платные вызовы автоматически.`;
      }
      return `${baseline}\n\nОжидающих paid API approvals нет. Если режим paid_api_mode = confirm_each, платные вызовы остаются заблокированы до явного подтверждения.`;
    case "context_pack":
      return `${baseline}\n\nContext Pack должен быть коротким стартовым пакетом для агента: активные правила, последние важные решения, checkpoint и подсказки что запросить дальше. Он не должен тащить всю историю проекта в окно контекста.`;
    case "cross_project":
      return `${baseline}\n\nCross-project recall работает как библиотека примеров, а не как смешанная каша памяти. Агент может попросить примеры из других проектов, но они остаются source-linked evidence, пока их явно не применили к текущему проекту.`;
    case "source_management":
      return `${baseline}\n\nВ этом memory space сейчас подключено источников: ${facts.source_count}. Источники управляются в Memory Spaces: можно создать виртуальное пространство, подключить папку/репозиторий/документы/ручной источник и отцепить один source без удаления памяти проекта. Для connector/server-path источников Recallant должен показывать health/status и не хранить raw secrets.`;
    case "provenance":
      return `${baseline}\n\nИсточник факта показывается как provenance. В списках Review смотри строку вроде “From source ...”; в выбранной памяти открой Evidence excerpts. Если источник выбран фильтром, сейчас выбран: ${facts.selected_source_name}.`;
    case "review":
      return `${baseline}\n\nReview нужен только для важных или рискованных вещей: кандидаты в правила, конфликты, дубликаты, high-risk guidance и imported history. Обычные низкорисковые воспоминания не должны превращаться в ручную очередь.`;
    case "connection_check":
      return `${baseline}\n\nПроверка подключения: ${
        facts.capture_ready
          ? "проект не просто зарегистрирован, а уже пишет рабочую память через Recallant."
          : "проект зарегистрирован, но полный capture loop еще не доказан."
      }\n\nПоследний context read: ${facts.last_context_read_at}. Последняя запись памяти: ${facts.last_memory_write_at}. Последний checkpoint: ${facts.last_checkpoint_at}. Событий capture: ${facts.capture_events}, решений: ${facts.captured_decisions}.`;
    case "memory_summary":
      return `${baseline}\n\nВ этом memory space сейчас видно ${facts.memory_count} воспоминаний, ${facts.capture_events} capture-событий и ${facts.captured_decisions} сохраненных решений. Для быстрого просмотра смотри Activity / Replay; для вещей, которые могут стать правилами или требуют решения владельца, смотри Review.`;
    case "rule_diagnostics":
      return `${baseline}\n\nЕсли правило не применяется, проверь три вещи: оно должно быть Active rule, его scope должен подходить этому проекту или всем проектам, и новая агентская сессия должна получить свежий Context Pack. Если правило только evidence-only, candidate, stale или needs review, агент может видеть его как факт, но не обязан выполнять как правило.`;
    case "status":
    case "general":
      if (interpretation.source === "local_ai" && interpretation.answer) {
        return `${baseline}\n\n${interpretation.answer}`;
      }
      return `${baseline}\n\nСистема готова для управляемой проверки этого проекта. Если хочешь действовать безопасно, сначала разбираем review/конфликты, потом проверяем старт агента через context pack.`;
  }
}

function answerEn(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  destructiveOrSensitive: boolean,
  interpretation: ChatInterpretation,
  globalRuleResult?: ManagementChatResponse["global_rule_result"],
  policyBlockReason?: string
) {
  const baseline = `${targetLineEn(facts)} Pending review: ${facts.pending_review}, import candidates: ${facts.import_candidates}, conflicts/duplicates: ${facts.conflicts_or_duplicates}, active rules: ${facts.active_rules}.`;
  if (policyBlockReason) {
    return `${baseline}\n\n${policyBlockReason}`;
  }
  if (intent === "global_rule") {
    if (globalRuleResult?.status === "created") {
      return `${baseline}\n\nI understood this as a rule for all projects and saved it as an active developer-wide rule. New agent sessions in connected projects will receive it in the startup Context Pack as binding guidance.\n\nRule: ${globalRuleResult.rule_text}`;
    }
    if (globalRuleResult?.status === "needs_review") {
      return `${baseline}\n\nI understood this as a rule for all projects, but it touches a risky area. I saved it for review and did not make it binding for all agents yet.\n\nRule: ${globalRuleResult.rule_text}`;
    }
    return `${baseline}\n\nI understood this as a rule for all projects, but could not save it automatically: ${globalRuleResult?.reason ?? "no usable rule text"}.`;
  }
  if (facts.target_project_ambiguous && destructiveOrSensitive) {
    return `${baseline}\n\nI will not substitute the open project into a risky command because the request looks sandbox-related and the target sandbox project is not unambiguous. Select the target project on the left or name it explicitly first.`;
  }
  if (destructiveOrSensitive) {
    const switchNote = facts.target_project_switched
      ? " I am not using the open project for the command because the request explicitly looks sandbox-related."
      : "";
    return `${baseline}\n\nThis looks like an operation that can delete, detach, expose access, touch secrets, or affect cost.${switchNote} I will not execute it directly from chat. Run a dry-run first, then confirm through the normal Recallant policy path.`;
  }
  switch (intent) {
    case "next_steps":
      if (facts.pending_review > 0) {
        return `${baseline}\n\nRecommended next step: clear the Review Inbox, starting with imported candidates and conflicts. Keep old project files as evidence-only unless you explicitly promote them into active rules.`;
      }
      return `${baseline}\n\nNo urgent decisions are waiting. The next useful step is to start an agent session and verify that it gets startup context from Recallant without manually reading old logs.`;
    case "cleanup":
      return `${baseline}\n\nSafe cleanup order: dry-run first, then confirmation. Ordinary detach does not permanently erase memory; sensitive or wrong memory belongs in the separate forget-forever workflow.`;
    case "settings":
      return `${baseline}\n\nProject settings are managed centrally in Recallant. Dangerous changes, such as paid API auto mode or large capture/context increases, must go through confirmation and audit.`;
    case "cost":
      if (facts.pending_paid_approvals > 0) {
        return `${baseline}\n\nThere are pending paid API approvals: ${facts.pending_paid_approvals}. Recallant should not make paid calls automatically until they are approved.`;
      }
      return `${baseline}\n\nThere are no pending paid API approvals. With paid_api_mode = confirm_each, paid calls remain blocked until explicitly confirmed.`;
    case "context_pack":
      return `${baseline}\n\nThe Context Pack should be a compact startup packet for the agent: active rules, important recent decisions, checkpoint, and suggested next fetches. It should not load the whole project history into context.`;
    case "cross_project":
      return `${baseline}\n\nCross-project recall is a library of examples, not mixed memory soup. Agents can ask for examples from other projects, but those results stay source-linked evidence until applied to the current project.`;
    case "source_management":
      return `${baseline}\n\nThis memory space currently has ${facts.source_count} attached source(s). Manage them in Memory Spaces: create a virtual space, attach a folder/repo/doc/manual source, or detach one source without deleting project memory. Connector/server-path sources should show health/status and must not store raw secrets.`;
    case "provenance":
      return `${baseline}\n\nFact origin is shown as provenance. In Review lists, look for “From source ...”; in the selected memory, open Evidence excerpts. If a source filter is active, the selected source is: ${facts.selected_source_name}.`;
    case "review":
      return `${baseline}\n\nReview is for important or risky material: rule candidates, conflicts, duplicates, high-risk guidance, and imported history. Low-risk routine memories should not become manual queue work.`;
    case "connection_check":
      return `${baseline}\n\nConnection check: ${
        facts.capture_ready
          ? "this project is not merely registered; it has recorded working memory through Recallant."
          : "this project is registered, but the full capture loop is not proven yet."
      }\n\nLast context read: ${facts.last_context_read_at}. Last memory write: ${facts.last_memory_write_at}. Last checkpoint: ${facts.last_checkpoint_at}. Capture events: ${facts.capture_events}, decisions: ${facts.captured_decisions}.`;
    case "memory_summary":
      return `${baseline}\n\nThis memory space currently shows ${facts.memory_count} memories, ${facts.capture_events} capture events, and ${facts.captured_decisions} captured decisions. Use Activity / Replay for the latest captured work; use Review for items that may become rules or need an owner decision.`;
    case "rule_diagnostics":
      return `${baseline}\n\nIf a rule is not applying, check three things: it must be an Active rule, its scope must match this project or all projects, and the next agent session must receive a fresh Context Pack. Evidence-only, candidate, stale, or needs-review records can be visible as facts, but they are not binding behavior.`;
    case "status":
    case "general":
      if (interpretation.source === "local_ai" && interpretation.answer) {
        return `${baseline}\n\n${interpretation.answer}`;
      }
      return `${baseline}\n\nThis project is ready for managed review. The safe order is review/conflicts first, then verify agent startup through the context pack.`;
  }
}

function actionsForIntent(
  intent: ManagementChatIntent,
  dashboard: DashboardLike,
  facts: ManagementChatResponse["facts"],
  targetProject: ChatTargetProject,
  language: ManagementChatLanguage,
  destructiveOrSensitive: boolean,
  globalRuleResult?: ManagementChatResponse["global_rule_result"],
  policyBlockReason?: string
): ManagementChatAction[] {
  if (policyBlockReason) {
    return [
      {
        label: language === "ru" ? "Проверить только наличие ссылки" : "Check reference only",
        kind: "read_only",
        reason: policyBlockReason
      }
    ];
  }
  if (intent === "global_rule") {
    return [
      {
        label:
          language === "ru"
            ? globalRuleResult?.status === "created"
              ? "Правило активно для всех проектов"
              : "Проверить правило перед активацией"
            : globalRuleResult?.status === "created"
              ? "Rule active for all projects"
              : "Review rule before activation",
        kind: globalRuleResult?.status === "created" ? "read_only" : "confirmation_required",
        reason:
          language === "ru"
            ? globalRuleResult?.status === "created"
              ? "Правило сохранено в developer-scope как instruction_grade и попадет в будущие Context Packs."
              : "Широкое или рискованное правило не становится обязательным без review."
            : globalRuleResult?.status === "created"
              ? "The rule is saved in developer scope as instruction_grade and will appear in future Context Packs."
              : "Broad or risky rules do not become binding without review."
      }
    ];
  }
  if (destructiveOrSensitive || intent === "cleanup") {
    if (targetProject.ambiguous) {
      return [
        {
          label: language === "ru" ? "Уточнить целевой проект" : "Clarify target project",
          kind: "read_only",
          reason:
            language === "ru"
              ? "Запрос похож на sandbox cleanup, но Recallant не должен подставлять открытый проект в опасную команду."
              : "The request looks sandbox-related, and Recallant should not put the open project into a risky command."
        }
      ];
    }
    const cleanup = dashboard.project_cleanup ?? {};
    const detachCommand =
      targetProject.project_id === facts.current_project_id
        ? stringValue(cleanup.detach_command)
        : `recallant detach --project-id ${targetProject.project_id} --dry-run`;
    return [
      {
        label:
          language === "ru"
            ? "Сначала предварительная проверка detach"
            : "Run detach dry-run first",
        kind: "dry_run",
        command: detachCommand,
        reason:
          language === "ru"
            ? `Показывает, что будет затронуто в проекте ${targetProject.project_name}, без изменения данных.`
            : `Shows what would be affected in ${targetProject.project_name} without changing data.`
      },
      {
        label:
          language === "ru" ? "Полное удаление только отдельно" : "Use forget forever separately",
        kind: "confirmation_required",
        reason:
          language === "ru"
            ? "Постоянное удаление чувствительной или ошибочной памяти требует отдельного подтверждения."
            : "Permanent erasure of sensitive or wrong memory requires a separate confirmation."
      }
    ];
  }

  if (intent === "cost") {
    return [
      {
        label: language === "ru" ? "Проверить Cost / Paid API" : "Review Cost / Paid API",
        kind: "read_only",
        reason:
          language === "ru"
            ? `Ожидающих paid approvals: ${facts.pending_paid_approvals}.`
            : `Pending paid approvals: ${facts.pending_paid_approvals}.`
      }
    ];
  }

  if (intent === "source_management") {
    return [
      {
        label: language === "ru" ? "Открыть Memory Spaces" : "Open Memory Spaces",
        kind: "read_only",
        reason:
          language === "ru"
            ? "Там можно создать virtual memory space, attach source или detach source без удаления памяти."
            : "Use it to create a virtual memory space, attach a source, or detach a source without deleting memory."
      }
    ];
  }

  if (intent === "provenance") {
    return [
      {
        label: language === "ru" ? "Открыть Evidence excerpts" : "Open Evidence excerpts",
        kind: "read_only",
        reason:
          language === "ru"
            ? `Показывает source refs/provenance. Текущий source filter: ${facts.selected_source_name}.`
            : `Shows source refs and provenance. Current source filter: ${facts.selected_source_name}.`
      }
    ];
  }

  if (facts.pending_review > 0) {
    return [
      {
        label: language === "ru" ? "Открыть первый Review item" : "Open the first review item",
        kind: "read_only",
        reason:
          language === "ru"
            ? "Это ближайшее безопасное решение владельца."
            : "This is the nearest safe owner decision."
      }
    ];
  }

  return [
    {
      label: language === "ru" ? "Проверить context pack" : "Check the context pack",
      kind: "read_only",
      reason:
        language === "ru"
          ? "Показывает, что получит следующий агент на старте."
          : "Shows what the next agent will receive at startup."
    }
  ];
}
