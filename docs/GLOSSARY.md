# Glossary

Термины и стабильные идентификаторы. В коде и API использовать **те же имена**, что здесь.

## Core concepts

| Term | Definition |
|------|------------|
| **Developer** | Владелец одного или нескольких проектов. Верхний уровень иерархии памяти. Идентификатор: `developer_id` (UUID). В v1 один developer per AMP instance. |
| **Project** | Логическая единица изоляции памяти, обычно 1:1 с корнем git-репозитория на диске. Может иметь parent project для subproject/workspace hierarchy. Принадлежит `developer_id`. Идентификатор: `project_id` (UUID). |
| **MemoryDomain** | Высокоуровневая область памяти: `agent_work` для coding-agent workflow сейчас; future domains могут покрывать broader personal memory. |
| **Workspace** | Физический путь на машине пользователя, связанный с `project_id`. Может меняться; в ingest хранится как метаданные, не как primary key. |
| **Session** | Непрерывный период работы одного CLI-клиента с пользователем; идентификатор: `session_id` (UUID). |
| **Heartbeat** | Lightweight session liveness update for long-running/idle tasks. Updates session metadata only and does not create raw memory events. |
| **Turn** | Одно сообщение пользователя или одно сообщение ассистента в рамках `session_id`. Immutable после записи в raw layer. |
| **Event** | Нормализованная запись append-only журнала (может оборачивать turn, system event, checkpoint update). `event_id` (UUID). |
| **RawEvidence** | Нижний factual слой: turns, workflow events, command/tool traces, large-output excerpts, and raw artifact refs. Used for recovery/audit/reprocess, not as direct behavior instruction. |
| **RawArtifact** | Large raw evidence payload stored outside normal event JSONB: terminal/tool output, attachment, media, transcript export, etc. Postgres keeps pointer/hash/excerpt/metadata. |
| **Chunk** | Текстовый фрагмент для indexing/embedding; всегда имеет `source_event_id` или `source_turn_id` (provenance). Имеет scope metadata. |
| **ScopeKind** | Где память применима: `domain`, `developer`, `environment`, `project`, `repo`, `subproject`, `session`, `connector_account`, `capability`, `client_adapter`. See ADR-0040. |
| **Audience** | Кто/что может потреблять память: `all_agents`, `specific_client`, `context_pack`, `background_worker`, `review_ui`, `human_owner`, `import_pipeline`, `connector`. |
| **Scope** | Legacy shorthand for visibility. Older docs using `project`/`developer` should be read as the default subset of the ADR-0040 multi-axis scope model. |
| **Checkpoint** | Малая структурированная запись «где остановились»: текущая задача, открытые вопросы, ссылки на последние релевантные `event_id`. |
| **Edge** | Рёбро графа между двумя сущностями (например chunk↔chunk, turn↔file_path). Типизировано `relation_type`. |
| **AgentMemory** | Структурированная governed запись памяти: decision, constraint, lesson, failure, work_log, preference, artifact reference, etc. Всегда имеет review/use metadata и provenance, кроме explicit imported/user-confirmed records. |
| **SourceRef** | Ссылка AgentMemory на evidence: event, chunk, edge, checkpoint или external ref. |
| **ReviewAction** | Запись о human/agent/system действии над AgentMemory: accept/approve, reject, supersede, archive, promote, demote, mark stale, edit, merge. |
| **UsePolicy** | Правило использования AgentMemory агентом: evidence-only, recall-allowed, instruction-grade, do-not-use. |
| **RecallTrace** | Audit/observability запись о том, какие chunks/AgentMemory были возвращены и какие агент отметил как использованные или проигнорированные. |
| **ContextBudget** | Ограничение на то, сколько repo-native инструкций и recalled memory агент загружает в активное окно модели. См. `CONTEXT_BUDGET.md`. |
| **ContextPack** | Bounded server-built startup context for an agent session: checkpoint, relevant governed memories/rules, recovery warnings, optional evidence excerpts, and suggested next fetches. |
| **ContextPackBuilder** | Server-side policy engine that constructs ContextPack. CLI/UI previews must call this same logic rather than reimplementing context selection. |
| **ResolverHint** | Декларативная подсказка, какой doc/skill/memory загрузить при конкретном типе задачи. Inspired by Journey kit manifests. |

## Layers (storage)

| Layer | Name | Mutability |
|-------|------|------------|
| **L0** | Raw append | Append-only, no update/delete of content (только tombstone/legal hold если добавлено в будущем ADR). |
| **L1** | Derived chunks + embeddings | Генерируется из L0; версии; пересборка допустима. |
| **L2** | Graph edges | Append + optional soft-delete по политике. |
| **L3** | Governed agent memories | Структурированная память с provenance, review status, use policy, and recall traces. |

## Retrieval

| Term | Definition |
|------|------------|
| **Hybrid retrieval** | Комбинация vector similarity и lexical match (full-text / BM25-подобное). |
| **Graph expansion** | Расширение результата поиска по рёбрам L2 с configured budget. |
| **Rerank** | Второй этап упорядочивания кандидатов после hybrid recall. |

## Model routing

| Term | Definition |
|------|------------|
| **ActiveAgentRoute** | The currently open agent session, such as Codex, performs reasoning and writes the result to AMP through MCP tools. |
| **SubscriptionWorkerRoute** | A background/local/server worker uses supported OAuth/sign-in subscription mechanisms and existing plan limits. |
| **PaidApiRoute** | Direct token/credit-billed API call to OpenAI, Gemini, Claude, or a compatible paid provider. |
| **Subscription-first/API-last** | Routing rule: use local/active-agent/subscription-backed paths before direct paid API, and never silently fall through to paid API after subscription limits are hit. |

## MCP

| Term | Definition |
|------|------------|
| **Tool** | MCP tool с фиксированным именем и JSON Schema входа/выхода; см. `MCP_SPEC.md`. |
| **Transport** | stdio или streamable HTTP — по выбору реализации; контракт tools не зависит от transport. |

## Enums (initial)

### `relation_type` (non-exhaustive, extensible via migration)

- `follows` — временный порядок / продолжение темы.
- `references` — ссылка на сущность (файл, commit, URL как текст).
- `duplicates` — дубликат смысла (редко).
- `contradicts` — явное противоречие (для будущего reasoning; v1 optional).
- `supersedes` — новый chunk заменяет старый; старый получает score penalty ×0.1 в retrieval (см. `CLEANUP.md`).

### `client_kind`

- `codex` | `cursor` | `windsurf` | `claude_code` | `unknown` | `other`

### `heartbeat_status`

- `active` — client is alive and actively working.
- `idle` — client is alive but no active memory work is happening.
- `running_tests` — long-running test command.
- `running_command` — long-running shell/tool command.
- `background_job` — import/sync/index/background operation.
- `unknown` — liveness known, specific activity unknown.

### `project_kind`

- `repo` — обычный git/code project.
- `subproject` — дочерний проект внутри larger workspace/product.
- `workspace` — umbrella workspace grouping multiple repos/projects.
- `personal_domain` — future non-coding personal memory domain.
- `other` — explicit extension point.

### `scope_kind`

- `domain` — broad memory domain.
- `developer` — owner-level cross-project scope.
- `environment` — a specific AMP installation/server/runtime.
- `project` — logical project/workspace.
- `repo` — concrete repository/checkout.
- `subproject` — package/app/module inside a larger project/repo.
- `session` — current/recent session state.
- `connector_account` — external account context such as Google personal/corporate.
- `capability` — permitted operation backed by provider/token/account.
- `client_adapter` — Codex/Claude/Cursor/Windsurf-specific guidance.

### `audience_kind`

- `all_agents`
- `specific_client`
- `context_pack`
- `background_worker`
- `review_ui`
- `human_owner`
- `import_pipeline`
- `connector`

### `memory_domain`

- `agent_work` — coding-agent work, v1 default.
- `personal_life` — future broader personal memory.
- `research` — future research/general knowledge domain.
- `other` — explicit extension point.

### `ingest_source`

- `mcp_append` | `file_import` | `cli_export` | `api` | `system`

### `event_kind`

- `turn_user` — user message.
- `turn_assistant` — assistant message.
- `tool_call` — agent/client tool invocation metadata.
- `tool_result` — tool result metadata/excerpt.
- `terminal_output` — shell/terminal output metadata/excerpt.
- `file_change` — file-change observation or repo-sync evidence.
- `system` — warning, repair, migration, or internal event.
- `import_batch` — explicit import event.
- `checkpoint` — checkpoint update marker.
- `other` — explicit extension point when a client cannot classify the event yet.

### `artifact_kind`

- `tool_output` | `terminal_output` | `attachment` | `transcript_export` | `media` | `other`

### `storage_backend`

- `local_spool` | `server_filesystem` | `postgres_inline` | `object_storage` | `external`

### `route_class`

- `local_model` — local/Ollama/Postgres/self-hosted model work.
- `active_agent` — current MCP-connected agent session performs the reasoning.
- `subscription_worker` — supported OAuth/sign-in subscription worker route.
- `paid_api_provider` — direct paid API call.

### `paid_api_approval_status`

- `pending` — waiting for owner decision.
- `approved` — owner approved the paid API call.
- `denied` — owner rejected the paid API call.
- `expired` — request was not decided before expiry.
- `cancelled` — request is no longer needed because another route handled/deferred the task.

### `agent_memory_type`

- `decision` — принятое решение.
- `constraint` — ограничение/правило, которое надо учитывать.
- `lesson` — вывод из прошлого опыта.
- `failure` — ошибка/сбой и причина.
- `work_log` — короткая запись о проделанной работе.
- `open_question` — нерешённый вопрос.
- `artifact_reference` — ссылка на файл, commit, PR, документ, URL.
- `preference` — предпочтение developer/user, потенциально cross-project.
- `procedure` — повторяемая инструкция или workflow.

### `agent_memory_status`

- `candidate` — предложенная память; ещё не trusted как durable instruction.
- `accepted` — подтверждённая governed memory, usable according to `use_policy`.
- `rejected` — рассмотрена и намеренно не продвинута; retained for audit/dedup suppression.
- `archived` — сохранена для истории, исключена из normal recall.
- `superseded` — заменена новой записью; lineage сохраняется.
- `stale` — возможно устарела; требует проверки перед reliance.
- `needs_review` — требует решения владельца или higher-confidence process.

### `use_policy`

- `evidence_only` — можно показывать как evidence, но не как правило поведения.
- `recall_allowed` — можно использовать как обычную память после review.
- `instruction_grade` — можно использовать как устойчивую инструкцию/preference.
- `do_not_use` — не возвращать в обычном recall.

### `source_kind`

- `event` | `chunk` | `raw_artifact` | `edge` | `checkpoint` | `external`

### `review_action`

- `accept` | `approve` | `reject` | `supersede` | `archive` | `unarchive` | `mark_stale` | `promote_instruction` | `demote_instruction` | `edit` | `merge`

`approve` is retained as an API/CLI synonym for `accept` if implementation compatibility needs it; the stored lifecycle status is `accepted`.
