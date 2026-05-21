# ADR-0008: Journey as workflow packaging layer, not memory foundation

## Status

Working direction

## Context

The owner trusts Matthew Berman as a high-signal source and asked whether Journey / Journey Kits should become the architectural foundation instead of Open Brain / OB1.

Journey is highly relevant to AMP, but it solves a different problem:

- OB1 is a memory substrate architecture: durable store, vectors, MCP access, multi-client memory, and governed agent memory.
- Journey is a workflow packaging and distribution system: reusable kits, target-aware installs, resolver hints, preflight checks, versioning, shared context, and feedback loops.

AMP needs both kinds of ideas. The foundation question should be answered by the memory substrate layer, not by the workflow packaging layer.

## Decision

Keep **Open Brain / OB1 as the preferred architectural foundation** for AMP's memory core.

Use **Journey / Journey Kits as the reference for packaging, onboarding, and workflow distribution**:

- AMP project bootstrap should learn from Journey's target-aware install model.
- AMP workflows and setup templates may be packaged in a `kit.md`-like format.
- AMP should use Journey-style resolver hints so agents load only the context needed for the current task.
- AMP setup should include preflight checks, verification commands, and version/update checks.
- AMP may later ship a Journey-compatible kit/skill as an installation path, but AMP core must remain usable without Journey SaaS.

## Rationale

Journey is not currently the right base for AMP memory because:

- It does not define AMP's required source-of-truth memory model: L0 raw events, L1 chunks/embeddings, L2 graph, L3 governed agent memories, checkpoints, and recall traces.
- It is oriented around installing and distributing workflows, not owning the durable memory substrate.
- Making AMP depend on a hosted registry would weaken the local/server-first goal.
- Journey's `memory` manifest contract is useful, but it describes a workflow's memory expectations; it is not itself a complete memory architecture.

Journey is still extremely useful because:

- It directly addresses the owner's "new project setup should be one action" pain.
- It has a mature pattern for target-specific installs across Codex, Cursor, Claude Code, Windsurf, and other harnesses.
- It has resolver hints that map cleanly to AMP's context-budget problem.
- It includes preflight/verification, dependency graph, version checks, and outcome/learning feedback loops that AMP can adapt locally.

## Consequences

- AMP implementation should not copy Journey as the database or memory core.
- AMP should define its own `amp init` and repo contract first.
- A later `amp kit export` or Journey-compatible AMP kit is valid if it preserves AMP's local/server-first operation.
- Journey concepts should influence `CONTEXT_BUDGET.md`, `REPO_CONTRACT.md`, `QUICKSTART.md`, and future bootstrap/template specs.

## Open questions

- Should AMP define its own local `amp-kit.md` format, adopt Journey `kit.md` directly, or support both?
- Should `amp init` produce Journey-compatible metadata from day one?
- Which resolver hints belong in project bootstrap versus in governed memory records?
