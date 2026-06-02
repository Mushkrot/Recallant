# Self-Hosting Recallant

Recallant is private by default. A normal install should create a local database, a private
Workbench, and a local CLI without exposing memory, raw artifacts, backups, or MCP over the public
internet.

## Profiles

### Single-user

Use this for a private workstation, a small personal server, or a first evaluation:

```bash
./scripts/install-recallant.sh --dry-run --profile single-user
./scripts/install-recallant.sh --profile single-user
```

Default locations:

```text
env file: ~/.config/recallant/recallant.env
data dir: ~/.local/share/recallant
CLI: ~/.local/bin/recallant
systemd: disabled by default
```

### Managed Linux server

Use this when Recallant is run as a managed service:

```bash
sudo ./scripts/install-recallant.sh --dry-run --profile managed-server
sudo ./scripts/install-recallant.sh --profile managed-server
```

Default locations:

```text
env file: /etc/recallant/recallant.env
data dir: /var/lib/recallant
CLI: /usr/local/bin/recallant
systemd: recallant.service when available
Postgres bind: 127.0.0.1:15432
Postgres container: recallant-postgres
Docker Compose project: recallant
```

For clean-host validation or side-by-side testing, use explicit Postgres isolation knobs:

```bash
sudo ./scripts/install-recallant.sh --profile managed-server \
  --postgres-port 17432 \
  --postgres-container-name recallant-clean-host-postgres \
  --compose-project-name recallant-clean-host
```

These values are written into the generated env file and passed through the production compose
wrapper so the database URL, Docker container name, bind port, and Compose project stay consistent.

Release-candidate managed install validation:

```bash
RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 npm run public-managed-install:smoke
```

This smoke starts Docker, uses temporary env/data/prefix paths, a unique Postgres container, a
unique Compose project, `--no-systemd`, and cleans up after itself. Run it only on a clean
non-owner host or an approved isolated VM/container.

### Owner-server compatibility profile

The `owner-server` profile is kept for the current owner's `/ai` production host and existing
operator workflow:

```bash
sudo ./scripts/install-recallant.sh --dry-run --profile owner-server
```

That profile uses owner-specific defaults documented in [OWNER_SERVER.md](OWNER_SERVER.md). It
should not be treated as the generic public install path.

## What The Installer Does

Dry-run:

- prints the install plan;
- exits before creating files;
- does not require Docker just to preview the plan;
- does not start services or write systemd units.

Confirmed install:

- checks Node.js, npm, Docker, and Docker Compose;
- creates the private env file if missing;
- creates the data directories;
- installs dependencies if needed;
- builds the TypeScript workspaces;
- installs the `recallant` CLI wrapper;
- starts the local Postgres service;
- applies the initial schema when needed;
- starts `recallant.service` when the profile uses systemd.

The selected profile paths are passed through the production compose wrapper and backup script.
`managed-server` therefore uses `/var/lib/recallant/postgres` for Postgres data and
`/var/lib/recallant/backups` for default backups unless overridden.

## Rollback And Recovery

The installer should be treated as reversible operational setup:

- Keep the env file. It contains the database password and stable owner/project ids.
- Back up the data directory before moving or reinstalling.
- Stop the service before changing ports or env values.
- Use `recallant backup-verify` on backup manifests before relying on them.
- Remove the CLI wrapper only after confirming no agents still depend on it.

Common managed-server rollback steps:

```bash
sudo systemctl stop recallant.service
sudo systemctl disable recallant.service
```

Database and data removal is intentionally not part of ordinary rollback. Memory deletion must go
through governed detach/forget workflows.

## Verification

After install:

```bash
recallant doctor
```

After attaching and connecting a project:

```bash
recallant doctor --project-dir /path/to/project --require-capture
```

The important distinction is:

- configured: Recallant files or client settings exist;
- capture active: Recallant has observed real session/context/memory/checkpoint evidence.

Do not claim a project is ready until capture is active.

## Security Defaults

- The HTTP server defaults to private bind behavior.
- Public bind requires an explicit opt-in environment variable.
- MCP is local stdio by default, not a public HTTP endpoint.
- Secrets and raw credentials must not be stored as memories.
- Paid API, public exposure, connector/account binding, destructive actions, and production service
  operations require policy gates and explicit confirmation.
