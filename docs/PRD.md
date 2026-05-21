# Product Requirements Document (PRD)

**Product name:** Recallant  
**Tagline:** Governed memory for AI agents  
**Doc version:** 1.0  
**Primary executors:** AI coding agents (not assumed: dedicated human engineering team).

## 0. Product stance

Recallant is intended to become a **full-quality working product for the owner's real AI-assisted development workflow**, not a quick prototype. The project may take more design and implementation effort if that is required for a coherent core.

Historical note: the project was originally drafted as **Agent Memory Platform (AMP)**. That name is retained only for historical context; active product and implementation contracts use **Recallant**.

Current architectural bias:

- **Open Brain / OB1** is the preferred foundation.
- Accepted synthesis: combine OB1 governance with MF0 workbench/raw-capture/Memory Tree/Keeper ideas; Recallant owns the bridge through managed hybrid capture profiles, Review UI, context-budget policy, and local-server-first deployment.
- Other reviewed systems remain active sources of subsystem ideas: MemPalace, OpenMemory, and Journey. `agent-bootstrap` is the owner's earlier personal sketch and remains useful as repo-contract inspiration, not as an external mature upstream.
- Matthew Berman's **Journey / Journey Kits** is a reference for packaging and distributing reusable agent workflows.
- Governed agent memory is part of v1, not a deferred phase-2 enhancement.
- Owner-facing compact Review UI workbench for governed memory is part of v1, not a deferred nice-to-have.
- Review UI runs on the Recallant server; v1 starts as a compact private workbench and should evolve into a broader management platform.
- Managed hybrid capture is part of v1: raw evidence can be preserved broadly, but future behavior is governed by structured memories, review, checkpoint, scoring, and project capture policy.
- Raw workflow evidence is the lower factual layer; governed memory is the upper behavior layer. Large raw outputs use artifact metadata/pointers/excerpts rather than being dumped into agent context.
- Current daily usage is Codex-first, while the architecture remains a universal MCP memory platform for any supported agent. Codex is the first adapter, not the product boundary.
- Settings are centralized on the Recallant server; project repositories store only pointer config.
- Settings UI is controlled in v1: project workflow settings are editable; sensitive/global/server settings are read-only or confirmation-gated.
- Model routing is configurable and provider-switchable. Local models are the default for core recall; stronger reasoning is subscription-first/API-last; paid API requires explicit confirmation by default; OpenAI is the baseline paid API profile only when paid API is approved; Gemini and Claude cheap models are optional paid API routes by task, project, and budget.
- v1 is a full working core for coding-agent memory, not a throwaway MVP. Broader personal-life memory, passive capture, large blob/object storage, specialized vector/graph databases, and public product packaging are designed for as future expansion, not first implementation scope. See [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md).
- Practical backup/restore is part of v1: Postgres + raw artifacts + manifest + restore verification, with a future path to a second backup server.
- Security/access posture is private-by-default plus Recallant auth: localhost/Tailnet/SSH by default, Review UI/admin API require Recallant auth even inside private network, and Cloudflare-managed access is a near-future opt-in mode requiring edge auth plus Recallant auth.
- Session liveness uses hybrid heartbeat: ordinary session tools update `last_seen_at`, and optional `memory_heartbeat` exists for long-running/idle tasks without writing raw memory events.

## 1. Problem statement

При Vibe Coding один и тот же каталог проекта открывается в разных CLI-агентах (Cursor, Windsurf, Claude Code). У каждого клиента свои правила, своя «память» внутри сессии и **compaction** окна контекста. В результате:

- при смене клиента **теряется рабочий контекст** (решения, договорённости, история рассуждений);
- внутри одного клиента **теряется длинный контекст** после compaction и из-за лимитов;
- между сессиями теряются **правила работы**, предпочтения пользователя и уже объяснённые договорённости;
- при подключении нового проекта требуется заново переносить структуру конфигурации и handoff-файлы;
- длинные repo-native инструкции и логи могут забивать окно контекста ещё до начала полезной работы;
- попытка «скормить всё» в промпт **невозможна** по стоимости и размеру окна.

Нужна **внешняя долговременная память** с **selective retrieval** и **единым хранилищем** для всех клиентов, плюс явный **checkpoint** «с чего продолжить».

## 2. Goals

### G1 — Cross-client continuity

Для фиксированного `project_id` любой поддерживаемый MCP-клиент может в новой сессии **восстановить практический контекст работы** через retrieval + checkpoint, без необходимости заново «переобъяснять весь проект» с нуля.

**Измеримость (acceptance):**

- [ ] Два разных клиента (например Codex и Cursor/Claude Code) подключены к **одному** store для одного `project_id`.
- [ ] После записи N turns в сессии A, сессия B находит top релевантные chunks по запросу, совпадающему с последней задачей из checkpoint.

### G2 — Intra-session resilience

Система сохраняет raw evidence according to configured capture policy and builds derived layers (L1/L2/L3) так, чтобы при пересборке индексов **не терялась** возможность вернуться к источникам через provenance. Resilience must not depend only on a perfect end-of-session closeout.

**Измеримость:**

- [ ] Любой `chunk_id` однозначно указывает на источник в L0.
- [ ] Re-embed job не уничтожает L0; максимум помечает старые embedding rows superseded.
- [ ] Project capture profile controls how much raw detail is recorded without changing the governed-memory model.
- [ ] Large workflow evidence can be preserved through raw artifact pointer/hash/excerpt records without forcing unbounded event JSONB or context output.
- [ ] `memory_start_session` detects an unclosed previous session and returns recovery metadata.
- [ ] Optional `memory_heartbeat` updates liveness metadata for long-running/idle tasks without creating L0 events.
- [ ] `memory_closeout` marks a normal ending session closed and updates checkpoint/governed-memory state.

### G3 — Token-safe agent interface

Агент **никогда** не получает «всю базу» одним вызовом. MCP tools возвращают **bounded** payload according to configured retrieval/context policy (см. `RETRIEVAL.md`, `MCP_SPEC.md`, and ADR-0015).

**Измеримость:**

- [ ] Стресс-тест: 1M символов в L0/raw artifacts → tools return ≤ configured max chars и ≤ max items.

### G4 — Hybrid recall

Поддержка **vector + lexical** поиска и опционального **graph expansion** с бюджетом.

**Измеримость:**

- [ ] Задокументированный golden set из запросов в `TEST_CONTRACT.md` проходит пороги precision@k (минимальные пороги задаются там же).

### G5 — Where we stopped

Checkpoint хранится в БД и **дублируется по смыслу** в репозитории через контракт `REPO_CONTRACT.md` (`PROJECT_LOG.md`).

**Измеримость:**

- [ ] `memory_get_checkpoint` и файл `PROJECT_LOG.md` после `memory_set_checkpoint` согласованы по полю `current_focus` (или эквиваленту) within a configured freshness budget. A 5-second budget may be used as a default test profile, but it is not a product-wide invariant.

### G6 — Governed agent memory

Система хранит не только raw events/chunks, но и структурированные **agent memories**: решения, ограничения, правила, уроки, ошибки, work logs, references to artifacts. Эти записи имеют provenance, review status и use policy.

**Измеримость:**

- [ ] Agent-generated memories создаются автоматически без ручного подтверждения каждой записи, если проходят validation/provenance policy.
- [ ] Agent-generated memory не может стать `instruction_grade` без explicit user confirmation/import/strong policy.
- [ ] Любой `agent_memory` имеет минимум один source ref на L0/L1 или external ref, если он не создан напрямую пользователем как imported/confirmed.
- [ ] Recall возвращает bounded set governed memories с review/use metadata.
- [ ] Recall trace или usage report показывает, какие governed memories были возвращены и какие агент отметил как использованные.

### G7 — One-action project onboarding

Новый проект должен подключаться к Recallant без ручного копирования всей структуры правил и логов.

**Измеримость:**

- [ ] `recallant init --target codex` создаёт `.recallant/config`, тонкий `AGENTS.md`, `PROJECT_LOG.md`, и нужный MCP/config output для Codex.
- [ ] `recallant init --dry-run` показывает план без изменений.
- [ ] Project bootstrap не копирует большие исторические документы в новый проект.
- [ ] Архитектура допускает Journey-style kit/skill distribution как альтернативный путь установки.

### G7.1 — Universal client adapters

Codex must work first, but Recallant must not become Codex-specific.

**Измеримость:**

- [ ] The same MCP tool contracts support `client_kind=codex`, `cursor`, `claude_code`, `windsurf`, and `other`.
- [ ] Client-specific code is limited to bootstrap/config/adapter generation and smoke tests.
- [ ] Core storage, policies, session lifecycle, closeout, recovery, and Review UI do not branch on Codex-specific behavior except for metadata/ergonomics.

### G8 — Context-budget discipline

Recallant должен улучшать качество работы агента без загрузки огромных файлов при старте сессии.

**Измеримость:**

- [ ] Сгенерированные `AGENTS.md`/adapter files остаются тонкими и содержат routing rules вместо long-form history.
- [ ] Startup flow восстанавливает контекст через automatic server-built context pack (`memory_start_session` → `memory_get_context_pack`), not manual user explanation.
- [ ] CLI/UI can preview the same context pack for debugging without creating a separate context-building algorithm.
- [ ] Есть тест или lint, который ловит bootstrap files с большим дублированным историческим контентом.

### G9 — Local-server-first memory runtime

Core Recallant работает на личном Linux-сервере владельца, с локальными embedding/consolidation задачами и optional внешними LLM для сложного анализа.

**Измеримость:**

- [ ] Базовый append/search работает без внешнего LLM API.
- [ ] Embedding provider по умолчанию self-hosted.
- [ ] External LLM providers включаются через config только для optional enrichment/consolidation/rerank/review assistance.
- [ ] Router can switch local/OpenAI/Gemini/Claude models by purpose/project/session without changing core memory behavior.
- [ ] Router distinguishes `local_model`, `active_agent`, `subscription_worker`, and `paid_api_provider`.
- [ ] Default escalation uses active agent or supported subscription worker before paid API when available.
- [ ] Paid API is not used silently after subscription limits are exhausted; Recallant defers/downgrades/asks according to policy.
- [ ] Default paid API mode is `confirm_each`; every direct paid API request requires explicit owner approval before execution.
- [ ] Recallant management UI includes a near-real-time cost dashboard for paid API estimates, approvals, providers/models, purposes, and project totals.
- [ ] Default paid API profile uses OpenAI unless a project/session explicitly selects optional Gemini or Claude routes.
- [ ] Preview/experimental model use is explicit and visible, not hidden inside defaults.

### G10 — Offline/local spool resilience

Recallant должен позволять работать локально, когда сервер недоступен, интернет медленный или live MCP write path временно не работает.

**Измеримость:**

- [ ] Local spool пишет append-only JSONL/NDJSON records with dedup keys.
- [ ] `recallant sync-spool` загружает локальные записи на сервер и сохраняет mapping local id → server `event_id`.
- [ ] После успешного sync локальные spool records могут быть safely pruned/offloaded.
- [ ] Search/recall явно показывает, если локальные unsynced records ещё не попали в server SoT.
- [ ] Local spool follows the same project/session capture policy as live server capture.

### G12 — Practical backup and restore

Recallant must be restorable after server/database/artifact failure.

**Измеримость:**

- [ ] Automated backup includes `recallant_agent_work` Postgres database.
- [ ] Backup includes raw artifact storage or enough artifact manifests to verify missing payloads.
- [ ] Backup manifest records timestamp, schema/migration version, included databases, artifact roots, hashes, sizes, and target.
- [ ] Restore verification can restore into a temporary database/location without overwriting production.
- [ ] Restore verification runs basic read checks: project list, checkpoint, governed memory recall, and bounded search.
- [ ] Architecture supports later replication of encrypted backups to a second server over SSH/Tailscale.

### G13 — Private access with Cloudflare-ready auth

Recallant must protect memory and management surfaces by default while remaining ready for a near-future Cloudflare-managed subdomain.

**Измеримость:**

- [ ] Default deployment binds Review UI/admin API to localhost or Tailnet/private interface.
- [ ] Review UI/admin API require Recallant auth/session/token even on private network.
- [ ] Postgres is not exposed publicly and is reachable only by Recallant runtime or explicit trusted admin operations.
- [ ] Provider API keys and secrets are not sent to browser clients.
- [ ] Future Cloudflare mode is represented in config/routing without being enabled by default.
- [ ] Cloudflare mode requires edge auth such as Cloudflare Access or equivalent plus Recallant auth.
- [ ] No unauthenticated public management, MCP, backup, or raw-artifact route exists.

### G11 — Owner review UI for governed memory

Recallant v1 должен дать владельцу полноценный UI для управления важной, конфликтной и долгосрочной памятью.

Placement: the UI runs on the Recallant server. It starts as a compact working review/cost/settings workbench, not a minimal approval table, while the architecture allows growth into a full private management platform.

First screen: Review Inbox / Command Center. It should prioritize items that need the owner's decision, not raw memory browsing or metrics.

**Измеримость:**

- [ ] UI показывает inbox важных/`candidate`/`needs_review`/high-risk memories.
- [ ] First screen shows scope/profile, critical review warnings, priority lanes, main review queue, selected item evidence, and review actions.
- [ ] v1 UI includes project navigation, Inbox, Rules, detail/source panel, Duplicates, Conflicts, Cost / Paid API, and Settings entrypoint.
- [ ] Management UI can list all managed projects and open project-specific Review/Settings views.
- [ ] Settings UI can edit project capture profile, context budget profile, review sensitivity, route enablement, paid API mode, client adapters, and project paths/aliases.
- [ ] Settings UI shows effective value source and writes audit records for changes.
- [ ] Settings UI confirmation-gates dangerous changes and does not expose raw secrets.
- [ ] UI показывает active `instruction_grade` rules with scope/type filters.
- [ ] UI показывает source refs and review history before promotion.
- [ ] UI позволяет accept/reject/promote/demote/archive/unarchive/mark-stale/edit/merge/supersede; approve may remain as a compatibility label/alias.
- [ ] UI показывает duplicate/conflict reports and suggested resolutions.
- [ ] Ordinary memories do not require manual approval before becoming useful recall records.

## 3. User stories (for coding agents)

1. **As an agent**, I want to call `memory_search` with a natural language query so that I retrieve prior decisions related to the current task without reading the entire repository.
2. **As an agent**, I want to call `memory_append_turn` so that my conversation fragments are durably stored with provenance.
2a. **As an agent/client adapter**, I want to call `memory_append_event` so tool output, terminal output, file-change evidence, and large raw artifacts are captured without polluting startup context.
3. **As an agent**, I want `memory_link` so that I can connect a decision chunk to a file path or commit id for later graph navigation.
4. **As an agent**, I want `memory_get_checkpoint` / `memory_set_checkpoint` so that I can resume work from the last agreed step.
5. **As an agent**, I want to create proposed `agent_memory` records from evidence so important decisions and lessons can be reviewed and reused safely.
6. **As an agent**, I want to recall accepted governed memories separately from raw chunks so I can distinguish stable instructions from evidence.
7. **As an agent**, I want a thin repo bootstrap so a new project can inherit global memory conventions without copying old logs.
8. **As an agent**, I want to load only relevant context so I do not waste the model window on unnecessary startup files.
8a. **As an agent**, I want to call one startup context-pack tool after session start so I do not manually guess which checkpoint/memories/searches to combine.
9. **As an agent**, I want to keep working during server/network outages and sync captured context later.
10. **As an agent**, I want deterministic error codes from MCP tools so that I can retry or escalate per `MCP_SPEC.md`.
11. **As the owner**, I want a Review UI so I can manage important memories, active rules, conflicts, duplicates, and source evidence without reviewing every automatic memory write.
12. **As the owner**, I want capture profiles per project so serious projects can record more detail while simple projects keep only the essentials.
13. **As the owner**, I want centralized settings so I can open Recallant management UI, choose a project, and inspect or change its project-specific settings without editing local files.
14. **As the owner**, I want a cost dashboard and explicit paid API approvals so Recallant cannot quietly add token bills on top of my existing agent subscriptions.

## 4. Priorities

1. Correctness of **L0 append + provenance**  
2. Governed **agent memory** with review/use policy
3. Owner-facing **Review UI** for important/conflicting/long-term memory hygiene
4. **Context-budget discipline** and one-action project bootstrap
5. **MCP contract** stability
6. **Retrieval quality** (hybrid + budgets)
7. Ingest breadth (автоматизация всех CLI — позже, см. `INGESTION.md`)

## 5. Success metrics (v1)

- Retrieval latency p95 для `memory_search` на локальном Postgres — целевые значения задаются в `TEST_CONTRACT.md` (не в PRD числами — избегаем рассинхрона).
- Zero data loss for L0 under normal shutdown (ACID commit before ACK to client).
- A new Codex project can be bootstrapped without manually copying existing project configuration history.
- Agent startup context remains bounded and task-relevant.
- A new Codex session in an old project restores the current task without the owner re-explaining context.
- Local captured work can be synced to the server after an outage.
- The owner can review and curate important/conflicting/long-term memories through UI without confirming every ordinary memory write.

## 6. Dependencies

- PostgreSQL с расширением `pgvector`.
- Реализация MCP server (language выбирается в implementation guide).
- Repo-native Recallant contract generated by `recallant init` — см. `REPO_CONTRACT.md`. The older personal `agent-bootstrap` sketch is only historical inspiration.

## 7. v1 Scope

v1 is the full working core for **coding-agent memory**. It includes:

- raw session/event evidence according to capture policy,
- raw artifact metadata/pointers for large workflow evidence,
- local spool/offline sync,
- practical backup/restore with restore verification,
- session lifecycle, hybrid heartbeat, interruption recovery, and closeout,
- checkpoints,
- Context Pack Builder,
- hybrid search with bounded responses,
- governed memories with provenance/review/use policy/source refs/recall traces,
- Review UI for important/conflicting/long-term governed memory hygiene,
- paid API approval flow and cost dashboard,
- centralized settings,
- private-by-default access with Recallant auth and Cloudflare-ready routing,
- local-first, subscription-first, API-last model router with OpenAI paid API baseline and optional Gemini/Claude cheap routes,
- Codex adapter as first working target and universal MCP contracts for later clients,
- project/developer rules and preferences,
- decisions, constraints, lessons, failures, procedures, work logs,
- file/commit/doc/external references as source-linked artifacts,
- explicit imports of important project docs, git history, issues, PRs, or external links when requested.

v1 does not automatically ingest every file, issue tracker, browser event, email, calendar item, or personal-life source. It does not require object storage, a separate vector DB, or a graph DB. Those are future expansion paths through explicit connectors/domains/ADRs.

## 8. Future Expansion Options

Future expansion may add:

- broader project imports: selected docs, git history, PRs/issues, release notes;
- codebase semantic map: symbols, dependency graph, architecture evidence;
- personal research memory: articles, notes, links, reading history;
- personal-life memory: calendar, email, files, browser history, messages;
- ambient capture: only after separate design for consent, review, privacy, and noise control;
- object storage for huge raw blobs and attachments;
- dedicated vector DB or graph DB when measured scale/query patterns justify the operational cost;
- richer visual Memory Tree/workbench beyond the required Review UI;
- public packaging / Journey-style kit distribution;
- multi-user/SaaS/security expansion.
