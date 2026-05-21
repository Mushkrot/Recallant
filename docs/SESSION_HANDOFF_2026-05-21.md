# Session handoff 2026-05-21

This file started as the final local-session handoff before moving AMP work to the target Linux server. It now also records the follow-up accepted decisions made after the move so future sessions do not reopen Q9/Q12/Q13.

## Transfer boundary

The durable project is `agent-memory-platform/`.

The parent `Memories/` folder is not required for continuation if this folder is transferred with its `docs/` contents intact.

External parent-folder notes were consolidated into:

- `WORKING_CONTEXT.md`,
- ADR-0035,
- ADR-0036,
- ADR-0037,
- ADR-0038,
- ADR-0039,
- ADR-0040,
- ADR-0041,
- this handoff file.

## Accepted in the final local session

### Decision 10: Retention / cleanup

AMP v1 uses conservative retention:

- L0 raw evidence: no automatic delete.
- Raw artifacts, transcripts, and log exports: no automatic delete by default.
- L1 derived data: chunks, embeddings, summaries, and indexes may be archived, rebuilt, refreshed, or pruned from active retrieval.
- L3 governed memory: archive, supersede, reject, or mark stale; no silent hard delete by default.
- Local spool / unsynced data: delete only after confirmed sync.
- Operational queues/temp jobs: cleanup allowed after successful completion or configured timeout.
- Model/cost/audit logs: retain for dashboard/debug/accountability; cleanup only under explicit configured retention.

Canonical spec: `ADR-0035-conservative-retention-and-cleanup.md`.

### Decision 11: Memory statuses / lifecycle

Accepted statuses:

```text
candidate
accepted
rejected
archived
superseded
stale
needs_review
```

Only `accepted` memories can act as durable behavioral guidance according to `use_policy`.

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

Canonical spec: `ADR-0036-governed-memory-lifecycle-statuses.md`.

## Recently Accepted

Questions 9, 12, and 13 have now been accepted:

- Question 9: Import workflow. Accepted in `ADR-0039-v1-import-workflow.md`.
- Question 12: Memory scope / audience. Accepted in `ADR-0040-memory-scope-and-audience-model.md`.

Accepted Q9 summary:

- v1 uses discovery-first, import-by-confirmation.
- `amp discover` scans candidates, `amp init` registers/configures and may suggest imports, and `amp import` is the explicit preview/dry-run/write path.
- Imported material is classified into raw evidence, chunks, candidate memories, environment facts, secret references, capability/account bindings, checkpoint seeds, or repo contracts.
- Imported material does not silently become `instruction_grade`.

Accepted Q12 summary:

- Scope and audience are separate axes.
- `scope_kind`/`scope_id` define where a memory applies.
- `audience` defines who/what may consume it.
- `use_policy` remains the authority level.
- Scope kinds include domain, developer, environment, project, repo, subproject, session, connector_account, capability, and client_adapter.

Canonical specs: `ADR-0039-v1-import-workflow.md`, `ADR-0040-memory-scope-and-audience-model.md`, and archived context in `ADR-0037-import-workflow-and-memory-scope-archive.md`.

Question 13 conflict resolution / priority is now accepted in `ADR-0041-conflict-resolution-priority.md`.

Accepted Q13 summary:

- Resolve conflicts by applicability first, then authority, then scope specificity, then recency.
- Current explicit user instruction is highest unless safety/security/confirmation gates apply.
- Safety/system/developer hard constraints and high-risk topics require confirmation/review.
- Narrower accepted `instruction_grade` scope beats broader guidance.
- Environment/capability/connector-account bindings outrank generic guesses or raw imported text for their task.
- High-risk or equal-authority conflicts go to Review UI / owner confirmation.

Continue with later remaining architecture questions, not implementation, unless the owner explicitly says to begin implementation.
