# ADR-0028: Practical backup and restore policy for v1

## Status

Accepted

## Context

AMP exists to prevent loss of working memory and project context. Therefore AMP itself must not become a single fragile point of memory loss.

The owner selected the practical v1 policy rather than a minimal backup or enterprise-level point-in-time recovery setup:

- target policy: automated Postgres backup + raw artifact backup + encrypted backup copy + periodic restore verification,
- initial deployment may keep backups on the same AMP server,
- future deployment should support copying backups to a second server on the owner's network,
- PITR/WAL archiving is a future hardening option, not mandatory for v1.

## Decision

AMP v1 will implement a **practical backup/restore policy**.

The backup set must cover:

1. `amp_agent_work` Postgres database.
2. Raw artifact storage used by `raw_artifacts` records.
3. Backup manifests containing timestamps, schema/migration version, artifact paths, hashes, sizes, and backup job status.
4. Non-secret deployment/config metadata needed to restore the AMP server.

Local spool is not the canonical backup. However, unsynced local spool records must be preserved until the server confirms sync. A local spool record may be pruned only after confirmed server sync and sync manifest update.

## v1 target behavior

- Backups run automatically according to configured schedule.
- Initial backup target may be local storage on the same AMP server.
- Backup target abstraction must allow later replication to a second backup server over SSH/Tailscale or another explicit transport.
- Backups should be encrypted before leaving the AMP server.
- A backup is not considered healthy only because a file exists. AMP must support restore verification into a temporary database/location.
- Restore verification should check that:
  - database restore succeeds,
  - migrations/schema version are understood,
  - raw artifact pointers resolve,
  - hashes match for sampled or all artifacts according to policy,
  - core read flows such as project list, checkpoint, governed memory recall, and bounded search can run.

## Not mandatory in v1

- PITR/WAL archiving.
- Hot standby database.
- Multi-region or cloud-enterprise backup architecture.
- Object storage as a required raw artifact backend.

These are future hardening options if AMP becomes more critical or data volume requires them.

## Consequences

- Backup/restore becomes part of v1 quality, not an afterthought.
- Implementation must include backup commands or jobs and restore verification commands.
- Raw artifact storage cannot be designed as an untracked folder; it needs manifests and hash checks.
- The future second-server backup path is part of the architecture even if the first deployment stores backups on the AMP server.
- Backup policy must not expose raw memory, secrets, provider keys, or raw artifact content through ordinary logs.
- This ADR covers backup/restore health. Instance portability adds explicit environment remapping and secret/connector rebinding requirements; see [ADR-0038](ADR-0038-environment-discovery-and-portable-instance.md).

## Follow-up decisions

- Exact backup schedule and retention windows.
- Exact backup tool: `pg_dump` plus filesystem snapshot, `restic`, `borg`, `rclone`, or another implementation choice.
- Exact future second-server transport and path.
- Whether PITR/WAL archiving should be added after v1.
