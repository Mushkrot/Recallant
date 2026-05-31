import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { URLSearchParams } from "node:url";
import { createRecallantHttpServer, getRecallantHttpConfig } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const token = `review-smoke-${randomUUID()}`;
process.env.RECALLANT_AUTH_TOKEN = token;
process.env.RECALLANT_SESSION_SECRET = `review-session-${randomUUID()}`;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
delete process.env.RECALLANT_CLOUDFLARE_MODE;
delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
delete process.env.RECALLANT_ADMIN_EMAILS;

const defaultHttpConfig = getRecallantHttpConfig();
if (
  defaultHttpConfig.host !== "127.0.0.1" ||
  defaultHttpConfig.cloudflare.mode !== "disabled" ||
  defaultHttpConfig.recallant_auth_required !== true
) {
  throw new Error(`Unexpected default HTTP security config: ${JSON.stringify(defaultHttpConfig)}`);
}

const originalHost = process.env.RECALLANT_HOST;
const originalAllowPublicBind = process.env.RECALLANT_ALLOW_PUBLIC_BIND;
try {
  process.env.RECALLANT_HOST = "0.0.0.0";
  delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  try {
    getRecallantHttpConfig();
    throw new Error("Public bind was allowed without explicit opt-in");
  } catch (error) {
    if (!String(error).includes("VALIDATION_ERROR")) throw error;
  }
  process.env.RECALLANT_ALLOW_PUBLIC_BIND = "true";
  const publicOptInConfig = getRecallantHttpConfig();
  if (publicOptInConfig.public_bind_allowed !== true) {
    throw new Error(`Public bind opt-in config failed: ${JSON.stringify(publicOptInConfig)}`);
  }
} finally {
  if (originalHost === undefined) delete process.env.RECALLANT_HOST;
  else process.env.RECALLANT_HOST = originalHost;
  if (originalAllowPublicBind === undefined) delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  else process.env.RECALLANT_ALLOW_PUBLIC_BIND = originalAllowPublicBind;
}

const developerId = randomUUID();
const projectId = randomUUID();
const sandboxProjectId = randomUUID();
const sandboxPath = `/ai/recallant-pilots/review-ui-sandbox-${randomUUID()}`;
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = process.cwd();

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath: process.cwd() });
const sandboxDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: sandboxProjectId,
  projectPath: sandboxPath
});
await db.ensureProject(process.cwd());
await sandboxDb.ensureProject(sandboxPath);
const session = await db.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "review-ui-smoke",
  resume_policy: "normal"
});
const event = await db.appendTurn({
  session_id: session.session_id,
  client_kind: "codex",
  role: "user",
  text: "Review UI smoke source event.",
  dedup_key: `review-ui-${randomUUID()}`
});
const importText =
  "Imported AGENTS.md says the pilot sandbox should review source refs before promotion.";
const importSource = await db.importSource({
  client_kind: "recallant-review-smoke",
  project_path: process.cwd(),
  source_path: "AGENTS.md",
  source_type: "agent_instructions",
  source_sha256: createHash("sha256").update(importText).digest("hex"),
  source_size_bytes: importText.length,
  content_type: "text/markdown",
  import_text: importText,
  bounded_excerpt: importText,
  result_class: "repo_contract",
  result_classes: ["repo_contract", "startup_instruction", "possible_conflict"],
  scope_kind: "project",
  scope_id: projectId,
  audience: [{ kind: "all_agents", id: null }],
  risk: "medium",
  risks: [{ code: "possible_conflict", severity: "warning", message: "smoke conflict" }]
});
const importMemoryId = importSource.memory_ids[0];
if (!importMemoryId)
  throw new Error(`Import source did not create memory: ${JSON.stringify(importSource)}`);
const candidate = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "developer",
  title: "Always review important rules",
  body: "Always review important rules in the Review Command Center.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "Review UI smoke" }]
});
const rule = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "project",
  title: "Review UI active rule",
  body: "Instruction-grade rules must appear separately from ordinary memories.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "active rule" }]
});
await db.reviewAgentMemory({
  memory_id: rule.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "review ui smoke"
});
const editable = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI editable memory",
  body: "Review UI should edit this memory through a browser form.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "editable memory" }]
});
const duplicate = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI duplicate memory",
  body: "Review UI should merge this duplicate into another memory.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate memory" }]
});
const forgetSecret = `REVIEW_UI_FORGET_SECRET_${randomUUID()}`;
const forgettable = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI forget forever memory",
  body: `This memory contains ${forgetSecret} and must be redacted by forget forever.`,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: forgetSecret }]
});

const server = createRecallantHttpServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to get review UI address");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const unauthorized = await fetch(`${baseUrl}/review`);
  if (unauthorized.status !== 401) {
    throw new Error(`Review UI did not require auth: ${unauthorized.status}`);
  }

  const html = await fetch(`${baseUrl}/review`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const htmlText = await html.text();
  const requiredHtml = [
    "Recallant Review Command Center",
    "What Needs Attention",
    "Project Actions",
    "Import Candidates",
    "Selected Detail",
    "Evidence excerpts",
    "Recommended action",
    "Technical details",
    "Promote to rule",
    "Edit memory",
    "Supersede / merge",
    "Forget forever",
    "AGENTS.md",
    importMemoryId,
    candidate.memory_id,
    rule.memory_id,
    "Cost / Paid API",
    "Settings",
    "Edit project settings",
    "Context budget",
    "Enabled clients",
    "Project aliases",
    "system_settings",
    "Management Chat",
    'id="management-chat"',
    "Agent Readiness",
    "Registered only. Agent context has not been read yet.",
    "last context read",
    "last memory write",
    "local cleanup dry-run",
    "Ask what to review next",
    "Local embeddings"
  ];
  const missingHtml = requiredHtml.filter((marker) => !htmlText.includes(marker));
  if (html.status !== 200 || missingHtml.length > 0) {
    throw new Error(
      `Review UI HTML smoke failed: ${html.status}; missing ${JSON.stringify(missingHtml)}; ${htmlText.slice(0, 500)}`
    );
  }

  const api = await fetch(`${baseUrl}/api/review-dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const json = await api.json();
  if (
    api.status !== 200 ||
    !json.import_candidates.some((memory) => memory.memory_id === importMemoryId) ||
    json.selected_detail?.memory?.id !== importMemoryId ||
    !json.selected_detail?.source_refs?.some((ref) => ref.source_id === importSource.event_id) ||
    !json.duplicate_conflicts.some((memory) => memory.memory_id === importMemoryId) ||
    !json.inbox.some((memory) => memory.memory_id === candidate.memory_id) ||
    !json.rules.some((memory) => memory.memory_id === rule.memory_id) ||
    json.project_readiness?.project_registered !== true ||
    typeof json.project_readiness?.capture_event_count !== "number" ||
    json.project_readiness?.last_context_read_at !== null ||
    !String(json.project_cleanup?.local_cleanup_command ?? "").includes(
      "recallant local-cleanup"
    ) ||
    json.critical.pending_review < 1
  ) {
    throw new Error(`Review dashboard API smoke failed: ${JSON.stringify(json)}`);
  }

  const russianChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Что дальше делать с этим проектом?"
    })
  });
  const russianChatJson = await russianChat.json();
  if (
    russianChat.status !== 200 ||
    russianChatJson.language !== "ru" ||
    russianChatJson.intent !== "next_steps" ||
    russianChatJson.understanding.source !== "rules" ||
    russianChatJson.confirmation_required !== false ||
    !String(russianChatJson.answer).includes("Следующий")
  ) {
    throw new Error(`Russian management chat smoke failed: ${JSON.stringify(russianChatJson)}`);
  }

  const globalRuleChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message:
        "Зафиксируй правило для всех проектов: агенты должны объяснять владельцу сложные решения простым языком."
    })
  });
  const globalRuleChatJson = await globalRuleChat.json();
  if (
    globalRuleChat.status !== 200 ||
    globalRuleChatJson.intent !== "global_rule" ||
    globalRuleChatJson.confirmation_required !== false ||
    globalRuleChatJson.global_rule_result?.status !== "created" ||
    globalRuleChatJson.global_rule_result?.scope !== "developer"
  ) {
    throw new Error(`Global rule chat smoke failed: ${JSON.stringify(globalRuleChatJson)}`);
  }
  const globalRuleMemory = await db.getAgentMemory(globalRuleChatJson.global_rule_result.memory_id);
  if (
    globalRuleMemory.memory?.scope !== "developer" ||
    globalRuleMemory.memory?.use_policy !== "instruction_grade" ||
    globalRuleMemory.memory?.status !== "accepted"
  ) {
    throw new Error(`Global rule was not binding: ${JSON.stringify(globalRuleMemory)}`);
  }

  const destructiveChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Удали этот проект навсегда"
    })
  });
  const destructiveChatJson = await destructiveChat.json();
  if (
    destructiveChat.status !== 200 ||
    destructiveChatJson.confirmation_required !== true ||
    destructiveChatJson.proposed_actions.length < 1 ||
    destructiveChatJson.facts.target_project_id !== projectId ||
    !String(destructiveChatJson.proposed_actions[0]?.command).includes(projectId) ||
    !String(destructiveChatJson.answer).includes("предварительная проверка")
  ) {
    throw new Error(
      `Destructive management chat was not confirmation-gated: ${JSON.stringify(destructiveChatJson)}`
    );
  }

  const sandboxDestructiveChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Удали этот sandbox проект"
    })
  });
  const sandboxDestructiveChatJson = await sandboxDestructiveChat.json();
  if (
    sandboxDestructiveChat.status !== 200 ||
    sandboxDestructiveChatJson.confirmation_required !== true ||
    sandboxDestructiveChatJson.facts.target_project_id !== sandboxProjectId ||
    sandboxDestructiveChatJson.proposed_actions.length < 1 ||
    !String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes(sandboxProjectId) ||
    String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes(projectId)
  ) {
    throw new Error(
      `Sandbox management chat targeted the wrong project: ${JSON.stringify(sandboxDestructiveChatJson)}`
    );
  }

  const destructiveChatForm = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      message: "Удали этот sandbox проект"
    })
  });
  const destructiveChatFormHtml = await destructiveChatForm.text();
  if (
    destructiveChatForm.status !== 200 ||
    !destructiveChatFormHtml.includes("Перед рискованным действием требуется подтверждение.") ||
    !destructiveChatFormHtml.includes("Предложенный следующий шаг") ||
    !destructiveChatFormHtml.includes(sandboxProjectId) ||
    destructiveChatFormHtml.includes("Confirmation required before any risky action can run.")
  ) {
    throw new Error(
      `Management chat destructive form smoke failed: ${destructiveChatForm.status} ${destructiveChatFormHtml}`
    );
  }

  const chatForm = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      message: "Объясни context pack простым языком"
    })
  });
  const chatFormHtml = await chatForm.text();
  if (
    chatForm.status !== 200 ||
    !chatFormHtml.includes("Ответ Recallant") ||
    !chatFormHtml.includes("Context Pack")
  ) {
    throw new Error(`Management chat form smoke failed: ${chatForm.status} ${chatFormHtml}`);
  }

  const detachDryRunApi = await fetch(`${baseUrl}/api/project-detach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: sandboxProjectId,
      mode: "sandbox"
    })
  });
  const detachDryRunApiJson = await detachDryRunApi.json();
  if (
    detachDryRunApi.status !== 200 ||
    detachDryRunApiJson.status !== "pending_confirmation" ||
    detachDryRunApiJson.dry_run !== true ||
    detachDryRunApiJson.writes_database !== false ||
    detachDryRunApiJson.affected?.sessions === undefined
  ) {
    throw new Error(`Project detach dry-run API failed: ${JSON.stringify(detachDryRunApiJson)}`);
  }

  const detachDryRunForm = await fetch(`${baseUrl}/project-detach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: sandboxProjectId,
      mode: "sandbox"
    })
  });
  const detachDryRunFormHtml = await detachDryRunForm.text();
  if (
    detachDryRunForm.status !== 200 ||
    !detachDryRunFormHtml.includes("Dry-run complete. Nothing changed yet.") ||
    !detachDryRunFormHtml.includes("Confirm remove from Recallant") ||
    !detachDryRunFormHtml.includes("Dry-run remove selected project") ||
    !detachDryRunFormHtml.includes(sandboxProjectId)
  ) {
    throw new Error(
      `Project detach dry-run form failed: ${detachDryRunForm.status} ${detachDryRunFormHtml}`
    );
  }

  const detachConfirmForm = await fetch(`${baseUrl}/project-detach`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: sandboxProjectId,
      mode: "sandbox",
      confirm: "true"
    })
  });
  if (detachConfirmForm.status !== 303 || detachConfirmForm.headers.get("location") !== "/review") {
    throw new Error(`Project detach confirm form failed: ${detachConfirmForm.status}`);
  }
  const postDetachDashboard = await db.getReviewDashboard({ project_id: projectId });
  if (postDetachDashboard.projects.some((project) => project.project_id === sandboxProjectId)) {
    throw new Error(
      `Detached sandbox project is still visible: ${JSON.stringify(postDetachDashboard.projects)}`
    );
  }

  const accepted = await fetch(`${baseUrl}/api/review-action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      memory_id: candidate.memory_id,
      action: "accept",
      actor_kind: "user",
      note: "review ui action smoke"
    })
  });
  const acceptedJson = await accepted.json();
  if (accepted.status !== 200 || acceptedJson.status !== "accepted") {
    throw new Error(`Review action API smoke failed: ${JSON.stringify(acceptedJson)}`);
  }

  async function createReviewActionMemory(title) {
    return db.createAgentMemory({
      memory_type: "decision",
      scope: "project",
      title,
      body: `${title} body.`,
      created_by: "agent",
      source_refs: [{ source_kind: "event", source_id: event.event_id, quote: title }]
    });
  }

  async function apiReviewAction(memoryId, action, extra = {}) {
    const response = await fetch(`${baseUrl}/api/review-action`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        memory_id: memoryId,
        action,
        actor_kind: "user",
        note: `review ui ${action} matrix smoke`,
        ...extra
      })
    });
    const payload = await response.json();
    if (response.status !== 200 || payload.ok !== true) {
      throw new Error(`Review action ${action} failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  const rejectedMemory = await createReviewActionMemory("Review UI reject action");
  const rejected = await apiReviewAction(rejectedMemory.memory_id, "reject");
  if (rejected.status !== "rejected" || rejected.use_policy !== "do_not_use") {
    throw new Error(`Reject action did not set do_not_use: ${JSON.stringify(rejected)}`);
  }

  const archivedMemory = await createReviewActionMemory("Review UI archive action");
  const archived = await apiReviewAction(archivedMemory.memory_id, "archive");
  if (archived.status !== "archived") {
    throw new Error(`Archive action failed: ${JSON.stringify(archived)}`);
  }
  const unarchived = await apiReviewAction(archivedMemory.memory_id, "unarchive");
  if (unarchived.status !== "accepted") {
    throw new Error(`Unarchive action failed: ${JSON.stringify(unarchived)}`);
  }

  const staleMemory = await createReviewActionMemory("Review UI stale action");
  const stale = await apiReviewAction(staleMemory.memory_id, "mark_stale");
  if (stale.status !== "stale" || stale.use_policy !== "evidence_only") {
    throw new Error(`Mark stale action failed: ${JSON.stringify(stale)}`);
  }

  const ruleMemory = await createReviewActionMemory("Review UI promote action");
  const promoted = await apiReviewAction(ruleMemory.memory_id, "promote_instruction");
  if (promoted.status !== "accepted" || promoted.use_policy !== "instruction_grade") {
    throw new Error(`Promote action failed: ${JSON.stringify(promoted)}`);
  }
  const demoted = await apiReviewAction(ruleMemory.memory_id, "demote_instruction");
  if (demoted.use_policy !== "recall_allowed") {
    throw new Error(`Demote action failed: ${JSON.stringify(demoted)}`);
  }

  const supersededMemory = await createReviewActionMemory("Review UI supersede action");
  const superseded = await apiReviewAction(supersededMemory.memory_id, "supersede", {
    superseded_by: ruleMemory.memory_id
  });
  if (superseded.status !== "superseded") {
    throw new Error(`Supersede action failed: ${JSON.stringify(superseded)}`);
  }

  const editForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: editable.memory_id,
      action: "edit",
      title: "Review UI edited memory",
      body: "The browser review form updated this memory body.",
      note: "review ui edit form smoke"
    })
  });
  if (
    editForm.status !== 303 ||
    !String(editForm.headers.get("location")).includes(editable.memory_id)
  ) {
    throw new Error(`Review action edit form failed: ${editForm.status}`);
  }
  const editedDetail = await db.getAgentMemory(editable.memory_id);
  if (
    editedDetail.memory?.title !== "Review UI edited memory" ||
    editedDetail.memory?.body !== "The browser review form updated this memory body." ||
    editedDetail.source_refs.length !== 1 ||
    !editedDetail.review_actions.some((action) => action.action === "edit")
  ) {
    throw new Error(
      `Review action edit did not preserve/update detail: ${JSON.stringify(editedDetail)}`
    );
  }

  const mergeForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: editable.memory_id,
      action: "merge",
      merge_memory_ids: duplicate.memory_id,
      note: "review ui merge form smoke"
    })
  });
  if (
    mergeForm.status !== 303 ||
    !String(mergeForm.headers.get("location")).includes(editable.memory_id)
  ) {
    throw new Error(`Review action merge form failed: ${mergeForm.status}`);
  }
  const duplicateDetail = await db.getAgentMemory(duplicate.memory_id);
  if (
    duplicateDetail.memory?.status !== "superseded" ||
    duplicateDetail.memory?.superseded_by !== editable.memory_id
  ) {
    throw new Error(
      `Review action merge did not supersede duplicate: ${JSON.stringify(duplicateDetail)}`
    );
  }

  const forgetDryRunApi = await fetch(`${baseUrl}/api/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      target: { kind: "agent_memory", id: forgettable.memory_id, selector: {} },
      reason: "review ui forget dry-run smoke",
      dry_run: false,
      confirmation: { confirmed: false }
    })
  });
  const forgetDryRunApiJson = await forgetDryRunApi.json();
  if (
    forgetDryRunApi.status !== 200 ||
    forgetDryRunApiJson.status !== "pending_confirmation" ||
    forgetDryRunApiJson.requires_confirmation !== true ||
    forgetDryRunApiJson.affected?.agent_memories !== 1
  ) {
    throw new Error(`Memory forget API dry-run failed: ${JSON.stringify(forgetDryRunApiJson)}`);
  }
  const afterForgetDryRun = await db.getAgentMemory(forgettable.memory_id);
  if (!String(afterForgetDryRun.memory?.body).includes(forgetSecret)) {
    throw new Error(`Memory forget dry-run changed content: ${JSON.stringify(afterForgetDryRun)}`);
  }

  const forgetDryRunForm = await fetch(`${baseUrl}/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      target_kind: "agent_memory",
      target_id: forgettable.memory_id,
      reason: "review ui forget form smoke"
    })
  });
  const forgetDryRunFormHtml = await forgetDryRunForm.text();
  if (
    forgetDryRunForm.status !== 200 ||
    !forgetDryRunFormHtml.includes("Dry-run complete. Nothing was erased.") ||
    !forgetDryRunFormHtml.includes("Confirm forget forever") ||
    !forgetDryRunFormHtml.includes(forgettable.memory_id)
  ) {
    throw new Error(
      `Memory forget form dry-run failed: ${forgetDryRunForm.status} ${forgetDryRunFormHtml}`
    );
  }

  const forgetConfirmForm = await fetch(`${baseUrl}/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      target_kind: "agent_memory",
      target_id: forgettable.memory_id,
      reason: "review ui confirmed forget smoke",
      confirm: "true"
    })
  });
  const forgetConfirmFormHtml = await forgetConfirmForm.text();
  if (
    forgetConfirmForm.status !== 200 ||
    !forgetConfirmFormHtml.includes("Forget forever complete. Recallant content was redacted.") ||
    !forgetConfirmFormHtml.includes("Redacted receipt") ||
    forgetConfirmFormHtml.includes(forgetSecret)
  ) {
    throw new Error(
      `Memory forget form confirmation failed: ${forgetConfirmForm.status} ${forgetConfirmFormHtml}`
    );
  }
  const forgottenDetail = await db.getAgentMemory(forgettable.memory_id);
  if (
    forgottenDetail.memory?.title !== "[REDACTED]" ||
    forgottenDetail.memory?.body !== "[REDACTED]" ||
    forgottenDetail.memory?.status !== "archived" ||
    forgottenDetail.memory?.use_policy !== "do_not_use" ||
    forgottenDetail.source_refs.some((ref) => ref.quote !== null)
  ) {
    throw new Error(
      `Memory forget did not redact governed memory: ${JSON.stringify(forgottenDetail)}`
    );
  }
  const erasureReceipt = await db.pool.query(
    "SELECT target_selector, redacted_receipt FROM erasure_requests WHERE target_selector->>'id' = $1",
    [forgettable.memory_id]
  );
  if (
    erasureReceipt.rowCount !== 1 ||
    JSON.stringify(erasureReceipt.rows).includes(forgetSecret) ||
    erasureReceipt.rows[0]?.redacted_receipt?.content_redacted !== true
  ) {
    throw new Error(`Erasure receipt is unsafe or missing: ${JSON.stringify(erasureReceipt.rows)}`);
  }

  const blockedSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "paid_api_mode",
      value: "auto_with_caps",
      reason: "review ui smoke"
    })
  });
  const blockedSettingJson = await blockedSetting.json();
  if (blockedSetting.status !== 409 || blockedSettingJson.status !== "confirmation_required") {
    throw new Error(
      `Dangerous setting was not confirmation-gated: ${JSON.stringify(blockedSettingJson)}`
    );
  }

  const updatedSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "capture_profile",
      value: "detailed",
      reason: "review ui smoke confirmed",
      confirmation: { confirmed: true }
    })
  });
  const updatedSettingJson = await updatedSetting.json();
  if (updatedSetting.status !== 200 || updatedSettingJson.status !== "updated") {
    throw new Error(`Confirmed setting update failed: ${JSON.stringify(updatedSettingJson)}`);
  }

  const settingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "review_sensitivity",
      value: "strict",
      reason: "review ui settings form smoke"
    })
  });
  const settingFormHtml = await settingForm.text();
  if (
    settingForm.status !== 200 ||
    !settingFormHtml.includes("Setting updated.") ||
    !settingFormHtml.includes("Review sensitivity") ||
    !settingFormHtml.includes("project_settings")
  ) {
    throw new Error(`Project setting form update failed: ${settingForm.status} ${settingFormHtml}`);
  }

  const dangerousSettingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "embedding_route_enabled",
      value: "false",
      reason: "review ui dangerous setting form smoke"
    })
  });
  const dangerousSettingFormHtml = await dangerousSettingForm.text();
  if (
    dangerousSettingForm.status !== 409 ||
    !dangerousSettingFormHtml.includes("Confirmation required before changing setting.") ||
    !dangerousSettingFormHtml.includes("Confirm setting change")
  ) {
    throw new Error(
      `Project dangerous setting form did not require confirmation: ${dangerousSettingForm.status} ${dangerousSettingFormHtml}`
    );
  }

  const confirmedDangerousSettingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "embedding_route_enabled",
      value: "false",
      reason: "review ui confirmed dangerous setting form smoke",
      confirm: "true"
    })
  });
  const confirmedDangerousSettingFormHtml = await confirmedDangerousSettingForm.text();
  if (
    confirmedDangerousSettingForm.status !== 200 ||
    !confirmedDangerousSettingFormHtml.includes("Setting updated.") ||
    !confirmedDangerousSettingFormHtml.includes("Local embedding route")
  ) {
    throw new Error(
      `Project dangerous setting confirmation failed: ${confirmedDangerousSettingForm.status} ${confirmedDangerousSettingFormHtml}`
    );
  }

  const settingsAudit = await db.pool.query(
    "SELECT key, new_value FROM settings_audit_events WHERE scope_id = $1 AND key IN ('review_sensitivity', 'embedding_route_enabled')",
    [projectId]
  );
  if (
    settingsAudit.rowCount < 2 ||
    !settingsAudit.rows.some(
      (row) => row.key === "review_sensitivity" && row.new_value === "strict"
    ) ||
    !settingsAudit.rows.some(
      (row) => row.key === "embedding_route_enabled" && row.new_value === false
    )
  ) {
    throw new Error(`Project setting audit rows missing: ${JSON.stringify(settingsAudit.rows)}`);
  }

  const audit = await db.getReviewDashboard();
  if (
    !audit.settings.some(
      (setting) => setting.key === "capture_profile" && setting.source === "project_settings"
    )
  ) {
    throw new Error(`Updated setting is missing from dashboard: ${JSON.stringify(audit.settings)}`);
  }

  process.env.RECALLANT_CLOUDFLARE_MODE = "enabled";
  process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH = "required";
  process.env.RECALLANT_ADMIN_EMAILS = "owner@example.invalid";
  const cloudflareConfig = getRecallantHttpConfig();
  if (
    cloudflareConfig.cloudflare.edge_auth_required !== true ||
    cloudflareConfig.cloudflare.admin_email_count !== 1
  ) {
    throw new Error(`Cloudflare config failed: ${JSON.stringify(cloudflareConfig)}`);
  }
  const bearerStillAuthorized = await fetch(`${baseUrl}/review`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (bearerStillAuthorized.status !== 200) {
    throw new Error(
      `Cloudflare mode blocked Recallant bearer API auth: ${bearerStillAuthorized.status}`
    );
  }
  const browserMissingEdgeAuth = await fetch(`${baseUrl}/review`);
  if (browserMissingEdgeAuth.status !== 401) {
    throw new Error(
      `Cloudflare mode allowed browser without edge auth: ${browserMissingEdgeAuth.status}`
    );
  }
  const wrongEdgeIdentity = await fetch(`${baseUrl}/review`, {
    headers: {
      "cf-access-authenticated-user-email": "intruder@example.invalid",
      "cf-access-jwt-assertion": "signed-by-cloudflare"
    }
  });
  if (wrongEdgeIdentity.status !== 401) {
    throw new Error(`Cloudflare mode allowed non-admin identity: ${wrongEdgeIdentity.status}`);
  }
  const edgeAuthorized = await fetch(`${baseUrl}/review`, {
    headers: {
      "cf-access-authenticated-user-email": "owner@example.invalid",
      "cf-access-jwt-assertion": "signed-by-cloudflare"
    }
  });
  if (edgeAuthorized.status !== 200) {
    throw new Error(`Cloudflare edge-auth browser session failed: ${edgeAuthorized.status}`);
  }
  const setCookie = edgeAuthorized.headers.get("set-cookie");
  if (!setCookie?.includes("recallant_session=") || !setCookie.includes("HttpOnly")) {
    throw new Error(`Cloudflare edge-auth did not issue a secure session cookie: ${setCookie}`);
  }
  const sessionAuthorized = await fetch(`${baseUrl}/api/review-dashboard`, {
    headers: { cookie: setCookie.split(";")[0] }
  });
  if (sessionAuthorized.status !== 200) {
    throw new Error(`Recallant session cookie auth failed: ${sessionAuthorized.status}`);
  }
} finally {
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;
  server.close();
  await sandboxDb.close();
  await db.close();
}

process.stdout.write("Review UI smoke passed\n");
