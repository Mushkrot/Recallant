# Working context snapshot

Last updated: 2026-05-30.

This file preserves the current conversation-level direction so a future agent does not restart the architecture discussion from zero.

## Current product intent

Recallant is a **full-quality personal memory product for AI-assisted software work**, not a quick demo and not a thin RAG prototype. The project owner prefers spending more design and implementation effort if that produces a stronger durable system.

The core problem remains: AI coding work spans multiple clients, projects, sessions, and context compactions. The user needs one durable memory substrate that helps agents resume work, understand prior decisions, avoid repeating analysis, and carry important preferences/rules across projects.

Current daily workflow is mostly **Codex-first**, but Recallant must stay multi-client-ready because switching between agents may return later and MCP keeps the architecture portable.

Accepted refinement: Codex is the first adapter and working scenario, not the product boundary. Recallant core is a universal MCP memory runtime for Codex, Cursor, Claude Code, Windsurf, and future multi-agent workflows.

## Current architectural direction

- **Open Brain / OB1 is the preferred architectural foundation.**
- The accepted architecture direction is an **OB1/MF0 synthesis**: OB1 provides the governance backbone; MF0 provides workbench/raw-capture/Memory Tree/Keeper ideas; Recallant owns the integration layer.
- Accepted refinement: raw workflow evidence is the lower factual foundation, while governed memory is the upper behavior layer. Recallant stores enough raw/session/tool evidence to recover, audit, reprocess, and review work, but agents normally receive bounded Context Packs and governed memories rather than raw archive dumps.
- Recallant should still mine MemPalace, OpenMemory, and Journey for the best subsystem ideas. `agent-bootstrap` is different: it is the owner's earlier personal sketch/prototype for the same problem, useful as prior Recallant thinking and repo-contract inspiration, but not an external implemented upstream.
- Licensing is not a selection criterion at this stage for external upstream projects; all listed external projects may be used/adapted as needed where technically suitable.
- Architecture is not fully finalized, but future work should not reopen a neutral "which project wins" contest unless new evidence invalidates the direction.
- Matthew Berman's **Journey / Journey Kits** is now an upstream reference for packaging, installing, versioning, and distributing agent workflows. It is not the primary memory engine; see ADR-0008.

## Current v1 quality bar

v1 must include the full core needed for real use:

- Recallant server on the owner's Linux server,
- `recallant_agent_work` Postgres domain database,
- environment discovery/onboarding that models the current server/project/secret/connector reality as configurable facts rather than hard-coded assumptions,
- raw append-only memory,
- chunks and embeddings,
- hybrid retrieval with bounded responses,
- project/developer scoping,
- explicit checkpoints,
- repo-native handoff sync,
- governed agent memories with provenance, review state, and use policy,
- managed memory operations: archive, reject, supersede, stale, edit, merge, demote/promote, and explicit owner-confirmed permanent erasure,
- owner-facing Review UI for important/conflicting/long-term governed memory hygiene,
- natural-language management chat as a primary control surface, backed by UI/CLI for precision and verification,
- managed hybrid capture with per-project/session policy profiles,
- context-budget discipline so startup files do not flood the model window,
- one-action project onboarding through `recallant init` and potentially a Journey-style kit/skill.
- autonomous project attach as the target everyday workflow, with `manual`, `guided`, and
  `autopilot` modes so cautious operation remains available.
- controlled cross-project recall: agents can ask for examples/patterns from other projects, but
  unrelated project memory is not included by default and cannot silently become a current-project
  rule.
- offline/local-spool operation with later server sync and local cleanup.
- portable backup/export/restore with remapping so a Recallant instance can move to another server without losing accumulated memory, provenance, artifacts, settings, review state, or project bindings.
- universal session lifecycle: `memory_start_session`, incremental capture, `memory_closeout`, and recovery from unclosed/interrupted sessions.
- server-side Context Pack Builder via `memory_get_context_pack`.
- cleanup/self-cleaning analysis for duplicates, stale decisions, superseded guidance, abandoned experiments, low-value derived context, poor provenance, and connector/account conflicts.

Governed agent memory is **not** a phase-2 nice-to-have. It is part of the v1 core because the product is meant to preserve decisions, rules, constraints, lessons, failures, and work logs in a way agents can safely reuse.

Accepted scope boundary: v1 is a full-quality coding-agent memory core, not a demo. Future expansion includes broader personal-life memory, passive always-on capture, Gmail/Drive/Calendar/GitHub/browser/screenshot connectors, object storage for huge raw blobs, dedicated vector/graph databases, rich visual Memory Tree/workbench, public packaging/Journey kit distribution, and multi-user/SaaS/security expansion. These must remain architecture-ready but are not part of the first implementation scope unless the owner explicitly reopens scope.

## Active design stance

Start from OB1's architecture, then graft in stronger subsystem patterns. The most important accepted synthesis is:

- OB1: governed memory, evidence vs instruction-grade policy, provenance, review, source refs, recall traces, audit, compact write-back.
- MF0-1984: raw conversation/evidence persistence patterns, local workbench, Memory Tree UX, keeper pipelines, saved conduct/rules UX, project profile export/import, server-side provider proxy.
- Recallant-owned bridge: managed hybrid capture, per-project capture profiles, future-only policy changes, Review UI, context-budget enforcement, local-server-first deployment.

Additional upstream donors remain:

- MemPalace: verbatim capture, pre-compaction/session hooks, message sweep, temporal KG, hybrid retrieval, repair/recovery.
- CaviraOSS/OpenMemory: salience, decay, reinforcement, temporal facts, connectors, explainable traces.
- agent-bootstrap: owner-authored early sketch for `AGENTS.md`, `PROJECT_LOG.md`, durable repo handoff, and repo-native fallback contracts; use for ideas, not as proof of a complete implementation.
- Journey / Journey Kits: workflow packaging, install targets, preflight checks, resolver hints, versioning, outcome/learning feedback loops.

Decision refinement: do not replace OB1 with Journey as Recallant's foundation. OB1 remains the memory substrate backbone; Journey informs the packaging/onboarding/workflow layer.

Additional settled points:

- The first onboarding interface can be a command; more comfortable kit/skill packaging can come later if the project becomes public.
- The current server layout (`/ai/*` project directories, `/ai/SECURITY`, `/opt/secure-configs/.env`) is the first real deployment profile and should be supported well, but it is a particular owner environment, not an architecture invariant. Recallant must model such paths as configurable environment/project/server facts, secret references, and capability bindings rather than hard-coded assumptions.
- Recallant setup should discover its environment safely, then discuss findings and goals with the user, then persist accepted facts/rules/settings. It should not require the user to re-explain stable environment facts every session, and agents should consult memory/capability bindings automatically when blocked.
- Projects do not need secrecy-style isolation from each other, but project context must not accidentally mix or degrade another project. Cross-project reuse is allowed when explicitly requested or when developer-level memories are intentionally promoted.
- The accepted cross-project refinement is "library, not soup": a project session normally receives
  current-project memory plus applicable developer/environment/capability facts. Source-linked
  examples from other projects are available when the agent/owner asks for them, but they remain
  evidence unless applied locally or promoted through governed policy.
- Local/offline work must be supported through a spool/sync/offload path.
- First success criteria are both old-project resume in a new Codex session and one-command onboarding for a new project.
- v1 memory scope is agent working memory plus explicit imports of broader project artifacts.
- Context budget direction: repo files are only front-door/router surfaces; startup should recover state from checkpoint + governed memories, then use targeted raw search only when needed. Budget enforcement must use configurable context policy/profiles instead of universal hard-coded file-size limits. Large projects may use explicit overrides; duplicated history/secrets/adapter rule duplication remain hard errors. A server-side context pack remains a strong design option to enforce budget centrally.
- Startup context decision is accepted: this is not a manual "smart button" requirement. Recallant must provide a server-side Context Pack Builder exposed as `memory_get_context_pack`. Agents call it automatically after `memory_start_session`; CLI/UI may preview the same pack for debugging, but must not implement separate context-selection logic.
- Operational numeric values such as retrieval counts, response char caps, graph budgets, decay halflife, stale thresholds, chunk size, and embedding batch size are configurable policy/profile defaults, not architecture invariants. Hard invariants are safety/provenance/boundedness rules.
- Managed hybrid capture is accepted: preserve raw evidence broadly where feasible, but future behavior is governed by structured memories, checkpoint, scoring, review/override, scope, and project/session capture policy. Different projects can use different capture profiles: lighter projects keep essentials, complex projects record more detail. `recallant init` should assign `standard` automatically for normal coding projects, with later UI/CLI adjustment available. Later profile changes affect only the current project and only future capture; old records are not reprocessed automatically.
- Raw artifact policy is accepted: ordinary turns can live fully in L0 events; large tool/terminal outputs, media, attachments, and transcript exports use metadata + bounded excerpt + hash + pointer. v1 may store full artifacts in local/server filesystem or spool storage; object storage is a later option, not a v1 dependency.
- Governed memories should be created automatically when valid. Ordinary memory can become recallable immediately; agent-inferred long-term rules are captured as candidates, while binding `instruction_grade` requires a stronger path such as direct explicit user instruction, trusted import, or review promotion.
- Review Inbox policy is accepted: review important, conflicting, and long-term records, not every memory. Default inbox includes candidate rules, developer/global scope changes, conflicts, duplicates, high-risk security/deploy/destructive/cost/model-provider/server-access guidance, low-confidence inferred behavior guidance, long-term rule proposals, and promotion/demotion/archive/supersede candidates. It excludes raw event text, ordinary evidence chunks, routine work logs, routine facts, and low-risk source-linked memories that do not create standing behavior rules.
- The three governed-memory buckets require an explicit management workflow: owner-visible inbox, active rules list, source inspection, promote/demote/edit/archive/reject/supersede/merge actions, duplicate/conflict reports, and closeout proposals. This is now a v1 Review UI requirement, with CLI kept for automation/fallback; see `MEMORY_MANAGEMENT.md` and `ADR-0016-review-ui-in-v1.md`.
- Manual session closeout should be full and durable: raw/spool, governed memories, links, checkpoint, `PROJECT_LOG.md`, and sync state.
- Normal successful closeout should be quiet by default. Show a short closeout report only when attention is needed: unsynced spool, conflicts, pending review, failed writes, incomplete repo sync, low-confidence extraction, or server/model/provider errors.
- Human memory beyond coding remains architecture-ready only in v1; passive personal-life capture is future work.
- Implementation is authorized and active as of 2026-05-22. The owner explicitly wants Recallant implementation agents to work autonomously, follow the documented phase plan, make ordinary technical decisions, and create scoped commits at logical rollback checkpoints without asking for separate permission.
- Agents should stop only for genuinely owner-dependent choices, security/public-exposure changes, secrets, paid API use, destructive operations, server/firewall/service changes, or real specification contradictions.
- Target deployment is the owner's Linux server. The first production deployment is now accepted:
  human UI at `recallant.unicloud.ca` behind Cloudflare Access for `highmac@gmail.com`, routed by
  Cloudflare Tunnel `mainserver` to the localhost-only origin `http://127.0.0.1:3005`. Recallant
  validates Cloudflare Access identity headers/JWT assertion against `RECALLANT_ADMIN_EMAILS` and
  issues its own secure session cookie. API/automation still uses
  `Authorization: Bearer <RECALLANT_AUTH_TOKEN>`. Agents use local stdio MCP
  (`recallant mcp-server`), not remote MCP over Cloudflare in the first deployment.
- Recallant server definition is accepted: it is the always-available private backend on the Linux server that owns memory runtime, MCP endpoints, Review UI/admin API, Postgres/model access, background jobs, and sync from local spools.
- Review UI placement is accepted: it runs on the Recallant server. v1 starts as a compact private workbench and should be designed as the beginning of a fuller Recallant management platform. The first production owner-server access path is `recallant.unicloud.ca` through Cloudflare Access and Tunnel to the localhost-only Recallant origin.
- Review UI first screen is accepted: Review Inbox / Command Center. It prioritizes conflicts, candidate rules, important/needs-review memories, and duplicates, with scope/profile, critical status, selected-item evidence, and direct review actions.
- Review UI detail decision is accepted: v1 uses compact workbench Option B, not a minimal approval table and not a full admin platform. Required areas: project navigation, Review Inbox, Rules, selected-item detail/source panel, conflicts/duplicates, action controls, Cost / Paid API, and project Settings shortcut.
- Settings location is accepted: authoritative settings live centrally on Recallant server/Postgres. UI management starts from all managed projects or a project selector, then opens project-specific Review/Settings. `.recallant/config` in a repo is only a pointer to `project_id` and `recallant_server_url`, not policy source of truth.
- Settings UI decision is accepted: v1 uses controlled Settings UI. Project workflow settings are editable; dangerous changes are confirmation-gated; server/security/secrets are read-only/status-only; every change is audited and generally affects future behavior only.
- Storage decision is one Postgres/pgvector instance with separate databases for major memory domains. v1 starts with `recallant_agent_work`; future domains such as `recallant_personal_life` should be separate databases in the same instance. Multi-storage Option C is rejected for v1.
- Backup/restore decision is practical v1 policy: automated Postgres backup + raw artifact backup + manifest + encrypted backup target + periodic restore verification. Initial backups may live on the Recallant server; architecture must support later replication to a second backup server over SSH/Tailscale. PITR/WAL archiving is future hardening, not mandatory v1.
- Instance portability is accepted as broader than backup/restore: after years of accumulated memory, Recallant must support moving to another server through export/restore plus remapping of project paths, secret references, connector/account bindings, environment facts, raw artifact locations, and settings. See `ADR-0038-environment-discovery-and-portable-instance.md`.
- Model routing decision is local-first, subscription-first, API-last router. Local embeddings/search are default. Stronger reasoning should prefer the current active agent, then supported subscription-worker routes, then local downgrade/defer, and only then paid API when policy/budget/confirmation allow it. Recallant does not treat ChatGPT subscription as a generic API replacement and must not use browser automation, scraping, hidden APIs, or limit bypass. Basic search must work without external providers.
- Baseline model portfolio is accepted as configurable defaults, not architecture invariants: `ollama/nomic-embed-text` for routine local embeddings, `ollama/gpt-oss:20b` for simple local extraction/classification, optional `ollama/qwen3-coder:30b` for local code-heavy assistance, active-agent and supported subscription-backed routes before paid API for complex reasoning where available, OpenAI as the baseline paid API profile, Gemini 2.5 Flash/Flash-Lite and Claude Haiku as optional cheap/fast paid API alternatives, and Gemini embeddings as optional cloud embedding alternatives. Claude Sonnet/Opus and Gemini 3.5 Flash / Gemini Pro are not cheap defaults; use them only through explicit quality/experiment opt-in when justified. Exact model IDs must be revisited before implementation/release.
- Paid API cost policy is strict by default: `paid_api_mode=confirm_each`, every direct paid API request requires explicit owner approval, background jobs do not use paid API automatically, and the Recallant management UI must include a near-real-time Cost / Paid API dashboard. Future `auto_with_caps` is possible only after observing real costs and enabling it explicitly for a scoped project/task/profile.
- Closeout intent decision: recognize configured Russian/English closeout or pause phrases, plus simple commands such as `Exit`, using simple triggers plus LLM intent classification for ambiguous cases; confirm only when unclear/risky. Closeout preserves current session state and must not perform broad historical imports. Imports remain explicit through `recallant import ...`; `recallant init` may suggest candidates but does not import them automatically.
- Runtime stack decision is **controlled hybrid**: TypeScript-first for Recallant core/MCP/CLI/contracts, Python only for bounded worker jobs where it clearly improves ML/batch/import/repair quality. Do not duplicate core business logic across languages.
- Codex connection decision: Codex calls Recallant as MCP tools through a thin Codex adapter generated by `recallant init --target codex`. Core tools and data are universal. End-of-session durability is implemented as incremental capture plus full closeout; abnormal interruption is handled by session tracking, last_seen state, local spool, and recovery on the next `memory_start_session`.
- Heartbeat decision: Recallant uses hybrid heartbeat. All session-scoped tools update `sessions.last_seen_at`; optional `memory_heartbeat` exists for long-running/idle tasks and updates liveness metadata only. Heartbeat does not create L0 events or raw memory. Timeout/stale-session thresholds are configurable policy values.
- Retention decision is accepted: v1 uses conservative retention. L0 raw evidence and raw artifacts are not automatically deleted by default; L1 chunks/embeddings/summaries/indexes may be archived, rebuilt, refreshed, or pruned from active retrieval; L3 governed memories are archived/superseded/rejected/stale rather than silently hard-deleted; local spool is deleted only after confirmed sync; model/cost/audit logs are kept for dashboard/debug/accountability until explicit configured retention applies. See `ADR-0035-conservative-retention-and-cleanup.md`.
- Governed memory lifecycle statuses are accepted: `candidate`, `accepted`, `rejected`, `archived`, `superseded`, `stale`, `needs_review`. Only `accepted` memories may act as durable behavioral guidance according to `use_policy`. Candidate/imported/stale/needs_review records may inform search/review but must not silently become instructions. Existing older spec wording using `approved` should be read as `accepted`; `pending_review` should be read as `candidate` or `needs_review` depending on reason. See `ADR-0036-governed-memory-lifecycle-statuses.md`.
- Import workflow Q9 is accepted: v1 uses discovery-first, import-by-confirmation. `recallant discover` scans candidates, `recallant init` registers/configures and may suggest imports, and `recallant import` is the explicit preview/dry-run/write path. Imported material is classified as raw evidence, chunks, candidates, environment facts, secret references, capability/account bindings, checkpoint seeds, or repo contracts; it does not silently become `instruction_grade`. See `ADR-0039-v1-import-workflow.md`.
- Memory scope/audience Q12 is accepted as a multi-axis model: `scope_kind`/`scope_id` say where a memory applies, `audience` says who may consume it, and `use_policy` says how authoritative it is. Accepted scope kinds include domain, developer, environment, project, repo, subproject, session, connector_account, capability, and client_adapter. See `ADR-0040-memory-scope-and-audience-model.md`.
- Conflict-resolution priority Q13 is accepted: resolve by applicability first, then authority, then scope specificity, then recency; high-risk or equal-authority conflicts go to Review UI / owner confirmation. See `ADR-0041-conflict-resolution-priority.md`.
- Managed AI-native platform decision is accepted: Recallant must be controllable through natural-language management chat, use AI heavily for extraction/cleanup/conflict/context planning, keep deterministic policy for safety/destructive operations, and support explicit permanent erasure. See `ADR-0042-managed-ai-native-platform-and-operations.md` and `OPERATING_PRINCIPLES.md`.
- Autonomous attach modes are accepted: `manual` preserves the cautious explicit workflow,
  `guided` produces a plan and waits for confirmation, and `autopilot` is the ordinary-project
  default. Autopilot may execute low-risk attach steps and report the result while preserving safety
  gates. It must intelligently migrate agent startup files, locally back up discovered agent files
  before changing existing ones, keep `PROJECT_LOG.md` as compact fallback/checkpoint, and downgrade
  production-sensitive projects to `guided` unless production-safe autopilot is explicitly approved.
  See
  `ADR-0043-autonomous-project-attach-modes.md` and `AUTONOMOUS_ATTACH.md`.
- Controlled cross-project recall is accepted: project memory is isolated by default, while agents
  can explicitly retrieve source-linked examples from other projects and applicable
  developer/environment/capability records. Agents may initiate this when a task needs a prior
  pattern; if the pattern is applied, they create current-project memory with source refs. See
  `ADR-0044-controlled-cross-project-recall.md` and
  `CROSS_PROJECT_RECALL.md`.
- The owner confirmed engineering-quality rules: code/docs/comments/API text/commit messages are English; conversation with the owner can stay Russian; implementation should be modular, low-coupling, testable, and publicly presentable; use meaningful scoped commits.
- Existing services must be reused through capability bindings where practical. On the owner server,
  use the single existing Ollama service rather than starting a duplicate stack. As of 2026-05-27 it
  has been upgraded to Ollama `0.24.0`, bound to `127.0.0.1:11434`, enabled, and documented in
  `/ai/SECURITY` and `/ai/PORTS.yaml`.
- Owner-server infrastructure constraints are accepted: consult `/ai/SECURITY` before exposure/auth/firewall/service/secret changes; register Recallant ports in `/ai/PORTS.yaml` before service start; represent `/opt/secure-configs/.env` as a secret reference/capability binding, not raw memory content.

Accepted owner-server deployment layout:

- code: `/ai/recallant`;
- persistent runtime data: `/ai/recallant-data`;
- secrets/env: `/opt/secure-configs/recallant.env`;
- Recallant app runtime: host `systemd`, bound to `127.0.0.1:3005`;
- Recallant Postgres/pgvector runtime: isolated Docker Compose service, host bind
  `127.0.0.1:15432 -> container 5432`, compose file `docker-compose.production.yml`, database
  `recallant_agent_work`, data under `/ai/recallant-data/postgres`;
- backups: local backups under `/ai/recallant-data/backups`; second-server replication remains
  future-only;
- paid APIs: disabled for first production deployment.

Production deployment progress as of 2026-05-27:

- the existing server Ollama service is active on `127.0.0.1:11434`;
- the dedicated Recallant Postgres/pgvector container is active and healthy on
  `127.0.0.1:15432`;
- `0001_initial.sql` has been applied to `recallant_agent_work`;
- `recallant.service` is active and enabled on `127.0.0.1:3005`;
- HTTP auth supports bearer API access and Cloudflare Access identity to signed session cookie;
- Cloudflare DNS, Access app/policy, and Tunnel ingress are configured for
  `recallant.unicloud.ca -> http://localhost:3005`;
- `recallant-backup.timer` is active/enabled for daily local backup plus restore verification at
  `03:15 UTC`, with backups under `/ai/recallant-data/backups`;
- production env has stable `RECALLANT_PROJECT_ID` and `RECALLANT_PROJECT_PATH=/ai/recallant`;
- the initial duplicate empty `/ai/recallant` project rows created before that env pin were
  cleaned up after backup verification;
- the Review UI project/settings panels have been compacted for the first production workbench;
- `/ai/PORTS.yaml` and `/ai/SECURITY` have been updated for these services.

Operational recovery as of 2026-05-28:

- a live `recallant.unicloud.ca` Cloudflare `502` was traced to the production
  `recallant-postgres` container being absent, so DB-backed Review UI requests hit
  `ECONNREFUSED 127.0.0.1:15432` and crashed the HTTP process;
- `make prod-db-up` restored the production Postgres container with existing data under
  `/ai/recallant-data/postgres`;
- `recallant-postgres` is healthy on `127.0.0.1:15432`, `recallant.service` is active on
  `127.0.0.1:3005`, and public unauthenticated access returns the expected Cloudflare Access
  redirect;
- the owner confirmed from a real browser session that authenticated Cloudflare Access loads the
  Recallant Review Command Center for project `84eda3bf`;
- production `recallant doctor`, local stdio MCP smoke, and backup restore verification pass;
- dev database Make targets now use the separate Docker Compose project name `recallant-dev` so
  local smoke cleanup cannot remove the production database container again.

Pre-pilot and Phase 10 decision as of 2026-05-28:

- The first pilot used a duplicated GutenDocx project copy, not the original working project.
- The owner confirmed that Recallant should move toward autonomous operation: given a request, it
  should analyze, choose safe optimal actions, execute them, and report.
- Autonomous project attach is desired, but more cautious `manual` and `guided` modes must remain
  available.
- If no mode is specified, `autopilot` is the default for ordinary projects.
- Existing agent files must be analyzed and migrated, not overwritten blindly: preserve important
  project rules, import history as evidence, normalize startup flow to Recallant, and keep a local
  `.recallant/backups/attach-*` backup of discovered agent files before changing existing ones.
- `PROJECT_LOG.md` remains mandatory as compact agent-readable fallback/checkpoint; Recallant is the
  main source of truth.
- Production-sensitive projects auto-downgrade requested autopilot to `guided` unless
  production-safe autopilot is explicitly approved.
- First Phase 10 attach slice is implemented: `recallant attach` supports `manual`, `guided`, and
  default `autopilot`; autopilot backs up discovered agent files locally, normalizes startup files,
  imports safe sources, creates starter/structured memories, runs startup/context-pack and Review
  visibility checks, and reports in owner-readable form.
- First Review/Management UI chat slice is implemented: the private Command Center now has a
  functional natural-language management chat API/form, plain-language "What Needs Attention" and
  project-action summaries, human-readable setting summaries, Russian answer coverage, and
  confirmation-gated cleanup/destructive/sensitive proposals instead of direct chat execution.
  The chat panel has been moved into the left rail with a capped answer scroll area so long answers
  do not push the whole page downward and unused left-side space is put to work.
  Sandbox cleanup wording is target-aware so chat does not blindly propose a dry-run against the
  open project when the owner clearly asked for a sandbox project.
  The chat now uses the configured local Ollama model for intent/language/target/global-rule
  extraction when available and visibly falls back to deterministic rules when the model is
  unavailable. Deterministic policy still owns risky actions. Owner-explicit low-risk "save this
  rule for all projects" requests now create developer-scope `instruction_grade` memories so future
  context packs include them across projects.
- Product install/onboarding UX now has an owner-server baseline: `scripts/install-recallant.sh`
  installs the server profile, `scripts/install-recallant-cli.sh` installs a global `recallant`
  wrapper, CLI commands auto-load `/opt/secure-configs/recallant.env` when present, and ordinary
  onboarding is `cd <project> && recallant attach .`.
- Closeout checkpoint as of 2026-05-30: commit `e562a7e Improve Recallant onboarding and AI chat`
  is pushed to `origin/main`; `/usr/local/bin/recallant` is installed; production `recallant doctor`,
  `/health`, Cloudflare Access redirect, and live AI-backed Management Chat all passed; the
  `recallant-dev` Docker environment was stopped after smoke validation.
- First Phase 10 detach slice is implemented: `recallant detach` / `recallant project-detach`
  supports dry-run affected counts, confirmation-gated Recallant-side cleanup, live hide-only
  detach, sandbox hide plus active-chunk archiving, Review UI active-list hiding, active-search
  blocking for detached projects, and hard-delete policy blocking.
- First Phase 10 controlled cross-project recall slice is implemented: MCP tool
  `memory_cross_project_recall` exposes explicit `same_project`, `developer_rules`, `environment`,
  `similar_projects`, and `all_projects_review` modes; results are source-linked and labeled with
  source project/path/ref, status/use policy, applicability warning, and promotion policy; ordinary
  context packs still exclude unrelated project memory.
- The active next plan is Phase 10: `docs/AUTONOMOUS_ATTACH.md` and
  `docs/CROSS_PROJECT_RECALL.md`.
- The current handoff for new sessions is `docs/SESSION_HANDOFF_CURRENT.md`.
- The old dated handoff from 2026-05-21 is archived under `docs/archive/SESSION_HANDOFF_2026-05-21.md`.

## Expansion stance

Recallant v1 is for coding-agent memory, but the architecture must leave a path toward broader human external memory in the OB1 spirit. That future path should use explicit domains/scopes, provenance, review/use policies, and bounded retrieval instead of mixing all personal data into project memory.

Do not treat future expansion as permission to implement everything at once. The first implementation should complete the core before adding connectors, personal-life capture, specialized storage, or public packaging.

## Next conversation context

The project is now on the target Linux server. A new session should resume from this documentation, not from chat history.

Latest implementation checkpoints:

- Phase 0 repo skeleton committed as `5fc7892`.
- Phase 1 initial Postgres/pgvector schema migration committed as `6945c46`.
- Phase 2 MCP skeleton stubs committed as `25a1a26`; verified by `npm run mcp:smoke`.
- Phase 3 core lifecycle/L0 write path is implemented across the current commits. MCP lifecycle/write tools route to Postgres when `RECALLANT_DATABASE_URL` is set: `memory_start_session`, `memory_append_turn`, `memory_append_event`, `memory_heartbeat`, checkpoint set/get, and `memory_closeout`. Capture profile resolution follows session override -> project setting -> developer setting -> system setting -> built-in `standard`; `light`, `standard`, and `detailed` profiles produce different stored text caps for new events only. Stale-session recovery uses configurable `stale_session_threshold_minutes`, not a hard-coded constant. Closeout now also persists governed-memory candidates and returns non-quiet reports when review or spool attention is needed. It is verified by `scripts/smoke-phase3-db.mjs` against Docker Postgres inside the private compose network.
- Phase 4 first embedding slice is implemented. Default embedding route is seeded as local `ollama/nomic-embed-text`; missing provider leaves chunks `pending` and writes a failed `model_calls` audit row. Test/profile overrides can use deterministic local embeddings to write pgvector rows and exercise vector search without external services. Cloud fallback candidates are seeded in settings for OpenAI and Gemini. Switching embedding model requires explicit reindex and is blocked. Paid API embedding routes create `paid_api_approval_requests` and a cancelled/blocked `model_calls` row without calling the provider. It is verified by `scripts/smoke-phase4-embeddings.mjs`.
- Phase 5 minimal golden retrieval is implemented for `memory_search`: lexical, vector, hybrid fusion, bounded response caps, project/developer scope filtering, audience/scope-kind filter hooks, query embedding audit, and chunk access tracking. It is verified by `scripts/smoke-phase5-retrieval.mjs`.
- Phase 6 first governed-memory slice is implemented: `memory_create_agent_memory`, `memory_review_agent_memory`, `memory_list_agent_memories`, `memory_get_agent_memory`, `memory_recall_agent_memories`, and `memory_report_recall_usage` are DB-backed. Agent-created memories require source refs; ordinary memories become `accepted` + `recall_allowed`; candidate/high-risk paths go to inbox; review promotion can create `instruction_grade`; recall writes and updates `recall_traces`. It is verified by `scripts/smoke-phase6-governed-memory.mjs`.
- Phase 6 graph/context/forget slice is implemented: `memory_link`, `memory_fetch_chunk`, graph expansion in `memory_search`, `memory_get_context_pack`, and the first `memory_forget` dry-run/confirmed redaction path are DB-backed. Context packs return checkpoint, recovery rows, instruction-grade binding rules, recalled working memories, optional bounded evidence, and suggested-next-fetch placeholders. It is verified by `scripts/smoke-phase6-graph-context-forget.mjs`.
- Phase 6.5 first Review UI slice is implemented as a private server-rendered Review Command Center on the Recallant server package. It requires `RECALLANT_AUTH_TOKEN` for `/review` and `/api/review-dashboard`, binds through the HTTP server default private host path, and shows project list, critical status, Review Inbox, Active Rules, Cost / Paid API, Settings, and a management-chat placeholder with confirmation-gated destructive action wording. It is verified by `scripts/smoke-review-ui.mjs`.
- Review UI action/settings slice is implemented: `/api/review-action` uses the same DB review policy path as MCP, `/api/project-setting` writes project settings with `settings_audit_events`, and dangerous settings such as paid API mode or major route/profile changes require explicit confirmation. `scripts/smoke-review-ui.mjs` covers auth, HTML/API dashboard, review action, confirmation-gated setting rejection, and confirmed setting update.
- Phase 7 first CLI onboarding slice is implemented: `recallant init`, `discover`, `import --dry-run`, `lint-context`, `context`, and expanded `doctor`. Init writes pointer-only `.recallant/config`, a thin `AGENTS.md` Memory section, `PROJECT_LOG.md`, central project/settings rows in Postgres, and a Codex MCP config block. Discover/import remain preview-only and do not create import events or instruction-grade memories. Doctor now reports project config presence, Postgres reachability, local Ollama endpoint/model status without starting services, effective model-route policy, and paid-API confirmation defaults. It is verified by `scripts/smoke-phase7-cli.mjs`.
- Phase 8 backup/restore-verification slice is implemented: `recallant backup` exports all current `0001_initial` Postgres tables into a local backup directory with `tables.json`, `manifest.json`, schema/version metadata, file hash, target metadata, and secret-policy marker; `recallant backup-verify --manifest ...` verifies the hash, loads the snapshot payload into a temporary schema, checks projects/checkpoints/governed memories/chunks/raw artifact pointers, optionally checks bounded backup search with `--query`, and then drops the temporary schema without overwriting production. It is verified by `scripts/smoke-phase8-backup.mjs`.
- Phase 8 portable restore planning slice is implemented: `recallant restore-plan --manifest ... --remap ...` verifies the backup hash and emits a non-writing restore/remap plan for project roots, raw artifact roots, secret references, connector accounts, environment facts, and ports. It does not edit raw memories by hand or write to production. It is covered by `scripts/smoke-phase8-backup.mjs`.
- Phase 8 size-limit slice is implemented: `memory_append_turn` rejects text above `RECALLANT_APPEND_TURN_MAX_CHARS`, `memory_append_event` rejects text above `RECALLANT_APPEND_EVENT_TEXT_MAX_CHARS`, and raw artifact excerpts above `RECALLANT_RAW_ARTIFACT_EXCERPT_MAX_CHARS` are rejected before session touch, event insert, raw-artifact insert, or dedup insert. It is verified by `scripts/smoke-phase8-size-limits.mjs`; `scripts/smoke-phase3-db.mjs` covers the normal append regression path.
- Phase 8 private HTTP/Cloudflare-ready slice is implemented: server config defaults to `127.0.0.1`, rejects public `0.0.0.0`/`::` bind unless `RECALLANT_ALLOW_PUBLIC_BIND=true`, exposes safe HTTP security metadata, keeps Cloudflare mode disabled by default, and when `RECALLANT_CLOUDFLARE_MODE=enabled` requires configured edge auth plus Recallant bearer auth. It is verified by `scripts/smoke-review-ui.mjs`.
- Phase 8 search p95 fixture is implemented: `scripts/smoke-phase8-search-p95.mjs` loads a 10k-chunk lexical fixture and verifies `memory_search` p95 stays below `RECALLANT_SEARCH_P95_BUDGET_MS` (default 1500ms). The current Docker smoke passed at about 11ms p95.
- Phase 8 structured error/rate-limit slice is implemented: MCP tool handlers now return structured JSON errors with `error.code`, `message`, and `retryable`; validation errors map to `VALIDATION_ERROR`, and `RECALLANT_MCP_RATE_LIMIT_PER_MINUTE` enables per-tool in-process rate limiting with `RATE_LIMITED` retryable errors. It is verified by `scripts/smoke-phase8-errors-rate-limit.mjs`; existing validation/governed-memory smokes still pass.
- Phase 9 archive/unarchive slice is implemented: `memory_archive` now updates `chunks.archived_at` in Postgres, `memory_search` excludes archived chunks by default, and `include_archived=true` can explicitly include them. Ordinary archive/unarchive preserves L0 events and raw artifact records. It is verified by `scripts/smoke-phase9-archive.mjs`; `scripts/smoke-phase5-retrieval.mjs` covers retrieval regression.
- Phase 9 retrieval decay/supersedes slice is implemented: `memory_search` applies configurable score decay (`RECALLANT_DECAY_ENABLED`, `RECALLANT_DECAY_HALFLIFE_DAYS`, `RECALLANT_DECAY_MIN`) and applies a configurable penalty to chunks superseded by `memory_link(relation_type="supersedes")`, returning `superseded_by` in hits. It is verified by `scripts/smoke-phase9-decay-supersedes.mjs`; `scripts/smoke-phase5-retrieval.mjs` covers retrieval regression.
- Phase 9 analyze/cleanup slice is implemented: `recallant analyze --dry-run` reports stale/not-accessed, duplicate-text, superseded, and low-value chunk candidates plus stale/superseded, duplicate, poor-provenance, and conflicting connector-account governed-memory hygiene candidates; `recallant cleanup --archive --dry-run` emits candidate actions and warnings without changing data; `recallant cleanup --archive --confirm` can archive derived chunks only, preserving L0 events, raw artifacts, embeddings, and governed memories. Hard delete remains policy-blocked. It is verified by `scripts/smoke-phase9-cleanup.mjs`.
- Repo-contract sync slice is implemented: after `memory_set_checkpoint`, MCP attempts to update an existing `PROJECT_LOG.md` under `RECALLANT_PROJECT_PATH` with `current_status`, `current_focus`, `next_step`, and open questions while preserving other sections. Missing project logs are skipped instead of creating files in arbitrary working directories. It is verified by `scripts/smoke-repo-contract.mjs`.
- Local spool/sync slice is implemented: `recallant spool-append` writes append-only local JSONL records for offline turns/events with stable dedup keys and raw-artifact pointers; `recallant sync-spool` supports dry-run and idempotent Postgres sync through a local sync manifest; `recallant prune-spool --synced` removes only confirmed synced local records, while unsafe pruning remains policy-blocked. It is verified by `scripts/smoke-spool.mjs`.
- Cross-client smoke automation is implemented: `scripts/smoke-cross-client.mjs` starts two independent MCP processes with the same project/developer context, writes a fact through one client kind, and verifies another client kind can retrieve it through `memory_search`.
- Core smoke suite aggregation is available through `npm run smoke:core`; run it after `npm run build` and a clean `make db-reset` when validating the full local DB-backed implementation surface.
- Pre-Pilot R1 existing-project discovery/preflight is implemented. `recallant discover --project-dir <path>` is read-only and returns source-linked candidates with result classes, provisional scope/audience, risk flags, context-budget warnings, import suggestions, and redacted secret-reference previews; `--format text` prints a human summary. `recallant import --dry-run <path>` reuses the same preview model without writes. It is verified by `scripts/smoke-pre-pilot-discovery.mjs`.
- Pre-Pilot R2 explicit import write mode is implemented. Confirmed `recallant import <path> --project-dir <path>` writes a source-linked `import_batch` event, raw artifact pointer, scoped chunks, embeddings when available, and a governed memory candidate/needs-review record; repeated import of the same project/source/hash/result-class is idempotent. Secret-reference imports store variable names/status only and redacted text. It is verified by `scripts/smoke-pre-pilot-import.mjs`.
- Pre-Pilot R3 Review UI import/action readiness is implemented. The dashboard/API expose import candidates, selected detail with source refs/review history/provenance/status/use policy/scope/audience/confidence, conflict/duplicate candidates, available review actions, and a cleanup/forget confirmation entrypoint. It is verified by `scripts/smoke-review-ui.mjs`.
- Pre-Pilot R4 pilot sandbox workflow is implemented and documented in `docs/PILOT_SANDBOX_WORKFLOW.md`. `scripts/smoke-pre-pilot-sandbox.mjs` copies a fixture into a temporary sandbox, runs discover/import dry-run/confirmed import, exercises MCP start/context/append/search/recall/closeout, verifies DB records, and checks that the original fixture was not modified.
- Pre-Pilot R5 agent onboarding contract is implemented and documented in `docs/AGENT_ONBOARDING_CONTRACT.md`. `recallant init --target codex` generates a thin Memory section with real MCP tool names and no longer references the nonexistent `memory_promote` tool. It is covered by `scripts/smoke-phase7-cli.mjs`.

Production deployment, the first UI cleanup, the GutenDocx sandbox pilot, local Ollama embedding
readiness, and the first human-readable Review UI cleanup are complete.

The active next product plan is to move from pre-pilot safety infrastructure into autonomous project
attach and controlled cross-project recall:

- document and implement `recallant attach --mode manual|guided|autopilot`;
- keep manual/guided modes available for cautious production work;
- keep governed project detach/delete available so sandbox and attached project cleanup is
  reversible and visible before any broad live-project onboarding;
- keep explicit cross-project recall modes available for source-linked examples from other
  projects;

Important: Questions 9, 12, and 13 are accepted in `ADR-0039`, `ADR-0040`, and `ADR-0041`. The later managed AI-native operations discussion is accepted in `ADR-0042`.

Next session should start here:

1. Continue autonomously from the latest committed phase checkpoint and current `git status`; do not ask whether implementation is authorized.
2. Read `PROJECT_LOG.md`, `docs/SESSION_HANDOFF_CURRENT.md`, `docs/AUTONOMOUS_ATTACH.md`, and
   `docs/CROSS_PROJECT_RECALL.md`.
3. Start from the completed first Phase 10 attach/detach/cross-project checkpoint; the next useful
   slice is owner-facing Management UI action quality, optional local sandbox cleanup, or an
   owner-driven new sandbox attach test through `recallant attach . --sandbox`.
4. Keep manual/guided modes available; do not make autopilot the only way to attach projects.
5. Commit autonomously at coherent verified checkpoints so rollback remains easy.
6. Keep `/ai/PORTS.yaml`, `/ai/SECURITY`, and Recallant docs synchronized after each material
   deployment or security change.

Do not reopen the product name, v1 scope, OB1/MF0 synthesis, managed memory decision, natural-language management direction, owner-server security/ports constraints, or Recallant/AMP rename unless the owner explicitly requests it.

After each material decision, update the relevant spec/ADR immediately so context loss does not erase the reasoning.
