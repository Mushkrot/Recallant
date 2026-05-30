# Implementation Status

Last updated: 2026-05-28.

This file records the current implementation checkpoint for Recallant so future sessions can resume from repository evidence rather than chat history.

## Current State

Recallant now has a working local v1 implementation slice for coding-agent memory:

- TypeScript monorepo skeleton, linting, formatting, build, Docker Postgres, and initial CI hooks.
- Postgres/pgvector schema for developers, projects, sessions, raw events, raw artifacts, chunks, embeddings, graph edges, checkpoints, governed memories, review actions, recall traces, erasure receipts, settings, model calls, and paid API approvals.
- MCP server tool surface with DB-backed lifecycle, capture, search, governed memory, graph, checkpoint, context pack, archive, forget, closeout, and review workflows.
- Session lifecycle with start, heartbeat, stale/unclosed recovery metadata, capture profile resolution, append-turn/event paths, deduplication, text limits, and raw artifact pointer storage.
- Local-first embedding route policy with deterministic test embedding support, model-call audit rows, cloud fallback settings, and paid API approval blocking.
- Hybrid retrieval with lexical/vector paths, bounded responses, scope/audience filtering, graph expansion, access tracking, decay, and superseded penalties.
- Governed memory workflow with provenance requirements, candidate/needs-review policy, instruction-grade promotion through review, recall traces, usage reporting, archive/supersede/stale/reject/edit/merge paths, and cleanup candidate reporting.
- Private Review Command Center with auth, project list, critical status, inbox, active rules, settings, paid API/cost view, review actions, and confirmation-gated dangerous setting changes.
- CLI onboarding and diagnostics: `init`, `discover`, `import --dry-run`, `lint-context`, `context`, `doctor`, backup/verify, restore-plan, analyze/cleanup, local spool append/sync/prune.
- Pre-Pilot discovery/preflight for existing projects: read-only candidate scanning for manual memory surfaces, selected runbooks/docs, secret-reference examples, source hashes, scope/audience previews, context-budget warnings, duplicate/conflict/stale-history risks, redacted secret handling, JSON and text output, and import dry-run parity.
- Pre-Pilot explicit import write mode: confirmed `recallant import <path>` writes source-linked `import_batch` events, raw artifact pointers, chunks, embeddings where available, and governed memory candidates/needs-review records with idempotent source-path/hash/result-class deduplication and redacted secret-reference handling.
- Pre-Pilot Review UI import readiness: dashboard/API include import candidates, selected detail with source refs/review history/provenance/status/use policy/scope/audience/confidence, conflict/duplicate candidates, available review actions, and cleanup/forget confirmation entrypoint.
- Pre-Pilot sandbox pilot workflow: documented copied-project operator flow and smoke automation that copies a fixture into a sandbox, discovers/imports selected sources, exercises MCP startup/context/append/search/recall/closeout, verifies DB records, and leaves the original project untouched.
- Pre-Pilot agent onboarding contract: documented exact startup/capture/checkpoint/closeout/file-ownership rules and corrected generated `AGENTS.md` Memory section to use real MCP tools instead of the old nonexistent `memory_promote` wording.
- First copied-project pilot: GutenDocx was cloned into a Recallant sandbox, initialized, discovered,
  imported, exercised through MCP startup/context/append/search/recall/closeout, checked through
  Review Dashboard data, and verified against post-test production health checks without modifying
  the original `/ai/gutendocx` project.
- Local Ollama model readiness: `nomic-embed-text` is installed and wired into the Recallant DB
  embedding path, `recallant doctor` accepts `model`/`model:latest` tag aliases, and production
  sandbox vector search is verified through `memory_append_turn` plus `memory_search mode=vector_only`.
- Review UI human-readability pass: project rows and memory rows are clickable, imported candidates
  are summarized in owner-readable language with status/use/type badges, recommended actions, and
  technical details hidden behind expandable sections.
- Product direction update: autonomous project attach is the target everyday workflow, with
  `autopilot` as the ordinary-project default and `manual`/`guided` preserved for cautious
  operation. Attach must intelligently migrate existing agent files, locally back them up before
  changing them, keep `PROJECT_LOG.md` as compact fallback/checkpoint, and downgrade
  production-sensitive projects to guided unless production-safe autopilot is explicitly approved.
  Controlled cross-project recall is accepted so agents can use source-linked examples from other
  projects without automatic memory mixing.
- Phase 10 attach first slice: `recallant attach <project-dir>` now defaults to `autopilot` for
  ordinary projects and supports `manual`, `guided`, and `autopilot` modes. Planning modes are
  read-only; production-sensitive autopilot downgrades to guided unless approved; autopilot writes
  pointer config, MCP hints, `.gitignore`, `AGENTS.md`, compact `PROJECT_LOG.md`, local redacted
  backups for agent files, safe imports, starter memory, structured low-risk source memories,
  startup/context-pack smoke, Review UI/API visibility check, diagnostics, and a short owner report.
- Phase 10 detach first slice: `recallant detach` and `recallant project-detach` provide governed
  project cleanup with dry-run affected counts, confirmation-required writes, live hide-only detach,
  sandbox hide plus active-chunk archiving, Review UI project-list hiding, active-search blocking
  for detached projects, and hard-delete policy blocking that points sensitive/wrong memory to the
  separate forget workflow.
- Phase 10 controlled cross-project recall first slice: MCP exposes
  `memory_cross_project_recall` with explicit modes for same-project, developer rules, environment,
  similar projects, and all-project review. Similar-project results are source-linked examples with
  source project/path/ref, status/use policy, applicability warning, and promotion policy. Default
  context packs still exclude unrelated project memory, and environment/capability output redacts
  secret-like values.
- Review/Management UI chat first slice: the private Command Center now has a functional
  management chat API and form instead of a placeholder. It answers read-only operational questions
  in the owner's language, summarizes project status in plain language, explains review/settings/
  cost/context-pack/cross-project recall topics, and converts cleanup/destructive/sensitive requests
  into dry-run plus confirmation-required action proposals without executing them directly.
- Review/Management UI readability pass: the first screen includes a plain-language "What Needs
  Attention" summary, project action guidance, cross-project isolation reminder, and human-readable
  setting summaries with technical JSON hidden behind expandable details.
- Review/Management UI layout pass: the management chat moved into the left rail so unused space
  becomes useful, chat answers are capped in their own scroll area instead of pushing the whole
  page down, cost records are summarized with technical rows collapsed, and Russian risky-action
  chat responses no longer show English confirmation/action labels.
- Management chat target-safety pass: sandbox cleanup wording is now treated as a target-selection
  signal. If the open project is not the sandbox and exactly one sandbox/pilot project is visible,
  chat builds the dry-run command for that sandbox project instead of blindly using the open
  project. If the sandbox target is missing or ambiguous, chat refuses to build a risky command and
  asks the owner to clarify the target.
- Repo contract sync for `PROJECT_LOG.md` after checkpoint writes when the target repo log already exists.
- Offline spool workflow with append-only JSONL records, stable dedup keys, raw artifact pointers, dry-run sync, idempotent DB sync, manifest mapping, context-pack/closeout status visibility, and prune only after confirmed sync.
- Cross-client MCP smoke showing one client kind can write a fact and another client kind can retrieve it through the same project memory.
- Aggregated `npm run smoke:core` suite for the local DB-backed implementation surface.

## Accepted Production Deployment Plan

The owner has authorized autonomous production deployment work after the local implementation
checkpoint. The accepted first owner-server deployment is:

- Human UI hostname: `recallant.unicloud.ca`.
- Cloudflare path: Cloudflare Access for `highmac@gmail.com` -> Tunnel `mainserver` ->
  `http://127.0.0.1:3005`.
- Recallant human auth: validate Cloudflare Access identity/JWT for an allowlisted
  `RECALLANT_ADMIN_EMAILS` identity, then issue a secure Recallant session cookie. Do not add a
  second email magic-link flow or second UI password for the first deployment.
- API/automation auth: keep `Authorization: Bearer <RECALLANT_AUTH_TOKEN>`.
- Agent access: use the existing local stdio MCP path (`recallant mcp-server`). Do not expose remote
  MCP through Cloudflare in the first deployment.
- App runtime: host `systemd` service from `/ai/recallant`.
- Database runtime: separate Docker Compose Postgres/pgvector service, not a shared app database.
- Production database compose file: `docker-compose.production.yml`.
- Database bind: `127.0.0.1:15432` on the host to `5432` inside the container.
- Database name: `recallant_agent_work`.
- Persistent runtime data: `/ai/recallant-data`.
- Secret/env file: `/opt/secure-configs/recallant.env`, single file for the app and database stack.
  Production database commands source it through `scripts/recallant-prod-compose.sh` and pass only
  Postgres variables into the database container.
- Backups: local backups under `/ai/recallant-data/backups`; second-server replication remains
  future-only because no second server is available.
- Local models: use the single existing server Ollama service, not a duplicate stack.
- Paid APIs: disabled for the first production deployment.

The Ollama prerequisite has already been completed on the owner server: the existing service was
upgraded to `0.24.0`, changed from the old unsafe `0.0.0.0` bind to `127.0.0.1:11434`, enabled, and
verified with existing models `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, and `mistral-small:24b`.
Server operations docs in `/ai/SECURITY` and `/ai/PORTS.yaml` were updated.

The production Postgres/pgvector prerequisite has also been completed on the owner server:
`recallant-postgres` is healthy, bound to `127.0.0.1:15432`, backed by
`/ai/recallant-data/postgres`, migrated with `0001_initial.sql`, and verified with `pgcrypto` and
`vector` installed. Local backup storage exists at `/ai/recallant-data/backups`.

Operational recovery note from 2026-05-28: a live Cloudflare `502` was traced to
`recallant-postgres` being absent, leaving `127.0.0.1:15432` unavailable. The first DB-backed Review
UI request crashed the HTTP process with `ECONNREFUSED`; systemd restarted the HTTP service, but the
database stayed down until `make prod-db-up` restored the production container. To prevent recurrence,
development database Make targets now use an explicit `recallant-dev` Docker Compose project name;
production database lifecycle stays behind `scripts/recallant-prod-compose.sh`.

The HTTP auth implementation now supports both accepted auth paths: bearer token auth for
agents/API and Cloudflare Access identity plus signed Recallant session cookie for the browser UI.
The production secret file includes `RECALLANT_ADMIN_EMAILS=highmac@gmail.com`.

The Recallant HTTP service is installed as `recallant.service`, enabled, active, and bound to
`127.0.0.1:3005`. Local verification confirmed `/health`, `401` for unauthenticated `/review`,
`200` for bearer-authenticated API access, and `200` for Cloudflare identity -> Recallant session
cookie -> API access.

Cloudflare routing is now configured for the owner-server deployment: `recallant.unicloud.ca` has a
proxied CNAME to Tunnel `mainserver`, a Cloudflare Access self-hosted app named `Recallant`, an
allow policy for `highmac@gmail.com`, and `/etc/cloudflared/config.yml` ingress to
`http://localhost:3005`. Public unauthenticated access was verified to redirect to Cloudflare
Access login while the localhost origin remains healthy.

Local production backups are automated with `recallant-backup.timer`. The timer runs
`recallant-backup.service` daily at `03:15 UTC`, creates a local backup under
`/ai/recallant-data/backups`, immediately runs `backup-verify`, and updates
`/ai/recallant-data/backups/latest-manifest.json`. The first manual service run completed
successfully on 2026-05-27.

Production `recallant doctor` was verified with Postgres reachable, Ollama reachable, no missing
expected local models, and paid APIs still disabled. Local stdio MCP smoke also passed on the
production env.

The first production UI cleanup is complete. The production env now includes stable
`RECALLANT_PROJECT_ID` and `RECALLANT_PROJECT_PATH=/ai/recallant`, preventing one-off dashboard,
doctor, or smoke processes from creating duplicate project rows. After a fresh backup+verify, 13
empty duplicate `/ai/recallant` project rows were removed with safety checks that skipped any row
with sessions, events, chunks, memories, settings, model calls, approvals, or adapter settings.
The Review UI project list now collapses projects by path, shows counts compactly, and renders
structured settings as formatted JSON instead of `[object Object]`.

## Active Next Plan

The active next checkpoint is Phase 10: autonomous attach and controlled cross-project recall. The
detailed pilot record remains
[PILOT_REPORT_GUTENDOCX_2026-05-28.md](PILOT_REPORT_GUTENDOCX_2026-05-28.md).

Current work order:

1. Existing-project discovery and preflight. Complete for the first pre-pilot checkpoint.
2. Durable explicit import write mode. Complete for the first pre-pilot checkpoint.
3. Review UI import candidate/action readiness. Complete for the first pre-pilot checkpoint.
4. Pilot sandbox workflow. Complete for the first pre-pilot checkpoint.
5. Agent onboarding contract. Complete for the first pre-pilot checkpoint.
6. Operational readiness check. Complete for the first pre-pilot checkpoint.
7. GutenDocx copied-project pilot. Complete for the first real-project sandbox checkpoint.
8. Phase 10 attach first slice. Complete for copied-project fixtures and covered by
   `scripts/smoke-phase10-attach.mjs`.
9. Phase 10 detach first slice. Complete for copied-project fixtures and covered by
   `scripts/smoke-phase10-detach.mjs`.
10. Phase 10 controlled cross-project recall first slice. Complete for copied-project fixtures and
    covered by `scripts/smoke-phase10-cross-project.mjs`.

Next recommended work:

1. Continue deepening Review/Management UI action flows, especially richer settings edits, review
   proposals, and context-pack previews from the same private management surface.
2. Add optional local sandbox-file cleanup after confirmed detach, still gated by dry-run and
   confirmation.

The next implementation session should start from [SESSION_HANDOFF_CURRENT.md](SESSION_HANDOFF_CURRENT.md).

## Recent Commit Checkpoints

- `fd23a0b Clean up production review dashboard`
- `f676468 Add production backup runner`
- `77509b8 Document Cloudflare deployment`
- `330d994 Add Cloudflare session auth for server`
- `cf2ca5f Add production Postgres compose`
- `d397f11 Document production deployment plan`
- `eae8851 Document implementation status`
- `77ca937 Add local spool sync CLI`
- `6ed6515 Expose local spool status in context`
- `eca8dee Automate cross-client MCP smoke`
- `1fab1bd Add core smoke suite command`
- `7b93976 Persist closeout memory candidates`
- `143bbdd Expand doctor route diagnostics`

Earlier implementation commits cover Phase 0 through Phase 9 slices and are summarized in `docs/WORKING_CONTEXT.md`.

## Validation

Latest full local validation was run on a clean Docker Postgres database:

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `make db-reset`
- Docker network execution of `npm run smoke:core`
- `make db-down`

The core smoke suite includes MCP handshake, lifecycle, embeddings, retrieval, governed memory, graph/context/forget, Review UI, CLI onboarding, backup/restore planning, size limits, structured errors/rate limits, search p95, archive/decay/cleanup, repo contract sync, local spool, and cross-client smoke.

Latest Review/Management UI chat validation:

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run review-ui:smoke`
- Docker network execution of `npm run smoke:core`

The Review UI smoke now covers the authenticated management chat JSON API, browser form path,
Russian-language answer fixture, destructive cleanup confirmation gating, and human-readable first
screen additions. It also covers the left-rail chat anchor, Russian destructive-action form labels,
and sandbox-target dry-run selection so sandbox cleanup requests do not accidentally target the
open Recallant project.

Latest Pre-Pilot R1 validation:

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run prepilot:smoke:discovery`
- Docker network execution of `npm run prepilot:smoke:import`
- Docker network execution of `npm run phase7:smoke`
- Docker network execution of `npm run review-ui:smoke`
- Docker network execution of `npm run prepilot:smoke:sandbox`

Latest Pre-Pilot R6 incident recovery validation:

- `make prod-db-up`
- `make prod-db-status`
- `ss -ltnp` confirmed `127.0.0.1:3005`, `127.0.0.1:15432`, and `127.0.0.1:11434`
- Local `/health` returned `200`
- Local unauthenticated `/review` returned `401`
- Public unauthenticated `https://recallant.unicloud.ca/` returned Cloudflare Access `302`
- `recallant-backup.timer` remained active
- `pg_isready` reported `recallant_agent_work` accepting connections
- SQL checks returned one `/ai/recallant` project row, zero pending paid API approvals, and zero
  paid-provider model calls in the last 30 days
- `/ai/recallant-data/backups/latest-manifest.json` points to the 2026-05-28 13:45 UTC manifest
- `make db-up && make db-down && make prod-db-status` verified dev compose cleanup no longer
  removes the production `recallant-postgres` container
- Owner browser verification confirmed the authenticated Cloudflare Access path loads the Recallant
  Review Command Center for project `84eda3bf`
- Production `recallant doctor` passed with Postgres reachable, project config present, Ollama
  reachable, no missing expected local models, paid API mode `confirm_each`, and hidden API routes
  disabled
- Production local stdio MCP smoke passed
- `backup-verify --manifest /ai/recallant-data/backups/latest-manifest.json` is now supported for
  symlinked latest-manifest pointers and passed restore verification without production overwrite
- Docker network execution of `npm run phase8:smoke:backup` passed against the isolated
  `recallant-dev` database and verifies symlinked latest-manifest backup/restore-plan handling

Latest first copied-project pilot validation:

- `git clone --no-hardlinks /ai/gutendocx /ai/recallant-pilots/gutendocx-20260528T161238Z`
- `recallant init --target codex --capture-profile detailed --project-dir <sandbox>`
- `recallant discover --dry-run --project-dir <sandbox>`
- `recallant lint-context --project-dir <sandbox>`
- `recallant import --dry-run` and confirmed `recallant import` for five selected GutenDocx
  sources.
- Local stdio MCP sandbox flow: `memory_start_session`, `memory_get_context_pack`,
  `memory_append_event`, `memory_append_turn`, `memory_search`, `memory_recall_agent_memories`, and
  `memory_closeout`.
- Review Dashboard data path with sandbox env returned five import candidates, five inbox items,
  zero interrupted sessions, and zero pending paid approvals.
- Read-only delete dry-run counts were recorded for the sandbox project id.
- Post-test production health checks confirmed GutenDocx and Recallant remained healthy.
- Original `/ai/gutendocx` status remained limited to the pre-existing `config.yaml` diff.

Latest local model readiness validation:

- `ollama pull nomic-embed-text`
- `ollama pull qwen2.5-coder:7b`
- `ollama pull qwen2.5-coder:14b`
- `ollama pull mistral-small:24b`
- Direct Ollama `/api/embeddings` returned 768 dimensions for `nomic-embed-text`
- Production sandbox MCP flow returned `status=embedded` for `ollama/nomic-embed-text`
- Production sandbox `memory_search mode=vector_only` returned the appended test chunk through
  `path=vector`
- Existing GutenDocx sandbox chunks were re-embedded, and vector-only search returned imported
  GutenDocx document chunks through `path=vector`
- Generation smoke passed for `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, and `mistral-small:24b`
  with `keep_alive=0s`
- `recallant doctor` reports no missing expected Ollama models

Latest Phase 10 attach/detach/cross-project validation:

- Docker network execution of `npm run phase10:smoke` passed against the isolated
  `recallant-dev` database.
- Attach smoke verifies manual dry-run, guided confirmation gating, default autopilot sandbox
  attach, redacted local backups, idempotent re-attach, safe import policy, startup/context-pack
  smoke, Review visibility, and production-sensitive downgrade.
- Detach smoke verifies dry-run affected counts with no writes, hard-delete policy blocking,
  confirmed sandbox detach hiding the project and archiving active chunks, local config left intact,
  live detach hiding without archiving chunks or touching files, active search blocked for detached
  projects, dashboard project-list hiding, and unrelated active project search unaffected.
- Cross-project recall smoke verifies default context-pack isolation, explicit similar-project
  recall with source project/path/ref/status/use policy/applicability warning, developer-rule mode,
  environment/capability secret redaction, no current-project memory creation until application,
  and current-project memory creation with source refs after applying a prior pattern.
- Full Docker network execution of `npm run smoke:core` passed on the same isolated dev profile
  after adding `memory_cross_project_recall` to the MCP tool list.

Smoke scripts that previously assumed a Docker `/work` mount now use the current repository root, so
the full local host `smoke:core` suite can run against the isolated `recallant-dev` database.

Latest product-UX readiness checkpoint:

- `scripts/install-recallant.sh` provides the intended server install entrypoint:
  clone, run one installer, get Postgres, the HTTP service, and the global `recallant` CLI.
- `scripts/install-recallant-cli.sh` installs the CLI wrapper for an already configured server.
- The CLI now auto-loads `/opt/secure-configs/recallant.env` when present, so project attach no
  longer requires manually sourcing env or invoking `node apps/cli/dist/index.js`.
- The operator attach path is now `cd <project> && recallant attach .`; `--sandbox`, `--mode
  guided`, and `--mode manual` remain available for cautious/test workflows.
- Management Chat now attempts local Ollama AI interpretation for natural-language intent, target
  hints, and global-rule extraction, then applies deterministic policy gates for risky actions.
- Explicit owner requests to save a low-risk rule for all projects create a developer-scope
  `instruction_grade` memory so future context packs include it as binding guidance.

## Current Boundary

The accepted production deployment profile, Pre-Pilot copied-project readiness, and first Phase 10
attach/detach/cross-project recall slices have been implemented. Continue with management UI/chat
quality and optional sandbox local-cleanup hardening.

Continue autonomously unless the next step requires a new owner decision, secrets that cannot be
generated safely on the server, public exposure beyond `recallant.unicloud.ca` behind Cloudflare
Access, paid API enablement, destructive erasure, firewall rule changes that risk lockout, a real
specification contradiction, or attaching a live production-sensitive project outside the documented
Phase 10 safety gates.
