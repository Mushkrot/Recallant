# ADR-0035: Conservative retention and cleanup

## Status

Accepted

## Context

Recallant will accumulate raw conversations, command/tool evidence, imported artifacts, chunks, embeddings, governed memories, queues, and model/cost audit records.

If the system deletes too aggressively, it can lose the source of truth needed for recovery, audit, reprocessing, or correcting bad memories. If it never cleans anything, retrieval quality and operations will degrade.

## Decision

Recallant v1 uses a conservative retention policy:

- L0 raw evidence is not automatically deleted.
- Raw artifacts, transcripts, and log exports are not automatically deleted by default.
- L1 derived data such as chunks, embeddings, summaries, and indexes may be archived, rebuilt, refreshed, or removed from active retrieval when it can be regenerated from raw evidence.
- L3 governed memories are archived, superseded, rejected, or marked stale; they are not silently hard-deleted by default.
- Local spool and unsynced data are deleted only after confirmed sync.
- Operational queues and temporary jobs may be cleaned after successful completion or configured timeout.
- Model, cost, and audit logs are retained for dashboard/debug/accountability and cleaned only under explicit configured retention.

Default posture:

```text
Prefer archive/rebuild over hard delete.
Hard delete requires explicit owner action or a future configured retention policy.
```

## Consequences

- Recovery and audit remain reliable even when derived indexes are pruned.
- Storage will grow, but the growth is safer than losing evidence during early product use.
- Cleanup tooling focuses first on derived chunks/embeddings, active retrieval hygiene, and review workflow.
- Future retention windows can be added as explicit settings after real storage volume and user expectations are known.

## Non-decisions

- Exact retention windows for raw artifacts, model calls, and backups are not fixed yet.
- Legal-hold or compliance-grade deletion is outside v1 unless reopened explicitly.
