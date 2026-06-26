import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const queuedResponses = [];
const seenRequests = [];
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const requestUrl = new globalThis.URL(String(url));
  if (requestUrl.pathname !== "/api/chat" || init?.method !== "POST") {
    return new globalThis.Response("not found", { status: 404 });
  }
  const body = String(init?.body ?? "{}");
  seenRequests.push(JSON.parse(body));
  const next = queuedResponses.shift();
  if (!next) {
    return new globalThis.Response(JSON.stringify({ error: "no queued mock response" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  return new globalThis.Response(
    JSON.stringify({
      message: {
        content: JSON.stringify(next)
      }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
};

const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
const previousUrl = process.env.RECALLANT_OLLAMA_URL;
const previousModel = process.env.RECALLANT_MANAGEMENT_CHAT_MODEL;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
process.env.RECALLANT_OLLAMA_URL = "http://mock-ollama.local";
process.env.RECALLANT_MANAGEMENT_CHAT_MODEL = "mock-intent:latest";

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const currentProjectId = "11111111-1111-4111-8111-111111111111";
const sandboxProjectId = "22222222-2222-4222-8222-222222222222";
const secondSandboxProjectId = "33333333-3333-4333-8333-333333333333";
const namedProjectId = "66666666-6666-4666-8666-666666666666";
const secondNamedProjectId = "77777777-7777-4777-8777-777777777777";

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
    project_registered: true,
    last_context_read_at: "2026-06-01T00:00:00Z",
    last_memory_write_at: "2026-06-01T00:01:00Z",
    checkpoint_updated_at: "2026-06-01T00:02:00Z",
    last_semantic_recall_proof_at: "2026-06-01T00:03:00Z",
    semantic_memory_ready: true,
    readiness_status: "capture_active",
    readiness_contract: {
      primary_state: "capture_active",
      configured: true,
      context_ready: true,
      semantic_memory_ready: true,
      capture_active: true,
      evidence: {
        last_context_read_at: "2026-06-01T00:00:00Z",
        last_memory_write_at: "2026-06-01T00:01:00Z",
        last_checkpoint_at: "2026-06-01T00:02:00Z",
        last_semantic_recall_proof_at: "2026-06-01T00:03:00Z"
      }
    },
    review_state_counts: {
      accepted: 3,
      pending_review: 0,
      rejected: 0,
      stale: 0,
      conflict: 0
    },
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
    intent: "general",
    confidence: 0.44,
    summary: "Mock model under-classified a risky cleanup request.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const guardedCleanup = await buildManagementChatResponse({
    message: "Удали gutendocx sandbox из Recallant",
    dashboard: baseDashboard
  });
  assert(
    guardedCleanup.understanding.source === "local_ai" &&
      guardedCleanup.intent === "cleanup" &&
      guardedCleanup.result_type === "dry_run_required" &&
      guardedCleanup.confirmation_required === true &&
      guardedCleanup.destructive_or_sensitive === true,
    `Deterministic policy did not guard misclassified cleanup: ${JSON.stringify(guardedCleanup)}`
  );
  assert(
    guardedCleanup.facts.target_project_id === sandboxProjectId &&
      String(guardedCleanup.proposed_actions[0]?.command).includes(sandboxProjectId),
    `Guarded cleanup targeted the wrong project: ${JSON.stringify(guardedCleanup)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "cleanup",
    confidence: 0.92,
    summary: "Owner names a non-open project for cleanup.",
    target_hint: "current",
    destructive_or_sensitive: true,
    global_rule_request: false
  });
  const namedCleanup = await buildManagementChatResponse({
    message: "Remove docs archive from Recallant",
    dashboard: {
      ...baseDashboard,
      projects: [
        ...baseDashboard.projects,
        { project_id: namedProjectId, name: "docs archive", primary_path: "/ai/docs_archive" }
      ]
    }
  });
  assert(
    namedCleanup.result_type === "dry_run_required" &&
      namedCleanup.facts.target_project_id === namedProjectId &&
      namedCleanup.facts.target_project_switched === true &&
      namedCleanup.facts.target_project_reason === "message_named_project",
    `Named cleanup should target the named project: ${JSON.stringify(namedCleanup.facts)}`
  );
  assert(
    String(namedCleanup.proposed_actions[0]?.command).includes(namedProjectId) &&
      !String(namedCleanup.proposed_actions[0]?.command).includes(currentProjectId),
    `Named cleanup command targeted the wrong project: ${JSON.stringify(namedCleanup.proposed_actions)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "cleanup",
    confidence: 0.9,
    summary: "Owner names an ambiguous project family for cleanup.",
    target_hint: "current",
    destructive_or_sensitive: true,
    global_rule_request: false
  });
  const ambiguousNamedCleanup = await buildManagementChatResponse({
    message: "Remove docs archive from Recallant",
    dashboard: {
      ...baseDashboard,
      projects: [
        ...baseDashboard.projects,
        { project_id: namedProjectId, name: "docs archive", primary_path: "/ai/docs_archive" },
        {
          project_id: secondNamedProjectId,
          name: "docs archive",
          primary_path: "/ai/docs_archive_backup"
        }
      ]
    }
  });
  assert(
    ambiguousNamedCleanup.result_type === "needs_clarification" &&
      ambiguousNamedCleanup.facts.target_project_ambiguous === true &&
      ambiguousNamedCleanup.clarification_context?.intent === "cleanup" &&
      ambiguousNamedCleanup.proposed_actions.every((action) => !action.command),
    `Ambiguous named cleanup should ask for clarification: ${JSON.stringify(ambiguousNamedCleanup)}`
  );
  const clarifiedNamedCleanup = await buildManagementChatResponse({
    message: "/ai/docs_archive_backup",
    dashboard: {
      ...baseDashboard,
      projects: [
        ...baseDashboard.projects,
        { project_id: namedProjectId, name: "docs archive", primary_path: "/ai/docs_archive" },
        {
          project_id: secondNamedProjectId,
          name: "docs archive",
          primary_path: "/ai/docs_archive_backup"
        }
      ]
    },
    clarification_context: ambiguousNamedCleanup.clarification_context
  });
  assert(
    clarifiedNamedCleanup.intent === "cleanup" &&
      clarifiedNamedCleanup.result_type === "dry_run_required" &&
      clarifiedNamedCleanup.facts.target_project_id === secondNamedProjectId &&
      String(clarifiedNamedCleanup.proposed_actions[0]?.command).includes(secondNamedProjectId),
    `Clarified named cleanup did not continue to dry-run plan: ${JSON.stringify(clarifiedNamedCleanup)}`
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

  let guardedSavedRule = null;
  queuedResponses.push({
    language: "ru",
    intent: "general",
    confidence: 0.48,
    summary: "Mock model under-classified a developer-wide rule request.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const guardedGlobalRule = await buildManagementChatResponse({
    message: "Сохрани правило для всех проектов: агенты должны проверять capture status.",
    dashboard: baseDashboard,
    database: {
      createAgentMemory: async (input) => {
        guardedSavedRule = input;
        return {
          memory_id: "88888888-8888-4888-8888-888888888888",
          use_policy: "instruction_grade"
        };
      }
    }
  });
  assert(
    guardedGlobalRule.understanding.source === "local_ai" &&
      guardedGlobalRule.intent === "global_rule" &&
      guardedGlobalRule.result_type === "safe_action" &&
      guardedGlobalRule.global_rule_result?.status === "created",
    `Deterministic policy did not guard misclassified global rule: ${JSON.stringify(
      guardedGlobalRule
    )}`
  );
  assert(
    guardedSavedRule?.scope === "developer" &&
      guardedSavedRule?.audience?.some((audience) => audience.kind === "all_agents") &&
      guardedGlobalRule.global_rule_result?.use_policy === "instruction_grade",
    `Guarded global rule wrote wrong DB input: ${JSON.stringify(guardedSavedRule)}`
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
    message: "Подключи папку с документами как источник",
    dashboard: baseDashboard
  });
  assert(
    sourceManagement.understanding.source === "local_ai" &&
      sourceManagement.intent === "source_management" &&
      sourceManagement.result_type === "needs_clarification",
    `Source management intent failed: ${JSON.stringify(sourceManagement)}`
  );
  assert(
    sourceManagement.facts.source_count === 2 &&
      sourceManagement.facts.source_ready_count === 2 &&
      sourceManagement.facts.source_needs_attention_count === 0 &&
      sourceManagement.clarification_context?.intent === "source_management" &&
      String(sourceManagement.answer).includes("не хватает данных") &&
      !sourceManagement.proposed_actions.some((action) => action.command),
    `Incomplete source management request did not ask for clarification: ${JSON.stringify(sourceManagement)}`
  );
  const clarifiedSourceAttach = await buildManagementChatResponse({
    message: "/tmp/recallant-clarified-docs",
    dashboard: baseDashboard,
    clarification_context: sourceManagement.clarification_context,
    database: {
      attachProjectSource: async (input) => ({
        id: "clarified-source-id",
        ...input,
        display_label: input.label,
        source_health: { status: "ready", label: "Source ready" }
      })
    }
  });
  assert(
    clarifiedSourceAttach.intent === "source_management" &&
      clarifiedSourceAttach.result_type === "safe_action" &&
      clarifiedSourceAttach.source_action_result?.source_uri === "/tmp/recallant-clarified-docs",
    `Clarified source attach did not continue to a safe plan: ${JSON.stringify(clarifiedSourceAttach)}`
  );

  let createdSpaceInput = null;
  queuedResponses.push({
    language: "ru",
    intent: "source_management",
    confidence: 0.94,
    summary: "Owner wants a virtual personal operations memory space with no folder yet.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const virtualSpace = await buildManagementChatResponse({
    message: "Создай виртуальное пространство «Personal operations»",
    dashboard: baseDashboard,
    database: {
      createMemorySpace: async (input) => {
        createdSpaceInput = input;
        return {
          project_id: "55555555-5555-4555-8555-555555555555",
          name: input.name,
          project_kind: input.projectKind,
          memory_domain: input.memoryDomain,
          primary_path: null
        };
      }
    }
  });
  assert(
    virtualSpace.understanding.source === "local_ai" &&
      virtualSpace.intent === "source_management" &&
      virtualSpace.result_type === "safe_action" &&
      virtualSpace.source_action_result?.status === "created" &&
      virtualSpace.source_action_result?.project_id === "55555555-5555-4555-8555-555555555555",
    `Virtual memory space creation did not become a safe action: ${JSON.stringify(virtualSpace)}`
  );
  assert(
    createdSpaceInput?.name === "Personal operations" &&
      createdSpaceInput?.projectKind === "personal_domain" &&
      createdSpaceInput?.memoryDomain === "personal_life" &&
      createdSpaceInput?.primaryPath === undefined,
    `Virtual memory space was created with wrong inputs: ${JSON.stringify(createdSpaceInput)}`
  );
  assert(
    virtualSpace.proposed_actions[0]?.label === "Пространство памяти создано" &&
      virtualSpace.proposed_actions[0]?.kind === "read_only" &&
      virtualSpace.proposed_actions.every((action) => !action.command) &&
      String(virtualSpace.answer).includes("файлы проекта") &&
      String(virtualSpace.answer).includes("внешние подключенные сервисы не тронуты"),
    `Virtual memory space response did not explain safe boundaries: ${JSON.stringify(virtualSpace)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "source_management",
    confidence: 0.92,
    summary: "Owner wants to attach a concrete local folder as a source.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  let attachedSourceInput = null;
  const sourceAttach = await buildManagementChatResponse({
    message: "Attach /ai/docs as a source to the current memory space",
    dashboard: baseDashboard,
    database: {
      attachProjectSource: async (input) => {
        attachedSourceInput = input;
        return {
          id: "source-attached-docs",
          project_id: input.project_id,
          source_kind: input.source_kind,
          label: input.label,
          uri: input.uri,
          status: "active"
        };
      }
    }
  });
  assert(
    sourceAttach.understanding.source === "local_ai" &&
      sourceAttach.intent === "source_management" &&
      sourceAttach.result_type === "safe_action" &&
      sourceAttach.source_action_result?.status === "created" &&
      sourceAttach.source_action_result?.operation === "attach_source",
    `Concrete source attach intent failed: ${JSON.stringify(sourceAttach)}`
  );
  assert(
    attachedSourceInput?.project_id === currentProjectId &&
      attachedSourceInput?.source_kind === "workspace_path" &&
      attachedSourceInput?.label === "docs" &&
      attachedSourceInput?.uri === "/ai/docs" &&
      attachedSourceInput?.metadata?.safe_db_only_attach === true,
    `Concrete source attach wrote wrong DB input: ${JSON.stringify(attachedSourceInput)}`
  );
  assert(
    String(sourceAttach.answer).includes("safe DB-only operation") &&
      sourceAttach.proposed_actions[0]?.label === "Source attached" &&
      sourceAttach.proposed_actions.every((action) => !action.command) &&
      sourceAttach.proposed_actions[1]?.label === "Open Sources workspace",
    `Concrete source attach answer did not explain safe execution: ${JSON.stringify(sourceAttach)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "source_management",
    confidence: 0.91,
    summary: "Owner wants to attach a connector source.",
    target_hint: "current",
    destructive_or_sensitive: true,
    global_rule_request: false
  });
  const connectorSourceAttach = await buildManagementChatResponse({
    message: "Attach gdrive:project-docs as a Google Drive connector source",
    dashboard: baseDashboard,
    database: {
      attachProjectSource: async () => {
        throw new Error("connector source attach must not execute directly from chat");
      }
    }
  });
  assert(
    connectorSourceAttach.intent === "source_management" &&
      connectorSourceAttach.result_type === "confirmation_required" &&
      connectorSourceAttach.source_action_result?.status === "skipped",
    `Connector source attach should stay policy-gated: ${JSON.stringify(connectorSourceAttach)}`
  );
  assert(
    String(connectorSourceAttach.answer).includes("governed source workflow") &&
      connectorSourceAttach.proposed_actions[0]?.kind === "confirmation_required" &&
      !connectorSourceAttach.proposed_actions.some((action) =>
        String(action.command ?? "").includes("detach")
      ),
    `Connector source attach should not become cleanup/detach guidance: ${JSON.stringify(connectorSourceAttach)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "project_onboarding",
    confidence: 0.9,
    summary: "Owner wants to attach a new project but did not provide a path.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const incompleteOnboarding = await buildManagementChatResponse({
    message: "Подключи новый проект к Recallant",
    dashboard: baseDashboard
  });
  assert(
    incompleteOnboarding.intent === "project_onboarding" &&
      incompleteOnboarding.result_type === "needs_clarification" &&
      String(incompleteOnboarding.answer).includes("не хватает данных") &&
      !incompleteOnboarding.proposed_actions.some((action) => action.command),
    `Incomplete onboarding should ask for project path: ${JSON.stringify(incompleteOnboarding)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "project_onboarding",
    confidence: 0.93,
    summary: "Owner wants to attach and connect a concrete project path.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const concreteOnboarding = await buildManagementChatResponse({
    message: "Connect /ai/new_project with Cursor and mandatory startup hooks",
    dashboard: baseDashboard
  });
  assert(
    concreteOnboarding.intent === "project_onboarding" &&
      concreteOnboarding.result_type === "dry_run_required" &&
      String(concreteOnboarding.proposed_actions[0]?.command).includes(
        "recallant attach /ai/new_project --sandbox --dry-run"
      ) &&
      String(concreteOnboarding.proposed_actions[1]?.command).includes(
        "recallant connect cursor --project-dir /ai/new_project --install-local-hooks --dry-run"
      ) &&
      String(concreteOnboarding.proposed_actions[2]?.command).includes(
        "recallant doctor --project-dir /ai/new_project --require-capture --semantic-proof"
      ),
    `Concrete onboarding did not produce attach/connect/doctor plan: ${JSON.stringify(concreteOnboarding)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "pilot_qa",
    confidence: 0.9,
    summary: "Owner wants autonomous pilot QA evidence.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const pilotQa = await buildManagementChatResponse({
    message: "Run pilot QA and produce the evidence report",
    dashboard: baseDashboard
  });
  assert(
    pilotQa.intent === "pilot_qa" &&
      pilotQa.result_type === "read_only_answer" &&
      pilotQa.proposed_actions.some((action) =>
        String(action.command).includes("npm run pilot-report:smoke")
      ) &&
      pilotQa.proposed_actions.some((action) =>
        String(action.command).includes("npm run review-ui:playwright")
      ),
    `Pilot QA did not produce evidence commands: ${JSON.stringify(pilotQa)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "cross_project",
    confidence: 0.89,
    summary: "Owner asks what was decided about Google Drive.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  let googleDriveRecallInput;
  const googleDriveLookup = await buildManagementChatResponse({
    message: "Что мы решили по Google Drive?",
    dashboard: baseDashboard,
    database: {
      recallAgentMemories: async (input) => {
        googleDriveRecallInput = input;
        return {
          trace_id: "trace-same-google-drive",
          truncated: false,
          memories: [
            {
              memory_id: "memory-google-drive-current",
              title: "Google Drive access pattern",
              body: "Use the existing connector pattern from the docs project before creating a new binding.",
              status: "accepted",
              use_policy: "recall_allowed",
              scope: "project",
              scope_kind: "project",
              provenance: { summary: "From source AGENTS.md", source_path: "AGENTS.md" },
              source_refs: []
            }
          ],
          query: input.query
        };
      },
      crossProjectRecall: async (input) => ({
        trace_id: "trace-cross-google-drive",
        mode: input.mode,
        current_project_id: currentProjectId,
        truncated: false,
        policy: {
          default_context_pack_includes_cross_project_examples: false,
          cross_project_results_are_binding_rules: false,
          source_linked_examples_only: true
        },
        results: [
          {
            memory_id: "memory-google-drive-example",
            title: "Docs project Google Drive connector",
            body: "The docs project used a source-linked connector reference and kept raw secrets outside memory.",
            status: "accepted",
            use_policy: "recall_allowed",
            scope: "project",
            scope_kind: "project",
            source_path: "Docs/GOOGLE_DRIVE.md",
            source_project: {
              name: "docs archive",
              primary_path: "/ai/docs_archive"
            },
            source_refs: []
          }
        ]
      })
    }
  });
  assert(
    googleDriveLookup.understanding.source === "local_ai" &&
      googleDriveLookup.intent === "cross_project" &&
      googleDriveLookup.result_type === "read_only_answer" &&
      googleDriveLookup.memory_lookup_result?.status === "found" &&
      googleDriveLookup.memory_lookup_result?.source_filter?.label === "AGENTS.md" &&
      googleDriveLookup.memory_lookup_result?.same_project_hits.length === 1 &&
      googleDriveLookup.memory_lookup_result?.cross_project_examples.length === 1,
    `Google Drive memory lookup failed: ${JSON.stringify(googleDriveLookup)}`
  );
  assert(
    googleDriveRecallInput?.source_id === "source-agents-md" &&
      String(googleDriveLookup.answer).includes("Google Drive") &&
      String(googleDriveLookup.answer).includes(
        "Фильтр источника в текущем memory space: AGENTS.md"
      ) &&
      String(googleDriveLookup.answer).includes("В текущем memory space") &&
      String(googleDriveLookup.answer).includes("Примеры из других проектов") &&
      String(googleDriveLookup.answer).includes("не становятся правилами автоматически") &&
      String(googleDriveLookup.answer).includes("AGENTS.md") &&
      String(googleDriveLookup.answer).includes("Docs/GOOGLE_DRIVE.md"),
    `Google Drive lookup answer did not include memories/provenance: ${JSON.stringify(
      googleDriveLookup
    )}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "connection_check",
    confidence: 0.9,
    summary: "Owner asks whether the selected project is connected and actually capturing memory.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const connectionCheck = await buildManagementChatResponse({
    message: "Проверь, нормально ли проект подключен и пишет память",
    dashboard: baseDashboard
  });
  assert(
    connectionCheck.understanding.source === "local_ai" &&
      connectionCheck.intent === "connection_check" &&
      connectionCheck.result_type === "read_only_answer" &&
      connectionCheck.facts.capture_ready === true &&
      connectionCheck.facts.semantic_memory_ready === true &&
      connectionCheck.facts.readiness_status === "capture_active" &&
      String(connectionCheck.answer).includes("capture-active evidence") &&
      String(connectionCheck.answer).includes("Последний context read") &&
      String(connectionCheck.answer).includes("Последняя запись памяти") &&
      String(connectionCheck.answer).includes("Последний semantic proof"),
    `Connection check did not explain capture readiness: ${JSON.stringify(connectionCheck)}`
  );

  queuedResponses.push({
    language: "en",
    intent: "connection_check",
    confidence: 0.9,
    summary: "Owner asks whether a configured-only project is actually active.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const configuredOnlyDashboard = JSON.parse(JSON.stringify(baseDashboard));
  configuredOnlyDashboard.project_readiness = {
    project_registered: true,
    readiness_status: "configured",
    semantic_memory_ready: false,
    configured_but_not_capture_active: true,
    readiness_contract: {
      primary_state: "configured",
      configured: true,
      context_ready: false,
      semantic_memory_ready: false,
      capture_active: false,
      evidence: {}
    },
    review_state_counts: {
      accepted: 0,
      pending_review: 0,
      rejected: 0,
      stale: 0,
      conflict: 0
    },
    capture_event_count: 0,
    captured_decision_count: 0
  };
  const configuredOnly = await buildManagementChatResponse({
    message: "Is this project connected and actually writing memory?",
    dashboard: configuredOnlyDashboard
  });
  assert(
    configuredOnly.intent === "connection_check" &&
      configuredOnly.result_type === "read_only_answer" &&
      configuredOnly.facts.capture_ready === false &&
      configuredOnly.facts.semantic_memory_ready === false &&
      configuredOnly.facts.readiness_status === "configured" &&
      String(configuredOnly.answer).includes("configured is not capture active"),
    `Configured-only connection check overclaimed readiness: ${JSON.stringify(configuredOnly)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "rule_diagnostics",
    confidence: 0.9,
    summary: "Owner asks why an expected rule is not being applied.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  let ruleDiagnosticsRecallInput;
  const ruleDiagnostics = await buildManagementChatResponse({
    message: "Почему правило про capture status не применяется?",
    dashboard: baseDashboard,
    database: {
      recallAgentMemories: async (input) => {
        ruleDiagnosticsRecallInput = input;
        return {
          trace_id: "trace-rule-diagnostics",
          truncated: false,
          memories: [
            {
              memory_id: "memory-rule-active-capture-status",
              title: "Active capture status rule",
              body: "Agents must verify capture status before claiming readiness.",
              status: "accepted",
              use_policy: "instruction_grade",
              scope: "developer",
              scope_kind: "developer",
              provenance: { summary: "From source AGENTS.md", source_path: "AGENTS.md" },
              source_refs: []
            },
            {
              memory_id: "memory-rule-capture-status",
              title: "Old capture status reminder",
              body: "Agents should verify capture status before claiming Recallant is ready.",
              status: "stale",
              use_policy: "evidence_only",
              scope: "developer",
              scope_kind: "developer",
              provenance: { summary: "From source AGENTS.md", source_path: "AGENTS.md" },
              source_refs: []
            }
          ]
        };
      }
    }
  });
  assert(
    ruleDiagnostics.understanding.source === "local_ai" &&
      ruleDiagnostics.intent === "rule_diagnostics" &&
      ruleDiagnostics.result_type === "read_only_answer" &&
      ruleDiagnostics.memory_lookup_result?.status === "found" &&
      ruleDiagnosticsRecallInput?.include_needs_review === true &&
      ruleDiagnosticsRecallInput?.include_candidates === true &&
      ruleDiagnosticsRecallInput?.include_stale === true &&
      ruleDiagnosticsRecallInput?.source_id === "source-agents-md" &&
      String(ruleDiagnostics.answer).includes("применяется ли каждая запись") &&
      String(ruleDiagnostics.answer).includes("Применяется: это Active rule") &&
      String(ruleDiagnostics.answer).includes("Не применяется: запись помечена как stale") &&
      String(ruleDiagnostics.answer).includes("Active capture status rule") &&
      String(ruleDiagnostics.answer).includes("Old capture status reminder") &&
      String(ruleDiagnostics.answer).includes("AGENTS.md"),
    `Rule diagnostics did not use governed lookup/source filter: ${JSON.stringify(ruleDiagnostics)}`
  );

  queuedResponses.push({
    language: "ru",
    intent: "review",
    confidence: 0.87,
    summary: "Owner asks what exactly should be reviewed next.",
    target_hint: "current",
    destructive_or_sensitive: false,
    global_rule_request: false
  });
  const reviewTriage = await buildManagementChatResponse({
    message: "Что именно сейчас надо разобрать в Review?",
    dashboard: {
      ...baseDashboard,
      critical: {
        ...baseDashboard.critical,
        pending_review: 3
      },
      import_candidates: [{ title: "README.md" }, { title: "PROJECT_LOG.md" }],
      duplicate_conflicts: [{ title: "Conflicting agent startup rule" }],
      rules: [{ title: "Active startup rule" }]
    }
  });
  assert(
    reviewTriage.understanding.source === "local_ai" &&
      reviewTriage.intent === "review" &&
      reviewTriage.result_type === "read_only_answer" &&
      reviewTriage.facts.pending_review === 3 &&
      reviewTriage.facts.import_candidates === 2 &&
      reviewTriage.facts.conflicts_or_duplicates === 1,
    `Review triage facts failed: ${JSON.stringify(reviewTriage)}`
  );
  assert(
    String(reviewTriage.answer).includes("Что требует решения") &&
      String(reviewTriage.answer).includes("сначала разобрать конфликты") &&
      reviewTriage.proposed_actions[0]?.label === "Сначала конфликты / дубликаты" &&
      reviewTriage.proposed_actions[1]?.label === "Затем Needs your decision" &&
      reviewTriage.proposed_actions[2]?.label === "Потом импорт-кандидаты",
    `Review triage answer/actions failed: ${JSON.stringify(reviewTriage)}`
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
    dashboard: baseDashboard,
    database: {
      recallAgentMemories: async (input) => ({
        trace_id: "trace-provenance",
        truncated: false,
        memories: [
          {
            memory_id: "memory-provenance-current",
            title: "Capture proof source",
            body: "The agent wrote capture proof after context read and checkpoint.",
            status: "accepted",
            use_policy: "recall_allowed",
            scope: "project",
            scope_kind: "project",
            provenance: {
              summary: "From source AGENTS.md",
              source_path: "AGENTS.md"
            },
            source_refs: []
          }
        ],
        query: input.query
      })
    }
  });
  assert(
    provenance.understanding.source === "local_ai" &&
      provenance.intent === "provenance" &&
      provenance.result_type === "read_only_answer" &&
      provenance.memory_lookup_result?.status === "found" &&
      provenance.memory_lookup_result?.same_project_hits.length === 1,
    `Provenance intent failed: ${JSON.stringify(provenance)}`
  );
  assert(
    provenance.facts.selected_source_name === "AGENTS.md" &&
      provenance.memory_lookup_result?.source_filter?.label === "AGENTS.md" &&
      String(provenance.answer).includes("Capture proof source") &&
      String(provenance.answer).includes("AGENTS.md") &&
      provenance.proposed_actions[0]?.label === "Open Evidence excerpts",
    `Provenance answer did not explain source refs: ${JSON.stringify(provenance)}`
  );

  assert(seenRequests.length === 20, `Unexpected mock AI call count: ${seenRequests.length}`);
} finally {
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
  restoreEnv("RECALLANT_OLLAMA_URL", previousUrl);
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_MODEL", previousModel);
  globalThis.fetch = previousFetch;
}

process.stdout.write("Management chat AI smoke passed\n");
