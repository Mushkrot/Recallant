# Controlled Cross-Project Recall

This document defines how agents may use memory from other projects without mixing everything
together.

## Principle

Recallant is a shared memory system, but not an undifferentiated memory pool.

Project memory is isolated by default. Cross-project knowledge is available when the agent or owner
asks for it, when a developer/environment/capability record is intentionally applicable, or when the
Context Pack Builder has a specific policy reason to include it.

Default behavior is narrow: Recallant does not proactively add examples from other projects to
ordinary context packs. The agent may decide to make an explicit cross-project recall request when
the current task clearly needs a prior pattern.

Short version:

```text
Default: current project + applicable owner/server/capability facts.
Explicit request: similar examples from other projects, always source-linked.
Promotion: only through governed review or explicit owner/user-confirmed policy.
```

## Common use cases

- "Find how another project connected Google Drive."
- "Show prior Cloudflare Access setup."
- "Where do agents usually find server secret references?"
- "What project has a working example of this connector?"
- "How did we solve this deployment error before?"

In these cases, Recallant should return examples and references, not silently change the current
project's rules.

## Default Context Pack behavior

For a normal project session, `memory_get_context_pack` should include:

- current project checkpoint and working memories;
- current project active rules;
- applicable developer preferences and rules;
- current environment/server facts;
- relevant capability/secret/connector-account references;
- client-adapter rules for the active client.

It should exclude unrelated project memories unless:

- the task hint asks for cross-project examples;
- a record has been intentionally promoted to developer/environment/capability scope;
- a resolver hint or policy explicitly says a known project is a reference for this task;
- the owner is in review/debug mode.

It should not add "1-3 similar examples" automatically for every non-trivial task. Cross-project
examples are targeted help, not ambient context.

## Cross-project query behavior

Cross-project retrieval must be explicit and labeled. A result from another project should include:

- source project;
- source file/path/ref;
- memory status and use policy;
- scope kind;
- why it matched;
- whether it is directly applicable or only an example.

Suggested logical modes:

| Mode | Meaning |
|------|---------|
| `same_project` | ordinary project recall |
| `developer_rules` | intentionally reusable owner-level guidance |
| `environment` | server/runtime/capability facts for the current instance |
| `similar_projects` | examples from other projects |
| `all_projects_review` | broad owner/debug search |

First implementation slice:

- MCP tool: `memory_cross_project_recall`.
- Default mode: `similar_projects`.
- `similar_projects` excludes the current project and detached/hidden projects by default.
- `developer_rules` returns accepted developer-scope `instruction_grade` memories.
- `environment` returns environment/capability/connector-account/domain records and redacts
  secret-like values in returned bodies and source quotes.
- Results include source project, source path when available, source refs, status, use policy,
  scope kind, applicability, applicability warning, and promotion policy.
- Ordinary `memory_get_context_pack` does not include similar-project examples by default.

## Applying a prior pattern

When an agent finds useful memory from another project, it should:

1. inspect the source enough to understand applicability;
2. implement or adapt the pattern in the current project;
3. write project-local evidence and checkpoint updates;
4. create a current-project governed memory with source refs when the pattern was actually applied;
5. request promotion only when the pattern is truly general.

The source project remains the source project. The new project gets its own memory once the pattern
is actually applied or accepted there.

If the pattern was not applied, the cross-project hit remains an example only.

## Secret and capability handling

Cross-project recall may reveal that a secret reference or capability exists, for example "Google
Drive personal account is configured through this connector binding" or "Cloudflare tokens live in
the secure config store." It must not reveal raw secret values.

Capability and connector-account records are high-risk enough to require review/confirmation before
they become active long-term behavior for another project.
