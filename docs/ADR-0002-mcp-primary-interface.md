# ADR-0002: MCP as primary agent interface (v1)

## Status

Accepted, refined by [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md)

## Context

Целевые пользователи системы — **coding agents** в Cursor, Windsurf, Claude Code. Им нужен стабильный механизм вызова памяти без кастомного HTTP в каждом клиенте.

## Decision

В v1 **все** операции чтения/записи памяти для агентов идут через **MCP tools** с контрактом из [MCP_SPEC.md](MCP_SPEC.md).

Owner-facing governed-memory review is a separate surface: ADR-0016 requires a Review UI/admin API in v1. This does not make REST/HTTP the primary agent interface.

## Consequences

- Клиенты получают единообразный способ подключения.
- Тестирование упирается в MCP harness (stdio).
- Нативные плагины под каждый редактор **не требуются** в v1.

## Alternatives considered

- REST first: больше работы на каждый клиент (разные auth модели).
- File-only memory: не масштабируется на hybrid + graph с контролем лимитов.
