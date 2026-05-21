# ADR-0001: Postgres as single source of truth

## Status

Accepted

## Context

Требуется ACID-хранилище для append-only L0, производных L1 (chunks, embeddings), графа L2 и checkpoint. Нужны транзакции, миграции, предсказуемый ops story.

## Decision

Использовать **PostgreSQL** как единственный SoT с расширением **pgvector** для embeddings.

Physical domain layout is refined by [ADR-0011-postgres-instance-domain-databases.md](ADR-0011-postgres-instance-domain-databases.md): one Postgres instance, separate databases for major memory domains.

## Consequences

- Положительные: зрелые миграции, backup/replication, SQL для отладки, hybrid lexical через `tsvector`.
- Отрицательные: операционная стоимость Postgres; для edge single-binary сценариев потребуется отдельный ADR (не v1).

## Alternatives considered

- SQLite + sqlite-vss: проще single-user, хуже для concurrent multi-client writes и hybrid ops.
- Chroma standalone: быстрый старт, слабее реляционные инварианты и unified checkpoint в одной транзакции с графом.
