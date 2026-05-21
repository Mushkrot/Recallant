# Repository contract (AMP repo-native fallback)

Цель: каждый **целевой git-проект**, который использует AMP, имеет **тонкий дисковый контракт**, понятный любому CLI-агенту без доступа к MCP.

This contract exists to prevent context loss without recreating the old problem of huge startup files. Long history belongs in AMP; repo files route the agent to the right memory.

The owner's earlier `agent-bootstrap` project inspired this file-based contract, but AMP owns the final repo contract and generated adapters.

## 1. Required files in the application repository

После выполнения `amp init` в папке проекта:

| File | Role |
|------|------|
| `.amp/config` | Локальный конфиг проекта: `project_id`, `amp_server_url` (не коммитить в git) |
| `AGENTS.md` | Канонические правила; **должно** содержать секцию «Memory (AMP)» см. ниже |
| `PROJECT_LOG.md` | Человекочитаемый checkpoint; дублирует смысл `memory_get_checkpoint` |

`.amp/config` — YAML или JSON, пример:

```yaml
project_id: "550e8400-e29b-41d4-a716-446655440000"
amp_server_url: "http://localhost:3748"
```

Добавить `.amp/` в `.gitignore` проекта (содержит локальные пути, не подлежит коммиту).

`.amp/config` is only a pointer. It must not become the source of truth for capture profile, context budget, model routing, review behavior, or other AMP policies. Authoritative settings live on the AMP server; see [SETTINGS.md](SETTINGS.md).

`amp init` must be idempotent and target-aware. The default near-term target is Codex, but the same bootstrap should support Cursor, Claude Code, Windsurf, and other targets through generated adapters rather than duplicated manual setup.

## 2. Canonical «Memory (AMP)» section for `AGENTS.md`

Агент-исполнитель **вставляет** следующий блок в каждый целевой репозиторий (текст можно локализовать, структура обязательна):

```markdown
## Memory (AMP)

- At session start: call `memory_start_session`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call `memory_get_context_pack` with the current task hint.
- Use `memory_search` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in memory_search — not broad ones. One call per session start is enough.
- After meaningful progress: update checkpoint via `memory_set_checkpoint` and update `PROJECT_LOG.md` to match fields `current_focus` and `next_step`.
- On clear pause/exit/closeout intent: call `memory_closeout` and update `PROJECT_LOG.md` from the closeout payload.
- To share a pattern across all projects: call `memory_promote` on the relevant chunk.
- Never paste secrets into memory tools.
- If MCP unavailable: still update `PROJECT_LOG.md` only.
```

## 3. Field mapping

| `memory_set_checkpoint.payload` | `PROJECT_LOG.md` section |
|-------------------------------|---------------------------|
| `current_status` | `## Current Session` → status line |
| `current_focus` | `Current focus` |
| `next_step` | `Next step` / `## Next Steps` |
| `open_questions` | `## Risks / Open Questions` |

Полная детерминированная процедура синхронизации — в `TEST_CONTRACT.md` (интеграционный сценарий).

## 4. MCP client configuration (per-project)

После `amp init` команда печатает готовый блок для вставки. Ниже — канонические примеры.

### Codex

Codex is the first target for v1 ergonomics. `amp init --target codex` must generate the exact MCP config block for the implementation's supported Codex config path and set `client_kind=codex` for sessions.

`AGENTS.md` remains the canonical project instruction surface for Codex.

### Claude Code (`~/.claude/settings.json` или `.claude/settings.json` в проекте)

```json
{
  "mcpServers": {
    "agent-memory-platform": {
      "command": "amp",
      "args": ["mcp-server"],
      "cwd": "/path/to/project",
      "env": {
        "AMP_PROJECT_ID": "<project_id из .amp/config>",
        "AMP_DEVELOPER_ID": "<developer_id>",
        "AMP_DATABASE_URL": "postgresql://amp:secret@localhost:5432/amp"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json` в папке проекта)

```json
{
  "mcpServers": {
    "agent-memory-platform": {
      "command": "amp",
      "args": ["mcp-server"],
      "env": {
        "AMP_PROJECT_ID": "<project_id из .amp/config>",
        "AMP_DEVELOPER_ID": "<developer_id>",
        "AMP_DATABASE_URL": "postgresql://amp:secret@localhost:5432/amp"
      }
    }
  }
}
```

`amp init` генерирует эти блоки автоматически с подставленными значениями.

## 5. Agent session flow

Канонический порядок действий агента при каждой новой сессии:

```
1. Прочитать AGENTS.md (автоматически при старте в большинстве клиентов)
2. Вызвать memory_start_session → получить session_id, checkpoint, и recovery warning если прошлая сессия оборвалась
3. Вызвать memory_get_context_pack(session_id, task_hint=<текущая задача>) → получить checkpoint, recovery warnings, relevant rules/memories, optional evidence, and suggested next fetches
4. Если есть unclosed previous session: восстановиться по context pack и явно отметить gaps/warnings
5. Вызвать memory_search(query=<текущая задача>) только если context pack явно недостаточен или задача изменилась
6. Работать, периодически вызывая memory_append_turn / memory_create_agent_memory / memory_set_checkpoint
6a. Если идёт долгая команда, тесты, import/sync или другая пауза без memory tools — использовать memory_heartbeat для liveness
7. При завершении значимого шага — вызвать memory_set_checkpoint
8. Обновить PROJECT_LOG.md в соответствии с checkpoint (поля current_focus, next_step)
```

Агент **не должен** просить пользователя объяснять контекст если выполнены шаги 2-3.

## 5.1 Manual session closeout flow

When the owner explicitly closes/pauses a session, the agent should perform a full durable closeout rather than a minimal checkpoint:

Closeout intent is natural-language aware. Phrases such as "Закрываем сессию", "Exit", or "Сохрани все и выходим" should trigger closeout when context supports it. Ambiguous cases may use model routing for intent classification; ask for confirmation only when unclear or risky.

1. Ensure recent raw work is appended or spooled.
2. Create/update governed memories for decisions, constraints, lessons, failures, procedures, artifact references, work log, and open questions.
3. Link important memories/chunks to files, commits, PRs, docs, or external refs where available.
4. Call `memory_closeout` with closeout summary, checkpoint payload, governed-memory candidates, and artifact refs.
5. Update `PROJECT_LOG.md` with the returned/current status, current focus, next step, blockers, and open questions.
6. Sync local spool if server is reachable; otherwise leave clear unsynced state.
7. Keep repo files compact; long narrative belongs in AMP.

This flow is intentionally heavier than normal incremental work because manual session closeout is the moment where context loss is most expensive.

Normal successful closeout should be quiet. The agent should show a short report only when `memory_closeout.report_required=true`, such as unsynced spool, conflicts, pending review items, failed writes, incomplete repo sync, low-confidence extraction, or server/model/provider errors.

Closeout does not import historical docs/git/exports automatically. Use explicit `amp import ...` commands for that.

## 6. Token efficiency guidelines (для агентов)

AMP намеренно возвращает **bounded** контекст чтобы не перегружать окно агента. Рекомендации для агентов:

**Вызывай memory_search точечно, не широко.**
Запрос должен отражать конкретную задачу сессии, не "расскажи всё о проекте".
```
Плохо:  memory_search(query="проект")
Хорошо: memory_search(query="как реализована JWT авторизация")
```

**Используй результаты в начале сессии, не повторяй вызовы.**
`memory_start_session` + `memory_get_context_pack` — нормальный стартовый путь. Повторный `memory_search` в середине сессии только если задача изменилась или Context Pack явно предлагает добрать evidence.

**Не добавляй все hits в контекст.**
`text_excerpt` в hit — достаточно для большинства задач. `memory_fetch_chunk` or explicit raw artifact inspection — только если excerpt явно недостаточен.

**`max_chars_total` — настраивай под задачу.**
Standard profile may default around 12000 символов (~3000 токенов), but the real limit comes from configured retrieval/context policy. Для быстрых справочных запросов можно снизить budget.

**Prompt caching (для агентов на Claude API).**
Если агент встраивает результаты `memory_search` в системный промпт — эта часть кешируется при повторных вызовах в той же сессии. Размещать блок памяти в начале системного промпта, до динамических инструкций.

## 7. Duplication policy

- `AGENTS.md` is the canonical thin agent entrypoint.
- Adapter files must point to canonical rules instead of duplicating long sections.
- `PROJECT_LOG.md` should contain the current resume state, not months of detailed history.
- Detailed history, decisions, failures, lessons, and source evidence should be stored in AMP.
- If a project already has large legacy logs, `amp init` / `amp analyze` should suggest archiving or importing them rather than appending more duplicated content.

## 8. Journey-style packaging path

AMP's own bootstrap may later be distributed as a Journey-style kit/skill in addition to the local CLI. Any such kit must preserve this repo contract:

- thin installed files,
- target-aware adapters,
- preflight checks,
- verification command,
- resolver hints instead of always-loaded long context,
- no silent overwrite of user-maintained project files.
