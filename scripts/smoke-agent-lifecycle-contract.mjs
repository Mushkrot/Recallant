function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { buildAgentLifecycleCloseoutResult } = await import("../packages/contracts/dist/index.js");

const forbiddenFixtures = [
  ["RECALLANT", "DATABASE", "URL"].join("_"),
  ["postgres", "://", "secret"].join(""),
  ["provider", "token"].join(" "),
  ["raw", "artifact", "body"].join("_")
];

function baseProof() {
  return {
    event: {
      ok: true,
      event_written: true,
      event_id: "event-1"
    },
    checkpoint: {
      ok: true,
      checkpoint_updated: true,
      checkpoint_updated_at: "2026-06-30T00:00:00.000Z",
      checkpoint_state_only: true
    },
    memory: {
      ok: true,
      searchable_memory_created: true,
      memory_status: "accepted",
      memory_id: "memory-1",
      memory_type: "work_log"
    },
    recall: {
      ok: true,
      recall_verified: true,
      query: "agent lifecycle marker",
      marker_found: true,
      recalled_memory_ids: ["memory-1"],
      checked_at: "2026-06-30T00:00:01.000Z"
    },
    next_session_context: {
      ok: true,
      next_session_context_verified: true,
      session_id: "session-2",
      context_pack_id: "context-pack-1",
      marker_found: true,
      checked_at: "2026-06-30T00:00:02.000Z"
    }
  };
}

function build(overrides = {}) {
  return buildAgentLifecycleCloseoutResult({
    mode: "server",
    project_id: "project-1",
    session_id: "session-1",
    closeout_event_id: "event-1",
    proof: baseProof(),
    warnings: forbiddenFixtures,
    ...overrides
  });
}

function assertNoForbiddenStrings(result, label) {
  const text = JSON.stringify(result);
  for (const forbidden of forbiddenFixtures) {
    assert(!text.includes(forbidden), `${label} leaked forbidden fixture: ${forbidden}`);
  }
}

const positive = build();
assert(positive.next_agent_ready === true, "positive server proof did not become next-agent ready");
assert(positive.failure_reasons.length === 0, "positive proof unexpectedly had failure reasons");
assertNoForbiddenStrings(positive, "positive proof");

const negativeCases = [
  {
    name: "offline_spool",
    input: { mode: "offline_spool", session_id: "session-1", spool_sync_status: "unsynced" },
    reason: "server_unavailable_or_spooled"
  },
  {
    name: "missing_event",
    input: { proof: { ...baseProof(), event: { ok: false, event_written: false } } },
    reason: "event_write_failed"
  },
  {
    name: "missing_checkpoint",
    input: {
      proof: {
        ...baseProof(),
        checkpoint: { ok: false, checkpoint_updated: false, checkpoint_state_only: true }
      }
    },
    reason: "checkpoint_update_failed"
  },
  {
    name: "missing_searchable_memory",
    input: {
      proof: {
        ...baseProof(),
        memory: {
          ok: false,
          searchable_memory_created: false,
          memory_status: "missing"
        }
      }
    },
    reason: "memory_not_searchable"
  },
  {
    name: "missing_semantic_recall",
    input: { proof: { ...baseProof(), recall: { ok: false, recall_verified: false } } },
    reason: "recall_verification_failed"
  },
  {
    name: "missing_next_session_context",
    input: {
      proof: {
        ...baseProof(),
        next_session_context: { ok: false, next_session_context_verified: false }
      }
    },
    reason: "next_session_context_failed"
  },
  {
    name: "review_required_memory",
    input: {
      proof: {
        ...baseProof(),
        memory: {
          ok: true,
          searchable_memory_created: true,
          memory_status: "needs_review",
          memory_id: "memory-needs-review",
          needs_review_ids: ["memory-needs-review"]
        }
      }
    },
    reason: "review_required"
  }
];

for (const testCase of negativeCases) {
  const result = build(testCase.input);
  assert(result.next_agent_ready === false, `${testCase.name} returned next_agent_ready=true`);
  assert(
    result.failure_reasons.includes(testCase.reason),
    `${testCase.name} missing failure reason ${testCase.reason}: ${JSON.stringify(result)}`
  );
  assertNoForbiddenStrings(result, testCase.name);
}

process.stdout.write(
  JSON.stringify(
    {
      agent_lifecycle_contract_smoke: "passed",
      positive_cases: 1,
      negative_cases: negativeCases.length,
      forbidden_fixture_redaction: "passed"
    },
    null,
    2
  ) + "\n"
);
