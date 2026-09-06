import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  remoteMcpBridgeHeaders,
  validateRemoteMcpBridgeConfig,
  type RemoteMcpBridgeConfig,
  type RemoteMcpBridgeConfigInput
} from "@recallant/contracts";

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

export type RemoteMcpFailureCode =
  | "REMOTE_MCP_CONFIGURATION_ERROR"
  | "REMOTE_MCP_TIMEOUT"
  | "REMOTE_MCP_DNS_FAILURE"
  | "REMOTE_MCP_CONNECTION_REFUSED"
  | "REMOTE_MCP_TLS_ERROR"
  | "REMOTE_MCP_NETWORK_ERROR"
  | "REMOTE_MCP_HTTP_ERROR"
  | "REMOTE_MCP_AUTH_ERROR"
  | "REMOTE_MCP_SCOPE_ERROR"
  | "REMOTE_MCP_JSON_RPC_ERROR"
  | "REMOTE_MCP_INVALID_RESPONSE"
  | "REMOTE_MCP_TOOL_ERROR";

export class RemoteMcpCallError extends Error {
  readonly code: RemoteMcpFailureCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly rpcCode: number | null;

  constructor(
    code: RemoteMcpFailureCode,
    message: string,
    options: {
      retryable?: boolean;
      httpStatus?: number | null;
      rpcCode?: number | null;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RemoteMcpCallError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.rpcCode = options.rpcCode ?? null;
  }
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function transportCauseCode(error: unknown) {
  const cause = objectValue(objectValue(error)?.cause);
  return typeof cause?.code === "string" ? cause.code.toUpperCase() : "";
}

export function classifyRemoteMcpTransportError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const causeCode = transportCauseCode(error);
  if (name === "AbortError") {
    return new RemoteMcpCallError("REMOTE_MCP_TIMEOUT", "Remote MCP request timed out.", {
      retryable: true,
      cause: error
    });
  }
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(causeCode)) {
    return new RemoteMcpCallError(
      "REMOTE_MCP_DNS_FAILURE",
      "Remote MCP server name could not be resolved.",
      { retryable: true, cause: error }
    );
  }
  if (causeCode === "ECONNREFUSED") {
    return new RemoteMcpCallError(
      "REMOTE_MCP_CONNECTION_REFUSED",
      "Remote MCP connection was refused.",
      { retryable: true, cause: error }
    );
  }
  if (/CERT|TLS|SSL/.test(causeCode)) {
    return new RemoteMcpCallError("REMOTE_MCP_TLS_ERROR", "Remote MCP TLS validation failed.", {
      retryable: false,
      cause: error
    });
  }
  return new RemoteMcpCallError("REMOTE_MCP_NETWORK_ERROR", "Remote MCP network request failed.", {
    retryable: true,
    cause: error
  });
}

export function remoteMcpFailure(error: unknown) {
  if (error instanceof RemoteMcpCallError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      http_status: error.httpStatus,
      rpc_code: error.rpcCode
    };
  }
  return {
    code: "REMOTE_MCP_CONFIGURATION_ERROR" as const,
    message: "Remote MCP configuration is incomplete or invalid.",
    retryable: false,
    http_status: null,
    rpc_code: null
  };
}

export function remoteMcpToolPayload(result: CallToolResult) {
  const structured = objectValue(result.structuredContent);
  if (structured) return structured;
  for (const item of result.content) {
    if (item.type !== "text") continue;
    try {
      const parsed = objectValue(JSON.parse(item.text));
      if (parsed) return parsed;
    } catch {
      // Non-JSON text content is valid MCP output, but it is not a structured Recallant payload.
    }
  }
  return null;
}

export async function callRecallantRemoteMcp(
  input: RemoteMcpBridgeConfigInput | RemoteMcpBridgeConfig,
  method: "initialize" | "tools/list" | "tools/call",
  params: Record<string, unknown>,
  options: { id?: JsonRpcId; timeoutMs?: number } = {}
) {
  let config: RemoteMcpBridgeConfig;
  try {
    config = validateRemoteMcpBridgeConfig(input);
  } catch (error) {
    throw new RemoteMcpCallError(
      "REMOTE_MCP_CONFIGURATION_ERROR",
      "Remote MCP configuration is incomplete or invalid.",
      { cause: error }
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  let response: Response;
  try {
    response = await fetch(config.endpointUrl, {
      method: "POST",
      headers: remoteMcpBridgeHeaders(config),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: options.id ?? `remote-mcp-${method}`,
        method,
        params
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw classifyRemoteMcpTransportError(error);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = objectValue(JSON.parse(text));
  } catch {
    if (!response.ok) {
      throw new RemoteMcpCallError(
        "REMOTE_MCP_HTTP_ERROR",
        `Remote MCP returned HTTP ${response.status}.`,
        { retryable: response.status >= 500, httpStatus: response.status }
      );
    }
  }
  if (!payload) {
    throw new RemoteMcpCallError(
      "REMOTE_MCP_INVALID_RESPONSE",
      "Remote MCP returned an invalid JSON response.",
      { retryable: false, httpStatus: response.status }
    );
  }
  if ("error" in payload) {
    const rpcError = (payload as JsonRpcError).error;
    const rpcCode = typeof rpcError?.code === "number" ? rpcError.code : null;
    const code =
      rpcCode === -32001
        ? "REMOTE_MCP_AUTH_ERROR"
        : rpcCode === -32003
          ? "REMOTE_MCP_SCOPE_ERROR"
          : "REMOTE_MCP_JSON_RPC_ERROR";
    throw new RemoteMcpCallError(
      code,
      code === "REMOTE_MCP_AUTH_ERROR"
        ? "Remote MCP rejected the scoped credential."
        : code === "REMOTE_MCP_SCOPE_ERROR"
          ? "Remote MCP rejected the requested project, developer, or client scope."
          : "Remote MCP returned a JSON-RPC error.",
      {
        retryable: response.status >= 500 || rpcCode === -32053,
        httpStatus: response.status,
        rpcCode
      }
    );
  }
  if (!response.ok) {
    throw new RemoteMcpCallError(
      "REMOTE_MCP_HTTP_ERROR",
      `Remote MCP returned HTTP ${response.status}.`,
      { retryable: response.status >= 500, httpStatus: response.status }
    );
  }
  if (!("result" in payload)) {
    throw new RemoteMcpCallError(
      "REMOTE_MCP_INVALID_RESPONSE",
      `Remote MCP ${method} response is missing result.`,
      { retryable: false, httpStatus: response.status }
    );
  }
  return (payload as JsonRpcSuccess).result;
}

export async function callRecallantRemoteTool(
  input: RemoteMcpBridgeConfigInput | RemoteMcpBridgeConfig,
  toolName: string,
  args: Record<string, unknown>,
  options: { id?: JsonRpcId; timeoutMs?: number } = {}
) {
  const raw = await callRecallantRemoteMcp(
    input,
    "tools/call",
    { name: toolName, arguments: args },
    options
  );
  const payload = objectValue(raw);
  if (!payload || !Array.isArray(payload.content)) {
    throw new RemoteMcpCallError(
      "REMOTE_MCP_INVALID_RESPONSE",
      "Remote MCP tools/call response is missing content.",
      { retryable: false }
    );
  }
  const result = {
    content: payload.content as CallToolResult["content"],
    structuredContent: objectValue(payload.structuredContent) ?? undefined,
    isError: payload.isError === true
  } satisfies CallToolResult;
  if (result.isError) {
    const errorPayload = remoteMcpToolPayload(result);
    const nestedError = objectValue(errorPayload?.error);
    throw new RemoteMcpCallError(
      "REMOTE_MCP_TOOL_ERROR",
      typeof nestedError?.message === "string"
        ? nestedError.message.slice(0, 500)
        : "Remote MCP tool returned an error.",
      { retryable: nestedError?.retryable === true }
    );
  }
  return { result, payload: remoteMcpToolPayload(result) };
}
