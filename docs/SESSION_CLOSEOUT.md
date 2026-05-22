# Session closeout

Manual session closeout is a high-value operation. The owner often works in long sessions and wants a near-complete durable state when explicitly closing or pausing.

Decision status: accepted. See [ADR-0013-closeout-intent-and-explicit-imports.md](ADR-0013-closeout-intent-and-explicit-imports.md).

Session lifecycle refinement: accepted. See [ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md](ADR-0019-universal-mcp-core-codex-adapter-session-recovery.md).

## 1. Trigger intent

Closeout should not depend on one rigid phrase. The agent should recognize closeout intent from context.

Examples include common Russian and English closeout/pause phrases, plus explicit commands such as `Exit`. The exact phrase list is configuration/test data, not a hard-coded product invariant.

Implementation should combine:

- simple phrase/rule matching for common triggers,
- context-aware interpretation of the current task,
- LLM intent classification when wording is ambiguous,
- confirmation only when the action is unclear, risky, or would trigger non-routine work.

Known trigger phrases should not require paid API. Ambiguous intent may use the local-first, subscription-first model router; paid API LLM use is escalation only for hard/quality-critical cases and only when policy allows it.

Closeout is not a broad import. It preserves the current session state. Historical docs, git history, exports, or external sources enter Recallant only through explicit import commands; see [IMPORT_POLICY.md](IMPORT_POLICY.md).

## 2. Full closeout steps

When closeout is triggered:

1. Ensure recent raw turns/events are appended or spooled.
2. Extract/update governed memories:
   - decisions,
   - constraints,
   - lessons,
   - failures,
   - procedures,
   - artifact references,
   - work log,
   - open questions.
3. Link important memory to files, commits, docs, URLs, or external refs.
4. Update checkpoint with current status, focus, next step, blockers, and open questions.
5. Update `PROJECT_LOG.md` with compact current state.
6. Sync local spool if server is reachable.
7. Leave clear unsynced state if server is unavailable.
8. Keep repo files lean; detailed narrative belongs in Recallant.

## 3. Normal incremental updates

During ordinary work, the agent may do lighter updates:

- append raw turn/event,
- create governed memory when important,
- update checkpoint after meaningful progress.

Full closeout is heavier and should run when the owner clearly ends or pauses the session.

## 4. User-facing closeout report policy

Normal closeout should be quiet by default. The owner should not receive a verbose report every time a session closes successfully.

Show a short report only when there is something that needs attention, for example:

- unsynced local spool,
- conflicts,
- candidate or needs-review memory items,
- failed writes,
- incomplete checkpoint or `PROJECT_LOG.md` update,
- low-confidence closeout extraction,
- server/model/provider errors.

If everything succeeds and there are no warnings, the agent may respond with a minimal confirmation in the user's language. The detailed closeout data remains in Recallant and can be inspected later through Review UI/CLI.

## 5. Abnormal interruption recovery

Closeout cannot be the only safety mechanism because a crashed or killed client cannot call tools after it exits.

Required recovery behavior:

- every new working session calls `memory_start_session`,
- active sessions track `last_seen_at`,
- ordinary session-scoped tools update `last_seen_at`,
- optional `memory_heartbeat` is available for long-running or idle tasks,
- ordinary work writes incremental evidence/checkpoints before final closeout,
- local spool stores writes when server capture is unavailable,
- the next session is told when the previous session did not close cleanly,
- recovery resumes from durable evidence and marks any gap plainly.

If the previous session is unclosed, the agent should not ask the owner to re-explain the project immediately. It should first inspect checkpoint, governed memories, last captured events, and spool state.

## 6. Heartbeat policy

Recallant uses hybrid heartbeat:

- normal memory tools refresh session liveness,
- `memory_heartbeat` exists for long-running commands, tests, imports, sync jobs, or idle periods,
- heartbeat does not create raw events, chunks, or governed memories,
- heartbeat status is small operational metadata for recovery/status UI,
- stale-session and timeout thresholds are configurable policy values.

See [ADR-0030-hybrid-session-heartbeat.md](ADR-0030-hybrid-session-heartbeat.md).

## 7. Open decisions

- Which closeout substeps may use active-agent/subscription-backed escalation by default versus paid API only when local confidence is low and policy allows it? See [MODEL_ROUTING.md](MODEL_ROUTING.md).
