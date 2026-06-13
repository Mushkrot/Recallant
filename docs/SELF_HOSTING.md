# Self-Hosting

Recallant is private by default. A normal install creates a local database, a private Workbench, and
a local CLI without exposing memory, raw artifacts, backups, or MCP over the public internet.

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

Use this when Recallant should run as a managed service:

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

For side-by-side installs, choose a different Postgres port, container name, and Compose project:

```bash
sudo ./scripts/install-recallant.sh --profile managed-server \
  --postgres-port 17432 \
  --postgres-container-name recallant-eval-postgres \
  --compose-project-name recallant-eval
```

## Installer Behavior

Dry-run:

- prints the install plan;
- exits before creating files;
- does not require Docker just to preview the plan;
- does not start services or write systemd units.

Confirmed install:

- checks Node.js, npm, Docker, and Docker Compose;
- creates a private env file if missing;
- creates data directories;
- installs dependencies when needed;
- builds TypeScript workspaces;
- installs the CLI wrapper;
- starts local Postgres;
- applies schema migrations;
- starts a service when the selected profile supports it.

## Verification

After install:

```bash
recallant doctor
```

After attaching and connecting a project:

```bash
recallant doctor --project-dir /path/to/project --require-capture
```

Recallant distinguishes:

- **configured:** project files or client settings exist;
- **capture active:** Recallant has observed real session/context/memory/checkpoint evidence.

## Private Deployment Profiles

Self-hosted installs often need local server inventories, private access providers, secret stores,
connector accounts, and service-specific runtime settings. Recallant should represent those as
deployment profiles, source records, capability references, and secret references. Public project
docs should describe the pattern; private environments provide the actual values.

Do not put raw credentials, private endpoint tokens, or customer data in a repository just so an
agent can find them. Store secret values in the environment or a secret store and let Recallant hold
only the safe reference.

## Rollback

Rollback should avoid deleting memory by accident.

- Stop services before changing ports or env values.
- Keep the env file unless you intentionally want a fresh instance.
- Back up the data directory before moving or reinstalling.
- Remove source project bindings through Recallant detach/forget workflows, not by deleting random
  database files.

For a local disposable test install, minimal cleanup is usually:

```bash
rm -f ~/.local/bin/recallant
rm -rf ~/.config/recallant ~/.local/share/recallant ~/.local/recallant
```

## Security Defaults

- HTTP defaults to private bind behavior.
- MCP is local stdio by default.
- Public exposure requires explicit deployment work and external auth.
- Secrets stay in env files or secret stores, not memory records.
- Paid API use, destructive actions, public exposure, connector binding, and global rule changes are
  confirmation-gated.
