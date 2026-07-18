import { createHash } from "node:crypto";
import {
  codexOtelEventNameValues,
  type CodexOtelControlEventInput,
  type CodexOtelEventName,
  type CodexOtelParseResult
} from "@recallant/contracts";

const supportedEventNames = new Set<string>(codexOtelEventNameValues);
const maxPayloadBytes = 1_048_576;
const maxLogRecords = 2_000;
const maxIdentifierChars = 512;
const maxSafeAttributes = 32;
const maxSafeAttributeChars = 1_000;

const safeAttributeNames = new Set([
  "auth_mode",
  "decision",
  "environment",
  "error.type",
  "event.name",
  "model",
  "provider_name",
  "sandbox_policy",
  "service.name",
  "service.version",
  "terminal.type"
]);

const contentAttributePattern =
  /(?:body|command|content|input|message|output|prompt|response|result|snippet|text)/i;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, limit = maxIdentifierChars): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, limit) : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function otlpAnyValue(value: unknown): string | number | boolean | null {
  if (!isObject(value)) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  const integer = finiteNumber(value.intValue);
  if (integer !== null) return integer;
  const double = finiteNumber(value.doubleValue);
  return double;
}

function attributeMap(value: unknown): Map<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  if (!Array.isArray(value)) return result;
  for (const entry of value.slice(0, 500)) {
    if (!isObject(entry)) continue;
    const key = boundedString(entry.key, 256);
    const parsed = otlpAnyValue(entry.value);
    if (key && parsed !== null) result.set(key, parsed);
  }
  return result;
}

function firstAttribute(
  maps: readonly Map<string, string | number | boolean>[],
  ...names: string[]
): string | number | boolean | null {
  for (const name of names) {
    for (const map of maps) {
      if (map.has(name)) return map.get(name) ?? null;
    }
  }
  return null;
}

function firstString(
  maps: readonly Map<string, string | number | boolean>[],
  ...names: string[]
): string | null {
  return boundedString(firstAttribute(maps, ...names));
}

function firstBoolean(
  maps: readonly Map<string, string | number | boolean>[],
  ...names: string[]
): boolean | null {
  const value = firstAttribute(maps, ...names);
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return null;
}

function firstNumber(
  maps: readonly Map<string, string | number | boolean>[],
  ...names: string[]
): number | null {
  return finiteNumber(firstAttribute(maps, ...names));
}

function isoFromUnixNano(value: unknown, fallback: Date): string {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric <= 0) return fallback.toISOString();
  const milliseconds = Math.floor(numeric / 1_000_000);
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function safeAttributes(maps: readonly Map<string, string | number | boolean>[]): {
  values: Record<string, string | number | boolean>;
  dropped: number;
  content: boolean;
} {
  const all = new Map<string, string | number | boolean>();
  for (const map of maps) for (const [key, value] of map) all.set(key, value);
  const values: Record<string, string | number | boolean> = {};
  let content = false;
  for (const [key, raw] of all) {
    if (contentAttributePattern.test(key) && !safeAttributeNames.has(key)) {
      content = true;
      continue;
    }
    if (!safeAttributeNames.has(key)) continue;
    values[key] = typeof raw === "string" ? raw.slice(0, maxSafeAttributeChars) : raw;
    if (Object.keys(values).length >= maxSafeAttributes) break;
  }
  return { values, dropped: Math.max(0, all.size - Object.keys(values).length), content };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseRecord(input: {
  record: JsonObject;
  resourceAttributes: Map<string, string | number | boolean>;
  scopeAttributes: Map<string, string | number | boolean>;
  observedAt: Date;
}): CodexOtelControlEventInput | null {
  const recordAttributes = attributeMap(input.record.attributes);
  const maps = [recordAttributes, input.scopeAttributes, input.resourceAttributes] as const;
  const eventName = firstString(maps, "event.name");
  if (!eventName || !supportedEventNames.has(eventName)) return null;
  const conversationId = firstString(
    maps,
    "conversation.id",
    "conversation_id",
    "thread.id",
    "session.id"
  );
  const callId = firstString(maps, "call.id", "call_id", "tool.call.id", "tool_call_id");
  const toolName = firstString(maps, "tool.name", "tool_name", "gen_ai.tool.name");
  const errorType = firstString(maps, "error.type", "error_type", "error.code");
  const errorMessage = firstString(maps, "error.message");
  const success = firstBoolean(maps, "success", "request.success", "tool.success");
  const durationMs = firstNumber(maps, "duration_ms", "duration.ms", "request.duration_ms");
  const attemptNumber = firstNumber(maps, "attempt", "attempt_number");
  const occurredAt = isoFromUnixNano(input.record.timeUnixNano, input.observedAt);
  const observedAt = isoFromUnixNano(input.record.observedTimeUnixNano, input.observedAt);
  const traceId = boundedString(input.record.traceId, 64)?.toLowerCase() ?? null;
  const spanId = boundedString(input.record.spanId, 32)?.toLowerCase() ?? null;
  const safe = safeAttributes(maps);
  const payloadSeed = JSON.stringify({
    eventName,
    conversationId,
    callId,
    traceId,
    spanId,
    occurredAt,
    success,
    durationMs,
    attemptNumber,
    toolName,
    errorType,
    attributes: safe.values
  });
  const payloadHash = hash(payloadSeed);
  return {
    event_name: eventName as CodexOtelEventName,
    conversation_id: conversationId,
    call_id: callId,
    trace_id: traceId,
    span_id: spanId,
    occurred_at: occurredAt,
    observed_at: observedAt,
    severity_number: finiteNumber(input.record.severityNumber),
    success,
    duration_ms: durationMs === null ? null : Math.max(0, Math.round(durationMs)),
    attempt_number:
      attemptNumber === null
        ? null
        : Math.max(1, Math.round(attemptNumber) + (attemptNumber === 0 ? 1 : 0)),
    tool_name: toolName,
    error_type: errorType,
    error_fingerprint:
      errorType || errorMessage ? hash(`${errorType ?? ""}|${errorMessage ?? ""}`) : null,
    payload_hash: payloadHash,
    dedup_key: `codex-otel:${payloadHash}`,
    safe_attributes: safe.values,
    dropped_attribute_count: safe.dropped,
    content_discarded: safe.content || input.record.body !== undefined
  };
}

export function parseCodexOtelLogs(input: string | unknown): CodexOtelParseResult {
  let payload: unknown = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > maxPayloadBytes) {
      return {
        ok: false,
        code: "payload_too_large",
        message: `OTLP payload exceeds ${maxPayloadBytes} bytes.`
      };
    }
    try {
      payload = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, code: "invalid_json", message: "OTLP payload is not valid JSON." };
    }
  }
  if (!isObject(payload) || !Array.isArray(payload.resourceLogs)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "OTLP logs payload must contain resourceLogs."
    };
  }
  const observedAt = new Date();
  const events: CodexOtelControlEventInput[] = [];
  let seen = 0;
  for (const resourceLog of payload.resourceLogs) {
    if (!isObject(resourceLog)) continue;
    const resourceAttributes = attributeMap(
      isObject(resourceLog.resource) ? resourceLog.resource.attributes : undefined
    );
    if (!Array.isArray(resourceLog.scopeLogs)) continue;
    for (const scopeLog of resourceLog.scopeLogs) {
      if (!isObject(scopeLog)) continue;
      const scopeAttributes = attributeMap(
        isObject(scopeLog.scope) ? scopeLog.scope.attributes : undefined
      );
      if (!Array.isArray(scopeLog.logRecords)) continue;
      for (const record of scopeLog.logRecords) {
        seen += 1;
        if (seen > maxLogRecords) {
          return {
            ok: false,
            code: "too_many_records",
            message: `OTLP payload exceeds ${maxLogRecords} log records.`
          };
        }
        if (!isObject(record)) continue;
        const parsed = parseRecord({ record, resourceAttributes, scopeAttributes, observedAt });
        if (parsed) events.push(parsed);
      }
    }
  }
  return {
    ok: true,
    events,
    accepted_log_records: events.length,
    ignored_log_records: seen - events.length
  };
}
