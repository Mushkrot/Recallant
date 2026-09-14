import { buildRecallantReadinessContract } from "@recallant/contracts";

type ReadinessContract = ReturnType<typeof buildRecallantReadinessContract>;

type PersistentReadiness = {
  readiness_contract?: unknown;
} | null;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function persistentContract(readiness: PersistentReadiness): ReadinessContract | null {
  const contract = readiness?.readiness_contract;
  return contract && typeof contract === "object" && !Array.isArray(contract)
    ? (contract as ReadinessContract)
    : null;
}

export function mergeDoctorReadinessContract(
  fallback: ReadinessContract,
  readiness: PersistentReadiness
) {
  const persistent = persistentContract(readiness);
  if (!persistent) return fallback;
  const persistentEvidence = objectValue(persistent.evidence);
  const fallbackEvidence = objectValue(fallback.evidence);
  return buildRecallantReadinessContract({
    configured: persistent.configured || fallback.configured,
    remote_mcp_ready: persistent.remote_mcp_ready || fallback.remote_mcp_ready,
    context_ready: persistent.context_ready || fallback.context_ready,
    semantic_memory_ready: persistent.semantic_memory_ready || fallback.semantic_memory_ready,
    memory_loop_ready: persistent.memory_loop_ready || fallback.memory_loop_ready,
    ingestion_approved: persistent.ingestion_approved || fallback.ingestion_approved,
    last_context_read_at:
      stringValue(persistentEvidence.last_context_read_at) ??
      stringValue(fallbackEvidence.last_context_read_at),
    last_memory_write_at:
      stringValue(persistentEvidence.last_memory_write_at) ??
      stringValue(fallbackEvidence.last_memory_write_at),
    last_checkpoint_at:
      stringValue(persistentEvidence.last_checkpoint_at) ??
      stringValue(fallbackEvidence.last_checkpoint_at),
    last_semantic_recall_proof_at:
      stringValue(persistentEvidence.last_semantic_recall_proof_at) ??
      stringValue(fallbackEvidence.last_semantic_recall_proof_at),
    last_automatic_capture_at: stringValue(fallbackEvidence.last_automatic_capture_at),
    automatic_capture_source: stringValue(fallbackEvidence.automatic_capture_source),
    capture_freshness_hours: Math.max(
      persistent.capture_freshness_hours,
      fallback.capture_freshness_hours
    ),
    ingestion_approval_ref:
      stringValue(persistentEvidence.ingestion_approval_ref) ??
      stringValue(fallbackEvidence.ingestion_approval_ref)
  });
}
