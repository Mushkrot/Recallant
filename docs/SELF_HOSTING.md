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

## Change Deployment Policy

For an active managed-service checkout, ordinary in-scope code and runtime changes follow one
delivery sequence: build the checkout, install the artifact consumed by the service, restart the
managed service, verify that it is active and healthy, and run the focused consumer smoke. This is
the default deployment policy for approved product changes; a separate owner confirmation is only
needed for destructive, out-of-scope, or potentially unrelated-workload interruptions.

```bash
npm run build
./scripts/install-recallant-cli.sh --user
systemctl restart <recallant-service>
systemctl is-active <recallant-service>
recallant doctor --project-dir <project> --format json
```

Keep concrete service names, environment paths, database URLs, credentials, and private topology in
the deployment layer rather than in this public document.

## Onboarding Storage Readiness

`recallant connect <project>` checks storage before it changes project files. If
`RECALLANT_DATABASE_URL` is already reachable, onboarding reuses it. If that variable is not set,
the installed CLI wrapper loads its configured env file when the server installer provided one, or
the default single-user env file when it exists. After a server or single-user install, onboarding a
project on the same machine should therefore stay one command:

```bash
recallant connect /path/to/project
```

The explicit `recallant onboard <project>` command is still available as the lower-level local path,
but it is not the primary beginner entry point.

In an interactive terminal, missing storage offers to run the single-user install profile before
project files are touched. Non-interactive runs, explicit private env-file runs, declined setup, or
unreachable storage block beginner onboarding with `storage_blocked` and a short setup choice. Local
offline spool remains a fail-soft capture fallback, but it is not treated as completed onboarding
because Recallant cannot prove recall or Workbench review without storage.

## Verification

After install:

```bash
recallant --version
recallant doctor
```

`recallant --version` should print the CLI package version with git build metadata, for example
`recallant 0.1.0-dev.0+<git-sha>` from a checkout install. If it reports `recallant 0.0.0`, refresh
the installed CLI wrapper before treating the host as current. The root monorepo package version is
not the installed CLI version.

For production service profiles, configure the CLI runtime and the service manager to use the same
private storage profile. `recallant doctor --format json` exposes a redacted
`service_env_profile` check when `RECALLANT_SERVICE_ENV_FILE` is set. It compares safe database
components and credential equality without printing raw passwords or full database URLs. Treat a
`mismatch` status as a deployment-readiness warning before sending users to the public Workbench.
When the service env file is configured directly or discoverable from the local service manager,
production-readiness output reports only safe metadata: whether the file is configured, whether it
exists, which public/runtime keys are present, and whether the CLI and service profiles align.

For a public Workbench, keep the Recallant origin bound to a private localhost listener and put the
public hostname behind an authenticated access provider. `recallant doctor --format json` reports
`production_readiness.public_workbench_readiness` when a public Workbench URL, private origin URL, or
Cloudflare Access profile is configured. A ready public UI means the private origin responds with an
auth-required Workbench response and edge auth is required at the public access layer; an anonymous
origin response or disabled edge auth is not public-ready.

Public Workbench readiness does not imply remote project access. The current agent path remains local
stdio MCP on an installed host. Supporting projects from another server or workstation through one
central Recallant instance is planned remote-client work and must use authenticated agent access
without exposing Postgres, backups, raw artifacts, or unauthenticated MCP/admin routes.

`recallant doctor --format json` also reports
`production_readiness.service_runtime` when production service signals are available from the
service env profile, explicit runtime overrides, or the local service manager. The runtime readiness
object is designed to distinguish the common public-UI failure modes without exposing private
deployment details:

- `service_inactive` or `service_disabled`: the service is not running or will not start on boot;
- `restart_policy_disabled`: the service manager will not restart Recallant after a crash;
- `wrong_bind_host`: the origin is not bound to a private listener;
- `service_env_missing`: the configured service env file is absent or unreadable;
- `health_failed`: the private `/health` endpoint returns an error;
- `public_bad_gateway`: the public route is returning an upstream gateway failure;
- `public_anonymous_access`: the Workbench is reachable without the expected access protection;
- `ready`: the service is active, private, healthy, and the public route requires authentication.

Access-provider redirects or HTTP authentication challenges are classified as public-route success.
A browser-visible gateway error or anonymous Workbench response is not.

Production readiness requires evidence from the complete scheduled backup path, not only an enabled
timer. The production job runs `scripts/recallant-production-backup.sh`, creates a PostgreSQL custom
format artifact with the version-matched `pg_dump` inside the configured Postgres container, checks
its SHA-256, restores it into a randomly named disposable database with `pg_restore --exit-on-error`,
compares every public table and row count, then removes the disposable database. The logical
`recallant backup-verify` command checks logical snapshot integrity only and reports
`restore_verification: not_performed`; it cannot satisfy production readiness.

Configure `RECALLANT_LATEST_BACKUP_VERIFICATION_FILE` to the production job's
`latest-verification.json`. Doctor requires all of the following:

- `recallant-backup.timer` is enabled;
- the latest `recallant-backup.service` result is `success`, `ExecMainStatus` is zero, and its
  completion timestamp is valid and recent;
- `backup_kind` is `postgresql_custom`, the artifact hash was verified, and the artifact timestamp
  is fresh;
- the disposable restore reports `restore_verification: passed`, matching table inventories and row
  counts, an unchanged production fingerprint, `production_overwritten: false`, and successful
  disposable-database cleanup;
- both timestamps are within their independent freshness limits.

The default limits are 30 hours. Override them with positive finite values up to 8760 hours:

```bash
RECALLANT_BACKUP_MAX_AGE_HOURS=30
RECALLANT_RESTORE_VERIFICATION_MAX_AGE_HOURS=30
```

`recallant doctor --format json` reports `production_readiness.backup_timer`,
`production_readiness.backup_job`, and separate `backup` and `restore` freshness objects under
`production_readiness.latest_backup_verification`. Missing, malformed, future, stale, failed, legacy
status-only, logical-snapshot, or cleanup-unverified evidence fails closed with a reason code and
operator action. Repair the job and run one successful native backup/rehearsal before retrying
doctor; never edit the report to force readiness.

For Prometheus installations that collect node-exporter systemd metrics, load
`contrib/prometheus/recallant-backup.rules.yml`. Its portable `RecallantBackupFailed` alert fires
when `recallant-backup.service` remains failed for one minute. Configure routing and receivers only
in the protected deployment layer; do not add recipient, token, or private-origin details to the
public rule. Validate the rule before reload with:

```bash
promtool test rules contrib/prometheus/recallant-backup.rules.test.yml
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
wrapper, and a fresh quickstart path in isolated temporary directories. The quickstart smoke runs
the unified onboarding proof, including capture, readiness, recall, and Workbench outcome checks.
Its `acceptance_report` is the release gate for the one-command user story: the report must be
`pass`, or `pass_with_warnings` only when every warning is explicitly recoverable, such as local
embeddings waiting for the configured model to come back online.

Optional live-host acceptance repeats the same story against one disposable project without
hardcoding a maintainer's host or paths. The runner refuses to execute unless explicitly opted in:

```bash
RECALLANT_LIVE_ACCEPTANCE=1 \
RECALLANT_LIVE_PROJECT_DIR=/path/to/disposable-project \
RECALLANT_PUBLIC_WORKBENCH_URL=https://memory.example.com/review \
RECALLANT_WORKBENCH_ORIGIN_URL=http://127.0.0.1:3005/review \
RECALLANT_SERVICE_ENV_FILE=/path/to/private/recallant.env \
RECALLANT_CLOUDFLARE_MODE=enabled \
RECALLANT_CLOUDFLARE_EDGE_AUTH=required \
RECALLANT_LIVE_CLEANUP_MODE=purge-dry-run \
npm run live-acceptance
```

The `acceptance_report` covers public route auth, private origin auth posture, service-env
alignment, service runtime readiness, `recallant connect /path/to/project`, capture/recall proof,
Workbench project visibility, pending embedding recovery, and optional cleanup preview. It returns
`pass`, `pass_with_warnings`, or `fail`; public 502, anonymous origin, service-env mismatch, missing
capture, hidden project, and unrecovered pending embeddings are blocking failures. Output redacts
database URLs, tokens, session cookies, admin emails, and never prints raw environment contents.

Fixture coverage for this release gate is deterministic and safe for CI:

```bash
npm run live-acceptance:smoke
```

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

## System Activity Audits

Recallant keeps a redacted system activity ledger for owner diagnosis. It is intended to answer:
which project used Recallant, through which surface, what operation ran, whether it succeeded,
whether storage/model/capture paths were healthy, and which failures or slow operations need
attention.

Use the CLI report when debugging a host:

```bash
recallant audit --project-dir /path/to/project
recallant audit --project-dir /path/to/project --surface mcp --status error --format json
```

The report defaults to a bounded recent window and supports `--since`, `--until`, `--surface`,
`--status`, `--slow-ms`, and `--limit`. It includes summary counts, recent failures, slow
operations, top error codes, model-provider health, capture counts, pending/failed embeddings, and
timeline rows with traceable ids.

The private Workbench has the same project-scoped report in the Audit view. Keep that view behind
Workbench authentication; it should not be exposed as an anonymous monitoring endpoint.

Audit records are redacted by design. They do not store request bodies, auth headers, cookies, raw
secret values, raw database URLs, or full environment values. Health, favicon, robots, and similar
probe routes are intentionally skipped to keep the ledger useful instead of noisy.

Backups include `system_activity_events` together with the memory/capture tables, and
`recallant backup-verify` reports a system activity row count. Project purge does not silently erase
system history: the dry-run counts project-scoped ledger rows, and confirmed purge de-identifies
them by clearing project/session links while retaining a redacted governance trail.

## Model Routing

Recallant is local-first. The local model route points at Ollama through
`RECALLANT_OLLAMA_URL`, and `RECALLANT_EXPECTED_OLLAMA_MODELS` should list only models that are
expected to be available from that local Ollama service.

Chunk embeddings are fail-soft during local Ollama cold starts. Recallant retries transient Ollama
embedding failures with bounded attempts and per-attempt timeouts, then leaves chunks `pending` if
Ollama remains unavailable. The event and chunk stay recorded, capture/recall remains available, and
`model_calls.metadata` records the attempt count, retry count, transient failures, and final
`UNAVAILABLE` outcome for diagnosis.

The one-command onboarding verification path attempts a bounded, project-scoped pending-embedding
recovery pass after capture readiness is proven. Onboard output reports whether semantic embeddings
are current, were recovered, remain pending because the local model is unavailable, or still need a
later bounded retry. It must not claim semantic indexing is complete while chunks remain pending.

Advanced operators can still recover pending project embeddings without manual SQL:

```bash
recallant recover-embeddings --project-dir /path/to/project --limit 50
```

Use `--dry-run` to preview the bounded project-scoped batch. `recallant doctor --format json`
reports `pending_embeddings.pending_chunks`, latest failure, latest chunk-embedding attempt, and a
`pending_embeddings.recovery` object with project scope and default limit metadata.

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

Confirmed purge requires the exact confirmation token printed by the dry-run. The dry-run and
confirmed receipts include `target`, `database_action`, `local_action`,
`retained_governance_receipt`, and `cleanup_scope` blocks so operators can see whether the target
came from `--project-id`, `--project-dir`, stale local metadata, or orphan local artifacts. It
deletes project-scoped Recallant records, disconnects Recallant-generated local artifacts when
requested, and writes a redacted receipt. It must not delete source files, secrets, downloads, the
Recallant product repository, or arbitrary project data.

If `.recallant/config` contains an old project id, the sanitize dry-run reports that stale id and,
when the path matches a current managed project for the same developer, resolves the active project
by path. Confirmed purge still requires the exact token for the resolved project.

The lower-level `recallant local-cleanup` command uses the same safe target resolution after the
project is detached or sandbox-cleaned. A stale local project id should not block cleanup when the
current managed project can be resolved by path, but cleanup remains blocked while that resolved
project is still active.

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
