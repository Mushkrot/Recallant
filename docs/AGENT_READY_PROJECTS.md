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
- analyze documentation posture and report whether docs are absent, thin, partial, need review, or
  Recallant-ready;
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

## Documentation Posture And Context Packs

Onboarding also produces a compact documentation posture summary. The summary is generic product
state, not a private deployment overlay. It can report:

- which documentation surfaces exist;
- which recommended surfaces are missing;
- whether agent docs describe the Recallant workflow;
- whether stale handoffs, oversized logs, production/server hints, or canon/capability references
  need review;
- which Workbench documentation strategy choices are available: keep current docs and add a
  Recallant layer, canonicalize docs for a Recallant-aware workflow, create starter docs, or
  discuss first.

The human onboard summary compresses this into four owner-facing states:

- `empty`: no project documentation was discovered;
- `healthy`: recommended documentation and Recallant workflow are already present;
- `needs_attention`: docs exist but are thin, partial, stale, or missing Recallant workflow;
- `risky`: production/server/canon or secret-sensitive signals should be reviewed before docs are
  changed.

The summary should stay short: `Documentation posture: <state>`, then `Found:` and `Workbench:`
lines. Detailed posture remains available in JSON output and context packs.

Confirmed attach stores this compact posture in Recallant project settings under the stable key
`documentation_posture`. Later context packs expose it as `sections.documentation_posture` so agents
receive startup guidance without asking maintainers to repeat the same explanation. The section is
guidance, not a binding rule: imported old handoffs stay evidence unless review promotes them.

Context packs also include `sections.canon_capability_context`, a compact reference map for
Recallant-connected projects. It is intentionally names-and-provenance oriented:

- environment facts from accepted project/developer memories or safe project metadata;
- capability references with readiness and consent status, without activating connectors;
- secret references by name/reference only, without raw values;
- server canon link status from configured references or needed-reference hints;
- documentation authority labels showing canonical docs, generated starter docs, imported
  evidence, stale handoffs, and review-required surfaces.

This section helps agents start with the right owner/server/capability context without searching for
secrets or asking maintainers to repeat known rules. It is not a full external resource registry, it
does not grant live access, and it does not make recalled text instruction-grade. Connector
activation, remote resource ingestion, and broader registry workflows remain governed future work.

The Workbench now shows this as a dedicated documentation strategy surface with four choices:

- **Keep current docs, add Recallant layer:** preserve the current documentation and add only the
  Recallant working layer.
- **Canonicalize docs for Recallant-aware workflow:** align existing docs, agent instructions, and
  handoffs with Recallant after owner review.
- **Create starter docs:** create the missing starter documentation surfaces when the project has no
  useful docs yet.
- **Discuss first:** review ambiguous, risky, production-sensitive, or conflicting posture before
  changing docs.

For an empty project, `recallant onboard <project>` can now create starter docs during the confirmed
onboarding write step. This is intentionally narrow: it applies only when no project documentation
was discovered and target files do not already exist. Existing-doc canonicalization and broader
documentation rewrites still require an owner-reviewed Workbench workflow.

## New Project Bootstrap

For a fresh project, Recallant should create or update only compact local files:

- `.recallant/config` as a local pointer to the Recallant memory space;
- `README.md` when the project has no docs yet;
- a thin `AGENTS.md` section that routes agents into Recallant;
- a compact `PROJECT_LOG.md` fallback with current focus and next step;
- client-specific MCP configuration when needed;
- local spool state for offline capture.

Starter docs always include the base `README.md`, `AGENTS.md`, and `PROJECT_LOG.md` surfaces. If
documentation posture can classify the project, onboarding may also add profile-specific starter
surfaces: service/app projects get operational and architecture docs; product or roadmap projects
get status and decision docs; library/package projects get an API or usage surface. These files are
starter surfaces, not imported old handoffs, and they must not overwrite existing project docs.

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

For a remote existing project, prove the connection before importing history:

1. verify `recallant agent-start --format json` reports `mode: "remote_mcp_ready"`;
2. verify the same JSON recommends `memory_get_context_pack` and
   `memory_create_agent_memory` as the next startup/proof calls;
3. verify local `recallant doctor --project-dir .` reports
   `remote-ready, local storage not attached` rather than a local attach failure;
4. prove session/context readiness with `memory_start_session` plus `memory_get_context_pack`, or
   `recallant remote-doctor --capture-proof`;
5. optionally prove checkpoint state with `memory_set_checkpoint` plus `memory_get_checkpoint`;
6. create one non-secret governed memory marker with `memory_create_agent_memory`;
7. recall that marker with `memory_recall_agent_memories`;
8. run a read-only inventory of candidate docs and risky paths;
9. ask the owner to approve a migration plan before writing project memories or imports.

The proof marker should be synthetic and concise. A safe `memory_create_agent_memory` shape is:

```json
{
  "memory_type": "work_log",
  "scope": "project",
  "audience": [{ "kind": "all_agents", "id": null }],
  "title": "Safe Recallant semantic marker",
  "body": "Synthetic non-secret marker recallant_safe_semantic_marker_example for create+recall proof.",
  "confidence": 1,
  "source_refs": [],
  "created_by": "agent",
  "metadata": {
    "diagnostic_marker": true,
    "contains_raw_secret": false
  }
}
```

Recall it with `query: "recallant_safe_semantic_marker_example"`, `scope: "project"`, and
`memory_types: ["work_log"]`. Do not use real customer data, raw credentials, private keys, `.env`
values, backups, raw artifacts, or large historical logs for a proof marker.

The migration plan should group sources by action: summarize into governed memory, keep as a source
reference, skip, or ask the owner. Safe governed memories should be concise and typed, for example
`environment_fact`, `procedure`, `decision`, `constraint`, `artifact_reference`, or
`open_question`. They should cite source paths in metadata or source refs without copying raw
secrets, customer data, backups, raw artifacts, or large historical logs. A checkpoint update is a
state fallback; it is not a substitute for governed memory recall.

The read-only inventory classifies paths using migration classes that are safe to print publicly:
`safe_source`, `useful_documentation`, `historical_handoff`, `large_archive_log`, `raw_artifact`,
`backup`, `credential_bearing_file`, `customer_data`, `private_key`, and
`environment_config_risk`. Risk output is path/class/count oriented. Secret references are names
only, and private-key, customer-data, raw-artifact, and backup contents stay metadata-only unless an
owner reviews a narrower source.

For remote-only projects, the approved concise entries can be written through the configured remote
MCP `memory_create_agent_memory` tool with source refs, then verified with
`memory_recall_agent_memories`; the external workstation does not need local Postgres. Server-local
projects can reuse the `importSource` review semantics behind explicit `recallant import <path>` or
`recallant attach <project-dir> --mode guided --confirm`. After one approved safe marker is recalled,
update checkpoint state separately.

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
