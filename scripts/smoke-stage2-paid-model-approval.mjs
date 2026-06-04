import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const currentProjectId = "11111111-1111-4111-8111-111111111111";
const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
const previousFetch = globalThis.fetch;
let networkCalls = 0;

process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Paid/external model approval smoke must not make network calls");
};

const dashboard = {
  current_project_id: currentProjectId,
  current_project: {
    project_id: currentProjectId,
    name: "recallant",
    primary_path: "/ai/recallant"
  },
  projects: [{ project_id: currentProjectId, name: "recallant", primary_path: "/ai/recallant" }],
  critical: {
    pending_review: 0,
    pending_paid_approvals: 1,
    interrupted_sessions: 0
  },
  inbox: [],
  import_candidates: [],
  duplicate_conflicts: [],
  rules: [],
  costs: [],
  settings: [],
  source_filters: { selected_source_id: "all", selected_source: null, sources: [] },
  project_cleanup: {
    detach_command: `recallant detach --project-id ${currentProjectId} --dry-run`
  },
  project_readiness: {},
  recent_activity: []
};

try {
  const paidModel = await buildManagementChatResponse({
    message: "Use an external paid model provider when local AI is not good enough",
    dashboard
  });
  assert(networkCalls === 0, `Unexpected network call count: ${networkCalls}`);
  assert(
    paidModel.understanding.source === "rules" &&
      paidModel.intent === "cost" &&
      paidModel.result_type === "confirmation_required" &&
      paidModel.confirmation_required === true &&
      paidModel.destructive_or_sensitive === true,
    `Paid model route was not policy gated: ${JSON.stringify(paidModel)}`
  );
  assert(
    String(paidModel.answer).includes("external or paid AI/model route") &&
      String(paidModel.answer).includes("does not make paid API calls") &&
      String(paidModel.answer).includes("Cost / Paid API") &&
      paidModel.proposed_actions[0]?.kind === "confirmation_required" &&
      paidModel.proposed_actions[0]?.label === "Open Cost / Paid API approval" &&
      !paidModel.proposed_actions.some((action) => action.kind === "dry_run"),
    `Paid model route did not explain approval path: ${JSON.stringify(paidModel)}`
  );

  const providerChange = await buildManagementChatResponse({
    message: "Change global setting model provider to paid API",
    dashboard
  });
  assert(
    providerChange.result_type === "confirmation_required" &&
      providerChange.confirmation_required === true &&
      providerChange.proposed_actions[0]?.label === "Open Cost / Paid API approval",
    `Provider change did not stay confirmation-gated: ${JSON.stringify(providerChange)}`
  );
} finally {
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
  globalThis.fetch = previousFetch;
}

process.stdout.write("Stage 2 paid model approval smoke passed\n");
