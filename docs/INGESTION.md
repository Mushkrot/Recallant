# Ingestion

Цель: детерминированно наполнять **L0 (`events`)** и далее порождать **L1/L2** согласно `DATA_MODEL.md`.

## 1. Canonical event shape

Каждая запись в L0 — строка в `events` с полями из модели. Минимальный `payload` для turn:

```json
{
  "text": "string",
  "attachments": [],
  "raw_artifacts": []
}
```

Расширения только через версионирование ключа `schema_version` внутри `payload` (рекомендуется добавить с фазы 1).

Ordinary captured user/assistant turns can store their full text in `payload.text`. For large workflow evidence, `payload.text` should be a bounded excerpt or summary, while `payload.raw_artifacts` points to `raw_artifacts` records that preserve the full evidence outside the normal context path.

## 2. Ingest channels

### 2.1 MCP `memory_append_turn` (primary)

- **Source:** `ingest_source = mcp_append`
- **Idempotency:** клиент может передать `dedup_key` (string); сервер записывает в `ingest_dedup_keys` и отвечает тем же `event_id` при повторе.
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

- Batch JSONL / NDJSON в согласованном формате (схема в `TEST_CONTRACT.md` fixtures).
- **Source:** `ingest_source = file_import`
- Используется для прототипов и миграций из экспортов CLI.

### 2.3 CLI exports (tertiary, explicit)

Для каждого CLI документируется **отдельный mapping** (отдельный subsection при появлении реального формата экспорта):

| CLI | Status v1 | Notes |
|-----|-------------|-------|
| Cursor | Adapter research pending | Stable export path is not part of the v1 core contract; until then use MCP append plus explicit JSONL import when available. |
| Windsurf | Adapter research pending | Same boundary as Cursor: adapter-specific export mapping is future work, not a v1 blocker. |
| Claude Code | Adapter research pending | Account for compaction by preferring Recallant-side append during the session; CLI export mapping is future adapter work. |

**Правило:** отсутствие авто-export **не блокирует** v1 если выполнен канал MCP append.

### 2.4 System events

- `kind=system` для reindex, migration markers, warnings.

### 2.5 Local capture spool + server offload

When the working machine cannot reach the Recallant server, or when direct live capture is not available, the agent/CLI writes append-only local JSONL spool files and later syncs them to the server. This is a required resilience path for the product, even if implementation is staged after the primary MCP write path.

Target behavior:

- Local spool is append-only and idempotent through `dedup_key` / payload hash.
- `recallant sync-spool` uploads unsynced records to the server and records server `event_id` mappings.
- Server remains the canonical SoT after sync.
- Spool files are not a replacement for Postgres; they are a resilience/offline/offload buffer.
- After confirmed sync, local spool records can be compacted/pruned while retaining a sync manifest.

Use cases:

- context compaction protection when the live MCP write path is unavailable,
- working on a laptop while the server is temporarily offline,
- bulk importing captured transcripts overnight.
- slow or unreliable network where local write must not block user/agent work.

Capture coverage depends on client capability and the configured capture profile. Current product direction is managed hybrid capture: preserve raw evidence broadly where feasible, but let governed memory, checkpoint, scoring, review, and scope decide what influences future agent behavior. See [ADR-0017-managed-hybrid-capture.md](ADR-0017-managed-hybrid-capture.md).

### 2.5.1 Raw workflow evidence and artifact offload

Accepted policy: raw workflow evidence is the lower factual foundation, while governed memory is the upper behavior layer. See [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md).

For v1:

- ordinary captured user/assistant turns are stored in L0 `events`,
- tool/terminal output depth is controlled by capture profile,
- very large outputs/media/attachments/transcript exports are stored as raw artifacts,
- Postgres keeps metadata, excerpt, hash, size, and pointer,
- the full payload can live in local spool or server filesystem storage,
- object storage is an evolution path, not a v1 dependency.

Raw artifacts are evidence. They must not be automatically promoted into instructions, and they must not be dumped into `memory_get_context_pack`.

### 2.5.2 Session interruption recovery

Abnormal interruption is expected: the agent process, terminal, network, or machine can stop before closeout.

Recovery model:

- every agent session starts with `memory_start_session`,
- session-scoped tool calls update `sessions.last_seen_at`,
- optional `memory_heartbeat` updates `last_seen_at` and heartbeat metadata for long-running/idle tasks without creating L0 events,
- normal closeout marks the session closed through `memory_closeout`,
- unclosed sessions remain visible as interrupted/recovery candidates,
- the next session receives the last checkpoint, last captured event, and available spool/sync status,
- recovery never fabricates missing turns; it resumes from durable evidence and clearly marks gaps.

This is client-neutral. Codex is the first tested path, but the same recovery model must work for other clients and multi-agent workflows.

Heartbeat is not an ingest channel. It is liveness metadata, not memory content.

## 2.6 Capture policy and profiles

Recallant must not use one fixed capture depth for every project.

Plain-language rule:

- important/complex projects can record more detail,
- simpler projects can record only the essentials,
- future agents still receive bounded, relevant context rather than raw archive dumps.

Capture policy controls:

- user/assistant turn capture: full, summarized, or closeout-only,
- tool calls: metadata only, summary, or capped raw excerpt,
- terminal output: errors/tail only, capped excerpts, or explicit full capture, with full large output stored as raw artifact when policy allows it,
- closeout detail level,
- governed-memory extraction aggressiveness,
- local spool retention before server sync/offload,
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

1. explicit task/session override,
2. project policy,
3. developer default policy,
4. server default profile,
5. built-in implementation default.

The effective policy must be inspectable in CLI/UI.

Settings source of truth is Recallant server/Postgres. Local `.recallant/config` only points to `project_id` and `recallant_server_url`; it does not store authoritative capture policy. See [SETTINGS.md](SETTINGS.md).

## 2.7 Explicit imports

v1 supports explicit imports for important project context that is not captured through live conversation:

- selected project docs,
- git history excerpts,
- PR/issue exports,
- external links or notes,
- previous `PROJECT_LOG.md` / archive files.

Explicit import is different from automatic full-repo ingestion. It should preserve provenance, source path/URL, import timestamp, and project/developer scope.

`recallant init` must not create `import_batch` events by itself. It may only detect candidates and suggest explicit `recallant import ...` commands. Natural-language closeout also must not import historical material automatically; it preserves current session state.

## 3. Chunking policy (L1)

Детерминированные правила (реализация должна совпасть с configured policy + tests):

- Разбиение длинного `payload.text` на chunks по configured **max_chars**.
- Overlap **optional** v1; если включён — configured `overlap_chars` в одном месте policy/config.

Chunking numbers are operational heuristics. They must be deterministic for a configured policy, but not hard-coded architecture invariants.

## 4. Embedding policy

- Модель embedding задаётся конфигом окружения `RECALLANT_EMBEDDING_MODEL`, `RECALLANT_EMBEDDING_DIMS`.
- Любой chunk без embedding имеет статус **явно** хранимый в `embeddings` presence или в `chunks` flag (если добавлено миграцией); минимум v1: отсутствие row в `embeddings` == pending.

### Batching

Embedding-вызовы **обязаны** быть батчевыми — не по одному chunk за вызов:

- Переменная окружения `RECALLANT_EMBED_BATCH_SIZE` (profile default).
- При `memory_append_turn` (1-3 chunks): батч из всех chunks одного turn — один HTTP-вызов к Ollama.
- При `file_import` (сотни turns): chunks накапливаются в буфер по `RECALLANT_EMBED_BATCH_SIZE` и отправляются пачками.
- Ollama `/api/embed` принимает массив строк — использовать именно этот endpoint, не `/api/embeddings` (single string).

Concrete batch examples are illustrative. The hard rule is batched embedding calls where provider supports batching; exact batch size is configurable.

### Async vs sync

| Режим | Когда использовать | Поведение |
|-------|-------------------|-----------|
| **sync** (default v1) | `memory_append_turn` в реальном времени | L0 + chunks пишутся в одной транзакции; embedding в той же транзакции или сразу после с явным `pending` статусом |
| **async** | `file_import`, reindex | Chunks пишутся немедленно со статусом `pending_embed`; фоновый worker обрабатывает батчами |

`memory_search` при наличии chunks со статусом `pending_embed` автоматически деградирует в `lexical_only` для этих chunks с пометкой в ответе.

### Смена embedding модели (re-embed)

**Важно:** векторы от разных моделей несовместимы. При смене `RECALLANT_EMBEDDING_MODEL`:

1. Изменить конфиг — новые chunks начнут писаться с новой моделью.
2. Запустить `recallant reindex --model <new_model>` — перезапишет все `embeddings` rows.
3. До завершения reindex — search деградирует в `lexical_only` для старых chunks.
4. Смена dims требует пересоздания pgvector индекса (миграция).

Процедура блокирует smena модели без явного `recallant reindex` — реализация должна это проверять.

### Рекомендуемые провайдеры

| Вариант | Модель | Dims | Стоимость | Приватность |
|---------|--------|------|-----------|-------------|
| **Self-hosted (initial default)** | `nomic-embed-text` via Ollama | 768 | бесплатно | данные не покидают сервер |
| **Cloud fallback** | `text-embedding-3-small` (OpenAI) | 1536 | платно (низкая цена) | данные уходят в OpenAI |
| **Cloud alternate** | `gemini-embedding-001` / `gemini-embedding-2` | provider-specific | платно | данные уходят в Gemini |

Целевой deployment — один Linux сервер; предпочтителен self-hosted вариант. `nomic-embed-text` / 768 dims is an initial default. The selected model/dims are configuration and require explicit reindex/migration when changed.

The active embedding provider must match the indexed vectors. If a project switches from local embeddings to OpenAI/Gemini or changes dimensions, Recallant must require explicit reindex/migration and must not silently mix incompatible vectors.

## 5. Ordering and clocks

- `occurred_at` для user turns — время от клиента если передано валидно ISO8601; иначе server `now()`.
- Всегда сохранять `created_at` server-side.

## 6. Failure modes

- Duplicate `dedup_key` → HTTP/MCP error `CONFLICT` с телом `{ "existing_event_id": "..." }` (см. `MCP_SPEC.md`).
- DB unavailable → `UNAVAILABLE` без частичной записи (транзакция).
