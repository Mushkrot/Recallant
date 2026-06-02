# Stage 1 Audit: Human Workbench UI

Audit date: 2026-06-02

## Status

Stage 1 is complete against the corrected full closure plan.

Approximate completion: 100% of the full Stage 1 closure plan after correcting the sub-goals.

Important correction: the old Goal 1.1-1.5 list covered several useful UI slices, but it did not
cover the whole Stage. The corrected Goal 1.1-1.9 list is now closed.

## Implemented

- The visible product name is `Recallant Workbench`.
- The UI exposes human work areas: Ask Recallant, Memory Spaces, Command Center, Sources / Source
  Map, Activity / Replay, Review, Settings, and governed Operations panels.
- Ask Recallant is the primary top work surface.
- Long chat answers are displayed in a wide central area, not the old narrow right rail.
- Memory Spaces show plain-language meaning, isolation policy, capture state, and source
  information.
- Source Map groups attached sources and shows source health/status, provenance filters, and detach
  controls.
- Activity / Replay shows session start, context read, memory write, checkpoint, and source-linked
  memory activity in grouped replay language.
- Review starts with a decision guide, human queue labels, compact queue summaries, and separated
  sensitive cleanup.
- Technical ids, raw JSON, route classes, provider/model names, and schema values are collapsed
  under Technical details or technical smokes instead of default-visible labels.
- Focused views exist through `?view=ask|memory|command|sources|activity|review|settings` plus the
  default overview.
- A final visual-system pass is implemented with shared product tokens, clearer panel/action/empty
  state hierarchy, focus-visible states, and safer dense text wrapping.
- Desktop and mobile visual QA is automated with Playwright.
- Public-safe screenshot candidate generation exists with synthetic fixture data and visible-text
  guards before candidate files are written.
- Dense-state Playwright QA now seeds many memory spaces, many sources, long labels, long chat
  answers, review queues, and activity rows; it verifies desktop/mobile bounds and writes dense
  evidence screenshots.
- Progressive-disclosure cleanup is implemented for default Workbench language: rule filters,
  settings summaries, cost details, cleanup internals, chat understanding, and memory badges now use
  human-facing labels while exact technical values remain inspectable.
- `npm run stage1:acceptance` is the explicit Stage 1 gate. It verifies all Stage 1 goals are
  completed, language contracts exist, and Playwright evidence screenshots/public-safe candidates
  are present.

## Partially Implemented

- Nothing remains for Stage 1 closure. Future real-world pilot histories may still suggest polish,
  but that belongs to later product/UI iteration, not the Stage 1 gate.
- Public-safe screenshot candidates exist; final public screenshot approval still belongs to Stage 7.

## Not Implemented Yet For Stage 1 Closure

- None.

## Out Of Scope For Stage 1

- New storage semantics.
- Client hook implementation.
- Installer/public packaging.
- Real connector capture.
- Personal-memory ingestion.
- AI chat interpretation changes, except where UI text displays existing results.

## Evidence Checked

- `docs/SESSION_HANDOFF_CURRENT.md`: Workbench checkpoints and latest Stage 1 follow-up notes.
- `docs/WORKING_CONTEXT.md`: current Workbench, focused views, source filters, settings polish,
  browser QA, and public-safe screenshot notes.
- `docs/DEVELOPMENT_PLAN_2026-06-01.md`: Stage 1 target and acceptance.
- `apps/server/src/index.ts`: server-rendered Workbench UI implementation.
- `scripts/smoke-review-ui.mjs`: Workbench vocabulary, review, chat, sources, settings, and safety
  gates.
- `scripts/smoke-review-ui-playwright.mjs`: desktop/mobile visual QA, focused views, dense state,
  human-default-language guard, public-safe screenshot candidates, and no-horizontal-scroll checks.
- `scripts/smoke-stage1-workbench.mjs`: explicit Stage 1 acceptance gate.
- `/ai/playwright/reports/public-safe-candidates`: generated internal candidate screenshot paths.
- `/tmp/recallant-stage1-acceptance.json`: latest Stage 1 acceptance report path.

## Risks

- Later stages can still add complexity that reintroduces technical labels. Keep
  `stage1:acceptance`, `review-ui:smoke`, and `review-ui:playwright` in the verification loop when
  changing Workbench surfaces.
- Stage 7 public screenshots still require final manual/public approval before publishing.

## Current Decision

Stage 1 is closed. Continue with the next requested stage/goal rather than adding more Stage 1 work
inside this slice.
