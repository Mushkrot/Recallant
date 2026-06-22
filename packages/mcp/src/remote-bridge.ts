import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  remoteMcpBridgeEnv,
  remoteMcpBridgeFlags,
  remoteMcpBridgeHeaders,
  validateRemoteMcpBridgeConfig,
  type RemoteMcpBridgeConfig,
  type RemoteMcpBridgeConfigInput
} from "@recallant/contracts";
import process from "node:process";
import { z } from "zod";

type JsonRpcId = string | number | null;

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type RemoteTool = {
  name: string;
  title?: string;
  description?: string;
};

const bridgeServerName = "recallant-remote-bridge";
const bridgeVersion = "0.0.0";
const passthroughInputSchema = z.object({}).passthrough();

const forbiddenEnvKeys = [
  "RECALLANT_DATABASE_URL",
  "DATABASE_URL",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "RECALLANT_WORKBENCH_AUTH_TOKEN",
  "RECALLANT_ADMIN_TOKEN",
  "RECALLANT_BACKUP_PATH",
  "RECALLANT_RAW_ARTIFACTS_PATH",
  "RECALLANT_PROVIDER_SECRET",
  "RECALLANT_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY"
] as const;

const forbiddenArgPatterns = [
  /^--(?:database-url|db-url|postgres-url|pg-.*)$/i,
  /^--(?:workbench-auth|admin-auth|admin-token)$/i,
  /^--(?:backup-path|raw-artifacts?|raw-artifacts-path)$/i,
  /^--(?:provider-secret|provider-key|openai-api-key|anthropic-api-key)$/i
];

const forbiddenPayloadKeyPattern =
  /^(?:RECALLANT_DATABASE_URL|DATABASE_URL|database_url|postgres_url|workbench_auth|admin_auth|admin_token|raw_artifacts?|raw_artifacts_path|backup_path|provider_secret|provider_key|openai_api_key|anthropic_api_key)$/i;

function parseBridgeFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readBridgeConfig(argv: readonly string[], env: NodeJS.ProcessEnv): RemoteMcpBridgeConfig {
  rejectForbiddenBridgeConfig(argv, env);
  return validateRemoteMcpBridgeConfig({
    serverUrl:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.serverUrl) ?? env[remoteMcpBridgeEnv.serverUrl],
    credential:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.credential) ?? env[remoteMcpBridgeEnv.credential],
    credentialRef:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.credentialRef) ??
      env[remoteMcpBridgeEnv.credentialRef],
    credentialStorePath:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.credentialStore) ??
      env[remoteMcpBridgeEnv.credentialStore],
    projectId:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.projectId) ?? env[remoteMcpBridgeEnv.projectId],
    developerId:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.developerId) ??
      env[remoteMcpBridgeEnv.developerId],
    clientId:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.clientId) ?? env[remoteMcpBridgeEnv.clientId],
    sessionId:
      parseBridgeFlag(argv, remoteMcpBridgeFlags.sessionId) ?? env[remoteMcpBridgeEnv.sessionId],
    traceId: parseBridgeFlag(argv, remoteMcpBridgeFlags.traceId) ?? env[remoteMcpBridgeEnv.traceId]
  });
}

function rejectForbiddenBridgeConfig(argv: readonly string[], env: NodeJS.ProcessEnv) {
  const envKey = forbiddenEnvKeys.find((key) => {
    const value = env[key];
    return value !== undefined && value.trim() !== "";
  });
  if (envKey) {
    throw new Error(
      "POLICY_BLOCKED: forbidden local secret or storage env is not allowed in remote MCP bridge config"
    );
  }
  const arg = argv
    .slice(3)
    .find((value) => forbiddenArgPatterns.some((pattern) => pattern.test(value)));
  if (arg) {
    throw new Error(
      "POLICY_BLOCKED: forbidden local secret or storage argument is not allowed in remote MCP bridge config"
    );
  }
}

function findForbiddenBridgePayloadKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findForbiddenBridgePayloadKey(item);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenPayloadKeyPattern.test(key)) return key;
    const nested = findForbiddenBridgePayloadKey(nestedValue);
    if (nested) return nested;
  }
  return null;
}

function rejectForbiddenBridgePayload(value: unknown) {
  if (findForbiddenBridgePayloadKey(value)) {
    throw new Error(
      "POLICY_BLOCKED: forbidden local secret or storage field is not allowed in remote MCP bridge tool arguments"
    );
  }
}

function redactRemoteBridgeValue(value: unknown, config: RemoteMcpBridgeConfig): unknown {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw
    .replaceAll(config.credential, "[REDACTED_CREDENTIAL]")
    .replaceAll(config.endpointUrl, "[REMOTE_MCP_ENDPOINT]")
    .replaceAll(config.serverUrl, "[REMOTE_MCP_SERVER]");
}

function remoteBridgeError(
  toolName: string,
  error: unknown,
  config: RemoteMcpBridgeConfig
): CallToolResult {
  const message = redactRemoteBridgeValue(
    error instanceof Error ? error.message : String(error),
    config
  );
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            bridge: bridgeServerName,
            tool: toolName,
            error: {
              code: "REMOTE_MCP_ERROR",
              message
            }
          },
          null,
          2
        )
      }
    ]
  };
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`VALIDATION_ERROR: remote MCP ${label} response must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseRemoteTools(result: unknown): RemoteTool[] {
  const payload = assertObject(result, "tools/list");
  if (!Array.isArray(payload.tools)) {
    throw new Error("VALIDATION_ERROR: remote MCP tools/list response must include tools[]");
  }
  return payload.tools.map((entry, index) => {
    const tool = assertObject(entry, `tools/list tools[${index}]`);
    if (typeof tool.name !== "string" || tool.name.trim() === "") {
      throw new Error(`VALIDATION_ERROR: remote MCP tools[${index}].name is required`);
    }
    return {
      name: tool.name,
      title: typeof tool.title === "string" ? tool.title : undefined,
      description: typeof tool.description === "string" ? tool.description : undefined
    };
  });
}

function parseToolResult(result: unknown) {
  const payload = assertObject(result, "tools/call");
  if (!Array.isArray(payload.content)) {
    throw new Error("VALIDATION_ERROR: remote MCP tools/call response must include content[]");
  }
  return {
    content: payload.content as CallToolResult["content"],
    structuredContent:
      payload.structuredContent &&
      typeof payload.structuredContent === "object" &&
      !Array.isArray(payload.structuredContent)
        ? (payload.structuredContent as Record<string, unknown>)
        : undefined,
    isError: payload.isError === true
  } satisfies CallToolResult;
}

async function callRemoteMcp(
  config: RemoteMcpBridgeConfig,
  method: "initialize" | "tools/list" | "tools/call",
  params: Record<string, unknown>,
  id: JsonRpcId
) {
  const response = await fetch(config.endpointUrl, {
    method: "POST",
    headers: remoteMcpBridgeHeaders(config satisfies RemoteMcpBridgeConfigInput),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    })
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `REMOTE_MCP_HTTP_${response.status}: remote MCP returned non-JSON response (${text.length} bytes)`
    );
  }
  const envelope = assertObject(payload, method);
  if ("error" in envelope) {
    const errorEnvelope = envelope as JsonRpcError;
    throw new Error(
      `REMOTE_MCP_JSON_RPC_${errorEnvelope.error?.code ?? "ERROR"}: ${
        errorEnvelope.error?.message ?? "remote MCP call failed"
      }`
    );
  }
  if (!response.ok) {
    throw new Error(`REMOTE_MCP_HTTP_${response.status}: remote MCP call failed`);
  }
  if (!("result" in envelope)) {
    throw new Error(`VALIDATION_ERROR: remote MCP ${method} response is missing result`);
  }
  return (envelope as JsonRpcSuccess).result;
}

export async function createRecallantRemoteBridgeServer(config: RemoteMcpBridgeConfig) {
  await callRemoteMcp(
    config,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: bridgeServerName,
        version: bridgeVersion
      }
    },
    "remote-bridge-initialize"
  );
  const tools = parseRemoteTools(
    await callRemoteMcp(config, "tools/list", {}, "remote-bridge-tools")
  );

  const server = new McpServer({
    name: bridgeServerName,
    version: bridgeVersion
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: passthroughInputSchema
      },
      async (args) => {
        try {
          rejectForbiddenBridgePayload(args);
          const result = await callRemoteMcp(
            config,
            "tools/call",
            {
              name: tool.name,
              arguments: (args ?? {}) as Record<string, unknown>
            },
            `remote-bridge-tool-${tool.name}`
          );
          return parseToolResult(result);
        } catch (error) {
          return remoteBridgeError(tool.name, error, config);
        }
      }
    );
  }

  return server;
}

export async function runRecallantRemoteBridge(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
) {
  const config = readBridgeConfig(argv, env);
  const server = await createRecallantRemoteBridgeServer(config);
  server.server.onerror = (error) => {
    process.stderr.write(
      `Recallant remote MCP bridge error: ${redactRemoteBridgeValue(
        error instanceof Error ? error.message : String(error),
        config
      )}\n`
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
