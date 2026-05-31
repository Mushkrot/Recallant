# Product Requirements Document (PRD)

**Product name:** Recallant  
**Tagline:** Governed memory for AI agents  
**Doc version:** 1.0  
**Primary executors:** AI coding agents (not assumed: dedicated human engineering team).

## 0. Product stance

Recallant is intended to become a **full-quality working product for the owner's real AI-assisted development workflow**, not a quick prototype. The project may take more design and implementation effort if that is required for a coherent core.

Historical note: the project was originally drafted as **Agent Memory Platform (AMP)**. That name is retained only for historical context; active product and implementation contracts use **Recallant**.

Current architectural bias:

- **Open Brain / OB1** is the preferred foundation.
- Accepted synthesis: combine OB1 governance with MF0 workbench/raw-capture/Memory Tree/Keeper ideas; Recallant owns the bridge through managed hybrid capture profiles, Review UI, context-budget policy, and local-server-first deployment.
- Other reviewed systems remain active sources of subsystem ideas: MemPalace, OpenMemory, and Journey. `agent-bootstrap` is the owner's earlier personal sketch and remains useful as repo-contract inspiration, not as an external mature upstream.
- Matthew Berman's **Journey / Journey Kits** is a reference for packaging and distributing reusable agent workflows.
- Governed agent memory is part of v1, not a deferred phase-2 enhancement.
- Owner-facing compact Review UI workbench for governed memory is part of v1, not a deferred nice-to-have.
- Review UI runs on the Recallant server; v1 starts as a compact private workbench and should evolve into a broader management platform.
- Managed hybrid capture is part of v1: raw evidence can be preserved broadly, but future behavior is governed by structured memories, review, checkpoint, scoring, and project capture policy.
- Raw workflow evidence is the lower factual layer; governed memory is the upper behavior layer. Large raw outputs use artifact metadata/pointers/excerpts rather than being dumped into agent context.
- Current daily usage is Codex-first, while the architecture remains a universal MCP memory platform for any supported agent. Codex is the first adapter, not the product boundary.
- Settings are centralized on the Recallant server; project repositories store only pointer config.
- Settings UI is controlled in v1: project workflow settings are editable; sensitive/global/server settings are read-only or confirmation-gated.
- Memory must be managed, correctable, self-cleaning, and erasable through explicit owner workflows. Archive/reject/supersede are normal governance actions; "forget forever" is a separate owner-confirmed erasure workflow that removes content and derived material from active memory.
- The management experience should be natural-language first. The Review UI remains important for inspection and control, but the owner should be able to query and direct the system in plain language and have Recallant respond in the user's language.
- Project attach should become autonomous for everyday use, with explicit `manual`, `guided`, and `autopilot` modes so the owner can choose more cautious workflows for production-sensitive projects.
- Project memories are isolated by default but can be reused through controlled cross-project recall. Agents may ask for source-linked examples from other projects, but unrelated project memory must not silently become current-project rules.
- Recallant should use AI/LLM capabilities heavily for extraction, cleanup suggestions, conflict explanation, context-pack planning, and intent detection, while deterministic server policy remains authoritative for safety, storage, auth, audit, cost, and destructive operations.
- Model routing is configurable and provider-switchable. Local models are the default for core recall; stronger reasoning is subscription-first/API-last; paid API requires explicit confirmation by default; OpenAI is the baseline paid API profile only when paid API is approved; Gemini and Claude cheap models are optional paid API routes by task, project, and budget.
- v1 is a full working core for coding-agent memory, not a throwaway MVP. Broader personal-life memory, passive capture, large blob/object storage, specialized vector/graph databases, and public product packaging are designed for as future expansion, not first implementation scope. See [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md).
- Practical backup/restore is part of v1: Postgres + raw artifacts + manifest + restore verification, with a future path to a second backup server.
- Security/access posture is private-by-default plus Recallant auth: localhost/Tailnet/SSH by default, Review UI/admin API require Recallant auth even inside private network, and Cloudflare-managed access is a near-future opt-in mode requiring edge auth plus Recallant auth.
- Session liveness uses hybrid heartbeat: ordinary session tools update `last_seen_at`, and optional `memory_heartbeat` exists for long-running/idle tasks without writing raw memory events.
- On the owner's current server, Recallant must respect shared infrastructure: use existing configured Ollama when available, consult `/ai/SECURITY` for server security changes, register service ports in `/ai/PORTS.yaml`, and model `/opt/secure-configs/.env` only as a secret reference/capability binding.
- Repository artifacts are public-quality English artifacts: code, identifiers, comments, documentation, commit messages, API text, and public materials. The owner conversation may remain Russian when the owner writes in Russian.

## 1. Problem statement

During AI-assisted coding, the same project directory may be opened in different CLI agents such as Codex, Cursor, Windsurf, and Claude Code. Each client has its own rules, session memory, and context-window compaction behavior. As a result:

- switching clients loses working context: decisions, agreements, reasoning history;
- a single client loses long context after compaction or window limits;
- rules, preferences, account bindings, and repeated explanations disappear between sessions;
- every new project requires manually rebuilding config/handoff structure;
- existing projects require too much manual discovery/import work before agents can use prior context safely;
- agents often need examples from other projects, such as Google Drive, Cloudflare, deployment, or secret-reference patterns, but today the owner must manually point them to the right folder;
- long repo-native instructions and logs can flood the context window before useful work begins;
- trying to put everything in the prompt is impossible because of cost and context limits;
- if wrong or sensitive information enters memory, the owner needs a clear way to correct or remove it;
- as memory grows, stale/duplicate/conflicting records can degrade agent behavior.

Recallant needs to provide external long-term memory with selective retrieval, one shared store for supported clients, explicit checkpoints, governed memory hygiene, and safe management workflows.

## 2. Goals

### G1 — Cross-client continuity

For a fixed `project_id`, any supported MCP client can restore practical working context in a new session through retrieval and checkpoint state without forcing the owner to re-explain the project from scratch.

**Acceptance:**

- [ ] Two different clients, for example Codex and Cursor/Claude Code, connect to the same store for one `project_id`.
- [ ] After session A writes N turns, session B finds the top relevant chunks for a query matching the latest checkpoint task.

### G2 — Intra-session resilience

The system preserves raw evidence according to configured capture policy and builds derived layers (L1/L2/L3) so indexes can be rebuilt without losing source provenance. Resilience must not depend only on a perfect end-of-session closeout.

**Acceptance:**

- [ ] Every `chunk_id` points unambiguously to its L0 source.
- [ ] A re-embed job does not destroy L0; at most it marks old embedding rows superseded.
- [ ] Project capture profile controls how much raw detail is recorded without changing the governed-memory model.
- [ ] Large workflow evidence can be preserved through raw artifact pointer/hash/excerpt records without forcing unbounded event JSONB or context output.
- [ ] `memory_start_session` detects an unclosed previous session and returns recovery metadata.
- [ ] Optional `memory_heartbeat` updates liveness metadata for long-running/idle tasks without creating L0 events.
- [ ] `memory_closeout` marks a normal ending session closed and updates checkpoint/governed-memory state.

### G3 — Token-safe agent interface

The agent never receives the entire database in one call. MCP tools return bounded payloads according to configured retrieval/context policy; see `RETRIEVAL.md`, `MCP_SPEC.md`, and ADR-0015.

**Acceptance:**

- [ ] Stress test: 1M characters in L0/raw artifacts still yields tool responses within configured max chars and max items.

### G4 — Hybrid recall

Support vector + lexical search and optional graph expansion with explicit budgets.

**Acceptance:**

- [ ] The documented golden query set in `TEST_CONTRACT.md` passes precision@k thresholds defined there.

### G5 — Where we stopped

Checkpoint state lives in the database and is mirrored semantically into the repository through the `REPO_CONTRACT.md` / `PROJECT_LOG.md` contract.

**Acceptance:**

- [ ] `memory_get_checkpoint` and `PROJECT_LOG.md` agree on `current_focus` or equivalent after `memory_set_checkpoint` within a configured freshness budget. A 5-second budget may be used as a default test profile, but it is not a product-wide invariant.

### G6 — Governed agent memory

The system stores not only raw events/chunks, but also structured agent memories: decisions, constraints, rules, lessons, failures, work logs, and artifact references. These records have provenance, review status, and use policy.

**Acceptance:**

- [ ] Agent-generated memories are created automatically without manual confirmation for every record when they pass validation/provenance policy.
- [ ] Agent-generated memory cannot become `instruction_grade` without explicit user confirmation, trusted import, or another strong policy path.
- [ ] Every `agent_memory` has at least one source ref to L0/L1 or an external ref unless created directly by the user as imported/confirmed.
- [ ] Recall returns a bounded set of governed memories with review/use metadata.
- [ ] Recall trace or usage report shows which governed memories were returned and which the agent marked as used.

### G7 — One-action project onboarding and attach

A new or existing project must connect to Recallant without manually copying rule/log/handoff structure. The target product workflow is `recallant attach`, with cautious modes available when the owner wants manual control.

**Acceptance:**

- [x] `recallant init --target codex` creates `.recallant/config`, thin `AGENTS.md`, `PROJECT_LOG.md`, `.gitignore`, and the required MCP/config output for Codex.
- [x] `recallant init --dry-run` shows a plan without making changes.
- [ ] `recallant attach <project-dir> --mode manual|guided|autopilot` is the product-level workflow that can coordinate init, discovery, import, lint, context preview, diagnostics, and reporting.
- [ ] If mode is omitted, `attach` defaults to `autopilot` unless production-sensitive detection downgrades it.
- [ ] `manual` mode preserves the old cautious workflow: discovery is read-only, dry-run writes nothing, and durable imports require explicit selected commands.
- [ ] `guided` mode builds a complete attach plan and waits for confirmation before durable writes.
- [ ] `autopilot` mode may import low-risk source-linked evidence, extract ordinary project-local memories, prepare and normalize bootstrap/startup files, run checks, and produce a short report without asking for each safe step.
- [ ] Before changing existing agent files, attach creates a local backup of all discovered agent files; backups are gitignored and redacted for raw secrets.
- [ ] `AGENTS.md` remains the primary agent entrypoint, `PROJECT_LOG.md` remains a compact fallback/checkpoint, and Recallant is the main source of truth.
- [ ] Old archive/handoff files import as historical evidence-only by default and are not startup reads.
- [ ] Already-attached projects update idempotently without duplicate project ids or duplicate imports.
- [ ] Production-sensitive projects requested with `autopilot` switch to `guided` unless production-safe autopilot is explicitly approved.
- [ ] `autopilot` does not silently promote broad/risky memories to `instruction_grade`, import raw secrets, enable paid API, change public exposure, perform destructive cleanup, or bind connector/capability records as active behavior without policy review.
- [ ] Project bootstrap does not copy large historical documents into the new project.
- [ ] The architecture allows Journey-style kit/skill distribution as an alternate installation path.

### G7.1 — Universal client adapters

Codex must work first, but Recallant must not become Codex-specific.

**Acceptance:**

- [ ] The same MCP tool contracts support `client_kind=codex`, `cursor`, `claude_code`, `windsurf`, and `other`.
- [ ] Client-specific code is limited to bootstrap/config/adapter generation and smoke tests.
- [ ] Core storage, policies, session lifecycle, closeout, recovery, and Review UI do not branch on Codex-specific behavior except for metadata/ergonomics.

### G7.2 — Controlled cross-project recall

Agents must be able to find useful patterns from other projects without mixing project memory by default.

**Acceptance:**

- [ ] The default context pack includes the current project plus applicable developer/environment/capability records, but excludes unrelated project memories.
- [ ] An explicit cross-project query can return source-linked examples from other projects.
- [ ] Cross-project results show source project, source path/ref, scope kind, status, use policy, and whether the result is an example or a binding rule.
- [ ] Agents may initiate explicit cross-project recall when the task clearly needs a prior pattern.
- [ ] A memory from project B does not become a project-A rule unless the pattern is applied and the agent creates project-A memory with source refs, or the owner/review policy promotes a general rule.
- [ ] Connector/account and capability-binding results from other projects require review/confirmation before becoming active long-term behavior for the current project.

### G8 — Context-budget discipline

Recallant must improve agent quality without loading huge files at session startup.

**Acceptance:**

- [ ] Generated `AGENTS.md`/adapter files stay thin and contain routing rules instead of long-form history.
- [ ] Startup flow restores context through the automatic server-built context pack (`memory_start_session` -> `memory_get_context_pack`), not manual user explanation.
- [ ] CLI/UI can preview the same context pack for debugging without creating a separate context-building algorithm.
- [ ] A test or lint check detects bootstrap files that contain large duplicated historical content.

### G9 — Local-server-first memory runtime

Core Recallant runs on the owner's Linux server, with local embedding/consolidation tasks and optional external LLMs for complex analysis.

**Acceptance:**

- [ ] Basic append/search works without an external LLM API.
- [ ] Embedding provider is self-hosted by default when local capability is available.
- [ ] Existing configured Ollama/local-model service is reused when available instead of starting a duplicate stack.
- [ ] If Ollama is missing, disabled, remote, or configured differently, `recallant doctor` reports the state and the router falls back according to settings.
- [ ] External LLM providers are enabled through config only for optional enrichment, consolidation, rerank, and review assistance.
- [ ] Router can switch local/OpenAI/Gemini/Claude models by purpose/project/session without changing core memory behavior.
- [ ] Router distinguishes `local_model`, `active_agent`, `subscription_worker`, and `paid_api_provider`.
- [ ] Default escalation uses active agent or supported subscription worker before paid API when available.
- [ ] Paid API is not used silently after subscription limits are exhausted; Recallant defers/downgrades/asks according to policy.
- [ ] Default paid API mode is `confirm_each`; every direct paid API request requires explicit owner approval before execution.
- [ ] Recallant management UI includes a near-real-time cost dashboard for paid API estimates, approvals, providers/models, purposes, and project totals.
- [ ] Default paid API profile uses OpenAI unless a project/session explicitly selects optional Gemini or Claude routes.
- [ ] Preview/experimental model use is explicit and visible, not hidden inside defaults.

### G10 — Offline/local spool resilience

Recallant must allow local work when the server is unavailable, internet is slow, or the live MCP write path temporarily does not work.

**Acceptance:**

- [ ] Local spool writes append-only JSONL/NDJSON records with dedup keys.
- [ ] `recallant sync-spool` uploads local records to the server and stores a local id -> server `event_id` mapping.
- [ ] After successful sync, local spool records can be safely pruned/offloaded.
- [ ] Search/recall explicitly shows when local unsynced records have not reached the server SoT yet.
- [ ] Local spool follows the same project/session capture policy as live server capture.

### G12 — Practical backup and restore

Recallant must be restorable after server/database/artifact failure.

**Acceptance:**

- [ ] Automated backup includes `recallant_agent_work` Postgres database.
- [ ] Backup includes raw artifact storage or enough artifact manifests to verify missing payloads.
- [ ] Backup manifest records timestamp, schema/migration version, included databases, artifact roots, hashes, sizes, and target.
- [ ] Restore verification can restore into a temporary database/location without overwriting production.
- [ ] Restore verification runs basic read checks: project list, checkpoint, governed memory recall, and bounded search.
- [ ] Architecture supports later replication of encrypted backups to a second server over SSH/Tailscale.

### G13 — Private access with Cloudflare-ready auth

Recallant must protect memory and management surfaces by default while remaining ready for a near-future Cloudflare-managed subdomain.

**Acceptance:**

- [ ] Default deployment binds Review UI/admin API to localhost or Tailnet/private interface.
- [ ] Review UI/admin API require Recallant auth/session/token even on private network.
- [ ] Postgres is not exposed publicly and is reachable only by Recallant runtime or explicit trusted admin operations.
- [ ] Provider API keys and secrets are not sent to browser clients.
- [ ] Future Cloudflare mode is represented in config/routing without being enabled by default.
- [ ] Cloudflare mode requires edge auth such as Cloudflare Access or equivalent plus Recallant auth.
- [ ] No unauthenticated public management, MCP, backup, or raw-artifact route exists.

### G11 — Owner review UI for governed memory

Recallant v1 must give the owner a real UI for important, conflicting, and long-term memory management.

Placement: the UI runs on the Recallant server. It starts as a compact working review/cost/settings workbench, not a minimal approval table, while the architecture allows growth into a full private management platform.

First screen: Review Inbox / Command Center. It should prioritize items that need the owner's decision, not raw memory browsing or metrics.

**Acceptance:**

- [ ] UI shows the inbox of important / `candidate` / `needs_review` / high-risk memories.
- [ ] First screen shows scope/profile, critical review warnings, priority lanes, main review queue, selected item evidence, and review actions.
- [ ] v1 UI includes project navigation, Inbox, Rules, detail/source panel, Duplicates, Conflicts, Cost / Paid API, and Settings entrypoint.
- [ ] Management UI can list all managed projects and open project-specific Review/Settings views.
- [ ] Settings UI can edit project capture profile, context budget profile, review sensitivity, route enablement, paid API mode, client adapters, and project paths/aliases.
- [ ] Settings UI shows effective value source and writes audit records for changes.
- [ ] Settings UI confirmation-gates dangerous changes and does not expose raw secrets.
- [ ] UI shows active `instruction_grade` rules with scope/type filters.
- [ ] UI shows source refs and review history before promotion.
- [ ] UI allows accept/reject/promote/demote/archive/unarchive/mark-stale/edit/merge/supersede; approve may remain as a compatibility label/alias.
- [ ] UI shows duplicate/conflict reports and suggested resolutions.
- [ ] Ordinary memories do not require manual approval before becoming useful recall records.

### G14 — Managed deletion and self-cleaning

Recallant memory must be correctable, cleanable, and erasable.

**Measurability:**

- [ ] The owner can archive, reject, supersede, stale, edit, merge, and demote/promote governed memories through UI/CLI/API.
- [ ] The owner can request a "forget forever" workflow that removes target content and derived chunks/embeddings/summaries/index entries from active memory.
- [ ] Erasure keeps only a redacted receipt when audit is needed; the original content is not retained in active memory, search, context packs, or UI.
- [ ] Cleanup analysis identifies stale, duplicate, conflicting, low-value, and poorly sourced records.
- [ ] Risky cleanup or erasure requires confirmation unless a scoped explicit policy allows it.

### G15 — Natural-language management

Recallant management should be conversational.

**Measurability:**

- [ ] Management UI includes a natural-language command/chat surface for memory questions, cleanup requests, review actions, settings inspection, and context-pack explanation.
- [ ] The chat interface answers in the user's language by default.
- [ ] Natural-language destructive/cost/security/global-rule requests become explicit action plans requiring confirmation before execution.
- [ ] Chat-driven actions use the same server-side policy path as UI/CLI/MCP actions.

### G16 — Professional public-quality implementation

Recallant should be suitable for public release and professional review.

**Measurability:**

- [ ] Code, identifiers, comments, documentation, commit messages, API text, and public materials are English.
- [ ] Implementation follows modular package boundaries and avoids large files with unrelated responsibilities.
- [ ] Meaningful commits are made at natural checkpoints.
- [ ] Upstream reuse is preceded by local inspection and documented adaptation decisions.
- [ ] Owner-server deployment changes consult `/ai/SECURITY` and register ports in `/ai/PORTS.yaml` before services are started.

## 3. User stories (for coding agents)

1. **As an agent**, I want to call `memory_search` with a natural language query so that I retrieve prior decisions related to the current task without reading the entire repository.
2. **As an agent**, I want to call `memory_append_turn` so that my conversation fragments are durably stored with provenance.
2a. **As an agent/client adapter**, I want to call `memory_append_event` so tool output, terminal output, file-change evidence, and large raw artifacts are captured without polluting startup context.
3. **As an agent**, I want `memory_link` so that I can connect a decision chunk to a file path or commit id for later graph navigation.
4. **As an agent**, I want `memory_get_checkpoint` / `memory_set_checkpoint` so that I can resume work from the last agreed step.
5. **As an agent**, I want to create proposed `agent_memory` records from evidence so important decisions and lessons can be reviewed and reused safely.
6. **As an agent**, I want to recall accepted governed memories separately from raw chunks so I can distinguish stable instructions from evidence.
7. **As an agent**, I want a thin repo bootstrap so a new project can inherit global memory conventions without copying old logs.
7a. **As an agent**, I want to attach an existing project through manual, guided, or autopilot mode so Recallant can safely analyze and import useful context without forcing the owner to run every step.
7b. **As an agent**, I want to ask Recallant for examples from other projects when I do not know how to set up a resource such as Google Drive, while keeping those examples separate from binding rules.
8. **As an agent**, I want to load only relevant context so I do not waste the model window on unnecessary startup files.
8a. **As an agent**, I want to call one startup context-pack tool after session start so I do not manually guess which checkpoint/memories/searches to combine.
9. **As an agent**, I want to keep working during server/network outages and sync captured context later.
10. **As an agent**, I want deterministic error codes from MCP tools so that I can retry or escalate per `MCP_SPEC.md`.
11. **As the owner**, I want a Review UI so I can manage important memories, active rules, conflicts, duplicates, and source evidence without reviewing every automatic memory write.
12. **As the owner**, I want capture profiles per project so serious projects can record more detail while simple projects keep only the essentials.
13. **As the owner**, I want centralized settings so I can open Recallant management UI, choose a project, and inspect or change its project-specific settings without editing local files.
14. **As the owner**, I want a cost dashboard and explicit paid API approvals so Recallant cannot quietly add token bills on top of my existing agent subscriptions.
15. **As the owner**, I want to manage Recallant through natural language so I can ask it to find, fix, archive, or forget memory without learning internal commands.
16. **As the owner**, I want permanent erasure for wrong or sensitive memory so it does not remain in context packs, embeddings, summaries, search, or UI.
17. **As the owner**, I want Recallant to reuse existing local infrastructure such as Ollama and obey server inventories such as `/ai/SECURITY` and `/ai/PORTS.yaml`.

## 4. Priorities

1. Correctness of **L0 append + provenance**  
2. Governed **agent memory** with review/use policy
3. Owner-facing **Review UI** for important/conflicting/long-term memory hygiene
4. **Context-budget discipline** and one-action project bootstrap
5. **MCP contract** stability
6. **Retrieval quality** (hybrid + budgets)
7. Managed cleanup/erasure and natural-language management safety
8. Ingest breadth (full automation for every CLI comes later; see `INGESTION.md`)

## 5. Success metrics (v1)

- Retrieval latency p95 for `memory_search` on local Postgres is defined in `TEST_CONTRACT.md`, not as hard-coded PRD numbers.
- Zero data loss for L0 under normal shutdown (ACID commit before ACK to client).
- A new Codex project can be bootstrapped without manually copying existing project configuration history.
- An existing project can be attached in guided/autopilot mode with a readable report and without silent instruction-grade promotion.
- Cross-project recall returns labeled, source-linked examples without mixing unrelated project memories into the default context pack.
- Agent startup context remains bounded and task-relevant.
- A new Codex session in an old project restores the current task without the owner re-explaining context.
- Local captured work can be synced to the server after an outage.
- The owner can review and curate important/conflicting/long-term memories through UI without confirming every ordinary memory write.
- The owner can remove incorrect or sensitive memory through an explicit erasure workflow that removes active and derived material.
- The owner can ask Recallant natural-language management questions and receive a context-aware answer/action plan in the user's language.
- Server deployment does not create unregistered port conflicts and does not bypass the existing security baseline.

## 6. Dependencies

- PostgreSQL with the `pgvector` extension.
- MCP server implementation; language/runtime choices are defined in the implementation guide.
- Repo-native Recallant contract generated by `recallant init`; see `REPO_CONTRACT.md`. The older personal `agent-bootstrap` sketch is only historical inspiration.

## 7. v1 Scope

v1 is the full working core for **coding-agent memory**. It includes:

- raw session/event evidence according to capture policy,
- raw artifact metadata/pointers for large workflow evidence,
- local spool/offline sync,
- practical backup/restore with restore verification,
- session lifecycle, hybrid heartbeat, interruption recovery, and closeout,
- checkpoints,
- Context Pack Builder,
- hybrid search with bounded responses,
- governed memories with provenance/review/use policy/source refs/recall traces,
- Review UI for important/conflicting/long-term governed memory hygiene,
- paid API approval flow and cost dashboard,
- centralized settings,
- private-by-default access with Recallant auth and Cloudflare-ready routing,
- local-first, subscription-first, API-last model router with OpenAI paid API baseline and optional Gemini/Claude cheap routes,
- Codex adapter as first working target and universal MCP contracts for later clients,
- project/developer rules and preferences,
- decisions, constraints, lessons, failures, procedures, work logs,
- file/commit/doc/external references as source-linked artifacts,
- explicit imports of important project docs, git history, issues, PRs, or external links when requested.
- autonomous/guided project attach workflows that compose safe discovery, import, context preview, diagnostics, and owner-readable reporting.
- controlled cross-project recall for prior solution examples, developer rules, environment facts, and capability/connector references.

v1 does not automatically ingest every file, issue tracker, browser event, email, calendar item, or personal-life source. It does not require object storage, a separate vector DB, or a graph DB. Those are future expansion paths through explicit connectors/domains/ADRs.

## 8. Future Expansion Options

Future expansion may add:

- broader project imports: selected docs, git history, PRs/issues, release notes;
- codebase semantic map: symbols, dependency graph, architecture evidence;
- personal research memory: articles, notes, links, reading history;
- personal-life memory: calendar, email, files, browser history, messages;
- ambient capture: only after separate design for consent, review, privacy, and noise control;
- object storage for huge raw blobs and attachments;
- dedicated vector DB or graph DB when measured scale/query patterns justify the operational cost;
- richer visual Memory Tree/workbench beyond the required Review UI;
- public packaging / Journey-style kit distribution;
- multi-user/SaaS/security expansion.
