# ADR-0009: Documentation-first before implementation

## Status

Accepted

## Context

The owner explicitly does not want to start implementation yet. The project is still in architecture discovery and documentation refinement. We are not optimizing for speed; we are optimizing for a coherent, durable architecture.

## Decision

Do **not** start implementation until:

- the architecture documentation is complete enough to guide implementation,
- the owner has reviewed and discussed the important design details,
- the owner explicitly says to begin implementation.

Agents may edit documentation, ADRs, diagrams, specs, and planning files. Agents must not create the implementation repository, write server/CLI code, create migrations, or scaffold runtime packages unless explicitly instructed.

## Consequences

- `AGENT_IMPLEMENTATION_GUIDE.md` remains a future implementation plan, not current authorization to code.
- Open questions should be captured in docs rather than prematurely resolved in code.
- Architecture docs are the current deliverable.
- When implementation begins, the implementation agent must read the docs in README order and follow the ADRs.
