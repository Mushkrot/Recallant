import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const token = `review-smoke-${randomUUID()}`;
process.env.RECALLANT_AUTH_TOKEN = token;

const developerId = randomUUID();
const projectId = randomUUID();
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = process.cwd();

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath: process.cwd() });
await db.ensureProject(process.cwd());
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
    !htmlText.includes(candidate.memory_id) ||
    !htmlText.includes(rule.memory_id) ||
    !htmlText.includes("Cost / Paid API") ||
    !htmlText.includes("Settings") ||
    !htmlText.includes("Management Chat")
  ) {
    throw new Error(`Review UI HTML smoke failed: ${html.status} ${htmlText.slice(0, 500)}`);
  }

  const api = await fetch(`${baseUrl}/api/review-dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const json = await api.json();
  if (
    api.status !== 200 ||
    !json.inbox.some((memory) => memory.memory_id === candidate.memory_id) ||
    !json.rules.some((memory) => memory.memory_id === rule.memory_id) ||
    json.critical.pending_review < 1
  ) {
    throw new Error(`Review dashboard API smoke failed: ${JSON.stringify(json)}`);
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
    throw new Error(`Dangerous setting was not confirmation-gated: ${JSON.stringify(blockedSettingJson)}`);
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
  if (!audit.settings.some((setting) => setting.key === "capture_profile" && setting.source === "project_settings")) {
    throw new Error(`Updated setting is missing from dashboard: ${JSON.stringify(audit.settings)}`);
  }
} finally {
  server.close();
  await db.close();
}

process.stdout.write("Review UI smoke passed\n");
