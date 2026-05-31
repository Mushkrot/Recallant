# Project Log

## Current Session

Status: Review UI/API capture readiness telemetry added and smoke-tested.
Current focus: run final product acceptance and self-dogfood verification, then deploy.
Next step: exercise `/ai/recallant` itself through the new capture runtime and confirm the captured
decision returns in a later context pack.

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

## Open Questions

- None that block implementation of the product acceptance loop.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
