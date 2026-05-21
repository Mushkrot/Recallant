# Upstream integration map

Политика: **заимствовать проверенное**, владеть **контрактами и схемой** у себя. На текущем этапе лицензии не являются архитектурным ограничением: владелец проекта подтвердил право использовать перечисленные upstream как нужно. Отбор делаем по технической ценности, переносимости и соответствию нашим контрактам.

Текущий детальный research snapshot: [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md).

Важно: архитектура AMP пока не зафиксирована окончательно. SHA ниже — research snapshots для воспроизводимого анализа; они не означают, что код нужно переносить без адаптации.

Текущая рабочая позиция: **OB1 / Open Brain — preferred architectural foundation**. Остальные проекты не отбрасываются; они остаются источниками лучших отдельных решений. См. [ADR-0004-ob1-as-preferred-foundation.md](ADR-0004-ob1-as-preferred-foundation.md).

Journey specifically is **not** replacing OB1 as the memory foundation; it is the packaging/onboarding/workflow layer reference. См. [ADR-0008-journey-as-workflow-packaging-layer.md](ADR-0008-journey-as-workflow-packaging-layer.md).

Accepted synthesis: AMP combines **OB1 governance** with **MF0 workbench/raw-capture/Memory Tree ideas**. OB1 remains the backbone, MF0 becomes a first-class subsystem donor, and AMP owns the bridge: managed hybrid capture profiles, raw workflow evidence/artifact pointers, future-only project policy changes, Review UI, and context-budget enforcement. См. [ADR-0018-ob1-mf0-synthesis.md](ADR-0018-ob1-mf0-synthesis.md) and [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md).

## 0. Accepted OB1/MF0 synthesis

| Layer | Primary upstream influence | AMP decision |
|-------|----------------------------|--------------|
| Governance / trust | OB1 | Provenance, review status, instruction-grade gates, source refs, recall traces, audit |
| Raw evidence / workbench capture | MF0 | Preserve conversation/workflow evidence according to capture profile, use raw artifact pointers for large payloads, then derive summaries/memories |
| Review and long-term hygiene | OB1 + MF0 | Governed review model plus richer owner-facing UI, duplicate/conflict/rule management |
| Memory graph / visual navigation | MF0 | Use as UX inspiration; map into AMP-owned graph/data contracts |
| Project onboarding/package | Journey + owner prior agent-bootstrap sketch + MF0 export/import | `amp init`, thin repo files, future kit/profile export/import |
| Final contracts | AMP | `DATA_MODEL.md`, `MCP_SPEC.md`, `INGESTION.md`, `MEMORY_MANAGEMENT.md`, `RETRIEVAL.md` |

## 1. NateBJones-Projects / OB1 (Open Brain)

**Роль:** preferred foundation для **Postgres + vectors + remote MCP + multi-client narrative**, плюс основной референс для governed **agent memory sidecars** and trust policy.

| Take as-is or adapt | Rework / replace |
|---------------------|------------------|
| Паттерны подключения MCP в Cursor / Claude Code из документации репозитория | Доменная схема — заменить на модель из [DATA_MODEL.md](DATA_MODEL.md) |
| Идеи getting started, env layout | Любые обходы без строгого `project_id` |
| Примеры миграций pgvector | Семантика «один мозг человека» → перефокус на **agent memory** (не меняет Postgres, меняет docs/tools naming) |
| Agent Memory sidecars: provenance, review, recall traces, source refs, use policy | Прямой перенос кода без адаптации под AMP scope/contracts |
| Compact structured write-back and unsafe raw-dump blocking | Treating OB1's selective capture stance as enough for AMP raw evidence needs |

**Action for implementers:** клонировать OB1, составить diff-list: какие файлы остаются, какие выбрасываются. Зафиксировать commit SHA в этом разделе после аудита:

- OB1 research snapshot: `151a8d1c922ffadad08399508efe46b207a5894e`
- OB1 implementation pin: not selected yet; record only if implementation code is adapted.

## 2. MemPalace (`MemPalace/mempalace`)

**Роль:** prior art для **verbatim-first memory**, MCP memory tools, hooks/pre-compaction capture, temporal KG, local semantic workflow, backend abstraction, and repair/recovery posture.

| Take | Skip |
|------|------|
| Имена/группировка tools как UX reference | Chroma-centric schema как SoT |
| Идея hooks до compaction → маппится на **policy** вызывать `memory_append_turn` из агента или внешнего watcher | «Palace» метафоры как обязательная часть |
| Verbatim raw storage and message-level sweep as capture safety net | AAAK/compression as required AMP layer |
| Temporal KG add/query/invalidate/timeline pattern | Benchmark claims without reproducing on AMP workloads |

**Research snapshot:** `develop` at `1b94f4efb4949765d6965936476c236df13fd108`; latest release observed `v3.3.5`.

**Implementation pin:** not selected yet; record only if implementation code is adapted.

## 3. MF0-1984 (`PavelMuntyan/MF0-1984`)

**Роль:** first-class subsystem donor для **raw capture/workbench**, графа/тем/диалогов, Memory Tree UX, keeper pipelines, project profile export/import, and server-side provider proxy patterns; не runtime core and not schema SoT.

| Take | Skip |
|------|------|
| Чтение `HANDOFF.md` для идей связности | Прямой перенос SQLite схемы |
| Визуальная идея memory tree → вдохновение для v1 Review UI and later richer workbench | Product-specific Intro/Rules/Access modes as AMP core |
| Graph hygiene commands: merge/rename/delete/move, protected hubs | Product-specific graph semantics without AMP normalization |
| Server-side LLM proxy pattern: browser never gets provider keys | |
| Conversation turn/thread message mirror, rolling summaries, extracted memory items | MF0's SQLite schema as AMP SoT |
| Keeper-style specialized extraction and saved-conduct flows | Unreviewed automatic promotion of extracted rules into binding AMP instructions |

**Research snapshot:** `9722af674bef7b85350617607db5dffd5e4ae6fe`, app version `1.9.28`.

**Implementation pin:** not selected yet; record only if implementation code is adapted.

## 4. agent-bootstrap (owner prior sketch)

**Роль:** ранний личный набросок владельца для той же проблемы, полезный как источник идей по **репозиторному контракту** для агентов. Это не внешний mature upstream и не реализация, которую нужно копировать.

| Take | Skip |
|------|------|
| Идея тонких `AGENTS.md` / `PROJECT_LOG.md` bootstrap surfaces | Любая логика памяти внутри bootstrap |

См. [REPO_CONTRACT.md](REPO_CONTRACT.md).

**Historical sketch snapshot:** `57d9b3f`.

## 5. Journey / Journey Kits (`journeykits.ai`)

**Роль:** reference для **packaging/distribution layer**: reusable agent workflows, target-aware install, kit manifests, resolver hints, preflight checks, versioning, shared context, and install/outcome/learning feedback.

Journey is not a memory engine foundation. It is relevant because AMP needs "new project -> one action -> usable agent configuration" without manually copying project rules and logs.

| Take | Skip |
|------|------|
| `kit.md`-style workflow package format | Making AMP dependent on Journey SaaS for core memory |
| Target-aware install model (`codex`, `cursor`, `claude-code`, `windsurf`, etc.) | Treating public kits as trusted without local review |
| Resolver hints to avoid always-loading all docs | Copying large kit docs into every project startup context |
| Preflight/verification and install reporting ideas | Requiring telemetry/outcome reporting for private local AMP use |
| Shared-context/resource binding concepts | Letting packaging layer own AMP SoT |

**Official snapshot:** Journey reference doc version `2026.04.13`; kit.md spec version `2026.03.28`; API build `5f85a73a24fde43c52be6b612c4f5d3d950db9b1`.

**Architecture decision:** do not use Journey as AMP's memory foundation; use it to shape `amp init`, future kit export, resolver hints, preflight, verification, and template versioning.

## 6. OpenMemory by CaviraOSS (`CaviraOSS/OpenMemory`) — optional

Не входил в «три», но полезен идеями cognitive sectors, temporal facts, salience/decay/reinforcement, waypoints, SDK ergonomics, connectors, and explainable traces. README currently says the project is being rewritten; использовать как prior art, не как stable foundation.

| Take | Skip |
|------|------|
| Contextual vs factual memory split | Full cognitive taxonomy as required AMP v1 schema |
| Salience, decay, reinforcement, last access tracking | Synthetic embeddings as serious retrieval default |
| `user_id` / `project_id` scoping | Current runtime as dependency while rewrite warning remains |
| SDK/server/MCP modes and connectors | |

**Research snapshot:** `de39bcd74c7d0a73982def1c052d0b69ecefd7f6`.

**Implementation pin:** not selected yet; record only if implementation code is adapted.

## 7. OpenMemory by Mem0 (`mem0ai/mem0/openmemory`) — historical / do not build on directly

This is a separate project from CaviraOSS/OpenMemory. Its README now says OpenMemory is being sunset and recommends Mem0 self-hosted instead. Keep it as historical prior art for local MCP memory UX and dashboard onboarding, but do not use the sunset package as AMP foundation.

**Research snapshot:** parent repo `843ab82905f7f04ca27ad7e73083e68bfab06c2d`.

## 8. Reuse checklist (agents must complete)

- [ ] Pinned SHAs recorded above
- [ ] List of reused/copied files with paths, if any
- [ ] Boundary contracts documented before adapting code
- [ ] Tests proving boundary contracts (`TEST_CONTRACT.md`)
