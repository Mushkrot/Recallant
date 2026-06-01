# ADR-0008: Journey as workflow packaging layer, not memory foundation

## Status

Accepted

## Context

The owner trusts Matthew Berman as a high-signal source and asked whether Journey / Journey Kits should become the architectural foundation instead of Open Brain / OB1.

Journey is highly relevant to Recallant, but it solves a different problem:

- OB1 is a memory substrate architecture: durable store, vectors, MCP access, multi-client memory, and governed agent memory.
- Journey is a workflow packaging and distribution system: reusable kits, target-aware installs, resolver hints, preflight checks, versioning, shared context, and feedback loops.

Recallant needs both kinds of ideas. The foundation question should be answered by the memory substrate layer, not by the workflow packaging layer.

## Decision

Keep **Open Brain / OB1 as the preferred architectural foundation** for Recallant's memory core.

Use **Journey / Journey Kits as the reference for packaging, onboarding, and workflow distribution**:

- Recallant project bootstrap should learn from Journey's target-aware install model.
- Recallant workflows and setup templates may be packaged in a `kit.md`-like format.
- Recallant should use Journey-style resolver hints so agents load only the context needed for the current task.
- Recallant setup should include preflight checks, verification commands, and version/update checks.
- Recallant may later ship a Journey-compatible kit/skill as an installation path, but Recallant core must remain usable without Journey SaaS.

## Rationale

Journey is not currently the right base for Recallant memory because:

- It does not define Recallant's required source-of-truth memory model: L0 raw events, L1 chunks/embeddings, L2 graph, L3 governed agent memories, checkpoints, and recall traces.
- It is oriented around installing and distributing workflows, not owning the durable memory substrate.
- Making Recallant depend on a hosted registry would weaken the local/server-first goal.
- Journey's `memory` manifest contract is useful, but it describes a workflow's memory expectations; it is not itself a complete memory architecture.

Journey is still extremely useful because:

- It directly addresses the owner's "new project setup should be one action" pain.
- It has a mature pattern for target-specific installs across Codex, Cursor, Claude Code, Windsurf, and other harnesses.
- It has resolver hints that map cleanly to Recallant's context-budget problem.
- It includes preflight/verification, dependency graph, version checks, and outcome/learning feedback loops that Recallant can adapt locally.

## Consequences

- Recallant implementation should not copy Journey as the database or memory core.
- Recallant should define its own `recallant init` and repo contract first.
- A later `recallant kit export` or Journey-compatible Recallant kit is valid if it preserves Recallant's local/server-first operation.
- Journey concepts should influence `CONTEXT_BUDGET.md`, `REPO_CONTRACT.md`, `QUICKSTART.md`, and future bootstrap/template specs.

## Open questions

- Should Recallant define its own local `recallant-kit.md` format, adopt Journey `kit.md` directly, or support both?
- Should `recallant init` produce Journey-compatible metadata from day one?
- Which resolver hints belong in project bootstrap versus in governed memory records?
