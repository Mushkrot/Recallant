import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
const previousTimeout = process.env.RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS;
const previousKeepAlive = process.env.RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE;

process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
process.env.RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS =
  process.env.RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS ?? "8000";
process.env.RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE =
  process.env.RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE ?? "0";

const currentProjectId = "11111111-1111-4111-8111-111111111111";
const sandboxProjectId = "22222222-2222-4222-8222-222222222222";

const dashboard = {
  current_project_id: currentProjectId,
  current_project: {
    project_id: currentProjectId,
    name: "recallant",
    primary_path: "/tmp/recallant-live-chat-current",
    memory_count: 4
  },
  projects: [
    {
      project_id: currentProjectId,
      name: "recallant",
      primary_path: "/tmp/recallant-live-chat-current"
    },
    {
      project_id: sandboxProjectId,
      name: "recallant sandbox",
      primary_path: "/tmp/recallant-live-chat-sandbox"
    }
  ],
  critical: {
    pending_review: 2,
    pending_paid_approvals: 0,
    interrupted_sessions: 0
  },
  inbox: [{ title: "Review candidate" }],
  import_candidates: [],
  duplicate_conflicts: [],
  rules: [{ title: "Active startup rule" }],
  costs: [],
  settings: [],
  source_filters: {
    selected_source_id: "all",
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
    label: "ru cleanup",
    message: "Снеси sandbox проект из Recallant",
    intent: "cleanup",
    resultType: "dry_run_required"
  },
  {
    label: "en global rule",
    message: "Save this rule for all projects: agents should explain risky changes before acting.",
    intent: "global_rule"
  },
  {
    label: "en memory lookup",
    message: "What did we decide about Google Drive connector examples?",
    intent: "cross_project",
    acceptableIntents: ["cross_project", "context_pack", "memory_summary", "provenance"]
  },
  {
    label: "ru source management",
    message: "Подключи источник /tmp/recallant-live-chat-docs",
    intent: "source_management"
  },
  {
    label: "en connection check",
    message: "Is agent capture connected and recording?",
    intent: "connection_check"
  },
  {
    label: "ru review triage",
    message: "Что мне сейчас разобрать в review inbox?",
    intent: "review"
  }
];

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  const results = [];
  for (const scenario of scenarios) {
    const response = await buildManagementChatResponse({
      message: scenario.message,
      dashboard
    });
    results.push({ scenario, response });
    assert(
      response.result_type !== "blocked_by_policy",
      `${scenario.label} was unexpectedly blocked: ${JSON.stringify(response)}`
    );
    if (scenario.resultType) {
      assert(
        response.result_type === scenario.resultType,
        `${scenario.label} result type mismatch: ${JSON.stringify(response)}`
      );
    }
  }

  const localAiResults = results.filter(
    (item) => item.response.understanding.source === "local_ai"
  );
  if (localAiResults.length === 0) {
    assert(
      results.every((item) => item.response.understanding.source === "rules"),
      `Mixed unavailable local-AI state: ${JSON.stringify(results)}`
    );
    process.stdout.write(
      "Management chat live smoke skipped: local AI unavailable; fallback mode is active and policy-gated responses were produced.\n"
    );
    process.exit(0);
  }

  assert(
    localAiResults.length === results.length,
    `Only some live-model scenarios used local AI: ${JSON.stringify(results)}`
  );
  for (const { scenario, response } of results) {
    const acceptableIntents = scenario.acceptableIntents ?? [scenario.intent];
    assert(
      acceptableIntents.includes(response.intent),
      `${scenario.label} intent mismatch: expected one of ${acceptableIntents.join(", ")}, got ${response.intent}; ${JSON.stringify(response)}`
    );
    assert(
      response.understanding.model,
      `${scenario.label} did not report the local model: ${JSON.stringify(response)}`
    );
  }

  const cleanup = results.find((item) => item.scenario.label === "ru cleanup")?.response;
  assert(
    cleanup?.destructive_or_sensitive === true &&
      cleanup.confirmation_required === true &&
      String(cleanup.proposed_actions[0]?.command ?? "").includes("--dry-run"),
    `Risky cleanup was not policy gated: ${JSON.stringify(cleanup)}`
  );

  process.stdout.write("Management chat live smoke passed with local AI\n");
} finally {
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS", previousTimeout);
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE", previousKeepAlive);
}
