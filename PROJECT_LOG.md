# Project Log

## Current Session

Status: Focused Workbench views are implemented and now have browser-level QA coverage.
Current focus: Continue turning the Workbench into a professional, human-readable control surface
while keeping Playwright checks for layout regressions.
Next step: Continue Stage 1/2/3/5 hardening: richer Ask Recallant scenarios, source/provenance UX,
and realistic pilot reports.
Last updated: 2026-06-02T05:49:15Z.
## Active Constraints

- Recallant is the main source of truth for durable project memory.
- This file is a compact fallback/checkpoint, not the full project history.
- Do not store secrets in repo docs or Recallant memories.
- Production-sensitive, destructive, paid API, public exposure, firewall, and secret-handling
  changes still require owner participation.
- On the owner server, consult `/ai/SECURITY` and `/ai/PORTS.yaml` before exposure/service/security
  changes.
- Server-wide Playwright is available as an on-demand QA CLI at `/usr/local/bin/playwright`. It uses
  shared browser binaries under `/ai/playwright/browsers`, writes optional reports under
  `/ai/playwright/reports`, is not a systemd service, and should leave no listener or browser
  process after tests finish.

## Recent Decisions

- The operator path must be human-friendly: install with `scripts/install-recallant.sh`, then attach
  a normal project with `recallant attach .`.
- Management Chat must use a local AI model for natural-language interpretation when available,
  while deterministic policy remains authoritative for risky actions.
- If local AI under-classifies an obvious cleanup, developer-wide rule, onboarding,
  source-management, or pilot-QA request, deterministic server policy must override the intent so
  the request still goes through the governed dry-run/rule/action workflow.
- Ask Recallant should answer ordinary "what did we decide about X?" questions by looking up
  governed memory and showing source/provenance, not only by explaining generic Recallant concepts.
- Explicit owner requests to save low-risk rules for all projects create developer-scope
  `instruction_grade` memories that future Context Packs include across projects.
- Installed CLI attach must treat an explicit project path as authoritative. It must not reuse the
  server's configured `RECALLANT_PROJECT_ID` for `/ai/recallant` when attaching another project.
- Existing `.recallant/config` must be validated against the DB project binding. If it points to a
  different path, attach treats it as stale/foreign and rewrites it for the current project.
- Review UI should show an owner-readable agent-readiness state instead of forcing the owner to
  infer readiness from low-level sessions/events/memory counters.
- Project removal from Recallant must be a two-step UI flow: dry-run first, explicit confirmation
  second. It hides the project from active Recallant views/search and does not touch files on disk.
- Cleanup / Forget must show the exact selected project name, path, and full id before dry-run or
  confirmation. The owner tested removing one sandbox project successfully, then hit confusion on
  `gutendocx-20260528T161238Z`; live dry-run worked, so the UI now makes the selected target
  explicit.
- Do not ask the owner to perform basic attach validation before the agent has independently run an
  equivalent real command path.
- Product readiness requires the end-to-end agent capture loop, not only attach/project
  registration. An attached project must start a Recallant-backed session, read context, write
  decisions/actions/tests/checkpoints, close out, and recall that memory in a later session.
- Commit/progress checkpoints are not stopping points. Continue to the next documented gate unless a
  real owner-dependent blocker appears.
- `docs/TEST_CONTRACT.md` has no remaining unchecked rows; do not reopen the full contract gap list
  unless a regression appears.
- Recallant is now explicitly framed as external memory for the owner and AI agents. Coding-agent
  memory is the first implemented domain, not the final product boundary.
- A Recallant project is a logical memory space; folders, repos, server paths, documents,
  connectors, and virtual/manual topics are sources attached to that memory space.
- Model routing must support AI-first management interpretation while keeping local-first,
  subscription-first, API-last behavior and explicit confirmation/cost/audit controls for paid API
  or third-party model routers.
- The forward plan after the green acceptance surface is documented in
  `docs/DEVELOPMENT_PLAN_2026-06-01.md`.
- Playwright is accepted as the server-level visual QA layer for Workbench/browser UI checks. It is a
  dev/QA tool, not a Recallant runtime dependency.
- Recallant-specific browser QA is implemented as `npm run review-ui:playwright`. It starts a local
  authenticated Recallant Workbench fixture on a random localhost port, checks desktop and mobile
  layout in headless Chromium, submits long chat answers, verifies no horizontal overflow, and writes
  screenshots under `/ai/playwright/reports`.
- Focused Workbench QA now opens `Ask`, `Sources`, and `Settings` directly, verifies that each
  focused surface is wide enough, confirms unrelated panels are absent, and saves dedicated
  screenshots. This caught and fixed a real bug where focused Settings still used the old half-width
  operations grid.

## Verification

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run review-ui:smoke`
- `npm run review-ui:playwright`
- `systemctl restart recallant`
- local `/health` returned `{"ok":true,...}` after restart
- unauthenticated local `/review` returned `401`
- authenticated local `/review` HTML contains `Recallant Workbench` and `Ask Recallant`, with no
  `Recallant Review Command Center` marker in the checked output
- public unauthenticated `https://recallant.unicloud.ca/` returned Cloudflare Access `302`
- `recallant-postgres` remained healthy on `127.0.0.1:15432`
- Playwright screenshots written to:
  - `/ai/playwright/reports/recallant-workbench-desktop.png`
  - `/ai/playwright/reports/recallant-workbench-desktop-focused-ask.png`
  - `/ai/playwright/reports/recallant-workbench-desktop-focused-sources.png`
  - `/ai/playwright/reports/recallant-workbench-desktop-focused-settings.png`
  - `/ai/playwright/reports/recallant-workbench-desktop-chat.png`
  - `/ai/playwright/reports/recallant-workbench-mobile-chat.png`
- Host process/socket checks after Playwright smoke found no remaining `playwright`/browser process
  and no Playwright-related listener.
- isolated temporary Postgres on `127.0.0.1:55432` for Review UI smoke, then container removed
- live `/project-detach` dry-run for `gutendocx-20260528T161238Z` after service restart; confirm
  button, selected project name/path, 18 active chunks, and 5 active memories rendered; project
  remained visible afterward
- live DB inspection showed `/ai/recallant` is registered, but current Codex chat work was not
  automatically captured as events; this is now the primary product gap
- CLI fallback commands now cover the first capture loop slice: `agent-start`, `agent-event`,
  `agent-checkpoint`, and `agent-closeout`. Decision events create source-linked accepted
  project-local memories so a later context pack can recall them.
- Governed-memory recall now tokenizes task hints and scopes context-pack working-memory recall to
  the session project, fixing the issue where a stored decision did not return for a related task
  hint.
- `recallant attach` now generates startup text and owner reports that point agents to
  `recallant agent-start --task-hint`, with `agent-event`, `agent-checkpoint`, and
  `agent-closeout` as the fallback capture runtime. Attach no longer implies that project
  registration alone is enough.
- Review dashboard readiness now distinguishes registered-only projects from capture-active
  projects using last context read, last memory write, last checkpoint, capture event count, and
  captured decision count.
- Context previews and spool sync now close their technical sessions with `client_exit` so ordinary
  context checks do not leave confusing active sessions in the Review UI.
- `npm run product-acceptance:smoke` is the named acceptance gate. It uses ordinary
  `recallant attach .`, verifies the capture loop, confirms later recall, checks dashboard
  readiness, verifies no lingering active sessions, exercises offline spool sync, and safely
  detaches the test project without changing files.
- Documentation alignment verification on 2026-06-01: `npm run format:check`, `npm run lint`, and
  `git diff --check` passed.
- Management Chat policy-guard verification on 2026-06-02: `npm run management-chat-ai:smoke`,
  `npm run review-ui:smoke`, `npm run lint`, `npm run format:check`, and `git diff --check` passed
  after adding deliberately misclassified cleanup/global-rule AI responses.
- Management Chat memory-lookup verification on 2026-06-02: `npm run build`,
  `npm run management-chat-ai:smoke`, `npm run review-ui:smoke`, `npm run lint`,
  `npm run format:check`, and `git diff --check` passed after adding a Google Drive governed-memory
  lookup scenario with current-project and cross-project source provenance.
- Full core verification on 2026-06-02T05:49:15Z: `npm run smoke:core` passed after the focused
  Workbench visual QA, Management Chat policy guard, and governed-memory lookup changes. Pilot
  report QA summary remained green for clean project, copied sandbox, production-sensitive preflight,
  and source-linked cross-project recall.
- `recallant local-cleanup` is the first local sandbox cleanup slice. It is blocked until detach,
  then removes only `.recallant/config`, `.recallant/codex-mcp.json`, and
  `.recallant/current-session.json`; it preserves bootstrap files, source files, and local attach
  backups.
- `npm run onboarding:smoke` installs the CLI wrapper into a temporary prefix and verifies the
  installed `recallant` command can attach a clean project and run the capture runtime.
- Review UI advanced action controls now execute real actions instead of showing disabled labels:
  edit, merge, supersede, promote/demote instruction, unarchive, and the basic accept/reject/archive
  actions all route through the same DB policy path.
- Review UI permanent-forget now has a separate selected-memory flow: dry-run first, explicit
  confirm second, governed-memory redaction on confirm, and redacted receipt display without erased
  content.
- Review UI project settings now has human-editable forms for capture profile, context budget,
  review sensitivity, local embedding route enablement, paid API mode, enabled clients, project
  paths, and project aliases. Setting writes target the selected project and record audit events.
- Promotion to `instruction_grade` now requires visible source refs. The UI shows an explanation
  instead of a promote button when source refs are missing, and the DB policy rejects crafted
  promote requests without source refs.
- Duplicate candidate detail now shows canonical-choice actions. The owner can keep the selected
  memory and merge a peer, or use another peer and supersede the selected memory, without copying
  UUIDs by hand.
- Conflict candidate detail now shows old/new records and actions to use newer, keep older/archive
  newer, or demote the selected rule. Superseded memories now drop `instruction_grade` so lifecycle
  policy stays schema-valid.
- `scripts/install-recallant.sh` now supports `--dry-run`, `--profile owner-server`, and
  `--profile single-user`, with path override flags. Dry-run prints the exact plan and exits before
  file, Docker, database, or systemd writes.
- Dev smoke tests now use dedicated Recallant dev Postgres on `127.0.0.1:15433` so they cannot
  accidentally connect to unrelated localhost Postgres services.
- Cross-project developer-rule smoke now proves developer-wide `instruction_grade` recall only after
  source refs are present.
- Spool sync smoke now passes `--project-dir` when syncing a specific project spool, so the fallback
  capture path verifies the intended project binding instead of the caller's cwd.
- `recallant lint-context` now resolves a configurable context policy from CLI override,
  project-level `context_budget_profile`, or the default profile. Expanded/custom CLI overrides
  require an explicit reason.
- Context lint treats size excess as policy-controlled, but duplicated history dumps, duplicated
  adapter/bootstrap rules, and secret-like values remain hard failures.
- Phase 6 graph/context smoke now uses a temporary project path so checkpoint sync cannot mutate
  `/ai/recallant/PROJECT_LOG.md`.
- Phase 7 smoke now asserts dry-run creates no files, init writes pointer-only config with valid UUID,
  default init stores `capture_profile=standard`, detailed override is stored, preview workflows do
  not create import batches or agent memories, and dry-run import exposes source refs/risks without
  durable writes.
- `memory_search` now rejects session-scoped broad startup queries such as `project` with
  `BROAD_STARTUP_QUERY`, telling agents to start with `memory_get_context_pack` and then ask a
  specific evidence query.
- `recallant doctor` now emits structured owner-server deployment checks for planned Recallant port
  registration and the `/ai/SECURITY` consultation baseline.
- Review Inbox now includes important long-term/action candidates by default: scope-changing
  candidates, duplicate/conflict signals, promotion/demotion/archive/supersede candidates,
  high-risk guidance, and low-confidence behavior guidance.
- Review Dashboard first screen now exposes unclosed/interrupted sessions, unsynced spool,
  high-risk conflicts, active-rule filters, current day/month cost summaries, cost rows by
  project/provider/model/purpose, and pending paid API approvals.
- `memory_closeout` now reports attention-required warnings for governed-memory conflicts,
  incomplete repo sync, low extraction confidence, and server/model/provider errors.
- `recallant attach` reports raw secret findings without leaking values. Live/production-sensitive
  preflight does not modify source files; sandbox/test masking happens only after a redacted local
  backup exists.
- `recallant doctor` now includes production-readiness diagnostics for local stdio MCP smoke,
  Cloudflare Access, localhost-only origin, backup timer, latest backup verification, duplicate
  `/ai/recallant` project rows, and unintended paid API use.
- Production readiness now reads the real `recallant-backup.timer` systemd state and
  `/ai/recallant-data/backups/latest-verification.json`; the production backup job writes that
  verification sidecar after `backup-verify`.
- Targeted latest-slice verification passed: `npm run build`, `npm run phase7:smoke`,
  `npm run phase6:smoke:governed`, `npm run review-ui:smoke`, and `npm run phase10:smoke`.
- Full latest-slice verification passed: `npm run build`, `npm run lint`, `npm run format:check`,
  clean `make db-reset`, full `npm run smoke:core`, and `make db-down`.
- Full smoke was rerun after the production-readiness/systemd backup sidecar fix and passed again
  on a clean dev database.
- Dogfood capture checkpoint for this contract-hardening work synced from local spool to Recallant
  event `f6562c63-638b-4be4-9533-5eb4597f21c2`; synced spool record was pruned afterward.
- Controlled production checks passed after restart: `recallant.service` active, local `/health`
  OK, authenticated `/api/review-dashboard` OK, public `recallant.unicloud.ca` returned Cloudflare
  Access `302`, production backup+verify wrote latest verification, `recallant doctor` reported
  `production_readiness.ready=true`, and local stdio `npm run mcp:smoke` passed.
- `npm run phase10:smoke`
- real installed-wrapper attach from `/tmp/recallant-new-project-smoke` against isolated dev
  Postgres with production-like host project env binding
- real installed-wrapper attach of `/ai/test_project_1`, resulting in sandbox project
  `9f7bca40-f763-4cb2-846b-909729882c51`
- production E2E smoke on `/ai/test_project_1`
- sandbox detach dry-run for `/ai/test_project_1`
- Review UI smoke for project-removal dry-run and confirmation forms
- production `recallant doctor`
- production `/health`
- live Management Chat API using local `mistral-small:24b`
- `npm run agent-capture:smoke` against an isolated temporary Postgres on `127.0.0.1:55433`;
  verified attach, agent-start, decision/action/test capture, checkpoint, closeout, later context
  recall, offline spool, sync-spool, and repeat sync idempotency
- `npm run phase10:smoke` and `npm run agent-capture:smoke` passed together against the same
  isolated temporary Postgres after attach/bootstrap integration
- `npm run review-ui:smoke` verifies the registered-only UI state; `npm run agent-capture:smoke`
  verifies capture-active readiness fields through the dashboard API
- live `/ai/recallant` dogfood capture: `recallant agent-start`, `agent-event --kind decision`,
  `agent-event --kind test`, `agent-checkpoint`, and `agent-closeout` wrote a real product
  acceptance memory and checkpoint
- live `recallant context --task-hint "product acceptance decision ..."` recalled memory
  `bbe351f3-66a1-4f1c-a963-ff545c7e314b`, proving the next session can retrieve the captured
  decision
- rerun `npm run agent-capture:smoke` after the session cleanup fix; smoke now also asserts active
  sessions are zero after recall verification
- `npm run product-acceptance:smoke` rerun against isolated temporary Postgres on
  `127.0.0.1:55433`; passed after adding ordinary attach and detach cleanup checks
- production deploy verification after restart: `systemctl is-active recallant.service`, local
  `/health`, authenticated `/api/review-dashboard`, and Review HTML readiness check all passed
- `npm run local-cleanup:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed
- `npm run review-ui:smoke` against the same isolated DB; passed with local cleanup command visible
- production deploy verification after local cleanup restart: `systemctl is-active
recallant.service`, local `/health`, authenticated `/api/review-dashboard`, and Review HTML local
  cleanup check all passed
- `npm run onboarding:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  full review action matrix coverage
- production deploy verification after Review action restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review HTML check for `Promote to rule`,
  `Edit memory`, and `Supersede / merge` all passed
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  permanent-forget API/form dry-run, confirmation gate, governed-memory redaction, source quote
  clearing, and safe erasure receipt coverage
- production deploy verification after permanent-forget restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review HTML check for `Forget forever`,
  `/memory-forget`, and `Dry-run forget forever` all passed
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  settings editor visibility, safe setting update, dangerous setting confirmation, selected-project
  setting writes, and `settings_audit_events` coverage
- production deploy verification after Settings UI restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review HTML check for `Edit project
settings`, `Context budget`, `Enabled clients`, `Project aliases`, and `system_settings` all
  passed
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  instruction promotion review-history coverage and source-ref-required API/UI guard coverage
- production deploy verification after promotion-guard restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review HTML check for evidence-backed
  `Promote to rule` all passed
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  duplicate resolution detail visibility and canonical merge form coverage
- production deploy verification after duplicate-resolution restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review route check for
  `Conflicts / Duplicates` all passed. Conditional canonical controls remain covered by isolated
  DB smoke because production has no active duplicate fixture.
- `npm run review-ui:smoke` against isolated temporary Postgres on `127.0.0.1:55433`; passed with
  conflict old/new detail visibility, supersede/demote/archive action visibility, and use-newer
  supersede form coverage
- production deploy verification after conflict-resolution restart: `systemctl is-active
recallant.service`, local `/health`, and authenticated Review route check for
  `Conflicts / Duplicates` all passed. Conditional old/new controls remain covered by isolated DB
  smoke because production has no active conflict fixture.
- `npm run installer:smoke`; passed with owner-server and single-user dry-run profiles and asserts
  no env file, data dir, CLI prefix, containers, DB rows, or systemd services were changed
- Clean `make db-reset` followed by full `npm run smoke:core`; passed against isolated
  `recallant-dev` Postgres on `127.0.0.1:15433`
- `npm run phase7:smoke`; passed with fresh bootstrap lint, project-level expanded context policy,
  explicit large-project override, and hard failures for history dumps and secret-like values
- `npm run phase6:smoke:graph`; passed and left this repo `PROJECT_LOG.md` unchanged
- Final clean `make db-reset` followed by full `npm run smoke:core`; passed after the lint-context
  and smoke isolation fixes
- `npm run phase7:smoke`; passed after strengthening init/discover/import contract assertions
- `npm run phase5:smoke`; passed with broad startup query rejection coverage
- `npm run phase7:smoke`; passed with owner-server doctor ports/security coverage

## 2026-06-01 Stage 1 Workbench UI Checkpoint

- The private Review UI is now presented as `Recallant Workbench` with top-level navigation for
  Command Center, Memory Spaces, Activity / Replay, Ask Recallant, Review, and Settings.
- Ask Recallant moved from the narrow right column into the central work area; long answers now have
  a wider readable panel and bounded internal scrolling.
- Memory Spaces use plain language for source and isolation/sharing policy, while ids, JSON, route
  classes, provider/model details, and schema terms remain collapsed under Technical details.
- Dashboard data now includes per-project capture-state signals and recent Activity / Replay rows:
  session start, context read, memory write, and checkpoint.
- `scripts/smoke-review-ui.mjs` now verifies Workbench vocabulary, central Ask Recallant placement,
  responsive layout CSS breakpoints, activity data, capture-state visibility, and human-readable
  labels in addition to the existing review/chat/settings/cleanup/forget gates.
- Verification passed: `npm run build`, `npm run lint`, `npm run format:check`,
  `git diff --check`, and `npm run review-ui:smoke` against the dev Postgres service on
  `127.0.0.1:15433`.
- A real Playwright/screenshot harness is not yet installed in the repo; the current UI regression
  guard is the strengthened HTML/CSS/API smoke contract.

## 2026-06-01 Stage 2 Management Chat Result-Type Checkpoint

- Management Chat API responses now include `result_type` with one of:
  `read_only_answer`, `safe_action`, `dry_run_required`, `confirmation_required`,
  `blocked_by_policy`, or `needs_clarification`.
- Existing `intent`, `confirmation_required`, `destructive_or_sensitive`, facts, and proposed-action
  fields remain in place for compatibility.
- Ask Recallant now shows the result type as a human-readable badge in the response.
- Requests to reveal raw secrets, passwords, tokens, or API keys are `blocked_by_policy`; they do
  not become confirmable actions.
- `scripts/smoke-review-ui.mjs` verifies result types for read-only Russian chat, developer-wide
  rule creation, cleanup dry-run, paid/public/connector/global-setting confirmation gates, sandbox
  cleanup targeting, and secret policy blocking.
- Verification passed: `npm run build`, `npm run lint`, `npm run format:check`,
  `git diff --check`, and `npm run review-ui:smoke` against the dev Postgres service on
  `127.0.0.1:15433`.

## 2026-06-01 Stage 3 Project Sources Checkpoint

- Added the `project_sources` table as the physical source-binding layer for memory spaces.
- `projects.primary_path` remains the compatibility/display fallback.
- `ensureProject` and `registerProject` now create or refresh a primary `workspace_path` source for
  folder-backed projects.
- Added DB methods for creating memory spaces, attaching/listing/detaching project sources, and
  listing memory spaces with sources.
- Added CLI commands:
  - `recallant memory-space create|list`
  - `recallant source attach|list|detach`
- Workbench Memory Spaces now shows attached source information when available, with a safe fallback
  to `primary_path`.
- Added `npm run project-sources:smoke`; it verifies virtual memory spaces with zero sources,
  multiple source bindings, detach-without-delete, automatic primary workspace source creation, and
  dashboard source visibility.
- Verification passed so far: clean `make db-reset`, `npm run schema:smoke`,
  `npm run project-sources:smoke`, `npm run review-ui:smoke`, `npm run phase10:smoke`, and full
  `npm run smoke:core`.

## 2026-06-01 Stage 4 Connect CLI First Slice

- Added `recallant connect <client>` as a separate lifecycle command from `attach`.
- First slice manages project-local MCP config and reports:
  `connection_status=mcp_only`, `hook_status=not_installed`, and `capture_status`.
- `connect --dry-run` shows exact planned file changes and does not write files.
- `connect` is idempotent. Since `attach` still writes `.recallant/codex-mcp.json` for
  compatibility, `connect codex` normally reports `no_change` after attach.
- Non-Codex clients currently use the generic MCP config fallback.
- The command does not write global client config or install hooks yet; that remains the next Stage
  4 implementation slice.
- Added `npm run connect:smoke`; targeted smoke and full `npm run smoke:core` passed.

## Open Questions

- None recorded.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
