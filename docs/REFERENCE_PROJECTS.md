# Reference Projects

Recallant tracks a small set of reference projects so future contributors can understand which
external patterns influenced the product and which ones should not be copied. These notes are not
endorsements, dependency decisions, or implementation plans. They are dated public observations that
should be refreshed before making large product or architecture decisions.

Use these references through the public [Agent-Ready Projects](AGENT_READY_PROJECTS.md) contract:
thin project bootstrap, governed memory, source-backed recall, Workbench review, capability
references, and safety gates remain Recallant-owned product requirements.

## Open Brain / OB1

Snapshot basis: internal research reviewed 2026-05-19. Refresh before major architecture decisions.

Public source:

- Current repository: [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1)

### Role For Recallant

Open Brain / OB1 is Recallant's preferred foundation reference for the memory substrate and trust
model. Recallant should not clone OB1, but OB1 remains the first comparison point when memory-core
decisions conflict.

Strong patterns to keep in the design loop:

- Postgres/pgvector-style durable memory foundation.
- MCP-first and multi-client posture: one memory substrate, several AI clients.
- Governed agent-memory sidecars with provenance, review status, source refs, use policy, audit, and
  recall traces.
- Compact structured write-back instead of treating raw transcripts as durable instructions.
- Conservative instruction-grade policy: agent-generated memory should not silently become binding
  project guidance.

What not to copy:

- Do not flatten Recallant into a generic "one brain" without project/source isolation.
- Do not rely only on selective capture. Recallant also needs raw workflow evidence, capture
  profiles, review states, and source-governed recall.
- Do not copy schema or API contracts directly; Recallant-owned contracts remain authoritative.

## Open Engine

Snapshot date: 2026-07-02.

Public sources inspected:

- Public preview:
  [Make Your AI Agents Hand Off Work Without You](https://natesnewsletter.substack.com/p/ai-agent-handoffs)
- Related Open Stack / memory-loop preview:
  [How to Build Your Own AI Memory With Claude or Codex](https://natesnewsletter.substack.com/p/build-your-own-ai-memory)
- Open Brain repository context:
  [NateBJones-Projects/OB1](https://github.com/NateBJones-Projects/OB1)
- OB1/OpenClaw skill context:
  [NBJ OB1 Agent Memory for OpenClaw](https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/skills/openclaw-agent-memory/README.md)

### Current Read

Open Engine is Nate Jones's process and guide layer for moving work between AI tools. Public
material describes it as a paid guide and copy-paste template system rather than a public source
repository. Its center of gravity is the work handoff: one AI tool finishes or pauses work, then the
next AI tool, person, or team receives a task record with sources, limits, status, and receipt-style
accountability.

As observed on 2026-07-02:

- The public preview says Open Engine includes a shared task list, a seven-part task record, a
  one-loop audit, a 30-minute build, and a receipt vocabulary.
- Nate's later Open Stack preview frames the stack as: Open Brain holds memory, Open Skills holds
  method, and Open Engine moves work.
- No separate public Open Engine source repository was found under the visible
  `NateBJones-Projects` GitHub organization at inspection time.
- OpenClaw should not be confused with Open Engine. OpenClaw is a separate runtime/workspace
  ecosystem; OB1's OpenClaw Agent Memory skill is an integration that teaches OpenClaw agents to
  recall, write back compact operational memory, respect use policy, include provenance, and report
  usage through OB1 Agent Memory.

### Role For Recallant

Open Engine is a strong process reference for portable task handoff, task records, work receipts,
and multi-tool agent continuity. It is not Recallant's memory substrate. Its value is the layer
above memory: how work becomes a claimable, pausable, resumable, and finishable unit that can travel
between models, tools, agents, and people without forcing the human to carry all state manually.

Recallant already has the infrastructure pieces that Open Engine tries to make usable by process:
context packs, governed memories, source refs, checkpoints, closeout, capture-active proof,
Workbench review, and audit. The next product lesson is to make those pieces feel like one simple
task handoff contract.

Strong patterns to keep in the design loop:

- Treat the task record as a first-class product object, not just a chat summary or checkpoint.
- Preserve source, limit, status, owner, next-step, and allowed-action fields through handoff.
- Make "receipt" a concise closeout vocabulary: what changed, what evidence supports it, what was
  not touched, what is still open, and what the next agent/person may do.
- Start from the smallest useful loop: one recurring or annoying handoff that can be claimed,
  paused, resumed, and finished with evidence.
- Optimize for tool plurality. Claude, Codex, ChatGPT, browser agents, local agents, Slack, Linear,
  and humans can all be part of one job without crowning one client as the only interface.
- Separate memory, method, boundary, receipt, and judgment. Recallant should make these separations
  explicit instead of letting "agent memory" imply permission to act.

What not to copy:

- Do not replace governed memory with copy-paste task templates as the source of truth.
- Do not make paid guide text, private templates, or non-public material part of the public
  Recallant contract.
- Do not blur Open Engine, Open Brain / OB1, and OpenClaw. Treat Open Engine as process/handoff,
  OB1 as memory substrate prior art, and OpenClaw as a separate runtime/integration target.
- Do not expand Recallant into a broad personal workflow OS just because Open Engine discusses work
  moving through many life and team tools.
- Do not let "receipt" become a self-attested completion note. Recallant receipts should stay tied
  to source refs, event evidence, review state, and audit where available.

### How Recallant Can Use This Reference

Task handoff checklist:

- Define a Recallant-owned task handoff record that can be created from agent start, closeout,
  checkpoint, or Workbench review.
- Map the record onto existing governed primitives: source refs, raw evidence, memories,
  checkpoints, graph relations, review state, and system activity events.
- Add a receipt view or CLI output that says whether work was saved, spooled, reviewed, recalled,
  and safe for the next agent to continue.
- Keep the record bounded and portable enough to paste into another tool, while preserving the
  server-backed authoritative state in Recallant.
- Study Open Engine deeply before designing team handoff UX, but implement only the pieces that
  strengthen governed coding-agent continuity.

## MemPalace

Snapshot basis: internal research reviewed 2026-05-19. Refresh before major architecture decisions.

Public sources:

- Current repository: [MemPalace/mempalace](https://github.com/MemPalace/mempalace)
- Public site: [MemPalace](https://mempalaceofficial.com/)

### Role For Recallant

MemPalace is a reference for verbatim-first capture, memory preservation, search/archive/recovery
workflows, temporal knowledge-graph ideas, and pre-compaction/session capture patterns.

Strong patterns to keep in the design loop:

- Preserve enough original evidence that later summaries and memories can be audited.
- Treat hooks and sweep-style capture as useful safety nets after the MCP append path is reliable.
- Study temporal facts, relation invalidation, timeline, and recovery flows.
- Make archive/search/recovery understandable for humans, not only as backend indexing.

What not to copy:

- Do not adopt a Chroma-centric or project-specific schema as Recallant's source of truth.
- Do not import unlimited raw capture into normal context. Recallant should use capture profiles,
  raw artifact pointers, excerpts, caps, and review policy.
- Do not copy product language or metaphors that make Recallant less direct for maintainers.

## AgentMemory

Snapshot basis: internal supplemental research reviewed 2026-06-01. Refresh before major
client-integration decisions.

Public source:

- Current repository: [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory)

### Role For Recallant

AgentMemory is the strongest reference for proving that agents are actually connected and recording:
client `connect` adapters, hook-based capture, native skills, live viewer/replay, capture-active
diagnostics, and sandboxed retrieval evaluation.

Strong patterns to keep in the design loop:

- Idempotent client configuration with dry-run, backups, and clear "MCP-only" versus hook-enabled
  status.
- Lifecycle hooks for session start, user prompt, tool use, pre-compact, stop, and closeout.
- Live activity/replay surfaces that make "capture active" visible.
- Agent-facing skills or instructions that teach when to recall, remember, recap, forget, and hand
  off.
- Sandboxed retrieval evaluation rather than relying only on intuition.

What not to copy:

- Do not replace Recallant's project attach/source lifecycle with loose path or basename identity.
- Do not replace governed Postgres/project memory with an all-project shared memory default.
- Do not expand Recallant's v1 MCP surface just because another project exposes many tools.
- Do not bypass Recallant's review, retention, or erasure policy.

## Journey / Journey Kits

Snapshot basis: internal research reviewed 2026-05-19. Refresh before major packaging decisions.

Public sources:

- Public site: [Journey Kits](https://www.journeykits.ai/)
- Public kit API: [Journey kit](https://www.journeykits.ai/api/kits/journey)
- Public kit documentation API: [kit.md docs](https://www.journeykits.ai/api/docs/kit-md)

### Role For Recallant

Journey / Journey Kits is a packaging, onboarding, and workflow-distribution reference. It is not
Recallant's memory foundation, but it is useful for making "new project -> one action -> usable
agent setup" feel real.

Strong patterns to keep in the design loop:

- Target-aware install for clients such as Codex, Cursor, Claude Code, Windsurf, and generic MCP
  clients.
- Resolver hints so agents load the smallest relevant instructions, docs, or memories for a task.
- Preflight checks, verification, versioning, and install outcome reports.
- Workflow packaging that can eventually coexist with Recallant's CLI and self-host path.

What not to copy:

- Do not make Recallant core memory depend on Journey SaaS.
- Do not let kit packaging own Recallant's source-of-truth data model.
- Do not trust public workflow packages without local review.

## OpenMemory Variants

Snapshot basis: internal research reviewed 2026-05-19. Refresh before major memory-product
decisions.

Public sources:

- [CaviraOSS/OpenMemory](https://github.com/CaviraOSS/OpenMemory)
- [mem0ai/mem0 OpenMemory path](https://github.com/mem0ai/mem0/tree/main/openmemory)
- [Mem0 OpenMemory announcement](https://mem0.ai/blog/introducing-openmemory-mcp)

### Role For Recallant

OpenMemory-style systems are useful prior art for user memory management, salience, decay,
reinforcement, temporal facts, connectors, SDK/server/MCP modes, and explainable recall traces.

Strong patterns to keep in the design loop:

- Lifecycle signals such as salience, decay, reinforcement, and last access.
- User/project scoping and connector-oriented memory capture.
- Explainable traces for why something was recalled.
- Local MCP onboarding ideas from historical OpenMemory work.

What not to copy:

- Do not treat sunset or rewrite-warning packages as Recallant's foundation.
- Do not import a full cognitive taxonomy just because it exists elsewhere.
- Do not make synthetic embeddings or unstable package surfaces core assumptions.

## Odysseus

Snapshot date: 2026-06-08.

Public sources inspected:

- Current repository: [pewdiepie-archdaemon/odysseus](https://github.com/pewdiepie-archdaemon/odysseus)
- Current license file:
  [MIT License](https://raw.githubusercontent.com/pewdiepie-archdaemon/odysseus/dev/LICENSE)
- Current README:
  [Odysseus](https://raw.githubusercontent.com/pewdiepie-archdaemon/odysseus/dev/README.md)
- Public landing page:
  [Odysseus - A Self-Hosted AI Workspace](https://pewdiepie-archdaemon.github.io/odysseus/)
- Releases page:
  [GitHub releases](https://github.com/pewdiepie-archdaemon/odysseus/releases)

### Current Read

Odysseus is a fast-moving self-hosted AI workspace. Its public positioning is close to
"ChatGPT/Claude UI, but local-first": chat, agents, MCP tools, hardware-aware local model setup,
deep research, model comparison, documents, memory/skills, email, notes/tasks, calendar, mobile
support, image tooling, theming, uploads, web search, presets, sessions, and two-factor auth.

As observed on 2026-06-08:

- The repository was not previously listed in Recallant's public reference docs.
- The default branch is `dev`, and the README says it contains the latest development changes while
  `main` is the more stable curated branch.
- Public traction shown by GitHub at inspection time was about 63.6k stars, 7.8k forks, 464 open
  issues, 563 open pull requests, and 1,032 commits. Treat those as dated traction signals, not
  stable quality metrics.
- No GitHub releases were published at the time of inspection.
- The repository license file is MIT, but Odysseus also references and bundles third-party systems
  and optional components. Any code reuse still needs normal dependency and license review.

### What Is Strong For Recallant

Interface and product shape:

- The first impression is an actual workspace, not an admin checklist. It leads with a familiar chat
  surface, capability groups, provider/model affordances, and visible examples.
- The public landing page uses screenshots and hover/tap previews to make product behavior concrete.
  Recallant's public docs should similarly show synthetic-data screenshots of the real Workbench,
  not only architecture prose.
- The UI is deliberately mobile-aware: installable PWA language, responsive previews, touch gestures,
  and mobile screenshots are part of the product promise.
- Settings carry much of the configuration burden. That is the right direction for Recallant too:
  deployment-level config should stay explicit, but everyday source, model, review, and memory state
  should be visible in the Workbench.
- The project treats a broad AI product as one coherent workspace with modes. Recallant can use the
  same UI lesson while keeping a narrower scope: Capture, Review, Recall, Sources, Clients, Settings,
  Health, and Ask Recallant.

Self-hosting and safety:

- The README makes loopback binding, auth, first-login credentials, Docker defaults, and private
  network exposure concrete. Recallant should keep the same level of plain-language operational
  guidance.
- The setup path accepts local models and API providers without making either path feel secondary.
  Recallant should keep model routing explicit, local-first, and approval-gated for paid APIs.
- The project separates default app configuration from deployment-level `.env` overrides. Recallant
  should continue to distinguish code, runtime config, local state, captured evidence, and reviewed
  memory.

Feature ideas worth studying:

- Model comparison as a first-class workflow, especially for review or management-chat answers where
  a maintainer may want several model perspectives before accepting durable memory.
- Hardware/model "Cookbook" style recommendations as an analogy for Recallant's doctor output:
  detect current environment, explain what is ready, and recommend the next safe action.
- A visible documents surface where the human writes and AI assists. Recallant's review surfaces
  should keep humans in the authorizing role, not make agent output feel automatically canonical.

### What Not To Copy

- Do not copy the whole product scope. Recallant is not an email client, calendar, local model
  serving studio, image editor, document suite, and agent workspace.
- Do not copy the casual brand voice or visual identity. Recallant should feel calm, trustworthy,
  and maintainer-oriented.
- Do not assume high GitHub traction equals product maturity. The lack of releases, large issue/PR
  surface, and default `dev` branch are stability cautions.
- Do not import powerful local tools such as shell, email, uploads, and model servers into Recallant
  unless they directly serve governed memory and pass security review.
- Do not reuse code without a dependency and third-party-license review, even when the top-level
  license is permissive.

### How Recallant Can Use This Reference

Workbench/UI checklist:

- Start the next Workbench redesign from concrete reference layouts, with Odysseus as one of the
  comparison points, instead of inventing another bespoke interface from a blank page.
- Make the first screen useful: ask/recall in the center, source and memory status visible, pending
  review obvious, and secondary administration behind clear navigation.
- Add screenshot-backed docs and visual smoke artifacts for desktop and mobile states.
- Make mobile a real target, not a compressed desktop table.
- Keep settings, sources, and policy state visible enough that maintainers can understand what the
  agent is allowed to remember and where it came from.

## OpenHuman

Snapshot date: 2026-07-02.

Public sources inspected:

- Current repository: [tinyhumansai/openhuman](https://github.com/tinyhumansai/openhuman)
- Current README:
  [OpenHuman](https://raw.githubusercontent.com/tinyhumansai/openhuman/main/README.md)
- Memory Tree docs:
  [Memory Trees](https://raw.githubusercontent.com/tinyhumansai/openhuman/main/gitbooks/features/obsidian-wiki/memory-tree.md)
- SuperContext docs:
  [SuperContext](https://raw.githubusercontent.com/tinyhumansai/openhuman/main/gitbooks/features/super-context.md)
- Goals and todos docs:
  [Goals & Todos](https://raw.githubusercontent.com/tinyhumansai/openhuman/main/gitbooks/features/goals-and-todos.md)
- Latest release at inspection time:
  [v0.58.7](https://github.com/tinyhumansai/openhuman/releases/tag/v0.58.7)

### Current Read

OpenHuman is a fast-moving personal AI harness and desktop workspace. Its public positioning is
close to "personal AI with local memory plus managed services where needed": UI-first onboarding,
local Memory Tree / Obsidian-style vault, SuperContext first-turn preparation, goals and todos,
integrations, MCP/skills catalogs, native tools, model routing, voice, meetings, and optional local
AI.

As observed on 2026-07-02:

- The repository was not previously listed in Recallant's public reference docs.
- The default branch is `main`.
- Public traction shown by GitHub at inspection time was about 34k stars, 3.3k forks, 157 open
  issues, and 48 published releases. Treat these as dated traction signals, not stable quality
  metrics.
- The latest GitHub release was `v0.58.7`, published on 2026-06-30.
- The repository license is GPL-3.0. Treat OpenHuman primarily as a product, UX, and lifecycle
  reference unless a separate license and dependency review approves code reuse.

### What Is Strong For Recallant

Memory and context lifecycle:

- SuperContext is a strong reference for the idea that a new agent thread should not start cold.
  Its harness-level, read-only context scout maps well to Recallant's lifecycle gate direction:
  session start, bounded context pack, proof that memory was read, and graceful fallback when context
  cannot be prepared.
- Memory Tree is a useful product reference for making memory visible as source/topic/global trees,
  bounded chunks, provenance, background jobs, retrieval scopes, and an Intelligence tab rather than
  only a hidden vector index.
- Goals and todos show a durable work contract across turns, interruptions, budgets, and approval
  gates. Recallant can use this as a reference for agent closeout, next-step readiness, checkpoints,
  and "what should the next agent do?" surfaces.

Product and trust:

- The README states the local versus managed-service boundary plainly. Recallant should keep the
  same candor around local-first defaults, remote MCP/server mode, model routing, credentials, and
  paid or hosted services.
- The install docs prefer native packages and call out the risk of unverified script installs.
  Recallant should keep similarly explicit setup, verification, and trust wording.
- The Intelligence/Memory surfaces are user-visible. Recallant's Workbench should likewise show
  capture health, source freshness, review state, provenance, and recall proof in plain language.

### What Not To Copy

- Do not copy the broad personal-agent scope. Recallant is not trying to be a meeting bot, voice
  assistant, media generator, integrations marketplace, and general desktop agent.
- Do not make a managed backend or hosted connector layer feel like an implicit default for
  self-hosted Recallant. Remote/server paths must stay explicit, scoped, and auditable.
- Do not copy the connector/skills/MCP catalog scale before the governed memory core is excellent.
  More tools can mean more policy, review, and secret-management risk.
- Do not adopt anthropomorphic product framing or mascot-centered UX. Recallant should stay calm,
  professional, and maintainer-oriented.
- Do not reuse code without GPL-3.0, dependency, and architecture review.

### How Recallant Can Use This Reference

Lifecycle and Workbench checklist:

- Treat first-turn context preparation as a product contract, not an optional model behavior.
- Make next-agent readiness visible: context read, memory write, checkpoint, recall proof, and
  saved/spooled/review status should be legible before another agent resumes.
- Expose memory topology as a governed source map: source, topic, project, decision, stale/conflict,
  accepted/rejected, and provenance states should be actionable.
- Keep durable thread goals and task boards in mind when designing closeout, follow-up, and
  budget-limited agent work.
- Preserve candor in docs: local storage, remote server mode, hosted/paid services, installer
  integrity, and connector credentials must be stated in ordinary language.

## MF0.ai / MF0-1984

Snapshot date: 2026-06-08.

Public sources inspected:

- Live product site: [MF0.ai](https://mf0.ai/)
- Current repository: [PavelMuntyan/MF0-1984](https://github.com/PavelMuntyan/MF0-1984)
- Current README:
  [MF0-1984](https://raw.githubusercontent.com/PavelMuntyan/MF0-1984/main/README.md)
- Current engineering handoff:
  [HANDOFF.md](https://raw.githubusercontent.com/PavelMuntyan/MF0-1984/main/HANDOFF.md)
- Public LinkedIn profile and recent posts:
  [Pavel Muntyan](https://cy.linkedin.com/in/paulmountian)

### Current Read

MF0.ai is Pavel Muntyan's current AI workspace product. The related public repository is
`PavelMuntyan/MF0-1984`, described as a local-first single-page app for multi-provider LLM chat,
structured workflows, a 3D Memory tree over SQLite, themes and dialogs, analytics, favorites, and
project profile backup/restore.

As observed on 2026-06-08:

- MF0-1984 is not a new Recallant reference. Earlier Recallant planning already treated it as a
  first-class workbench, raw-capture, Memory Tree, Keeper-style pipeline, export/import, and
  provider-proxy reference. This public note restores that reference into the current trimmed OSS
  documentation surface and refreshes it with current public product/news observations.
- GitHub showed 87 stars, 11 forks, 4 open issues, 0 open pull requests, 94 commits, and no
  published releases.
- `package.json` marks the package as `private: true`, and no top-level license file was visible in
  the GitHub page. Treat the repository as a public-code reference only unless the license is
  clarified.
- The live site presents "one interface, every model": ChatGPT, Claude, Gemini, Grok, Perplexity,
  AI Opinion, shared context, attachments, memory, analytics, and cost tracking.
- Recent public posts describe active work on parallel multi-model answers, Memory Tree, themes,
  voice/audio chat, sticky scroll during streaming, interface scaling, rule attachments, import from
  Claude/Gemini, cost optimization, and mobile-oriented tap targets.
- The handoff notes version 1.9.26 as a mobile UI redesign with icon navigation, compact bottom bar,
  mobile theme controls, and Memory tree camera behavior. Version 1.9.28 focuses on moving embedded
  image payloads out of SQLite into attachment files.

### What Is Strong For Recallant

Memory UX:

- Memory is a visible product object, not only a retrieval backend. The Memory tree has node/link
  counts, group filters, zoom/repulsion controls, focus/reset actions, and node details.
- The live product separates user intent into spaces such as Intro, Rules, APIs/Access, Help, and
  Incognito. Recallant can use the same idea with coding-agent spaces: Project facts, Rules,
  Decisions, Sources, Clients, Review, and Health.
- The project profile export/import flow is explicit about what data is inside the bundle. Recallant
  should be equally clear about memory export/import, backups, evidence, and sensitive local state.

Interaction details:

- AI Opinion makes multi-model comparison a normal mode, not an advanced hidden feature. Recallant
  can study this for management-chat answers, risky memory promotion, or source-conflict review.
- Sticky scroll during streaming is a small but important sign of respect for readers. Recallant
  should avoid forcing maintainers away from text they are inspecting.
- Interface scale controls acknowledge that dense AI workbenches need user-adjustable readability.
- Mobile icon navigation and large tap targets are treated as product work, not afterthoughts.

Cost and operations:

- Cost analytics are visible to users. Recallant should continue to expose paid-model approval,
  local fallback, and usage/cost state plainly.
- Recent work moved provider keys through a server-side proxy rather than exposing real keys to the
  browser. That aligns with Recallant's rule that raw secrets should stay out of memory, fixtures,
  examples, and browser surfaces.
- The Memory tree optimization notes distinguish deterministic graph cleanup from LLM checks.
  Recallant should keep the same clarity when labeling deterministic analysis versus AI-generated
  suggestions.

### What Not To Copy

- Do not copy code until the license is clarified. A public GitHub repository without a visible
  license is not open-source reuse permission.
- Do not turn Recallant into a general personal assistant. Recallant's center is governed
  coding-agent memory: provenance, project scope, review state, policy, and safe recall.
- Do not make memory graph beauty a substitute for governance. Recallant needs visible review,
  source, conflict, stale, accepted, rejected, and policy states, not only graph visualization.
- Do not import consumer billing, crypto top-up, media generation, or broad provider marketplace
  features unless they serve Recallant's maintainer workflow.

### How Recallant Can Use This Reference

Workbench/UI checklist:

- Preserve the earlier accepted role: MF0 remains a first-class workbench/raw-capture/Memory Tree
  reference, not a newly discovered side project.
- Make Memory Tree / Source Map more useful and less decorative: node details, filters, source
  status, and review state should be directly actionable.
- Add UI affordances for large text and streaming answers: sticky scroll, capped scroll regions,
  copy feedback, and readable long-answer handling.
- Consider an optional multi-model comparison mode only for high-value management or review flows,
  with cost approval and provenance labels.
- Add interface density/scale options only after the core layout is stable; avoid using scaling to
  compensate for unclear information architecture.
- Keep sensitive areas visibly locked or permission-gated where appropriate, while avoiding a fake
  sense of security for data that still requires server-side policy.

## Kortix / Suna

Snapshot date: 2026-06-08.

Public sources inspected:

- Current repository: [kortix-ai/suna](https://github.com/kortix-ai/suna)
- Current license file:
  [Elastic License 2.0](https://raw.githubusercontent.com/kortix-ai/suna/main/LICENSE)
- Old `v1` README:
  [Suna - Open Source Generalist AI Agent](https://raw.githubusercontent.com/kortix-ai/suna/v1/README.md)
- Old `v1` license:
  [Apache License 2.0](https://raw.githubusercontent.com/kortix-ai/suna/v1/LICENSE)
- Current release example:
  [v0.9.35](https://github.com/kortix-ai/suna/releases/tag/v0.9.35)

### Current Read

Kortix / Suna is the public source line to watch for a polished agent workspace. It appears to have
moved from an Apache-licensed "generalist AI agent" posture in the `v1` era to a source-available
company command-center posture on current `main`.

As observed on 2026-06-08 through GitHub UI/API and a shallow clone:

- Repository created: 2024-10-05.
- Public traction: about 19.8k stars, 3.4k forks, and 154 subscribers.
- Public activity: about 10k repository commits, 66 contributors returned by GitHub contributor
  stats, and 9,100 commits in the trailing 52-week participation endpoint.
- Recent velocity: 2,614 commits in the trailing 12 weeks and 374 commits in the latest reported
  week.
- Releases: 57 GitHub releases since 2025-06-08, with `v0.9.35` published on 2026-06-08.
- Open work surface at the time of inspection: 6 open issues and 6 open pull requests in the GitHub
  UI. Public issues are not the full planning signal because many work items are linked to Linear or
  handled through release PRs.
- Current repository license: Elastic License 2.0. Treat it as source-available and self-hostable,
  not permissive OSS for building a competing hosted/managed service.

The old `v1` branch presented Suna as a generalist assistant for browser automation, file work,
search, command execution, data analysis, and report generation. The current main branch presents
Kortix as an AI command center for companies: projects as repositories, session sandboxes, agent
branches, change requests, connectors, secrets, channels, triggers, desktop/mobile surfaces, and
cloud/self-host paths.

### What Is Strong For Recallant

Product packaging:

- Clear "one repo, one config" positioning. It makes the system feel inspectable and owned instead
  of mysterious.
- CLI-first onboarding with a short install/init/ship loop. Recallant should keep improving toward
  a similarly crisp prove-it path for self-hosted memory.
- Visible release discipline. Frequent tagged releases, changelog-style names, and production-fix
  releases make the project feel alive and operationally serious.

Agent governance:

- Sessions run in isolated sandboxes and only durable work survives through commits and change
  requests. This is a useful governance analogy for Recallant memory: agent-produced memory should
  have source, status, review, and promotion gates.
- The change-request surface gives humans a normal place to approve agent changes. Recallant should
  keep the Workbench as the normal place to approve durable rules, resolve memory conflicts, and
  inspect source-backed capture.
- The project separates disposable runtime state from durable project state. Recallant should keep
  the same discipline between runtime logs, candidate memories, accepted memories, settings, and
  exported artifacts.

Configuration and trust boundaries:

- Kortix documents a strict boundary between platform config and OpenCode agent config. Recallant
  should keep equally explicit boundaries between server config, client setup, captured evidence,
  and reviewed memory rules.
- Connectors are presented as configuration plus credentials plus policies, rather than as a vague
  "agent can use tools" promise. Recallant can use the same pattern for sources, MCP clients, and
  future write-capable integrations.
- Secrets and connector credentials are described as platform-managed, scoped, and injected or
  brokered at runtime. Recallant should continue to avoid storing secrets as memories, examples,
  fixtures, or logs.

Interface patterns:

- Public screenshots show a simple chat-like shell with a left session history, central project
  command surface, fast setup cards, prompt input, and task chips. This is a strong reminder that
  complex agent infrastructure can still feel like a familiar chat workspace.
- The Customize surface groups work by user intent: Build, Connect, Automate, then operational
  surfaces such as Changes, Files, Sandbox, Members, and Settings. Recallant can mirror that
  clarity with groups such as Capture, Review, Recall, Sources, Clients, Settings, and Health.
- The connector screen shows stored config, credential state, sync/add actions, and policy tabs in
  one restrained surface. Recallant should make memory-source status and policy state similarly
  visible.
- The change-request screen makes "nothing to review" an explicit state. Recallant should use the
  same calm empty-state pattern for no pending memories, no conflicts, no stale rules, and no source
  warnings.

Operational maturity:

- Recent releases include reliability fixes, billing and migration work, desktop delivery, Slack or
  channel reliability, static webhook authentication, project memory, typed APIs, SOC 2 baseline
  work, and deployment pipeline changes. This shows what a product looks like after moving beyond a
  demo.
- The repository includes web, API, CLI, desktop, mobile, sandbox, docs, infra, tests, gitleaks, and
  security-oriented configuration. Recallant should use this as a reminder to harden install,
  security review, release, and smoke-test paths before presenting itself as stable infrastructure.

### What Not To Copy

- Do not copy code or build a hosted derivative from current `main` without a license review. The
  current Elastic License 2.0 has hosted/managed-service restrictions.
- Do not chase the full autonomous-company operating-system scope. Recallant is not trying to own
  agents, apps, channels, billing, deployments, and business automation. Its sharper role is
  governed memory for coding agents.
- Do not make memory just "files that agents can edit" as the final model. That is transparent but
  not enough for Recallant's goals: provenance, review state, scope, conflict handling, lifecycle,
  and policy still need first-class product surfaces.
- Do not let agents rewrite durable instructions or memory rules without human review. Kortix has a
  change-request path; Recallant needs the same spirit for memory promotion.
- Do not treat GitHub stars as proof of quality by themselves. Use them as traction signal only,
  alongside release cadence, issue quality, contributor distribution, docs, install proof, and
  maintainability.
- Do not import their broad connector ambitions too early. Recallant should first make project
  memory capture, recall, review, and source governance excellent, then expand integrations.
- Do not copy the brand, wording, or visual identity. The useful lesson is the interaction pattern:
  simple shell, visible state, review gates, and plain language.

### How Recallant Can Use This Reference

Near-term product checklist:

- Keep the Quickstart short enough that a maintainer can prove one project remembers in minutes.
- Add more screenshot-backed public docs using synthetic data only.
- Make Workbench states obvious: pending review, accepted, rejected, stale, conflict, source
  warning, and healthy.
- Present memory sources like governed connectors: configured source, credential or access state,
  last capture, policy, and review status.
- Keep release notes and smoke checks visible enough that users can see Recallant becoming
  operationally serious.

Architecture checklist:

- Preserve strict boundaries between code, runtime config, private local state, captured evidence,
  memory records, and reviewed rules.
- Keep agent-facing context packs server-built and bounded.
- Treat automatic memory extraction as proposal generation, not automatic instruction promotion.
- Make export/import and rollback part of the self-host story, not an afterthought.

Strategic checklist:

- Use Kortix / Suna as a benchmark for polish and operational seriousness.
- Use Recallant's narrower scope as the differentiator: durable, governed, evidence-backed memory
  for coding agents across sessions and clients.
- When evaluating new features, ask whether they improve memory governance or merely expand the
  platform surface.

### Refresh Checklist

Before making a major decision based on this note:

- Re-check the current license on `main`.
- Re-check release cadence, issue/PR health, and contributor distribution.
- Compare the current README and docs against the `v1` baseline.
- Inspect the current public screenshots or the live product if an account is available.
- Confirm whether any official Kortex/Eden source repository has been published. Do not assume the
  Kortex/Eden product and Kortix/Suna repository are the same codebase unless official sources say
  so.

## Kortex / Eden

Kortex / Eden is tracked separately as a product and UX reference, not as a confirmed public source
repository for Recallant to study. Its useful lesson is the opposite side of the same market: a
polished human/team second-brain surface with capture, search, chat over knowledge, writing
workflows, collaboration, export, and an MCP bridge for assistants.

Recallant should learn from its clarity and simplicity, but keep its own center of gravity:
agent-first governed memory, project scope, provenance, review, and safe recall.
