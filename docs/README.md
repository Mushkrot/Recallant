# Recallant Documentation Pack

This directory is the **single source of implementation specification** for Recallant: a long-term governed-memory platform for AI agents such as Codex, Cursor, Windsurf, Claude Code, and compatible MCP clients. The expected implementers are **AI coding agents** following these documents.

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## User Quickstart

→ [QUICKSTART.md](QUICKSTART.md) describes how to connect a new project and start using Recallant.

## Required Reading Order For Implementers

1. [WORKING_CONTEXT.md](WORKING_CONTEXT.md) — current conversation decisions and product direction.
2. [PAIN_POINTS_2026-05-19.md](PAIN_POINTS_2026-05-19.md) — owner pain points and requirements extracted from discussion.
3. [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) — product/engineering principles, managed memory, natural-language control, server safety.
4. [PRD.md](PRD.md) — goals, scope, and success criteria.
5. [NON_GOALS.md](NON_GOALS.md) — explicit non-goals.
6. [GLOSSARY.md](GLOSSARY.md) — terms and stable identifiers.
7. [ARCHITECTURE.md](ARCHITECTURE.md) — components and data flows.
8. [DEPLOYMENT_TOPOLOGY.md](DEPLOYMENT_TOPOLOGY.md) — Recallant server topology on Linux/Tailscale/private networks.
9. [SETTINGS.md](SETTINGS.md) — server/developer/project/session/client settings architecture.
10. [RUNTIME_STACK.md](RUNTIME_STACK.md) — TypeScript/Python tradeoffs and controlled hybrid runtime.
11. [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md) — Postgres/domain/schema boundaries and future splits.
12. [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — practical backup/restore policy and restore verification.
13. [MODEL_ROUTING.md](MODEL_ROUTING.md) — local and cloud models, routing, fallback.
14. [DATA_MODEL.md](DATA_MODEL.md) — canonical database schema.
15. [INGESTION.md](INGESTION.md) — how events enter the system.
16. [IMPORT_POLICY.md](IMPORT_POLICY.md) — explicit imports and future connectors.
17. [RETRIEVAL.md](RETRIEVAL.md) — agent search and response bounds.
18. [MEMORY_GOVERNANCE.md](MEMORY_GOVERNANCE.md) — automatic memory creation, review, and instruction-grade policy.
19. [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md) — inbox/rules/review workflow, duplicates, conflicts, rule hygiene, erasure.
20. [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md) — how Recallant avoids filling model context with unnecessary files.
21. [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md) — full closeout and natural-language intent recognition.
22. [MCP_SPEC.md](MCP_SPEC.md) — MCP tool contract.
23. [SECURITY.md](SECURITY.md) — threats and safety rules.
24. [OBSERVABILITY.md](OBSERVABILITY.md) — logs and metrics.
25. [UPSTREAM_INTEGRATION.md](UPSTREAM_INTEGRATION.md) — OB1 as preferred foundation and upstream borrowing rules.
26. [REPO_CONTRACT.md](REPO_CONTRACT.md) — `AGENTS.md` / `PROJECT_LOG.md`, MCP client config, and session flow.
27. [QUICKSTART.md](QUICKSTART.md) — user journey: `recallant init`, client connection, cross-project search.
28. [CLEANUP.md](CLEANUP.md) — score decay, archiving, self-cleaning, `recallant analyze`, `recallant cleanup`.
29. [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) — implementation phases.
30. [TASK_GRAPH.md](TASK_GRAPH.md) — task dependencies.
31. [TEST_CONTRACT.md](TEST_CONTRACT.md) — required tests.

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

## Upstream research snapshots

- [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md) — current working snapshot of Open Brain / OB1, MemPalace, MF0-1984, OpenMemory, Journey, and the owner-authored `agent-bootstrap` sketch before the architecture rebuild.

Raw research dumps and old chat-derived notes are kept under [archive/README.md](archive/README.md). They are evidence, not canonical reading material.

## Architecture review snapshots

- [DECISION_RIGIDITY_AUDIT_2026-05-20.md](DECISION_RIGIDITY_AUDIT_2026-05-20.md) — audit of accepted decisions for accidental over-rigidity and numeric heuristic hard-coding.
- [SESSION_HANDOFF_2026-05-21.md](SESSION_HANDOFF_2026-05-21.md) — historical transfer handoff plus accepted Q9/Q12/Q13 updates.

## Duplication Rule

If information belongs to the database schema, it lives only in `DATA_MODEL.md`. Other documents link to it instead of copying table definitions.

## Phase Definition Of Done

Each phase in [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) is complete only when the matching checks in [TEST_CONTRACT.md](TEST_CONTRACT.md) pass.
