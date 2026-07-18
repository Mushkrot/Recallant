# Agent Observability

Recallant can record a bounded, project-scoped account of what an AI agent did during a run. The
goal is practical diagnosis: an owner should be able to see the request, the visible response,
meaningful tool activity, failures, retries, remediation, and verification without reading raw
technical logs or guessing whether evidence is missing.

This is separate from the system activity ledger. The system activity ledger explains what the
Recallant service did. Agent observations explain what a connected agent reported doing.

## What Recallant Records

An observation can represent:

- a visible user prompt or assistant response;
- a meaningful tool call or result, including terminal, file, test, commit, and deployment work;
- an error, retry, remediation step, or verification result;
- a session start, checkpoint, closeout, or other bounded lifecycle event;
- an optional short, user-visible rationale such as "Run the focused test before the full suite."

Recallant does not record hidden chain-of-thought. A rationale field is for a brief explanation that
is safe and useful to show the project owner, not private model reasoning.

Each observation has a correlation envelope: project, developer, session, run, turn, trace, and
optional parent observation. Session and run sequence numbers make gaps visible. Kind, status,
resolution state, attempt number, occurrence time, duration, client identity, and capture profile
make the replay understandable without exposing raw credentials or unrestricted payloads.

## Automatic Codex Capture

For a locally attached Codex project, the normal connection command installs the automatic adapter:

```bash
recallant connect codex --project-dir .
```

Recallant safely merges its command handlers into `.codex/hooks.json`, preserves unrelated hooks,
and backs up an existing file before changing it. The same command is idempotent. It never writes
global Codex configuration and it does not bypass Codex trust: open `/hooks`, review the Recallant
command hook, and trust it before expecting the first native invocation.

All installed handlers call one silent, fail-soft command: `recallant codex-hook`. Recallant maps
the native Codex events as follows:

| Codex event | Recallant evidence |
| --- | --- |
| `SessionStart` | session/system start |
| `UserPromptSubmit` | visible user prompt |
| `PreToolUse` | correlated tool call |
| `PostToolUse` | correlated tool result and an error fact when the result failed |
| `PreCompact` | system event plus durable checkpoint state |
| `PostCompact` | system event after compaction |
| `SubagentStart` | child run start |
| `SubagentStop` | child run response/stop |
| `Stop` | visible assistant response for that turn |

Codex `Stop` is turn-scoped, so the adapter never treats it as session closeout. Agents should still
use `memory_closeout` (or the advanced `recallant agent-closeout` fallback) when a session actually
ends.

Check the automatic adapter independently from memory-readiness proof:

```bash
recallant doctor --project-dir . --require-agent-audit --format json
```

`configured_unobserved` means the file is correct but Recallant has not received a native hook event.
After Codex invokes the trusted hook, the status becomes `observed_server` or
`observed_offline_spool`, and `capture_active` becomes `true`. Generated files alone are never
reported as active capture. Use `--no-local-hooks` only when an advanced setup intentionally wants
Codex MCP without automatic audit capture.

## Other Capture Paths

Connected agents can also use the MCP tool `memory_append_observation`. Local automation can use the
advanced CLI command:

```bash
recallant agent-observe \
  --project-dir /path/to/project \
  --kind tool_call \
  --tool-name test \
  --trace-id <trace-id> \
  --text "Run the focused agent observability smoke test"
```

Supported kinds include prompts, responses, tool calls and results, errors, retries, remediation,
verification, checkpoints, closeout, and lifecycle/system observations. Use the same trace id for a
tool call and result or for an error and its recovery chain. Use `--parent-observation-id` when the
client knows the exact preceding observation.

Recallant also installs a project-local helper hook kit for compatibility with clients and custom
integrations. Those scripts are fail-soft, use a short timeout, and fall back to the local Recallant
spool when the service is temporarily unavailable. Do not wire both a native Codex event and its
equivalent helper script, because that would report the same activity twice. For clients without a
native adapter, generated helper files alone are not proof that every activity is captured.

Existing `memory_append_event` and agent lifecycle calls remain compatible. When an event maps to
an observable agent action, Recallant derives an observation so older clients appear in the same
run-oriented view. This compatibility path does not invent missing prompts, results, or recovery
evidence.

## Use The Workbench

Open the selected project and choose **Activity**. The default **Runs** tab shows recent runs as a
compact list with status, client, last activity, and completeness. The other tabs answer focused
questions:

- **Replay** — what happened, in order, with technical fields collapsed by default;
- **Errors** — which failures repeat, which runs they affect, and whether recovery was verified;
- **Coverage** — which clients are reporting and which evidence is missing.

Select a run to keep the replay focused. Legacy memory recording history remains available under a
collapsed technical disclosure; it does not compete with the main agent timeline.

## Completeness Semantics

Recallant checks evidence rather than assuming that a connected client is complete. The Workbench
flags:

- missing run sequence numbers;
- a user prompt without a visible assistant response in the same turn;
- a tool call without a correlated tool result;
- an error without a resolved verification chain;
- unknown or inactive client adapters.

A run is **Complete** only when the captured evidence is internally consistent. **In progress**
means the session is still active. **Needs attention** means an unresolved failure is present.
**Incomplete** means evidence is missing even though no unresolved error was reported. A high score
describes the observations Recallant received; it cannot prove that an external client reported
every action it performed.

The native adapter intentionally ignores `transcript_path`: Codex documents the transcript format as
unstable, and reading it would expand the privacy boundary. Hook payload fields are allowlisted,
bounded, and secret-redacted. Native command hooks also cannot see Codex hosted-tool activity that
does not emit one of the events above, so Recallant does not claim exhaustive coverage of those
tools.

## Privacy, Retention, And Removal

The Workbench and its APIs use the same private/authenticated project boundary as the rest of
Recallant. Observation bodies and metadata are bounded and pass through secret redaction. Raw auth
headers, cookies, credentials, database URLs, provider keys, private environment values, and hidden
reasoning must never be recorded.

Agent observations default to 30 days of retention. Operators can set a positive number of days
with `RECALLANT_AGENT_OBSERVATION_RETENTION_DAYS`. Retention cleanup runs on project observation
writes; it is not a substitute for a scheduled backup or a project purge.

The Workbench read model is intentionally bounded: at most 5,000 recent project observations, 50
run summaries, and 2,000 replay rows for one selected run. Native production backups include the
`agent_observations` table and verify its restored content. Targeted confirmed forget operations
redact selected observation content while preserving a content-free envelope; confirmed project
purge removes the project's observations entirely.

## Verification

The focused product gates are:

```bash
npm run agent-observability:smoke
npm run codex-hook-adapter:smoke
npm run codex-hook-runtime:smoke
npm run connect:smoke
npm run review-ui:smoke
npm run review-ui:playwright
npm run project-sanitize:smoke
npm run phase8:smoke:backup
```

Together they cover correlation, ordering, deduplication, redaction, retention, error recovery,
completeness, targeted forget, project purge, native backup/restore, desktop behavior, mobile
behavior, and keyboard-accessible navigation.
