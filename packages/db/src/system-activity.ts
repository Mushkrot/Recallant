import { randomUUID } from "node:crypto";

export type SystemActivityStatus = "started" | "success" | "error" | "cancelled" | "skipped";

export type SystemActivityInput = {
  trace_id?: string | null;
  parent_trace_id?: string | null;
  developer_id?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  surface: string;
  operation: string;
  actor_kind?: string | null;
  actor_id?: string | null;
  client_kind?: string | null;
  client_version?: string | null;
  related_ids?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type FinishSystemActivityInput = {
  id: string;
  status: Exclude<SystemActivityStatus, "started">;
  developer_id?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  related_ids?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ResolveSystemActivityScopeInput = {
  developer_id?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  project_path?: string | null;
};

export type ResolvedSystemActivityScope = {
  developer_id: string | null;
  project_id: string | null;
  session_id: string | null;
  resolved_by: "session_id" | "project_id" | "project_path" | "not_found";
};

export type SystemActivityRecord = {
  id: string;
  trace_id: string;
  parent_trace_id: string | null;
  developer_id: string | null;
  project_id: string | null;
  session_id: string | null;
  surface: string;
  operation: string;
  actor_kind: string;
  actor_id: string | null;
  client_kind: string | null;
  client_version: string | null;
  status: SystemActivityStatus;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  related_ids: Record<string, unknown>;
  redacted_metadata: Record<string, unknown>;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

const sensitiveKeyPattern =
  /(?:authorization|bearer|cookie|database[_-]?url|password|passwd|api[_-]?key|secret|token|credential|private[_-]?key)/i;
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const redactionPatterns: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/\b(?:postgres|postgresql):\/\/[^\s"'<>]+/gi, "postgres://[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_TOKEN]"],
  [
    /\b(password|passwd|api[_-]?key|secret|token|cookie)\s*[:=]\s*['"]?[^'",\s;]{4,}/gi,
    "$1=[REDACTED]"
  ]
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactString(value: string) {
  if (/^(\/|~\/|[a-z]:\\)/i.test(value)) {
    return "[REDACTED_PATH]";
  }
  let redacted = value.replace(uuidPattern, "[REDACTED_UUID]");
  for (const [pattern, replacement] of redactionPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactSystemActivityValue(value: unknown, keyPath = "value"): unknown {
  if (sensitiveKeyPattern.test(keyPath)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSystemActivityValue(item, `${keyPath}[${index}]`));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactSystemActivityValue(item, `${keyPath}.${key}`)
      ])
    );
  }
  return value;
}

export function redactedSystemActivityObject(value: unknown): Record<string, unknown> {
  const redacted = redactSystemActivityValue(value);
  return isPlainObject(redacted) ? redacted : { value: redacted };
}

export function normalizeSystemActivityStart(input: SystemActivityInput) {
  return {
    trace_id: input.trace_id ?? randomUUID(),
    parent_trace_id: input.parent_trace_id ?? null,
    developer_id: input.developer_id ?? null,
    project_id: input.project_id ?? null,
    session_id: input.session_id ?? null,
    surface: input.surface,
    operation: input.operation,
    actor_kind: input.actor_kind ?? "system",
    actor_id: input.actor_id ?? null,
    client_kind: input.client_kind ?? null,
    client_version: input.client_version ?? null,
    related_ids: redactedSystemActivityObject(input.related_ids ?? {}),
    redacted_metadata: redactedSystemActivityObject(input.metadata ?? {})
  };
}

export function normalizeSystemActivityFinish(input: FinishSystemActivityInput) {
  return {
    ...input,
    error_message:
      typeof input.error_message === "string" ? redactString(input.error_message) : null,
    related_ids: redactedSystemActivityObject(input.related_ids ?? {}),
    redacted_metadata: redactedSystemActivityObject(input.metadata ?? {})
  };
}

// Keep this DDL idempotent: fresh installs get the same table from 0001_initial.sql, while
// existing self-hosted deployments can safely call ensureSystemActivitySchema before first write.
export const systemActivitySchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS system_activity_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID NOT NULL DEFAULT gen_random_uuid(),
      parent_trace_id UUID,
      developer_id UUID REFERENCES developers(id) ON DELETE SET NULL,
      project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      surface TEXT NOT NULL,
      operation TEXT NOT NULL,
      actor_kind TEXT NOT NULL DEFAULT 'system',
      actor_id TEXT,
      client_kind TEXT,
      client_version TEXT,
      status TEXT NOT NULL DEFAULT 'started',
      duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
      error_code TEXT,
      error_message TEXT,
      related_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
      redacted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IN ('started', 'success', 'error', 'cancelled', 'skipped'))
    )
  `,
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS trace_id UUID NOT NULL DEFAULT gen_random_uuid()",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS parent_trace_id UUID",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS developer_id UUID REFERENCES developers(id) ON DELETE SET NULL",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'system'",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'unknown'",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS actor_kind TEXT NOT NULL DEFAULT 'system'",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS actor_id TEXT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS client_kind TEXT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS client_version TEXT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'started'",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS duration_ms INT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS error_code TEXT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS error_message TEXT",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS related_ids JSONB NOT NULL DEFAULT '{}'::jsonb",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS redacted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  "ALTER TABLE system_activity_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  "CREATE INDEX IF NOT EXISTS idx_system_activity_project_time ON system_activity_events (project_id, started_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_system_activity_trace ON system_activity_events (trace_id)",
  "CREATE INDEX IF NOT EXISTS idx_system_activity_parent_trace ON system_activity_events (parent_trace_id) WHERE parent_trace_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_system_activity_surface_status_time ON system_activity_events (surface, status, started_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_system_activity_error_time ON system_activity_events (error_code, started_at DESC) WHERE error_code IS NOT NULL"
];

export async function ensureSystemActivitySchema(client: Queryable) {
  for (const statement of systemActivitySchemaStatements) {
    await client.query(statement);
  }
}
