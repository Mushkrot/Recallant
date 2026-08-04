import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { join, resolve } from "node:path";
import {
  buildAgentLifecycleCloseoutResult,
  buildRecallantReadinessContract,
  agentObservationCaptureProfileValues,
  agentObservationKindValues,
  agentObservationResolutionStatusValues,
  agentObservationStatusValues,
  graphCandidateExtractionMethodValues,
  graphCandidateKindValues,
  graphCandidateMaintenanceActionKindValues,
  graphCandidateReviewActionValues,
  graphCandidateSourceRefKindValues,
  graphRetrievalProfileValues,
  graphTreeLifecycleStateValues,
  graphTreeNodeKindValues,
  type AgentLifecycleCloseoutProof,
  type AgentLifecycleMemoryProofStatus,
  type AppendAgentObservationInput,
  type CreateGraphCandidateInput,
  type GraphCandidateMaintenanceApplyInput,
  type GetGraphCandidateMaintenancePlanInput,
  type GetGraphCandidateHygieneInput,
  type GetGraphCandidateInput,
  type ListGraphCandidatesInput,
  type PromoteGraphCandidateInput,
  type ReviewGraphCandidateInput
} from "@recallant/contracts";
import {
  createRecallantDbFromEnv,
  emptyCanonCapabilityContext,
  forgetTargetKindValues,
  type AgentMemorySourceRefInput,
  type ArchiveInput,
  type ContextPackInput,
  type CrossProjectRecallInput,
  type CreateAgentMemoryInput,
  type ForgetInput,
  type GraphCandidateScopedInput,
  type AppendEventInput,
  type AppendTurnInput,
  type JsonObject,
  type LinkMemoryInput,
  type ListAgentMemoriesInput,
  type RecallAgentMemoriesInput,
  type ReportRecallUsageInput,
  type ReviewAgentMemoryInput,
  type StartSessionInput
} from "@recallant/db";
import {
  buildMemoryKeeperPlan,
  prepareProjectLogSync,
  validateProjectIdentity,
  type MemoryKeeperSourceInput,
  type ProjectLogCheckpointPayload
} from "@recallant/core";
import { z } from "zod";

type ToolDb = ReturnType<typeof createRecallantDbFromEnv>;

export type RecallantToolsRuntimeContext = {
  projectId?: string | null;
  projectPath?: string | null;
  developerId?: string | null;
  clientId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  getDatabase?: () => ToolDb;
};

const recallantToolsRuntimeContext = new AsyncLocalStorage<RecallantToolsRuntimeContext>();

const nullableString = z.string().nullable().optional();
const metadata = z.record(z.string(), z.unknown()).default({});
const uuidString = z.string().uuid();

const clientKind = z.enum([
  "codex",
  "cursor",
  "windsurf",
  "claude_code",
  "generic",
  "unknown",
  "other"
]);
const agentObservationKind = z.enum(agentObservationKindValues);
const agentObservationStatus = z.enum(agentObservationStatusValues);
const agentObservationResolutionStatus = z.enum(agentObservationResolutionStatusValues);
const agentObservationCaptureProfile = z.enum(agentObservationCaptureProfileValues);
const scope = z.enum(["project", "developer", "all"]);
const memoryScope = z.enum(["project", "developer"]);
const sourceKind = z.enum(["event", "chunk", "raw_artifact", "edge", "checkpoint", "external"]);
const graphNodeKind = z.enum(graphTreeNodeKindValues);
const graphCandidateKind = z.enum(graphCandidateKindValues);
const graphLifecycleState = z.enum(graphTreeLifecycleStateValues);
const graphExtractionMethod = z.enum(graphCandidateExtractionMethodValues);
const graphSourceRefKind = z.enum(graphCandidateSourceRefKindValues);
const graphReviewAction = z.enum(graphCandidateReviewActionValues);
const graphMaintenanceActionKind = z.enum(graphCandidateMaintenanceActionKindValues);
const graphRetrievalProfile = z.enum(graphRetrievalProfileValues);
const graphCandidateScope = z.enum(["project", "developer", "domain", "all"]);
const graphCandidateAudience = z
  .array(
    z.object({
      kind: z.string().min(1),
      id: nullableString
    })
  )
  .default([]);
const graphCandidateEndpointRef = z.object({
  kind: z.union([graphNodeKind, z.literal("external")]),
  id: z.string().min(1),
  label: nullableString,
  metadata
});
const graphCandidateSourceRef = z.object({
  source_kind: graphSourceRefKind,
  source_id: nullableString,
  uri: nullableString,
  path: nullableString,
  anchor: nullableString,
  quote: z.string().max(1000).nullable().optional(),
  metadata
});
const memoryTypeValues = [
  "decision",
  "constraint",
  "lesson",
  "failure",
  "work_log",
  "open_question",
  "artifact_reference",
  "preference",
  "procedure",
  "environment_fact",
  "domain_fact",
  "capability_fact"
] as const;
const memoryType = z.enum(memoryTypeValues);
const recallMemoryType = z.enum([...memoryTypeValues, "checkpoint"] as const);
const checkpointPayloadSchema = z
  .object({
    current_status: z.string(),
    current_focus: z.string(),
    next_step: z.string(),
    last_event_id: uuidString.nullable().optional(),
    open_questions: z.array(z.string()).default([]),
    summary: nullableString,
    status: nullableString,
    updated_at: nullableString,
    source: nullableString
  })
  .passthrough();
const governedMemoryAudienceExample = [{ kind: "all_agents", id: null }] as const;
const governedMemoryForbiddenClasses =
  "raw secrets, credentials, customer data, private keys, database URLs, provider tokens, backups, raw artifacts, and large logs";
export const safeSemanticMarkerMemoryExample = {
  memory_type: "work_log",
  scope: "project",
  audience: governedMemoryAudienceExample,
  title: "Safe Recallant semantic marker",
  body: "Synthetic non-secret marker recallant_safe_semantic_marker_example for create+recall proof.",
  confidence: 1,
  source_refs: [],
  created_by: "agent",
  metadata: {
    diagnostic_marker: true,
    contains_raw_secret: false
  }
} as const;
export const safeSemanticMarkerRecallExample = {
  query: "recallant_safe_semantic_marker_example",
  scope: "project",
  memory_types: ["work_log"],
  include_candidates: true,
  include_needs_review: true,
  top_k: 5,
  max_chars_total: 4000
} as const;
const createAgentMemoryDescription = [
  "Create a governed structured memory record.",
  "When Recallant is configured and consent allows agent-authored memory, agents must use this for concise decisions, actions, tests, checkpoints, closeout summaries, and safe synthetic proof markers.",
  "This is not an import tool: bulk project history, raw logs, customer data, artifacts, and file summaries require separate owner approval.",
  'Required fields: memory_type, scope, title, body, created_by, and audience; use audience [{ "kind": "all_agents", "id": null }] for normal project-wide agent recall.',
  `Safe semantic marker example: ${JSON.stringify(safeSemanticMarkerMemoryExample)}.`,
  `Never store ${governedMemoryForbiddenClasses}.`
].join(" ");
const recallAgentMemoriesDescription = [
  "Return bounded governed memories relevant to the current task.",
  "Use this after creating a diagnostic marker to prove semantic memory; checkpoint state readback alone is not semantic memory proof.",
  `Safe recall query example after creating a marker: ${JSON.stringify(
    safeSemanticMarkerRecallExample
  )}.`,
  "Recall returns governed memory records."
].join(" ");

export type RecallantToolName =
  | "memory_start_session"
  | "memory_heartbeat"
  | "memory_get_readiness_status"
  | "memory_get_context_pack"
  | "memory_append_turn"
  | "memory_append_event"
  | "memory_append_observation"
  | "memory_search"
  | "memory_fetch_chunk"
  | "memory_link"
  | "memory_keeper_candidates"
  | "memory_create_graph_candidate"
  | "memory_list_graph_candidates"
  | "memory_get_graph_candidate"
  | "memory_review_graph_candidate"
  | "memory_promote_graph_candidate"
  | "memory_graph_hygiene"
  | "memory_graph_maintenance"
  | "memory_promote"
  | "memory_archive"
  | "memory_forget"
  | "memory_get_checkpoint"
  | "memory_set_checkpoint"
  | "memory_agent_checkpoint"
  | "memory_create_agent_memory"
  | "memory_review_agent_memory"
  | "memory_list_agent_memories"
  | "memory_get_agent_memory"
  | "memory_recall_agent_memories"
  | "memory_cross_project_recall"
  | "memory_report_recall_usage"
  | "memory_closeout";

export type RecallantToolDefinition = {
  name: RecallantToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  examples?: readonly unknown[];
  handler: (
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

function currentRecallantToolsContext() {
  return contextAwarePath(recallantToolsRuntimeContext.getStore() ?? {});
}

export function runWithRecallantToolsContext<T>(
  context: RecallantToolsRuntimeContext,
  operation: () => Promise<T> | T
) {
  return recallantToolsRuntimeContext.run(contextAwarePath(context), operation);
}

function db() {
  const context = currentRecallantToolsContext();
  return context.getDatabase();
}

function contextAwarePath(context: RecallantToolsRuntimeContext) {
  return {
    projectId: context.projectId ?? null,
    projectPath: context.projectPath ?? null,
    developerId: context.developerId ?? null,
    clientId: context.clientId ?? null,
    sessionId: context.sessionId ?? null,
    traceId: context.traceId ?? null,
    getDatabase: context.getDatabase ?? (() => createRecallantDbFromEnv())
  };
}

type ProjectPathSource =
  | "argument.project_path"
  | "argument.project_dir"
  | "context.projectPath"
  | "env.RECALLANT_PROJECT_PATH"
  | "none";

type ProjectScopeDiagnostic = {
  project_path_source: ProjectPathSource;
  project_dir_alias: "not_provided" | "accepted_as_project_path" | "accepted_same_path";
  provided_fields: {
    project_path: boolean;
    project_dir: boolean;
  };
};

function stringInput(value: unknown) {
  return typeof value === "string" ? value : null;
}

function comparableProjectPath(value: string) {
  return resolve(value);
}

function validationError(message: string) {
  return new Error(`VALIDATION_ERROR: ${message}`);
}

async function attachedProjectConfig(projectPath: string | null | undefined) {
  if (!projectPath) return { projectPath: null, projectId: null, projectLogSync: null };
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(projectPath);
  } catch {
    // Do not turn an inaccessible remote path into a local identity assertion.
    // A binding comparison is meaningful only for a real attached checkout.
    return { projectPath: null, projectId: null, projectLogSync: null };
  }
  try {
    const content = await readFile(join(resolvedPath, ".recallant", "config"), "utf8");
    const config = JSON.parse(content) as Record<string, unknown>;
    return {
      projectPath: resolvedPath,
      projectId: stringInput(config.project_id),
      projectLogSync: config.project_log_sync ?? null
    };
  } catch {
    return { projectPath: resolvedPath, projectId: null, projectLogSync: null };
  }
}

async function projectIdentityPreflight(input: {
  database?: ToolDb;
  projectId?: string | null;
  projectPath?: string | null;
}) {
  const config = await attachedProjectConfig(input.projectPath);
  const requestedProjectId = stringInput(input.projectId);
  const effectiveProjectId = config.projectId ?? requestedProjectId;
  const binding =
    input.database && effectiveProjectId
      ? await input.database.getProjectBinding(effectiveProjectId)
      : null;
  const proof = validateProjectIdentity({
    requestedProjectId,
    attachedProjectId: config.projectId,
    bindingProjectId: binding?.project_id ?? null,
    projectPath: config.projectPath,
    bindingPrimaryPath: binding?.primary_path ?? null
  });
  if (proof.status === "mismatch") {
    throw validationError(
      "PROJECT_ID_PATH_MISMATCH: requested project identity does not match the attached project path."
    );
  }
  return {
    ...proof,
    project_id: effectiveProjectId,
    project_path: config.projectPath,
    project_log_sync: config.projectLogSync
  };
}

function scopedProjectInputWithDiagnostics<T extends Record<string, unknown>>(
  args: T,
  options: { includeEnvironmentProjectScope?: boolean } = {}
) {
  const context = currentRecallantToolsContext();
  const argumentProjectPath = stringInput(args.project_path);
  const argumentProjectDir = stringInput(args.project_dir);
  if (
    argumentProjectPath &&
    argumentProjectDir &&
    comparableProjectPath(argumentProjectPath) !== comparableProjectPath(argumentProjectDir)
  ) {
    throw validationError(
      "`project_path` and `project_dir` refer to different paths; provide only one field or matching values."
    );
  }
  const contextProjectPath = stringInput(context.projectPath);
  const envProjectPath = options.includeEnvironmentProjectScope
    ? stringInput(process.env.RECALLANT_PROJECT_PATH)
    : null;
  const projectPath =
    argumentProjectPath ?? argumentProjectDir ?? contextProjectPath ?? envProjectPath ?? undefined;
  const projectPathSource: ProjectPathSource = argumentProjectPath
    ? "argument.project_path"
    : argumentProjectDir
      ? "argument.project_dir"
      : contextProjectPath
        ? "context.projectPath"
        : envProjectPath
          ? "env.RECALLANT_PROJECT_PATH"
          : "none";
  const input = {
    ...args,
    project_id:
      args.project_id ??
      context.projectId ??
      (options.includeEnvironmentProjectScope ? process.env.RECALLANT_PROJECT_ID : undefined) ??
      undefined,
    project_path: projectPath
  };
  delete (input as Record<string, unknown>).project_dir;
  return {
    input,
    diagnostic: {
      project_path_source: projectPathSource,
      project_dir_alias: argumentProjectDir
        ? argumentProjectPath
          ? "accepted_same_path"
          : "accepted_as_project_path"
        : "not_provided",
      provided_fields: {
        project_path: argumentProjectPath !== null,
        project_dir: argumentProjectDir !== null
      }
    } satisfies ProjectScopeDiagnostic,
    aliasProvided: argumentProjectDir !== null
  };
}

function scopedProjectInput<T extends Record<string, unknown>>(args: T): T {
  return scopedProjectInputWithDiagnostics(args).input as T;
}

function projectScopeDiagnosticOutput(
  scoped: ReturnType<typeof scopedProjectInputWithDiagnostics>
) {
  if (!scoped.aliasProvided) return {};
  return {
    project_path_source: scoped.diagnostic.project_path_source,
    project_scope_diagnostic: scoped.diagnostic
  };
}

function remoteAgentSourceRef() {
  const context = currentRecallantToolsContext();
  const sourceId =
    context.traceId ??
    context.sessionId ??
    (context.clientId ? `remote-client:${context.clientId}` : null) ??
    (context.projectId ? `remote-project:${context.projectId}` : "remote-mcp");
  return {
    source_kind: "external",
    source_id: sourceId,
    quote: null,
    metadata: {
      source: "remote_mcp",
      project_id: context.projectId ?? null,
      developer_id: context.developerId ?? null,
      client_id: context.clientId ?? null,
      trace_id: context.traceId ?? null,
      session_id: context.sessionId ?? null
    }
  };
}

function scopedAgentMemoryInput(args: Record<string, unknown>): CreateAgentMemoryInput {
  const scoped = scopedProjectInput(args);
  const sourceRefs = Array.isArray(scoped.source_refs) ? scoped.source_refs : [];
  return {
    ...scoped,
    source_refs:
      scoped.created_by === "agent" && sourceRefs.length === 0
        ? [remoteAgentSourceRef()]
        : sourceRefs
  } as CreateAgentMemoryInput;
}

function nowIso() {
  return new Date().toISOString();
}

function stubResponse(tool: RecallantToolName, payload: Record<string, unknown>) {
  return {
    status: "stub",
    tool,
    ...payload
  };
}

function readinessStatusOutput(readiness: Record<string, unknown>) {
  const contract =
    readiness.readiness_contract && typeof readiness.readiness_contract === "object"
      ? (readiness.readiness_contract as Record<string, unknown>)
      : buildRecallantReadinessContract({ configured: false });
  return {
    ok: true,
    project_id: currentRecallantToolsContext().projectId,
    configured: contract.configured === true,
    context_ready: contract.context_ready === true,
    semantic_memory_ready: contract.semantic_memory_ready === true,
    capture_active: contract.capture_active === true,
    ingestion_approved: contract.ingestion_approved === true,
    remote_mcp_ready: contract.remote_mcp_ready === true,
    readiness_status: readiness.readiness_status ?? contract.primary_state,
    evidence: contract.evidence ?? {},
    readiness_contract: contract,
    last_context_read_at: readiness.last_context_read_at ?? null,
    last_memory_write_at: readiness.last_memory_write_at ?? null,
    checkpoint_updated_at: readiness.checkpoint_updated_at ?? null,
    last_semantic_recall_proof_at: readiness.last_semantic_recall_proof_at ?? null,
    review_state_counts: readiness.review_state_counts ?? {
      pending_review: 0,
      accepted: 0,
      rejected: 0,
      stale: 0,
      conflict: 0
    }
  };
}

function stubReadinessStatusOutput() {
  const context = currentRecallantToolsContext();
  const remoteReady = Boolean(context.projectId && context.developerId && context.clientId);
  const contract = buildRecallantReadinessContract({
    configured: Boolean(context.projectId),
    remote_mcp_ready: remoteReady,
    context_ready: false,
    semantic_memory_ready: false,
    capture_active: false,
    ingestion_approved: false
  });
  return readinessStatusOutput({
    readiness_status: contract.primary_state,
    readiness_contract: contract
  });
}

function summarizeText(text: string, max = 88) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function checkpointValue(payload: JsonObject, key: string, fallback = "") {
  const value = payload[key];
  return value === null || value === undefined ? fallback : String(value);
}

function checkpointEventText(payload: JsonObject) {
  return `Checkpoint: ${checkpointValue(payload, "current_focus")} Next: ${checkpointValue(
    payload,
    "next_step"
  )}`;
}

function checkpointMemoryBody(payload: JsonObject) {
  return [
    `Status: ${checkpointValue(payload, "status", checkpointValue(payload, "current_status", "checkpoint"))}`,
    `Current focus: ${checkpointValue(payload, "current_focus")}`,
    `Next step: ${checkpointValue(payload, "next_step")}`,
    payload.summary ? `Summary: ${String(payload.summary)}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function closeoutMemoryStatusFromDbStatus(status: unknown): AgentLifecycleMemoryProofStatus {
  if (status === "accepted") return "accepted";
  if (status === "candidate") return "candidate";
  if (status === "needs_review") return "needs_review";
  if (status === "rejected") return "rejected";
  return "missing";
}

function closeoutSummaryText(summary: unknown, payload: JsonObject) {
  return String(summary ?? payload.summary ?? payload.current_focus ?? "Session closeout");
}

function closeoutLifecycleMarker(input: {
  sessionId: string;
  eventId: string;
  summary: unknown;
  payload: JsonObject;
}) {
  const focus = checkpointValue(input.payload, "current_focus", "closeout");
  const nextStep = checkpointValue(input.payload, "next_step", "continue");
  return [
    "memory-closeout-lifecycle",
    input.sessionId,
    input.eventId,
    summarizeText(closeoutSummaryText(input.summary, input.payload), 48),
    summarizeText(focus, 48),
    summarizeText(nextStep, 48)
  ].join(":");
}

function closeoutMemoryBody(input: {
  summary: unknown;
  payload: JsonObject;
  sessionId: string;
  eventId: string;
  lifecycleMarker: string;
}) {
  return [
    `Status: ${checkpointValue(input.payload, "status", checkpointValue(input.payload, "current_status", "closed"))}`,
    `Current focus: ${checkpointValue(
      input.payload,
      "current_focus",
      closeoutSummaryText(input.summary, input.payload)
    )}`,
    `Next step: ${checkpointValue(input.payload, "next_step", "Continue from Recallant context.")}`,
    `Summary: ${closeoutSummaryText(input.summary, input.payload)}`,
    `Lifecycle marker: ${input.lifecycleMarker}`,
    `Session: ${input.sessionId}`,
    `Closeout event: ${input.eventId}`
  ].join("\n");
}

function partialRecallProof(): AgentLifecycleCloseoutProof["recall"] {
  return {
    ok: false,
    recall_verified: false,
    query: null,
    marker_found: false,
    recalled_memory_ids: [],
    checked_at: null
  };
}

function partialNextSessionContextProof(): AgentLifecycleCloseoutProof["next_session_context"] {
  return {
    ok: false,
    next_session_context_verified: false,
    session_id: null,
    context_pack_id: null,
    marker_found: false,
    checked_at: null
  };
}

function contextPackWorkingMemories(
  pack: Awaited<ReturnType<NonNullable<ToolDb>["getContextPack"]>>
) {
  const sections = pack.sections;
  const sectionObject =
    sections && typeof sections === "object" && !Array.isArray(sections)
      ? (sections as Record<string, unknown>)
      : {};
  const workingMemories = sectionObject.working_memories;
  return Array.isArray(workingMemories)
    ? workingMemories.filter(
        (memory): memory is Record<string, unknown> =>
          memory !== null && typeof memory === "object" && !Array.isArray(memory)
      )
    : [];
}

async function verifyMcpCloseoutNextSessionContext(input: {
  database: NonNullable<ToolDb>;
  context: RecallantToolsRuntimeContext;
  lifecycleMarker: string;
  closeoutMemoryId: string;
  localSpoolStatus?: JsonObject | null;
}): Promise<{
  proof: AgentLifecycleCloseoutProof["next_session_context"];
  warnings: string[];
}> {
  let verificationSessionId: string | null = null;
  let contextPackId: string | null = null;
  let proof = partialNextSessionContextProof();
  let warnings: string[] = [];

  try {
    const started = await input.database.startSession({
      client_kind: "mcp",
      project_id: input.context.projectId ?? null,
      project_path: input.context.projectPath ?? null,
      session_label: "recallant-mcp-closeout-verification",
      resume_policy: "normal"
    });
    verificationSessionId = String(started.session_id);
    const pack = await input.database.getContextPack({
      session_id: verificationSessionId,
      task_hint: input.lifecycleMarker,
      include_raw_evidence: "auto",
      include_recovery: false,
      local_spool_status: input.localSpoolStatus ?? null,
      max_chars_total: 4000
    });
    contextPackId = String(pack.context_pack_id);
    const workingMemories = contextPackWorkingMemories(pack);
    const markerFound = workingMemories.some(
      (memory) =>
        String(memory.memory_id ?? "") === input.closeoutMemoryId ||
        String(memory.body ?? "").includes(input.lifecycleMarker) ||
        String(memory.title ?? "").includes(input.lifecycleMarker)
    );
    proof = {
      ok: markerFound,
      next_session_context_verified: markerFound,
      session_id: verificationSessionId,
      context_pack_id: contextPackId,
      marker_found: markerFound,
      checked_at: nowIso()
    };
    if (!markerFound) {
      warnings = ["Next-session context pack did not return the MCP closeout memory."];
    }
  } catch {
    proof = {
      ok: false,
      next_session_context_verified: false,
      session_id: verificationSessionId,
      context_pack_id: contextPackId,
      marker_found: false,
      checked_at: nowIso()
    };
    warnings = ["Next-session context verification failed; next agent readiness is false."];
  } finally {
    if (verificationSessionId) {
      try {
        await input.database.closeSession(verificationSessionId, "client_exit");
      } catch {
        proof = {
          ...proof,
          ok: false,
          next_session_context_verified: false
        };
        warnings = [
          ...warnings,
          "Verification session cleanup failed; review active Recallant sessions."
        ];
      }
    }
  }

  return { proof, warnings };
}

function nonReadyMcpCloseoutLifecycle(input: {
  sessionId: string;
  projectId?: string | null;
  spoolSyncStatus?: string | null;
  warnings?: string[];
}) {
  return buildAgentLifecycleCloseoutResult({
    mode: "offline_spool",
    project_id: input.projectId ?? null,
    session_id: input.sessionId,
    closeout_event_id: null,
    spool_sync_status: input.spoolSyncStatus ?? null,
    proof: {
      event: {
        ok: false,
        event_written: false,
        spooled: input.spoolSyncStatus === "unsynced"
      },
      checkpoint: {
        ok: false,
        checkpoint_updated: false,
        checkpoint_updated_at: null,
        checkpoint_state_only: true
      },
      memory: {
        ok: false,
        searchable_memory_created: false,
        memory_status: "missing",
        memory_id: null,
        memory_type: null
      },
      recall: partialRecallProof(),
      next_session_context: partialNextSessionContextProof()
    },
    warnings: input.warnings ?? [
      "MCP closeout is not database-backed; next-agent readiness is false."
    ]
  });
}

function closeoutSourceRefs(rawRefs: unknown[], sessionId: string): AgentMemorySourceRefInput[] {
  const allowed = new Set(["event", "chunk", "raw_artifact", "edge", "checkpoint", "external"]);
  const refs = rawRefs
    .filter((ref): ref is Record<string, unknown> => typeof ref === "object" && ref !== null)
    .filter((ref) => allowed.has(String(ref.source_kind)) && typeof ref.source_id === "string")
    .map((ref) => ({
      source_kind: String(ref.source_kind),
      source_id: String(ref.source_id),
      quote: typeof ref.quote === "string" ? ref.quote : null,
      metadata:
        typeof ref.metadata === "object" && ref.metadata !== null
          ? (ref.metadata as JsonObject)
          : {}
    }));
  if (refs.length > 0) return refs;
  return [
    {
      source_kind: "checkpoint",
      source_id: sessionId,
      quote: null,
      metadata: { fallback_reason: "closeout_candidate_without_source_refs" }
    }
  ];
}

async function resolveProjectPath(
  database?: ToolDb,
  contextProjectId?: string | null,
  contextProjectPath?: string | null
) {
  if (contextProjectPath) return { path: contextProjectPath, source: "context" };
  const databaseProjectPath =
    database && contextProjectId ? await database.projectPrimaryPath(contextProjectId) : null;
  if (databaseProjectPath) return { path: databaseProjectPath, source: "database_primary_path" };
  const envProjectPath = process.env.RECALLANT_PROJECT_PATH;
  if (envProjectPath) return { path: envProjectPath, source: "env" };
  return null;
}

async function syncProjectLog(
  payload: JsonObject,
  database?: ToolDb,
  contextProjectId?: string | null,
  contextProjectPath?: string | null
) {
  const resolvedProjectPath = await resolveProjectPath(
    database,
    contextProjectId,
    contextProjectPath
  );
  if (!resolvedProjectPath) {
    return {
      status: "skipped",
      reason: "No project path is configured and no database primary path was found."
    };
  }
  let projectRoot: string;
  try {
    projectRoot = await realpath(resolvedProjectPath.path);
  } catch {
    return {
      status: "skipped",
      reason: "Configured project path is not present.",
      project_path: resolvedProjectPath.path,
      project_path_source: resolvedProjectPath.source
    };
  }
  const projectLogPath = join(projectRoot, "PROJECT_LOG.md");
  const identity = await projectIdentityPreflight({
    database,
    projectId: contextProjectId,
    projectPath: projectRoot
  });
  let existing = "";
  try {
    existing = await readFile(projectLogPath, "utf8");
  } catch {
    existing = "";
  }
  const prepared = prepareProjectLogSync({
    mode: identity.project_log_sync,
    existingContent: existing,
    payload: payload as ProjectLogCheckpointPayload
  });
  if (prepared.status !== "updated" || !prepared.next_content) {
    return {
      ...prepared,
      path: projectLogPath,
      project_path: projectRoot,
      project_path_source: resolvedProjectPath.source,
      identity
    };
  }
  await writeFile(projectLogPath, prepared.next_content);
  return {
    ...prepared,
    path: projectLogPath,
    project_path: projectRoot,
    project_path_source: resolvedProjectPath.source,
    identity
  };
}

export const recallantToolsBase: readonly RecallantToolDefinition[] = [
  {
    name: "memory_start_session",
    title: "Start Session",
    description: "Start or resume a Recallant-tracked agent session.",
    inputSchema: z.object({
      client_kind: clientKind,
      client_version: nullableString,
      project_path: nullableString,
      project_dir: nullableString.describe("Compatibility alias for project_path."),
      session_label: nullableString,
      resume_policy: z.enum(["normal", "force_new", "recover_previous"]).default("normal")
    }),
    handler: async (args) => {
      const database = db();
      const scoped = scopedProjectInputWithDiagnostics(args);
      if (database) {
        const identity = await projectIdentityPreflight({
          database,
          projectId: stringInput(scoped.input.project_id),
          projectPath: stringInput(scoped.input.project_path)
        });
        const started = await database.startSession({
          ...(scoped.input as StartSessionInput),
          project_id: identity.project_id ?? undefined,
          project_path: identity.project_path ?? stringInput(scoped.input.project_path) ?? undefined
        });
        return {
          ...started,
          project_identity: identity,
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_start_session", {
        session_id: randomUUID(),
        project_id:
          currentRecallantToolsContext().projectId ??
          process.env.RECALLANT_PROJECT_ID ??
          randomUUID(),
        checkpoint: { payload: null, updated_at: null },
        previous_unclosed_session: null,
        previous_session_recovery: {
          status: "none",
          agent_message:
            "No previous unfinished agent session was found for this project. Start from the context pack."
        },
        recommended_next_calls: ["memory_get_context_pack"],
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_heartbeat",
    title: "Heartbeat",
    description: "Update session liveness without creating raw memory events.",
    inputSchema: z.object({
      session_id: uuidString,
      status: z.enum([
        "active",
        "idle",
        "running_tests",
        "running_command",
        "background_job",
        "unknown"
      ]),
      note: nullableString,
      metadata
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        const heartbeat = await database.heartbeat(
          args.session_id as string,
          args.status as string,
          args.note as string | null | undefined,
          args.metadata as JsonObject | undefined
        );
        return {
          ok: true,
          session_id: heartbeat?.id ?? args.session_id,
          last_seen_at: heartbeat?.last_seen_at ?? nowIso(),
          last_heartbeat_at: heartbeat?.last_heartbeat_at ?? nowIso()
        };
      }
      return stubResponse("memory_heartbeat", {
        ok: true,
        session_id: args.session_id,
        last_seen_at: nowIso(),
        last_heartbeat_at: nowIso()
      });
    }
  },
  {
    name: "memory_get_readiness_status",
    title: "Get Readiness Status",
    description:
      "Return the bounded Recallant readiness contract for the current scoped project. This is a status tool, not an import tool: it returns configuration/proof/capture gates and timestamps only, never raw memories, project files, credentials, artifacts, backups, or bulk summaries.",
    inputSchema: z.object({}),
    handler: async () => {
      const context = currentRecallantToolsContext();
      const database = db();
      if (database) {
        const readiness = await database.getProjectReadiness({
          project_id: context.projectId ?? undefined,
          remote_mcp_ready: Boolean(context.projectId && context.developerId && context.clientId)
        });
        return readinessStatusOutput(readiness);
      }
      return stubResponse("memory_get_readiness_status", stubReadinessStatusOutput());
    }
  },
  {
    name: "memory_get_context_pack",
    title: "Get Context Pack",
    description: "Build bounded startup context for an agent session.",
    inputSchema: z.object({
      session_id: uuidString,
      task_hint: nullableString,
      project_id: uuidString.nullable().optional(),
      max_chars_total: z.number().int().positive().default(12_000),
      include_raw_evidence: z.enum(["auto", "never", "always"]).default("auto"),
      include_recovery: z.boolean().default(true),
      local_spool_status: z.record(z.string(), z.unknown()).nullable().optional()
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.getContextPack(scopedProjectInput(args) as ContextPackInput);
      return stubResponse("memory_get_context_pack", {
        context_pack_id: randomUUID(),
        project_id:
          args.project_id ??
          currentRecallantToolsContext().projectId ??
          process.env.RECALLANT_PROJECT_ID ??
          randomUUID(),
        session_id: args.session_id,
        profile: "compact",
        sections: {
          checkpoint: {},
          documentation_posture: {
            status: "not_recorded",
            profile: "unknown",
            summary: "No database-backed documentation posture is available in MCP skeleton mode.",
            missing_recommended_docs: [],
            review_options: [
              {
                option: "discuss_first",
                recommended: true,
                reason: "Connect Recallant storage or open Workbench review before changing docs."
              }
            ],
            authority: {
              source: "mcp_skeleton_stub",
              key: "documentation_posture",
              role: "startup_guidance",
              instruction_grade: false,
              notes: [
                "Placeholder only. This stub contains no project docs, secrets, or binding rules."
              ]
            },
            canon_context: {
              needed: false,
              reason: null,
              recommended_reference_kinds: [],
              configured_references: []
            },
            capability_hints: []
          },
          canon_capability_context: emptyCanonCapabilityContext(),
          recovery: {},
          binding_rules: [],
          working_memories: [],
          operational_bindings: [],
          local_spool_status: args.local_spool_status ?? { status: "unknown" },
          evidence_excerpts: [],
          suggested_next_fetches: [],
          warnings: ["MCP skeleton stub: database-backed context pack is not implemented yet."]
        },
        truncated: false,
        budget: {
          max_chars_total: args.max_chars_total,
          used_chars_estimate: 0
        }
      });
    }
  },
  {
    name: "memory_append_turn",
    title: "Append Turn",
    description: "Append a user or assistant turn as raw L0 evidence.",
    inputSchema: z.object({
      session_id: uuidString.nullable().optional(),
      client_kind: clientKind,
      role: z.enum(["user", "assistant"]),
      text: z.string().min(1),
      occurred_at: nullableString,
      dedup_key: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.appendTurn(args as AppendTurnInput);
      return stubResponse("memory_append_turn", { event_id: randomUUID(), status: "created" });
    }
  },
  {
    name: "memory_append_event",
    title: "Append Event",
    description: "Append non-turn workflow evidence and raw artifact refs.",
    inputSchema: z.object({
      session_id: uuidString.nullable().optional(),
      client_kind: clientKind,
      event_kind: z.enum([
        "tool_call",
        "tool_result",
        "terminal_output",
        "file_change",
        "system",
        "other"
      ]),
      text: nullableString,
      metadata,
      raw_artifacts: z
        .array(
          z.object({
            artifact_kind: z.enum([
              "tool_output",
              "terminal_output",
              "attachment",
              "transcript_export",
              "media",
              "other"
            ]),
            storage_backend: z.enum([
              "local_spool",
              "server_filesystem",
              "postgres_inline",
              "object_storage",
              "external"
            ]),
            uri: nullableString,
            sha256: nullableString,
            size_bytes: z.number().int().nonnegative().nullable().optional(),
            content_type: nullableString,
            excerpt: nullableString,
            metadata
          })
        )
        .default([]),
      occurred_at: nullableString,
      dedup_key: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.appendEvent(args as AppendEventInput);
      return stubResponse("memory_append_event", {
        event_id: randomUUID(),
        raw_artifact_ids: Array.from({ length: (args.raw_artifacts as unknown[]).length }, () =>
          randomUUID()
        ),
        status: "created"
      });
    }
  },
  {
    name: "memory_append_observation",
    title: "Record Agent Observation",
    description:
      "Record one correlated, bounded, secret-redacted agent observation for replay and error analysis. Rationale is an optional short user-visible reason, never hidden chain-of-thought.",
    inputSchema: z.object({
      session_id: uuidString,
      run_id: uuidString.nullable().optional(),
      turn_id: nullableString,
      trace_id: uuidString.nullable().optional(),
      parent_observation_id: uuidString.nullable().optional(),
      source_event_id: uuidString.nullable().optional(),
      dedup_key: z.string().max(240).nullable().optional(),
      kind: agentObservationKind,
      status: agentObservationStatus.optional(),
      occurred_at: nullableString,
      duration_ms: z.number().int().nonnegative().nullable().optional(),
      title: z.string().max(2_000).nullable().optional(),
      body: z.string().max(200_000).nullable().optional(),
      tool_name: z.string().max(2_000).nullable().optional(),
      error_code: z.string().max(2_000).nullable().optional(),
      attempt_number: z.number().int().positive().nullable().optional(),
      resolution_status: agentObservationResolutionStatus.optional(),
      rationale: z.string().max(20_000).nullable().optional(),
      metadata,
      capture_profile: agentObservationCaptureProfile.nullable().optional(),
      client_kind: clientKind.nullable().optional(),
      client_version: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.appendAgentObservation(args as AppendAgentObservationInput);
      return stubResponse("memory_append_observation", {
        id: randomUUID(),
        sequence_number: 1,
        status: "success",
        durable: false
      });
    }
  },
  {
    name: "memory_search",
    title: "Search Raw Evidence",
    description: "Search raw chunks with lexical/vector/hybrid retrieval.",
    inputSchema: z.object({
      query: z.string().min(1),
      mode: z.enum(["hybrid", "vector_only", "lexical_only"]).default("hybrid"),
      session_id: uuidString.nullable().optional(),
      source_id: uuidString.nullable().optional(),
      scope: scope.default("project"),
      scope_kind: nullableString,
      audience: nullableString,
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000),
      graph_expand: z.boolean().default(false),
      graph_retrieval_profile: graphRetrievalProfile.nullable().optional(),
      graph_budget_nodes: z.number().int().nonnegative().default(8),
      include_archived: z.boolean().default(false)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.search({
          query: args.query as string,
          mode: args.mode as string | undefined,
          top_k: args.top_k as number | undefined,
          max_chars_total: args.max_chars_total as number | undefined,
          session_id: args.session_id as string | null | undefined,
          source_id: args.source_id as string | null | undefined,
          scope: args.scope as string | undefined,
          scope_kind: args.scope_kind as string | null | undefined,
          audience: args.audience as string | null | undefined,
          graph_expand: args.graph_expand as boolean | undefined,
          graph_retrieval_profile: args.graph_retrieval_profile as string | null | undefined,
          graph_budget_nodes: args.graph_budget_nodes as number | undefined,
          include_archived: args.include_archived as boolean | undefined
        });
      }
      return stubResponse("memory_search", { hits: [], truncated: false });
    }
  },
  {
    name: "memory_fetch_chunk",
    title: "Fetch Chunk",
    description: "Fetch one bounded chunk by id.",
    inputSchema: z.object({
      chunk_id: uuidString,
      max_chars: z.number().int().positive().default(16_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.fetchChunk(args.chunk_id as string, args.max_chars as number | undefined);
      }
      return stubResponse("memory_fetch_chunk", {
        chunk_id: args.chunk_id,
        text: "",
        source_event_id: null,
        metadata: {}
      });
    }
  },
  {
    name: "memory_link",
    title: "Link Memory Records",
    description: "Create a graph edge between chunks, events, or external refs.",
    inputSchema: z.object({
      src_kind: z.enum(["chunk", "event"]),
      src_id: z.string().min(1),
      dst_kind: z.enum(["chunk", "event", "external"]),
      dst_id: z.string().min(1),
      relation_type: z.string().min(1),
      weight: z.number().default(1.0),
      metadata
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.linkMemory(args as LinkMemoryInput);
      return stubResponse("memory_link", { edge_id: randomUUID() });
    }
  },
  {
    name: "memory_keeper_candidates",
    title: "Generate Keeper Graph Candidates",
    description:
      "Dry-run or explicitly persist governed graph candidate proposals from controlled keeper text or bounded project-source evidence. Dry-run is the default. Do not paste raw secrets, credentials, customer data, raw artifacts, backups, or bulk project files.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      developer_id: uuidString.nullable().optional(),
      text: z
        .string()
        .min(1)
        .max(50_000)
        .optional()
        .describe("Controlled keeper source text. Do not include raw secrets or customer data."),
      from_source_id: uuidString
        .optional()
        .describe(
          "Project source id to resolve into bounded governed Recallant evidence. Requires database access."
        ),
      source_kind: graphSourceRefKind.default("external"),
      source_id: nullableString,
      source_path: nullableString,
      label: nullableString,
      max_source_chars: z.number().int().positive().max(50_000).optional(),
      max_source_memories: z.number().int().positive().max(50).optional(),
      write_candidates: z.boolean().default(false),
      confirm: z.boolean().default(false)
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      const textInput = typeof args.text === "string" ? args.text : null;
      const fromSourceId = typeof args.from_source_id === "string" ? args.from_source_id : null;
      const sourcePath = stringInput(args.source_path);
      const label = stringInput(args.label);
      const sourceId = stringInput(args.source_id);
      const maxSourceChars =
        typeof args.max_source_chars === "number" ? args.max_source_chars : undefined;
      const maxSourceMemories =
        typeof args.max_source_memories === "number" ? args.max_source_memories : undefined;
      const inputModeCount = [textInput !== null, fromSourceId !== null].filter(Boolean).length;
      if (inputModeCount !== 1) {
        throw validationError(
          "memory_keeper_candidates requires exactly one of text or from_source_id"
        );
      }
      if (args.write_candidates === true && args.confirm !== true) {
        throw validationError(
          "keeper candidate persistence requires write_candidates=true and confirm=true"
        );
      }
      if ((fromSourceId || args.write_candidates === true) && !database) {
        throw new Error(
          fromSourceId
            ? "RECALLANT_DATABASE_URL is required for keeper from_source_id source resolution"
            : "RECALLANT_DATABASE_URL is required for keeper candidate writes"
        );
      }

      let sourceInput: MemoryKeeperSourceInput;
      if (fromSourceId) {
        const resolved = await database!.resolveKeeperProjectSource({
          source_id: fromSourceId,
          project_id: (scoped.input.project_id as string | null | undefined) ?? null,
          project_path: (scoped.input.project_path as string | null | undefined) ?? null,
          max_source_chars: maxSourceChars,
          max_source_memories: maxSourceMemories
        });
        sourceInput = {
          input_kind: "source_excerpt",
          text: resolved.text,
          source_kind: "source",
          source_id: resolved.source_id,
          uri: resolved.uri,
          path: sourcePath ?? resolved.path,
          label: label ?? resolved.label,
          metadata: {
            ...resolved.metadata,
            mcp_tool: "memory_keeper_candidates"
          },
          source_resolution: resolved.source_resolution
        };
      } else {
        sourceInput = {
          input_kind: "text",
          text: textInput ?? "",
          source_kind:
            typeof args.source_kind === "string"
              ? (args.source_kind as MemoryKeeperSourceInput["source_kind"])
              : "external",
          source_id: sourceId,
          path: sourcePath,
          label: label ?? "Keeper MCP text",
          metadata: {
            mcp_tool: "memory_keeper_candidates"
          }
        };
      }

      const plan = {
        action: "keeper_candidates",
        ...buildMemoryKeeperPlan(sourceInput)
      };
      if (args.write_candidates !== true) {
        return {
          ...plan,
          governance: {
            candidate_storage_only: true,
            retrieval_active: false
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }

      const created: Array<{ graph_candidate_id?: string; title?: string | null }> = [];
      for (const proposal of plan.proposals) {
        created.push(
          await database!.createGraphCandidate({
            ...proposal.candidate,
            project_id: (scoped.input.project_id as string | null | undefined) ?? undefined,
            project_path: (scoped.input.project_path as string | null | undefined) ?? undefined
          })
        );
      }
      return {
        ...plan,
        dry_run: false,
        writes_database: true,
        persisted: {
          count: created.length,
          graph_candidate_ids: created.map((candidate) => candidate.graph_candidate_id)
        },
        proposals: plan.proposals.map((proposal, index) => ({
          ...proposal,
          persisted: created[index]?.graph_candidate_id ?? null
        })),
        governance: {
          candidate_storage_only: true,
          retrieval_active: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      };
    }
  },
  {
    name: "memory_create_graph_candidate",
    title: "Create Graph Candidate",
    description:
      "Create a governed staging record for a proposed graph node or edge. Graph candidates preserve provenance and review state; they do not affect default retrieval by themselves.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      developer_id: uuidString.nullable().optional(),
      candidate_kind: graphCandidateKind,
      node_kind: graphNodeKind.optional(),
      relation_type: z.string().min(1).optional(),
      src: graphCandidateEndpointRef.optional(),
      dst: graphCandidateEndpointRef.optional(),
      title: nullableString,
      summary: nullableString,
      lifecycle_state: graphLifecycleState.optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      extraction_method: graphExtractionMethod,
      created_by: z.enum(["agent", "user", "system", "import"]),
      scope: graphCandidateScope.default("project"),
      scope_kind: nullableString,
      scope_id: nullableString,
      audience: graphCandidateAudience,
      source_refs: z.array(graphCandidateSourceRef).default([]),
      metadata
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const created = await database.createGraphCandidate(
          scoped.input as CreateGraphCandidateInput & GraphCandidateScopedInput
        );
        return {
          ...created,
          governance: {
            candidate_storage_only: true,
            retrieval_active: false
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_create_graph_candidate", {
        graph_candidate_id: randomUUID(),
        candidate_kind: args.candidate_kind,
        lifecycle_state: args.lifecycle_state ?? "candidate",
        source_refs: args.source_refs ?? [],
        review_actions: [],
        governance: {
          candidate_storage_only: true,
          retrieval_active: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_list_graph_candidates",
    title: "List Graph Candidates",
    description:
      "List governed graph candidate staging records for the current project. Candidate rows are reviewable proposals and do not affect default retrieval by themselves.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      developer_id: uuidString.nullable().optional(),
      candidate_kind: graphCandidateKind.optional(),
      lifecycle_state: graphLifecycleState.optional(),
      source_kind: graphSourceRefKind.optional(),
      extraction_method: graphExtractionMethod.optional(),
      created_by: z.enum(["agent", "user", "system", "import"]).optional(),
      audience_kind: nullableString,
      limit: z.number().int().positive().max(200).default(50)
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const result = await database.listGraphCandidates(
          scoped.input as ListGraphCandidatesInput & GraphCandidateScopedInput
        );
        return {
          ...result,
          governance: {
            candidate_storage_only: true,
            retrieval_active: false
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_list_graph_candidates", {
        candidates: [],
        governance: {
          candidate_storage_only: true,
          retrieval_active: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_get_graph_candidate",
    title: "Get Graph Candidate",
    description:
      "Read one governed graph candidate staging record from the current project. Candidate data remains outside default retrieval unless a future promotion path is used.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      graph_candidate_id: uuidString
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const result = await database.getGraphCandidate(
          scoped.input as GetGraphCandidateInput & GraphCandidateScopedInput
        );
        return {
          ...result,
          governance: {
            candidate_storage_only: true,
            retrieval_active: false
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_get_graph_candidate", {
        graph_candidate_id: args.graph_candidate_id,
        found: false,
        governance: {
          candidate_storage_only: true,
          retrieval_active: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_review_graph_candidate",
    title: "Review Graph Candidate",
    description:
      "Append review history and update lifecycle state for a governed graph candidate. Accepting a candidate records review state only; it does not insert graph edges or change default retrieval by itself.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      graph_candidate_id: uuidString,
      action: graphReviewAction,
      actor_kind: z.enum(["agent", "user", "system"]),
      note: nullableString,
      patch: z
        .object({
          node_kind: graphNodeKind.optional(),
          relation_type: z.string().min(1).optional(),
          title: nullableString,
          summary: nullableString,
          confidence: z.number().min(0).max(1).nullable().optional(),
          lifecycle_state: graphLifecycleState.optional(),
          audience: graphCandidateAudience.optional(),
          metadata: metadata.optional()
        })
        .default({}),
      merge_target_id: uuidString.nullable().optional(),
      superseded_by: uuidString.nullable().optional(),
      metadata
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const result = await database.reviewGraphCandidate(
          scoped.input as ReviewGraphCandidateInput & GraphCandidateScopedInput
        );
        return {
          ...result,
          governance: {
            candidate_storage_only: true,
            retrieval_active: false
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_review_graph_candidate", {
        graph_candidate_id: args.graph_candidate_id,
        lifecycle_state:
          args.action === "reject"
            ? "rejected"
            : args.action === "archive"
              ? "archived"
              : args.action === "mark_stale" || args.action === "supersede"
                ? "stale"
                : "accepted",
        review_actions: [
          {
            review_action_id: randomUUID(),
            graph_candidate_id: args.graph_candidate_id,
            action: args.action,
            actor_kind: args.actor_kind,
            note: args.note ?? null,
            metadata: args.metadata ?? {},
            created_at: nowIso()
          }
        ],
        governance: {
          candidate_storage_only: true,
          retrieval_active: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_promote_graph_candidate",
    title: "Promote Graph Candidate",
    description:
      "Explicitly promote one accepted, compatible graph edge candidate into the active edges table. Accepting a candidate remains review-only; this tool is the activation path.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      graph_candidate_id: uuidString,
      actor_kind: z.enum(["agent", "user", "system"]).default("agent"),
      note: nullableString,
      metadata
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const result = await database.promoteGraphCandidate(
          scoped.input as PromoteGraphCandidateInput & GraphCandidateScopedInput
        );
        return {
          ...result,
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_promote_graph_candidate", {
        graph_candidate_id: args.graph_candidate_id,
        status: "blocked",
        active_edge: false,
        retrieval_active: false,
        promoted_edge_id: null,
        blocked_reason: "unsupported_endpoint",
        blocked_detail:
          "Stub runtime cannot promote graph candidates without a configured database.",
        governance: {
          explicit_promotion: true,
          accept_remains_review_only: true,
          active_graph_table: "edges",
          active_edge: false,
          retrieval_active: false,
          supported_endpoint_policy: "current_edges",
          endpoint_capabilities: {
            active_edge_supported: false,
            chunk_retrieval_supported: false
          }
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_graph_hygiene",
    title: "Graph Hygiene",
    description:
      "Return read-only graph candidate hygiene counts, duplicate groups, and promotion readiness for the scoped project. This tool does not mutate graph candidates or edges.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      developer_id: uuidString.nullable().optional(),
      limit: z.number().int().positive().max(1000).default(500)
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (database) {
        const result = await database.getGraphCandidateHygiene(
          scoped.input as GetGraphCandidateHygieneInput & GraphCandidateScopedInput
        );
        return {
          ...result,
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_graph_hygiene", {
        generated_at: nowIso(),
        counts: {
          total: 0,
          promotable: 0,
          blocked: 0,
          duplicate: 0,
          stale: 0,
          promoted: 0,
          conflict_review: 0,
          blocked_reasons: {}
        },
        readiness: [],
        duplicate_groups: [],
        governance: {
          read_only: true,
          mutates_candidates: false,
          mutates_edges: false,
          supported_endpoint_policy: "current_edges",
          active_edge_endpoint_kinds: ["chunk", "event", "external"],
          chunk_retrieval_endpoint_policy: "chunk_to_chunk"
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_graph_maintenance",
    title: "Graph Maintenance",
    description:
      "Preview governed graph candidate maintenance recommendations or apply one explicit lifecycle maintenance action. Plan mode is read-only. Apply mode requires confirm: true and never mutates active edges or retrieval semantics.",
    inputSchema: z.object({
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString,
      developer_id: uuidString.nullable().optional(),
      mode: z.enum(["plan", "apply"]).default("plan"),
      limit: z.number().int().positive().max(200).default(50),
      action_kind: graphMaintenanceActionKind.optional(),
      graph_candidate_id: uuidString.optional(),
      target_graph_candidate_id: uuidString.nullable().optional(),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().optional(),
      actor_kind: z.enum(["agent", "user", "system"]).default("agent"),
      note: nullableString,
      metadata
    }),
    handler: async (args) => {
      const scoped = scopedProjectInputWithDiagnostics(args);
      const database = db();
      if (args.mode === "apply") {
        if (args.confirm !== true) {
          throw new Error(
            "VALIDATION_ERROR: memory_graph_maintenance apply requires confirm: true"
          );
        }
        if (!args.action_kind || !args.graph_candidate_id) {
          throw new Error(
            "VALIDATION_ERROR: memory_graph_maintenance apply requires action_kind and graph_candidate_id"
          );
        }
        if (
          (args.action_kind === "merge_duplicate" || args.action_kind === "supersede_candidate") &&
          !args.target_graph_candidate_id
        ) {
          throw new Error(
            "VALIDATION_ERROR: memory_graph_maintenance apply requires target_graph_candidate_id"
          );
        }
        if (database) {
          const result = await database.applyGraphCandidateMaintenance(
            scoped.input as GraphCandidateMaintenanceApplyInput & GraphCandidateScopedInput
          );
          return {
            tool: "memory_graph_maintenance",
            mode: "apply",
            ...result,
            ...projectScopeDiagnosticOutput(scoped)
          };
        }
        return stubResponse("memory_graph_maintenance", {
          mode: "apply",
          generated_at: nowIso(),
          action_kind: args.action_kind,
          graph_candidate_id: args.graph_candidate_id,
          target_graph_candidate_id: args.target_graph_candidate_id ?? null,
          status: "dry_run",
          mutation: {
            dry_run: true,
            confirmed: true,
            mutates_candidates: false,
            review_action_appended: false,
            deletes_candidates: false,
            mutates_edges: false,
            retrieval_semantics_changed: false
          },
          governance: {
            read_only_plan: false,
            dry_run_default: true,
            apply_requires_confirm: true,
            deletes_candidates: false,
            mutates_edges: false,
            retrieval_semantics_changed: false,
            preserves_source_refs: true
          },
          ...projectScopeDiagnosticOutput(scoped)
        });
      }
      if (database) {
        const result = await database.getGraphCandidateMaintenancePlan(
          scoped.input as GetGraphCandidateMaintenancePlanInput & GraphCandidateScopedInput
        );
        return {
          tool: "memory_graph_maintenance",
          mode: "plan",
          ...result,
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_graph_maintenance", {
        mode: "plan",
        generated_at: nowIso(),
        counts: {
          total_recommendations: 0,
          duplicates: 0,
          stale_or_archived: 0,
          blocked: 0,
          conflict_review: 0,
          promoted_cleanup: 0,
          omitted_recommendations: 0,
          truncated: false,
          limits: {
            recommendations: args.limit ?? 50
          }
        },
        lanes: [],
        governance: {
          read_only_plan: true,
          dry_run_default: true,
          apply_requires_confirm: true,
          deletes_candidates: false,
          mutates_edges: false,
          retrieval_semantics_changed: false,
          preserves_source_refs: true,
          mutates_candidates: false
        },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_promote",
    title: "Promote Memory",
    description: "Compatibility helper for promoting a chunk into broader governed scope.",
    inputSchema: z.object({
      chunk_id: uuidString,
      note: nullableString
    }),
    handler: (args) =>
      stubResponse("memory_promote", {
        ok: true,
        chunk_id: args.chunk_id,
        scope: "developer",
        scope_kind: "developer"
      })
  },
  {
    name: "memory_archive",
    title: "Archive Chunk",
    description: "Archive or unarchive a chunk for ordinary search.",
    inputSchema: z.object({
      chunk_id: uuidString,
      action: z.enum(["archive", "unarchive"])
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.archiveChunk(args as ArchiveInput);
      return stubResponse("memory_archive", {
        ok: true,
        chunk_id: args.chunk_id,
        archived_at: args.action === "archive" ? nowIso() : null
      });
    }
  },
  {
    name: "memory_forget",
    title: "Forget Content",
    description:
      "Preview or run project-bound erasure. Broad search/scope targets require the exact preview confirmation token.",
    inputSchema: z.object({
      target: z.object({
        kind: z.enum(forgetTargetKindValues),
        id: z.string().nullable().optional(),
        selector: z
          .object({
            project_id: z.string().uuid().nullable().optional(),
            query: z.string().min(3).max(200).nullable().optional(),
            scope_kind: z.string().min(1).max(80).nullable().optional(),
            scope_id: z.string().min(1).max(200).nullable().optional(),
            max_matches: z.number().int().min(1).max(1000).nullable().optional()
          })
          .strict()
          .default({})
      }),
      reason: nullableString,
      dry_run: z.boolean().default(true),
      confirmation: z
        .object({
          confirmed: z.boolean().default(false),
          confirmation_token: nullableString
        })
        .default({ confirmed: false })
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.forget(args as ForgetInput);
      return stubResponse("memory_forget", {
        erasure_id: randomUUID(),
        status: "preview",
        requires_confirmation: true,
        affected: {
          events: 0,
          chunks: 0,
          embeddings: 0,
          edges: 0,
          agent_memories: 0,
          raw_artifacts: 0,
          source_refs: 0,
          review_actions: 0,
          recall_traces: 0,
          checkpoints: 0,
          external_artifacts: 0,
          derived_summaries: 0
        },
        warnings: ["MCP skeleton stub: erasure preview is not database-backed yet."],
        redacted_receipt: {}
      });
    }
  },
  {
    name: "memory_get_checkpoint",
    title: "Get Checkpoint",
    description: "Fetch the current project checkpoint.",
    inputSchema: z.object({}),
    handler: async () => {
      const database = db();
      if (database) {
        return database.getCheckpoint(
          currentRecallantToolsContext().projectId ?? process.env.RECALLANT_PROJECT_ID
        );
      }
      return stubResponse("memory_get_checkpoint", { payload: null, updated_at: null });
    }
  },
  {
    name: "memory_set_checkpoint",
    title: "Set Checkpoint",
    description:
      "Set the current project checkpoint state only. This does not create searchable governed memory; use memory_agent_checkpoint for searchable checkpoint closeout.",
    inputSchema: z.object({
      payload: checkpointPayloadSchema
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        const context = currentRecallantToolsContext();
        const identity = await projectIdentityPreflight({
          database,
          projectId: context.projectId ?? process.env.RECALLANT_PROJECT_ID,
          projectPath: context.projectPath ?? null
        });
        const checkpoint = await database.setCheckpoint(
          identity.project_id ?? context.projectId ?? process.env.RECALLANT_PROJECT_ID,
          args.payload as JsonObject
        );
        try {
          return {
            ok: true,
            updated_at: checkpoint?.updated_at ?? nowIso(),
            checkpoint_state_only: true,
            searchable_memory_created: false,
            memory_id: null,
            repo_sync: await syncProjectLog(
              args.payload as JsonObject,
              database,
              identity.project_id ?? context.projectId ?? process.env.RECALLANT_PROJECT_ID,
              identity.project_path ?? context.projectPath ?? null
            )
          };
        } catch (error) {
          return {
            ok: true,
            updated_at: checkpoint?.updated_at ?? nowIso(),
            checkpoint_state_only: true,
            searchable_memory_created: false,
            memory_id: null,
            repo_sync: {
              status: "failed",
              reason: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }
      return stubResponse("memory_set_checkpoint", {
        ok: true,
        updated_at: nowIso(),
        checkpoint_state_only: true,
        searchable_memory_created: false,
        memory_id: null
      });
    }
  },
  {
    name: "memory_agent_checkpoint",
    title: "Create Agent Checkpoint",
    description:
      "Explicit high-level checkpoint closeout: update checkpoint state, append a checkpoint event when a session_id is available, and create a searchable governed checkpoint memory.",
    inputSchema: z.object({
      session_id: uuidString.nullable().optional(),
      client_kind: z.string().min(1).default("mcp"),
      project_id: uuidString.nullable().optional(),
      project_path: nullableString,
      project_dir: nullableString.describe("Compatibility alias for project_path."),
      payload: checkpointPayloadSchema,
      metadata
    }),
    handler: async (args) => {
      const database = db();
      const payload = args.payload as JsonObject;
      const context = currentRecallantToolsContext();
      const scoped = scopedProjectInputWithDiagnostics(args, {
        includeEnvironmentProjectScope: true
      });
      const projectId = stringInput(scoped.input.project_id);
      const projectPath = stringInput(scoped.input.project_path);
      const sessionId =
        typeof args.session_id === "string" ? args.session_id : (context.sessionId ?? null);
      if (database) {
        const requestedIdentity = await projectIdentityPreflight({
          database,
          projectId,
          projectPath
        });
        const projectContext = requestedIdentity.project_id
          ? { projectId: requestedIdentity.project_id }
          : await database.ensureProject(projectPath ?? undefined);
        const checkpoint = await database.setCheckpoint(projectContext.projectId, payload);
        const eventText = checkpointEventText(payload);
        const event = sessionId
          ? await database.appendEvent({
              session_id: sessionId,
              client_kind: String(args.client_kind ?? "mcp"),
              event_kind: "checkpoint",
              text: eventText,
              metadata: {
                capture_kind: "memory_agent_checkpoint",
                checkpoint_payload: payload,
                ...(args.metadata as JsonObject)
              },
              raw_artifacts: []
            })
          : null;
        const sourceRefs = event
          ? [
              {
                source_kind: "event",
                source_id: String(event.event_id),
                quote: summarizeText(eventText, 500),
                metadata: { capture_kind: "memory_agent_checkpoint" }
              }
            ]
          : [
              {
                source_kind: "checkpoint",
                source_id: `checkpoint:${String(checkpoint?.updated_at ?? nowIso())}`,
                quote: summarizeText(eventText, 500),
                metadata: {
                  capture_kind: "memory_agent_checkpoint",
                  event_appended: false
                }
              }
            ];
        const memory = await database.createAgentMemory({
          project_id: projectContext.projectId,
          project_path: projectPath,
          memory_type: "checkpoint",
          scope: "project",
          scope_kind: "project",
          title: summarizeText(`Checkpoint: ${checkpointValue(payload, "current_focus")}`, 72),
          body: checkpointMemoryBody(payload),
          confidence: 0.95,
          created_by: "agent",
          source_refs: sourceRefs,
          metadata: {
            created_from: "memory_agent_checkpoint",
            searchable_checkpoint_memory: true,
            ...(args.metadata as JsonObject)
          }
        });
        return {
          ok: true,
          action: "memory_agent_checkpoint",
          checkpoint_updated_at: checkpoint?.updated_at ?? nowIso(),
          checkpoint_state_only: false,
          searchable_memory_created: true,
          event_appended: Boolean(event),
          event_id: event?.event_id ?? null,
          memory_id: memory.memory_id,
          memory: {
            ...memory,
            memory_type: "checkpoint"
          },
          ...projectScopeDiagnosticOutput(scoped)
        };
      }
      return stubResponse("memory_agent_checkpoint", {
        ok: true,
        action: "memory_agent_checkpoint",
        checkpoint_updated_at: nowIso(),
        checkpoint_state_only: false,
        searchable_memory_created: true,
        event_appended: false,
        event_id: null,
        memory_id: randomUUID(),
        memory: { status: "accepted", use_policy: "recall_allowed", memory_type: "checkpoint" },
        ...projectScopeDiagnosticOutput(scoped)
      });
    }
  },
  {
    name: "memory_create_agent_memory",
    title: "Create Agent Memory",
    description: createAgentMemoryDescription,
    examples: [safeSemanticMarkerMemoryExample],
    inputSchema: z.object({
      memory_type: memoryType.describe(
        'Required governed memory type. For a safe diagnostic marker use "work_log"; for project facts use "environment_fact" or another listed type, not "fact".'
      ),
      scope: memoryScope.describe(
        'Required governed scope. Use "project" for project-specific memory.'
      ),
      scope_kind: nullableString.describe(
        'Optional scope label. Use "project" or omit/null for normal project-scoped memory.'
      ),
      scope_id: nullableString.describe(
        "Optional explicit scope id. Omit/null for the current project context."
      ),
      audience: z
        .array(
          z
            .object({
              kind: z
                .enum([
                  "all_agents",
                  "specific_client",
                  "context_pack",
                  "background_worker",
                  "review_ui",
                  "human_owner",
                  "import_pipeline",
                  "connector"
                ])
                .describe('Audience kind. Use "all_agents" for project-wide agent recall.'),
              id: nullableString.describe('Audience id. Use null with "all_agents".')
            })
            .describe('Audience object, for example { "kind": "all_agents", "id": null }.'),
          {
            error:
              'audience must be an array of objects, for example [{ "kind": "all_agents", "id": null }].'
          }
        )
        .describe(
          'Required audience list. For normal project memory use [{ "kind": "all_agents", "id": null }], not a string.'
        )
        .default([]),
      title: z
        .string({
          error: "title is required; provide a short non-secret memory title."
        })
        .min(1, "title is required; provide a short non-secret memory title.")
        .describe("Required short non-secret title for this governed memory."),
      body: z
        .string({
          error:
            "body is required; provide concise governed memory text without raw secrets or customer data."
        })
        .min(
          1,
          "body is required; provide concise governed memory text without raw secrets or customer data."
        )
        .describe(
          `Required concise governed memory text. Do not include ${governedMemoryForbiddenClasses}.`
        ),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .nullable()
        .optional()
        .describe("Optional confidence between 0 and 1."),
      source_refs: z
        .array(
          z
            .object({
              source_kind: sourceKind.describe("Source reference kind."),
              source_id: z
                .string()
                .min(1)
                .describe("Source identifier or path reference; never paste credential values."),
              quote: nullableString.describe("Optional short non-secret quote or null.")
            })
            .describe("Source reference object. Keep it bounded and non-secret.")
        )
        .describe(
          "Optional source references. Remote agent-created memories get a safe external source ref when omitted."
        )
        .default([]),
      created_by: z
        .enum(["agent", "user", "system", "import"], {
          error: 'created_by is required; agents should normally use "agent".'
        })
        .describe('Required creator kind. Agents should normally use "agent".'),
      metadata: metadata.describe(
        "Optional non-secret metadata, for example diagnostic_marker: true."
      )
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.createAgentMemory(scopedAgentMemoryInput(args));
      return stubResponse("memory_create_agent_memory", {
        memory_id: randomUUID(),
        status: args.created_by === "agent" ? "accepted" : "candidate",
        use_policy: "recall_allowed"
      });
    }
  },
  {
    name: "memory_review_agent_memory",
    title: "Review Agent Memory",
    description: "Update review or use state for a governed memory.",
    inputSchema: z.object({
      memory_id: uuidString,
      action: z.enum([
        "accept",
        "approve",
        "reject",
        "supersede",
        "archive",
        "unarchive",
        "mark_stale",
        "promote_instruction",
        "demote_instruction",
        "edit",
        "merge"
      ]),
      superseded_by: uuidString.nullable().optional(),
      merge_memory_ids: z.array(uuidString).default([]),
      patch: z
        .object({
          title: nullableString,
          body: nullableString,
          scope: memoryScope.nullable().optional(),
          scope_kind: nullableString,
          scope_id: nullableString,
          audience: z.array(z.unknown()).optional(),
          memory_type: nullableString
        })
        .default({}),
      note: nullableString,
      actor_kind: z.enum(["user", "agent", "system"])
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.reviewAgentMemory(args as ReviewAgentMemoryInput);
      return stubResponse("memory_review_agent_memory", {
        ok: true,
        memory_id: args.memory_id,
        status: args.action === "reject" ? "rejected" : "accepted",
        use_policy: args.action === "promote_instruction" ? "instruction_grade" : "recall_allowed"
      });
    }
  },
  {
    name: "memory_list_agent_memories",
    title: "List Agent Memories",
    description: "List governed memories for management surfaces.",
    inputSchema: z.object({
      view: z.enum(["inbox", "rules", "candidates", "duplicates", "conflicts", "all"]),
      project_id: uuidString.nullable().optional(),
      source_id: uuidString.nullable().optional(),
      scope: memoryScope.nullable().optional(),
      scope_kind: nullableString,
      audience_kind: nullableString,
      memory_domain: nullableString,
      status: nullableString,
      use_policy: nullableString,
      limit: z.number().int().positive().max(200).default(50)
    }),
    handler: async (args) => {
      const database = db();
      if (database)
        return database.listAgentMemories(scopedProjectInput(args) as ListAgentMemoriesInput);
      return stubResponse("memory_list_agent_memories", { memories: [] });
    }
  },
  {
    name: "memory_get_agent_memory",
    title: "Get Agent Memory",
    description: "Return one governed memory with source refs and review history.",
    inputSchema: z.object({
      memory_id: uuidString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.getAgentMemory(args.memory_id as string);
      return stubResponse("memory_get_agent_memory", {
        memory: { memory_id: args.memory_id },
        source_refs: [],
        review_actions: [],
        related_memories: []
      });
    }
  },
  {
    name: "memory_recall_agent_memories",
    title: "Recall Agent Memories",
    description: recallAgentMemoriesDescription,
    examples: [safeSemanticMarkerRecallExample],
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Required search text. For marker proof, use the same synthetic marker string."),
      source_id: uuidString.nullable().optional(),
      scope: scope.default("project"),
      scope_kind: nullableString,
      audience_kind: nullableString,
      memory_types: z.array(recallMemoryType).default([]),
      include_candidates: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      include_needs_review: z.boolean().default(false),
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.recallAgentMemories(scopedProjectInput(args) as RecallAgentMemoriesInput);
      }
      return stubResponse("memory_recall_agent_memories", {
        trace_id: randomUUID(),
        memories: [],
        truncated: false
      });
    }
  },
  {
    name: "memory_cross_project_recall",
    title: "Cross-Project Recall",
    description:
      "Explicitly retrieve source-linked governed-memory examples from this project, other projects, developer rules, or environment/capability records without adding them to default context.",
    inputSchema: z.object({
      query: z.string().min(1),
      mode: z
        .enum([
          "same_project",
          "developer_rules",
          "environment",
          "similar_projects",
          "all_projects_review"
        ])
        .default("similar_projects"),
      session_id: uuidString.nullable().optional(),
      scope_kind: nullableString,
      memory_types: z.array(z.string().min(1)).default([]),
      include_candidates: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      include_needs_review: z.boolean().default(false),
      include_detached: z.boolean().default(false),
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.crossProjectRecall(args as CrossProjectRecallInput);
      return stubResponse("memory_cross_project_recall", {
        trace_id: randomUUID(),
        mode: args.mode ?? "similar_projects",
        results: [],
        truncated: false,
        policy: {
          default_context_pack_includes_cross_project_examples: false,
          cross_project_results_are_binding_rules: false
        }
      });
    }
  },
  {
    name: "memory_report_recall_usage",
    title: "Report Recall Usage",
    description: "Report which recalled memories or chunks were used or ignored.",
    inputSchema: z.object({
      trace_id: uuidString,
      used_memory_ids: z.array(uuidString).default([]),
      ignored_memory_ids: z.array(uuidString).default([]),
      used_chunk_ids: z.array(uuidString).default([]),
      note: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.reportRecallUsage(args as ReportRecallUsageInput);
      return stubResponse("memory_report_recall_usage", { ok: true });
    }
  },
  {
    name: "memory_closeout",
    title: "Close Out Session",
    description: "Run durable closeout for an ending or pausing session.",
    inputSchema: z.object({
      session_id: uuidString,
      closeout_intent: z.enum([
        "manual_exit",
        "pause",
        "task_complete",
        "context_compaction",
        "other"
      ]),
      summary: z.string(),
      checkpoint_payload: z.object({
        current_status: z.string(),
        current_focus: z.string(),
        next_step: z.string(),
        last_event_id: uuidString.nullable().optional(),
        open_questions: z.array(z.string()).default([])
      }),
      governed_memory_candidates: z
        .array(
          z.object({
            memory_type: memoryType,
            title: z.string(),
            body: z.string(),
            confidence: z.number().min(0).max(1).nullable().optional(),
            source_refs: z.array(z.unknown()).default([])
          })
        )
        .default([]),
      artifact_refs: z
        .array(
          z.object({
            kind: z.enum(["file", "commit", "url", "external"]),
            ref: z.string(),
            note: nullableString
          })
        )
        .default([]),
      closeout_diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
      local_spool_status: z.record(z.string(), z.unknown()).nullable().optional()
    }),
    handler: async (args) => {
      const database = db();
      const context = currentRecallantToolsContext();
      const checkpointPayload = args.checkpoint_payload as JsonObject;
      const sessionId = String(args.session_id);
      const localSpoolStatus = args.local_spool_status as JsonObject | null | undefined;
      if (database) {
        const sessionBinding = await database.getSessionProjectBinding(sessionId);
        const runtimeAttachment = await attachedProjectConfig(context.projectPath);
        const identity = await projectIdentityPreflight({
          database,
          projectId: runtimeAttachment.projectPath
            ? (context.projectId ?? sessionBinding.project_id)
            : sessionBinding.project_id,
          projectPath: runtimeAttachment.projectPath ?? sessionBinding.primary_path
        });
        if (
          runtimeAttachment.projectPath &&
          identity.project_id &&
          identity.project_id !== sessionBinding.project_id
        ) {
          throw validationError(
            "PROJECT_ID_PATH_MISMATCH: closeout session project does not match the attached project path."
          );
        }
        const closeoutEvent = await database.appendEvent({
          session_id: sessionId,
          client_kind: "mcp",
          event_kind: "system",
          text: `Closeout: ${closeoutSummaryText(args.summary, checkpointPayload)}`,
          metadata: {
            capture_kind: "memory_closeout",
            closeout_intent: String(args.closeout_intent),
            checkpoint_payload: checkpointPayload
          },
          raw_artifacts: []
        });
        const checkpoint = await database.closeout(
          sessionId,
          checkpointPayload,
          "closeout",
          localSpoolStatus,
          args.closeout_diagnostics as JsonObject | null | undefined
        );
        const closeoutProjectId = stringInput(checkpoint?.project_id) ?? context.projectId ?? null;
        const closeoutContext = {
          ...context,
          projectId: closeoutProjectId,
          projectPath: identity.project_path ?? sessionBinding.primary_path
        };
        const createdMemoryIds: string[] = [];
        const needsReviewIds: string[] = [];
        const warnings = [...(checkpoint?.warnings ?? [])];
        for (const candidate of args.governed_memory_candidates as Array<Record<string, unknown>>) {
          if (typeof candidate.confidence === "number" && candidate.confidence < 0.5) {
            warnings.push(
              `Closeout candidate "${String(candidate.title)}" has low extraction confidence.`
            );
          }
          try {
            const created = await database.createAgentMemory({
              project_id: closeoutProjectId ?? undefined,
              memory_type: String(candidate.memory_type),
              scope: "project",
              title: String(candidate.title),
              body: String(candidate.body),
              confidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
              source_refs: closeoutSourceRefs(
                Array.isArray(candidate.source_refs) ? candidate.source_refs : [],
                String(args.session_id)
              ),
              created_by: "agent",
              metadata: { created_from: "memory_closeout" }
            });
            if (created.memory_id) createdMemoryIds.push(created.memory_id);
            if (created.status === "candidate" || created.status === "needs_review") {
              needsReviewIds.push(created.memory_id);
            }
          } catch (error) {
            warnings.push(
              `Failed to create closeout governed-memory candidate: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
        const lifecycleMarker = closeoutLifecycleMarker({
          sessionId,
          eventId: String(closeoutEvent.event_id),
          summary: args.summary,
          payload: checkpointPayload
        });
        const closeoutMemory = await database.createAgentMemory({
          project_id: closeoutProjectId ?? undefined,
          project_path: closeoutProjectId ? undefined : (context.projectPath ?? undefined),
          memory_type: "work_log",
          scope: "project",
          scope_kind: "project",
          title: summarizeText(
            `Closeout: ${closeoutSummaryText(args.summary, checkpointPayload)}`,
            72
          ),
          body: closeoutMemoryBody({
            summary: args.summary,
            payload: checkpointPayload,
            sessionId,
            eventId: String(closeoutEvent.event_id),
            lifecycleMarker
          }),
          confidence: 0.95,
          created_by: "agent",
          source_refs: [
            {
              source_kind: "event",
              source_id: String(closeoutEvent.event_id),
              quote: summarizeText(
                `Closeout: ${closeoutSummaryText(args.summary, checkpointPayload)}`,
                500
              ),
              metadata: {
                capture_kind: "memory_closeout",
                created_from: "memory_closeout_lifecycle",
                lifecycle_marker: lifecycleMarker
              }
            }
          ],
          metadata: {
            created_from: "memory_closeout_lifecycle",
            closeout_event_id: String(closeoutEvent.event_id),
            lifecycle_marker: lifecycleMarker
          }
        });
        const memoryStatus = closeoutMemoryStatusFromDbStatus(closeoutMemory.status);
        const recallCheckedAt = nowIso();
        let recalledMemoryIds: string[] = [];
        let recallVerified = false;
        let recallWarnings: string[] = [];
        try {
          const recall = await database.recallAgentMemories({
            ...(closeoutProjectId ? { project_id: closeoutProjectId } : {}),
            query: lifecycleMarker,
            memory_types: ["work_log"],
            top_k: 5
          });
          recalledMemoryIds = recall.memories
            .map((memory: Record<string, unknown>) => String(memory.memory_id ?? ""))
            .filter(Boolean);
          recallVerified =
            recalledMemoryIds.includes(String(closeoutMemory.memory_id)) ||
            recall.memories.some((memory: Record<string, unknown>) =>
              String(memory.body ?? "").includes(lifecycleMarker)
            );
          if (!recallVerified) {
            recallWarnings = ["Semantic recall did not return the MCP closeout memory."];
          }
        } catch {
          recallWarnings = ["Semantic recall verification failed; next agent readiness is false."];
        }
        const nextSessionContext = await verifyMcpCloseoutNextSessionContext({
          database,
          context: closeoutContext,
          lifecycleMarker,
          closeoutMemoryId: String(closeoutMemory.memory_id),
          localSpoolStatus
        });
        if (needsReviewIds.length > 0) {
          warnings.push(
            `Closeout created ${needsReviewIds.length} governed-memory candidate(s) requiring review.`
          );
        }
        let projectLogUpdate: Awaited<ReturnType<typeof syncProjectLog>>;
        try {
          projectLogUpdate = await syncProjectLog(
            args.checkpoint_payload as JsonObject,
            database,
            closeoutProjectId,
            identity.project_path ?? context.projectPath ?? sessionBinding.primary_path
          );
        } catch (error) {
          projectLogUpdate = {
            status: "failed",
            reason: error instanceof Error ? error.message : String(error)
          };
          warnings.push(`Failed to update PROJECT_LOG.md: ${projectLogUpdate.reason}`);
        }
        const lifecycleWarnings = [...warnings, ...recallWarnings, ...nextSessionContext.warnings];
        const lifecycle = buildAgentLifecycleCloseoutResult({
          mode: "server",
          project_id: closeoutProjectId,
          session_id: sessionId,
          closeout_event_id: String(closeoutEvent.event_id),
          spool_sync_status: checkpoint?.spool_sync_status ?? "not_provided",
          proof: {
            event: {
              ok: true,
              event_written: true,
              event_id: String(closeoutEvent.event_id)
            },
            checkpoint: {
              ok: Boolean(checkpoint?.updated_at),
              checkpoint_updated: Boolean(checkpoint?.updated_at),
              checkpoint_updated_at: checkpoint?.updated_at ? String(checkpoint.updated_at) : null,
              checkpoint_state_only: true
            },
            memory: {
              ok: memoryStatus === "accepted",
              searchable_memory_created: memoryStatus === "accepted",
              memory_status: memoryStatus,
              memory_id: String(closeoutMemory.memory_id),
              memory_type: "work_log",
              needs_review_ids:
                memoryStatus === "candidate" || memoryStatus === "needs_review"
                  ? [String(closeoutMemory.memory_id)]
                  : []
            },
            recall: {
              ok: recallVerified,
              recall_verified: recallVerified,
              query: lifecycleMarker,
              marker_found: recallVerified,
              recalled_memory_ids: recalledMemoryIds,
              checked_at: recallCheckedAt
            },
            next_session_context: nextSessionContext.proof
          },
          warnings: lifecycleWarnings,
          report_required:
            checkpoint?.report_required === true ||
            needsReviewIds.length > 0 ||
            lifecycleWarnings.length > 0
        });
        return {
          ok: true,
          session_id: sessionId,
          checkpoint_updated_at: checkpoint?.updated_at ?? nowIso(),
          created_memory_ids: createdMemoryIds,
          needs_review_ids: needsReviewIds,
          spool_sync_status: checkpoint?.spool_sync_status ?? "not_provided",
          report_required:
            checkpoint?.report_required === true ||
            needsReviewIds.length > 0 ||
            lifecycleWarnings.length > 0,
          warnings: lifecycleWarnings,
          lifecycle,
          project_log_update: projectLogUpdate
        };
      }
      const lifecycle = nonReadyMcpCloseoutLifecycle({
        sessionId,
        projectId: context.projectId,
        spoolSyncStatus: "not_applicable",
        warnings: ["MCP skeleton stub: closeout is not database-backed yet."]
      });
      return stubResponse("memory_closeout", {
        ok: true,
        session_id: sessionId,
        checkpoint_updated_at: nowIso(),
        created_memory_ids: [],
        needs_review_ids: [],
        spool_sync_status: "not_applicable",
        report_required: true,
        warnings: ["MCP skeleton stub: closeout is not database-backed yet."],
        lifecycle,
        project_log_update: {
          required: true,
          suggested_payload: checkpointPayload
        }
      });
    }
  }
];

export function createRecallantTools(
  context: RecallantToolsRuntimeContext = {}
): readonly RecallantToolDefinition[] {
  const runtimeContext = contextAwarePath(context);
  return recallantToolsBase.map((tool) => ({
    ...tool,
    handler: (args) => runWithRecallantToolsContext(runtimeContext, () => tool.handler(args))
  }));
}

export const recallantTools = createRecallantTools();

export const recallantToolNames = recallantTools.map((tool) => tool.name);
