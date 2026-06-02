# Stage 1: Human Workbench UI

## Goal

Turn the private Review UI into a professional Recallant Workbench that a serious owner can use
without reading database ids, JSON, schema names, or raw implementation terms.

## Current Audited Status

Stage 1 is complete after the corrected Goal 1.1-1.9 closure path.

The completed goals produced the current Workbench direction: Ask Recallant first, Memory Spaces,
Source Map, Activity / Replay, guided Review, focused views, collapsed technical details,
public-safe screenshot candidates, a shared visual system, dense-state responsive QA, progressive
disclosure cleanup, and an explicit Stage 1 acceptance gate.

No Stage 1 closure work remains in this planning file.

## Completion Rule

Stage 1 is complete because every goal in `Stage 1 sub stages.md` is complete and
`npm run stage1:acceptance` passed after Playwright screenshot generation.

## Main Evidence

- `docs/SESSION_HANDOFF_CURRENT.md` records the 2026-06-01 and 2026-06-02 Workbench slices.
- `docs/WORKING_CONTEXT.md` records current Workbench behavior, focused views, source filtering,
  public-safe screenshots, and Playwright QA.
- `apps/server/src/index.ts` contains the server-rendered private Workbench route and UI language.
- `scripts/smoke-review-ui.mjs` verifies Workbench vocabulary, review, chat, sources, settings, and
  safety gates.
- `scripts/smoke-review-ui-playwright.mjs` verifies desktop/mobile screenshots, focused views, long
  answer readability, dense-state responsive bounds, default-visible language, and public-safe
  screenshot candidates.
- `scripts/smoke-stage1-workbench.mjs` verifies the Stage 1 acceptance gate and writes the latest
  report to `/tmp/recallant-stage1-acceptance.json`.

## What This Stage Is Not

This stage does not add new storage semantics, client hooks, installer behavior, personal-memory
connectors, or AI interpretation changes. It is the human interface layer over capabilities built in
other stages.

## Next Work

Stage 1 is closed. Continue only from a new requested stage/goal.
