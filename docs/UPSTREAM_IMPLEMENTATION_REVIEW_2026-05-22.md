# Upstream Implementation Review - 2026-05-22

This review records the first implementation-facing local inspection of the upstream projects named in `UPSTREAM_INTEGRATION.md`.

The goal was to reduce implementation risk before writing Recallant code: inspect real schemas, tool/API surfaces, retrieval/capture behavior, and operational mistakes that upstreams have already solved. This is not a decision to copy upstream code wholesale. Recallant contracts remain authoritative.

## Local snapshots inspected

The repositories were cloned into ignored local working copies under `.upstream/`.

| Project | Local path | Pinned revision | Implementation role |
| --- | --- | --- | --- |
| OB1 / Open Brain | `.upstream/OB1` | `151a8d1c922ffadad08399508efe46b207a5894e` | Primary governance/API/schema reference |
| MemPalace | `.upstream/mempalace` | `1b94f4efb4949765d6965936476c236df13fd108` | Capture, retrieval, recovery, MCP robustness reference |
| MF0-1984 | `.upstream/MF0-1984` | `9722af674bef7b85350617607db5dffd5e4ae6fe` | Workbench, context-pack, provider-proxy, raw artifact reference |
| CaviraOSS/OpenMemory | `.upstream/CaviraOSS-OpenMemory` | `de39bcd74c7d0a73982def1c052d0b69ecefd7f6` | Optional scoring, temporal facts, project isolation reference |

Journey remains a packaging/onboarding reference from the documented official snapshots; no local code repository was inspected for Journey in this pass.

## Executive decision

Use upstreams as implementation references, not as a direct code base.

The optimal implementation path remains:

1. Build Recallant's TypeScript-first monorepo from its own contracts.
2. Adapt OB1's agent-memory governance model into Recallant tables and MCP tools.
3. Adapt MF0/MemPalace capture and context lessons into Recallant L0 events, raw artifacts, local spool, and context-pack builder.
4. Adapt OpenMemory scoring/temporal ideas later in retrieval and cleanup phases.
5. Avoid copying upstream schemas directly, because none matches Recallant's L0/L1/L2/L3 model, project/developer/session settings hierarchy, erasure workflow, or capture profiles.

No upstream file is currently selected for direct code copy. Any future code copy must update `UPSTREAM_INTEGRATION.md` with the exact file path, implementation pin, boundary contract, and tests.

## OB1 findings

Inspected:

- `.upstream/OB1/schemas/agent-memory/schema.sql`
- `.upstream/OB1/integrations/agent-memory-api/index.ts`
- `.upstream/OB1/integrations/agent-memory-api/README.md`
- `.upstream/OB1/dashboards/open-brain-dashboard-next/lib/agent-memory.ts`

Keep/adapt:

- Agent memory sidecar table pattern: governed memory records plus source refs, artifacts, relations, review actions, recall traces, recall items, and audit events.
- Instruction-grade safety invariant: generated agent memory must not silently become binding instruction.
- Runtime-neutral API shape: recall, writeback, usage report, review, list, inspect, trace.
- Unsafe writeback blocking: secrets, raw transcript-like payloads, large code blocks, and credential-like strings should be rejected before durable storage.
- Recall trace discipline: returned memories should be traceable, and agents should report which records were used or ignored.
- Dashboard client split: UI calls a server/API layer and does not directly own memory policy.

Rewrite for Recallant:

- OB1 keeps `thoughts` as a base table and uses sidecars. Recallant needs its own L0 events, L1 chunks/embeddings, L2 edges, L3 governed memories, checkpoints, sessions, settings, raw artifacts, model calls, and erasure receipts.
- OB1's Supabase Edge Function/OpenRouter defaults are useful references but not Recallant's runtime. Recallant is TypeScript/Node core with local-first model routing and Postgres/pgvector.
- OB1 uses workspace/project visibility fields; Recallant must use ADR-0040 scope/audience plus project/developer/session settings.

Implementation impact:

- Phase 1 should model OB1-style governed-memory sidecars, but in Recallant-owned migrations.
- Phase 2/6 MCP schemas should include OB1's recall/writeback/review/trace concepts, but exposed through Recallant tool names.
- Phase 6 tests should include unsafe writeback blocking and instruction-grade gating.

## MemPalace findings

Inspected:

- `.upstream/mempalace/mempalace/mcp_server.py`
- `.upstream/mempalace/mempalace/searcher.py`
- `.upstream/mempalace/mempalace/sweeper.py`
- `.upstream/mempalace/mempalace/knowledge_graph.py`
- `.upstream/mempalace/tests/test_hybrid_search.py`
- `.upstream/mempalace/tests/test_sweeper.py`
- `.upstream/mempalace/tests/test_mcp_stdio_protection.py`

Keep/adapt:

- MCP stdio protection is a real operational lesson: MCP servers must keep stdout clean for JSON-RPC and route diagnostics to stderr/log files.
- Message-level sweeper design is valuable for recovery: deterministic IDs, cursor by session/timestamp, idempotent re-run, and noise filtering.
- Hybrid retrieval invariant is important: lexical/direct hits must remain a floor; semantic/graph/closet expansion can boost, but must not hide exact evidence.
- Neighbor expansion around matched chunks is a useful context-quality pattern.
- Temporal KG add/query/invalidate/timeline is useful as prior art for later L2 graph/temporal facts.
- Tests cover operational regressions, not only happy paths; Recallant should copy this testing attitude.

Rewrite for Recallant:

- Do not use Chroma as source of truth or adopt palace/wing/room/drawer vocabulary.
- Do not expose a broad 20+ MCP tool surface in v1; Recallant's MCP surface is contract-driven.
- Do not import AAAK/compression as a required layer.
- MemPalace's verbatim "no caps" sweeper conflicts with Recallant's capture profiles; Recallant should preserve evidence according to policy, raw artifact pointers, excerpts, and caps.

Implementation impact:

- Phase 2/3 MCP implementation should include stdio/noise tests if stdio transport is supported.
- Phase 3 local spool/import should use deterministic dedup keys and resume-safe cursor behavior.
- Phase 5 retrieval tests should include the "semantic expansion can boost but not suppress lexical evidence" invariant.

## MF0-1984 findings

Inspected:

- `.upstream/MF0-1984/db/schema.sql`
- `.upstream/MF0-1984/db/migrations/003_context_engine.sql`
- `.upstream/MF0-1984/db/migrations/004_memory_graph.sql`
- `.upstream/MF0-1984/server/routes/llm.mjs`
- `.upstream/MF0-1984/src/contextEngine/buildModelContext.js`
- `.upstream/MF0-1984/src/contextEngine/fitContextToBudget.js`
- `.upstream/MF0-1984/server/services/contextPipeline.mjs`
- `.upstream/MF0-1984/server/services/attachmentStorage.mjs`

Keep/adapt:

- Thread/message mirror plus rolling summaries and extracted memory items map well to Recallant L0/L1/L3 separation.
- Context-pack builder layers are useful: core rules, rules digest, access/catalog metadata, compact memory, retrieved older context, recent messages, final user prompt.
- Budget fitting order is a useful design reference: shrink lower-priority retrieved blocks before core/rules/recent/final user.
- Server-side provider proxy pattern is important: browser clients must not receive provider API keys.
- Attachment extraction to files with DB references matches Recallant's raw artifact direction.
- Memory graph UI/workbench and graph hygiene routes are useful for Review UI and later workbench expansion.
- Cost/token analytics routes are relevant to Recallant's Cost / Paid API view.

Rewrite for Recallant:

- Do not copy MF0's SQLite schema or product-specific theme/dialog/mode model.
- Do not hard-code MF0's Intro/Access/Rules concepts into Recallant core.
- Do not place provider proxy routes in the browser-facing UI without Recallant auth, audit, paid API confirmation, and route policy.
- MF0 context building is chat-app oriented; Recallant context packs are project/session/checkpoint/governed-memory oriented and must be served by `memory_get_context_pack`.

Implementation impact:

- Phase 3 should support raw artifacts and large payload offload from the start.
- Phase 6 context-pack builder should use explicit priority layers and budget trimming.
- Phase 6.5 Review UI should borrow the compact workbench idea but focus on inbox/rules/detail/conflicts/settings/cost.
- Phase 4/6.5 model routing and Cost UI should keep provider keys server-side and expose only safe status/cost metadata.

## CaviraOSS/OpenMemory findings

Inspected:

- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/core/db.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/core/memory.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/memory/hsg.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/memory/decay.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/temporal_graph/store.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/src/ai/mcp_tools.ts`
- `.upstream/CaviraOSS-OpenMemory/packages/openmemory-js/tests/test_project_isolation.ts`

Keep/adapt:

- Project isolation test pattern: project-scoped search should see its own memory plus allowed global memory, but not unrelated projects.
- Salience, decay, reinforcement, last-seen/access, and waypoint ideas are useful for later scoring and cleanup.
- Temporal fact validity windows and invalidation map to future graph/temporal memory behavior.
- Provider/model configuration by purpose is useful as a model-routing reference.
- MCP tool registry using Zod-to-JSON-Schema is a useful TypeScript implementation pattern.

Rewrite for Recallant:

- Do not adopt cognitive sectors as Recallant's v1 schema. Coding-agent types such as decision, constraint, lesson, failure, artifact_reference, open_question, work_log are a better fit.
- Do not use synthetic embeddings except for tests.
- Do not copy OpenMemory's database bootstrap style into Recallant migrations; Recallant needs versioned SQL migrations and explicit schema gates.
- Current rewrite warning in OpenMemory docs means it should remain optional prior art, not a core dependency.

Implementation impact:

- Phase 5 and Phase 9 should include project isolation, global memory, decay, reinforcement, and access tracking tests.
- Phase 6 graph/temporal features can borrow validity-window semantics without importing taxonomy.

## Cross-upstream risks to avoid

- Copying a schema that does not represent Recallant's raw evidence plus governed memory split.
- Treating generated memory as binding instruction without explicit review/user/import path.
- Exposing provider secrets or database URLs to browser clients.
- Letting semantic retrieval hide rare lexical evidence.
- Dumping raw transcript/tool output into agent startup context.
- Building a broad raw-memory browser instead of the required compact Review Inbox / Command Center.
- Depending on hosted services or external paid APIs for core append/search.
- Failing MCP clients by writing logs or dependency noise to stdout.

## Decisions before Phase 0

- Proceed with a fresh TypeScript monorepo skeleton rather than adopting any upstream repository as the base tree.
- Keep `.upstream/` as ignored local research material.
- Start Phase 0 with package boundaries from `AGENT_IMPLEMENTATION_GUIDE.md`.
- In Phase 1, design migrations from Recallant `DATA_MODEL.md` while using OB1/MF0/MemPalace/OpenMemory as references for table responsibilities and tests.
- Add tests from the beginning for the upstream-derived invariants: instruction-grade gating, unsafe writeback rejection, project isolation, retrieval floor, deterministic dedup, and bounded context.

