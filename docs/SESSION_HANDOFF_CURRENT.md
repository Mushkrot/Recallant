# Current Session Handoff

Last updated: 2026-05-31.

This is the current handoff for the next Recallant session. Start here after reading `AGENTS.md`.

## Current State

Recallant is deployed on the owner server, the GutenDocx copied-project sandbox pilot is complete,
and the first product-UX readiness pass is deployed. Phase 10 has working first slices for
autonomous project attach/detach, controlled cross-project recall, one-command project onboarding,
AI-backed Management Chat, and owner-confirmed developer-wide rules. The Product Acceptance agent
capture scenario now passes for the first production-ready slice: a clean project can run ordinary
`recallant attach .`, start a Recallant-backed session, read context, write
decisions/actions/tests/checkpoints, close out, recall that memory in a later session, show
capture-active readiness in the Review UI/API, and detach safely without touching project files.

The first copied-project pilot has been run on a GutenDocx sandbox copy. See
[PILOT_REPORT_GUTENDOCX_2026-05-28.md](PILOT_REPORT_GUTENDOCX_2026-05-28.md). Do not attach the
live `/ai/gutendocx` project yet unless the owner explicitly chooses that next step. The safer next
work is to deepen owner-facing Management UI action flows, close remaining CLI init/discover/import
contract gaps, or extend local sandbox cleanup beyond the first safe pointer/runtime-artifact slice.

Operational note from 2026-05-28: a live Cloudflare `502` on `recallant.unicloud.ca` was traced to
the production Postgres container being absent and `127.0.0.1:15432` refusing connections. Restored
with `make prod-db-up`; public unauthenticated access returned Cloudflare Access `302` again. Dev
database Make targets now use `recallant-dev` as their Docker Compose project name and publish dev
Postgres on `127.0.0.1:15433` so local `make db-down` / `make db-reset` cannot remove or collide
with the production `recallant-postgres` container.
The owner then confirmed in a real browser that authenticated Cloudflare Access loads the Recallant
Review Command Center for project `84eda3bf`.

Historical handoff material from 2026-05-21 has been archived under `docs/archive/SESSION_HANDOFF_2026-05-21.md`. It is useful for provenance, but it is no longer the current starting point.

## Start Sequence For The Next Agent

1. Read `AGENTS.md`.
2. Read `PROJECT_LOG.md`.
3. Read `docs/PRODUCT_ACCEPTANCE_TEST.md`.
4. Read `docs/WORKING_CONTEXT.md`.
5. Read `docs/PRE_PILOT_READINESS.md`.
6. Read `docs/AUTONOMOUS_ATTACH.md`.
7. Read `docs/CROSS_PROJECT_RECALL.md`.
8. Read `docs/IMPLEMENTATION_STATUS.md`.
9. Skim `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` for the relevant gate.
10. Run `git status --short --branch`.
11. Run `git log --oneline -8`.
12. Review `docs/PILOT_REPORT_GUTENDOCX_2026-05-28.md` if the next task touches pilot cleanup or real-project onboarding.

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
- chat now attempts local Ollama AI interpretation first and labels deterministic fallback when the
  model is unavailable;
- explicit owner requests to save a low-risk rule for all projects create developer-scope
  `instruction_grade` memories that future context packs include as binding rules.

The current install/onboarding UX target is implemented for the owner-server profile:

- `scripts/install-recallant.sh` is the server install entrypoint;
- `scripts/install-recallant-cli.sh` installs the global `recallant` wrapper on configured servers;
- CLI commands auto-load `/opt/secure-configs/recallant.env` when present;
- ordinary project onboarding is `cd <project> && recallant attach .`, with `--sandbox`,
  `--mode guided`, and `--mode manual` available when needed.
- QA correction: installed CLI attach must not reuse the Recallant host project id from the loaded
  server env when the operator attaches another explicit project path. The fix is in
  `packages/db/src/index.ts`; the Phase 10 attach smoke now simulates a configured host
  `RECALLANT_PROJECT_ID`/`RECALLANT_PROJECT_PATH` and asserts that a new sandbox receives its own
  project id.

The current Product Acceptance target is complete for the first implementation slice:

- `npm run product-acceptance:smoke` uses a clean project and ordinary `recallant attach .`;
- the smoke verifies agent-start, context-read capture, decision/action/test events, checkpoint,
  closeout, second-session recall, Review dashboard capture readiness, zero lingering active
  sessions after preview/verification, offline spool sync/idempotency, and safe detach
  dry-run/confirm;
- `/ai/recallant` dogfooded the same capture path in production and a later live context pack
  recalled memory `bbe351f3-66a1-4f1c-a963-ff545c7e314b`;
- `recallant.service` was restarted after the readiness/deploy change and local `/health`,
  authenticated `/api/review-dashboard`, and Review HTML readiness checks passed.

The current local cleanup follow-up is complete for the first safe slice:

- `recallant local-cleanup --project-dir <project> --dry-run` reports local pointer/runtime files
  that can be removed after detach;
- confirmed local cleanup is policy-blocked until the project is already `detached` or
  `sandbox_cleaned` in Recallant;
- confirmed cleanup removes `.recallant/config`, `.recallant/codex-mcp.json`, and
  `.recallant/current-session.json`;
- `AGENTS.md`, `PROJECT_LOG.md`, `.gitignore`, source files, local attach backups, and the sandbox
  copy directory are preserved.

The current installed-wrapper onboarding follow-up is complete for the first safe slice:

- `npm run onboarding:smoke` installs `recallant` into a temporary prefix through
  `scripts/install-recallant-cli.sh`;
- the installed wrapper runs `lint-context`, ordinary `recallant attach .`, `agent-start`, decision
  capture, and closeout against an isolated temporary database;
- `npm run installer:smoke` verifies full server-installer dry-run planning for `owner-server` and
  `single-user` profiles;
- dry-run prints env/data/CLI/systemd/Postgres/migration actions and exits before creating files,
  starting Docker, writing DB rows, or touching systemd.
- The local dev database used by smoke tests is now isolated on `127.0.0.1:15433`; a clean
  `make db-reset` followed by `npm run smoke:core` passes end to end.
- `recallant lint-context` now applies configured context policy instead of fixed size checks, accepts
  explicit large-project overrides with a reason, and still fails hard on copied history, adapter
  rule duplication, or secret-like values.
- Phase 6 graph/context smoke uses a temporary project path, so full `smoke:core` no longer mutates
  `/ai/recallant/PROJECT_LOG.md`.
- Phase 7 init/discover/import contract rows for dry-run, pointer-only config, capture profiles,
  preview safety, `.env` secret redaction, and client-specific audience are now checked in
  `TEST_CONTRACT.md` and covered by smoke automation.
- `memory_search(query="project")` and similar session-scoped broad startup queries are rejected with
  `BROAD_STARTUP_QUERY`; agents should start with `memory_get_context_pack`.
- `recallant doctor` now reports structured owner-server deployment checks for Recallant port
  registration and the `/ai/SECURITY` consultation baseline.

The current Review action follow-up is complete for the governed-memory action set:

- Review detail now exposes real browser controls for accept, reject, archive, unarchive, mark
  stale, promote instruction, demote instruction, edit, merge, and supersede;
- `/review-action` form posts and `/api/review-action` JSON posts both route through
  `reviewAgentMemory`;
- `npm run review-ui:smoke` verifies visible advanced controls and DB state for the full action
  matrix;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and authenticated Review HTML shows `Promote to rule`, `Edit memory`, and
  `Supersede / merge`.

The current Review permanent-forget follow-up is complete for selected governed memories:

- Review detail exposes `Forget forever` as a separate dangerous flow from ordinary project detach;
- `/api/memory-forget` and `/memory-forget` both route through `memory_forget`/`database.forget`;
- dry-run returns affected counts and leaves content unchanged;
- confirmation redacts the governed memory body/title and source quotes, archives it, sets
  `do_not_use`, and writes a redacted `erasure_requests` receipt;
- `npm run review-ui:smoke` verifies the API path, browser form path, confirmation gate, redaction,
  and absence of erased secret text in the receipt/rendered confirmation page;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and authenticated Review HTML shows `Forget forever`, `/memory-forget`, and
  `Dry-run forget forever`.

The current Settings UI follow-up is complete for the first editable project-settings slice:

- Settings now shows browser forms for capture profile, context budget profile, review sensitivity,
  local embedding route enablement, paid API mode, enabled clients, project paths, and project
  aliases;
- `/project-setting` form posts and `/api/project-setting` JSON posts both write through
  `setProjectSetting`;
- `setProjectSetting` now accepts `project_id`, so Review UI writes target the selected project
  rather than silently using the server host project;
- dangerous route/cost/capture-style changes remain confirmation-gated;
- `npm run review-ui:smoke` verifies settings editor visibility, inherited/project source display,
  safe setting update, dangerous setting confirmation, confirmed update, and
  `settings_audit_events` rows;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and authenticated Review HTML shows `Edit project settings`, `Context budget`,
  `Enabled clients`, `Project aliases`, and `system_settings`.

The current instruction-promotion guard follow-up is complete:

- Review UI shows `Promote to rule` only when selected memory has visible source refs;
- selected memories without source refs show `Promotion requires visible source refs first.`;
- `reviewAgentMemory(action="promote_instruction")` returns `source_refs_required` for crafted
  requests without source refs;
- successful promotion still writes an `agent_memory_review_actions` row;
- `npm run review-ui:smoke` verifies all of the above against an isolated database;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and authenticated Review HTML still shows `Promote to rule` for a selected
  memory with visible evidence excerpts.

The current duplicate-resolution follow-up is complete for canonical choice:

- selected duplicate/conflict memories show `Duplicate resolution` in detail when peers exist;
- the owner can choose `Keep this, merge other` or `Use other, supersede this`;
- those forms post to the same `/review-action` merge/supersede policy path;
- `npm run review-ui:smoke` verifies the detail controls and that choosing selected memory as
  canonical marks the peer `superseded`;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and the authenticated Review route still renders `Conflicts / Duplicates`.

The current conflict-resolution follow-up is complete for old/new Review UI handling:

- selected conflict memories show `Conflict resolution` with older/newer record cards;
- actions can use newer and supersede older, keep older and archive newer, or demote the selected
  rule;
- `supersede` and `merge` now move superseded records out of `instruction_grade` to preserve the
  governed-memory lifecycle invariant;
- `npm run review-ui:smoke` verifies the old/new detail and the use-newer supersede form against an
  isolated database;
- production deploy verification after restart passed: `recallant.service` is active, local
  `/health` is OK, and the authenticated Review route still renders `Conflicts / Duplicates`.

Latest deployed checkpoint:

- Commit `595e13c Add conflict resolution review UI` was pushed to `origin/main` and applied by
  controlled `recallant.service` restart.
- Commit `194435d Add duplicate canonical resolution UI` was pushed to `origin/main` and applied by
  controlled `recallant.service` restart.
- Commit `505a143 Require source refs for instruction promotion` was pushed to `origin/main` and
  applied by controlled `recallant.service` restart.
- Commit `4700867 Add editable project settings UI` was pushed to `origin/main` and applied by
  controlled `recallant.service` restart.
- Commit `fe93e12 Add Review UI permanent forget flow` was pushed to `origin/main` and applied by
  controlled `recallant.service` restart.
- Commit `c33982f Enable full review action controls` was pushed to `origin/main` and applied by
  controlled `recallant.service` restart.
- Commit `e562a7e Improve Recallant onboarding and AI chat` was pushed to `origin/main`.
- `/usr/local/bin/recallant` is installed on the owner server.
- `recallant doctor` passed through the installed CLI with Postgres reachable, Ollama reachable,
  expected local models present, and paid API mode `confirm_each`.
- `recallant.service` was restarted after deploy and is active on `127.0.0.1:3005`.
- Local `/health` passed after restart.
- Public unauthenticated `https://recallant.unicloud.ca/` still returns the expected Cloudflare
  Access redirect.
- Live Management Chat API answered through local AI interpretation:
  `source=local_ai`, `model=mistral-small:24b`, `intent=next_steps`, `language=ru`.
- Dev `recallant-dev` Docker environment was stopped after smoke tests.

Latest QA correction checkpoint:

- Owner-tested `/ai/test_project_1` exposed a bug: `recallant attach . --sandbox` reported the
  existing `/ai/recallant` project id `84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce`.
- Fixed project resolution so explicit attach paths ignore configured `RECALLANT_PROJECT_ID` unless
  they match configured `RECALLANT_PROJECT_PATH`.
- Fixed stale local config handling so attach validates an existing `.recallant/config` against the
  database project binding and ignores it when it points to a different path.
- Verified with `npm run build`, `npm run lint`, `npm run format:check`, `npm run phase10:smoke`
  against isolated dev Postgres, and a real installed-wrapper attach in
  `/tmp/recallant-new-project-smoke` with production-like env binding. The wrapper produced a new
  project id, not the host id.
- Production repair on 2026-05-31: restored project `84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce` to
  `name=recallant`, `primary_path=/ai/recallant`; archived the two wrong attach-bootstrap memories
  on that project; closed two wrong `recallant-attach` sessions as `superseded`; attached
  `/ai/test_project_1` as sandbox project `9f7bca40-f763-4cb2-846b-909729882c51`.
- Autonomous E2E validation on `/ai/test_project_1` then exercised the real installed
  `recallant mcp-server` path from inside the project folder. It verified startup/context pack,
  workflow event capture, governed memory creation, lexical search, governed-memory recall,
  same-project cross-project boundary, closeout, and `PROJECT_LOG.md` sync.
- Fixes from that validation: `memory_append_event` indexes captured text into chunks/embeddings,
  `memory_closeout` updates `PROJECT_LOG.md`, attach startup smoke closes its internal session, and
  Phase 3 smoke no longer mutates the Recallant repo log.
- Management readiness follow-up: the Review Dashboard API/UI now includes `project_readiness`
  signals and an `Agent Readiness` panel for the selected project. A real dry-run sandbox detach for
  `/ai/test_project_1` succeeded without changing records or files and showed the expected
  hidden/search-disabled lifecycle plan.
- Manual UI cleanup follow-up: `Cleanup / Forget` now has a dry-run and confirmation form for
  removing the selected project from active Recallant views/search without touching files on disk.
  The same backend policy path as CLI detach is used.
- Do not ask the owner to run attach as QA until the agent has already run the equivalent scenario
  independently.

The next required target is no longer the Product Acceptance loop; that loop is green for the first
slice. Permanent-forget UI, richer Management UI action flows, remaining CLI init/discover/import
contract gaps, or a separate explicit workflow for deleting sandbox copy directories are now the
highest-value follow-ups.

Current contract-hardening checkpoint:

- `recallant closeout-intent` is implemented as a read-only CLI helper for configured Russian and
  English closeout phrases, `Exit`, ambiguous pause wording, and risky/non-routine wording.
- `memory_closeout` now warns when closeout-created governed-memory candidates require review.
- `recallant doctor` now exposes richer model-route policy for local model, active-agent,
  subscription-worker, and paid API routes, including disabled/confirmation-gated states and
  explicit opt-in boundaries for preview/expensive models.
- Targeted verification passed for this slice: `npm run build`, `npm run phase7:smoke`, and
  `npm run phase3:smoke`.
- Keep going from `docs/TEST_CONTRACT.md`: remaining closeout error-report fixtures, exact
  `recallant context`/MCP parity, denied/expired paid API approval behavior, and the broader
  backup/security/cleanup rows still need explicit smoke-backed closure.

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

The next session should start clean from this handoff, `PROJECT_LOG.md`, and current git state. It
should continue from the green Product Acceptance slice into the next documented follow-up without
reopening the already-passed attach/capture/dogfood gate unless a regression appears.
