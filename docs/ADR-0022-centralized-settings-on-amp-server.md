# ADR-0022: Centralized settings on AMP server

## Status

Accepted, refined by [ADR-0034-controlled-settings-ui-in-v1.md](ADR-0034-controlled-settings-ui-in-v1.md)

## Context

AMP will have a management UI on the AMP server and may later be accessed through a Cloudflare-managed subdomain. The owner needs to manage multiple projects from one place and then open a specific project to inspect or change its settings.

This creates an important boundary: settings must not be scattered across project folders as the source of truth. Local project files should help agents find the right AMP project, but they should not become the authoritative policy store.

## Decision

System settings live centrally on the AMP server.

AMP settings are stored and managed primarily in the AMP server database, with secrets and infrastructure bootstrapping kept in environment variables or a secret store.

The settings hierarchy is:

1. **Server settings**: AMP server/runtime defaults and deployment mode.
2. **Developer/global settings**: owner-wide defaults across projects.
3. **Project settings**: settings for one managed project.
4. **Session/task overrides**: temporary settings for one session or task.
5. **Client adapter settings**: target-specific configuration for Codex, Cursor, Claude Code, Windsurf, and future clients.

The management UI must start from a project list when the owner is not already inside a project. From there, the owner can open a specific project and view or edit its project settings.

The v1 Settings UI is controlled rather than fully administrative. It can edit practical project settings, while sensitive/server/global settings are read-only or confirmation-gated; see [ADR-0034-controlled-settings-ui-in-v1.md](ADR-0034-controlled-settings-ui-in-v1.md).

Local `.amp/config` remains a pointer only:

```yaml
project_id: "..."
amp_server_url: "..."
```

It is not the source of truth for capture policy, context budget, model routing, or review behavior.

## Resolution Order

When AMP needs an effective setting, it resolves in this order:

1. explicit session/task override,
2. project setting,
3. developer/global setting,
4. server default,
5. built-in implementation default.

The effective source should be inspectable in UI/CLI, so the owner can see why a project is using a specific value.

## Consequences

- Cloudflare/subdomain access can show all managed projects and then project-specific settings.
- A project folder does not need to store full policy state.
- Changing a project setting in the UI affects future behavior for that project according to each setting's semantics.
- Settings changes should be auditable enough to understand who/what changed a project policy and when.
- `amp init` creates project records and pointer files, but settings remain centralized.

## Open questions

- Which settings need typed first-class columns versus generic JSONB key/value rows?
- What settings require immediate effect versus only future events?
- Which deeper server/infrastructure settings should later get dedicated admin flows?
