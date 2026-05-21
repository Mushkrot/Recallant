# Backup and restore

Recallant memory is only useful if it can be restored after a failure. This document is the practical backup/restore contract for v1. See [ADR-0028-practical-backup-restore-policy.md](ADR-0028-practical-backup-restore-policy.md).

## 1. Backup set

Every complete Recallant backup must include:

1. **Postgres domain database**
   - required v1 database: `recallant_agent_work`,
   - future domain databases such as `recallant_personal_life` when they exist.

2. **Raw artifact storage**
   - server filesystem or local/server spool-backed artifact files,
   - any future object-storage-backed artifact manifests.

3. **Backup manifest**
   - backup id,
   - created timestamp,
   - Recallant version,
   - migration/schema version,
   - database names included,
   - raw artifact root(s),
   - file counts and size totals,
   - hashes or hash manifest location,
   - backup target,
   - encryption status,
   - restore verification status.

4. **Restore metadata**
   - non-secret deployment notes,
   - required environment variable names,
   - service/container names,
   - migration version.

Do not store provider API keys or raw secrets in backup manifests.

## 2. Backup targets

v1 starts with a practical local target:

```text
Recallant server
  ├── Postgres / pgvector
  ├── raw artifacts
  └── local encrypted backup directory
```

The architecture must support adding a second backup server later:

```text
Recallant server
  ├── local encrypted backup directory
  └── replication over SSH/Tailscale
        ↓
     backup server on owner's network
```

The second server is not required on day one, but implementation should not hard-code "backup only lives on the Recallant server" as the permanent model.

## 3. Restore verification

A backup is not considered good just because it was created. Recallant must support a restore verification workflow.

Minimum verification:

- restore Postgres backup into a temporary database,
- load backup manifest,
- verify schema/migration version,
- verify raw artifact root exists,
- verify artifact hashes according to policy,
- run read checks:
  - list projects,
  - fetch latest checkpoint,
  - recall governed memories,
  - run bounded search on restored chunks.

The verification workflow must be safe to run without overwriting the production database.

## 4. Local spool rule

Local spool is not the official backup. It is an offline/resilience buffer.

Rules:

- unsynced spool records must not be pruned,
- synced spool records can be pruned only after server confirmation and local->server mapping are recorded,
- spool sync state should be visible in closeout warnings and Review/Management UI status.

## 5. PITR / WAL

Point-in-time recovery and WAL archiving are future hardening options. They are not required in v1.

The v1 requirement is reliable practical backup plus restore verification.
