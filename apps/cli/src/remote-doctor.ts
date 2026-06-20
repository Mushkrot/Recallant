import {
  remoteMcpBridgeEndpointUrl,
  remoteMcpBridgeFlags,
  remoteMcpBridgeHeaders,
  remoteMcpDoctorReport,
  remoteMcpDoctorStage,
  remoteMcpDoctorStageIds,
  redactRemoteMcpDoctorValue,
  type RemoteMcpDoctorReport,
  type RemoteMcpDoctorResultCode,
  type RemoteMcpDoctorStage,
  type RemoteMcpDoctorStageId,
  type RemoteMcpDoctorStageStatus
} from "@recallant/contracts";

type RemoteDoctorOptions = {
  serverUrl: string | null;
  credential: string | null;
  projectId: string | null;
  developerId: string | null;
  clientId: string | null;
  sessionId: string | null;
  traceId: string | null;
  format: "json" | "text";
  timeoutMs: number;
  captureProof: boolean;
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
  return {
    serverUrl: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.serverUrl)),
    credential: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.credential)),
    projectId: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.projectId)),
    developerId: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.developerId)),
    clientId: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.clientId)),
    sessionId: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.sessionId)),
    traceId: normalizedOptional(parseFlag(argv, remoteMcpBridgeFlags.traceId)),
    format,
    timeoutMs,
    captureProof: hasFlag(argv, "--capture-proof"),
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
    [remoteMcpBridgeFlags.credential, options.credential],
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
  const payload = result.json?.result as Record<string, unknown> | undefined;
  const structuredContent =
    payload?.structuredContent && typeof payload.structuredContent === "object"
      ? (payload.structuredContent as Record<string, unknown>)
      : null;
  if (typeof structuredContent?.session_id === "string") return structuredContent.session_id;
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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
      skippedStage("capture_recall_proof")
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

  if (!options.captureProof) {
    stages.push(
      stage(
        "capture_recall_proof",
        "skipped",
        "not_requested",
        "Capture/recall proof was not requested."
      )
    );
    return stages;
  }

  if (
    !toolNames.includes("memory_start_session") ||
    !toolNames.includes("memory_get_context_pack")
  ) {
    stages.push(
      stage(
        "capture_recall_proof",
        "warn",
        "capture_recall_proof_unavailable",
        "Capture/recall proof tool is unavailable.",
        {
          metadata: { required_tools: ["memory_start_session", "memory_get_context_pack"] },
          remediation:
            "Transport is ready; enable or expose Recallant memory tools before using capture proof."
        }
      )
    );
    return stages;
  }

  const startSession = await postJsonRpc(
    options,
    "tools/call",
    {
      name: "memory_start_session",
      arguments: {
        client_kind: "codex",
        client_version: "0.0.0",
        project_path: null,
        session_label: "remote MCP doctor capture proof",
        resume_policy: "force_new"
      }
    },
    3
  );
  const startedSessionId = sessionIdFromToolCall(startSession);
  if (!startSession.ok || !startedSessionId) {
    stages.push(
      stage(
        "capture_recall_proof",
        "fail",
        "capture_recall_proof_failed",
        "Capture/recall session start failed.",
        {
          http_status: startSession.httpStatus,
          metadata: { error_code: errorCodeFromJson(startSession) },
          remediation: "Transport is ready; inspect memory_start_session readiness separately."
        }
      )
    );
    return stages;
  }

  const proof = await postJsonRpc(
    options,
    "tools/call",
    {
      name: "memory_get_context_pack",
      arguments: {
        session_id: options.sessionId ?? startedSessionId,
        task_hint: "remote MCP doctor capture proof",
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
        "capture_recall_proof",
        "fail",
        "capture_recall_proof_failed",
        "Capture/recall proof call failed.",
        {
          http_status: proof.httpStatus,
          metadata: { error_code: errorCodeFromJson(proof) },
          remediation: "Transport is ready; inspect capture/recall tool readiness separately."
        }
      )
    );
    return stages;
  }
  stages.push(
    stage(
      "capture_recall_proof",
      "pass",
      "capture_recall_proof_ok",
      "Capture/recall proof call succeeded.",
      {
        http_status: proof.httpStatus,
        metadata: { tool_names: ["memory_start_session", "memory_get_context_pack"] }
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

export async function runRemoteDoctor(argv: readonly string[]) {
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
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(redactedReport, null, 2)}\n`
      : textReport(redactedReport)
  );
  if (!redactedReport.summary.ok) process.exitCode = 1;
}
