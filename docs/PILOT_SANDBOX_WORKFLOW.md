# Pilot Sandbox Workflow

Last updated: 2026-06-01.

Use this workflow for copied-project pilots. The first GutenDocx copied-project pilot has completed.
This manual workflow remains useful for cautious testing; the first Phase 10 attach slice now wraps
the same safety checks inside `recallant attach --mode manual|guided|autopilot`.

## Recommended Sandbox Root

Use `/ai/recallant-pilots/<project-name>` unless the owner chooses another path.

## Workflow

1. Copy the selected project into the sandbox root.
2. Run `recallant discover --dry-run --project-dir <sandbox>` and review source classes, risks, duplicate/stale warnings, and secret-reference previews.
3. Run `recallant import --dry-run <source> --project-dir <sandbox>` for selected sources.
4. Run confirmed `recallant import <source> --project-dir <sandbox>` only for sources selected for the pilot.
5. Start a local stdio MCP session for the sandbox project.
6. Call `memory_start_session`, then `memory_get_context_pack`.
7. Exercise one append/search/recall path.
8. Call `memory_closeout` with a checkpoint and no broad historical imports.
9. Review imported candidates in the private Review UI.
10. Detach by removing the sandbox project copy and, if needed, deleting only the sandbox project rows after backup/verification and explicit owner confirmation.

## Pilot Report Template

- Sandbox path:
- Sources discovered:
- Sources imported:
- Sources rejected:
- Context pack contents:
- Useful recalled memories:
- Missing or noisy memories:
- Review actions taken:
- Rollback/detach result:
- Fixes required before a real project:

## Verification

`npm run prepilot:smoke:sandbox` runs this workflow against the fixture project in a temporary sandbox copy.
