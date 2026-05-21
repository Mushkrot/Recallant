# ADR-0036: Governed memory lifecycle statuses

## Status

Accepted

## Context

Recallant must distinguish proposed memories, trusted memories, rejected memories, old memories, replaced memories, and possibly stale memories. A flat "approved/pending" model is too weak for long-lived agent behavior because it blurs whether a record is a rule, evidence, candidate, or historical artifact.

## Decision

Recallant v1 uses these governed-memory lifecycle statuses:

```text
candidate
accepted
rejected
archived
superseded
stale
needs_review
```

Plain-language meanings:

- `candidate`: proposed memory; not yet trusted as a durable instruction.
- `accepted`: governed memory usable by agents according to its `use_policy`.
- `rejected`: reviewed and intentionally not promoted; retained for audit and dedup suppression.
- `archived`: preserved for history, excluded from normal retrieval.
- `superseded`: replaced by newer memory; lineage must be preserved.
- `stale`: possibly outdated; requires verification before relying on it.
- `needs_review`: human or higher-confidence process should decide before normal use.

Lifecycle v1:

```text
candidate -> accepted
candidate -> rejected
accepted -> archived
accepted -> superseded
accepted -> stale
stale -> accepted
stale -> archived
stale -> superseded
needs_review -> accepted
needs_review -> rejected
```

Only `accepted` memories can act as durable behavioral guidance. Candidate, imported, stale, and needs-review records may inform search or review, but must not silently become standing instructions.

Required metadata:

- status,
- created_at,
- updated_at,
- source_refs,
- accepted_by / rejected_by where applicable,
- supersedes / superseded_by where applicable,
- review_reason,
- confidence.

## Consequences

- Existing references to `pending_review` should map to `needs_review` or `candidate` depending on why the item is blocked.
- Existing references to `approved` should map to `accepted`.
- Review UI and CLI still may use action words such as "approve", but the stored lifecycle status is `accepted`.
- Retrieval must exclude rejected/archived/superseded by default and treat stale/candidate/needs_review as non-binding unless explicitly requested.

## Related decisions

- Memory scope/audience is accepted in [ADR-0040](ADR-0040-memory-scope-and-audience-model.md).
- Conflict priority is accepted in [ADR-0041](ADR-0041-conflict-resolution-priority.md).
