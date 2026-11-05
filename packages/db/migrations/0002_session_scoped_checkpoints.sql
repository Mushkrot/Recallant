BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS external_session_id_hash TEXT;

CREATE INDEX IF NOT EXISTS sessions_external_identity_idx
  ON sessions (project_id, client_kind, external_session_id_hash, last_seen_at DESC)
  WHERE external_session_id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_checkpoints (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
