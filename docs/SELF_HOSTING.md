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

## Onboarding Storage Readiness

`recallant onboard <project>` checks storage before it changes project files. If
`RECALLANT_DATABASE_URL` is already reachable, onboarding reuses it. If that variable is not set,
the CLI loads the default single-user env file when it exists.

In an interactive terminal, missing storage offers to run the single-user install profile before
project files are touched. Non-interactive runs, explicit private env-file runs, declined setup, or
unreachable storage block beginner onboarding with `storage_blocked` and a short setup choice. Local
offline spool remains a fail-soft capture fallback, but it is not treated as completed onboarding
because Recallant cannot prove recall or Workbench review without storage.

## Verification

After install:

```bash
recallant doctor
```

For production service profiles, configure the CLI runtime and the service manager to use the same
private storage profile. `recallant doctor --format json` exposes a redacted
`service_env_profile` check when `RECALLANT_SERVICE_ENV_FILE` is set. It compares safe database
components and credential equality without printing raw passwords or full database URLs. Treat a
`mismatch` status as a deployment-readiness warning before sending users to the public Workbench.

For a public Workbench, keep the Recallant origin bound to a private localhost listener and put the
public hostname behind an authenticated access provider. `recallant doctor --format json` reports
`production_readiness.public_workbench_readiness` when a public Workbench URL, private origin URL, or
Cloudflare Access profile is configured. A ready public UI means the private origin responds with an
auth-required Workbench response and edge auth is required at the public access layer; an anonymous
origin response or disabled edge auth is not public-ready.

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
wrapper, and a fresh quickstart path in isolated temporary directories. The quickstart smoke runs
the unified onboarding proof, including capture, readiness, recall, and Workbench outcome checks.
Its `acceptance_report` is the release gate for the one-command user story: the report must be
`pass`, or `pass_with_warnings` only when every warning is explicitly recoverable, such as local
embeddings waiting for the configured model to come back online.

Optional live-host acceptance should repeat the same story against one disposable project:

1. Run `recallant onboard /path/to/disposable-project`.
2. Confirm the output reports capture evidence, recall proof, and a private Workbench URL.
3. Open the public Workbench URL through the configured access provider and verify the project
   chooser shows the disposable project before opening its selected project view.
4. Run `recallant doctor --project-dir /path/to/disposable-project --require-capture --format json`
   and treat missing capture, service-env mismatch, origin-not-private, disabled edge auth, or
   unexpected pending embeddings as release blockers unless the report classifies them as
   recoverable warnings.

The rollback smoke validates dry-run behavior, confirmed cleanup of marked disposable artifacts, and
refusal to remove unmarked data directories:

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

## Model Routing

Recallant is local-first. The local model route points at Ollama through
`RECALLANT_OLLAMA_URL`, and `RECALLANT_EXPECTED_OLLAMA_MODELS` should list only models that are
expected to be available from that local Ollama service.

Chunk embeddings are fail-soft during local Ollama cold starts. Recallant retries transient Ollama
embedding failures with bounded attempts and per-attempt timeouts, then leaves chunks `pending` if
Ollama remains unavailable. The event and chunk stay recorded, and `model_calls.metadata` records the
attempt count, retry count, transient failures, and final `UNAVAILABLE` outcome for diagnosis.
When Ollama becomes healthy again, recover pending project embeddings without manual SQL:

```bash
recallant recover-embeddings --project-dir /path/to/project --limit 50
```

Use `--dry-run` to preview the bounded project-scoped batch. `recallant doctor --format json`
reports `pending_embeddings.pending_chunks` and the recommended recovery command.

Optional tuning variables:

- `RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS` defaults to 3 and is capped at 5.
- `RECALLANT_OLLAMA_EMBED_TIMEOUT_MS` defaults to 30000 and is capped at 120000 per attempt.
- `RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS` defaults to 250 and is capped at 5000.
- `RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS` defaults to 1000 and is capped at 10000.

Do not add Ollama cloud tags such as `*:cloud` to the expected local model list. They are external
model routes, even when they are launched through the Ollama CLI. Treat cloud or paid model use as a
governed capability: it must be explicit, cost-aware, and approval-gated instead of becoming a
silent fallback from local inference.

Maintainers may still use one-off agent launches such as `ollama launch codex`,
`ollama launch codex-app`, or `ollama launch cline` with a cloud model for complex development work.
That is an operator decision outside automatic Recallant routing unless the project has an approved
paid/external model policy.

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

Rollback should avoid deleting memory by accident. Project lifecycle cleanup is separate from
install rollback:

- Stop services before changing ports or env values.
- Keep the env file unless you intentionally want a fresh instance.
- Back up the data directory before moving or reinstalling.
- Remove source project bindings through Recallant project sanitization workflows, not by deleting
  random database files.

For a project you only want to hide from active recall, preview detach:

```bash
recallant project-sanitize --project-id <project-id> --mode detach --dry-run
```

For a disposable or wrongly attached project that needs a clean Recallant slate, preview purge:

```bash
recallant project-sanitize --project-id <project-id> --mode purge --dry-run
```

Confirmed purge requires the exact confirmation token printed by the dry-run. It deletes
project-scoped Recallant records, disconnects Recallant-generated local artifacts when requested,
and writes a redacted receipt. It must not delete source files, secrets, downloads, or arbitrary
project data.

If `.recallant/config` contains an old project id, the sanitize dry-run reports that stale id and,
when the path matches a current managed project for the same developer, resolves the active project
by path. Confirmed purge still requires the exact token for the resolved project.

If the database project has already been removed but local Recallant artifacts remain, use the
explicit local-only cleanup opt-in:

```bash
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --dry-run
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --confirm
```

The local-only cleanup path reports `writes_database: false` and removes only Recallant-generated
local artifacts such as `.recallant/config`, session pointers, generated hooks, offline spool files,
MCP config, and generated bootstrap sections.

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
