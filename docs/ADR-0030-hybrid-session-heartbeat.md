# ADR-0030: Hybrid session heartbeat

## Status

Accepted

## Context

AMP must detect unclosed or interrupted agent sessions without relying only on manual closeout. The schema already has `sessions.last_seen_at`, updated by session-scoped tool calls.

The decision question was whether AMP needs a separate heartbeat tool or whether ordinary memory tool calls are enough.

The owner selected the hybrid option.

## Decision

AMP v1 uses **hybrid heartbeat**:

- all session-scoped tools update `sessions.last_seen_at`,
- an optional lightweight `memory_heartbeat` tool exists for long-running or idle work,
- heartbeat updates session liveness metadata only,
- heartbeat does **not** create L0 `events`,
- timeout/stale-session thresholds are configurable policy values, not hard-coded architecture constants.

## Intended use

Normal work:

- `memory_append_turn`,
- `memory_append_event`,
- `memory_search`,
- `memory_get_context_pack`,
- `memory_set_checkpoint`,
- `memory_closeout`,

all refresh `last_seen_at`.

Long-running work:

- test suite running for a long time,
- build/deploy waiting,
- agent doing a long local analysis,
- background import/sync operation,

may call:

```json
{
  "session_id": "uuid",
  "status": "running_tests",
  "note": "pytest still running",
  "metadata": {}
}
```

## Consequences

- AMP avoids noisy heartbeat events in the raw memory archive.
- Review/Management UI can show that a session is active or stale.
- Recovery is more accurate for long-running tasks.
- Clients that do not support heartbeat still work because ordinary tools update `last_seen_at`.
- Agents should use heartbeat only when a long task would otherwise leave AMP with stale session state.

## Non-decisions

- Exact heartbeat interval.
- Exact stale-session timeout.
- Whether future background workers use the same tool or an internal worker heartbeat table.
