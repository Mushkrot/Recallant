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
| Paid API surprises | Require explicit approval unless a project changes policy. |
| Destructive action overreach | Require dry-run and confirmation paths. |
| Huge tool output or raw artifacts | Store bounded excerpts plus hashes/pointers. |
| Backup exposure | Keep backups private and avoid raw secret material in manifests. |

## Public Defaults

- MCP uses local stdio by default.
- The Workbench is intended for localhost, private networks, or protected reverse proxy setups.
- Remote admin/API access must require authentication.
- No unauthenticated public route should expose the Workbench, MCP tools, backups, raw artifacts, or
  provider settings.

## Credentials

Recallant credentials belong in env files or a secret store. Project repositories should contain
only references such as variable names or configuration labels.

Browser clients must never receive provider API keys, database passwords, session secrets, auth
tokens, or connector secrets.

## External Services And Deployment Profiles

Projects may need to remember that an external service, private access provider, server inventory,
or connector account exists. Recallant should store those as references and policy records, not as
raw authorization material.

Using a capability can still require confirmation, local operator action, or a separate connector
binding flow. A recalled note that a service exists is evidence, not permission to expose a public
route, spend money, delete data, or bypass a private access boundary.

## Memory Governance

Agent-created memories can be useful immediately, but durable behavioral guidance requires stronger
authority. This protects maintainers from old or low-confidence context becoming hidden standing
instructions.

## Automated Security Review

The public security review is executable, not only narrative. Run:

- `npm run public-security:smoke`
- `npm run security-review:smoke`
- `npm run review-ui:smoke`
- `npm run public-install-rollback:smoke`

Together these cover install/auth/Workbench/backups/secrets: private-by-default HTTP binding,
Cloudflare/private access preconditions, Workbench auth, browser-facing secret redaction, generated
secret file permissions, rollback confirmation, redacted local backups, and static checks that the
runtime Workbench smoke keeps exercising secret and route exposure cases.

## Reporting Issues

Do not paste secrets or private memory exports into public issues. Report sensitive issues privately
through the project owner until a dedicated disclosure address is published.
