# Upstream Research Snapshot — 2026-05-19

Internal working notes for Recallant architecture discovery. This is not a user-facing comparison and does not decide the final architecture.

## Purpose

We are early in architecture selection. The goal is to assemble the strongest ideas from current open-source memory projects into one system suited to our needs: durable memory for coding agents, cross-client continuity, explicit checkpoints, provenance, and safe bounded retrieval.

Use this file as the current research baseline before changing `ARCHITECTURE.md`, `DATA_MODEL.md`, or `MCP_SPEC.md`.

Current working direction: **Open Brain / OB1 is the preferred architectural foundation**. This is not a final low-level design decision, but it is the default reference point for resolving architecture tradeoffs. The other projects remain active best-of-breed sources rather than discarded alternatives.

## Source Snapshot

Official sources were refreshed on 2026-05-19.

| Project | Official source | Snapshot revision / state | Reuse assumption |
|---|---|---:|---|
| Open Brain / OB1 | `https://github.com/NateBJones-Projects/OB1` | `main` at `151a8d1c922ffadad08399508efe46b207a5894e` | May be used/adapted as needed; evaluate only technical fit |
| MemPalace | `https://github.com/MemPalace/mempalace`, `https://mempalaceofficial.com` | `develop` at `1b94f4efb4949765d6965936476c236df13fd108`; latest release observed `v3.3.5` | May be used/adapted as needed; evaluate only technical fit |
| MF0-1984 | `https://github.com/PavelMuntyan/MF0-1984` | `main` at `9722af674bef7b85350617607db5dffd5e4ae6fe`; app version `1.9.28` | May be used/adapted as needed; evaluate only technical fit |
| OpenMemory by CaviraOSS | `https://github.com/CaviraOSS/OpenMemory`, `https://openmemory.cavira.app` | `main` at `de39bcd74c7d0a73982def1c052d0b69ecefd7f6`; README says project is being rewritten | May be used/adapted as needed; evaluate only technical fit |
| OpenMemory by Mem0 | `https://github.com/mem0ai/mem0/tree/main/openmemory`, `https://mem0.ai/blog/introducing-openmemory-mcp` | parent repo `main` at `843ab82905f7f04ca27ad7e73083e68bfab06c2d`; OpenMemory README says it is being sunset | May be used/adapted as needed; evaluate only technical fit |
| agent-bootstrap | owner's prior local prototype/sketch, external folder not required after transfer | `57d9b3f Initial bootstrap v1` | idea source only; not an external implemented upstream to copy |
| Journey / Journey Kits | `https://www.journeykits.ai`, `https://www.journeykits.ai/api/kits/journey`, `https://www.journeykits.ai/api/docs/kit-md` | Journey doc `2026.04.13`; kit.md spec `2026.03.28`; API build `5f85a73a24fde43c52be6b612c4f5d3d950db9b1` | May be used/adapted as workflow packaging/onboarding reference |

Important working rule from the project owner: licensing is not a selection criterion at this stage. We can use any listed project as needed. The practical question is whether a component fits Recallant technically, operationally, and contractually.

## Working Architecture Bias

OB1 should be treated as the backbone because its architecture most closely matches the desired Recallant shape:

- durable Postgres/pgvector foundation,
- remote MCP and multi-client integration,
- clean narrative around "one memory substrate, many AI clients",
- growing agent-memory sidecar model with provenance, review, source refs, use policies, and recall traces.

The other projects should be mined for subsystem-level wins:

- MemPalace: verbatim capture, hooks/sweep, temporal KG, hybrid retrieval, repair/recovery.
- MF0-1984: Memory Tree UX, graph hygiene, keeper pipelines, project export/import, server-side provider proxy.
- CaviraOSS/OpenMemory: salience/decay/reinforcement, temporal facts, connectors, explainable traces.
- Mem0 OpenMemory: historical local MCP onboarding ideas only.
- agent-bootstrap: owner's early repo-contract sketch for durable handoff files; treat as prior Recallant thinking, not as a mature external upstream.
- Journey / Journey Kits: reusable workflow packaging, target-aware install, resolver hints, preflight, versioning, shared context, outcome/learning loops.

Architectural implication: do not keep re-running a neutral "which project wins" contest. Start from OB1 and deliberately graft in stronger subsystem patterns where they help Recallant.

## Open Brain / OB1

Current positioning: "infrastructure layer for your thinking": one database, one AI gateway, one chat channel, any AI can plug in. It is not a notes app; it is a Supabase/Postgres + pgvector backend with remote MCP access.

Core system:

- Base table is `thoughts`: `content`, `embedding vector(1536)`, `metadata`, timestamps, fingerprint dedupe.
- Core MCP server is a Supabase Edge Function (`server/index.ts`).
- Core MCP tools: `search`, `fetch`, `search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`.
- Uses OpenRouter embeddings (`openai/text-embedding-3-small`) and LLM metadata extraction (`gpt-4o-mini`) in the default guide.
- Remote MCP URL pattern is first-class; ChatGPT compatibility led to explicit `readOnlyHint` annotations.
- The repo has grown into recipes, skills, schemas, dashboards, integrations, and primitives.

Most important new direction for Recallant:

- OB1 now has an `Agent Memory` sidecar schema and runtime-neutral Agent Memory API.
- Sidecar keeps the core `thoughts` table, but adds governed operational memory:
  - `agent_memories`
  - `agent_memory_source_refs`
  - `agent_memory_artifacts`
  - `agent_memory_relations`
  - `agent_memory_review_actions`
  - recall trace and audit tables.
- Memory types include `decision`, `output`, `lesson`, `constraint`, `open_question`, `failure`, `artifact_reference`, `work_log`.
- Agent-created memory is evidence-only and requires review by default.
- Instruction-grade memory is gated: only `user_confirmed` or `imported` can become instruction-grade.
- Runtime API exposes recall, writeback, usage reporting, review, inspection, and recall trace endpoints.

What to take into Recallant:

- Remote MCP deployment patterns and client-specific compatibility details.
- `readOnlyHint` / tool annotation discipline.
- Agent-memory governance model: provenance, confidence, review status, use policy, source refs, audit.
- Recall trace and usage reporting: agent should report what recalled memory was used or ignored.
- Write-back should be compact structured memory, not raw transcript dumps.
- Smoke harnesses that prove unsafe write-back is blocked and pending memory is gated.

What not to take directly:

- The single flat `thoughts` table as Recallant core. Recallant needs raw L0 events, chunks, embeddings, edges, checkpoints, and project/developer scope.
- Default OpenRouter dependency as the only path. Recallant should keep local embeddings viable.
- Direct code transfer before adapting it to Recallant's project/developer scope, provenance rules, and storage contracts.

## MemPalace

Current positioning: local-first AI memory with verbatim storage, pluggable backend, ChromaDB default, strong retrieval benchmark claims after public corrections.

Core system:

- Stores conversation/project content as verbatim text. It explicitly does not summarize or paraphrase for the primary storage path.
- Palace taxonomy: wings, rooms, closets, drawers.
- Default backend is ChromaDB, but a backend abstraction exists (`BaseBackend`, `BaseCollection`, typed `QueryResult`, `PalaceRef`).
- Temporal knowledge graph is local SQLite with entities, triples, attributes, validity windows.
- MCP server exposes 29 tools for status, taxonomy, search, drawer CRUD, sync, KG ops, graph tunnels, diary, hooks, reconnect.
- Claude Code hooks save periodically and before compaction; `sweep` gives message-level transcript ingestion.
- Current release notes are mainly about integrity, recovery, locking, cross-process correctness, and KG temporal validation.

High-value current features:

- Verbatim-first philosophy. Do not let summarization be the only durable source.
- Hook model for pre-compaction and stop/session capture.
- Recovery tooling (`repair --mode from-sqlite`) and explicit handling of vector-store corruption.
- Query sanitizer and MCP stdio protection.
- Per-agent diary and per-project wing scoping.
- Temporal KG validity validation: invalid date windows become write-time errors.
- Hybrid retrieval: semantic + keyword/BM25 + temporal boosts + optional LLM rerank.
- Benchmark hygiene now explicitly separates retrieval recall from end-to-end QA accuracy.

What to take into Recallant:

- Raw/verbatim capture as a first-class invariant.
- Pre-compaction/session-close hooks as optional ingest channels.
- Message-level sweeper concept for missed transcript capture.
- Backend abstraction idea, but likely with Postgres as the initial real backend.
- Integrity/recovery posture: assume vector indexes can go stale/corrupt and build repair paths.
- Temporal KG add/query/invalidate/timeline pattern.
- Query-size limits and prompt-contamination mitigation.

What not to take directly:

- Palace/wings/rooms/drawers as the public Recallant model. Useful as inspiration, but Recallant should keep neutral project/session/event/chunk terms.
- ChromaDB as SoT.
- AAAK as a required compression layer. It is experimental and had public corrections.
- Benchmark numbers as architecture proof without reproducing on our target workloads.

## MF0-1984

Current positioning: local-first SPA/workbench for multi-provider LLM chat, structured modes, memory tree, themes/dialogs, analytics, favorites, and `.mf` profile backup/restore.

Current architecture:

- Vite UI, default port `1984`.
- Local Node API with Express 5 and `better-sqlite3`, default API port `35184`.
- Version observed: `1.9.28`.
- Server is no longer the old monolithic route chain: `server/api.mjs` is now a thin bootstrap mounting route modules.
- API keys moved server-side through `POST /api/llm/<provider>/*`; browser gets `server-proxy` placeholders, not real keys.
- SQLite WAL mode is enabled.
- Images moved from base64-in-SQLite into `data/attachments/<uuid>.<ext>`.
- Memory graph has categories, nodes, edges, protected hubs, merge/delete/rename/move commands, and import/export.
- Context pipeline stores thread messages, rolling summaries, decision logs, and extracted `memory_items`.
- Keeper pipelines extract Intro graph, Access service records, Rules, and normal-chat interest sketch.

What to take into Recallant:

- UI/workbench ideas, not runtime core.
- Memory graph UX and graph hygiene operations: merge nodes, rename nodes, delete stale edges, protect hub anchors.
- Structured keeper pipelines that extract different memory classes from different workflows.
- Server-side secret proxy pattern: no provider keys in browser.
- Project profile export/import as a portability idea.
- Attachment extraction to files with DB references.
- WAL/adapter lessons for SQLite if Recallant ever supports edge/local single-user mode.

What not to take directly:

- Product-specific SQLite schema as Recallant core.
- UI modes (`Intro`, `Access`, `Rules`) as required Recallant concepts.
- Any code path that bakes MF0 product-specific modes into Recallant core instead of treating them as optional UX/pipeline ideas.

## OpenMemory by CaviraOSS

Current positioning: cognitive memory engine for LLMs and agents; self-hosted/local-first; Python and Node SDKs; REST server; MCP; VS Code extension. README currently warns that the project is being rewritten.

Core architecture:

- HMD/HSG style memory architecture.
- Five sectors: episodic, semantic, procedural, emotional, reflective.
- SQLite by default, Postgres supported.
- Tables include memories, vectors, waypoints, users, stats, temporal facts, temporal edges.
- Memory has salience, decay lambda, last seen time, sector classification, mean vectors, project/user ids.
- Retrieval combines vector similarity, salience, recency, waypoint expansion, tags/keyword overlap.
- Waypoint graph creates associative links and reinforces/prunes them over time.
- Temporal facts support subject-predicate-object facts with validity windows.
- Connectors include GitHub, Notion, Google Drive/Sheets/Slides, OneDrive, web crawler.
- MCP tools observed: `openmemory_query`, `openmemory_store_project`, `openmemory_store`, `openmemory_reinforce`, `openmemory_delete`, `openmemory_list`, `openmemory_get`.

What to take into Recallant:

- Distinction between contextual memory and temporal facts.
- User/project scoping as explicit parameters.
- Salience, decay, reinforcement, and last-access tracking as retrieval inputs.
- Explainable recall traces as a requirement, not afterthought.
- Connector architecture for future ingest sources.
- SDK ergonomics: embedded mode, server mode, MCP mode.

What not to take directly:

- Cognitive sector taxonomy as required v1 schema. For coding agents, `decision`, `constraint`, `failure`, `artifact`, `checkpoint`, `work_log` may be more useful than emotional/reflective sectors.
- Current repo as stable base while rewrite warning remains.
- Synthetic embeddings as a serious retrieval default except for tests.

## OpenMemory by Mem0

This is a separate project from CaviraOSS/OpenMemory. It lives under `mem0ai/mem0/openmemory`.

Current state:

- Official README now says OpenMemory is being sunset.
- It recommends using the Mem0 self-hosted server instead.
- Original concept: local MCP memory server with dashboard, cross-client memory, and tools like `add_memories`, `search_memory`, `list_memories`, `delete_all_memories`.

What to take into Recallant:

- Treat it as historical prior art for local MCP memory UX and dashboard onboarding.
- Check Mem0 self-hosted separately if we decide to compare managed/self-hosted memory platforms.

What not to take directly:

- Do not base Recallant on the sunset OpenMemory package.
- Do not confuse it with CaviraOSS/OpenMemory in docs.

## Journey / Journey Kits by Matthew Berman / Forward Future

Current positioning: a free/open registry for reusable agent workflows. Its public site describes Journey as a place to install kits and give agents new capabilities. It is relevant to Recallant because the owner needs "new project -> one action -> usable agent configuration" without manually copying project rules and logs.

Architecture decision after comparison with OB1: Journey should not replace OB1 as Recallant's memory foundation. Journey is the reference for packaging/onboarding/workflow distribution; OB1 remains the preferred memory-substrate backbone. See ADR-0008.

Official surfaces inspected:

- `https://www.journeykits.ai/`
- `GET /api/kits/journey` reference doc, version `2026.04.13`
- `GET /api/docs/kit-md` spec, version `2026.03.28`
- `GET /.well-known/agent-kit.json`
- `GET /api/openapi.json`
- `GET /api/install-targets`

Core system:

- `kit.md` packages reusable agent workflows with YAML frontmatter and markdown body.
- Kits may include skills, tools, examples, assets, source code, prerequisites, verification, failure modes, memory contracts, resolver hints, and required resources.
- Install is target-aware. Observed targets include `codex`, `cursor`, `claude-code`, `windsurf`, several other agent targets, and `generic`.
- The API supports search, task matching, install, preflight, dependency graph, version checks, diffs, release history, authors, related kits, org/private kits, shared context, runtime credential issuance, and hosted MCP.
- The Journey kit guidance says structured installs should run preflight checks, preserve file paths exactly, respect append/create write modes, run verification when available, and report install/outcome/learning where appropriate.
- `kit.md` has an explicit `memory` contract with scope/backing/writePolicy/retention/reviewMode/entityTypes, plus `resolverHints` for lazy context routing.

What to take into Recallant:

- One-action project onboarding as a product primitive, not an afterthought.
- Target-aware bootstrap output: Codex now, more clients later.
- `kit.md`-like packaging for Recallant project setup or reusable memory workflows.
- Resolver hints to avoid loading all instructions/docs at startup.
- Preflight checks and verification command for new project setup.
- Versioning/update checks for installed memory workflows and templates.
- Learning/outcome feedback loop as an optional private local pattern for improving Recallant templates.
- Shared resource binding concepts for server URLs, DBs, credentials, and future organization/team contexts.

What not to take directly:

- Do not make Recallant core memory depend on Journey SaaS availability.
- Do not let workflow packaging become the source of truth for memory.
- Do not copy big kit guides into always-loaded project context.
- Do not submit telemetry/outcome reports by default for private local work.

## agent-bootstrap

This is the owner's prior personal project started before Recallant. It should be treated as an idea sketch / first pass at the same problem Recallant now addresses more seriously, not as a mature external upstream implementation.

Local repo-contract ideas remain useful:

- `AGENTS.md`, `PROJECT_LOG.md`, thin adapter files, and manifests.
- A file-based handoff/checkpoint contract even if MCP is unavailable.
- Repo-native fallback surfaces that Recallant can generate during `recallant init`.

What not to do:

- Do not treat agent-bootstrap as proof that a design is implemented or production-ready.
- Do not rank it alongside OB1, MemPalace, MF0, OpenMemory, or Journey as an independent upstream project.
- Do not bake the owner's current server layout into Recallant just because the early sketch assumed a local workflow.

## Cross-Project Architecture Lessons

### 1. Durable source of truth

The strongest common pattern is: raw durable storage first, derived memory second.

- MemPalace is strongest on verbatim preservation.
- OB1 core starts with atomic `thoughts`.
- Recallant should keep L0 append-only events as SoT, then derive chunks, embeddings, facts, summaries, and traces.

### 2. Memory write-back must be governed

OB1 Agent Memory is the best current source for this.

Recallant should distinguish:

- raw transcript/event evidence
- generated/inferred memory
- user-confirmed instruction-grade memory
- stale/superseded/rejected memory.

Generated memories should be evidence-only by default. Instruction-grade memories require user confirmation or trusted import.

### 3. Retrieval needs several legs

Vector-only is not enough.

Use a bounded hybrid pipeline:

- lexical / keyword / BM25 or `tsvector`
- vector semantic similarity
- recency and decay
- salience / access reinforcement
- graph expansion within budget
- optional LLM rerank only after candidate generation.

### 4. Graph should be useful, not decorative

Useful graph patterns:

- OB1: memory relations, supersedes/conflicts/merged_into, source refs.
- MemPalace: temporal facts and tunnels.
- MF0: node hygiene commands and protected hubs.
- OpenMemory: waypoints and temporal facts.

Recallant should probably start with relations between chunks/events/memories and temporal facts, not a full visual graph product.

### 5. Project scope matters

All systems eventually need isolation:

- OB1 uses workspace/project/channel in agent memory sidecars.
- OpenMemory has user_id/project_id.
- MemPalace uses wings and per-project diaries.
- Recallant already has developer/project scope; keep it central.

### 6. Hooks and file contracts are both needed

MCP alone does not guarantee capture before context loss.

Recallant should support:

- MCP append/writeback during normal work
- explicit session close/checkpoint
- optional hooks/watchers for transcript capture
- repo-native `PROJECT_LOG.md` fallback via `agent-bootstrap`.

### 7. Tool surface must stay small

MemPalace shows what a powerful large tool surface looks like, but Recallant should not expose 29 tools in v1.

Keep v1 compact:

- append raw event/turn
- search
- fetch
- link/relation
- get/set checkpoint
- governed-memory management and Review UI are now v1 scope per ADR-0016; keep broader raw-memory dashboards out of v1. The later ADR-0032 adds a narrow Cost / Paid API dashboard as a required safety surface, not a broad raw-memory dashboard.

Add richer tools only when the retrieval/writeback lifecycle proves they are needed.

## Provisional Recallant Direction

Not final at low-level design, but updated by ADR-0004, ADR-0005, ADR-0016, ADR-0017, and ADR-0018. Current best synthesis:

1. **Postgres SoT** remains the strongest default for Recallant.
2. **L0 events are append-only** and preserve raw/verbatim context.
3. **L1 chunks** hold searchable text, embedding status, access stats, scope, archive/supersede state.
4. **L2 relations** cover provenance, supersedes/conflicts/related_to, source refs, artifacts, and optional graph expansion.
5. **Agent memories** are separate governed L3 records, inspired by OB1 sidecars, rather than just raw chunks.
6. **OB1/MF0 synthesis** is accepted: OB1 supplies governance/trust; MF0 supplies workbench/raw-capture/Memory Tree/Keeper ideas; Recallant owns capture profiles and Review UI policy.
7. **Temporal facts** should probably be a first-class derived layer or a specialized relation type.
8. **Checkpoint** remains an explicit project object and must sync to `PROJECT_LOG.md`.
9. **Hybrid retrieval** should combine Postgres lexical search, vector search, decay/salience, and bounded graph expansion.
10. **Hooks/watchers** should be optional ingest paths after MCP append is working.
11. **Review UI/admin** is v1 for governed-memory inbox/rules/conflicts/duplicates/source inspection; broader dashboards remain non-v1, except the later required Cost / Paid API dashboard from ADR-0032.

## Follow-up Implementation Topics

- Baseline schema/API mapping for L3 `agent_memories`, source refs, review actions, and recall traces now lives in [DATA_MODEL.md](DATA_MODEL.md) and [MCP_SPEC.md](MCP_SPEC.md). Field-level details may still evolve during implementation.
- Temporal facts need a concrete implementation shape later: either their own table pair or typed edges with validity windows.
- Runtime direction is resolved by [RUNTIME_STACK.md](RUNTIME_STACK.md) and [ADR-0010-controlled-hybrid-runtime.md](ADR-0010-controlled-hybrid-runtime.md): TypeScript-first core with optional bounded Python workers.
- v1 storage direction is Postgres SoT. Local files/spool may exist for resilience, but not as an alternate authoritative SQLite mode.
- Closeout/write-back payload is defined by [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md), [REPO_CONTRACT.md](REPO_CONTRACT.md), and [MCP_SPEC.md](MCP_SPEC.md).
- Review UI is required in v1 by [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md) and shaped by [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md).
- OB1/MF0 synthesis is accepted by [ADR-0018-ob1-mf0-synthesis.md](ADR-0018-ob1-mf0-synthesis.md): OB1 is the governance backbone; MF0 is a first-class workbench/raw-capture/UI donor.

## Implementation Research Tasks

1. Build a technical reuse matrix: what to copy, adapt, reimplement, or only study.
2. Refine the Recallant core memory taxonomy: raw events, chunks, governed memories, temporal facts, checkpoints.
3. Iterate `DATA_MODEL.md` from the initial L3 governed memory schema.
4. Iterate `MCP_SPEC.md` for compact tools plus provenance/review fields.
5. Build a small retrieval prototype against Postgres: raw chunks + tsvector + pgvector + supersedes + decay.
6. Separately evaluate Mem0 self-hosted if we want a reference for production SDK/platform ergonomics.
