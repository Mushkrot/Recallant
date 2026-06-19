import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createRecallantDbFromEnv,
  redactSystemActivityValue,
  type RecallantDb,
  type SystemActivityRecord
} from "@recallant/db";
import process from "node:process";

import { createRecallantTools, type RecallantToolsRuntimeContext } from "./tools.js";

type RateLimitState = {
  windowStartedAt: number;
  count: number;
};

const rateLimits = new Map<string, RateLimitState>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type McpAuditStatus = {
  durable: boolean;
  surface: "mcp";
  operation: string;
  status: "recorded" | "unavailable" | "failed";
  activity_id?: string;
  trace_id?: string;
  error_code?: string;
  reason?: string;
};

type McpAuditContext = {
  database: RecallantDb | null;
  activity: SystemActivityRecord | null;
  status: McpAuditStatus;
};

function readRateLimitPerMinute() {
  const raw = process.env.RECALLANT_MCP_RATE_LIMIT_PER_MINUTE;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function checkRateLimit(toolName: string) {
  const limit = readRateLimitPerMinute();
  if (limit <= 0) return;
  const now = Date.now();
  const state = rateLimits.get(toolName);
  if (!state || now - state.windowStartedAt >= 60_000) {
    rateLimits.set(toolName, { windowStartedAt: now, count: 1 });
    return;
  }
  state.count += 1;
  if (state.count > limit) {
    throw new Error(`RATE_LIMITED: ${toolName} exceeded ${limit} calls per minute`);
  }
}

function codeFromError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("VALIDATION_ERROR:")) return "VALIDATION_ERROR";
  if (message.startsWith("RATE_LIMITED:")) return "RATE_LIMITED";
  if (message.startsWith("POLICY_BLOCKED:")) return "POLICY_BLOCKED";
  return "INTERNAL_ERROR";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactSystemActivityValue(message, "error_message"));
}

function structuredError(toolName: string, error: unknown, audit?: McpAuditStatus) {
  const message = safeErrorMessage(error);
  const code = codeFromError(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            error: {
              code,
              message,
              retryable: code === "RATE_LIMITED"
            },
            audit,
            tool: toolName
          },
          null,
          2
        )
      }
    ]
  };
}

function uuidOrNull(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function summarizeArgument(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return null;
  if (uuidPattern.test(String(value))) return value;
  if (typeof value === "string") {
    if (/secret|token|password|api[_-]?key|authorization|cookie|database[_-]?url/i.test(key)) {
      return "[REDACTED]";
    }
    if (/text|body|query|summary|note|payload/i.test(key)) {
      return { type: "string", length: value.length };
    }
    return value.length > 120 ? { type: "string", length: value.length } : value;
  }
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value).sort() };
  return value;
}

function summarizeArgs(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, summarizeArgument(value, key)])
  );
}

function relatedIdsFromArgs(args: Record<string, unknown>) {
  return {
    project_id: uuidOrNull(args.project_id) ?? uuidOrNull(process.env.RECALLANT_PROJECT_ID),
    session_id: uuidOrNull(args.session_id),
    trace_id: uuidOrNull(args.trace_id),
    memory_id: uuidOrNull(args.memory_id),
    chunk_id: uuidOrNull(args.chunk_id)
  };
}

function relatedIdsFromResult(payload: Record<string, unknown>) {
  const related: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (uuidPattern.test(String(value)) && /(?:^|_)id$/.test(key)) {
      related[key] = value;
      continue;
    }
    if (
      Array.isArray(value) &&
      /(?:^|_)ids$/.test(key) &&
      value.every((item) => uuidPattern.test(String(item)))
    ) {
      related[key] = value.slice(0, 20);
    }
  }
  return related;
}

function attachAuditStatus(payload: Record<string, unknown>, audit: McpAuditStatus) {
  return { ...payload, audit };
}

async function startMcpAudit(
  toolName: string,
  args: Record<string, unknown>
): Promise<McpAuditContext> {
  const database = createRecallantDbFromEnv();
  const unavailable: McpAuditStatus = {
    durable: false,
    surface: "mcp",
    operation: toolName,
    status: "unavailable",
    reason: "Recallant storage is not configured for this MCP server process."
  };
  if (!database) return { database: null, activity: null, status: unavailable };
  try {
    const activity = await database.startSystemActivity({
      surface: "mcp",
      operation: toolName,
      actor_kind: "agent",
      actor_id: typeof args.client_kind === "string" ? args.client_kind : "mcp-client",
      client_kind: typeof args.client_kind === "string" ? args.client_kind : "mcp",
      client_version:
        typeof args.client_version === "string"
          ? args.client_version
          : process.env.RECALLANT_CLIENT_VERSION,
      developer_id: null,
      project_id: null,
      session_id: null,
      related_ids: relatedIdsFromArgs(args),
      metadata: {
        argument_keys: Object.keys(args).sort(),
        arguments: summarizeArgs(args)
      }
    });
    return {
      database,
      activity,
      status: {
        durable: true,
        surface: "mcp",
        operation: toolName,
        status: "recorded",
        activity_id: activity.id,
        trace_id: activity.trace_id
      }
    };
  } catch (error) {
    return {
      database: null,
      activity: null,
      status: {
        durable: false,
        surface: "mcp",
        operation: toolName,
        status: "failed",
        error_code: codeFromError(error),
        reason: safeErrorMessage(error)
      }
    };
  }
}

async function finishMcpAudit(
  audit: McpAuditContext,
  status: "success" | "error" | "cancelled" | "skipped",
  payload: Record<string, unknown> | null,
  error?: unknown
) {
  if (!audit.database || !audit.activity) return audit.status;
  try {
    const finished = await audit.database.finishSystemActivity({
      id: audit.activity.id,
      status,
      error_code: error ? codeFromError(error) : null,
      error_message: error ? safeErrorMessage(error) : null,
      related_ids: payload ? relatedIdsFromResult(payload) : {},
      metadata: {
        result_keys: payload ? Object.keys(payload).sort() : [],
        error_code: error ? codeFromError(error) : null
      }
    });
    return {
      durable: true,
      surface: "mcp" as const,
      operation: audit.status.operation,
      status: "recorded" as const,
      activity_id: finished?.id ?? audit.activity.id,
      trace_id: finished?.trace_id ?? audit.activity.trace_id
    };
  } catch (finishError) {
    return {
      durable: false,
      surface: "mcp" as const,
      operation: audit.status.operation,
      status: "failed" as const,
      activity_id: audit.activity.id,
      trace_id: audit.activity.trace_id,
      error_code: codeFromError(finishError),
      reason: safeErrorMessage(finishError)
    };
  }
}

export function createRecallantMcpServer(context: RecallantToolsRuntimeContext = {}) {
  const server = new McpServer({
    name: "recallant",
    version: "0.0.0"
  });

  for (const tool of createRecallantTools(context)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args) => {
        const toolArgs = args as Record<string, unknown>;
        const audit = await startMcpAudit(tool.name, toolArgs);
        try {
          checkRateLimit(tool.name);
          const payload = await tool.handler(toolArgs);
          const auditStatus = await finishMcpAudit(audit, "success", payload);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(attachAuditStatus(payload, auditStatus), null, 2)
              }
            ]
          };
        } catch (error) {
          const auditStatus = await finishMcpAudit(audit, "error", null, error);
          return structuredError(tool.name, error, auditStatus);
        }
      }
    );
  }

  return server;
}

export async function runRecallantStdioServer() {
  const server = createRecallantMcpServer();
  server.server.onerror = (error) => {
    process.stderr.write(
      `Recallant MCP error: ${error instanceof Error ? error.message : String(error)}\n`
    );
  };
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  const keepAlive = setInterval(() => undefined, 60_000);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  clearInterval(keepAlive);
  await server.close();
}
