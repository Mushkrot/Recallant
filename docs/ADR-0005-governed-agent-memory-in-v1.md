# ADR-0005: Governed agent memory is v1 core

## Status

Accepted, refined by [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md), [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md), [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md), [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md), [ADR-0040-memory-scope-and-audience-model.md](ADR-0040-memory-scope-and-audience-model.md), and [ADR-0041-conflict-resolution-priority.md](ADR-0041-conflict-resolution-priority.md)

## Context

The earlier architecture discussion left one central question open: should Recallant v1 stop at raw capture, chunks, retrieval, and checkpoints, or should OB1-style governed agent memories be included from the start?

The project owner explicitly prefers the second path. Recallant is intended to become a full product for real daily work, not the fastest minimal prototype. We should not save implementation effort by postponing the memory layer that makes prior decisions, rules, constraints, lessons, failures, and work logs safe to reuse.

## Decision

Governed agent memory is part of the v1 core.

v1 must support:

- append-only raw evidence in L0,
- derived chunks/embeddings for retrieval,
- explicit checkpoint state,
- structured `agent_memory` records derived from evidence or confirmed/imported by the user,
- source references from every generated memory back to raw events/chunks/external refs,
- review status and review actions,
- owner-facing Review UI for important/conflicting/long-term memory hygiene,
- use policy that distinguishes evidence-only memory from instruction-grade memory,
- recall traces or usage reporting sufficient to inspect what the agent recalled and used.

## Consequences

- Implementation phases must include agent-memory tables and MCP tools before v1 is considered complete.
- `memory_search` alone is insufficient as the final recall surface; agents also need structured governed memories.
- Derived summaries and agent-created memories cannot become instruction-grade by default.
- Every important memory must preserve provenance so it can be checked against raw evidence.
- The product can take longer to build if that is required for a coherent core.

## Initial policy

- Agent-generated records are created automatically without requiring manual user confirmation for each record.
- Default agent-created records may be `status=accepted` with `use_policy=recall_allowed` when they have source refs and pass validation.
- High-impact behavioral rules and durable preferences should require stronger policy before becoming `instruction_grade`.
- Direct explicit user instructions, user-confirmed records, trusted imports, or review-promoted records may become `instruction_grade`.
- Agent-inferred rules may be captured automatically as recallable candidate rules, but must not silently become `instruction_grade`.
- Rejected, superseded, archived, stale, candidate, and needs-review records remain inspectable, but only accepted records are returned for ordinary behavioral recall by default.
- No generated summary replaces the raw L0 record that supports it.
- Review is a correction/curation workflow, not a required blocking step for every memory write.

## Refinements after acceptance

- v1 Review UI shape is the compact workbench from ADR-0033; detailed UI behavior can evolve during implementation.
- `MCP_SPEC.md` keeps raw/chunk search and governed-memory recall as separate primary tools, with Context Pack assembly allowed to combine both.
- Recall trace storage belongs to `DATA_MODEL.md` / `MCP_SPEC.md`; exact field additions are implementation details if they preserve inspectability.
- Manual-confirmation triggers for important/conflicting/long-term guidance follow ADR-0026 and ADR-0041.
