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

The active next checkpoint is [Pre-Pilot Readiness](PRE_PILOT_READINESS.md). The goal is to make
Recallant ready for a first pilot on a duplicated project copy before connecting any real working
project.

Current work order:

1. Existing-project discovery and preflight. Complete for the first pre-pilot checkpoint.
2. Durable explicit import write mode. Complete for the first pre-pilot checkpoint.
3. Review UI import candidate/action readiness. Complete for the first pre-pilot checkpoint.
4. Pilot sandbox workflow. Complete for the first pre-pilot checkpoint.
5. Agent onboarding contract. Complete for the first pre-pilot checkpoint.
6. Operational readiness check. Next.

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

Latest Pre-Pilot R1 validation:

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run prepilot:smoke:discovery`
- Docker network execution of `npm run prepilot:smoke:import`
- Docker network execution of `npm run phase7:smoke`
- Docker network execution of `npm run review-ui:smoke`
- Docker network execution of `npm run prepilot:smoke:sandbox`

The existing `scripts/smoke-phase7-cli.mjs` still assumes the Docker `/work` mount profile for its child CLI process; running it directly on the host without that mount fails before exercising Recallant code.

## Current Boundary

The accepted production deployment profile has been implemented. Continue with Pre-Pilot Readiness.

Continue autonomously unless the next step requires a new owner decision, secrets that cannot be
generated safely on the server, public exposure beyond `recallant.unicloud.ca` behind Cloudflare
Access, paid API enablement, destructive erasure, firewall rule changes that risk lockout, a real
specification contradiction, or attaching a real working project before the Pre-Pilot Readiness exit
gate.
