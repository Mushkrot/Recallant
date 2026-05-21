# ADR-0019: Universal MCP core, Codex adapter, and session recovery

## Status

Accepted

## Context

The owner currently works in Codex, but AMP is not a Codex-specific memory product. AMP must be a universal memory platform for any MCP-capable agent and must remain ready for multi-agent / multi-client workflows.

The owner also wants the working agent to call memory tools itself, including durable closeout at the end of a session. However, abnormal interruptions cannot be solved by a final closeout call because a dead client cannot call tools after it exits.

## Decision

AMP will use a **universal MCP core with target-specific adapters**.

Codex is the first high-quality adapter and smoke-test path, but core runtime, storage, tools, policies, and review workflows are client-agnostic.

### Universal core

The AMP core owns:

- MCP server and tool contracts,
- Postgres storage,
- capture policy and local spool/sync,
- sessions and recovery state,
- governed memory creation/review/recall,
- checkpoint management,
- Review UI/admin API,
- model routing.

### Codex adapter

The Codex-specific layer is thin:

- `amp init --target codex`,
- generated/updated `AGENTS.md` Memory section,
- Codex MCP config output,
- `client_kind=codex`,
- Codex-oriented smoke tests and docs.

Cursor, Claude Code, Windsurf, and future agents should use the same core tools with their own adapters.

### Session lifecycle

AMP session safety has three layers:

1. **Session start:** agent calls `memory_start_session`, receives `session_id`, previous checkpoint state, and any warning about unclosed prior sessions.
2. **Incremental capture:** agent periodically records important work through `memory_append_turn`, governed memories, checkpoint updates, or local spool. AMP must not rely only on a final closeout.
3. **Hybrid heartbeat:** ordinary session-scoped tools update `last_seen_at`; optional `memory_heartbeat` updates liveness metadata for long-running/idle tasks without writing L0 events.
4. **Session closeout:** when the owner clearly ends or pauses work, agent calls `memory_closeout` and performs a full durable closeout.

### Abnormal interruption recovery

If a session ends without closeout:

- the prior `sessions` row remains unclosed or marked interrupted,
- the next `memory_start_session` detects it,
- AMP returns recovery information: last checkpoint, last captured event, unsynced local spool state when known, and recommended recovery actions,
- the new agent resumes from captured state instead of asking the owner to re-explain context.

## Consequences

- Codex ergonomics can be excellent without making Codex the product boundary.
- v1 must include session lifecycle support, not just append/search.
- Full closeout remains important, but data safety comes from incremental capture plus spool/recovery.
- Hybrid heartbeat is accepted; see [ADR-0030-hybrid-session-heartbeat.md](ADR-0030-hybrid-session-heartbeat.md).
- Adapters must not duplicate memory logic; they configure clients and thin repo files only.
- Tool descriptions and `AGENTS.md` must teach agents when to call memory tools, but server-side policy remains authoritative.

## Open questions

- How much unclosed-session recovery summary should be generated locally versus escalated to active-agent/subscription-worker/paid-API routes for difficult cases?
- Should `memory_closeout` update `PROJECT_LOG.md` directly through a local adapter, or should the agent update the repo file after the server closeout response?
