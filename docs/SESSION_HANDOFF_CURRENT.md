# Current Session Handoff

Last updated: 2026-05-28.

This is the current handoff for the next Recallant session. Start here after reading `AGENTS.md`.

## Current State

Recallant is deployed on the owner server, the first production UI cleanup has been completed, and
the GutenDocx copied-project sandbox pilot is complete. The active product direction is now Phase 10:
autonomous project attach/detach plus controlled cross-project recall; the first implementation
slices for all three are now complete. The next management-surface slice has also started: the
Review Command Center now has functional plain-language management chat and a more owner-readable
first screen.

The first copied-project pilot has been run on a GutenDocx sandbox copy. See
[PILOT_REPORT_GUTENDOCX_2026-05-28.md](PILOT_REPORT_GUTENDOCX_2026-05-28.md). Do not attach the
live `/ai/gutendocx` project yet. The next work is to implement the product-level workflow that can
attach/detach projects safely and reuse cross-project examples explicitly, then continue improving
the owner-facing management surface.

Operational note from 2026-05-28: a live Cloudflare `502` on `recallant.unicloud.ca` was traced to
the production Postgres container being absent and `127.0.0.1:15432` refusing connections. Restored
with `make prod-db-up`; public unauthenticated access returned Cloudflare Access `302` again. Dev
database Make targets now use `recallant-dev` as their Docker Compose project name so local
`make db-down` / `make db-reset` cannot remove the production `recallant-postgres` container.
The owner then confirmed in a real browser that authenticated Cloudflare Access loads the Recallant
Review Command Center for project `84eda3bf`.

Historical handoff material from 2026-05-21 has been archived under `docs/archive/SESSION_HANDOFF_2026-05-21.md`. It is useful for provenance, but it is no longer the current starting point.

## Start Sequence For The Next Agent

1. Read `AGENTS.md`.
2. Read `docs/WORKING_CONTEXT.md`.
3. Read `docs/PRE_PILOT_READINESS.md`.
4. Read `docs/AUTONOMOUS_ATTACH.md`.
5. Read `docs/CROSS_PROJECT_RECALL.md`.
6. Read `docs/IMPLEMENTATION_STATUS.md`.
7. Skim `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` for the relevant gate.
8. Run `git status --short --branch`.
9. Run `git log --oneline -8`.
10. Review `docs/PILOT_REPORT_GUTENDOCX_2026-05-28.md`.

## Active Work Order

1. R1 Existing Project Discovery And Preflight. Complete for the first pre-pilot checkpoint.
2. R2 Durable Explicit Import. Complete for the first pre-pilot checkpoint.
3. R3 Review UI Import And Action Readiness. Complete for the first pre-pilot checkpoint.
4. R4 Pilot Sandbox Workflow. Complete for the first pre-pilot checkpoint.
5. R5 Agent Onboarding Contract. Complete for the first pre-pilot checkpoint.
6. R6 Operational Readiness Check. Complete for the first pre-pilot checkpoint.

R0 Documentation And Handoff Readiness is complete for the current checkpoint. R1 discovery/preflight, R2 explicit import write mode, R3 Review UI import/action readiness, R4 pilot sandbox workflow, R5 agent onboarding contract, and R6 operational readiness are also complete for the first pre-pilot checkpoint.

The current Phase 10 attach target is complete for the first implementation slice:

- `recallant attach --mode manual|guided|autopilot`, with omitted mode defaulting to `autopilot` for
  ordinary projects;
- production-sensitive detection that downgrades requested autopilot to `guided` unless
  production-safe autopilot is explicitly approved;
- intelligent migration of `AGENTS.md`, `PROJECT_LOG.md`, client-specific startup files, and current
  handoffs into Recallant-style startup, with local `.recallant/backups/attach-*` backup before
  existing file changes;
- compact `PROJECT_LOG.md` as agent-readable fallback/checkpoint;
- owner-readable attach reports;

The current Phase 10 detach target is complete for the first implementation slice:

- `recallant detach` / `recallant project-detach` supports dry-run affected counts and
  confirmation-gated writes;
- live project detach hides the project in Recallant without touching files, physically deleting
  records, or archiving chunks;
- sandbox detach hides the project from active UI/search and archives active chunks, while leaving
  local sandbox files untouched and offering separate local cleanup as a follow-up;
- hard delete / permanent erasure is policy-blocked from ordinary detach and must use the separate
  forget workflow.

The current Phase 10 controlled cross-project recall target is complete for the first
implementation slice:

- MCP tool `memory_cross_project_recall` exposes explicit `same_project`, `developer_rules`,
  `environment`, `similar_projects`, and `all_projects_review` modes;
- similar-project results include source project/path/ref, status, use policy, scope kind,
  applicability warning, and promotion policy;
- ordinary context packs do not include unrelated project memory by default;
- environment/capability recall redacts secret-like values;
- applying a pattern from project B requires creating project-A memory with source refs.

The current Review/Management UI and chat target is complete for the first implementation slice:

- the Command Center has a real management chat API/form instead of a placeholder;
- chat answers read-only status/review/settings/cost/context-pack/cross-project questions in the
  owner's language by default;
- cleanup/destructive/sensitive requests return dry-run and confirmation-required proposals, not
  direct execution;
- the first screen includes "What Needs Attention", project action guidance, cross-project
  isolation reminders, and human-readable settings summaries with technical details collapsed.
- the chat panel now lives in the left rail, uses its own capped scroll area for long answers, and
  Russian risky-action responses keep the warning/action labels in Russian.
- sandbox cleanup wording is target-aware: if the open project is not the sandbox and exactly one
  sandbox/pilot project is visible, the chat dry-run proposal targets that sandbox project; if the
  target is ambiguous, chat asks for clarification instead of using the open project.

The next useful targets are:

- deepen Review/Management UI action flows for settings, context-pack preview, and review
  proposals;
- optionally add local sandbox-file cleanup after confirmed detach, still gated by dry-run and
  confirmation.

The GutenDocx copied-project pilot is complete for the first real-project sandbox checkpoint:

- Sandbox copy: `/ai/recallant-pilots/gutendocx-20260528T161238Z`
- Sandbox Recallant project id: `29bc4ee3-cac8-4c3f-9634-ef47d0401ae9`
- Imported sources: `.cursor/SESSION_HANDOFF.md`, `AGENTS.md`, `Docs/README.md`,
  `PROJECT_LOG.md`, and `README.md`
- All imports are `needs_review` / `evidence_only`; no instruction-grade promotion was performed.
- Original `/ai/gutendocx` was not modified beyond its pre-existing `config.yaml` runtime diff.
- Local embeddings initially failed during the pilot because `nomic-embed-text` was absent and the
  DB package did not yet call Ollama. Follow-up completed on 2026-05-28: `nomic-embed-text` is
  installed, `recallant doctor` reports no missing local models, and a sandbox MCP smoke verified
  `memory_append_turn` -> `embedded` -> `memory_search mode=vector_only`. Existing GutenDocx
  sandbox chunks were also re-embedded, and vector-only search now returns imported document chunks.

## Boundaries

- Conversation with the owner may be Russian; repo artifacts stay English.
- Continue autonomously for ordinary implementation steps.
- Commit at coherent rollback checkpoints.
- Update docs whenever behavior, status, or decisions change.
- Do not perform new public exposure, paid API enablement, destructive erasure, firewall changes, or secret disclosure without owner participation.
- Consult `/ai/SECURITY` and `/ai/PORTS.yaml` before server/service/security changes.
- Keep real working projects untouched until the owner explicitly chooses to attach one. The
  GutenDocx sandbox is a copied pilot and is safe to delete after backup/verify and explicit owner
  confirmation.

## Success Condition For The Next Session

The next session should continue from a completed first Phase 10 attach/detach/cross-project
checkpoint and a first functional Management UI/chat checkpoint. Practical next slices are richer
owner-facing settings/review/context-pack action flows or optional local sandbox cleanup after
confirmed detach.
