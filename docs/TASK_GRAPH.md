# Task graph (dependencies)

```mermaid
graph TD
  p0[Phase0_skeleton]
  p1[Phase1_DB_migrations]
  p2[Phase2_MCP_stub]
  p3[Phase3_session_lifecycle_L0_append]
  p4[Phase4_embeddings]
  p5[Phase5_hybrid_retrieval]
  p6[Phase6_governed_memory_graph_checkpoint]
  p65[Phase6_5_review_ui]
  p7[Phase7_codex_first_project_onboarding_context_lint]
  p8[Phase8_hardening]
  p9[Phase9_cleanup_analysis]
  p0 --> p1
  p1 --> p2
  p2 --> p3
  p3 --> p4
  p4 --> p5
  p5 --> p6
  p6 --> p65
  p65 --> p7
  p7 --> p8
  p5 --> p9
  p8 --> p9
```

Критический путь: `0 → 1 → 2 → 3 → 4 → 5 → 6 → 6.5 → 7 → 8 → 9`. Все фазы обязательны для v1 core. Phase 3 включает universal session lifecycle, hybrid heartbeat, interruption recovery metadata, L0 append, and raw workflow evidence/artifact pointers. Phase 6 включает governed agent memory, graph и checkpoint; Phase 6.5 включает required Review UI; neither is an optional layer.

Phase 6 also includes the Context Pack Builder because it depends on checkpoint, governed memories, and retrieval budgets. Phase 8 includes hardening plus practical backup/restore verification. Phase 9 зависит от Phase 5 (retrieval pipeline для decay) и Phase 8 (hardening завершён).

Future expansion work from [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md) is intentionally outside this critical path.
