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
  if (
    html.status !== 200 ||
    !htmlText.includes("Recallant Review Command Center") ||
    !htmlText.includes("What Needs Attention") ||
    !htmlText.includes("Project Actions") ||
    !htmlText.includes("Import Candidates") ||
    !htmlText.includes("Selected Detail") ||
    !htmlText.includes("Evidence excerpts") ||
    !htmlText.includes("Recommended action") ||
    !htmlText.includes("Technical details") ||
    !htmlText.includes("AGENTS.md") ||
    !htmlText.includes(importMemoryId) ||
    !htmlText.includes(candidate.memory_id) ||
    !htmlText.includes(rule.memory_id) ||
    !htmlText.includes("Cost / Paid API") ||
    !htmlText.includes("Settings") ||
    !htmlText.includes("Management Chat") ||
    !htmlText.includes('id="management-chat"') ||
    !htmlText.includes("Agent Readiness") ||
    !htmlText.includes("Ask what to review next") ||
    !htmlText.includes("Local embeddings")
  ) {
    throw new Error(`Review UI HTML smoke failed: ${html.status} ${htmlText.slice(0, 500)}`);
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
    typeof json.project_readiness?.active_chunk_count !== "number" ||
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
