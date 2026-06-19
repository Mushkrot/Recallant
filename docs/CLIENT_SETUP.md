# Client Setup

Recallant connects to agents through local MCP stdio. The Workbench is for humans; agents normally
call `recallant mcp-server` locally.

Remote project access is not part of the default beginner setup. Today, a protected public Workbench
URL lets humans review and manage Recallant; it does not by itself make an external workstation or
server an agent client. Recallant now has a first authenticated `POST /api/mcp` endpoint slice,
DB-backed scoped remote MCP credentials, a local stdio-to-HTTPS bridge command, and CLI-first remote
doctor diagnostics. It also has deterministic isolated external-client rehearsal coverage that
spawns a scrubbed child-process client against an HTTPS `/api/mcp` fixture. Real separate-machine
rehearsal and broader onboarding polish are still near-term work unless an operator supplies live
external rehearsal inputs.

The public remote contract surface is documented in [`docs/MCP_SPEC.md`](MCP_SPEC.md) and includes
transport, scope, header, and error contracts.

## Beginner Flow

For projects on a machine that already has a local Recallant install and storage, use onboarding:

```bash
recallant onboard <project>
```

Onboarding defaults to the Codex beginner flow: attach, client connection, local hooks when
supported, capture proof, readiness proof, and recall proof. The project is not capture active until
context read, memory write, checkpoint, and recall evidence are present.

Do not use the local self-host installer or `recallant onboard <project>` as the first step for an
external workstation that should connect to an existing central Recallant server. That remote
existing-server path is separate and must not require local Docker, Postgres, `RECALLANT_DATABASE_URL`,
or internal server paths.

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

The first remote client path is `recallant remote-bridge`: a stdio MCP bridge that forwards
`initialize`, `tools/list`, and `tools/call` over HTTPS to a central `POST /api/mcp` endpoint. It
uses a scoped remote MCP credential plus project, developer, and client scope. It does not require
`RECALLANT_DATABASE_URL` on the remote machine.

With operator-provided values, the external workstation can install only the Recallant remote bridge
CLI, write the project-local client config, and run `remote-doctor`:

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-client-bootstrap.sh | bash -s -- \
  --server-url <https-recallant-server> \
  --credential <scoped-remote-mcp-credential> \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --project-dir .
```

That bootstrap does not run the local self-host installer and does not require Docker, Postgres,
`RECALLANT_DATABASE_URL`, internal server paths, raw artifacts, backups, or provider secrets.

Maintainers can also preview or write the same config with the installed CLI:

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
- `RECALLANT_REMOTE_MCP_CREDENTIAL`
- `RECALLANT_PROJECT_ID`
- `RECALLANT_DEVELOPER_ID`
- `RECALLANT_REMOTE_MCP_CLIENT_ID`
- optional `RECALLANT_REMOTE_MCP_SESSION_ID`
- optional `RECALLANT_REMOTE_MCP_TRACE_ID`

The remote machine must not receive Postgres access, `RECALLANT_DATABASE_URL`, internal server paths,
Workbench/admin auth, raw artifacts, backups, or provider secrets. Local stdio MCP remains the
default simple path for installed-host projects.

This is still operator-provided and advanced until it has passed a real separate-machine rehearsal
with live endpoint/credential/scope and capture/recall proof against the central server.

### Provision Scoped Remote Credentials

Provisioning is CLI-first. An operator creates or rotates a scoped credential on the central
Recallant server, then gives the external agent only the ready bridge command/config and the raw
credential shown in that one response.

```bash
recallant remote-credential create \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --server-url <https-recallant-server> \
  --target codex
```

Create and rotate output may include the one-time raw credential plus a `recallant connect-remote`
command and rendered MCP config. Store that raw value in the external agent's local secret store.
`list`, `revoke`, audit output, docs, and stored rows are redacted and must not include raw
credential values or hashes.

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
`initialize`, MCP `tools/list`, and optional capture/recall proof.

```bash
recallant remote-doctor \
  --server-url <https-recallant-server> \
  --credential <scoped-remote-mcp-credential> \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --format json
```

Add `--capture-proof` only when the remote MCP tools should also prove Recallant memory readiness.
Capture proof is a separate stage: it may pass, warn, or fail without changing the network/auth/scope
diagnosis. The command prints redacted JSON by default with `--format json` or an operator-readable
stage summary with `--format text`. It does not need local Postgres, `RECALLANT_DATABASE_URL`,
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
project/developer/client failures, capture proof pass/missing/failure, and no DB/admin/provider/raw
artifact/backup leakage. It is deterministic external-like coverage, not a claim that a physical
second machine has been rehearsed.

For a real separate-machine rehearsal, run the same smoke from the external host with
operator-provided live inputs:

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
- keep validating `/api/mcp` endpoint behavior through `remote-mcp-contract:smoke`,
  `remote-mcp-credentials:smoke`, `remote-mcp-bridge:smoke`, and
  `remote-mcp-provisioning:smoke`; keep validating remote diagnostics through
  `remote-mcp-doctor:smoke`; keep validating the end-to-end remote security matrix through
  `remote-mcp-security:smoke`; keep validating deterministic isolated external-client rehearsal
  through `remote-mcp-external-rehearsal:smoke`.

Until real separate-machine rehearsal and broader onboarding polish land, use the local stdio setup
above on the installed host for the default client path.

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

If MCP tools are unavailable, use CLI fallback commands:

```bash
recallant agent-start --task-hint "<current task>"
recallant agent-event --kind decision --text "<important decision>"
recallant agent-checkpoint --summary "<current state>"
recallant agent-closeout --summary "<what changed and what is next>"
```
