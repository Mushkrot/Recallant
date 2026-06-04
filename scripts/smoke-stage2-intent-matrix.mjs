import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const currentProjectId = "11111111-1111-4111-8111-111111111111";
const sandboxProjectId = "22222222-2222-4222-8222-222222222222";

const dashboard = {
  current_project_id: currentProjectId,
  current_project: {
    project_id: currentProjectId,
    name: "recallant",
    primary_path: "/ai/recallant",
    memory_count: 3
  },
  projects: [
    { project_id: currentProjectId, name: "recallant", primary_path: "/ai/recallant" },
    {
      project_id: sandboxProjectId,
      name: "recallant sandbox",
      primary_path: "/ai/recallant-pilots/recallant-sandbox"
    }
  ],
  critical: {
    pending_review: 2,
    pending_paid_approvals: 0,
    interrupted_sessions: 0
  },
  inbox: [{ title: "Needs decision" }],
  import_candidates: [{ title: "Import candidate" }],
  duplicate_conflicts: [],
  rules: [{ title: "Active rule" }],
  costs: [],
  settings: [],
  source_filters: {
    selected_source_id: "all",
    selected_source: null,
    sources: []
  },
  project_cleanup: {
    detach_command: `recallant detach --project-id ${currentProjectId} --dry-run`
  },
  project_readiness: {
    last_context_read_at: "2026-06-01T00:00:00Z",
    last_memory_write_at: "2026-06-01T00:01:00Z",
    checkpoint_updated_at: "2026-06-01T00:02:00Z",
    capture_event_count: 4,
    captured_decision_count: 1
  },
  recent_activity: []
};

const scenarios = [
  {
    name: "cleanup ru",
    message: "Снеси sandbox проект из Recallant",
    ai: {
      language: "ru",
      intent: "cleanup",
      summary: "Owner asks to remove a sandbox project.",
      target_hint: "sandbox",
      destructive_or_sensitive: true,
      global_rule_request: false
    },
    expectedIntent: "cleanup",
    expectedResult: "dry_run_required"
  },
  {
    name: "cleanup en",
    message: "Remove the sandbox workspace from Recallant",
    ai: {
      language: "en",
      intent: "cleanup",
      summary: "Owner asks to remove a sandbox workspace.",
      target_hint: "sandbox",
      destructive_or_sensitive: true,
      global_rule_request: false
    },
    expectedIntent: "cleanup",
    expectedResult: "dry_run_required"
  },
  {
    name: "global rule ru",
    message: "Сохрани правило для всех проектов: агенты должны проверять capture status",
    ai: {
      language: "ru",
      intent: "global_rule",
      summary: "Owner asks for a developer-wide rule.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: true,
      rule_text: "Agents must check capture status."
    },
    expectedIntent: "global_rule",
    expectedResult: "safe_action",
    database: {
      createAgentMemory: async () => ({
        memory_id: "44444444-4444-4444-8444-444444444444",
        use_policy: "instruction_grade"
      })
    }
  },
  {
    name: "memory lookup en",
    message: "What did the agent remember about capture?",
    ai: {
      language: "en",
      intent: "memory_summary",
      summary: "Owner asks what memory says about capture.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "memory_summary",
    expectedResult: "read_only_answer"
  },
  {
    name: "source management ru",
    message: "Покажи источники текущего memory space",
    ai: {
      language: "ru",
      intent: "source_management",
      summary: "Owner asks to inspect sources.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "source_management",
    expectedResult: "read_only_answer"
  },
  {
    name: "connection diagnostics en",
    message: "Check whether this project is recording capture correctly",
    ai: {
      language: "en",
      intent: "connection_check",
      summary: "Owner asks for connection and capture diagnostics.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "connection_check",
    expectedResult: "read_only_answer"
  },
  {
    name: "review triage ru",
    message: "Что нужно разобрать в Review?",
    ai: {
      language: "ru",
      intent: "review",
      summary: "Owner asks what to triage in review.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "review",
    expectedResult: "read_only_answer"
  },
  {
    name: "pilot qa en",
    message: "Run pilot QA and prepare an acceptance report",
    ai: {
      language: "en",
      intent: "pilot_qa",
      summary: "Owner asks for pilot QA.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "pilot_qa",
    expectedResult: "read_only_answer"
  },
  {
    name: "rule diagnostics ru",
    message: "Почему правило про capture status не применяется?",
    ai: {
      language: "ru",
      intent: "rule_diagnostics",
      summary: "Owner asks why a rule is not applying.",
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: false
    },
    expectedIntent: "rule_diagnostics",
    expectedResult: "read_only_answer"
  }
];

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
const previousUrl = process.env.RECALLANT_OLLAMA_URL;
const previousModel = process.env.RECALLANT_MANAGEMENT_CHAT_MODEL;
const previousFetch = globalThis.fetch;

try {
  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
  process.env.RECALLANT_OLLAMA_URL = "http://mock-ollama.local";
  process.env.RECALLANT_MANAGEMENT_CHAT_MODEL = "mock-intent:latest";
  const queued = scenarios.map((scenario) => ({
    confidence: 0.9,
    ...scenario.ai
  }));
  globalThis.fetch = async () => {
    const next = queued.shift();
    if (!next) {
      return new globalThis.Response(JSON.stringify({ error: "unexpected AI call" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
    return new globalThis.Response(
      JSON.stringify({ message: { content: JSON.stringify(next) } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  for (const scenario of scenarios) {
    const result = await buildManagementChatResponse({
      message: scenario.message,
      dashboard,
      database: scenario.database
    });
    assert(result.understanding.source === "local_ai", `${scenario.name}: local AI not used`);
    assert(
      result.intent === scenario.expectedIntent && result.result_type === scenario.expectedResult,
      `${scenario.name}: local AI matrix mismatch: ${JSON.stringify(result)}`
    );
  }

  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
  globalThis.fetch = previousFetch;
  for (const scenario of scenarios) {
    const result = await buildManagementChatResponse({
      message: scenario.message,
      dashboard,
      database: scenario.database
    });
    assert(result.understanding.source === "rules", `${scenario.name}: fallback not used`);
    assert(
      result.intent === scenario.expectedIntent && result.result_type === scenario.expectedResult,
      `${scenario.name}: fallback matrix mismatch: ${JSON.stringify(result)}`
    );
  }

  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
  globalThis.fetch = async () =>
    new globalThis.Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            language: "ru",
            intent: "general",
            confidence: 0.4,
            summary: "Misclassified unsafe cleanup as a general question.",
            target_hint: "current",
            destructive_or_sensitive: false,
            global_rule_request: false
          })
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const guarded = await buildManagementChatResponse({
    message: "Удали sandbox проект из Recallant",
    dashboard
  });
  assert(
    guarded.understanding.source === "local_ai" &&
      guarded.intent === "cleanup" &&
      guarded.result_type === "dry_run_required" &&
      guarded.confirmation_required === true,
    `Server policy did not override unsafe AI misclassification: ${JSON.stringify(guarded)}`
  );
} finally {
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
  restoreEnv("RECALLANT_OLLAMA_URL", previousUrl);
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_MODEL", previousModel);
  globalThis.fetch = previousFetch;
}

process.stdout.write("Stage 2 intent matrix smoke passed\n");
