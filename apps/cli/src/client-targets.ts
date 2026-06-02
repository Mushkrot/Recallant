import { supportedClientKinds } from "@recallant/adapters";

type ClientKind = (typeof supportedClientKinds)[number];

type McpServerConfig = {
  mcpServers: {
    recallant: {
      command: "recallant";
      args: string[];
      env: {
        RECALLANT_PROJECT_ID: string;
        RECALLANT_DEVELOPER_ID: string;
        RECALLANT_DATABASE_URL: string;
      };
    };
  };
};

export type ClientTargetConfig = {
  target: ClientKind;
  config_file: string;
  format: "codex_mcp_json" | "cursor_mcp_json" | "claude_code_mcp_json" | "generic_mcp_json";
  client_specific: boolean;
  merge_mcp_servers: boolean;
  setup_hint: string;
  mcp_config: McpServerConfig;
};

const targetAliases: Record<string, ClientKind> = {
  "claude-code": "claude_code",
  claude_code: "claude_code"
};

function normalizeRawTarget(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

export function normalizeClientTarget(raw: string | undefined): ClientKind {
  const normalized = normalizeRawTarget(raw ?? "codex");
  const candidate = targetAliases[normalized] ?? normalized;
  if (supportedClientKinds.includes(candidate as ClientKind)) return candidate as ClientKind;
  throw new Error(
    `Invalid --target: ${raw}. Supported targets: ${supportedClientKinds.join(", ")}`
  );
}

export function mcpServerConfig(projectId: string, developerId: string): McpServerConfig {
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["mcp-server"],
        env: {
          RECALLANT_PROJECT_ID: projectId,
          RECALLANT_DEVELOPER_ID: developerId,
          RECALLANT_DATABASE_URL: "${RECALLANT_DATABASE_URL}"
        }
      }
    }
  };
}

export function clientTargetConfig(
  rawTarget: string | undefined,
  projectId: string,
  developerId: string
): ClientTargetConfig {
  const target = normalizeClientTarget(rawTarget);
  const mcp_config = mcpServerConfig(projectId, developerId);
  if (target === "codex") {
    return {
      target,
      config_file: ".recallant/codex-mcp.json",
      format: "codex_mcp_json",
      client_specific: true,
      merge_mcp_servers: false,
      setup_hint: "Use this generated Codex MCP config for Recallant-backed sessions.",
      mcp_config
    };
  }
  if (target === "claude_code") {
    return {
      target,
      config_file: ".mcp.json",
      format: "claude_code_mcp_json",
      client_specific: true,
      merge_mcp_servers: true,
      setup_hint:
        "Claude Code can read this project-local .mcp.json. Recallant merges its server entry without removing existing MCP servers.",
      mcp_config
    };
  }
  return {
    target,
    config_file: ".recallant/generic-mcp.json",
    format: "generic_mcp_json",
    client_specific: target === "generic",
    merge_mcp_servers: false,
    setup_hint:
      target === "generic"
        ? "Use this generic MCP stdio config with any client that supports custom MCP servers."
        : `No dedicated ${target} writer exists yet; use this generic MCP stdio config as the safe fallback.`,
    mcp_config
  };
}

export function connectClientTargetConfig(
  rawTarget: string | undefined,
  projectId: string,
  developerId: string
): ClientTargetConfig {
  const target = normalizeClientTarget(rawTarget);
  const mcp_config = mcpServerConfig(projectId, developerId);
  if (target === "cursor") {
    return {
      target,
      config_file: ".cursor/mcp.json",
      format: "cursor_mcp_json",
      client_specific: true,
      merge_mcp_servers: true,
      setup_hint:
        "Cursor can read this project-local .cursor/mcp.json. Recallant merges its server entry without removing existing MCP servers.",
      mcp_config
    };
  }
  return clientTargetConfig(rawTarget, projectId, developerId);
}

export const generatedMcpConfigFiles = [
  ".recallant/codex-mcp.json",
  ".recallant/generic-mcp.json"
] as const;
