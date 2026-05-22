# MCP specification

## 1. Server identity

- **Name:** `recallant`
- **Version:** semver in code; logged on startup.

## 2. Configuration (environment)

| Variable | Required | Meaning |
|----------|----------|---------|
| `RECALLANT_DATABASE_URL` | yes | Postgres connection string |
| `RECALLANT_DEVELOPER_ID` | yes | Owner/developer UUID; created once during setup/init |
| `RECALLANT_PROJECT_ID` | yes* | Project UUID; loaded from `.recallant/config` for the current project |
| `RECALLANT_EMBEDDING_MODEL` | yes | Model id for embeddings (default: `nomic-embed-text`) |
| `RECALLANT_EMBEDDING_DIMS` | yes | int (default: `768` for `nomic-embed-text`) |
| `RECALLANT_OLLAMA_URL` | no | Existing Ollama/local-model endpoint (default: `http://localhost:11434`; discovered/configured capability, not a hard-coded service requirement) |
| `RECALLANT_EMBED_BATCH_SIZE` | no | Embedding batch size (default: `32`); see `INGESTION.md` |
| `RECALLANT_DECAY_ENABLED` | no | Age-based score decay (default: `true`); see `CLEANUP.md` |
| `RECALLANT_DECAY_HALFLIFE_PROJECT_DAYS` | no | Half-life for project chunks (default: `90`) |
| `RECALLANT_DECAY_HALFLIFE_DEVELOPER_DAYS` | no | Half-life for developer chunks (default: `365`) |
| `RECALLANT_ANALYSIS_PROVIDER` | no | LLM provider for `recallant analyze`: `ollama` (default) \| `openai` \| `none` |
| `RECALLANT_ANALYSIS_MODEL` | no | Model for analyze summaries (default: `llama3.2:3b`; for OpenAI, for example `gpt-4o-mini`) |
| `RECALLANT_CLOUD_EMBEDDING_FALLBACK` | no | `disabled` \| `enabled`; default `disabled` until explicitly configured |
| `RECALLANT_MODEL_ROUTER_MODE` | no | `local_only` \| `local_first` \| `subscription_first_api_last` \| `paid_api_allowed`; default `subscription_first_api_last` when subscription routes are configured, otherwise `local_first` |
| `RECALLANT_SUBSCRIPTION_WORKER` | no | `disabled` \| `enabled`; enables supported OAuth/sign-in subscription worker route when configured |
| `RECALLANT_PAID_API_DAILY_BUDGET_USD` | no | optional daily paid API budget ceiling |
| `RECALLANT_PAID_API_MODE` | no | `disabled` \| `confirm_each` \| `auto_with_caps`; default `confirm_each` |
| `RECALLANT_OPENAI_API_KEY` | no* | OpenAI API key; required if `RECALLANT_ANALYSIS_PROVIDER=openai` |
| `RECALLANT_OPENAI_BASE_URL` | no | Base URL for OpenAI-compatible APIs (default: `https://api.openai.com/v1`) |
| `RECALLANT_LOG_LEVEL` | no | default `info` |
| `RECALLANT_RETRIEVAL_PROFILE` | no | retrieval/context tuning profile; default implementation profile |

\*`RECALLANT_PROJECT_ID` is automatically loaded from `.recallant/config` when using the `recallant` CLI. Direct MCP server startup passes it explicitly.

Default values in this table are implementation/profile defaults, not architecture invariants. Model/dimension changes must follow explicit reindex/migration rules because stored embeddings depend on the chosen dimensionality; see [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md).

## 3. Tools (canonical names)

Tool names are fixed; clients and tests depend on them.

### 3.0 `memory_start_session`

Starts or resumes a Recallant-tracked agent session. This tool is universal: Codex, Cursor, Claude Code, Windsurf, and future agents all use the same contract with different `client_kind` values.

**Input JSON:**

```json
{
  "client_kind": "codex|cursor|windsurf|claude_code|unknown|other",
  "client_version": "string|null",
  "project_path": "string|null",
  "session_label": "string|null",
  "resume_policy": "normal|force_new|recover_previous"
}
```

**Output JSON:**

```json
{
  "session_id": "uuid",
  "project_id": "uuid",
  "checkpoint": {
    "payload": {},
    "updated_at": "iso8601|null"
  },
  "previous_unclosed_session": {
    "session_id": "uuid",
    "last_seen_at": "iso8601",
    "last_event_id": "uuid|null",
    "recovery_status": "none|needs_review|recovered"
  },
  "recommended_next_calls": [
    "memory_get_context_pack"
  ]
}
```

`previous_unclosed_session` is `null` when no recovery candidate exists.

**Policy:**

- Every non-trivial agent session should start with this tool.
- The server updates `sessions.last_seen_at` on this and other session-scoped tool calls.
- If the previous session for the same project did not close cleanly, the response must make that visible.
- `memory_start_session` does not perform broad historical import.

### 3.0.1 `memory_heartbeat`

Lightweight liveness update for long-running or idle tasks. This tool does not append raw memory and does not create L0 `events`.

**Input JSON:**

```json
{
  "session_id": "uuid",
  "status": "active|idle|running_tests|running_command|background_job|unknown",
  "note": "string|null",
  "metadata": {}
}
```

**Output JSON:**

```json
{
  "ok": true,
  "session_id": "uuid",
  "last_seen_at": "iso8601",
  "last_heartbeat_at": "iso8601"
}
```

**Policy:**

- Updates `sessions.last_seen_at`, `last_heartbeat_at`, `heartbeat_status`, and bounded `heartbeat_metadata`.
- Must not create `events` or chunks.
- Must not store raw command/test output.
- Intended for long-running commands, tests, imports, sync jobs, or idle periods where no other memory tool is being called.
- Timeout/stale-session thresholds are configured by policy.

### 3.0.2 `memory_get_context_pack`

Builds the bounded startup context for an agent session. This is the canonical automatic startup context path; CLI/UI previews must use the same server logic.

**Input JSON:**

```json
{
  "session_id": "uuid",
  "task_hint": "string|null",
  "project_id": "uuid|null",
  "max_chars_total": 12000,
  "include_raw_evidence": "auto|never|always",
  "include_recovery": true
}
```

`max_chars_total` is an example. The effective limit is bounded by configured context policy.

**Output JSON:**

```json
{
  "context_pack_id": "uuid|null",
  "project_id": "uuid",
  "session_id": "uuid",
  "profile": "compact|standard|expanded|custom",
  "sections": {
    "checkpoint": {},
    "recovery": {},
    "binding_rules": [],
    "working_memories": [],
    "operational_bindings": [],
    "evidence_excerpts": [],
    "suggested_next_fetches": [],
    "warnings": []
  },
  "truncated": false,
  "budget": {
    "max_chars_total": 12000,
    "used_chars_estimate": 0
  }
}
```

**Policy:**

- The tool composes checkpoint, governed-memory recall, recovery warnings, resolver hints, and optional narrow evidence search.
- It must not import historical docs, read all project files, or return unbounded raw history.
- If raw evidence is included, excerpts must include source refs.
- Active `instruction_grade` memories must be distinguishable from ordinary working memories.
- Scope/audience filtering follows ADR-0040; unresolved high-risk conflicts follow ADR-0041 and must appear as warnings rather than hidden choices.
- If previous session/spool state is incomplete, the pack must include a visible warning rather than pretending context is complete.
- For trivial sessions the pack may be small; "context pack" does not mean "large dump".

### 3.1 `memory_append_turn`

**Input JSON:**

```json
{
  "session_id": "uuid|null",
  "client_kind": "codex|cursor|windsurf|claude_code|unknown|other",
  "role": "user|assistant",
  "text": "string",
  "occurred_at": "iso8601|null",
  "dedup_key": "string|null"
}
```

**Output JSON:**

```json
{
  "event_id": "uuid",
  "status": "created|duplicate"
}
```

**Errors:**

| Code | When |
|------|------|
| `VALIDATION_ERROR` | schema / empty text |
| `CONFLICT` | duplicate dedup_key |
| `UNAVAILABLE` | DB down |

### 3.1.1 `memory_append_event`

Appends non-turn workflow evidence. This is the canonical path for tool/terminal/file/system evidence that does not fit the simpler user/assistant turn shape.

**Input JSON:**

```json
{
  "session_id": "uuid|null",
  "client_kind": "codex|cursor|windsurf|claude_code|unknown|other",
  "event_kind": "tool_call|tool_result|terminal_output|file_change|system|other",
  "text": "string|null",
  "metadata": {},
  "raw_artifacts": [
    {
      "artifact_kind": "tool_output|terminal_output|attachment|transcript_export|media|other",
      "storage_backend": "local_spool|server_filesystem|postgres_inline|object_storage|external",
      "uri": "string|null",
      "sha256": "string|null",
      "size_bytes": 0,
      "content_type": "string|null",
      "excerpt": "string|null",
      "metadata": {}
    }
  ],
  "occurred_at": "iso8601|null",
  "dedup_key": "string|null"
}
```

**Output JSON:**

```json
{
  "event_id": "uuid",
  "raw_artifact_ids": ["uuid"],
  "status": "created|duplicate"
}
```

**Policy:**

- Capture profile controls how much `text`/`excerpt` is stored.
- Large raw payloads must be referenced through `raw_artifacts`, not returned as unbounded MCP responses.
- Raw artifacts are source evidence. They do not become governed memories or instructions without the normal extraction/review policy.
- Full artifact content is not part of `memory_get_context_pack`.

### 3.2 `memory_search`

**Input JSON:** see fields in `RETRIEVAL.md`; implementation must expose them explicitly in JSON Schema.

Example standard-profile input:

```json
{
  "query": "string",
  "mode": "hybrid|vector_only|lexical_only",
  "scope": "project|developer|all",
  "scope_kind": "domain|developer|environment|project|repo|subproject|session|connector_account|capability|client_adapter|null",
  "audience": "all_agents|specific_client|context_pack|background_worker|review_ui|human_owner|import_pipeline|connector|null",
  "top_k": 8,
  "max_chars_total": 12000,
  "graph_expand": false,
  "graph_budget_nodes": 8
}
```

`scope` is a convenience filter. `scope_kind` and `audience` further narrow applicability according to ADR-0040. Default search is current project plus applicable developer/environment/capability/client-adapter records according to server policy, not a blind cross-project scan.

`top_k`, `max_chars_total`, and `graph_budget_nodes` are bounded by configured retrieval policy. Example numbers in this spec are not architecture invariants; see [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md).

**Output JSON:**

```json
{
  "hits": [
    {
      "chunk_id": "uuid",
      "score": 0.0,
      "text_excerpt": "string",
      "source_event_id": "uuid",
      "raw_artifact_refs": ["uuid"],
      "occurred_at": "iso8601",
      "why": "vector|lexical|graph|rerank"
    }
  ],
  "truncated": true
}
```

### 3.3 `memory_fetch_chunk`

**Input:** `{ "chunk_id": "uuid", "max_chars": 16000 }` where `16000` is an example value and `max_chars` is bounded by configured retrieval policy.  
**Output:** `{ "chunk_id", "text", "source_event_id", "metadata": {} }`

### 3.4 `memory_link`

**Input:**

```json
{
  "src_kind": "chunk|event",
  "src_id": "uuid",
  "dst_kind": "chunk|event|external",
  "dst_id": "uuid|string",
  "relation_type": "string",
  "weight": 1.0,
  "metadata": {}
}
```

**Output:** `{ "edge_id": "uuid" }`

### 3.5 `memory_promote`

Compatibility helper for promoting a chunk/memory into a broader governed scope. In the simple v1 path this may promote from project to developer visibility. Broader ADR-0040 scope changes must go through validation/review policy, especially for environment, capability, connector_account, or client_adapter scopes.

**Input:**
```json
{
  "chunk_id": "uuid",
  "note": "string|null"
}
```

**Output:** `{ "ok": true, "chunk_id": "uuid", "scope": "developer", "scope_kind": "developer" }`

**Errors:** `NOT_FOUND`, `VALIDATION_ERROR`.

Called by the agent on its own initiative or after an explicit user request.

### 3.6 `memory_archive`

Archives a chunk and excludes it from ordinary search. This is reversible through `unarchive`.

**Input:** `{ "chunk_id": "uuid", "action": "archive|unarchive" }`
**Output:** `{ "ok": true, "chunk_id": "uuid", "archived_at": "iso8601|null" }`
**Errors:** `NOT_FOUND`

### 3.6.1 `memory_forget`

Starts or executes an explicit owner-confirmed erasure workflow. This is not ordinary cleanup. It removes target content and derived material from active memory, search, embeddings, summaries, context packs, and UI surfaces.

**Input JSON:**

```json
{
  "target": {
    "kind": "event|chunk|agent_memory|raw_artifact|search_query|scope_selector",
    "id": "uuid-or-string|null",
    "selector": {}
  },
  "reason": "string|null",
  "dry_run": true,
  "confirmation": {
    "confirmed": false,
    "confirmation_token": "string|null"
  }
}
```

**Output JSON:**

```json
{
  "erasure_id": "uuid",
  "status": "preview|pending_confirmation|running|completed|failed|cancelled",
  "requires_confirmation": true,
  "affected": {
    "events": 0,
    "chunks": 0,
    "embeddings": 0,
    "agent_memories": 0,
    "raw_artifacts": 0,
    "derived_summaries": 0
  },
  "warnings": [],
  "redacted_receipt": {}
}
```

**Policy:**

- Default call is preview/dry-run and does not erase content.
- Erasure requires explicit owner confirmation unless a future dedicated retention policy says otherwise.
- Erasure records must not preserve the content being erased.
- Erasure must remove or redact source content and derived material consistently.
- If the target is broad, ambiguous, security-sensitive, or crosses project/developer scope, confirmation must show the affected scope and counts before execution.
- Chat/UI/CLI/MCP erasure must all use the same server-side erasure path.

### 3.7 `memory_get_checkpoint`

**Input:** `{}`  
**Output:** `{ "payload": { ... }, "updated_at": "iso8601" }`; payload may be null if uninitialized.

### 3.8 `memory_set_checkpoint`

**Input:** `{ "payload": { ... } }`  
Minimum payload schema:

```json
{
  "current_status": "string",
  "current_focus": "string",
  "next_step": "string",
  "last_event_id": "uuid|null",
  "open_questions": ["string"]
}
```

**Output:** `{ "ok": true, "updated_at": "iso8601" }`

### 3.9 `memory_create_agent_memory`

Creates a governed structured memory record. Agent-created records are allowed to be created automatically when they include provenance and pass validation. Ordinary records may be immediately `accepted`/`recall_allowed`, but they may not silently become `instruction_grade`.

**Input JSON:**

```json
{
  "memory_type": "decision|constraint|lesson|failure|work_log|open_question|artifact_reference|preference|procedure",
  "scope": "project|developer",
  "scope_kind": "domain|developer|environment|project|repo|subproject|session|connector_account|capability|client_adapter|null",
  "scope_id": "uuid-or-stable-id|null",
  "audience": [
    {
      "kind": "all_agents|specific_client|context_pack|background_worker|review_ui|human_owner|import_pipeline|connector",
      "id": "string|null"
    }
  ],
  "title": "string",
  "body": "string",
  "confidence": 0.0,
  "source_refs": [
    {
      "source_kind": "event|chunk|raw_artifact|edge|checkpoint|external",
      "source_id": "uuid-or-string",
      "quote": "string|null"
    }
  ],
  "created_by": "agent|user|system|import",
  "metadata": {}
}
```

**Output JSON:**

```json
{
  "memory_id": "uuid",
  "status": "candidate|accepted|needs_review",
  "use_policy": "evidence_only|recall_allowed|instruction_grade"
}
```

**Policy:**

- `created_by=agent` requires at least one `source_ref`.
- Agent-created records may default to `accepted` + `recall_allowed` for ordinary memories after validation.
- Agent-created records may default to `candidate` + `recall_allowed` for non-binding candidate rules.
- Agent-created records may default to `needs_review` + `evidence_only` for low-confidence, high-risk, conflicting, or broad inferred rule candidates.
- Broad/high-risk scope kinds such as developer, environment, capability, connector_account, and client_adapter require explicit validation/review before becoming binding instructions.
- `instruction_grade` is only allowed through direct explicit user instruction, review/import/user-confirmed flow, or another trusted promotion path.
- Review is available for correction, curation, archive, reject, supersede, edit, merge, and promotion/demotion; it is not required before every memory is useful.

### 3.10 `memory_review_agent_memory`

Updates review/use state for a governed memory.

**Input JSON:**

```json
{
  "memory_id": "uuid",
  "action": "accept|approve|reject|supersede|archive|unarchive|mark_stale|promote_instruction|demote_instruction|edit|merge",
  "superseded_by": "uuid|null",
  "merge_memory_ids": ["uuid"],
  "patch": {
    "title": "string|null",
    "body": "string|null",
    "scope": "project|developer|null",
    "scope_kind": "string|null",
    "scope_id": "string|null",
    "audience": [],
    "memory_type": "string|null"
  },
  "note": "string|null",
  "actor_kind": "user|agent|system"
}
```

Policy:

- `edit` must preserve source refs and write previous values into review action metadata.
- `merge` keeps one canonical memory active and marks duplicates as superseded/archived with duplicate/supersede relations.
- `approve` is a compatibility alias for `accept`; stored lifecycle status is `accepted`.

**Output JSON:**

```json
{
  "ok": true,
  "memory_id": "uuid",
  "status": "candidate|accepted|rejected|archived|superseded|stale|needs_review",
  "use_policy": "evidence_only|recall_allowed|instruction_grade|do_not_use"
}
```

### 3.10.1 `memory_list_agent_memories`

Lists governed memories for management surfaces such as inbox, active rules, duplicate/conflict reports, and owner review. This is an admin/agent management tool, not the primary recall tool for doing task work.

**Input JSON:**

```json
{
  "view": "inbox|rules|candidates|duplicates|conflicts|all",
  "project_id": "uuid|null",
  "scope": "project|developer|null",
  "scope_kind": "string|null",
  "audience_kind": "string|null",
  "memory_domain": "string|null",
  "status": "candidate|accepted|rejected|archived|superseded|stale|needs_review|null",
  "use_policy": "evidence_only|recall_allowed|instruction_grade|do_not_use|null",
  "limit": 50
}
```

**Output:** bounded list of memory summaries with ids, title, memory_type, scope/scope_kind/audience, status, use_policy, confidence, updated_at, and flags such as `possible_duplicate` or `possible_conflict`.

### 3.10.2 `memory_get_agent_memory`

Returns one governed memory with full body, source refs, review history, and related duplicate/conflict/supersede edges.

**Input:** `{ "memory_id": "uuid" }`

**Output:** one memory record plus `source_refs`, `review_actions`, and `related_memories`.

### 3.11 `memory_recall_agent_memories`

Returns bounded governed memories relevant to the current task. This complements `memory_search`, which returns raw chunk evidence.

**Input JSON:**

```json
{
  "query": "string",
  "scope": "project|developer|all",
  "scope_kind": "string|null",
  "audience_kind": "string|null",
  "memory_types": ["decision", "constraint", "lesson"],
  "include_candidates": false,
  "include_stale": false,
  "include_needs_review": false,
  "top_k": 8,
  "max_chars_total": 12000
}
```

`top_k` and `max_chars_total` here are standard-profile examples. The implementation must enforce configured policy caps rather than treating these numbers as universal constants.

**Output JSON:**

```json
{
  "trace_id": "uuid",
  "memories": [
    {
      "memory_id": "uuid",
      "memory_type": "decision",
      "title": "string",
      "body_excerpt": "string",
      "status": "accepted",
      "use_policy": "recall_allowed",
      "scope_kind": "project",
      "audience": [],
      "source_refs": [],
      "why": "lexical|semantic|recency|graph|manual"
    }
  ],
  "truncated": true
}
```

### 3.12 `memory_report_recall_usage`

Lets an agent report which recalled items were actually used, ignored, or unsafe for the task.

**Input JSON:**

```json
{
  "trace_id": "uuid",
  "used_memory_ids": ["uuid"],
  "ignored_memory_ids": ["uuid"],
  "used_chunk_ids": ["uuid"],
  "note": "string|null"
}
```

**Output:** `{ "ok": true }`

### 3.13 `memory_closeout`

Runs durable closeout for a clearly ending/pausing session. This is heavier than normal checkpoint update.

**Input JSON:**

```json
{
  "session_id": "uuid",
  "closeout_intent": "manual_exit|pause|task_complete|context_compaction|other",
  "summary": "string",
  "checkpoint_payload": {
    "current_status": "string",
    "current_focus": "string",
    "next_step": "string",
    "last_event_id": "uuid|null",
    "open_questions": ["string"]
  },
  "governed_memory_candidates": [
    {
      "memory_type": "decision|constraint|lesson|failure|work_log|open_question|artifact_reference|preference|procedure",
      "title": "string",
      "body": "string",
      "confidence": 0.0,
      "source_refs": []
    }
  ],
  "artifact_refs": [
    {
      "kind": "file|commit|url|external",
      "ref": "string",
      "note": "string|null"
    }
  ]
}
```

**Output JSON:**

```json
{
  "ok": true,
  "session_id": "uuid",
  "checkpoint_updated_at": "iso8601",
  "created_memory_ids": ["uuid"],
  "needs_review_ids": ["uuid"],
  "spool_sync_status": "not_applicable|synced|unsynced|failed",
  "report_required": false,
  "warnings": [],
  "project_log_update": {
    "required": true,
    "suggested_payload": {}
  }
}
```

**Policy:**

- `memory_closeout` preserves current session state; it does not import historical docs/git/exports automatically.
- The server applies the same governed-memory validation and instruction-grade policy as `memory_create_agent_memory`.
- If repo-native `PROJECT_LOG.md` cannot be updated by the server/adapter, the tool returns a suggested payload and the agent updates the file.
- `report_required=false` when closeout succeeds without warnings. Set `report_required=true` when there are unsynced spool records, conflicts, `candidate`/`needs_review` items, failed writes, incomplete repo sync, low-confidence extraction, or server/model/provider errors.
- A dead client cannot call closeout after crashing; abnormal recovery depends on incremental capture, local spool, and `memory_start_session` recovery.

## 4. JSON Schema delivery

Implementation must export JSON Schema for every tool through MCP capabilities and generate it from one source of truth in code.

## 5. Backwards compatibility

Adding fields must be additive and must not break existing keys. Removing fields requires a major server version plus an ADR.
