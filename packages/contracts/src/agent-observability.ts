export const agentObservationContractVersion = 1 as const;

export const agentObservationKindValues = [
  "user_prompt",
  "assistant_response",
  "tool_call",
  "tool_result",
  "terminal_command",
  "terminal_output",
  "file_change",
  "test",
  "error",
  "retry",
  "remediation",
  "verification",
  "commit",
  "deploy",
  "closeout",
  "gap",
  "system"
] as const;

export type AgentObservationKind = (typeof agentObservationKindValues)[number];

export const agentObservationStatusValues = [
  "started",
  "success",
  "error",
  "cancelled",
  "skipped",
  "unknown"
] as const;

export type AgentObservationStatus = (typeof agentObservationStatusValues)[number];

export const agentObservationResolutionStatusValues = [
  "not_applicable",
  "unresolved",
  "retrying",
  "resolved",
  "unknown"
] as const;

export type AgentObservationResolutionStatus =
  (typeof agentObservationResolutionStatusValues)[number];

export const agentObservationCaptureProfileValues = [
  "light",
  "standard",
  "detailed",
  "custom"
] as const;

export type AgentObservationCaptureProfile = (typeof agentObservationCaptureProfileValues)[number];

export type AppendAgentObservationInput = {
  session_id: string;
  run_id?: string | null;
  turn_id?: string | null;
  trace_id?: string | null;
  parent_observation_id?: string | null;
  source_event_id?: string | null;
  dedup_key?: string | null;
  kind: AgentObservationKind;
  status?: AgentObservationStatus;
  occurred_at?: string | null;
  duration_ms?: number | null;
  title?: string | null;
  body?: string | null;
  tool_name?: string | null;
  error_code?: string | null;
  attempt_number?: number | null;
  resolution_status?: AgentObservationResolutionStatus;
  /** A short, explicitly supplied user-visible reason. Never hidden chain-of-thought. */
  rationale?: string | null;
  metadata?: Record<string, unknown> | null;
  capture_profile?: AgentObservationCaptureProfile | null;
  client_kind?: string | null;
  client_version?: string | null;
};

export type AgentObservationRecord = {
  id: string;
  project_id: string;
  developer_id: string;
  session_id: string;
  run_id: string;
  turn_id: string | null;
  trace_id: string;
  parent_observation_id: string | null;
  source_event_id: string | null;
  dedup_key: string | null;
  sequence_number: number;
  kind: AgentObservationKind;
  status: AgentObservationStatus;
  occurred_at: Date;
  duration_ms: number | null;
  title: string | null;
  body: string | null;
  tool_name: string | null;
  error_code: string | null;
  error_fingerprint: string | null;
  attempt_number: number | null;
  resolution_status: AgentObservationResolutionStatus;
  rationale: string | null;
  redacted_metadata: Record<string, unknown>;
  capture_profile: AgentObservationCaptureProfile;
  redacted: boolean;
  truncated: boolean;
  client_kind: string | null;
  client_version: string | null;
  created_at: Date;
};

export type AgentObservationCompleteness = {
  state: "empty" | "complete" | "incomplete";
  score: number;
  observation_count: number;
  sequence_gaps: Array<{ after: number; before: number; missing: number }>;
  unmatched_user_prompts: number;
  unmatched_tool_calls: number;
  unresolved_errors: number;
  redacted_observations: number;
  truncated_observations: number;
  coverage: Partial<Record<AgentObservationKind, number>>;
  client_coverage: Record<string, number>;
  unknown_client_observations: number;
};
