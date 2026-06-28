# Client Setup

Recallant connects to agents through local MCP stdio. The Workbench is for humans; agents normally
call `recallant mcp-server` locally.

Remote project access is a separate flow when an external workstation or server should connect to
an existing central Recallant server. A protected public Workbench URL lets humans review and manage
Recallant; it does not by itself make an external machine an agent client. Recallant now has a
first authenticated `POST /api/mcp`, DB-backed scoped remote MCP credentials, one-time remote onboarding
invites, a local stdio-to-HTTPS bridge command, and CLI-first remote doctor diagnostics. The
universal beginner target is a device-pairing command served by the central server:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

That command installs or updates only the remote client CLI, starts browser approval through the
protected central server, receives a scoped provisioning package, writes project-local remote MCP
config, and runs `remote-doctor`. The detailed implementation record and route contract are in
[`docs/REMOTE_CONNECT_PLAN.md`](REMOTE_CONNECT_PLAN.md). Server-generated one-time invites remain
supported for advanced/admin provisioning, automation, pre-known projects, and directed one-time
access, but they are not the universal first-run command.

The public remote contract surface is documented in [`docs/MCP_SPEC.md`](MCP_SPEC.md) and includes
transport, scope, header, and error contracts.

## Beginner Flow

For projects on a machine that already has a local Recallant install and storage, use onboarding:

```bash
recallant onboard <project>
```

The universal beginner command is:

```bash
recallant connect <project>
```

It routes to local onboarding when private storage is reachable. If local storage is missing, it
asks for an existing central Recallant server URL or lets the owner choose local storage. Automation
can provide the server URL up front:

```bash
recallant connect <project> --server-url https://memory.example.com
```

Onboarding defaults to the Codex beginner flow: attach, client connection, local hooks when
supported, capture proof, readiness proof, and recall proof. The project is not capture active until
context read, memory write, checkpoint, and recall evidence are present.

Interrupted sessions are reported as recovery context for the next agent. They do not erase current
capture-active evidence when the working loop has been proven again.

Do not use the local self-host installer or `recallant onboard <project>` as the first step for an
external workstation that should connect to an existing central Recallant server. That remote
existing-server path is separate and must not require local Docker, Postgres, `RECALLANT_DATABASE_URL`,
or internal server paths.

For a remote workstation, the beginner flow is:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

If the Recallant CLI is already installed on the workstation, use the same universal command:

```bash
recallant connect .
```

When it asks for the central server URL, enter `https://memory.example.com` or the bare host name
`memory.example.com`; Recallant normalizes bare public hosts to HTTPS. For automation, pass
`--server-url https://memory.example.com`. It works even when `recallant` is missing or old through
the `curl .../connect | bash` path. The remote machine starts a pending connection request and the
owner approves it in the protected browser flow. That first approval registers a local trusted-device
key on the workstation. Later projects from the same trusted workstation can reconnect with the same
`curl .../connect | bash` / `connect-cloud` path using signed device challenges instead of another
Cloudflare email-code browser approval.

For headless servers or CI-like hosts where no browser approval is practical, an administrator can
create a short-lived one-time bootstrap token through the protected central server API. The remote
host then runs:

```bash
recallant connect-cloud . --server-url https://memory.example.com --bootstrap-token <one-time-token>
```

Bootstrap tokens are one-time, hash/prefix stored on the server, expire quickly, and do not grant
Workbench, admin, credential-management, backup, provider, raw-artifact, or browser-session access.
They only approve the remote connect request enough for `/api/connect/poll` to return a scoped MCP
credential once.

Advanced/admin fallback: create a short-lived invite on the central Recallant server:

```bash
recallant invite /path/to/project --server-url https://memory.example.com
```

Then run the printed one-line command from the project folder on the remote workstation:

```bash
curl -fsSL https://memory.example.com/j/<one-time-invite-token> | bash
```

That invite command installs only the remote bridge client, writes project-local MCP config, redeems
a scoped credential, and runs `remote-doctor` without exposing Postgres, local storage credentials,
Workbench/admin auth, raw artifacts, backups, or provider secrets to the remote machine. It remains
useful for maintainers, automation, pre-known projects, and directed one-time access.

## Advanced Client Setup

Maintainers and automation can still use the lower-level client setup path when they need explicit
control over each step:

```bash
recallant attach .
recallant connect codex --project-dir .
recallant doctor --project-dir . --require-capture
```

Attach creates the memory space and small project-local pointers. Connect writes or prints the client
configuration. Doctor verifies whether the client has produced capture evidence.

Project-local files stay thin. The client setup should point agents to Recallant, not copy long
handoffs or private deployment details into prompt-visible files.

## Codex

Default target:

```bash
recallant connect codex --project-dir . --dry-run
recallant connect codex --project-dir .
```

To install the project-local fail-soft hook kit for Codex capture targets, run:

```bash
recallant connect codex --project-dir . --install-local-hooks --dry-run
recallant connect codex --project-dir . --install-local-hooks
```

After the MCP config and hook files already match, the same dry-run is a readiness check: JSON
output should report `connection_status: "mcp_and_hooks_ready"`,
`hook_status: "local_hook_kit_installed"`, and `writes_files: false`. It reports
`mcp_and_hooks_planned` only when the project-local config or hook kit would actually need changes.

Generated project-local Codex config:

```toml
[mcp_servers.recallant]
command = "recallant"
args = ["mcp-server"]
env = { RECALLANT_PROJECT_ID = "<project-id>", RECALLANT_DEVELOPER_ID = "<developer-id>" }
env_vars = ["RECALLANT_DATABASE_URL"]
```

Codex reads `.codex/config.toml` only for trusted projects, so onboarding writes the project-local
config and then the next Codex session can launch the Recallant MCP server automatically. If your
Codex build supports `codex mcp add`, global registration remains an advanced alternative rather
than the beginner path.

## Cursor

```bash
recallant connect cursor --project-dir . --dry-run
recallant connect cursor --project-dir .
```

Recallant merges a project-local MCP config while preserving existing servers.

## Claude Code

```bash
recallant connect claude-code --project-dir . --dry-run
recallant connect claude-code --project-dir .
```

Recallant writes a local MCP config that Claude Code can load from the project root.

## Windsurf And Generic MCP Clients

```bash
recallant connect generic --project-dir . --dry-run
recallant connect generic --project-dir .
```

Use the generated `mcpServers.recallant` block in any MCP client that accepts stdio server config.

## Remote Project Access

The remote client runtime is `recallant remote-bridge`: a stdio MCP bridge that forwards
`initialize`, `tools/list`, and `tools/call` over HTTPS to a central `POST /api/mcp` endpoint. It
uses a scoped remote MCP credential plus project, developer, and client scope. It does not require
`RECALLANT_DATABASE_URL` on the remote machine.

The universal remote connect flow lets the external workstation install only the Recallant remote
bridge CLI, request approval, write the project-local client config, and run `remote-doctor` with
one command:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

The person on the external workstation should not assemble `server-url`, credential, project id,
developer id, and client id by hand. The remote workstation also should not need a preinstalled
current Recallant CLI.

For advanced/admin fallback, maintainers can generate a one-time invite on the central server:

```bash
recallant invite /path/to/project --server-url https://memory.example.com
```

The remote workstation then runs only the printed command:

```bash
curl -fsSL https://memory.example.com/j/<one-time-invite-token> | bash
```

That invite bootstrap does not run the local self-host installer and does not require Docker, Postgres,
`RECALLANT_DATABASE_URL`, internal server paths, raw artifacts, backups, or provider secrets. On
success it reports that config was written, `remote-doctor` passed, and the next step is to open
Codex in that project. If `remote-doctor` fails, the script keeps the credential redacted and points
the operator toward server URL, credential status, project/developer/client scope, or edge/access
policy instead of local Docker/Postgres setup.

For no-browser servers, use the protected bootstrap-token path instead of an invite when the host
should autonomously connect once and then rely on its scoped project credential:

```bash
recallant connect-cloud . --server-url https://memory.example.com --bootstrap-token <one-time-token>
```

Maintainers can still use the lower-level package form when debugging provisioning or credential
scope directly:

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-client-bootstrap.sh | bash -s -- \
  --server-url <https-recallant-server> \
  --credential <scoped-remote-mcp-credential> \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --project-dir .
```

They can also preview or write the same config with the installed CLI:

```bash
recallant connect-remote codex \
  --server-url <https-recallant-server> \
  --credential <scoped-remote-mcp-credential> \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --project-dir . \
  --write \
  --format json
```

The generated MCP server uses `recallant remote-bridge` and these remote-only environment variables:

- `RECALLANT_REMOTE_MCP_URL`
- `RECALLANT_REMOTE_MCP_CREDENTIAL_REF`
- optional `RECALLANT_REMOTE_MCP_CREDENTIAL_STORE`
- `RECALLANT_PROJECT_ID`
- `RECALLANT_DEVELOPER_ID`
- `RECALLANT_REMOTE_MCP_CLIENT_ID`
- optional `RECALLANT_REMOTE_MCP_SESSION_ID`
- optional `RECALLANT_REMOTE_MCP_TRACE_ID`

New generated configs reference the local credential store instead of embedding the raw scoped
credential. The explicit `RECALLANT_REMOTE_MCP_CREDENTIAL` value remains an advanced/debug-only
compatibility path, not the beginner output.

The remote machine must not receive Postgres access, `RECALLANT_DATABASE_URL`, internal server paths,
Workbench/admin auth, raw artifacts, backups, or provider secrets. Local stdio MCP remains the
default simple path for installed-host projects; `curl -fsSL https://memory.example.com/connect |
bash` is the simple path for remote projects attached to a central server. Invite provisioning is
the advanced/admin fallback for maintainers, automation, pre-known projects, and directed one-time
access.

### Remote Readiness Versus Recall Proof

Configuration proves access. Proof proves memory. Capture-active proves Recallant is doing its job.

Remote setup has several distinct readiness levels. Keep them separate when diagnosing a connected
project:

Use these names consistently in client setup and diagnostics:

- `configured`: scoped remote MCP access or local client config exists; no memory proof yet.
- `context_ready`: the agent read `memory_get_context_pack`.
- `semantic_memory_ready`: a safe synthetic or agent-authored governed memory was created and
  recalled.
- `capture_active`: context read, memory write, and checkpoint evidence are present.
- `ingestion_approved`: the owner separately approved import/summarization of existing files or
  history.

Do not treat `remote_mcp_ready` as `capture_active`; it maps only to `configured`. Remote
`agent-start` reads bounded readiness through `memory_get_readiness_status` when the project has
remote consent/config. Before proof, the primary state remains `configured`; after
`recallant remote-doctor --semantic-proof`, a repeated `agent-start` should report
`readiness_contract.primary_state: "semantic_memory_ready"` while `capture_active` remains false
until the normal context/memory/checkpoint capture loop has actually run.

Safe remote existing-project sequence:

1. reach `remote_mcp_ready` through the scoped remote MCP consent/config boundary;
2. prove session/context readiness with `memory_start_session` plus `memory_get_context_pack`, or
   `recallant remote-doctor --capture-proof`;
3. optionally prove checkpoint state with `memory_set_checkpoint` plus `memory_get_checkpoint`;
4. prove governed semantic recall with one synthetic `memory_create_agent_memory` marker and
   `memory_recall_agent_memories`;
5. run read-only migration inventory, classify risk, get owner approval, write concise governed
   memories/imports, and verify recall again.

- `recallant agent-start --format json` returning `mode: "remote_mcp_ready"` proves the project has a
  remote consent/config boundary and can use the scoped remote MCP bridge. It also reports
  `recommended_next_call: "memory_get_context_pack"` and
  `recommended_next_proof_call: "memory_create_agent_memory"`.
  Those JSON field names are backward-compatible hints; for agents the behavior is mandatory by
  default when consent allows agent-authored memory. The same output includes the bounded
  `readiness_contract`; configuration-only projects stay `configured`, and post-semantic-proof
  projects report `semantic_memory_ready`.
- Local `recallant doctor --project-dir .` on that remote workstation should report
  `remote-ready, local storage not attached`, not a standalone local attach failure.
- `memory_start_session` followed by `memory_get_context_pack`, or
  `recallant remote-doctor --capture-proof`, proves session/context readiness. It does not prove
  checkpoint state or governed semantic recall.
- `memory_set_checkpoint` followed by `memory_get_checkpoint` proves the current project checkpoint
  state can be written and read. The response is state-only and reports
  `checkpoint_state_only: true`, `searchable_memory_created: false`, and no `memory_id`.
- `memory_agent_checkpoint` is the explicit high-level MCP checkpoint closeout path. It updates
  checkpoint state, appends a checkpoint event when a `session_id` is available, creates a governed
  `memory_type: "checkpoint"` record, and returns the generated `memory_id`.
- `memory_create_agent_memory` followed by `memory_recall_agent_memories` proves governed semantic
  memory can be written and recalled for the current project scope.

Checkpoint state and governed semantic memory are intentionally different surfaces. A checkpoint that
can be read back is not, by itself, proof that semantic recall is populated. Existing-project context
migration should therefore start with a safe governed-memory marker proof, then continue with a
reviewed import or summarization plan. Do not run local `attach --confirm` on a remote workstation
unless the operator explicitly wants to switch that project to the local-storage attach flow.

Session recovery is a separate surface again. `memory_start_session` may return
`previous_unclosed_session` when a previous agent session for the same project is still active in
storage, plus `previous_session_recovery` with user-facing guidance. Agents should treat this as a
recovery hint for the scoped project, not as an error and not as new task instructions. If the
previous session is stale, recover from the latest checkpoint/events only as needed; if it is fresh,
check whether another agent is actively working before continuing.

The baseline checkpoint parity contract is state-only: `memory_set_checkpoint` updates the current
checkpoint and `memory_get_checkpoint` reads it back. Searchable checkpoint memory requires an
explicit high-level closeout/checkpoint action such as `memory_agent_checkpoint`, rather than
assuming checkpoint state is semantic recall. Generic `memory_create_agent_memory` remains for
ordinary governed facts, decisions, procedures, work logs, and references; use the dedicated
checkpoint tool when the memory should represent session checkpoint closeout.

### Provision Scoped Remote Credentials

Provisioning is CLI-first. An operator creates or rotates a scoped credential on the central
Recallant server, then gives the external agent only the ready remote client bootstrap command and
the raw credential shown in that one response.

```bash
recallant remote-credential create \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --server-url <https-recallant-server> \
  --target codex
```

Create and rotate output may include the one-time raw credential plus the complete
`install-recallant-client-bootstrap.sh` command, a `remote-doctor` command, and rendered MCP config.
Store that raw value in the external agent's local secret store. `list`, `revoke`, audit output,
docs, and stored rows are redacted and must not include raw credential values or hashes.

```bash
recallant remote-credential rotate --credential-id <credential-id> --server-url <https-recallant-server>
recallant remote-credential list --project-id <project-id> --developer-id <developer-id>
recallant remote-credential revoke --credential-id <credential-id>
```

The protected Workbench also includes a Remote MCP Credentials panel for the same scoped
create/rotate/revoke/list workflow where Workbench is available. Its generated command/config uses
`recallant remote-bridge` through HTTPS `/api/mcp`; it is not a Workbench/admin-auth handoff.

### Diagnose Remote MCP

Use `recallant remote-doctor` from the remote host to distinguish network reachability, HTTPS/TLS
posture, edge/access denial, scoped credential auth, project/developer/client scope, MCP
`initialize`, MCP `tools/list`, session/context readiness, checkpoint state, and governed semantic
memory recall proof.

```bash
recallant remote-doctor --project-dir . --format json
```

If the project already has a project-local remote MCP config from `connect-cloud` or the universal
connect flow, `--project-dir` is enough: `remote-doctor` reads the server URL, project/developer/client
scope, credential reference, and local credential-store path from that config. Explicit
`--server-url`, credential, and scope flags remain available for advanced/debug workflows.

Add `--capture-proof` only when the remote MCP tools should also prove session/context readiness.
That stage uses `memory_start_session` and `memory_get_context_pack`; it does not prove checkpoint
state or semantic recall. Add `--semantic-proof` when the operator wants the stricter diagnostic:
`remote-doctor` separately proves checkpoint state with `memory_set_checkpoint` /
`memory_get_checkpoint`, then creates exactly one small governed diagnostic memory through
`memory_create_agent_memory` and recalls it with `memory_recall_agent_memories`. The synthetic marker
memory is scoped to the project, typed as `work_log`, created by `agent`, addressed to
`[{ "kind": "all_agents", "id": null }]`, and marked with `diagnostic_marker: true`.

The command prints redacted JSON by default with `--format json` or an operator-readable stage
summary with `--format text`. It does not need local Postgres, `RECALLANT_DATABASE_URL`,
Workbench/admin auth, raw artifacts, backups, provider secrets, internal server paths, or private
deployment context on the remote machine.

The deterministic coverage for this shipped diagnostic path is `npm run remote-mcp-doctor:smoke`.

### Rehearse The External Client Path

Use the shipped deterministic rehearsal smoke when validating that an external-like client can use
only HTTPS `/api/mcp`, a scoped remote MCP credential, and project/developer/client scope:

```bash
npm run remote-mcp-external-rehearsal:smoke
```

That smoke starts a local HTTPS `/api/mcp` fixture, runs `recallant connect-remote`,
`recallant remote-bridge`, and `recallant remote-doctor` from a scrubbed child-process environment,
and proves initialize, tools/list, tools/call, wrong/revoked/rotated credential failures, wrong
project/developer/client failures, session/context readiness proof pass/missing/failure, semantic
marker proof pass, and no DB/admin/provider/raw artifact/backup leakage. It is deterministic
external-like coverage, not a claim that a physical second machine has been rehearsed.

For a real separate-machine rehearsal, use the CLI acceptance gate from the external host with
operator-provided live inputs. It bootstraps the remote client config, runs `remote-doctor`, opens
the remote MCP bridge, starts a memory session, fetches a context pack, writes a governed memory
marker, checkpoints, recalls that marker, verifies no local `.recallant`/Docker/Postgres artifacts
were created, and writes a redacted evidence bundle:

```bash
recallant remote-acceptance \
  --project-dir . \
  --capture-proof \
  --output-dir recallant-external-evidence
```

If the project already has Recallant remote client config from bootstrap, `remote-acceptance` reads
the scoped server URL, credential, project id, developer id, and client id from that local config.
If that config stores only a credential reference, acceptance skips bootstrap automatically and uses
the local credential store for doctor and bridge probes. Operators can still pass scope flags
explicitly to override the config during diagnostics. The evidence output directory is created
automatically when it does not exist.

Validate a saved evidence file before sharing it or committing an optional internal rehearsal
report:

```bash
recallant remote-acceptance validate --evidence recallant-external-evidence/<run-id>.evidence.json
```

On the central Recallant server, run the stricter Capture/Recall Acceptance validator against the
same evidence bundle:

```bash
recallant remote-acceptance validate-live --evidence recallant-external-evidence/<run-id>.evidence.json
```

That server-side gate requires `RECALLANT_DATABASE_URL` and verifies Workbench project/readiness
evidence plus redacted `system_activity_events` coverage for the remote MCP initialize/list/call
envelope. The tool-specific proof still comes from the evidence bundle and central DB facts for the
sessions, accepted memory, checkpoint, and next-session recall. It does not grant the external
machine Workbench/admin or database access.
A separate human-written report file is optional audit paperwork, not a product-readiness blocker
after the evidence bundle or server-side trace verification has passed.

### Remote Live External Canary

Before asking a user to manually retry remote-client setup, maintainers should run the automated
remote live external canary or an equivalent server-side trace gate. The deterministic smoke is safe
for CI and local development because it uses fake controller provisioning, a scrubbed fake external
HOME/project, generated remote client config, semantic marker recall, evidence validation, and a
regression matrix for no-CLI, stale-CLI, credential-ref, missing-evidence-dir, reconnect, forbidden
local path, and incomplete-input cases:

```bash
npm run remote-live-external-canary:smoke
```

For an operator-controlled central server, run the live canary only with explicit server-local
controller inputs. Use placeholder values in shared docs and runbooks:

```bash
RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL=<https-recallant-server> \
RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL=<server-local-controller-url> \
RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN=<controller-auth-token> \
RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID=<developer-id> \
RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE=1 \
npm run remote-live-external-canary -- --live --json
```

The optional controller URL lets an operator use a server-local protected provisioning endpoint while
the fake external child still receives only the public HTTPS server URL. The controller may use
protected provisioning and server-side validation credentials, but the child receives only the remote
connection material needed for `connect-cloud` and `remote-acceptance`. The child must not receive
Postgres access, `RECALLANT_DATABASE_URL`, Workbench/admin auth, raw artifacts, backups, provider
secrets, private topology, raw scoped credentials, bootstrap token values in output, or controller
auth tokens. If live server trace validation is disabled or unavailable, the canary reports
`server_trace_validation_skipped` and marks the result as `not_release_pass`; that is useful
diagnostics, not a release pass.

The deterministic canary is the default autonomous regression net for remote-client changes. It can
catch most client bootstrap and acceptance regressions without a human-owned laptop: missing or stale
CLI installs, duplicate reconnect config, project-local credential-reference acceptance, missing
evidence directories, accidental local `.recallant`/Docker/Postgres dependence, semantic recall
breakage, next-session recall breakage, evidence validation failures, cleanup failures, and unsafe
failure diagnostics. It is still a fixture-backed proof, not a substitute for the operator live
canary. A release-pass live canary requires explicit server-local inputs and enabled server trace
validation, and it must finish with semantic marker recall, next-session recall, evidence
validation, server trace validation, cleanup, and redaction all passing. Evidence validation accepts
both first-time redacted bootstrap commands and already-connected credential-reference projects; raw
`--credential` or `--bootstrap-token` values remain validation failures.

### Operator Server-Side CLI Update

When a canary fix lands, update the central server's deployed Recallant checkout before asking
remote users to retry. Keep the runbook generic in shared docs and keep server paths, environment
files, database URLs, and controller tokens out of transcripts:

```bash
git fetch --depth 1 origin main
npm run build
./scripts/install-recallant-cli.sh --user
systemctl restart <recallant-service>
systemctl is-active <recallant-service>
npm run remote-live-external-canary:smoke
```

Then run the operator-controlled live canary with server-local credentials. A restart alone is not a
remote-client proof; the live canary must still show semantic marker recall, next-session recall,
evidence validation, server trace validation, cleanup, and redaction before it counts as a release
gate pass.

If the gate fails because an old local setup left `.recallant` in the project folder, clean only
that stale local storage marker and retry:

```bash
recallant remote-acceptance cleanup --project-dir . --confirm
```

This cleanup preserves source files, `AGENTS.md`, `PROJECT_LOG.md`, and the remote client config. It
does not delete central Recallant server records.

To disconnect only the remote client config before retrying bootstrap, use the remote cleanup gate.
It is a dry-run by default:

```bash
recallant remote-cleanup --project-dir .
```

If the plan only removes the generated remote Recallant entry, confirm it:

```bash
recallant remote-cleanup --project-dir . --confirm
```

For Codex this removes only the remote `[mcp_servers.recallant]` table from `.codex/config.toml`;
unrelated Codex settings and other MCP servers are preserved. If that Recallant table points to the
local `recallant mcp-server` flow instead of `recallant remote-bridge`, the command preserves it and
prints a warning. It does not touch `.recallant`, source files, Docker/Postgres, Workbench/admin
auth, or central Recallant records.

If the external workstation should also remove the user-local CLI wrapper installed by the remote
bootstrap, make that an explicit second opt-in:

```bash
recallant remote-cleanup --project-dir . --remove-cli-wrapper --confirm
```

The CLI wrapper removal is conservative: it removes only a wrapper that looks like a Recallant
launcher and preserves the persistent cloned source directory so a later bootstrap can update or
reuse it.

The evidence JSON and summary redact the credential, host name, project path, repository root,
database/admin/provider/raw-artifact/backup surfaces, and local private paths. This is the preferred
gate for deciding whether the remote existing-server path is ready for a beginner-facing command.
External-host rehearsals should be reported with redacted summaries only; public docs should not
publish owner-specific device names, project paths, trace ids, raw evidence ids, or private topology.
The central-server trace check should confirm next-session recall, Workbench readiness evidence, and
redacted audit rows without exposing those raw values.

The older live-input smoke remains useful for transport/security matrix checks:

```bash
RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL=<https-recallant-server> \
RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL=<scoped-remote-mcp-credential> \
RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID=<project-id> \
RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID=<developer-id> \
RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID=<client-id> \
npm run remote-mcp-external-rehearsal:smoke
```

Optional `RECALLANT_EXTERNAL_REHEARSAL_SESSION_ID`,
`RECALLANT_EXTERNAL_REHEARSAL_TRACE_ID`, and `RECALLANT_EXTERNAL_REHEARSAL_CAPTURE_PROOF=1` add
session/trace headers and capture proof. When live inputs are absent, the smoke exits green with
`skipped_live_external_rehearsal` so CI does not require real credentials.

For the stricter central-server readiness gate, use the dedicated live smoke. It is intentionally
not a fixture proof: with no live inputs it reports `skipped_live_remote_mcp_readiness`; with partial
inputs it fails as incomplete; with full inputs it runs `remote-doctor` and a remote bridge
`tools/list` roundtrip against HTTPS `/api/mcp`:

```bash
RECALLANT_LIVE_REMOTE_MCP_SERVER_URL=<https-recallant-server> \
RECALLANT_LIVE_REMOTE_MCP_CREDENTIAL=<scoped-remote-mcp-credential> \
RECALLANT_LIVE_REMOTE_MCP_PROJECT_ID=<project-id> \
RECALLANT_LIVE_REMOTE_MCP_DEVELOPER_ID=<developer-id> \
RECALLANT_LIVE_REMOTE_MCP_CLIENT_ID=<client-id> \
npm run remote-mcp-live-readiness:smoke
```

Optional `RECALLANT_LIVE_REMOTE_MCP_SESSION_ID`,
`RECALLANT_LIVE_REMOTE_MCP_TRACE_ID`, and `RECALLANT_LIVE_REMOTE_MCP_CAPTURE_PROOF=1` add
session/trace headers and require capture proof to pass. Output is redacted and does not print the
credential.

The remote-client goal is to support projects on another server or workstation while a single
managed Recallant server remains the memory source of truth. That path should:

- authenticate each remote agent/client before any memory tool call;
- scope every request to an attached project and developer, with optional client-specific
  credentials;
- use `recallant remote-credential <create|list|rotate|revoke>` for admin-safe credential
  lifecycle operations;
- store remote MCP credential secrets as hashes only, with non-secret prefixes and redacted audit
  metadata;
- support revocation and rotation without granting global Recallant access;
- avoid direct remote Postgres exposure or internal server paths;
- keep Workbench/admin, raw artifacts, backups, and provider settings private;
- use `recallant remote-doctor` for diagnostics that distinguish network reachability,
  edge/access denial, credential auth, project/developer/client scope, MCP readiness, and
  capture-not-active states;
- preserve the same startup contract: `memory_start_session`, `memory_get_context_pack`, meaningful
  evidence/checkpoints, and closeout.
- give Codex, Claude Code, Cursor, and generic MCP clients the same hook/skill posture: on session
  start recall context, during meaningful work write concise agent-authored decisions/actions/tests,
  before compaction checkpoint, on stop close out, and during diagnostics create+recall one synthetic
  non-secret marker.
- keep validating `/api/mcp` endpoint behavior through `remote-mcp-contract:smoke`,
  `remote-mcp-credentials:smoke`, `remote-mcp-bridge:smoke`, and
  `remote-mcp-provisioning:smoke`; keep validating remote diagnostics through
  `remote-mcp-doctor:smoke`; keep validating the end-to-end remote security matrix through
  `remote-mcp-security:smoke`; keep validating deterministic isolated external-client rehearsal
  through `remote-mcp-external-rehearsal:smoke`; keep validating the redacted evidence bundle
  through `remote-mcp-separate-machine-evidence:smoke` and
  `remote-mcp-separate-machine-evidence-validate:smoke`.

Until broader remote-client polish and repeat release rehearsals are complete, use the local stdio
setup above on the installed host for the default client path.

## Optional Local Hooks

For clients that can call local hook scripts:

```bash
recallant connect codex --project-dir . --install-local-hooks --dry-run
recallant connect codex --project-dir . --install-local-hooks
```

Hooks are fail-soft. If Recallant is unavailable, they should not block normal agent work. When
possible, they write local spool records for later sync.

## Agent Startup Contract

The first agent session after connect should:

1. read project instructions;
2. call `memory_start_session`;
3. call `memory_get_context_pack`;
4. work normally;
5. write meaningful decisions, actions, tests, and checkpoints;
6. close out with `memory_closeout`.

That startup contract is what turns a registered project into an agent-ready project. If the loop is
not visible in Recallant, the project is configured but not yet capture active.

When the session start response includes `previous_session_recovery`, display that guidance in plain
language. Avoid saying "old unclosed checkpoint": the checkpoint is the latest compact project state,
while the unfinished item is the previous agent session. This distinction keeps multi-agent work
calm: agents can share project memory across clients and projects, but each agent still scopes
recovery to the current project and the user's current task.

For remote projects, `recallant agent-start --format json` reports `mode: "remote_mcp_ready"` and
the external Recallant consent boundary before agent work continues: destination server, HTTPS
`/api/mcp` endpoint, project / developer / client credential scope, allowed context classes,
prohibited data classes, the mandatory context-pack call, and the mandatory semantic proof call when
consent allows agent-authored memory.
Text mode prints the same boundary for humans. Local `recallant doctor` should describe this as
`remote-ready, local storage not attached` so agents do not run local `attach --confirm` unless the
operator explicitly chooses the local-storage path.

For an already connected remote project, use `recallant agent-start --format json` as the first
refresh check. If it reports `remote_mcp_ready`, the existing scoped config is usable; no local
`attach`, `onboard`, or import is needed. If the local client itself needs to be updated or the
project config must be rewritten, rerun the central-server bootstrap (`curl -fsSL
https://memory.example.com/connect | bash`) or the explicit remote flow:

```bash
recallant connect-cloud . --server-url https://memory.example.com --yes
```

Older client builds may still route `recallant connect . --server-url ...` through the local-storage
connect path and fail with `connect requires an attached project with .recallant/config`; update the
remote client or use `connect-cloud` directly before retrying that shorthand.

After `remote_mcp_ready`, a useful first proof is a small non-secret governed memory marker:
`memory_create_agent_memory` with `scope: "project"`, `created_by: "agent"`, and
`audience: [{ "kind": "all_agents" }]`, followed by `memory_recall_agent_memories` for the same
marker. That proof confirms semantic memory for the scoped project. A checkpoint-only readback is a
valid state check, but it should not be reported as semantic recall proof. When an agent needs a
checkpoint that is searchable later, use `memory_agent_checkpoint` instead of relying on
`memory_set_checkpoint`; the low-level state call intentionally does not create governed memory.

The prohibited classes are `.env`, private keys, raw credentials, customer data, provider secrets,
database URLs, raw artifacts, and backups. Those must not be sent through Recallant memory tools,
stored in consent receipts, or copied into project config. The local consent receipt written by
`connect-cloud` is a non-secret reminder of the remote boundary; it stores credential references and
redaction classes, not raw credentials or private keys.

For old projects with a lot of existing context, start with `recallant discover --dry-run
--project-dir .`. That command is a read-only migration inventory: it produces a review-first
`migration_plan`, classifies safe docs and risky paths, and prints only paths, classes, counts, and
secret reference names. The owner approves the concise plan before any import or governed-memory
write. Remote-only projects may apply approved entries through `memory_create_agent_memory` and
verify with `memory_recall_agent_memories` without local Postgres; server-local projects may use
explicit `recallant import <path>` or guided attach confirmation. Checkpoint state is updated after
the recall proof, not used as the proof.

Cloudflare Access remains the human gate for dashboard/admin/approval surfaces. Agent runtime uses
the scoped machine credential from the local credential store and does not require Cloudflare browser
auth after the project is connected. Codex or another agent client may still ask its own
external-context safety confirmation; that client-level prompt is separate from Recallant auth and
should be answered only after reviewing the reported consent boundary.

Remote-only projects must not report `mode: "offline_spool"` just because the external workstation
does not have `RECALLANT_DATABASE_URL`. Offline spool remains a fail-soft fallback for local capture
when no remote MCP consent/config is present; it is not the normal remote-connect startup mode.

If MCP tools are unavailable, use CLI fallback commands:

```bash
recallant agent-start --task-hint "<current task>"
recallant agent-event --kind decision --text "<important decision>"
recallant agent-checkpoint --summary "<current state>"
recallant agent-closeout --summary "<what changed and what is next>"
```
