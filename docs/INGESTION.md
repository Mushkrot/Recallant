# Ingestion

Goal: deterministically populate **L0 (`events`)** and then derive **L1/L2/L3** according to `DATA_MODEL.md`.

## 1. Canonical event shape

Each L0 record is a row in `events` with fields from the data model. Minimal turn payload:

```json
{
  "text": "string",
  "attachments": [],
  "raw_artifacts": []
}
```

Extensions must use versioned keys such as `schema_version` inside `payload`.

Ordinary captured user/assistant turns can store full text in `payload.text`. For large workflow evidence, `payload.text` should be a bounded excerpt or summary, while `payload.raw_artifacts` points to `raw_artifacts` records that preserve full evidence outside the normal context path.

## 2. Ingest channels

### 2.1 MCP `memory_append_turn` (primary)

- **Source:** `ingest_source = mcp_append`
- **Idempotency:** client may pass `dedup_key`; server writes to `ingest_dedup_keys` and returns the same `event_id` on retry.
- For Codex-first v1, this is the preferred live path when the MCP server is reachable.

Important: Recallant must not rely only on end-of-session capture. `memory_append_turn`, checkpoint updates, governed-memory writes, and local spool provide incremental safety during work. Full closeout is an additional durable consolidation step, not the only write path.

### 2.1.1 MCP `memory_append_event` (workflow evidence)

`memory_append_turn` is for user/assistant conversation turns. Non-turn workflow evidence uses `memory_append_event`:

- tool calls/results,
- terminal output,
- file-change observations,
- system warnings,
- large output excerpts with raw artifact refs.

This keeps Recallant universal across clients. Codex is the first adapter, but other clients can report the same event kinds through the same contract.

### 2.2 File import (secondary)

- Batch JSONL / NDJSON in an agreed format; schema fixtures live in `TEST_CONTRACT.md`.
- **Source:** `ingest_source = file_import`
- Used for prototypes and migrations from CLI exports.

### 2.3 CLI exports (tertiary, explicit)

Each CLI gets a separate mapping when a real stable export format exists:

| CLI | Status v1 | Notes |
|-----|-----------|-------|
| Cursor | Adapter research pending | Stable export path is not part of the v1 core contract; until then use MCP append plus explicit JSONL import when available. |
| Windsurf | Adapter research pending | Same boundary as Cursor: adapter-specific export mapping is future work, not a v1 blocker. |
| Claude Code | Adapter research pending | Account for compaction by preferring Recallant-side append during the session; CLI export mapping is future adapter work. |

Rule: missing auto-export does not block v1 if MCP append works.

### 2.4 System events

- `kind=system` for reindex, migration markers, warnings, repairs, and internal events.

### 2.5 Local capture spool + server offload

When the working machine cannot reach the Recallant server, or when direct live capture is not available, the agent/CLI writes append-only local JSONL spool files and later syncs them to the server. This is a required resilience path for the product, even if implementation is staged after the primary MCP write path.

Target behavior:

- Local spool is append-only and idempotent through `dedup_key` / payload hash.
- `recallant sync-spool` uploads unsynced records to the server and records server `event_id` mappings.
- Server remains the canonical SoT after sync.
- Spool files are not a replacement for Postgres; they are a resilience/offline/offload buffer.
- After confirmed sync, local spool records can be compacted/pruned while retaining a sync manifest.

Use cases:

- context compaction protection when live MCP write path is unavailable;
- working on a laptop while the server is temporarily offline;
- bulk importing captured transcripts overnight;
- slow or unreliable network where local write must not block user/agent work.

Capture coverage depends on client capability and configured capture profile. Current direction is managed hybrid capture: preserve raw evidence broadly where feasible, but let governed memory, checkpoint, scoring, review, and scope decide what influences future agent behavior. See [ADR-0017-managed-hybrid-capture.md](ADR-0017-managed-hybrid-capture.md).

### 2.5.1 Raw workflow evidence and artifact offload

Accepted policy: raw workflow evidence is the lower factual foundation, while governed memory is the upper behavior layer. See [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md).

For v1:

- ordinary captured user/assistant turns are stored in L0 `events`;
- tool/terminal output depth is controlled by capture profile;
- very large outputs/media/attachments/transcript exports are stored as raw artifacts;
- Postgres keeps metadata, excerpt, hash, size, and pointer;
- full payload can live in local spool or server filesystem storage;
- object storage is an evolution path, not a v1 dependency.

Raw artifacts are evidence. They must not be automatically promoted into instructions, and they must not be dumped into `memory_get_context_pack`.

### 2.5.2 Session interruption recovery

Abnormal interruption is expected: the agent process, terminal, network, or machine can stop before closeout.

Recovery model:

- every agent session starts with `memory_start_session`;
- session-scoped tool calls update `sessions.last_seen_at`;
- optional `memory_heartbeat` updates `last_seen_at` and heartbeat metadata for long-running/idle tasks without creating L0 events;
- normal closeout marks the session closed through `memory_closeout`;
- unclosed sessions remain visible as interrupted/recovery candidates;
- the next session receives last checkpoint, last captured event, and available spool/sync status;
- recovery never fabricates missing turns; it resumes from durable evidence and clearly marks gaps.

This is client-neutral. Codex is the first tested path, but the same recovery model must work for other clients and multi-agent workflows.

Heartbeat is not an ingest channel. It is liveness metadata, not memory content.

## 2.6 Capture policy and profiles

Recallant must not use one fixed capture depth for every project.

Plain-language rule:

- important/complex projects can record more detail;
- simpler projects can record only the essentials;
- future agents still receive bounded, relevant context rather than raw archive dumps.

Capture policy controls:

- user/assistant turn capture: full, summarized, or closeout-only;
- tool calls: metadata only, summary, or capped raw excerpt;
- terminal output: errors/tail only, capped excerpts, or explicit full capture, with full large output stored as raw artifact when policy allows it;
- closeout detail level;
- governed-memory extraction aggressiveness;
- local spool retention before server sync/offload;
- secret handling: reject, mask, or warn.

Initial profile examples:

| Profile | Intended use | Behavior |
|---------|--------------|----------|
| `light` | simple/low-risk projects | mostly checkpoint, closeout, important decisions, failures, explicit rules |
| `standard` | normal daily coding work | broad turns, key tool metadata, errors, decisions, lessons, governed memories |
| `detailed` | complex/important projects | richer raw evidence, stronger provenance, more aggressive extraction |
| `custom` | project-specific needs | explicit override with visible reason |

Default selection:

- `recallant init` assigns `standard` automatically for normal coding projects.
- The owner can override immediately with a command option or later through UI/CLI settings.
- The selected effective profile should be visible in `recallant init --dry-run`, project settings, and Review UI.
- Later profile changes apply only to the current project and only to future capture. Existing records are not reprocessed unless the owner runs an explicit reprocess/import/extraction workflow.

Policy resolution order:

1. explicit task/session override;
2. project policy;
3. developer default policy;
4. server default profile;
5. built-in implementation default.

The effective policy must be inspectable in CLI/UI.

Settings source of truth is Recallant server/Postgres. Local `.recallant/config` only points to `project_id` and `recallant_server_url`; it does not store authoritative capture policy. See [SETTINGS.md](SETTINGS.md).

## 2.7 Explicit imports

v1 supports explicit imports for important project context that is not captured through live conversation:

- selected project docs;
- git history excerpts;
- PR/issue exports;
- external links or notes;
- previous `PROJECT_LOG.md` / archive files.

Explicit import is different from automatic full-repo ingestion. It should preserve provenance, source path/URL, import timestamp, and project/developer scope.

`recallant init` must not create `import_batch` events by itself. It may only detect candidates and suggest explicit `recallant import ...` commands. Natural-language closeout also must not import historical material automatically; it preserves current session state.

## 3. Chunking policy (L1)

Deterministic rules must match configured policy and tests:

- split long `payload.text` into chunks by configured `max_chars`;
- overlap is optional in v1; if enabled, configure `overlap_chars` in one policy/config location.

Chunking numbers are operational heuristics. They must be deterministic for a configured policy, but not hard-coded architecture invariants.

## 4. Embedding policy

- Embedding model and dimensions come from `RECALLANT_EMBEDDING_MODEL` and `RECALLANT_EMBEDDING_DIMS`.
- Any chunk without embedding has an explicit status through embeddings presence or a `chunks` flag if added by migration. Minimum v1: missing row in `embeddings` means pending.

### Batching

Embedding calls must be batched when the provider supports batching:

- `RECALLANT_EMBED_BATCH_SIZE` controls batch size.
- For `memory_append_turn`, send all chunks from one turn as one batch when practical.
- For `file_import`, buffer chunks up to `RECALLANT_EMBED_BATCH_SIZE`.
- For Ollama, use `/api/embed` with an array of strings, not `/api/embeddings` with one string.

Concrete batch examples are illustrative. The hard rule is batched embedding calls where provider supports batching; exact batch size is configurable.

### Async vs sync

| Mode | When to use | Behavior |
|------|-------------|----------|
| `sync` (default v1) | real-time `memory_append_turn` | L0 + chunks are written in one transaction; embedding happens in the same transaction or immediately after with explicit `pending` status |
| `async` | `file_import`, reindex | Chunks are written immediately as `pending_embed`; background worker processes batches |

When chunks have `pending_embed`, `memory_search` automatically degrades to `lexical_only` for those chunks and marks this in the response.

### Embedding model changes (re-embed)

Vectors from different models/dimensions are incompatible. When changing `RECALLANT_EMBEDDING_MODEL`:

1. Change config; new chunks start using the new model.
2. Run `recallant reindex --model <new_model>`.
3. Until reindex finishes, search degrades to `lexical_only` or same-model subsets for old chunks.
4. Dimension changes require pgvector index recreation/migration.

Implementation must block silent model/dimension changes without explicit reindex/migration.

### Recommended providers

| Option | Model | Dims | Cost | Privacy |
|--------|-------|------|------|---------|
| Self-hosted initial default | `nomic-embed-text` via existing configured Ollama | 768 | no external token bill | data stays on server |
| Cloud fallback | `text-embedding-3-small` (OpenAI) | 1536 | paid | data goes to OpenAI |
| Cloud alternate | `gemini-embedding-001` / `gemini-embedding-2` | provider-specific | paid | data goes to Gemini |

Target deployment is one Linux server; self-hosted is preferred. `nomic-embed-text` / 768 dimensions is an initial default. The selected model/dimensions are configuration and require explicit reindex/migration when changed.

The active embedding provider must match the indexed vectors. If a project switches from local embeddings to OpenAI/Gemini or changes dimensions, Recallant must require explicit reindex/migration and must not silently mix incompatible vectors.

## 5. Ordering and clocks

- `occurred_at` for user turns comes from the client if valid ISO8601 is provided; otherwise use server `now()`.
- Always store `created_at` server-side.

## 6. Failure modes

- Duplicate `dedup_key` -> HTTP/MCP error `CONFLICT` with body `{ "existing_event_id": "..." }`; see `MCP_SPEC.md`.
- DB unavailable -> `UNAVAILABLE` without partial write; use a transaction.
- Erasure requested for content not controlled by Recallant -> return a partial/unsupported warning and remove Recallant-controlled derived material.
