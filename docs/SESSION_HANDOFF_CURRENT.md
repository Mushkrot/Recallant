# Current Session Handoff

Last updated: 2026-06-01.

This is the current handoff for the next Recallant session. Start here after reading `AGENTS.md`.

## Current State

Recallant is deployed on the owner server, the GutenDocx copied-project sandbox pilot is complete,
and the first product-UX readiness pass is deployed. Phase 10 has working first slices for
autonomous project attach/detach, controlled cross-project recall, one-command project onboarding,
AI-backed Management Chat, owner-confirmed developer-wide rules, target-aware `codex`/`generic`
MCP config generation, and multi-client startup documentation. The Product Acceptance agent capture
scenario now passes for the first production-ready slice: a clean project can run ordinary
`recallant attach .`, start a Recallant-backed session, read context, write decisions/actions/tests/
checkpoints, close out, recall that memory in a later session, show capture-active readiness in the
Review UI/API, and detach safely without touching project files.

Server-wide Playwright QA is now installed for Recallant Workbench and other browser UI checks:
`/usr/local/bin/playwright` wraps the global Playwright CLI, uses shared browser binaries under
`/ai/playwright/browsers`, and writes optional reports/screenshots under `/ai/playwright/reports`.
It is an on-demand QA tool only; there is no `playwright*` systemd unit, no Playwright listener, and
the installation is recorded in `/ai/SECURITY` plus `/ai/PORTS.yaml` with `ports: []`.
Recallant-specific browser QA is now implemented as `npm run review-ui:playwright`; it starts a
local authenticated Workbench fixture, checks desktop/mobile layout and Ask Recallant readability in
headless Chromium, writes screenshots under `/ai/playwright/reports`, and closes the browser/server
after the run.
The latest Workbench source slice adds human-readable source health/status, source provenance
summaries in Review rows, and a `source_id` Review/dashboard filter for source-linked import
candidates, inbox items, and active rules. It is verified by `npm run project-sources:smoke`,
`npm run review-ui:smoke`, and `npm run review-ui:playwright`.
Production `recallant.service` was restarted on 2026-06-01 after the Workbench UI changes because
the live browser still showed the older in-memory `Recallant Review Command Center`. Post-restart
checks passed: local `/health`, unauthenticated `/review` `401`, authenticated local `/review`
contains `Recallant Workbench` and `Ask Recallant`, public unauthenticated
`https://recallant.unicloud.ca/` redirects through Cloudflare Access, and `recallant-postgres`
remains healthy on `127.0.0.1:15432`.

The first copied-project pilot has been run on a GutenDocx sandbox copy. See
[PILOT_REPORT_GUTENDOCX_2026-05-28.md](PILOT_REPORT_GUTENDOCX_2026-05-28.md). Do not attach the
live `/ai/gutendocx` project yet unless the owner explicitly chooses that next step. The safer next
work is to deepen owner-facing Management UI action flows, extend local sandbox cleanup beyond the
first safe pointer/runtime-artifact slice, or run another sandbox/live-project pilot after the agent
has independently validated the same attach/capture/closeout/recall flow.

Current contract status: `docs/TEST_CONTRACT.md` has no remaining unchecked rows. The latest
contract-hardening slice added smoke-backed coverage for Review Inbox long-term/action candidates,
Review UI first-screen critical status/rule filters/cost view, closeout warnings for conflicts/
repo-sync/low-confidence/model-provider errors, raw-secret attach policy, and production-readiness
diagnostics in `recallant doctor`.

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
7. Read `docs/CLIENT_SETUP.md`.
8. Read `docs/CROSS_PROJECT_RECALL.md`.
9. Read `docs/IMPLEMENTATION_STATUS.md`.
10. Skim `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` for the relevant gate.
11. Run `git status --short --branch`.
12. Run `git log --oneline -8`.
13. Review `docs/PILOT_REPORT_GUTENDOCX_2026-05-28.md` if the next task touches pilot cleanup or real-project onboarding.

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
- confirmed cleanup removes Recallant local pointer/runtime files, including `.recallant/config`,
  `.recallant/codex-mcp.json`, `.recallant/generic-mcp.json`, and
  `.recallant/current-session.json` when present;
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

The current upstream reference set now includes `rohitg00/agentmemory` as of 2026-06-01:

- local snapshot `.upstream/agentmemory` at `fd9e3bd42d6208a33f0ee9de1442fdbb60eab106`;
- package version `0.9.24`;
- added documentation: `docs/UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md`;
- key lesson: AgentMemory is the strongest reference for client `connect`, hooks, native skills,
  viewer/replay, capture-active diagnostics, and sandboxed retrieval evals, but it does not replace
  Recallant's governed Postgres/project-lifecycle architecture.

The current product framing refinement as of 2026-06-01 is documented in
[ADR-0045-human-centered-memory-and-workbench.md](ADR-0045-human-centered-memory-and-workbench.md)
and [HUMAN_MEMORY_AND_UI_DIRECTION.md](HUMAN_MEMORY_AND_UI_DIRECTION.md):

- Recallant is external memory for the owner and AI agents, not only memory for coding agents.
- Coding-agent memory remains the first concrete domain and acceptance path.
- A project is a logical memory space; folders, repos, server paths, documents, connectors, and
  virtual/manual topics are sources attached to that memory space.
- The UI must speak professional human language by default and keep raw technical fields/JSON in
  collapsed details.
- AI interpretation should be the normal path for semantic requests, while deterministic policy
  remains authoritative for secrets, deletion, paid API, public exposure, production changes, auth,
  storage, and audit.

The current documentation alignment audit and forward plan are:

- [DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md](DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md)
- [DEVELOPMENT_PLAN_2026-06-01.md](DEVELOPMENT_PLAN_2026-06-01.md)

Future implementation should not treat Phase 10 as still pending. The next work is the
post-acceptance human-centered product evolution plan: human workbench quality, AI-native
management, project sources/memory spaces, client connect/hooks, more pilots, broader memory-domain
design, and packaging.

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

The next required target is no longer the Product Acceptance loop or the TEST_CONTRACT gap list;
those are green for the first production-ready slice. Richer Management UI action flows, PRD
requirement-by-requirement closure, and a separate explicit workflow for deleting sandbox copy
directories are now the highest-value follow-ups.

Latest target-aware onboarding checkpoint:

- `recallant init` now validates/normalizes `--target`, writes the target MCP hint file, and includes
  `.gitignore` in the generated project files. `--target codex` writes
  `.recallant/codex-mcp.json`; `--target generic` writes `.recallant/generic-mcp.json`.
- `recallant attach` now uses the same target-aware generator. Codex keeps the Codex hint; generic
  writes the generic MCP stdio hint and does not create a Codex-specific file.
- `recallant local-cleanup` now removes both generated MCP hint files when present, after the same
  detach/sandbox-cleaned policy gate.
- [CLIENT_SETUP.md](CLIENT_SETUP.md) documents Codex, Cursor, Claude Code, Windsurf, and generic MCP
  startup paths with official references and Recallant env/config guidance.
- Verification for this slice: `npm run build`, `npm run lint`, `npm run format:check`,
  `npm run phase7:smoke`, `npm run phase10:smoke`, and `npm run local-cleanup:smoke`.

Latest PRD synchronization checkpoint:

- `docs/PRD.md` no longer contains stale unchecked acceptance rows; the checkboxes were synchronized
  against the already-green `docs/TEST_CONTRACT.md` coverage.
- The only new test added for that sync is the missing G3 stress edge: Phase 8 size-limit smoke now
  captures a 1M-size raw artifact as pointer/hash/excerpt and verifies bounded search output.
- Verification for this focused update: `npm run phase8:smoke:limits`.
- Full clean regression after the sync passed: `npm run build`, `npm run lint`,
  `npm run format:check`, `make db-reset`, `npm run smoke:core`, and `make db-down`.

Latest production-facing verification:

- No Recallant service restart was required for this CLI/docs-only slice. The installed
  `recallant` wrapper was verified with `recallant init --target generic --dry-run`.
- Production service checks passed after the pushed commits: `recallant.service` active, local
  `/health` OK, authenticated local `/api/review-dashboard` OK, public
  `https://recallant.unicloud.ca/` returns Cloudflare Access `302`, and `recallant doctor
  --project-dir /ai/recallant` reports `production_readiness.ready=true`.

Previous contract-hardening checkpoint:

- `recallant closeout-intent` is implemented as a read-only CLI helper for configured Russian and
  English closeout phrases, `Exit`, ambiguous pause wording, and risky/non-routine wording.
- `memory_closeout` now warns when closeout-created governed-memory candidates require review.
- `recallant doctor` now exposes richer model-route policy for local model, active-agent,
  subscription-worker, and paid API routes, including disabled/confirmation-gated states and
  explicit opt-in boundaries for preview/expensive models.
- `recallant context --session-id <id>` now previews the same active-session context pack path as
  MCP `memory_get_context_pack`; Phase 6 smoke compares the core pack sections for parity.
- Paid API embedding routes now defer after a denied/expired approval without creating a second
  approval or provider call; Phase 4 smoke covers the denied-approval branch.
- `schema:smoke` now verifies the migrated DB baseline and is part of `smoke:core`; MCP smoke now
  checks the exact tool list.
- Phase 3 smoke now verifies Cursor/Claude Code/Windsurf session-start parity and developer-default
  capture policy precedence.
- Targeted verification passed for this slice: `npm run build`, `npm run phase7:smoke`, and
  `npm run phase3:smoke`; follow-up parity verification passed with
  `npm run phase6:smoke:graph`; paid-approval verification passed with `npm run phase4:smoke`;
  schema/MCP verification passed with `npm run schema:smoke` and `npm run mcp:smoke`.
Latest contract-hardening checkpoint:

- `memory_list_agent_memories(view="inbox")` now includes important long-term/action candidates:
  scope changes, duplicate/conflict signals, promotion/demotion/archive/supersede candidates,
  high-risk guidance, and low-confidence behavior guidance, while keeping routine evidence out of
  mandatory review.
- Review Dashboard first screen now exposes unclosed/interrupted sessions, unsynced spool,
  high-risk conflicts, pending paid API approvals, active-rule filters, and current day/month cost
  summaries by project/provider/model/purpose.
- `memory_closeout` now sets `report_required=true` for governed-memory conflicts, failed writes,
  incomplete repo sync, low extraction confidence, and server/model/provider errors.
- `recallant attach` now reports raw secret findings without leaking values; live/production
  preflight does not modify source files, while sandbox/test masking happens only after a redacted
  local backup exists.
- `recallant doctor` now reports a structured production-readiness object for local stdio MCP smoke,
  Cloudflare Access, localhost-only origin, backup timer, latest backup verification, duplicate
  `/ai/recallant` rows, and unintended paid API use.
- Production readiness now uses real server state for backup checks: `recallant-backup.timer`
  systemd status plus `/ai/recallant-data/backups/latest-verification.json`, which the production
  backup script writes after `backup-verify`.
- Verification for this latest slice: `npm run build`, `npm run lint`, `npm run format:check`,
  targeted changed-slice checks (`npm run phase7:smoke`, `npm run phase6:smoke:governed`,
  `npm run review-ui:smoke`, `npm run phase10:smoke`), clean `make db-reset`, full
  `npm run smoke:core`, and `make db-down`.
- Production verification after controlled restart passed: service active, local `/health`,
  authenticated `/api/review-dashboard`, public Cloudflare Access `302`, backup+verify sidecar,
  `production_readiness.ready=true`, and local stdio MCP smoke.

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

## Current Implementation Checkpoint

2026-06-01 Stage 1 Workbench UI first slice is implemented.

- The private UI now presents itself as `Recallant Workbench`, not a raw Review Command Center.
- The first screen is structured around Command Center, Memory Spaces, Activity / Replay, Ask
  Recallant, Review, and Settings.
- Ask Recallant is in the central work area, so long chat answers no longer live in the narrow
  right rail.
- Memory Spaces show source, isolation/sharing policy, and capture state in owner-facing language.
- The dashboard API now exposes recent activity rows for session start, context read, memory write,
  and checkpoint; per-project rows expose capture-state timestamps.
- Technical ids, JSON, route classes, provider/model details, and schema terms remain available
  under collapsed Technical details rather than the primary workflow.
- `npm run review-ui:smoke` now verifies the Workbench vocabulary, layout CSS contract, central Ask
  Recallant placement, human labels, capture activity, and the previous review/chat/settings/
  cleanup/forget gates.
- Follow-up Workbench slice: Ask Recallant is now the wide top work surface, while Selected Detail,
  Cost / Paid API, Cleanup / Forget, and Settings are secondary lower panels. Browser QA verifies
  desktop/mobile no-horizontal-scroll and long Russian chat readability.
- 2026-06-02 composition follow-up: Ask Recallant is now the first central surface with a compact
  current memory-space profile beside it. Source management is a wide `Sources` workspace with
  selected-source health, detach controls, create-space, and attach-source flows. The former right
  rail is a lower secondary workspace, and mobile puts Ask Recallant before the memory-space
  navigator. `npm run review-ui:smoke` and `npm run review-ui:playwright` verify the new layout
  order and readability.
- 2026-06-02 Workbench refinement follow-up: Ask Recallant is larger and visually primary, the
  Sources workspace now shows active/detached/provenance-filter summary, and
  Selected Detail/Cost/Cleanup/Settings live in compact governed Operations panels. `review-ui:smoke`
  and `review-ui:playwright` pass and screenshots are under `/ai/playwright/reports`.
- 2026-06-02 Ask-first Workbench follow-up: Ask Recallant now spans the top of the Workbench before
  the Memory Spaces / Command Center / Sources workspace. Source management is presented as a
  Source Map with shortcuts to source-linked memories and provenance filtering, and governed
  Operations are collapsed below the main work area. `review-ui:smoke` and `review-ui:playwright`
  pass with updated screenshots under `/ai/playwright/reports`.

2026-06-01 Stage 2 Management Chat first slice is implemented.

- Management Chat responses now include `result_type`:
  `read_only_answer`, `safe_action`, `dry_run_required`, `confirmation_required`,
  `blocked_by_policy`, or `needs_clarification`.
- The field is additive; existing `intent`, `confirmation_required`, `destructive_or_sensitive`,
  facts, and proposed-action fields remain for compatibility.
- Ask Recallant displays a human-readable result badge.
- Secret-reveal requests are policy-blocked rather than confirmation-gated. Recallant may confirm a
  secret reference exists, but it must not show raw secret/password/token/API-key values.
- `npm run review-ui:smoke` verifies read-only, global-rule safe action, cleanup dry-run,
  paid/public/connector/global-setting confirmation, sandbox cleanup targeting, and secret policy
  block result types.
- The chat fallback now recognizes common owner questions about project connection/capture status,
  what the agent remembered, why a rule is not applying, and Google Drive/example lookups.
- Follow-up AI-path validation: `npm run management-chat-ai:smoke` uses a mock Ollama endpoint to
  verify local-AI semantic interpretation for colloquial Russian sandbox cleanup, ambiguous sandbox
  target clarification, developer-wide rule creation from non-exact wording, source-management
  requests, and provenance questions.
- 2026-06-02 source-operation follow-up: source-management asks now return `needs_clarification`
  when the owner has not provided a memory-space name or exact source location, and concrete source
  attach asks produce a safe plan for the `Sources` workspace or `recallant source attach` without
  executing the write directly from chat. Verified by `npm run management-chat-ai:smoke` and
  `npm run review-ui:smoke`.
- 2026-06-02 onboarding/QA follow-up: Management Chat now classifies project onboarding and pilot QA
  as first-class intents. Missing new-project paths ask for clarification; concrete paths produce
  attach/connect/doctor dry-run plans; pilot QA asks produce product-acceptance, pilot-report, and
  browser-QA evidence commands. Verified by `npm run management-chat-ai:smoke` and
  `npm run review-ui:smoke`.

2026-06-01 Stage 3 Project Sources first slice is implemented.

- The schema now includes `project_sources` as the physical source-binding table.
- `projects.primary_path` remains a compatibility/display fallback.
- `ensureProject` and `registerProject` create or refresh a primary `workspace_path` source for
  folder-backed projects.
- DB APIs now support:
  - creating a memory space with zero sources;
  - attaching a source to a memory space;
  - listing sources;
  - detaching one source without deleting memory space memory;
  - listing memory spaces with source bindings.
- CLI first slice:
  - `recallant memory-space create|list`
  - `recallant source attach|list|detach`
- Workbench Memory Spaces shows attached source information when available and falls back safely to
  `primary_path`.
- Workbench forms now create logical memory spaces, attach a source to the selected memory space,
  and detach one source without deleting the memory space, its memories, or project files.
- Follow-up context-pack provenance: binding rules and working memories now include redacted
  `source_refs` plus compact `provenance` summaries. Agents can tell where a context-pack fact or
  rule came from without reading raw artifacts or old project history files.
- `npm run project-sources:smoke` verifies virtual memory space creation, zero-source state,
  multiple source bindings, source detach, automatic primary workspace source creation, and
  dashboard source visibility.
- Full `npm run smoke:core` passed after the Stage 3 source-binding migration and CLI/API changes.

2026-06-01 Stage 4 Connect CLI first slice is implemented.

- `recallant connect <client>` now exists as a separate lifecycle command from `attach`.
- It writes or verifies project-local MCP config and reports `connection_status=mcp_only`,
  `hook_status=not_installed`, and capture observation state.
- `connect --dry-run` reports exact planned file changes and writes nothing.
- Codex connect is idempotent after attach because attach still creates `.recallant/codex-mcp.json`
  for compatibility.
- Claude Code now has a dedicated project-local `.mcp.json` writer. It merges
  `mcpServers.recallant` into existing local MCP config, preserves other servers, creates a local
  backup when changing an existing file, supports dry-run, and is idempotent. Other non-Codex
  clients still use the generic MCP fallback.
- This slice does not write global client config. Project-local fail-soft hooks are available
  through `--install-local-hooks`.
- `npm run connect:smoke` and full `npm run smoke:core` passed for the first slice; the latest
  connect smoke also verifies Claude Code `.mcp.json` merge/backup/idempotency.
- Follow-up Stage 4 gate: `recallant doctor --require-capture` now reports
  `capture_readiness` and exits with status 2 until the project has context read, memory write, and
  checkpoint evidence. `connect:smoke` verifies failure before capture and success after
  agent-start/agent-event/agent-checkpoint.
- Follow-up local hook kit: `recallant connect --install-local-hooks` installs optional
  project-local scripts under `.recallant/hooks/` only. It writes no global client config, reports
  `hook_status=local_hook_kit_installed`, and the scripts exit 0 if `recallant` is missing or a
  timeout occurs. The kit now includes explicit targets for session start, owner prompt, tool
  result, pre-compaction checkpoint, generic event capture, and stop/closeout; `connect:smoke`
  verifies those hooks write prompt/tool/checkpoint/closeout events through a temporary Recallant
  wrapper.
- 2026-06-02 hook spool follow-up: project-local hook primary commands now pass
  `--spool-dir "$PROJECT_DIR/.recallant/spool"`, and hook scripts attempt a local `spool-append`
  fallback when primary capture fails while `recallant` is available. `connect:smoke` verifies the
  fallback writes project-local JSONL and still exits 0.
- 2026-06-02 hook-spool path QA follow-up: full `smoke:core` exposed that direct CLI closeout with
  `--project-dir` still checked the process working directory spool. The default spool path now
  resolves through the project directory, and `local-cleanup:smoke`, `spool:smoke`,
  `connect:smoke`, and full `smoke:core` pass.
- 2026-06-02 Cursor connect follow-up: `recallant connect cursor` now uses a dedicated
  project-local `.cursor/mcp.json` merge path. It preserves existing MCP servers, creates a local
  backup before changing an existing file, supports dry-run, stays idempotent, and writes no global
  config. `connect:smoke` covers the path.
- 2026-06-02 mandatory-startup diagnostics follow-up: `connect` output now includes
  `mandatory_startup_layer`, and `doctor` output includes `client_connection`. They distinguish
  MCP-only, planned MCP+hooks, installed MCP+hooks, and capture-active proof, including covered hook
  targets and the `doctor --require-capture` command. `connect:smoke` and `phase7:smoke` pass.

2026-06-01 Stage 5 Pilot Report first automation slice is implemented.

- `npm run pilot-report:smoke` runs one self-contained pilot report against isolated temporary
  projects and the dev DB.
- Clean empty-project pilot: ordinary attach, decision/action/test/checkpoint capture, closeout,
  later-session recall, `doctor --require-capture`, detach dry-run, confirmed detach.
- Copied existing-project sandbox pilot: creates an existing-project fixture, copies it, attaches
  only the copy, imports discovered agent/doc sources, creates a local backup, captures/recalls
  pilot memory, detaches the sandbox, and proves the original fixture hash tree is unchanged.
- Production-sensitive preflight pilot: verifies requested autopilot downgrades to guided,
  requires confirmation, writes no files, writes no database rows, and leaves project files
  unchanged.
- The smoke prints JSON with attached project ids, detected/imported sources, remembered and
  recalled markers, cleanup results, and untouched-original proof.
- `pilot-report:smoke` is included in `npm run smoke:core`.
- 2026-06-02 report-artifact follow-up: `pilot-report:smoke` now writes a persisted JSON artifact
  under `RECALLANT_PILOT_REPORT_DIR` or `/tmp/recallant-pilot-reports`, includes a `qa_summary` for
  the clean project, copied sandbox, and production-sensitive preflight scenarios, and reads the
  artifact back before passing.

Latest validation for the Workbench/source/chat follow-up slice:

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `git diff --check`
- `npm run review-ui:smoke`
- `npm run review-ui:playwright`
- `npm run management-chat-ai:smoke`
- `npm run project-sources:smoke`
- `npm run product-acceptance:smoke`
- `npm run connect:smoke`
- `npm run phase7:smoke`

Next autonomous work after this checkpoint:

- Stage 2: continue strengthening live local-AI semantic tests and multi-project clarification
  flows while keeping server policy as the execution authority.
- Stage 3: continue richer source health/status and search/review source filters.
- Stage 4: add real client/global config writers where safe, local backups for global/client files,
  dedicated client hook installation where supported, and richer hook capture/spooling.
- Stage 5: run additional non-fixture real-world pilots after hook capture and source-health UI are
  mature enough to make the reports more realistic.

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
should continue from the green Product Acceptance and TEST_CONTRACT slices into the next documented
follow-up without reopening already-passed attach/capture/dogfood/contract gates unless a regression
appears.
