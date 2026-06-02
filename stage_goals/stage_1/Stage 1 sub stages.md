# Stage 1 Sub Stages And Goals

These goals must cover the entire Stage 1 closure path. After this correction, closing every goal in
this file should mean Stage 1 can be marked complete.

Each goal is intentionally small enough for an agent to execute without drifting into unrelated
architecture, CLI, storage, or installer work.

## Goal 1.1: First-Screen Workbench Polish

Status: completed.

Make the first viewport feel like a professional memory workbench, not a collection of status cards.

Scope:

- Improve visual hierarchy around Ask Recallant, current memory space, source status, and next
  attention.
- Keep technical panels secondary.
- Avoid adding new product concepts.

Acceptance:

- A new owner can understand the first screen in under one minute.
- Ask Recallant is clearly the main action surface.
- No wide desktop area is wasted while important content is squeezed.
- `npm run review-ui:smoke` passes.
- `npm run review-ui:playwright` passes.

## Goal 1.2: Memory Tree / Source Map Direction

Status: completed.

Make Memory Spaces and Sources easier to understand as a map of memory, not as rows of records.

Scope:

- Improve Source Map grouping and labels.
- Show source health and provenance in human language.
- Keep raw ids and exact paths in Technical details.

Acceptance:

- Owner can see what a memory space means, what sources are attached, and whether each source is
  usable.
- Detaching a source is clearly separate from deleting memory.
- Source filters remain visible and understandable.
- UI smoke and Playwright focused-source checks pass.

## Goal 1.3: Activity / Replay Readability

Status: completed.

Make Activity / Replay answer "what happened recently?" without requiring technical interpretation.

Scope:

- Improve labels and grouping for session start, context read, memory write, checkpoint, decisions,
  actions, tests, and closeout.
- Preserve source-provenance display where available.

Acceptance:

- Owner can tell whether agents are actually recording.
- Owner can distinguish configured-only from capture-active.
- Source-filtered activity remains safe and understandable.
- Relevant smoke tests pass.

## Goal 1.4: Review Decision Workflow Polish

Status: completed.

Make Review feel like a guided decision queue.

Scope:

- Keep compact queue summaries.
- Improve default empty states and decision language.
- Make risky actions clearly separate from normal review actions.

Acceptance:

- Review queues are understandable without raw status names.
- "Needs your decision", "Active rule", "Usable memory", and conflict states are visible in human
  language.
- Risky changes still require policy gates.
- `npm run review-ui:smoke` passes.

## Goal 1.5: Public-Safe UI Screenshot Candidates

Status: completed.

Prepare internal screenshot states that can later be used in Stage 7 public readiness.

Scope:

- Use synthetic/demo project names and sources only.
- Do not expose owner paths, private project names, ids, secrets, or server details.
- Do not publish screenshots in this goal.

Acceptance:

- Playwright can generate clean desktop/mobile screenshots.
- Screenshots show Ask Recallant, Memory Spaces, Sources, Activity / Replay, and Review in a
  product-quality state.
- Screenshot paths are documented for later Stage 7 use.

## Goal 1.6: Final Visual System Pass

Status: completed.

Turn the current functional Workbench into a stable product visual system.

Scope:

- Define and apply final spacing, type scale, panel hierarchy, borders, density, empty states, and
  action hierarchy across all Workbench surfaces.
- Keep the current Workbench structure; do not redesign architecture or add new product concepts.
- Remove remaining admin-dashboard feel from default screens.

Acceptance:

- The overview, Ask, Sources, Activity, Review, and Settings focused views feel like one coherent
  professional product.
- Important actions are visually obvious; secondary operations are visibly secondary.
- Empty states read as product guidance, not database absence messages.
- `npm run review-ui:smoke` and `npm run review-ui:playwright` pass with updated screenshots.

## Goal 1.7: Dense-State Responsive QA

Status: completed.

Prove the Workbench remains usable in crowded realistic states, not only light synthetic fixtures.

Scope:

- Add or extend a Playwright fixture with many memory spaces, many sources, long labels, long chat
  answers, review queues, activity rows, and operations panels.
- Verify desktop and mobile widths.
- Do not add backend behavior unless needed only to seed UI fixture data.

Acceptance:

- No horizontal overflow, incoherent overlap, clipped controls, or unreadable button text.
- Dense Activity and Review remain scannable.
- Long memory-space/source names do not break layout.
- Playwright writes evidence screenshots and reports the dense-state checks.

## Goal 1.8: Progressive Disclosure And Technical-Language Cleanup

Status: completed.

Make sure the default Workbench is human-first everywhere and technical detail is opt-in.

Scope:

- Audit default visible labels across all Workbench views.
- Move remaining raw ids, JSON, route classes, schema keys, provider/model details, and command
  snippets into collapsed Technical details unless the current view is explicitly a developer view.
- Improve Settings and Operations language without changing safety policy.

Acceptance:

- A normal owner can read the default screens without understanding schema names or variable names.
- Technical details are still available when intentionally opened.
- Public-safe screenshot guard and Review UI smoke protect the new language contract.

## Goal 1.9: Stage 1 Acceptance Gate

Status: completed.

Close Stage 1 with one explicit Workbench acceptance check.

Scope:

- Add or update a Stage 1 acceptance smoke/report that verifies the full Human Workbench criteria.
- Include desktop/mobile screenshots, default-language checks, capture-state visibility, source map,
  Activity, Review, Ask Recallant, Settings/Operations progressive disclosure, and public-safe
  candidate existence.
- Update Stage 1 audit/status docs after the gate passes.

Acceptance:

- The acceptance report proves every Stage 1 requirement from `Stage 1.md` and `Stage 1 Audit.md`.
- All relevant targeted checks pass.
- Stage 1 can be marked complete without relying on owner manual QA as the first proof.
