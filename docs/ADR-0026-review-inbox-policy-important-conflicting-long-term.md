# ADR-0026: Review Inbox policy for important, conflicting, and long-term memories

## Status

Accepted, refined by [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md)

## Context

Recallant creates ordinary governed memories automatically. If every memory required manual review, the Review UI would become unusable. If nothing required review, inferred long-term rules, conflicts, duplicates, and risky guidance could quietly degrade agent behavior.

The owner selected the policy: review **important, conflicting, and long-term** records.

## Decision

The default Review Inbox policy is:

- ordinary low-risk memories are auto-created and can become recallable without owner review;
- the Review Inbox focuses on records that can affect future behavior, create conflicts, or require long-term hygiene;
- `instruction_grade` promotion remains guarded by direct explicit user instruction, trusted import, or review promotion.

By default, the Review Inbox includes:

1. **Candidate rules**: inferred or extracted behavior rules, preferences, procedures, or defaults that are not yet binding.
2. **Needs-review records**: low-confidence, broad, high-risk, conflicting, or imported records that require owner/higher-confidence decision before normal use.
3. **Scope-changing records**: project memory proposed for developer/global scope, or rules that affect all projects.
4. **Conflicts**: new memories/rules contradicting existing active decisions or `instruction_grade` records.
5. **Duplicates and near-duplicates**: similar rules or decisions that should be merged, archived, or superseded.
6. **High-risk records**: memories touching security, secrets, public exposure, deploys, destructive actions, billing/cost, model/provider routing, storage policy, or server access.
7. **Low-confidence behavior guidance**: records the agent inferred from context rather than direct owner instruction.
8. **Long-term rule proposals**: anything intended to guide future sessions beyond the immediate task.
9. **Promotion/demotion candidates**: records suggested for `instruction_grade`, demotion, archive, stale marking, or supersede.

By default, the Review Inbox excludes:

- raw event text,
- ordinary evidence chunks,
- routine work logs,
- routine project facts,
- low-risk decisions with source refs and no conflict,
- low-risk failures/lessons/open questions that are useful as recall but do not create standing behavior rules.

Explicit user instructions may become `instruction_grade` immediately when scoped, source-linked, and non-conflicting, but they should still appear in the Rules view and recent activity, not as a mandatory approval item.

## Consequences

- Review remains useful and quiet.
- The owner manages what matters: future behavior, conflicts, duplicates, high-risk guidance, and long-term rules.
- Automatic memory creation remains fast and low-friction.
- Agents must not treat a candidate rule as binding just because it is recallable.

## Non-goal

This policy does not prevent the owner from browsing raw memories or all records later. It only defines the default Review Inbox queue.
