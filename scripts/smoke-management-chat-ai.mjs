import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const queuedResponses = [];
const seenRequests = [];
const server = createServer(async (request, response) => {
  if (request.url !== "/api/chat" || request.method !== "POST") {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  const body = await readBody(request);
  seenRequests.push(JSON.parse(body));
  const next = queuedResponses.shift();
  if (!next) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "no queued mock response" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      message: {
        content: JSON.stringify(next)
      }
    })
  );
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock Ollama server did not bind");

const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
const previousUrl = process.env.RECALLANT_OLLAMA_URL;
const previousModel = process.env.RECALLANT_MANAGEMENT_CHAT_MODEL;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
process.env.RECALLANT_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
process.env.RECALLANT_MANAGEMENT_CHAT_MODEL = "mock-intent:latest";

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const currentProjectId = "11111111-1111-4111-8111-111111111111";
const sandboxProjectId = "22222222-2222-4222-8222-222222222222";
const secondSandboxProjectId = "33333333-3333-4333-8333-333333333333";

const baseDashboard = {
  current_project_id: currentProjectId,
  current_project: {
    project_id: currentProjectId,
    name: "recallant",
    primary_path: "/ai/recallant",
    memory_count: 2
  },
  projects: [
    { project_id: currentProjectId, name: "recallant", primary_path: "/ai/recallant" },
    {
      project_id: sandboxProjectId,
      name: "gutendocx sandbox",
      primary_path: "/ai/recallant-pilots/gutendocx-sandbox"
    }
  ],
  critical: {
    pending_review: 0,
    pending_paid_approvals: 0,
    interrupted_sessions: 0
  },
  inbox: [],
  import_candidates: [],
  duplicate_conflicts: [],
  rules: [],
  costs: [],
  settings: [],
  source_filters: {
    selected_source_id: "source-agents-md",
    selected_source: {
      source_id: "source-agents-md",
      display_label: "AGENTS.md",
      source_health: { status: "ready", label: "Source ready" }
    },
    sources: [
      {
        source_id: "source-agents-md",
        display_label: "AGENTS.md",
        source_health: { status: "ready", label: "Source ready" }
      },
      {
        source_id: "source-docs",
        display_label: "Docs folder",
        source_health: { status: "ready", label: "Source ready" }
      }
    ]
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

try {
  queuedResponses.push({
    language: "ru",
    intent: "cleanup",
    confidence: 0.93,
    summary: "Owner asks to remove the sandbox project using colloquial Russian wording.",
    target_hint: "sandbox",
    destructive_or_sensitive: true,
    global_rule_request: false
  });
  const cleanup = await buildManagementChatResponse({
    message: "Снеси песочницу, она больше не нужна",
    dashboard: baseDashboard
  });
  assert(cleanup.understanding.source === "local_ai", "Cleanup intent did not use local AI");
  assert(cleanup.intent === "cleanup", `Cleanup intent mismatch: ${cleanup.intent}`);
  assert(cleanup.result_type === "dry_run_required", "Cleanup did not require dry-run");
  assert(
    cleanup.facts.target_project_id === sandboxProjectId,
    `Cleanup did not target the only sandbox project: ${JSON.stringify(cleanup.facts)}`
  );
  assert(
    String(cleanup.proposed_actions[0]?.command).includes(sandboxProjectId) &&
      !String(cleanup.proposed_actions[0]?.command).includes(currentProjectId),
    `Cleanup command targeted the wrong project: ${JSON.stringify(cleanup.proposed_actions)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "cleanup",
    confidence: 0.91,
    summary: "Owner asks to remove a sandbox but there is more than one possible sandbox.",
    target_hint: "sandbox",
    destructive_or_sensitive: true,
    global_rule_request: false
  });
  const ambiguous = await buildManagementChatResponse({
    message: "Удали тестовый sandbox",
    dashboard: {
      ...baseDashboard,
      projects: [
        ...baseDashboard.projects,
        {
          project_id: secondSandboxProjectId,
          name: "second sandbox",
          primary_path: "/ai/recallant-pilots/second-sandbox"
        }
      ]
    }
  });
  assert(
    ambiguous.result_type === "needs_clarification",
    `Ambiguous sandbox did not ask for clarification: ${JSON.stringify(ambiguous)}`
  );
  assert(
    ambiguous.proposed_actions.every((action) => !action.command),
    "Ambiguous risky request should not produce a runnable command"
  );

  let savedRule = null;
  queuedResponses.push({
    language: "ru",
    intent: "global_rule",
    confidence: 0.95,
    summary: "Owner wants a developer-wide behavior rule, using non-exact wording.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: true,
    rule_text: "Agents must explain complex project decisions in plain human language."
  });
  const globalRule = await buildManagementChatResponse({
    message: "Во всех воркспейсах агенты должны объяснять сложные решения человеческим языком",
    dashboard: baseDashboard,
    database: {
      createAgentMemory: async (input) => {
        savedRule = input;
        return {
          memory_id: "44444444-4444-4444-8444-444444444444",
          use_policy: "instruction_grade"
        };
      }
    }
  });
  assert(globalRule.understanding.source === "local_ai", "Global rule did not use local AI");
  assert(globalRule.intent === "global_rule", `Global rule intent mismatch: ${globalRule.intent}`);
  assert(globalRule.result_type === "safe_action", "Global rule did not become a safe action");
  assert(globalRule.global_rule_result?.scope === "developer", "Global rule scope mismatch");
  assert(
    savedRule?.scope === "developer",
    `Saved rule scope mismatch: ${JSON.stringify(savedRule)}`
  );
  assert(
    savedRule?.audience?.some((audience) => audience.kind === "all_agents"),
    `Saved rule audience mismatch: ${JSON.stringify(savedRule)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "source_management",
    confidence: 0.9,
    summary: "Owner wants to create or manage a virtual memory space/source.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const sourceManagement = await buildManagementChatResponse({
    message: "Создай виртуальное пространство и подключи к нему папку с документами",
    dashboard: baseDashboard
  });
  assert(
    sourceManagement.understanding.source === "local_ai" &&
      sourceManagement.intent === "source_management" &&
      sourceManagement.result_type === "read_only_answer",
    `Source management intent failed: ${JSON.stringify(sourceManagement)}`
  );
  assert(
    sourceManagement.facts.source_count === 2 &&
      String(sourceManagement.answer).includes("Memory Spaces") &&
      sourceManagement.proposed_actions[0]?.label.includes("Memory Spaces"),
    `Source management answer did not guide through Memory Spaces: ${JSON.stringify(sourceManagement)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "provenance",
    confidence: 0.88,
    summary: "Owner asks where a fact came from.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const provenance = await buildManagementChatResponse({
    message: "Where did this fact come from and what source is selected?",
    dashboard: baseDashboard
  });
  assert(
    provenance.understanding.source === "local_ai" &&
      provenance.intent === "provenance" &&
      provenance.result_type === "read_only_answer",
    `Provenance intent failed: ${JSON.stringify(provenance)}`
  );
  assert(
    provenance.facts.selected_source_name === "AGENTS.md" &&
      String(provenance.answer).includes("Evidence excerpts") &&
      provenance.proposed_actions[0]?.label === "Open Evidence excerpts",
    `Provenance answer did not explain source refs: ${JSON.stringify(provenance)}`
  );

  assert(seenRequests.length === 5, `Unexpected mock AI call count: ${seenRequests.length}`);
} finally {
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
  restoreEnv("RECALLANT_OLLAMA_URL", previousUrl);
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_MODEL", previousModel);
  server.close();
  await once(server, "close");
}

process.stdout.write("Management chat AI smoke passed\n");
