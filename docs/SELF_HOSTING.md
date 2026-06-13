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

Maintainers can also run the public clean-host smoke before release work:

```bash
npm run public-clean-host:smoke
npm run public-quickstart:smoke
```

Those smokes validate install-plan dry-runs, profile defaults, override handling, the installed CLI
wrapper, and a fresh quickstart path in isolated temporary directories. The quickstart smoke installs
the wrapper, runs `recallant onboard --client codex --install-local-hooks --verify`, proves
`doctor --require-capture`, and checks `ask` recall. The rollback smoke validates dry-run behavior,
confirmed cleanup of marked disposable artifacts, and refusal to remove unmarked data directories:

```bash
npm run public-install-rollback:smoke
```

Set `RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1` on that smoke to exercise a full disposable
managed-install rollback cycle.

For an opt-in Docker-backed managed install smoke:

```bash
RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 npm run public-managed-install:smoke
```

The managed install smoke intentionally starts local infrastructure in temporary directories, proves
Postgres reachability, attaches a project, writes capture evidence, verifies `doctor
--require-capture`, and removes the temporary container afterward. Independent-host validation is
still recommended before a release-candidate tag.

## Private Deployment Profiles

Self-hosted installs often need local server inventories, private access providers, secret stores,
connector accounts, and service-specific runtime settings. Recallant should represent those as
deployment profiles, source records, capability references, and secret references. Public project
docs should describe the pattern; private environments provide the actual values.

Public defaults are intentionally generic. Private deployments can provide local values through
environment variables such as:

- `RECALLANT_SERVER_INVENTORY_FILE`
- `RECALLANT_SECURITY_BASELINE_PATH`
- `RECALLANT_PRODUCTION_PROJECT_PATH`
- `RECALLANT_LATEST_BACKUP_VERIFICATION_FILE`
- `RECALLANT_LATEST_BACKUP_MANIFEST`

Those variables let `recallant doctor` and production-readiness checks reference a private
deployment profile without baking owner-specific paths into public code or docs.

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

For managed disposable installs, prefer the rollback helper. It prints a dry-run plan by default and
requires an explicit confirmation token before removing selected artifacts:

```bash
./scripts/rollback-recallant-install.sh --dry-run \
  --env-file /etc/recallant/recallant.env \
  --data-dir /var/lib/recallant \
  --install-cli-prefix /usr/local/bin \
  --postgres-container-name recallant-postgres \
  --remove-env-file \
  --remove-data-dir \
  --remove-cli \
  --remove-container
```

Confirmed data-dir removal requires the install marker created by the installer. Without that marker,
the helper refuses to remove the directory unless a maintainer intentionally uses the manual recovery
override.

## Security Defaults

- HTTP defaults to private bind behavior.
- MCP is local stdio by default.
- Public exposure requires explicit deployment work and external auth.
- Secrets stay in env files or secret stores, not memory records.
- Paid API use, destructive actions, public exposure, connector binding, and global rule changes are
  confirmation-gated.
