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
only credential references, and `agent-start` reports the remote consent/redaction boundary.

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
project-local remote MCP config, runs `remote-doctor`, and reports the next agent-start command.

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

Add a DB-backed pending connection table with hash-only device secrets:

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

Add:

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
9. runs `remote-doctor`;
10. prints acceptance and cleanup guidance.

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

## Implementation Record And Regression Guards

The initial shipped slice was built in these independently verifiable pieces. Keep them as the
regression checklist for future changes.

### Phase 1: Contract and storage

- Add shared contract helpers for `/connect`, `/api/connect/start`, `/api/connect/poll`, and
  approval URLs.
- Add DB migration and methods for pending remote connection requests.
- Store only hashes/prefixes for device secrets.
- Add audit events for start, approve, deny, poll, redeem, expire, and failure.

Acceptance:

- storage smoke proves start/approve/redeem/expire and one-time redemption;
- raw device secret and raw credential are absent from stored rows and audit output.

### Phase 2: Server routes

- Add public bootstrap at `GET /connect`.
- Add start, poll, and optional cancel JSON APIs.
- Add protected approval page and protected approval action.
- Reuse existing remote credential provisioning and remote config rendering.

Acceptance:

- unauthenticated start/poll work without Workbench cookies;
- approval requires the same protected human auth posture as Workbench;
- denied/expired/redeemed requests cannot be reused.

### Phase 3: CLI pairing command

- Add `recallant connect-cloud` and aliases.
- Install/update the remote-only client path from the bootstrap script.
- Poll with timeout, clear user messaging, and safe retry.
- Write project-local remote MCP config through the existing `connect-remote` machinery.
- Run `remote-doctor`.

Acceptance:

- a machine with no current Recallant CLI can run the public bootstrap and complete pairing;
- a machine with an old CLI is upgraded or bypassed safely;
- no local Docker/Postgres/database URL is required.

### Phase 4: Security and edge policy

- Add rate limits and bounded payload validation for connect routes.
- Ensure project metadata is redacted and does not leak private paths.
- Keep admin credential creation protected.
- Document Cloudflare Access path split.

Acceptance:

- security smoke covers unauthenticated public route behavior, protected approval, protected
  Workbench/admin, wrong code, expired code, replay, and redaction.

### Phase 5: External acceptance

- Add deterministic pairing smoke with fixture server.
- Add live central-server readiness gate for `/connect`.
- Extend `remote-acceptance` evidence to record connect-cloud bootstrap mode.

Acceptance:

- clean external host can connect a new project with only the `curl .../connect | bash` command;
- evidence proves remote MCP session/context/write/checkpoint/recall;
- no local self-host artifacts are created.

### Phase 6: Documentation and migration polish

- Make universal connect the beginner remote docs path.
- Keep invite documented as advanced/admin.
- Add troubleshooting for old CLIs, pending approvals, expired codes, denied approvals, and edge
  Access misconfiguration.
- Update public readiness/security smokes to prevent docs from regressing back to old invite-first
  wording.

Acceptance:

- public docs clearly distinguish local self-host onboarding, universal remote connect, and
  advanced invite provisioning;
- public readiness and security smokes pass.

## Non-Goals

- Do not expose Workbench/admin to unauthenticated users.
- Do not give remote machines database access.
- Do not make browser cookies sufficient for remote MCP calls.
- Do not remove invite provisioning; demote it to advanced/admin.
- Do not copy private deployment overlays or owner-specific paths into public docs.
