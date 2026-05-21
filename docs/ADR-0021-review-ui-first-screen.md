# ADR-0021: Review UI first screen

## Status

Accepted, refined by [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md) and [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md)

## Context

The Review UI runs on the AMP server and should be useful from day one. The owner asked what should be on the first screen and delegated the decision. Later refinement accepted a compact workbench for v1, not a minimal approval table.

The first screen should support the main purpose of Review UI: keeping long-term governed memory healthy without asking the owner to approve every ordinary memory write.

The accepted inbox policy is to show important, conflicting, and long-term records by default. See [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md).

## Decision

The first screen of Review UI will be **Review Inbox / Command Center**.

It is not a metrics dashboard and not a raw memory browser. It is an action-focused triage surface for memory items that may change future agent behavior.

## First screen layout

The first screen should contain:

1. **Scope bar**
   - current project,
   - project selector / link to project list,
   - developer/all-project scope,
   - memory domain,
   - current capture profile,
   - link to settings/profile when available.

2. **Critical status strip**
   - unclosed/interrupted session warning,
   - unsynced local spool warning,
   - pending paid API approval warning,
   - high-risk conflicts count,
   - only operational warnings that affect review or agent behavior.

3. **Priority lanes**
   - Conflicts,
   - Candidate Rules,
   - Important / Needs Review,
   - Duplicates / Merge Needed.

4. **Main review queue**
   - sorted by risk and impact, not by raw creation time alone,
   - first: conflicts involving active `instruction_grade` rules,
   - second: candidate rules that may become binding,
   - third: high-risk or developer-scope memories,
   - fourth: duplicate/stale cleanup.

Ordinary low-risk memories, raw events, evidence chunks, and routine work logs are excluded from the default queue.

5. **Selected item detail panel**
   - title/body,
   - memory type,
   - scope and domain,
   - status and use policy,
   - confidence,
   - why this item is in review,
   - source refs and short evidence excerpts,
   - related conflicts/duplicates/supersedes.

6. **Action bar**
   - accept / approve,
   - reject,
   - promote instruction,
   - demote instruction,
   - edit,
   - archive,
   - mark stale,
   - merge,
   - supersede.

7. **Navigation**
   - Inbox,
   - Rules,
   - Conflicts,
   - Duplicates,
   - Cost / Paid API,
   - Sessions/Recovery,
   - Settings.

## Empty state

If there is nothing requiring attention, the first screen should show a quiet empty state:

- no required review items,
- current project and capture profile,
- active rule count,
- last checkpoint/update time,
- any unsynced/interrupted-session warning if present.

It should not invent work for the owner.

## Consequences

- The owner can open Review UI and immediately see what matters.
- When entering from a future Cloudflare subdomain, the management UI can show all managed projects first, then open a project's Review Inbox and Settings.
- Ordinary auto-created memories stay out of mandatory review unless policy marks them important, risky, conflicting, or duplicate.
- The first UI page can be simple while still aligned with the long-term management platform path.
- The first screen remains review-focused, but v1 also needs the compact workbench around it: Rules, Cost / Paid API, and Settings entrypoints.
- The design leaves room for project/session/model/spool management without expanding v1 into a full admin platform.

## Open questions

- Should the first implementation use a two-pane layout or a single-column mobile-friendly layout first?
- Should keyboard-first actions be included in v1?
- Should Sessions/Recovery appear as an active nav item in v1 or only as a warning strip link?
