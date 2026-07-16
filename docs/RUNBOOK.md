# Operations Runbook

This runbook is the public, deployment-neutral operating path for a managed Recallant instance. Keep
real credentials, private hostnames, concrete environment paths, alert receivers, and owner-specific
topology in the protected deployment layer.

## Routine Health Check

Start with the installed artifact and the product-level readiness report:

```bash
recallant --version
systemctl is-active <recallant-service>
recallant doctor --project-dir <project> --format json
```

A production-ready result requires more than a running process. Confirm that
`production_readiness.ready` is `true`, the service runtime is active and healthy, the private origin
requires authentication, and backup plus restore-rehearsal evidence is successful and fresh. Use
the reason and operator-action fields from `doctor`; do not edit readiness evidence to force a pass.

When local Ollama routes are configured, `ollama ps` shows which models are loaded. Recallant
embedding requests ask Ollama to keep the embedding model resident, but the runtime may still evict
it under resource pressure. A later embedding request should load it again with the same residency
request.

## Deploy A Checkout Change

An approved runtime change is complete only after the managed service consumes and proves the new
artifact:

```bash
npm run format:check
npm run lint
npm run build
./scripts/install-recallant-cli.sh --user
systemctl restart <recallant-service>
systemctl is-active <recallant-service>
recallant doctor --project-dir <project> --format json
```

Run the focused consumer smoke for the changed surface, then the applicable product and public
gates. A commit or green local build without service restart and live verification is a checkpoint,
not a completed managed deployment.

## Backup And Restore Verification

For production readiness, use the scheduled native PostgreSQL backup job described in
[Self-hosting](SELF_HOSTING.md), not logical snapshot verification alone.

```bash
systemctl is-enabled recallant-backup.timer
systemctl is-active recallant-backup.timer
systemctl status recallant-backup.service --no-pager
recallant doctor --project-dir <project> --format json
```

The latest job must report a successful zero exit status, a fresh custom-format artifact with a
verified hash, and a fresh isolated restore rehearsal that leaves production unchanged. A stale or
failed backup, malformed evidence, skipped restore, or unsuccessful cleanup keeps readiness red.

## Incident Triage

Use the first failing `doctor` reason to choose the narrowest repair:

| Signal | First action |
|---|---|
| `service_inactive` or `service_disabled` | Inspect the service status and recent journal before restarting. |
| `health_failed` | Check the private health endpoint and the service journal. |
| `public_bad_gateway` | Verify the private origin before changing the authenticated edge route. |
| `public_anonymous_access` | Restore authentication; do not expose the origin directly. |
| backup job, artifact, or restore freshness failure | Repair and run one real native backup plus isolated restore rehearsal. |
| pending embeddings | Confirm the configured local model runtime, then run bounded project-scoped recovery. |

For project-scoped activity evidence, use the redacted audit surface:

```bash
recallant audit --project-dir <project> --status error --format json
```

Do not paste raw environment files, tokens, database URLs, request bodies, customer data, backups,
or private deployment notes into issues, public logs, or memory records.

## Rollback

Preserve memory and configuration by default. Before rollback, capture the current readiness result,
confirm a fresh backup and restore rehearsal, and identify the last known-good artifact. Stop only
the affected managed service, restore the known-good application artifact or package version, then
restart and repeat the routine health check and focused smoke.

Installation cleanup is separate from project lifecycle cleanup. Preview the repository-provided
rollback helper before any confirmed action:

```bash
./scripts/rollback-recallant-install.sh --dry-run <profile-options>
```

Use `recallant project-sanitize --dry-run` for project detach or purge planning. Never delete source
files, arbitrary database files, or the data directory as an application rollback shortcut.

## Escalation And Records

If a repair changes exposure, authentication, firewall policy, secret handling, storage topology, or
an unrelated workload, consult the protected deployment/security canon first. Record only redacted
results in public reports. The current product maturity and remaining release gates are summarized in
[Status](STATUS.md); detailed contract evidence remains in
[Product Contract Status](CONTRACT_STATUS.md).
