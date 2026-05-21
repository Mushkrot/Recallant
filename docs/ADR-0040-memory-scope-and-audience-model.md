# ADR-0040: Multi-axis memory scope and audience model

## Status

Accepted

## Context

Question 12 covered where imported, discovered, captured, and governed memories are allowed to apply, and who may consume them.

The initial data model used a simple `scope=project|developer` distinction. That is useful but too narrow for the owner's real operating model:

- one Recallant instance may run on a particular server with local environment facts,
- the current `/ai` layout and `/opt/secure-configs/.env` are deployment-profile facts, not global Recallant truth,
- `/ai/SECURITY` owns server exposure while app repos own app behavior,
- connector/account bindings such as personal vs corporate Google Drive must be remembered,
- capability bindings such as Cloudflare DNS vs Zero Trust tokens must be distinct,
- client-specific guidance such as Codex-only/dormant Claude must not become universal all-agent policy.

## Decision

Recallant will use a **multi-axis scope and audience model**.

### Scope / applicability

Scope answers: where is this memory true or applicable?

Accepted scope kinds:

- `domain`: a broad memory domain such as `agent_work` or future `personal_life`.
- `developer`: durable owner-level preferences, lessons, and rules across projects.
- `environment`: facts about a specific Recallant installation/server/runtime.
- `project`: a logical project/workspace.
- `repo`: a concrete repository or checkout under a project.
- `subproject`: a bounded package/app/module inside a repo/workspace.
- `session`: current or recent session state and temporary facts.
- `connector_account`: a specific external account/context such as Google personal vs corporate.
- `capability`: a permitted operation backed by a provider/token/account, such as Cloudflare DNS management.
- `client_adapter`: client-specific guidance for Codex, Claude Code, Cursor, Windsurf, etc.

The older `project|developer` model remains the v1 default subset, but storage/API contracts must be able to represent the richer scope kinds through `scope_kind`, `scope_id`, and metadata.

### Audience / consumer

Audience answers: who or what may consume this memory?

Accepted audience kinds:

- `all_agents`
- `specific_client`
- `context_pack`
- `background_worker`
- `review_ui`
- `human_owner`
- `import_pipeline`
- `connector`

Examples:

- `CLAUDE.md` import: `scope_kind=project`, `audience=specific_client:claude_code`, not universal agent behavior.
- `/opt/secure-configs/.env` reference: `scope_kind=environment`, audience may include `context_pack`, `background_worker`, and `review_ui`, but never raw secret values.
- Corporate Google Drive binding for one project: `scope_kind=connector_account` plus project relation, audience includes agents working on that project and connector workers.
- Codex-only temporary mode: `scope_kind=client_adapter`, audience `specific_client:codex` plus review visibility.

### Use policy remains separate

Scope and audience do not decide authority by themselves. `use_policy` still controls how a memory may be used:

- `evidence_only`
- `recall_allowed`
- `instruction_grade`
- `do_not_use`

Only `accepted` + appropriate `use_policy` records can guide behavior. Candidate, stale, needs-review, rejected, or archived records remain bounded by governance policy.

## Retrieval and Context Pack behavior

When a session starts, the Context Pack Builder should compose:

- checkpoint/session state,
- relevant project/repo/subproject memories,
- relevant developer rules,
- relevant environment facts,
- relevant capability and secret references,
- relevant connector/account bindings,
- current client-adapter rules,
- optional bounded evidence excerpts.

It must not include:

- project memories from unrelated projects by default,
- environment facts from a different Recallant instance unless restoring/remapping,
- client-specific rules for the wrong client,
- connector/account bindings unrelated to the project/task,
- candidate or needs-review records as binding rules.

## Import behavior

ADR-0039 import preview must assign provisional `scope_kind`, `scope_id`, and `audience` for each import result. The preview must show high-risk or broad-scope assignments before write.

Broad or risky imports require review or explicit confirmation:

- developer scope,
- environment/server scope,
- connector/account bindings,
- capability/secret references,
- client-adapter rules that affect multiple clients,
- any `instruction_grade` proposal.

## Consequences

- Data model and APIs should evolve from simple `scope=project|developer` to explicit `scope_kind`, `scope_id`, and `audience` fields.
- The current server layout is modeled as `environment` facts for the first instance.
- Connector/account ambiguity is represented directly rather than hidden in prose docs.
- Context Pack Builder gains enough structure to avoid reading everything while still finding operational facts when blocked.
- Conflict resolution must compare memories within compatible scope/audience and understand broader/narrower scope precedence; see ADR-0041.

## Follow-up decisions

- Exact SQL representation for multi-audience records: enum/array/table.
- Whether `repo` and `subproject` are separate tables in v1 or represented as project metadata.
- Default scope inference rules for import preview.
- Exact conflict scoring/explanation details within ADR-0041's accepted priority model.
