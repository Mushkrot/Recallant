BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  parent_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  project_kind TEXT NOT NULL DEFAULT 'repo' CHECK (project_kind IN ('repo', 'subproject', 'workspace', 'personal_domain', 'other')),
  memory_domain TEXT NOT NULL DEFAULT 'agent_work',
  name TEXT NOT NULL,
  primary_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_kind TEXT NOT NULL,
  client_version TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ,
  heartbeat_status TEXT,
  heartbeat_metadata JSONB,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'interrupted', 'recovered')),
  ended_reason TEXT CHECK (ended_reason IN ('closeout', 'client_exit', 'timeout', 'crash_or_unknown', 'superseded')),
  recovered_from_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  ingest_source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'turn_user',
      'turn_assistant',
      'tool_call',
      'tool_result',
      'terminal_output',
      'file_change',
      'system',
      'import_batch',
      'checkpoint',
      'other'
    )
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE raw_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN ('tool_output', 'terminal_output', 'attachment', 'transcript_export', 'media', 'other')
  ),
  storage_backend TEXT NOT NULL CHECK (
    storage_backend IN ('local_spool', 'server_filesystem', 'postgres_inline', 'object_storage', 'external')
  ),
  uri TEXT NOT NULL,
  sha256 TEXT,
  size_bytes BIGINT,
  content_type TEXT,
  excerpt TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  source_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  chunk_index INT NOT NULL,
  token_count_est INT,
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'developer')),
  scope_kind TEXT,
  scope_id TEXT,
  audience JSONB,
  embed_status TEXT NOT NULL DEFAULT 'pending' CHECK (embed_status IN ('pending', 'embedded', 'failed')),
  embed_model TEXT,
  last_accessed_at TIMESTAMPTZ,
  access_count INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, chunk_index)
);

CREATE TABLE embeddings (
  chunk_id UUID PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dims INT NOT NULL,
  vector vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  src_kind TEXT NOT NULL CHECK (src_kind IN ('chunk', 'event', 'external')),
  src_id TEXT NOT NULL,
  dst_kind TEXT NOT NULL CHECK (dst_kind IN ('chunk', 'event', 'external')),
  dst_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (src_kind <> dst_kind OR src_id <> dst_id)
);

CREATE TABLE checkpoints (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  memory_domain TEXT NOT NULL DEFAULT 'agent_work',
  scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'developer')),
  scope_kind TEXT,
  scope_id TEXT,
  audience JSONB,
  memory_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (
    status IN ('candidate', 'accepted', 'rejected', 'archived', 'superseded', 'stale', 'needs_review')
  ),
  use_policy TEXT NOT NULL DEFAULT 'evidence_only' CHECK (
    use_policy IN ('evidence_only', 'recall_allowed', 'instruction_grade', 'do_not_use')
  ),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  created_by TEXT NOT NULL CHECK (created_by IN ('agent', 'user', 'system', 'import')),
  accepted_by TEXT,
  rejected_by TEXT,
  review_reason TEXT,
  supersedes UUID REFERENCES agent_memories(id) ON DELETE SET NULL,
  superseded_by UUID REFERENCES agent_memories(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scope <> 'project' OR project_id IS NOT NULL),
  CHECK (
    use_policy <> 'instruction_grade'
    OR (status = 'accepted' AND created_by IN ('user', 'import', 'system'))
  )
);

CREATE TABLE agent_memory_source_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('event', 'chunk', 'raw_artifact', 'edge', 'checkpoint', 'external')),
  source_id TEXT NOT NULL,
  quote TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_memory_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  actor_id TEXT,
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recall_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  query TEXT,
  returned_chunk_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  returned_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  used_chunk_ids JSONB,
  used_memory_ids JSONB,
  ignored_memory_ids JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingest_dedup_keys (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dedup_key TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, dedup_key)
);

CREATE TABLE erasure_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL,
  request_source TEXT NOT NULL CHECK (request_source IN ('ui', 'cli', 'chat', 'mcp', 'system')),
  target_selector JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (
    status IN ('pending_confirmation', 'confirmed', 'running', 'completed', 'failed', 'cancelled')
  ),
  requires_confirmation BOOLEAN NOT NULL DEFAULT true,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  redacted_receipt JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paid_api_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  routing_reason TEXT NOT NULL,
  attempted_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_tokens_estimate INT,
  output_tokens_estimate INT,
  cost_estimate_usd NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  requested_by TEXT NOT NULL CHECK (requested_by IN ('agent', 'system', 'user')),
  decided_by TEXT,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE model_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID REFERENCES developers(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  memory_domain TEXT,
  route_class TEXT NOT NULL CHECK (
    route_class IN ('local_model', 'active_agent', 'subscription_worker', 'paid_api_provider')
  ),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  routing_reason TEXT NOT NULL,
  limit_status TEXT,
  confirmation_status TEXT CHECK (
    confirmation_status IS NULL
    OR confirmation_status IN ('not_required', 'required_pending', 'approved', 'denied')
  ),
  approval_request_id UUID REFERENCES paid_api_approval_requests(id) ON DELETE SET NULL,
  input_tokens INT,
  output_tokens INT,
  cost_estimate_usd NUMERIC,
  cost_actual_usd NUMERIC,
  latency_ms INT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'cancelled')),
  error_code TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  value_schema_version INT NOT NULL DEFAULT 1,
  is_secret_ref BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE developer_settings (
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  value_schema_version INT NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (developer_id, key)
);

CREATE TABLE project_settings (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  value_schema_version INT NOT NULL DEFAULT 1,
  applies_to TEXT NOT NULL DEFAULT 'future_only' CHECK (applies_to IN ('future_only', 'immediate', 'requires_reprocess')),
  reason TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key)
);

CREATE TABLE session_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_adapter_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  client_kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('system', 'developer', 'project', 'session', 'client_adapter')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  actor_id TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_developer_parent ON projects (developer_id, parent_project_id);
CREATE INDEX idx_projects_developer_domain_kind ON projects (developer_id, memory_domain, project_kind);

CREATE INDEX idx_sessions_project_status_seen ON sessions (project_id, status, last_seen_at DESC);

CREATE INDEX idx_events_project_occurred ON events (project_id, occurred_at DESC);
CREATE INDEX idx_events_payload_hash ON events (project_id, payload_hash) WHERE payload_hash IS NOT NULL;

CREATE INDEX idx_raw_artifacts_project_created ON raw_artifacts (project_id, created_at DESC);
CREATE INDEX idx_raw_artifacts_source_event ON raw_artifacts (source_event_id);
CREATE INDEX idx_raw_artifacts_sha256 ON raw_artifacts (sha256) WHERE sha256 IS NOT NULL;

CREATE INDEX idx_chunks_project ON chunks (project_id);
CREATE INDEX idx_chunks_tsv ON chunks USING GIN (tsv);
CREATE INDEX idx_chunks_developer_scope ON chunks (developer_id, scope);
CREATE INDEX idx_chunks_cleanup ON chunks (project_id, last_accessed_at, archived_at);
CREATE INDEX idx_chunks_scope_kind ON chunks (scope_kind, scope_id) WHERE scope_kind IS NOT NULL;

CREATE INDEX idx_edges_src ON edges (project_id, src_kind, src_id);
CREATE INDEX idx_edges_dst ON edges (project_id, dst_kind, dst_id);

CREATE INDEX idx_agent_memories_project_policy ON agent_memories (project_id, status, use_policy, updated_at DESC);
CREATE INDEX idx_agent_memories_developer_scope ON agent_memories (developer_id, scope, status, use_policy);
CREATE INDEX idx_agent_memories_scope_kind ON agent_memories (scope_kind, scope_id) WHERE scope_kind IS NOT NULL;

CREATE INDEX idx_agent_memory_source_refs_memory ON agent_memory_source_refs (memory_id);
CREATE INDEX idx_agent_memory_source_refs_source ON agent_memory_source_refs (source_kind, source_id);
CREATE INDEX idx_agent_memory_review_actions_memory ON agent_memory_review_actions (memory_id, created_at DESC);

CREATE INDEX idx_recall_traces_project_created ON recall_traces (project_id, created_at DESC);
CREATE INDEX idx_model_calls_created ON model_calls (created_at DESC);
CREATE INDEX idx_model_calls_project_created ON model_calls (project_id, created_at DESC);
CREATE INDEX idx_model_calls_route ON model_calls (route_class, provider, model, purpose, created_at DESC);

CREATE INDEX idx_paid_api_approval_status ON paid_api_approval_requests (status, created_at DESC);
CREATE INDEX idx_paid_api_approval_project_status ON paid_api_approval_requests (project_id, status, created_at DESC);
CREATE INDEX idx_paid_api_approval_provider ON paid_api_approval_requests (provider, model, purpose, created_at DESC);

CREATE INDEX idx_session_overrides_session_key ON session_overrides (session_id, key, cleared_at);
CREATE UNIQUE INDEX idx_client_adapter_settings_unique
  ON client_adapter_settings (developer_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), client_kind, key);
CREATE INDEX idx_settings_audit_scope ON settings_audit_events (scope_kind, scope_id, created_at DESC);
CREATE INDEX idx_settings_audit_key ON settings_audit_events (key, created_at DESC);

COMMIT;
