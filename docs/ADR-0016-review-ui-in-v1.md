# ADR-0016: Review UI in v1

## Status

Accepted, refined by [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md) and [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md)

## Context

Governed memory only stays healthy if the owner can inspect and curate important records over time. CLI-only review is technically possible, but it is too weak for the actual product goal: managing long-term behavior, conflicts, duplicate rules, source evidence, and instruction-grade promotion without turning every memory write into a manual approval step.

The owner confirmed that review is required in v1 with a full UI, focused on important, conflicting, and long-term memories.

Placement refinement: the Review UI runs on the Recallant server. v1 should be a compact private workbench rather than a minimal approval table, and it should evolve into a fuller Recallant management platform. See [ADR-0020-review-ui-on-recallant-server-management-platform-path.md](ADR-0020-review-ui-on-recallant-server-management-platform-path.md) and [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md).

First screen refinement: the Review UI starts on an action-focused Review Inbox / Command Center, not a generic metrics dashboard. See [ADR-0021-review-ui-first-screen.md](ADR-0021-review-ui-first-screen.md).

Inbox policy refinement: default review covers important, conflicting, and long-term records, not every memory. See [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md).

## Decision

Recallant v1 must include an owner-facing Review UI.

The Review UI is served from the Recallant server deployment, not from Codex and not from each target project repository.

The Review UI is not for confirming every memory. Ordinary memories can still be created automatically and become recallable through deterministic policy. The UI exists to manage:

- important candidate rules,
- active `instruction_grade` rules,
- conflicts,
- duplicates,
- stale or superseded guidance,
- high-risk behavior guidance,
- scope-changing proposals,
- source refs and review history,
- promotion/demotion/archive/reject/edit/merge/supersede actions.

CLI review commands remain required for automation, scripting, smoke tests, and fallback operation, but the primary owner-facing review workflow is the UI.

## UI Scope

Required v1 screens or views:

- **Inbox / Command Center:** the first screen; `candidate`/`needs_review`/high-risk/important memories, conflicts, candidate rules, duplicates, scope bar, critical status strip, selected-item detail, and action bar.
- **Rules:** active binding `instruction_grade` memories with scope/type filters.
- **Memory Detail:** body, status, use policy, confidence, source refs, related records, and review history.
- **Duplicates:** possible duplicate memories/rules with merge/archive/supersede actions.
- **Conflicts:** contradictory active/candidate records with suggested resolution.
- **Cost / Paid API:** pending approval requests, current cost estimates, cost by project/provider/model/purpose, and paid API route visibility.
- **Project / Settings navigation:** project selector/list and project settings entrypoints.
- **Actions:** accept/approve, reject, promote instruction, demote instruction, archive, unarchive, mark stale, edit, merge, supersede.

The UI should prioritize review hygiene, rules, and paid API cost safety over broad analytics. It should not become a raw-event browser, graph explorer, full backup console, or broad product dashboard in v1.

## Required Properties

- Every UI action must call the same server-side policy path as MCP/CLI review actions.
- Every action must write `agent_memory_review_actions`.
- Source refs must be visible before promoting a rule to `instruction_grade`.
- The UI must show scope clearly: project, developer, domain, and whether a rule affects all projects.
- The UI must not silently promote agent-inferred memories to binding rules.
- The UI should be usable locally over Tailscale/private server access; no public SaaS assumption.
- v1 should be a compact working UI with project navigation, inbox, rules, details, actions, Cost / Paid API, and settings shortcuts. A minimal approval-only table is not sufficient.
- The UI should be structured so it can grow into a Recallant management platform.

## Non-goal Boundary

This ADR changes the earlier "no required UI in v1" position only for governed-memory review. Recallant v1 still does not need:

- marketing website,
- public SaaS dashboard,
- full observability suite,
- universal personal-life memory UI,
- visual editor for every raw event/chunk.

This does not prohibit a future private management platform. It only prevents v1 from expanding into a public SaaS dashboard or broad analytics product before governed-memory review works.

## Consequences

- v1 implementation scope increases, but the product becomes much more realistic for long-term rule hygiene.
- TypeScript-first core becomes even more appropriate because types can be shared between MCP, CLI, API, and UI.
- The implementation guide and test contract must include review UI requirements.
- MF0/OpenMemory dashboard/workbench ideas become relevant UI references, while Recallant keeps its own governed-memory model.

## Open questions

- Which UI stack should be used in implementation: Next.js, Vite/React, or another TypeScript-first option?
- Should the UI support keyboard-first review flows in v1?
- Should the first implementation serve the UI from the main Recallant HTTP service or a separate `recallant-review-ui` process?
