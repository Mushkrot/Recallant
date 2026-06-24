import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const remoteMcpEndpointPath = "/api/mcp" as const;

export const remoteConnectBootstrapPath = "/connect" as const;
export const remoteConnectApprovePath = "/connect/approve" as const;
export const remoteConnectStartPath = "/api/connect/start" as const;
export const remoteConnectPollPath = "/api/connect/poll" as const;
export const remoteConnectCancelPath = "/api/connect/cancel" as const;

export const remoteConnectStatusValues = [
  "pending",
  "approved",
  "denied",
  "expired",
  "redeemed"
] as const;

export type RemoteConnectStatus = (typeof remoteConnectStatusValues)[number];

export const remoteConnectDefaultExpiresSeconds = 600 as const;

export type RemoteConnectStartRequest = {
  target?: string | null;
  project_id?: string | null;
  project_display_name?: string | null;
  project_fingerprint?: string | null;
  project_path_hint_redacted?: string | null;
  repo_remote_hash?: string | null;
  requested_by_ip_hash?: string | null;
  trusted_device_registration?: RemoteTrustedDeviceRegistration | null;
  trusted_device?: RemoteConnectTrustedDeviceStart | null;
  bootstrap_token?: string | null;
  consent_scope?: RemoteAgentConsentScope | null;
};

export type RemoteConnectStartResponse = {
  ok: true;
  request_id: string;
  device_code: string;
  poll_token: string;
  approve_url: string;
  expires_at: string;
  interval_seconds: number;
  approval_mode?: RemoteConnectApprovalMode;
  trusted_device?: RemoteConnectTrustedDeviceStartResult | null;
  bootstrap_token?: RemoteConnectBootstrapTokenStartResult | null;
};

export type RemoteConnectPollRequest = {
  poll_token: string;
};

export type RemoteConnectPollResponse =
  | {
      ok: true;
      status: "pending" | "denied" | "expired" | "redeemed";
      request_id: string | null;
      retry_after_seconds?: number;
      message?: string;
    }
  | {
      ok: true;
      status: "approved";
      approval_mode: RemoteConnectApprovalMode;
      request_id: string;
      bootstrap: {
        server_url: string;
        project_id: string;
        developer_id: string;
        client_id: string;
        target: RemoteMcpClientTarget;
      };
      one_time_secret: string;
      provisioning: RemoteMcpProvisioningOutput;
    };

export type RemoteConnectCancelRequest = {
  poll_token: string;
};

export type RemoteConnectApprovalMode = "human_approval" | "trusted_device" | "bootstrap_token";

export type RemoteTrustedDeviceStatus = "active" | "expired" | "revoked";

export const remoteTrustedDeviceDefaultExpiresSeconds = 90 * 24 * 60 * 60;

export type RemoteTrustedDeviceRegistration = {
  device_name: string;
  device_key_prefix: string;
  public_key_fingerprint: string;
  public_key_material: string;
  public_key_algorithm: "ed25519-v1" | "p256-v1" | "unknown";
  trust_expires_at?: string | null;
};

export type RemoteConnectTrustedDeviceStart = {
  device_key_prefix: string;
  public_key_fingerprint: string;
  public_key_material: string;
  challenge_nonce: string;
  challenge_signature: string;
  signature_algorithm: "ed25519-v1" | "p256-v1" | "unknown";
};

export type RemoteConnectTrustedDeviceStartResult =
  | {
      status: "approved";
      approval_mode: "trusted_device";
      browser_approval_required: false;
      device_key_prefix: string;
      public_key_fingerprint: string;
    }
  | {
      status: "fallback";
      reason:
        | "missing_device"
        | "invalid_device"
        | "invalid_signature"
        | "expired"
        | "revoked"
        | "replayed";
      browser_approval_required: true;
      device_key_prefix: string;
      public_key_fingerprint: string;
    }
  | {
      status: "pending_human_approval";
      browser_approval_required: true;
      device_key_prefix: string;
      public_key_fingerprint: string;
    };

export type RemoteConnectTrustedDeviceResult = {
  status: RemoteTrustedDeviceStatus;
  device_id: string;
  device_key_prefix: string;
  public_key_fingerprint: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export type RemoteConnectBootstrapTokenStatus = "active" | "expired" | "redeemed" | "revoked";

export const remoteConnectBootstrapTokenDefaultExpiresSeconds = 15 * 60;

export type RemoteConnectBootstrapTokenCreateRequest = {
  project_id?: string | null;
  developer_id: string;
  target?: RemoteMcpClientTarget | null;
  label?: string | null;
  allow_project_create?: boolean;
  expires_at?: string | null;
};

export type RemoteConnectBootstrapTokenCreateResponse = {
  ok: true;
  bootstrap_token: string;
  token_prefix: string;
  status: "active";
  project_id: string | null;
  developer_id: string;
  target: RemoteMcpClientTarget;
  expires_at: string;
};

export type RemoteConnectBootstrapTokenRedeemRequest = {
  bootstrap_token: string;
  project_display_name?: string | null;
  project_fingerprint?: string | null;
  project_path_hint_redacted?: string | null;
  client_id?: string | null;
  target?: RemoteMcpClientTarget | null;
};

export type RemoteConnectBootstrapTokenRedeemResponse = {
  ok: true;
  approval_mode: "bootstrap_token";
  token_prefix: string;
  project_id: string | null;
  developer_id: string;
  client_id: string;
  target: RemoteMcpClientTarget;
};

export type RemoteConnectBootstrapTokenStartResult = {
  status: "approved";
  approval_mode: "bootstrap_token";
  browser_approval_required: false;
  token_prefix: string;
};

export type RemoteConnectCredentialStoreReference = {
  kind: "local_file_v1" | "os_keychain" | "env_reference";
  key: string;
  display_path?: string | null;
  credential_prefix?: string | null;
};

export type RemoteAgentConsentScope = {
  destination: {
    server_url: string;
    endpoint_path: typeof remoteMcpEndpointPath;
  };
  credential_scope: {
    project_id: string | null;
    developer_id: string | null;
    client_id: string | null;
    credential_prefix?: string | null;
  };
  allowed_context: string[];
  redaction_boundary: string[];
  not_sent: string[];
  recommended_next_call: "memory_get_context_pack" | "recallant context";
};

export const remoteMcpTransport = "mcp_streamable_http" as const;

export const remoteMcpRequiredHeaders = [
  "Authorization",
  "X-Recallant-Project-Id",
  "X-Recallant-Developer-Id",
  "X-Recallant-Client-Id"
] as const;

export const remoteMcpOptionalHeaders = ["X-Recallant-Session-Id", "X-Recallant-Trace-Id"] as const;

export const remoteMcpAuthSchemes = ["Bearer", "Cloudflare-Access"] as const;

export const remoteMcpBridgeEnv = {
  serverUrl: "RECALLANT_REMOTE_MCP_URL",
  credential: "RECALLANT_REMOTE_MCP_CREDENTIAL",
  credentialRef: "RECALLANT_REMOTE_MCP_CREDENTIAL_REF",
  credentialStore: "RECALLANT_REMOTE_MCP_CREDENTIAL_STORE",
  projectId: "RECALLANT_PROJECT_ID",
  developerId: "RECALLANT_DEVELOPER_ID",
  clientId: "RECALLANT_REMOTE_MCP_CLIENT_ID",
  sessionId: "RECALLANT_REMOTE_MCP_SESSION_ID",
  traceId: "RECALLANT_REMOTE_MCP_TRACE_ID"
} as const;

export const remoteMcpBridgeFlags = {
  serverUrl: "--server-url",
  credential: "--credential",
  credentialRef: "--credential-ref",
  credentialStore: "--credential-store",
  projectId: "--project-id",
  developerId: "--developer-id",
  clientId: "--client-id",
  sessionId: "--session-id",
  traceId: "--trace-id"
} as const;

export const remoteMcpClientBootstrapScriptUrl =
  "https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-client-bootstrap.sh" as const;

export const remoteMcpForbiddenSurfaces = [
  "RECALLANT_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "authorization",
  "raw_auth",
  "admin_auth",
  "workbench_auth",
  "session_secret",
  "raw_artifacts",
  "raw_artifacts_path",
  "backup_path",
  "provider_keys",
  "provider_secret",
  "raw_request_body"
] as const;

export function remoteConnectApprovalUrl(serverUrl: string, deviceCode: string) {
  const url = new URL(remoteConnectApprovePath, serverUrl);
  url.searchParams.set("code", deviceCode);
  return url.toString();
}

export type RemoteMcpHeader = (typeof remoteMcpRequiredHeaders)[number];
export type RemoteMcpBridgeEnvName = (typeof remoteMcpBridgeEnv)[keyof typeof remoteMcpBridgeEnv];
export type RemoteMcpBridgeFlag = (typeof remoteMcpBridgeFlags)[keyof typeof remoteMcpBridgeFlags];

export const remoteMcpDoctorStageIds = [
  "url_validation",
  "network_reachability",
  "endpoint_shape",
  "edge_access_posture",
  "credential_auth",
  "scope",
  "mcp_initialize",
  "tools_list",
  "session_context_readiness",
  "checkpoint_state_proof",
  "semantic_memory_proof"
] as const;

export const remoteMcpDoctorResultCodes = {
  skipped: ["not_requested", "not_reached", "not_applicable"],
  pass: [
    "url_ok",
    "network_ok",
    "endpoint_ok",
    "edge_access_ok",
    "credential_ok",
    "scope_ok",
    "initialize_ok",
    "tools_list_ok",
    "session_context_readiness_ok",
    "checkpoint_state_proof_ok",
    "semantic_memory_proof_ok"
  ],
  warn: [
    "insecure_localhost_allowed",
    "session_context_readiness_unavailable",
    "checkpoint_state_proof_unavailable",
    "semantic_memory_proof_unavailable"
  ],
  fail: [
    "missing_required_input",
    "invalid_server_url",
    "non_https_url",
    "endpoint_unreachable",
    "wrong_endpoint",
    "edge_access_denied",
    "invalid_credential",
    "expired_credential",
    "revoked_credential",
    "rotated_credential",
    "project_scope_mismatch",
    "developer_scope_mismatch",
    "client_scope_mismatch",
    "initialize_failed",
    "tools_list_failed",
    "session_context_readiness_failed",
    "checkpoint_state_proof_failed",
    "semantic_memory_proof_failed",
    "forbidden_diagnostic_surface"
  ]
} as const;

export type RemoteMcpDoctorStageId = (typeof remoteMcpDoctorStageIds)[number];
export type RemoteMcpDoctorStageStatus = keyof typeof remoteMcpDoctorResultCodes;
export type RemoteMcpDoctorResultCode =
  (typeof remoteMcpDoctorResultCodes)[RemoteMcpDoctorStageStatus][number];

export type RemoteMcpDoctorStage = {
  id: RemoteMcpDoctorStageId;
  status: RemoteMcpDoctorStageStatus;
  code: RemoteMcpDoctorResultCode;
  message: string;
  http_status?: number | null;
  metadata?: Record<string, unknown>;
  remediation?: string | null;
};

export type RemoteMcpDoctorSummary = {
  ok: boolean;
  failed_stage_ids: RemoteMcpDoctorStageId[];
  warning_stage_ids: RemoteMcpDoctorStageId[];
  skipped_stage_ids: RemoteMcpDoctorStageId[];
};

export type RemoteMcpDoctorReport = {
  transport: typeof remoteMcpTransport;
  endpoint_path: typeof remoteMcpEndpointPath;
  generated_at: string;
  scope: {
    project_id: string | null;
    developer_id: string | null;
    client_id: string | null;
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
  summary: RemoteMcpDoctorSummary;
  stages: RemoteMcpDoctorStage[];
};

export type RemoteMcpClientTarget = "codex" | "cursor" | "claude_code" | "generic";

export type RemoteMcpServerConfig = {
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

export type RemoteClientTargetConfig = {
  target: RemoteMcpClientTarget;
  config_file: string;
  format: "codex_config_toml" | "cursor_mcp_json" | "claude_code_mcp_json" | "generic_mcp_json";
  client_specific: boolean;
  merge_mcp_servers: boolean;
  setup_hint: string;
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
  target: RemoteMcpClientTarget;
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

export type RemoteMcpBridgeConfigInput = {
  serverUrl?: string | null;
  credential?: string | null;
  credentialRef?: string | null;
  credentialStorePath?: string | null;
  projectId?: string | null;
  developerId?: string | null;
  clientId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
};

export type RemoteMcpBridgeConfig = {
  serverUrl: string;
  endpointUrl: string;
  credential: string;
  credentialRef: string | null;
  credentialStorePath: string | null;
  projectId: string;
  developerId: string;
  clientId: string;
  sessionId: string | null;
  traceId: string | null;
};

export type RemoteMcpCredentialStoreEntry = {
  credential: string;
  credential_prefix: string | null;
  server_url: string;
  project_id: string;
  developer_id: string;
  client_id: string;
  created_at: string;
  updated_at: string;
};

export type RemoteMcpCredentialStoreFile = {
  version: "remote-mcp-credential-store-v1";
  credentials: Record<string, RemoteMcpCredentialStoreEntry>;
};

export function remoteMcpCredentialStorePath(home = homedir()) {
  return join(home, ".config", "recallant", "remote-mcp-credentials.json");
}

export function remoteMcpCredentialStoreKey(input: {
  serverUrl: string;
  projectId: string;
  developerId: string;
  clientId: string;
}) {
  const hash = createHash("sha256")
    .update(
      [
        normalizeRemoteMcpBridgeServerUrl(input.serverUrl),
        input.projectId,
        input.developerId,
        input.clientId
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 24);
  return `rclcred_${hash}`;
}

function emptyRemoteMcpCredentialStore(): RemoteMcpCredentialStoreFile {
  return { version: "remote-mcp-credential-store-v1", credentials: {} };
}

function readRemoteMcpCredentialStore(path: string): RemoteMcpCredentialStoreFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RemoteMcpCredentialStoreFile>;
    if (parsed.version === "remote-mcp-credential-store-v1" && parsed.credentials) {
      return {
        version: "remote-mcp-credential-store-v1",
        credentials: parsed.credentials as Record<string, RemoteMcpCredentialStoreEntry>
      };
    }
  } catch {
    return emptyRemoteMcpCredentialStore();
  }
  return emptyRemoteMcpCredentialStore();
}

export function storeRemoteMcpCredential(input: {
  credential: string;
  serverUrl: string;
  projectId: string;
  developerId: string;
  clientId: string;
  credentialPrefix?: string | null;
  storePath?: string | null;
}) {
  const storePath = input.storePath?.trim() || remoteMcpCredentialStorePath();
  const key = remoteMcpCredentialStoreKey(input);
  const now = new Date().toISOString();
  const store = readRemoteMcpCredentialStore(storePath);
  const previous = store.credentials[key];
  store.credentials[key] = {
    credential: input.credential,
    credential_prefix: input.credentialPrefix ?? previous?.credential_prefix ?? null,
    server_url: normalizeRemoteMcpBridgeServerUrl(input.serverUrl),
    project_id: input.projectId,
    developer_id: input.developerId,
    client_id: input.clientId,
    created_at: previous?.created_at ?? now,
    updated_at: now
  };
  mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(storePath), 0o700);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(storePath, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
  return {
    kind: "local_file_v1" as const,
    key,
    display_path: storePath,
    credential_prefix: store.credentials[key].credential_prefix
  };
}

export function resolveRemoteMcpStoredCredential(input: {
  credential?: string | null;
  credentialRef?: string | null;
  credentialStorePath?: string | null;
}) {
  const explicit = optionalBridgeString(input.credential);
  if (explicit) return explicit;
  const credentialRef = optionalBridgeString(input.credentialRef);
  if (!credentialRef) return null;
  const storePath =
    optionalBridgeString(input.credentialStorePath) ?? remoteMcpCredentialStorePath();
  const store = readRemoteMcpCredentialStore(storePath);
  const credential = store.credentials[credentialRef]?.credential;
  return optionalBridgeString(credential);
}

export const remoteMcpHeaders = {
  required: remoteMcpRequiredHeaders,
  optional: remoteMcpOptionalHeaders
} as const;

export const remoteMcpErrorCodes = {
  UNAUTHORIZED: { httpStatus: 401, retryable: false },
  MISSING_PROJECT_OR_DEVELOPER_SCOPE: { httpStatus: 400, retryable: false },
  INVALID_SCOPE_TOKEN: { httpStatus: 401, retryable: false },
  PROJECT_SCOPE_MISMATCH: { httpStatus: 403, retryable: false },
  PROJECT_NOT_ATTACHED: { httpStatus: 404, retryable: false },
  FORBIDDEN_HEADER: { httpStatus: 400, retryable: false },
  PAYLOAD_TOO_LARGE: { httpStatus: 413, retryable: false },
  VALIDATION_ERROR: { httpStatus: 400, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  UNAVAILABLE: { httpStatus: 503, retryable: true }
} as const;

export const remoteMcpAuditFields = [
  "trace_id",
  "request_id",
  "project_id",
  "developer_id",
  "client_id",
  "operation",
  "http_status",
  "duration_ms",
  "error_code"
] as const;

export const remoteMcpRedactionPolicy = {
  tokenLike: ["client_secret", "authorization", "session_secret", "raw_auth"],
  dbUrl: ["RECALLANT_DATABASE_URL"],
  requestBody: "bounded_summary"
} as const;

export const remoteMcpRateLimits = {
  startupPerMinute: 60,
  toolPerMinute: 120
} as const;

export const remoteMcpPayloadLimits = {
  responseBytes: 10 * 1024 * 1024,
  requestWarningBytes: 4 * 1024 * 1024,
  requestHardBytes: 8 * 1024 * 1024
} as const;

const remoteMcpForbiddenDiagnosticKeyPattern =
  /^(?:RECALLANT_DATABASE_URL|DATABASE_URL|POSTGRES_URL|authorization|raw_auth|admin_auth|workbench_auth|admin_token|session_secret|client_secret|raw_request_body|raw_artifacts?|raw_artifacts_path|backup_path|provider_keys?|provider_secret|provider_key|openai_api_key|anthropic_api_key)$/i;

const remoteMcpForbiddenDiagnosticValuePattern =
  /\b(?:RECALLANT_DATABASE_URL|DATABASE_URL|POSTGRES_URL|postgres(?:ql)?:\/\/|bearer\s+[A-Za-z0-9._~+/=-]{8,}|authorization|workbench[_-]?auth|admin[_-]?auth|raw[_-]?artifacts?|backup[_-]?path|provider[_-]?(?:secret|key)s?|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key)\b/gi;

export function redactRemoteMcpDoctorValue(
  value: unknown,
  rawSecrets: readonly string[] = []
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const exactSecret = rawSecrets.find((secret) => secret.length > 0 && value.includes(secret));
    return (exactSecret ? value.replaceAll(exactSecret, "<redacted>") : value).replaceAll(
      remoteMcpForbiddenDiagnosticValuePattern,
      "<redacted>"
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactRemoteMcpDoctorValue(item, rawSecrets));
  }
  if (typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (remoteMcpForbiddenDiagnosticKeyPattern.test(key)) {
        redacted[key] = "<redacted>";
      } else {
        redacted[key] = redactRemoteMcpDoctorValue(nestedValue, rawSecrets);
      }
    }
    return redacted;
  }
  return String(value);
}

export function remoteMcpDoctorStage(input: RemoteMcpDoctorStage): RemoteMcpDoctorStage {
  return {
    ...input,
    message: String(redactRemoteMcpDoctorValue(input.message)),
    metadata: input.metadata
      ? (redactRemoteMcpDoctorValue(input.metadata) as Record<string, unknown>)
      : undefined,
    remediation: input.remediation ? String(redactRemoteMcpDoctorValue(input.remediation)) : null
  };
}

export function summarizeRemoteMcpDoctorStages(
  stages: readonly RemoteMcpDoctorStage[]
): RemoteMcpDoctorSummary {
  return {
    ok: !stages.some((stage) => stage.status === "fail"),
    failed_stage_ids: stages.filter((stage) => stage.status === "fail").map((stage) => stage.id),
    warning_stage_ids: stages.filter((stage) => stage.status === "warn").map((stage) => stage.id),
    skipped_stage_ids: stages.filter((stage) => stage.status === "skipped").map((stage) => stage.id)
  };
}

export function remoteMcpDoctorReport(input: {
  generatedAt?: string;
  projectId?: string | null;
  developerId?: string | null;
  clientId?: string | null;
  stages: readonly RemoteMcpDoctorStage[];
}): RemoteMcpDoctorReport {
  const stages = input.stages.map((stage) => remoteMcpDoctorStage(stage));
  return {
    transport: remoteMcpTransport,
    endpoint_path: remoteMcpEndpointPath,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    scope: {
      project_id: input.projectId ?? null,
      developer_id: input.developerId ?? null,
      client_id: input.clientId ?? null
    },
    safety: {
      local_stdio_default_unchanged: true,
      requires_recallant_database_url: false,
      exposes_postgres: false,
      exposes_internal_server_paths: false,
      exposes_workbench_or_admin_auth: false,
      exposes_raw_artifacts_or_backups: false,
      exposes_provider_secrets: false
    },
    summary: summarizeRemoteMcpDoctorStages(stages),
    stages
  };
}

function requiredBridgeString(value: string | null | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`VALIDATION_ERROR: ${name} is required for remote MCP bridge`);
  return normalized;
}

function optionalBridgeString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeRemoteMcpClientTarget(raw: string | null | undefined): RemoteMcpClientTarget {
  const normalized = (raw ?? "codex").trim().toLowerCase().replace(/\s+/g, "_");
  const aliased = normalized === "claude-code" ? "claude_code" : normalized;
  if (aliased === "codex" || aliased === "cursor" || aliased === "claude_code") return aliased;
  return "generic";
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

export function normalizeRemoteMcpBridgeServerUrl(serverUrl: string) {
  const normalized = serverUrl.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("VALIDATION_ERROR: remote MCP bridge server URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("VALIDATION_ERROR: remote MCP bridge server URL must use http or https");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function remoteMcpBridgeEndpointUrl(serverUrl: string) {
  const normalized = normalizeRemoteMcpBridgeServerUrl(serverUrl);
  return `${normalized}${remoteMcpEndpointPath}`;
}

export function validateRemoteMcpBridgeConfig(
  input: RemoteMcpBridgeConfigInput
): RemoteMcpBridgeConfig {
  const serverUrl = normalizeRemoteMcpBridgeServerUrl(
    requiredBridgeString(input.serverUrl, remoteMcpBridgeEnv.serverUrl)
  );
  const credential = resolveRemoteMcpStoredCredential(input);
  return {
    serverUrl,
    endpointUrl: remoteMcpBridgeEndpointUrl(serverUrl),
    credential: requiredBridgeString(
      credential,
      `${remoteMcpBridgeEnv.credential} or ${remoteMcpBridgeEnv.credentialRef}`
    ),
    credentialRef: optionalBridgeString(input.credentialRef),
    credentialStorePath: optionalBridgeString(input.credentialStorePath),
    projectId: requiredBridgeString(input.projectId, remoteMcpBridgeEnv.projectId),
    developerId: requiredBridgeString(input.developerId, remoteMcpBridgeEnv.developerId),
    clientId: requiredBridgeString(input.clientId, remoteMcpBridgeEnv.clientId),
    sessionId: optionalBridgeString(input.sessionId),
    traceId: optionalBridgeString(input.traceId)
  };
}

export function remoteMcpBridgeHeaders(input: RemoteMcpBridgeConfigInput) {
  const config = validateRemoteMcpBridgeConfig(input);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${config.credential}`,
    "X-Recallant-Project-Id": config.projectId,
    "X-Recallant-Developer-Id": config.developerId,
    "X-Recallant-Client-Id": config.clientId
  };
  if (config.sessionId) headers["X-Recallant-Session-Id"] = config.sessionId;
  if (config.traceId) headers["X-Recallant-Trace-Id"] = config.traceId;
  return headers;
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
  if (input.credentialStorePath)
    env.RECALLANT_REMOTE_MCP_CREDENTIAL_STORE = input.credentialStorePath;
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

export function codexRemoteMcpServerToml(config: RemoteMcpServerConfig) {
  const recallant = config.mcpServers.recallant;
  return [
    "[mcp_servers.recallant]",
    `command = ${tomlString(recallant.command)}`,
    `args = ${tomlStringArray(recallant.args)}`,
    `env = ${tomlInlineStringMap(recallant.env)}`
  ].join("\n");
}

export function remoteClientTargetConfig(
  rawTarget: string | null | undefined,
  input: RemoteMcpBridgeConfigInput
): RemoteClientTargetConfig {
  const target = normalizeRemoteMcpClientTarget(rawTarget);
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
    client_specific: true,
    merge_mcp_servers: false,
    setup_hint:
      "Use this generic remote MCP stdio config with any client that supports custom MCP servers.",
    mcp_config,
    remote: true
  };
}

export function renderRemoteClientTargetConfig(targetConfig: RemoteClientTargetConfig) {
  if (targetConfig.format === "codex_config_toml") {
    return `${codexRemoteMcpServerToml(targetConfig.mcp_config)}\n`;
  }
  return `${JSON.stringify(targetConfig.mcp_config, null, 2)}\n`;
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
  const target = normalizeRemoteMcpClientTarget(input.target);
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
      rendered_config: renderRemoteClientTargetConfig(targetConfig),
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

export type RemoteMcpErrorCode = keyof typeof remoteMcpErrorCodes;
export type RemoteMcpRequiredHeader = (typeof remoteMcpRequiredHeaders)[number];
export type RemoteMcpOptionalHeader = (typeof remoteMcpOptionalHeaders)[number];
