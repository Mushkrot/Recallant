# Memory governance policy

Governed memories should be created automatically when valid, but not all memory types should have the same behavioral authority.

Plain-language rule:

- ordinary memory is created automatically;
- possible long-term rules are also captured automatically, but first as candidates;
- a rule becomes binding `instruction_grade` only through a stronger path: direct explicit user instruction, import from trusted config/docs, or review/promotion.

The goal is to avoid asking the owner to approve every memory while preventing agents from silently inventing permanent behavior rules.

Decision refinement: lifecycle statuses are `candidate`, `accepted`, `rejected`, `archived`, `superseded`, `stale`, and `needs_review`. See [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md).

Scope/audience refinement: governed memory authority is multi-axis. A memory must be interpreted through `scope_kind`, `scope_id`, `audience`, status, and `use_policy`. See [ADR-0040](ADR-0040-memory-scope-and-audience-model.md). A correct `use_policy` does not make a memory universal; it only applies within its scope and audience.

## 1. Policy levels

| Level | Meaning | Example |
|-------|---------|---------|
| `evidence_only` | Useful evidence, not a rule. | "On May 19 the agent tried X and it failed." |
| `recall_allowed` | Safe to recall as working memory. | "Recallant uses OB1 as foundation and Journey as packaging layer." |
| `instruction_grade` | Safe to treat as a standing instruction/preference. | "For spreadsheet edits, never overwrite formulas unless explicitly asked." |
| `do_not_use` | Retained for audit but excluded from normal recall. | Rejected or unsafe memory. |

## 1.1 Three practical buckets

### Bucket A — Ordinary memory

Created automatically and normally usable immediately as `accepted` + `recall_allowed`.

Examples:

- "ADR-0011 selected one Postgres instance with separate domain databases."
- "The owner rejected multi-storage Option C for v1."
- "The latest closeout should update `PROJECT_LOG.md`."
- "Open question: first cloud embedding fallback provider is undecided."

These records help the agent remember what happened or what was decided. They do not by themselves command future behavior forever.

### Bucket B — Candidate rule

Captured automatically, but not binding as a permanent instruction yet.

Default state:

- `status=candidate` + `use_policy=recall_allowed` when confidence is high and source refs exist but the record is not binding, or
- `status=needs_review` + `use_policy=evidence_only` when confidence is low, broad, risky, conflicting, or inferred.

Examples:

- "The owner seems to prefer documentation-first architecture."
- "Maybe new projects should always use `recallant init --target codex`."
- "The agent inferred that paid API LLM should be used for all closeouts."

These can be recalled as context, but the agent must not treat them as a standing rule unless promoted.

### Bucket C — Binding rule

Can become `instruction_grade`.

Allowed promotion paths:

- direct explicit user instruction in the current conversation,
- import from trusted repo config such as `AGENTS.md`,
- explicit review action such as `promote_instruction`,
- curated admin/CLI operation.

Examples:

- User says: "Всегда фиксируй важные решения в документации." This may become `instruction_grade` with source ref to the user turn.
- `AGENTS.md` says: "Never deploy without explicit owner approval." This may be imported as `instruction_grade`.
- Owner reviews a candidate and promotes it.

Important: an `instruction_grade` memory can guide behavior, but it does not override safety gates. For example, "deploy when I say deploy" can help interpret intent, but it does not authorize unrelated destructive actions.

## 2. Auto-created by default

These can usually be created automatically as `accepted` + `recall_allowed` when they have source refs:

- `work_log`
- `artifact_reference`
- `decision`
- `lesson`
- `failure`
- `open_question`
- project-specific `constraint`

Examples:

- "ADR-0008 says Journey is packaging layer, not memory foundation."
- "Manual closeout should include raw/spool, governed memories, links, checkpoint, PROJECT_LOG, sync state."
- "Open question: exact cloud embedding fallback provider is still undecided."

## 3. Higher caution before instruction-grade

These can be auto-created for recall, but should not become `instruction_grade` without stronger policy:

- developer-wide preferences,
- global rules across all projects,
- environment/server facts,
- connector/account bindings,
- capability/secret references,
- client-adapter rules that could affect multiple agents,
- procedures that can change files/deploy/run commands,
- safety/security rules,
- model/provider/cost policies,
- personal-life memory policies.

Examples:

- "Always use `recallant init --target codex` for new projects" can be recallable now, but may become instruction-grade after confirmation.
- "Never expose Recallant outside Tailscale" is security-sensitive and should require confirmation before instruction-grade.

## 3.1 Stronger policy triggers

Treat a memory as a candidate rule, not an automatic binding rule, when it contains signals like:

- "always", "never", "default", "from now on", "in every project",
- applies to all projects or developer-wide behavior,
- affects security, secrets, public exposure, deploys, destructive commands, money/cost, or model-provider choice,
- was inferred by an agent rather than stated by the owner,
- conflicts with an existing instruction-grade memory,
- comes from a summary rather than a direct source.

Direct user statements can still become `instruction_grade`, but they must be explicit, scoped, source-linked, and non-conflicting.

## 4. Review as correction, not gate

Review exists so the owner or agent can:

- reject incorrect memories,
- mark possibly outdated memories as `stale`,
- archive stale memories after review,
- supersede old decisions,
- promote stable rules to `instruction_grade`,
- demote instructions that became too strong,
- merge duplicates.

The system should not ask the owner to approve every memory write.

Management of inboxes, active rules, duplicates, conflicts, editing, and periodic hygiene is defined in [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md).

Conflict priority is defined in [ADR-0041](ADR-0041-conflict-resolution-priority.md). In short: applicability first, then authority, then scope specificity, then recency; high-risk or equal-authority conflicts require review/owner confirmation.

## 5. Review Inbox default policy

The accepted default is to review **important, conflicting, and long-term** records. See [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md).

Review Inbox includes records that can affect future behavior or long-term memory hygiene:

- candidate rules and `needs_review` records,
- developer/global scope changes,
- conflicts with active decisions or `instruction_grade` rules,
- duplicates or near-duplicates,
- security/deploy/destructive/cost/model-provider/server-access sensitive memories,
- low-confidence inferred behavior guidance,
- long-term rule proposals,
- promotion/demotion/archive/supersede candidates.

Review Inbox excludes routine low-risk recall:

- raw event text,
- ordinary chunks,
- routine work logs,
- routine project facts,
- low-risk decisions with source refs and no conflict,
- low-risk failures/lessons/open questions that do not become standing guidance.

Explicit direct user instructions may become `instruction_grade` immediately when scoped, source-linked, and non-conflicting, but they should still be visible in the Rules view and recent activity.

## 6. Lifecycle

Stored statuses:

```text
candidate
accepted
rejected
archived
superseded
stale
needs_review
```

Lifecycle v1:

```text
candidate -> accepted
candidate -> rejected
accepted -> archived
accepted -> superseded
accepted -> stale
stale -> accepted
stale -> archived
stale -> superseded
needs_review -> accepted
needs_review -> rejected
```

Only `accepted` memories can act as durable behavioral guidance according to their `use_policy`. Candidate/imported/stale/needs_review records may inform search or review, but must not silently become standing instructions.

## 7. Open decisions

- Should low-confidence extraction always produce `needs_review` by default, or only for candidate rules?
- Should cross-project/developer-level promotion require explicit user confirmation unless the source is a direct user instruction?
- Should there be a daily/weekly `recallant review --important` summary rather than interrupting during work?
