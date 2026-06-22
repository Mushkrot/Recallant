import { supportedClientKinds } from "@recallant/adapters";
import {
  remoteMcpBridgeEnv,
  remoteMcpBridgeFlags,
  remoteMcpClientBootstrapScriptUrl,
  type RemoteMcpBridgeConfigInput
} from "@recallant/contracts";

type ClientKind = (typeof supportedClientKinds)[number];

type McpServerConfig = {
  mcpServers: {
    recallant: {
      command: "recallant";
      args: string[];
      env: {
        RECALLANT_PROJECT_ID: string;
        RECALLANT_DEVELOPER_ID: string;
        RECALLANT_PROJECT_PATH: string;
        RECALLANT_DATABASE_URL: string;
      };
    };
  };
};

type RemoteMcpServerConfig = {
  mcpServers: {
    recallant: {
      command: "recallant";
      args: string[];
      env: {
        RECALLANT_REMOTE_MCP_URL: string;
        RECALLANT_REMOTE_MCP_CREDENTIAL?: string;
        RECALLANT_REMOTE_MCP_CREDENTIAL_REF?: string;
        RECALLANT_REMOTE_MCP_CREDENTIAL_STORE?: string;
        RECALLANT_PROJECT_ID: string;
        RECALLANT_DEVELOPER_ID: string;
        RECALLANT_REMOTE_MCP_CLIENT_ID: string;
        RECALLANT_REMOTE_MCP_SESSION_ID?: string;
        RECALLANT_REMOTE_MCP_TRACE_ID?: string;
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

export type RemoteClientTargetConfig = Omit<ClientTargetConfig, "mcp_config"> & {
  mcp_config: RemoteMcpServerConfig;
  remote: true;
};

export type RemoteMcpProvisioningCredential = {
  id: string;
  project_id: string;
  developer_id: string;
  client_id?: string | null;
  label?: string | null;
  status: string;
  credential_prefix: string;
  created_at?: string | Date | null;
  last_used_at?: string | Date | null;
  expires_at?: string | Date | null;
  revoked_at?: string | Date | null;
  rotated_from_credential_id?: string | null;
};

export type RemoteMcpProvisioningAction = "create" | "rotate" | "list" | "revoke";

export type RemoteMcpProvisioningOutputInput = {
  action: RemoteMcpProvisioningAction;
  target?: string;
  serverUrl: string;
  bootstrapScriptUrl?: string | null;
  projectDir?: string | null;
  credential: RemoteMcpProvisioningCredential;
  previousCredential?: RemoteMcpProvisioningCredential | null;
  bridgeClientId: string;
  credentialSecret?: string | null;
  includeSecret: boolean;
  sessionId?: string | null;
  traceId?: string | null;
};

export type RemoteMcpProvisioningOutput = {
  action: RemoteMcpProvisioningAction;
  target: ClientKind;
  one_time_secret: {
    shown: boolean;
    value: string | null;
    policy: "create_rotate_only" | "redacted";
  };
  credential: RemoteMcpProvisioningCredential;
  previous_credential: RemoteMcpProvisioningCredential | null;
  scope: {
    project_id: string;
    developer_id: string;
    credential_client_id: string | null;
    bridge_client_id: string;
    client_scoped: boolean;
  };
  provisioning: {
    command: string;
    argv: string[];
    bootstrap_script_url: string;
    project_dir: string;
    doctor_command: string;
    doctor_argv: string[];
    bridge_command: string;
    bridge_argv: string[];
    config_file: string;
    format: RemoteClientTargetConfig["format"];
    rendered_config: string;
    mcp_config: RemoteMcpServerConfig;
    secret_visibility: "one_time_raw_secret" | "redacted_placeholder";
    local_runtime: {
      requires_docker: false;
      requires_postgres: false;
      requires_local_recallant_server: false;
      writes_project_client_config: true;
    };
  };
  safety: {
    local_stdio_default_unchanged: true;
    requires_recallant_database_url: false;
    exposes_postgres: false;
    exposes_internal_server_paths: false;
    exposes_workbench_or_admin_auth: false;
    exposes_raw_artifacts_or_backups: false;
    exposes_provider_secrets: false;
  };
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

export function mcpServerConfig(
  projectId: string,
  developerId: string,
  projectPath: string
): McpServerConfig {
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["mcp-server"],
        env: {
          RECALLANT_PROJECT_ID: projectId,
          RECALLANT_DEVELOPER_ID: developerId,
          RECALLANT_PROJECT_PATH: projectPath,
          RECALLANT_DATABASE_URL: "${RECALLANT_DATABASE_URL}"
        }
      }
    }
  };
}

export function remoteMcpServerConfig(input: RemoteMcpBridgeConfigInput): RemoteMcpServerConfig {
  const env: RemoteMcpServerConfig["mcpServers"]["recallant"]["env"] = {
    RECALLANT_REMOTE_MCP_URL: input.serverUrl ?? "",
    RECALLANT_PROJECT_ID: input.projectId ?? "",
    RECALLANT_DEVELOPER_ID: input.developerId ?? "",
    RECALLANT_REMOTE_MCP_CLIENT_ID: input.clientId ?? ""
  };
  if (input.credentialRef) env.RECALLANT_REMOTE_MCP_CREDENTIAL_REF = input.credentialRef;
  else env.RECALLANT_REMOTE_MCP_CREDENTIAL = input.credential ?? "";
  if (input.credentialStorePath) {
    env.RECALLANT_REMOTE_MCP_CREDENTIAL_STORE = input.credentialStorePath;
  }
  if (input.sessionId) env.RECALLANT_REMOTE_MCP_SESSION_ID = input.sessionId;
  if (input.traceId) env.RECALLANT_REMOTE_MCP_TRACE_ID = input.traceId;
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["remote-bridge"],
        env
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

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isoOrNull(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizedProvisioningCredential(
  credential: RemoteMcpProvisioningCredential
): RemoteMcpProvisioningCredential {
  return {
    id: credential.id,
    project_id: credential.project_id,
    developer_id: credential.developer_id,
    client_id: credential.client_id ?? null,
    label: credential.label ?? null,
    status: credential.status,
    credential_prefix: credential.credential_prefix,
    created_at: isoOrNull(credential.created_at),
    last_used_at: isoOrNull(credential.last_used_at),
    expires_at: isoOrNull(credential.expires_at),
    revoked_at: isoOrNull(credential.revoked_at),
    rotated_from_credential_id: credential.rotated_from_credential_id ?? null
  };
}

export function codexConfigHasRecallantMcp(content: string | null) {
  return /^\s*\[mcp_servers\.recallant\]\s*$/m.test(content ?? "");
}

export function codexMcpServerToml(config: McpServerConfig) {
  const recallant = config.mcpServers.recallant;
  const env = {
    RECALLANT_PROJECT_ID: recallant.env.RECALLANT_PROJECT_ID,
    RECALLANT_DEVELOPER_ID: recallant.env.RECALLANT_DEVELOPER_ID,
    RECALLANT_PROJECT_PATH: recallant.env.RECALLANT_PROJECT_PATH
  };
  return [
    "[mcp_servers.recallant]",
    `command = ${tomlString(recallant.command)}`,
    `args = ${tomlStringArray(recallant.args)}`,
    `env = ${tomlInlineStringMap(env)}`,
    'env_vars = ["RECALLANT_DATABASE_URL"]'
  ].join("\n");
}

export function codexRemoteMcpServerToml(config: RemoteMcpServerConfig) {
  const recallant = config.mcpServers.recallant;
  return [
    "[mcp_servers.recallant]",
    `command = ${tomlString(recallant.command)}`,
    `args = ${tomlStringArray(recallant.args)}`,
    `env = ${tomlInlineStringMap(recallant.env)}`
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

export function renderRemoteClientTargetConfig(
  existingText: string | null,
  targetConfig: RemoteClientTargetConfig
) {
  if (targetConfig.format === "codex_config_toml") {
    return upsertTomlTable(
      existingText,
      "mcp_servers.recallant",
      codexRemoteMcpServerToml(targetConfig.mcp_config)
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
  developerId: string,
  projectPath: string
): ClientTargetConfig {
  const target = normalizeClientTarget(rawTarget);
  const mcp_config = mcpServerConfig(projectId, developerId, projectPath);
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
  developerId: string,
  projectPath: string
): ClientTargetConfig {
  const target = normalizeClientTarget(rawTarget);
  const mcp_config = mcpServerConfig(projectId, developerId, projectPath);
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
  return clientTargetConfig(rawTarget, projectId, developerId, projectPath);
}

export function remoteClientTargetConfig(
  rawTarget: string | undefined,
  input: RemoteMcpBridgeConfigInput
): RemoteClientTargetConfig {
  const target = normalizeClientTarget(rawTarget);
  const mcp_config = remoteMcpServerConfig(input);
  if (target === "codex") {
    return {
      target,
      config_file: ".codex/config.toml",
      format: "codex_config_toml",
      client_specific: true,
      merge_mcp_servers: true,
      setup_hint:
        "Codex reads this project-local .codex/config.toml in trusted projects. This remote config runs the Recallant bridge over HTTPS without local storage credentials.",
      mcp_config,
      remote: true
    };
  }
  if (target === "cursor") {
    return {
      target,
      config_file: ".cursor/mcp.json",
      format: "cursor_mcp_json",
      client_specific: true,
      merge_mcp_servers: true,
      setup_hint:
        "Cursor can read this project-local .cursor/mcp.json. This remote config merges only the Recallant bridge server entry.",
      mcp_config,
      remote: true
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
        "Claude Code can read this project-local .mcp.json. This remote config merges only the Recallant bridge server entry.",
      mcp_config,
      remote: true
    };
  }
  return {
    target,
    config_file: ".recallant/generic-remote-mcp.json",
    format: "generic_mcp_json",
    client_specific: target === "generic",
    merge_mcp_servers: false,
    setup_hint:
      target === "generic"
        ? "Use this generic remote MCP stdio config with any client that supports custom MCP servers."
        : `No dedicated ${target} remote writer exists yet; use this generic MCP stdio config as the safe fallback.`,
    mcp_config,
    remote: true
  };
}

export const remoteBridgeConfigFields = {
  env: remoteMcpBridgeEnv,
  flags: remoteMcpBridgeFlags
} as const;

export function remoteMcpProvisioningOutput(
  input: RemoteMcpProvisioningOutputInput
): RemoteMcpProvisioningOutput {
  const credential = normalizedProvisioningCredential(input.credential);
  const previousCredential = input.previousCredential
    ? normalizedProvisioningCredential(input.previousCredential)
    : null;
  const target = normalizeClientTarget(input.target);
  const bridgeCredential = input.includeSecret
    ? (input.credentialSecret ?? "")
    : "<scoped-remote-mcp-credential>";
  const targetConfig = remoteClientTargetConfig(target, {
    serverUrl: input.serverUrl,
    credential: bridgeCredential,
    projectId: credential.project_id,
    developerId: credential.developer_id,
    clientId: input.bridgeClientId,
    sessionId: input.sessionId,
    traceId: input.traceId
  });
  const bridgeArgv = [
    "recallant",
    "connect-remote",
    target,
    remoteMcpBridgeFlags.serverUrl,
    input.serverUrl,
    remoteMcpBridgeFlags.credential,
    bridgeCredential,
    remoteMcpBridgeFlags.projectId,
    credential.project_id,
    remoteMcpBridgeFlags.developerId,
    credential.developer_id,
    remoteMcpBridgeFlags.clientId,
    input.bridgeClientId
  ];
  if (input.sessionId) bridgeArgv.push(remoteMcpBridgeFlags.sessionId, input.sessionId);
  if (input.traceId) bridgeArgv.push(remoteMcpBridgeFlags.traceId, input.traceId);
  bridgeArgv.push("--format", "json");
  const projectDir = input.projectDir?.trim() || ".";
  const bootstrapScriptUrl = input.bootstrapScriptUrl?.trim() || remoteMcpClientBootstrapScriptUrl;
  const bootstrapArgs = [
    remoteMcpBridgeFlags.serverUrl,
    input.serverUrl,
    remoteMcpBridgeFlags.credential,
    bridgeCredential,
    remoteMcpBridgeFlags.projectId,
    credential.project_id,
    remoteMcpBridgeFlags.developerId,
    credential.developer_id,
    remoteMcpBridgeFlags.clientId,
    input.bridgeClientId,
    "--target",
    target,
    "--project-dir",
    projectDir
  ];
  if (input.sessionId) bootstrapArgs.push(remoteMcpBridgeFlags.sessionId, input.sessionId);
  if (input.traceId) bootstrapArgs.push(remoteMcpBridgeFlags.traceId, input.traceId);
  const argv = ["bash", "-s", "--", ...bootstrapArgs];
  const doctorArgv = [
    "recallant",
    "remote-doctor",
    remoteMcpBridgeFlags.serverUrl,
    input.serverUrl,
    remoteMcpBridgeFlags.credential,
    bridgeCredential,
    remoteMcpBridgeFlags.projectId,
    credential.project_id,
    remoteMcpBridgeFlags.developerId,
    credential.developer_id,
    remoteMcpBridgeFlags.clientId,
    input.bridgeClientId,
    "--format",
    "json"
  ];
  if (input.sessionId) doctorArgv.push(remoteMcpBridgeFlags.sessionId, input.sessionId);
  if (input.traceId) doctorArgv.push(remoteMcpBridgeFlags.traceId, input.traceId);
  return {
    action: input.action,
    target,
    one_time_secret: {
      shown: input.includeSecret,
      value: input.includeSecret ? (input.credentialSecret ?? null) : null,
      policy: input.includeSecret ? "create_rotate_only" : "redacted"
    },
    credential,
    previous_credential: previousCredential,
    scope: {
      project_id: credential.project_id,
      developer_id: credential.developer_id,
      credential_client_id: credential.client_id ?? null,
      bridge_client_id: input.bridgeClientId,
      client_scoped: Boolean(credential.client_id)
    },
    provisioning: {
      command: `curl -fsSL ${shellArg(bootstrapScriptUrl)} | ${argv
        .map((value) => shellArg(value))
        .join(" ")}`,
      argv,
      bootstrap_script_url: bootstrapScriptUrl,
      project_dir: projectDir,
      doctor_command: doctorArgv.map((value) => shellArg(value)).join(" "),
      doctor_argv: doctorArgv,
      bridge_command: bridgeArgv.map((value) => shellArg(value)).join(" "),
      bridge_argv: bridgeArgv,
      config_file: targetConfig.config_file,
      format: targetConfig.format,
      rendered_config: renderRemoteClientTargetConfig(null, targetConfig),
      mcp_config: targetConfig.mcp_config,
      secret_visibility: input.includeSecret ? "one_time_raw_secret" : "redacted_placeholder",
      local_runtime: {
        requires_docker: false,
        requires_postgres: false,
        requires_local_recallant_server: false,
        writes_project_client_config: true
      }
    },
    safety: {
      local_stdio_default_unchanged: true,
      requires_recallant_database_url: false,
      exposes_postgres: false,
      exposes_internal_server_paths: false,
      exposes_workbench_or_admin_auth: false,
      exposes_raw_artifacts_or_backups: false,
      exposes_provider_secrets: false
    }
  };
}

export const generatedMcpConfigFiles = [
  ".recallant/codex-mcp.json",
  ".recallant/generic-mcp.json"
] as const;
