# Quickstart

Install Recallant on a local self-hosted machine and make one project agent-ready.

This quickstart is for a machine that should run its own local Recallant storage stack. It may
require Docker/Postgres. It is not the path for connecting a workstation project to an existing
central Recallant server.

## 1. Install Local Recallant

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
```

That command installs the Recallant CLI and prepares private local storage for a single-user
self-host evaluation.

Preview the install plan first:

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash -s -- --dry-run
```

Advanced preview from a checkout:

```bash
git clone https://github.com/Mushkrot/Recallant.git recallant
cd recallant
./scripts/install-recallant.sh --dry-run --profile single-user
```

Verify the CLI:

```bash
recallant --version
# recallant 0.1.0-dev.0+<git-sha>
```

`recallant --version` reports the CLI package version with git build metadata when installed from a
checkout. It should not report `recallant 0.0.0`. The repository root package version is a
monorepo/workspace placeholder and is not the installed CLI version.

## 2. Make A Project Agent-Ready

From anywhere:

```bash
recallant connect /path/to/project
```

`recallant connect` is the universal beginner command for both local self-host projects and projects
that should connect to an existing central Recallant server. With reachable local storage, `connect`
runs the local onboarding flow. Without local storage, it asks for an existing central Recallant
server URL or lets the owner choose local storage. Automation can provide the server URL up front:

```bash
recallant connect /path/to/project --server-url https://memory.example.com
```

The explicit local command remains available for contributors and debugging:

```bash
recallant onboard /path/to/project
```

The one-command flow checks storage readiness, offers local single-user storage setup when needed,
attaches the project, analyzes documentation posture, prepares thin local agent configuration for
Codex, installs local hooks when supported, proves capture and recall, and prints the private
Workbench outcome. Advanced flags can opt out of those defaults, but they are not part of the
beginner path.

Before changing project files, onboarding also checks version-control safety. If Git is available
but the project is not a usable Git work tree, onboarding offers to initialize Git first or continue
with Recallant local backups only. In approved automation, `--yes` may initialize Git, but Recallant
does not stage or commit project files, secrets, or data automatically.

Expected success:

- `Capture active: yes` after context read, memory write, checkpoint, and recall proof are present;
- `Embedding recovery: current` or a bounded recovery/waiting status when local embeddings are
  catching up;
- a concise documentation posture summary: `Documentation posture: empty | healthy |
  needs_attention | risky`, followed by `Found:` and `Workbench:` lines that summarize what was
  discovered and what to review next;
- a Workbench link with private/auth-required posture;
- project visibility and review queue status.

Maintainers can run the public quickstart smoke to exercise this same path in temporary clean
directories:

```bash
npm run public-quickstart:smoke
```

That smoke prints an `acceptance_report` for the beginner path. A release-ready run means:

- `status: "pass"`: onboarding, Codex MCP config, hook kit, capture-active doctor, context pack
  recall, checkpoint fallback, Workbench navigation, embedding baseline, and public UI readiness
  fixtures all passed;
- `status: "pass_with_warnings"`: no blocking failure occurred, but a recoverable condition such as
  pending local embeddings needs attention;
- `status: "fail"`: at least one required proof is missing, so the one-command path is not ready.

## Remote Existing-Server Setup

Do not use the local self-host installer when the goal is to connect a project on this workstation
to an existing Recallant server. That remote path must not require local Docker, Postgres,
`RECALLANT_DATABASE_URL`, internal server paths, raw artifacts, backups, or provider secrets.

Recallant has a first authenticated remote MCP/bridge slice and a remote client bootstrap that does
not install local storage. The beginner remote existing-server setup is one universal command from
the external project folder:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

If the Recallant CLI is already installed on the workstation, use the same universal command:

```bash
recallant connect .
```

When it asks for the central server URL, enter `https://memory.example.com`. For automation, pass
`--server-url https://memory.example.com`. This works even when `recallant` is missing or old on the
external machine. It starts a device-style pairing request, asks the owner to approve the project
through the protected central server, then writes scoped remote MCP client config, a non-secret
consent receipt, and thin agent-ready files locally. See
[`docs/REMOTE_CONNECT_PLAN.md`](REMOTE_CONNECT_PLAN.md).

On the first approved connect from a workstation, the flow registers a local trusted-device key.
Later projects from the same workstation can use signed device challenges through the same
`curl .../connect | bash` / `recallant connect-cloud` path instead of asking for another
Cloudflare email-code browser approval. The project credential is stored in the user's local
Recallant credential store; generated project config contains a credential reference, not the raw
secret.

Expected remote readiness:

- `recallant connect . --server-url https://memory.example.com` or `recallant connect-cloud .`
  creates or safely upserts the thin `README.md`, `AGENTS.md`, and `PROJECT_LOG.md` agent-ready
  surfaces by default, while preserving existing project docs and avoiding local storage setup;
- `recallant agent-start --format json` reports `mode: "remote_mcp_ready"`;
- the same JSON includes a bounded `readiness_contract`; before proof its primary state remains
  `configured`;
- the same JSON includes a `startup_contract` with direct MCP calls and CLI fallback commands;
- the same JSON reports `recommended_next_call: "memory_get_context_pack"` and
  `recommended_next_proof_call: "memory_create_agent_memory"`;
- local `recallant doctor --project-dir .` reports `remote-ready, local storage not attached`
  instead of treating the remote-only project as a broken local attach;
- session/context readiness is proven by `memory_start_session` plus `memory_get_context_pack`, or
  by `recallant remote-doctor --capture-proof`;
- a checkpoint can be written and read back with `memory_set_checkpoint` and
  `memory_get_checkpoint`;
- `memory_set_checkpoint` remains state-only; use `memory_agent_checkpoint` when the checkpoint
  should also become searchable governed checkpoint memory;
- governed semantic memory is proven separately by creating a small non-secret memory through
  `memory_create_agent_memory` and recalling it through `memory_recall_agent_memories`.
- after `recallant remote-doctor --semantic-proof`, rerun `recallant agent-start --format json`; it
  should read persisted remote readiness evidence and report `semantic_memory_ready` without implying
  `capture_active`.

Do not treat a checkpoint-only readback as semantic recall proof. Do not run local `attach
--confirm` on a remote workstation unless the operator explicitly wants the local-storage attach
path instead of the scoped remote MCP path.

For baseline parity, `memory_set_checkpoint` remains state-only. Use `memory_closeout` or
`recallant agent-closeout` for normal closeout. Use `memory_agent_checkpoint` or
`recallant agent-checkpoint` only when the checkpoint itself should become searchable governed
checkpoint memory.

For headless servers or CI-like hosts, use a short-lived one-time bootstrap token created from a
protected admin/human surface:

```bash
recallant connect-cloud . --server-url https://memory.example.com --bootstrap-token <one-time-token>
```

Bootstrap tokens approve only the remote connect request for scoped MCP access. They do not grant
Workbench, admin, credential-management, backup, provider, raw-artifact, database, or browser-session
access.

Advanced/admin fallback: from the central Recallant server, a maintainer can still generate a
one-time invite for automation, pre-known projects, or directed access:

```bash
recallant invite /path/to/project --server-url https://memory.example.com
```

The output contains the one-time command the remote computer needs. Run it from the remote project
folder:

```bash
curl -fsSL https://memory.example.com/j/<one-time-invite-token> | bash
```

The invite is short-lived and one-time. It is not the primary beginner remote UX. The invite
bootstrap redeems it for a scoped remote MCP credential, installs only the remote bridge CLI, writes
project-local client config, and runs `remote-doctor` with session/context readiness proof. Strict
semantic proof is available with `recallant remote-doctor --semantic-proof`, which creates and
recalls one synthetic governed diagnostic marker. The bootstrap does not require local Docker,
Postgres, `RECALLANT_DATABASE_URL`, internal server paths, raw artifacts, backups, or provider
secrets. The acceptance proof command after bootstrap is:

```bash
recallant remote-acceptance \
  --project-dir . \
  --capture-proof
```

That acceptance command reads the scoped remote connection from the project-local client config
written by bootstrap, then writes redacted evidence for bootstrap, remote-doctor, remote MCP
session/context/write/checkpoint/recall, next-session recall, and forbidden local-artifact checks.
External-host rehearsal outcomes should be published only as redacted summaries, without
owner-specific device names, project paths, trace ids, raw evidence ids, or private topology. Keep
invite provisioning operator-led while universal connect remains the beginner remote command.

For strict Capture/Recall Acceptance, validate that evidence on the central Recallant server:

```bash
recallant remote-acceptance validate-live --evidence recallant-external-evidence/<run-id>.evidence.json
```

That second server-side check proves Workbench visibility and redacted audit rows without giving the
external workstation database or Workbench/admin access. A separate written report file is optional,
not required for continuing development after this proof passes.

If you accidentally started the local self-host installer while testing remote setup, stop and clean
up the local install artifacts before retrying. A failed install that stopped before onboarding
usually did not change the target project folder; check for `.recallant`, `.codex/config.toml`,
`AGENTS.md`, and `PROJECT_LOG.md` before deleting anything. Local install rollback guidance is in
[Self-Hosting](SELF_HOSTING.md#rollback).

If you only need to retry remote bootstrap for this project, remove only the remote client entry:

```bash
recallant remote-cleanup --project-dir .
recallant remote-cleanup --project-dir . --confirm
```

That command preserves source files, `.recallant`, Docker/Postgres, central Recallant records, and
unrelated client settings. To also remove the local `recallant` CLI wrapper installed for remote
bootstrap, add `--remove-cli-wrapper` to the confirmed command.

## 3. If Onboarding Stops

If storage is missing in an interactive terminal, onboarding asks whether to set up local single-user
storage before it touches the project. If the user declines, the environment is non-interactive, or
storage remains unreachable, onboarding reports `storage_blocked` and explains the setup choice.
Local offline spool is a fail-soft capture fallback, not completed onboarding.

If version-control safety needs a decision, onboarding stops before project writes and offers a
plain choice: initialize Git first, install Git if it is missing, or explicitly continue without Git.

If the project looks production-sensitive, onboarding shows the project path, risk reason, planned
writes, backup behavior, import/review behavior, and a continue/cancel prompt before it changes
files. Use `--yes` only in automation that already approved the plan.

## 4. Open The Workbench

The onboarding output includes the private Workbench URL when review state is available. The
Workbench is used to review memories, rules, source context, capture status, migration imports, and
safety gates. When documentation posture needs review, the Workbench shows a documentation strategy
surface with four choices: keep current docs and add a Recallant layer, canonicalize docs for a
Recallant-aware workflow, create starter docs, or discuss first. This surface helps the owner choose
the next documentation posture. Empty projects may receive starter docs during the confirmed
`recallant connect <project>` local onboarding write step. Existing-doc canonicalization and broader
doc rewriting remain confirmed Workbench workflows.

The Workbench and startup context packs also show a minimal canon/capability context layer:
environment facts, capability references, secret reference names, server canon link status, and a
documentation authority map. These are guidance and provenance for agents. They do not activate
connectors, reveal secret values, or turn recalled text into binding rules.

The Workbench also has an Audit view for the system activity ledger. It summarizes redacted activity
rows, failures, skipped operations, slow operations, capture/model health, and recent timeline rows
for the current project. The Audit view is for owner diagnosis, not public observability: request
bodies, auth headers, cookies, raw environment values, provider keys, and database URLs are not
shown.

Maintainers can get the same report from the CLI:

```bash
recallant audit --project-dir /path/to/project
```

Useful filters include `--since`, `--until`, `--surface`, `--status`, `--slow-ms`, `--limit`, and
`--format json`. The default report window is bounded so an accidental command does not dump the
whole system history.

## 5. Clean Up Or Reset A Test Project

Recallant has separate cleanup levels so a test run does not turn into accidental data loss.

To remove a project from active Recallant views and search without deleting Recallant records,
preview detach first:

```bash
recallant project-sanitize --project-id <project-id> --mode detach --dry-run
```

Then confirm only after checking the target. Detach closes active Recallant sessions and hides the
project from normal recall, but it does not physically delete Recallant database records.

To start over from a clean Recallant slate for a disposable or wrongly attached project, use purge
mode. Dry-run is still the default:

```bash
recallant project-sanitize --project-id <project-id> --mode purge --dry-run
```

The dry-run prints a receipt with `target`, `database_action`, `local_action`,
`retained_governance_receipt`, and `cleanup_scope`. The `target` block names whether the request
came from `--project-id`, `--project-dir`, or orphan local artifacts, and `cleanup_scope` must say
this is not Recallant product-repo cleanup. Confirmed purge requires the exact token printed in the
dry-run:

```bash
recallant project-sanitize --project-id <project-id> --mode purge --confirm-token "<token>"
```

If local project metadata is stale, Recallant does not stop at the stale id. The dry-run reports the
stale `project_id`, resolves the current managed project by path when it can do so safely, and
prints the confirmation token for the resolved project. Review that target-resolution block before
confirming purge.

If the Recallant database no longer has a matching project but local Recallant bootstrap artifacts
remain, use the explicit local-only cleanup path. It is also dry-run first:

```bash
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --dry-run
```

After reviewing the planned local changes, confirm only the local Recallant artifact cleanup:

```bash
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --confirm
```

That local-only path must report `writes_database: false`; it is not a database purge.

Project sanitization never deletes source files, secrets, downloads, or arbitrary project data. When
local disconnect is enabled, Recallant removes or updates only Recallant-generated artifacts such as
`.recallant/` pointer files, generated hooks, offline spool files, Recallant MCP config, and
generated bootstrap sections. If a previous file can only be restored from a redacted backup,
Recallant reports that limitation instead of guessing.

Project purge also accounts for the system activity ledger. Project-scoped memory/capture records
are removed according to the dry-run plan, while ledger rows are retained only as de-identified
governance evidence with project/session identity removed. The receipt calls this out so an owner
can tell the difference between content removal and auditability retention.

## What Gets Written

Project attach may create small local pointer/config files such as `.recallant/config`,
client-specific MCP config such as `.codex/config.toml`, `AGENTS.md`, and `PROJECT_LOG.md`.
Durable memory lives in Recallant, not in those bootstrap files.

When onboarding finds no project docs, it may also create starter docs. The base starter set is
`README.md`, `AGENTS.md`, and `PROJECT_LOG.md`. Service or app projects may also get runbook and
architecture docs; product or roadmap projects may get status and decision docs; library or package
projects may get an API or usage surface. Starter docs are not copied old handoffs, and onboarding
must not overwrite existing target files.

`AGENTS.md` should route future agents into Recallant. `PROJECT_LOG.md` is a compact
fallback/checkpoint file. Old handoffs, long history, source notes, and runbook details should be
imported as source-linked evidence or reviewed memories rather than copied into startup context.
Use `recallant discover --dry-run --project-dir .` before migrating an existing project. The
inventory is read-only, classifies safe documentation and risky paths, prints secret references by
name only, and produces a review-first migration plan. Writes happen only after owner approval:
remote-only projects use governed MCP memory creation plus recall verification, while server-local
projects use explicit imports or guided attach confirmation. Update checkpoint state after a safe
approved marker recalls successfully.
The documentation posture summary is stored in Recallant and appears in later context packs so a
new agent can see whether the project is already documented well, needs canon links, or should be
reviewed before docs are rewritten.

## Next

- [Agent-ready projects](AGENT_READY_PROJECTS.md)
- [Client setup](CLIENT_SETUP.md)
- [Self-hosting](SELF_HOSTING.md)
- [Security](SECURITY.md)

## Advanced / Debug CLI

Maintainers and automation can still use lower-level commands such as attach, connect, doctor,
agent capture, audit, demo capture, and ask when they need explicit control. See
[Client setup](CLIENT_SETUP.md) for that advanced path. These commands are not required for the
beginner quickstart above.
