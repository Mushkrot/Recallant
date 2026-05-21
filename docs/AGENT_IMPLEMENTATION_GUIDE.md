# Agent implementation guide

Этот документ задаёт **порядок работ** для AI-агента, который создаёт репозиторий реализации AMP.

**Current status:** do not execute this guide yet. Implementation is paused until architecture documentation is complete and the owner explicitly authorizes coding. See [ADR-0009-documentation-first-before-implementation.md](ADR-0009-documentation-first-before-implementation.md).

This guide implements the v1 full coding-agent memory core defined in [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md). Do not add future expansion work such as personal-life capture, external productivity connectors, object storage, dedicated vector/graph DBs, public packaging, or multi-user/SaaS features unless the owner explicitly reopens scope.

## 0. Preconditions

- Прочитаны все файлы из [README.md](README.md) в указанном порядке.
- Runtime decision follows [RUNTIME_STACK.md](RUNTIME_STACK.md) and [ADR-0010-controlled-hybrid-runtime.md](ADR-0010-controlled-hybrid-runtime.md): **TypeScript-first core** with optional Python workers only behind explicit process/queue/API boundaries.

## Phase 0 — Repository skeleton

**Deliverables:**

- [ ] Monorepo или single package root с `README`, `LICENSE`, formatter/linter config.
- [ ] Пустой CI workflow placeholder (lint + test hooks).

**Gate:** `TEST_CONTRACT.md` Phase 0 checks pass.

## Phase 1 — Database + migrations

**Deliverables:**

- [ ] SQL migrations соответствуют [DATA_MODEL.md](DATA_MODEL.md) byte-for-byte по именам таблиц/колонок.
- [ ] L3 governed memory tables included: `agent_memories`, `agent_memory_source_refs`, `agent_memory_review_actions`, `recall_traces`.
- [ ] Raw workflow evidence table included: `raw_artifacts` with event linkage, pointer/hash/excerpt metadata, and sync/delete markers from [DATA_MODEL.md](DATA_MODEL.md).
- [ ] Scope/audience fields from [ADR-0040](ADR-0040-memory-scope-and-audience-model.md) are represented for chunks/governed memories/import results: `scope_kind`, `scope_id`, and audience metadata, with `project|developer` kept only as compatibility/default subset.
- [ ] `sessions` includes lifecycle/recovery/heartbeat fields from `DATA_MODEL.md`: `last_seen_at`, `last_heartbeat_at`, `heartbeat_status`, `heartbeat_metadata`, `status`, `ended_reason`, `recovered_from_session_id`.
- [ ] Settings tables included: `system_settings`, `developer_settings`, `project_settings`, `session_overrides`, `client_adapter_settings`, `settings_audit_events`.
- [ ] `docker-compose.yml` или `Makefile` target `db-up` для локального Postgres + pgvector.

**Gate:** миграции применяются на чистую БД без ошибок.

## Phase 2 — MCP skeleton

**Deliverables:**

- [ ] Регистрация server name `agent-memory-platform`.
- [ ] Stub tools с JSON Schema из [MCP_SPEC.md](MCP_SPEC.md) (возвращают фикстуры).
- [ ] Universal session lifecycle/startup tools included in the stub surface: `memory_start_session`, `memory_get_context_pack`, `memory_closeout`.
- [ ] Hybrid heartbeat stub included: `memory_heartbeat`.
- [ ] Raw workflow evidence stub included: `memory_append_event`.

**Gate:** клиент Cursor может подключить server и вызвать stub tool (manual checklist в `TEST_CONTRACT.md`).

## Phase 3 — Session lifecycle + L0 write path

**Deliverables:**

- [ ] `memory_start_session` creates/continues session state, returns checkpoint, and surfaces unclosed prior session recovery metadata.
- [ ] `memory_append_turn` пишет в `events`, chunking по [INGESTION.md](INGESTION.md), dedup.
- [ ] `memory_append_event` writes non-turn workflow evidence to `events` and creates `raw_artifacts` rows for large payload refs.
- [ ] Session-scoped tools update `sessions.last_seen_at`.
- [ ] `memory_heartbeat` updates liveness metadata only and does not write L0 events/chunks.
- [ ] Capture policy/profile resolution from [ADR-0017-managed-hybrid-capture.md](ADR-0017-managed-hybrid-capture.md): session override → project policy → developer default → server default.
- [ ] Tool/terminal/raw-output capture obeys configured policy, including caps/summaries and secret handling.

**Gate:** unit tests на chunking + интеграционный тест append.

## Phase 4 — Embeddings + L1

**Deliverables:**

- [ ] Вызов embedding provider (config через env) + запись `embeddings`.
- [ ] Обработка cold start (нет ключа — явная ошибка `UNAVAILABLE` с понятным сообщением).
- [ ] Initial model router settings from [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md) and [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md): local embeddings default, active-agent route, subscription-worker route placeholder, OpenAI paid API baseline route, optional Gemini/Claude cheap route placeholders, Gemini embedding fallback candidates, and explicit quality/experiment placeholders for expensive models.
- [ ] Provider/worker adapters can be stubbed initially, but route config and `model_calls` audit must already preserve route class/provider/model/purpose/routing reason/limit status/cost or confirmation metadata.
- [ ] Default paid API path creates approval requests and does not call paid providers until approval is recorded.

**Gate:** `memory_search` vector leg работает на golden set минимум 3 документа.

## Phase 5 — Hybrid retrieval

**Deliverables:**

- [ ] Реализация pipeline из [RETRIEVAL.md](RETRIEVAL.md).
- [ ] Configurable retrieval policy for `N_lex`, `N_vec`, default `top_k`, `max_chars_total`, graph budgets, and related caps.
- [ ] Retrieval and governed-memory recall enforce ADR-0040 scope/audience filtering before ranking.
- [ ] Context Pack and retrieval conflict handling follow [ADR-0041](ADR-0041-conflict-resolution-priority.md).

**Gate:** `TEST_CONTRACT.md` retrieval section.

## Phase 6 — Governed memory + graph + checkpoint tools

**Deliverables:**

- [ ] `memory_create_agent_memory`, `memory_review_agent_memory`, `memory_recall_agent_memories`, `memory_report_recall_usage`.
- [ ] `memory_list_agent_memories` and `memory_get_agent_memory` for inbox/rules/source inspection.
- [ ] Policy enforcement: valid agent-created memories can be auto-created for recall, while instruction-grade requires direct explicit user instruction, review/import/user-confirmed path.
- [ ] Recall traces are written for governed memory recall.
- [ ] `memory_link`, graph expansion branch.
- [ ] `memory_get_checkpoint` / `memory_set_checkpoint`.
- [ ] `memory_get_context_pack` from [ADR-0024-automatic-startup-context-pack-builder.md](ADR-0024-automatic-startup-context-pack-builder.md): server-side composition of checkpoint, recovery warnings, governed memories/rules, optional bounded evidence, and suggested next fetches.
- [ ] Rule management workflow from [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md): promote/demote/reject/archive/supersede, duplicate/conflict reports, and closeout proposals.
- [ ] Conflict reports explain applicability, authority, scope specificity, and recency per ADR-0041.

**Gate:** governed memory policy tests pass; graph expansion не превышает budgets на синтетическом графе.

## Phase 6.5 — Review UI (required)

**Deliverables:**

- [ ] Owner-facing compact Review UI workbench from [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md), [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md), and [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md).
- [ ] UI runs on the AMP server deployment per [ADR-0020-review-ui-on-amp-server-management-platform-path.md](ADR-0020-review-ui-on-amp-server-management-platform-path.md).
- [ ] First screen follows [ADR-0021-review-ui-first-screen.md](ADR-0021-review-ui-first-screen.md): Review Inbox / Command Center, not a metrics dashboard.
- [ ] Management UI includes project list/selector and project-specific Settings entrypoint per [SETTINGS.md](SETTINGS.md).
- [ ] Views: project selector/list, inbox, rules, memory detail/source refs/history, duplicates, conflicts, Cost / Paid API, and project settings shortcut.
- [ ] Controlled Settings UI implements editable project settings, effective source display, confirmation-gated dangerous changes, secret redaction, and settings audit events per [ADR-0034-controlled-settings-ui-in-v1.md](ADR-0034-controlled-settings-ui-in-v1.md).
- [ ] Actions: accept/approve, reject, promote instruction, demote instruction, archive, unarchive, mark stale, edit, merge, supersede.
- [ ] UI actions use the same server-side policy path as MCP/CLI review actions and write `agent_memory_review_actions`.
- [ ] UI is private/local-server oriented and requires AMP-level auth/session/token even on Tailnet/SSH access; no public SaaS assumption.
- [ ] UI/admin API route/session design is Cloudflare-ready without enabling public/subdomain access by default.
- [ ] Initial implementation must be a compact working UI, not an approval-only table, while API/routing structure must not block management-platform expansion.

**Gate:** Review UI tests in `TEST_CONTRACT.md` pass.

## Phase 7 — Project onboarding CLI (required)

**Deliverables:**

- [ ] Команда `amp init --target codex` в папке проекта:
  1. Создаёт запись в `projects` (генерирует `project_id`, привязывает к `developer_id`).
  2. Assigns default `capture_profile=standard` unless overridden by `--capture-profile`.
  3. Записывает `.amp/config` в корень проекта (`project_id` + `amp_server_url`).
  4. Создаёт или дополняет thin `AGENTS.md` секцией «Memory (AMP)» (см. `REPO_CONTRACT.md`).
  5. Создаёт `PROJECT_LOG.md` если его нет.
  6. Печатает готовый блок MCP-конфигурации для вставки в настройки клиента.
  7. Может показать import candidates, но не создаёт import events и не запускает import без explicit `amp import ...`.
- [ ] Команда `amp discover` follows [ADR-0038](ADR-0038-environment-discovery-and-portable-instance.md) and [ADR-0039](ADR-0039-v1-import-workflow.md): scans candidates without silently importing or promoting them.
- [ ] Команда `amp import --dry-run` previews source refs, hashes, result classes, provisional scope/audience, high-risk assignments, and conflicts before durable writes.
- [ ] Флаг `--dry-run`: показывает план без изменений.
- [ ] Флаг `--capture-profile light|standard|detailed|custom`: overrides the automatic default during init.
- [ ] Target-aware generation for at least `codex` and `generic`; other targets may be added incrementally.
- [ ] `amp lint-context`: проверяет, что bootstrap files не стали duplicated context dumps and applies the configurable context policy from [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md), including project overrides.
- [ ] `amp context` or equivalent preview command calls the same Context Pack Builder used by `memory_get_context_pack`.
- [ ] Команда `amp doctor`: проверяет связность (Postgres, Ollama, `.amp/config`).
- [ ] `amp doctor` or equivalent diagnostics show effective model routes and whether local, active-agent, subscription-worker, and paid API routes are enabled/disabled.
- [ ] Cost / Paid API management view shows model-call audit, estimated cost, pending approvals, and confirms default `paid_api_mode=confirm_each`.
- [ ] Closeout intent handling follows [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md): known trigger phrases plus model-routed classification for ambiguous cases.
- [ ] Normal closeout calls `memory_closeout`; abnormal interruption recovery starts at the next `memory_start_session`.

**Gate:** тесты из `TEST_CONTRACT.md` Phase 7.

## Phase 8 — Hardening

**Deliverables:**

- [ ] Rate limits, size limits, structured errors.
- [ ] Security/access hardening from [ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md](ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md): private bind defaults, AMP auth, secret handling, token/session checks, and Cloudflare-ready config.
- [ ] Backup commands/jobs from [BACKUP_RESTORE.md](BACKUP_RESTORE.md): Postgres backup, raw artifact backup, manifest creation, and encrypted local target support.
- [ ] Restore verification command/job: restore into temporary DB/location and run basic read checks without touching production.
- [ ] Backup target abstraction allows future SSH/Tailscale replication to a second backup server, even if the initial implementation writes only to local AMP-server storage.
- [ ] Export/restore design preserves portability metadata and supports remapping/rebinding of project paths, secret references, connector/account bindings, and environment facts per ADR-0038.
- [ ] Документация запуска для трёх клиентов (ссылки на внешние official docs + наши env).

**Gate:** full `TEST_CONTRACT.md` green.

## Phase 9 — Cleanup & Analysis

**Deliverables:**

- [ ] Score decay в retrieval: формула из `CLEANUP.md`, параметры через env.
- [ ] Access tracking: асинхронное обновление `last_accessed_at` / `access_count` после каждого retrieval.
- [ ] `supersedes` penalty в rerank pipeline.
- [ ] MCP tool `memory_archive` (archive / unarchive).
- [ ] Команда `amp analyze` с интерактивным отчётом и LLM summary (Ollama fallback на keyword extraction).
- [ ] Команда `amp cleanup` с флагами `--archive`, `--delete-archived`, `--dry-run`, `--no-confirm`.

**Gate:** тесты из `TEST_CONTRACT.md` Phase 9.

## Parallelization rules

- Phases **1→2** можно слабо параллелить только после таблицы `projects` согласована.
- **3→4** последовательно (embed зависит от chunks).
- **5** зависит от **4**.
- **6** зависит от **5** для `memory_search` graph использования scores.

## Stop conditions

Если требование противоречит `NON_GOALS.md` — остановиться и создать новый `ADR-*.md`.
