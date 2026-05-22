# Memory management workflow

This file defines how the owner and agents manage the three governed-memory buckets over time.

The goal is to prevent rule rot: too many rules, duplicate rules, stale rules, inferred rules pretending to be confirmed rules, and conflicts between old and new guidance.

Accepted default Review Inbox policy: review **important, conflicting, and long-term** records, not every memory. See [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md).

Lifecycle refinement: governed memory statuses are `candidate`, `accepted`, `rejected`, `archived`, `superseded`, `stale`, and `needs_review`. See [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md).

## 1. Mental model

Recallant has three practical buckets:

```text
Bucket A: ordinary memory
  - facts, decisions, work logs, failures, artifact refs, open questions
  - normally auto-created and recallable

Bucket B: candidate rule
  - possible preference/procedure/rule inferred or extracted from work
  - visible in review, recallable as context, not binding

Bucket C: binding rule
  - instruction_grade memory
  - agent may treat it as standing guidance, within safety limits
```

Management is about moving records between these buckets:

```text
ordinary memory  -> candidate rule -> binding rule
       |                 |                |
       v                 v                v
 archive/reject     edit/archive      demote/supersede/archive
```

## 2. Required owner-facing surfaces

v1 requires a compact owner-facing Review UI workbench for governed memory. The UI is focused on important, conflicting, and long-term memory hygiene, rule management, and paid API cost safety, not on approving every memory write.

Required UI views:

- Inbox / Command Center: first screen; `candidate`/`needs_review`/high-risk/important memories plus conflicts, candidate rules, duplicate cleanup, current scope, and critical status.
- Rules: active `instruction_grade` records with scope/type filters.
- Memory detail: source refs, review history, related records, status, use policy, confidence.
- Duplicates: possible duplicates with merge/archive/supersede actions.
- Conflicts: contradictory records with suggested resolution.
- Cost / Paid API: pending paid API approvals and cost visibility.
- Project / Settings navigation: project selector/list and project settings entrypoints.
- Natural-language management chat: ask questions, inspect memories, explain context packs, propose cleanup, and prepare confirmation-gated actions.
- Cleanup / Forget: cleanup candidates, stale clusters, duplicate/conflict hygiene, archive/rebuild actions, and explicit permanent erasure workflow.
- Action controls: accept/approve, reject, promote instruction, demote instruction, archive, unarchive, mark stale, edit, merge, supersede.

The CLI/admin workflow remains required for scripting, automation, tests, and fallback operation.

Required CLI commands:

```bash
recallant memory inbox
recallant memory rules
recallant memory show <memory_id>
recallant memory accept <memory_id>
recallant memory reject <memory_id>
recallant memory promote <memory_id>
recallant memory demote <memory_id>
recallant memory edit <memory_id>
recallant memory archive <memory_id>
recallant memory forget <selector-or-id> --dry-run
recallant memory supersede <old_memory_id> --by <new_memory_id>
recallant memory merge <memory_id...>
recallant memory conflicts
recallant memory duplicates
recallant chat
```

Names may change during implementation, but the workflow must exist. `recallant memory approve` may remain as a compatibility alias for `accept`; the stored status is `accepted`.

## 2.1 Natural-language management

The management UI must include a conversational surface. This is the owner's primary ergonomic control layer, while structured UI controls remain available for inspection and precision.

Examples:

```text
Show what the next agent needs before starting this project.
Find stale GitHub access memories.
Delete everything related to the wrong Google account in this project.
Make this rule developer-wide, but only after showing the source.
Forget this permanently.
```

Natural-language management must not bypass policy:

- read-only questions can be answered directly with source links where available;
- low-risk governance actions may produce an action plan and UI controls;
- destructive, cost-affecting, global-scope, connector/account, security, public-exposure, or secret-related actions require explicit confirmation;
- actions execute through the same server-side MCP/API paths used by UI and CLI.

Recallant should answer the owner in the owner's language by default. Repository artifacts and API contracts remain English.

## 2.2 First screen: Review Inbox / Command Center

The first screen should answer one practical question: **what needs the owner's decision now?**

It should not be a broad analytics dashboard and should not list every raw event/chunk.

Required first-screen elements:

- scope bar: project, developer/all-project scope, domain, capture profile;
- critical status strip: interrupted/unclosed session, unsynced spool, high-risk conflict warning;
- priority lanes: Conflicts, Candidate Rules, Important/Pending, Duplicates;
- main review queue sorted by risk/impact;
- selected-item detail panel with source refs and related records;
- action bar for accept/reject/promote/demote/edit/archive/mark-stale/merge/supersede;
- navigation to Inbox, Rules, Conflicts, Duplicates, Cost / Paid API, Sessions/Recovery, and Settings.

Queue priority:

1. Conflicts involving active `instruction_grade` rules.
2. Candidate rules that may become binding.
3. Developer-scope or high-risk memories.
4. Duplicate/stale cleanup.

If no item needs attention, show a quiet empty state with current project/profile, active rule count, last checkpoint/update time, and any unsynced/interrupted-session warning.

## 3. Inbox

`recallant memory inbox` shows records that need attention.

Default inbox includes:

- `needs_review` records,
- high-confidence candidate rules that are not yet `instruction_grade`,
- low-confidence records that would affect future behavior,
- records flagged as possible duplicate or conflict,
- developer-scope candidates,
- security/cost/deploy/provider-related candidates,
- model-routing, storage-policy, server-access, public-exposure, or destructive-action candidates,
- project-to-developer/global promotion candidates,
- long-term rule proposals.

Default inbox excludes ordinary low-risk memories:

- raw event text,
- ordinary evidence chunks,
- routine work logs,
- routine project facts,
- low-risk source-linked decisions,
- low-risk failures/lessons/open questions that do not create standing behavior rules.

Example:

```text
Recallant Memory Inbox

[1] candidate_rule / developer scope / high confidence
    "Always document architecture decisions immediately."
    Suggested: promote_instruction
    Source: user turn 2026-05-20

[2] candidate_rule / project scope / possible duplicate
    "Use TypeScript core and Python workers only when useful."
    Similar to: ADR-0010 runtime decision
    Suggested: merge or archive duplicate

[3] candidate_rule / security sensitive
    "Never expose Recallant outside Tailscale."
    Suggested: promote_instruction after owner confirmation
```

The inbox should be quiet by default. It should not interrupt normal work unless:

- the agent is about to rely on an unconfirmed candidate as a rule,
- a direct user command appears to create a new binding rule,
- a serious conflict affects the current task.

## 4. Rules view

`recallant memory rules` shows only active `instruction_grade` records by default.

Useful filters:

```bash
recallant memory rules --scope developer
recallant memory rules --project <project_id>
recallant memory rules --domain agent_work
recallant memory rules --type preference
recallant memory rules --type procedure
recallant memory rules --include-archived
recallant memory rules --with-sources
```

Example output:

```text
Active Binding Rules

[r1] developer / procedure
     Always document accepted architecture decisions in docs/ADR.
     Source: user turn 2026-05-20
     Last used: 2026-05-20

[r2] project / safety
     Do not deploy without explicit owner approval.
     Source: AGENTS.md
     Last used: 2026-05-18
```

The owner must be able to inspect source refs before trusting a rule.

## 5. Review actions

Required actions:

| Action | Meaning |
|--------|---------|
| `accept` / `approve` | Ordinary memory or candidate becomes `accepted`; normally recallable if policy allows it. |
| `reject` | Incorrect memory; retained for audit but excluded from recall. |
| `promote_instruction` | Candidate becomes binding `instruction_grade`. |
| `demote_instruction` | Binding rule becomes recallable context, no longer a standing instruction. |
| `archive` | Hide from normal recall without declaring it false. |
| `mark_stale` | Mark memory as possibly outdated; require verification before reliance. |
| `supersede` | Newer memory/rule replaces older memory/rule. |
| `merge` | Several duplicates become one canonical record; old records point to the canonical one. |
| `edit` | Owner edits title/body/scope/type; original source refs and review history remain. |
| `forget` | Explicit owner-confirmed permanent erasure of content and derived material. Not ordinary cleanup. |

Every action writes an `agent_memory_review_actions` row.

`forget` additionally writes an `erasure_requests` record or equivalent redacted receipt and must remove/redact derived material as defined in `DATA_MODEL.md` and `MCP_SPEC.md`.

## 6. Editing

Editing must not destroy history.

When the owner edits a memory:

- create a review action `edit`,
- store previous title/body/scope/use_policy in action metadata,
- keep original source refs,
- optionally add a new source ref saying the owner edited it,
- update the active `agent_memories` row.

If the edit changes meaning materially, prefer creating a new memory and `supersede` the old one.

## 7. Duplicates

Duplicates happen when several sessions extract the same rule in slightly different words.

Examples:

- "Always update docs after decisions."
- "Important decisions must be fixed in documentation."
- "Do not leave architecture decisions only in chat."

Recallant should detect possible duplicates by:

- same `memory_type`,
- same/similar scope,
- semantic similarity,
- shared source refs or same project/session,
- overlapping keywords,
- same target behavior.

Duplicates are not auto-deleted. They are shown in `recallant memory duplicates`.

Preferred resolution:

```text
canonical memory remains active
duplicate memories become superseded/archived
edge relation: duplicate -> canonical with relation_type=duplicates or supersedes
```

## 8. Conflicts

Conflicts are more dangerous than duplicates.

Examples:

- Old: "Use Option A: one database."
- New: "Use Option B: one Postgres instance, separate databases."
- Old: "Cloud is disabled."
- New: "Cloud is allowed as escalation."

Recallant should flag possible conflicts when:

- two active `instruction_grade` records have opposite guidance,
- a new decision contradicts an older decision in the same scope/domain,
- a candidate rule would override an existing binding rule,
- source refs show later explicit user decision against an older rule.

Conflict resolution follows [ADR-0041](ADR-0041-conflict-resolution-priority.md):

1. applicability,
2. authority,
3. scope specificity,
4. recency,
5. review/owner confirmation when still risky or ambiguous.

Authority ladder:

- current explicit user instruction in the current session, unless safety/security/confirmation gates apply,
- safety/system/developer hard constraints,
- accepted `instruction_grade` memory in the narrowest applicable scope,
- accepted environment/capability/connector-account bindings,
- accepted `recall_allowed` decisions, lessons, and facts,
- current checkpoint,
- imported source-linked candidates or `needs_review`,
- raw evidence/chunks,
- agent inference or summary.

High-risk or equal-authority conflicts must go to Review UI / owner confirmation instead of silent resolution.

`recallant memory conflicts` should show:

```text
Conflict 1
Old: [r10] "Start with Option A..."
New: [r22] "Option B accepted..."
Suggested: r22 supersedes r10
```

## 9. Agent behavior during work

Agents may create ordinary memories and candidate rules automatically.

Agents must not silently promote candidate rules to `instruction_grade` unless the source is a direct explicit user instruction and policy validation passes.

When an agent thinks a candidate should become binding, it should create a review proposal instead of asking constantly in chat.

Example closeout summary:

```text
Memory proposals:
- promote: "Always document accepted architecture decisions in docs/ADR" because the owner explicitly confirmed it.
- merge: two duplicate runtime-stack rules into ADR-0010 canonical rule.
- archive: older Option A storage recommendation superseded by ADR-0011.
```

## 10. Periodic hygiene

Use two levels:

1. Light review during closeout:
   - new candidate rules,
   - obvious duplicates,
   - conflicts created in the session.

2. Periodic review:
   - `recallant memory inbox --older-than 7d`,
   - `recallant memory duplicates`,
   - `recallant memory conflicts`,
   - `recallant analyze` for stale raw/chunk material.

The system should avoid making the owner review everything every day.

## 10.1 Self-cleaning and erasure

Recallant should continuously make memory easier to maintain without silently destroying source truth.

Self-cleaning should detect:

- duplicate or near-duplicate memories,
- stale decisions,
- superseded guidance,
- abandoned experiments,
- old temporary context,
- low-value derived chunks/summaries,
- unsynced or already-synced spool material,
- conflicting connector/account bindings,
- records without adequate provenance.

Default automated cleanup should prefer archive, supersede, stale, rebuild, or prune derived/index data. Permanent erasure requires explicit owner confirmation unless a future dedicated retention policy is explicitly configured.

When erasure runs, the owner should receive a redacted receipt with safe counts and warnings. The receipt must not contain the erased content.

## 11. Minimal v1 requirement

v1 must include:

- compact Review UI workbench with project navigation, inbox, rules, detail, duplicates, conflicts, Cost / Paid API, Settings shortcut, and action flows,
- natural-language management chat for memory questions, review actions, cleanup requests, and confirmation-gated operations,
- CLI fallback for the same management actions,
- queryable inbox,
- list active rules,
- show one memory with source refs and review history,
- promote/demote/reject/archive/supersede/edit/merge,
- explicit permanent erasure workflow with dry-run, confirmation, and redacted receipt,
- duplicate/conflict detection at least as a report,
- closeout proposals for new candidate rules.

The UI should be polished enough for real daily/weekly owner review, but scoped narrowly to governed-memory hygiene and paid API cost safety. A minimal approval-only table is not sufficient. Broader dashboards can come later, except the required Cost / Paid API dashboard defined by ADR-0032.
