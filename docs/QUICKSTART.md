# Quickstart — подключение нового проекта к Recallant

## Предусловие: сервер запущен

На Linux-сервере работают три контейнера (настраиваются один раз):

```bash
# docker-compose.yml в репозитории реализации
docker compose up -d   # postgres + ollama + recallant-server
```

Проверить:

```bash
recallant doctor
# ✓ Postgres reachable
# ✓ Ollama reachable (nomic-embed-text loaded)
# ✓ Recallant server version 1.x.x
```

---

## Шаг 1 — Создать и зарегистрировать новый проект

```bash
mkdir ~/projects/my-new-project
cd ~/projects/my-new-project
recallant init --target codex
```

Команда выполняет:
1. Создаёт запись в БД (`projects` таблица), генерирует `project_id`.
2. Assigns the default capture profile (`standard` for normal coding projects) unless explicitly overridden.
3. Записывает `.recallant/config` в папку проекта.
4. Создаёт `AGENTS.md` с секцией «Memory (Recallant)».
5. Добавляет `.recallant/` в `.gitignore`.
6. Печатает MCP-конфиг блоки для вставки в настройки клиента.
7. Может показать найденные import candidates, но не импортирует их автоматически.

You can override capture depth at init time:

```bash
recallant init --target codex --capture-profile detailed
```

Or change it later through Review UI/project settings or CLI.

`--target codex` is the near-term default path because the owner's current workflow is Codex-first. Other targets remain supported by architecture: `cursor`, `claude-code`, `windsurf`, and `generic`.

Пример вывода:

```
✓ Project registered: my-new-project
  project_id: 550e8400-e29b-41d4-a716-446655440000
  capture_profile: standard

✓ Created: .recallant/config
✓ Created: AGENTS.md

Detected import candidates:
  PROJECT_LOG.md
  docs/architecture/*.md

No imports were run.
Suggested commands:
  recallant import project-log PROJECT_LOG.md
  recallant import docs docs/architecture/*.md

─── Codex (paste into project/local Codex MCP config) ────────────
{
  "mcpServers": {
    "recallant": {
      "command": "recallant",
      "args": ["mcp-server"],
      "env": {
        "RECALLANT_PROJECT_ID": "550e8400-e29b-41d4-a716-446655440000",
        "RECALLANT_DEVELOPER_ID": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "RECALLANT_DATABASE_URL": "postgresql://recallant:secret@localhost:5432/recallant"
      }
    }
  }
}

─── Claude Code (optional target) ────────────────────────────────
{ ... }

─── Cursor (paste into .cursor/mcp.json) ─────────────────────────
{ ... }
```

---

## Шаг 2 — Вставить MCP-конфиг в клиент

Скопировать нужный блок из вывода `recallant init` и вставить в настройки своего клиента.

**Codex:** use the generated Codex MCP config from `recallant init --target codex`.

**Claude Code:** `.claude/settings.json` (глобально) или `<project>/.claude/settings.json` (локально).

**Cursor:** `.cursor/mcp.json` в папке проекта.

После этого клиент при следующем открытии папки автоматически подключится к Recallant.

---

## Шаг 3 — Начать работу

Открыть папку проекта в любом MCP-клиенте. Агент при старте:
1. Читает `AGENTS.md`.
2. Вызывает `memory_start_session`.
3. Вызывает `memory_get_context_pack` — получает checkpoint, relevant governed memories, recovery warnings, and suggested next fetches.
4. Готов к работе.

Существенная работа фиксируется через Recallant tools; live capture/full transcript capture зависит от подключённого клиента и ingest mode. Если live MCP write path недоступен, local spool/offload path сохраняет raw evidence для последующей синхронизации. Большие tool/terminal outputs хранятся как raw artifact metadata/pointers/excerpts, а не как startup context dump.

---

## Переключение между агентами / сессиями

Контекст не теряется при смене клиента или разрыве сессии.

```
Cursor (утро)                    Claude Code (вечер)
─────────────────────            ─────────────────────────────
работаю над задачей         →    открываю ту же папку
агент пишет в память             агент читает AGENTS.md
агент ставит checkpoint    →     агент вызывает memory_start_session
                                 агент вызывает memory_get_context_pack
                                 продолжает с той же точки
```

Тебе не нужно объяснять контекст новому агенту.

---

## Cross-project поиск

Если агент хочет найти решение которое ты уже применял в другом проекте:

```
memory_search(query="как я делал JWT авторизацию", scope="all")
```

Чтобы сохранить паттерн как общий для всех проектов:

```
memory_promote(chunk_id="...", note="мой стандартный JWT подход")
```

После этого все агенты во всех проектах находят его по умолчанию (`scope=developer`).

---

## Структура файлов после `recallant init`

```
my-new-project/
├── .recallant/
│   └── config          ← project_id + recallant_server_url (в .gitignore)
├── .gitignore          ← .recallant/ добавлен автоматически
├── AGENTS.md           ← инструкции для агентов (коммитить в git)
└── PROJECT_LOG.md      ← человекочитаемый checkpoint (коммитить в git)
```

The generated files must stay thin. They should not copy old project logs, long architecture docs, or all historical memory into the new project. That content belongs in Recallant and is recalled on demand.
