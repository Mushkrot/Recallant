# Implementation Status

Last updated: 2026-05-27.

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
- Recallant human auth: validate Cloudflare Access identity/JWT, then issue a secure Recallant
  session cookie. Do not add a second email magic-link flow or second UI password for the first
  deployment.
- API/automation auth: keep `Authorization: Bearer <RECALLANT_AUTH_TOKEN>`.
- Agent access: use the existing local stdio MCP path (`recallant mcp-server`). Do not expose remote
  MCP through Cloudflare in the first deployment.
- App runtime: host `systemd` service from `/ai/recallant`.
- Database runtime: separate Docker Compose Postgres/pgvector service, not a shared app database.
- Database bind: `127.0.0.1:15432` on the host to `5432` inside the container.
- Database name: `recallant_agent_work`.
- Persistent runtime data: `/ai/recallant-data`.
- Secret/env file: `/opt/secure-configs/recallant.env`, single file for the app and database stack.
- Backups: local backups under `/ai/recallant-data/backups`; second-server replication remains
  future-only because no second server is available.
- Local models: use the single existing server Ollama service, not a duplicate stack.
- Paid APIs: disabled for the first production deployment.

The Ollama prerequisite has already been completed on the owner server: the existing service was
upgraded to `0.24.0`, changed from the old unsafe `0.0.0.0` bind to `127.0.0.1:11434`, enabled, and
verified with existing models `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, and `mistral-small:24b`.
Server operations docs in `/ai/SECURITY` and `/ai/PORTS.yaml` were updated.

## Recent Commit Checkpoints

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

## Current Boundary

The owner has answered the deployment-profile questions above and authorized autonomous
implementation of ordinary deployment steps with scoped commits and verification after each
checkpoint.

Continue autonomously unless the next step requires a new owner decision, secrets that cannot be
generated safely on the server, public exposure beyond `recallant.unicloud.ca` behind Cloudflare
Access, paid API enablement, destructive erasure, firewall rule changes that risk lockout, or a real
specification contradiction.
