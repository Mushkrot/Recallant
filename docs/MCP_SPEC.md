# Remote MCP Contract Specification

This is the public contract for authenticated Recallant remote agent access.

Recallant includes a first authenticated `POST /api/mcp` JSON-RPC endpoint slice for scoped remote
agent calls plus a `recallant remote-bridge` stdio-to-HTTPS bridge for external MCP clients. It is
not yet the default beginner workflow.

## 1) Scope and Readiness Posture

Local stdio MCP (`recallant mcp-server`) remains the current production-ready agent path for
installed projects.

Remote project access is partially implemented: the authenticated endpoint, DB-backed scoped
credentials, strict scope gate, redacted audit envelope, CLI-first provisioning output, protected
Workbench/API provisioning routes, `recallant remote-bridge`, `recallant connect-remote`, and
CLI-first `recallant remote-doctor` diagnostics exist with deterministic
endpoint/bridge/provisioning/doctor behavior smokes. Deterministic isolated external-client
rehearsal also exists through `remote-mcp-external-rehearsal:smoke`. Real separate-machine rehearsal
and broader client onboarding polish remain near-term work before this should be treated as a stable
default workflow.

## 2) Endpoint And Transport

Remote MCP endpoint: `POST /api/mcp`

The first slice accepts JSON-RPC-over-HTTP requests for `initialize`, `tools/list`, and
`tools/call`. The contract remains aligned with MCP Streamable HTTP (`mcp_streamable_http`) so
future client transport expansion can reuse the same auth, scope, audit, and error semantics.

## 3) Authentication

Remote calls must be authenticated and must not rely on browser cookies alone.
No unauthenticated public route should expose remote MCP.

### Required layers

- HTTPS/TLS in transport.
- External edge authentication (for example Cloudflare Access or equivalent).
- DB-backed scoped remote MCP credential.
- Project and developer scope checks before any tool execution.

### Required headers

- `Authorization: Bearer <scoped-remote-mcp-credential>`
- `X-Recallant-Project-Id: <project-uuid>`
- `X-Recallant-Developer-Id: <developer-uuid>`
- `X-Recallant-Client-Id: <client-identifier>`

### Optional/transport headers

- `X-Recallant-Session-Id: <session-uuid>`
- `X-Recallant-Trace-Id: <request-trace-id>`
- Standard MCP headers/metadata supported by the client implementation.

### Auth schemes

- `Bearer`
- `Cloudflare-Access`

## 3a) Remote Bridge Inputs

The bridge is configured from the operator's local client config or environment. It requires:

- `RECALLANT_REMOTE_MCP_URL`
- `RECALLANT_REMOTE_MCP_CREDENTIAL`
- `RECALLANT_PROJECT_ID`
- `RECALLANT_DEVELOPER_ID`
- `RECALLANT_REMOTE_MCP_CLIENT_ID`

It may also send:

- `RECALLANT_REMOTE_MCP_SESSION_ID`
- `RECALLANT_REMOTE_MCP_TRACE_ID`

Remote bridge hosts must not receive `RECALLANT_DATABASE_URL`, Postgres access, internal server
paths, Workbench/admin auth, raw artifacts, backups, provider secrets, or raw deployment overlays.
The bridge rejects forbidden local secret/storage config and forbidden tool-argument payload fields
before forwarding a memory tool call.

## 3b) Remote Doctor Diagnostics

`recallant remote-doctor` runs from a remote host using the same scoped credential and project,
developer, and client ids as `recallant remote-bridge`. It does not require local Postgres,
`RECALLANT_DATABASE_URL`, internal server paths, Workbench/admin auth, raw artifacts, backups,
provider secrets, or private deployment context.

Diagnostic stages are intentionally separate:

- URL validation and HTTPS/TLS posture.
- Network reachability.
- Endpoint shape and JSON-RPC response parsing.
- Edge/access posture, including Cloudflare Access-style HTML `401`/`403` denials.
- Scoped credential auth.
- Project/developer/client scope.
- MCP `initialize`.
- MCP `tools/list`.
- Optional capture/recall proof through remote MCP `tools/call`.

Use placeholder-only commands in docs and runbooks:

```bash
recallant remote-doctor \
  --server-url <https-recallant-server> \
  --credential <scoped-remote-mcp-credential> \
  --project-id <project-id> \
  --developer-id <developer-id> \
  --client-id <client-id> \
  --format json
```

Add `--capture-proof` only when the operator wants remote MCP memory readiness evidence. Capture
proof is reported separately from transport, auth, and scope. The deterministic diagnostic coverage
is `npm run remote-mcp-doctor:smoke`.

## 3c) External Rehearsal

`remote-mcp-external-rehearsal:smoke` proves the shipped remote client path from a scrubbed
external-like child-process environment. It uses HTTPS `/api/mcp`, `recallant connect-remote`,
`recallant remote-bridge`, `recallant remote-doctor`, scoped credential auth, project/developer/client
scope, optional session/trace headers, initialize, tools/list, tools/call, capture proof
pass/warn/fail states, wrong/revoked/rotated credential failures, wrong project/developer/client
failures, and output leakage checks.

This deterministic smoke is not a physical second-machine claim. A real external-host rehearsal is
opt-in: provide `RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL`,
`RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL`, `RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID`,
`RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID`, and `RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID` from the
external host. With no live inputs, the smoke exits green with `skipped_live_external_rehearsal`.
Live output remains redacted and must not include `RECALLANT_DATABASE_URL`, Postgres access,
Workbench/admin auth, internal server paths, raw artifacts, backups, provider secrets, or private
deployment context.

`remote-mcp-live-readiness:smoke` is the stricter operator gate for a real central Recallant server.
It uses `RECALLANT_LIVE_REMOTE_MCP_SERVER_URL`,
`RECALLANT_LIVE_REMOTE_MCP_CREDENTIAL`, `RECALLANT_LIVE_REMOTE_MCP_PROJECT_ID`,
`RECALLANT_LIVE_REMOTE_MCP_DEVELOPER_ID`, and `RECALLANT_LIVE_REMOTE_MCP_CLIENT_ID`. With complete
inputs it requires HTTPS, derives `/api/mcp` through the shared contract helper, runs
`recallant remote-doctor`, and performs a remote bridge `tools/list` roundtrip from a scrubbed
child-process environment. With no live inputs it reports `skipped_live_remote_mcp_readiness`; with
partial or invalid inputs it fails explicitly. It must not print raw credentials, DB URLs, provider
secrets, private paths, raw artifact paths, or backup paths.

## 4) Scope Validation

Remote access must enforce strict project/developer scope:

- Requests include both `project_id` and `developer_id` identity values.
- Credential metadata must resolve to the same project/developer pair.
- Credentials may optionally be bound to one `client_id`; client-scoped credentials must match the
  `X-Recallant-Client-Id` header.
- Credential/header scope mismatches return `INVALID_SCOPE_TOKEN`; attached-project binding
  mismatches return `PROJECT_SCOPE_MISMATCH`.
- Calls to projects in a different scope are denied.
Remote clients must not receive RECALLANT_DATABASE_URL or other raw storage credentials.

Scoped remote MCP credentials are not global Recallant access. They are stored as hash-only rows
with a non-secret prefix and lifecycle metadata. The beginner remote onboarding path is an
invite-command flow: `recallant invite /path/to/project --server-url https://memory.example.com`
creates a short-lived one-time invite, and the remote workstation runs the printed
`curl -fsSL https://memory.example.com/j/<token> | bash` command. The invite token is also stored
hash-only; redeeming it creates the scoped remote MCP credential and marks the invite used.
Operators can still create, list, rotate, and revoke credentials directly with
`recallant remote-credential <create|list|rotate|revoke>` for advanced/debug workflows. Create and
rotate print the raw credential only in that command output; list, audit, docs, and stored rows do
not include raw credential values or hashes.

Provisioning output is intentionally human-facing and copyable. Create and rotate responses may
show a one-time raw credential, a full remote client bootstrap command, a `recallant connect-remote`
command, and a rendered MCP config that runs `recallant remote-bridge` against HTTPS `/api/mcp`.
Human-facing surfaces must point people to the complete bootstrap command, not the raw bootstrap
script URL by itself. List and revoke responses use the `<scoped-remote-mcp-credential>` placeholder
and remain redacted. Protected Workbench/API provisioning routes follow the same rule: no
credential provisioning route is exposed, scope is checked before lifecycle actions, and raw
credentials are not stored outside the immediate create/rotate or invite-redeem response.

## 5) Audit and Redaction

Recallant records a redacted, bounded audit envelope for each remote MCP request.

### Allowed audit fields

- `trace_id`
- `request_id`
- `project_id`
- `developer_id`
- `client_id`
- `credential_id`
- `credential_prefix`
- `operation`
- `http_status`
- `duration_ms`
- `error_code`

### Redaction policy

- `client_secret`, `authorization`, `session_secret`, `raw_auth` -> redacted
- `authorization` bearer token -> replaced with `[REDACTED]`
- `RECALLANT_DATABASE_URL` -> replaced with `[REDACTED]` and never emitted
- Request body -> bounded summary only (no raw payload)
- Remote MCP credential lifecycle events include project/developer/client scope, credential id, and
  credential prefix only; they do not include raw credential values or hashes.

### Forbidden raw values

Requests must never emit raw secret-like values, secrets, DB URLs, or provider keys in audit output.

`remote-mcp-provisioning:smoke` covers create/rotate one-time output, list/revoke redaction,
Workbench/API auth and scope failures, generated command/config leakage checks, and redacted
credential lifecycle audit events. `remote-mcp-bridge:smoke` covers the bridge happy path
(`initialize`, `tools/list`, and `tools/call`), wrong/revoked/rotated credentials, wrong
project/developer/client scope, forbidden payload blocking, required remote MCP headers, and no raw
credential fixture leakage outside the operator-provided Authorization/env boundary.
`remote-mcp-doctor:smoke` covers remote doctor JSON and human output, non-HTTPS and unreachable
endpoints, edge/access denial, invalid JSON/wrong endpoint, missing/invalid/expired/revoked/rotated
credentials, wrong project/developer/client scope, initialize/tools-list failure, capture proof
pass/warn/fail states, no DB URL dependency, and no raw fixture leakage in outputs.
`remote-mcp-security:smoke` aggregates the shipped contract, credential, bridge, provisioning, and
doctor smokes into one end-to-end security matrix covering unauthorized and missing Authorization,
wrong token, expired/revoked/rotated credentials, wrong project/developer/client, forbidden
client-provided DB/internal/provider/raw/backup surfaces, no remote DB URL requirement, capture proof
states, protected Workbench/API credential visibility, and redacted audit trail assertions.
`remote-mcp-external-rehearsal:smoke` adds deterministic isolated external-client evidence and an
opt-in live external rehearsal path with redacted output.
`remote-mcp-live-readiness:smoke` adds a central-server-only live gate with explicit skip/fail/pass
semantics.

## 6) Error Mapping

Error responses use a stable machine-readable `{ code, message }` shape plus HTTP status.

- `UNAUTHORIZED` -> `401`
- `MISSING_PROJECT_OR_DEVELOPER_SCOPE` -> `400`
- `INVALID_SCOPE_TOKEN` -> `401`
- `PROJECT_SCOPE_MISMATCH` -> `403`
- `PROJECT_NOT_ATTACHED` -> `404`
- `FORBIDDEN_HEADER` -> `400`
- `RATE_LIMITED` -> `429` (retryable)
- `UNAVAILABLE` -> `503` (retryable)
- `VALIDATION_ERROR` -> `400`

## 7) Rate Limits And Payload Size

Default profile values are contract constants:

- startup path: `60` calls/minute
- tool path: `120` calls/minute
- default response envelope size: `10485760` bytes (`10 MB`)
- request size warning threshold: `4194304` bytes (`4 MB`)
- hard payload limit: `8388608` bytes (`8 MB`)

Payloads above the hard limit must return `PAYLOAD_TOO_LARGE` and may include a retryable hint.
