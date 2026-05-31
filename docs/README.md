# Recallant Documentation Pack

This directory is the **single source of implementation specification** for Recallant: a long-term governed-memory platform for AI agents such as Codex, Cursor, Windsurf, Claude Code, and compatible MCP clients. The expected implementers are **AI coding agents** following these documents.

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## User Quickstart

→ [QUICKSTART.md](QUICKSTART.md) describes how to connect a project and start using Recallant.

Current operator note: Pre-Pilot Readiness, the first copied-project pilot, first autonomous
attach/detach slices, first controlled cross-project recall slice, one-command owner-server CLI
install/attach UX, and AI-backed Management UI/chat with deterministic safety gates have first
slices. The main product loop is not complete until the agent capture acceptance test passes:
attached projects must start Recallant-backed sessions, read context, write decisions/actions/tests/
checkpoints, and recall that memory in a later session without the owner acting as QA.

## Required Reading Order For Implementers

1. [WORKING_CONTEXT.md](WORKING_CONTEXT.md) — current conversation decisions and product direction.
2. [PRODUCT_ACCEPTANCE_TEST.md](PRODUCT_ACCEPTANCE_TEST.md) — non-negotiable end-to-end product gate.
3. [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md) — completed launch-readiness plan and copied-project pilot record.
4. [AUTONOMOUS_ATTACH.md](AUTONOMOUS_ATTACH.md) — target project attach workflow with manual, guided, and autopilot modes.
5. [CROSS_PROJECT_RECALL.md](CROSS_PROJECT_RECALL.md) — controlled cross-project reuse without automatic memory mixing.
6. [PHASE10_OWNER_DECISIONS_2026-05-28.md](PHASE10_OWNER_DECISIONS_2026-05-28.md) — owner-confirmed detailed Phase 10 decisions before implementation.
7. [PILOT_SANDBOX_WORKFLOW.md](PILOT_SANDBOX_WORKFLOW.md) — copied-project pilot workflow and report template.
8. [SESSION_HANDOFF_CURRENT.md](SESSION_HANDOFF_CURRENT.md) — current resume point for the next session.
9. [PAIN_POINTS_2026-05-19.md](PAIN_POINTS_2026-05-19.md) — owner pain points and requirements extracted from discussion.
10. [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) — product/engineering principles, managed memory, natural-language control, server safety.
11. [PRD.md](PRD.md) — goals, scope, and success criteria.
12. [NON_GOALS.md](NON_GOALS.md) — explicit non-goals.
13. [GLOSSARY.md](GLOSSARY.md) — terms and stable identifiers.
14. [ARCHITECTURE.md](ARCHITECTURE.md) — components and data flows.
15. [DEPLOYMENT_TOPOLOGY.md](DEPLOYMENT_TOPOLOGY.md) — Recallant server topology on Linux/Tailscale/private networks.
16. [SETTINGS.md](SETTINGS.md) — server/developer/project/session/client settings architecture.
17. [RUNTIME_STACK.md](RUNTIME_STACK.md) — TypeScript/Python tradeoffs and controlled hybrid runtime.
18. [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md) — Postgres/domain/schema boundaries and future splits.
19. [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — practical backup/restore policy and restore verification.
20. [MODEL_ROUTING.md](MODEL_ROUTING.md) — local and cloud models, routing, fallback.
21. [DATA_MODEL.md](DATA_MODEL.md) — canonical database schema.
22. [INGESTION.md](INGESTION.md) — how events enter the system.
23. [IMPORT_POLICY.md](IMPORT_POLICY.md) — explicit imports and future connectors.
24. [RETRIEVAL.md](RETRIEVAL.md) — agent search and response bounds.
25. [MEMORY_GOVERNANCE.md](MEMORY_GOVERNANCE.md) — automatic memory creation, review, and instruction-grade policy.
26. [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md) — inbox/rules/review workflow, duplicates, conflicts, rule hygiene, erasure.
27. [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md) — how Recallant avoids filling model context with unnecessary files.
28. [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md) — full closeout and natural-language intent recognition.
29. [MCP_SPEC.md](MCP_SPEC.md) — MCP tool contract.
30. [SECURITY.md](SECURITY.md) — threats and safety rules.
31. [OBSERVABILITY.md](OBSERVABILITY.md) — logs and metrics.
32. [UPSTREAM_INTEGRATION.md](UPSTREAM_INTEGRATION.md) — OB1 as preferred foundation and upstream borrowing rules.
33. [REPO_CONTRACT.md](REPO_CONTRACT.md) — `AGENTS.md` / `PROJECT_LOG.md`, MCP client config, and session flow.
34. [AGENT_ONBOARDING_CONTRACT.md](AGENT_ONBOARDING_CONTRACT.md) — exact Recallant startup, capture, checkpoint, closeout, and file ownership contract.
35. [QUICKSTART.md](QUICKSTART.md) — user journey: `recallant init`/future `attach`, client connection, cross-project search.
36. [CLEANUP.md](CLEANUP.md) — score decay, archiving, self-cleaning, `recallant analyze`, `recallant cleanup`.
37. [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) — implementation phases.
38. [TASK_GRAPH.md](TASK_GRAPH.md) — task dependencies.
39. [TEST_CONTRACT.md](TEST_CONTRACT.md) — required tests.

## ADR (Architecture Decision Records)

- [ADR-0001-postgres-as-sot.md](ADR-0001-postgres-as-sot.md)
- [ADR-0002-mcp-primary-interface.md](ADR-0002-mcp-primary-interface.md)
- [ADR-0003-embedding-provider.md](ADR-0003-embedding-provider.md)
- [ADR-0004-ob1-as-preferred-foundation.md](ADR-0004-ob1-as-preferred-foundation.md)
- [ADR-0005-governed-agent-memory-in-v1.md](ADR-0005-governed-agent-memory-in-v1.md)
- [ADR-0006-codex-first-multi-client-ready.md](ADR-0006-codex-first-multi-client-ready.md)
- [ADR-0007-local-server-and-personal-memory-expansion.md](ADR-0007-local-server-and-personal-memory-expansion.md)
- [ADR-0008-journey-as-workflow-packaging-layer.md](ADR-0008-journey-as-workflow-packaging-layer.md)
- [ADR-0009-documentation-first-before-implementation.md](ADR-0009-documentation-first-before-implementation.md)
- [ADR-0010-controlled-hybrid-runtime.md](ADR-0010-controlled-hybrid-runtime.md)
- [ADR-0011-postgres-instance-domain-databases.md](ADR-0011-postgres-instance-domain-databases.md)
- [ADR-0012-local-first-model-router.md](ADR-0012-local-first-model-router.md)
- [ADR-0013-closeout-intent-and-explicit-imports.md](ADR-0013-closeout-intent-and-explicit-imports.md)
- [ADR-0014-configurable-context-budget-policy.md](ADR-0014-configurable-context-budget-policy.md)
- [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md)
- [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md)
- [ADR-0017-managed-hybrid-capture.md](ADR-0017-managed-hybrid-capture.md)
- [ADR-0018-ob1-mf0-synthesis.md](ADR-0018-ob1-mf0-synthesis.md)
- [ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md](ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md)
- [ADR-0020-review-ui-on-recallant-server-management-platform-path.md](ADR-0020-review-ui-on-recallant-server-management-platform-path.md)
- [ADR-0021-review-ui-first-screen.md](ADR-0021-review-ui-first-screen.md)
- [ADR-0022-centralized-settings-on-recallant-server.md](ADR-0022-centralized-settings-on-recallant-server.md)
- [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md)
- [ADR-0024-automatic-startup-context-pack-builder.md](ADR-0024-automatic-startup-context-pack-builder.md)
- [ADR-0025-v1-core-and-expansion-boundary.md](ADR-0025-v1-core-and-expansion-boundary.md)
- [ADR-0026-review-inbox-policy-important-conflicting-long-term.md](ADR-0026-review-inbox-policy-important-conflicting-long-term.md)
- [ADR-0027-raw-workflow-evidence-foundation.md](ADR-0027-raw-workflow-evidence-foundation.md)
- [ADR-0028-practical-backup-restore-policy.md](ADR-0028-practical-backup-restore-policy.md)
- [ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md](ADR-0029-private-by-default-access-and-cloudflare-ready-auth.md)
- [ADR-0030-hybrid-session-heartbeat.md](ADR-0030-hybrid-session-heartbeat.md)
- [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md)
- [ADR-0032-paid-api-confirmation-and-cost-dashboard.md](ADR-0032-paid-api-confirmation-and-cost-dashboard.md)
- [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md)
- [ADR-0034-controlled-settings-ui-in-v1.md](ADR-0034-controlled-settings-ui-in-v1.md)
- [ADR-0035-conservative-retention-and-cleanup.md](ADR-0035-conservative-retention-and-cleanup.md)
- [ADR-0036-governed-memory-lifecycle-statuses.md](ADR-0036-governed-memory-lifecycle-statuses.md)
- [ADR-0037-import-workflow-and-memory-scope-archive.md](ADR-0037-import-workflow-and-memory-scope-archive.md)
- [ADR-0038-environment-discovery-and-portable-instance.md](ADR-0038-environment-discovery-and-portable-instance.md)
- [ADR-0039-v1-import-workflow.md](ADR-0039-v1-import-workflow.md)
- [ADR-0040-memory-scope-and-audience-model.md](ADR-0040-memory-scope-and-audience-model.md)
- [ADR-0041-conflict-resolution-priority.md](ADR-0041-conflict-resolution-priority.md)
- [ADR-0042-managed-ai-native-platform-and-operations.md](ADR-0042-managed-ai-native-platform-and-operations.md)
- [ADR-0043-autonomous-project-attach-modes.md](ADR-0043-autonomous-project-attach-modes.md)
- [ADR-0044-controlled-cross-project-recall.md](ADR-0044-controlled-cross-project-recall.md)

## Upstream research snapshots

- [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md) — current working snapshot of Open Brain / OB1, MemPalace, MF0-1984, OpenMemory, Journey, and the owner-authored `agent-bootstrap` sketch before the architecture rebuild.

Raw research dumps and old chat-derived notes are kept under [archive/README.md](archive/README.md). They are evidence, not canonical reading material.

## Architecture review snapshots

- [DECISION_RIGIDITY_AUDIT_2026-05-20.md](DECISION_RIGIDITY_AUDIT_2026-05-20.md) — audit of accepted decisions for accidental over-rigidity and numeric heuristic hard-coding.
- [SESSION_HANDOFF_CURRENT.md](SESSION_HANDOFF_CURRENT.md) — current session resume point and active next work order.
- [archive/SESSION_HANDOFF_2026-05-21.md](archive/SESSION_HANDOFF_2026-05-21.md) — historical transfer handoff plus accepted Q9/Q12/Q13 updates.

## Duplication Rule

If information belongs to the database schema, it lives only in `DATA_MODEL.md`. Other documents link to it instead of copying table definitions.

## Phase Definition Of Done

Each phase in [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) is complete only when the matching checks in [TEST_CONTRACT.md](TEST_CONTRACT.md) pass.

## Product Definition Of Done

Recallant as a product is ready only when [PRODUCT_ACCEPTANCE_TEST.md](PRODUCT_ACCEPTANCE_TEST.md)
passes. Project registration, attach reports, UI visibility, or component smoke tests are not
sufficient without proven automatic agent capture and later recall.
