export const agentLifecycleCloseoutResultVersion = 1 as const;

export const agentLifecycleCloseoutInvariant =
  "next_agent_ready is true only after event, checkpoint, searchable governed memory, semantic recall, and next-session context proof all pass." as const;

export const agentLifecycleCloseoutModeValues = ["server", "offline_spool"] as const;

export type AgentLifecycleCloseoutMode = (typeof agentLifecycleCloseoutModeValues)[number];

export const agentLifecycleMemoryProofStatusValues = [
  "accepted",
  "candidate",
  "needs_review",
  "rejected",
  "missing",
  "not_applicable"
] as const;

export type AgentLifecycleMemoryProofStatus =
  (typeof agentLifecycleMemoryProofStatusValues)[number];

export const agentLifecycleCloseoutFailureReasonValues = [
  "server_unavailable_or_spooled",
  "no_active_session",
  "event_write_failed",
  "checkpoint_update_failed",
  "memory_not_searchable",
  "recall_verification_failed",
  "next_session_context_failed",
  "review_required",
  "incomplete_proof"
] as const;

export type AgentLifecycleCloseoutFailureReason =
  (typeof agentLifecycleCloseoutFailureReasonValues)[number];

export type AgentLifecycleEventProof = {
  ok: boolean;
  event_written: boolean;
  event_id?: string | null;
  local_id?: string | null;
  spooled?: boolean;
};

export type AgentLifecycleCheckpointProof = {
  ok: boolean;
  checkpoint_updated: boolean;
  checkpoint_updated_at?: string | null;
  checkpoint_state_only: boolean;
};

export type AgentLifecycleMemoryProof = {
  ok: boolean;
  searchable_memory_created: boolean;
  memory_status: AgentLifecycleMemoryProofStatus;
  memory_id?: string | null;
  memory_type?: string | null;
  needs_review_ids?: string[];
};

export type AgentLifecycleRecallProof = {
  ok: boolean;
  recall_verified: boolean;
  query?: string | null;
  marker_found?: boolean;
  recalled_memory_ids?: string[];
  checked_at?: string | null;
};

export type AgentLifecycleNextSessionContextProof = {
  ok: boolean;
  next_session_context_verified: boolean;
  session_id?: string | null;
  context_pack_id?: string | null;
  marker_found?: boolean;
  checked_at?: string | null;
};

export type AgentLifecycleCloseoutProof = {
  event: AgentLifecycleEventProof;
  checkpoint: AgentLifecycleCheckpointProof;
  memory: AgentLifecycleMemoryProof;
  recall: AgentLifecycleRecallProof;
  next_session_context: AgentLifecycleNextSessionContextProof;
};

export type AgentLifecycleCloseoutResult = {
  version: typeof agentLifecycleCloseoutResultVersion;
  invariant: typeof agentLifecycleCloseoutInvariant;
  mode: AgentLifecycleCloseoutMode;
  project_id?: string | null;
  session_id?: string | null;
  closeout_event_id?: string | null;
  proof: AgentLifecycleCloseoutProof;
  next_agent_ready: boolean;
  failure_reasons: AgentLifecycleCloseoutFailureReason[];
  warnings: string[];
  spool_sync_status?: string | null;
  report_required: boolean;
};

export type AgentLifecycleCloseoutInput = {
  mode: AgentLifecycleCloseoutMode;
  project_id?: string | null;
  session_id?: string | null;
  closeout_event_id?: string | null;
  proof: AgentLifecycleCloseoutProof;
  failure_reasons?: AgentLifecycleCloseoutFailureReason[];
  warnings?: string[];
  spool_sync_status?: string | null;
  report_required?: boolean;
};

function uniqueFailureReasons(
  reasons: AgentLifecycleCloseoutFailureReason[]
): AgentLifecycleCloseoutFailureReason[] {
  return Array.from(new Set(reasons));
}

function redactCloseoutWarning(value: string): string {
  const databaseUrlEnvPattern = new RegExp(["RECALLANT", "DATABASE", "URL"].join("_"), "gi");
  const providerTokenPattern = new RegExp(["provider", "token"].join("\\s+"), "gi");
  const rawArtifactBodyPattern = new RegExp(["raw", "artifact", "body"].join("_"), "gi");

  return value
    .replaceAll(databaseUrlEnvPattern, "[redacted]")
    .replaceAll(/postgres:\/\/[^\s"']*/gi, "[redacted]")
    .replaceAll(providerTokenPattern, "[redacted]")
    .replaceAll(rawArtifactBodyPattern, "[redacted]")
    .replaceAll(/raw credentials?/gi, "[redacted]");
}

export function buildAgentLifecycleCloseoutResult(
  input: AgentLifecycleCloseoutInput
): AgentLifecycleCloseoutResult {
  const proof = input.proof;
  const computedFailureReasons: AgentLifecycleCloseoutFailureReason[] = [
    ...(input.failure_reasons ?? [])
  ];
  const eventReady = proof.event.ok === true && proof.event.event_written === true;
  const checkpointReady =
    proof.checkpoint.ok === true && proof.checkpoint.checkpoint_updated === true;
  const memoryReady =
    proof.memory.ok === true &&
    proof.memory.searchable_memory_created === true &&
    proof.memory.memory_status === "accepted";
  const recallReady = proof.recall.ok === true && proof.recall.recall_verified === true;
  const nextContextReady =
    proof.next_session_context.ok === true &&
    proof.next_session_context.next_session_context_verified === true;

  if (input.mode === "offline_spool") {
    computedFailureReasons.push("server_unavailable_or_spooled");
  }
  if (input.mode === "server" && !input.session_id) {
    computedFailureReasons.push("no_active_session");
  }
  if (!eventReady) computedFailureReasons.push("event_write_failed");
  if (!checkpointReady) computedFailureReasons.push("checkpoint_update_failed");
  if (!memoryReady) {
    if (
      proof.memory.memory_status === "candidate" ||
      proof.memory.memory_status === "needs_review"
    ) {
      computedFailureReasons.push("review_required");
    } else {
      computedFailureReasons.push("memory_not_searchable");
    }
  }
  if (!recallReady) computedFailureReasons.push("recall_verification_failed");
  if (!nextContextReady) computedFailureReasons.push("next_session_context_failed");

  const allProofReady =
    input.mode === "server" &&
    Boolean(input.session_id) &&
    eventReady &&
    checkpointReady &&
    memoryReady &&
    recallReady &&
    nextContextReady;
  if (!allProofReady) computedFailureReasons.push("incomplete_proof");

  const failureReasons = uniqueFailureReasons(computedFailureReasons);
  const nextAgentReady = allProofReady && failureReasons.length === 0;
  const warnings = (input.warnings ?? []).map(redactCloseoutWarning);

  return {
    version: agentLifecycleCloseoutResultVersion,
    invariant: agentLifecycleCloseoutInvariant,
    mode: input.mode,
    project_id: input.project_id ?? null,
    session_id: input.session_id ?? null,
    closeout_event_id: input.closeout_event_id ?? null,
    proof,
    next_agent_ready: nextAgentReady,
    failure_reasons: failureReasons,
    warnings,
    spool_sync_status: input.spool_sync_status ?? null,
    report_required: input.report_required ?? (!nextAgentReady || warnings.length > 0)
  };
}
