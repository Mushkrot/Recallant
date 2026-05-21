# Data model (Postgres SoT)

Единственный канонический источник схемы. Все миграции в коде должны **соответствовать** этому документу.

## 1. Extensions

- `CREATE EXTENSION IF NOT EXISTS vector;`
- Для lexical: `pg_trgm` и/или встроенный `tsvector` — выбор фиксируется в миграции v1 (рекомендация: **tsvector** на `chunks.text` + GIN index).

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

Один `developer` объединяет несколько `projects`. Позволяет cross-project поиск и хранение общих паттернов с `scope=developer`. В v1 допускается один developer per Recallant instance (single-user); multi-developer — через ADR.

### 2.1 `projects`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `project_id` |
| `developer_id` | UUID FK → developers | обязателен |
| `parent_project_id` | UUID FK → projects | nullable; для nested projects/workspaces |
| `project_kind` | TEXT | `repo` \| `subproject` \| `workspace` \| `personal_domain` \| `other`; default `repo` |
| `memory_domain` | TEXT | `agent_work` default; future: `personal_life`, `research`, `other` |
| `name` | TEXT | Human label |
| `primary_path` | TEXT | Последний известный workspace path (nullable) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

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
| `client_kind` | TEXT | см. `GLOSSARY.md` |
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
| `session_id` | UUID FK | nullable для system events |
| `ingest_source` | TEXT | см. `GLOSSARY.md` |
| `kind` | TEXT | `turn_user` \| `turn_assistant` \| `tool_call` \| `tool_result` \| `terminal_output` \| `file_change` \| `system` \| `import_batch` \| `checkpoint` \| `other` |
| `occurred_at` | TIMESTAMPTZ | |
| `payload` | JSONB | Нормализованное тело: для turn — `{ "text": "...", "attachments": [] }`; для больших workflow events — metadata + bounded excerpt + raw artifact refs |
| `payload_hash` | TEXT | SHA256 canonical JSON для dedup (nullable для non-deterministic) |
| `created_at` | TIMESTAMPTZ | insert time |

**Invariant:** `events` без UPDATE содержимого; исправления только новым событием `kind=system` с ссылкой (если политика допускает).

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

### 2.4 `chunks` (L1)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK | |
| `developer_id` | UUID FK → developers | денормализовано для эффективного cross-project поиска |
| `source_event_id` | UUID FK → events | обязателен если chunk из event |
| `text` | TEXT | materialized chunk |
| `chunk_index` | INT | порядок внутри event |
| `token_count_est` | INT | nullable |
| `scope` | TEXT | compatibility default: `project` \| `developer`; see ADR-0040 for richer `scope_kind`/audience model |
| `scope_kind` | TEXT | nullable/additive v1 field for ADR-0040 scope kinds |
| `scope_id` | TEXT | nullable/additive v1 field; UUID or stable external id depending on `scope_kind` |
| `audience` | JSONB | nullable; consumer/audience hints such as all_agents/specific_client/context_pack |
| `embed_status` | TEXT | `pending` \| `embedded` \| `failed` — статус embedding pipeline |
| `embed_model` | TEXT | название модели которой сделан embedding; NULL если `pending` |
| `last_accessed_at` | TIMESTAMPTZ | время последнего retrieval-обращения; NULL если никогда |
| `access_count` | INT | счётчик обращений через memory_search / memory_fetch_chunk; default 0 |
| `archived_at` | TIMESTAMPTZ | NULL = активный; NOT NULL = архивирован, не участвует в поиске |
| `tsv` | tsvector | generated or maintained |
| `created_at` | TIMESTAMPTZ | |

### 2.5 `embeddings`

| Column | Type | Notes |
|--------|------|-------|
| `chunk_id` | UUID PK/FK | |
| `model` | TEXT | например `text-embedding-3-large` |
| `dims` | INT | |
| `vector` | vector(dims) | pgvector |
| `created_at` | TIMESTAMPTZ | |

**Invariant:** при смене модели — новые rows или версия в отдельной таблице `embedding_models` (ADR optional); v1 допускает **replace** по `chunk_id` с логом в `events`.

### 2.6 `edges` (L2)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `project_id` | UUID FK | |
| `src_kind` | TEXT | `chunk` \| `event` \| `external` |
| `src_id` | UUID or TEXT | UUID для chunk/event; TEXT для external ref |
| `dst_kind` | TEXT | |
| `dst_id` | UUID or TEXT | |
| `relation_type` | TEXT | см. `GLOSSARY.md` |
| `weight` | REAL | default 1.0 |
| `metadata` | JSONB | nullable |
| `created_at` | TIMESTAMPTZ | |

### 2.7 `checkpoints`

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | UUID PK | один активный на проект в v1 |
| `payload` | JSONB | см. `MCP_SPEC.md` schema |
| `updated_at` | TIMESTAMPTZ | |

### 2.8 `agent_memories` (L3 governed memory)

Structured memory records for decisions, constraints, lessons, failures, preferences, procedures, artifact references, and work logs. These are not a replacement for L0; they are governed derived/confirmed records with provenance.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `developer_id` | UUID FK → developers | обязателен |
| `project_id` | UUID FK → projects | nullable только если `scope=developer` |
| `memory_domain` | TEXT | default `agent_work`; см. `GLOSSARY.md` |
| `scope` | TEXT | compatibility default: `project` \| `developer`; see `scope_kind` |
| `scope_kind` | TEXT | nullable/additive v1 field for ADR-0040 scope kinds |
| `scope_id` | TEXT | nullable/additive v1 field; UUID or stable external id depending on `scope_kind` |
| `audience` | JSONB | nullable; consumer/audience hints |
| `memory_type` | TEXT | см. `agent_memory_type` в `GLOSSARY.md` |
| `title` | TEXT | короткое имя для recall |
| `body` | TEXT | основная запись памяти |
| `status` | TEXT | `candidate` \| `accepted` \| `rejected` \| `archived` \| `superseded` \| `stale` \| `needs_review` |
| `use_policy` | TEXT | `evidence_only` \| `recall_allowed` \| `instruction_grade` \| `do_not_use` |
| `confidence` | REAL | 0.0–1.0, nullable для imported/user confirmed |
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
| `action` | TEXT | см. `review_action` в `GLOSSARY.md`; `approve` may be accepted as a compatibility alias for `accept` |
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
| `dedup_key` | TEXT | уникальный per project |
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
- `chunks (developer_id, scope)` — для cross-project developer-scope запросов
- `chunks (project_id, last_accessed_at, archived_at)` — для recallant analyze / cleanup queries
- `embeddings USING ivfflat` или `hnsw` на `vector` (выбор по размеру данных; v1 может начать с sequential scan при малых N — только для dev)
- `edges (project_id, src_kind, src_id)` и `(project_id, dst_kind, dst_id)`
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

- Все изменения схемы — SQL миграции + обновление этого файла в том же PR/commit от агента.
- Любое изменение enums — дополнение к `GLOSSARY.md`.
