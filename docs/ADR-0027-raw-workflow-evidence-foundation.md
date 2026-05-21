# ADR-0027: Raw workflow evidence as the lower memory foundation

## Status

Accepted, refined by [ADR-0035-conservative-retention-and-cleanup.md](ADR-0035-conservative-retention-and-cleanup.md)

## Context

The owner confirmed the proposed synthesis:

- OB1 remains the preferred upper architecture for governed memory, provenance, review, recall, and policy.
- MF0/Journey-like workbench ideas are needed for preserving the real agent workflow: conversation history, command/tool traces, large outputs, session recovery, and later reprocessing.

The important distinction is that AMP is not only a "memory of conclusions." It must also preserve enough evidence to reconstruct what happened during agent work when a session is interrupted, compacted, or later reviewed.

OB1-style governed memory is strong for safe future behavior, but by itself it is not enough for AMP because AMP must support:

- recovery after abnormal session interruption,
- audit and correction of extracted memories,
- later reprocessing with better extraction models,
- source-backed Review UI,
- investigation of failures, command output, file-change context, and incomplete work.

## Decision

AMP will use a two-level synthesis:

1. **Lower layer: raw workflow evidence**
   - append-only L0 events for ordinary conversation turns and workflow events,
   - capture-profile-controlled storage of tool calls, terminal output, file-change evidence, attachments, and transcript imports,
   - large payload handling through raw artifact pointers, excerpts, hashes, and metadata.

2. **Upper layer: governed memory**
   - structured `agent_memories`,
   - source refs back to raw events/chunks/artifacts,
   - review lifecycle,
   - use policies such as `evidence_only`, `recall_allowed`, and `instruction_grade`,
   - bounded recall through Context Pack Builder and search.

Raw evidence is the factual archive. Governed memory is what may influence future agent behavior.

## v1 storage policy

For v1:

- Ordinary user/assistant turns are stored as full text in L0 `events` when captured by policy.
- Tool/terminal outputs are stored according to the project's capture profile:
  - `light`: metadata, errors, and tail excerpts,
  - `standard`: metadata plus bounded excerpts and errors/tail,
  - `detailed`: richer raw evidence, still with configured caps unless explicit full capture is enabled.
- Very large outputs, media, attachments, and transcript exports are stored as raw artifacts:
  - Postgres stores metadata, excerpt, hash, size, and location pointer,
  - the full payload can live in local spool/server filesystem storage in v1,
  - future object storage can replace the physical backend without changing the logical contract.
- L1 chunks and embeddings are rebuildable derived indexes.
- L0 events and raw artifact metadata are not deleted by ordinary cleanup.

## Context policy

Raw evidence must not be dumped into the agent's active context.

Normal startup and task recall use:

- checkpoint,
- governed memories,
- binding rules,
- bounded evidence excerpts,
- suggested next fetches.

Full raw artifacts are available for recovery, Review UI, debugging, explicit inspection, import/reprocess jobs, and audit. They are not ordinary startup context and are not instruction-grade memory.

## Consequences

- AMP borrows OB1's governance discipline and MF0's stronger workflow-capture posture without copying either project directly.
- Raw capture does not weaken safety because future behavior is controlled by governed memory, use policy, review, scoring, scope, and context budget.
- Capture profiles become important product settings because different projects need different evidence depth.
- The schema needs an explicit raw artifact abstraction now, even if v1 physically stores artifacts on the filesystem/spool rather than in object storage.
- Cleanup focuses first on derived chunks/embeddings and governed-memory hygiene. Raw evidence retention now follows the conservative v1 policy in ADR-0035: no automatic delete by default.

## Non-decisions

- v1 does not require S3/MinIO/object storage.
- v1 does not require a full MF0-style visual Memory Tree.
- v1 does not expose raw archive dumps as normal agent context.
- Future personal-life capture may reuse this raw-evidence/governed-memory split, but it remains outside the first implementation scope.
