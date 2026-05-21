# Retrieval

Цель: **высокое качество recall** при **настраиваемых жёстких лимитах** на размер ответа MCP tool.

AMP retrieval must be contextual, not keyword-only. Lexical search is necessary for exact terms, file names, IDs, and rare tokens, but the platform must also find memories by task meaning, prior decisions, and related context through embeddings, governed memory types, graph expansion, scope, decay/salience, and provenance.

## 1. Public API (logical)

Raw evidence retrieval реализуется внутри MCP tool `memory_search` (и опционально `memory_fetch_chunk`).

Governed memory recall реализуется отдельным MCP tool `memory_recall_agent_memories`. Агент должен понимать различие:

- `memory_search` возвращает evidence chunks из L1.
- `memory_recall_agent_memories` возвращает structured AgentMemory records из L3 с review/use metadata.
- Для сложной задачи агент обычно вызывает оба: сначала governed memories для устойчивых решений/правил, затем raw chunks для evidence.

Raw workflow artifacts are not normal recall payloads. Search may return bounded excerpts and source refs derived from raw artifacts, but full raw artifacts are for explicit inspection, Review UI, recovery, debugging, or reprocess jobs. Startup context must never become a raw archive dump.

### Inputs

- `project_id` (implicit из session config)
- `developer_id` (implicit из session config)
- `query` (string)
- `mode` (enum): `hybrid` (default) | `vector_only` | `lexical_only`
- `scope` (enum): `project` (default) | `developer` | `all`
  - `project`: chunks текущего проекта + chunks с `scope=developer` данного developer
  - `developer`: только chunks с `scope=developer` данного developer (все проекты)
  - `all`: все chunks всех проектов данного developer
- `scope_kind` / `audience` filters may further narrow results according to ADR-0040. The simple `scope=project|developer|all` API is the convenience layer; server-side policy must still respect environment, connector_account, capability, client_adapter, and audience constraints.
- `top_k` (int, policy default; bounded by configured server cap)
- `max_chars_total` (int, policy default; bounded by configured server cap)
- `graph_expand` (bool, default **false**)
- `graph_budget_nodes` (int, policy default; bounded by configured server cap)

Concrete defaults such as `top_k=8`, `max_chars_total=12000`, and `graph_budget_nodes=8` may ship in the standard profile, but they are tuning defaults, not architecture invariants. See [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md).

### Output shape

Список hits, каждый hit:

- `chunk_id`
- `score` (float)
- `text_excerpt` (bounded substring of chunk)
- `source_event_id`
- `occurred_at`
- `why` (string) — кратко: `vector` | `lexical` | `graph` | `rerank`

## 2. Hybrid algorithm (v1 baseline)

1. **Lexical:** `ts_rank_cd` или эквивалент по `chunks.tsv` → candidate set `C_lex` (limit `N_lex`, policy default).
2. **Vector:** top `N_vec` по cosine distance из `embeddings` (policy default).
3. **Fusion:** union `C_lex ∪ C_vec`, dedupe by `chunk_id`. Исключить chunks где `archived_at IS NOT NULL`.
4. **Rerank:** combined score с decay и supersede penalty:
   ```
   S_base  = a * norm_vector + b * norm_lexical          (a/b are policy defaults)
   decay   = max(MIN_DECAY, 0.5 ^ (age_days / halflife)) (см. CLEANUP.md)
   penalty = 0.1 если chunk имеет входящее ребро supersedes, иначе 1.0
   S_final = S_base * decay * penalty
   ```
5. **Truncate:** top `top_k` по `S_final`, затем усечь суммарный текст до `max_chars_total` по порядку score (не разрывая mid-word — допускается mid-sentence cut с суффиксом `…`).

Константы `a`, `b`, `N_lex`, `N_vec`, caps и decay параметры — настраиваемые policy/profile values. Tests should verify bounded behavior and relative ranking, not arbitrary exact defaults.

Embeddings are a retrieval index, not the memory itself. The durable content remains raw L0 plus materialized chunks and governed memories. If embeddings are rebuilt or replaced, provenance and text remain intact.

For large raw artifacts, chunks may be generated from bounded excerpts, extracted text, or policy-approved slices. The artifact pointer/hash remains the durable provenance, while retrieval returns only bounded text.

## 2.2 Governed memory recall

`memory_recall_agent_memories` uses the same bounded-response discipline as `memory_search`, but filters by governance first:

1. Exclude `rejected`, `archived`, `superseded`, `stale`, `candidate`, `needs_review`, and `do_not_use` by default.
2. Include `candidate`, `stale`, or `needs_review` only when the caller explicitly requests them for review/investigation.
3. Prefer `instruction_grade` and `recall_allowed` over `evidence_only`, but only `accepted` records can act as durable behavioral guidance.
4. Rank by lexical/semantic match, recency, confidence, and optional source graph proximity.
5. Return source refs with each memory so the agent can inspect evidence before relying on it.
6. Create a `recall_traces` row and return `trace_id`.

Scope/audience filtering is mandatory before ranking:

- exclude memories outside the current project/repo/subproject unless caller explicitly requests broader scope,
- include developer-scope rules only when applicable to the current domain/task,
- include environment facts only for the current AMP instance or explicit restore/remap workflows,
- include connector/capability bindings only when relevant to the task/project,
- include client-adapter guidance only for the active client or explicit review,
- never treat candidate/needs-review records as binding even if scope matches.

Instruction-grade memories are not automatically true forever. They can be superseded, demoted, archived, or contradicted by later evidence.

When retrieved memories conflict, the caller and Context Pack Builder must apply ADR-0041:

- filter by applicability first,
- prefer higher authority,
- prefer narrower scope,
- prefer later accepted decisions when authority/scope match,
- surface high-risk or equal-authority conflicts instead of silently choosing.

## 2.1 Access tracking

После формирования финального списка hits, **асинхронно** (не блокируя ответ):
```sql
UPDATE chunks
SET last_accessed_at = now(),
    access_count = access_count + 1
WHERE id = ANY(<returned_chunk_ids>)
```

Константы `N_lex`, `N_vec` — policy/profile values.

## 3. Graph expansion (optional step)

Если `graph_expand=true`:

- Взять top `m` chunks после шага 5 (`m` policy default, bounded by `top_k`).
- Для каждого chunk, выбрать инцидентные рёбра из `edges` до `graph_budget_nodes` суммарно по всем стартам BFS с дедупом.
- Добавить соседние chunks в pool с пометкой `why=graph` и policy-defined понижающим весом к rerank.
- Повторить fusion+truncate с учётом общего `max_chars_total`.

## 4. `memory_fetch_chunk`

- Input: `chunk_id`
- Output: полный `text` chunk + metadata, но **не более** `max_chars` (default same as single chunk max in tests) — для больших chunk допускается pagination в v2 (ADR).

## 5. Quality guardrails

- Запрет возвращать hit без `source_event_id`.
- Если нет embeddings (cold start), автоматически деградировать в `lexical_only` с пометкой в логе.
- Archived chunks (`archived_at IS NOT NULL`) не возвращаются если не передан `include_archived=true`.
- Если chunk имеет `superseded_by` — добавить это поле в hit для прозрачности.

## 6. Observability

См. `OBSERVABILITY.md`: latency, counts candidates, truncation stats.
