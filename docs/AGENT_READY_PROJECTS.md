# Agent-Ready Projects

Recallant is meant to make a project ready for AI agent work without asking maintainers to rebuild
the same context by hand in every session. The public product goal is broader than "store memories":
Recallant should help a new or existing project become an agent-ready workspace with governed
onboarding, capture, recall, review, and safety boundaries.

## Product Contract

An agent-ready project has three layers:

- **Thin project files:** `AGENTS.md`, `PROJECT_LOG.md`, and client-local MCP configuration tell
  agents how to start Recallant-backed work. They are pointers and checkpoints, not the full history.
- **Recallant memory:** decisions, actions, tests, checkpoints, source references, and reviewable
  rules live in Recallant as governed memory.
- **Private deployment profile:** local runtime settings, secret store references, private access
  provider settings, server inventory, and external connector bindings stay outside the public repo
  and are represented as references or capability records.

## Beginner Onboarding Contract

The beginner onboarding path is one command:

```bash
recallant onboard <project>
```

That command should behave like a guided setup program, not a list of commands to memorize. It must:

- check whether Recallant storage is configured and reachable;
- create or select a local/private storage profile when the user chooses automatic setup;
- explain production-sensitive project signals in plain language before writing files;
- create a local backup before changing existing agent files;
- attach the project, connect the selected client, and keep generated files thin;
- import old handoffs and project notes as review-only evidence;
- prove capture with a context read, memory write, checkpoint, and recall check;
- show the Workbench outcome or a single clear blocker.

`Database not configured` is not a successful onboarding state. Offline spool can be a fail-soft
capture fallback, but a beginner setup is not complete until Recallant can either use storage or
clearly stop with one next action.

The lower-level commands remain advanced/debug APIs for automation and contributors:

```bash
recallant attach .
recallant connect codex --project-dir .
recallant doctor --project-dir . --require-capture
recallant agent-start --task-hint "<task>"
```

They should not be the normal beginner quickstart. The important user-facing result is
`capture active`: Recallant has observed a context read, meaningful memory write, checkpoint, and
recall proof for the project.

## New Project Bootstrap

For a fresh project, Recallant should create or update only compact local files:

- `.recallant/config` as a local pointer to the Recallant memory space;
- a thin `AGENTS.md` section that routes agents into Recallant;
- a compact `PROJECT_LOG.md` fallback with current focus and next step;
- client-specific MCP configuration when needed;
- local spool state for offline capture.

Durable history belongs in Recallant, not in a growing prompt file. A later session should start
from a server-built context pack, not from a long manual prompt.

## Existing Project Migration

Existing projects often contain old handoffs, local rules, runbooks, and agent-specific files.
Recallant should treat those files as migration inputs:

- preserve important project rules;
- import old handoffs and logs as source-linked evidence;
- classify stale, conflicting, broad, or risky statements for review;
- keep local startup files thin after migration;
- create local backups before changing existing agent files;
- report discovered agent files, selected imports, imported sources, review-needed items, raw-secret
  findings, and local backup creation;
- never silently delete important project-specific guidance.

Historical material is evidence by default. It should not become an instruction-grade rule unless a
trusted import path, explicit owner action, or review policy allows it.

For public release validation, Recallant keeps a neutral non-owner migration smoke that attaches a
sandbox copy of an existing-project fixture, verifies the original project is untouched, requires a
local redacted backup, checks the migration summary, and confirms imported material stays reviewed
evidence rather than silent instructions.

In the Workbench, migrated projects should expose a migration review queue instead of leaving
maintainers to infer priority from a flat inbox. The queue groups conflicts and duplicates, secret or
capability references, stale handoffs, and low-risk imported evidence so owners can decide what to
keep as usable memory, reject as noise, or promote only after source-backed review.

## Agent Session Contract

After onboarding, agents should follow the same session loop:

1. read project instructions;
2. start a Recallant-backed session;
3. read a server-built context pack;
4. work normally;
5. write meaningful decisions, actions, tests, and checkpoints;
6. close out when the task pauses or finishes.

If MCP is unavailable, the CLI fallback can still record work and write local spool records for
later sync.

## Sources, Capabilities, And Secret References

Recallant models the things memory refers to as sources. A source can be a repository, folder,
document set, server path reference, connector account, or manual topic. Source records should make
provenance visible without dumping raw private data into agent context.

Secret values do not belong in memories, fixtures, examples, or public docs. Recallant should store
only references such as variable names, secret-store labels, connector names, or capability records.
Agents may learn that a capability exists, but using it remains governed by the project's policy and
the relevant confirmation gates.

## Cross-Project Examples

Recallant keeps current-project memory isolated by default. When a task needs a prior pattern, an
agent may request cross-project examples explicitly, such as:

- how another project handled deployment notes;
- how a secret reference was documented without exposing values;
- how a private access provider was configured at the pattern level;
- how a connector or external service was represented safely.

Cross-project results are examples with provenance. They do not become current-project rules until
the pattern is applied locally and a new source-linked memory is created or reviewed.

## Safety Gates

Recallant should keep ordinary memory capture easy while keeping risky operations behind explicit
policy:

- raw secrets are never stored;
- public exposure is explicit deployment work;
- destructive operations require confirmation and dry-run paths where possible;
- paid API use is disabled or confirmation-gated by default;
- connector binding and external service access require governed setup;
- global or instruction-grade rules require stronger authority than agent inference.

These boundaries let Recallant support real operational work without turning recalled text into
hidden standing instructions.

## Public And Private Boundary

The public Recallant repository should describe the universal product contract: agent-ready
onboarding, governed memory, sources, capabilities, secret references, private deployment profiles,
and safety gates.

Concrete deployment overlays belong outside the public product docs: actual server inventories,
domain names, private access-provider configuration, secret-store paths, customer data, internal
handoffs, and owner-specific resource maps. Public docs should explain the model; private profiles
should provide the local values through environment variables, source/capability records, and
deployment-profile notes.
