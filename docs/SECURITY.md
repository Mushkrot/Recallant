# Security

Recallant stores development memory. That makes the default posture simple: private by default,
bounded by design, and conservative about secrets.

## Threat Model

| Threat | Default posture |
|--------|-----------------|
| Secret leakage into memory | Store secret references, never raw secret values. |
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

## Memory Governance

Agent-created memories can be useful immediately, but durable behavioral guidance requires stronger
authority. This protects maintainers from old or low-confidence context becoming hidden standing
instructions.

## Reporting Issues

Do not paste secrets or private memory exports into public issues. Report sensitive issues privately
through the project owner until a dedicated disclosure address is published.
