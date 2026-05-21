# ADR-0024: Automatic startup Context Pack Builder

## Status

Accepted

## Context

The owner expects a new agent session to recover context automatically. The user should not need to click a UI button or manually explain what to load.

Previous discussion used the phrase "smart button", but that is misleading. The desired behavior is a server-side mechanism that builds the right bounded startup context for an agent. CLI/UI entrypoints are useful for preview and debugging, but they are not the primary workflow.

## Decision

AMP will include a server-side **Context Pack Builder**.

Normal agent startup flow:

1. Agent reads the thin repo contract (`AGENTS.md` / local adapter).
2. Agent calls `memory_start_session`.
3. `memory_start_session` returns `session_id`, checkpoint/recovery metadata, and recommends `memory_get_context_pack`.
4. Agent calls `memory_get_context_pack` before non-trivial work.
5. AMP server returns a bounded startup pack with only the context needed for this project/session/task.

The Context Pack Builder composes:

- project identity and effective settings,
- checkpoint/current focus/next step,
- interrupted-session recovery warnings,
- active binding rules (`instruction_grade`) relevant to the session,
- relevant governed memories,
- optional bounded evidence excerpts only when needed,
- suggested next fetches instead of dumping full docs/logs,
- warnings when local spool is unsynced or context is incomplete.

Manual CLI/UI access is only a preview/debug surface over the same server logic:

- CLI example: `amp context --project <id>` or equivalent,
- UI example: "Preview agent context" in the future management interface.

These preview surfaces must not create a separate context-building algorithm.

## Consequences

- Agent startup becomes automatic and consistent across Codex, Cursor, Claude Code, Windsurf, and future clients.
- Context budgeting is enforced on the AMP server before the agent sees text.
- Agents no longer need to manually decide whether to call checkpoint, governed memory recall, or raw search at startup.
- The owner can inspect what an agent would receive without changing the normal automatic workflow.
- Implementation needs a canonical MCP tool: `memory_get_context_pack`.

## Non-goals

- This is not a UI-first feature.
- This does not mean every session receives a large context dump.
- This does not import historical docs automatically.
- This does not replace targeted `memory_search` or `memory_fetch_chunk` during later work.
