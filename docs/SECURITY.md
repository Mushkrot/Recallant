# Security

Recallant stores development memory. That makes the default posture simple: private by default,
bounded by design, and conservative about secrets.

## Threat Model

| Threat | Default posture |
|--------|-----------------|
| Secret leakage into memory | Store secret references, never raw secret values. |
| Unsafe capability reuse | Treat connector, deployment, and external service bindings as governed capabilities. |
| Cross-project context contamination | Scope recall to the current memory space by default. |
| Prompt injection through old memory | Treat recalled text as evidence, not automatic instruction. |
| Silent rule promotion | Block instruction-grade memory unless authority is explicit. |
| Public admin exposure | Keep Workbench/admin/MCP private by default. |
| Paid or cloud model surprises | Require explicit approval unless a project changes policy. |
| Destructive action overreach | Require dry-run, exact confirmation tokens, and redacted receipts. |
| Huge tool output or raw artifacts | Store bounded excerpts plus hashes/pointers. |
| Backup exposure | Keep backups private and avoid raw secret material in manifests. |

## Public Defaults

- MCP uses local stdio by default.
- The Workbench is intended for localhost, private networks, or protected reverse proxy setups.
- Remote admin/API access must require authentication.
- No unauthenticated public route should expose the Workbench, MCP tools, backups, raw artifacts, or
  provider settings.
- Cloudflare Access or an equivalent edge gate protects human/admin/approval surfaces such as the
  Workbench, `/connect/approve`, credential-management, backup, provider, and raw-artifact routes.
  Agent runtime does not use a Cloudflare browser session; it uses scoped machine credentials.
- Public agent routes are limited to the universal connect bootstrap/start/poll/cancel path,
  bootstrap-token redemption through `/api/connect/start`, invite redemption, and `/api/mcp` with
  scoped Bearer credentials. They must not expose Workbench/admin capabilities.
- Remote MCP/agent endpoints require explicit DB-backed scoped credentials plus
  project/developer/client scope before tool execution. Credentials are project/developer scoped,
  optionally client scoped, revocable, rotatable, hash-stored, and audited without raw credential
  values. Universal connect registers a local trusted-device key after first human approval, uses
  signed nonce challenges for trusted-device reconnect, supports one-time headless bootstrap tokens,
  writes generated project config with a local credential-store reference, and does not expose
  Postgres, Workbench/admin auth, raw artifacts, backups, provider secrets, or raw scoped
  credentials to the project.
- Public examples may name prohibited classes such as `.env` files, raw credentials, private keys,
  customer data, backups, raw artifacts, database URLs, and provider secrets, but they must not
  include concrete values for those classes. Use placeholders such as
  `<scoped-remote-mcp-credential>` or `<redacted>` when showing operator input.
- Public Workbench readiness requires an auth-protected private origin plus authenticated edge
  access. Do not make the Workbench public by changing the default bind host.
- Production readiness treats stopped services, disabled restart behavior, missing service env
  files, failed private `/health` checks, public gateway errors, and anonymous Workbench exposure as
  separate service-runtime failures. Access-provider redirects or authentication challenges are
  acceptable public-route responses; unauthenticated Workbench content is not.

## Credentials

Recallant credentials belong in env files or a secret store. Project repositories should contain
only references such as variable names or configuration labels.

Browser clients must never receive provider API keys, database passwords, session secrets, auth
tokens, or connector secrets.

Production service managers should reuse the same private Recallant storage profile as the CLI.
When a service env file is configured through `RECALLANT_SERVICE_ENV_FILE`, `recallant doctor`
reports only a redacted `service_env_profile` status, safe database components, and mismatch labels.
It must never print raw database passwords, auth tokens, session secrets, or a full credentialed
database URL.

## System Activity Ledger

Recallant records a redacted system activity ledger so an owner can audit what the system did across
CLI commands, MCP tools, Workbench HTTP routes, model/capture health, settings changes, and project
cleanup flows.

The ledger is diagnostic evidence, not a raw request log. Entries store operation names, status,
timing, trace ids, project/session links when allowed, error codes, and redacted metadata. Request
bodies, auth headers, cookies, provider keys, database URLs, raw environment values, and secret-like
strings must not be stored in ledger rows or shown in audit reports. Health, favicon, robots, and
other noise routes are intentionally excluded rather than logged as user activity.

`recallant audit` and the Workbench Audit view summarize that ledger with bounded windows, filters,
failure/slow-operation sections, model/capture health, and timeline rows. They are owner/admin
surfaces and must remain behind the same private/authenticated Workbench posture as the rest of the
management UI.

Project purge must account for the ledger without pretending governed operations never happened.
Project-scoped content records are removed according to the dry-run plan, but system activity rows
are retained only as de-identified governance evidence: project and session links are cleared, and
the redacted receipt records the purge. Backups include the ledger table so restore verification can
audit history, while manifests continue to exclude raw secrets.

## Agent Observation Boundary

Agent observations are project content, not an unrestricted raw log. They can contain bounded
visible prompts and responses, meaningful tool summaries, errors, retries, remediation, and
verification evidence. They must not contain hidden chain-of-thought, auth headers, cookies,
credentials, provider keys, database URLs, private environment values, or unrestricted terminal
output. Optional rationale is limited to a short owner-visible explanation.

Every observation is bound to a project and session. The Workbench read model applies that project
scope, uses bounded result windows, and keeps technical metadata collapsed. Bodies and metadata
pass through secret redaction before durable storage. The Workbench and its APIs remain on the same
private/authenticated management boundary as other project data.

Observation retention defaults to 30 days and can be set with
`RECALLANT_AGENT_OBSERVATION_RETENTION_DAYS`. Native backups include observations. A confirmed
targeted forget redacts selected observation content while keeping a content-free correlation
envelope; a confirmed project purge removes all observation rows for that project. The system
activity ledger remains separately de-identified governance evidence after purge.

## External Services And Deployment Profiles

Projects may need to remember that an external service, private access provider, server inventory,
or connector account exists. Recallant should store those as references and policy records, not as
raw authorization material.

Using a capability can still require confirmation, local operator action, or a separate connector
binding flow. A recalled note that a service exists is evidence, not permission to expose a public
route, spend money, delete data, or bypass a private access boundary.

Ollama-hosted cloud model tags, including `*:cloud` model names, are external model capabilities.
They should not be treated as local Ollama readiness requirements or silent local-model fallbacks.
Retrying a cold local Ollama embedding call is still local-model behavior. If local Ollama remains
unavailable, Recallant records `UNAVAILABLE` and leaves chunks pending; it must not switch to paid or
external embedding providers without the normal explicit approval path.

## Memory Governance

Agent-created memories can be useful immediately, but durable behavioral guidance requires stronger
authority. This protects maintainers from old or low-confidence context becoming hidden standing
instructions.

## Scoped Content Erasure

Targeted erasure is separate from whole-project purge. `memory_forget` can select one current-project
event, chunk, governed memory, or raw-artifact reference by ID, a bounded current-project search,
or an exact scope kind and scope ID. Search and scope selection fail closed at their match limit.

- The first pass is a no-write dry-run that returns affected counts, a content-free selection
  digest, and a confirmation token.
- Broad execution requires the exact token, re-resolves the selection inside one transaction, and
  rejects stale confirmation rather than erasing a changed result set.
- Selected content and Recallant-controlled dependents are redacted or removed, including text,
  metadata, source quotes, artifact references, embeddings, graph edges, review history, recall
  traces, and matching checkpoint state.
- The retained receipt contains only bounded governance identifiers, counts, flags, and the
  selection digest. It does not retain the reason, query, selector, deleted content, URI, quote,
  metadata, or embedding.
- Owner-controlled external files or objects are not deleted. Recallant erases its references and
  reports that boundary explicitly.
- Raw query or task-hint text is not persisted in recall traces or context-read audit events; only
  hash, length, and redaction metadata remain, so verification cannot recreate erased text.

Redacted rows act as non-content tombstones where referential integrity or governance history must
remain. Repeating a direct erasure is therefore safe and does not restore or duplicate content.

## Project Sanitization

Project cleanup is intentionally split into non-destructive detach and irreversible purge.

- Detach hides a project from normal Recallant views/search and closes active sessions, but does not
  physically delete Recallant records.
- Project purge is the clean-slate path for disposable or wrongly attached projects. It is dry-run
  first, requires an exact confirmation token, and stores only a redacted receipt.
- Stale local project metadata must not hide the real target. Sanitize dry-runs report stale
  `project_id` values and, when safe, resolve the managed project by path before issuing the
  confirmation token.
- If the database no longer contains the project, local-only cleanup requires the explicit
  `--allow-orphan-local` opt-in and reports `writes_database: false`.
- Local disconnect may remove or update Recallant-generated artifacts such as `.recallant/` pointer
  files, generated hooks, offline spool files, MCP config, and generated bootstrap sections. It must
  not delete source files, secrets, downloads, or arbitrary project data.
- Chat and agent surfaces should guide users to the dry-run/confirm flow rather than executing
  destructive project cleanup directly.

## Automated Security Review

The public security review is executable, not only narrative. Run:

- `npm run public-security:smoke`
- `npm run security-review:smoke`
- `npm run review-ui:smoke`
- `npm run public-install-rollback:smoke`

Together these cover install/auth/Workbench/backups/secrets: private-by-default HTTP binding,
Cloudflare/private access preconditions, Workbench auth, browser-facing secret redaction, generated
secret file permissions, scoped machine-credential routing for agents, rollback confirmation,
redacted local backups, and static checks that the runtime Workbench smoke keeps exercising secret
and route exposure cases. The public security smoke also scans public docs and public runtime/install
code for owner-only paths and deployment markers so private overlays stay out of the OSS surface.

## Reporting Issues

Do not paste secrets or private memory exports into public issues. Report sensitive issues privately
through the project owner until a dedicated disclosure address is published.
