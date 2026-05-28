# Agent Onboarding Contract

Last updated: 2026-05-28.

This contract describes how a coding agent should use Recallant after a project is initialized.

## Startup Contract

1. Read the project instructions such as `AGENTS.md`.
2. Call `memory_start_session`.
3. Call `memory_get_context_pack` before non-trivial work.
4. Work normally.
5. Use `memory_search` only for specific follow-up evidence queries.
6. Write meaningful workflow evidence through `memory_append_event`.
7. Create governed memory proposals through `memory_create_agent_memory` when source refs exist.
8. Update checkpoint through `memory_set_checkpoint` after meaningful progress.
9. On clear pause/exit/closeout intent, call `memory_closeout`.
10. If MCP is unavailable, update `PROJECT_LOG.md` and local spool when available.

## Existing Project Onboarding

Use this only on a copied sandbox until Pre-Pilot Readiness is complete:

```bash
recallant discover --dry-run --project-dir <sandbox>
recallant import --dry-run <selected-source> --project-dir <sandbox>
recallant import <selected-source> --project-dir <sandbox>
```

Discovery is read-only. Confirmed import writes source-linked evidence and reviewable candidates, not instruction-grade rules.

## New Project Onboarding

```bash
recallant init --target codex --project-dir <project>
recallant lint-context --project-dir <project>
recallant context --project-dir <project> --task-hint "initial work"
```

`recallant init` may show import candidates but does not import historical material.

## File Ownership

Commit to the project when appropriate:

- thin `AGENTS.md` Memory section,
- `PROJECT_LOG.md` when the project uses repo-native handoff,
- project docs that intentionally describe Recallant usage.

Keep local or ignored unless the owner explicitly wants otherwise:

- `.recallant/config`, because it is a pointer to central settings,
- `.recallant/spool/`, because it is local runtime state,
- local env/secrets and any raw exported memory material.

## Context Lint Expectations

`recallant lint-context` should pass for fresh generated bootstrap files. It should fail or warn when agent bootstrap files become history dumps, duplicate adapter rules, or contain secret-like material.
