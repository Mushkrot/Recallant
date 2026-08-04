import { createHash } from "node:crypto";

import type {
  AgentObservationKind,
  AgentObservationResolutionStatus,
  AgentObservationStatus
} from "@recallant/contracts";

export const codexHookEventNames = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop"
] as const;

export type CodexHookEventName = (typeof codexHookEventNames)[number];

const codexHookEventSet = new Set<string>(codexHookEventNames);
const maxPayloadBytes = 1_048_576;
const maxIdentifierLength = 256;
const maxBodyLength = 12_000;
const maxMetadataStringLength = 4_000;
const maxMetadataKeys = 50;
const maxMetadataArrayItems = 20;
const maxMetadataDepth = 5;
const redactedValue = "[REDACTED]";

const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|session[_-]?token|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const sensitiveTextPatterns: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi
];

type JsonObject = Record<string, unknown>;

type CodexHookCommon = {
  hook_event_name: CodexHookEventName;
  session_id: string;
  cwd: string | null;
  model: string | null;
  turn_id: string | null;
};

export type CodexSessionStartHook = CodexHookCommon & {
  hook_event_name: "SessionStart";
  source: string | null;
};

export type CodexUserPromptSubmitHook = CodexHookCommon & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
};

export type CodexPreToolUseHook = CodexHookCommon & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
};

export type CodexPostToolUseHook = CodexHookCommon & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response: unknown;
};

export type CodexCompactHook = CodexHookCommon & {
  hook_event_name: "PreCompact" | "PostCompact";
  trigger: string | null;
};

export type CodexSubagentStartHook = CodexHookCommon & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string | null;
};

export type CodexSubagentStopHook = CodexHookCommon & {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_type: string | null;
  last_assistant_message: string | null;
};

export type CodexStopHook = CodexHookCommon & {
  hook_event_name: "Stop";
  last_assistant_message: string | null;
};

export type CodexHookEvent =
  | CodexSessionStartHook
  | CodexUserPromptSubmitHook
  | CodexPreToolUseHook
  | CodexPostToolUseHook
  | CodexCompactHook
  | CodexSubagentStartHook
  | CodexSubagentStopHook
  | CodexStopHook;

export type CodexHookParseResult =
  | { ok: true; event: CodexHookEvent }
  | {
      ok: false;
      code: "payload_too_large" | "invalid_json" | "invalid_payload" | "unsupported_event";
      message: string;
    };

export type CodexHookMappedObservation = {
  type: "observation";
  event_name: CodexHookEventName;
  external_session_id: string;
  run_scope: "main" | "subagent";
  run_id: string | null;
  turn_id: string | null;
  trace_id: string;
  source_event_id: string;
  dedup_key: string;
  kind: AgentObservationKind;
  status: AgentObservationStatus;
  resolution_status: AgentObservationResolutionStatus;
  title: string;
  body: string | null;
  tool_name: string | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
};

export type CodexHookCheckpointAction = {
  type: "checkpoint";
  event_name: "PreCompact";
  external_session_id: string;
  turn_id: string | null;
  trace_id: string;
  dedup_key: string;
  summary: string;
  next_step: string;
};

export type CodexHookCaptureAction = CodexHookMappedObservation | CodexHookCheckpointAction;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = maxIdentifierLength): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maximum);
}

function requiredString(
  object: JsonObject,
  key: string,
  maximum = maxIdentifierLength
): string | null {
  return boundedString(object[key], maximum);
}

function redactText(value: string): string {
  let redacted = value;
  for (const pattern of sensitiveTextPatterns) {
    redacted = redacted.replace(pattern, redactedValue);
  }
  return redacted;
}

function boundedBody(value: string | null): string | null {
  if (value === null) return null;
  const redacted = redactText(value);
  return redacted.length <= maxBodyLength
    ? redacted
    : `${redacted.slice(0, maxBodyLength)}\n[TRUNCATED]`;
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth >= maxMetadataDepth) return "[DEPTH_LIMIT]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const redacted = redactText(value);
    return redacted.length <= maxMetadataStringLength
      ? redacted
      : `${redacted.slice(0, maxMetadataStringLength)}[TRUNCATED]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, maxMetadataArrayItems).map((item) => sanitizeUnknown(item, depth + 1));
  }
  if (!isObject(value)) return String(value).slice(0, maxMetadataStringLength);

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, maxMetadataKeys)) {
    output[key] = sensitiveKeyPattern.test(key)
      ? redactedValue
      : sanitizeUnknown(nested, depth + 1);
  }
  return output;
}

function sanitizedPreview(value: unknown): string | null {
  if (value === undefined) return null;
  const sanitized = sanitizeUnknown(value);
  const rendered = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  return boundedBody(rendered);
}

function commonFields(object: JsonObject, eventName: CodexHookEventName): CodexHookCommon | null {
  const sessionId = requiredString(object, "session_id");
  if (!sessionId) return null;
  return {
    hook_event_name: eventName,
    session_id: sessionId,
    cwd: boundedString(object.cwd, 4_096),
    model: boundedString(object.model),
    turn_id: boundedString(object.turn_id)
  };
}

export function parseCodexHookPayload(input: string | unknown): CodexHookParseResult {
  let value: unknown = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > maxPayloadBytes) {
      return {
        ok: false,
        code: "payload_too_large",
        message: `Codex hook payload exceeds ${maxPayloadBytes} bytes.`
      };
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, code: "invalid_json", message: "Codex hook payload is not valid JSON." };
    }
  }
  if (!isObject(value)) {
    return { ok: false, code: "invalid_payload", message: "Codex hook payload must be an object." };
  }

  const rawEventName = boundedString(value.hook_event_name);
  if (!rawEventName || !codexHookEventSet.has(rawEventName)) {
    return {
      ok: false,
      code: "unsupported_event",
      message: rawEventName
        ? `Unsupported Codex hook event: ${rawEventName}.`
        : "Codex hook payload has no supported hook_event_name."
    };
  }
  const eventName = rawEventName as CodexHookEventName;
  const common = commonFields(value, eventName);
  if (!common) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Codex hook payload has no valid session_id."
    };
  }

  switch (eventName) {
    case "SessionStart":
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          source: boundedString(value.source)
        }
      };
    case "UserPromptSubmit": {
      const prompt = requiredString(value, "prompt", maxPayloadBytes);
      if (!prompt) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "UserPromptSubmit requires prompt."
        };
      }
      return { ok: true, event: { ...common, hook_event_name: eventName, prompt } };
    }
    case "PreToolUse": {
      const toolName = requiredString(value, "tool_name");
      const toolUseId = requiredString(value, "tool_use_id");
      if (!toolName || !toolUseId) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "PreToolUse requires tool_name and tool_use_id."
        };
      }
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          tool_name: toolName,
          tool_use_id: toolUseId,
          tool_input: sanitizeUnknown(value.tool_input)
        }
      };
    }
    case "PostToolUse": {
      const toolName = requiredString(value, "tool_name");
      const toolUseId = requiredString(value, "tool_use_id");
      if (!toolName || !toolUseId) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "PostToolUse requires tool_name and tool_use_id."
        };
      }
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          tool_name: toolName,
          tool_use_id: toolUseId,
          tool_input: sanitizeUnknown(value.tool_input),
          tool_response: sanitizeUnknown(value.tool_response)
        }
      };
    }
    case "PreCompact":
    case "PostCompact":
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          trigger: boundedString(value.trigger)
        }
      };
    case "SubagentStart": {
      const agentId = requiredString(value, "agent_id");
      if (!agentId) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "SubagentStart requires agent_id."
        };
      }
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          agent_id: agentId,
          agent_type: boundedString(value.agent_type)
        }
      };
    }
    case "SubagentStop": {
      const agentId = requiredString(value, "agent_id");
      if (!agentId) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "SubagentStop requires agent_id."
        };
      }
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          agent_id: agentId,
          agent_type: boundedString(value.agent_type),
          last_assistant_message: boundedString(value.last_assistant_message, maxPayloadBytes)
        }
      };
    }
    case "Stop":
      return {
        ok: true,
        event: {
          ...common,
          hook_event_name: eventName,
          last_assistant_message: boundedString(value.last_assistant_message, maxPayloadBytes)
        }
      };
  }
}

export function deterministicCodexHookUuid(...parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"))
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  const variantNibble = Number.parseInt(digest[16] ?? "0", 16);
  digest[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20
  )}-${value.slice(20)}`;
}

function eventCorrelationParts(event: CodexHookEvent): string[] {
  if (event.hook_event_name === "PreToolUse" || event.hook_event_name === "PostToolUse") {
    return [event.session_id, event.turn_id ?? "no-turn", "tool", event.tool_use_id];
  }
  if (event.hook_event_name === "SubagentStart" || event.hook_event_name === "SubagentStop") {
    return [event.session_id, "subagent", event.agent_id];
  }
  return [
    event.session_id,
    event.turn_id ?? "no-turn",
    event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop"
      ? "turn"
      : event.hook_event_name
  ];
}

function eventSourceId(event: CodexHookEvent, suffix = "primary"): string {
  return deterministicCodexHookUuid(
    "codex-hook-source",
    event.hook_event_name,
    ...eventCorrelationParts(event),
    suffix
  );
}

function eventMetadata(event: CodexHookEvent): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    adapter: "codex_native_hook",
    hook_event_name: event.hook_event_name,
    external_session_id: event.session_id
  };
  if (event.model) metadata.model = event.model;
  if (event.turn_id) metadata.external_turn_id = event.turn_id;
  if (event.cwd) metadata.cwd = event.cwd;
  return metadata;
}

type ToolOutcome = { failed: boolean; error_code: string | null };

function inspectToolOutcome(value: unknown, depth = 0): ToolOutcome {
  if (depth >= maxMetadataDepth || !isObject(value)) {
    return { failed: false, error_code: null };
  }
  if (value.isError === true || value.is_error === true) {
    return { failed: true, error_code: "CODEX_TOOL_ERROR" };
  }
  if (value.success === false || value.ok === false) {
    return { failed: true, error_code: "CODEX_TOOL_ERROR" };
  }
  const exitCode = value.exit_code ?? value.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) {
    return { failed: true, error_code: `CODEX_TOOL_EXIT_${Math.trunc(exitCode)}` };
  }
  const status = boundedString(value.status)?.toLowerCase();
  if (status && ["error", "failed", "failure", "cancelled"].includes(status)) {
    return {
      failed: true,
      error_code: status === "cancelled" ? "CODEX_TOOL_CANCELLED" : "CODEX_TOOL_ERROR"
    };
  }
  if (
    value.error !== null &&
    value.error !== undefined &&
    value.error !== false &&
    value.error !== ""
  ) {
    return { failed: true, error_code: "CODEX_TOOL_ERROR" };
  }
  for (const nested of Object.values(value).slice(0, maxMetadataKeys)) {
    const outcome = inspectToolOutcome(nested, depth + 1);
    if (outcome.failed) return outcome;
  }
  return { failed: false, error_code: null };
}

function observationBase(
  event: CodexHookEvent,
  suffix: string,
  overrides: Omit<
    CodexHookMappedObservation,
    | "type"
    | "event_name"
    | "external_session_id"
    | "run_scope"
    | "run_id"
    | "turn_id"
    | "trace_id"
    | "source_event_id"
    | "dedup_key"
    | "metadata"
  > & {
    metadata?: Record<string, unknown>;
    run_scope?: "main" | "subagent";
    run_id?: string | null;
  }
): CodexHookMappedObservation {
  const sourceEventId = eventSourceId(event, suffix);
  return {
    type: "observation",
    event_name: event.hook_event_name,
    external_session_id: event.session_id,
    run_scope: overrides.run_scope ?? "main",
    run_id: overrides.run_id ?? null,
    turn_id: event.turn_id,
    trace_id: deterministicCodexHookUuid("codex-hook-trace", ...eventCorrelationParts(event)),
    source_event_id: sourceEventId,
    dedup_key: `codex-hook:${sourceEventId}`,
    kind: overrides.kind,
    status: overrides.status,
    resolution_status: overrides.resolution_status,
    title: overrides.title,
    body: overrides.body,
    tool_name: overrides.tool_name,
    error_code: overrides.error_code,
    metadata: { ...eventMetadata(event), ...overrides.metadata }
  };
}

export function mapCodexHookEvent(event: CodexHookEvent): CodexHookCaptureAction[] {
  switch (event.hook_event_name) {
    case "SessionStart":
      return [
        observationBase(event, "session-start", {
          kind: "system",
          status: "success",
          resolution_status: "not_applicable",
          title: "Codex session started",
          body: null,
          tool_name: null,
          error_code: null,
          metadata: { source: event.source }
        })
      ];
    case "UserPromptSubmit":
      return [
        observationBase(event, "user-prompt", {
          kind: "user_prompt",
          status: "success",
          resolution_status: "not_applicable",
          title: "User prompt",
          body: boundedBody(event.prompt),
          tool_name: null,
          error_code: null
        })
      ];
    case "PreToolUse":
      return [
        observationBase(event, "tool-call", {
          kind: "tool_call",
          status: "started",
          resolution_status: "not_applicable",
          title: `Tool started: ${event.tool_name}`,
          body: sanitizedPreview(event.tool_input),
          tool_name: event.tool_name,
          error_code: null,
          metadata: {
            external_tool_use_id: event.tool_use_id,
            tool_input: event.tool_input
          }
        })
      ];
    case "PostToolUse": {
      const outcome = inspectToolOutcome(event.tool_response);
      const result = observationBase(event, "tool-result", {
        kind: "tool_result",
        status: outcome.failed ? "error" : "success",
        resolution_status: "not_applicable",
        title: outcome.failed
          ? `Tool failed: ${event.tool_name}`
          : `Tool completed: ${event.tool_name}`,
        body: sanitizedPreview(event.tool_response),
        tool_name: event.tool_name,
        error_code: outcome.error_code,
        metadata: {
          external_tool_use_id: event.tool_use_id,
          tool_input: event.tool_input,
          tool_response: event.tool_response
        }
      });
      if (!outcome.failed) return [result];
      return [
        result,
        observationBase(event, "tool-error", {
          kind: "error",
          status: "error",
          resolution_status: "unresolved",
          title: `Tool error: ${event.tool_name}`,
          body: sanitizedPreview(event.tool_response),
          tool_name: event.tool_name,
          error_code: outcome.error_code,
          metadata: {
            external_tool_use_id: event.tool_use_id,
            reported_by: "PostToolUse"
          }
        })
      ];
    }
    case "PreCompact": {
      const traceId = deterministicCodexHookUuid(
        "codex-hook-trace",
        ...eventCorrelationParts(event)
      );
      const checkpointId = eventSourceId(event, "checkpoint");
      return [
        observationBase(event, "pre-compact", {
          kind: "system",
          status: "started",
          resolution_status: "not_applicable",
          title: "Codex context compaction started",
          body: null,
          tool_name: null,
          error_code: null,
          metadata: { trigger: event.trigger }
        }),
        {
          type: "checkpoint",
          event_name: "PreCompact",
          external_session_id: event.session_id,
          turn_id: event.turn_id,
          trace_id: traceId,
          dedup_key: `codex-hook:${checkpointId}`,
          summary: "Codex is compacting the current context.",
          next_step: "Continue from Recallant's latest governed session state after compaction."
        }
      ];
    }
    case "PostCompact":
      return [
        observationBase(event, "post-compact", {
          kind: "system",
          status: "success",
          resolution_status: "not_applicable",
          title: "Codex context compaction completed",
          body: null,
          tool_name: null,
          error_code: null,
          metadata: { trigger: event.trigger }
        })
      ];
    case "SubagentStart": {
      const runId = deterministicCodexHookUuid("codex-hook-run", event.session_id, event.agent_id);
      return [
        observationBase(event, "subagent-start", {
          kind: "system",
          status: "started",
          resolution_status: "not_applicable",
          title: `Codex subagent started${event.agent_type ? `: ${event.agent_type}` : ""}`,
          body: null,
          tool_name: null,
          error_code: null,
          run_scope: "subagent",
          run_id: runId,
          metadata: {
            external_agent_id: event.agent_id,
            agent_type: event.agent_type
          }
        })
      ];
    }
    case "SubagentStop": {
      const runId = deterministicCodexHookUuid("codex-hook-run", event.session_id, event.agent_id);
      return [
        observationBase(event, "subagent-stop", {
          kind: "assistant_response",
          status: "success",
          resolution_status: "not_applicable",
          title: `Codex subagent completed${event.agent_type ? `: ${event.agent_type}` : ""}`,
          body: boundedBody(event.last_assistant_message),
          tool_name: null,
          error_code: null,
          run_scope: "subagent",
          run_id: runId,
          metadata: {
            external_agent_id: event.agent_id,
            agent_type: event.agent_type
          }
        })
      ];
    }
    case "Stop":
      return [
        observationBase(event, "assistant-response", {
          kind: "assistant_response",
          status: "success",
          resolution_status: "not_applicable",
          title: "Assistant response",
          body: boundedBody(event.last_assistant_message),
          tool_name: null,
          error_code: null
        })
      ];
  }
}
