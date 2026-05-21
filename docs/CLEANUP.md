# Cleanup & Analysis

Цель: предотвратить накопление устаревших, противоречивых и невостребованных данных, которые снижают качество retrieval и могут направить агента в неверном направлении.

Decision status: conservative v1 retention accepted. See [ADR-0035-conservative-retention-and-cleanup.md](ADR-0035-conservative-retention-and-cleanup.md).

## 0. Retention v1

AMP cleanup must not erase the source of truth by default.

Policy:

- L0 raw evidence: no automatic delete.
- Raw artifacts, transcripts, and log exports: no automatic delete by default.
- L1 derived data: chunks, embeddings, summaries, and indexes may be archived, rebuilt, refreshed, or removed from active retrieval.
- L3 governed memory: use archive, supersede, reject, or stale status; no silent hard delete by default.
- Local spool / unsynced data: delete only after confirmed sync.
- Operational queues/temp jobs: cleanup allowed after successful completion or configured timeout.
- Model/cost/audit logs: retain for dashboard, debugging, and accountability; cleanup only under explicit configured retention.

Default posture:

```text
Prefer archive/rebuild over hard delete.
Hard delete is an explicit owner action or a future configured retention policy, not default behavior.
```

## 1. Проблема

База накапливает три типа "мусора":

| Тип | Пример | Риск |
|-----|--------|------|
| **Устаревшее решение** | "используем Redis" → потом переключились на Postgres | Агент получает оба ответа, не знает какой актуальный |
| **Брошенный эксперимент** | "попробуем GraphQL" → отказались, но chunk остался | Агент предлагает GraphQL как актуальный вариант |
| **Невостребованный контекст** | debug-сессии, временные заметки 6-месячной давности | Шум снижает релевантность реальных результатов |

## 2. Автоматический score decay

Retrieval автоматически снижает score старых chunks. Агент получает свежие решения выше устаревших без каких-либо действий.

### Формула

```
decay(chunk) = max(MIN_DECAY, 0.5 ^ (age_days / halflife_days))
```

Где:
- `age_days` — кол-во дней с `chunks.occurred_at`
- `halflife_days` — настраивается через policy/env
- `MIN_DECAY` — настраиваемая нижняя граница

Итоговый score в retrieval:
```
score_final = S * decay(chunk)
```

Где `S` — результат hybrid scoring из `RETRIEVAL.md`.

### Разные halflife для разных scope

| Scope | Default halflife | Обоснование |
|-------|-----------------|-------------|
| `project` | profile default | Проектные решения меняются быстрее |
| `developer` | profile default | Общие паттерны более стабильны |

Оба значения настраиваемы: `AMP_DECAY_HALFLIFE_PROJECT_DAYS`, `AMP_DECAY_HALFLIFE_DEVELOPER_DAYS`. Examples such as 90/365 days are tuning defaults, not architecture invariants.

### Отключение decay

`AMP_DECAY_ENABLED=false` — отключает decay полностью (для отладки или специальных случаев).

## 3. Явное supersede

Агент может явно пометить что новый chunk заменяет старый:

```
memory_link(
  src_kind="chunk", src_id=<новый_chunk>,
  dst_kind="chunk", dst_id=<старый_chunk>,
  relation_type="supersedes"
)
```

При retrieval: chunk с входящим ребром `supersedes` получает policy-defined penalty so it ranks below the active replacement. В hit добавляется поле `superseded_by: chunk_id` для прозрачности.

## 4. Access tracking

Каждое обращение к chunk через `memory_search` или `memory_fetch_chunk` обновляет:
- `chunks.last_accessed_at` — время последнего обращения
- `chunks.access_count` — счётчик обращений

Это основа для анализа невостребованных данных.

**Важно:** обновление происходит асинхронно (после отправки ответа агенту) чтобы не добавлять latency к retrieval.

## 5. Archiving

Chunk можно архивировать — исключить из обычного поиска, сохранив данные:

- MCP tool: `memory_archive(chunk_id)` — устанавливает `chunks.archived_at = now()`
- Archived chunks не попадают в `memory_search` по умолчанию
- Явный параметр `memory_search(include_archived=true)` — включает их обратно
- L0 events никогда не архивируются — только derived chunks

Raw artifacts follow the same evidence-first posture as L0 metadata. Ordinary cleanup may archive/delete derived chunks and embeddings, but it must not delete raw artifact records or full artifact content unless an explicit retention/offload policy says so. In v1 the default is to preserve raw evidence and prune only confirmed local spool copies after server sync.

## 6. `amp analyze` — интерактивный анализ

Команда для периодической ревизии накопленных данных.

### Запуск

```bash
amp analyze                          # все проекты
amp analyze --project my-project     # конкретный проект
amp analyze --older-than 90d         # example threshold; configurable
amp analyze --not-accessed 90d       # example threshold; configurable
```

### Что делает

1. Находит кандидатов на удаление по критериям (см. ниже).
2. Кластеризует их по теме (используя существующие embeddings — k-means или nearest-neighbor группировка).
3. Для каждого кластера генерирует краткое summary на русском/английском через локальную LLM (Ollama, модель `AMP_ANALYSIS_MODEL`, default: `llama3.2:3b`).
4. Показывает интерактивный отчёт и предлагает действия.

Analysis model names and thresholds are profile/config defaults, not architecture invariants. The hard requirement is that cleanup analysis is auditable, dry-run capable, and can degrade to an offline non-LLM path.

### Критерии кандидатов (настраиваемые)

```
not_accessed_days  >= AMP_STALE_NOT_ACCESSED_DAYS
OR
age_days           >= AMP_STALE_AGE_DAYS
```

При этом исключаются:
- Chunks с `scope=developer` (общие паттерны — более ценны)
- Chunks к которым ведут активные `supersedes` рёбра (они уже учтены в scoring)
- Checkpoint-related chunks

### Формат отчёта

```
══════════════════════════════════════════════════════
AMP Analysis Report — project: my-project
Stale chunks: 47  |  Clusters: 4
══════════════════════════════════════════════════════

Cluster 1 — 12 chunks  |  Last accessed: 4 months ago
Topic: Попытка миграции на Redis (март 2026, отказались)
Oldest: 2026-03-12  |  Newest: 2026-03-18

  [d] Delete   [a] Archive   [k] Keep   [v] View chunks
> _

──────────────────────────────────────────────────────

Cluster 2 — 8 chunks  |  Never accessed
Topic: Debug-сессия: проблема с JWT refresh token (решена)
Oldest: 2026-02-01  |  Newest: 2026-02-01

  [d] Delete   [a] Archive   [k] Keep   [v] View chunks
> _
```

### Действия

| Команда | Результат |
|---------|-----------|
| `d` (delete) | Физически удаляет chunks и embeddings из L1/L2. L0 events сохраняются. |
| `a` (archive) | Устанавливает `archived_at`, исключает из поиска. Обратимо. |
| `k` (keep) | Не трогает. Добавляет `AMP_STALE_NOT_ACCESSED_DAYS` к следующей проверке для этого кластера. |
| `v` (view) | Показывает полные тексты chunks кластера. |
| `da` (delete all) | Удалить все кластеры в этом отчёте. |
| `aa` (archive all) | Архивировать все. |

### LLM для summary — провайдеры

`amp analyze` поддерживает три провайдера для генерации summary. Выбор через `AMP_ANALYSIS_PROVIDER`:

| Провайдер | Config | Стоимость | Когда использовать |
|-----------|--------|-----------|-------------------|
| `ollama` (default) | `AMP_ANALYSIS_MODEL=llama3.2:3b` | бесплатно | повседневный анализ |
| `openai` | `AMP_OPENAI_API_KEY=...`, `AMP_ANALYSIS_MODEL=gpt-4o-mini` | платно | когда нужно лучшее качество summary and explicit paid API approval is granted |
| `none` | — | бесплатно | keyword-only fallback без LLM |

#### Ollama (default)

```bash
amp analyze  # использует llama3.2:3b через локальный Ollama
```

Если Ollama недоступна или модель не загружена — автоматически деградирует в `none` с предупреждением.

#### Внешний API (OpenAI и совместимые)

```bash
amp analyze --provider openai
# или через env:
AMP_ANALYSIS_PROVIDER=openai amp analyze
```

Перед запуском `amp analyze` с внешним провайдером **создаёт paid API approval request**, показывает оценку стоимости и запрашивает подтверждение:

```
Analysis provider: OpenAI (gpt-4o-mini)
Clusters to summarize: 4
Estimated input tokens: ~3,200
Estimated cost: ~$0.0005 (≈ $0.00015/1K input tokens)

Proceed? [y/N] _
```

Default behavior does not allow silent paid API calls. A future script mode may bypass per-call prompts only when `paid_api_mode=auto_with_caps` is explicitly enabled for the project/task/profile and the call remains visible in the Cost / Paid API dashboard.

Оценка стоимости рассчитывается по формуле:
```
tokens_est = sum(len(cluster_text) / 4)  # грубая оценка: 4 символа ≈ 1 токен
cost_est   = tokens_est * price_per_token[model]
```

Цены моделей хранятся в конфиге реализации и обновляются вручную — не гарантируют точность, служат ориентиром.

#### Keyword fallback (`none`)

Если LLM недоступен или явно выбран `--provider none` — summary заменяется на топ-5 ключевых слов кластера (TF-IDF). Работает полностью офлайн.

```
Cluster 1 — 12 chunks  |  Last accessed: 4 months ago
Keywords: redis, migration, cache, connection, failed
```

### Промпт для summary (внутренний, все LLM-провайдеры)

```
Given these text fragments from a developer's memory system, 
write a 1-2 sentence summary in plain language describing 
what topic/task they relate to. Be specific and concrete.
Fragments: [chunk texts, truncated to configured analysis prompt cap]
```

## 7. `amp cleanup` — пакетная очистка

Для автоматизации без интерактивного режима:

```bash
# Example: архивировать всё старше 6 месяцев без единого обращения
amp cleanup --archive --not-accessed 180d --no-confirm

# Example: удалить уже заархивированные chunks старше года
amp cleanup --delete-archived --older-than 365d

# Example dry run — показать что будет сделано без действий
amp cleanup --archive --not-accessed 90d --dry-run
```

## 8. Env variables (полный список)

| Variable | Default | Meaning |
|----------|---------|---------|
| `AMP_DECAY_ENABLED` | `true` | Включить score decay |
| `AMP_DECAY_HALFLIFE_PROJECT_DAYS` | `90` | Half-life для project-scope chunks |
| `AMP_DECAY_HALFLIFE_DEVELOPER_DAYS` | `365` | Half-life для developer-scope chunks |
| `AMP_DECAY_MIN` | `0.2` | Минимальный decay multiplier |
| `AMP_STALE_NOT_ACCESSED_DAYS` | profile default | Порог "не запрашивался N дней" для analyze |
| `AMP_STALE_AGE_DAYS` | profile default | Порог возраста chunk для analyze |
| `AMP_ANALYSIS_PROVIDER` | `ollama` | Провайдер LLM для summary: `ollama` \| `openai` \| `none` |
| `AMP_ANALYSIS_MODEL` | `llama3.2:3b` | Модель для summary (Ollama model name или OpenAI model id) |
| `AMP_OPENAI_API_KEY` | — | API ключ OpenAI; обязателен если `AMP_ANALYSIS_PROVIDER=openai` |
| `AMP_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL; можно заменить на совместимый API |

Defaults in this table are implementation/profile defaults. They can change without architecture revision if routing, cost, or quality evidence justifies it and the change is explicit in config.
