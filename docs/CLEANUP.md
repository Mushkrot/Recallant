# Cleanup and analysis

Goal: prevent stale, contradictory, duplicate, or low-value data from degrading retrieval and agent behavior.

Decision status: conservative v1 retention accepted. See [ADR-0035-conservative-retention-and-cleanup.md](ADR-0035-conservative-retention-and-cleanup.md). Managed AI-native cleanup and erasure are accepted in [ADR-0042-managed-ai-native-platform-and-operations.md](ADR-0042-managed-ai-native-platform-and-operations.md).

## 0. Retention v1

Recallant cleanup must not erase the source of truth by default.

Policy:

- L0 raw evidence: no automatic delete by default.
- Raw artifacts, transcripts, and log exports: no automatic delete by default.
- L1 derived data: chunks, embeddings, summaries, and indexes may be archived, rebuilt, refreshed, or removed from active retrieval.
- L3 governed memory: use archive, supersede, reject, or stale status; no silent hard delete by default.
- Local spool / unsynced data: delete only after confirmed sync.
- Operational queues/temp jobs: cleanup allowed after successful completion or configured timeout.
- Model/cost/audit logs: retain for dashboard, debugging, and accountability until explicit configured retention applies.

Default posture:

```text
Prefer archive/rebuild over hard delete.
Hard delete is an explicit owner action or a future configured retention policy, not default behavior.
```

## 1. Problem

The memory store accumulates several kinds of noise:

| Type | Example | Risk |
|------|---------|------|
| Stale decision | "Use Redis" followed later by "Use Postgres" | The agent sees both and may choose the wrong one. |
| Abandoned experiment | "Try GraphQL" after the project rejected it | The agent proposes obsolete architecture. |
| Low-value context | Debug sessions or temporary notes from months ago | Retrieval quality drops. |
| Duplicate rules | Same preference extracted repeatedly | Review becomes noisy and conflicts are harder to see. |
| Poor provenance | Memory with no clear source | Hard to trust, correct, or delete. |

## 2. Automatic score decay

Retrieval automatically lowers the score of older chunks so fresher decisions tend to rank higher.

Formula:

```text
decay(chunk) = max(MIN_DECAY, 0.5 ^ (age_days / halflife_days))
score_final = S * decay(chunk)
```

Where:

- `age_days` is the age since `chunks.occurred_at`;
- `halflife_days` is configured by policy/profile;
- `MIN_DECAY` is the configured lower bound;
- `S` is the hybrid score from `RETRIEVAL.md`.

Different scopes may use different halflives. Values such as 90/365 days are tuning defaults, not architecture invariants.

`RECALLANT_DECAY_ENABLED=false` disables decay for debugging or special profiles.

## 3. Explicit supersede

An agent or owner can mark a newer chunk as replacing an older chunk:

```text
memory_link(
  src_kind="chunk", src_id=<new_chunk>,
  dst_kind="chunk", dst_id=<old_chunk>,
  relation_type="supersedes"
)
```

Retrieval applies a policy-defined penalty to the superseded chunk and exposes `superseded_by` in results for transparency.

## 4. Access tracking

Each `memory_search` or `memory_fetch_chunk` updates:

- `chunks.last_accessed_at`;
- `chunks.access_count`.

The update should be asynchronous after the response is sent so retrieval latency is not inflated.

## 5. Archiving

Archiving excludes a chunk from ordinary search while preserving data:

- MCP tool: `memory_archive(chunk_id)`;
- archived chunks are excluded from `memory_search` by default;
- `memory_search(include_archived=true)` can include them explicitly;
- L0 events are not archived by ordinary cleanup; only derived chunks are.

Raw artifacts follow the evidence-first posture. Ordinary cleanup may archive/delete derived chunks and embeddings, but must not delete raw artifact records or full artifact content unless explicit retention/offload policy says so. v1 preserves raw evidence by default and prunes only confirmed synced local spool copies.

## 6. Permanent erasure

Permanent erasure is not archiving.

Use erasure only when the owner explicitly asks to delete or forget something permanently, or when a future scoped retention policy explicitly allows it.

Erasure must remove or redact:

- raw event content controlled by Recallant,
- raw artifact excerpts and managed artifact content,
- chunks,
- embeddings,
- governed memory title/body/source quotes,
- derived summaries,
- search indexes,
- context-pack caches,
- UI/chat recall surfaces.

Erasure leaves at most a redacted, non-reconstructive receipt with safe counts, ids/hashes when safe, status, and warnings. The receipt must not contain the erased content.

## 7. `recallant analyze`

Interactive analysis command for periodic review.

Examples:

```bash
recallant analyze
recallant analyze --project my-project
recallant analyze --older-than 90d
recallant analyze --not-accessed 90d
```

What it does:

1. Finds cleanup candidates by configured criteria.
2. Clusters candidates by topic using existing embeddings or lexical fallback.
3. Generates a short summary through the configured local model when available.
4. Shows an interactive report and proposes actions.

Analysis model names and thresholds are profile/config defaults, not architecture invariants. Cleanup analysis must be auditable, dry-run capable, and able to degrade to a non-LLM path.

Candidate criteria are configurable:

```text
not_accessed_days >= RECALLANT_STALE_NOT_ACCESSED_DAYS
OR
age_days          >= RECALLANT_STALE_AGE_DAYS
```

Exclusions:

- developer-scope chunks unless explicitly included;
- chunks already handled by active `supersedes` edges;
- checkpoint-related chunks;
- records protected by policy.

## 8. Analyze report

Example:

```text
Recallant Analysis Report - project: my-project
Stale chunks: 47 | Clusters: 4

Cluster 1 - 12 chunks | Last accessed: 4 months ago
Topic: Redis migration attempt, later rejected
Oldest: 2026-03-12 | Newest: 2026-03-18

  [a] Archive   [k] Keep   [v] View chunks   [f] Forget permanently
> _
```

Actions:

| Command | Result |
|---------|--------|
| `a` | Archive selected derived chunks. Reversible. |
| `k` | Keep and postpone future analysis for the cluster. |
| `v` | Show full candidate details under configured caps. |
| `f` | Start permanent erasure dry-run/confirmation workflow. |
| `aa` | Archive all clusters in the report. |

Permanent erasure from analyze must always go through the same `memory_forget` policy path. It must not be a one-keystroke destructive action in v1.

## 9. LLM providers for summaries

`recallant analyze` supports provider choices through `RECALLANT_ANALYSIS_PROVIDER`:

| Provider | Config | Cost | Use |
|----------|--------|------|-----|
| `ollama` | `RECALLANT_ANALYSIS_MODEL=llama3.2:3b` | no external token bill | ordinary local analysis when Ollama is reachable |
| `openai` | `RECALLANT_OPENAI_API_KEY=...`, `RECALLANT_ANALYSIS_MODEL=gpt-4o-mini` | paid | better summaries only after explicit paid API approval |
| `none` | none | no external token bill | keyword-only fallback |

Ollama is a capability binding. If the owner's server already has an Ollama service, Recallant should use the configured existing endpoint instead of starting another one. If the endpoint is unavailable, analysis degrades to `none` or another approved route according to settings.

External paid API analysis creates a paid API approval request before execution and records the call in the Cost / Paid API dashboard.

## 10. `recallant cleanup`

Batch cleanup command for automation:

```bash
recallant cleanup --archive --not-accessed 180d --no-confirm
recallant cleanup --delete-archived --older-than 365d
recallant cleanup --archive --not-accessed 90d --dry-run
```

Batch cleanup can archive/rebuild/prune derived data under policy. It must not perform permanent erasure without an explicit erasure workflow.

## 11. Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `RECALLANT_DECAY_ENABLED` | `true` | Enable score decay |
| `RECALLANT_DECAY_HALFLIFE_PROJECT_DAYS` | profile default | Half-life for project-scope chunks |
| `RECALLANT_DECAY_HALFLIFE_DEVELOPER_DAYS` | profile default | Half-life for developer-scope chunks |
| `RECALLANT_DECAY_MIN` | profile default | Minimum decay multiplier |
| `RECALLANT_STALE_NOT_ACCESSED_DAYS` | profile default | Candidate threshold for not-accessed records |
| `RECALLANT_STALE_AGE_DAYS` | profile default | Candidate threshold by age |
| `RECALLANT_ANALYSIS_PROVIDER` | `ollama` | Summary provider: `ollama` \| `openai` \| `none` |
| `RECALLANT_ANALYSIS_MODEL` | profile default | Summary model name or provider id |
| `RECALLANT_OPENAI_API_KEY` | none | Required only for approved OpenAI analysis route |
| `RECALLANT_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |

Defaults are implementation/profile defaults. They can change without architecture revision when routing, cost, or quality evidence justifies the change and the change is explicit in config.
