# Observability

## 1. Logging

Структурированные JSON-логи (или эквивалент) с полями:

- `ts`, `level`, `tool`, `project_id`, `duration_ms`, `status`, `error_code`

**Запрещено** на `info`: полный текст turns.

## 2. Metrics (минимум)

Счётчики / histograms (реализация через OpenTelemetry optional):

- `amp_mcp_requests_total{tool,status}`
- `amp_mcp_latency_ms{tool}` (histogram)
- `amp_search_candidates_lexical`
- `amp_search_candidates_vector`
- `amp_search_truncated_total`
- `amp_agent_memory_recall_total{status,use_policy}`
- `amp_recall_usage_report_total`
- `amp_model_calls_total{route_class,provider,model,purpose,status}`
- `amp_model_call_latency_ms{route_class,provider,model,purpose}` (histogram)
- `amp_model_call_cost_usd{route_class,provider,model,purpose}` (counter or derived metric)
- `amp_model_subscription_limit_total{provider,status}` where subscription-backed routes expose limit state
- `amp_paid_api_approval_requests_total{provider,model,purpose,status}`
- `amp_session_heartbeat_total{client_kind,status}`
- `amp_session_stale_total{client_kind}`
- `amp_backup_jobs_total{target,status}`
- `amp_restore_verify_jobs_total{target,status}`

## 3. Recall traces

Every governed memory recall writes a `recall_traces` row with returned memory/chunk ids and later usage report fields when available. This is product behavior, not only debug logging: it lets us inspect whether agents relied on the right durable memories.

## 4. Runtime traces

- Один trace на MCP request; spans: `db.query`, `embed`, `model_call`, `graph_expand`.

Heartbeat calls should be visible as lightweight operational events/metrics, not as raw memory content.

## 4.1 Model call audit

Every AMP model/agent intelligence call writes a `model_calls` row with route class/provider/model/purpose/routing reason/cost or subscription-limit metadata/latency/status metadata. This includes local Ollama calls, active-agent routes, supported subscription-worker routes, and paid API calls. Full prompt/input/output text must not be written to ordinary logs or `model_calls` by default.

## 4.1.1 Paid API approvals and cost view

Every default-profile paid API call must have an approval record before execution. Approval records should include project, purpose, provider/model, estimated tokens/cost, route attempts already made, approval status, actor, and timestamps.

AMP v1 must expose a near-real-time cost dashboard in the management UI based on `model_calls`, approval records, and configured/provider cost metadata. Provider billing portals remain the billing source of truth; the AMP dashboard is the operational guardrail.

## 4.2 Backup and restore status

Backup/restore jobs should expose operational status without leaking memory contents:

- last backup timestamp/status,
- last restore verification timestamp/status,
- backup target label,
- included databases/artifact roots,
- counts/sizes/hashes,
- errors with raw content redacted.

## 5. Health

- `GET /health` should exist if the Review UI/admin API is served over HTTP; otherwise health через отдельную команду CLI `amp doctor` (фаза из implementation guide).

## 6. Dashboards

General metrics/observability dashboards не входят в v1 core; допускается экспорт метрик в существующий stack пользователя (ADR). This does not exclude the required v1 Review UI and required v1 paid API cost dashboard inside AMP management UI.
