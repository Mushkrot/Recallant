# Recallant — documentation pack

Этот каталог — **единственный источник спецификации** для реализации Recallant: платформы долговременной governed memory для агентов (Codex, Cursor, Windsurf, Claude Code и совместимые MCP-клиенты). Предполагается, что код пишут **AI-агенты** по этим документам.

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## Быстрый старт для пользователя

→ [QUICKSTART.md](QUICKSTART.md) — как подключить новый проект и начать работу.

## Обязательный порядок чтения (для агента-реализатора)

1. [WORKING_CONTEXT.md](WORKING_CONTEXT.md) — текущие решения разговора и product direction, чтобы не терять контекст.
2. [PAIN_POINTS_2026-05-19.md](PAIN_POINTS_2026-05-19.md) — боли владельца и требования, извлечённые из обсуждения.
3. [PRD.md](PRD.md) — цели, scope, критерии успеха.
4. [NON_GOALS.md](NON_GOALS.md) — что не делаем.
5. [GLOSSARY.md](GLOSSARY.md) — термины и идентификаторы.
6. [ARCHITECTURE.md](ARCHITECTURE.md) — компоненты и потоки данных.
7. [DEPLOYMENT_TOPOLOGY.md](DEPLOYMENT_TOPOLOGY.md) — что такое Recallant server и как он живёт на Linux/Tailscale.
8. [SETTINGS.md](SETTINGS.md) — где живут настройки server/developer/project/session/client.
9. [RUNTIME_STACK.md](RUNTIME_STACK.md) — TypeScript/Python tradeoffs and controlled hybrid runtime.
10. [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md) — границы Postgres/domains/schemas/future splits.
11. [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — practical backup/restore policy and restore verification.
12. [MODEL_ROUTING.md](MODEL_ROUTING.md) — локальные и cloud модели, routing, fallback.
13. [DATA_MODEL.md](DATA_MODEL.md) — схема БД (SoT).
14. [INGESTION.md](INGESTION.md) — как попадают события в систему.
15. [IMPORT_POLICY.md](IMPORT_POLICY.md) — explicit imports и future connectors.
16. [RETRIEVAL.md](RETRIEVAL.md) — поиск и лимиты для агентов.
17. [MEMORY_GOVERNANCE.md](MEMORY_GOVERNANCE.md) — automatic memory creation, review, instruction-grade.
18. [MEMORY_MANAGEMENT.md](MEMORY_MANAGEMENT.md) — inbox/rules/review workflow, duplicates, conflicts, rule hygiene.
19. [CONTEXT_BUDGET.md](CONTEXT_BUDGET.md) — как не забивать окно контекста лишними файлами.
20. [SESSION_CLOSEOUT.md](SESSION_CLOSEOUT.md) — full closeout и распознавание intent.
21. [MCP_SPEC.md](MCP_SPEC.md) — контракт MCP tools.
22. [SECURITY.md](SECURITY.md) — угрозы и правила.
23. [OBSERVABILITY.md](OBSERVABILITY.md) — логи и метрики.
24. [UPSTREAM_INTEGRATION.md](UPSTREAM_INTEGRATION.md) — OB1 как preferred foundation и заимствования из upstream-проектов.
25. [REPO_CONTRACT.md](REPO_CONTRACT.md) — связь с `AGENTS.md` / `PROJECT_LOG.md`, MCP-конфиг клиентов, session flow.
26. [QUICKSTART.md](QUICKSTART.md) — пользовательский journey: `recallant init`, подключение клиента, cross-project поиск.
27. [CLEANUP.md](CLEANUP.md) — score decay, архивирование, `recallant analyze`, `recallant cleanup`.
28. [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) — фазы реализации.
29. [TASK_GRAPH.md](TASK_GRAPH.md) — зависимости задач.
30. [TEST_CONTRACT.md](TEST_CONTRACT.md) — обязательные тесты.

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

## Upstream research snapshots

- [UPSTREAM_RESEARCH_2026-05-19.md](UPSTREAM_RESEARCH_2026-05-19.md) — актуальный рабочий снимок Open Brain / OB1, MemPalace, MF0-1984, OpenMemory, Journey и owner-authored agent-bootstrap sketch перед пересборкой архитектуры.

Raw research dumps and old chat-derived notes are kept under [archive/README.md](archive/README.md). They are evidence, not canonical reading material.

## Architecture review snapshots

- [DECISION_RIGIDITY_AUDIT_2026-05-20.md](DECISION_RIGIDITY_AUDIT_2026-05-20.md) — audit of accepted decisions for accidental over-rigidity and numeric heuristic hard-coding.
- [SESSION_HANDOFF_2026-05-21.md](SESSION_HANDOFF_2026-05-21.md) — historical transfer handoff plus accepted Q9/Q12/Q13 updates.

## Правило дублирования

Если информация относится к схеме данных — она живёт только в `DATA_MODEL.md`. Остальные файлы ссылаются на него, а не копируют таблицы.

## Определение готовности фазы

Каждая фаза в [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) завершается только когда выполнены соответствующие пункты [TEST_CONTRACT.md](TEST_CONTRACT.md).
