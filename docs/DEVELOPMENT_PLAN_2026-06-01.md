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
- Done: Memory Space source cards now show human-readable health/status such
  as primary source ready, source ready, connector setup needed, or detached,
  with a plain reason and next action.
- Done: Review rows now show compact provenance summaries such as "From source
  AGENTS.md" instead of requiring the owner to open raw source refs.

2026-06-02 Workbench composition slice:

- Done: Ask Recallant is now the first central work surface, paired with a
  compact current memory-space profile so the owner can talk to Recallant while
  seeing whether the selected space is capture-active and source-linked.
- Done: source management moved out of the left rail into a wide `Sources`
  workspace with selected-source health, detach controls, create-space, and
  attach-source flows.
- Done: Selected Detail, Cost / Paid API, Cleanup / Forget, and Settings now
  live in a lower secondary workspace instead of a side rail, reducing cramped
  right-column reading.
- Done: mobile layout shows Ask Recallant before the memory-space navigator, so
  the primary control surface remains first on small screens.
- Done: `npm run review-ui:smoke` and `npm run review-ui:playwright` verify the
  new Ask -> Sources -> secondary workspace order, source management surface,
  no horizontal scroll, and readable long chat answers.
- Done: Review is now a compact workspace with four human-readable queue
  summaries and expandable lanes for Import Candidates, Review Inbox,
  Conflicts / Duplicates, and Active Rules. This keeps review detail available
  without turning the first screen into a long database list.
- Done: `review-ui:smoke` and `review-ui:playwright` verify the compact Review
  overview layout in HTML and real desktop/mobile browser rendering.

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
- Done: `npm run management-chat-ai:smoke` runs the Management Chat interpreter
  through a mock Ollama endpoint to prove the local-AI path handles meaning that
  deterministic keywords do not cover: colloquial Russian sandbox cleanup,
  ambiguous sandbox targets, and developer-wide rule capture from non-exact
  wording.
- Done: Management Chat now understands source-management and provenance
  requests as first-class intents. It can guide the owner to create/attach/
  detach Memory Space sources safely and explain where a fact came from through
  Review provenance/Evidence excerpts.
- Done: `management-chat-ai:smoke` verifies local-AI semantic classification
  for source-management and provenance requests in addition to cleanup,
  ambiguity, and developer-wide rule capture.
- Done: source-management requests now distinguish incomplete natural-language
  asks from concrete source operations. Missing memory-space names or source
  locations return `needs_clarification` with no runnable command; concrete
  source attach requests return a safe plan pointing to the `Sources` workspace
  or `recallant source attach` without executing from chat.
- Done: source-management answers now include ready, needs-attention, and
  detached source counts, so Ask Recallant can explain source health instead of
  only reporting a total source count.
- Done: Management Chat AI smoke now runs without opening a localhost listener,
  using an in-process mock `fetch`. It also covers connection-readiness and
  rule-diagnostics owner questions with governed-memory lookup and the active
  source filter.
- Done: Review questions now produce decision-oriented triage instead of a
  generic explanation. Ask Recallant summarizes conflicts/duplicates, owner-
  decision items, and import candidates in a safe order and returns read-only
  next-step cards. The local-AI smoke covers this path.
- Remaining: broaden live local-AI semantic tests against real installed models
  and continue improving multi-project/source-target clarification UX.

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
- Done: context-pack binding rules and working memories now include redacted
  `source_refs` plus compact `provenance` summaries, so agents can answer where
  a fact/rule came from without loading raw artifact content.
- Done: Review dashboard/API and Workbench now expose source health/status and
  a source filter. The filter can select an attached source and limit source-
  linked import candidates, inbox items, and active rules while leaving global
  conflict signals visible.
- Done: source health now probes absolute local `workspace_path`, `repo`, and
  `server_path` bindings without reading source contents. Existing paths show
  local-source-ready status; missing paths and wrong folder/file shapes show
  needs-attention guidance.
- Done: remote source health now avoids unsafe probing. Remote server paths are
  shown as needing governed access binding, remote repos as needing sync/import,
  connector sources as setup-needed unless governed capability metadata exists,
  and document collections as provenance-ready references.
- Done: raw evidence search now accepts a selected `source_id`, applies the
  source-provenance filter to lexical/vector candidates and graph-expanded
  neighbors, and returns compact hit provenance. This is the raw-search
  counterpart to source-filtered governed memory recall.
- Remaining: live connector verification, governed remote-source access checks,
  and broader source-aware recovery flows.

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
- Done: Claude Code now has a dedicated project-local `.mcp.json` writer. It
  merges only the `mcpServers.recallant` entry, preserves existing MCP servers,
  creates a local backup when changing an existing file, supports dry-run, and
  is idempotent.
- Done: Cursor now has a dedicated project-local `.cursor/mcp.json` writer with
  the same merge/backup/dry-run/idempotency guarantees.
- Done: remaining non-Codex clients still use the generic MCP fallback until
  dedicated writers are implemented.
- Done: `npm run connect:smoke` verifies sandbox attach, Codex dry-run/
  idempotency, actual connect, Claude Code `.mcp.json` merge/backup/idempotency,
  Cursor `.cursor/mcp.json` merge/backup/idempotency, and generic fallback
  dry-run.
- Done: `recallant doctor --require-capture` now fails with exit code 2 when
  the selected project is only registered or capture is partial, and passes only
  when Recallant sees context read, memory write, and checkpoint evidence from
  local session state or dashboard readiness.
- Done: `recallant connect --install-local-hooks` writes an optional
  project-local hook kit under `.recallant/hooks/` without touching global
  client config. The scripts are fail-soft: missing `recallant` or timeout exits
  0 so normal agent work is not broken.
- Done: hook primary capture commands now write offline records to the project
  spool path `.recallant/spool` when the server/database path is unavailable.
  If a primary hook command fails while `recallant` is still available, the
  script also attempts a local `spool-append` fallback before exiting 0.
- Done: the local hook kit now exposes explicit lifecycle targets for session
  start, owner prompt, tool result, generic event capture, pre-compaction
  checkpoint, and stop/closeout. Server-mode closeout now also records an
  explicit closeout event before closing the session.
- Done: the local hook kit now writes `.recallant/hooks/manifest.json` with
  fail-soft policy, no-global-config guarantee, lifecycle target scripts, spool
  path, and the `recallant doctor --require-capture` readiness proof command.
- Done: `recallant doctor` / client connection readiness now validates the hook
  manifest contract and reports whether the manifest is missing, invalid, or
  valid.
- Done: `npm run connect:smoke` proves the hook scripts are fail-soft when
  `recallant` is unavailable, then runs the hooks through a temporary Recallant
  wrapper and verifies prompt, tool-result, checkpoint, closeout events, and
  manifest contract in Postgres.
- Done: `npm run mcp:smoke` now uses the official SDK in-memory transport for
  core protocol QA, verifies the Recallant MCP handshake/tool list, asserts the
  `memory_search.source_id` schema, and calls `memory_heartbeat`. This avoids
  false failures from nested child stdin behavior in restricted sandbox runs;
  the production `recallant mcp-server` stdio lifecycle remains available for
  real clients and now exits when stdin closes.
- Done: `recallant doctor` hook readiness now requires all generated hook files,
  executable scripts, and a valid manifest before reporting hooks as ready.
  `connect:smoke` includes invalid-manifest and invalid-permission regressions,
  but the DB-backed smoke must be rerun with local dev Postgres access because
  the restricted sandbox blocked it with `connect EPERM 127.0.0.1:15433`.
- Remaining: safe global/client config writers, local backups for global config,
  dedicated client hook installation where each client supports it, and richer
  hook spooling/replay diagnostics.

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

2026-06-01 first pilot-report automation slice:

- Done: `npm run pilot-report:smoke` creates an isolated clean project, attaches
  it, records decision/action/test/checkpoint memory, closes out, starts a later
  session, verifies recall, checks `doctor --require-capture`, and detaches with
  dry-run first.
- Done: the same smoke creates an existing-project fixture, copies it to a
  sandbox, attaches only the copy, imports discovered agent/doc sources, records
  and recalls pilot memory, detaches the sandbox, and verifies the original
  fixture hash tree is unchanged.
- Done: the same smoke runs a production-sensitive attach preflight and verifies
  requested autopilot is downgraded to guided with `writes_files=false` and
  `writes_database=false`.
- Done: the smoke prints a machine-readable pilot report containing what was
  attached, what sources were detected/imported, what was remembered, what was
  recalled later, what cleanup did, and what remained untouched.
- Done: the smoke also writes a JSON pilot-report artifact under
  `RECALLANT_PILOT_REPORT_DIR` or `/tmp/recallant-pilot-reports`, includes a
  `qa_summary` for the three required scenarios, and reads the artifact back to
  verify the report is persisted.
- Done: pilot reports now include a compact Workbench snapshot for clean and
  copied-sandbox pilots: capture readiness, review queue counts, source-health
  counts, and recent activity count.
- Done: `pilot-report:smoke` is part of `npm run smoke:core`.
- Remaining: run more non-fixture real-world pilots after Stage 4 hooks and
  source-health UI become richer.

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

2026-06-02 first packaging slice:

- Done: root README now shows the intended outside-user path: preview install,
  install, attach a project, connect an agent client, and prove capture with
  `recallant doctor --require-capture`.
- Done: [QUICKSTART.md](QUICKSTART.md) is now the short ordinary user journey
  instead of mixing public onboarding with owner-server production details.
- Done: [SELF_HOSTING.md](SELF_HOSTING.md) separates install profiles,
  rollback/recovery notes, verification, and security defaults.
- Done: [OWNER_SERVER.md](OWNER_SERVER.md) records the current `/ai` production
  profile as owner-specific operational evidence rather than the generic
  product default.
- Done: [PUBLIC_READINESS.md](PUBLIC_READINESS.md) tracks Stage 7 status,
  acceptance path, and remaining release blockers.
- Done: installer `--dry-run` exits before dependency checks, so a new user can
  preview the install plan before Docker is installed or available in `PATH`.
- Done: `npm run public-readiness:smoke` verifies README/Quickstart/Self-hosting/
  Owner-server/Public-readiness documentation markers plus installer dry-run for
  both profiles and the no-Docker-preview path.
- Done: added a neutral `managed-server` installer profile using generic Linux
  paths (`/etc/recallant/recallant.env`, `/var/lib/recallant`) so outside users
  do not have to treat the owner's `/ai` layout as the default managed-server
  install. The existing `owner-server` profile remains available for the current
  owner host and compatibility.

Remaining before a real public-release claim:

- Real public repository URL, release/version policy, and public install URL.
- Public-quality screenshots from the final Workbench visual direction.
- Clean-host install validation outside the owner server.
- Rollback docs tested on a non-owner host.
- Full mandatory startup parity for supported clients.
- Security review of public-facing packaging instructions.

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
