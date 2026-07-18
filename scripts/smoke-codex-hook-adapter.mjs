import assert from "node:assert/strict";

import {
  codexHookEventNames,
  deterministicCodexHookUuid,
  mapCodexHookEvent,
  parseCodexHookPayload
} from "../packages/adapters/dist/index.js";

const common = {
  session_id: "codex-session-123",
  cwd: "/tmp/example-project",
  model: "gpt-5",
  turn_id: "turn-42",
  transcript_path: "/private/transcript-with-secret.jsonl",
  transcript: "must never cross the adapter"
};

const fixtures = {
  SessionStart: { ...common, hook_event_name: "SessionStart", source: "startup" },
  UserPromptSubmit: {
    ...common,
    hook_event_name: "UserPromptSubmit",
    prompt: "Please inspect this safely."
  },
  PreToolUse: {
    ...common,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-7",
    tool_input: { command: "npm test", password: "do-not-store" }
  },
  PostToolUse: {
    ...common,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-7",
    tool_input: { command: "npm test", api_key: "do-not-store" },
    tool_response: { exit_code: 0, output: "ok" }
  },
  PreCompact: { ...common, hook_event_name: "PreCompact", trigger: "auto" },
  PostCompact: { ...common, hook_event_name: "PostCompact", trigger: "auto" },
  SubagentStart: {
    ...common,
    hook_event_name: "SubagentStart",
    agent_id: "agent-9",
    agent_type: "explorer"
  },
  SubagentStop: {
    ...common,
    hook_event_name: "SubagentStop",
    agent_id: "agent-9",
    agent_type: "explorer",
    last_assistant_message: "Subagent result"
  },
  Stop: {
    ...common,
    hook_event_name: "Stop",
    last_assistant_message: "Assistant result"
  }
};

const expectedKinds = {
  SessionStart: ["system"],
  UserPromptSubmit: ["user_prompt"],
  PreToolUse: ["tool_call"],
  PostToolUse: ["tool_result"],
  PreCompact: ["system", "checkpoint"],
  PostCompact: ["system"],
  SubagentStart: ["system"],
  SubagentStop: ["assistant_response"],
  Stop: ["assistant_response"]
};

for (const eventName of codexHookEventNames) {
  const parsed = parseCodexHookPayload(JSON.stringify(fixtures[eventName]));
  assert.equal(parsed.ok, true, `${eventName} should parse`);
  if (!parsed.ok) continue;
  const actions = mapCodexHookEvent(parsed.event);
  assert.deepEqual(
    actions.map((action) => (action.type === "observation" ? action.kind : action.type)),
    expectedKinds[eventName],
    `${eventName} mapping`
  );
  const serialized = JSON.stringify({ parsed: parsed.event, actions });
  assert.equal(serialized.includes("transcript-with-secret"), false);
  assert.equal(serialized.includes("must never cross the adapter"), false);
}

const toolCall = parseCodexHookPayload(JSON.stringify(fixtures.PreToolUse));
assert.equal(toolCall.ok, true);
if (toolCall.ok) {
  const serialized = JSON.stringify(mapCodexHookEvent(toolCall.event));
  assert.equal(serialized.includes("do-not-store"), false);
  assert.equal(serialized.includes("[REDACTED]"), true);
}

const failedTool = parseCodexHookPayload({
  ...fixtures.PostToolUse,
  tool_response: { exit_code: 17, output: "Bearer top-secret-value" }
});
assert.equal(failedTool.ok, true);
if (failedTool.ok) {
  const actions = mapCodexHookEvent(failedTool.event);
  assert.deepEqual(
    actions.map((action) => (action.type === "observation" ? action.kind : action.type)),
    ["tool_result", "error"]
  );
  assert.equal(actions[0]?.type, "observation");
  if (actions[0]?.type === "observation") {
    assert.equal(actions[0].status, "error");
    assert.equal(actions[0].error_code, "CODEX_TOOL_EXIT_17");
  }
  assert.equal(JSON.stringify(actions).includes("top-secret-value"), false);
}

const logicalFailure = parseCodexHookPayload({
  ...fixtures.PostToolUse,
  tool_response: { ok: false, message: "tool declined the operation" }
});
assert.equal(logicalFailure.ok, true);
if (logicalFailure.ok) {
  const actions = mapCodexHookEvent(logicalFailure.event);
  assert.equal(actions[0]?.type, "observation");
  if (actions[0]?.type === "observation") assert.equal(actions[0].status, "error");
}

const stop = parseCodexHookPayload(JSON.stringify(fixtures.Stop));
assert.equal(stop.ok, true);
if (stop.ok) {
  const actions = mapCodexHookEvent(stop.event);
  assert.equal(actions.some((action) => action.type === "checkpoint"), false);
  assert.equal(
    actions.some((action) => action.type === "observation" && action.kind === "closeout"),
    false
  );
}

const firstId = deterministicCodexHookUuid("session", "turn", "tool");
assert.equal(firstId, deterministicCodexHookUuid("session", "turn", "tool"));
assert.notEqual(firstId, deterministicCodexHookUuid("session", "turn", "other-tool"));
assert.match(firstId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

assert.deepEqual(parseCodexHookPayload("{"), {
  ok: false,
  code: "invalid_json",
  message: "Codex hook payload is not valid JSON."
});
assert.equal(
  parseCodexHookPayload({ ...common, hook_event_name: "PermissionRequest" }).ok,
  false
);
assert.equal(
  parseCodexHookPayload({
    ...common,
    hook_event_name: "UserPromptSubmit",
    prompt: "x".repeat(2_000_000)
  }).ok,
  true
);
const bounded = parseCodexHookPayload({
  ...common,
  hook_event_name: "UserPromptSubmit",
  prompt: "x".repeat(2_000_000)
});
if (bounded.ok) {
  const body = mapCodexHookEvent(bounded.event)[0];
  assert.equal(body?.type, "observation");
  if (body?.type === "observation") {
    assert.ok((body.body?.length ?? 0) <= 12_012);
    assert.equal(body.body?.endsWith("[TRUNCATED]"), true);
  }
}

process.stdout.write(
  JSON.stringify(
    {
      status: "pass",
      events: codexHookEventNames,
      mappings: expectedKinds,
      transcript_parsing: false,
      deterministic_ids: "pass",
      redaction: "pass",
      bounds: "pass",
      stop_is_closeout: false
    },
    null,
    2
  ) + "\n"
);
