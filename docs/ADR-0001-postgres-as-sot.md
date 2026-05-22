# ADR-0001: Postgres as single source of truth

## Status

Accepted

## Context

Recallant needs ACID storage for append-only L0, derived L1 chunks/embeddings, L2 graph data, and checkpoints. It needs transactions, migrations, and a predictable operations story.

## Decision

Use **PostgreSQL** as the single source of truth with the **pgvector** extension for embeddings.

Physical domain layout is refined by [ADR-0011-postgres-instance-domain-databases.md](ADR-0011-postgres-instance-domain-databases.md): one Postgres instance, separate databases for major memory domains.

## Consequences

- Positive: mature migrations, backup/replication, SQL debugging, and hybrid lexical search through `tsvector`.
- Negative: Postgres operational cost; edge/single-binary scenarios need a separate ADR and are not v1.

## Alternatives considered

- SQLite + sqlite-vss: simpler for single-user local scenarios, weaker for concurrent multi-client writes and hybrid operations.
- Chroma standalone: faster bootstrap, weaker relational invariants, and no unified checkpoint/graph transaction.
