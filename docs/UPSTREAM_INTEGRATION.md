# Upstream integration map

Policy: **borrow proven ideas**, but own Recallant's contracts and schema. At this stage, licenses are not an architecture selection constraint: the owner confirmed that listed upstreams may be used as needed. Selection is based on technical value, portability, and fit with Recallant contracts.

Current detailed research snapshot: [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md).

Implementation-facing local review: [UPSTREAM_IMPLEMENTATION_REVIEW_2026-05-22.md](UPSTREAM_IMPLEMENTATION_REVIEW_2026-05-22.md).

Important: Recallant architecture is not a license to copy upstream blindly. The SHAs below are research snapshots for reproducible analysis; they do not mean code should be transplanted without adaptation.

Current working position: **OB1 / Open Brain is the preferred architectural foundation**. Other projects remain sources for strong subsystem ideas. See [ADR-0004-ob1-as-preferred-foundation.md](ADR-0004-ob1-as-preferred-foundation.md).

Journey specifically is **not** replacing OB1 as the memory foundation; it is the packaging/onboarding/workflow layer reference. See [ADR-0008-journey-as-workflow-packaging-layer.md](ADR-0008-journey-as-workflow-packaging-layer.md).

Accepted synthesis: Recallant combines **OB1 governance** with **MF0 workbench/raw-capture/Memory Tree ideas**. OB1 remains the backbone, MF0 becomes a first-class subsystem donor, and Recallant owns the bridge: managed hybrid capture profiles, raw workflow evidence/artifact pointers, future-only project policy changes, Review UI, and context-budget enforcement. See [ADR-0018-ob1-mf0-synthesis.md](ADR-0018-ob1-mf0-synthesis.md) and [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md).

Before implementation, selected upstream repositories should be cloned or inspected locally when practical. The goal is to understand code, architecture, tradeoffs, mistakes, and mature patterns before writing Recallant code. Reuse must be deliberate: document what is adapted, what is rejected, and which Recallant contract it maps to.

## 0. Accepted OB1/MF0 synthesis

| Layer | Primary upstream influence | Recallant decision |
|-------|----------------------------|--------------|
| Governance / trust | OB1 | Provenance, review status, instruction-grade gates, source refs, recall traces, audit |
| Raw evidence / workbench capture | MF0 | Preserve conversation/workflow evidence according to capture profile, use raw artifact pointers for large payloads, then derive summaries/memories |
| Review and long-term hygiene | OB1 + MF0 | Governed review model plus richer owner-facing UI, duplicate/conflict/rule management |
| Memory graph / visual navigation | MF0 | Use as UX inspiration; map into Recallant-owned graph/data contracts |
| Project onboarding/package | Journey + owner prior agent-bootstrap sketch + MF0 export/import | `recallant init`, thin repo files, future kit/profile export/import |
| Final contracts | Recallant | `DATA_MODEL.md`, `MCP_SPEC.md`, `INGESTION.md`, `MEMORY_MANAGEMENT.md`, `RETRIEVAL.md` |

## 1. NateBJones-Projects / OB1 (Open Brain)

**Role:** preferred foundation for **Postgres + vectors + remote MCP + multi-client narrative**, plus the main reference for governed **agent memory sidecars** and trust policy.

| Take as-is or adapt | Rework / replace |
|---------------------|------------------|
| MCP connection patterns for Cursor / Claude Code from repo docs | Domain schema; replace with [DATA_MODEL.md](DATA_MODEL.md) |
| Getting started and env layout ideas | Any shortcut without strict `project_id` |
| pgvector migration examples | "One human brain" semantics; refocus as **agent memory** |
| Agent Memory sidecars: provenance, review, recall traces, source refs, use policy | Direct code transfer without adaptation to Recallant scope/contracts |
| Compact structured write-back and unsafe raw-dump blocking | Treating OB1's selective capture stance as enough for Recallant raw evidence needs |

**Action for implementers:** clone or inspect OB1 locally, produce a diff-list of what remains useful and what is discarded, and record the implementation pin here if code is adapted:

- OB1 research snapshot: `151a8d1c922ffadad08399508efe46b207a5894e`
- OB1 implementation review pin: `151a8d1c922ffadad08399508efe46b207a5894e`
- OB1 implementation code pin: not selected yet; record only if implementation code is adapted.

## 2. MemPalace (`MemPalace/mempalace`)

**Role:** prior art for **verbatim-first memory**, MCP memory tools, hooks/pre-compaction capture, temporal KG, local semantic workflow, backend abstraction, and repair/recovery posture.

| Take | Skip |
|------|------|
| Tool names/grouping as UX reference | Chroma-centric schema as source of truth |
| Pre-compaction hook idea, mapped to policy that calls `memory_append_turn` from agent or watcher | "Palace" metaphors as required product language |
| Verbatim raw storage and message-level sweep as capture safety net | AAAK/compression as required Recallant layer |
| Temporal KG add/query/invalidate/timeline pattern | Benchmark claims without reproducing on Recallant workloads |

**Research snapshot:** `develop` at `1b94f4efb4949765d6965936476c236df13fd108`; latest release observed `v3.3.5`.

**Implementation review pin:** `1b94f4efb4949765d6965936476c236df13fd108`.

**Implementation code pin:** not selected yet; record only if implementation code is adapted.

## 3. MF0-1984 (`PavelMuntyan/MF0-1984`)

**Role:** first-class subsystem donor for **raw capture/workbench**, graph/topic/dialogue UX, Memory Tree, keeper pipelines, project profile export/import, and server-side provider proxy patterns; not runtime core and not schema source of truth.

| Take | Skip |
|------|------|
| Read `HANDOFF.md` for continuity ideas | Direct SQLite schema transfer |
| Memory Tree visual idea as inspiration for v1 Review UI and later richer workbench | Product-specific Intro/Rules/Access modes as Recallant core |
| Graph hygiene commands: merge/rename/delete/move, protected hubs | Product-specific graph semantics without Recallant normalization |
| Server-side LLM proxy pattern: browser never gets provider keys | |
| Conversation turn/thread message mirror, rolling summaries, extracted memory items | MF0's SQLite schema as Recallant SoT |
| Keeper-style specialized extraction and saved-conduct flows | Unreviewed automatic promotion of extracted rules into binding Recallant instructions |

**Research snapshot:** `9722af674bef7b85350617607db5dffd5e4ae6fe`, app version `1.9.28`.

**Implementation review pin:** `9722af674bef7b85350617607db5dffd5e4ae6fe`.

**Implementation code pin:** not selected yet; record only if implementation code is adapted.

## 4. agent-bootstrap (owner prior sketch)

**Role:** the owner's earlier personal sketch for the same problem, useful for **repo contract** ideas for agents. It is not an external mature upstream and not an implementation to copy.

| Take | Skip |
|------|------|
| Thin `AGENTS.md` / `PROJECT_LOG.md` bootstrap surfaces | Any memory logic inside bootstrap |

See [REPO_CONTRACT.md](REPO_CONTRACT.md).

**Historical sketch snapshot:** `57d9b3f`.

## 5. Journey / Journey Kits (`journeykits.ai`)

**Role:** reference for **packaging/distribution layer**: reusable agent workflows, target-aware install, kit manifests, resolver hints, preflight checks, versioning, shared context, and install/outcome/learning feedback.

Journey is not a memory engine foundation. It is relevant because Recallant needs "new project -> one action -> usable agent configuration" without manually copying project rules and logs.

| Take | Skip |
|------|------|
| `kit.md`-style workflow package format | Making Recallant dependent on Journey SaaS for core memory |
| Target-aware install model (`codex`, `cursor`, `claude-code`, `windsurf`, etc.) | Treating public kits as trusted without local review |
| Resolver hints to avoid always-loading all docs | Copying large kit docs into every project startup context |
| Preflight/verification and install reporting ideas | Requiring telemetry/outcome reporting for private local Recallant use |
| Shared-context/resource binding concepts | Letting packaging layer own Recallant SoT |

**Official snapshot:** Journey reference doc version `2026.04.13`; kit.md spec version `2026.03.28`; API build `5f85a73a24fde43c52be6b612c4f5d3d950db9b1`.

**Architecture decision:** do not use Journey as Recallant's memory foundation; use it to shape `recallant init`, future kit export, resolver hints, preflight, verification, and template versioning.

## 6. OpenMemory by CaviraOSS (`CaviraOSS/OpenMemory`) — optional

This was not part of the original "three", but it is useful for ideas around cognitive sectors, temporal facts, salience/decay/reinforcement, waypoints, SDK ergonomics, connectors, and explainable traces. Its README currently says the project is being rewritten; use it as prior art, not as a stable foundation.

| Take | Skip |
|------|------|
| Contextual vs factual memory split | Full cognitive taxonomy as required Recallant v1 schema |
| Salience, decay, reinforcement, last access tracking | Synthetic embeddings as serious retrieval default |
| `user_id` / `project_id` scoping | Current runtime as dependency while rewrite warning remains |
| SDK/server/MCP modes and connectors | |

**Research snapshot:** `de39bcd74c7d0a73982def1c052d0b69ecefd7f6`.

**Implementation review pin:** `de39bcd74c7d0a73982def1c052d0b69ecefd7f6`.

**Implementation code pin:** not selected yet; record only if implementation code is adapted.

## 7. OpenMemory by Mem0 (`mem0ai/mem0/openmemory`) — historical / do not build on directly

This is a separate project from CaviraOSS/OpenMemory. Its README now says OpenMemory is being sunset and recommends Mem0 self-hosted instead. Keep it as historical prior art for local MCP memory UX and dashboard onboarding, but do not use the sunset package as Recallant foundation.

**Research snapshot:** parent repo `843ab82905f7f04ca27ad7e73083e68bfab06c2d`.

## 8. Reuse checklist (agents must complete)

- [x] Pinned SHAs recorded above for implementation review
- [x] Local upstream inspection performed before Phase 0; see [UPSTREAM_IMPLEMENTATION_REVIEW_2026-05-22.md](UPSTREAM_IMPLEMENTATION_REVIEW_2026-05-22.md)
- [ ] List of reused/copied files with paths, if any
- [x] Boundary contracts documented before adapting code
- [ ] Tests proving boundary contracts (`TEST_CONTRACT.md`)
