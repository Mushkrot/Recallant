# Observability

## 1. Logs

Use structured JSON logs or equivalent with at least these fields:

- `timestamp`
- `level`
- `component`
- `request_id`
- `project_id`
- `session_id`
- `tool_name`
- `duration_ms`
- `status`
- `error_code`

Never log full turn text, raw artifact content, provider API keys, secret env values, or erased content at `info` level. Debug logs that include sensitive payloads require an explicit debug flag and should remain disabled by default.

## 2. Metrics

Minimum counters/histograms:

- `recallant_mcp_requests_total`
- `recallant_mcp_request_duration_ms`
- `recallant_db_query_duration_ms`
- `recallant_embedding_jobs_total`
- `recallant_embedding_duration_ms`
- `recallant_search_candidates_total`
- `recallant_search_truncated_total`
- `recallant_context_pack_truncated_total`
- `recallant_model_calls_total`
- `recallant_paid_api_approval_requests_total`
- `recallant_paid_api_cost_estimate_usd`
- `recallant_erasure_requests_total`
- `recallant_erasure_failures_total`

Implementation may use OpenTelemetry or another equivalent metrics stack.

## 3. Tracing

One trace per MCP/admin request is preferred. Useful spans:

- `db.query`
- `embed`
- `model_call`
- `graph_expand`
- `context_pack`
- `cleanup_analyze`
- `erasure_execute`

## 4. Recall traces

Recall traces are product-level observability, not just infrastructure logs. They show which chunks/governed memories were returned, used, ignored, or marked unsafe. See `DATA_MODEL.md` and `MCP_SPEC.md`.

## 5. Health checks

`recallant doctor` is the canonical diagnostic command. It should check at least:

- Postgres connection and migration version,
- pgvector extension,
- Recallant server reachability,
- configured Ollama/local-model endpoint reachability and expected model availability,
- paid API route enablement/approval mode,
- `.recallant/config` validity,
- local spool status,
- backup/restore verification status when configured,
- owner-server `/ai/PORTS.yaml` registration for planned service ports,
- relevant `/ai/SECURITY` baseline reminder for exposure/security changes.

If the Review UI/admin API is served over HTTP, `GET /health` should exist and expose only safe status data.

General metrics/observability dashboards are not v1 core. Exporting metrics to an existing owner stack is allowed by ADR. This does not exclude the required v1 management UI and paid API cost dashboard.
