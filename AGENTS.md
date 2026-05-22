# Recallant Agent Instructions

## Working Mode

Work autonomously. The owner has authorized agents to follow the documented implementation plan, make ordinary technical decisions, verify changes, and create scoped commits at logical rollback checkpoints without asking for separate permission each time.

Stop only when the next step genuinely requires the owner: security/public exposure, secrets, paid API use, destructive operations, server/firewall/service changes, or a real contradiction in the specs.

## Canonical Context

Start with:

1. `docs/WORKING_CONTEXT.md`
2. `docs/README.md`
3. `docs/AGENT_IMPLEMENTATION_GUIDE.md`
4. `docs/TASK_GRAPH.md`
5. `docs/TEST_CONTRACT.md`

The repository artifacts are English. Conversation with the owner may be Russian.

## Implementation Discipline

- Follow the phase order unless the docs explicitly allow parallel work.
- Keep changes modular and scoped.
- Update docs when behavior, status, or decisions change.
- Run the relevant checks before committing.
- Do not commit runtime state, secrets, generated build output, local upstream clones, or unrelated changes.
