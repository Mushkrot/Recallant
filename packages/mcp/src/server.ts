import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

import { recallantTools } from "./tools.js";

type RateLimitState = {
  windowStartedAt: number;
  count: number;
};

const rateLimits = new Map<string, RateLimitState>();

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

function structuredError(toolName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
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
            tool: toolName
          },
          null,
          2
        )
      }
    ]
  };
}

export function createRecallantMcpServer() {
  const server = new McpServer({
    name: "recallant",
    version: "0.0.0"
  });

  for (const tool of recallantTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args) => {
        try {
          checkRateLimit(tool.name);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(await tool.handler(args as Record<string, unknown>), null, 2)
              }
            ]
          };
        } catch (error) {
          return structuredError(tool.name, error);
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
