# Retrieval

Goal: high-quality recall with configurable hard limits on MCP tool response size.

Recallant retrieval must be contextual, not keyword-only. Lexical search is necessary for exact terms, file names, IDs, and rare tokens, but the platform must also find memories by task meaning, prior decisions, and related context through embeddings, governed memory types, graph expansion, scope, decay/salience, and provenance.

## 1. Public API (logical)

Raw evidence retrieval is implemented through the MCP tool `memory_search` and optionally `memory_fetch_chunk`.

Governed memory recall is implemented through the separate MCP tool `memory_recall_agent_memories`. Agents must understand the difference:

- `memory_search` returns L1 evidence chunks.
- `memory_recall_agent_memories` returns structured L3 AgentMemory records with review/use metadata.
- For complex tasks, agents normally call both: governed memories first for durable decisions/rules, then raw chunks for evidence.

Raw workflow artifacts are not normal recall payloads. Search may return bounded excerpts and source refs derived from raw artifacts, but full raw artifacts are for explicit inspection, Review UI, recovery, debugging, or reprocess jobs. Startup context must never become a raw archive dump.

### Inputs

- `project_id`: implicit from session config.
- `developer_id`: implicit from session config.
- `query`: string.
- `mode`: `hybrid` (default), `vector_only`, or `lexical_only`.
- `scope`: `project` (default), `developer`, or `all`.
  - `project`: chunks from the current project plus applicable developer-scope chunks.
  - `developer`: only developer-scope chunks across projects.
  - `all`: all chunks for the current developer, intended for explicit cross-project review or
    source-linked example search, not default startup context.
- `recall_intent`: logical intent such as `same_project`, `developer_rules`, `environment`,
  `similar_projects`, or `all_projects_review`. Early implementations may map this to `scope` plus
  filters, but responses must still label cross-project results clearly.
- `scope_kind` / `audience` filters may further narrow results according to ADR-0040. The simple `scope=project|developer|all` API is a convenience layer; server-side policy must still respect environment, connector_account, capability, client_adapter, and audience constraints.
- `top_k`: policy default, bounded by configured server cap.
- `max_chars_total`: policy default, bounded by configured server cap.
- `graph_expand`: boolean, default false.
- `graph_budget_nodes`: policy default, bounded by configured server cap.

Concrete defaults such as `top_k=8`, `max_chars_total=12000`, and `graph_budget_nodes=8` may ship in the standard profile, but they are tuning defaults, not architecture invariants. See [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md).

### Output shape

List of hits. Each hit includes:

- `chunk_id`
- `score`
- `text_excerpt`
- `source_event_id`
- `occurred_at`
- `why`: `vector`, `lexical`, `graph`, or `rerank`

## 2. Hybrid algorithm (v1 baseline)

1. **Lexical:** use `ts_rank_cd` or an equivalent query over `chunks.tsv` to build candidate set `C_lex`, limited by policy.
2. **Vector:** take top `N_vec` by cosine distance from `embeddings`, limited by policy.
3. **Fusion:** union `C_lex` and `C_vec`, deduplicate by `chunk_id`, and exclude chunks where `archived_at IS NOT NULL`.
4. **Rerank:** compute combined score with decay and supersede penalty:

   ```text
   S_base  = a * norm_vector + b * norm_lexical
   decay   = max(MIN_DECAY, 0.5 ^ (age_days / halflife))
   penalty = 0.1 when chunk has an incoming supersedes edge, otherwise 1.0
   S_final = S_base * decay * penalty
   ```

5. **Truncate:** take top `top_k` by `S_final`, then cap total returned text to `max_chars_total` in score order. Avoid cutting mid-word; mid-sentence truncation with a suffix is acceptable.

Constants such as `a`, `b`, `N_lex`, `N_vec`, caps, and decay parameters are configurable policy/profile values. Tests should verify bounded behavior and relative ranking, not arbitrary exact defaults.

Embeddings are a retrieval index, not the memory itself. Durable content remains raw L0 plus materialized chunks and governed memories. If embeddings are rebuilt or replaced, provenance and text remain intact unless explicit erasure applies.

For large raw artifacts, chunks may be generated from bounded excerpts, extracted text, or policy-approved slices. The artifact pointer/hash remains the durable provenance, while retrieval returns only bounded text.

## 2.1 Governed memory recall

`memory_recall_agent_memories` uses the same bounded-response discipline as `memory_search`, but filters by governance first:

1. Exclude `rejected`, `archived`, `superseded`, `stale`, `candidate`, `needs_review`, and `do_not_use` by default.
2. Include `candidate`, `stale`, or `needs_review` only when the caller explicitly requests them for review/investigation.
3. Prefer `instruction_grade` and `recall_allowed` over `evidence_only`, but only `accepted` records can act as durable behavioral guidance.
4. Rank by lexical/semantic match, recency, confidence, and optional source graph proximity.
5. Return source refs with each memory so the agent can inspect evidence before relying on it.
6. Create a `recall_traces` row and return `trace_id`.

Callers may pass `source_id` to narrow same-project governed-memory recall to memories linked to a
selected project source. This is useful when the owner or agent asks "what came from this folder,
document, connector, or manual source?" The filter must not hide session/capture health in the UI,
and it must not silently mix cross-project examples into the current project.

Scope/audience filtering is mandatory before ranking:

- exclude memories outside the current project/repo/subproject unless the caller explicitly requests broader scope;
- include developer-scope rules only when applicable to the current domain/task;
- include environment facts only for the current Recallant instance or explicit restore/remap workflows;
- include connector/capability bindings only when relevant to the task/project;
- include client-adapter guidance only for the active client or explicit review;
- never treat candidate/needs-review records as binding even if scope matches.

Instruction-grade memories are not automatically true forever. They can be superseded, demoted, archived, or contradicted by later evidence.

When retrieved memories conflict, the caller and Context Pack Builder must apply ADR-0041:

- filter by applicability first;
- prefer higher authority;
- prefer narrower scope;
- prefer later accepted decisions when authority/scope match;
- surface high-risk or equal-authority conflicts instead of silently choosing.

## 2.2 Controlled cross-project recall

Ordinary retrieval should not mix all project memory into the current session. Cross-project recall
is an explicit source-linked mode for finding examples and prior patterns.

When `recall_intent="similar_projects"` or an equivalent explicit mode is used:

- return hits from other projects only as examples/evidence unless their scope/use policy is already
  applicable;
- include source project id/name, source path/ref, status, use policy, scope kind, and applicability
  warning in the response metadata;
- do not let a hit from project B become a rule for project A without a new project-A governed memory
  proposal or owner/review promotion;
- never expose raw secret values from another project.

## 2.3 Access tracking

After the final hit list is formed, update access metadata asynchronously so the response is not blocked:

```sql
UPDATE chunks
SET last_accessed_at = now(),
    access_count = access_count + 1
WHERE id = ANY(<returned_chunk_ids>)
```

## 3. Graph expansion (optional)

If `graph_expand=true`:

- take top `m` chunks after the baseline retrieval step, where `m` is a policy default bounded by `top_k`;
- for each chunk, select incident edges from `edges` up to `graph_budget_nodes` total across all BFS starts with deduplication;
- add neighboring chunks to the pool with `why=graph` and a policy-defined lower weight;
- repeat fusion/truncate while respecting `max_chars_total`.

## 4. `memory_fetch_chunk`

- Input: `chunk_id`.
- Output: full chunk `text` plus metadata, capped by `max_chars`. Large chunks may use pagination in v2 through a future ADR.

## 5. Quality guardrails

- Do not return a hit without `source_event_id`.
- If embeddings are unavailable, automatically degrade to `lexical_only` and mark this in logs/metadata.
- Archived chunks are excluded unless `include_archived=true`.
- If a chunk has `superseded_by`, add it to the hit for transparency.
- Erased chunks/content must never be returned in ordinary search, context packs, or fetch APIs.

## 6. Observability

See `OBSERVABILITY.md` for latency, candidate counts, truncation stats, and recall tracing.
