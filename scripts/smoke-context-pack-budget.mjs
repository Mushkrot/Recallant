import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { boundContextPack } from "@recallant/db";
import { createRecallantMcpServer } from "@recallant/mcp";

const projectId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const contextPackId = "33333333-3333-4333-8333-333333333333";
const syntheticText = "synthetic-context-pack-fixture-".repeat(240);
const rawSecret = "sk-context-pack-synthetic-secret";
const checkpointMarker = "PILOT-SAMPLE-PRODUCTION-9df85db2-e165-4a13-95ac-b99b2a650399";

function sourceRef(index) {
  return {
    source_kind: "project_source",
    source_id: `source-${index}`,
    quote: syntheticText,
    metadata: {
      source_path: syntheticText,
      nested: { detail: syntheticText },
      api_key: rawSecret
    }
  };
}

function memory(index) {
  return {
    memory_id: `memory-${index}`,
    memory_type: "work_log",
    title: `Synthetic memory ${index} ${syntheticText}`,
    body: syntheticText,
    status: "accepted",
    use_policy: "recall_allowed",
    scope: "project",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "all_agents", id: null }],
    confidence: 0.9,
    updated_at: "2026-08-11T00:00:00.000Z",
    source_refs: [sourceRef(index)],
    provenance: {
      source_count: 1,
      primary_source_kind: "project_source",
      primary_source_id: `source-${index}`,
      source_path: syntheticText,
      summary: syntheticText
    }
  };
}

function fixture() {
  return {
    context_pack_id: contextPackId,
    project_id: projectId,
    session_id: sessionId,
    profile: "compact",
    sections: {
      checkpoint: {
        payload: {
          current_status: `status ${syntheticText}`,
          current_focus: `focus ${syntheticText}`,
          next_step: `next ${syntheticText}`,
          open_questions: [syntheticText, syntheticText]
        },
        updated_at: "2026-08-11T00:00:00.000Z"
      },
      documentation_posture: {
        status: "needs_review",
        profile: "service_app",
        summary: syntheticText,
        missing_recommended_docs: [syntheticText, syntheticText],
        authority: {
          source: "project_settings",
          key: "documentation_posture",
          role: "startup_guidance",
          instruction_grade: false,
          notes: [syntheticText]
        },
        canon_context: {
          needed: true,
          reason: syntheticText,
          recommended_reference_kinds: [syntheticText]
        },
        capability_hints: [{ kind: syntheticText, status: "needed", guidance: syntheticText }]
      },
      canon_capability_context: {
        schema_version: 1,
        status: "ready",
        summary: syntheticText,
        environment_facts: [
          {
            key: syntheticText,
            label: syntheticText,
            value_summary: syntheticText,
            status: "review_required",
            provenance: {
              source_count: 1,
              primary_source_kind: "project_source",
              primary_source_id: "source-1",
              summary: syntheticText
            }
          }
        ],
        capability_references: [
          {
            id: "capability-1",
            label: syntheticText,
            kind: "storage",
            status: "ready",
            access: "reference_only",
            provenance: {
              source_count: 1,
              primary_source_kind: "project_source",
              primary_source_id: "source-1",
              summary: syntheticText
            }
          }
        ],
        secret_references: [],
        server_canon_links: [
          {
            kind: "security_baseline",
            label: syntheticText,
            status: "needed",
            reference: syntheticText
          }
        ]
      },
      recovery: Array.from({ length: 3 }, (_, index) => ({
        session_id: `recovery-${index}`,
        last_seen_at: "2026-08-11T00:00:00.000Z",
        status: syntheticText
      })),
      binding_rules: Array.from({ length: 8 }, (_, index) => ({
        ...memory(index),
        use_policy: "instruction_grade"
      })),
      working_memories: Array.from({ length: 8 }, (_, index) => memory(index + 10)),
      operational_bindings: [
        { label: syntheticText, metadata: { detail: syntheticText, token: rawSecret } }
      ],
      local_spool_status: { status: "unknown", detail: syntheticText },
      evidence_excerpts: Array.from({ length: 4 }, (_, index) => ({
        chunk_id: `chunk-${index}`,
        source_event_id: `event-${index}`,
        score: 0.9,
        path: syntheticText,
        why: syntheticText,
        occurred_at: "2026-08-11T00:00:00.000Z",
        provenance: {
          source_count: 1,
          primary_source_kind: "project_source",
          primary_source_id: `source-${index}`,
          summary: syntheticText
        },
        text_excerpt: syntheticText,
        excerpt: syntheticText,
        graph_trace: { detail: syntheticText }
      })),
      suggested_next_fetches: [{ query: syntheticText, reason: syntheticText }]
    },
    provenance: {
      source_kind: "project_context",
      source_id: projectId,
      scope: "project",
      authority: "startup_guidance",
      review_status: "review_required"
    },
    trace_id: "44444444-4444-4444-8444-444444444444",
    truncated: false,
    budget: { max_chars_total: 12_000 },
    audit: {
      durable: true,
      surface: "mcp",
      operation: "memory_get_context_pack",
      status: "recorded",
      activity_id: "55555555-5555-4555-8555-555555555555",
      trace_id: "66666666-6666-4666-8666-666666666666"
    }
  };
}

function focusedFixture() {
  const compactMemory = (memoryId, usePolicy, title) => ({
    memory_id: memoryId,
    memory_type: usePolicy === "instruction_grade" ? "procedure" : "decision",
    title: `${title} ${syntheticText}`,
    body: syntheticText,
    status: "accepted",
    use_policy: usePolicy,
    scope: "project",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "all_agents", id: null }],
    source_refs: [sourceRef(memoryId)],
    provenance: {
      source_count: 1,
      primary_source_kind: "project_source",
      primary_source_id: memoryId,
      summary: syntheticText
    }
  });
  return {
    context_pack_id: contextPackId,
    project_id: projectId,
    session_id: sessionId,
    profile: "compact",
    sections: {
      checkpoint: {
        payload: {
          current_status: "focused fixture status",
          current_focus: "focused fixture",
          next_step: `Start a new session and recall ${checkpointMarker}`,
          open_questions: []
        }
      },
      documentation_posture: {
        status: "needs_review",
        summary: syntheticText,
        authority: { key: "documentation_posture", instruction_grade: false }
      },
      canon_capability_context: {
        schema_version: 1,
        status: "ready",
        summary: syntheticText,
        environment_facts: [],
        capability_references: [],
        secret_references: [],
        server_canon_links: []
      },
      recovery: [{ session_id: "recovery-focused", status: "interrupted" }],
      binding_rules: [compactMemory("rule-focused", "instruction_grade", "Binding rule")],
      working_memories: [compactMemory("working-focused", "recall_allowed", "Working memory")],
      operational_bindings: [],
      local_spool_status: { status: "unknown" },
      evidence_excerpts: [
        {
          chunk_id: "chunk-focused",
          source_event_id: "event-focused",
          score: 0.9,
          text_excerpt: syntheticText,
          metadata: { token: rawSecret }
        }
      ],
      suggested_next_fetches: []
    },
    provenance: {
      source_kind: "project_context",
      source_id: projectId,
      scope: "project",
      authority: "startup_guidance"
    },
    trace_id: "44444444-4444-4444-8444-444444444444",
    truncated: false,
    budget: { max_chars_total: 12_000 },
    audit: {
      durable: true,
      surface: "mcp",
      operation: "memory_get_context_pack",
      status: "recorded",
      activity_id: "55555555-5555-4555-8555-555555555555",
      trace_id: "66666666-6666-4666-8666-666666666666"
    }
  };
}

for (const budget of [1_000, 4_000, 8_000, 12_000]) {
  const result = boundContextPack(fixture(), budget);
  const text = JSON.stringify(result, null, 2);
  assert(text.length <= budget, `budget exceeded at ${budget}: ${text.length}`);
  assert.equal(result.budget.max_chars_total, budget);
  assert.equal(result.budget.used_chars_estimate, text.length);
  assert.equal(result.context_pack_id, contextPackId);
  assert.equal(result.project_id, projectId);
  assert.equal(result.session_id, sessionId);
  assert.equal(result.sections.checkpoint.payload.current_focus.startsWith("focus"), true);
  assert.equal(result.sections.checkpoint.payload.next_step.startsWith("next"), true);
  assert.equal(result.provenance.source_kind, "project_context");
  assert.equal(result.provenance.source_id, projectId);
  assert.equal(JSON.stringify(result.sections).includes('"metadata"'), false);
  assert.equal(
    JSON.stringify(result).includes("synthetic-context-pack-fixture-".repeat(20)),
    false
  );
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
  if (budget === 1_000) assert(result.omissions?.items?.evidence_excerpts > 0);
  if (budget < 12_000) assert.equal(result.truncated, true);
}

const workingMemoryPriorityInput = fixture();
workingMemoryPriorityInput.sections.binding_rules = [];
workingMemoryPriorityInput.sections.working_memories =
  workingMemoryPriorityInput.sections.working_memories.slice(0, 3);
workingMemoryPriorityInput.sections.operational_bindings = [];
workingMemoryPriorityInput.sections.suggested_next_fetches = [];
const workingMemoryPriority = boundContextPack(workingMemoryPriorityInput, 12_000);
assert(
  String(workingMemoryPriority.sections.working_memories?.[0]?.body ?? "").startsWith(
    "synthetic-context-pack-fixture-"
  ),
  "aggregate compaction removed relevant working-memory bodies before optional canon metadata"
);

const small = boundContextPack(
  {
    context_pack_id: contextPackId,
    project_id: projectId,
    session_id: sessionId,
    sections: {
      checkpoint: {
        payload: {
          current_status: "ready",
          current_focus: "bounded pack",
          next_step: "continue",
          open_questions: []
        }
      }
    },
    budget: { max_chars_total: 12_000 }
  },
  12_000
);
assert.equal(small.truncated, false);
assert.equal(small.omissions, undefined);

const empty = boundContextPack(
  {
    context_pack_id: contextPackId,
    project_id: projectId,
    session_id: sessionId,
    sections: {
      checkpoint: {
        payload: {
          current_status: "ready",
          current_focus: "empty pack",
          next_step: "continue",
          open_questions: []
        }
      }
    },
    provenance: { source_kind: "project_context", source_id: projectId, scope: "project" },
    budget: { max_chars_total: 1_000 }
  },
  1_000
);
assert(empty.budget.used_chars_estimate <= 1_000);
assert.equal(empty.project_id, projectId);
assert.equal(empty.session_id, sessionId);

const evictionOrder = boundContextPack(
  {
    context_pack_id: contextPackId,
    project_id: projectId,
    session_id: sessionId,
    sections: {
      checkpoint: {
        payload: {
          current_status: "ready",
          current_focus: "preserve working memory before raw evidence",
          next_step: "verify eviction order",
          open_questions: []
        }
      },
      working_memories: [
        {
          memory_id: "working-eviction-order",
          title: "Current working memory",
          body: "working-detail-".repeat(28),
          use_policy: "recall_allowed",
          audience: [],
          source_refs: [],
          provenance: {}
        }
      ],
      evidence_excerpts: [
        {
          chunk_id: "raw-evidence-eviction-order",
          source_event_id: "event-eviction-order",
          text_excerpt: syntheticText,
          provenance: {}
        }
      ]
    },
    provenance: { source_kind: "project_context", source_id: projectId, scope: "project" },
    budget: { max_chars_total: 1_600 }
  },
  1_600
);
assert.equal(evictionOrder.sections.evidence_excerpts.length, 0);
assert.equal(evictionOrder.sections.working_memories[0].body, "working-detail-".repeat(28));
assert.equal(evictionOrder.omissions.items.evidence_excerpts, 1);

const focused = boundContextPack(focusedFixture(), 3_000);
const focusedText = JSON.stringify(focused, null, 2);
assert(focusedText.length <= 3_000, `focused fixture exceeded budget: ${focusedText.length}`);
assert.equal(focused.budget.used_chars_estimate, focusedText.length);
assert.equal(focused.sections.binding_rules?.[0]?.use_policy, "instruction_grade");
assert.deepEqual(focused.sections.binding_rules?.[0]?.audience, [
  { kind: "all_agents", id: null }
]);
assert.equal(focused.sections.working_memories?.[0]?.use_policy, "recall_allowed");
assert.equal(focused.sections.checkpoint?.payload?.next_step.includes(checkpointMarker), true);
assert.equal(focused.sections.evidence_excerpts?.length, 0);
assert.equal(focused.omissions?.items?.evidence_excerpts, 1);
assert.equal(focusedText.includes(rawSecret), false);

const boundaryInput = {
  context_pack_id: contextPackId,
  project_id: projectId,
  session_id: sessionId,
  sections: {
    checkpoint: {
      payload: {
        current_status: "boundary status",
        current_focus: "boundary focus",
        next_step: "boundary next",
        open_questions: []
      }
    }
  },
  provenance: { source_kind: "project_context", source_id: projectId, scope: "project" },
  budget: { max_chars_total: 12_000 }
};
const boundary = boundContextPack(boundaryInput, 12_000);
const exactBoundary = boundContextPack(boundaryInput, boundary.budget.used_chars_estimate);
assert(exactBoundary.budget.used_chars_estimate <= boundary.budget.used_chars_estimate);
assert.equal(exactBoundary.truncated, false);
const belowBoundary = boundContextPack(boundaryInput, boundary.budget.used_chars_estimate - 1);
assert(belowBoundary.budget.used_chars_estimate <= boundary.budget.used_chars_estimate - 1);

const originalDatabaseUrl = process.env.RECALLANT_DATABASE_URL;
delete process.env.RECALLANT_DATABASE_URL;
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({ name: "context-pack-budget-smoke", version: "0.0.0" });
const mcpServer = createRecallantMcpServer();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);
const mcpLengths = [];
try {
  for (const budget of [1_000, 4_000, 8_000, 12_000]) {
    const response = await mcpClient.callTool(
      {
        name: "memory_get_context_pack",
        arguments: {
          session_id: sessionId,
          project_id: projectId,
          task_hint: "MCP budget contract",
          max_chars_total: budget
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const text = response.content?.[0]?.text ?? "";
    const payload = JSON.parse(text);
    assert(text.length <= budget, `MCP budget exceeded at ${budget}: ${text.length}`);
    assert.equal(payload.budget.used_chars_estimate, text.length);
    assert.equal(payload.budget.max_chars_total, budget);
    assert.equal(payload.project_id, projectId);
    assert.equal(payload.session_id, sessionId);
    assert.equal(payload.audit?.status, "unavailable");
    mcpLengths.push(text.length);
  }
} finally {
  await mcpClient.close();
  await mcpServer.close();
  if (originalDatabaseUrl !== undefined) process.env.RECALLANT_DATABASE_URL = originalDatabaseUrl;
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      budgets: [1_000, 4_000, 8_000, 12_000],
      final_lengths: [1_000, 4_000, 8_000, 12_000].map(
        (budget) => boundContextPack(fixture(), budget).budget.used_chars_estimate
      ),
      mcp_lengths: mcpLengths
    },
    null,
    2
  )}\n`
);
