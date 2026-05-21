# Settings architecture

This document defines where Recallant settings live and how effective settings are resolved.

## 1. Principle

Recallant server is the source of truth for settings.

Local project files only identify the project and route the agent to Recallant:

```yaml
project_id: "..."
recallant_server_url: "..."
```

Do not store full capture policy, model routing, context budget, or review behavior in each project repository as the authoritative copy. Otherwise projects drift and agents read stale policy.

## 2. Settings levels

Settings are layered:

| Level | Purpose | Examples |
|-------|---------|----------|
| Server | Runtime/deployment defaults | ports, private bind address, Cloudflare mode, auth mode, default model router mode, backup targets |
| Developer/global | Owner-wide defaults | default capture profile, default context policy, default review preferences |
| Project | One project only | capture profile, context budget, heartbeat/stale policy, model overrides, enabled clients, project paths |
| Session/task override | Temporary | detailed capture for one session, cloud closeout for one task, long-running heartbeat status |
| Client adapter | Target-specific wiring | Codex MCP config hints, Cursor config path, Claude Code adapter metadata |

Secrets and bootstrap credentials are not ordinary settings. They should live in environment variables or a secret store. The database may store only safe references or non-secret metadata.

Security/access settings should include safe metadata only:

- bind mode: `localhost`, `tailnet`, or explicit configured interface,
- Recallant auth mode and non-secret policy metadata,
- token/session lifetime policy,
- allowed origins for future Cloudflare/subdomain mode,
- Cloudflare mode flag and safe route labels,
- secret references, not raw secret values.

Session/heartbeat settings should include configurable policy values:

- stale-session threshold,
- interrupted-session threshold,
- suggested heartbeat interval for long-running tasks,
- whether clients should emit heartbeat for long commands/tests by default,
- maximum size for heartbeat note/metadata.

These values are profile/settings defaults, not architecture constants.

## 3. Resolution order

Effective settings resolve in this order:

1. session/task override,
2. project setting,
3. developer/global setting,
4. server default,
5. built-in implementation default.

The UI and CLI must be able to show both the final value and where it came from.

Example:

```text
capture_profile = detailed
source = project_settings
project = "Memories"
previous/default = developer_settings.standard
applies_to = future capture only
```

## 4. Management UI behavior

When the owner opens the management UI through Tailscale/SSH tunnel or a future Cloudflare subdomain, the top-level view should support multiple projects. Future Cloudflare access should be treated as a near-future deployment mode, but the default v1 setting remains private-by-default and Recallant-authenticated.

Default path:

```text
/projects
  -> list managed projects
/projects/:project_id/review
/projects/:project_id/settings
/projects/:project_id/sessions
/projects/:project_id/capture
```

The Review Inbox may open inside the last/current project, but there must be a clear project selector because the same Recallant server manages multiple projects.

## 4.1 Controlled Settings UI

v1 uses a **controlled Settings UI**. The owner can edit practical project-level behavior, but the UI is not a full server/infrastructure admin console.

Editable project settings in v1:

- capture profile: `light`, `standard`, `detailed`, `custom`,
- context budget profile,
- review sensitivity / candidate-rule aggressiveness,
- model routing mode and route enablement,
- `paid_api_mode`: `disabled` or `confirm_each` by default,
- project paths and aliases,
- enabled/known client adapters,
- project-specific import candidate visibility,
- safe Cost / Paid API dashboard preferences.

Confirmation-gated settings:

- enabling paid API,
- enabling future `auto_with_caps`,
- enabling or changing a subscription worker,
- editing developer/global settings that affect multiple projects,
- increasing capture detail significantly,
- increasing context budget enough to risk context flooding,
- enabling preview/experimental models,
- changing model routes for quality-critical tasks,
- changing any setting that can increase cost, reduce privacy/security, or change long-term agent behavior.

Read-only/status-only in normal v1 UI:

- raw provider API keys and secrets,
- database connection strings,
- backup encryption keys,
- auth/session secret material,
- low-level Postgres/index/storage internals,
- Cloudflare secret values,
- destructive retention/delete policies unless a future dedicated flow is designed.

The UI may show safe status and secret references such as `configured`, `missing`, or a secret label. It must not show raw secret values.

## 5. Project settings

Project settings should include at least:

- capture profile: `light`, `standard`, `detailed`, `custom`,
- context budget profile,
- enabled/known clients,
- project paths and aliases,
- repo contract status: `.recallant/config`, `AGENTS.md`, `PROJECT_LOG.md`,
- local spool/sync status,
- import candidates,
- model routing overrides,
- review behavior and candidate-rule aggressiveness.

Backup/restore settings should include at least:

- backup enabled/disabled,
- backup schedule,
- local backup target path/label,
- encryption status/key reference (not the raw key),
- restore verification schedule,
- future second-server target label/path/transport,
- retention windows once they are decided.

Model routing settings should include at least:

- `model_router_profile`: e.g. `subscription_first_api_last`, `balanced_default_openai_api`, `cost_speed_gemini_2_5`, `cheap_claude_haiku`, `quality_claude_explicit`, `local_only`, `custom`,
- provider enablement: `ollama`, `openai`, `gemini`, `anthropic`,
- route-class enablement: `local_model`, `active_agent`, `subscription_worker`, `paid_api_provider`,
- baseline paid API provider, default `openai`,
- per-purpose model routes: embeddings, extraction, intent detection, closeout, review assistance, consolidation,
- subscription worker enablement and safe credential reference, if configured,
- subscription limit behavior: `defer`, `downgrade_local`, `ask_before_paid_api`,
- `paid_api_mode`: `disabled` \| `confirm_each` \| `auto_with_caps`; default `confirm_each`,
- preview/experimental model policy,
- cost ceilings per day/job/project where configured,
- paid API escalation policy and fallback order,
- confirmation requirements before paid API is used.

Cost dashboard settings should include at least:

- dashboard enabled for paid API monitoring; v1 default `enabled`,
- provider pricing metadata source or manually configured price table,
- cost display currency,
- default dashboard time ranges: day/month/project,
- alert thresholds for unusual paid API activity,
- whether `auto_with_caps` is allowed at all on this Recallant instance.

The baseline model portfolio is defined in [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md). Exact provider/model choices are settings, not hard-coded business logic.

Changing a project setting affects only that project unless the UI action explicitly edits developer/global settings.

Most settings affect future behavior only. Existing captured records are not reprocessed automatically unless an explicit reprocess workflow is requested.

## 6. Local project files

`.recallant/config` is a local pointer and should not be committed by default.

`AGENTS.md` stays thin and tells agents how to use Recallant tools.

`PROJECT_LOG.md` stays a human-readable checkpoint.

Full settings live in Recallant server/Postgres and are managed through UI/CLI/API.

## 7. Audit

Settings changes should be recorded with enough information to debug behavior later:

- setting key,
- scope/level,
- old value or redacted old value,
- new value or redacted new value,
- actor kind,
- timestamp,
- reason/note if provided.

The audit log does not need to store secrets.
