import assert from "node:assert/strict";

import {
  deriveAgentRecoveryChains,
  parseCodexOtelLogs
} from "../packages/core/dist/index.js";

const otlp = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "codex_cli_rs" } },
          { key: "authorization", value: { stringValue: "Bearer must-not-survive" } }
        ]
      },
      scopeLogs: [
        {
          scope: { attributes: [] },
          logRecords: [
            {
              timeUnixNano: "1784350000000000000",
              observedTimeUnixNano: "1784350001000000000",
              severityNumber: 9,
              traceId: "5B8EFFF798038103D269B633813FC60C",
              spanId: "EEE19B7EC3C1B174",
              body: { stringValue: "raw tool output must be discarded" },
              attributes: [
                { key: "event.name", value: { stringValue: "codex.tool_result" } },
                { key: "conversation.id", value: { stringValue: "conversation-1" } },
                { key: "call_id", value: { stringValue: "call-7" } },
                { key: "tool_name", value: { stringValue: "functions.exec" } },
                { key: "success", value: { boolValue: true } },
                { key: "duration_ms", value: { intValue: "42" } },
                { key: "output", value: { stringValue: "secret output" } },
                { key: "error.message", value: { stringValue: "private failure detail" } }
              ]
            },
            {
              attributes: [
                { key: "event.name", value: { stringValue: "unrelated.library.log" } }
              ]
            }
          ]
        }
      ]
    }
  ]
};

const parsed = parseCodexOtelLogs(JSON.stringify(otlp));
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error(parsed.message);
assert.equal(parsed.accepted_log_records, 1);
assert.equal(parsed.ignored_log_records, 1);
const event = parsed.events[0];
assert.equal(event.event_name, "codex.tool_result");
assert.equal(event.conversation_id, "conversation-1");
assert.equal(event.call_id, "call-7");
assert.equal(event.success, true);
assert.equal(event.duration_ms, 42);
assert.equal(event.content_discarded, true);
assert.equal(JSON.stringify(event).includes("secret output"), false);
assert.equal(JSON.stringify(event).includes("private failure detail"), false);
assert.equal(JSON.stringify(event).includes("must-not-survive"), false);
assert.equal(parseCodexOtelLogs("{" ).ok, false);
assert.equal(parseCodexOtelLogs({}).ok, false);
assert.equal(parseCodexOtelLogs("x".repeat(1_048_577)).ok, false);

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  developer: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  run: "44444444-4444-4444-8444-444444444444",
  trace1: "55555555-5555-4555-8555-555555555555",
  trace2: "66666666-6666-4666-8666-666666666666"
};

function observation(sequence, input) {
  return {
    id: input.id,
    project_id: ids.project,
    developer_id: ids.developer,
    session_id: ids.session,
    run_id: ids.run,
    turn_id: input.turn_id ?? "turn-1",
    trace_id: input.trace_id ?? ids.trace1,
    parent_observation_id: input.parent_observation_id ?? null,
    source_event_id: null,
    dedup_key: null,
    sequence_number: sequence,
    run_sequence_number: sequence,
    kind: input.kind,
    status: input.status ?? (input.kind === "error" ? "error" : "success"),
    occurred_at: new Date(`2026-07-18T06:00:0${sequence}.000Z`),
    duration_ms: null,
    title: input.title ?? input.kind,
    body: null,
    tool_name: input.tool_name ?? "npm test",
    error_code: input.error_code ?? (input.kind === "error" ? "TEST_FAILED" : null),
    error_fingerprint: input.error_fingerprint ?? "fingerprint-1",
    attempt_number: null,
    resolution_status: input.kind === "error" ? "unresolved" : "not_applicable",
    rationale: null,
    redacted_metadata: {},
    capture_profile: "standard",
    redacted: false,
    truncated: false,
    client_kind: "codex",
    client_version: "test",
    created_at: new Date(`2026-07-18T06:00:0${sequence}.000Z`)
  };
}

const error = observation(1, {
  id: "70000000-0000-4000-8000-000000000001",
  kind: "error"
});
const retry = observation(2, {
  id: "70000000-0000-4000-8000-000000000002",
  kind: "tool_call",
  trace_id: ids.trace2
});
const success = observation(3, {
  id: "70000000-0000-4000-8000-000000000003",
  kind: "tool_result",
  trace_id: ids.trace2
});
const prose = observation(4, {
  id: "70000000-0000-4000-8000-000000000004",
  kind: "assistant_response",
  title: "I believe I fixed it"
});
const regression = observation(5, {
  id: "70000000-0000-4000-8000-000000000005",
  kind: "error",
  trace_id: "77777777-7777-4777-8777-777777777777"
});

const chains = deriveAgentRecoveryChains([error, retry, success, prose, regression]);
assert.equal(chains.length, 2);
const verified = chains.find((chain) => chain.id === error.id);
const regressed = chains.find((chain) => chain.id === regression.id);
assert.equal(verified?.status, "verified");
assert.deepEqual(
  verified?.steps.map((step) => step.stage),
  ["error", "retry", "remediation", "verification"]
);
assert.equal(verified?.steps.some((step) => step.observation_id === prose.id), false);
assert.equal(regressed?.status, "regressed");
assert.equal(regressed?.previous_verified_chain_id, error.id);

process.stdout.write(
  JSON.stringify(
    {
      status: "pass",
      otlp_json: "pass",
      supported_event: event.event_name,
      content_discarded: event.content_discarded,
      ignored_records: parsed.ignored_log_records,
      recovery_status: verified?.status,
      recovery_steps: verified?.steps.map((step) => step.stage),
      regression_link: regressed?.previous_verified_chain_id,
      assistant_prose_used_for_correlation: false
    },
    null,
    2
  ) + "\n"
);
