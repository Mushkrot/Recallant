# ADR-0018: OB1/MF0 synthesis for Recallant architecture

## Status

Accepted

## Context

The owner confirmed the desired direction: Recallant should use the strongest parts of both Open Brain / OB1 and MF0-1984 rather than choosing one project narrowly.

Current upstream research shows a useful split:

- **OB1** is strongest as the governance backbone: Postgres/pgvector, MCP-first architecture, governed agent-memory sidecars, provenance, review state, source refs, recall traces, audit trails, compact write-back, and conservative policy around instruction-grade memory.
- **MF0-1984** is strongest as a local workbench and capture/UI reference: conversation turns, per-thread message mirror, rolling summaries, extracted memory items, Memory Tree, Keeper pipelines, project profile export/import, and server-side provider proxy patterns.

Neither upstream project implements the exact Recallant decision by itself. OB1 is more selective and governed; it intentionally avoids raw transcript capture as normal memory. MF0 preserves more of the chat/workbench flow and derives summaries/memories from it, but does not provide Recallant's explicit per-project capture profile semantics.

## Decision

Recallant will use an **optimal controlled synthesis**:

### From OB1

Use OB1 as the default foundation for:

- durable Postgres/pgvector memory substrate,
- remote MCP / multi-client posture,
- governed agent memories,
- evidence vs instruction-grade separation,
- pending/reviewed/rejected lifecycle,
- provenance and source refs,
- recall traces and usage reporting,
- audit events,
- conservative policy that prevents agent-generated memory from silently becoming binding instruction,
- compact structured write-back rather than raw dump-as-instruction.

### From MF0

Use MF0-1984 as a major subsystem donor for:

- local-first workbench thinking,
- raw conversation/evidence persistence patterns,
- thread/message mirror and rolling summary ideas,
- Memory Tree / graph-oriented review UX inspiration,
- Keeper-style specialized extraction pipelines,
- saved conduct/rules-management UX,
- project profile export/import,
- server-side LLM/provider proxy pattern so browser/UI clients do not directly hold provider secrets.

### Owned by Recallant

Recallant must own the bridge that neither upstream provides exactly:

- managed hybrid capture with raw evidence, derived memory, and agent-context layers,
- raw workflow evidence as the lower factual foundation, with governed memory as the upper behavior layer,
- per-project/session capture profiles (`light`, `standard`, `detailed`, `custom` or equivalent),
- future-only profile changes for the current project,
- Review UI focused on important, conflicting, duplicate, and long-term governed memory,
- explicit promotion path from ordinary memory to candidate rule to binding rule,
- context-budget policy that keeps raw archives out of normal startup context,
- local-server-first deployment on the owner's private Linux/Tailscale environment.

## Consequences

- OB1 remains the preferred architecture foundation, but MF0 is not a minor reference. It is the primary donor for workbench, raw capture, Memory Tree, and Keeper-style UX ideas.
- Recallant must not copy either upstream schema directly. All borrowed ideas are mapped into Recallant-owned contracts: `DATA_MODEL.md`, `MCP_SPEC.md`, `INGESTION.md`, `MEMORY_MANAGEMENT.md`, and `RETRIEVAL.md`.
- Raw evidence preservation does not weaken governance. Future agent behavior comes from governed memories, checkpoint, scoring, review, and scoped retrieval.
- The v1 design should intentionally combine OB1-style safe memory with MF0-style usable memory management, instead of treating these as competing choices.
- See [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md) for the accepted lower-layer raw evidence policy.

## Source snapshots

- OB1 research snapshot: `151a8d1c922ffadad08399508efe46b207a5894e`
- MF0-1984 research snapshot: `9722af674bef7b85350617607db5dffd5e4ae6fe`

## Open questions

- How much MF0-style Memory Tree functionality belongs in v1 Review UI versus later workbench expansion?
- Which Keeper-style specialized extraction pipelines should be implemented first after core capture/governance works?
- How should MF0-style project profile export/import relate to Recallant `recallant init`, Journey-style kits, and backup/restore?
