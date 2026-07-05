import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  remoteMcpBridgeEndpointUrl,
  remoteMcpBridgeFlags,
  remoteMcpBridgeHeaders,
  remoteMcpDoctorReport,
  remoteMcpDoctorStage,
  remoteMcpDoctorStageIds,
  redactRemoteMcpDoctorValue,
  resolveRemoteMcpStoredCredential,
  type RemoteMcpDoctorReport,
  type RemoteMcpDoctorResultCode,
  type RemoteMcpDoctorStage,
  type RemoteMcpDoctorStageId,
  type RemoteMcpDoctorStageStatus
} from "@recallant/contracts";

type RemoteDoctorOptions = {
  projectDir: string | null;
  serverUrl: string | null;
  credential: string | null;
  credentialRef: string | null;
  credentialStorePath: string | null;
  projectId: string | null;
  developerId: string | null;
  clientId: string | null;
  sessionId: string | null;
  traceId: string | null;
  format: "json" | "text";
  timeoutMs: number;
  captureProof: boolean;
  semanticProof: boolean;
  allowInsecureLocalhost: boolean;
};

type JsonRpcResult = {
  ok: boolean;
  httpStatus: number | null;
  json: Record<string, unknown> | null;
  text: string;
  contentType: string;
  error: string | null;
};

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(argv: readonly string[], name: string) {
  return argv.includes(name);
}

function normalizedOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function readText(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function remoteConfigValue(content: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = content.match(new RegExp(`${escaped}\\s*[:=]\\s*"([^"]+)"`));
  if (quoted?.[1]) return quoted[1];
  const bare = content.match(new RegExp(`${escaped}\\s*[:=]\\s*([^,}\\n\\r]+)`));
  return bare?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? null;
}

type RemoteDoctorProjectConfig = {
  serverUrl: string | null;
  credentialRef: string | null;
  credentialStorePath: string | null;
  projectId: string | null;
  developerId: string | null;
  clientId: string | null;
  sessionId: string | null;
  traceId: string | null;
};

function emptyRemoteDoctorProjectConfig(): RemoteDoctorProjectConfig {
  return {
    serverUrl: null,
    credentialRef: null,
    credentialStorePath: null,
    projectId: null,
    developerId: null,
    clientId: null,
    sessionId: null,
    traceId: null
  };
}

function readRemoteDoctorProjectConfig(projectDir: string | null): RemoteDoctorProjectConfig {
  if (!projectDir) return emptyRemoteDoctorProjectConfig();
  const receipt = readText(join(projectDir, ".recallant", "remote-consent.json"));
  if (receipt) {
    try {
      const parsed = JSON.parse(receipt) as Record<string, unknown>;
      const consentScope =
        parsed.consent_scope && typeof parsed.consent_scope === "object"
          ? (parsed.consent_scope as Record<string, unknown>)
          : null;
      const destination =
        consentScope?.destination && typeof consentScope.destination === "object"
          ? (consentScope.destination as Record<string, unknown>)
          : null;
      const credentialScope =
        consentScope?.credential_scope && typeof consentScope.credential_scope === "object"
          ? (consentScope.credential_scope as Record<string, unknown>)
          : null;
      if (parsed.kind === "recallant_remote_agent_consent" && destination && credentialScope) {
        return {
          serverUrl: normalizedOptional(String(destination.server_url ?? "")),
          credentialRef: normalizedOptional(String(parsed.credential_ref ?? "")),
          credentialStorePath: normalizedOptional(String(parsed.credential_store_path ?? "")),
          projectId: normalizedOptional(String(credentialScope.project_id ?? "")),
          developerId: normalizedOptional(String(credentialScope.developer_id ?? "")),
          clientId: normalizedOptional(String(credentialScope.client_id ?? "")),
          sessionId: null,
          traceId: null
        };
      }
    } catch {
      // Ignore malformed receipts and fall back to client config discovery.
    }
  }

  const candidates = [
    ".codex/config.toml",
    ".cursor/mcp.json",
    ".mcp.json",
    ".recallant/generic-remote-mcp.json"
  ];
  for (const candidate of candidates) {
    const content = readText(join(projectDir, candidate));
    if (!content?.includes("RECALLANT_REMOTE_MCP_URL") || !content.includes("remote-bridge")) {
      continue;
    }
    return {
      serverUrl: normalizedOptional(remoteConfigValue(content, "RECALLANT_REMOTE_MCP_URL")),
      credentialRef: normalizedOptional(
        remoteConfigValue(content, "RECALLANT_REMOTE_MCP_CREDENTIAL_REF")
      ),
      credentialStorePath: normalizedOptional(
        remoteConfigValue(content, "RECALLANT_REMOTE_MCP_CREDENTIAL_STORE")
      ),
      projectId: normalizedOptional(remoteConfigValue(content, "RECALLANT_PROJECT_ID")),
      developerId: normalizedOptional(remoteConfigValue(content, "RECALLANT_DEVELOPER_ID")),
      clientId: normalizedOptional(remoteConfigValue(content, "RECALLANT_REMOTE_MCP_CLIENT_ID")),
      sessionId: normalizedOptional(remoteConfigValue(content, "RECALLANT_REMOTE_MCP_SESSION_ID")),
      traceId: normalizedOptional(remoteConfigValue(content, "RECALLANT_REMOTE_MCP_TRACE_ID"))
    };
  }
  return emptyRemoteDoctorProjectConfig();
}

function readOptions(argv: readonly string[]): RemoteDoctorOptions {
  const format = hasFlag(argv, "--json") ? "json" : (parseFlag(argv, "--format") ?? "text");
  if (format !== "json" && format !== "text") {
    throw new Error("VALIDATION_ERROR: --format must be json or text");
  }
  const timeoutRaw = parseFlag(argv, "--timeout-ms");
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 8_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("VALIDATION_ERROR: --timeout-ms must be a positive number");
  }
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const projectConfig = readRemoteDoctorProjectConfig(projectDir);
  const credentialRef =
    normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.credentialRef)) ??
    projectConfig.credentialRef;
  const credentialStorePath =
    normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.credentialStore)) ??
    projectConfig.credentialStorePath;
  const credential =
    normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.credential)) ??
    resolveRemoteMcpStoredCredential({ credentialRef, credentialStorePath });
  return {
    projectDir,
    serverUrl:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.serverUrl)) ??
      projectConfig.serverUrl,
    credential,
    credentialRef,
    credentialStorePath,
    projectId:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.projectId)) ??
      projectConfig.projectId,
    developerId:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.developerId)) ??
      projectConfig.developerId,
    clientId:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.clientId)) ?? projectConfig.clientId,
    sessionId:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.sessionId)) ??
      projectConfig.sessionId,
    traceId:
      normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.traceId)) ?? projectConfig.traceId,
    format,
    timeoutMs,
    captureProof: hasFlag(argv, "--capture-proof") || hasFlag(argv, "--semantic-proof"),
    semanticProof: hasFlag(argv, "--semantic-proof"),
    allowInsecureLocalhost: hasFlag(argv, "--allow-insecure-localhost")
  };
}

function stage(
  id: RemoteMcpDoctorStageId,
  status: RemoteMcpDoctorStageStatus,
  code: RemoteMcpDoctorResultCode,
  message: string,
  extra: Omit<RemoteMcpDoctorStage, "id" | "status" | "code" | "message"> = {}
) {
  return remoteMcpDoctorStage({
    id,
    status,
    code,
    message,
    ...extra
  });
}

function skippedStage(id: RemoteMcpDoctorStageId, message = "Not reached.") {
  return stage(id, "skipped", "not_reached", message);
}

function skippedProofStages(message = "Not reached.") {
  return [
    skippedStage("session_context_readiness", message),
    skippedStage("checkpoint_state_proof", message),
    skippedStage("semantic_memory_proof", message)
  ];
}

function validationReport(options: RemoteDoctorOptions, stages: RemoteMcpDoctorStage[]) {
  for (const id of remoteMcpDoctorStageIds) {
    if (!stages.some((stageEntry) => stageEntry.id === id)) stages.push(skippedStage(id));
  }
  return remoteMcpDoctorReport({
    projectId: options.projectId,
    developerId: options.developerId,
    clientId: options.clientId,
    stages
  });
}

function isLocalhostUrl(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function validateBeforeNetwork(options: RemoteDoctorOptions) {
  const stages: RemoteMcpDoctorStage[] = [];
  const missing = [
    [remoteMcpBridgeFlags.serverUrl, options.serverUrl],
    [
      `${remoteMcpBridgeFlags.credential} or ${remoteMcpBridgeFlags.credentialRef}`,
      options.credential
    ],
    [remoteMcpBridgeFlags.projectId, options.projectId],
    [remoteMcpBridgeFlags.developerId, options.developerId],
    [remoteMcpBridgeFlags.clientId, options.clientId]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    stages.push(
      stage(
        "url_validation",
        "fail",
        "missing_required_input",
        `Missing required remote doctor input: ${missing.join(", ")}.`,
        {
          metadata: { missing_flags: missing },
          remediation:
            "Provide only the scoped remote MCP credential plus project, developer, and client ids."
        }
      )
    );
    return validationReport(options, stages);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.serverUrl ?? "");
  } catch {
    stages.push(
      stage("url_validation", "fail", "invalid_server_url", "Remote MCP server URL is invalid.", {
        remediation: "Use an HTTPS Recallant server origin, not an internal path."
      })
    );
    return validationReport(options, stages);
  }
  if (parsedUrl.protocol !== "https:") {
    if (
      !(
        options.allowInsecureLocalhost &&
        parsedUrl.protocol === "http:" &&
        isLocalhostUrl(parsedUrl)
      )
    ) {
      stages.push(
        stage("url_validation", "fail", "non_https_url", "Remote MCP diagnostics require HTTPS.", {
          metadata: { protocol: parsedUrl.protocol.replace(":", "") },
          remediation: "Use the public HTTPS Recallant server origin."
        })
      );
      return validationReport(options, stages);
    }
    stages.push(
      stage(
        "url_validation",
        "warn",
        "insecure_localhost_allowed",
        "Insecure localhost URL accepted for deterministic local diagnostics only.",
        { metadata: { protocol: "http", host: parsedUrl.host } }
      )
    );
  } else {
    stages.push(stage("url_validation", "pass", "url_ok", "Remote MCP server URL is HTTPS."));
  }
  return null;
}

function jsonRpcBody(id: number, method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function postJsonRpc(
  options: RemoteDoctorOptions,
  method: string,
  params: Record<string, unknown> = {},
  id = 1
): Promise<JsonRpcResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const endpointUrl = remoteMcpBridgeEndpointUrl(options.serverUrl ?? "");
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: remoteMcpBridgeHeaders({
        serverUrl: options.serverUrl,
        credential: options.credential,
        projectId: options.projectId,
        developerId: options.developerId,
        clientId: options.clientId,
        sessionId: options.sessionId,
        traceId: options.traceId
      }),
      body: jsonRpcBody(id, method, params),
      signal: controller.signal
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok && Boolean(json) && !json?.error,
      httpStatus: response.status,
      json,
      text,
      contentType,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      json: null,
      text: "",
      contentType: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function errorCodeFromJson(result: JsonRpcResult) {
  const error = result.json?.error;
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  return String(data?.code ?? record.code ?? record.message ?? "");
}

function classifyCredentialCode(result: JsonRpcResult): RemoteMcpDoctorResultCode {
  const raw = (errorCodeFromJson(result) ?? "").toLowerCase();
  if (/expired/.test(raw)) return "expired_credential";
  if (/revoked/.test(raw)) return "revoked_credential";
  if (/rotated/.test(raw)) return "rotated_credential";
  return "invalid_credential";
}

function classifyScopeCode(result: JsonRpcResult): RemoteMcpDoctorResultCode {
  const raw = (errorCodeFromJson(result) ?? "").toLowerCase();
  if (/developer/.test(raw)) return "developer_scope_mismatch";
  if (/client/.test(raw)) return "client_scope_mismatch";
  return "project_scope_mismatch";
}

function isHtmlDenied(result: JsonRpcResult) {
  return (
    (result.httpStatus === 401 || result.httpStatus === 403) &&
    (/html/i.test(result.contentType) || /<html|cloudflare|access denied/i.test(result.text))
  );
}

function toolsFromList(result: JsonRpcResult) {
  const payload = result.json?.result as Record<string, unknown> | undefined;
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  return tools
    .map((tool) =>
      tool && typeof tool === "object" ? String((tool as Record<string, unknown>).name ?? "") : ""
    )
    .filter(Boolean);
}

function sessionIdFromToolCall(result: JsonRpcResult) {
  const structuredContent = structuredContentFromToolCall(result);
  if (typeof structuredContent?.session_id === "string") return structuredContent.session_id;
  const payload = result.json?.result as Record<string, unknown> | undefined;
  const content = Array.isArray(payload?.content) ? payload.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.session_id === "string") return parsed.session_id;
    } catch {
      continue;
    }
  }
  return null;
}

function structuredContentFromToolCall(result: JsonRpcResult) {
  const payload = result.json?.result as Record<string, unknown> | undefined;
  return payload?.structuredContent && typeof payload.structuredContent === "object"
    ? (payload.structuredContent as Record<string, unknown>)
    : null;
}

function resultContains(result: JsonRpcResult, value: string) {
  return JSON.stringify(result.json?.result ?? result.json ?? {}).includes(value);
}

function checkpointContainsMarker(result: JsonRpcResult, marker: string) {
  const structured = structuredContentFromToolCall(result);
  const payload =
    structured?.payload && typeof structured.payload === "object"
      ? (structured.payload as Record<string, unknown>)
      : null;
  return payload?.current_focus === marker || resultContains(result, marker);
}

async function runProbes(options: RemoteDoctorOptions, initialStages: RemoteMcpDoctorStage[]) {
  const initialize = await postJsonRpc(
    options,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "recallant-remote-doctor", version: "0.0.0" }
    },
    1
  );
  if (initialize.error) {
    return [
      ...initialStages,
      stage(
        "network_reachability",
        "fail",
        "endpoint_unreachable",
        "Remote MCP endpoint is unreachable.",
        {
          metadata: { error: initialize.error },
          remediation:
            "Check DNS, HTTPS/TLS, firewall, and edge routing before checking Recallant auth."
        }
      ),
      skippedStage("endpoint_shape"),
      skippedStage("edge_access_posture"),
      skippedStage("credential_auth"),
      skippedStage("scope"),
      skippedStage("mcp_initialize"),
      skippedStage("tools_list"),
      ...skippedProofStages()
    ];
  }

  const stages = [
    ...initialStages,
    stage("network_reachability", "pass", "network_ok", "Remote MCP endpoint returned HTTP.", {
      http_status: initialize.httpStatus
    })
  ];

  if (isHtmlDenied(initialize)) {
    stages.push(
      stage(
        "edge_access_posture",
        "fail",
        "edge_access_denied",
        "Edge or access layer denied the request before Recallant MCP.",
        {
          http_status: initialize.httpStatus,
          metadata: { content_type: initialize.contentType },
          remediation: "Check Cloudflare Access or edge policy for the remote host."
        }
      ),
      skippedStage("endpoint_shape"),
      skippedStage("credential_auth"),
      skippedStage("scope"),
      skippedStage("mcp_initialize"),
      skippedStage("tools_list"),
      ...skippedProofStages()
    );
    return stages;
  }

  if (!initialize.json) {
    stages.push(
      stage("endpoint_shape", "fail", "wrong_endpoint", "Endpoint did not return JSON-RPC JSON.", {
        http_status: initialize.httpStatus,
        metadata: { content_type: initialize.contentType },
        remediation:
          "Point --server-url at the Recallant server origin; the command appends /api/mcp."
      }),
      skippedStage("edge_access_posture"),
      skippedStage("credential_auth"),
      skippedStage("scope"),
      skippedStage("mcp_initialize"),
      skippedStage("tools_list"),
      ...skippedProofStages()
    );
    return stages;
  }

  stages.push(stage("endpoint_shape", "pass", "endpoint_ok", "Endpoint returned JSON-RPC JSON."));
  stages.push(
    stage("edge_access_posture", "pass", "edge_access_ok", "No edge/access denial detected.")
  );

  if (initialize.httpStatus === 401) {
    stages.push(
      stage(
        "credential_auth",
        "fail",
        classifyCredentialCode(initialize),
        "Scoped credential was rejected.",
        {
          http_status: initialize.httpStatus,
          metadata: { error_code: errorCodeFromJson(initialize) },
          remediation: "Create or rotate a scoped remote MCP credential."
        }
      ),
      skippedStage("scope"),
      skippedStage("mcp_initialize"),
      skippedStage("tools_list"),
      ...skippedProofStages()
    );
    return stages;
  }
  stages.push(stage("credential_auth", "pass", "credential_ok", "Scoped credential was accepted."));

  if (initialize.httpStatus === 403 || initialize.httpStatus === 404) {
    stages.push(
      stage(
        "scope",
        "fail",
        classifyScopeCode(initialize),
        "Credential scope does not match request scope.",
        {
          http_status: initialize.httpStatus,
          metadata: { error_code: errorCodeFromJson(initialize) },
          remediation: "Verify project, developer, and client ids against the credential scope."
        }
      ),
      skippedStage("mcp_initialize"),
      skippedStage("tools_list"),
      ...skippedProofStages()
    );
    return stages;
  }
  stages.push(stage("scope", "pass", "scope_ok", "Project, developer, and client scope accepted."));

  if (!initialize.ok) {
    stages.push(
      stage("mcp_initialize", "fail", "initialize_failed", "MCP initialize failed.", {
        http_status: initialize.httpStatus,
        metadata: { error_code: errorCodeFromJson(initialize) },
        remediation: "Check server MCP readiness after auth and scope are accepted."
      }),
      skippedStage("tools_list"),
      ...skippedProofStages()
    );
    return stages;
  }
  stages.push(stage("mcp_initialize", "pass", "initialize_ok", "MCP initialize succeeded."));

  const toolsList = await postJsonRpc(options, "tools/list", {}, 2);
  if (!toolsList.ok) {
    stages.push(
      stage("tools_list", "fail", "tools_list_failed", "MCP tools/list failed.", {
        http_status: toolsList.httpStatus,
        metadata: { error_code: errorCodeFromJson(toolsList), content_type: toolsList.contentType },
        remediation: "Check remote MCP server tool registration."
      }),
      ...skippedProofStages()
    );
    return stages;
  }

  const toolNames = toolsFromList(toolsList);
  stages.push(
    stage("tools_list", "pass", "tools_list_ok", "MCP tools/list succeeded.", {
      http_status: toolsList.httpStatus,
      metadata: { tool_names: toolNames }
    })
  );

  if (!options.captureProof && !options.semanticProof) {
    stages.push(
      stage(
        "session_context_readiness",
        "skipped",
        "not_requested",
        "Session/context readiness proof was not requested."
      ),
      stage(
        "checkpoint_state_proof",
        "skipped",
        "not_requested",
        "Checkpoint state proof was not requested."
      ),
      stage(
        "semantic_memory_proof",
        "skipped",
        "not_requested",
        "Semantic governed-memory proof was not requested."
      )
    );
    return stages;
  }

  let startedSessionId: string | null = null;
  const marker = `remote-doctor-semantic-proof:${randomUUID()}`;

  if (
    !toolNames.includes("memory_start_session") ||
    !toolNames.includes("memory_get_context_pack")
  ) {
    stages.push(
      stage(
        "session_context_readiness",
        "warn",
        "session_context_readiness_unavailable",
        "Session/context readiness proof tools are unavailable.",
        {
          metadata: { required_tools: ["memory_start_session", "memory_get_context_pack"] },
          remediation:
            "Transport is ready; enable or expose memory_start_session and memory_get_context_pack before using session/context readiness proof."
        }
      )
    );
  } else {
    const startSession = await postJsonRpc(
      options,
      "tools/call",
      {
        name: "memory_start_session",
        arguments: {
          client_kind: "codex",
          client_version: "0.0.0",
          project_path: null,
          session_label: "remote MCP doctor session/context readiness proof",
          resume_policy: "force_new"
        }
      },
      3
    );
    startedSessionId = sessionIdFromToolCall(startSession);
    if (!startSession.ok || !startedSessionId) {
      stages.push(
        stage(
          "session_context_readiness",
          "fail",
          "session_context_readiness_failed",
          "Session/context readiness session start failed.",
          {
            http_status: startSession.httpStatus,
            metadata: { error_code: errorCodeFromJson(startSession) },
            remediation: "Transport is ready; inspect memory_start_session readiness separately."
          }
        )
      );
    } else {
      const proof = await postJsonRpc(
        options,
        "tools/call",
        {
          name: "memory_get_context_pack",
          arguments: {
            session_id: options.sessionId ?? startedSessionId,
            task_hint: "remote MCP doctor session/context readiness proof",
            project_id: null,
            include_raw_evidence: "never",
            include_recovery: false
          }
        },
        4
      );
      if (!proof.ok) {
        stages.push(
          stage(
            "session_context_readiness",
            "fail",
            "session_context_readiness_failed",
            "Session/context readiness context-pack call failed.",
            {
              http_status: proof.httpStatus,
              metadata: { error_code: errorCodeFromJson(proof) },
              remediation:
                "Transport is ready; inspect memory_get_context_pack readiness separately."
            }
          )
        );
      } else {
        stages.push(
          stage(
            "session_context_readiness",
            "pass",
            "session_context_readiness_ok",
            "Session/context readiness proof succeeded.",
            {
              http_status: proof.httpStatus,
              metadata: {
                tool_names: ["memory_start_session", "memory_get_context_pack"],
                session_id_observed: true
              }
            }
          )
        );
      }
    }
  }

  if (!options.semanticProof) {
    stages.push(
      stage(
        "checkpoint_state_proof",
        "skipped",
        "not_requested",
        "Checkpoint state proof was not requested."
      ),
      stage(
        "semantic_memory_proof",
        "skipped",
        "not_requested",
        "Semantic governed-memory proof was not requested."
      )
    );
    return stages;
  }

  if (
    !toolNames.includes("memory_set_checkpoint") ||
    !toolNames.includes("memory_get_checkpoint")
  ) {
    stages.push(
      stage(
        "checkpoint_state_proof",
        "warn",
        "checkpoint_state_proof_unavailable",
        "Checkpoint state proof tools are unavailable.",
        {
          metadata: { required_tools: ["memory_set_checkpoint", "memory_get_checkpoint"] },
          remediation:
            "Transport is ready; expose memory_set_checkpoint and memory_get_checkpoint before using checkpoint state proof."
        }
      )
    );
  } else {
    const checkpointPayload = {
      current_status: "remote doctor semantic proof running",
      current_focus: marker,
      next_step: "Verify recall of the remote doctor semantic proof marker.",
      open_questions: []
    };
    const setCheckpoint = await postJsonRpc(
      options,
      "tools/call",
      { name: "memory_set_checkpoint", arguments: { payload: checkpointPayload } },
      5
    );
    if (!setCheckpoint.ok) {
      stages.push(
        stage(
          "checkpoint_state_proof",
          "fail",
          "checkpoint_state_proof_failed",
          "Checkpoint state write failed.",
          {
            http_status: setCheckpoint.httpStatus,
            metadata: { error_code: errorCodeFromJson(setCheckpoint), marker },
            remediation:
              "Transport is ready; inspect memory_set_checkpoint separately from semantic recall."
          }
        )
      );
    } else {
      const getCheckpoint = await postJsonRpc(
        options,
        "tools/call",
        { name: "memory_get_checkpoint", arguments: {} },
        6
      );
      const markerFound = getCheckpoint.ok && checkpointContainsMarker(getCheckpoint, marker);
      stages.push(
        stage(
          "checkpoint_state_proof",
          markerFound ? "pass" : "fail",
          markerFound ? "checkpoint_state_proof_ok" : "checkpoint_state_proof_failed",
          markerFound
            ? "Checkpoint state write/read proof succeeded."
            : "Checkpoint state readback did not return the diagnostic marker.",
          {
            http_status: getCheckpoint.httpStatus,
            metadata: {
              error_code: getCheckpoint.ok ? null : errorCodeFromJson(getCheckpoint),
              tool_names: ["memory_set_checkpoint", "memory_get_checkpoint"],
              marker,
              marker_found: markerFound
            },
            remediation: markerFound
              ? null
              : "Inspect checkpoint state separately; semantic governed-memory proof can still be evaluated independently."
          }
        )
      );
    }
  }

  if (
    !toolNames.includes("memory_create_agent_memory") ||
    !toolNames.includes("memory_recall_agent_memories")
  ) {
    stages.push(
      stage(
        "semantic_memory_proof",
        "warn",
        "semantic_memory_proof_unavailable",
        "Semantic governed-memory proof tools are unavailable.",
        {
          metadata: {
            required_tools: ["memory_create_agent_memory", "memory_recall_agent_memories"]
          },
          remediation:
            "Transport is ready; expose governed memory create and recall tools before using semantic proof."
        }
      )
    );
    return stages;
  }

  const memoryArguments = {
    memory_type: "work_log",
    scope: "project",
    scope_kind: null,
    scope_id: null,
    audience: [{ kind: "all_agents", id: null }],
    title: "Remote doctor semantic marker",
    body: marker,
    confidence: 1,
    source_refs: [],
    created_by: "agent",
    metadata: {
      diagnostic_marker: true,
      diagnostic_kind: "remote_doctor_semantic_proof",
      marker_id: marker
    }
  };
  const created = await postJsonRpc(
    options,
    "tools/call",
    { name: "memory_create_agent_memory", arguments: memoryArguments },
    7
  );
  if (!created.ok) {
    stages.push(
      stage(
        "semantic_memory_proof",
        "fail",
        "semantic_memory_proof_failed",
        "Semantic governed-memory marker creation failed.",
        {
          http_status: created.httpStatus,
          metadata: {
            error_code: errorCodeFromJson(created),
            marker,
            memory_type: memoryArguments.memory_type,
            scope: memoryArguments.scope,
            created_by: memoryArguments.created_by,
            audience: memoryArguments.audience,
            diagnostic_marker: true
          },
          remediation:
            "Transport is ready; inspect memory_create_agent_memory validation and governance policy."
        }
      )
    );
    return stages;
  }

  const recall = await postJsonRpc(
    options,
    "tools/call",
    {
      name: "memory_recall_agent_memories",
      arguments: {
        query: marker,
        scope: "project",
        scope_kind: null,
        audience_kind: null,
        memory_types: ["work_log"],
        include_candidates: true,
        include_stale: false,
        include_needs_review: true,
        top_k: 5,
        max_chars_total: 4000
      }
    },
    8
  );
  const markerFound = recall.ok && resultContains(recall, marker);
  const createdStructured = structuredContentFromToolCall(created);
  stages.push(
    stage(
      "semantic_memory_proof",
      markerFound ? "pass" : "fail",
      markerFound ? "semantic_memory_proof_ok" : "semantic_memory_proof_failed",
      markerFound
        ? "Semantic governed-memory marker create/recall proof succeeded."
        : "Semantic governed-memory recall did not return the diagnostic marker.",
      {
        http_status: recall.httpStatus,
        metadata: {
          error_code: recall.ok ? null : errorCodeFromJson(recall),
          tool_names: ["memory_create_agent_memory", "memory_recall_agent_memories"],
          marker,
          marker_found: markerFound,
          memory_id: createdStructured?.memory_id ?? null,
          memory_status: createdStructured?.status ?? null,
          memory_type: memoryArguments.memory_type,
          scope: memoryArguments.scope,
          created_by: memoryArguments.created_by,
          audience: memoryArguments.audience,
          diagnostic_marker: true
        },
        remediation: markerFound
          ? null
          : "Inspect semantic indexing/governance separately from transport and checkpoint state."
      }
    )
  );
  return stages;
}

function textReport(report: RemoteMcpDoctorReport) {
  const lines = [
    "Recallant remote-doctor",
    "",
    `Status: ${report.summary.ok ? "ready" : "attention_required"}`,
    `Endpoint path: ${report.endpoint_path}`,
    `Project scope: ${report.scope.project_id ?? "<missing>"}`,
    `Developer scope: ${report.scope.developer_id ?? "<missing>"}`,
    `Client scope: ${report.scope.client_id ?? "<missing>"}`,
    "",
    "Stages:"
  ];
  for (const stageEntry of report.stages) {
    const httpStatus = stageEntry.http_status ? ` http=${stageEntry.http_status}` : "";
    lines.push(`  - ${stageEntry.id}: ${stageEntry.status} ${stageEntry.code}${httpStatus}`);
    lines.push(`    ${stageEntry.message}`);
    if (stageEntry.remediation) lines.push(`    Next: ${stageEntry.remediation}`);
  }
  lines.push(
    "",
    "Remote boundary: uses HTTPS /api/mcp with scoped credential only; no local database, Postgres, Workbench/admin auth, raw artifacts, backups, or provider secrets."
  );
  return `${lines.join("\n")}\n`;
}

export async function buildRemoteDoctorReport(argv: readonly string[]) {
  const options = readOptions(argv);
  const validation = validateBeforeNetwork(options);
  let report: RemoteMcpDoctorReport;
  if (validation) {
    report = validation;
  } else {
    const initialStage = options.allowInsecureLocalhost
      ? [
          stage(
            "url_validation",
            "warn",
            "insecure_localhost_allowed",
            "Insecure localhost URL accepted for deterministic local diagnostics only."
          )
        ]
      : [stage("url_validation", "pass", "url_ok", "Remote MCP server URL is HTTPS.")];
    const stages = await runProbes(options, initialStage);
    report = remoteMcpDoctorReport({
      projectId: options.projectId,
      developerId: options.developerId,
      clientId: options.clientId,
      stages
    });
  }

  const redactedReport = redactRemoteMcpDoctorValue(report, [
    options.credential ?? ""
  ]) as RemoteMcpDoctorReport;
  return redactedReport;
}

export async function runRemoteDoctor(argv: readonly string[]) {
  const options = readOptions(argv);
  const redactedReport = await buildRemoteDoctorReport(argv);
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(redactedReport, null, 2)}\n`
      : textReport(redactedReport)
  );
  if (!redactedReport.summary.ok) process.exitCode = 1;
}
