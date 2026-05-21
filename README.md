# Recallant

**Governed memory for AI agents.**

Recallant is a source-backed memory and context continuity platform for AI coding agents. It preserves decisions, working context, evidence, checkpoints, and project-specific operating knowledge across sessions, tools, and agent clients.

## Документация

Вся машинно-ориентированная спецификация находится в каталоге **[docs/](docs/README.md)**.

Начните с [docs/README.md](docs/README.md) (порядок чтения зафиксирован там).

## Статус

На данный момент репозиторий содержит **только документацию** (PRD, архитектура, схема данных, MCP контракт, план реализации для агентов). Код реализации создаётся отдельным шагом по [docs/AGENT_IMPLEMENTATION_GUIDE.md](docs/AGENT_IMPLEMENTATION_GUIDE.md).

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## Связанные материалы

- `agent-bootstrap` — ранний личный sketch владельца, полезный для идей репозиторного контракта `AGENTS.md` / `PROJECT_LOG.md`, но не внешний mature upstream. Для продолжения работы соседняя папка не требуется: нужные выводы зафиксированы в [docs/REPO_CONTRACT.md](docs/REPO_CONTRACT.md), [docs/UPSTREAM_INTEGRATION.md](docs/UPSTREAM_INTEGRATION.md), and [docs/UPSTREAM_RESEARCH_2026-05-19.md](docs/UPSTREAM_RESEARCH_2026-05-19.md).
