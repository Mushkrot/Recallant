export const codexOtelEventNameValues = [
  "codex.conversation_starts",
  "codex.api_request",
  "codex.sse_event",
  "codex.websocket_request",
  "codex.websocket_event",
  "codex.user_prompt",
  "codex.tool_decision",
  "codex.tool_result"
] as const;

export const codexOtelLogsEndpointPath = "/api/otel/v1/logs" as const;

export type CodexOtelEventName = (typeof codexOtelEventNameValues)[number];

export const otelControlMatchStatusValues = [
  "pending",
  "matched",
  "missing_hook",
  "conflict",
  "ignored"
] as const;

export type OtelControlMatchStatus = (typeof otelControlMatchStatusValues)[number];

export type CodexOtelControlEventInput = {
  event_name: CodexOtelEventName;
  conversation_id: string | null;
  call_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  occurred_at: string;
  observed_at: string;
  severity_number: number | null;
  success: boolean | null;
  duration_ms: number | null;
  attempt_number: number | null;
  tool_name: string | null;
  error_type: string | null;
  error_fingerprint: string | null;
  payload_hash: string;
  dedup_key: string;
  safe_attributes: Record<string, string | number | boolean>;
  dropped_attribute_count: number;
  content_discarded: boolean;
};

export type CodexOtelControlEventRecord = CodexOtelControlEventInput & {
  id: string;
  project_id: string;
  developer_id: string;
  matched_observation_id: string | null;
  match_status: OtelControlMatchStatus;
  match_reason: string | null;
  created_at: Date;
};

export type OtelControlCoverage = {
  configured: boolean;
  status: "not_configured" | "unobserved" | "healthy" | "gaps" | "stale";
  last_event_at: Date | null;
  event_count: number;
  matched_count: number;
  missing_hook_count: number;
  missing_otel_count: number;
  conflict_count: number;
  match_rate_percent: number | null;
  freshness_hours: number;
  next_actions: string[];
};

export type CodexOtelParseResult =
  | {
      ok: true;
      events: CodexOtelControlEventInput[];
      accepted_log_records: number;
      ignored_log_records: number;
    }
  | {
      ok: false;
      code: "invalid_json" | "invalid_payload" | "payload_too_large" | "too_many_records";
      message: string;
    };
