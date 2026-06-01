# Data model (Postgres SoT)

This is the canonical schema source. Implementation migrations must match this document.

## 1. Extensions

- `CREATE EXTENSION IF NOT EXISTS vector;`
- For lexical search: `pg_trgm` and/or built-in `tsvector`. The v1 migration fixes the choice; recommended baseline is `tsvector` on `chunks.text` plus a GIN index.

## 1.1 Database placement

This schema applies first to the `recallant_agent_work` database inside the single Recallant Postgres instance. See [ADR-0011-postgres-instance-domain-databases.md](ADR-0011-postgres-instance-domain-databases.md).

Future domain databases such as `recallant_personal_life` may reuse this base L0/L1/L2/L3 schema and extend it through ADRs. Keep `memory_domain` columns even inside a domain-specific database for provenance, export/import, and cross-domain recall traces.

## 2. Tables

### 2.0 `developers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `developer_id` |
| `name` | TEXT | Human label (e.g. workspace owner name) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

One `developer` groups multiple `projects`. This enables cross-project search and developer-scoped patterns. v1 may use one developer per Recallant instance; multi-developer support requires a separate ADR.

### 2.1 `projects`

`projects` are logical memory spaces, not necessarily folders. A row may represent a repository,
server/infrastructure area, client, research topic, personal domain, recurring process, or virtual
topic. `primary_path` is a convenience/display/fallback pointer for folder-first coding workflows,
not the permanent project identity.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `project_id` |
| `developer_id` | UUID FK → developers | required |
| `parent_project_id` | UUID FK → projects | nullable; for nested projects/workspaces |
| `project_kind` | TEXT | `repo` \| `subproject` \| `workspace` \| `personal_domain` \| `other`; default `repo` |
| `memory_domain` | TEXT | `agent_work` default; future: `personal_life`, `research`, `other` |
| `name` | TEXT | Human label |
| `primary_path` | TEXT | Last known workspace path (nullable) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 2.1.0 `project_sources` (target source-binding table)

The initial coding workflow can use `projects.primary_path` as a compatibility shortcut. The target
architecture should support multiple sources attached to one project memory space. A source is a
folder/repo/server/document/connector/manual binding, not a separate project unless the owner wants
separate memory isolation.

Implementation status: first slice implemented on 2026-06-01. `project_sources` exists in the
initial schema, folder-backed project registration creates a primary `workspace_path` source, and
the CLI exposes first source-management commands. `projects.primary_path` remains the compatibility
fallback.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `project_source_id` |
| `project_id` | UUID FK → projects | required |
| `source_kind` | TEXT | `workspace_path` \| `repo` \| `server_path` \| `document_collection` \| `connector` \| `manual` \| `virtual` \| `other` |
| `label` | TEXT | Human label shown in UI |
| `uri` | TEXT | Path, URL, connector id, or stable virtual id; nullable for fully manual sources |
| `is_primary` | BOOLEAN | display/default source hint; at most one primary source per project by policy |
| `status` | TEXT | `active` \| `detached` \| `archived` \| `needs_review` |
| `metadata` | JSONB | nullable; source-specific safe metadata, never raw secrets |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Invariant:** a project can exist with zero sources. A source can be detached without deleting the
project memory. Source bindings may point to different machines or services; Recallant stores the
binding and provenance, not a promise that the path is always locally reachable.

### 2.1.1 Scope and audience model

ADR-0040 accepts a multi-axis scope/audience model. Existing `scope=project|developer` columns are the compatibility/default subset, not the full architecture.

Implementation should represent richer applicability through `scope_kind`, `scope_id`, and audience metadata where records need more precision:

- `domain`
- `developer`
- `environment`
- `project`
- `repo`
- `subproject`
- `session`
- `connector_account`
- `capability`
- `client_adapter`

Audience metadata controls consumers such as `all_agents`, `specific_client`, `context_pack`, `background_worker`, `review_ui`, `human_owner`, `import_pipeline`, and `connector`.

In v1, this may be implemented as additive nullable columns and JSONB/array metadata before normalizing into dedicated tables, but migrations must not bake in only `project|developer` as the permanent model.

### 2.2 `sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | |
| `client_kind` | TEXT | see `GLOSSARY.md` |
| `client_version` | TEXT | nullable |
| `started_at` | TIMESTAMPTZ | |
| `last_seen_at` | TIMESTAMPTZ | updated by session-scoped tool calls; used for interruption detection |
| `last_heartbeat_at` | TIMESTAMPTZ | nullable; updated only by `memory_heartbeat` |
| `heartbeat_status` | TEXT | nullable; e.g. `active`, `idle`, `running_tests`, `running_command`, `background_job`, `unknown` |
| `heartbeat_metadata` | JSONB | nullable; small status metadata, not raw output |
| `ended_at` | TIMESTAMPTZ | nullable |
| `status` | TEXT | `active` \| `closed` \| `interrupted` \| `recovered`; default `active` |
| `ended_reason` | TEXT | `closeout` \| `client_exit` \| `timeout` \| `crash_or_unknown` \| `superseded` \| nullable |
| `recovered_from_session_id` | UUID FK → sessions | nullable; set when a new session resumes an unclosed one |

**Invariant:** a missing `ended_at` is not data loss by itself. It means the next `memory_start_session` must inspect the previous session, checkpoint, last captured event, and local spool/sync state if available.

**Invariant:** heartbeat metadata is session liveness metadata only. `memory_heartbeat` must not create L0 `events` and must not store raw command/test output in `heartbeat_metadata`.

### 2.3 `events` (L0 append envelope)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `event_id` |
| `project_id` | UUID FK | |
| `session_id` | UUID FK | nullable for system events |
| `ingest_source` | TEXT | see `GLOSSARY.md` |
| `kind` | TEXT | `turn_user` \| `turn_assistant` \| `tool_call` \| `tool_result` \| `terminal_output` \| `file_change` \| `system` \| `import_batch` \| `checkpoint` \| `other` |
| `occurred_at` | TIMESTAMPTZ | |
| `payload` | JSONB | Normalized body: for a turn, `{ "text": "...", "attachments": [] }`; for large workflow events, metadata + bounded excerpt + raw artifact refs |
| `payload_hash` | TEXT | SHA256 canonical JSON for dedup (nullable for non-deterministic content) |
| `created_at` | TIMESTAMPTZ | insert time |

**Invariant:** normal correction does not update `events` content; corrections are new `kind=system` events with source references when policy allows.

**Erasure exception:** explicit owner-confirmed erasure may hard-delete or redact event content and all derived material. If a row must remain for integrity/audit, content fields must be replaced with a non-reconstructive redaction marker and linked to an `erasure_requests` receipt. This exception is not ordinary cleanup.

Ordinary captured user/assistant turns may store full text directly in `events.payload`. Large terminal/tool output, media, attachments, and transcript exports should not force unbounded JSONB growth; store a bounded excerpt and link one or more `raw_artifacts` rows.

### 2.3.1 `raw_artifacts` (large raw evidence pointers)

Raw artifacts preserve large workflow evidence without making every event row a huge blob. In v1 the physical backend may be local spool or server filesystem storage. Future object storage can be added behind the same logical contract.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `raw_artifact_id` |
| `project_id` | UUID FK | |
| `session_id` | UUID FK → sessions | nullable |
| `source_event_id` | UUID FK → events | nullable only while a local spool record has not yet synced to server event id |
| `artifact_kind` | TEXT | `tool_output` \| `terminal_output` \| `attachment` \| `transcript_export` \| `media` \| `other` |
| `storage_backend` | TEXT | `local_spool` \| `server_filesystem` \| `postgres_inline` \| `object_storage` \| `external` |
| `uri` | TEXT | backend-specific pointer/path/URL; not necessarily public |
| `sha256` | TEXT | content hash for dedup/integrity |
| `size_bytes` | BIGINT | nullable if unknown |
| `content_type` | TEXT | nullable, e.g. `text/plain`, `application/json`, `image/png` |
| `excerpt` | TEXT | bounded preview used for Review UI/search context |
| `metadata` | JSONB | nullable; command id, exit code, capture profile, truncation reason, local spool mapping |
| `created_at` | TIMESTAMPTZ | |
| `synced_at` | TIMESTAMPTZ | nullable; set when local artifact is confirmed on server |
| `deleted_at` | TIMESTAMPTZ | nullable; only by explicit retention policy, not ordinary cleanup |

**Invariant:** raw artifact metadata is part of L0 provenance. Full artifact content is never returned to startup context by default; agents receive bounded excerpts and source refs unless an explicit inspection/reprocess workflow is used.

**Erasure exception:** explicit owner-confirmed erasure must remove/redact raw artifact excerpt and physical content when the artifact is in Recallant-managed storage. External artifacts are represented as removed bindings plus a redacted receipt; Recallant cannot delete content it does not control.

### 2.4 `chunks` (L1)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK | |
| `developer_id` | UUID FK → developers | denormalized for efficient cross-project search |
| `source_event_id` | UUID FK → events | required if chunk came from an event |
| `text` | TEXT | materialized chunk |
| `chunk_index` | INT | order inside event |
| `token_count_est` | INT | nullable |
| `scope` | TEXT | compatibility default: `project` \| `developer`; see ADR-0040 for richer `scope_kind`/audience model |
| `scope_kind` | TEXT | nullable/additive v1 field for ADR-0040 scope kinds |
| `scope_id` | TEXT | nullable/additive v1 field; UUID or stable external id depending on `scope_kind` |
| `audience` | JSONB | nullable; consumer/audience hints such as all_agents/specific_client/context_pack |
| `embed_status` | TEXT | `pending` \| `embedded` \| `failed`; embedding pipeline status |
| `embed_model` | TEXT | embedding model name; NULL when `pending` |
| `last_accessed_at` | TIMESTAMPTZ | last retrieval access time; NULL if never accessed |
| `access_count` | INT | access count through memory_search / memory_fetch_chunk; default 0 |
| `archived_at` | TIMESTAMPTZ | NULL = active; NOT NULL = archived and excluded from normal search |
| `tsv` | tsvector | generated or maintained |
| `created_at` | TIMESTAMPTZ | |

### 2.5 `embeddings`

| Column | Type | Notes |
|--------|------|-------|
| `chunk_id` | UUID PK/FK | |
| `model` | TEXT | for example `text-embedding-3-large` |
| `dims` | INT | |
| `vector` | vector(dims) | pgvector |
| `created_at` | TIMESTAMPTZ | |

**Invariant:** when changing model/dimensions, use new rows or a versioned `embedding_models` table. v1 may replace by `chunk_id` with an audit/event record.

### 2.6 `edges` (L2)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK | |
| `src_kind` | TEXT | `chunk` \| `event` \| `external` |
| `src_id` | UUID or TEXT | UUID for chunk/event; TEXT for external ref |
| `dst_kind` | TEXT | |
| `dst_id` | UUID or TEXT | |
| `relation_type` | TEXT | see `GLOSSARY.md` |
| `weight` | REAL | default 1.0 |
| `metadata` | JSONB | nullable |
| `created_at` | TIMESTAMPTZ | |

### 2.7 `checkpoints`

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | UUID PK | one active checkpoint per project in v1 |
| `payload` | JSONB | see `MCP_SPEC.md` schema |
| `updated_at` | TIMESTAMPTZ | |

### 2.8 `agent_memories` (L3 governed memory)

Structured memory records for decisions, constraints, lessons, failures, preferences, procedures, artifact references, and work logs. These are not a replacement for L0; they are governed derived/confirmed records with provenance.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | required |
| `project_id` | UUID FK → projects | nullable only if `scope=developer` |
| `memory_domain` | TEXT | default `agent_work`; see `GLOSSARY.md` |
| `scope` | TEXT | compatibility default: `project` \| `developer`; see `scope_kind` |
| `scope_kind` | TEXT | nullable/additive v1 field for ADR-0040 scope kinds |
| `scope_id` | TEXT | nullable/additive v1 field; UUID or stable external id depending on `scope_kind` |
| `audience` | JSONB | nullable; consumer/audience hints |
| `memory_type` | TEXT | see `agent_memory_type` in `GLOSSARY.md` |
| `title` | TEXT | short recall name |
| `body` | TEXT | main memory body |
| `status` | TEXT | `candidate` \| `accepted` \| `rejected` \| `archived` \| `superseded` \| `stale` \| `needs_review` |
| `use_policy` | TEXT | `evidence_only` \| `recall_allowed` \| `instruction_grade` \| `do_not_use` |
| `confidence` | REAL | 0.0-1.0, nullable for imported/user-confirmed records |
| `created_by` | TEXT | `agent` \| `user` \| `system` \| `import` |
| `accepted_by` | TEXT | nullable actor label/id when status becomes `accepted` |
| `rejected_by` | TEXT | nullable actor label/id when status becomes `rejected` |
| `review_reason` | TEXT | nullable reason for accept/reject/archive/supersede/stale decisions |
| `supersedes` | UUID FK → agent_memories | nullable; memory this record replaces |
| `superseded_by` | UUID FK → agent_memories | nullable |
| `metadata` | JSONB | nullable |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Invariant:** agent-generated records require provenance and validation. They may be auto-created as `accepted` + `recall_allowed` for ordinary memories, `candidate` + `recall_allowed` for non-binding candidate rules, or `needs_review` + `evidence_only` for low-confidence/high-risk records. Only direct explicit user instruction, user-confirmed/imported records, or review-approved flow can produce `instruction_grade`.

**Invariant:** only `accepted` memories can act as durable behavioral guidance. `candidate`, `stale`, `needs_review`, and imported evidence may inform review/search but must not silently become standing instructions.

### 2.9 `agent_memory_source_refs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `memory_id` | UUID FK → agent_memories | |
| `source_kind` | TEXT | `event` \| `chunk` \| `raw_artifact` \| `edge` \| `checkpoint` \| `external` |
| `source_id` | TEXT | UUID string or external ref |
| `quote` | TEXT | optional short supporting quote/excerpt |
| `metadata` | JSONB | nullable |
| `created_at` | TIMESTAMPTZ | |

**Invariant:** agent-generated `agent_memories` must have at least one source ref before they can be returned in ordinary recall.

### 2.10 `agent_memory_review_actions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `memory_id` | UUID FK → agent_memories | |
| `action` | TEXT | see `review_action` in `GLOSSARY.md`; `approve` may be accepted as a compatibility alias for `accept` |
| `actor_kind` | TEXT | `user` \| `agent` \| `system` |
| `actor_id` | TEXT | nullable human/client identifier |
| `note` | TEXT | nullable |
| `metadata` | JSONB | nullable; previous values for edit, merge members, conflict/duplicate detection details |
| `created_at` | TIMESTAMPTZ | |

### 2.11 `recall_traces`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | |
| `project_id` | UUID FK → projects | nullable for all-project recall |
| `session_id` | UUID FK → sessions | nullable |
| `tool_name` | TEXT | e.g. `memory_search`, `memory_recall_agent_memories` |
| `query` | TEXT | nullable |
| `returned_chunk_ids` | JSONB | array of UUID strings |
| `returned_memory_ids` | JSONB | array of UUID strings |
| `used_chunk_ids` | JSONB | nullable, reported after use |
| `used_memory_ids` | JSONB | nullable, reported after use |
| `ignored_memory_ids` | JSONB | nullable |
| `metadata` | JSONB | latency, truncation, mode, etc. |
| `created_at` | TIMESTAMPTZ | |

### 2.12 `ingest_dedup_keys` (optional but recommended)

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | UUID | |
| `dedup_key` | TEXT | unique per project |
| `event_id` | UUID FK | |

Unique index on (`project_id`, `dedup_key`).

### 2.13 `model_calls`

Durable audit log for every embedding/LLM/rerank/classification call made by Recallant. See [MODEL_ROUTING.md](MODEL_ROUTING.md) and [ADR-0012-local-first-model-router.md](ADR-0012-local-first-model-router.md).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | nullable only for early system startup checks |
| `project_id` | UUID FK → projects | nullable for global/system jobs |
| `session_id` | UUID FK → sessions | nullable |
| `memory_domain` | TEXT | e.g. `agent_work`; nullable only for system startup checks |
| `route_class` | TEXT | `local_model` \| `active_agent` \| `subscription_worker` \| `paid_api_provider` |
| `provider` | TEXT | `ollama`, `codex`, `openai`, `anthropic`, `gemini`, `other` |
| `model` | TEXT | provider model id |
| `purpose` | TEXT | `embedding`, `query_embedding`, `rerank`, `extract_memory`, `classify_policy`, `closeout_summary`, `consolidation`, `cleanup_summary`, `intent_detection`, `other` |
| `routing_reason` | TEXT | `default_local`, `fallback_unavailable`, `low_confidence`, `quality_critical`, `complex_closeout`, `user_requested`, `batch_job`, `other` |
| `limit_status` | TEXT | nullable; e.g. `unknown`, `available`, `near_limit`, `rate_limited`, `exhausted` |
| `confirmation_status` | TEXT | nullable; `not_required` \| `required_pending` \| `approved` \| `denied` |
| `approval_request_id` | UUID | nullable FK → `paid_api_approval_requests.id` |
| `input_tokens` | INT | nullable; actual or estimate |
| `output_tokens` | INT | nullable; actual or estimate |
| `cost_estimate_usd` | NUMERIC | nullable |
| `cost_actual_usd` | NUMERIC | nullable |
| `latency_ms` | INT | nullable |
| `status` | TEXT | `success` \| `failed` \| `cancelled` |
| `error_code` | TEXT | nullable |
| `metadata` | JSONB | batch size, dimensions, confidence, retry count, provider request id, redacted details |
| `created_at` | TIMESTAMPTZ | |

Do not store full prompt/input/output text in `model_calls` by default. Store source ids or redacted references in `metadata` when needed.

### 2.13.0 `erasure_requests`

Explicit owner-confirmed erasure is separate from ordinary archive/reject/supersede cleanup. It removes content from active memory and derived layers while preserving at most a redacted, non-reconstructive receipt.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `erasure_id` |
| `developer_id` | UUID FK → developers | |
| `project_id` | UUID FK → projects | nullable for developer/environment/global scope erasure |
| `requested_by` | TEXT | actor id/label |
| `request_source` | TEXT | `ui` \| `cli` \| `chat` \| `mcp` \| `system` |
| `target_selector` | JSONB | ids, scopes, search criteria, or safe references; no raw target content |
| `reason` | TEXT | nullable owner note; must not include secrets or erased content |
| `status` | TEXT | `pending_confirmation` \| `confirmed` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `requires_confirmation` | BOOLEAN | default true |
| `confirmed_by` | TEXT | nullable actor id/label |
| `confirmed_at` | TIMESTAMPTZ | nullable |
| `executed_at` | TIMESTAMPTZ | nullable |
| `redacted_receipt` | JSONB | counts, target kinds, hashes/ids if safe, warnings; no erased content |
| `error_code` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Invariant:** erasure must cover active and derived surfaces: `events.payload`, `chunks.text`, `embeddings.vector`, `agent_memories.title/body`, source-ref quotes, raw-artifact excerpts/content, search indexes, summaries, and context-pack caches. The exact implementation may hard-delete rows or replace content with a redaction marker when referential integrity requires a tombstone.

**Invariant:** erasure requests and receipts must not preserve the content being forgotten. They exist to prove the operation happened and to suppress re-import/re-extraction of the same material when safe identifiers are available.

### 2.13.1 `paid_api_approval_requests`

Default-profile paid API calls require explicit approval before execution. This table records pending/approved/denied approval decisions and powers the cost dashboard.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | |
| `project_id` | UUID FK → projects | nullable for global/system jobs |
| `session_id` | UUID FK → sessions | nullable |
| `purpose` | TEXT | same purpose enum family as `model_calls` |
| `provider` | TEXT | e.g. `openai`, `gemini`, `anthropic` |
| `model` | TEXT | provider model id |
| `routing_reason` | TEXT | why paid API is requested |
| `attempted_routes` | JSONB | local/active-agent/subscription attempts and outcomes; redacted |
| `input_tokens_estimate` | INT | nullable |
| `output_tokens_estimate` | INT | nullable |
| `cost_estimate_usd` | NUMERIC | nullable |
| `status` | TEXT | `pending` \| `approved` \| `denied` \| `expired` \| `cancelled` |
| `requested_by` | TEXT | `agent` \| `system` \| `user` |
| `decided_by` | TEXT | nullable actor id/label |
| `decision_note` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | |
| `decided_at` | TIMESTAMPTZ | nullable |
| `expires_at` | TIMESTAMPTZ | nullable |

**Invariant:** approval records must not store raw prompts or secrets. They store purpose, estimates, route history, and source references only.

### 2.14 `system_settings`

Server/runtime defaults owned by the Recallant server. Secrets themselves should stay in environment variables or a secret store; this table may store safe references or non-secret deployment policy.

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | e.g. `default_capture_profile`, `cloudflare_mode`, `default_model_router_mode` |
| `value` | JSONB | setting value; no raw secrets |
| `value_schema_version` | INT | default 1 |
| `is_secret_ref` | BOOLEAN | true means value is a reference/label, not the secret itself |
| `updated_by` | TEXT | nullable actor label/id |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 2.15 `developer_settings`

Owner-wide defaults across projects.

| Column | Type | Notes |
|--------|------|-------|
| `developer_id` | UUID FK → developers | |
| `key` | TEXT | setting key |
| `value` | JSONB | setting value |
| `value_schema_version` | INT | default 1 |
| `updated_by` | TEXT | nullable actor label/id |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Unique index on (`developer_id`, `key`).

### 2.16 `project_settings`

Project-specific settings. These override developer/global defaults for one project.

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | UUID FK → projects | |
| `key` | TEXT | setting key |
| `value` | JSONB | setting value |
| `value_schema_version` | INT | default 1 |
| `applies_to` | TEXT | `future_only` \| `immediate` \| `requires_reprocess`; default depends on setting |
| `reason` | TEXT | nullable owner/agent note |
| `updated_by` | TEXT | nullable actor label/id |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Unique index on (`project_id`, `key`).

Examples: `capture_profile`, `context_budget_profile`, `model_routing_overrides`, `enabled_clients`, `project_paths`, `review_behavior`.

### 2.17 `session_overrides`

Temporary settings for one session or task.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `session_id` | UUID FK → sessions | |
| `key` | TEXT | setting key |
| `value` | JSONB | setting value |
| `expires_at` | TIMESTAMPTZ | nullable |
| `cleared_at` | TIMESTAMPTZ | nullable |
| `reason` | TEXT | nullable |
| `created_by` | TEXT | nullable actor label/id |
| `created_at` | TIMESTAMPTZ | |

### 2.18 `client_adapter_settings`

Target/client-specific settings and hints. These must not duplicate core policy.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | |
| `project_id` | UUID FK → projects | nullable for developer-wide adapter defaults |
| `client_kind` | TEXT | `codex`, `cursor`, `claude_code`, `windsurf`, `other` |
| `key` | TEXT | setting key |
| `value` | JSONB | setting value |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Unique index on (`developer_id`, `project_id`, `client_kind`, `key`) with appropriate NULL handling in migration.

### 2.19 `settings_audit_events`

Audit trail for settings changes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `scope_kind` | TEXT | `system` \| `developer` \| `project` \| `session` \| `client_adapter` |
| `scope_id` | TEXT | UUID string or `system` |
| `key` | TEXT | setting key |
| `old_value` | JSONB | nullable/redacted |
| `new_value` | JSONB | nullable/redacted |
| `actor_kind` | TEXT | `user` \| `agent` \| `system` |
| `actor_id` | TEXT | nullable |
| `reason` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | |

Do not store secrets in settings audit events.

## 3. Indices (minimum)

- `events (project_id, occurred_at DESC)`
- `sessions (project_id, status, last_seen_at DESC)` for active/stale session recovery checks
- `raw_artifacts (project_id, created_at DESC)`, `(source_event_id)`, `(sha256)`
- `projects (developer_id, parent_project_id)`
- `projects (developer_id, memory_domain, project_kind)`
- `chunks (project_id)` + GIN(`tsv`)
- `chunks (developer_id, scope)` for cross-project developer-scope queries
- `chunks (project_id, last_accessed_at, archived_at)` for `recallant analyze` / cleanup queries
- `embeddings USING ivfflat` or `hnsw` on `vector`; choose based on data size. v1 may start with sequential scan only for dev/small fixtures.
- `edges (project_id, src_kind, src_id)` and `(project_id, dst_kind, dst_id)`
- `agent_memories (project_id, status, use_policy, updated_at DESC)`
- `agent_memories (developer_id, scope, status, use_policy)`
- `agent_memory_source_refs (memory_id)` and `(source_kind, source_id)`
- `recall_traces (project_id, created_at DESC)`
- `model_calls (created_at DESC)`, `(project_id, created_at DESC)`, `(route_class, provider, model, purpose, created_at DESC)`
- `paid_api_approval_requests (status, created_at DESC)`, `(project_id, status, created_at DESC)`, `(provider, model, purpose, created_at DESC)`
- `developer_settings (developer_id, key)` unique
- `project_settings (project_id, key)` unique
- `session_overrides (session_id, key, cleared_at)`
- `client_adapter_settings (developer_id, project_id, client_kind, key)` unique with NULL-safe migration handling
- `settings_audit_events (scope_kind, scope_id, created_at DESC)`, `(key, created_at DESC)`

## 4. Migrations policy

- Every schema change requires SQL migrations plus an update to this file in the same PR/commit.
- Every enum change requires an update to `GLOSSARY.md`.
