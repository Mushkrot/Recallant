# Development Plan - 2026-06-01

This is the next development plan after the first green Product Acceptance
surface. It is based on the owner discussion, current docs, upstream reviews,
and current implementation status.

The plan assumes Recallant has a working first production-ready coding-agent
memory slice. The goal now is to evolve it from a technically working platform
into the owner-facing external-memory product.

## North Star

Recallant should become a private external memory for the owner and their AI
agents.

The owner should be able to work normally with agents. Recallant should
remember, organize, retrieve, explain, and protect the important context without
requiring daily manual memory administration.

## Product Principles

1. **Memory spaces, not folders only.** A project can be a repo, server, client,
   research area, recurring process, personal domain, or virtual topic.
2. **Sources attach to memory spaces.** Folders, repos, server paths, documents,
   connectors, and manual/virtual sources are bindings to a project.
3. **Human language first.** The UI explains meaning, risk, status, and next
   action before technical detail.
4. **AI-first interpretation.** AI should understand requests, classify memory,
   propose actions, and explain results wherever semantic judgment matters.
5. **Policy-governed execution.** Deterministic server policy controls secrets,
   deletion, paid API, public exposure, production operations, auth, and audit.
6. **Safe autonomy by default.** Recallant should choose good defaults and run
   safe work automatically, while manual/guided modes remain available.

## Stage 1 - Human Workbench Quality

Goal: make the private UI feel like a professional management workbench, not an
internal database dashboard.

Work:

- Replace remaining technical-first labels on default screens with human
  language.
- Add a "Memory Spaces" view that separates project meaning from attached
  folders/sources.
- Add an "Activity / Replay" view inspired by AgentMemory: last session start,
  last context read, last memory write, last checkpoint, and recent captured
  decisions.
- Improve "What Needs Attention" so it tells the owner exactly what decision is
  waiting and why.
- Keep technical values collapsed behind details panels.
- Add screenshot/Playwright checks for layout, scrolling, and text overflow on
  desktop and mobile widths.

Acceptance:

- A non-technical owner can understand the main screen without reading JSON,
  IDs, route classes, or schema names.
- The UI shows whether each project is registered only, capture active, or
  stale/interrupted.
- Long chat answers do not waste page space or push the workbench into awkward
  scroll-only layouts.

2026-06-01 first implementation slice:

- Done: private UI renamed and reorganized as `Recallant Workbench`.
- Done: first-class sections for Command Center, Memory Spaces, Activity /
  Replay, Ask Recallant, Review, and Settings.
- Done: Ask Recallant moved into the central work area.
- Done: dashboard API exposes recent activity and per-project capture-state
  fields.
- Done: default screens use human-readable labels for local semantic search,
  capture state, memory-space source, and sharing/isolation policy.
- Done: `npm run review-ui:smoke` verifies the Workbench layout contract and
  activity/capture fields.
- Done: server-wide Playwright `1.60.0` QA tooling is installed as an on-demand
  CLI on the owner server, with shared browser binaries under
  `/ai/playwright/browsers` and no service/listener.
- Done: `npm run review-ui:playwright` runs a Recallant-specific headless
  browser smoke against a local authenticated Workbench fixture, verifies
  desktop/mobile overflow and Ask Recallant placement/readability, and saves
  screenshots under `/ai/playwright/reports`.

2026-06-01 follow-up Workbench slice:

- Done: Ask Recallant is now the wide top work surface instead of sharing a
  narrow first-viewport column with secondary admin panels.
- Done: Cost / Paid API, Cleanup / Forget, Settings, and Selected Detail moved
  into a secondary grid below the main work area so chat answers and review work
  have more horizontal room.
- Done: Playwright verifies that Ask Recallant is in the central work area,
  long Russian chat answers remain readable, and desktop/mobile layouts have no
  horizontal scroll.

## Stage 2 - AI-Native Management Layer

Goal: make "Ask Recallant" a real AI-managed control surface, not keyword
matching with a chat box.

Work:

- Route management chat through local LLM interpretation by default when
  available.
- Add structured intent outputs: read-only answer, proposed safe action,
  dry-run required, confirmation required, blocked by policy, or needs
  clarification.
- Use AI to classify the target memory space/source when the owner writes
  naturally.
- Use AI to propose cleanup/rule/import plans, then execute only through normal
  policy-controlled APIs.
- Add deterministic fallback labels when AI is unavailable.
- Add tests where Russian and English owner requests are understood by meaning,
  not only keywords.

Acceptance:

- "Save this rule for all projects" creates the correct governed workflow.
- "Remove this sandbox from Recallant" proposes the right project target or asks
  for clarification if ambiguous.
- Risky requests never execute directly from chat without dry-run/confirmation.

2026-06-01 first implementation slice:

- Done: Management Chat API now returns `result_type`:
  `read_only_answer`, `safe_action`, `dry_run_required`, `confirmation_required`,
  `blocked_by_policy`, or `needs_clarification`.
- Done: Ask Recallant shows the result type in human language.
- Done: explicit developer-wide rule requests return `safe_action` after saving
  the governed developer-scope rule.
- Done: cleanup requests return `dry_run_required` and still require the normal
  policy path before execution.
- Done: paid API, public exposure, connector/account, and global model/provider
  changes return `confirmation_required`.
- Done: secret-reveal requests return `blocked_by_policy`, not a confirmable
  action.
- Done: deterministic fallback now understands additional owner-level requests:
  check whether a project is actually recording, show what the agent remembered,
  explain why a rule is not applying, and route Google Drive/example lookup
  requests to controlled cross-project recall guidance.
- Remaining: broaden live local-AI semantic tests beyond deterministic fallback
  and strengthen multi-project clarification UX.

## Stage 3 - Project Sources And Memory Spaces

Goal: evolve from folder-first projects to logical memory spaces with multiple
sources.

Work:

- Implement or prepare migrations for `project_sources` according to
  [DATA_MODEL.md](DATA_MODEL.md).
- Keep `projects.primary_path` as compatibility/display fallback.
- Add CLI/UI flows:
  - create a virtual memory space;
  - attach a folder/repo/source to an existing memory space;
  - detach one source without deleting the memory space;
  - show all sources for a memory space.
- Update context packs so project/source provenance is visible but not noisy.
- Add Review UI source filters and source health/status.

Acceptance:

- A project can exist without a folder.
- One memory space can have multiple sources.
- Detaching a source does not erase the project memory.
- Agents can ask "which source did this come from?" and get a clear answer.

2026-06-01 first implementation slice:

- Done: `project_sources` table exists in the initial schema.
- Done: folder-backed `ensureProject` / `registerProject` create or refresh a
  primary `workspace_path` source.
- Done: DB APIs can create memory spaces with zero sources, attach/list/detach
  sources, and list memory spaces with source bindings.
- Done: CLI first slice supports `recallant memory-space create|list` and
  `recallant source attach|list|detach`.
- Done: Workbench Memory Spaces shows attached sources when available and falls
  back to `primary_path` when running against an older schema.
- Done: `npm run project-sources:smoke` verifies zero-source virtual memory
  space creation, multiple sources, source detach without memory deletion, and
  dashboard source visibility.
- Done: Workbench now includes browser forms to create a logical memory space,
  attach a source to the selected memory space, and detach one source without
  deleting the memory space or project files.
- Remaining: source-aware context-pack provenance, richer source health/status,
  and search/review source filters.

## Stage 4 - Client Connect And Hook Capture

Goal: make agents automatically use Recallant, not merely have a generated MCP
hint file.

Work:

- Add `recallant connect <client>` as a separate layer from `recallant attach`.
- Use AgentMemory as the main reference for idempotent client config merge,
  backups, dry-run, and hook capture.
- Add capture-active checks per client:
  - session start recorded;
  - prompt/context read recorded;
  - tool/action/verification evidence recorded where client supports it;
  - closeout/checkpoint captured.
- Add `recallant doctor --require-capture` or equivalent.
- Keep fail-soft hooks: they must not break agent work if Recallant is
  temporarily unavailable.

Acceptance:

- For each supported client, Recallant can distinguish "configured" from
  "actually recording".
- The owner does not act as QA for basic attach/connect validation.
- Product Acceptance covers at least Codex deeply and one additional client
  enough to prove the universal path.

2026-06-01 first implementation slice:

- Done: `recallant connect <client>` exists as a separate command from
  `attach`.
- Done: first slice writes/verifies project-local MCP config and reports
  `connection_status=mcp_only`, `hook_status=not_installed`, and
  `capture_status`.
- Done: `connect --dry-run` shows exact planned file changes and writes
  nothing.
- Done: Codex connect is idempotent after attach because attach still creates
  `.recallant/codex-mcp.json` for compatibility.
- Done: non-Codex clients use the generic MCP fallback until dedicated writers
  are implemented.
- Done: `npm run connect:smoke` verifies sandbox attach, Codex dry-run/
  idempotency, actual connect, and Claude Code/generic fallback dry-run.
- Done: `recallant doctor --require-capture` now fails with exit code 2 when
  the selected project is only registered or capture is partial, and passes only
  when Recallant sees context read, memory write, and checkpoint evidence from
  local session state or dashboard readiness.
- Remaining: safe global/client config writers, local backups for global config,
  hook install, and fail-soft hook capture/spooling.

## Stage 5 - More Real Pilots

Goal: validate Recallant against realistic projects without risking production
work.

Work:

- Run another clean empty-project pilot.
- Run another copied existing-project sandbox pilot.
- Run a guided attach dry-run on one production-sensitive project without
  changing it.
- Keep all pilot cleanup reversible and documented.
- Record what the agent remembered correctly in a later session.

Acceptance:

- Recallant independently validates attach/capture/closeout/recall before the
  owner is asked to inspect.
- Original projects are untouched unless explicitly approved.
- Pilot reports show what was learned and what needs product improvement.

## Stage 6 - Broader External Memory Domain Design

Goal: prepare personal/work memory expansion without prematurely building every
connector.

Work:

- Define the first non-code memory domain shape, probably a virtual/manual
  project or "personal/work operations" domain.
- Decide whether future personal domains share the same database or use a
  separate domain database inside the same Postgres instance.
- Define consent/review rules for passive or connector-based capture.
- Design connector capability bindings without raw secrets.
- Decide first connector candidates after project-source support is stable.

Acceptance:

- Architecture supports personal/work memory without mixing it into coding
  project context by default.
- AI agents can use the broader memory only through governed scope/audience
  rules.
- No passive capture is enabled without explicit owner policy.

## Stage 7 - Product Packaging And Public Readiness

Goal: make Recallant installable by a serious outside user without owner-specific
server assumptions.

Work:

- Harden installer profiles and documented rollback.
- Add one-page quickstart for outside users.
- Add public-quality screenshots after the workbench UI improves.
- Add Journey/kit-style packaging only if it helps onboarding.
- Keep owner-server `/ai` assumptions as one deployment profile, not the
  product default.

Acceptance:

- A new user can install Recallant, attach a project, connect an agent, and see
  capture-active status without reading internal architecture docs.
- Docs clearly separate ordinary user flow from advanced/self-hosted operations.

## Verification Discipline

Each stage should finish with:

- relevant targeted smoke checks;
- `npm run build` when code changes;
- `npm run lint`;
- `npm run format:check`;
- `git diff --check`;
- product or UI screenshot checks when UI changes;
- scoped commit and updated handoff/status docs.

Full `npm run smoke:core` should run after major behavior changes, acceptance
surface changes, or before production deployment.
