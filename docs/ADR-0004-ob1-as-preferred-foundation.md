# ADR-0004: OB1 as preferred architectural foundation

## Status

Working direction

## Context

Recallant is still in architecture discovery. We have compared Open Brain / OB1, MemPalace, MF0-1984, OpenMemory variants, Journey, and the owner's earlier local `agent-bootstrap` sketch.

The project owner currently prefers **Open Brain / OB1** as the main architectural foundation because its author and current design direction are considered the strongest architectural baseline among the reviewed projects.

This does not mean Recallant should become a direct clone of OB1. It means OB1 is the default reference point when decisions conflict, while other projects remain active sources of proven mechanisms and implementation ideas.

## Decision

Use **OB1 as the preferred foundation** for Recallant architecture:

- Postgres / pgvector as the central durable store.
- Remote MCP as the primary agent-facing interface.
- Multi-client memory narrative: Cursor, Claude Code, ChatGPT-compatible tools, and similar clients should share one durable memory substrate.
- Governed agent memory sidecars: provenance, review state, source refs, recall traces, and explicit use policies.
- Minimal but disciplined tool contracts instead of a large uncontrolled tool surface.

Keep the following projects in the design loop as best-of-breed donors:

- **MemPalace** for verbatim-first capture, pre-compaction/session hooks, message-level sweep, temporal KG operations, hybrid retrieval discipline, and repair/recovery posture.
- **MF0-1984** for Memory Tree/workbench UX, graph hygiene operations, keeper pipelines, project export/import, and server-side LLM proxy patterns.
- **CaviraOSS/OpenMemory** for salience/decay/reinforcement, temporal facts, user/project scoping, connector architecture, and explainable recall traces.
- **Mem0 OpenMemory** only as historical prior art for local MCP memory onboarding, not as a foundation.
- The owner's **agent-bootstrap** sketch for repository-contract ideas: `AGENTS.md`, `PROJECT_LOG.md`, and resumable project handoff conventions.
- **Journey / Journey Kits** for reusable workflow packaging, target-aware install, resolver hints, preflight checks, versioning, shared context, and learning/outcome feedback loops.

Journey has been evaluated as a possible foundation and remains a layer reference, not a replacement for OB1; see [ADR-0008-journey-as-workflow-packaging-layer.md](ADR-0008-journey-as-workflow-packaging-layer.md).

The owner has also accepted a more precise OB1/MF0 synthesis: OB1 remains the governance/foundation backbone, while MF0 becomes the main donor for raw capture, local workbench, Memory Tree, Keeper-style pipelines, project profile export/import, and server-side provider proxy patterns. See [ADR-0018-ob1-mf0-synthesis.md](ADR-0018-ob1-mf0-synthesis.md).

## Consequences

- When specs conflict, start from OB1's architectural posture and adapt it to Recallant requirements before adopting competing patterns.
- Do not flatten the comparison into "all projects are equal." OB1 is the backbone; the others are targeted sources of specific capabilities.
- Do not discard a better mechanism just because it is outside OB1. If MemPalace, MF0, or OpenMemory has a stronger answer for a specific subsystem, document the subsystem-level adoption.
- Keep Recallant's own contracts authoritative: `DATA_MODEL.md`, `MCP_SPEC.md`, `RETRIEVAL.md`, and `INGESTION.md` define the final implementation surface.
- Treat MF0 as a first-class subsystem reference for workbench/capture/UI ideas, not as a replacement foundation and not as a schema to copy directly.

## Implementation mapping notes

- Recallant contracts stay authoritative: `DATA_MODEL.md`, `MCP_SPEC.md`, `RETRIEVAL.md`, and `INGESTION.md` define the implementation surface.
- OB1-style governed agent memories are v1 core; see [ADR-0005-governed-agent-memory-in-v1.md](ADR-0005-governed-agent-memory-in-v1.md).
- MemPalace hook/sweep mechanics are prior art for capture policy, but MCP append and local spool are the v1 contract.
- OpenMemory-style salience/decay ideas are represented as configurable scoring/governance metadata, not a required imported taxonomy.
