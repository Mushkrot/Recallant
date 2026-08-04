import type {
  AgentObservationRecord,
  CodexOtelControlEventInput,
  CodexOtelControlEventRecord,
  OtelControlCoverage,
  OtelControlMatchStatus
} from "@recallant/contracts";
import type { PoolClient } from "pg";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<unknown> };

export const agentTelemetrySchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS project_otel_control_settings (
      project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT true,
      protocol TEXT NOT NULL DEFAULT 'otlp_http_json' CHECK (protocol = 'otlp_http_json'),
      client_id TEXT NOT NULL,
      endpoint_path TEXT NOT NULL DEFAULT '/api/otel/v1/logs',
      configured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_otel_control_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      conversation_id TEXT,
      call_id TEXT,
      trace_id TEXT,
      span_id TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      severity_number INT,
      success BOOLEAN,
      duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
      attempt_number INT CHECK (attempt_number IS NULL OR attempt_number >= 1),
      tool_name TEXT,
      error_type TEXT,
      error_fingerprint TEXT,
      payload_hash TEXT NOT NULL,
      dedup_key TEXT NOT NULL,
      safe_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      dropped_attribute_count INT NOT NULL DEFAULT 0,
      content_discarded BOOLEAN NOT NULL DEFAULT false,
      matched_observation_id UUID REFERENCES agent_observations(id) ON DELETE SET NULL,
      match_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        match_status IN ('pending', 'matched', 'missing_hook', 'conflict', 'ignored')
      ),
      match_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, dedup_key)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_agent_otel_control_project_time ON agent_otel_control_events (project_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_agent_otel_control_conversation ON agent_otel_control_events (project_id, conversation_id, occurred_at DESC) WHERE conversation_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_agent_otel_control_call ON agent_otel_control_events (project_id, call_id, occurred_at DESC) WHERE call_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_agent_otel_control_match ON agent_otel_control_events (project_id, match_status, occurred_at DESC)"
];

export async function ensureAgentTelemetrySchema(client: Queryable) {
  for (const statement of agentTelemetrySchemaStatements) await client.query(statement);
}

function mapControlEvent(row: Record<string, unknown>): CodexOtelControlEventRecord {
  return {
    ...(row as unknown as CodexOtelControlEventRecord),
    severity_number: row.severity_number == null ? null : Number(row.severity_number),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    attempt_number: row.attempt_number == null ? null : Number(row.attempt_number),
    dropped_attribute_count: Number(row.dropped_attribute_count ?? 0),
    safe_attributes:
      row.safe_attributes && typeof row.safe_attributes === "object"
        ? (row.safe_attributes as Record<string, string | number | boolean>)
        : {},
    match_status: row.match_status as OtelControlMatchStatus
  };
}

type Match = { observationId: string | null; status: OtelControlMatchStatus; reason: string };

function expectedHookKind(event: CodexOtelControlEventInput) {
  if (event.event_name === "codex.conversation_starts") return "system";
  if (event.event_name === "codex.user_prompt") return "user_prompt";
  if (event.event_name === "codex.tool_decision") return "tool_call";
  if (event.event_name === "codex.tool_result") return "tool_result";
  return null;
}

async function matchControlEvent(
  client: PoolClient,
  projectId: string,
  event: CodexOtelControlEventInput
): Promise<Match> {
  const kind = expectedHookKind(event);
  if (!kind) {
    return {
      observationId: null,
      status: "ignored",
      reason: "control-only Codex event has no native hook counterpart"
    };
  }
  if (!event.conversation_id) {
    return {
      observationId: null,
      status: "missing_hook",
      reason: "Codex conversation identifier is missing"
    };
  }
  const result = await client.query<AgentObservationRecord>(
    `
      SELECT * FROM agent_observations
      WHERE project_id = $1
        AND kind = $2
        AND redacted_metadata->>'external_session_id' = $3
        AND ($4::text IS NULL OR redacted_metadata->>'external_tool_use_id' = $4)
        AND occurred_at BETWEEN $5::timestamptz - interval '15 minutes'
                            AND $5::timestamptz + interval '15 minutes'
      ORDER BY
        CASE WHEN $4::text IS NOT NULL AND redacted_metadata->>'external_tool_use_id' = $4
             THEN 0 ELSE 1 END,
        abs(extract(epoch FROM (occurred_at - $5::timestamptz))) ASC
      LIMIT 1
    `,
    [projectId, kind, event.conversation_id, event.call_id, event.occurred_at]
  );
  const observation = result.rows[0];
  if (!observation) {
    return {
      observationId: null,
      status: "missing_hook",
      reason: "no corresponding native hook observation was found"
    };
  }
  if (event.tool_name && observation.tool_name && event.tool_name !== observation.tool_name) {
    return {
      observationId: observation.id,
      status: "conflict",
      reason: "OTel and native hook tool names differ"
    };
  }
  const hookSuccess = observation.status === "success";
  if (event.success !== null && event.success !== hookSuccess) {
    return {
      observationId: observation.id,
      status: "conflict",
      reason: "OTel and native hook success states differ"
    };
  }
  return {
    observationId: observation.id,
    status: "matched",
    reason: event.call_id
      ? "conversation and tool call identifiers matched"
      : "conversation identifier and event semantics matched"
  };
}

export async function storeCodexOtelControlEvents(
  client: PoolClient,
  input: {
    project_id: string;
    developer_id: string;
    events: readonly CodexOtelControlEventInput[];
    retention_days: number;
  }
): Promise<CodexOtelControlEventRecord[]> {
  const stored: CodexOtelControlEventRecord[] = [];
  for (const event of input.events) {
    const match = await matchControlEvent(client, input.project_id, event);
    const result = await client.query(
      `
        INSERT INTO agent_otel_control_events (
          project_id, developer_id, event_name, conversation_id, call_id, trace_id, span_id,
          occurred_at, observed_at, severity_number, success, duration_ms, attempt_number,
          tool_name, error_type, error_fingerprint, payload_hash, dedup_key, safe_attributes,
          dropped_attribute_count, content_discarded, matched_observation_id, match_status,
          match_reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24
        )
        ON CONFLICT (project_id, dedup_key) DO UPDATE SET
          matched_observation_id = coalesce(
            EXCLUDED.matched_observation_id,
            agent_otel_control_events.matched_observation_id
          ),
          match_status = CASE
            WHEN EXCLUDED.match_status IN ('matched', 'conflict') THEN EXCLUDED.match_status
            ELSE agent_otel_control_events.match_status
          END,
          match_reason = CASE
            WHEN EXCLUDED.match_status IN ('matched', 'conflict') THEN EXCLUDED.match_reason
            ELSE agent_otel_control_events.match_reason
          END
        RETURNING *
      `,
      [
        input.project_id,
        input.developer_id,
        event.event_name,
        event.conversation_id,
        event.call_id,
        event.trace_id,
        event.span_id,
        event.occurred_at,
        event.observed_at,
        event.severity_number,
        event.success,
        event.duration_ms,
        event.attempt_number,
        event.tool_name,
        event.error_type,
        event.error_fingerprint,
        event.payload_hash,
        event.dedup_key,
        JSON.stringify(event.safe_attributes),
        event.dropped_attribute_count,
        event.content_discarded,
        match.observationId,
        match.status,
        match.reason
      ]
    );
    stored.push(mapControlEvent(result.rows[0] as Record<string, unknown>));
  }
  await client.query(
    `DELETE FROM agent_otel_control_events
     WHERE project_id = $1 AND occurred_at < now() - make_interval(days => $2::int)`,
    [input.project_id, input.retention_days]
  );
  return stored;
}

export async function reconcileControlEventsForObservation(
  client: PoolClient,
  observation: AgentObservationRecord
) {
  const externalSessionId = observation.redacted_metadata.external_session_id;
  if (typeof externalSessionId !== "string") return;
  const candidates = await client.query(
    `
      SELECT * FROM agent_otel_control_events
      WHERE project_id = $1
        AND conversation_id = $2
        AND match_status = 'missing_hook'
        AND occurred_at BETWEEN $3::timestamptz - interval '15 minutes'
                            AND $3::timestamptz + interval '15 minutes'
      ORDER BY occurred_at ASC LIMIT 100
    `,
    [observation.project_id, externalSessionId, observation.occurred_at]
  );
  for (const row of candidates.rows) {
    const event = mapControlEvent(row as Record<string, unknown>);
    const match = await matchControlEvent(client, observation.project_id, event);
    if (match.status !== "matched" && match.status !== "conflict") continue;
    await client.query(
      `UPDATE agent_otel_control_events
       SET matched_observation_id = $2, match_status = $3, match_reason = $4 WHERE id = $1`,
      [event.id, match.observationId, match.status, match.reason]
    );
  }
}

export async function configureProjectOtelControl(
  client: PoolClient,
  input: { project_id: string; developer_id: string; client_id: string }
) {
  const result = await client.query(
    `
      INSERT INTO project_otel_control_settings (project_id, developer_id, enabled, client_id)
      VALUES ($1, $2, true, $3)
      ON CONFLICT (project_id) DO UPDATE SET
        developer_id = EXCLUDED.developer_id,
        enabled = true,
        client_id = EXCLUDED.client_id,
        updated_at = now()
      RETURNING *
    `,
    [input.project_id, input.developer_id, input.client_id]
  );
  return result.rows[0] as Record<string, unknown>;
}

export async function readOtelControlCoverage(
  client: PoolClient,
  input: { project_id: string; freshness_hours: number }
): Promise<OtelControlCoverage> {
  const result = await client.query<{
    configured: boolean;
    last_event_at: Date | null;
    event_count: number;
    matched_count: number;
    missing_hook_count: number;
    conflict_count: number;
    missing_otel_count: number;
  }>(
    `
      SELECT
        EXISTS (SELECT 1 FROM project_otel_control_settings
                WHERE project_id = $1 AND enabled = true) AS configured,
        (SELECT max(occurred_at) FROM agent_otel_control_events WHERE project_id = $1) AS last_event_at,
        (SELECT count(*)::int FROM agent_otel_control_events WHERE project_id = $1) AS event_count,
        (SELECT count(*)::int FROM agent_otel_control_events
         WHERE project_id = $1 AND match_status = 'matched') AS matched_count,
        (SELECT count(*)::int FROM agent_otel_control_events
         WHERE project_id = $1 AND match_status = 'missing_hook') AS missing_hook_count,
        (SELECT count(*)::int FROM agent_otel_control_events
         WHERE project_id = $1 AND match_status = 'conflict') AS conflict_count,
        (
          SELECT count(*)::int FROM agent_observations observation
          WHERE observation.project_id = $1
            AND observation.redacted_metadata->>'adapter' = 'codex_native_hook'
            AND observation.redacted_metadata->>'hook_event_name' IN (
              'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'
            )
            AND NOT EXISTS (
              SELECT 1 FROM agent_otel_control_events control
              WHERE control.project_id = observation.project_id
                AND control.matched_observation_id = observation.id
            )
        ) AS missing_otel_count
    `,
    [input.project_id]
  );
  const row = result.rows[0];
  const configured = Boolean(row?.configured);
  const lastEventAt = row?.last_event_at ?? null;
  const eventCount = Number(row?.event_count ?? 0);
  const matchedCount = Number(row?.matched_count ?? 0);
  const missingHookCount = Number(row?.missing_hook_count ?? 0);
  const missingOtelCount = Number(row?.missing_otel_count ?? 0);
  const conflictCount = Number(row?.conflict_count ?? 0);
  const stale =
    lastEventAt !== null &&
    Date.now() - lastEventAt.getTime() > input.freshness_hours * 60 * 60 * 1_000;
  const status: OtelControlCoverage["status"] = !configured
    ? "not_configured"
    : eventCount === 0
      ? "unobserved"
      : stale
        ? "stale"
        : missingHookCount + missingOtelCount + conflictCount > 0
          ? "gaps"
          : "healthy";
  const comparable = matchedCount + missingHookCount + conflictCount;
  const nextActions: string[] = [];
  if (!configured) nextActions.push("Generate the Codex OpenTelemetry user-profile fragment.");
  else if (eventCount === 0)
    nextActions.push("Start a new Codex run and check that OTLP logs arrive.");
  if (missingHookCount > 0)
    nextActions.push("Inspect native hook gaps for OTel-observed activity.");
  if (missingOtelCount > 0) nextActions.push("Inspect OTel export gaps for native-hook activity.");
  if (conflictCount > 0) nextActions.push("Review events where the two evidence lanes disagree.");
  if (stale) nextActions.push("Run a fresh Codex canary; the last control event is stale.");
  if (nextActions.length === 0) nextActions.push("The independent evidence lanes agree.");
  return {
    configured,
    status,
    last_event_at: lastEventAt,
    event_count: eventCount,
    matched_count: matchedCount,
    missing_hook_count: missingHookCount,
    missing_otel_count: missingOtelCount,
    conflict_count: conflictCount,
    match_rate_percent: comparable > 0 ? Math.round((matchedCount / comparable) * 100) : null,
    freshness_hours: input.freshness_hours,
    next_actions: nextActions
  };
}
