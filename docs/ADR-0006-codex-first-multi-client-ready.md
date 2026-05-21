# ADR-0006: Codex-first, multi-client-ready

## Status

Accepted

## Context

The owner's current daily workflow is mostly Codex. The original motivation included multiple agents and IDEs, but the immediate pain is no longer urgent cross-agent switching. The same core problems still exist inside one agent across sessions and context compactions.

## Decision

Recallant should be **Codex-first for near-term ergonomics** and **multi-client-ready by architecture**.

Refinement: Codex is the first adapter and smoke-test path, not the product boundary. Recallant core remains universal MCP memory runtime. See [ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md](ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md).

Near-term implementation should optimize the default bootstrap, documentation, and smoke tests around Codex:

- `AGENTS.md` as the primary repo-native instruction surface.
- Codex MCP config examples and `recallant init --target codex`.
- Codex session flow as the first tested path.

The architecture still keeps MCP and project/developer scoping as client-agnostic contracts so Cursor, Claude Code, Windsurf, and other clients can attach later without redesign.

Codex-specific work is limited to target-aware bootstrap, generated adapter/config files, `client_kind=codex`, and tested Codex session flow. Memory storage, session lifecycle, closeout, recovery, Review UI, and policy enforcement belong to the universal Recallant core.

## Consequences

- Do not overbuild client-specific adapters before the Codex path is excellent.
- Do not remove multi-client fields such as `client_kind`, `session_id`, or transport-neutral MCP tool contracts.
- Cross-client smoke remains part of the test contract, but it can be later than Codex-first local smoke.
- Project bootstrap must remain target-aware so additional harnesses can be generated without duplicating core rules.
- Abnormal session recovery must be core behavior, not a Codex-only workaround.

## Open questions

- Should `recallant init` default to `--target codex` when no target is passed?
