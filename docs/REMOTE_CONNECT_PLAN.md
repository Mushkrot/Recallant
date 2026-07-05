# Universal Remote Connect

Status: the universal remote connect model is implemented and covered by deterministic storage,
server, CLI, security, external-rehearsal, remote-MCP, agent-capture, and public-doc smoke tests.
This document is the public contract and regression checklist for that flow.

Recallant remote onboarding works from a clean external workstation or server with one command from
the project directory:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

That command does not depend on an already installed or up-to-date local `recallant` CLI. It does
not require Docker, Postgres, `RECALLANT_DATABASE_URL`, Workbench/admin cookies, internal server
paths, raw artifacts, backups, provider secrets, or private deployment overlays on the remote
machine. First approval can register a trusted device, later projects can reconnect with signed
device challenges, headless hosts can use one-time bootstrap tokens, generated project config stores
only credential references, and remote-only `agent-start` returns `remote_mcp_ready` with the
remote consent/redaction boundary instead of falling back to local offline spool messaging.

## Product Decision

The beginner remote path is device-style pairing against an existing central Recallant server.
Server-generated invites remain supported as an advanced/admin path, but they are not the universal
first-run command for a new external project.

## Target User Flow

From the external project folder:

```bash
curl -fsSL https://memory.example.com/connect | bash
```

The bootstrap installs or updates only the remote Recallant client CLI and starts:

```bash
recallant connect-cloud . --server-url https://memory.example.com
```

The CLI starts a pending connection request and prints an approval URL:

```text
Open this URL to approve Recallant for this project:
https://memory.example.com/connect/approve?code=ABCD-1234
```

After the owner approves in the browser, the CLI receives a provisioning package, writes the
project-local remote MCP config, stores only a credential reference, prepares thin agent-ready files
(`README.md`, `AGENTS.md`, and `PROJECT_LOG.md`), runs `remote-doctor`, and reports the next
`agent-start` command. For remote-only projects, that command is a readiness/consent handoff: it
should report `mode: "remote_mcp_ready"` and direct the agent to the configured MCP
`memory_get_context_pack` flow without requiring local Recallant storage or Cloudflare browser auth.

## Authentication Paths

Recallant remote connect has three distinct authorization paths:

- **First browser approval:** a new workstation runs `curl -fsSL https://memory.example.com/connect
  | bash`, starts a pending request, and the owner approves it through protected
  `/connect/approve`.
- **Trusted-device reconnect:** after that first approval registers the workstation's public device
  key, later projects from the same workstation use `connect-cloud` signed nonce challenges. The
  server validates the device key, expiry, revocation, project metadata, and replay table before
  auto-approving the pending request. This does not grant Workbench, admin,
  credential-management, backup, provider, or raw-artifact access.
- **Headless bootstrap token:** servers and CI-like hosts can use a short-lived one-time token:

  ```bash
  recallant connect-cloud . --server-url https://memory.example.com --bootstrap-token <one-time-token>
  ```

  Bootstrap tokens are created only through protected admin/human surfaces such as
  `POST /api/connect/bootstrap-token`. The remote host redeems the token through public
  `/api/connect/start`, receives no browser cookies, and still gets the scoped MCP credential only
  through the normal approved `/api/connect/poll` one-time-secret boundary.

## Trust Boundary

The remote workstation can start and poll a pending connection request, but it cannot create a
project binding or credential by itself. Approval happens through the central server's protected
human surface, a previously trusted device key, or a one-time headless bootstrap token. The server
owns:

- owner authentication;
- project creation or project binding;
- developer/client identity creation;
- scoped remote MCP credential creation;
- audit events;
- revocation and cleanup.

The remote workstation receives only the redacted provisioning package needed to run
`recallant remote-bridge` against HTTPS `/api/mcp`.

## Public Routes

These routes form the universal connect flow:

- `GET /connect`: public shell bootstrap script.
- `POST /api/connect/start`: public, rate-limited pending request creation.
- `GET /connect/approve?code=<device-code>`: protected browser approval page.
- `POST /api/connect/approve`: protected approval action.
- `POST /api/connect/poll`: public, rate-limited polling endpoint for the device code.
- `POST /api/connect/cancel`: optional public cancellation endpoint for a pending device code.

The existing remote routes remain:

- `POST /api/mcp`: authenticated remote MCP endpoint.
- `POST /api/remote-invite/redeem`: advanced invite redemption.
- `GET /j/<token>`: advanced invite bootstrap.

Workbench, admin, raw artifact, backup, provider, and credential-management routes remain protected.
`POST /api/connect/bootstrap-token` is also protected because it creates/revokes headless bootstrap
tokens; only token redemption through `/api/connect/start` is public.

## State Model

The server stores pending connection requests in a DB-backed table with hash-only device secrets:

- `id`
- `device_code_hash`
- `user_code_hash`
- `user_code_prefix`
- `project_fingerprint`
- `project_display_name`
- `project_path_hint_redacted`
- `repo_remote_hash`
- `target_client`
- `requested_by_ip_hash`
- `status`: `pending`, `approved`, `denied`, `expired`, `redeemed`
- `expires_at`
- `approved_at`
- `approved_by`
- `redeemed_at`
- `created_project_id`
- `developer_id`
- `client_id`
- `credential_id`
- redacted audit metadata

Raw device secrets are returned only to the bootstrap process at start time and are never stored.
Raw remote MCP credentials are returned only once, during approved poll redemption.

## CLI Commands

Available commands:

```bash
recallant connect-cloud <project-dir> --server-url <https-url> [--client codex|cursor|claude-code|generic]
recallant connect-cloud <project-dir> --server-url <https-url> --bootstrap-token <one-time-token>
```

Aliases:

```bash
recallant cloud-connect <project-dir> --server-url <https-url>
recallant connect-remote-auto <project-dir> --server-url <https-url>
```

This command:

1. collects safe project metadata;
2. calls `/api/connect/start`;
3. prints and optionally opens the approval URL;
4. skips browser approval when a valid trusted-device signature or bootstrap token auto-approves the
   pending request;
5. polls `/api/connect/poll`;
6. stores the raw scoped credential only in the user's local Recallant credential store;
7. writes generated project config with a credential reference, not the raw secret;
8. writes a non-secret project-local remote consent receipt;
9. creates or safely upserts compact agent-ready files for the target project;
10. runs `remote-doctor`;
11. prints acceptance and cleanup guidance.

The generated config and consent receipt must not contain raw credentials or private keys. The
credential store entry is local to the user profile; `.codex/config.toml` and equivalent client
files carry only `RECALLANT_REMOTE_MCP_CREDENTIAL_REF` plus project/developer/client scope.

Existing `recallant invite` remains:

```bash
recallant invite /path/to/project --server-url https://memory.example.com
```

It is for maintainers, automation, pre-known projects, and one-time directed access, not the
beginner command for an arbitrary external workstation.

## Cloudflare Access Shape

For a managed deployment with Cloudflare Access:

- `/connect`
- `/api/connect/start`
- `/api/connect/poll`
- `/api/connect/cancel`
- `/j/*`
- `/api/remote-invite/redeem`
- `/api/mcp*`

may be exposed as path-scoped agent routes.

The browser approval route and Workbench remain protected:

- `/connect/approve`
- `/`
- `/review`
- `/api/review-dashboard`
- `/api/remote-credential`
- `/api/remote-invite`
- `/api/connect/bootstrap-token`

If an edge provider cannot express this path split safely, use a dedicated agent hostname for the
public routes and keep the Workbench hostname protected.

Rollback for a managed edge change is intentionally narrow: remove or disable only the path-scoped
agent-route bypass for `/connect`, `/api/connect/start`, `/api/connect/poll`,
`/api/connect/cancel`, `/j/*`, `/api/remote-invite/redeem`, and `/api/mcp*`. After rollback, those
paths should return the edge provider's protected-access response again, while `/`, `/review`,
approval, credential-management, raw artifact, backup, provider, and admin routes must remain
protected throughout.

The central server also keeps a bounded payload check and a per-route abuse guard for public
connect POST routes. Edge rate limits are still recommended for internet deployments; the server
guard is a fail-safe, not a replacement for Cloudflare/WAF policy.

## Regression Guards

The shipped remote connect contract is guarded by deterministic tests rather than private operator
notes. Future changes should keep these surfaces passing:

- storage and server route smokes prove start/approve/redeem/expire behavior, one-time redemption,
  protected approval, and no raw device secret or raw credential in stored rows or audit output;
- CLI pairing smokes prove no-CLI and stale-CLI bootstrap, browser approval, trusted-device
  reconnect, bootstrap-token redemption, credential references, and no local Docker/Postgres/database
  requirement;
- agent-ready smokes prove empty projects, existing-doc projects, existing `AGENTS.md`, non-ASCII
  paths, reconnect idempotency, and conflict-safe handling of managed `AGENTS.md` / `PROJECT_LOG.md`
  sections;
- remote doctor and remote MCP smokes prove transport/auth/scope, session/context proof, checkpoint
  state proof, governed semantic marker recall, and honest `configured` versus
  `semantic_memory_ready` versus `capture_active` reporting;
- security and public-readiness smokes keep the Workbench/admin boundary protected, keep invite
  provisioning advanced/admin, keep public examples generic, and prevent docs from regressing to
  "MCP config only" remote setup language.

## Non-Goals

- Do not expose Workbench/admin to unauthenticated users.
- Do not give remote machines database access.
- Do not make browser cookies sufficient for remote MCP calls.
- Do not remove invite provisioning; demote it to advanced/admin.
- Do not copy private deployment overlays or owner-specific paths into public docs.
