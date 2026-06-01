# Agent Onboarding Contract

Last updated: 2026-05-28.

This contract describes how a coding agent should use Recallant after a project is initialized.
Project registration is not enough. A project is truly attached only when the agent capture loop
starts a Recallant-backed session, reads context, writes meaningful evidence/checkpoints, closes out,
and proves that a later session can recall the result.

## Startup Contract

1. Read the project instructions such as `AGENTS.md`.
2. Start a Recallant-backed session with the generated MCP flow or CLI fallback.
3. Call `memory_start_session` and then `memory_get_context_pack` before non-trivial work.
4. Work normally.
5. Use `memory_search` only for specific follow-up evidence queries.
6. Write meaningful workflow evidence through `memory_append_event` or the CLI capture fallback.
7. Create governed memory proposals through `memory_create_agent_memory` when source refs exist.
8. Update checkpoint through `memory_set_checkpoint` after meaningful progress.
9. On clear pause/exit/closeout intent, call `memory_closeout`.
10. If MCP is unavailable, update `PROJECT_LOG.md` and local spool through the CLI fallback.

For Codex v1, passive capture of every desktop chat token is not assumed. The required behavior is
agent-enforced capture: the startup instructions and CLI/MCP tooling must make the agent start the
session and write meaningful events/checkpoints as part of normal work. If that loop is not visible
in Recallant, the project is registered only, not capture-ready.

## Existing Project Onboarding

Use this only on a copied sandbox until the owner explicitly chooses to attach a live project.

Target attach workflow:

```bash
recallant attach .
recallant attach <project> --target codex
recallant attach <project> --target codex --mode manual
recallant attach <project> --target codex --mode guided
recallant attach <project> --target codex --mode autopilot
```

On an installed server, `recallant attach .` is the normal path. The CLI auto-loads the configured
server env file when present; operators should not need to source it manually.

Mode expectations:

- `manual`: run only explicit requested commands.
- `guided`: build a complete plan and wait for confirmation before durable writes.
- `autopilot`: attach the project, import safe source-linked evidence, run checks, and report without
  asking for every low-risk step.

If no mode is supplied, `autopilot` is the default for non-production-sensitive projects.

Autopilot still must not import raw secrets, enable paid APIs, perform public exposure/service
changes, erase/delete data, or promote broad/risky records to instruction-grade without policy
review.

For existing projects, attach migrates agent startup files rather than replacing them blindly:

- analyze `AGENTS.md`, `PROJECT_LOG.md`, client-specific files, current handoffs, and related agent
  docs;
- preserve important project rules;
- move long history/handoff material to Recallant as evidence;
- add or update Recallant startup instructions;
- locally back up all discovered agent files before changing any existing one.

Lower-level manual commands remain:

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

For new empty projects, `recallant attach` should also create starter project-local memory recording
that the project is attached and that Recallant is the primary source of truth while
`PROJECT_LOG.md` is fallback/checkpoint.

## Product Acceptance Gate

Every implementation checkpoint that claims onboarding/capture readiness must pass the scenario in
[PRODUCT_ACCEPTANCE_TEST.md](PRODUCT_ACCEPTANCE_TEST.md). At minimum, a smoke test must create an
attached project, start capture, write a unique owner decision, close out, start a new session, and
prove that the unique decision returns through Recallant context.

`recallant doctor --require-capture --project-dir <project>` is the quick readiness gate for normal
project work. It must fail before real capture has happened and pass only after Recallant has proof
of context read, memory write, and checkpoint evidence. A plain `doctor` remains informational.

## Cross-Project Recall Contract

Agents may use other projects as source-linked examples when the current task needs a prior pattern,
for example connector setup, Google Drive access, Cloudflare deployment, server inventory, or secret
reference locations.

Rules:

- ordinary startup context uses the current project plus applicable developer/environment/capability
  facts;
- unrelated project memories are not loaded by default;
- cross-project search must be explicit and labeled as examples/evidence;
- agents may initiate cross-project recall when the current task clearly needs a prior pattern;
- a result from another project does not become a rule for the current project unless the pattern is
  actually applied and a governed memory is created for the current project, or the owner/review
  policy promotes a general rule;
- never expose raw secret values from another project.

## File Ownership

Commit to the project when appropriate:

- thin `AGENTS.md` Memory section,
- `PROJECT_LOG.md` when the project uses repo-native handoff,
- project docs that intentionally describe Recallant usage.

Keep local or ignored unless the owner explicitly wants otherwise:

- `.recallant/config`, because it is a pointer to central settings,
- `.recallant/spool/`, because it is local runtime state,
- `.recallant/backups/`, because it contains local rollback material for attach file migration,
- local env/secrets and any raw exported memory material.

## Context Lint Expectations

`recallant lint-context` should pass for fresh generated bootstrap files. It should fail or warn when agent bootstrap files become history dumps, duplicate adapter rules, or contain secret-like material.

`PROJECT_LOG.md` should stay compact and agent-readable. It is the fallback/checkpoint file, not the
full memory store.
