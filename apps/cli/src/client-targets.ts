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
  format: "codex_config_toml" | "cursor_mcp_json" | "claude_code_mcp_json" | "generic_mcp_json";
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

function parseJsonObjectOrEmpty(text: string | null) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mergeMcpServersConfig(
  existingText: string | null,
  desiredConfig: { mcpServers: Record<string, unknown> }
) {
  const existingObject = parseJsonObjectOrEmpty(existingText);
  const existingServers =
    existingObject.mcpServers &&
    typeof existingObject.mcpServers === "object" &&
    !Array.isArray(existingObject.mcpServers)
      ? (existingObject.mcpServers as Record<string, unknown>)
      : {};
  return {
    ...existingObject,
    mcpServers: {
      ...existingServers,
      ...desiredConfig.mcpServers
    }
  };
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function tomlInlineStringMap(values: Record<string, string>) {
  const entries = Object.entries(values).map(([key, value]) => `${key} = ${tomlString(value)}`);
  return `{ ${entries.join(", ")} }`;
}

export function codexConfigHasRecallantMcp(content: string | null) {
  return /^\s*\[mcp_servers\.recallant\]\s*$/m.test(content ?? "");
}

export function codexMcpServerToml(config: McpServerConfig) {
  const recallant = config.mcpServers.recallant;
  const env = {
    RECALLANT_PROJECT_ID: recallant.env.RECALLANT_PROJECT_ID,
    RECALLANT_DEVELOPER_ID: recallant.env.RECALLANT_DEVELOPER_ID
  };
  return [
    "[mcp_servers.recallant]",
    `command = ${tomlString(recallant.command)}`,
    `args = ${tomlStringArray(recallant.args)}`,
    `env = ${tomlInlineStringMap(env)}`,
    'env_vars = ["RECALLANT_DATABASE_URL"]'
  ].join("\n");
}

function upsertTomlTable(existingText: string | null, tableName: string, tableText: string) {
  const existing = existingText?.trimEnd() ?? "";
  const tablePattern = new RegExp(
    `(^|\\n)\\[${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`
  );
  if (tablePattern.test(existing)) {
    return `${existing.replace(tablePattern, (match, prefix: string) => `${prefix}${tableText}`)}\n`;
  }
  return existing ? `${existing}\n\n${tableText}\n` : `${tableText}\n`;
}

export function renderClientTargetConfig(
  existingText: string | null,
  targetConfig: ClientTargetConfig
) {
  if (targetConfig.format === "codex_config_toml") {
    return upsertTomlTable(
      existingText,
      "mcp_servers.recallant",
      codexMcpServerToml(targetConfig.mcp_config)
    );
  }
  const desiredConfig = targetConfig.merge_mcp_servers
    ? mergeMcpServersConfig(existingText, targetConfig.mcp_config)
    : targetConfig.mcp_config;
  return `${JSON.stringify(desiredConfig, null, 2)}\n`;
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
      config_file: ".codex/config.toml",
      format: "codex_config_toml",
      client_specific: true,
      merge_mcp_servers: true,
      setup_hint:
        "Codex reads this project-local .codex/config.toml in trusted projects. Recallant merges only its mcp_servers.recallant entry.",
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
