import type {
  AgentObservationRecord,
  AgentObservationResolutionStatus,
  AgentObservationStatus
} from "@recallant/contracts";
import type { NormalizedAgentObservation } from "@recallant/core";
import type { PoolClient } from "pg";

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

export const agentObservationSchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS agent_observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      run_id UUID NOT NULL,
      turn_id TEXT,
      trace_id UUID NOT NULL DEFAULT gen_random_uuid(),
      parent_observation_id UUID REFERENCES agent_observations(id) ON DELETE SET NULL,
      source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
      dedup_key TEXT,
      sequence_number BIGINT NOT NULL,
      run_sequence_number BIGINT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
      title TEXT,
      body TEXT,
      tool_name TEXT,
      error_code TEXT,
      error_fingerprint TEXT,
      attempt_number INT CHECK (attempt_number IS NULL OR attempt_number >= 1),
      resolution_status TEXT NOT NULL DEFAULT 'not_applicable',
      rationale TEXT,
      redacted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      capture_profile TEXT NOT NULL DEFAULT 'standard',
      redacted BOOLEAN NOT NULL DEFAULT false,
      truncated BOOLEAN NOT NULL DEFAULT false,
      client_kind TEXT,
      client_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind IN (
        'user_prompt', 'assistant_response', 'tool_call', 'tool_result',
        'terminal_command', 'terminal_output', 'file_change', 'test', 'error',
        'retry', 'remediation', 'verification', 'commit', 'deploy', 'closeout',
        'gap', 'system'
      )),
      CHECK (status IN ('started', 'success', 'error', 'cancelled', 'skipped', 'unknown')),
      CHECK (resolution_status IN (
        'not_applicable', 'unresolved', 'retrying', 'resolved', 'unknown'
      )),
      CHECK (capture_profile IN ('light', 'standard', 'detailed', 'custom')),
      UNIQUE (session_id, sequence_number)
    )
  `,
  "ALTER TABLE agent_observations ADD COLUMN IF NOT EXISTS run_sequence_number BIGINT",
  `
    WITH numbered AS (
      SELECT id, row_number() OVER (
        PARTITION BY run_id ORDER BY sequence_number ASC, occurred_at ASC, id ASC
      ) AS run_sequence_number
      FROM agent_observations
      WHERE run_sequence_number IS NULL
    )
    UPDATE agent_observations observations
    SET run_sequence_number = numbered.run_sequence_number
    FROM numbered
    WHERE observations.id = numbered.id
  `,
  "ALTER TABLE agent_observations ALTER COLUMN run_sequence_number SET NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_observations_project_dedup ON agent_observations (project_id, dedup_key) WHERE dedup_key IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_project_time ON agent_observations (project_id, occurred_at DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_observations_run_position ON agent_observations (run_id, run_sequence_number)",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_session_sequence ON agent_observations (session_id, sequence_number)",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_trace ON agent_observations (trace_id)",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_parent ON agent_observations (parent_observation_id) WHERE parent_observation_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_errors ON agent_observations (project_id, resolution_status, occurred_at DESC) WHERE kind = 'error'",
  "CREATE INDEX IF NOT EXISTS idx_agent_observations_error_fingerprint ON agent_observations (project_id, error_fingerprint, occurred_at DESC) WHERE error_fingerprint IS NOT NULL"
];

export async function ensureAgentObservationSchema(client: Queryable) {
  for (const statement of agentObservationSchemaStatements) await client.query(statement);
}

function mapAgentObservation(row: Record<string, unknown>): AgentObservationRecord {
  return {
    ...(row as Omit<AgentObservationRecord, "sequence_number" | "run_sequence_number">),
    sequence_number: Number(row.sequence_number),
    run_sequence_number: Number(row.run_sequence_number ?? row.sequence_number),
    status: row.status as AgentObservationStatus,
    resolution_status: row.resolution_status as AgentObservationResolutionStatus,
    redacted_metadata:
      row.redacted_metadata && typeof row.redacted_metadata === "object"
        ? (row.redacted_metadata as Record<string, unknown>)
        : {}
  } as AgentObservationRecord;
}

export async function storeAgentObservation(
  client: PoolClient,
  input: NormalizedAgentObservation & { project_id: string; developer_id: string },
  retentionDays: number
): Promise<AgentObservationRecord> {
  if (input.dedup_key) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${input.project_id}:${input.dedup_key}`
    ]);
    const duplicate = await client.query(
      "SELECT * FROM agent_observations WHERE project_id = $1 AND dedup_key = $2",
      [input.project_id, input.dedup_key]
    );
    if (duplicate.rows[0]) return mapAgentObservation(duplicate.rows[0]);
  }

  if (input.parent_observation_id) {
    const parent = await client.query<{ project_id: string; session_id: string }>(
      "SELECT project_id::text, session_id::text FROM agent_observations WHERE id = $1",
      [input.parent_observation_id]
    );
    if (!parent.rows[0]) throw new Error("Unknown parent_observation_id");
    if (
      parent.rows[0].project_id !== input.project_id ||
      parent.rows[0].session_id !== input.session_id
    ) {
      throw new Error("parent_observation_id must belong to the same project and session");
    }
  }

  for (const lockKey of Array.from(new Set([input.session_id, input.run_id])).sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
  }
  const sequence = await client.query<{ next_sequence: string }>(
    `
      SELECT (coalesce(max(sequence_number), 0) + 1)::text AS next_sequence
      FROM agent_observations
      WHERE session_id = $1
    `,
    [input.session_id]
  );
  const nextSequence = Number(sequence.rows[0]?.next_sequence ?? "1");
  const runSequence = await client.query<{ next_sequence: string }>(
    `
      SELECT (coalesce(max(run_sequence_number), 0) + 1)::text AS next_sequence
      FROM agent_observations
      WHERE run_id = $1
    `,
    [input.run_id]
  );
  const nextRunSequence = Number(runSequence.rows[0]?.next_sequence ?? "1");
  const inserted = await client.query(
    `
      INSERT INTO agent_observations (
        project_id, developer_id, session_id, run_id, turn_id, trace_id,
        parent_observation_id, source_event_id, dedup_key, sequence_number, run_sequence_number,
        kind, status, occurred_at, duration_ms, title, body, tool_name, error_code,
        error_fingerprint, attempt_number, resolution_status, rationale,
        redacted_metadata, capture_profile, redacted, truncated, client_kind, client_version
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29
      )
      RETURNING *
    `,
    [
      input.project_id,
      input.developer_id,
      input.session_id,
      input.run_id,
      input.turn_id,
      input.trace_id,
      input.parent_observation_id,
      input.source_event_id,
      input.dedup_key,
      nextSequence,
      nextRunSequence,
      input.kind,
      input.status,
      input.occurred_at,
      input.duration_ms,
      input.title,
      input.body,
      input.tool_name,
      input.error_code,
      input.error_fingerprint,
      input.attempt_number,
      input.resolution_status,
      input.rationale,
      JSON.stringify(input.redacted_metadata),
      input.capture_profile,
      input.redacted,
      input.truncated,
      input.client_kind,
      input.client_version
    ]
  );
  await client.query(
    `
      DELETE FROM agent_observations
      WHERE project_id = $1
        AND occurred_at < now() - make_interval(days => $2::int)
    `,
    [input.project_id, retentionDays]
  );
  return mapAgentObservation(inserted.rows[0] as Record<string, unknown>);
}

export async function listStoredAgentObservations(
  client: PoolClient,
  input: {
    project_id: string;
    session_id?: string | null;
    run_id?: string | null;
    limit: number;
  }
): Promise<AgentObservationRecord[]> {
  const result = await client.query(
    `
      SELECT *
      FROM agent_observations
      WHERE project_id = $1
        AND ($2::uuid IS NULL OR session_id = $2::uuid)
        AND ($3::uuid IS NULL OR run_id = $3::uuid)
      ORDER BY occurred_at DESC, sequence_number DESC
      LIMIT $4
    `,
    [input.project_id, input.session_id ?? null, input.run_id ?? null, input.limit]
  );
  return result.rows.map((row) => mapAgentObservation(row));
}
