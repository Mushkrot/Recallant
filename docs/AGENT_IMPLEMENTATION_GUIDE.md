# Agent implementation guide

This document defines the implementation order for an AI agent building Recallant.

**Current status:** implementation is authorized, the main local v1 implementation slices are present, and the first owner-server production deployment is running. The active next plan is [Pre-Pilot Readiness](PRE_PILOT_READINESS.md), which must be completed before attaching a real working project.

This guide implements the v1 full coding-agent memory core defined in [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md). Do not add future expansion work such as personal-life capture, external productivity connectors, object storage, dedicated vector/graph DBs, public packaging, or multi-user/SaaS features unless the owner explicitly reopens scope.

## 0. Preconditions

- Read the files listed in [README.md](README.md) in the required order.
- Understand [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) and [ADR-0042-managed-ai-native-platform-and-operations.md](ADR-0042-managed-ai-native-platform-and-operations.md) before writing code.
- Follow [RUNTIME_STACK.md](RUNTIME_STACK.md) and [ADR-0010-controlled-hybrid-runtime.md](ADR-0010-controlled-hybrid-runtime.md): **TypeScript-first core** with optional Python workers only behind explicit process/queue/API boundaries.
- Clone or inspect selected upstream repositories locally when practical before adapting architecture or code. Record what is reused, adapted, rejected, or rewritten in [UPSTREAM_INTEGRATION.md](UPSTREAM_INTEGRATION.md).
- All code, comments, docs, API messages, commit messages, and public-facing artifacts must be English.
- Use meaningful scoped commits at natural checkpoints. Do not commit local runtime state, secrets, generated junk, or unrelated changes.
- On the owner's server, consult `/ai/SECURITY` before exposure/auth/firewall/service/secret changes and update `/ai/PORTS.yaml` before starting any port-bound service.

## Phase 0 - Repository skeleton

**Deliverables:**

- [ ] Monorepo or single package root with `README`, `LICENSE`, formatter/linter config.
- [ ] Preferred monorepo layout, unless implementation evidence justifies a simpler equivalent:
  - `apps/cli`
  - `apps/server`
  - `apps/review-ui`
  - `packages/core`
  - `packages/db`
  - `packages/mcp`
  - `packages/contracts`
  - `packages/adapters`
- [ ] Module boundaries keep storage, policy, routing, UI, CLI, MCP, adapters, and workers loosely coupled.
- [ ] Code style prevents large catch-all files; refactor when files outgrow a clear responsibility.
- [ ] Empty CI workflow placeholder for lint and test hooks.

**Gate:** `TEST_CONTRACT.md` Phase 0 checks pass.

## Phase 1 - Database and migrations

**Deliverables:**

- [ ] SQL migrations match [DATA_MODEL.md](DATA_MODEL.md) by table and column names.
- [ ] L3 governed memory tables included: `agent_memories`, `agent_memory_source_refs`, `agent_memory_review_actions`, `recall_traces`.
- [ ] Raw workflow evidence table included: `raw_artifacts` with event linkage, pointer/hash/excerpt metadata, and sync/delete markers from [DATA_MODEL.md](DATA_MODEL.md).
- [ ] Scope/audience fields from [ADR-0040](ADR-0040-memory-scope-and-audience-model.md) are represented for chunks/governed memories/import results: `scope_kind`, `scope_id`, and audience metadata, with `project|developer` kept only as compatibility/default subset.
- [ ] `sessions` includes lifecycle/recovery/heartbeat fields from `DATA_MODEL.md`: `last_seen_at`, `last_heartbeat_at`, `heartbeat_status`, `heartbeat_metadata`, `status`, `ended_reason`, `recovered_from_session_id`.
- [ ] Settings tables included: `system_settings`, `developer_settings`, `project_settings`, `session_overrides`, `client_adapter_settings`, `settings_audit_events`.
- [ ] Erasure workflow storage included: `erasure_requests` or an equivalent redacted-receipt table from [DATA_MODEL.md](DATA_MODEL.md).
- [ ] `docker-compose.yml` or `Makefile` target `db-up` for local Postgres + pgvector.

**Gate:** migrations apply cleanly to an empty database.

## Phase 2 - MCP skeleton

**Deliverables:**

- [ ] Register server name `recallant`.
- [ ] Stub tools with JSON Schema from [MCP_SPEC.md](MCP_SPEC.md); return fixtures.
- [ ] Universal session lifecycle/startup tools included in the stub surface: `memory_start_session`, `memory_get_context_pack`, `memory_closeout`.
- [ ] Hybrid heartbeat stub included: `memory_heartbeat`.
- [ ] Raw workflow evidence stub included: `memory_append_event`.
- [ ] Explicit erasure stub included: `memory_forget`.

**Gate:** an MCP client can connect to the server and call a stub tool.

## Phase 3 - Session lifecycle and L0 write path

**Deliverables:**

- [ ] `memory_start_session` creates/continues session state, returns checkpoint, and surfaces unclosed prior session recovery metadata.
- [ ] `memory_append_turn` writes to `events`, chunks according to [INGESTION.md](INGESTION.md), and deduplicates.
- [ ] `memory_append_event` writes non-turn workflow evidence to `events` and creates `raw_artifacts` rows for large payload refs.
- [ ] Session-scoped tools update `sessions.last_seen_at`.
- [ ] `memory_heartbeat` updates liveness metadata only and does not write L0 events/chunks.
- [ ] Capture policy/profile resolution from [ADR-0017-managed-hybrid-capture.md](ADR-0017-managed-hybrid-capture.md): session override -> project policy -> developer default -> server default.
- [ ] Tool/terminal/raw-output capture obeys configured policy, including caps/summaries and secret handling.

**Gate:** unit tests for chunking and an integration append test pass.

## Phase 4 - Embeddings and L1

**Deliverables:**

- [ ] Embedding provider call is configurable and writes `embeddings`.
- [ ] Cold start/missing provider handling returns explicit `UNAVAILABLE` or configured fallback with a clear message.
- [ ] Initial model router settings from [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md) and [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md): local embeddings default, active-agent route, subscription-worker route placeholder, OpenAI paid API baseline route, optional Gemini/Claude cheap route placeholders, Gemini embedding fallback candidates, and explicit quality/experiment placeholders for expensive models.
- [ ] Provider/worker adapters can be stubbed initially, but route config and `model_calls` audit must already preserve route class/provider/model/purpose/routing reason/limit status/cost or confirmation metadata.
- [ ] Default paid API path creates approval requests and does not call paid providers until approval is recorded.

**Gate:** `memory_search` vector leg works on a golden set of at least three documents.

## Phase 5 - Hybrid retrieval

**Deliverables:**

- [ ] Implement the pipeline from [RETRIEVAL.md](RETRIEVAL.md).
- [ ] Configurable retrieval policy for `N_lex`, `N_vec`, default `top_k`, `max_chars_total`, graph budgets, and related caps.
- [ ] Retrieval and governed-memory recall enforce ADR-0040 scope/audience filtering before ranking.
- [ ] Context Pack and retrieval conflict handling follow [ADR-0041](ADR-0041-conflict-resolution-priority.md).

**Gate:** `TEST_CONTRACT.md` retrieval checks pass.

## Phase 6 - Governed memory, graph, and checkpoint tools

**Deliverables:**

- [ ] `memory_create_agent_memory`, `memory_review_agent_memory`, `memory_recall_agent_memories`, `memory_report_recall_usage`.
- [ ] `memory_list_agent_memories` and `memory_get_agent_memory` for inbox/rules/source inspection.
- [ ] Policy enforcement: valid agent-created memories can be auto-created for recall, while instruction-grade requires direct explicit user instruction, review/import/user-confirmed path.
- [ ] Recall traces are written for governed memory recall.
- [ ] `memory_link` and graph expansion branch.
- [ ] `memory_get_checkpoint` / `memory_set_checkpoint`.
- [ ] `memory_get_context_pack` from [ADR-0024-automatic-startup-context-pack-builder.md](ADR-0024-automatic-startup-context-pack-builder.md): server-side composition of checkpoint, recovery warnings, governed memories/rules, optional bounded evidence, and suggested next fetches.
- [ ] Rule management workflow from [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md): promote/demote/reject/archive/supersede, duplicate/conflict reports, and closeout proposals.
- [ ] Conflict reports explain applicability, authority, scope specificity, and recency per ADR-0041.
- [ ] Erasure workflow from [ADR-0042](ADR-0042-managed-ai-native-platform-and-operations.md) and [MCP_SPEC.md](MCP_SPEC.md): dry-run, confirmation, redacted receipt, and removal/redaction of derived material.

**Gate:** governed memory policy tests pass; graph expansion stays within configured budgets on a synthetic graph.

## Phase 6.5 - Review UI (required)

**Deliverables:**

- [ ] Owner-facing compact Review UI workbench from [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md), [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md), and [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md).
- [ ] UI runs on the Recallant server deployment per [ADR-0020-review-ui-on-recallant-server-management-platform-path.md](ADR-0020-review-ui-on-recallant-server-management-platform-path.md).
- [ ] First screen follows [ADR-0021-review-ui-first-screen.md](ADR-0021-review-ui-first-screen.md): Review Inbox / Command Center, not a metrics dashboard.
- [ ] Management UI includes project list/selector and project-specific Settings entrypoint per [SETTINGS.md](SETTINGS.md).
- [ ] Views: project selector/list, inbox, rules, memory detail/source refs/history, duplicates, conflicts, Cost / Paid API, and project settings shortcut.
- [ ] Natural-language management chat is available for memory questions, context-pack explanation, cleanup requests, and confirmation-gated actions.
- [ ] Cleanup / Forget surface exists for stale clusters, duplicate/conflict hygiene, archive/rebuild actions, and permanent erasure dry-run/confirmation.
- [ ] Controlled Settings UI implements editable project settings, effective source display, confirmation-gated dangerous changes, secret redaction, and settings audit events per [ADR-0034-controlled-settings-ui-in-v1.md](ADR-0034-controlled-settings-ui-in-v1.md).
- [ ] Actions: accept/approve, reject, promote instruction, demote instruction, archive, unarchive, mark stale, edit, merge, supersede.
- [ ] UI actions use the same server-side policy path as MCP/CLI review actions and write `agent_memory_review_actions`.
- [ ] UI is private/local-server oriented and requires Recallant-level auth/session/token even on Tailnet/SSH access; no public SaaS assumption.
- [ ] UI/admin API route/session design is Cloudflare-ready without enabling public/subdomain access by default.
- [ ] Initial implementation must be a compact working UI, not an approval-only table, while API/routing structure must not block management-platform expansion.
- [ ] Chat-driven destructive/cost/security/global-scope/connector actions require explicit confirmation and use the same server-side policy path as UI/CLI/MCP.

**Gate:** Review UI tests in `TEST_CONTRACT.md` pass.

## Phase 7 - Project onboarding CLI (required)

**Deliverables:**

- [ ] `recallant init --target codex` in a project directory:
  1. creates a `projects` record, generates `project_id`, and binds it to `developer_id`;
  2. assigns default `capture_profile=standard` unless overridden by `--capture-profile`;
  3. writes `.recallant/config` into the project root with `project_id` and `recallant_server_url`;
  4. creates or updates a thin `AGENTS.md` section named `Memory (Recallant)`;
  5. creates `PROJECT_LOG.md` if missing;
  6. prints the MCP configuration block for the target client;
  7. may show import candidates, but does not create import events or run imports without explicit `recallant import ...`.
- [ ] `recallant discover` follows [ADR-0038](ADR-0038-environment-discovery-and-portable-instance.md) and [ADR-0039](ADR-0039-v1-import-workflow.md): scan candidates without silently importing or promoting them.
- [ ] `recallant import --dry-run` previews source refs, hashes, result classes, provisional scope/audience, high-risk assignments, and conflicts before durable writes.
- [ ] `--dry-run` shows the plan without changes.
- [ ] `--capture-profile light|standard|detailed|custom` overrides the automatic init default.
- [ ] Target-aware generation for at least `codex` and `generic`; other targets may be added incrementally.
- [ ] `recallant lint-context` verifies bootstrap files did not become duplicated context dumps and applies the configurable context policy from [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md), including project overrides.
- [ ] `recallant context` or equivalent preview command calls the same Context Pack Builder used by `memory_get_context_pack`.
- [ ] `recallant doctor` checks connectivity for Postgres, configured local model provider/Ollama, and `.recallant/config`.
- [ ] `recallant doctor` reports whether Ollama/local-model capability is reachable, which endpoint is configured, which expected models are missing, and which fallback route applies.
- [ ] Owner-server deployment profile validates that planned Recallant service ports are present in `/ai/PORTS.yaml` before daemon/service start.
- [ ] Owner-server deployment profile surfaces `/ai/SECURITY` as the security baseline to consult for public exposure, Cloudflare, firewall, service, or secret changes.
- [ ] `recallant doctor` or equivalent diagnostics show effective model routes and whether local, active-agent, subscription-worker, and paid API routes are enabled/disabled.
- [ ] Cost / Paid API management view shows model-call audit, estimated cost, pending approvals, and confirms default `paid_api_mode=confirm_each`.
- [ ] Closeout intent handling follows [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md): known trigger phrases plus model-routed classification for ambiguous cases.
- [ ] Normal closeout calls `memory_closeout`; abnormal interruption recovery starts at the next `memory_start_session`.

**Gate:** `TEST_CONTRACT.md` Phase 7 checks pass.

## Phase 8 - Hardening

**Deliverables:**

- [ ] Rate limits, size limits, structured errors.
- [ ] Security/access hardening from [ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md](ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md): private bind defaults, Recallant auth, secret handling, token/session checks, and Cloudflare-ready config.
- [ ] Natural-language management actions are policy-gated; destructive/cost/security/global-rule/connector-account/public-exposure operations require explicit confirmation.
- [ ] Backup commands/jobs from [BACKUP_RESTORE.md](BACKUP_RESTORE.md): Postgres backup, raw artifact backup, manifest creation, and encrypted local target support.
- [ ] Restore verification command/job: restore into temporary DB/location and run basic read checks without touching production.
- [ ] Backup target abstraction allows future SSH/Tailscale replication to a second backup server, even if the initial implementation writes only to local Recallant-server storage.
- [ ] Export/restore design preserves portability metadata and supports remapping/rebinding of project paths, secret references, connector/account bindings, and environment facts per ADR-0038.
- [ ] Startup documentation for at least three clients with official external links and Recallant env/config guidance.

**Gate:** full `TEST_CONTRACT.md` green.

## Phase 9 - Cleanup and analysis

**Deliverables:**

- [ ] Score decay in retrieval: formula from `CLEANUP.md`, parameters through env/settings.
- [ ] Access tracking: asynchronous update of `last_accessed_at` / `access_count` after every retrieval.
- [ ] `supersedes` penalty in the rerank pipeline.
- [ ] MCP tool `memory_archive` for archive/unarchive.
- [ ] MCP tool `memory_forget` with dry-run, owner confirmation, redacted receipt, and derived-material erasure.
- [ ] `recallant analyze` with an interactive report and LLM summary, with Ollama/local provider fallback to keyword extraction.
- [ ] `recallant cleanup` with `--archive`, `--delete-archived`, `--dry-run`, `--no-confirm`.
- [ ] Self-cleaning identifies duplicates, stale decisions, superseded guidance, abandoned experiments, low-value context, poor provenance, and conflicting connector/account bindings.
- [ ] Batch cleanup does not perform permanent erasure silently.

**Gate:** `TEST_CONTRACT.md` Phase 9 checks pass.

## Pre-Pilot Readiness - Launch preparation before first real project

The current active work order is defined in [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md).

This is not a broad new product phase and does not reopen future-scope items. It is the readiness layer needed before the first real project pilot:

- safe existing-project discovery/preflight,
- explicit import write mode with reviewable candidates,
- Review UI import/detail/action readiness,
- sandbox pilot workflow on a duplicated project copy,
- agent onboarding contract,
- production health and backup verification.

Do not connect a real working project until the Pre-Pilot Readiness exit gate passes.

## Parallelization rules

- Phases **1 -> 2** can be weakly parallelized only after the `projects` table is agreed.
- **3 -> 4** is sequential because embeddings depend on chunks.
- **5** depends on **4**.
- **6** depends on **5** for `memory_search` graph use of scores.

## Stop conditions

If a requirement conflicts with `NON_GOALS.md`, stop and create a new `ADR-*.md`.
