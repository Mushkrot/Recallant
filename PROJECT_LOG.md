# Project Log

## Current Session

Status: Installer dry-run/profile smoke and full local smoke isolation are implemented and verified.
Current focus: continue closing the full v1 contract requirement by requirement.
Next step: audit remaining CLI init/discover/import contract gaps against TEST_CONTRACT.
Last updated: 2026-05-31T08:05:26Z.

## Active Constraints

- Recallant is the main source of truth for durable project memory.
- This file is a compact fallback/checkpoint, not the full project history.
- Do not store secrets in repo docs or Recallant memories.
- Production-sensitive, destructive, paid API, public exposure, firewall, and secret-handling
  changes still require owner participation.
- On the owner server, consult `/ai/SECURITY` and `/ai/PORTS.yaml` before exposure/service/security
  changes.

## Recent Decisions

- The operator path must be human-friendly: install with `scripts/install-recallant.sh`, then attach
  a normal project with `recallant attach .`.
- Management Chat must use a local AI model for natural-language interpretation when available,
  while deterministic policy remains authoritative for risky actions.
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

## Verification

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run review-ui:smoke`
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

## Open Questions

- None that block the next documented implementation step.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
