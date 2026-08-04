export const recallantReadinessStateValues = [
  "configured",
  "context_ready",
  "semantic_memory_ready",
  "memory_loop_ready",
  "capture_active",
  "ingestion_approved"
] as const;

export type RecallantReadinessState = (typeof recallantReadinessStateValues)[number];

export const recallantReadinessInvariant =
  "Configuration proves access. Recall proves memory. Memory-loop-ready proves the governed workflow. Capture-active proves fresh automatic agent telemetry." as const;

export const defaultCaptureFreshnessHours = 24;

export type RecallantReadinessContract = {
  version: 2;
  invariant: typeof recallantReadinessInvariant;
  primary_state: RecallantReadinessState | "not_configured";
  configured: boolean;
  context_ready: boolean;
  semantic_memory_ready: boolean;
  memory_loop_ready: boolean;
  capture_active: boolean;
  capture_fresh: boolean;
  capture_freshness_hours: number;
  ingestion_approved: boolean;
  remote_mcp_ready: boolean;
  evidence: {
    last_context_read_at: string | null;
    last_memory_write_at: string | null;
    last_checkpoint_at: string | null;
    last_semantic_recall_proof_at: string | null;
    last_automatic_capture_at: string | null;
    automatic_capture_source: string | null;
    ingestion_approval_ref: string | null;
  };
  notes: {
    remote_mcp_ready: string;
    memory_loop_ready: string;
    capture_active: string;
    ingestion_approved: string;
  };
};

export type RecallantReadinessInput = {
  configured: boolean;
  context_ready?: boolean;
  semantic_memory_ready?: boolean;
  memory_loop_ready?: boolean;
  /** @deprecated capture_active is derived from fresh automatic-capture evidence. */
  capture_active?: boolean;
  capture_freshness_hours?: number;
  now?: string | Date;
  ingestion_approved?: boolean;
  remote_mcp_ready?: boolean;
  last_context_read_at?: string | null;
  last_memory_write_at?: string | null;
  last_checkpoint_at?: string | null;
  last_semantic_recall_proof_at?: string | null;
  last_automatic_capture_at?: string | null;
  automatic_capture_source?: string | null;
  ingestion_approval_ref?: string | null;
};

export function normalizeCaptureFreshnessHours(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultCaptureFreshnessHours;
}

export function isAutomaticCaptureFresh(input: {
  last_automatic_capture_at?: string | null;
  capture_freshness_hours?: number;
  now?: string | Date;
}) {
  if (!input.last_automatic_capture_at) return false;
  const capturedAt = Date.parse(input.last_automatic_capture_at);
  const nowValue = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now ?? "");
  const now = Number.isFinite(nowValue) ? nowValue : Date.now();
  if (!Number.isFinite(capturedAt)) return false;
  const ageMs = now - capturedAt;
  const maximumAgeMs =
    normalizeCaptureFreshnessHours(input.capture_freshness_hours) * 60 * 60 * 1000;
  return ageMs >= -5 * 60 * 1000 && ageMs <= maximumAgeMs;
}

export function buildRecallantReadinessContract(
  input: RecallantReadinessInput
): RecallantReadinessContract {
  const configured = Boolean(input.configured);
  const contextReady = Boolean(input.context_ready);
  const semanticMemoryReady = Boolean(input.semantic_memory_ready);
  const memoryLoopReady =
    Boolean(input.memory_loop_ready) ||
    Boolean(input.last_context_read_at && input.last_memory_write_at && input.last_checkpoint_at);
  const captureFreshnessHours = normalizeCaptureFreshnessHours(input.capture_freshness_hours);
  const captureFresh = isAutomaticCaptureFresh({
    last_automatic_capture_at: input.last_automatic_capture_at,
    capture_freshness_hours: captureFreshnessHours,
    now: input.now
  });
  const captureActive = configured && captureFresh;
  const ingestionApproved = Boolean(input.ingestion_approved);
  const primaryState: RecallantReadinessContract["primary_state"] = captureActive
    ? "capture_active"
    : memoryLoopReady
      ? "memory_loop_ready"
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
    version: 2,
    invariant: recallantReadinessInvariant,
    primary_state: primaryState,
    configured,
    context_ready: contextReady,
    semantic_memory_ready: semanticMemoryReady,
    memory_loop_ready: memoryLoopReady,
    capture_active: captureActive,
    capture_fresh: captureFresh,
    capture_freshness_hours: captureFreshnessHours,
    ingestion_approved: ingestionApproved,
    remote_mcp_ready: Boolean(input.remote_mcp_ready),
    evidence: {
      last_context_read_at: input.last_context_read_at ?? null,
      last_memory_write_at: input.last_memory_write_at ?? null,
      last_checkpoint_at: input.last_checkpoint_at ?? null,
      last_semantic_recall_proof_at: input.last_semantic_recall_proof_at ?? null,
      last_automatic_capture_at: input.last_automatic_capture_at ?? null,
      automatic_capture_source: input.automatic_capture_source ?? null,
      ingestion_approval_ref: input.ingestion_approval_ref ?? null
    },
    notes: {
      remote_mcp_ready:
        "remote_mcp_ready means scoped remote MCP access is configured; it is not semantic memory proof.",
      memory_loop_ready:
        "memory_loop_ready means context-read, memory-write, and checkpoint evidence all exist; it does not prove that automatic capture is currently running.",
      capture_active:
        "capture_active is derived only from a fresh automatic agent event inside the configured freshness window; manual memory activity cannot set it.",
      ingestion_approved:
        "ingestion_approved is separate owner approval for import or bulk summarization; agent-authored work memory does not imply ingestion approval."
    }
  };
}
