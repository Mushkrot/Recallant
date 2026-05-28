# ADR-0044: Controlled cross-project recall

## Status

Accepted

## Context

The owner often solves a problem in one project and later needs the same pattern in another project:
Google Drive access, Cloudflare setup, server deployment, secret-reference location, model routing,
or other operational knowledge. Today the owner tells the agent to inspect another nearby project
folder. Recallant should make this easier and faster.

The owner does not want automatic memory mixing. One project's stale docs or local decisions must
not silently become another project's rules.

## Decision

Recallant treats project memory as **isolated by default and reusable by explicit intent**.

The default is narrow. Recallant should not automatically inject examples from other projects into
ordinary startup context. Agents may decide to ask for cross-project examples when the task clearly
needs a prior pattern.

The default context pack for project A may include:

- project/repo/subproject memories for project A;
- developer-scope preferences/rules that were intentionally promoted;
- environment facts for the current Recallant instance;
- relevant capability, connector-account, and secret-reference records.

It must not include ordinary project memories from unrelated project B by default.

Agents may request cross-project recall when the task indicates that a prior pattern is useful, for
example:

- "Find how I connected Google Drive in another project."
- "Look for a prior Cloudflare Access setup."
- "Find similar deployment docs from other `/ai` projects."
- "Show examples, not rules, for how this was solved before."

Cross-project results are **evidence**, not binding instructions, unless they are already accepted
developer/environment/capability records with an applicable `use_policy`.

## Retrieval modes

Recallant should expose explicit retrieval intent instead of overloading ordinary search:

- `same_project` - default project recall.
- `developer_rules` - intentionally promoted owner-level guidance.
- `environment` - current server/runtime facts and capability references.
- `similar_projects` - source-linked examples from other projects.
- `all_projects_review` - owner/review/debug mode for broad inspection.

The implementation may start with parameters on `memory_search` /
`memory_recall_agent_memories`, then add a higher-level helper when needed.

## Output requirements

Every cross-project hit must show:

- source project name/id;
- source path or external ref;
- scope kind and use policy;
- status such as accepted/candidate/needs_review/stale;
- why it was returned;
- whether it is an example, evidence, rule, environment fact, or capability binding;
- a warning when the record is not directly applicable to the current project.

## Promotion policy

A useful pattern from project B can become reusable for project A in three ways:

1. the agent uses it as source-linked evidence for a project-A implementation;
2. after applying it, the agent creates a project-A governed memory with source refs;
3. the owner or review policy promotes a general rule to developer/environment/capability scope.

No cross-project record becomes a project-A rule just because it matched search.

## Consequences

- Cross-project recall becomes a first-class product capability rather than an accidental
  `scope=all` query.
- Existing ADR-0040 scope/audience model remains the safety foundation.
- UI/chat should explain cross-project results in plain language so the owner can tell whether a
  result is a reusable rule or only a prior example.
