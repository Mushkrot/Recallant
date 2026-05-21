# Test contract

Любая фаза из [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) **не считается завершённой**, пока не выполнены соответствующие проверки ниже.

## Phase 0

- [ ] Линтер настроен и `npm run lint` / `ruff check` (эквивалент) завершается 0.

## Phase 1

- [ ] `migrate up` на пустой Postgres: успех.
- [ ] Extensions: `vector` присутствует.
- [ ] `projects` table includes `parent_project_id`, `project_kind`, and `memory_domain`.
- [ ] `raw_artifacts` table exists and links large raw evidence to `events`.
- [ ] `sessions` table includes heartbeat fields: `last_heartbeat_at`, `heartbeat_status`, and `heartbeat_metadata`.
- [ ] Tables for governed memory exist: `agent_memories`, `agent_memory_source_refs`, `agent_memory_review_actions`, `recall_traces`.
- [ ] Chunk/governed-memory/import-result storage can represent ADR-0040 `scope_kind`, `scope_id`, and audience metadata; `project|developer` remains only the compatibility/default subset.
- [ ] Settings tables exist: `system_settings`, `developer_settings`, `project_settings`, `session_overrides`, `client_adapter_settings`, `settings_audit_events`.

## Phase 2

- [ ] Handshake MCP: server отвечает списком tools с именами **точно** как в [MCP_SPEC.md](MCP_SPEC.md).
- [ ] Tool list includes universal session lifecycle tools: `memory_start_session` and `memory_closeout`.
- [ ] Tool list includes automatic startup context tool: `memory_get_context_pack`.
- [ ] Tool list includes raw workflow evidence tool: `memory_append_event`.
- [ ] Tool list includes optional liveness tool: `memory_heartbeat`.

## Phase 3

- [ ] `memory_start_session(client_kind="codex")` creates an active `sessions` row and returns `session_id`.
- [ ] `memory_start_session` recommends `memory_get_context_pack` as the normal next startup call.
- [ ] `memory_start_session(client_kind="cursor"|"claude_code"|"windsurf")` uses the same server contract and differs only by `client_kind`.
- [ ] Session-scoped tool calls update `sessions.last_seen_at`.
- [ ] `memory_heartbeat` updates `sessions.last_seen_at`, `last_heartbeat_at`, and bounded heartbeat metadata.
- [ ] `memory_heartbeat` does not create `events`, chunks, embeddings, or governed memories.
- [ ] `memory_append_turn` создаёт ровно одну строку `events` и ≥1 `chunks` для длинного текста.
- [ ] `memory_append_turn` stores ordinary captured user/assistant turn text in L0 according to the active capture profile.
- [ ] `memory_append_event(event_kind="terminal_output"|"tool_result")` creates an `events` row with bounded text/excerpt and raw artifact refs when large evidence is present.
- [ ] Повтор с тем же `dedup_key` не создаёт новый `event_id`.
- [ ] Effective capture policy resolves in order: session override → project policy → developer default → server default.
- [ ] `light`, `standard`, and `detailed` fixture policies produce different raw/tool-output capture depth while preserving the same governed-memory path.
- [ ] Large terminal/tool output is capped/summarized in event payload and stored as raw artifact metadata/pointer unless explicit full inline capture is enabled by policy.
- [ ] Changing a project's capture profile affects only new events in that project; existing events/chunks/governed memories are unchanged unless an explicit reprocess workflow is run.
- [ ] A new `memory_start_session` detects a previous unclosed session in the same project and returns recovery metadata instead of hiding the interruption.
- [ ] Stale/interrupted-session detection uses configurable thresholds rather than hard-coded universal numbers.

## Phase 4

- [ ] После append для fixture-текста, достаточно длинного чтобы пройти chunk/embed path, существует row в `embeddings` для каждого chunk (или явный `pending` флаг если выбрана такая схема — тогда тест проверяет флаг). Конкретный размер fixture задаётся тестовым профилем.
- [ ] Default embedding route resolves to local `ollama/nomic-embed-text` unless project/session settings override it.
- [ ] Cloud embedding fallback candidates include OpenAI and Gemini routes in settings, even if provider calls are stubbed in early tests.
- [ ] Switching embedding model/dims is blocked unless an explicit reindex/migration workflow is requested.
- [ ] Every embedding/model call writes a `model_calls` audit row with route class/provider/model/purpose/routing reason/status.
- [ ] Default-profile paid API route creates a `paid_api_approval_requests` row and does not call the provider until approved.

## Phase 5 — Golden retrieval (minimal)

Подготовить фикстуру из **трёх** искусственных событий с пересекающейся лексикой и семантикой.

- [ ] Запрос по редкому токену возвращает правильный chunk (lexical path).
- [ ] Запрос перефразирования возвращает семантически ближайший chunk (vector path).
- [ ] Для configured fixture cap вроде `max_chars_total=2000` суммарная длина excerpts + metadata в ответе tool **никогда** не превышает этот configured cap.
- [ ] Scope/audience fixture excludes unrelated project/environment/client-adapter/connector memories before ranking.

## Phase 6

- [ ] `memory_create_agent_memory(created_by="agent")` with valid source refs creates a governed memory without requiring user confirmation for that write.
- [ ] Ordinary valid agent-created memories become recallable (`accepted` + `recall_allowed`) or explicitly marked `candidate` / `needs_review` by deterministic risk/confidence policy.
- [ ] Agent-created memory без `source_refs` возвращает `VALIDATION_ERROR`.
- [ ] `memory_review_agent_memory(action="accept")` меняет статус на `accepted` и обычную policy на `recall_allowed`; `approve` may work as a compatibility alias.
- [ ] `instruction_grade` разрешён только для direct explicit user instruction, user/import/review-approved flow и не проходит тихо для raw agent-created inferred/candidate/needs-review records.
- [ ] `memory_list_agent_memories(view="inbox")` returns `candidate`/`needs_review`/high-risk items and excludes ordinary low-risk recall memories by default.
- [ ] Review Inbox default includes important, conflicting, and long-term records: candidate rules, scope-changing candidates, conflicts, duplicates, high-risk guidance, low-confidence behavior guidance, and promotion/demotion/archive/supersede candidates.
- [ ] Review Inbox default excludes raw events, ordinary evidence chunks, routine work logs, routine project facts, and low-risk source-linked memories that do not affect future behavior.
- [ ] `memory_list_agent_memories(view="rules")` returns active `instruction_grade` records by default.
- [ ] `memory_get_agent_memory` returns source refs and review action history.
- [ ] Duplicate/candidate report can flag two semantically similar rule memories without auto-deleting either.
- [ ] Conflict report can flag an older instruction/decision contradicted by a newer accepted decision.
- [ ] Conflict report explains ADR-0041 applicability/authority/scope-specificity/recency for at least one high-risk conflict.
- [ ] Two client-adapter records with non-overlapping audiences are not treated as a conflict.
- [ ] High-risk equal-authority conflict is returned as needs review instead of being silently resolved.
- [ ] `memory_review_agent_memory(action="edit")` preserves source refs and records previous values in review action metadata.
- [ ] `memory_review_agent_memory(action="merge")` leaves one canonical memory active and marks merged duplicates as superseded/archived.
- [ ] `memory_recall_agent_memories` не возвращает `candidate`, `needs_review`, `stale`, `rejected`, `archived`, `superseded` или `do_not_use` записи по умолчанию.
- [ ] `memory_recall_agent_memories` возвращает `trace_id`, а `memory_report_recall_usage` обновляет соответствующий `recall_traces` row.
- [ ] `memory_link` создаёт ребро; `memory_search` с `graph_expand=true` подтягивает соседа в пределах `graph_budget_nodes`.
- [ ] `memory_set_checkpoint` затем `memory_get_checkpoint` возвращает эквивалентный JSON (JSON semantic equality).
- [ ] `memory_get_context_pack` returns checkpoint, relevant binding rules, working memories, recovery warnings when present, optional bounded evidence, and suggested next fetches under configured context budget.
- [ ] `memory_get_context_pack` distinguishes `instruction_grade` binding rules from ordinary working memories.
- [ ] `memory_get_context_pack` does not import historical docs or read all project files.
- [ ] `memory_get_context_pack` does not return full raw artifact content; it returns only bounded excerpts/source refs when evidence is included.

## Phase 6.5 — Review UI

- [ ] Review UI is served from the AMP server deployment or a sibling `amp-review-ui` process behind the same AMP private boundary.
- [ ] First screen is Review Inbox / Command Center, not a raw memory list or metrics dashboard.
- [ ] v1 UI is a compact workbench, not an approval-only table: it includes project navigation, Review Inbox, Rules, detail panel, action controls, Cost / Paid API, and Settings entrypoint.
- [ ] First screen shows current project/scope/domain/capture profile.
- [ ] Management UI can list all managed projects and navigate into one project's Review Inbox and Settings.
- [ ] Project Settings UI can edit capture profile, context budget profile, review sensitivity, model route enablement, paid API mode, enabled clients, and project paths/aliases.
- [ ] Settings UI shows effective value and source for at least one project setting inherited from developer/global default.
- [ ] Settings UI writes `settings_audit_events` for every setting change.
- [ ] Dangerous settings changes require explicit confirmation: paid API enablement, future `auto_with_caps`, subscription worker enablement, developer/global edits, major capture/context increases, preview models, and quality-critical route changes.
- [ ] Settings UI shows secret status/reference only and never raw provider API keys, database URLs, backup encryption keys, auth secrets, or Cloudflare secret values.
- [ ] First screen shows critical status when present: unclosed/interrupted session, unsynced spool, high-risk conflicts.
- [ ] First screen has priority lanes or equivalent grouping for Conflicts, Candidate Rules, Important/Needs Review, and Duplicates.
- [ ] Selecting an item shows source refs/evidence, status/use policy/confidence, related records, and available actions.
- [ ] Review UI shows inbox records: `candidate`, `needs_review`, important, high-risk, duplicate, and conflict candidates.
- [ ] Review UI does not make ordinary low-risk memories mandatory review work.
- [ ] Review UI shows active `instruction_grade` rules with scope/type/project/domain filters.
- [ ] Management UI includes a Cost / Paid API view showing current day/month estimated paid API cost, cost by project/provider/model/purpose, and pending approvals.
- [ ] Management UI does not expose a full raw memory browser, graph explorer, broad analytics suite, or public SaaS dashboard in v1.
- [ ] Browser/UI clients cannot read provider API keys or raw prompts from cost/model-call records.
- [ ] Memory detail view shows body, status, use policy, confidence, source refs, related records, and review action history.
- [ ] UI accept/reject/archive/unarchive/mark-stale/promote/demote/edit/merge/supersede actions update the same database state as `memory_review_agent_memory`; approve may remain as a UI label/alias if needed.
- [ ] UI promotion to `instruction_grade` requires visible source refs and writes a review action.
- [ ] Duplicate view allows choosing a canonical memory and marking the others merged/superseded/archived.
- [ ] Conflict view shows old/new records and can apply a supersede/demote/archive resolution.
- [ ] Ordinary auto-created recallable memories do not appear as mandatory approval work unless policy marks them important/risky/conflicting.
- [ ] Review UI/admin API is not publicly exposed by default in the local/server test profile.
- [ ] Review UI/admin API requires AMP auth/session/token even when bound to localhost/Tailnet.
- [ ] Browser/UI clients cannot read provider API keys or secret env values.

## Phase 7

- [ ] `amp init --target codex --dry-run` в папке без `.amp/config`: печатает план, не изменяет файлы.
- [ ] `amp init --target codex` создаёт `.amp/config` с валидным UUID `project_id`, запись в таблице `projects`.
- [ ] `amp init --target codex` assigns `capture_profile=standard` by default and prints it in the plan/output.
- [ ] `amp init --target codex --capture-profile detailed` stores the override and prints it in the plan/output.
- [ ] `amp init` stores authoritative project settings on the AMP server; `.amp/config` contains only pointer data such as `project_id` and `amp_server_url`.
- [ ] `amp init --target codex` создаёт или дополняет thin `AGENTS.md` секцией «Memory (AMP)».
- [ ] `amp init --target codex` создаёт `PROJECT_LOG.md` если его нет.
- [ ] `amp init --target codex` печатает готовый MCP-конфиг блок для Codex.
- [ ] `amp init --target codex` может напечатать import candidates, но не создаёт `events.kind=import_batch` и не запускает import без explicit `amp import ...`.
- [ ] `amp discover --dry-run` shows project/server/secret-reference/import candidates without creating active memories or instruction-grade records.
- [ ] `amp import --dry-run` shows source refs, hashes, result classes, provisional scope/audience, high-risk assignments, and conflicts without writing durable import rows.
- [ ] `amp import` of `.env.example` stores variable names/meanings only and never raw secret values.
- [ ] `amp import` of client-specific docs such as `CLAUDE.md` defaults to client-adapter/specific-client audience rather than universal all-agent instruction.
- [ ] Closeout intent recognizer treats "Закрываем сессию", "Exit", and "Сохрани все и выходим" as closeout triggers when context supports it.
- [ ] `memory_closeout` marks the session closed, updates checkpoint, creates/updates governed-memory candidates, and returns a `PROJECT_LOG.md` update payload.
- [ ] Successful warning-free `memory_closeout` returns `report_required=false`.
- [ ] `memory_closeout` returns `report_required=true` and warnings when spool is unsynced, conflicts exist, `candidate`/`needs_review` records are created, writes fail, repo sync is incomplete, extraction confidence is low, or server/model/provider errors occur.
- [ ] Ambiguous closeout wording uses model routing or asks for confirmation; risky/non-routine actions require confirmation.
- [ ] `amp lint-context` проходит на свежем bootstrap и падает на fixture с большим duplicated historical log in `AGENTS.md`.
- [ ] `amp lint-context` applies configured context policy/profile rather than hard-coded universal file-size limits.
- [ ] `amp lint-context` accepts an explicit large-project override with reason, but still fails on duplicated history, secrets, or adapter rule duplication.
- [ ] Startup fixture restores context through checkpoint + governed memories without reading long docs or archive logs.
- [ ] Startup fixture uses `memory_start_session` followed by `memory_get_context_pack` as the normal automatic path.
- [ ] `amp context` or equivalent preview returns the same core pack sections as `memory_get_context_pack` for the same project/session policy.
- [ ] Startup broad query fixture such as `memory_search(query="проект")` is warned/rejected by context-budget lint or policy tests.
- [ ] `amp doctor` возвращает OK при доступных Postgres и Ollama; возвращает конкретную ошибку при недоступности каждого.
- [ ] `amp doctor` or equivalent diagnostics shows effective model routes for `local_model`, `active_agent`, `subscription_worker`, and `paid_api_provider`, and marks disabled routes clearly.
- [ ] Default powerful-model escalation is subscription-first/API-last: active agent or supported subscription worker before paid API where available.
- [ ] Default paid API profile routes through OpenAI unless project/session settings explicitly select Gemini or Claude.
- [ ] If subscription route reports `rate_limited` or `exhausted`, AMP defers/downgrades/asks according to policy and does not silently fall through to paid API.
- [ ] Default `paid_api_mode=confirm_each`; every direct paid API request requires explicit approval before provider call.
- [ ] Denied/expired paid API approval defers or downgrades the task according to policy without creating a paid provider call.
- [ ] `auto_with_caps` is rejected unless explicitly enabled for the project/task/profile and visible in settings/cost dashboard.
- [ ] Browser automation, scraping, hidden API routes, and limit-bypass route configs are rejected or fail policy checks.
- [ ] Preview/experimental model IDs are rejected or warned unless the project/session explicitly enables preview use.
- [ ] Default Gemini cost/speed profiles route to `gemini-2.5-flash-lite` or `gemini-2.5-flash`, not `gemini-3.5-flash`.
- [ ] `gemini-3.5-flash` requires explicit project/session opt-in or an experiment/quality profile.
- [ ] Default cheap Claude profile routes to Haiku; Sonnet/Opus require explicit quality profile.

## Offline spool

- [ ] При недоступном сервере local spool append создаёт JSONL/NDJSON record with stable dedup key.
- [ ] Local spool can include raw artifact pointer/hash/metadata records for large evidence and sync them to server `raw_artifacts`.
- [ ] `amp sync-spool --dry-run` показывает unsynced records без записи на сервер.
- [ ] `amp sync-spool` загружает records, создаёт server `event_id`, и сохраняет local→server mapping.
- [ ] Повторный `amp sync-spool` не создаёт duplicates.
- [ ] `amp prune-spool --synced` удаляет/архивирует только confirmed synced records.

## Phase 8

- [ ] Append текста размером **> лимита** возвращает `VALIDATION_ERROR` без записи в БД.
- [ ] `memory_search` на БД с representative fixture size завершается < **configured p95 budget** (например 10k chunks / 1500ms на dev hardware может быть локальным CI-профилем; не как жёсткий prod SLO).
- [ ] Backup command/job creates a backup manifest with backup id, timestamp, AMP/schema version, included DBs, artifact roots, hash manifest, target, encryption status, and job status.
- [ ] Backup includes `amp_agent_work` Postgres data and raw artifact storage metadata/files required by `raw_artifacts`.
- [ ] Restore verification restores backup into temporary database/location without overwriting production.
- [ ] Restore verification checks schema/migration version, raw artifact pointers, artifact hashes according to policy, project list, latest checkpoint, governed memory recall, and bounded search.
- [ ] Backup target config can represent current local AMP-server storage and a future second server over SSH/Tailscale.
- [ ] Portable restore/remap fixture can map old project roots, secret references, connector/account bindings, and environment facts to new values without editing raw memories by hand.
- [ ] Backup manifests/logs do not include provider API keys or raw secrets.
- [ ] Default HTTP bind config is localhost/Tailnet/private interface, not public `0.0.0.0`, unless explicit owner config enables another mode.
- [ ] Remote MCP/admin API rejects unauthenticated requests.
- [ ] Future Cloudflare mode exists as explicit config but is disabled by default.
- [ ] Cloudflare mode requires both edge-auth metadata/config and AMP auth/session; tests must reject unauthenticated public access.
- [ ] No unauthenticated public route exposes Review UI, admin API, MCP tools, backups, or raw artifacts.

## Phase 9

- [ ] `memory_search` возвращает older fixture chunk с score ниже идентичного fresh chunk when decay is enabled (конкретный age gap задаётся тестовым профилем).
- [ ] Chunk с `archived_at IS NOT NULL` не появляется в `memory_search` без `include_archived=true`.
- [ ] Ordinary cleanup can archive/delete derived chunks/embeddings but does not delete L0 events or raw artifact records by default.
- [ ] Spool pruning deletes only records confirmed synced to server.
- [ ] Governed-memory cleanup changes lifecycle status (`archived`, `superseded`, `rejected`, or `stale`) rather than hard-deleting by default.
- [ ] После `memory_link(relation_type="supersedes", src=new, dst=old)` — старый chunk получает score penalty: его `S_final` < его `S_base * decay`.
- [ ] `access_count` chunk увеличивается после `memory_search` который его вернул.
- [ ] `amp analyze --dry-run` не изменяет данные, печатает отчёт.
- [ ] `amp cleanup --archive --not-accessed <configured-threshold> --dry-run` не изменяет данные, печатает список кандидатов.

## Cross-client smoke (manual until automated harness exists)

- [ ] Два MCP клиента (например Cursor + другой) с одинаковым `AMP_PROJECT_ID`: append в A, search в B находит тот же факт по запросу.

## Repo contract sync

- [ ] После `memory_set_checkpoint`, поля `current_focus` и `next_step` отражены в `PROJECT_LOG.md` согласно [REPO_CONTRACT.md](REPO_CONTRACT.md) within the configured repo-sync freshness budget **или** документирована причина async (тогда тест допускает polling по тестовому профилю, например до 5s).

## Fixtures location

Реализация должна хранить golden fixtures в `tests/fixtures/` относительно implementation repo (создаётся агентом в Phase 3+).
