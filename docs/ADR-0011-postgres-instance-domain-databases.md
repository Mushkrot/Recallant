# ADR-0011: One Postgres instance with domain databases

## Status

Accepted

## Context

The owner does not want a multi-storage-system architecture for v1. Separate object storage, vector DB, and graph DB would make Recallant harder to administer and debug before the core product is proven.

At the same time, the owner does not want all future memory domains to live in one undifferentiated database. Coding-agent memory and future personal-life memory should not accidentally become one mixed operational bucket.

## Decision

Use **one Postgres instance** on the Recallant server, with **separate databases for major memory domains**.

Initial physical layout:

```text
Postgres instance on Recallant server
  └── recallant_agent_work        # required v1 database
```

Reserved future layout:

```text
Postgres instance on Recallant server
  ├── recallant_agent_work        # coding-agent memory
  ├── recallant_personal_life     # future broader human memory
  └── recallant_research          # optional future research/reference memory
```

v1 should not create empty future databases unless implementation/ops simplicity makes that useful. The important v1 choice is that the first database is already named and treated as a domain database, not as a generic `recallant` bucket.

The canonical schema in `DATA_MODEL.md` applies to `recallant_agent_work` first. Future domain databases may reuse the same base L0/L1/L2/L3 structure and extend it through ADRs.

## Consequences

- Recallant avoids the operational complexity of separate storage products in v1.
- Domain-level backup, retention, restore, and cleanup policies remain possible.
- Future personal-life memory can be added without extracting it from an already-mixed coding database.
- Cross-domain search cannot rely on one simple SQL join; the Recallant server must perform explicit fan-out/merge when cross-domain recall is allowed.
- Migration tooling must be domain-aware: at minimum it can run migrations for `recallant_agent_work`; later it must run the correct migration set per domain database.
- `memory_domain` remains in records even inside a domain database for provenance, export/import, and future compatibility.
- Backup/restore policy is domain-aware: v1 backs up `recallant_agent_work`, and future domain databases must be included explicitly when they are created. See [ADR-0028-practical-backup-restore-policy.md](ADR-0028-practical-backup-restore-policy.md).

## Rejected

- **Option A as long-term physical direction:** one Postgres database with multiple schemas/tables. It is acceptable as an implementation shortcut only if it does not change the public architecture, but it is not the preferred target.
- **Option C for v1:** Postgres + object storage + vector DB + graph DB as required systems. This is rejected for v1 because it creates distributed-storage complexity too early.

## Open questions

- Should Recallant ever add a tiny `recallant_control` database for domain registry, server metadata, and global configuration, or should domain routing remain config/env-based?
- Should future `recallant_personal_life` reuse exactly the same base schema or get a specialized schema from the beginning?
- What exact backup retention windows should apply to each domain database?
