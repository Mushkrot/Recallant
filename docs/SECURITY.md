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
- Public Workbench readiness requires an auth-protected private origin plus authenticated edge
  access. Do not make the Workbench public by changing the default bind host.

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
secret file permissions, rollback confirmation, redacted local backups, and static checks that the
runtime Workbench smoke keeps exercising secret and route exposure cases. The public security smoke
also scans public docs and public runtime/install code for owner-only paths and deployment markers so
private overlays stay out of the OSS surface.

## Reporting Issues

Do not paste secrets or private memory exports into public issues. Report sensitive issues privately
through the project owner until a dedicated disclosure address is published.
