# Remote MCP Contract Specification

This is the public contract for authenticated Recallant remote agent access.

Recallant includes a first authenticated `POST /api/mcp` JSON-RPC endpoint slice for scoped remote
agent calls plus a `recallant remote-bridge` stdio-to-HTTPS bridge for external MCP clients. It is
the remote runtime behind the universal existing-server beginner workflow.

## 1) Scope and Readiness Posture

Local stdio MCP (`recallant mcp-server`) remains the current production-ready agent path for
installed projects.

Remote project access includes the authenticated endpoint, DB-backed scoped credentials, strict
scope gate, redacted audit envelope, CLI-first provisioning output, protected Workbench/API
provisioning routes, `recallant remote-bridge`, `recallant connect-remote`, CLI-first
`recallant remote-doctor` diagnostics, and universal device-style pairing from
`curl -fsSL https://memory.example.com/connect | bash`. Deterministic endpoint, bridge,
provisioning, doctor, connect-cloud, and isolated external-client smokes cover the shipped slices.
Local stdio MCP remains the local self-host agent path; universal connect is the beginner path when
an external machine should attach a project to an existing central Recallant server.

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
- DB-backed scoped machine credential.
- Project and developer scope checks before any tool execution.
- Edge policy that keeps Workbench, admin, approval, credential-management, backup, provider, and
  raw-artifact routes behind Cloudflare Access or an equivalent human/admin gate. Agent runtime must
  not depend on a Cloudflare browser session; `/api/mcp` is authorized by the scoped Bearer
  credential plus project/developer/client scope.

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

- `Bearer` for agent runtime.
- `Cloudflare-Access` or equivalent for protected human/admin/approval surfaces.

## 3a) Remote Bridge Inputs

The bridge is configured from the operator's local client config or environment. It requires:

- `RECALLANT_REMOTE_MCP_URL`
- `RECALLANT_REMOTE_MCP_CREDENTIAL_REF` or the advanced/debug-only
  `RECALLANT_REMOTE_MCP_CREDENTIAL`
- `RECALLANT_PROJECT_ID`
- `RECALLANT_DEVELOPER_ID`
- `RECALLANT_REMOTE_MCP_CLIENT_ID`

It may also send:

- `RECALLANT_REMOTE_MCP_CREDENTIAL_STORE`
- `RECALLANT_REMOTE_MCP_SESSION_ID`
- `RECALLANT_REMOTE_MCP_TRACE_ID`

Remote bridge hosts must not receive `RECALLANT_DATABASE_URL`, Postgres access, internal server
paths, Workbench/admin auth, raw artifacts, backups, provider secrets, or raw deployment overlays.
Generated beginner configs store only a credential reference and resolve the raw scoped credential
from the user's local Recallant credential store. The bridge rejects forbidden local secret/storage
config and forbidden tool-argument payload fields before forwarding a memory tool call.

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
- Optional session/context readiness proof through remote MCP `tools/call`.
- Optional checkpoint state proof.
- Optional governed semantic-memory proof.

Use placeholder-only commands in docs and runbooks:

```bash
recallant remote-doctor --project-dir . --format json
```

When a project-local remote MCP config exists, `remote-doctor` can infer the server URL, credential
reference, credential-store path, and project/developer/client scope from that project directory.
Explicit `--server-url`, `--credential-ref`, `--credential-store`, and scope flags remain available
for advanced/debug workflows. The explicit `--credential <scoped-remote-mcp-credential>` form is
only for cases where the operator intentionally provides the raw secret boundary.

Add `--capture-proof` only when the operator wants remote MCP session/context readiness evidence.
This uses `memory_start_session` and `memory_get_context_pack` and is reported separately from
transport, auth, and scope. Add `--semantic-proof` when the operator wants the stricter governed
marker proof. That mode also reports checkpoint state proof through `memory_set_checkpoint` /
`memory_get_checkpoint`, then creates one non-secret `memory_create_agent_memory` marker and recalls
it with `memory_recall_agent_memories`. The diagnostic marker body is synthetic; the governed memory
uses `memory_type: "work_log"`, `scope: "project"`, `created_by: "agent"`,
`audience: [{ "kind": "all_agents", "id": null }]`, and `diagnostic_marker: true` metadata.

`memory_start_session` reports unfinished prior work as session recovery, not checkpoint failure. The
legacy-compatible `previous_unclosed_session` field contains diagnostic details, while
`previous_session_recovery` contains the plain guidance an agent should show or follow. The agent
should review current-project checkpoint/events for continuity, check for fresh parallel work, and
avoid presenting stale recovery context as an error.

Interrupted session counts are recovery debt, not capture proof failure. If a later scoped cycle has
fresh context-read, memory-write, and checkpoint evidence, readiness may still report
`capture_active` while also surfacing the interrupted-session count.

`memory_get_readiness_status` returns the bounded readiness contract used by Workbench and remote
`agent-start`: configured, context, semantic proof, capture, ingestion, timestamps, and review-state
counts. It must not return raw memories, raw project files, credentials, artifacts, backups, or bulk
summaries. A checkpoint-only timestamp is not semantic memory proof, and a semantic proof timestamp is
not `capture_active` unless the full capture loop has also been observed.

A `memory_set_checkpoint` / `memory_get_checkpoint` round trip proves checkpoint state, not semantic
memory recall. The baseline checkpoint parity contract keeps `memory_set_checkpoint` state-only by
default; its output reports `checkpoint_state_only: true` and
`searchable_memory_created: false`. Searchable checkpoint memory requires the explicit high-level
`memory_agent_checkpoint` tool. That tool updates checkpoint state, appends a checkpoint event when
a `session_id` is available, creates a governed `memory_type: "checkpoint"` memory with source
refs, and returns the generated `memory_id`. Use `memory_create_agent_memory` for ordinary governed
facts, decisions, procedures, and work logs, not for implicit checkpoint closeout. The deterministic
diagnostic coverage is `npm run remote-mcp-doctor:smoke`; the local MCP parity proof is
`npm run phase6:smoke:governed`.

When Recallant is configured and consent allows agent-authored memory, agents must use the MCP
memory lifecycle by default: start a session, read `memory_get_context_pack`, write concise governed
decisions/actions/tests/work logs, and close out with `memory_closeout`. `memory_closeout` is the
normal MCP closeout path: it updates checkpoint state, creates or verifies searchable closeout
memory, runs recall verification, and reports next-session readiness semantics. Use
`memory_agent_checkpoint` only when the checkpoint itself should become searchable governed
checkpoint memory. Bulk project import, raw logs, customer data, raw artifacts, database URLs,
provider secrets, and existing-file summarization remain approval-gated.

## 3c) Governed Memory Tool UX

`tools/list` must make governed memory creation usable without trial-and-error. The
`memory_create_agent_memory` description and schema expose `title`, `body`, `created_by`, and the
recommended project-wide audience shape:

```json
[{ "kind": "all_agents", "id": null }]
```

Safe semantic marker proof uses a tiny synthetic memory, not project contents:

```json
{
  "memory_type": "work_log",
  "scope": "project",
  "audience": [{ "kind": "all_agents", "id": null }],
  "title": "Safe Recallant semantic marker",
  "body": "Synthetic non-secret marker recallant_safe_semantic_marker_example for create+recall proof.",
  "confidence": 1,
  "source_refs": [],
  "created_by": "agent",
  "metadata": {
    "diagnostic_marker": true,
    "contains_raw_secret": false
  }
}
```

The matching recall query is similarly bounded:

```json
{
  "query": "recallant_safe_semantic_marker_example",
  "scope": "project",
  "memory_types": ["work_log"],
  "include_candidates": true,
  "include_needs_review": true,
  "top_k": 5,
  "max_chars_total": 4000
}
```

Validation errors must be actionable and redacted. Passing `audience` as a string returns a
`VALIDATION_ERROR` that says the expected shape is an array of objects like
`[{ "kind": "all_agents", "id": null }]`. Missing `title` or `body` returns a field-specific
required-field message. These messages must not echo raw request bodies, raw secrets, credentials,
customer data, private keys, backups, raw artifacts, large logs, database URLs, auth headers, or
provider keys.

## 3d) Governed Graph Candidate Tools

The graph candidate tool surface is a governed staging path for proposed graph nodes and edges. It
does not make candidate data retrieval-active by default, and accepting a candidate records review
state without automatically inserting an `edges` row.

The first candidate tools are:

- `memory_create_graph_candidate` - create a project-scoped node or edge candidate with lifecycle
  state, scope, audience, confidence, extraction method, creator provenance, bounded metadata, and
  source refs.
- `memory_list_graph_candidates` - list candidates for the scoped project with optional lifecycle,
  kind, scope, and pagination filters.
- `memory_get_graph_candidate` - read one candidate plus its source refs and review history inside
  the scoped project.
- `memory_review_graph_candidate` - record review actions such as accept, reject, archive,
  unarchive, mark stale, edit, merge, or supersede while preserving the original candidate row.

Agent-generated and import-generated candidates require source refs. Tool handlers must keep project
scope explicit, reject wrong-project access, and block raw secrets, database URLs, provider tokens,
raw credentials, raw artifacts, customer data, private keys, backups, auth headers, cookies, and
private deployment details from candidate payloads and responses.

## 3e) External Rehearsal

`remote-mcp-external-rehearsal:smoke` proves the shipped remote client path from a scrubbed
external-like child-process environment. It uses HTTPS `/api/mcp`, `recallant connect-remote`,
`recallant remote-bridge`, `recallant remote-doctor`, scoped credential auth, project/developer/client
scope, optional session/trace headers, initialize, tools/list, tools/call, capture proof
pass/warn/fail states, semantic marker proof, wrong/revoked/rotated credential failures, wrong
project/developer/client failures, and output leakage checks.

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

`remote-live-external-canary:smoke` is the automated remote-client regression gate before manual
remote-client checks. It deterministically exercises controller provisioning, a scrubbed fake
external HOME/project, `connect-cloud` bootstrap behavior, project-local credential references,
`agent-start` `remote_mcp_ready`, `remote-acceptance --semantic-proof`, local evidence validation,
opt-in server trace validation, and regression cases for no CLI, stale CLI, already-connected
credential refs, missing evidence directories, reconnect idempotency, forbidden local-storage paths,
and incomplete live inputs. The live command is operator-controlled and uses placeholder-only inputs
in public docs:

```bash
RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL=<https-recallant-server> \
RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL=<server-local-controller-url> \
RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN=<controller-auth-token> \
RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID=<developer-id> \
RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE=1 \
npm run remote-live-external-canary -- --live --json
```

The optional controller URL is for server-local protected provisioning and validation only; it must
not be sent to the external child. The external child uses the public HTTPS server URL and must not
receive `RECALLANT_DATABASE_URL`, Postgres access, Workbench/admin auth, provider secrets, raw
artifacts, backups, raw scoped credential values, bootstrap token values in output, controller auth
tokens, or private topology. If server trace validation is not enabled, the canary reports
`server_trace_validation_skipped` and `not_release_pass`; that is a diagnostic result, not a remote
release gate pass. Server trace validation checks the redacted remote MCP audit envelope plus central
DB facts for sessions, accepted memory, checkpoint, and next-session recall; it does not require raw
tool-call bodies or secret-bearing audit metadata.

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
with a non-secret prefix and lifecycle metadata. The beginner remote onboarding path is a
device-pairing flow: the remote workstation runs
`curl -fsSL https://memory.example.com/connect | bash`, receives an approval URL, and waits while
the owner approves through the protected central server. The approved poll response creates and
returns the scoped remote MCP provisioning package once. First approval can register a local trusted
device key; later projects from the same trusted workstation use signed nonce challenges rather than
another Cloudflare browser approval. Headless servers can redeem short-lived one-time bootstrap
tokens through the same public start/poll boundary. The existing invite-command flow remains an
advanced/admin fallback: `recallant invite /path/to/project --server-url https://memory.example.com`
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
credentials, wrong project/developer/client scope, initialize/tools-list failure, session/context
readiness proof pass/warn/fail states, checkpoint state proof, governed semantic marker proof, no
DB URL dependency, and no raw fixture leakage in outputs.
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
