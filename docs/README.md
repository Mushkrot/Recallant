# Recallant Documentation Pack

This directory is the **single source of implementation specification** for Recallant: a long-term governed external-memory platform for the owner and AI agents such as Codex, Cursor, Windsurf, Claude Code, and compatible MCP clients. The expected implementers are **AI coding agents** following these documents.

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## User Quickstart

→ [QUICKSTART.md](QUICKSTART.md) describes the ordinary first-user path: preview install, install,
attach a project, connect an agent, prove capture, open the Workbench, and safely detach a test
project.

→ [SELF_HOSTING.md](SELF_HOSTING.md) describes install profiles, rollback notes, verification, and
security defaults.

→ [OWNER_SERVER.md](OWNER_SERVER.md) records the current owner-server `/ai` production profile. It
is operational evidence, not the generic public quickstart.

→ [PUBLIC_READINESS.md](PUBLIC_READINESS.md) tracks Stage 7 packaging and public-readiness status.

→ [RELEASE.md](RELEASE.md) records the repository URL, version policy, and release-candidate gate.

Current operator note: Pre-Pilot Readiness, the first copied-project pilot, autonomous
attach/detach, controlled cross-project recall, one-command owner-server CLI install/attach UX,
AI-backed Management UI/chat with deterministic safety gates, detached local cleanup, installed CLI
onboarding, target-aware `codex`/`generic` MCP output, multi-client startup docs, and first Stage 7
public-packaging guardrails have implementation slices. The server installer now has side-effect
free dry-run owner-server and single-user profiles with smoke coverage, so outside testers can
preview install effects before anything is written or even before Docker is available. The Product
Acceptance agent-capture loop now passes for the first production-ready slice: attached projects
start Recallant-backed sessions, read context, write decisions/actions/tests/checkpoints, close out,
and recall that memory in a later session without the owner acting as QA. The PRD and TEST_CONTRACT
acceptance rows are now synchronized and green; remaining work should be treated as production
verification, deploy polish, and product improvement rather than stale spec-checkbox closure.

## Required Reading Order For Implementers

1. [WORKING_CONTEXT.md](WORKING_CONTEXT.md) — current conversation decisions and product direction.
2. [PRODUCT_ACCEPTANCE_TEST.md](PRODUCT_ACCEPTANCE_TEST.md) — non-negotiable end-to-end product gate.
3. [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md) — completed launch-readiness plan and copied-project pilot record.
4. [AUTONOMOUS_ATTACH.md](AUTONOMOUS_ATTACH.md) — target project attach workflow with manual, guided, and autopilot modes.
5. [CLIENT_SETUP.md](CLIENT_SETUP.md) — client-specific MCP startup paths for Codex, Cursor, Claude Code, Windsurf, and generic clients.
6. [CROSS_PROJECT_RECALL.md](CROSS_PROJECT_RECALL.md) — controlled cross-project reuse without automatic memory mixing.
7. [PHASE10_OWNER_DECISIONS_2026-05-28.md](PHASE10_OWNER_DECISIONS_2026-05-28.md) — owner-confirmed detailed Phase 10 decisions before implementation.
8. [PILOT_SANDBOX_WORKFLOW.md](PILOT_SANDBOX_WORKFLOW.md) — copied-project pilot workflow and report template.
9. [SESSION_HANDOFF_CURRENT.md](SESSION_HANDOFF_CURRENT.md) — current resume point for the next session.
10. [PAIN_POINTS_2026-05-19.md](PAIN_POINTS_2026-05-19.md) — owner pain points and requirements extracted from discussion.
11. [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) — product/engineering principles, managed memory, natural-language control, server safety.
12. [HUMAN_MEMORY_AND_UI_DIRECTION.md](HUMAN_MEMORY_AND_UI_DIRECTION.md) — human-centered product framing, plain-language UI direction, and upstream UI lessons.
13. [DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md](DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md) — current documentation reconciliation and stale-status audit.
14. [DEVELOPMENT_PLAN_2026-06-01.md](DEVELOPMENT_PLAN_2026-06-01.md) — next development plan after the first green acceptance surface.
15. [PUBLIC_READINESS.md](PUBLIC_READINESS.md) — Stage 7 packaging/public-readiness status and smoke guardrail.
16. [RELEASE.md](RELEASE.md) — repository URL, version policy, and release-candidate gate.
17. [SELF_HOSTING.md](SELF_HOSTING.md) — install profiles, rollback, and self-hosted verification.
18. [OWNER_SERVER.md](OWNER_SERVER.md) — owner-server deployment profile and operational constraints.
19. [PRD.md](PRD.md) — goals, scope, and success criteria.
20. [NON_GOALS.md](NON_GOALS.md) — explicit non-goals.
21. [GLOSSARY.md](GLOSSARY.md) — terms and stable identifiers.
22. [ARCHITECTURE.md](ARCHITECTURE.md) — components and data flows.
23. [DEPLOYMENT_TOPOLOGY.md](DEPLOYMENT_TOPOLOGY.md) — Recallant server topology on Linux/Tailscale/private networks.
24. [SETTINGS.md](SETTINGS.md) — server/developer/project/session/client settings architecture.
25. [RUNTIME_STACK.md](RUNTIME_STACK.md) — TypeScript/Python tradeoffs and controlled hybrid runtime.
26. [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md) — Postgres/domain/schema boundaries and future splits.
27. [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — practical backup/restore policy and restore verification.
28. [MODEL_ROUTING.md](MODEL_ROUTING.md) — local and cloud models, routing, fallback.
29. [DATA_MODEL.md](DATA_MODEL.md) — canonical database schema.
30. [INGESTION.md](INGESTION.md) — how events enter the system.
31. [IMPORT_POLICY.md](IMPORT_POLICY.md) — explicit imports and future connectors.
32. [RETRIEVAL.md](RETRIEVAL.md) — agent search and response bounds.
33. [MEMORY_GOVERNANCE.md](MEMORY_GOVERNANCE.md) — automatic memory creation, review, and instruction-grade policy.
34. [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md) — inbox/rules/review workflow, duplicates, conflicts, rule hygiene, erasure.
35. [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md) — how Recallant avoids filling model context with unnecessary files.
36. [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md) — full closeout and natural-language intent recognition.
37. [MCP_SPEC.md](MCP_SPEC.md) — MCP tool contract.
38. [SECURITY.md](SECURITY.md) — threats and safety rules.
39. [OBSERVABILITY.md](OBSERVABILITY.md) — logs and metrics.
40. [UPSTREAM_INTEGRATION.md](UPSTREAM_INTEGRATION.md) — OB1 as preferred foundation and upstream borrowing rules.
41. [UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md](UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md) — supplemental AgentMemory reference review for client connect, hooks, skills, viewer/replay, and evals.
42. [REPO_CONTRACT.md](REPO_CONTRACT.md) — `AGENTS.md` / `PROJECT_LOG.md`, MCP client config, and session flow.
43. [AGENT_ONBOARDING_CONTRACT.md](AGENT_ONBOARDING_CONTRACT.md) — exact Recallant startup, capture, checkpoint, closeout, and file ownership contract.
44. [QUICKSTART.md](QUICKSTART.md) — user journey: install, attach, connect, prove capture, Workbench, Ask Recallant.
45. [CLEANUP.md](CLEANUP.md) — score decay, archiving, self-cleaning, `recallant analyze`, `recallant cleanup`.
46. [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) — implementation phases.
47. [TASK_GRAPH.md](TASK_GRAPH.md) — task dependencies.
48. [TEST_CONTRACT.md](TEST_CONTRACT.md) — required tests.

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
- [ADR-0045-human-centered-memory-and-workbench.md](ADR-0045-human-centered-memory-and-workbench.md)

## Upstream research snapshots

- [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md) — current working snapshot of Open Brain / OB1, MemPalace, MF0-1984, OpenMemory, Journey, and the owner-authored `agent-bootstrap` sketch before the architecture rebuild.
- [UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md](UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md) — supplemental review of `rohitg00/agentmemory` as a client-connect, hook-capture, skills, viewer/replay, and eval-harness reference.

## Current Alignment And Plan

- [DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md](DOCUMENTATION_ALIGNMENT_AUDIT_2026-06-01.md) — current audit of stale status wording versus actual implementation state.
- [DEVELOPMENT_PLAN_2026-06-01.md](DEVELOPMENT_PLAN_2026-06-01.md) — current forward plan: human workbench quality, AI-native management, source bindings, client connect/hooks, pilots, broader memory domains, and packaging.
- [PUBLIC_READINESS.md](PUBLIC_READINESS.md) — current Stage 7 packaging/readiness status.
- [RELEASE.md](RELEASE.md) — public repository URL, versioning, and release-candidate gate.

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
