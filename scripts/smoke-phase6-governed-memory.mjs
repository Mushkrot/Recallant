import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-phase6-governed-"));
await writeFile(
  join(projectPath, "PROJECT_LOG.md"),
  "# Project Log\n\n## Current Session\n\nStatus: phase6 governed smoke.\n"
);

async function assertCliMcpServerLifecycle() {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId,
      RECALLANT_PROJECT_PATH: projectPath
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  let exit = null;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (exit) {
    throw new Error(
      `CLI mcp-server exited before client close: ${JSON.stringify({ exit, stderr })}`
    );
  }
  child.kill();
  await once(child, "close");
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

await assertCliMcpServerLifecycle();

const mcpEnvKeys = [
  "RECALLANT_DATABASE_URL",
  "RECALLANT_DEVELOPER_ID",
  "RECALLANT_PROJECT_ID",
  "RECALLANT_PROJECT_PATH"
];
const mcpEnvSnapshot = snapshotEnv(mcpEnvKeys);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = projectPath;

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({
  name: "recallant-phase6-governed-smoke",
  version: "0.0.0"
});
const mcpServer = createRecallantMcpServer();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

async function callTool(id, name, args) {
  const response = await mcpClient.callTool({ name, arguments: args }, undefined, {
    timeout: 30_000
  });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(String(text));
}

async function callToolError(id, name, args) {
  const response = await mcpClient.callTool({ name, arguments: args }, undefined, {
    timeout: 30_000
  });
  const text = response.content?.[0]?.text ?? "";
  if (response.isError !== true) throw new Error(`Expected ${name} to fail: ${JSON.stringify(response)}`);
  return String(text);
}

let nextToolId = 13;
async function callNextTool(name, args) {
  const response = await callTool(nextToolId, name, args);
  nextToolId += 1;
  return response;
}

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectPath,
  session_label: "phase6-governed-smoke",
  resume_policy: "normal"
});
const routeClient = new pg.Client({ connectionString: databaseUrl });
await routeClient.connect();
try {
  await routeClient.query(
    `
      INSERT INTO developer_settings (developer_id, key, value, updated_by)
      VALUES ($1, 'embedding_route', $2, 'smoke')
      ON CONFLICT (developer_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [
      developerId,
      JSON.stringify({
        route_class: "local_model",
        provider: "deterministic",
        model: "deterministic-phase6-governed",
        dims: 768
      })
    ]
  );
} finally {
  await routeClient.end();
}

const event = await callTool(3, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "Phase 6 source event for governed memory smoke.",
  dedup_key: `phase6-source-${randomUUID()}`
});

const autoSourced = await callTool(4, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Auto-sourced agent memory",
  body: "MCP agent memories without explicit source refs receive a safe runtime source ref.",
  created_by: "agent",
  source_refs: []
});
if (autoSourced.status !== "accepted" || autoSourced.use_policy !== "recall_allowed") {
  throw new Error(`Auto-sourced agent memory was not accepted: ${JSON.stringify(autoSourced)}`);
}

const ordinary = await callTool(5, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Recallant keeps governed memory in v1",
  body: "Governed memory is part of the v1 core and can be recalled when accepted.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "governed memory smoke" }]
});
if (ordinary.status !== "accepted" || ordinary.use_policy !== "recall_allowed") {
  throw new Error(`Ordinary governed memory policy failed: ${JSON.stringify(ordinary)}`);
}

const forbiddenMemoryError = await callToolError(12, "memory_create_agent_memory", {
  memory_type: "work_log",
  scope: "project",
  title: "Forbidden raw database URL",
  body: "RECALLANT_DATABASE_URL=postgres://user:secret@example.invalid:5432/db",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "forbidden payload" }]
});
if (
  !forbiddenMemoryError.includes("VALIDATION_ERROR") ||
  !forbiddenMemoryError.includes("database URLs")
) {
  throw new Error(`Forbidden governed memory payload was not rejected clearly: ${forbiddenMemoryError}`);
}

const candidate = await callTool(6, "memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "developer",
  title: "Always run governed memory smoke",
  body: "Always run governed memory smoke before changing memory policy.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "Always run" }]
});
if (candidate.status !== "candidate" || candidate.use_policy !== "recall_allowed") {
  throw new Error(`Candidate rule policy failed: ${JSON.stringify(candidate)}`);
}

const inbox = await callTool(7, "memory_list_agent_memories", {
  view: "inbox",
  limit: 20
});
if (
  !inbox.memories.some((memory) => memory.memory_id === candidate.memory_id) ||
  inbox.memories.some((memory) => memory.memory_id === ordinary.memory_id)
) {
  throw new Error(`Inbox filtering failed: ${JSON.stringify(inbox)}`);
}

const promoted = await callTool(8, "memory_review_agent_memory", {
  memory_id: candidate.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "phase6 smoke promotion"
});
if (promoted.status !== "accepted" || promoted.use_policy !== "instruction_grade") {
  throw new Error(`Instruction promotion failed: ${JSON.stringify(promoted)}`);
}

const rules = await callTool(9, "memory_list_agent_memories", {
  view: "rules",
  limit: 20
});
if (!rules.memories.some((memory) => memory.memory_id === candidate.memory_id)) {
  throw new Error(`Rules view failed: ${JSON.stringify(rules)}`);
}

const detail = await callTool(10, "memory_get_agent_memory", {
  memory_id: candidate.memory_id
});
if (detail.source_refs.length !== 1 || detail.review_actions.length < 1) {
  throw new Error(`Source/review detail failed: ${JSON.stringify(detail)}`);
}

const autoSourcedDetail = await callNextTool("memory_get_agent_memory", {
  memory_id: autoSourced.memory_id
});
if (autoSourcedDetail.source_refs.length !== 1) {
  throw new Error(`Auto-sourced memory missing source ref: ${JSON.stringify(autoSourcedDetail)}`);
}

const recall = await callTool(11, "memory_recall_agent_memories", {
  query: "governed memory",
  scope: "project",
  top_k: 5,
  max_chars_total: 2000
});
if (
  !recall.trace_id ||
  !recall.memories.some((memory) => memory.memory_id === ordinary.memory_id) ||
  recall.memories.some((memory) => memory.status !== "accepted")
) {
  throw new Error(`Governed recall failed: ${JSON.stringify(recall)}`);
}

await callTool(12, "memory_report_recall_usage", {
  trace_id: recall.trace_id,
  used_memory_ids: [ordinary.memory_id],
  ignored_memory_ids: [candidate.memory_id],
  note: "phase6 smoke usage"
});

const checkpointMarker = `phase4-searchable-checkpoint-${randomUUID()}`;
const stateOnlyCheckpoint = await callNextTool("memory_set_checkpoint", {
  payload: {
    current_status: "phase4 state-only checkpoint smoke",
    current_focus: `state-only ${checkpointMarker}`,
    next_step: "create searchable checkpoint through memory_agent_checkpoint",
    open_questions: []
  }
});
if (
  stateOnlyCheckpoint.checkpoint_state_only !== true ||
  stateOnlyCheckpoint.searchable_memory_created !== false ||
  stateOnlyCheckpoint.memory_id !== null
) {
  throw new Error(
    `State-only checkpoint output changed: ${JSON.stringify(stateOnlyCheckpoint)}`
  );
}

const searchableCheckpoint = await callNextTool("memory_agent_checkpoint", {
  session_id: started.session_id,
  client_kind: "codex",
  payload: {
    current_status: "phase4 searchable checkpoint smoke",
    current_focus: `Searchable checkpoint focus ${checkpointMarker}`,
    next_step: `Recall checkpoint memory ${checkpointMarker}`,
    summary: `Searchable checkpoint summary ${checkpointMarker}`,
    open_questions: []
  },
  metadata: { smoke: "phase4_checkpoint_parity" }
});
if (
  searchableCheckpoint.searchable_memory_created !== true ||
  searchableCheckpoint.checkpoint_state_only !== false ||
  searchableCheckpoint.event_appended !== true ||
  !searchableCheckpoint.event_id ||
  !searchableCheckpoint.memory_id ||
  searchableCheckpoint.memory?.memory_type !== "checkpoint" ||
  searchableCheckpoint.memory?.status !== "accepted"
) {
  throw new Error(
    `High-level checkpoint memory was not created: ${JSON.stringify(searchableCheckpoint)}`
  );
}

const checkpointRecall = await callNextTool("memory_recall_agent_memories", {
  query: checkpointMarker,
  scope: "project",
  memory_types: ["checkpoint"],
  include_candidates: true,
  include_stale: false,
  include_needs_review: true,
  top_k: 5,
  max_chars_total: 2000
});
if (
  !checkpointRecall.memories.some(
    (memory) =>
      memory.memory_id === searchableCheckpoint.memory_id &&
      String(memory.body ?? "").includes(checkpointMarker)
  )
) {
  throw new Error(`Checkpoint memory recall failed: ${JSON.stringify(checkpointRecall)}`);
}

const directUserRule = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "developer",
  title: "Always honor direct owner instructions",
  body: "Always honor direct owner instructions when they are explicit and safe.",
  confidence: 1,
  created_by: "user",
  metadata: { owner_confirmed_global_rule: true },
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "direct owner" }]
});
if (directUserRule.status !== "accepted" || directUserRule.use_policy !== "instruction_grade") {
  throw new Error(
    `Direct user instruction did not become instruction-grade: ${JSON.stringify(directUserRule)}`
  );
}

const needsReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Production deployment secret decision",
  body: "Production deployment API secret handling needs owner review before reuse.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "secret handling" }]
});
if (needsReview.status !== "needs_review" || needsReview.use_policy !== "evidence_only") {
  throw new Error(
    `High-risk agent memory was not routed to review: ${JSON.stringify(needsReview)}`
  );
}

const acceptedReview = await callNextTool("memory_review_agent_memory", {
  memory_id: needsReview.memory_id,
  action: "accept",
  actor_kind: "user",
  note: "phase6 accept smoke"
});
if (acceptedReview.status !== "accepted" || acceptedReview.use_policy !== "recall_allowed") {
  throw new Error(`Accept review action failed: ${JSON.stringify(acceptedReview)}`);
}

const approveAliasCandidate = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Always run approve alias smoke",
  body: "Always run approve alias smoke as a candidate rule.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "approve alias" }]
});
const approvedAlias = await callNextTool("memory_review_agent_memory", {
  memory_id: approveAliasCandidate.memory_id,
  action: "approve",
  actor_kind: "user",
  note: "phase6 approve alias smoke"
});
if (approvedAlias.status !== "accepted" || approvedAlias.use_policy !== "recall_allowed") {
  throw new Error(`Approve alias failed: ${JSON.stringify(approvedAlias)}`);
}

const lowConfidence = await callNextTool("memory_create_agent_memory", {
  memory_type: "preference",
  scope: "developer",
  title: "Maybe all projects should use phase6 low confidence style",
  body: "Maybe all projects should use phase6 low confidence style.",
  confidence: 0.2,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "Maybe all projects" }]
});
if (lowConfidence.status !== "needs_review") {
  throw new Error(
    `Low-confidence behavior guidance did not require review: ${JSON.stringify(lowConfidence)}`
  );
}

const highRiskInboxItem = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 inbox high risk secret handling",
  body: "This project has a secret handling rule that needs review before reuse.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "secret handling" }]
});
const candidateInboxItem = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Always keep phase6 inbox candidate visible",
  body: "Always keep phase6 inbox candidate visible until owner review.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "inbox candidate" }]
});
const scopeChangingCandidate = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "developer",
  title: "Always keep scope-changing phase6 candidate visible",
  body: "Always keep scope-changing candidates visible until owner review.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "scope changing" }],
  metadata: { scope_change: true }
});
const acceptedDuplicateReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 accepted duplicate still needs review",
  body: "Accepted duplicate candidates should remain visible for merge/archive review.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate review" }],
  metadata: { possible_duplicate: true, review_candidate_action: "merge" }
});
const acceptedConflictReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 accepted conflict still needs review",
  body: "Accepted conflict candidates should remain visible for supersede review.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "conflict review" }],
  metadata: { possible_conflict: true, review_candidate_action: "supersede" }
});
const promotionReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Phase6 accepted promotion candidate",
  body: "Promotion candidates should remain visible until an owner promotes or rejects them.",
  confidence: 0.9,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "promotion review" }],
  metadata: { recommended_action: "promote_instruction", long_term: true }
});
const demotionReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "developer",
  title: "Phase6 accepted demotion candidate",
  body: "Instruction-grade memories can be proposed for demotion without disappearing from review.",
  confidence: 1,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "demotion review" }],
  metadata: {
    owner_confirmed_global_rule: true,
    review_candidate_action: "demote_instruction"
  }
});
const archiveReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 accepted archive candidate",
  body: "Archive candidates should remain visible until an owner archives or keeps them.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "archive review" }],
  metadata: { review_candidate_action: "archive" }
});
const supersedeReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 accepted supersede candidate",
  body: "Supersede candidates should remain visible until a canonical memory is chosen.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "supersede review" }],
  metadata: { review_candidate_action: "supersede" }
});
const expandedInbox = await callNextTool("memory_list_agent_memories", {
  view: "inbox",
  limit: 50
});
if (
  !expandedInbox.memories.some((memory) => memory.memory_id === candidateInboxItem.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === lowConfidence.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === highRiskInboxItem.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === scopeChangingCandidate.memory_id) ||
  !expandedInbox.memories.some(
    (memory) => memory.memory_id === acceptedDuplicateReview.memory_id
  ) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === acceptedConflictReview.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === promotionReview.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === demotionReview.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === archiveReview.memory_id) ||
  !expandedInbox.memories.some((memory) => memory.memory_id === supersedeReview.memory_id) ||
  expandedInbox.memories.some((memory) => memory.memory_id === ordinary.memory_id)
) {
  throw new Error(`Expanded inbox policy failed: ${JSON.stringify(expandedInbox)}`);
}

const duplicateA = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Duplicate phase6 review rule",
  body: "Always keep duplicate phase6 review rule as the first candidate.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate first" }]
});
const duplicateB = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Duplicate phase6 review rule",
  body: "Always keep duplicate phase6 review rule as the second candidate.",
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate second" }]
});
const duplicates = await callNextTool("memory_list_agent_memories", {
  view: "duplicates",
  limit: 20
});
if (
  !duplicates.memories.some((memory) => memory.memory_id === duplicateA.memory_id) ||
  !duplicates.memories.some((memory) => memory.memory_id === duplicateB.memory_id) ||
  !duplicates.memories.every((memory) => memory.possible_duplicate === true)
) {
  throw new Error(`Duplicate report failed: ${JSON.stringify(duplicates)}`);
}

const conflictOld = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Production deploy provider",
  body: "Always use blue provider for production deploys.",
  confidence: 1,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "blue provider" }]
});
const conflictNew = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Production deploy provider",
  body: "Always use green provider for production deploys.",
  confidence: 1,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "green provider" }]
});
const conflicts = await callNextTool("memory_list_agent_memories", {
  view: "conflicts",
  limit: 20
});
const highRiskConflict = conflicts.memories.find(
  (memory) => memory.memory_id === conflictNew.memory_id
);
if (
  !conflicts.memories.some((memory) => memory.memory_id === conflictOld.memory_id) ||
  !highRiskConflict ||
  highRiskConflict.review_status !== "needs_review" ||
  highRiskConflict.conflict_report?.adr !== "ADR-0041" ||
  !String(highRiskConflict.conflict_report?.authority ?? "").includes("equal") ||
  !String(highRiskConflict.conflict_report?.resolution ?? "").includes("review")
) {
  throw new Error(`Conflict report failed: ${JSON.stringify(conflicts)}`);
}

const warningCloseout = await callNextTool("memory_closeout", {
  session_id: started.session_id,
  closeout_intent: "task_complete",
  summary: "Phase 6 closeout warning smoke.",
  checkpoint_payload: {
    current_status: "warning smoke complete",
    current_focus: "closeout warning policy",
    next_step: "review warning report",
    open_questions: []
  },
  governed_memory_candidates: [
    {
      memory_type: "decision",
      title: "Low confidence closeout extraction",
      body: "Maybe this low confidence extraction should become memory.",
      confidence: 0.2,
      source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "low confidence" }]
    }
  ],
  artifact_refs: [],
  local_spool_status: { status: "unsynced", unsynced_count: 2 },
  closeout_diagnostics: {
    repo_sync_status: "incomplete",
    extraction_confidence: 0.2,
    server_errors: ["phase6 server warning"],
    model_errors: ["phase6 model warning"],
    provider_errors: ["phase6 provider warning"]
  }
});
if (
  warningCloseout.report_required !== true ||
  warningCloseout.warnings.length < 6 ||
  !warningCloseout.warnings.some((warning) => warning.includes("Local spool")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("conflicts")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("Repository sync")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("confidence")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("server/errors")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("model/errors")) ||
  !warningCloseout.warnings.some((warning) => warning.includes("provider/errors"))
) {
  throw new Error(`Closeout warning report failed: ${JSON.stringify(warningCloseout)}`);
}

await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  scope_kind: "client_adapter",
  scope_id: "codex",
  audience: [{ kind: "specific_client", id: "codex" }],
  title: "Client adapter non-overlap phase6",
  body: "Always use Codex-only adapter behavior.",
  confidence: 1,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "codex only" }]
});
await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  scope_kind: "client_adapter",
  scope_id: "claude_code",
  audience: [{ kind: "specific_client", id: "claude_code" }],
  title: "Client adapter non-overlap phase6",
  body: "Always use Claude-only adapter behavior.",
  confidence: 1,
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "claude only" }]
});
const clientAdapterConflicts = await callNextTool("memory_list_agent_memories", {
  view: "conflicts",
  scope_kind: "client_adapter",
  limit: 20
});
if (
  clientAdapterConflicts.memories.some(
    (memory) => memory.title === "Client adapter non-overlap phase6"
  )
) {
  throw new Error(
    `Non-overlapping client-adapter audiences were treated as a conflict: ${JSON.stringify(clientAdapterConflicts)}`
  );
}

const editTarget = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Phase6 edit source refs target",
  body: "Original editable governed memory body.",
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "editable source ref" }]
});
await callNextTool("memory_review_agent_memory", {
  memory_id: editTarget.memory_id,
  action: "edit",
  actor_kind: "user",
  note: "phase6 edit smoke",
  patch: {
    title: "Phase6 edited source refs target",
    body: "Edited governed memory body."
  }
});
const editedDetail = await callNextTool("memory_get_agent_memory", {
  memory_id: editTarget.memory_id
});
const editAction = editedDetail.review_actions.find((action) => action.action === "edit");
if (
  editedDetail.source_refs.length !== 1 ||
  editedDetail.memory.title !== "Phase6 edited source refs target" ||
  editAction?.metadata?.previous?.title !== "Phase6 edit source refs target"
) {
  throw new Error(
    `Edit did not preserve source refs/previous values: ${JSON.stringify(editedDetail)}`
  );
}

await callNextTool("memory_review_agent_memory", {
  memory_id: duplicateA.memory_id,
  action: "accept",
  actor_kind: "user",
  note: "phase6 merge canonical accept"
});
await callNextTool("memory_review_agent_memory", {
  memory_id: duplicateA.memory_id,
  action: "merge",
  actor_kind: "user",
  note: "phase6 merge smoke",
  merge_memory_ids: [duplicateB.memory_id]
});
const canonicalAfterMerge = await callNextTool("memory_get_agent_memory", {
  memory_id: duplicateA.memory_id
});
const mergedAfterMerge = await callNextTool("memory_get_agent_memory", {
  memory_id: duplicateB.memory_id
});
if (
  canonicalAfterMerge.memory.status !== "accepted" ||
  mergedAfterMerge.memory.status !== "superseded" ||
  mergedAfterMerge.memory.superseded_by !== duplicateA.memory_id
) {
  throw new Error(
    `Merge did not keep canonical and supersede duplicate: ${JSON.stringify({
      canonicalAfterMerge,
      mergedAfterMerge
    })}`
  );
}

const excludedRecallToken = `excluded_recall_${randomUUID()}`;
const excludedCandidate = await callNextTool("memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Excluded recall candidate",
  body: `Always keep ${excludedRecallToken} as a candidate-only rule.`,
  confidence: 0.8,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
const excludedNeedsReview = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Excluded recall needs review",
  body: `${excludedRecallToken} mentions a production secret and needs review.`,
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
const excludedRejected = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Excluded recall rejected",
  body: `${excludedRecallToken} rejected body.`,
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
const excludedArchived = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Excluded recall archived",
  body: `${excludedRecallToken} archived body.`,
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
const excludedStale = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Excluded recall stale",
  body: `${excludedRecallToken} stale body.`,
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
const excludedSuperseded = await callNextTool("memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Excluded recall superseded",
  body: `${excludedRecallToken} superseded body.`,
  confidence: 0.9,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: excludedRecallToken }]
});
await callNextTool("memory_review_agent_memory", {
  memory_id: excludedRejected.memory_id,
  action: "reject",
  actor_kind: "user"
});
await callNextTool("memory_review_agent_memory", {
  memory_id: excludedArchived.memory_id,
  action: "archive",
  actor_kind: "user"
});
await callNextTool("memory_review_agent_memory", {
  memory_id: excludedStale.memory_id,
  action: "mark_stale",
  actor_kind: "user"
});
await callNextTool("memory_review_agent_memory", {
  memory_id: excludedSuperseded.memory_id,
  action: "supersede",
  actor_kind: "user",
  superseded_by: ordinary.memory_id
});
const excludedRecall = await callNextTool("memory_recall_agent_memories", {
  query: excludedRecallToken,
  scope: "project",
  top_k: 20,
  max_chars_total: 4000
});
const excludedIds = new Set([
  excludedCandidate.memory_id,
  excludedNeedsReview.memory_id,
  excludedRejected.memory_id,
  excludedArchived.memory_id,
  excludedStale.memory_id,
  excludedSuperseded.memory_id
]);
if (excludedRecall.memories.some((memory) => excludedIds.has(memory.memory_id))) {
  throw new Error(
    `Default governed recall returned non-recallable memory: ${JSON.stringify(excludedRecall)}`
  );
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $1) AS source_ref_count,
        (SELECT count(*)::int FROM agent_memory_review_actions WHERE memory_id = $2 AND action = 'promote_instruction') AS promotion_count,
        (SELECT used_memory_ids FROM recall_traces WHERE id = $3) AS used_memory_ids,
        (SELECT ignored_memory_ids FROM recall_traces WHERE id = $3) AS ignored_memory_ids,
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $4 AND source_kind = 'event') AS checkpoint_source_ref_count
    `,
    [ordinary.memory_id, candidate.memory_id, recall.trace_id, searchableCheckpoint.memory_id]
  );
  const row = checks.rows[0];
  if (
    row.source_ref_count !== 1 ||
    row.promotion_count !== 1 ||
    row.checkpoint_source_ref_count !== 1 ||
    !JSON.stringify(row.used_memory_ids).includes(ordinary.memory_id) ||
    !JSON.stringify(row.ignored_memory_ids).includes(candidate.memory_id)
  ) {
    throw new Error(`Governed memory DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

await mcpClient.close();
await mcpServer.close();
restoreEnv(mcpEnvSnapshot);
await rm(projectPath, { recursive: true, force: true });

process.stdout.write(
  JSON.stringify(
    {
      phase4_checkpoint_parity: {
        state_only_checkpoint: {
          checkpoint_state_only: stateOnlyCheckpoint.checkpoint_state_only,
          searchable_memory_created: stateOnlyCheckpoint.searchable_memory_created,
          memory_id: stateOnlyCheckpoint.memory_id
        },
        high_level_checkpoint: {
          tool: "memory_agent_checkpoint",
          event_appended: searchableCheckpoint.event_appended,
          memory_id: searchableCheckpoint.memory_id,
          memory_type: searchableCheckpoint.memory?.memory_type,
          recall_found: checkpointRecall.memories.some(
            (memory) => memory.memory_id === searchableCheckpoint.memory_id
          )
        }
      }
    },
    null,
    2
  ) + "\n"
);
process.stdout.write("Phase 6 governed memory smoke passed\n");
