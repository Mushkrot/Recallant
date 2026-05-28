# Task graph

This file defines implementation dependencies between phases from [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md).

```mermaid
flowchart TD
  P0[Phase 0 repo skeleton]
  P1[Phase 1 database and migrations]
  P2[Phase 2 MCP skeleton]
  P3[Phase 3 session lifecycle and L0 write path]
  P4[Phase 4 embeddings and L1]
  P5[Phase 5 hybrid retrieval]
  P6[Phase 6 governed memory, graph, checkpoint, context pack]
  P65[Phase 6.5 Review/Management UI]
  P7[Phase 7 onboarding CLI]
  P8[Phase 8 hardening and backup/restore]
  P9[Phase 9 cleanup, analysis, erasure]
  PPR[Pre-Pilot Readiness]

  P0 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P65 --> P7 --> P8 --> P9
  P9 --> PPR
```

Critical path: `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 6.5 -> 7 -> 8 -> 9`. All phases are required for the v1 core.

Phase 3 includes universal session lifecycle, hybrid heartbeat, interruption recovery metadata, L0 append, and raw workflow evidence/artifact pointers.

Phase 6 includes governed agent memory, graph, checkpoint, Context Pack Builder, conflict handling, and erasure policy path because these depend on checkpoint, governed memories, retrieval budgets, and data model support.

Phase 6.5 includes the required Review/Management UI: inbox, rules, detail, duplicates, conflicts, Cost / Paid API, Settings, cleanup/forget, and natural-language management chat.

Phase 8 includes security hardening plus practical backup/restore verification.

Phase 9 depends on Phase 5 for retrieval decay/scoring and Phase 8 for hardened destructive/erasure paths.

Pre-Pilot Readiness is the active launch-readiness plan after the deployed implementation slice. It prepares existing-project discovery, explicit import, Review UI import/action handling, sandbox pilot workflow, agent onboarding contract, and operational checks before any real working project is attached. See [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md).
