import { createHash, randomUUID } from "node:crypto";
import type {
  AgentObservationCaptureProfile,
  AgentObservationCompleteness,
  AgentObservationKind,
  AgentObservationRecord,
  AgentObservationResolutionStatus,
  AgentObservationStatus,
  AppendAgentObservationInput
} from "@recallant/contracts";

export const agentObservationPolicyVersion = 1 as const;

const profileBodyLimits: Record<AgentObservationCaptureProfile, number> = {
  light: 1_000,
  standard: 12_000,
  detailed: 50_000,
  custom: 12_000
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sensitiveKeyPattern =
  /(?:authorization|bearer|cookie|database[_-]?url|password|passwd|api[_-]?key|secret|token|credential|private[_-]?key)/i;
const privateKeyPattern =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const redactionPatterns: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_ACCESS_KEY]"],
  [
    /\b(password|passwd|api[_-]?key|secret|token|cookie|credential)\s*[:=]\s*['"]?[^'",\s;]{4,}/gi,
    "$1=[REDACTED]"
  ]
];

type RedactionResult<T> = { value: T; redacted: boolean; truncated: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundText(
  value: string | null | undefined,
  maxChars: number
): RedactionResult<string | null> {
  if (value == null) return { value: null, redacted: false, truncated: false };
  let safe = value.replace(privateKeyPattern, "[REDACTED_PRIVATE_KEY]");
  for (const [pattern, replacement] of redactionPatterns) safe = safe.replace(pattern, replacement);
  const redacted = safe !== value;
  if (safe.length <= maxChars) return { value: safe, redacted, truncated: false };
  return {
    value: `${safe.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`,
    redacted,
    truncated: true
  };
}

function redactValue(
  value: unknown,
  keyPath: string,
  depth = 0,
  state = { redacted: false, truncated: false }
): unknown {
  if (sensitiveKeyPattern.test(keyPath)) {
    state.redacted = true;
    return "[REDACTED]";
  }
  if (depth > 6) {
    state.truncated = true;
    return "[TRUNCATED_DEPTH]";
  }
  if (typeof value === "string") {
    const bounded = boundText(value, 1_000);
    state.redacted ||= bounded.redacted;
    state.truncated ||= bounded.truncated;
    return bounded.value;
  }
  if (Array.isArray(value)) {
    state.truncated ||= value.length > 50;
    return value
      .slice(0, 50)
      .map((item, index) => redactValue(item, `${keyPath}[${index}]`, depth + 1, state));
  }
  if (isPlainObject(value)) {
    state.truncated ||= Object.keys(value).length > 100;
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [key, redactValue(item, `${keyPath}.${key}`, depth + 1, state)])
    );
  }
  return value;
}

export function redactAgentObservationValue(value: unknown, keyPath = "value"): unknown {
  return redactValue(value, keyPath);
}

function boundMetadata(
  value: unknown,
  maxChars = 12_000
): RedactionResult<Record<string, unknown>> {
  const source = isPlainObject(value) ? value : {};
  const state = { redacted: false, truncated: false };
  const safe = redactValue(source, "metadata", 0, state) as Record<string, unknown>;
  const serialized = JSON.stringify(safe);
  if (serialized.length <= maxChars) {
    return { value: safe, redacted: state.redacted, truncated: state.truncated };
  }
  return {
    value: {
      truncated: true,
      preview: boundText(serialized, maxChars).value
    },
    redacted: state.redacted,
    truncated: true
  };
}

function defaultStatus(kind: AgentObservationKind): AgentObservationStatus {
  if (kind === "error") return "error";
  if (kind === "tool_call" || kind === "terminal_command" || kind === "deploy") return "started";
  return "success";
}

function defaultResolution(kind: AgentObservationKind): AgentObservationResolutionStatus {
  if (kind === "error") return "unresolved";
  if (kind === "retry" || kind === "remediation") return "retrying";
  return "not_applicable";
}

function nullableUuid(value: string | null | undefined, field: string): string | null {
  if (value == null) return null;
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function requiredUuid(value: string, field: string): string {
  const parsed = nullableUuid(value, field);
  if (!parsed) throw new Error(`${field} is required`);
  return parsed;
}

export type NormalizedAgentObservation = Omit<
  AppendAgentObservationInput,
  | "occurred_at"
  | "metadata"
  | "status"
  | "resolution_status"
  | "run_id"
  | "trace_id"
  | "capture_profile"
> & {
  run_id: string;
  trace_id: string;
  status: AgentObservationStatus;
  occurred_at: Date;
  resolution_status: AgentObservationResolutionStatus;
  redacted_metadata: Record<string, unknown>;
  capture_profile: AgentObservationCaptureProfile;
  error_fingerprint: string | null;
  redacted: boolean;
  truncated: boolean;
};

export function normalizeAgentObservation(
  input: AppendAgentObservationInput,
  options?: { capture_profile?: AgentObservationCaptureProfile; body_max_chars?: number }
): NormalizedAgentObservation {
  const profile = input.capture_profile ?? options?.capture_profile ?? "standard";
  const body = boundText(input.body, options?.body_max_chars ?? profileBodyLimits[profile]);
  const title = boundText(input.title, 240);
  const toolName = boundText(input.tool_name, 240);
  const errorCode = boundText(input.error_code, 160);
  const rationale = boundText(input.rationale, 2_000);
  const metadata = boundMetadata(input.metadata);
  const occurredAt = input.occurred_at ? new Date(input.occurred_at) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("occurred_at must be an ISO timestamp");
  const sessionId = requiredUuid(input.session_id, "session_id");
  const runId = requiredUuid(input.run_id ?? sessionId, "run_id");
  const traceId = requiredUuid(input.trace_id ?? randomUUID(), "trace_id");
  const fingerprintSeed = [input.kind, toolName.value, errorCode.value, body.value?.slice(0, 500)]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return {
    ...input,
    session_id: sessionId,
    run_id: runId,
    trace_id: traceId,
    turn_id: input.turn_id ?? null,
    parent_observation_id: nullableUuid(input.parent_observation_id, "parent_observation_id"),
    source_event_id: nullableUuid(input.source_event_id, "source_event_id"),
    dedup_key: boundText(input.dedup_key, 240).value,
    status: input.status ?? defaultStatus(input.kind),
    occurred_at: occurredAt,
    duration_ms:
      typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms)
        ? Math.max(0, Math.round(input.duration_ms))
        : null,
    title: title.value,
    body: body.value,
    tool_name: toolName.value,
    error_code: errorCode.value,
    error_fingerprint: fingerprintSeed
      ? createHash("sha256").update(fingerprintSeed).digest("hex")
      : null,
    attempt_number:
      typeof input.attempt_number === "number" && Number.isFinite(input.attempt_number)
        ? Math.max(1, Math.round(input.attempt_number))
        : null,
    resolution_status: input.resolution_status ?? defaultResolution(input.kind),
    rationale: rationale.value,
    redacted_metadata: metadata.value,
    capture_profile: profile,
    redacted:
      body.redacted ||
      title.redacted ||
      toolName.redacted ||
      errorCode.redacted ||
      rationale.redacted ||
      metadata.redacted,
    truncated:
      body.truncated ||
      title.truncated ||
      toolName.truncated ||
      errorCode.truncated ||
      rationale.truncated ||
      metadata.truncated
  };
}

export function analyzeAgentObservationCompleteness(
  observations: readonly AgentObservationRecord[]
): AgentObservationCompleteness {
  const sorted = [...observations].sort((a, b) => a.sequence_number - b.sequence_number);
  const sequenceGaps: AgentObservationCompleteness["sequence_gaps"] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && current.sequence_number > previous.sequence_number + 1) {
      sequenceGaps.push({
        after: previous.sequence_number,
        before: current.sequence_number,
        missing: current.sequence_number - previous.sequence_number - 1
      });
    }
  }

  const responsesByTurn = new Set(
    observations
      .filter((item) => item.kind === "assistant_response" && item.turn_id)
      .map((item) => item.turn_id)
  );
  const unmatchedUserPrompts = observations.filter(
    (item) => item.kind === "user_prompt" && (!item.turn_id || !responsesByTurn.has(item.turn_id))
  ).length;
  const toolResults = observations.filter((item) => item.kind === "tool_result");
  const unmatchedToolCalls = observations.filter(
    (call) =>
      call.kind === "tool_call" &&
      !toolResults.some(
        (result) =>
          result.parent_observation_id === call.id ||
          (result.trace_id === call.trace_id && result.id !== call.id)
      )
  ).length;
  const resolvedErrorIds = new Set(
    observations
      .filter((item) => item.resolution_status === "resolved" && item.parent_observation_id)
      .map((item) => item.parent_observation_id)
  );
  const resolvedTraceIds = new Set(
    observations
      .filter((item) => item.resolution_status === "resolved")
      .map((item) => item.trace_id)
  );
  const unresolvedErrors = observations.filter(
    (item) =>
      item.kind === "error" &&
      item.resolution_status !== "resolved" &&
      item.resolution_status !== "not_applicable" &&
      !resolvedErrorIds.has(item.id) &&
      !resolvedTraceIds.has(item.trace_id)
  ).length;
  const coverage: AgentObservationCompleteness["coverage"] = {};
  for (const item of observations) coverage[item.kind] = (coverage[item.kind] ?? 0) + 1;

  const deductions =
    Math.min(
      40,
      sequenceGaps.reduce((sum, gap) => sum + gap.missing * 10, 0)
    ) +
    Math.min(30, unmatchedUserPrompts * 10) +
    Math.min(20, unmatchedToolCalls * 5) +
    Math.min(30, unresolvedErrors * 10);
  const score = observations.length === 0 ? 0 : Math.max(0, 100 - deductions);
  const complete =
    observations.length > 0 &&
    sequenceGaps.length === 0 &&
    unmatchedUserPrompts === 0 &&
    unmatchedToolCalls === 0 &&
    unresolvedErrors === 0;

  return {
    state: observations.length === 0 ? "empty" : complete ? "complete" : "incomplete",
    score,
    observation_count: observations.length,
    sequence_gaps: sequenceGaps,
    unmatched_user_prompts: unmatchedUserPrompts,
    unmatched_tool_calls: unmatchedToolCalls,
    unresolved_errors: unresolvedErrors,
    redacted_observations: observations.filter((item) => item.redacted).length,
    truncated_observations: observations.filter((item) => item.truncated).length,
    coverage
  };
}
