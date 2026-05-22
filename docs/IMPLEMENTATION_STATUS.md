# Implementation Status

Last updated: 2026-05-22.

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

Autonomous safe implementation is complete up to the current documented local/server-private core checkpoint.

Next meaningful work likely needs owner participation because it crosses one or more protected boundaries:

- owner-server deployment profile and service setup,
- `/ai/PORTS.yaml` registration,
- `/ai/SECURITY` review before exposure/auth/firewall/Cloudflare changes,
- public/subdomain routing decisions,
- secrets or production environment values,
- paid API/provider enablement,
- destructive erasure beyond tested confirmation paths,
- deeper natural-language management/model-router behavior that changes product policy.

Until those are confirmed, continue only with local, reversible implementation and tests.
