# Recallant Agent Instructions

## Working Mode

Work autonomously. The owner has authorized agents to follow the documented implementation plan, make ordinary technical decisions, verify changes, and create scoped commits at logical rollback checkpoints without asking for separate permission each time.

Do not stop just to report progress, summarize completed work, ask whether to continue, or wait for approval on an ordinary implementation step. Progress reports and commits are checkpoints, not stopping points.

Stop only when the next step genuinely requires the owner: security/public exposure, secrets, paid API use, destructive operations, server/firewall/service changes, or a real contradiction in the specs. If none of those blockers exists, continue to the next documented implementation step.

Do not call Recallant ready because a project is registered, files were generated, or a component
smoke passed. The main product loop is ready only after the acceptance scenario in
`docs/PRODUCT_ACCEPTANCE_TEST.md` proves that an attached project starts a Recallant-backed session,
reads context, writes decisions/actions/tests/checkpoints, closes out, and recalls that memory in a
new session without owner QA.

## Canonical Context

Start with:

1. `docs/WORKING_CONTEXT.md`
2. `docs/PRODUCT_ACCEPTANCE_TEST.md`
3. `docs/PRE_PILOT_READINESS.md`
4. `docs/SESSION_HANDOFF_CURRENT.md`
5. `docs/README.md`
6. `docs/AGENT_IMPLEMENTATION_GUIDE.md`
7. `docs/TASK_GRAPH.md`
8. `docs/TEST_CONTRACT.md`

The repository artifacts are English. Conversation with the owner may be Russian.

## Implementation Discipline

- Follow the phase order unless the docs explicitly allow parallel work.
- Keep changes modular and scoped.
- Update docs when behavior, status, or decisions change.
- Run the relevant checks before committing.
- Do not commit runtime state, secrets, generated build output, local upstream clones, or unrelated changes.
