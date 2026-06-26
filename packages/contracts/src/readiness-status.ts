export const recallantReadinessStateValues = [
  "configured",
  "context_ready",
  "semantic_memory_ready",
  "capture_active",
  "ingestion_approved"
] as const;

export type RecallantReadinessState = (typeof recallantReadinessStateValues)[number];

export const recallantReadinessInvariant =
  "Configuration proves access. Proof proves memory. Capture-active proves Recallant is doing its job." as const;

export type RecallantReadinessContract = {
  version: 1;
  invariant: typeof recallantReadinessInvariant;
  primary_state: RecallantReadinessState | "not_configured";
  configured: boolean;
  context_ready: boolean;
  semantic_memory_ready: boolean;
  capture_active: boolean;
  ingestion_approved: boolean;
  remote_mcp_ready: boolean;
  evidence: {
    last_context_read_at: string | null;
    last_memory_write_at: string | null;
    last_checkpoint_at: string | null;
    last_semantic_recall_proof_at: string | null;
    ingestion_approval_ref: string | null;
  };
  notes: {
    remote_mcp_ready: string;
    ingestion_approved: string;
  };
};

export type RecallantReadinessInput = {
  configured: boolean;
  context_ready?: boolean;
  semantic_memory_ready?: boolean;
  capture_active?: boolean;
  ingestion_approved?: boolean;
  remote_mcp_ready?: boolean;
  last_context_read_at?: string | null;
  last_memory_write_at?: string | null;
  last_checkpoint_at?: string | null;
  last_semantic_recall_proof_at?: string | null;
  ingestion_approval_ref?: string | null;
};

export function buildRecallantReadinessContract(
  input: RecallantReadinessInput
): RecallantReadinessContract {
  const configured = Boolean(input.configured);
  const contextReady = Boolean(input.context_ready);
  const semanticMemoryReady = Boolean(input.semantic_memory_ready);
  const captureActive = Boolean(input.capture_active);
  const ingestionApproved = Boolean(input.ingestion_approved);
  const primaryState: RecallantReadinessContract["primary_state"] = captureActive
    ? "capture_active"
    : semanticMemoryReady
      ? "semantic_memory_ready"
      : contextReady
        ? "context_ready"
        : configured
          ? "configured"
          : ingestionApproved
            ? "ingestion_approved"
            : "not_configured";

  return {
    version: 1,
    invariant: recallantReadinessInvariant,
    primary_state: primaryState,
    configured,
    context_ready: contextReady,
    semantic_memory_ready: semanticMemoryReady,
    capture_active: captureActive,
    ingestion_approved: ingestionApproved,
    remote_mcp_ready: Boolean(input.remote_mcp_ready),
    evidence: {
      last_context_read_at: input.last_context_read_at ?? null,
      last_memory_write_at: input.last_memory_write_at ?? null,
      last_checkpoint_at: input.last_checkpoint_at ?? null,
      last_semantic_recall_proof_at: input.last_semantic_recall_proof_at ?? null,
      ingestion_approval_ref: input.ingestion_approval_ref ?? null
    },
    notes: {
      remote_mcp_ready:
        "remote_mcp_ready means scoped remote MCP access is configured; it is not semantic memory proof.",
      ingestion_approved:
        "ingestion_approved is separate owner approval for import or bulk summarization; agent-authored work memory does not imply ingestion approval."
    }
  };
}
