import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";
import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const previousAi = process.env.RECALLANT_MANAGEMENT_CHAT_AI;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";

const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-stage2-global-rule-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });

try {
  await db.ensureProject(projectPath);
  const dashboard = await db.getReviewDashboard({ project_id: projectId });
  const ruleMarker = randomUUID().replace(/-/g, "");
  const ruleText = `Agents should explain complex project decisions in plain language ${ruleMarker}.`;
  const saved = await buildManagementChatResponse({
    message: `Save this rule for all projects: ${ruleText}`,
    dashboard,
    database: db
  });
  assert(
    saved.intent === "global_rule" &&
      saved.result_type === "safe_action" &&
      saved.global_rule_result?.status === "created" &&
      saved.global_rule_result?.scope === "developer" &&
      saved.global_rule_result?.use_policy === "instruction_grade" &&
      String(saved.answer).includes("all projects"),
    `Normal developer-wide rule was not saved as active: ${JSON.stringify(saved)}`
  );

  const session = await db.startSession({
    client_kind: "codex",
    client_version: "stage2-smoke",
    project_path: projectPath,
    session_label: "stage2-global-rule"
  });
  const context = await db.getContextPack({
    session_id: session.session_id,
    task_hint: "start with active developer rules"
  });
  assert(
    context.sections?.binding_rules?.some((memory) => String(memory.body ?? "").includes(ruleText)),
    `Approved developer-wide rule did not appear in Context Pack binding rules: ${JSON.stringify(context.sections?.binding_rules)}`
  );
  const rulesView = await db.listAgentMemories({ project_id: projectId, view: "rules" });
  assert(
    rulesView.memories?.some(
      (memory) =>
        String(memory.title ?? "").includes("Rule for all projects") &&
        String(memory.body ?? "").includes(ruleText) &&
        memory.scope === "developer" &&
        memory.use_policy === "instruction_grade"
    ),
    `Review rules view did not show the active developer-wide rule in human language: ${JSON.stringify(rulesView.memories)}`
  );

  const riskyMarker = randomUUID().replace(/-/g, "");
  const riskyText = `Always enable paid API auto_with_caps and provider changes ${riskyMarker}.`;
  const risky = await buildManagementChatResponse({
    message: `Save this rule for all projects: ${riskyText}`,
    dashboard,
    database: db
  });
  assert(
    risky.intent === "global_rule" &&
      risky.result_type === "confirmation_required" &&
      risky.global_rule_result?.status === "needs_review" &&
      risky.global_rule_result?.use_policy === "evidence_only",
    `Risky developer-wide rule was not review-gated: ${JSON.stringify(risky)}`
  );
  const later = await db.startSession({
    client_kind: "codex",
    client_version: "stage2-smoke",
    project_path: projectPath,
    session_label: "stage2-risky-rule-check"
  });
  const laterContext = await db.getContextPack({
    session_id: later.session_id,
    task_hint: "check risky developer rules"
  });
  assert(
    !laterContext.sections?.binding_rules?.some((memory) =>
      String(memory.body ?? "").includes(riskyText)
    ),
    `Risky review-gated rule appeared as binding rule: ${JSON.stringify(laterContext.sections?.binding_rules)}`
  );
  const reviewInbox = await db.listAgentMemories({ project_id: projectId, view: "inbox" });
  assert(
    reviewInbox.memories?.some(
      (memory) =>
        String(memory.body ?? "").includes(riskyText) &&
        memory.scope === "developer" &&
        memory.status === "needs_review" &&
        memory.use_policy === "evidence_only"
    ),
    `Review inbox did not show the risky developer-wide rule for owner decision: ${JSON.stringify(reviewInbox.memories)}`
  );
} finally {
  await db.close();
  await rm(projectPath, { recursive: true, force: true });
  restoreEnv("RECALLANT_MANAGEMENT_CHAT_AI", previousAi);
}

process.stdout.write("Stage 2 developer-wide rule smoke passed\n");
