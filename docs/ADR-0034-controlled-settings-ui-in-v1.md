# ADR-0034: Controlled Settings UI in v1

## Status

Accepted

## Context

Settings already live centrally on the Recallant server. The owner needs to change practical project behavior without editing local files or asking an agent to patch config by hand.

At the same time, a full low-level admin settings UI would be risky too early: it could expose secrets, infrastructure toggles, storage internals, and provider controls before the product is hardened.

## Decision

Use **Option B: controlled Settings UI** in v1.

The Settings UI is editable for practical project-level workflow settings, while sensitive/global/server settings are read-only or confirmation-gated.

## Editable Project Settings In V1

The owner can edit these for the selected project:

- capture profile: `light`, `standard`, `detailed`, `custom`,
- context budget profile,
- review sensitivity / candidate-rule aggressiveness,
- model routing mode and route enablement:
  - `local_model`,
  - `active_agent`,
  - `subscription_worker`,
  - `paid_api_provider`,
- `paid_api_mode`: `disabled` or `confirm_each` by default,
- project paths and aliases,
- enabled/known client adapters,
- project-specific import candidates visibility,
- Cost / Paid API dashboard preferences that do not weaken approval policy.
- natural-language management chat enablement and allowed action classes,
- local model provider endpoint/status labels such as configured Ollama URL,
- safe capability/secret reference labels, never raw secret values.

## Confirmation-Gated Settings

These changes require explicit confirmation and clear warning text:

- enabling paid API if disabled,
- enabling future `auto_with_caps`,
- enabling or changing a subscription worker,
- changing developer/global settings that affect multiple projects,
- increasing capture detail significantly,
- increasing context budget enough to risk flooding agent context,
- enabling preview/experimental models,
- changing model routes for quality-critical tasks,
- changing settings that affect cost, privacy, security, or long-term agent behavior.
- enabling chat execution for anything beyond read-only/propose mode,
- changing connector/account bindings such as personal versus corporate Google Drive,
- changing local model provider endpoints when it could affect privacy/cost/quality.

## Read-Only / Status-Only In V1

These are visible but not directly editable in the normal v1 Settings UI:

- raw provider API keys and secrets,
- database connection strings,
- backup encryption keys,
- low-level Postgres/index/storage internals,
- auth/session secret material,
- Cloudflare secret values,
- destructive retention/delete policies unless a future dedicated flow is designed.
- raw contents of shared secret files such as `/opt/secure-configs/.env`.

The UI may show safe status, labels, and secret references such as `configured` or `missing`, but not raw secret values.

## Semantics

- Changing a project setting affects only that project.
- Most setting changes affect future behavior only.
- Existing captured records are not reprocessed automatically unless an explicit reprocess workflow is requested.
- Every settings change writes a `settings_audit_events` row.
- The UI and CLI must show effective value and source: session override, project setting, developer/global default, server default, or built-in default.

## Consequences

- The owner can manage daily Recallant behavior without hand-editing files.
- The UI remains safe enough for v1.
- Dangerous changes are possible only with explicit confirmation and audit.
- Full server/infrastructure administration remains future work.
