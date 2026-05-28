# Current Session Handoff

Last updated: 2026-05-28.

This is the current handoff for the next Recallant session. Start here after reading `AGENTS.md`.

## Current State

Recallant is deployed on the owner server and the first production UI cleanup has been completed. The active next plan is [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md).

Do not start by connecting a real project. Existing-project discovery/preflight, Durable Explicit Import write mode, Review UI import/action readiness, Pilot Sandbox Workflow, and Agent Onboarding Contract are complete for the first pre-pilot checkpoint; the next implementation work is Operational Readiness Check.

Historical handoff material from 2026-05-21 has been archived under `docs/archive/SESSION_HANDOFF_2026-05-21.md`. It is useful for provenance, but it is no longer the current starting point.

## Start Sequence For The Next Agent

1. Read `AGENTS.md`.
2. Read `docs/WORKING_CONTEXT.md`.
3. Read `docs/PRE_PILOT_READINESS.md`.
4. Read `docs/IMPLEMENTATION_STATUS.md`.
5. Skim `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` for the relevant gate.
6. Run `git status --short --branch`.
7. Run `git log --oneline -8`.
8. Begin with Workstream R6 from `docs/PRE_PILOT_READINESS.md`.

## Active Work Order

1. R1 Existing Project Discovery And Preflight. Complete for the first pre-pilot checkpoint.
2. R2 Durable Explicit Import. Complete for the first pre-pilot checkpoint.
3. R3 Review UI Import And Action Readiness. Complete for the first pre-pilot checkpoint.
4. R4 Pilot Sandbox Workflow. Complete for the first pre-pilot checkpoint.
5. R5 Agent Onboarding Contract. Complete for the first pre-pilot checkpoint.
6. R6 Operational Readiness Check. Start here next.

R0 Documentation And Handoff Readiness is complete for the current checkpoint. R1 discovery/preflight, R2 explicit import write mode, R3 Review UI import/action readiness, R4 pilot sandbox workflow, and R5 agent onboarding contract are also complete for the first pre-pilot checkpoint.

## Boundaries

- Conversation with the owner may be Russian; repo artifacts stay English.
- Continue autonomously for ordinary implementation steps.
- Commit at coherent rollback checkpoints.
- Update docs whenever behavior, status, or decisions change.
- Do not perform new public exposure, paid API enablement, destructive erasure, firewall changes, or secret disclosure without owner participation.
- Consult `/ai/SECURITY` and `/ai/PORTS.yaml` before server/service/security changes.
- Keep real working projects untouched until the Pre-Pilot Readiness exit gate is met and the owner chooses the first pilot candidate.

## Success Condition For The Next Session

The next session should leave Recallant able to run a safe pilot on a duplicated project copy, with discovery/import/review/closeout documented and verified.
