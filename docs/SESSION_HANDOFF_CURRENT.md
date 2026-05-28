# Current Session Handoff

Last updated: 2026-05-28.

This is the current handoff for the next Recallant session. Start here after reading `AGENTS.md`.

## Current State

Recallant is deployed on the owner server and the first production UI cleanup has been completed. The active next plan is [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md).

Do not start by connecting a real project. The next implementation work is to make existing-project discovery, explicit import, Review UI import handling, and sandbox pilot workflow ready enough for a copied project pilot.

Historical handoff material from 2026-05-21 has been archived under `docs/archive/SESSION_HANDOFF_2026-05-21.md`. It is useful for provenance, but it is no longer the current starting point.

## Start Sequence For The Next Agent

1. Read `AGENTS.md`.
2. Read `docs/WORKING_CONTEXT.md`.
3. Read `docs/PRE_PILOT_READINESS.md`.
4. Read `docs/IMPLEMENTATION_STATUS.md`.
5. Skim `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` for the relevant gate.
6. Run `git status --short --branch`.
7. Run `git log --oneline -8`.
8. Begin with Workstream R1 from `docs/PRE_PILOT_READINESS.md`.

## Active Work Order

1. R1 Existing Project Discovery And Preflight.
2. R2 Durable Explicit Import.
3. R3 Review UI Import And Action Readiness.
4. R4 Pilot Sandbox Workflow.
5. R5 Agent Onboarding Contract.
6. R6 Operational Readiness Check.

R0 Documentation And Handoff Readiness is complete for the current checkpoint.

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
