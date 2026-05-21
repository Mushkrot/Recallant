# ADR-0033: Compact Review UI workbench in v1

## Status

Accepted, refined by [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md)

## Context

Review UI is already accepted for v1. This ADR decides how much UI to build first.

Rejected options:

- a minimal approval table: too weak for real memory governance because it hides sources, conflicts, scope, and reasons;
- a full admin platform immediately: too broad before the memory core is implemented.

## Decision

Use **Option B: compact working UI** for v1.

v1 UI must be a usable private workbench, not a demo list. It should remain compact, but it must support real daily/weekly owner work.

Required v1 areas:

1. **Project navigation**
   - project list or selector,
   - current project/scope/domain/capture profile,
   - entrypoints to project Review and Settings.

2. **Review Inbox / Command Center**
   - important `candidate` / `needs_review` memories,
   - candidate rules,
   - conflicts,
   - duplicates/merge needed,
   - critical status strip for interrupted sessions, unsynced spool, high-risk conflicts, and pending paid API approvals.

3. **Detail panel**
   - memory body/title,
   - scope/domain/type/status/use policy,
   - confidence and why it is in review,
   - source refs and bounded evidence excerpts,
   - related conflicts/duplicates/supersedes,
   - review action history.

4. **Action controls**
   - accept/approve,
   - reject,
   - edit,
   - archive/unarchive,
   - mark stale,
   - promote/demote instruction,
   - supersede,
   - merge.

5. **Rules view**
   - active `instruction_grade` rules,
   - filters by project/developer/domain/type,
   - source inspection before trust-changing actions.

6. **Cost / Paid API view**
   - pending paid API approval requests,
   - current day/month estimated paid API cost,
   - cost by project/provider/model/purpose,
   - approved/denied/expired requests,
   - route-class breakdown where available.

7. **Settings shortcut**
   - project settings entrypoint,
   - capture profile,
   - model routing / paid API mode visibility,
   - context budget profile.
   - controlled editing for project-level settings, with dangerous changes confirmation-gated.

## Boundary

v1 UI should not include a full raw memory browser, visual graph explorer, personal-life memory UI, full backup console, or broad analytics suite.

It should be implemented with a layout and API shape that can grow into the later Recallant management platform without redesign.

## Consequences

- The UI scope is larger than a simple list, but still bounded.
- Cost control becomes a visible first-class surface alongside memory review.
- Implementation must include real detail/source panels and action flows before the UI is considered complete.
- Future management sections can be added after the compact workbench and core memory lifecycle are working.
