import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getRecallantCoreInfo } from "@recallant/core";
import {
  remoteConnectApprovalUrl,
  remoteConnectApprovePath,
  remoteConnectBootstrapPath,
  remoteConnectPollPath,
  remoteConnectStartPath,
  remoteMcpEndpointPath,
  remoteMcpErrorCodes,
  remoteMcpForbiddenSurfaces,
  remoteMcpClientBootstrapScriptUrl,
  remoteMcpProvisioningOutput,
  remoteMcpPayloadLimits,
  remoteMcpRequiredHeaders,
  type ReviewGraphCandidateInput,
  type RemoteMcpProvisioningAction,
  type RemoteMcpProvisioningOutput,
  type RemoteMcpErrorCode
} from "@recallant/contracts";
import {
  RecallantDb,
  createRecallantDbFromEnv,
  recallantDatabasePackage,
  type ForgetInput,
  type ProjectSourceKind,
  type ProjectSettingInput,
  type RemoteMcpCredentialSummary,
  type RemoteConnectRequestSummary,
  type RemoteOnboardingInviteSummary,
  redactSystemActivityValue,
  type ReviewAgentMemoryInput,
  type SystemActivityRecord
} from "@recallant/db";
import { createRecallantTools, recallantMcpServerName } from "@recallant/mcp";
import { buildManagementChatResponse, type ManagementChatResponse } from "./management-chat.js";

type ReviewDashboardData = Awaited<
  ReturnType<NonNullable<ReturnType<typeof createRecallantDbFromEnv>>["getReviewDashboard"]>
> & {
  starter_docs?: unknown;
  canon_capability_context?: unknown;
  audit_report?: unknown;
  audit_error?: unknown;
};

type ChatRenderState = {
  question?: string;
  response?: ManagementChatResponse;
};

type DetachRenderState = {
  result?: Record<string, unknown>;
};

type SanitizeRenderState = {
  result?: Record<string, unknown>;
};

type MemoryForgetRenderState = {
  result?: Record<string, unknown>;
  target?: {
    kind?: string | null;
    id?: string | null;
  };
  reason?: string | null;
};

type SettingRenderState = {
  result?: Record<string, unknown>;
  key?: string | null;
  rawValue?: string | null;
  reason?: string | null;
};

type SourceRenderState = {
  result?: Record<string, unknown> | null;
  action?: "create_space" | "attach_source" | "detach_source";
  message?: string;
};

type RemoteCredentialRenderState = {
  action?: RemoteMcpProvisioningAction;
  result?: RemoteCredentialProvisioningResponse | null;
  error?: string | null;
};

const documentationStrategyOptions = [
  {
    key: "keep_current_docs",
    label: "Keep current docs, add Recallant layer",
    summary: "Preserve the current documentation and add only the Recallant working layer.",
    reason:
      "Use this when the existing docs remain the canonical source and Recallant should add memory, checkpoint, and context-pack guidance."
  },
  {
    key: "canonicalize_for_recallant",
    label: "Canonicalize docs for Recallant-aware workflow",
    summary: "Normalize the documentation so agents and Recallant share one workflow.",
    reason:
      "Use this when existing docs, agent instructions, runbooks, or handoffs need owner-reviewed alignment with Recallant."
  },
  {
    key: "create_starter_docs",
    label: "Create starter docs",
    summary: "Create the minimum starter documentation surfaces for an agent-ready project.",
    reason:
      "Use this when the project is empty or missing the basic README, agent, status, runbook, or architecture surfaces."
  },
  {
    key: "discuss_first",
    label: "Discuss first",
    summary: "Review the posture with the owner before changing documentation.",
    reason:
      "Use this when the posture is ambiguous, risky, production-sensitive, or needs owner context before a plan is chosen."
  }
] as const;

type DocumentationStrategyOptionKey = (typeof documentationStrategyOptions)[number]["key"];

export function describeServerBoundary() {
  return {
    core: getRecallantCoreInfo(),
    database: recallantDatabasePackage,
    mcpServerName: recallantMcpServerName,
    reviewUi: "private-command-center",
    http: getRecallantHttpConfig()
  };
}

export function getRecallantHttpConfig() {
  const host = process.env.RECALLANT_HOST ?? "127.0.0.1";
  const port = Number(process.env.RECALLANT_PORT ?? 3005);
  const cloudflareMode = process.env.RECALLANT_CLOUDFLARE_MODE ?? "disabled";
  const adminEmails = getConfiguredAdminEmails();
  const publicBindRequested = host === "0.0.0.0" || host === "::";
  if (publicBindRequested && process.env.RECALLANT_ALLOW_PUBLIC_BIND !== "true") {
    throw new Error(
      "VALIDATION_ERROR: public HTTP bind requires explicit RECALLANT_ALLOW_PUBLIC_BIND=true"
    );
  }
  if (cloudflareMode !== "disabled" && cloudflareMode !== "enabled") {
    throw new Error("VALIDATION_ERROR: RECALLANT_CLOUDFLARE_MODE must be disabled or enabled");
  }
  if (cloudflareMode === "enabled" && process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH !== "required") {
    throw new Error(
      "VALIDATION_ERROR: Cloudflare mode requires RECALLANT_CLOUDFLARE_EDGE_AUTH=required"
    );
  }
  if (cloudflareMode === "enabled" && adminEmails.length === 0) {
    throw new Error("VALIDATION_ERROR: Cloudflare mode requires RECALLANT_ADMIN_EMAILS");
  }
  return {
    host,
    port,
    private_by_default: !publicBindRequested,
    public_bind_allowed: process.env.RECALLANT_ALLOW_PUBLIC_BIND === "true",
    recallant_auth_required: true,
    cloudflare: {
      mode: cloudflareMode,
      edge_auth_required: cloudflareMode === "enabled",
      admin_email_count: adminEmails.length
    }
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getConfiguredAdminEmails() {
  return (process.env.RECALLANT_ADMIN_EMAILS ?? process.env.RECALLANT_ADMIN_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getHeaderValue(request: IncomingMessage, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseCookies(request: IncomingMessage) {
  const header = getHeaderValue(request, "cookie");
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

function getSessionSecret() {
  return process.env.RECALLANT_SESSION_SECRET ?? "";
}

function signSessionPayload(payload: string) {
  const secret = getSessionSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionCookie(email: string) {
  const payload = Buffer.from(
    JSON.stringify({ email: email.toLowerCase(), issued_at: Date.now() }),
    "utf8"
  ).toString("base64url");
  const signature = signSessionPayload(payload);
  if (!signature) return "";
  const secure = process.env.RECALLANT_CLOUDFLARE_MODE === "enabled" ? "; Secure" : "";
  return [
    `recallant_session=${encodeURIComponent(`${payload}.${signature}`)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=28800",
    secure
  ]
    .filter(Boolean)
    .join("; ");
}

function verifySessionCookie(request: IncomingMessage) {
  const cookie = parseCookies(request).get("recallant_session");
  if (!cookie) return undefined;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return undefined;
  const expected = signSessionPayload(payload);
  if (!expected) return undefined;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return undefined;
  }
  let parsed: { email?: string; issued_at?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      issued_at?: number;
    };
  } catch {
    return undefined;
  }
  if (!parsed.email || !parsed.issued_at) return undefined;
  if (Date.now() - parsed.issued_at > 8 * 60 * 60 * 1000) return undefined;
  if (!getConfiguredAdminEmails().includes(parsed.email.toLowerCase())) return undefined;
  return parsed.email.toLowerCase();
}

function getCloudflareIdentity(request: IncomingMessage) {
  if (process.env.RECALLANT_CLOUDFLARE_MODE !== "enabled") return undefined;
  if (process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH !== "required") return undefined;
  const email = getHeaderValue(request, "cf-access-authenticated-user-email")?.toLowerCase();
  const jwt = getHeaderValue(request, "cf-access-jwt-assertion");
  if (!email || !jwt) return undefined;
  if (!getConfiguredAdminEmails().includes(email)) return undefined;
  return email;
}

function bearerAuthorized(request: IncomingMessage) {
  const token = process.env.RECALLANT_AUTH_TOKEN;
  if (!token) return false;
  const header = request.headers.authorization;
  return header === `Bearer ${token}`;
}

function authorize(request: IncomingMessage) {
  if (bearerAuthorized(request)) return { ok: true, mode: "bearer" };
  const sessionEmail = verifySessionCookie(request);
  if (sessionEmail) return { ok: true, mode: "session", email: sessionEmail };
  const cloudflareEmail = getCloudflareIdentity(request);
  if (cloudflareEmail) return { ok: true, mode: "cloudflare", email: cloudflareEmail };
  return { ok: false, mode: "none" };
}

type WorkbenchAuth = ReturnType<typeof authorize>;

type RemoteMcpJsonRpcId = string | number | null;

type RemoteMcpScope = {
  projectId: string;
  developerId: string;
  clientId: string;
  sessionId: string | null;
  traceId: string | null;
};

type RemoteMcpAuthResult =
  | {
      ok: true;
      mode: "scoped_credential";
      actorId: string;
      scope: RemoteMcpScope;
      credential: {
        id: string;
        credential_prefix: string;
      };
    }
  | {
      ok: false;
      code: RemoteMcpErrorCode;
      message: string;
      httpStatus: number;
    };

type RemoteMcpProjectBinding = {
  project_id: string;
  developer_id: string;
  primary_path?: string | null;
};

type RecallantHttpServerOptions = {
  remoteMcpDatabase?: RecallantDb;
  workbenchDatabase?: RecallantDb;
};

export class RemoteMcpRequestError extends Error {
  constructor(
    public readonly contractCode: RemoteMcpErrorCode,
    message: string,
    public readonly id: RemoteMcpJsonRpcId = null
  ) {
    super(message);
    this.name = "RemoteMcpRequestError";
  }
}

function remoteMcpErrorStatus(code: RemoteMcpErrorCode) {
  return remoteMcpErrorCodes[code].httpStatus;
}

function remoteMcpJsonRpcCode(code: RemoteMcpErrorCode) {
  if (code === "VALIDATION_ERROR") return -32600;
  if (code === "UNAUTHORIZED" || code === "INVALID_SCOPE_TOKEN") return -32001;
  if (code === "PROJECT_SCOPE_MISMATCH") return -32003;
  if (code === "PROJECT_NOT_ATTACHED") return -32004;
  if (code === "PAYLOAD_TOO_LARGE") return -32013;
  if (code === "RATE_LIMITED") return -32029;
  if (code === "UNAVAILABLE") return -32053;
  return -32000;
}

export function remoteMcpJsonRpcErrorEnvelope(
  id: RemoteMcpJsonRpcId,
  code: RemoteMcpErrorCode,
  message: string
) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: remoteMcpJsonRpcCode(code),
      message,
      data: {
        code,
        http_status: remoteMcpErrorStatus(code),
        retryable: remoteMcpErrorCodes[code].retryable
      }
    }
  };
}

function remoteMcpHeader(request: IncomingMessage, name: string) {
  return optionalInput(getHeaderValue(request, name));
}

export function readRemoteMcpScopeHeaders(request: IncomingMessage): RemoteMcpScope | null {
  const projectId = remoteMcpHeader(request, "X-Recallant-Project-Id");
  const developerId = remoteMcpHeader(request, "X-Recallant-Developer-Id");
  const clientId = remoteMcpHeader(request, "X-Recallant-Client-Id");
  if (!projectId || !developerId || !clientId) return null;
  return {
    projectId,
    developerId,
    clientId,
    sessionId: remoteMcpHeader(request, "X-Recallant-Session-Id"),
    traceId: remoteMcpHeader(request, "X-Recallant-Trace-Id")
  };
}

function extractBearerToken(request: IncomingMessage) {
  const authorization = remoteMcpHeader(request, "Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function remoteMcpAuthFailure(code: RemoteMcpErrorCode, message: string): RemoteMcpAuthResult {
  return { ok: false, code, message, httpStatus: remoteMcpErrorStatus(code) };
}

function remoteMcpCredentialFailureCode(code: string): RemoteMcpErrorCode {
  if (code === "missing_token") return "UNAUTHORIZED";
  return "INVALID_SCOPE_TOKEN";
}

export async function authorizeRemoteMcpRequest(
  request: IncomingMessage,
  database: RecallantDb
): Promise<RemoteMcpAuthResult> {
  const scope = readRemoteMcpScopeHeaders(request);
  if (!scope) {
    return remoteMcpAuthFailure(
      "MISSING_PROJECT_OR_DEVELOPER_SCOPE",
      `Remote MCP requires ${remoteMcpRequiredHeaders.join(", ")}.`
    );
  }
  const bearerToken = extractBearerToken(request);
  if (!bearerToken) return remoteMcpAuthFailure("UNAUTHORIZED", "Missing remote MCP bearer token.");

  const verification = await database.verifyRemoteMcpCredential({
    bearerToken,
    projectId: scope.projectId,
    developerId: scope.developerId,
    clientId: scope.clientId
  });
  if (!verification.ok) {
    return remoteMcpAuthFailure(
      remoteMcpCredentialFailureCode(verification.code),
      verification.message
    );
  }
  if (
    verification.credential.project_id !== scope.projectId ||
    verification.credential.developer_id !== scope.developerId ||
    (verification.credential.client_id && verification.credential.client_id !== scope.clientId)
  ) {
    return remoteMcpAuthFailure("INVALID_SCOPE_TOKEN", "Remote MCP credential scope mismatch.");
  }
  return {
    ok: true,
    mode: "scoped_credential",
    actorId: `remote-client:${scope.clientId}`,
    scope,
    credential: {
      id: verification.credential.id,
      credential_prefix: verification.credential.credential_prefix
    }
  };
}

function containsForbiddenRemoteMcpKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const stack = [value as Record<string, unknown>];
  while (stack.length > 0) {
    const current = stack.pop() as Record<string, unknown>;
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase();
      const forbidden = remoteMcpForbiddenSurfaces.find(
        (surface) => normalizedKey === surface.toLowerCase()
      );
      if (forbidden) return forbidden;
      if (nested && typeof nested === "object") stack.push(nested as Record<string, unknown>);
    }
  }
  return null;
}

export function assertRemoteMcpBodyIsAllowed(body: unknown, id: RemoteMcpJsonRpcId = null) {
  const forbidden = containsForbiddenRemoteMcpKey(body);
  if (forbidden) {
    throw new RemoteMcpRequestError(
      "FORBIDDEN_HEADER",
      `Remote MCP request includes forbidden client surface: ${forbidden}.`,
      id
    );
  }
}

export function assertRemoteMcpProjectScope(
  scope: RemoteMcpScope,
  binding: RemoteMcpProjectBinding | null
) {
  if (!binding) {
    throw new RemoteMcpRequestError("PROJECT_NOT_ATTACHED", "Remote MCP project is not attached.");
  }
  if (binding.project_id !== scope.projectId || binding.developer_id !== scope.developerId) {
    throw new RemoteMcpRequestError(
      "PROJECT_SCOPE_MISMATCH",
      "Remote MCP project/developer scope does not match the attached project."
    );
  }
}

type HttpAuditRoute = {
  operation: string;
  group: string;
  route_template: string;
  noisy?: boolean;
};

type HttpAuditContext = {
  database: RecallantDb | null;
  activity: SystemActivityRecord | null;
  route: HttpAuditRoute;
};

const httpAuditSkipRoutes = [
  { method: "GET", path: "/health", reason: "health readiness probe" },
  { method: "GET", path: "/favicon.ico", reason: "browser favicon probe" },
  { method: "GET", path: "/robots.txt", reason: "crawler metadata probe" }
] as const;

const httpUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown) {
  return typeof value === "string" && httpUuidPattern.test(value) ? value : null;
}

function isSkippedHttpAuditRoute(method: string, pathname: string) {
  return httpAuditSkipRoutes.some((route) => route.method === method && route.path === pathname);
}

function classifyHttpAuditRoute(method: string, pathname: string): HttpAuditRoute {
  if (pathname === "/" || pathname === "/review") {
    return { operation: "workbench.review", group: "review", route_template: "/review" };
  }
  if (pathname === "/api/review-dashboard") {
    return {
      operation: "workbench.api.review_dashboard",
      group: "review",
      route_template: "/api/review-dashboard"
    };
  }
  if (
    pathname === "/api/remote-credentials" ||
    pathname === "/api/remote-credential" ||
    pathname === "/api/connect/bootstrap-token" ||
    pathname === "/remote-credential"
  ) {
    return {
      operation: "workbench.remote_credential",
      group: "remote_credential",
      route_template: pathname.startsWith("/api/")
        ? pathname === "/api/remote-credentials"
          ? "/api/remote-credentials"
          : "/api/remote-credential"
        : "/remote-credential"
    };
  }
  if (
    method === "POST" &&
    (pathname === "/api/management-chat" || pathname === "/management-chat")
  ) {
    return {
      operation: "workbench.management_chat",
      group: "management_chat",
      route_template: pathname.startsWith("/api/") ? "/api/management-chat" : "/management-chat"
    };
  }
  if (method === "POST" && (pathname === "/api/review-action" || pathname === "/review-action")) {
    return {
      operation: "workbench.review_action",
      group: "review",
      route_template: pathname.startsWith("/api/") ? "/api/review-action" : "/review-action"
    };
  }
  if (
    method === "POST" &&
    (pathname === "/api/project-setting" || pathname === "/project-setting")
  ) {
    return {
      operation: "workbench.settings_update",
      group: "settings",
      route_template: pathname.startsWith("/api/") ? "/api/project-setting" : "/project-setting"
    };
  }
  if (
    method === "POST" &&
    (pathname === "/api/project-sanitize" || pathname === "/project-sanitize")
  ) {
    return {
      operation: "workbench.project_sanitize",
      group: "sanitize",
      route_template: pathname.startsWith("/api/") ? "/api/project-sanitize" : "/project-sanitize"
    };
  }
  if (method === "POST" && (pathname === "/api/project-detach" || pathname === "/project-detach")) {
    return {
      operation: "workbench.project_detach",
      group: "sanitize",
      route_template: pathname.startsWith("/api/") ? "/api/project-detach" : "/project-detach"
    };
  }
  if (method === "POST" && (pathname === "/api/memory-forget" || pathname === "/memory-forget")) {
    return {
      operation: "workbench.memory_forget",
      group: "forget",
      route_template: pathname.startsWith("/api/") ? "/api/memory-forget" : "/memory-forget"
    };
  }
  if (method === "POST" && pathname === "/memory-space") {
    return {
      operation: "workbench.memory_space",
      group: "sources",
      route_template: "/memory-space"
    };
  }
  if (method === "POST" && (pathname === "/source-attach" || pathname === "/source-detach")) {
    return { operation: "workbench.source", group: "sources", route_template: pathname };
  }
  return {
    operation: "workbench.unknown",
    group: "unknown",
    route_template: pathname || "/"
  };
}

function summarizeHttpHeaders(request: IncomingMessage) {
  return {
    header_names: Object.keys(request.headers).sort(),
    access_header_seen: Boolean(request.headers.authorization),
    browser_session_header_seen: Boolean(request.headers.cookie),
    edge_email_header_seen: Boolean(getHeaderValue(request, "cf-access-authenticated-user-email")),
    edge_assertion_header_seen: Boolean(getHeaderValue(request, "cf-access-jwt-assertion")),
    content_type: request.headers["content-type"] ?? null,
    content_length_present: Boolean(request.headers["content-length"]),
    user_agent_present: Boolean(request.headers["user-agent"])
  };
}

function httpAuditErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("VALIDATION_ERROR:")) return "VALIDATION_ERROR";
  if (message.startsWith("POLICY_BLOCKED:")) return "POLICY_BLOCKED";
  return "HTTP_HANDLER_ERROR";
}

function safeHttpAuditErrorMessage(error: unknown) {
  return String(redactSystemActivityValue(error instanceof Error ? error.message : String(error)));
}

function createHttpAuditDb() {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) return null;
  return new RecallantDb({
    databaseUrl,
    developerId: process.env.RECALLANT_DEVELOPER_ID,
    projectId: process.env.RECALLANT_PROJECT_ID,
    projectPath: process.env.RECALLANT_PROJECT_PATH
  });
}

async function startHttpAudit(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  auth: WorkbenchAuth
): Promise<HttpAuditContext | null> {
  const method = request.method ?? "GET";
  if (isSkippedHttpAuditRoute(method, requestUrl.pathname)) return null;
  const route = classifyHttpAuditRoute(method, requestUrl.pathname);
  const database = createHttpAuditDb();
  if (!database) return { database: null, activity: null, route };
  try {
    const activity = await database.startSystemActivity({
      surface: "workbench_http",
      operation: route.operation,
      actor_kind: auth.ok ? "user" : "anonymous",
      actor_id: auth.ok ? `auth:${auth.mode}` : "unauthorized",
      client_kind: "workbench",
      project_id: uuidOrNull(requestUrl.searchParams.get("project_id")),
      related_ids: {
        route_template: route.route_template,
        query_project_id: requestUrl.searchParams.get("project_id"),
        selected_memory_id: requestUrl.searchParams.get("memory_id")
      },
      metadata: {
        audit_policy: "health_favicon_robots_skipped; bodies_summarized_not_stored",
        method,
        pathname: requestUrl.pathname,
        route_template: route.route_template,
        operation_group: route.group,
        auth_mode: auth.mode,
        authorized: auth.ok,
        query_keys: Array.from(requestUrl.searchParams.keys()).sort(),
        headers: summarizeHttpHeaders(request)
      }
    });
    response.setHeader("x-recallant-audit-trace-id", activity.trace_id);
    return { database, activity, route };
  } catch {
    await database.close().catch(() => undefined);
    return { database: null, activity: null, route };
  }
}

async function finishHttpAudit(
  audit: HttpAuditContext | null,
  response: ServerResponse,
  error?: unknown
) {
  if (!audit?.database || !audit.activity) return;
  const statusCode = response.statusCode || (error ? 500 : 200);
  const status = error
    ? "error"
    : statusCode >= 500
      ? "error"
      : statusCode >= 400
        ? "skipped"
        : "success";
  try {
    await audit.database.finishSystemActivity({
      id: audit.activity.id,
      status,
      error_code: error
        ? httpAuditErrorCode(error)
        : statusCode >= 400
          ? `HTTP_${statusCode}`
          : null,
      error_message: error ? safeHttpAuditErrorMessage(error) : null,
      metadata: {
        route_template: audit.route.route_template,
        operation_group: audit.route.group,
        status_code: statusCode,
        response_finished: response.writableEnded
      }
    });
  } catch (finishError) {
    if (process.env.RECALLANT_HTTP_AUDIT_DEBUG === "true") {
      process.stderr.write(
        `Recallant HTTP audit finish failed: ${safeHttpAuditErrorMessage(finishError)}\n`
      );
    }
    // Audit logging must never break the Workbench response path.
  } finally {
    await audit.database.close().catch(() => undefined);
  }
}

function write(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/html",
  headers: Record<string, string | string[]> = {}
) {
  response.writeHead(statusCode, {
    ...headers,
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
  response.end(body);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJsonWithLimit(request: IncomingMessage, limitBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > limitBytes) {
      throw new RemoteMcpRequestError("PAYLOAD_TOO_LARGE", "Remote MCP request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function readForm(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(params.entries());
}

function optionalInput(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function booleanInput(value: unknown) {
  return value === true || String(value ?? "").toLowerCase() === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type RemoteCredentialProvisioningRequest = {
  action?: unknown;
  project_id?: unknown;
  developer_id?: unknown;
  client_id?: unknown;
  credential_id?: unknown;
  label?: unknown;
  expires_at?: unknown;
  include_revoked?: unknown;
  server_url?: unknown;
  target?: unknown;
  bridge_client_id?: unknown;
  session_id?: unknown;
  trace_id?: unknown;
};

type RemoteCredentialProvisioningResponse = {
  ok: boolean;
  action: RemoteMcpProvisioningAction;
  credential?: RemoteMcpCredentialSummary;
  credentials?: RemoteMcpCredentialSummary[];
  previous_credential?: RemoteMcpCredentialSummary | null;
  one_time_secret?: string | null;
  provisioning?: RemoteMcpProvisioningOutput;
  provisioning_by_credential?: RemoteMcpProvisioningOutput[];
  secret_print_policy: "create_rotate_only" | "redacted";
};

type RemoteInviteRequest = {
  action?: unknown;
  project_id?: unknown;
  developer_id?: unknown;
  label?: unknown;
  expires_at?: unknown;
  server_url?: unknown;
  target?: unknown;
};

type RemoteInviteResponse = {
  ok: boolean;
  action: "create";
  invite: RemoteOnboardingInviteSummary;
  invite_token: string;
  redeem_url: string;
  command: string;
  secret_print_policy: "shown_once_create_output_only";
};

type RemoteInviteRedeemRequest = {
  invite_token?: unknown;
  token?: unknown;
  client_id?: unknown;
};

type RemoteInviteRedeemResponse = {
  ok: boolean;
  action: "redeem";
  invite: RemoteOnboardingInviteSummary;
  credential: RemoteMcpCredentialSummary;
  one_time_secret: string;
  provisioning: RemoteMcpProvisioningOutput;
  bootstrap: {
    server_url: string;
    credential: string;
    project_id: string;
    developer_id: string;
    client_id: string;
    target: string;
  };
  secret_print_policy: "redeem_only";
};

type RemoteConnectStartRequest = {
  target?: unknown;
  project_id?: unknown;
  project_display_name?: unknown;
  project_fingerprint?: unknown;
  project_path_hint_redacted?: unknown;
  repo_remote_hash?: unknown;
  requested_by_ip_hash?: unknown;
  trusted_device_registration?: unknown;
  trusted_device?: unknown;
  bootstrap_token?: unknown;
  expires_at?: unknown;
};

type RemoteConnectPollRequest = {
  poll_token?: unknown;
};

type RemoteConnectApprovalRequest = {
  code?: unknown;
  action?: unknown;
  project_id?: unknown;
  developer_id?: unknown;
  client_id?: unknown;
};

type RemoteConnectBootstrapTokenRequest = {
  action?: unknown;
  project_id?: unknown;
  developer_id?: unknown;
  token_id?: unknown;
  target?: unknown;
  label?: unknown;
  allow_project_create?: unknown;
  expires_at?: unknown;
  server_url?: unknown;
};

const remoteConnectRateLimitWindowMs = 60_000;
const remoteConnectRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function remoteCredentialAction(value: unknown): RemoteMcpProvisioningAction {
  const action = optionalInput(value) ?? "list";
  if (action === "create" || action === "rotate" || action === "revoke" || action === "list") {
    return action;
  }
  throw new Error("VALIDATION_ERROR: unsupported remote credential action");
}

function requireRemoteCredentialScope(input: RemoteCredentialProvisioningRequest) {
  const projectId = optionalInput(input.project_id);
  const developerId = optionalInput(input.developer_id);
  if (!projectId || !developerId) {
    throw new Error("VALIDATION_ERROR: project_id and developer_id are required");
  }
  return {
    projectId,
    developerId,
    clientId: optionalInput(input.client_id)
  };
}

function remoteCredentialServerUrl(
  input: RemoteCredentialProvisioningRequest,
  request: IncomingMessage
) {
  const explicit = optionalInput(input.server_url);
  if (explicit) {
    const parsed = new URL(explicit);
    if (parsed.protocol !== "https:") {
      throw new Error("VALIDATION_ERROR: remote credential provisioning server_url must use https");
    }
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  }
  const forwardedProto = optionalInput(getHeaderValue(request, "x-forwarded-proto"));
  const forwardedHost =
    optionalInput(getHeaderValue(request, "x-forwarded-host")) ??
    optionalInput(getHeaderValue(request, "host"));
  if (forwardedProto === "https" && forwardedHost) return `https://${forwardedHost}`;
  return "https://recallant.example.com";
}

function remoteCredentialBridgeClientId(
  input: RemoteCredentialProvisioningRequest,
  credential: RemoteMcpCredentialSummary
) {
  return optionalInput(input.bridge_client_id) ?? credential.client_id ?? "remote-agent";
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function normalizedRemoteServerUrl(raw: string) {
  const parsed = new URL(raw);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function remoteInviteServerUrl(input: RemoteInviteRequest, request: IncomingMessage) {
  const explicit = optionalInput(input.server_url);
  if (explicit) return normalizedRemoteServerUrl(explicit);
  const forwardedProto = optionalInput(getHeaderValue(request, "x-forwarded-proto"));
  const forwardedHost =
    optionalInput(getHeaderValue(request, "x-forwarded-host")) ??
    optionalInput(getHeaderValue(request, "host"));
  if (forwardedHost) {
    return normalizedRemoteServerUrl(
      `${forwardedProto === "http" ? "http" : "https"}://${forwardedHost}`
    );
  }
  return "https://recallant.example.com";
}

function remoteConnectRateLimitMax() {
  const parsed = Number.parseInt(process.env.RECALLANT_REMOTE_CONNECT_RATE_LIMIT_MAX ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function remoteConnectRateLimitKey(request: IncomingMessage, pathname: string) {
  const forwardedFor = optionalInput(getHeaderValue(request, "x-forwarded-for"));
  const remoteAddress = request.socket.remoteAddress ?? "unknown";
  const actor = forwardedFor?.split(",")[0]?.trim() || remoteAddress;
  return `${pathname}:${actor}`;
}

function enforceRemoteConnectRateLimit(request: IncomingMessage, pathname: string) {
  const now = Date.now();
  const key = remoteConnectRateLimitKey(request, pathname);
  const existing = remoteConnectRateLimitBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + remoteConnectRateLimitWindowMs };
  bucket.count += 1;
  remoteConnectRateLimitBuckets.set(key, bucket);
  if (remoteConnectRateLimitBuckets.size > 10_000) {
    for (const [bucketKey, value] of remoteConnectRateLimitBuckets.entries()) {
      if (value.resetAt <= now) remoteConnectRateLimitBuckets.delete(bucketKey);
    }
  }
  if (bucket.count > remoteConnectRateLimitMax()) {
    throw new Error("RATE_LIMITED: remote connect route rate limit exceeded");
  }
}

function assertRemoteConnectPayloadBudget(input: unknown, label: string) {
  const bytes = Buffer.byteLength(JSON.stringify(input ?? {}), "utf8");
  if (bytes > 16 * 1024) {
    throw new Error(`VALIDATION_ERROR: ${label} payload is too large`);
  }
}

function remoteConnectTrustedDeviceRegistration(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const deviceKeyPrefix = optionalInput(record.device_key_prefix);
  const publicKeyFingerprint = optionalInput(record.public_key_fingerprint);
  const publicKeyMaterial = optionalInput(record.public_key_material);
  if (!deviceKeyPrefix || !publicKeyFingerprint || !publicKeyMaterial) {
    throw new Error("VALIDATION_ERROR: trusted device registration is incomplete");
  }
  return {
    deviceKeyPrefix,
    publicKeyFingerprint,
    publicKeyMaterial,
    publicKeyHash: createHash("sha256").update(publicKeyMaterial).digest("hex"),
    publicKeyAlgorithm: optionalInput(record.public_key_algorithm) ?? "unknown",
    deviceName: optionalInput(record.device_name) ?? "trusted remote device"
  };
}

function remoteConnectTrustedDeviceStart(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const deviceKeyPrefix = optionalInput(record.device_key_prefix);
  const publicKeyFingerprint = optionalInput(record.public_key_fingerprint);
  const publicKeyMaterial = optionalInput(record.public_key_material);
  const challengeNonce = optionalInput(record.challenge_nonce);
  const challengeSignature = optionalInput(record.challenge_signature);
  const signatureAlgorithm = optionalInput(record.signature_algorithm) ?? "unknown";
  if (
    !deviceKeyPrefix ||
    !publicKeyFingerprint ||
    !publicKeyMaterial ||
    !challengeNonce ||
    !challengeSignature
  ) {
    throw new Error("VALIDATION_ERROR: trusted device signed challenge is incomplete");
  }
  return {
    deviceKeyPrefix,
    publicKeyFingerprint,
    publicKeyMaterial,
    challengeNonce,
    challengeSignature,
    signatureAlgorithm
  };
}

function remoteConnectTrustedDeviceChallengePayload(input: {
  target: string;
  projectFingerprint: string | null | undefined;
  projectPathHintRedacted: string | null | undefined;
  challengeNonce: string;
}) {
  return [
    "recallant-connect-trusted-device-v1",
    `target:${input.target}`,
    `project_fingerprint:${input.projectFingerprint ?? ""}`,
    `project_path_hint_redacted:${input.projectPathHintRedacted ?? ""}`,
    `challenge_nonce:${input.challengeNonce}`
  ].join("\n");
}

function verifyRemoteConnectTrustedDeviceSignature(input: {
  publicKeyMaterial: string;
  challengeSignature: string;
  payload: string;
  signatureAlgorithm: string;
}) {
  if (input.signatureAlgorithm !== "ed25519-v1") return false;
  try {
    return verifySignature(
      null,
      Buffer.from(input.payload, "utf8"),
      createPublicKey(input.publicKeyMaterial),
      Buffer.from(input.challengeSignature, "base64url")
    );
  } catch {
    return false;
  }
}

function remoteConnectApprovalMode(approvedBy: string | null | undefined) {
  if (approvedBy?.startsWith("trusted-device:")) return "trusted_device";
  if (approvedBy?.startsWith("bootstrap-token:")) return "bootstrap_token";
  return "human_approval";
}

async function maybeApproveRemoteConnectWithTrustedDevice(input: {
  database: RecallantDb;
  deviceCode: string;
  request: RemoteConnectRequestSummary;
  trustedDevice: NonNullable<ReturnType<typeof remoteConnectTrustedDeviceStart>>;
  target: string;
  projectFingerprint: string | null | undefined;
  projectPathHintRedacted: string | null | undefined;
}) {
  const payload = remoteConnectTrustedDeviceChallengePayload({
    target: input.target,
    projectFingerprint: input.projectFingerprint,
    projectPathHintRedacted: input.projectPathHintRedacted,
    challengeNonce: input.trustedDevice.challengeNonce
  });
  const signatureOk = verifyRemoteConnectTrustedDeviceSignature({
    publicKeyMaterial: input.trustedDevice.publicKeyMaterial,
    challengeSignature: input.trustedDevice.challengeSignature,
    payload,
    signatureAlgorithm: input.trustedDevice.signatureAlgorithm
  });
  if (!signatureOk) {
    return {
      status: "fallback",
      reason: "invalid_signature",
      browser_approval_required: true,
      device_key_prefix: input.trustedDevice.deviceKeyPrefix,
      public_key_fingerprint: input.trustedDevice.publicKeyFingerprint
    };
  }

  const verification = await input.database.verifyRemoteTrustedDeviceChallenge({
    deviceKeyPrefix: input.trustedDevice.deviceKeyPrefix,
    publicKeyFingerprint: input.trustedDevice.publicKeyFingerprint,
    publicKeyMaterial: input.trustedDevice.publicKeyMaterial,
    challengeNonce: input.trustedDevice.challengeNonce,
    verifiedBy: "remote-connect"
  });
  if (!verification.ok) {
    return {
      status: "fallback",
      reason: verification.code,
      browser_approval_required: true,
      device_key_prefix: input.trustedDevice.deviceKeyPrefix,
      public_key_fingerprint: input.trustedDevice.publicKeyFingerprint
    };
  }

  const project = await input.database.createMemorySpace({
    name: input.request.project_display_name ?? "remote project",
    developerId: verification.device.developer_id,
    projectKind: "workspace",
    memoryDomain: "agent_work"
  });
  const approvedRequest = await input.database.approveRemoteConnectRequest({
    deviceCode: input.deviceCode,
    projectId: project.project_id,
    developerId: verification.device.developer_id,
    clientId: `remote-${input.trustedDevice.deviceKeyPrefix}`,
    approvedBy: `trusted-device:${input.trustedDevice.deviceKeyPrefix}`
  });
  return {
    status: "approved",
    approval_mode: "trusted_device",
    browser_approval_required: false,
    device_key_prefix: input.trustedDevice.deviceKeyPrefix,
    public_key_fingerprint: input.trustedDevice.publicKeyFingerprint,
    request: approvedRequest
  };
}

async function maybeApproveRemoteConnectWithBootstrapToken(input: {
  database: RecallantDb;
  deviceCode: string;
  request: RemoteConnectRequestSummary;
  bootstrapToken: string;
  projectId?: string | null;
}) {
  const clientId = `remote-bootstrap-${createHash("sha256")
    .update(input.request.id)
    .digest("hex")
    .slice(0, 12)}`;
  const redeemed = await input.database.redeemRemoteConnectBootstrapToken({
    token: input.bootstrapToken,
    clientId,
    projectId: input.projectId,
    redeemedBy: "remote-connect-bootstrap"
  });
  if (!redeemed.project_id) {
    throw new Error("VALIDATION_ERROR: bootstrap token did not resolve a project scope");
  }
  const approvedRequest = await input.database.approveRemoteConnectRequest({
    deviceCode: input.deviceCode,
    projectId: redeemed.project_id,
    developerId: redeemed.developer_id,
    clientId: redeemed.client_id,
    approvedBy: `bootstrap-token:${redeemed.bootstrap_token.token_prefix}`
  });
  return {
    status: "approved",
    approval_mode: "bootstrap_token",
    browser_approval_required: false,
    token_prefix: redeemed.bootstrap_token.token_prefix,
    request: approvedRequest
  };
}

function remoteInviteRedeemUrl(serverUrl: string) {
  return `${serverUrl}/api/remote-invite/redeem`;
}

function remoteInviteCommand(serverUrl: string, token: string) {
  return `curl -fsSL ${shellSingleQuote(`${serverUrl}/j/${token}`)} | bash`;
}

function remoteInviteScript(serverUrl: string, token: string) {
  return `#!/usr/bin/env bash
set -euo pipefail
curl -fsSL ${shellSingleQuote(remoteMcpClientBootstrapScriptUrl)} | bash -s -- --invite-url ${shellSingleQuote(remoteInviteRedeemUrl(serverUrl))} --invite-token ${shellSingleQuote(token)} "$@"
`;
}

function remoteConnectBootstrapScript(serverUrl: string) {
  return `#!/usr/bin/env bash
set -euo pipefail
curl -fsSL ${shellSingleQuote(`${serverUrl}/connect/client-bootstrap.sh`)} | bash -s -- --connect-url ${shellSingleQuote(serverUrl)} "$@"
`;
}

function remoteConnectClientBootstrapScript() {
  return readFileSync(
    join(process.cwd(), "scripts", "install-recallant-client-bootstrap.sh"),
    "utf8"
  );
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRemoteConnectApprovalPage(input: {
  code: string;
  request: RemoteConnectRequestSummary | null;
  error?: string | null;
}) {
  const request = input.request;
  const status = request?.status ?? "missing";
  const canApprove = status === "pending";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Approve Recallant remote connect</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #172033; background: #f6f4ee; }
    main { max-width: 760px; margin: 0 auto; background: white; border: 1px solid #ded7c7; border-radius: 18px; padding: 2rem; box-shadow: 0 20px 70px rgb(23 32 51 / 10%); }
    code, input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    label { display: block; font-weight: 650; margin-top: 1rem; }
    input { box-sizing: border-box; width: 100%; padding: .75rem; border: 1px solid #c9c1b0; border-radius: 10px; }
    button { margin-top: 1rem; margin-right: .75rem; padding: .8rem 1rem; border: 0; border-radius: 999px; background: #173b2f; color: white; font-weight: 700; cursor: pointer; }
    button[name="action"][value="deny"] { background: #793a2d; }
    .meta { background: #f7f1df; padding: 1rem; border-radius: 12px; }
    .error { color: #8b1d1d; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Approve Recallant remote connect</h1>
    ${input.error ? `<p class="error">${htmlEscape(input.error)}</p>` : ""}
    <p>
      This is the human approval gate for a remote agent client. Approve only if you recognize the
      project and device. Approval creates scoped machine access for Recallant memory over HTTPS
      <code>/api/mcp</code>; it does not grant Workbench, admin, credential-management, backup,
      provider, or raw-artifact access.
    </p>
    <div class="meta">
      <p><strong>Status:</strong> ${htmlEscape(status)}</p>
      <p><strong>Target client:</strong> ${htmlEscape(request?.target ?? "unknown")}</p>
      <p><strong>Project:</strong> ${htmlEscape(request?.project_display_name ?? "not provided")}</p>
      <p><strong>Project fingerprint:</strong> ${htmlEscape(request?.project_fingerprint ?? "not provided")}</p>
      <p><strong>Path hint:</strong> ${htmlEscape(request?.project_path_hint_redacted ?? "not provided")}</p>
      <p><strong>Trusted device:</strong> ${htmlEscape(request?.trusted_device_name ?? "not requested")}</p>
      <p><strong>Device fingerprint:</strong> ${htmlEscape(request?.trusted_device_public_key_fingerprint ?? "not provided")}</p>
      <p><strong>Trust duration:</strong> ${request?.trusted_device_key_prefix ? "up to 90 days unless revoked" : "this approval only"}</p>
      <p><strong>Trust effect:</strong> ${request?.trusted_device_key_prefix ? "Future projects from this device can request Recallant project connection with signed machine auth. This does not grant Workbench, admin, credential-management, backup, provider, or raw-artifact access." : "Only this project connection will be approved."}</p>
      <p><strong>Expires:</strong> ${htmlEscape(request?.expires_at?.toISOString?.() ?? request?.expires_at ?? "unknown")}</p>
    </div>
    <form method="post" action="${remoteConnectApprovePath}">
      <input type="hidden" name="code" value="${htmlEscape(input.code)}" />
      <label>Remote client id</label>
      <input name="client_id" placeholder="remote-macbook-air" ${canApprove ? "" : "disabled"} />
      <button name="action" value="approve" ${canApprove ? "" : "disabled"}>Approve remote connect</button>
      <button name="action" value="deny" ${canApprove ? "" : "disabled"}>Deny</button>
    </form>
  </main>
</body>
</html>`;
}

async function handleRemoteInviteCreate(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteInviteRequest
): Promise<RemoteInviteResponse> {
  const scope = requireRemoteCredentialScope(input);
  const serverUrl = remoteInviteServerUrl(input, request);
  if (!serverUrl.startsWith("https://") && !serverUrl.startsWith("http://127.0.0.1")) {
    throw new Error("VALIDATION_ERROR: remote invite server_url must use https");
  }
  const result = await database.createRemoteOnboardingInvite({
    projectId: scope.projectId,
    developerId: scope.developerId,
    target: optionalInput(input.target) ?? "codex",
    label: optionalInput(input.label),
    expiresAt: optionalInput(input.expires_at),
    createdBy: "workbench"
  });
  return {
    ok: true,
    action: "create",
    invite: result.invite,
    invite_token: result.token,
    redeem_url: remoteInviteRedeemUrl(serverUrl),
    command: remoteInviteCommand(serverUrl, result.token),
    secret_print_policy: "shown_once_create_output_only"
  };
}

async function handleRemoteConnectBootstrapToken(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteConnectBootstrapTokenRequest,
  actorId: string
) {
  const action = optionalInput(input.action) ?? "create";
  if (action === "create") {
    const developerId = optionalInput(input.developer_id);
    if (!developerId) throw new Error("VALIDATION_ERROR: developer_id is required");
    const result = await database.createRemoteConnectBootstrapToken({
      projectId: optionalInput(input.project_id),
      developerId,
      target: optionalInput(input.target),
      label: optionalInput(input.label),
      allowProjectCreate: booleanInput(input.allow_project_create),
      expiresAt: optionalInput(input.expires_at),
      createdBy: actorId
    });
    const serverUrl = remoteInviteServerUrl(input, request);
    return {
      ok: true,
      action,
      bootstrap_token: result.bootstrap_token,
      token: result.token,
      token_prefix: result.bootstrap_token.token_prefix,
      command: `recallant connect-cloud . --server-url ${shellSingleQuote(serverUrl)} --bootstrap-token ${shellSingleQuote(result.token)}`,
      secret_print_policy: "shown_once_create_output_only"
    };
  }
  if (action === "revoke") {
    const tokenId = optionalInput(input.token_id);
    if (!tokenId) throw new Error("VALIDATION_ERROR: token_id is required");
    const bootstrapToken = await database.revokeRemoteConnectBootstrapToken({
      tokenId,
      revokedBy: actorId
    });
    return {
      ok: true,
      action,
      bootstrap_token: bootstrapToken,
      secret_print_policy: "redacted"
    };
  }
  throw new Error("VALIDATION_ERROR: connect bootstrap token supports create|revoke");
}

async function handleRemoteConnectStart(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteConnectStartRequest
) {
  assertRemoteConnectPayloadBudget(input, "remote connect start");
  const serverUrl = remoteInviteServerUrl({}, request);
  const target = optionalInput(input.target) ?? "codex";
  const projectFingerprint = optionalInput(input.project_fingerprint);
  const projectPathHintRedacted = optionalInput(input.project_path_hint_redacted);
  const bootstrapToken = optionalInput(input.bootstrap_token);
  const trustedDeviceRegistration = remoteConnectTrustedDeviceRegistration(
    input.trusted_device_registration
  );
  const trustedDevice = remoteConnectTrustedDeviceStart(input.trusted_device);
  const result = await database.createRemoteConnectRequest({
    target,
    projectDisplayName: optionalInput(input.project_display_name),
    projectFingerprint,
    projectPathHintRedacted,
    repoRemoteHash: optionalInput(input.repo_remote_hash),
    requestedByIpHash: optionalInput(input.requested_by_ip_hash),
    trustedDeviceKeyPrefix: trustedDeviceRegistration?.deviceKeyPrefix,
    trustedDevicePublicKeyFingerprint: trustedDeviceRegistration?.publicKeyFingerprint,
    trustedDevicePublicKeyHash: trustedDeviceRegistration?.publicKeyHash,
    trustedDevicePublicKeyAlgorithm: trustedDeviceRegistration?.publicKeyAlgorithm,
    trustedDeviceName: trustedDeviceRegistration?.deviceName,
    expiresAt: optionalInput(input.expires_at),
    createdBy: "remote-connect"
  });
  const bootstrapApproval = bootstrapToken
    ? await maybeApproveRemoteConnectWithBootstrapToken({
        database,
        deviceCode: result.device_code,
        request: result.request,
        bootstrapToken,
        projectId: optionalInput(input.project_id)
      })
    : null;
  const trustedDeviceApproval = bootstrapApproval
    ? null
    : trustedDevice
      ? await maybeApproveRemoteConnectWithTrustedDevice({
          database,
          deviceCode: result.device_code,
          request: result.request,
          trustedDevice,
          target,
          projectFingerprint,
          projectPathHintRedacted
        })
      : trustedDeviceRegistration
        ? {
            status: "pending_human_approval",
            browser_approval_required: true,
            device_key_prefix: trustedDeviceRegistration.deviceKeyPrefix,
            public_key_fingerprint: trustedDeviceRegistration.publicKeyFingerprint
          }
        : null;
  const machineApproval = bootstrapApproval ?? trustedDeviceApproval;
  const trustedDeviceApproved =
    machineApproval && "request" in machineApproval ? machineApproval : null;
  const approvalMode =
    trustedDeviceApproved?.status === "approved"
      ? trustedDeviceApproved.approval_mode
      : "human_approval";
  return {
    ok: true,
    action: "start",
    request_id: result.request.id,
    request: trustedDeviceApproved?.request ?? result.request,
    device_code: result.device_code,
    poll_token: result.poll_token,
    approve_url: remoteConnectApprovalUrl(serverUrl, result.device_code),
    expires_at: result.request.expires_at,
    interval_seconds: 2,
    approval_mode: approvalMode,
    trusted_device: trustedDeviceApproval,
    bootstrap_token: bootstrapApproval
      ? {
          status: bootstrapApproval.status,
          approval_mode: bootstrapApproval.approval_mode,
          browser_approval_required: bootstrapApproval.browser_approval_required,
          token_prefix: bootstrapApproval.token_prefix
        }
      : null,
    secret_print_policy: "device_and_poll_tokens_shown_once_start_output_only"
  };
}

async function handleRemoteConnectPoll(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteConnectPollRequest
) {
  assertRemoteConnectPayloadBudget(input, "remote connect poll");
  const pollToken = optionalInput(input.poll_token);
  if (!pollToken) throw new Error("VALIDATION_ERROR: remote connect poll_token is required");
  const serverUrl = remoteInviteServerUrl({}, request);
  const result = await database.pollRemoteConnectRequest({
    pollToken,
    redeemedBy: "remote-connect"
  });
  if (result.status !== "approved") {
    return {
      ok: true,
      action: "poll",
      status: result.status,
      request_id: result.request?.id ?? null,
      retry_after_seconds: result.status === "pending" ? 2 : null,
      secret_print_policy: "redacted_until_approved"
    };
  }
  const provisioning = remoteMcpProvisioningOutput({
    action: "create",
    target: result.target,
    serverUrl,
    credential: result.credential,
    bridgeClientId: result.client_id,
    credentialSecret: result.secret,
    includeSecret: true
  });
  return {
    ok: true,
    action: "poll",
    status: "approved",
    approval_mode: remoteConnectApprovalMode(result.request.approved_by),
    request_id: result.request.id,
    credential: result.credential,
    one_time_secret: result.secret,
    provisioning,
    bootstrap: {
      server_url: serverUrl,
      credential: result.secret,
      project_id: result.project_id,
      developer_id: result.developer_id,
      client_id: result.client_id,
      target: result.target
    },
    secret_print_policy: "approved_poll_only"
  };
}

async function handleRemoteConnectApprove(
  database: RecallantDb,
  input: RemoteConnectApprovalRequest,
  approvedBy: string
) {
  const code = optionalInput(input.code);
  if (!code) throw new Error("VALIDATION_ERROR: remote connect approval code is required");
  const action = optionalInput(input.action) ?? "approve";
  if (action === "deny") {
    return {
      ok: true,
      action,
      request: await database.denyRemoteConnectRequest({ deviceCode: code, deniedBy: approvedBy })
    };
  }
  if (action !== "approve") throw new Error("VALIDATION_ERROR: unsupported approval action");
  const pendingRequest = await database.getRemoteConnectRequestForApproval({ deviceCode: code });
  if (!pendingRequest) throw new Error("VALIDATION_ERROR: remote connect request not found");
  const projectName = pendingRequest.project_display_name ?? "remote project";
  const project = await database.createMemorySpace({
    name: projectName,
    projectKind: "workspace",
    memoryDomain: "agent_work"
  });
  const trustedDeviceRegistration =
    await database.getRemoteConnectTrustedDeviceRegistrationForApproval({ deviceCode: code });
  if (trustedDeviceRegistration) {
    await database.createRemoteTrustedDevice({
      developerId: project.developer_id,
      deviceKeyPrefix: trustedDeviceRegistration.device_key_prefix,
      publicKeyFingerprint: trustedDeviceRegistration.public_key_fingerprint,
      publicKeyHash: trustedDeviceRegistration.public_key_hash,
      publicKeyAlgorithm: trustedDeviceRegistration.public_key_algorithm,
      deviceName: trustedDeviceRegistration.device_name,
      createdBy: approvedBy
    });
  }
  return {
    ok: true,
    action,
    request: await database.approveRemoteConnectRequest({
      deviceCode: code,
      projectId: project.project_id,
      developerId: project.developer_id,
      clientId: optionalInput(input.client_id),
      approvedBy
    })
  };
}

async function handleRemoteInviteRedeem(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteInviteRedeemRequest
): Promise<RemoteInviteRedeemResponse> {
  const token = optionalInput(input.invite_token) ?? optionalInput(input.token);
  if (!token) throw new Error("VALIDATION_ERROR: remote invite token is required");
  const serverUrl = remoteInviteServerUrl({}, request);
  const redeemed = await database.redeemRemoteOnboardingInvite({
    token,
    clientId: optionalInput(input.client_id),
    redeemedBy: "remote-invite"
  });
  const provisioning = remoteMcpProvisioningOutput({
    action: "create",
    target: redeemed.target,
    serverUrl,
    credential: redeemed.credential,
    bridgeClientId: redeemed.client_id,
    credentialSecret: redeemed.secret,
    includeSecret: true
  });
  return {
    ok: true,
    action: "redeem",
    invite: redeemed.invite,
    credential: redeemed.credential,
    one_time_secret: redeemed.secret,
    provisioning,
    bootstrap: {
      server_url: serverUrl,
      credential: redeemed.secret,
      project_id: redeemed.credential.project_id,
      developer_id: redeemed.credential.developer_id,
      client_id: redeemed.client_id,
      target: redeemed.target
    },
    secret_print_policy: "redeem_only"
  };
}

function remoteCredentialProvisioning(input: {
  action: RemoteMcpProvisioningAction;
  request: RemoteCredentialProvisioningRequest;
  httpRequest: IncomingMessage;
  credential: RemoteMcpCredentialSummary;
  previousCredential?: RemoteMcpCredentialSummary | null;
  secret?: string | null;
  includeSecret: boolean;
}) {
  return remoteMcpProvisioningOutput({
    action: input.action,
    target: optionalInput(input.request.target) ?? "codex",
    serverUrl: remoteCredentialServerUrl(input.request, input.httpRequest),
    credential: input.credential,
    previousCredential: input.previousCredential,
    bridgeClientId: remoteCredentialBridgeClientId(input.request, input.credential),
    credentialSecret: input.secret,
    includeSecret: input.includeSecret,
    sessionId: optionalInput(input.request.session_id),
    traceId: optionalInput(input.request.trace_id)
  });
}

async function remoteCredentialInScope(
  database: RecallantDb,
  input: RemoteCredentialProvisioningRequest
) {
  const scope = requireRemoteCredentialScope(input);
  const credentialId = optionalInput(input.credential_id);
  if (!credentialId) throw new Error("VALIDATION_ERROR: credential_id is required");
  const credentials = await database.listRemoteMcpCredentials({
    projectId: scope.projectId,
    developerId: scope.developerId,
    clientId: scope.clientId,
    includeRevoked: true
  });
  const credential = credentials.find((row) => row.id === credentialId);
  if (!credential) {
    throw new Error("VALIDATION_ERROR: remote MCP credential does not match requested scope");
  }
  return credential;
}

async function handleRemoteCredentialProvisioning(
  database: RecallantDb,
  request: IncomingMessage,
  input: RemoteCredentialProvisioningRequest
): Promise<RemoteCredentialProvisioningResponse> {
  const action = remoteCredentialAction(input.action);
  const scope = requireRemoteCredentialScope(input);
  if (action === "list") {
    const credentials = await database.listRemoteMcpCredentials({
      projectId: scope.projectId,
      developerId: scope.developerId,
      clientId: scope.clientId,
      includeRevoked: booleanInput(input.include_revoked)
    });
    return {
      ok: true,
      action,
      credentials,
      provisioning_by_credential: credentials.map((credential) =>
        remoteCredentialProvisioning({
          action,
          request: input,
          httpRequest: request,
          credential,
          includeSecret: false
        })
      ),
      secret_print_policy: "redacted"
    };
  }
  if (action === "create") {
    const result = await database.createRemoteMcpCredential({
      projectId: scope.projectId,
      developerId: scope.developerId,
      clientId: scope.clientId,
      label: optionalInput(input.label),
      expiresAt: optionalInput(input.expires_at),
      createdBy: "workbench"
    });
    return {
      ok: true,
      action,
      credential: result.credential,
      one_time_secret: result.secret,
      provisioning: remoteCredentialProvisioning({
        action,
        request: input,
        httpRequest: request,
        credential: result.credential,
        secret: result.secret,
        includeSecret: true
      }),
      secret_print_policy: "create_rotate_only"
    };
  }
  const scopedCredential = await remoteCredentialInScope(database, input);
  if (action === "rotate") {
    const result = await database.rotateRemoteMcpCredential({
      credentialId: scopedCredential.id,
      expiresAt: optionalInput(input.expires_at),
      rotatedBy: "workbench"
    });
    return {
      ok: true,
      action,
      credential: result.credential,
      previous_credential: result.previous,
      one_time_secret: result.secret,
      provisioning: remoteCredentialProvisioning({
        action,
        request: input,
        httpRequest: request,
        credential: result.credential,
        previousCredential: result.previous,
        secret: result.secret,
        includeSecret: true
      }),
      secret_print_policy: "create_rotate_only"
    };
  }
  const credential = await database.revokeRemoteMcpCredential({
    credentialId: scopedCredential.id,
    revokedBy: "workbench"
  });
  return {
    ok: true,
    action,
    credential,
    provisioning: remoteCredentialProvisioning({
      action,
      request: input,
      httpRequest: request,
      credential,
      includeSecret: false
    }),
    secret_print_policy: "redacted"
  };
}

function remoteMcpJsonRpcId(value: unknown): RemoteMcpJsonRpcId {
  if (!isRecord(value)) return null;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function remoteMcpJsonRpcResult(id: RemoteMcpJsonRpcId, result: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, result };
}

function zodValidationIssues(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues : null;
}

function remoteMcpValidationMessage(error: unknown) {
  const issues = zodValidationIssues(error);
  if (!issues) return null;
  const summarized = issues.slice(0, 5).map((issue) => {
    const record = isRecord(issue) ? issue : {};
    const rawPath = Array.isArray(record.path) ? record.path.map(String).join(".") : "";
    const path = rawPath || "arguments";
    const message =
      typeof record.message === "string" ? record.message : "Invalid value for this field.";
    return `${path}: ${String(redactSystemActivityValue(message, "validation_message"))}`;
  });
  const suffix =
    issues.length > summarized.length ? `; ${issues.length - summarized.length} more` : "";
  return `VALIDATION_ERROR: invalid remote MCP tool arguments (${summarized.join("; ")}${suffix}). For simple facts use memory_type "work_log" or "environment_fact", not "fact".`;
}

function writeRemoteMcpJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
) {
  write(response, statusCode, JSON.stringify(payload), "application/json");
}

function remoteMcpErrorFromUnknown(error: unknown, fallbackId: RemoteMcpJsonRpcId = null) {
  if (error instanceof RemoteMcpRequestError) {
    return {
      statusCode: remoteMcpErrorStatus(error.contractCode),
      code: error.contractCode,
      body: remoteMcpJsonRpcErrorEnvelope(error.id ?? fallbackId, error.contractCode, error.message)
    };
  }
  if (error instanceof Error && error.message.startsWith("VALIDATION_ERROR:")) {
    return {
      statusCode: remoteMcpErrorStatus("VALIDATION_ERROR"),
      code: "VALIDATION_ERROR" as RemoteMcpErrorCode,
      body: remoteMcpJsonRpcErrorEnvelope(fallbackId, "VALIDATION_ERROR", error.message)
    };
  }
  const validationMessage = remoteMcpValidationMessage(error);
  if (validationMessage) {
    return {
      statusCode: remoteMcpErrorStatus("VALIDATION_ERROR"),
      code: "VALIDATION_ERROR" as RemoteMcpErrorCode,
      body: remoteMcpJsonRpcErrorEnvelope(fallbackId, "VALIDATION_ERROR", validationMessage)
    };
  }
  if (error instanceof SyntaxError) {
    return {
      statusCode: remoteMcpErrorStatus("VALIDATION_ERROR"),
      code: "VALIDATION_ERROR" as RemoteMcpErrorCode,
      body: remoteMcpJsonRpcErrorEnvelope(fallbackId, "VALIDATION_ERROR", "Malformed JSON body.")
    };
  }
  return {
    statusCode: remoteMcpErrorStatus("UNAVAILABLE"),
    code: "UNAVAILABLE" as RemoteMcpErrorCode,
    body: remoteMcpJsonRpcErrorEnvelope(
      fallbackId,
      "UNAVAILABLE",
      "Remote MCP request could not be completed."
    )
  };
}

async function startRemoteMcpAudit(input: {
  database: RecallantDb;
  auth: RemoteMcpAuthResult;
  method: string;
  request: IncomingMessage;
}) {
  const scope = input.auth.ok ? input.auth.scope : readRemoteMcpScopeHeaders(input.request);
  return input.database.startSystemActivity({
    trace_id: uuidOrNull(scope?.traceId),
    developer_id: uuidOrNull(scope?.developerId),
    project_id: uuidOrNull(scope?.projectId),
    session_id: uuidOrNull(scope?.sessionId),
    surface: "remote_mcp",
    operation: `remote_mcp.${input.method || "unknown"}`,
    actor_kind: input.auth.ok ? "agent" : "anonymous",
    actor_id: input.auth.ok ? input.auth.actorId : "unauthorized",
    client_kind: "remote_mcp",
    related_ids: {
      client_id: scope?.clientId ?? null,
      method: input.method || "unknown",
      credential_id: input.auth.ok ? input.auth.credential.id : null,
      credential_prefix: input.auth.ok ? input.auth.credential.credential_prefix : null
    },
    metadata: {
      audit_policy: "remote_mcp_redacted_no_raw_body_no_auth_headers",
      auth_mode: input.auth.ok ? input.auth.mode : "rejected",
      authorized: input.auth.ok,
      credential_id: input.auth.ok ? input.auth.credential.id : null,
      credential_prefix: input.auth.ok ? input.auth.credential.credential_prefix : null,
      required_headers_present: Object.fromEntries(
        remoteMcpRequiredHeaders.map((header) => [
          header,
          Boolean(remoteMcpHeader(input.request, header))
        ])
      ),
      optional_headers_present: {
        "X-Recallant-Session-Id": Boolean(remoteMcpHeader(input.request, "X-Recallant-Session-Id")),
        "X-Recallant-Trace-Id": Boolean(remoteMcpHeader(input.request, "X-Recallant-Trace-Id"))
      }
    }
  });
}

async function finishRemoteMcpAudit(input: {
  database: RecallantDb;
  activity: SystemActivityRecord | null;
  statusCode: number;
  startedAt: number;
  errorCode?: RemoteMcpErrorCode | null;
  method: string;
}) {
  if (!input.activity) return;
  await input.database.finishSystemActivity({
    id: input.activity.id,
    status: input.statusCode >= 500 ? "error" : input.statusCode >= 400 ? "skipped" : "success",
    error_code: input.errorCode ?? (input.statusCode >= 400 ? `HTTP_${input.statusCode}` : null),
    error_message: input.errorCode ? input.errorCode : null,
    metadata: {
      operation: `remote_mcp.${input.method || "unknown"}`,
      http_status: input.statusCode,
      duration_ms: Date.now() - input.startedAt,
      error_code: input.errorCode ?? null
    }
  });
}

function remoteMcpToolList() {
  function fieldDescription(schema: unknown) {
    if (!schema || typeof schema !== "object") return null;
    const description = (schema as { description?: unknown }).description;
    return typeof description === "string" && description.trim() ? description : null;
  }

  function requiredInputFields(toolName: string) {
    if (toolName === "memory_create_agent_memory") {
      return ["memory_type", "scope", "title", "body", "created_by", "audience"];
    }
    if (toolName === "memory_recall_agent_memories") return ["query"];
    return [];
  }

  return createRecallantTools().map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    examples: tool.examples ?? [],
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.shape).map(([name, schema]) => {
          const description = fieldDescription(schema);
          return [
            name,
            {
              title: name,
              ...(description ? { description } : {})
            }
          ];
        })
      ),
      required: requiredInputFields(tool.name)
    },
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.shape).map(([name, schema]) => {
          const description = fieldDescription(schema);
          return [
            name,
            {
              title: name,
              ...(description ? { description } : {})
            }
          ];
        })
      ),
      required: requiredInputFields(tool.name)
    }
  }));
}

async function dispatchRemoteMcpJsonRpc(input: {
  database: RecallantDb;
  body: unknown;
  auth: Extract<RemoteMcpAuthResult, { ok: true }>;
  projectPath: string | null;
}) {
  if (!isRecord(input.body) || input.body.jsonrpc !== "2.0") {
    throw new RemoteMcpRequestError(
      "VALIDATION_ERROR",
      "Remote MCP requires a JSON-RPC 2.0 object."
    );
  }
  const id = remoteMcpJsonRpcId(input.body);
  const method = optionalInput(input.body.method);
  const params = isRecord(input.body.params) ? input.body.params : {};
  if (method === "initialize") {
    return remoteMcpJsonRpcResult(id, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: recallantMcpServerName, version: "0.0.0" },
      capabilities: { tools: { listChanged: false } },
      transport: "json_rpc_http"
    });
  }
  if (method === "tools/list") {
    return remoteMcpJsonRpcResult(id, { tools: remoteMcpToolList() });
  }
  if (method === "tools/call") {
    const toolName = optionalInput(params.name);
    if (!toolName) {
      throw new RemoteMcpRequestError("VALIDATION_ERROR", "tools/call requires params.name.", id);
    }
    const tool = createRecallantTools({
      projectId: input.auth.scope.projectId,
      developerId: input.auth.scope.developerId,
      clientId: input.auth.scope.clientId,
      sessionId: input.auth.scope.sessionId,
      traceId: input.auth.scope.traceId,
      projectPath: input.projectPath,
      getDatabase: () => input.database
    }).find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new RemoteMcpRequestError(
        "VALIDATION_ERROR",
        `Unknown Recallant tool: ${toolName}.`,
        id
      );
    }
    const argumentsInput = isRecord(params.arguments) ? params.arguments : {};
    const parsedArgs = tool.inputSchema.parse(argumentsInput);
    const payload = await tool.handler(parsedArgs);
    return remoteMcpJsonRpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload
    });
  }
  throw new RemoteMcpRequestError(
    "VALIDATION_ERROR",
    `Unsupported remote MCP method: ${method}.`,
    id
  );
}

async function handleRemoteMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  databaseOverride?: RecallantDb
) {
  const startedAt = Date.now();
  const database = databaseOverride ?? createRecallantDbFromEnv();
  if (!database) {
    writeRemoteMcpJson(
      response,
      remoteMcpErrorStatus("UNAVAILABLE"),
      remoteMcpJsonRpcErrorEnvelope(null, "UNAVAILABLE", "Remote MCP database is unavailable.")
    );
    return;
  }
  let activity: SystemActivityRecord | null = null;
  let statusCode = 200;
  let errorCode: RemoteMcpErrorCode | null = null;
  let method = "unknown";
  let id: RemoteMcpJsonRpcId = null;
  try {
    const body = await readJsonWithLimit(request, remoteMcpPayloadLimits.requestHardBytes);
    id = remoteMcpJsonRpcId(body);
    method = isRecord(body) && typeof body.method === "string" ? body.method : "unknown";
    assertRemoteMcpBodyIsAllowed(body, id);
    const auth = await authorizeRemoteMcpRequest(request, database);
    activity = await startRemoteMcpAudit({ database, auth, method, request });
    if (!auth.ok) {
      statusCode = auth.httpStatus;
      errorCode = auth.code;
      writeRemoteMcpJson(
        response,
        statusCode,
        remoteMcpJsonRpcErrorEnvelope(id, auth.code, auth.message)
      );
      return;
    }
    const binding = await database.getProjectBinding(auth.scope.projectId);
    assertRemoteMcpProjectScope(auth.scope, binding);
    const projectPath =
      binding?.primary_path ?? (await database.projectPrimaryPath(auth.scope.projectId));
    const result = await dispatchRemoteMcpJsonRpc({ database, body, auth, projectPath });
    writeRemoteMcpJson(response, statusCode, result);
  } catch (error) {
    const remoteError = remoteMcpErrorFromUnknown(error, id);
    statusCode = remoteError.statusCode;
    errorCode = remoteError.code;
    if (!activity) {
      const auth = remoteMcpAuthFailure(
        remoteError.code,
        "Remote MCP request failed before authorization completed."
      );
      activity = await startRemoteMcpAudit({ database, auth, method, request }).catch(() => null);
    }
    writeRemoteMcpJson(response, statusCode, remoteError.body);
  } finally {
    await finishRemoteMcpAudit({
      database,
      activity,
      statusCode,
      startedAt,
      errorCode,
      method
    }).catch(() => undefined);
  }
}

function buildForgetInput(body: Record<string, unknown>): ForgetInput {
  const target = asRecord(body.target);
  const confirmation = asRecord(body.confirmation);
  const confirmed = confirmation.confirmed === true || body.confirm === "true";
  return {
    target: {
      kind: optionalInput(target.kind) ?? optionalInput(body.target_kind) ?? "agent_memory",
      id:
        optionalInput(target.id) ?? optionalInput(body.target_id) ?? optionalInput(body.memory_id),
      selector: asRecord(target.selector)
    },
    reason: optionalInput(body.reason) ?? "Review UI forget forever",
    dry_run: confirmed ? false : true,
    confirmation: {
      confirmed,
      confirmation_token: optionalInput(confirmation.confirmation_token)
    }
  };
}

function reviewPath(projectId: unknown, memoryId?: unknown) {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", String(projectId));
  if (memoryId) params.set("memory_id", String(memoryId));
  const query = params.toString();
  return `/review${query ? `?${query}` : ""}`;
}

function reviewPathWithParams(projectId: unknown, params: Record<string, unknown>) {
  const query = new URLSearchParams();
  if (projectId) query.set("project_id", String(projectId));
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === "all") continue;
    query.set(key, String(value));
  }
  const rendered = query.toString();
  return `/review${rendered ? `?${rendered}` : ""}`;
}

type WorkbenchGraphReviewInput = ReviewGraphCandidateInput & {
  project_id?: string | null;
};

function graphReviewTargetId(body: Record<string, unknown>) {
  return optionalInput(body.graph_candidate_id) ?? optionalInput(body.candidate_id);
}

function isGraphReviewRequest(body: Record<string, unknown>) {
  return (
    Boolean(graphReviewTargetId(body)) ||
    optionalInput(body.target_kind) === "graph_candidate" ||
    body.graph_review === true ||
    optionalInput(body.review_kind) === "graph_candidate"
  );
}

function numberFormInput(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  return Number(value);
}

function graphReviewPatch(action: string, body: Record<string, unknown>) {
  const rawPatch = isRecord(body.patch) ? body.patch : {};
  const patch: Record<string, unknown> = {};
  const value = (key: string) => rawPatch[key] ?? body[key];
  const nodeKind = optionalInput(value("node_kind"));
  const relationType = optionalInput(value("relation_type"));
  const title = optionalInput(value("title"));
  const summary = optionalInput(value("summary"));
  const lifecycleState = optionalInput(value("lifecycle_state"));
  const confidence = numberFormInput(value("confidence"));
  const metadata =
    (isRecord(rawPatch.metadata) ? rawPatch.metadata : null) ??
    (isRecord(body.patch_metadata) ? body.patch_metadata : null) ??
    parseOptionalJsonObject(body.patch_metadata);
  if (nodeKind) patch.node_kind = nodeKind;
  if (relationType) patch.relation_type = relationType;
  if (action === "edit" && (title || "title" in rawPatch || "title" in body)) patch.title = title;
  if (action === "edit" && (summary || "summary" in rawPatch || "summary" in body))
    patch.summary = summary;
  if (confidence !== undefined) patch.confidence = confidence;
  if (lifecycleState) patch.lifecycle_state = lifecycleState;
  if (metadata) patch.metadata = metadata;
  return patch;
}

function graphReviewMetadata(body: Record<string, unknown>) {
  return (
    (isRecord(body.metadata) ? body.metadata : null) ?? parseOptionalJsonObject(body.metadata) ?? {}
  );
}

function buildGraphReviewInput(body: Record<string, unknown>): WorkbenchGraphReviewInput {
  const graphCandidateId = graphReviewTargetId(body);
  if (!graphCandidateId) throw new Error("VALIDATION_ERROR: graph_candidate_id is required");
  const action = optionalInput(body.action);
  if (!action) throw new Error("VALIDATION_ERROR: graph candidate action is required");
  const targetGraphCandidateId =
    optionalInput(body.target_graph_candidate_id) ?? optionalInput(body.target_candidate_id);
  return {
    project_id: optionalInput(body.project_id),
    graph_candidate_id: graphCandidateId,
    action: action as WorkbenchGraphReviewInput["action"],
    actor_kind: "user",
    note: optionalInput(body.note),
    patch: graphReviewPatch(action, body),
    merge_target_id: optionalInput(body.merge_target_id) ?? targetGraphCandidateId,
    superseded_by: optionalInput(body.superseded_by) ?? targetGraphCandidateId,
    metadata: graphReviewMetadata(body)
  };
}

function graphReviewRedirectPath(body: Record<string, unknown>, graphCandidateId: string) {
  return reviewPathWithParams(body.project_id, {
    view: optionalInput(body.view) ?? "review",
    graph_candidate_id: graphCandidateId,
    graph_lifecycle_state: body.graph_lifecycle_state,
    graph_candidate_kind: body.graph_candidate_kind,
    graph_extraction_method: body.graph_extraction_method,
    graph_source_kind: body.graph_source_kind,
    graph_node_kind: body.graph_node_kind,
    graph_relation_type: body.graph_relation_type
  });
}

function rootWorkbenchPath(view: WorkbenchView) {
  return view === "all" ? "/review" : `/review?view=${encodeURIComponent(view)}`;
}

function projectSelectionPath(projectId: unknown, view: WorkbenchView) {
  return view === "all" ? reviewPath(projectId) : reviewPathWithParams(projectId, { view });
}

function shortId(value: unknown) {
  return String(value ?? "").slice(0, 8);
}

function publicScreenshotMode() {
  return process.env.RECALLANT_PUBLIC_SCREENSHOT_MODE === "true";
}

function publicProjectBadge() {
  return publicScreenshotMode() ? "Demo memory space" : "";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatDisplayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
  }
  return String(value);
}

function parseOptionalJsonObject(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatUsd(value: unknown) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

function isSensitiveSettingKey(key: unknown) {
  return /(secret|api[_-]?key|token|password|database[_-]?url|auth|cloudflare|encryption)/i.test(
    String(key ?? "")
  );
}

function safeSettingValue(key: unknown, value: unknown) {
  if (!isSensitiveSettingKey(key)) return value;
  const configured =
    value !== null &&
    value !== undefined &&
    !(typeof value === "string" && value.trim().length === 0);
  return {
    status: configured ? "configured" : "not_configured",
    reference: String(key ?? "secret_setting"),
    redacted: true
  };
}

function sanitizeSettingRow(row: Record<string, unknown>) {
  return { ...row, value: safeSettingValue(row.key, row.value) };
}

function sanitizeDashboardForClient(data: ReviewDashboardData): ReviewDashboardData {
  return {
    ...data,
    settings: data.settings.map(sanitizeSettingRow)
  };
}

async function withAuditReport(
  database: NonNullable<ReturnType<typeof createRecallantDbFromEnv>>,
  dashboard: ReviewDashboardData,
  requestUrl: URL,
  activeView: WorkbenchView
) {
  if (activeView !== "audit") return dashboard;
  try {
    return {
      ...dashboard,
      audit_report: await database.getSystemAuditReport({
        project_id: optionalInput(requestUrl.searchParams.get("project_id")),
        since: optionalInput(requestUrl.searchParams.get("since")),
        until: optionalInput(requestUrl.searchParams.get("until")),
        surface: optionalInput(requestUrl.searchParams.get("surface")),
        status: optionalInput(requestUrl.searchParams.get("status")),
        limit: 100
      })
    };
  } catch (error) {
    return {
      ...dashboard,
      audit_error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseSettingValue(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseProjectSettingFormValue(key: string, rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  if (key === "embedding_route_enabled") return value === "true";
  if (key === "enabled_clients" || key === "project_paths" || key === "project_aliases") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return parseSettingValue(value);
}

function parseProjectKindFormValue(value: unknown) {
  const projectKind = String(value ?? "other");
  const allowed = ["repo", "subproject", "workspace", "personal_domain", "other"];
  if (allowed.includes(projectKind)) {
    return projectKind as "repo" | "subproject" | "workspace" | "personal_domain" | "other";
  }
  return "other";
}

function parseSourceKindFormValue(value: unknown): ProjectSourceKind {
  const sourceKind = String(value ?? "manual");
  const allowed: ProjectSourceKind[] = [
    "workspace_path",
    "repo",
    "server_path",
    "document_collection",
    "connector",
    "manual",
    "virtual",
    "other"
  ];
  return allowed.includes(sourceKind as ProjectSourceKind)
    ? (sourceKind as ProjectSourceKind)
    : "manual";
}

function settingLabel(key: unknown) {
  const settingKey = String(key ?? "");
  const labels: Record<string, string> = {
    capture_profile: "Capture profile",
    context_budget_profile: "Context budget",
    database_url: "Database connection",
    embedding_route_enabled: "Semantic search",
    enabled_clients: "Enabled clients",
    embedding_route: "Local search by meaning",
    paid_api_mode: "Paid API mode",
    project_aliases: "Project aliases",
    project_lifecycle: "Project lifecycle",
    project_paths: "Project paths",
    provider_api_key: "Provider API key reference",
    review_sensitivity: "Review sensitivity"
  };
  if (!labels[settingKey] && isSensitiveSettingKey(settingKey)) {
    if (/database[_-]?url/i.test(settingKey)) return "Database connection";
    if (/api[_-]?key/i.test(settingKey)) return "API key reference";
    if (/token|auth/i.test(settingKey)) return "Access token reference";
    if (/cloudflare/i.test(settingKey)) return "Cloudflare access reference";
    if (/encryption|password/i.test(settingKey)) return "Secret reference";
    return "Secret reference";
  }
  return labels[settingKey] ?? settingKey.replaceAll("_", " ");
}

function settingSourceLabel(source: unknown) {
  const value = String(source ?? "");
  const labels: Record<string, string> = {
    project_settings: "Project setting",
    system_settings: "System setting",
    developer_settings: "Developer setting"
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function settingSummary(row: Record<string, unknown>) {
  const key = String(row.key ?? "");
  if (isSensitiveSettingKey(key)) {
    const value = parseSettingValue(row.value);
    const status = asRecord(value).status ?? "configured";
    return `Secret setting is ${String(status).replaceAll("_", " ")}; raw value is hidden.`;
  }
  const value = parseSettingValue(row.value);
  const record = asRecord(value);
  if (key === "embedding_route") {
    const dims = record.dims ? ` Vector size: ${String(record.dims)}.` : "";
    return `Semantic search is configured locally.${dims}`;
  }
  if (key === "paid_api_mode") {
    if (value === "confirm_each") return "Paid model calls require explicit confirmation.";
    if (value === "disabled") return "Paid model calls are disabled.";
    return "Paid model use has a custom approval policy. Technical details show the exact value.";
  }
  if (key === "capture_profile") {
    return `Future capture profile: ${formatDisplayValue(value) || "not set"}.`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatDisplayValue(value) || "Not set.";
  }
  return "Configured centrally in Recallant.";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function sourcePath(row: Record<string, unknown>) {
  const title = String(row.title ?? "");
  if (title.startsWith("Imported ")) return title.slice("Imported ".length);
  const metadata = asRecord(row.metadata);
  const sourcePathValue = metadata.source_path;
  return typeof sourcePathValue === "string" ? sourcePathValue : title || "Memory";
}

function publicSafeProvenanceSummary(summary: string) {
  if (!publicScreenshotMode()) return summary;
  if (/event\s+[0-9a-f]{6,}/i.test(summary)) return "Source evidence available.";
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(summary)) {
    return "Source evidence available.";
  }
  return summary;
}

function humanStatus(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    needs_review: "Needs review",
    candidate: "Candidate",
    accepted: "Accepted",
    rejected: "Rejected",
    archived: "Archived",
    stale: "Stale",
    superseded: "Superseded"
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function humanPolicy(value: unknown) {
  const policy = String(value ?? "");
  const labels: Record<string, string> = {
    evidence_only: "Evidence only",
    recall_allowed: "Usable memory",
    instruction_grade: "Active rule",
    do_not_use: "Do not use"
  };
  return labels[policy] ?? policy.replaceAll("_", " ");
}

function memoryKindLabel(value: unknown) {
  const kind = String(value ?? "");
  const labels: Record<string, string> = {
    repo_contract: "Project rule candidate",
    checkpoint_seed: "Handoff checkpoint",
    environment_fact: "Environment fact",
    import_candidate: "Imported note",
    secret_reference: "Secret reference"
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

function riskSummary(row: Record<string, unknown>) {
  const metadata = asRecord(row.metadata);
  const risks = asArray(metadata.risks);
  const resultClasses = [
    ...asArray(metadata.result_classes),
    ...(typeof metadata.result_class === "string" ? [metadata.result_class] : [])
  ].map(String);
  if (
    resultClasses.some((value) => /secret|capability|connector/i.test(value)) ||
    String(row.memory_type ?? "") === "secret_reference"
  ) {
    return "Review as a secret or capability reference. Keep names only; do not promote raw secret material.";
  }
  const severity = String(metadata.risk ?? row.risk ?? "").replaceAll("_", " ");
  const messages = risks
    .map((risk) => asRecord(risk).message)
    .filter((message): message is string => typeof message === "string" && message.length > 0);
  if (messages.length > 0) return messages.slice(0, 2).join(" ");
  if (severity) return `Marked ${severity} risk by the import scanner.`;
  return "Review before trusting this as reusable memory.";
}

function currentEffect(row: Record<string, unknown>) {
  const status = String(row.status ?? "");
  const policy = String(row.use_policy ?? "");
  if (policy === "evidence_only") {
    return "It is stored as evidence only. Agents can inspect it, but it is not an active rule.";
  }
  if (policy === "instruction_grade") {
    return "This is an active rule and can affect future agent behavior.";
  }
  if (status === "rejected" || policy === "do_not_use") {
    return "This memory is rejected and should not be used.";
  }
  return "This can be recalled as working memory after review.";
}

function recommendedAction(row: Record<string, unknown>) {
  const policy = String(row.use_policy ?? "");
  const status = String(row.status ?? "");
  if (status === "needs_review" && policy === "evidence_only") {
    return "For this sandbox, keep it as evidence or reject it if it is not useful. Do not promote to a rule unless you explicitly want it to guide future work.";
  }
  if (status === "candidate") return "Accept if this is useful context; reject if it is noise.";
  if (status === "accepted")
    return "No action needed unless this should be archived or made stale.";
  return "Review only if this still matters.";
}

function renderBadges(entries: Array<[string, unknown]>) {
  return `<div class="badges">${entries
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`
    )
    .join("")}</div>`;
}

function renderMeta(entries: Array<[string, unknown]>) {
  const visible = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );
  if (visible.length === 0) return "";
  return `<dl>
    ${visible
      .map(
        ([key, value]) =>
          `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatDisplayValue(value))}</dd></div>`
      )
      .join("")}
  </dl>`;
}

function renderRows(rows: Array<Record<string, unknown>>, emptyLabel: string, projectId?: unknown) {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return rows
    .map((row) => {
      const isMemory = Boolean(row.memory_id);
      const provenance = asRecord(row.provenance);
      const provenanceSummary =
        typeof provenance.summary === "string" && provenance.summary.length > 0
          ? publicSafeProvenanceSummary(provenance.summary)
          : "";
      const title = isMemory
        ? sourcePath(row)
        : (row.title ??
          row.name ??
          row.provider ??
          row.key ??
          row.source_kind ??
          row.action ??
          row.project_id ??
          row.id);
      const body = isMemory
        ? currentEffect(row)
        : (row.body ??
          row.quote ??
          row.source_id ??
          row.primary_path ??
          row.model ??
          formatDisplayValue(row.value));
      const content = `<article class="item">
        <h3>${escapeHtml(title)}</h3>
        ${
          isMemory
            ? `${renderBadges([
                ["Decision", humanStatus(row.status)],
                ["Agent use", humanPolicy(row.use_policy)],
                ["Kind", memoryKindLabel(row.memory_type)]
              ])}
              <p>${escapeHtml(body)}</p>
              ${provenanceSummary ? `<p class="source-note">${escapeHtml(provenanceSummary)}</p>` : ""}
              <p class="why">${escapeHtml(riskSummary(row))}</p>`
            : `<p>${escapeHtml(body)}</p>
              ${renderMeta(
                Object.entries(row)
                  .filter(
                    ([key]) => !["title", "body", "quote", "name", "primary_path"].includes(key)
                  )
                  .slice(0, 6)
              )}`
        }
      </article>`;
      return row.memory_id && projectId
        ? `<a class="row-link" href="${escapeHtml(reviewPath(projectId, row.memory_id))}">${content}</a>`
        : content;
    })
    .join("");
}

function renderReviewActions(
  memory: Record<string, unknown>,
  projectId: unknown,
  sourceRefCount: number
) {
  const safeActions = [
    ["accept", "Keep as usable memory"],
    ["reject", "Reject"],
    ["archive", "Archive"],
    ["unarchive", "Unarchive"],
    ["mark_stale", "Mark stale"],
    ["demote_instruction", "Demote from rule"]
  ];
  if (sourceRefCount > 0) {
    safeActions.splice(5, 0, ["promote_instruction", "Promote to rule"]);
  }
  const simpleForms = safeActions
    .map(
      ([action, label]) => `<form method="post" action="/review-action">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
        <input type="hidden" name="action" value="${escapeHtml(action)}" />
        <button type="submit">${escapeHtml(label)}</button>
      </form>`
    )
    .join("");
  const editForm = `<details class="action-detail">
    <summary>Edit memory</summary>
    <form method="post" action="/review-action">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
      <input type="hidden" name="action" value="edit" />
      <label>Title <input name="title" value="${escapeHtml(memory.title)}" /></label>
      <label>Body <textarea name="body" rows="4">${escapeHtml(memory.body)}</textarea></label>
      <label>Note <input name="note" value="Owner edited memory from Review UI" /></label>
      <button type="submit">Save edit</button>
    </form>
  </details>`;
  const supersedeForm = `<details class="action-detail">
    <summary>Supersede / merge</summary>
    <form method="post" action="/review-action">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
      <input type="hidden" name="action" value="supersede" />
      <label>Replacement memory reference <input name="superseded_by" /></label>
      <label>Note <input name="note" value="Owner superseded memory from Review UI" /></label>
      <button type="submit">Mark superseded</button>
    </form>
    <form method="post" action="/review-action">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
      <input type="hidden" name="action" value="merge" />
      <label>Other memory references <input name="merge_memory_ids" placeholder="memory reference 1, memory reference 2" /></label>
      <label>Note <input name="note" value="Owner merged duplicate memories from Review UI" /></label>
      <button type="submit">Merge duplicates into this memory</button>
    </form>
  </details>`;
  const promoteGuard =
    sourceRefCount > 0
      ? ""
      : `<p class="action-note">Promotion requires visible source refs first.</p>`;
  return `${simpleForms}${promoteGuard}${editForm}${supersedeForm}`;
}

function renderMemoryForgetResult(
  memory: Record<string, unknown>,
  projectId: unknown,
  memoryForget?: MemoryForgetRenderState
) {
  if (!memoryForget?.result) return "";
  const targetId = String(memoryForget.target?.id ?? "");
  if (targetId && targetId !== String(memory.id ?? "")) return "";
  const result = memoryForget.result;
  const affected = asRecord(result.affected);
  const receipt = asRecord(result.redacted_receipt);
  const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
  const needsConfirmation = result.status !== "completed";
  const reason =
    memoryForget.reason ?? "Sensitive or wrong memory cleanup requested from Review UI";
  return `<article class="forget-result">
    <strong>${escapeHtml(
      needsConfirmation
        ? "Dry-run complete. Nothing was erased."
        : "Forget forever complete. Recallant content was redacted."
    )}</strong>
    <p>${escapeHtml(
      needsConfirmation
        ? "Review the affected Recallant records. Confirm only if this memory is sensitive, wrong, or must never be recalled again."
        : "This is not ordinary cleanup. The receipt below contains only safe internal references, counts, and status."
    )}</p>
    <div class="summary-grid">
      <span><strong>${escapeHtml(affected.agent_memories ?? 0)}</strong> memories</span>
      <span><strong>${escapeHtml(affected.chunks ?? 0)}</strong> chunks</span>
      <span><strong>${escapeHtml(affected.embeddings ?? 0)}</strong> embeddings</span>
      <span><strong>${escapeHtml(affected.events ?? 0)}</strong> events</span>
    </div>
    ${
      warnings.length > 0
        ? `<ul class="attention-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : ""
    }
    ${
      needsConfirmation
        ? `<form class="confirm-form" method="post" action="/memory-forget">
            <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
            <input type="hidden" name="target_kind" value="agent_memory" />
            <input type="hidden" name="target_id" value="${escapeHtml(memory.id)}" />
            <input type="hidden" name="reason" value="${escapeHtml(reason)}" />
            <input type="hidden" name="confirm" value="true" />
            <button class="danger" type="submit">Confirm forget forever</button>
          </form>`
        : `<details>
            <summary>Redacted receipt</summary>
            <pre>${escapeHtml(
              formatDisplayValue({
                erasure_id: result.erasure_id,
                status: result.status,
                receipt
              })
            )}</pre>
          </details>`
    }
  </article>`;
}

function renderMemoryForgetAction(
  memory: Record<string, unknown>,
  projectId: unknown,
  memoryForget?: MemoryForgetRenderState
) {
  const defaultReason = "Sensitive or wrong memory cleanup requested from Review UI";
  return `<details class="action-detail danger-zone">
    <summary>Forget forever</summary>
    <p>Only use this for sensitive or wrong memory. Ordinary project detach hides a project from Recallant; this redacts the selected memory so agents cannot recall it.</p>
    ${renderMemoryForgetResult(memory, projectId, memoryForget)}
    <form method="post" action="/memory-forget">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="target_kind" value="agent_memory" />
      <input type="hidden" name="target_id" value="${escapeHtml(memory.id)}" />
      <label>Reason <textarea name="reason" rows="3">${escapeHtml(defaultReason)}</textarea></label>
      <button type="submit">Dry-run forget forever</button>
    </form>
  </details>`;
}

function renderDuplicateResolution(
  memory: Record<string, unknown>,
  projectId: unknown,
  duplicateRows: Array<Record<string, unknown>>
) {
  const selectedId = String(memory.id ?? "");
  const selectedInList = duplicateRows.some((row) => row.memory_id === selectedId);
  const metadataText = JSON.stringify(memory.metadata ?? {});
  const looksDuplicate =
    selectedInList || /duplicate|conflict|possible_duplicate|possible_conflict/i.test(metadataText);
  const peers = duplicateRows.filter(
    (row) => row.memory_id && String(row.memory_id) !== selectedId
  );
  if (!looksDuplicate || peers.length === 0) return "";
  return `<details class="action-detail">
    <summary>Duplicate resolution</summary>
    <p>Choose which memory should remain canonical. Recallant will mark the other memory as merged or superseded through the normal review policy path.</p>
    <div class="duplicate-options">
      ${peers
        .slice(0, 6)
        .map(
          (peer) => `<article>
            <strong>${escapeHtml(sourcePath(peer))}</strong>
            <p>${escapeHtml(currentEffect(peer))}</p>
            <form method="post" action="/review-action">
              <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
              <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
              <input type="hidden" name="action" value="merge" />
              <input type="hidden" name="merge_memory_ids" value="${escapeHtml(peer.memory_id)}" />
              <input type="hidden" name="note" value="Owner chose this memory as canonical from Review UI" />
              <button type="submit">Keep this, merge other</button>
            </form>
            <form method="post" action="/review-action">
              <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
              <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
              <input type="hidden" name="action" value="supersede" />
              <input type="hidden" name="superseded_by" value="${escapeHtml(peer.memory_id)}" />
              <input type="hidden" name="note" value="Owner chose another canonical memory from Review UI" />
              <button type="submit">Use other, supersede this</button>
            </form>
          </article>`
        )
        .join("")}
    </div>
  </details>`;
}

function memoryRowId(row: Record<string, unknown>) {
  return String(row.memory_id ?? row.id ?? "");
}

function isConflictCandidate(row: Record<string, unknown>) {
  return /conflict|possible_conflict/i.test(JSON.stringify(row.metadata ?? {}));
}

function conflictRole(row: Record<string, unknown>) {
  const role = String(asRecord(row.metadata).conflict_role ?? "").toLowerCase();
  return role === "old" || role === "older"
    ? "old"
    : role === "new" || role === "newer"
      ? "new"
      : "";
}

function renderConflictRecord(label: string, row: Record<string, unknown>) {
  const provenance = asRecord(row.provenance);
  const provenanceSummary =
    typeof provenance.summary === "string" && provenance.summary.length > 0
      ? publicSafeProvenanceSummary(provenance.summary)
      : "No source reference recorded";
  return `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(sourcePath(row))}</strong>
    <p>${escapeHtml(currentEffect(row))}</p>
    <p class="source-note">Source: ${escapeHtml(provenanceSummary)}</p>
    <p class="source-note">${escapeHtml(humanPolicy(row.use_policy))}; ${escapeHtml(humanStatus(row.status))}</p>
  </article>`;
}

function renderConflictResolution(
  memory: Record<string, unknown>,
  projectId: unknown,
  conflictRows: Array<Record<string, unknown>>
) {
  const selectedId = memoryRowId(memory);
  const selectedMetadata = asRecord(memory.metadata);
  const conflictGroup = String(selectedMetadata.conflict_group ?? "");
  const selectedRow: Record<string, unknown> = {
    ...memory,
    memory_id: selectedId
  };
  const selectedLooksConflict =
    isConflictCandidate(selectedRow) || conflictRows.some((row) => memoryRowId(row) === selectedId);
  const peers = conflictRows.filter((row) => {
    const peerId = memoryRowId(row);
    if (!peerId || peerId === selectedId || !isConflictCandidate(row)) return false;
    if (!conflictGroup) return true;
    return String(asRecord(row.metadata).conflict_group ?? "") === conflictGroup;
  });
  if (!selectedLooksConflict || peers.length === 0) return "";
  const related: Array<Record<string, unknown>> = [selectedRow, ...peers];
  const oldRow =
    related.find((row) => conflictRole(row) === "old") ??
    [...related].sort(
      (left, right) =>
        new Date(String(left.updated_at ?? 0)).getTime() -
        new Date(String(right.updated_at ?? 0)).getTime()
    )[0];
  const newRow =
    related.find((row) => conflictRole(row) === "new") ??
    [...related].sort(
      (left, right) =>
        new Date(String(right.updated_at ?? 0)).getTime() -
        new Date(String(left.updated_at ?? 0)).getTime()
    )[0];
  const oldId = oldRow ? memoryRowId(oldRow) : "";
  const newId = newRow ? memoryRowId(newRow) : "";
  if (!oldRow || !newRow || !oldId || !newId || oldId === newId) return "";
  return `<details class="action-detail">
    <summary>Conflict resolution</summary>
    <p>Compare the older and newer records, then choose the active guidance. The losing memory is marked through the same review policy path.</p>
    <h4>Source comparison</h4>
    <p>Cross-source conflicts stay in review. Recallant does not silently turn overlapping evidence into an active rule.</p>
    <div class="conflict-compare">
      ${renderConflictRecord("Older record", oldRow)}
      ${renderConflictRecord("Newer record", newRow)}
    </div>
    <div class="conflict-actions">
      <form method="post" action="/review-action">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="memory_id" value="${escapeHtml(oldId)}" />
        <input type="hidden" name="action" value="supersede" />
        <input type="hidden" name="superseded_by" value="${escapeHtml(newId)}" />
        <input type="hidden" name="note" value="Owner resolved conflict by using newer memory from Review UI" />
        <button type="submit">Use newer, supersede older</button>
      </form>
      <form method="post" action="/review-action">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="memory_id" value="${escapeHtml(newId)}" />
        <input type="hidden" name="action" value="archive" />
        <input type="hidden" name="note" value="Owner resolved conflict by keeping older memory from Review UI" />
        <button type="submit">Keep older, archive newer</button>
      </form>
      <form method="post" action="/review-action">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="memory_id" value="${escapeHtml(selectedId)}" />
        <input type="hidden" name="action" value="demote_instruction" />
        <input type="hidden" name="note" value="Owner demoted conflicting rule from Review UI" />
        <button type="submit">Demote selected from rule</button>
      </form>
    </div>
  </details>`;
}

function renderProvenanceDrilldown(payload: {
  memory_space?: Record<string, unknown> | null;
  source_refs?: Array<Record<string, unknown>>;
  resolved_source_refs?: Array<Record<string, unknown>>;
}) {
  const memorySpace = payload.memory_space ?? {};
  const sourceRefs = payload.resolved_source_refs ?? payload.source_refs ?? [];
  const memorySpaceLabel =
    projectDisplayName(memorySpace) || memorySpace.project_id || "Unknown memory space";
  const sourceRows =
    sourceRefs.length === 0
      ? `<p class="empty">No source refs recorded for this memory.</p>`
      : sourceRefs
          .map((sourceRef) => {
            const projectSource = asRecord(sourceRef.project_source);
            const health = asRecord(projectSource.source_health);
            const label =
              sourceDisplayTitle(projectSource) ||
              String(asRecord(sourceRef.metadata).source_path ?? sourceRef.source_id ?? "Source");
            const kind =
              String(projectSource.source_kind_label ?? "") ||
              sourceKindLabel(projectSource.source_kind ?? sourceRef.source_kind);
            const status = String(projectSource.status ?? "source ref");
            const healthLabel = String(health.label ?? "Source reference recorded");
            const quote = typeof sourceRef.quote === "string" ? sourceRef.quote : "";
            return `<article class="provenance-source">
              <strong>${escapeHtml(label)}</strong>
              <span>${escapeHtml(kind)}</span>
              <span>${escapeHtml(status === "active" ? "Active source" : status.replaceAll("_", " "))}</span>
              <span>${escapeHtml(healthLabel)}</span>
              ${quote ? `<p>${escapeHtml(quote)}</p>` : ""}
            </article>`;
          })
          .join("");
  return `<div class="provenance-drilldown">
    <article>
      <strong>${escapeHtml(memorySpaceLabel)}</strong>
      <span>Memory space</span>
      <p>${escapeHtml(
        `Domain: ${String(memorySpace.memory_domain ?? "unknown").replaceAll("_", " ")}`
      )}</p>
    </article>
    ${sourceRows}
  </div>`;
}

function renderDetail(
  detail: unknown,
  availableActions: unknown,
  projectId: unknown,
  memoryForget?: MemoryForgetRenderState,
  duplicateRows: Array<Record<string, unknown>> = []
) {
  if (!detail || typeof detail !== "object") {
    return `<p class="empty">No selected memory.</p>`;
  }
  const payload = detail as {
    memory?: Record<string, unknown> | null;
    memory_space?: Record<string, unknown> | null;
    source_refs?: Array<Record<string, unknown>>;
    resolved_source_refs?: Array<Record<string, unknown>>;
    review_actions?: Array<Record<string, unknown>>;
  };
  const memory = payload.memory;
  if (!memory) return `<p class="empty">No selected memory.</p>`;
  const actions = Array.isArray(availableActions) ? availableActions.map(String) : [];
  return `<article class="detail">
    <h3>${escapeHtml(sourcePath(memory))}</h3>
    ${renderBadges([
      ["Decision", humanStatus(memory.status)],
      ["Agent use", humanPolicy(memory.use_policy)],
      ["Kind", memoryKindLabel(memory.memory_type)]
    ])}
    <h4>What this is</h4>
    <p>${escapeHtml(currentEffect(memory))}</p>
    <h4>Why it needs review</h4>
    <p>${escapeHtml(riskSummary(memory))}</p>
    <h4>Recommended action</h4>
    <p>${escapeHtml(recommendedAction(memory))}</p>
    <h4>Normal review actions</h4>
    <p class="action-note">Use these for ordinary review decisions: keep as Usable memory, reject, archive, edit, merge, or promote source-backed guidance into an Active rule.</p>
    <div class="actions review-action-group">${renderReviewActions(memory, projectId, payload.source_refs?.length ?? 0)}</div>
    ${renderDuplicateResolution(memory, projectId, duplicateRows)}
    ${renderConflictResolution(memory, projectId, duplicateRows)}
    <h4>Separate sensitive cleanup</h4>
    <p class="action-note">Forget forever is separate from normal review. It is only for sensitive or wrong memory and still starts with a dry run.</p>
    <div class="actions risky-action-group">${renderMemoryForgetAction(memory, projectId, memoryForget)}</div>
    <details open>
      <summary>Where this came from</summary>
      ${renderProvenanceDrilldown(payload)}
    </details>
    <details>
      <summary>Evidence excerpts</summary>
      ${renderRows(payload.source_refs ?? [], "No source refs recorded.")}
    </details>
    <details>
      <summary>Review history</summary>
      ${renderRows(payload.review_actions ?? [], "No review actions yet.")}
    </details>
    <details>
      <summary>Technical details</summary>
      ${renderMeta([
        ["memory_id", memory.id],
        ["status", memory.status],
        ["use_policy", memory.use_policy],
        ["memory_type", memory.memory_type],
        ["scope", memory.scope],
        ["scope_kind", memory.scope_kind],
        ["scope_id", memory.scope_id],
        ["audience", memory.audience],
        ["confidence", memory.confidence],
        ["created_by", memory.created_by],
        ["metadata", memory.metadata]
      ])}
    </details>
    <details>
      <summary>Technical action keys</summary>
      <div class="actions disabled">${actions.map((action) => `<span>${escapeHtml(action)}</span>`).join("")}</div>
    </details>
  </article>`;
}

function projectDisplayName(row: Record<string, unknown>) {
  if (publicScreenshotMode() && !row.name && !row.title) return "Demo memory space";
  return (
    row.title ??
    row.name ??
    row.provider ??
    row.key ??
    row.source_kind ??
    row.action ??
    row.project_id ??
    row.id
  );
}

function captureState(row: Record<string, unknown>) {
  const interrupted = Number(row.interrupted_sessions ?? 0);
  if (interrupted > 0) return { label: "Interrupted", className: "interrupted" };
  if (row.last_context_read_at && row.last_memory_write_at && row.checkpoint_updated_at) {
    return { label: "Capture active", className: "active" };
  }
  if (Number(row.session_count ?? 0) > 0 || row.last_context_read_at) {
    return { label: "Started, not complete", className: "started" };
  }
  return { label: "Registered only", className: "registered" };
}

function sourceLabel(row: Record<string, unknown>) {
  const sources = Array.isArray(row.sources) ? (row.sources as Array<Record<string, unknown>>) : [];
  const primarySource =
    sources.find((source) => source.is_primary === true && source.status === "active") ??
    sources.find((source) => source.status === "active") ??
    sources[0];
  if (primarySource) {
    if (primarySource.source_kind === "workspace_path" && primarySource.is_primary === true) {
      return "Workspace folder attached";
    }
    return `${sourceKindLabel(primarySource.source_kind)}: ${sourceDisplayTitle(primarySource)}`;
  }
  const path = row.primary_path;
  if (publicScreenshotMode() && path) return "Workspace folder attached";
  if (path) return `Workspace folder: ${String(path)}`;
  if (row.project_kind === "personal_domain") return "Virtual personal memory space";
  return "No attached source is recorded yet";
}

function isHumanMemorySpace(row: Record<string, unknown>) {
  return row.project_kind === "personal_domain" || row.memory_domain === "personal_life";
}

function sourceKindLabel(value: unknown) {
  const labels: Record<string, string> = {
    workspace_path: "Workspace folder",
    repo: "Repository",
    server_path: "Server path",
    document_collection: "Document collection",
    connector: "Connector",
    manual: "Manual source",
    virtual: "Virtual source",
    other: "Source"
  };
  return labels[String(value ?? "")] ?? "Source";
}

function sourceDisplayTitle(source: Record<string, unknown>) {
  const sourceKind = String(source.source_kind ?? "");
  const label = String(source.display_label ?? source.label ?? "").trim();
  if (sourceKind === "workspace_path" && source.is_primary === true) {
    return "Primary workspace folder";
  }
  return label || sourceKindLabel(sourceKind);
}

function attachedSourceSummary(row: Record<string, unknown>) {
  const sources = Array.isArray(row.sources) ? (row.sources as Array<Record<string, unknown>>) : [];
  if (sources.length === 0) return "No attached sources yet";
  const active = sources.filter((source) => source.status === "active");
  const detached = sources.filter((source) => source.status === "detached");
  const parts = [`${active.length} active source${active.length === 1 ? "" : "s"}`];
  if (detached.length > 0) parts.push(`${detached.length} detached`);
  return parts.join(", ");
}

function memoryProfile(row: Record<string, unknown>) {
  const profile = asRecord(row.memory_profile);
  return {
    label: String(profile.label ?? "Memory space"),
    purpose: String(profile.purpose ?? "Recallant memory space."),
    defaultIsolation: String(
      profile.default_isolation ?? "Isolated by default; shared only through governed recall."
    ),
    allowedRecall: String(
      profile.allowed_recall ?? "Recall uses this memory space according to governed policy."
    ),
    capturePolicy: String(
      profile.capture_policy ?? "Recording state depends on explicit agent activity."
    ),
    connectorPolicy: String(
      profile.connector_policy ??
        "Connectors are not active until separate consent and setup are recorded."
    ),
    defaultSources: String(profile.default_sources ?? "zero sources by default")
  };
}

function sharingPolicy(row: Record<string, unknown>) {
  const profile = memoryProfile(row);
  if (profile.defaultIsolation) return profile.defaultIsolation;
  if (row.memory_domain === "agent_work") {
    return "Isolated by default; agents may ask for source-linked examples from other spaces.";
  }
  return "Isolated by default; shared only through governed recall.";
}

function currentProject(data: ReviewDashboardData) {
  return data.projects.find((row) => row.project_id === data.current_project_id) ?? {};
}

function currentProjectSources(data: ReviewDashboardData) {
  const sources = currentProject(data).sources;
  return Array.isArray(sources) ? (sources as Array<Record<string, unknown>>) : [];
}

function projectPathLabel(row: Record<string, unknown>) {
  const primaryPath = row.primary_path;
  if (!primaryPath) return "No primary path recorded";
  if (publicScreenshotMode()) return "Workspace folder attached";
  return String(primaryPath);
}

function sourceStatusLabel(source: Record<string, unknown>) {
  const health = asRecord(source.source_health);
  if (typeof health.label === "string" && health.label.length > 0) {
    return health.label;
  }
  const status = String(source.status ?? "active");
  const prefix = source.is_primary ? "Primary" : sourceKindLabel(source.source_kind);
  if (status === "active") return `${prefix} active`;
  return `${prefix} ${status.replaceAll("_", " ")}`;
}

function sourceHealth(source: Record<string, unknown>) {
  const health = asRecord(source.source_health);
  return {
    status: String(health.status ?? source.status ?? "ready").replaceAll("_", "-"),
    label: String(health.label ?? sourceStatusLabel(source)),
    reason:
      typeof health.reason === "string" && health.reason.length > 0
        ? health.reason
        : "Recallant can show this source as provenance when memory is source-linked.",
    action:
      typeof health.action_needed === "string" && health.action_needed.length > 0
        ? health.action_needed
        : "No action needed."
  };
}

function sourceHealthCounts(sources: Array<Record<string, unknown>>) {
  const counts = {
    active: sources.filter((source) => source.status === "active").length,
    detached: sources.filter((source) => source.status === "detached").length,
    ready: 0,
    needsSetup: 0,
    needsAttention: 0
  };
  for (const source of sources) {
    const status = sourceHealth(source).status;
    if (status === "ready") counts.ready += 1;
    else if (status === "needs-setup") counts.needsSetup += 1;
    else if (status === "needs-attention") counts.needsAttention += 1;
  }
  return counts;
}

function sourceMapStatus(source: Record<string, unknown>) {
  if (source.status === "detached") return "detached";
  const status = sourceHealth(source).status;
  if (status === "ready") return "ready";
  if (status === "needs-setup") return "needs-setup";
  if (status === "needs-attention") return "needs-attention";
  return "ready";
}

function sourceMapStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "Ready to cite",
    "needs-setup": "Needs setup",
    "needs-attention": "Needs attention",
    detached: "Detached"
  };
  return labels[status] ?? "Source";
}

function sourceAttachmentLabel(source: Record<string, unknown>) {
  return source.status === "detached" ? "Detached source" : "Attached source";
}

function sourceUsabilityLabel(source: Record<string, unknown>) {
  const status = sourceMapStatus(source);
  if (status === "ready") return "Usable for citations";
  if (status === "needs-setup") return "Planned; setup needed";
  if (status === "needs-attention") return "Needs attention before use";
  return "Detached; kept as provenance";
}

function sourceAccessContractSummary(source: Record<string, unknown>) {
  const contract = asRecord(source.source_access_contract);
  const capabilityStatus = String(contract.capability_binding_status ?? "not_required");
  if (capabilityStatus === "needed") {
    return "Governed access or capability binding is needed before live capture. Raw secrets stay outside Recallant.";
  }
  if (capabilityStatus === "ready") {
    return "Governed access is recorded; raw secrets stay outside Recallant.";
  }
  return "No external access is needed for this source record.";
}

function sourceMapRole(source: Record<string, unknown>) {
  const kind = String(source.source_kind ?? "other");
  if (kind === "workspace_path") return "Primary workspace evidence";
  if (kind === "repo") return "Repository evidence";
  if (kind === "document_collection") return "Document evidence";
  if (kind === "connector") return "Connector reference";
  if (kind === "server_path") return "Server/environment reference";
  if (kind === "manual") return "Owner-supplied note";
  if (kind === "virtual") return "Virtual memory branch";
  return "Supporting source";
}

function sourceCaptureReadiness(source: Record<string, unknown>) {
  const contract = asRecord(source.source_access_contract);
  const readiness = String(contract.capture_readiness ?? "");
  if (source.status === "detached") return "Detached from new capture";
  if (readiness === "ready_or_reference_only") return "Ready or reference-only";
  if (readiness === "consent_or_capability_needed") return "Consent/setup needed";
  if (readiness === "governed_setup_needed") return "Governed setup needed";
  return "Ready for provenance";
}

function sourceProvenanceNote(source: Record<string, unknown>) {
  const status = sourceMapStatus(source);
  if (status === "ready") {
    return "Recallant can cite memory from this source with provenance.";
  }
  if (status === "needs-setup") {
    return "Visible in the map, but setup is needed before agents should rely on it.";
  }
  if (status === "needs-attention") {
    return "Recallant can keep the source record, but this source needs attention.";
  }
  return "Detached from active use. Memory remains in Recallant unless separately cleaned.";
}

function sourceFilterState(data: ReviewDashboardData) {
  const sourceFilters = asRecord(data.source_filters);
  const sources = asArray(sourceFilters.sources) as Array<Record<string, unknown>>;
  const selectedSourceId = String(sourceFilters.selected_source_id ?? "all");
  const selectedSourceRecord = asRecord(sourceFilters.selected_source);
  const selectedSource =
    Object.keys(selectedSourceRecord).length > 0
      ? selectedSourceRecord
      : (sources.find(
          (source) => String(source.source_id ?? source.id ?? "") === selectedSourceId
        ) ?? {});
  const selectedLabel =
    selectedSourceId !== "all"
      ? sourceDisplayTitle(selectedSource) || shortId(selectedSourceId)
      : "All sources";
  return {
    sources,
    selectedSource,
    selectedSourceId,
    selectedLabel,
    isFiltered: selectedSourceId !== "all"
  };
}

function renderSourceFilterControl(data: ReviewDashboardData, view: WorkbenchView, note?: string) {
  const state = sourceFilterState(data);
  if (state.sources.length === 0) {
    return `<div class="source-filter-panel">
      <div>
        <span class="section-kicker">Source view</span>
        <h3>No source filter yet</h3>
        <p>This memory space has no attached sources. Recallant is showing the whole memory space.</p>
      </div>
    </div>`;
  }
  const chip = (label: string, sourceId: unknown) => {
    const normalized = String(sourceId ?? "all");
    const active = normalized === "all" ? !state.isFiltered : normalized === state.selectedSourceId;
    return `<a class="source-filter-chip ${active ? "active" : ""}" href="${escapeHtml(
      reviewPathWithParams(data.current_project_id, { view, source_id: normalized })
    )}">${escapeHtml(label)}</a>`;
  };
  const sourceChips = state.sources
    .slice(0, 12)
    .map((source) => chip(sourceDisplayTitle(source), source.source_id ?? source.id))
    .join("");
  const defaultNote = state.isFiltered
    ? "Review rows and source-linked memory writes are limited to this source. Session, context, and checkpoint activity stays visible so recording state is not hidden."
    : "Showing the whole memory space. Pick a source when you want to inspect where a fact came from or narrow review work.";
  return `<div class="source-filter-panel">
    <div>
      <span class="section-kicker">Source view</span>
      <h3>${escapeHtml(state.isFiltered ? `Filtered to ${state.selectedLabel}` : "Showing all sources")}</h3>
      <p>${escapeHtml(note ?? defaultNote)}</p>
    </div>
    <div class="source-filter-chips">
      ${chip("All sources", "all")}
      ${sourceChips}
    </div>
  </div>`;
}

function renderSourceResult(source?: SourceRenderState) {
  if (!source?.result && !source?.message) return "";
  const result = asRecord(source.result);
  const labels: Record<string, string> = {
    create_space: "Memory space created.",
    attach_source: "Source attached.",
    detach_source: "Source detached."
  };
  const title = source.action ? labels[source.action] : "Memory space updated.";
  const body =
    source.message ??
    (source.action === "create_space"
      ? "The new space is available in Recallant. It can hold memory even before a folder is attached."
      : source.action === "detach_source"
        ? "The memory space remains available; only this source binding was detached. Detaching a source does not delete memories."
        : "The source is now linked to this memory space and can be shown as provenance.");
  return `<article class="source-result">
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(body)}</p>
    <details>
      <summary>Technical details</summary>
      ${renderMeta([
        ["source_id", result.id ?? result.source_id],
        ["project_id", result.project_id],
        ["source_kind", result.source_kind],
        ["status", result.status],
        ["uri", result.uri],
        ["memory_space", result.name]
      ])}
    </details>
  </article>`;
}

function renderSourceTree(data: ReviewDashboardData) {
  const project = currentProject(data);
  const sources = currentProjectSources(data);
  const title = projectDisplayName(project) || data.current_project_id;
  const rootNote = sources.length
    ? "This memory space can cite attached sources without mixing them automatically."
    : "This memory space has no attached sources yet.";
  const counts = sourceHealthCounts(sources);
  const groups = ["ready", "needs-setup", "needs-attention", "detached"].map((status) => ({
    status,
    label: sourceMapStatusLabel(status),
    sources: sources.filter((source) => sourceMapStatus(source) === status)
  }));
  return `<div class="source-tree" aria-label="Memory Tree source map">
    <article class="source-tree-root">
      <span>Memory Tree root</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(rootNote)}</p>
      <p>${escapeHtml(`${counts.ready} usable, ${counts.needsSetup} planned, ${counts.needsAttention} need attention, ${counts.detached} detached`)}</p>
    </article>
    <div class="source-tree-groups">
      ${groups
        .filter((group) => group.sources.length > 0)
        .map(
          (group) => `<section class="source-tree-group ${escapeHtml(group.status)}">
            <h3>${escapeHtml(group.label)}</h3>
            <div>
              ${group.sources
                .map((source) => {
                  const sourceId = source.source_id ?? source.id;
                  const sourceMemoryPath = reviewPathWithParams(data.current_project_id, {
                    source_id: sourceId
                  });
                  return `<article class="source-tree-node">
                    <strong>${escapeHtml(sourceDisplayTitle(source))}</strong>
                    <span>${escapeHtml(sourceMapRole(source))}</span>
                    <span>${escapeHtml(sourceAttachmentLabel(source))}</span>
                    <span>${escapeHtml(sourceKindLabel(source.source_kind))}</span>
                    <span>${escapeHtml(sourceUsabilityLabel(source))}</span>
                    <span>${escapeHtml(sourceCaptureReadiness(source))}</span>
                    <p>${escapeHtml(sourceProvenanceNote(source))}</p>
                    <p>${escapeHtml(sourceAccessContractSummary(source))}</p>
                    <a href="${escapeHtml(sourceMemoryPath)}#sources">View source memory</a>
                  </article>`;
                })
                .join("")}
            </div>
          </section>`
        )
        .join("")}
    </div>
  </div>`;
}

function renderMemorySpaceForms(data: ReviewDashboardData) {
  return `<details class="memory-space-editor">
    <summary>Create a memory space</summary>
    <form class="source-form" method="post" action="/memory-space">
      <label>Name<input name="name" required placeholder="Client research, My servers, Personal operations" /></label>
      <label>Kind<select name="project_kind">
        <option value="other">Virtual or general</option>
        <option value="repo">Code repository</option>
        <option value="workspace">Workspace</option>
        <option value="personal_domain">Personal / work domain</option>
        <option value="subproject">Subproject</option>
      </select></label>
      <label>Memory domain<select name="memory_domain">
        <option value="agent_work">Agent work</option>
        <option value="personal_life">Personal / work operations</option>
      </select></label>
      <label>Optional folder or path<input name="primary_path" placeholder="/path/to/project or leave empty" /></label>
      <button type="submit">Create space</button>
    </form>
  </details>
  <details class="memory-space-editor">
    <summary>Attach a source to selected space</summary>
    <form class="source-form" method="post" action="/source-attach">
      <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
      <label>Source type<select name="source_kind">
        <option value="workspace_path">Workspace folder</option>
        <option value="repo">Repository</option>
        <option value="server_path">Server path</option>
        <option value="document_collection">Document collection</option>
        <option value="connector">Connector</option>
        <option value="manual">Manual source</option>
        <option value="virtual">Virtual source</option>
        <option value="other">Other source</option>
      </select></label>
      <label>Label<input name="label" required placeholder="Docs folder, Google Drive notes, production server" /></label>
      <label>Location or reference<input name="uri" placeholder="/path/to/project, github:owner/repo, gdrive:folder-id" /></label>
      <label class="checkbox-line"><input type="checkbox" name="primary" value="true" /> Make this the primary source</label>
      <button type="submit">Attach source</button>
    </form>
  </details>`;
}

function renderSelectedSources(data: ReviewDashboardData) {
  const sources = currentProjectSources(data);
  if (sources.length === 0) {
    return `<p class="empty">No sources are attached to this memory space yet.</p>`;
  }
  return `<div class="source-list">
    ${sources
      .map((source) => {
        const health = sourceHealth(source);
        const sourceId = source.source_id ?? source.id;
        const sourceMemoryPath = reviewPathWithParams(data.current_project_id, {
          source_id: sourceId
        });
        return `<article class="source-card">
          <div>
            <strong>${escapeHtml(sourceDisplayTitle(source))}</strong>
            <span class="source-health ${escapeHtml(health.status)}">${escapeHtml(health.label)}</span>
            <span class="source-role">${escapeHtml(sourceMapRole(source))}</span>
            <span class="source-attachment">${escapeHtml(sourceAttachmentLabel(source))}</span>
            <span class="source-usability">${escapeHtml(sourceUsabilityLabel(source))}</span>
            <span class="source-readiness">${escapeHtml(sourceCaptureReadiness(source))}</span>
            <span class="source-kind">${escapeHtml(sourceKindLabel(source.source_kind))}</span>
            <p>${escapeHtml(sourceProvenanceNote(source))}</p>
            <p>${escapeHtml(sourceAccessContractSummary(source))}</p>
            <p>${escapeHtml(health.reason)}</p>
            <p class="source-action">${escapeHtml(health.action)}</p>
            <div class="source-card-actions">
              <a href="${escapeHtml(sourceMemoryPath)}#review">Show source memories</a>
              <a href="${escapeHtml(sourceMemoryPath)}#sources">Use as provenance filter</a>
            </div>
          </div>
          ${
            source.status === "active"
              ? `<form method="post" action="/source-detach">
                  <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
                  <input type="hidden" name="source_id" value="${escapeHtml(sourceId)}" />
                  <button type="submit">Detach source</button>
                </form>`
              : ""
          }
          <details>
            <summary>Technical details</summary>
            ${renderMeta([
              ["source_id", source.source_id ?? source.id],
              ["source_kind", source.source_kind],
              ["status", source.status],
              ["location", source.uri],
              ["source_health", source.source_health],
              ["source_access_contract", source.source_access_contract],
              ["is_primary", source.is_primary],
              ["metadata", source.metadata]
            ])}
          </details>
        </article>`;
      })
      .join("")}
  </div>`;
}

function renderMemorySpaces(data: ReviewDashboardData, activeView: WorkbenchView = "all") {
  const renderSpaceCard = (row: Record<string, unknown>) => {
    const active = row.project_id === data.current_project_id;
    const state = captureState(row);
    const profile = memoryProfile(row);
    const human = isHumanMemorySpace(row);
    const sources = Array.isArray(row.sources)
      ? (row.sources as Array<Record<string, unknown>>)
      : [];
    const connectorCount = sources.filter(
      (source) => source.source_kind === "connector" && source.status === "active"
    ).length;
    return `<article class="memory-space ${active ? "active" : ""} ${human ? "human-domain" : "code-domain"}">
      <div class="memory-space-head">
        <h3><a href="${escapeHtml(projectSelectionPath(row.project_id, activeView))}">${escapeHtml(projectDisplayName(row))}</a></h3>
        <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
      </div>
      <p><strong>${escapeHtml(profile.label)}</strong></p>
      <p>${escapeHtml(profile.purpose)}</p>
      <p>${escapeHtml(sourceLabel(row))}</p>
      <p>${escapeHtml(profile.defaultSources)}</p>
      <p>${escapeHtml(attachedSourceSummary(row))}</p>
      <p>${escapeHtml(sharingPolicy(row))}</p>
      ${
        human
          ? `<p><strong>No passive capture.</strong> Manual or agent-mediated writes only.</p>
             <p><strong>Connectors:</strong> ${connectorCount > 0 ? "planned source record present; setup still governed" : "not connected"}</p>`
          : ""
      }
      <div class="metrics">
        <span>${escapeHtml(row.session_count ?? 0)} sessions</span>
        <span>${escapeHtml(row.memory_count ?? 0)} memories</span>
        <span>${escapeHtml(row.event_count ?? 0)} events</span>
      </div>
      <details>
        <summary>Technical details</summary>
        ${renderMeta([
          ["project_id", row.project_id],
          ["project_kind", row.project_kind],
          ["memory_domain", row.memory_domain],
          ["memory_profile", row.memory_profile],
          ["primary_path", row.primary_path],
          ["sources", row.sources]
        ])}
      </details>
    </article>`;
  };
  const humanSpaces = data.projects.filter(isHumanMemorySpace);
  const codeSpaces = data.projects.filter((row) => !isHumanMemorySpace(row));
  const spaceList =
    data.projects.length === 0
      ? `<p class="empty">No memory spaces yet.</p>`
      : `<div class="memory-space-groups">
        ${
          humanSpaces.length
            ? `<section class="memory-space-group human-memory-slice">
                <span class="section-kicker">Human memory domains</span>
                <h3>Virtual personal / work memory</h3>
                <p>These spaces are manual-first and isolated from coding-agent context unless you explicitly ask Recallant to recall them.</p>
                <div class="memory-spaces">${humanSpaces.map(renderSpaceCard).join("")}</div>
              </section>`
            : ""
        }
        <section class="memory-space-group">
          <span class="section-kicker">Agent workspaces</span>
          <h3>Code and project memory</h3>
          <p>These spaces record agent work only when capture is configured and activity proves it.</p>
          <div class="memory-spaces">${codeSpaces.length ? codeSpaces.map(renderSpaceCard).join("") : `<p class="empty">No code workspaces yet.</p>`}</div>
        </section>
      </div>`;
  return `<div class="memory-spaces">
    ${spaceList}
  </div>`;
}

function renderProjectChooser(data: ReviewDashboardData, activeView: WorkbenchView) {
  const rows = data.projects;
  if (rows.length === 0) {
    return `<section class="panel project-chooser empty-project-chooser" id="project-chooser">
      <div class="section-head">
        <div>
          <span class="section-kicker">Project chooser</span>
          <h2>Choose a memory space</h2>
        </div>
      </div>
      <p class="empty">No projects are attached yet. Run <code>recallant onboard /path/to/project</code> once from the project folder; Recallant will register storage, connect supported agent clients, and bring this Workbench to the project automatically.</p>
    </section>`;
  }
  const renderChoice = (row: Record<string, unknown>) => {
    const state = captureState(row);
    const profile = memoryProfile(row);
    const sources = Array.isArray(row.sources)
      ? (row.sources as Array<Record<string, unknown>>)
      : [];
    const activeSources = sources.filter((source) => source.status === "active").length;
    return `<a class="project-choice ${isHumanMemorySpace(row) ? "human-domain" : "code-domain"}" href="${escapeHtml(projectSelectionPath(row.project_id, activeView))}">
      <article>
        <div class="memory-space-head">
          <h3>${escapeHtml(projectDisplayName(row))}</h3>
          <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
        </div>
        <p><strong>${escapeHtml(profile.label)}</strong></p>
        <dl class="project-choice-meta">
          <dt>Short id</dt>
          <dd>${escapeHtml(shortId(row.project_id))}</dd>
          <dt>Primary path</dt>
          <dd>${escapeHtml(projectPathLabel(row))}</dd>
          <dt>Sources</dt>
          <dd>${escapeHtml(activeSources)} active / ${escapeHtml(sources.length)} total</dd>
        </dl>
        <div class="metrics">
          <span>${escapeHtml(row.session_count ?? 0)} sessions</span>
          <span>${escapeHtml(row.memory_count ?? 0)} memories</span>
          <span>${escapeHtml(row.event_count ?? 0)} events</span>
        </div>
      </article>
    </a>`;
  };
  return `<section class="panel project-chooser" id="project-chooser">
    <div class="section-head">
      <div>
        <span class="section-kicker">Project chooser</span>
        <h2>Choose a memory space</h2>
      </div>
      <p>Selecting a space opens the requested Workbench view for that project.</p>
    </div>
    <div class="project-choice-grid">
      ${rows.map(renderChoice).join("")}
    </div>
  </section>`;
}

function currentProjectHeaderLabel(data: ReviewDashboardData) {
  if (publicProjectBadge()) return publicProjectBadge();
  const project = currentProject(data);
  const name = projectDisplayName(project) || data.current_project_id;
  return `Current: ${String(name)} · ${shortId(data.current_project_id)}`;
}

function renderCurrentProjectContext(data: ReviewDashboardData) {
  const project = currentProject(data);
  const state = captureState(project);
  const sources = currentProjectSources(data);
  const activeSources = sources.filter((source) => source.status === "active").length;
  return `<div class="current-project-context" aria-label="Selected project context">
    <div>
      <span class="section-kicker">Selected project</span>
      <strong>${escapeHtml(projectDisplayName(project) || data.current_project_id)}</strong>
      <p>${escapeHtml(projectPathLabel(project))}</p>
    </div>
    <div class="current-project-facts">
      <span>${escapeHtml(publicScreenshotMode() ? "demo workspace" : `id ${shortId(data.current_project_id)}`)}</span>
      <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
      <span>${escapeHtml(activeSources)} active sources</span>
    </div>
  </div>`;
}

function renderCurrentMemoryProfile(data: ReviewDashboardData) {
  const project = currentProject(data);
  const state = captureState(project);
  const sources = currentProjectSources(data);
  const activeSources = sources.filter((source) => source.status === "active");
  const filterState = sourceFilterState(data);
  const title = projectDisplayName(project) || data.current_project_id;
  const profile = memoryProfile(project);
  return `<aside class="memory-profile" aria-label="Current memory space profile">
    <span class="section-kicker">Current memory space</span>
    <h3>${escapeHtml(title)}</h3>
    <p><strong>${escapeHtml(profile.label)}</strong></p>
    <p>${escapeHtml(profile.purpose)}</p>
    <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
    <p>${escapeHtml(sourceLabel(project))}</p>
    ${
      filterState.isFiltered
        ? `<p><strong>Source filter:</strong> ${escapeHtml(filterState.selectedLabel)}</p>`
        : ""
    }
    <p>${escapeHtml(sharingPolicy(project))}</p>
    <p>${escapeHtml(profile.allowedRecall)}</p>
    <p>${escapeHtml(profile.capturePolicy)}</p>
    <p>${escapeHtml(profile.connectorPolicy)}</p>
    <div class="memory-profile-metrics">
      <span><strong>${escapeHtml(activeSources.length)}</strong> active sources</span>
      <span><strong>${escapeHtml(project.memory_count ?? 0)}</strong> memories</span>
      <span><strong>${escapeHtml(project.event_count ?? 0)}</strong> events</span>
    </div>
  </aside>`;
}

function attentionSnapshot(data: ReviewDashboardData) {
  const pendingReview = criticalCount(data, "pending_review");
  const conflicts = rowCount(data.duplicate_conflicts);
  const interrupted = criticalCount(data, "interrupted_sessions");
  const activeSessions = criticalCount(data, "active_sessions");
  const paidApprovals = criticalCount(data, "pending_paid_approvals");
  const unsyncedSpool = criticalCount(data, "unsynced_spool_records");
  const highRiskConflicts = criticalCount(data, "high_risk_conflicts");
  const urgent =
    pendingReview +
    conflicts +
    interrupted +
    activeSessions +
    paidApprovals +
    unsyncedSpool +
    highRiskConflicts;
  if (urgent === 0) {
    return {
      count: 0,
      label: "Clear",
      note: "No urgent owner decision is waiting.",
      className: "ready"
    };
  }
  const main =
    highRiskConflicts > 0
      ? "High-risk conflict"
      : pendingReview > 0
        ? "Review decision"
        : conflicts > 0
          ? "Possible conflict"
          : activeSessions > 0
            ? "Open session"
            : interrupted > 0
              ? "Interrupted session"
              : unsyncedSpool > 0
                ? "Unsynced capture"
                : "Paid approval";
  return {
    count: urgent,
    label: `${urgent} item${urgent === 1 ? "" : "s"}`,
    note: main,
    className: "needs-work"
  };
}

function renderFirstScreenSnapshot(data: ReviewDashboardData) {
  const project = currentProject(data);
  const capture = captureState(project);
  const readiness = asRecord(data.project_readiness);
  const contract = asRecord(readiness.readiness_contract);
  const sources = currentProjectSources(data);
  const sourceCounts = sourceHealthCounts(sources);
  const attention = attentionSnapshot(data);
  const captureReady =
    typeof contract.capture_active === "boolean"
      ? contract.capture_active
      : capture.className === "active";
  const semanticMemoryReady =
    readiness.semantic_memory_ready === true || contract.semantic_memory_ready === true;
  const readinessStatus = String(
    readiness.readiness_status ?? contract.primary_state ?? "configured"
  );
  const readinessWarning = String(
    readiness.readiness_warning ??
      (readiness.configured_but_not_capture_active
        ? "Configured but not capture active."
        : "Capture proof is not complete yet.")
  );
  const sourceLabel =
    sourceCounts.active === 0
      ? "No sources"
      : `${sourceCounts.ready} of ${sourceCounts.active} ready`;
  const sourceNote =
    sourceCounts.needsAttention > 0
      ? `${sourceCounts.needsAttention} source${sourceCounts.needsAttention === 1 ? "" : "s"} need attention.`
      : sourceCounts.needsSetup > 0
        ? `${sourceCounts.needsSetup} source${sourceCounts.needsSetup === 1 ? "" : "s"} need setup.`
        : sourceCounts.active > 0
          ? "Sources are ready to cite."
          : "Attach a source when this memory space needs evidence.";
  return `<div class="first-screen-snapshot" aria-label="Workbench status snapshot">
    <article class="${escapeHtml(attention.className)}">
      <span>Needs attention</span>
      <strong>${escapeHtml(attention.label)}</strong>
      <p>${escapeHtml(attention.note)}</p>
    </article>
    <article class="${captureReady ? "ready" : "needs-work"}">
      <span>Memory capture</span>
      <strong>${escapeHtml(readinessStatus.replaceAll("_", " "))}</strong>
      <p>${escapeHtml(captureReady ? "Capture-active evidence is present." : readinessWarning)}</p>
    </article>
    <article class="${semanticMemoryReady ? "ready" : "needs-work"}">
      <span>Semantic proof</span>
      <strong>${escapeHtml(semanticMemoryReady ? "Semantic memory ready" : "Not proven yet")}</strong>
      <p>${escapeHtml(
        semanticMemoryReady
          ? "Last create+recall proof is recorded."
          : "Create and recall a governed marker before calling memory proven."
      )}</p>
    </article>
    <article class="${sourceCounts.needsAttention > 0 || sourceCounts.needsSetup > 0 ? "needs-work" : "ready"}">
      <span>Sources</span>
      <strong>${escapeHtml(sourceLabel)}</strong>
      <p>${escapeHtml(sourceNote)}</p>
    </article>
  </div>`;
}

function documentationPostureItems(value: unknown) {
  return asArray(value)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function documentationStrategyKey(value: unknown): DocumentationStrategyOptionKey | null {
  const key = String(value ?? "").trim();
  return documentationStrategyOptions.some((option) => option.key === key)
    ? (key as DocumentationStrategyOptionKey)
    : null;
}

function documentationStrategyReviewOptions(value: unknown) {
  const rawOptions: Array<{
    key: DocumentationStrategyOptionKey;
    recommended: boolean;
    reason: string;
  }> = asArray(value).flatMap((item) => {
    const record = asRecord(item);
    const key = documentationStrategyKey(record.option);
    if (!key) return [];
    return [
      {
        key,
        recommended: record.recommended === true,
        reason: String(record.reason ?? "").trim()
      }
    ];
  });
  const recommendedKey =
    documentationStrategyOptions.find((option) =>
      rawOptions.some((item) => item.key === option.key && item.recommended)
    )?.key ?? "discuss_first";
  return documentationStrategyOptions.map((option) => {
    const raw = rawOptions.find((item) => item.key === option.key);
    return {
      ...option,
      recommended: option.key === recommendedKey,
      reason: raw?.reason || option.reason
    };
  });
}

function starterDocsItems(value: unknown) {
  return asArray(value)
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return String(record.path ?? "").trim();
    })
    .filter(Boolean)
    .slice(0, 8);
}

function renderStarterDocsSummary(value: unknown) {
  const record = asRecord(value);
  const status = String(record.status ?? "not_recorded");
  const generatedFiles = starterDocsItems(record.generated_files);
  const plannedFiles = starterDocsItems(record.planned_files);
  const skippedFiles = starterDocsItems(record.skipped_files);
  const hasGenerated = generatedFiles.length > 0 && ["generated", "partial"].includes(status);
  const listItems = hasGenerated ? generatedFiles : plannedFiles;
  const heading = hasGenerated
    ? "Generated starter docs"
    : plannedFiles.length
      ? "Starter docs plan"
      : "Starter docs";
  const detail = hasGenerated
    ? "Recallant generated these starter documentation files during onboarding."
    : plannedFiles.length
      ? "Recallant planned these starter documentation files for an empty project."
      : "No starter-doc action is recorded for this project.";
  const skippedNote = skippedFiles.length
    ? `<p class="strategy-note">Skipped: ${escapeHtml(skippedFiles.join(", "))}</p>`
    : "";
  return `<div class="starter-docs-summary" data-starter-docs-status="${escapeHtml(status)}">
    <h4>${escapeHtml(heading)}</h4>
    <p class="strategy-note">${escapeHtml(detail)}</p>
    ${
      listItems.length
        ? `<ul class="posture-options starter-docs-files">${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : `<p class="empty">No starter documentation files are listed.</p>`
    }
    ${skippedNote}
  </div>`;
}

function canonCapabilityList(
  title: string,
  items: unknown,
  renderItem: (item: Record<string, unknown>) => string,
  emptyText: string
) {
  const rows = asArray(items)
    .map((item) => asRecord(item))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, 6);
  return `<div class="canon-capability-group">
    <h4>${escapeHtml(title)}</h4>
    ${
      rows.length
        ? `<ul>${rows.map((item) => `<li>${renderItem(item)}</li>`).join("")}</ul>`
        : `<p class="empty">${escapeHtml(emptyText)}</p>`
    }
  </div>`;
}

function publicSafeDefaultReferenceLabel(value: unknown, fallback: string) {
  const label = String(value ?? "").trim();
  if (!label) return fallback;
  if (!publicScreenshotMode()) return label;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(label)) {
    return fallback;
  }
  if (/^(\/|~\/|[a-z]:\\)/i.test(label) || label.includes("\\") || label.includes("/")) {
    return fallback;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(label)) {
    return fallback;
  }
  if (/^agents\.md$/i.test(label)) {
    return fallback;
  }
  return label;
}

function capabilityKindLabel(kind: unknown) {
  const labels: Record<string, string> = {
    connector: "Connector capability reference",
    deployment: "Deployment capability reference",
    model: "Model capability reference",
    other: "Capability reference",
    server: "Server capability reference",
    storage: "Storage/source capability reference"
  };
  return labels[String(kind ?? "")] ?? "Capability reference";
}

function renderSecretReferenceOverview(items: unknown) {
  const rows = asArray(items)
    .map((item) => asRecord(item))
    .filter((item) => Object.keys(item).length > 0);
  const statusCounts = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? "names_only");
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const statusSummary = Array.from(statusCounts.entries())
    .map(([status, count]) => `${count} ${status.replaceAll("_", " ")}`)
    .join(", ");
  return `<div class="canon-capability-group">
    <h4>Secret references</h4>
    ${
      rows.length
        ? `<ul><li>${escapeHtml(
            `${rows.length} reference name${rows.length === 1 ? "" : "s"} recorded`
          )}<span>${escapeHtml(statusSummary || "names only")}</span><p class="strategy-note">Names stay hidden on this default screen; use explicit settings or review surfaces for safe reference names.</p></li></ul>`
        : `<p class="empty">No secret reference names are recorded yet.</p>`
    }
  </div>`;
}

function renderCanonCapabilityContext(value: unknown) {
  const context = asRecord(value);
  const status = String(context.status ?? "not_recorded");
  return `<div class="canon-capability-summary" data-canon-capability-status="${escapeHtml(status)}">
    <div>
      <h4>Canon and capability context</h4>
      <p class="strategy-note">References are guidance and provenance for agents. They do not activate connectors, grant secret access, or create binding rules.</p>
    </div>
    <div class="canon-capability-grid">
      ${canonCapabilityList(
        "Environment facts",
        context.environment_facts,
        (item) =>
          `${escapeHtml(String(item.label ?? item.key ?? "Environment fact"))}<span>${escapeHtml(
            String(item.status ?? "review")
          )}</span>`,
        "No environment facts are recorded yet."
      )}
      ${canonCapabilityList(
        "Capabilities",
        context.capability_references,
        (item) =>
          `${escapeHtml(
            publicSafeDefaultReferenceLabel(item.label ?? item.id, capabilityKindLabel(item.kind))
          )}<span>${escapeHtml(`${String(item.status ?? "review")} / ${String(item.access ?? "reference_only")}`)}</span>`,
        "No capability references are recorded yet."
      )}
      ${renderSecretReferenceOverview(context.secret_references)}
      ${canonCapabilityList(
        "Server canon",
        context.server_canon_links,
        (item) =>
          `${escapeHtml(String(item.kind ?? item.label ?? "canon"))}<span>${escapeHtml(
            String(item.status ?? "needed")
          )}</span>`,
        "No server canon references are recorded yet."
      )}
      ${canonCapabilityList(
        "Documentation authority",
        context.documentation_authority_map,
        (item) =>
          `${escapeHtml(
            publicSafeDefaultReferenceLabel(item.path, "Project documentation reference")
          )}<span>${escapeHtml(String(item.role ?? "review_required"))}</span>`,
        "No documentation authority map is recorded yet."
      )}
    </div>
  </div>`;
}

function renderDocumentationPosture(data: ReviewDashboardData) {
  const posture = asRecord(data.documentation_posture);
  const starterDocs = asRecord(data.starter_docs);
  const status = String(posture.status ?? "not_recorded");
  const profile = String(posture.profile ?? "unknown");
  const summary =
    String(posture.summary ?? "").trim() || "No documentation posture has been recorded yet.";
  const missingDocs = documentationPostureItems(posture.missing_recommended_docs).slice(0, 4);
  const signals = asArray(posture.signals)
    .map((item) => asRecord(item))
    .filter((item) => String(item.code ?? "").trim().length > 0)
    .slice(0, 4);
  const reviewOptions = documentationStrategyReviewOptions(posture.review_options);
  const canonContext = asRecord(posture.canon_context);
  const canonKinds = documentationPostureItems(canonContext.recommended_reference_kinds);
  const configuredReferences = documentationPostureItems(canonContext.configured_references);
  const topSignals = signals.length
    ? signals.map((signal) => `${signal.code}: ${signal.message ?? "review"}`)
    : [];
  const reviewItems = [...missingDocs.map((item) => `Missing: ${item}`), ...topSignals].slice(0, 5);
  const optionList = reviewOptions
    .map((option) => {
      const recommended = option.recommended ? "Recommended strategy" : "Available strategy";
      return `<li class="strategy-option ${option.recommended ? "recommended" : "available"}" data-strategy-option="${escapeHtml(option.key)}"><div><strong>${escapeHtml(option.label)}</strong><span>${escapeHtml(recommended)}</span></div><p>${escapeHtml(option.summary)}</p><p class="strategy-reason">${escapeHtml(option.reason)}</p></li>`;
    })
    .join("");
  return `<section class="documentation-posture-panel" id="documentation-posture" aria-label="Documentation posture">
    <div class="documentation-posture-head">
      <div>
        <span class="section-kicker">Documentation posture</span>
        <h3>${escapeHtml(status.replaceAll("_", " "))}</h3>
      </div>
      <span class="posture-profile">${escapeHtml(profile.replaceAll("_", " "))}</span>
    </div>
    <p>${escapeHtml(summary)}</p>
    <div class="posture-grid">
      <div>
        <h4>Top missing / risk signals</h4>
        ${
          reviewItems.length
            ? `<ul>${reviewItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : `<p class="empty">No documentation review signal is recorded.</p>`
        }
      </div>
      <div>
        <h4>Documentation strategy</h4>
        <p class="strategy-note">Review these choices in Workbench. Existing documentation rewrites still require owner review.</p>
        <ul class="posture-options strategy-options">${optionList}</ul>
      </div>
      ${renderStarterDocsSummary(starterDocs)}
      ${renderCanonCapabilityContext(data.canon_capability_context)}
    </div>
    ${
      canonKinds.length || configuredReferences.length
        ? `<p class="posture-canon">${escapeHtml(
            [
              canonKinds.length ? `Canon needed: ${canonKinds.join(", ")}` : "",
              configuredReferences.length
                ? `Configured refs: ${configuredReferences.join(", ")}`
                : ""
            ]
              .filter(Boolean)
              .join(" · ")
          )}</p>`
        : ""
    }
  </section>`;
}

function renderSourceWorkbench(data: ReviewDashboardData, source?: SourceRenderState) {
  const sources = currentProjectSources(data);
  const counts = sourceHealthCounts(sources);
  const filterState = sourceFilterState(data);
  return `<section class="panel source-workbench" id="sources">
    <div class="section-head">
      <div>
        <span class="section-kicker">Memory Tree / Source Map · Memory space sources</span>
        <h2>Source Map</h2>
      </div>
      <p>These are the folders, repositories, documents, connectors, and virtual inputs Recallant may cite for this memory space. Detaching a source does not delete the memory.</p>
    </div>
    ${renderSourceResult(source)}
    <div class="source-map-legend" aria-label="Source map legend">
      <span><strong>Root</strong> current memory space</span>
      <span><strong>Branches</strong> attached sources</span>
      <span><strong>Provenance</strong> where facts came from</span>
      <span><strong>Safety</strong> detach is not delete</span>
    </div>
    <div class="source-overview">
      <span><strong>${escapeHtml(counts.active)}</strong> active sources</span>
      <span><strong>${escapeHtml(counts.ready)}</strong> ready to cite</span>
      <span><strong>${escapeHtml(counts.needsSetup)}</strong> need setup</span>
      <span><strong>${escapeHtml(counts.needsAttention)}</strong> need attention</span>
      <span><strong>${escapeHtml(filterState.selectedLabel)}</strong> selected source</span>
    </div>
    ${renderSourceTree(data)}
    ${renderSourceFilterControl(data, "sources")}
    <div class="source-workspace-grid">
      <div>
        <h3>Sources for selected space</h3>
        ${renderSelectedSources(data)}
      </div>
      <div class="source-management">
        ${renderMemorySpaceForms(data)}
      </div>
    </div>
  </section>`;
}

function selectedSettingValue(rows: Array<Record<string, unknown>>, key: string) {
  const row =
    rows.find((setting) => setting.key === key && setting.source === "project_settings") ??
    rows.find((setting) => setting.key === key);
  return row ? parseSettingValue(row.value) : undefined;
}

function optionTags(options: string[], selected: unknown) {
  return options
    .map((option) => {
      const active = String(selected ?? "") === option;
      return `<option value="${escapeHtml(option)}"${active ? " selected" : ""}>${escapeHtml(option.replaceAll("_", " "))}</option>`;
    })
    .join("");
}

function linesValue(value: unknown) {
  if (Array.isArray(value)) return value.join("\n");
  if (value === undefined || value === null) return "";
  return String(value);
}

function renderSettingResult(projectId: unknown, state?: SettingRenderState) {
  if (!state?.result) return "";
  const result = state.result;
  const key = state.key ?? result.key;
  const status = String(result.status ?? "");
  if (status === "confirmation_required") {
    return `<article class="setting-result">
      <strong>Confirmation required before changing setting.</strong>
      <p>This setting can affect cost, model behavior, capture volume, or routing. Review it, then confirm if it is intentional.</p>
      <form method="post" action="/project-setting">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <input type="hidden" name="value" value="${escapeHtml(state.rawValue)}" />
        <input type="hidden" name="reason" value="${escapeHtml(state.reason ?? "Review UI confirmed setting change")}" />
        <input type="hidden" name="confirm" value="true" />
        <button class="danger" type="submit">Confirm setting change</button>
      </form>
    </article>`;
  }
  return `<article class="setting-result">
    <strong>Setting updated.</strong>
    <p>${escapeHtml(settingLabel(key))} is now stored for this project. The audit log records the previous and new values.</p>
  </article>`;
}

function renderSettingForm(input: {
  projectId: unknown;
  key: string;
  valueHtml: string;
  reason: string;
  danger?: boolean;
}) {
  return `<form class="setting-form" method="post" action="/project-setting">
    <input type="hidden" name="project_id" value="${escapeHtml(input.projectId)}" />
    <input type="hidden" name="key" value="${escapeHtml(input.key)}" />
    <label>${escapeHtml(settingLabel(input.key))}${input.valueHtml}</label>
    <input type="hidden" name="reason" value="${escapeHtml(input.reason)}" />
    <button${input.danger ? ' class="danger"' : ""} type="submit">Save</button>
  </form>`;
}

function currentProjectDeveloperId(data: ReviewDashboardData) {
  return optionalInput(currentProject(data).developer_id);
}

function renderRemoteCredentialScopeFields(data: ReviewDashboardData, clientId = "") {
  return `<input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
    <label>Developer scope<input name="developer_id" value="${escapeHtml(currentProjectDeveloperId(data) ?? "")}" required /></label>
    <label>Client scope<input name="client_id" value="${escapeHtml(clientId)}" placeholder="optional client id" /></label>`;
}

function renderProvisioningOutput(provisioning: RemoteMcpProvisioningOutput | null | undefined) {
  if (!provisioning) return "";
  return `<div class="setting-result">
    <strong>Remote onboarding package</strong>
    <dl>
      <dt>Project</dt><dd>${escapeHtml(provisioning.scope.project_id)}</dd>
      <dt>Developer</dt><dd>${escapeHtml(provisioning.scope.developer_id)}</dd>
      <dt>Credential client</dt><dd>${escapeHtml(provisioning.scope.credential_client_id ?? "any client")}</dd>
      <dt>Bridge client</dt><dd>${escapeHtml(provisioning.scope.bridge_client_id)}</dd>
      <dt>Secret policy</dt><dd>${escapeHtml(provisioning.one_time_secret.policy)}</dd>
      <dt>Project dir</dt><dd>${escapeHtml(provisioning.provisioning.project_dir)}</dd>
      <dt>Config file</dt><dd>${escapeHtml(provisioning.provisioning.config_file)}</dd>
      <dt>Requires Docker</dt><dd>${escapeHtml(String(provisioning.provisioning.local_runtime.requires_docker))}</dd>
      <dt>Requires Postgres</dt><dd>${escapeHtml(String(provisioning.provisioning.local_runtime.requires_postgres))}</dd>
    </dl>
    ${
      provisioning.one_time_secret.shown
        ? `<p class="why">The raw credential is shown only in this create/rotate response. Store it in the external agent secret store now.</p>`
        : `<p>Credential material is redacted for this action.</p>`
    }
    <p class="why">Copy/paste the full remote client bootstrap command. The bootstrap URL by itself only prints the script and does not connect the project.</p>
    <label>Remote client bootstrap command<textarea rows="6" readonly>${escapeHtml(provisioning.provisioning.command)}</textarea></label>
    <label>Remote doctor command<textarea rows="3" readonly>${escapeHtml(provisioning.provisioning.doctor_command)}</textarea></label>
    <label>Client config<textarea rows="8" readonly>${escapeHtml(provisioning.provisioning.rendered_config)}</textarea></label>
  </div>`;
}

function renderRemoteCredentialResult(state?: RemoteCredentialRenderState) {
  if (!state) return "";
  if (state.error) {
    return `<article class="setting-result">
      <strong>Remote credential action failed.</strong>
      <p>${escapeHtml(state.error)}</p>
    </article>`;
  }
  const result = state.result;
  if (!result) return "";
  const credential = result.credential;
  const list = result.credentials ?? [];
  return `<article class="setting-result">
    <strong>${escapeHtml(`Remote credential ${result.action} completed.`)}</strong>
    ${
      credential
        ? `<dl>
      <dt>ID</dt><dd>${escapeHtml(credential.id)}</dd>
      <dt>Status</dt><dd>${escapeHtml(credential.status)}</dd>
      <dt>Project</dt><dd>${escapeHtml(credential.project_id)}</dd>
      <dt>Developer</dt><dd>${escapeHtml(credential.developer_id)}</dd>
      <dt>Client</dt><dd>${escapeHtml(credential.client_id ?? "any client")}</dd>
      <dt>Prefix</dt><dd>${escapeHtml(credential.credential_prefix)}</dd>
      <dt>Rotated from</dt><dd>${escapeHtml(credential.rotated_from_credential_id ?? "none")}</dd>
      <dt>Revoked at</dt><dd>${escapeHtml(credential.revoked_at ?? "not revoked")}</dd>
    </dl>`
        : ""
    }
    ${
      result.one_time_secret
        ? `<label>One-time credential secret<textarea rows="3" readonly>${escapeHtml(result.one_time_secret)}</textarea></label>`
        : ""
    }
    ${
      list.length > 0
        ? `<div class="item-list">${list
            .map(
              (row) => `<article class="item">
          <h3>${escapeHtml(row.label ?? row.id)}</h3>
          <p>${escapeHtml(row.status)} · ${escapeHtml(row.client_id ?? "any client")} · prefix ${escapeHtml(row.credential_prefix)}</p>
          <dl>
            <dt>ID</dt><dd>${escapeHtml(row.id)}</dd>
            <dt>Rotated from</dt><dd>${escapeHtml(row.rotated_from_credential_id ?? "none")}</dd>
            <dt>Revoked</dt><dd>${escapeHtml(row.revoked_at ?? "not revoked")}</dd>
          </dl>
        </article>`
            )
            .join("")}</div>`
        : result.action === "list"
          ? `<p class="empty">No remote MCP credentials matched this scope.</p>`
          : ""
    }
    ${renderProvisioningOutput(result.provisioning)}
    ${
      result.provisioning_by_credential && result.provisioning_by_credential.length > 0
        ? result.provisioning_by_credential
            .map((output) => renderProvisioningOutput(output))
            .join("")
        : ""
    }
  </article>`;
}

function renderRemoteCredentials(data: ReviewDashboardData, state?: RemoteCredentialRenderState) {
  return `${renderRemoteCredentialResult(state)}
    <div class="settings-grid">
      <form class="setting-form" method="post" action="/remote-credential">
        <input type="hidden" name="action" value="create" />
        <input type="hidden" name="view" value="settings" />
        ${renderRemoteCredentialScopeFields(data)}
        <label>Label<input name="label" placeholder="external agent or workstation" /></label>
        <label>Expires at<input name="expires_at" placeholder="optional ISO timestamp" /></label>
        <label>HTTPS server URL<input name="server_url" value="https://recallant.example.com" required /></label>
        <label>Target<select name="target">${optionTags(["codex", "cursor", "claude_code", "generic"], "codex")}</select></label>
        <label>Bridge client id<input name="bridge_client_id" value="remote-agent" required /></label>
        <button type="submit">Create credential</button>
      </form>
      <form class="setting-form" method="post" action="/remote-credential">
        <input type="hidden" name="action" value="rotate" />
        <input type="hidden" name="view" value="settings" />
        ${renderRemoteCredentialScopeFields(data)}
        <label>Credential ID<input name="credential_id" required /></label>
        <label>Expires at<input name="expires_at" placeholder="optional ISO timestamp" /></label>
        <label>HTTPS server URL<input name="server_url" value="https://recallant.example.com" required /></label>
        <label>Target<select name="target">${optionTags(["codex", "cursor", "claude_code", "generic"], "codex")}</select></label>
        <label>Bridge client id<input name="bridge_client_id" value="remote-agent" required /></label>
        <button type="submit">Rotate credential</button>
      </form>
      <form class="setting-form" method="post" action="/remote-credential">
        <input type="hidden" name="action" value="revoke" />
        <input type="hidden" name="view" value="settings" />
        ${renderRemoteCredentialScopeFields(data)}
        <label>Credential ID<input name="credential_id" required /></label>
        <label>HTTPS server URL<input name="server_url" value="https://recallant.example.com" required /></label>
        <button class="danger" type="submit">Revoke credential</button>
      </form>
      <form class="setting-form" method="post" action="/remote-credential">
        <input type="hidden" name="action" value="list" />
        <input type="hidden" name="view" value="settings" />
        ${renderRemoteCredentialScopeFields(data)}
        <label>Include revoked<select name="include_revoked">${optionTags(["false", "true"], "false")}</select></label>
        <label>HTTPS server URL<input name="server_url" value="https://recallant.example.com" required /></label>
        <label>Target<select name="target">${optionTags(["codex", "cursor", "claude_code", "generic"], "codex")}</select></label>
        <label>Bridge client id<input name="bridge_client_id" value="remote-agent" required /></label>
        <button type="submit">List credentials</button>
      </form>
    </div>`;
}

function renderSettings(data: ReviewDashboardData, state?: SettingRenderState) {
  const rows = data.settings;
  const projectId = data.current_project_id;
  const project = currentProject(data);
  const captureProfile = selectedSettingValue(rows, "capture_profile") ?? "standard";
  const contextBudget = selectedSettingValue(rows, "context_budget_profile") ?? "compact";
  const reviewSensitivity = selectedSettingValue(rows, "review_sensitivity") ?? "normal";
  const paidApiMode = selectedSettingValue(rows, "paid_api_mode") ?? "confirm_each";
  const embeddingEnabled = selectedSettingValue(rows, "embedding_route_enabled");
  const enabledClients = selectedSettingValue(rows, "enabled_clients") ?? ["codex"];
  const projectPaths =
    selectedSettingValue(rows, "project_paths") ?? [project.primary_path].filter(Boolean);
  const projectAliases = selectedSettingValue(rows, "project_aliases") ?? [];
  const settingRows =
    rows.length === 0
      ? `<p class="empty">No project settings configured.</p>`
      : rows
          .map((row) => {
            const value = formatDisplayValue(row.value);
            return `<article class="setting">
        <div class="setting-head">
          <h3>${escapeHtml(settingLabel(row.key))}</h3>
          <span>${escapeHtml(settingSourceLabel(row.source))}</span>
        </div>
        <p class="setting-value">${escapeHtml(settingSummary(row))}</p>
        <details>
          <summary>Technical value</summary>
          <pre>${escapeHtml(value || "Not set")}</pre>
        </details>
      </article>`;
          })
          .join("");
  return `${renderSettingResult(projectId, state)}
    <details class="settings-editor">
      <summary>Edit project settings</summary>
      <div class="settings-grid">
        ${renderSettingForm({
          projectId,
          key: "capture_profile",
          reason: "Review UI capture profile change",
          danger: true,
          valueHtml: `<select name="value">${optionTags(["light", "standard", "detailed"], captureProfile)}</select>`
        })}
        ${renderSettingForm({
          projectId,
          key: "context_budget_profile",
          reason: "Review UI context budget profile change",
          danger: true,
          valueHtml: `<select name="value">${optionTags(["compact", "standard", "expanded"], contextBudget)}</select>`
        })}
        ${renderSettingForm({
          projectId,
          key: "review_sensitivity",
          reason: "Review UI review sensitivity change",
          valueHtml: `<select name="value">${optionTags(["low", "normal", "strict"], reviewSensitivity)}</select>`
        })}
        ${renderSettingForm({
          projectId,
          key: "embedding_route_enabled",
          reason: "Review UI embedding route enablement change",
          danger: true,
          valueHtml: `<select name="value">${optionTags(["true", "false"], embeddingEnabled === false ? "false" : "true")}</select>`
        })}
        ${renderSettingForm({
          projectId,
          key: "paid_api_mode",
          reason: "Review UI paid API mode change",
          danger: true,
          valueHtml: `<select name="value">${optionTags(["disabled", "confirm_each", "auto_with_caps"], paidApiMode)}</select>`
        })}
        ${renderSettingForm({
          projectId,
          key: "enabled_clients",
          reason: "Review UI enabled clients change",
          valueHtml: `<textarea name="value" rows="3">${escapeHtml(linesValue(enabledClients))}</textarea>`
        })}
        ${renderSettingForm({
          projectId,
          key: "project_paths",
          reason: "Review UI project paths change",
          valueHtml: `<textarea name="value" rows="3">${escapeHtml(linesValue(projectPaths))}</textarea>`
        })}
        ${renderSettingForm({
          projectId,
          key: "project_aliases",
          reason: "Review UI project aliases change",
          valueHtml: `<textarea name="value" rows="3">${escapeHtml(linesValue(projectAliases))}</textarea>`
        })}
      </div>
    </details>
    ${settingRows}`;
}

function renderCosts(data: ReviewDashboardData) {
  const rows = data.costs;
  const summary = asRecord(data.cost_summary);
  const pendingApprovals = Array.isArray(data.pending_paid_api_approvals)
    ? data.pending_paid_api_approvals
    : [];
  if (rows.length === 0 && pendingApprovals.length === 0) {
    return `<p class="empty">No model cost records in the last 30 days.</p>`;
  }
  const actualUsd = rows.reduce((sum, row) => sum + Number(row.actual_usd ?? 0), 0);
  const estimatedUsd = rows.reduce((sum, row) => sum + Number(row.estimated_usd ?? 0), 0);
  const callCount = rows.reduce((sum, row) => sum + Number(row.call_count ?? 0), 0);
  return `<div class="cost-summary">
    <h3>Today</h3>
    <div class="summary-grid">
      <span><strong>${escapeHtml(summary.current_day_calls ?? 0)}</strong> calls</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_day_actual_usd))}</strong> actual</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_day_estimated_usd))}</strong> estimated</span>
      <span><strong>${escapeHtml(pendingApprovals.length)}</strong> pending approvals</span>
    </div>
    <h3>This month</h3>
    <div class="summary-grid">
      <span><strong>${escapeHtml(summary.current_month_calls ?? callCount)}</strong> calls</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_month_actual_usd ?? actualUsd))}</strong> actual</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_month_estimated_usd ?? estimatedUsd))}</strong> estimated</span>
      <span><strong>${escapeHtml(formatUsd(summary.pending_approval_estimated_usd))}</strong> pending estimate</span>
    </div>
    <details>
      <summary>Technical cost breakdown</summary>
      ${renderRows(rows, "No model cost records in the last 30 days.")}
    </details>
    <details>
      <summary>Pending paid model approvals</summary>
      ${renderRows(pendingApprovals, "No paid API approvals are pending.")}
    </details>
  </div>`;
}

function publicSafeTechnicalFilterValue(label: string, value: unknown) {
  if (!publicScreenshotMode()) return value;
  if (label === "project_id") return value ? "selected project" : "";
  if (label === "source_id") return value && value !== "all" ? "selected source" : "all";
  return value;
}

function renderRuleFilters(data: ReviewDashboardData) {
  const filters = asRecord(data.rule_filters);
  const sourceFilters = asRecord(data.source_filters);
  const sources = asArray(sourceFilters.sources) as Array<Record<string, unknown>>;
  const projectId = data.current_project_id;
  const current = {
    scope: String(filters.scope ?? "all"),
    scope_kind: String(filters.scope_kind ?? "all"),
    rule_type: String(filters.memory_type ?? "all"),
    rule_domain: String(filters.memory_domain ?? "agent_work"),
    source_id: String(sourceFilters.selected_source_id ?? filters.source_id ?? "all")
  };
  const link = (label: string, params: Record<string, unknown>) =>
    `<a class="filter-chip" href="${escapeHtml(
      reviewPathWithParams(projectId, { ...current, ...params })
    )}">${escapeHtml(label)}</a>`;
  const sourceLinks = [
    link("All sources", { source_id: "all" }),
    ...sources.slice(0, 8).map((source) => {
      const sourceId = source.source_id ?? source.id;
      const label = sourceDisplayTitle(source);
      return link(String(label), { source_id: sourceId });
    })
  ].join(" ");
  const selectedSource = asRecord(sourceFilters.selected_source);
  const selectedSourceNote =
    current.source_id !== "all" && Object.keys(selectedSource).length > 0
      ? `<p class="filter-note">Showing source-linked memories from ${escapeHtml(
          sourceDisplayTitle(selectedSource) ?? current.source_id
        )}. Conflicts are still shown globally so high-risk issues are not hidden.</p>`
      : "";
  return `<div class="rule-filters" aria-label="Active rule filters">
    <h3>Rule view</h3>
    <div><strong>Applies to</strong> ${link("All", { scope: "all" })} ${link("This memory space", { scope: "project" })} ${link("All your projects", { scope: "developer" })}</div>
    <div><strong>Kind</strong> ${link("All", { rule_type: "all" })} ${link("Process", { rule_type: "procedure" })} ${link("Limit", { rule_type: "constraint" })} ${link("Decision", { rule_type: "decision" })}</div>
    <div><strong>From source</strong> ${sourceLinks}</div>
    ${selectedSourceNote}
    <details>
      <summary>Technical filter values</summary>
      ${renderMeta([
        ["project_id", publicSafeTechnicalFilterValue("project_id", projectId)],
        ["scope", current.scope],
        ["scope_kind", current.scope_kind],
        ["memory_type", current.rule_type],
        ["memory_domain", current.rule_domain],
        ["source_id", publicSafeTechnicalFilterValue("source_id", current.source_id)]
      ])}
    </details>
  </div>`;
}

function rowCount(rows: unknown) {
  return Array.isArray(rows) ? rows.length : 0;
}

function criticalCount(data: ReviewDashboardData, key: string) {
  return Number(asRecord(data.critical)[key] ?? 0);
}

function renderTextBlock(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function renderAttention(data: ReviewDashboardData) {
  const pendingReview = criticalCount(data, "pending_review");
  const pendingEmbeddings = criticalCount(data, "pending_embeddings");
  const conflicts = rowCount(data.duplicate_conflicts);
  const imports = rowCount(data.import_candidates);
  const interrupted = criticalCount(data, "interrupted_sessions");
  const activeSessions = criticalCount(data, "active_sessions");
  const paidApprovals = criticalCount(data, "pending_paid_approvals");
  const unsyncedSpool = criticalCount(data, "unsynced_spool_records");
  const highRiskConflicts = criticalCount(data, "high_risk_conflicts");
  const urgent =
    pendingReview +
    conflicts +
    interrupted +
    activeSessions +
    paidApprovals +
    unsyncedSpool +
    highRiskConflicts;
  if (urgent === 0) {
    if (pendingEmbeddings > 0) {
      return `<p>${escapeHtml(`${pendingEmbeddings} chunk embedding${pendingEmbeddings === 1 ? "" : "s"} are waiting for local model recovery. Recall remains available while semantic indexing catches up.`)}</p>`;
    }
    return `<p>No urgent owner decision is waiting. The useful check now is whether the next agent starts from Recallant context instead of reading old project logs by hand.</p>`;
  }
  const items = [
    pendingReview > 0
      ? `${pendingReview} memory item${pendingReview === 1 ? "" : "s"} need review.`
      : "",
    imports > 0
      ? `${imports} imported source${imports === 1 ? "" : "s"} are still evidence-only.`
      : "",
    conflicts > 0
      ? `${conflicts} possible conflict/duplicate item${conflicts === 1 ? "" : "s"} need attention.`
      : "",
    highRiskConflicts > 0
      ? `${highRiskConflicts} high-risk conflict${highRiskConflicts === 1 ? "" : "s"} need owner review.`
      : "",
    activeSessions > 0
      ? `${activeSessions} unclosed active session${activeSessions === 1 ? "" : "s"} should be closed when work is done.`
      : "",
    interrupted > 0
      ? `${interrupted} interrupted session${interrupted === 1 ? "" : "s"} should be checked.`
      : "",
    unsyncedSpool > 0
      ? `${unsyncedSpool} local spool record${unsyncedSpool === 1 ? "" : "s"} are not synced yet.`
      : "",
    pendingEmbeddings > 0
      ? `${pendingEmbeddings} chunk embedding${pendingEmbeddings === 1 ? "" : "s"} are waiting for local model recovery.`
      : "",
    paidApprovals > 0
      ? `${paidApprovals} paid API approval${paidApprovals === 1 ? "" : "s"} are pending.`
      : ""
  ].filter(Boolean);
  return `<ul class="attention-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderCurrentSignals(data: ReviewDashboardData) {
  return `<div class="signal-strip" aria-label="Current Recallant signals">
    <span><strong>${escapeHtml(data.critical?.active_sessions ?? 0)}</strong> Active</span>
    <span><strong>${escapeHtml(data.critical?.interrupted_sessions ?? 0)}</strong> Interrupted</span>
    <span><strong>${escapeHtml(data.critical?.pending_review ?? 0)}</strong> Review</span>
    <span><strong>${escapeHtml(data.critical?.high_risk_conflicts ?? 0)}</strong> Conflicts</span>
    <span><strong>${escapeHtml(data.critical?.pending_embeddings ?? 0)}</strong> Pending embed</span>
    <span><strong>${escapeHtml(data.critical?.pending_paid_approvals ?? 0)}</strong> Paid API</span>
  </div>`;
}

function renderReadiness(data: ReviewDashboardData) {
  const readiness = asRecord(data.project_readiness);
  const contract = asRecord(readiness.readiness_contract);
  const evidence = asRecord(contract.evidence);
  const reviewCounts = asRecord(readiness.review_state_counts);
  const registered = Boolean(readiness.project_registered);
  const checkpointUpdatedAt = readiness.checkpoint_updated_at ?? evidence.last_checkpoint_at;
  const lastContextReadAt = readiness.last_context_read_at ?? evidence.last_context_read_at;
  const lastMemoryWriteAt = readiness.last_memory_write_at ?? evidence.last_memory_write_at;
  const lastSemanticRecallProofAt =
    readiness.last_semantic_recall_proof_at ?? evidence.last_semantic_recall_proof_at;
  const activeSessions = Number(readiness.active_sessions ?? 0);
  const interruptedSessions = Number(readiness.interrupted_sessions ?? 0);
  const captureEvents = Number(readiness.capture_event_count ?? 0);
  const capturedDecisions = Number(readiness.captured_decision_count ?? 0);
  const reviewMemories = Number(reviewCounts.pending_review ?? readiness.review_memory_count ?? 0);
  const acceptedMemories = Number(reviewCounts.accepted ?? readiness.accepted_memory_count ?? 0);
  const rejectedMemories = Number(reviewCounts.rejected ?? readiness.rejected_memory_count ?? 0);
  const staleMemories = Number(reviewCounts.stale ?? readiness.stale_memory_count ?? 0);
  const conflictMemories = Number(reviewCounts.conflict ?? readiness.conflict_memory_count ?? 0);
  const captureActive =
    typeof contract.capture_active === "boolean"
      ? contract.capture_active
      : registered &&
        interruptedSessions === 0 &&
        lastContextReadAt !== null &&
        lastContextReadAt !== undefined &&
        lastMemoryWriteAt !== null &&
        lastMemoryWriteAt !== undefined &&
        checkpointUpdatedAt !== null &&
        checkpointUpdatedAt !== undefined;
  const readinessStatus = String(readiness.readiness_status ?? contract.primary_state ?? "");
  const warning = String(readiness.readiness_warning ?? "");
  const statusText = warning
    ? warning
    : !registered
      ? "Project is not registered."
      : captureActive
        ? "Agent capture active."
        : !lastContextReadAt
          ? "Registered only. Agent context has not been read yet."
          : !lastMemoryWriteAt
            ? "Capture started. No memory write has been recorded yet."
            : !checkpointUpdatedAt
              ? "Capture active. Checkpoint is still missing."
              : "Capture needs attention.";
  const note =
    activeSessions > 0
      ? `${activeSessions} active session${activeSessions === 1 ? "" : "s"} still open.`
      : "No active agent sessions are open.";
  const readinessDate = (value: unknown) => formatDate(value) || "Not yet";
  return `<div class="readiness ${captureActive ? "ready" : "needs-work"}">
    <strong>${escapeHtml(
      readinessStatus ? `Readiness: ${readinessStatus.replaceAll("_", " ")}` : statusText
    )}</strong>
    <p>${escapeHtml(statusText)}</p>
    <p>${escapeHtml(note)}</p>
    <div class="summary-grid">
      <span><strong>${escapeHtml(readinessDate(lastContextReadAt))}</strong> last context read</span>
      <span><strong>${escapeHtml(readinessDate(lastMemoryWriteAt))}</strong> last memory write</span>
      <span><strong>${escapeHtml(readinessDate(checkpointUpdatedAt))}</strong> last checkpoint</span>
      <span><strong>${escapeHtml(readinessDate(lastSemanticRecallProofAt))}</strong> last semantic proof</span>
      <span><strong>${escapeHtml(captureEvents)}</strong> capture events</span>
      <span><strong>${escapeHtml(capturedDecisions)}</strong> captured decisions</span>
      <span><strong>${escapeHtml(reviewMemories)}</strong> pending review</span>
      <span><strong>${escapeHtml(acceptedMemories)}</strong> accepted</span>
      <span><strong>${escapeHtml(rejectedMemories)}</strong> rejected</span>
      <span><strong>${escapeHtml(staleMemories)}</strong> stale</span>
      <span><strong>${escapeHtml(conflictMemories)}</strong> conflict</span>
    </div>
    <p class="readiness-note">Last session: ${escapeHtml(formatDate(readiness.last_session_at))}</p>
  </div>`;
}

function renderReviewSummaryTile(label: string, count: number, note: string) {
  const countLabel = count === 0 ? "Clear" : String(count);
  return `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(countLabel)}</strong>
    <p>${escapeHtml(note)}</p>
  </article>`;
}

function renderReviewLane(
  title: string,
  rows: Array<Record<string, unknown>>,
  emptyLabel: string,
  projectId: unknown,
  open = false,
  note = "",
  extra = ""
) {
  return `<details class="review-lane"${open ? " open" : ""}>
    <summary>
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(rows.length)}</strong>
    </summary>
    ${note ? `<p class="review-lane-note">${escapeHtml(note)}</p>` : ""}
    ${extra}
    ${renderRows(rows, emptyLabel, projectId)}
  </details>`;
}

function renderMigrationReviewQueue(data: ReviewDashboardData) {
  const migrationReview = asRecord(data.migration_review);
  const totalImported = Number(migrationReview.total_imported ?? 0);
  if (totalImported <= 0) return "";
  const lanes = asArray(migrationReview.lane_order).map(asRecord);
  const firstAction = String(
    migrationReview.first_action ?? "Review imported evidence before active rules."
  );
  const filterHint = String(
    migrationReview.review_filter_hint ?? "Review imported evidence before active rules."
  );
  return `<section class="migration-review" aria-label="Migration review queue">
    <div class="migration-review-head">
      <span>Migration review queue</span>
      <strong>${escapeHtml(totalImported)} imported source${totalImported === 1 ? "" : "s"}</strong>
      <p>${escapeHtml(firstAction)}</p>
      <p class="review-lane-note">${escapeHtml(filterHint)}</p>
    </div>
    <div class="migration-review-lanes">
      ${lanes
        .map(
          (lane) => `<article>
            <span>${escapeHtml(lane.label)}</span>
            <strong>${escapeHtml(lane.count ?? 0)}</strong>
            <p>${escapeHtml(lane.action)}</p>
          </article>`
        )
        .join("")}
    </div>
  </section>`;
}

function graphCandidateLabel(candidate: Record<string, unknown>) {
  const kind = String(candidate.candidate_kind ?? "candidate");
  const id = String(candidate.graph_candidate_id ?? "");
  return publicScreenshotMode()
    ? `${kind === "edge" ? "Edge" : "Node"} candidate`
    : `${kind === "edge" ? "Edge" : "Node"} ${shortId(id)}`;
}

function graphEndpointLabel(endpoint: unknown) {
  const row = asRecord(endpoint);
  const label = optionalInput(row.label);
  if (label) return label;
  const kind = optionalInput(row.kind) ?? "endpoint";
  if (publicScreenshotMode()) return kind;
  return `${kind} ${shortId(row.id)}`;
}

function graphSourceRefLabel(ref: Record<string, unknown>) {
  const kind = String(ref.source_kind ?? "source").replaceAll("_", " ");
  if (publicScreenshotMode()) return kind;
  const id = optionalInput(ref.source_id);
  return id ? `${kind} ${shortId(id)}` : kind;
}

function graphConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "not set";
  return `${Math.round(numeric * 100)}%`;
}

function renderGraphSourceRefs(sourceRefs: Array<Record<string, unknown>>) {
  if (sourceRefs.length === 0) return `<p class="empty">No source refs recorded.</p>`;
  return `<div class="graph-source-refs">
    ${sourceRefs
      .slice(0, 4)
      .map(
        (ref) => `<article>
          <strong>${escapeHtml(graphSourceRefLabel(ref))}</strong>
          <p>${escapeHtml(ref.quote ?? ref.path ?? ref.uri ?? "Source evidence available.")}</p>
        </article>`
      )
      .join("")}
  </div>`;
}

function renderGraphReviewHistory(actions: Array<Record<string, unknown>>) {
  if (actions.length === 0) return `<p class="empty">No graph review actions yet.</p>`;
  return `<div class="graph-review-history">
    ${actions
      .slice(0, 6)
      .map(
        (action) => `<article>
          <strong>${escapeHtml(humanStatus(action.action))}</strong>
          <span>${escapeHtml(action.actor_kind ?? "user")} · ${escapeHtml(formatDate(action.created_at) || "now")}</span>
          ${action.note ? `<p>${escapeHtml(action.note)}</p>` : ""}
        </article>`
      )
      .join("")}
  </div>`;
}

function renderGraphActionForm(
  candidate: Record<string, unknown>,
  projectId: unknown,
  action: string,
  label: string,
  extra = ""
) {
  return `<form method="post" action="/review-action">
    <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
    <input type="hidden" name="target_kind" value="graph_candidate" />
    <input type="hidden" name="graph_candidate_id" value="${escapeHtml(candidate.graph_candidate_id)}" />
    <input type="hidden" name="action" value="${escapeHtml(action)}" />
    <input type="hidden" name="view" value="review" />
    ${extra}
    <button type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function renderGraphCandidateActions(candidate: Record<string, unknown>, projectId: unknown) {
  return `<div class="graph-actions">
    ${renderGraphActionForm(candidate, projectId, "accept", "Accept")}
    ${renderGraphActionForm(candidate, projectId, "reject", "Reject")}
    ${renderGraphActionForm(candidate, projectId, "mark_stale", "Mark stale")}
    ${renderGraphActionForm(candidate, projectId, "archive", "Archive")}
    ${renderGraphActionForm(candidate, projectId, "unarchive", "Unarchive")}
  </div>
  <details class="graph-action-detail">
    <summary>Edit candidate</summary>
    <form method="post" action="/review-action">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="target_kind" value="graph_candidate" />
      <input type="hidden" name="graph_candidate_id" value="${escapeHtml(candidate.graph_candidate_id)}" />
      <input type="hidden" name="action" value="edit" />
      <input type="hidden" name="view" value="review" />
      <label>Title <input name="title" value="${escapeHtml(candidate.title ?? "")}" /></label>
      <label>Summary <input name="summary" value="${escapeHtml(candidate.summary ?? "")}" /></label>
      <label>Confidence <input name="confidence" inputmode="decimal" value="${escapeHtml(candidate.confidence ?? "")}" /></label>
      <label>Lifecycle <input name="lifecycle_state" value="${escapeHtml(candidate.lifecycle_state ?? "")}" /></label>
      <label>Note <input name="note" value="" /></label>
      <button type="submit">Save edit</button>
    </form>
  </details>
  <details class="graph-action-detail">
    <summary>Merge or supersede</summary>
    <div class="graph-target-actions">
      ${renderGraphActionForm(
        candidate,
        projectId,
        "merge",
        "Merge",
        `<label>Target <input name="target_graph_candidate_id" value="" /></label><label>Note <input name="note" value="" /></label>`
      )}
      ${renderGraphActionForm(
        candidate,
        projectId,
        "supersede",
        "Supersede",
        `<label>Target <input name="target_graph_candidate_id" value="" /></label><label>Note <input name="note" value="" /></label>`
      )}
    </div>
  </details>`;
}

function renderGraphCandidateCard(
  candidate: Record<string, unknown>,
  projectId: unknown,
  selectedId: unknown
) {
  const selected = String(candidate.graph_candidate_id ?? "") === String(selectedId ?? "");
  const kind = String(candidate.candidate_kind ?? "node");
  const title =
    optionalInput(candidate.title) ??
    (kind === "edge"
      ? `${graphEndpointLabel(candidate.src)} ${candidate.relation_type ?? "relates to"} ${graphEndpointLabel(candidate.dst)}`
      : "Untitled graph candidate");
  const href = reviewPathWithParams(projectId, {
    view: "review",
    graph_candidate_id: candidate.graph_candidate_id
  });
  return `<article class="graph-candidate-card${selected ? " selected" : ""}">
    <div class="graph-candidate-main">
      <div>
        <span class="graph-candidate-id">${escapeHtml(graphCandidateLabel(candidate))}</span>
        <h3><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h3>
        <p>${escapeHtml(candidate.summary ?? "No summary recorded.")}</p>
      </div>
      ${renderBadges([
        ["State", humanStatus(candidate.lifecycle_state)],
        ["Kind", kind],
        ["Confidence", graphConfidence(candidate.confidence)],
        ["Method", String(candidate.extraction_method ?? "").replaceAll("_", " ")],
        ["Sources", candidate.source_ref_count ?? asArray(candidate.source_refs).length],
        ["Actions", candidate.review_action_count ?? asArray(candidate.review_actions).length]
      ])}
    </div>
    <div class="graph-candidate-shape">
      ${
        kind === "edge"
          ? `<span>${escapeHtml(graphEndpointLabel(candidate.src))}</span>
             <strong>${escapeHtml(candidate.relation_type ?? "related")}</strong>
             <span>${escapeHtml(graphEndpointLabel(candidate.dst))}</span>`
          : `<span>${escapeHtml(candidate.node_kind ?? "node")}</span>
             <strong>${escapeHtml(title)}</strong>`
      }
    </div>
  </article>`;
}

function renderGraphCandidateDetail(selected: Record<string, unknown>, projectId: unknown) {
  if (!selected.graph_candidate_id) return "";
  const sourceRefs = asArray(selected.source_refs).map(asRecord);
  const reviewActions = asArray(selected.review_actions).map(asRecord);
  return `<section class="graph-candidate-detail" aria-label="Selected graph candidate">
    <div class="graph-detail-head">
      <span>${escapeHtml(graphCandidateLabel(selected))}</span>
      <strong>${escapeHtml(selected.title ?? "Selected graph candidate")}</strong>
      <p>Accepted candidates remain staged review records and are not retrieval-active by themselves.</p>
    </div>
    ${renderMeta([
      ["Lifecycle", humanStatus(selected.lifecycle_state)],
      ["Candidate kind", selected.candidate_kind],
      ["Node kind", selected.node_kind],
      ["Relation", selected.relation_type],
      ["Confidence", graphConfidence(selected.confidence)],
      ["Extraction", String(selected.extraction_method ?? "").replaceAll("_", " ")],
      ["Created by", selected.created_by],
      ["Updated", formatDate(selected.updated_at)]
    ])}
    <h4>Source evidence</h4>
    ${renderGraphSourceRefs(sourceRefs)}
    <h4>Review history</h4>
    ${renderGraphReviewHistory(reviewActions)}
    <h4>Actions</h4>
    ${renderGraphCandidateActions(selected, projectId)}
  </section>`;
}

function renderGraphCandidateLane(
  title: string,
  rows: Array<Record<string, unknown>>,
  projectId: unknown,
  selectedId: unknown
) {
  return `<details class="review-lane graph-candidate-lane" open>
    <summary>
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(rows.length)}</strong>
    </summary>
    ${rows.length === 0 ? `<p class="empty">No graph candidates match the current filters.</p>` : ""}
    <div class="graph-candidate-list">
      ${rows.map((row) => renderGraphCandidateCard(row, projectId, selectedId)).join("")}
    </div>
  </details>`;
}

function renderGraphCandidateReview(data: ReviewDashboardData) {
  const graph = asRecord(data.graph_candidates);
  const candidates = asArray(graph.candidates).map(asRecord);
  const selected = asRecord(graph.selected_candidate);
  const selectedId = selected.graph_candidate_id;
  const counts = asRecord(graph.counts);
  const candidateKindCounts = asRecord(counts.candidate_kind);
  const lifecycleCounts = asRecord(counts.lifecycle_state);
  const nodeCandidates = candidates.filter((candidate) => candidate.candidate_kind === "node");
  const edgeCandidates = candidates.filter((candidate) => candidate.candidate_kind === "edge");
  return `<section class="graph-review" aria-label="Graph candidates">
    <div class="graph-review-head">
      <div>
        <span>Graph candidates</span>
        <h3>Graph candidates</h3>
        <p>Accepted candidates remain staged review records and are not retrieval-active by themselves.</p>
      </div>
      <div class="graph-review-counts">
        <span><strong>${escapeHtml(counts.total ?? candidates.length)}</strong> total</span>
        <span><strong>${escapeHtml(candidateKindCounts.node ?? 0)}</strong> node</span>
        <span><strong>${escapeHtml(candidateKindCounts.edge ?? 0)}</strong> edge</span>
        <span><strong>${escapeHtml(lifecycleCounts.accepted ?? 0)}</strong> accepted</span>
      </div>
    </div>
    <div class="graph-review-grid">
      <div class="graph-review-lanes">
        ${renderGraphCandidateLane("Node candidates", nodeCandidates, data.current_project_id, selectedId)}
        ${renderGraphCandidateLane("Edge candidates", edgeCandidates, data.current_project_id, selectedId)}
      </div>
      ${renderGraphCandidateDetail(selected, data.current_project_id)}
    </div>
  </section>`;
}

function renderReviewDecisionGuide(
  importCount: number,
  inboxCount: number,
  conflictCount: number,
  ruleCount: number
) {
  const openCount = importCount + inboxCount + conflictCount;
  const headline =
    conflictCount > 0
      ? "Start with possible conflicts."
      : inboxCount > 0
        ? "Start with memories that need your decision."
        : importCount > 0
          ? "Start with imported evidence."
          : "No owner decision is waiting.";
  const note =
    openCount > 0
      ? "Review items from top to bottom: conflicts first, then memories that need your decision, then imported evidence. Keep ordinary facts as Usable memory; promote only source-backed guidance into an Active rule."
      : ruleCount > 0
        ? "Active rules are already available. Use this area when new evidence needs review or when agents surface a conflict."
        : "Recallant has no review work for this memory space right now.";
  return `<section class="review-guide" aria-label="Review decision guide">
    <div>
      <span>Review decision guide</span>
      <strong>${escapeHtml(headline)}</strong>
      <p>${escapeHtml(note)}</p>
    </div>
    <ol>
      <li>Resolve conflict states before routine review.</li>
      <li>Keep useful facts as Usable memory.</li>
      <li>Make only durable guidance an Active rule.</li>
    </ol>
  </section>`;
}

function renderReviewWorkspace(data: ReviewDashboardData) {
  const importCount = rowCount(data.import_candidates);
  const inboxCount = rowCount(data.inbox);
  const conflictCount = rowCount(data.duplicate_conflicts);
  const ruleCount = rowCount(data.rules);
  const hasOpenDecision = importCount + inboxCount + conflictCount > 0;
  return `<div class="review-workspace">
    ${renderSourceFilterControl(data, "review")}
    ${renderReviewDecisionGuide(importCount, inboxCount, conflictCount, ruleCount)}
    ${renderGraphCandidateReview(data)}
    ${renderMigrationReviewQueue(data)}
    <div class="review-overview">
      ${renderReviewSummaryTile(
        "Imported evidence",
        importCount,
        importCount > 0
          ? "Imported evidence is waiting for review before agents rely on it."
          : "No imported evidence needs review."
      )}
      ${renderReviewSummaryTile(
        "Needs your decision",
        inboxCount,
        inboxCount > 0
          ? "Choose Usable memory, reject, archive, or review before making a rule."
          : "No memory item needs a decision."
      )}
      ${renderReviewSummaryTile(
        "Possible conflicts",
        conflictCount,
        conflictCount > 0
          ? "Conflict states should be resolved before normal review."
          : "No conflict states are visible."
      )}
      ${renderReviewSummaryTile(
        "Active rules",
        ruleCount,
        ruleCount > 0
          ? "Reusable guidance is available to agents."
          : "No active rules match the current filters."
      )}
    </div>
    <div class="review-lanes">
      ${renderReviewLane(
        "Imported evidence",
        data.import_candidates,
        "No imported evidence needs review.",
        data.current_project_id,
        importCount > 0,
        "Imported material stays as evidence until you decide what is useful."
      )}
      ${renderReviewLane(
        "Needs your decision",
        data.inbox,
        "No memory item needs your decision.",
        data.current_project_id,
        inboxCount > 0,
        "Decide whether each item becomes Usable memory, gets rejected, is archived, or needs more work."
      )}
      ${renderReviewLane(
        "Possible conflicts",
        data.duplicate_conflicts,
        "No conflict states or duplicates detected.",
        data.current_project_id,
        conflictCount > 0,
        "Compare overlapping memories and keep the one agents should trust."
      )}
      ${renderReviewLane(
        "Active rules",
        data.rules,
        "No active rules match the current filters.",
        data.current_project_id,
        !hasOpenDecision && ruleCount > 0,
        "These are durable rules agents can apply across work after review.",
        renderRuleFilters(data)
      )}
    </div>
  </div>`;
}

function activityIcon(kind: unknown) {
  const value = String(kind ?? "");
  const labels: Record<string, string> = {
    session: "Session",
    context_read: "Context",
    memory_write: "Memory",
    checkpoint: "Checkpoint"
  };
  return labels[value] ?? "Activity";
}

function activityGroup(kind: unknown) {
  const value = String(kind ?? "");
  if (value === "memory_write") return "Memory updates";
  if (value === "checkpoint") return "Checkpoints";
  if (value === "session" || value === "context_read") return "Recording flow";
  return "Other activity";
}

function activityGroupNote(group: string) {
  const notes: Record<string, string> = {
    "Recording flow": "Session starts and context reads prove the agent is entering Recallant.",
    "Memory updates": "These records show what Recallant captured as usable working memory.",
    Checkpoints: "Checkpoints show the latest durable handoff state.",
    "Other activity": "Additional Recallant events that do not fit the main recording flow."
  };
  return notes[group] ?? "Recent Recallant activity.";
}

function activitySummary(rows: Array<Record<string, unknown>>) {
  const count = (kind: string) => rows.filter((row) => row.activity_kind === kind).length;
  const sourceLinked = rows.filter((row) => row.source_summary).length;
  return {
    sessions: count("session"),
    contextReads: count("context_read"),
    memoryWrites: count("memory_write"),
    checkpoints: count("checkpoint"),
    sourceLinked
  };
}

function renderActivityReplay(data: ReviewDashboardData) {
  const rows = Array.isArray(data.recent_activity)
    ? (data.recent_activity as Array<Record<string, unknown>>)
    : [];
  const sourceFilter = renderSourceFilterControl(data, "activity");
  if (rows.length === 0) {
    return `${sourceFilter}<p class="empty">No recent Recallant activity has been captured for this memory space yet.</p>`;
  }
  const summary = activitySummary(rows);
  const grouped = ["Recording flow", "Memory updates", "Checkpoints", "Other activity"]
    .map((group) => ({
      group,
      rows: rows.filter((row) => activityGroup(row.activity_kind) === group)
    }))
    .filter((group) => group.rows.length > 0);
  return `${sourceFilter}
  <div class="activity-summary" aria-label="Activity replay summary">
    <span><strong>${escapeHtml(summary.sessions)}</strong> sessions</span>
    <span><strong>${escapeHtml(summary.contextReads)}</strong> context reads</span>
    <span><strong>${escapeHtml(summary.memoryWrites)}</strong> memory writes</span>
    <span><strong>${escapeHtml(summary.checkpoints)}</strong> checkpoints</span>
    <span><strong>${escapeHtml(summary.sourceLinked)}</strong> source-linked</span>
  </div>
  <div class="activity-list">
    ${grouped
      .map(
        (group) => `<section class="activity-group">
          <div class="activity-group-head">
            <h3>${escapeHtml(group.group)}</h3>
            <p>${escapeHtml(activityGroupNote(group.group))}</p>
          </div>
          ${group.rows
            .map(
              (row) => `<article class="activity-item">
                <span>${escapeHtml(activityIcon(row.activity_kind))}</span>
                <div>
                  <strong>${escapeHtml(row.title)}</strong>
                  <p>${escapeHtml(row.body)}</p>
                  ${
                    row.source_summary
                      ? `<p class="source-note">Source: ${escapeHtml(
                          publicSafeProvenanceSummary(String(row.source_summary))
                        )}</p>`
                      : ""
                  }
                  <time>${escapeHtml(formatDate(row.occurred_at))}</time>
                </div>
              </article>`
            )
            .join("")}
        </section>`
      )
      .join("")}
  </div>`;
}

function auditMetric(report: Record<string, unknown>, key: string) {
  return String(asRecord(report.summary)[key] ?? 0);
}

function renderAuditFilters(data: ReviewDashboardData, report: Record<string, unknown>) {
  const filters = asRecord(report.filters);
  return `<form class="audit-filter-form" method="get" action="/review">
    <input type="hidden" name="view" value="audit" />
    <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
    <label>Since <input name="since" value="${escapeHtml(filters.since ?? "")}" /></label>
    <label>Until <input name="until" value="${escapeHtml(filters.until ?? "")}" /></label>
    <label>Surface <input name="surface" placeholder="all" value="${escapeHtml(filters.surface ?? "")}" /></label>
    <label>Status <input name="status" placeholder="all" value="${escapeHtml(filters.status ?? "")}" /></label>
    <button type="submit">Apply</button>
  </form>`;
}

function renderAuditRows(rows: unknown, emptyLabel: string) {
  const normalized = asArray(rows).map((row) => asRecord(row));
  if (normalized.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<div class="audit-row-list">
    ${normalized
      .slice(0, 12)
      .map((row) => {
        const link = row.project_id
          ? reviewPathWithParams(row.project_id, { view: "activity" })
          : null;
        const content = `<article class="audit-row">
          <div>
            <strong>${escapeHtml(`${String(row.surface ?? "system")}/${String(row.operation ?? "operation")}`)}</strong>
            <p>${escapeHtml(`${String(row.status ?? "unknown")}${row.error_code ? ` · ${String(row.error_code)}` : ""}`)}</p>
            <time>${escapeHtml(formatDate(row.started_at))}</time>
          </div>
          <dl>
            <dt>trace</dt><dd>${escapeHtml(shortId(row.trace_id))}</dd>
            <dt>activity</dt><dd>${escapeHtml(shortId(row.activity_id))}</dd>
          </dl>
        </article>`;
        return link ? `<a class="row-link" href="${escapeHtml(link)}">${content}</a>` : content;
      })
      .join("")}
  </div>`;
}

function renderAuditWorkbench(data: ReviewDashboardData) {
  if (data.audit_error) {
    return `<div class="audit-workbench">
      <p class="empty">Audit report is unavailable right now: ${escapeHtml(data.audit_error)}</p>
    </div>`;
  }
  const report = asRecord(data.audit_report);
  if (Object.keys(report).length === 0) {
    return `<div class="audit-workbench">
      <p class="empty">Audit report has not been loaded for this view yet.</p>
    </div>`;
  }
  const summary = asRecord(report.summary);
  const model = asRecord(report.model_provider);
  const capture = asRecord(report.capture);
  const recommendations = asArray(report.recommendations).map((row) => asRecord(row));
  const total = Number(summary.total ?? 0);
  return `<div class="audit-workbench">
    <div class="section-head">
      <div>
        <span class="section-kicker">System activity ledger</span>
        <h3>Audit report</h3>
      </div>
      <p>Summarized from redacted system activity rows. Request bodies, auth headers, cookies, and secret-like values are not shown here.</p>
    </div>
    ${renderAuditFilters(data, report)}
    <div class="audit-summary" aria-label="Audit summary">
      <span><strong>${escapeHtml(total)}</strong> activity rows</span>
      <span><strong>${escapeHtml(auditMetric(report, "failures"))}</strong> failures/skips</span>
      <span><strong>${escapeHtml(auditMetric(report, "slow_operations"))}</strong> slow operations</span>
      <span><strong>${escapeHtml(auditMetric(report, "pending_started"))}</strong> open started</span>
      <span><strong>${escapeHtml(model.failed_calls ?? 0)}</strong> model failures</span>
      <span><strong>${escapeHtml(capture.pending_embeddings ?? 0)}</strong> pending embeddings</span>
    </div>
    ${
      total === 0
        ? `<p class="empty">No audit activity matched these filters.</p>`
        : `<div class="audit-columns">
            <section>
              <h3>Recent failures</h3>
              ${renderAuditRows(report.failures, "No failed or skipped operations in this window.")}
            </section>
            <section>
              <h3>Slow operations</h3>
              ${renderAuditRows(report.slow_operations, "No slow operations crossed the configured threshold.")}
            </section>
          </div>
          <section>
            <h3>Timeline</h3>
            ${renderAuditRows(report.timeline, "No audit timeline rows are available.")}
          </section>`
    }
    <section class="audit-recommendations">
      <h3>Recommendations</h3>
      ${
        recommendations.length === 0
          ? `<p class="empty">No recommendations for this window.</p>`
          : `<ul>${recommendations
              .map(
                (row) =>
                  `<li><strong>${escapeHtml(row.severity ?? "info")}</strong> ${escapeHtml(
                    row.message ?? "Review audit report."
                  )}</li>`
              )
              .join("")}</ul>`
      }
    </section>
  </div>`;
}

function renderProjectActions(data: ReviewDashboardData) {
  const cleanup = asRecord(data.project_cleanup);
  return `<div class="action-plan">
    <p>Project memory stays isolated by default. Agents can ask for cross-project examples, but unrelated memories are not mixed into this project automatically.</p>
    <details>
      <summary>Advanced cleanup details</summary>
      ${renderMeta([
        ["detach dry-run", cleanup.detach_command],
        ["sanitize detach dry-run", cleanup.sanitize_detach_command],
        ["purge dry-run", cleanup.purge_command],
        ["sandbox cleanup dry-run", cleanup.sandbox_cleanup_command],
        ["local cleanup dry-run", cleanup.local_cleanup_command],
        [
          "permanent erasure",
          cleanup.permanent_erasure_separate ? "Token-confirmed project purge" : ""
        ]
      ])}
    </details>
  </div>`;
}

function renderProjectDetachResult(data: ReviewDashboardData, detach?: DetachRenderState) {
  if (!detach?.result) return "";
  const result = detach.result;
  const project = asRecord(result.project);
  const affected = asRecord(result.affected);
  const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
  const mode = String(result.mode ?? "sandbox");
  const projectId = String(project.project_id ?? data.current_project_id ?? "");
  const dryRun = result.dry_run !== false;
  const status =
    result.status === "detached"
      ? "Removed from active Recallant views."
      : "Dry-run complete. Nothing changed yet.";
  return `<article class="detach-result">
    <strong>${escapeHtml(status)}</strong>
    <p>${escapeHtml(
      dryRun
        ? "Review the affected records, then confirm if this is the project you want to remove from Recallant."
        : "Project files were not touched. Permanent erasure is still separate."
    )}</p>
    <div class="summary-grid">
      <span><strong>${escapeHtml(affected.sessions ?? 0)}</strong> sessions</span>
      <span><strong>${escapeHtml(affected.events ?? 0)}</strong> events</span>
      <span><strong>${escapeHtml(affected.active_chunks ?? 0)}</strong> active chunks</span>
      <span><strong>${escapeHtml(affected.active_agent_memories ?? 0)}</strong> active memories</span>
    </div>
    ${
      warnings.length > 0
        ? `<ul class="attention-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : ""
    }
    ${
      dryRun && projectId
        ? `<form class="confirm-form" method="post" action="/project-detach">
            <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
            <input type="hidden" name="mode" value="${escapeHtml(mode)}" />
            <input type="hidden" name="confirm" value="true" />
            <button type="submit">Confirm remove from Recallant</button>
          </form>`
        : ""
    }
  </article>`;
}

function renderTargetResolution(result: Record<string, unknown>) {
  const resolution = asRecord(result.target_resolution);
  if (
    !resolution.resolved_by &&
    !resolution.requested_project_id &&
    !resolution.resolved_project_id
  )
    return "";
  return `<details class="target-resolution">
    <summary>Target resolution</summary>
    ${renderMeta([
      ["resolved by", resolution.resolved_by],
      ["requested project_id", resolution.requested_project_id],
      ["resolved project_id", resolution.resolved_project_id],
      ["stale project_id", resolution.stale_project_id],
      ["project path supplied", resolution.requested_project_path ? "yes" : ""]
    ])}
  </details>`;
}

function renderProjectSanitizeResult(data: ReviewDashboardData, sanitize?: SanitizeRenderState) {
  if (!sanitize?.result) return "";
  const result = sanitize.result;
  const project = asRecord(result.project);
  const affected = asRecord(result.affected);
  const changes = asRecord(result.changes);
  const confirmation = asRecord(result.confirmation);
  const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
  const projectId = String(project.project_id ?? data.current_project_id ?? "");
  const projectPath = typeof project.primary_path === "string" ? project.primary_path : "";
  const dryRun = result.dry_run !== false;
  const status =
    result.status === "purged"
      ? "Project purged from Recallant."
      : "Purge dry-run complete. Nothing changed yet.";
  return `<article class="detach-result">
    <strong>${escapeHtml(status)}</strong>
    <p>${escapeHtml(
      dryRun
        ? "Review the affected records and confirmation token before deleting this project's Recallant memory."
        : "Recallant database records were purged or de-identified. Project files were not deleted."
    )}</p>
    <div class="summary-grid">
      <span><strong>${escapeHtml(affected.events ?? 0)}</strong> events</span>
      <span><strong>${escapeHtml(affected.chunks ?? 0)}</strong> chunks</span>
      <span><strong>${escapeHtml(affected.agent_memories ?? 0)}</strong> memories</span>
      <span><strong>${escapeHtml(changes.physically_deleted_records ?? 0)}</strong> deleted records</span>
    </div>
    ${renderTargetResolution(result)}
    ${confirmation.token ? `<p><code>${escapeHtml(String(confirmation.token))}</code></p>` : ""}
    ${
      warnings.length > 0
        ? `<ul class="attention-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : ""
    }
    ${
      dryRun && projectId && confirmation.token
        ? `<form class="confirm-form" method="post" action="/project-sanitize">
            <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
            ${projectPath ? `<input type="hidden" name="project_path" value="${escapeHtml(projectPath)}" />` : ""}
            <input type="hidden" name="mode" value="purge" />
            <input type="hidden" name="confirm_token" value="${escapeHtml(String(confirmation.token))}" />
            <button class="danger" type="submit">Confirm purge from Recallant</button>
          </form>`
        : ""
    }
  </article>`;
}

function renderCleanup(
  data: ReviewDashboardData,
  detach?: DetachRenderState,
  sanitize?: SanitizeRenderState
) {
  const project = currentProject(data);
  const projectName =
    project.title ?? project.name ?? project.provider ?? project.key ?? data.current_project_id;
  const projectPath = project.primary_path ?? "No path recorded";
  return `<div class="cleanup-flow">
    <article class="selected-project-card">
      <strong>${escapeHtml(publicScreenshotMode() ? "Demo memory space" : projectName)}</strong>
      <span>${escapeHtml(publicScreenshotMode() ? "Project files stay private" : projectPath)}</span>
      <details>
        <summary>Technical details</summary>
        ${renderMeta([["project_id", data.current_project_id]])}
      </details>
    </article>
    <p>Detach hides the selected project from active Recallant views and search. Purge is the irreversible clean-slate path for Recallant database records. Project files on disk are not deleted.</p>
    ${renderProjectDetachResult(data, detach)}
    ${renderProjectSanitizeResult(data, sanitize)}
    <form method="post" action="/project-detach">
      <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
      <input type="hidden" name="mode" value="sandbox" />
      <button type="submit">Dry-run remove selected project</button>
    </form>
    <form method="post" action="/project-sanitize">
      <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
      <input type="hidden" name="mode" value="purge" />
      <button class="danger" type="submit">Dry-run purge from Recallant</button>
    </form>
  </div>`;
}

function renderManagementChat(
  data: ReviewDashboardData,
  chat?: ChatRenderState,
  view: WorkbenchView = "ask"
) {
  const selectedMemory = asRecord(asRecord(data.selected_detail).memory);
  const selectedMemoryId = selectedMemory.id;
  const selectedSourceId = String(asRecord(data.source_filters).selected_source_id ?? "all");
  return `<form class="chat-form" method="post" action="/management-chat#ask-recallant">
    <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
    <input type="hidden" name="view" value="${escapeHtml(view === "all" ? "ask" : view)}" />
    ${
      chat?.response?.clarification_context
        ? `<input type="hidden" name="clarification_context" value="${escapeHtml(JSON.stringify(chat.response.clarification_context))}" />`
        : ""
    }
    ${
      selectedSourceId !== "all"
        ? `<input type="hidden" name="source_id" value="${escapeHtml(selectedSourceId)}" />`
        : ""
    }
    ${
      selectedMemoryId
        ? `<input type="hidden" name="memory_id" value="${escapeHtml(selectedMemoryId)}" />`
        : ""
    }
    <textarea name="message" rows="4" placeholder="Ask Recallant what to check, change, connect, remember, or clean up.">${escapeHtml(chat?.question ?? "")}</textarea>
    <div class="chat-submit-row">
      <button type="submit">Ask Recallant</button>
      <span>Private, policy protected</span>
    </div>
  </form>
  ${
    chat?.response
      ? `<article class="chat-answer">
          <h3>${chat.response.language === "ru" ? "Ответ Recallant" : "Recallant Answer"}</h3>
          <p class="chat-understanding">${escapeHtml(
            chat.response.language === "ru"
              ? chat.response.understanding.source === "local_ai"
                ? "Понято локальной AI-моделью."
                : "Понято безопасными локальными правилами; AI-модель недоступна."
              : chat.response.understanding.source === "local_ai"
                ? "Understood by local AI."
                : "Understood by safe local rules; AI model unavailable."
          )} <span class="chat-result">${escapeHtml(resultTypeLabel(chat.response.result_type, chat.response.language))}</span></p>
          ${renderTextBlock(chat.response.answer)}
          ${
            chat.response.confirmation_required
              ? `<p class="warning">${escapeHtml(chat.response.language === "ru" ? "Перед рискованным действием требуется подтверждение." : "Confirmation required before any risky action can run.")}</p>`
              : ""
          }
          ${renderChatActions(chat.response.proposed_actions, chat.response.language)}
        </article>`
      : `<p class="empty">No answer yet.</p>`
  }`;
}

function renderChatActions(
  actions: ManagementChatResponse["proposed_actions"],
  language: ManagementChatResponse["language"]
) {
  if (actions.length === 0) return "";
  const title = language === "ru" ? "Предложенный следующий шаг" : "Proposed next step";
  return `<div class="chat-actions">
    <h4>${escapeHtml(title)}</h4>
    ${actions
      .map(
        (action) => `<article class="chat-action chat-action--${escapeHtml(action.kind)}">
          <strong>${escapeHtml(action.label)}</strong>
          <span>${escapeHtml(actionKindLabel(action.kind, language))}</span>
          <p>${escapeHtml(action.reason)}</p>
          ${action.command ? `<code>${escapeHtml(action.command)}</code>` : ""}
          ${renderChatActionForm(action, language)}
        </article>`
      )
      .join("")}
  </div>`;
}

function renderChatActionForm(
  action: ManagementChatResponse["proposed_actions"][number],
  language: ManagementChatResponse["language"]
) {
  if (action.kind !== "dry_run" || !action.command) return "";
  const projectMatch = action.command.match(/--project-id\s+([0-9a-f-]{36})(?:\s|$)/i);
  if (!projectMatch) return "";
  if (!/(?:^|\s)--dry-run(?:\s|$)/.test(action.command)) return "";
  const sanitizeCommand = /\brecallant\s+project-sanitize\b/.test(action.command);
  const detachCommand = /\brecallant\s+detach\b/.test(action.command);
  if (!sanitizeCommand && !detachCommand) return "";
  const mode = /(?:^|\s)--mode\s+sandbox(?:\s|$)/.test(action.command) ? "sandbox" : "live";
  const sanitizeMode = /(?:^|\s)--mode\s+purge(?:\s|$)/.test(action.command) ? "purge" : "detach";
  const sanitizeDetachMode = /(?:^|\s)--detach-mode\s+sandbox(?:\s|$)/.test(action.command)
    ? "sandbox"
    : "live";
  const label = language === "ru" ? "Запустить dry-run в интерфейсе" : "Run dry-run in UI";
  if (sanitizeCommand) {
    return `<form class="chat-action-form" method="post" action="/project-sanitize#ask-recallant">
    <input type="hidden" name="project_id" value="${escapeHtml(projectMatch[1] ?? "")}" />
    <input type="hidden" name="mode" value="${escapeHtml(sanitizeMode)}" />
    <input type="hidden" name="detach_mode" value="${escapeHtml(sanitizeDetachMode)}" />
    <button type="submit">${escapeHtml(label)}</button>
  </form>`;
  }
  return `<form class="chat-action-form" method="post" action="/project-detach#ask-recallant">
    <input type="hidden" name="project_id" value="${escapeHtml(projectMatch[1] ?? "")}" />
    <input type="hidden" name="mode" value="${escapeHtml(mode)}" />
    <button type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function actionKindLabel(
  kind: ManagementChatResponse["proposed_actions"][number]["kind"],
  language: ManagementChatResponse["language"]
) {
  if (language !== "ru") return kind.replaceAll("_", " ");
  const labels: Record<typeof kind, string> = {
    read_only: "безопасная проверка",
    dry_run: "dry-run без изменений",
    confirmation_required: "требуется подтверждение"
  };
  return labels[kind];
}

function resultTypeLabel(
  resultType: ManagementChatResponse["result_type"],
  language: ManagementChatResponse["language"]
) {
  if (language === "ru") {
    const labels: Record<ManagementChatResponse["result_type"], string> = {
      read_only_answer: "Результат: безопасный ответ",
      safe_action: "Результат: безопасное действие выполнено",
      dry_run_required: "Результат: сначала dry-run",
      confirmation_required: "Результат: требуется подтверждение",
      blocked_by_policy: "Результат: заблокировано политикой",
      needs_clarification: "Результат: нужно уточнение"
    };
    return labels[resultType];
  }
  const labels: Record<ManagementChatResponse["result_type"], string> = {
    read_only_answer: "Result: read-only answer",
    safe_action: "Result: safe action completed",
    dry_run_required: "Result: dry-run required",
    confirmation_required: "Result: confirmation required",
    blocked_by_policy: "Result: blocked by policy",
    needs_clarification: "Result: clarification needed"
  };
  return labels[resultType];
}

type WorkbenchView =
  | "all"
  | "ask"
  | "memory"
  | "command"
  | "sources"
  | "activity"
  | "audit"
  | "review"
  | "settings";

function normalizeWorkbenchView(value: unknown): WorkbenchView {
  const view = String(value ?? "all").toLowerCase();
  const allowed: WorkbenchView[] = [
    "all",
    "ask",
    "memory",
    "command",
    "sources",
    "activity",
    "audit",
    "review",
    "settings"
  ];
  return allowed.includes(view as WorkbenchView) ? (view as WorkbenchView) : "all";
}

function showWorkbenchView(activeView: WorkbenchView, target: Exclude<WorkbenchView, "all">) {
  return activeView === "all" || activeView === target;
}

function workbenchViewHref(data: ReviewDashboardData, view: WorkbenchView) {
  return view === "all"
    ? reviewPath(data.current_project_id)
    : reviewPathWithParams(data.current_project_id, { view });
}

function renderWorkbenchNav(
  data: ReviewDashboardData,
  activeView: WorkbenchView,
  options?: { rootChooser?: boolean }
) {
  const items: Array<{ view: WorkbenchView; label: string }> = [
    { view: "ask", label: "Ask Recallant" },
    { view: "all", label: "Workbench" },
    { view: "memory", label: "Memory Spaces" },
    { view: "sources", label: "Sources" },
    { view: "activity", label: "Activity / Replay" },
    { view: "audit", label: "Audit" },
    { view: "review", label: "Review" },
    { view: "command", label: "Command Center" },
    { view: "settings", label: "Settings" }
  ];
  return `<nav class="workbench-nav" aria-label="Workbench sections">
    ${items
      .map(
        (item) =>
          `<a class="${item.view === activeView ? "active" : ""}" href="${escapeHtml(
            options?.rootChooser ? rootWorkbenchPath(item.view) : workbenchViewHref(data, item.view)
          )}">${escapeHtml(item.label)}</a>`
      )
      .join("")}
  </nav>`;
}

function renderDashboard(
  data: ReviewDashboardData,
  state?: {
    chat?: ChatRenderState;
    detach?: DetachRenderState;
    sanitize?: SanitizeRenderState;
    memoryForget?: MemoryForgetRenderState;
    setting?: SettingRenderState;
    source?: SourceRenderState;
    remoteCredential?: RemoteCredentialRenderState;
    view?: WorkbenchView;
    projectChooser?: boolean;
  }
) {
  const chat = state?.chat;
  const detach = state?.detach;
  const sanitize = state?.sanitize;
  const memoryForget = state?.memoryForget;
  const setting = state?.setting;
  const source = state?.source;
  const remoteCredential = state?.remoteCredential;
  const activeView = normalizeWorkbenchView(state?.view);
  const projectChooser = state?.projectChooser === true;
  const showAsk = !projectChooser && showWorkbenchView(activeView, "ask");
  const showMemory = !projectChooser && showWorkbenchView(activeView, "memory");
  const showCommand = !projectChooser && showWorkbenchView(activeView, "command");
  const showSources = !projectChooser && showWorkbenchView(activeView, "sources");
  const showActivity = !projectChooser && showWorkbenchView(activeView, "activity");
  const showAudit = !projectChooser && activeView === "audit";
  const showReview = !projectChooser && showWorkbenchView(activeView, "review");
  const showSettings = !projectChooser && showWorkbenchView(activeView, "settings");
  const showBody =
    showMemory ||
    showCommand ||
    showSources ||
    showActivity ||
    showAudit ||
    showReview ||
    showSettings;
  const focused = activeView !== "all";
  const focusedSettings = activeView === "settings";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Recallant Workbench</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      --bg: #f3f6f5;
      --surface: #ffffff;
      --surface-soft: #f8fbfa;
      --surface-muted: #f4f7fb;
      --line: #d7dedb;
      --line-strong: #c9d5d1;
      --text: #20242c;
      --muted: #4f5867;
      --quiet: #6f7785;
      --accent: #166454;
      --accent-strong: #145a4d;
      --accent-soft: #eef8f5;
      --warning: #7a4d18;
      --warning-soft: #fff8e8;
      --danger: #8a3c15;
      --danger-soft: #fff4ed;
      --shadow-soft: 0 8px 24px rgba(32, 36, 44, 0.05);
      --radius: 8px;
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 20px 32px; border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, 0.94); display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0; color: var(--text); }
    main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 22px; align-items: start; max-width: 1760px; margin: 0 auto; }
    section, aside { min-width: 0; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    h3 { letter-spacing: 0; }
    a { color: inherit; text-decoration: none; }
    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; margin-bottom: 14px; box-shadow: var(--shadow-soft); }
    .workbench-nav { display: flex; gap: 8px; flex-wrap: wrap; }
    .workbench-nav a { border: 1px solid #d2dae6; border-radius: 999px; padding: 6px 9px; font-size: 12px; background: var(--surface-soft); color: #303845; }
    .workbench-nav a:hover { border-color: var(--line-strong); background: #f0f6f3; }
    .workbench-nav a.active { border-color: var(--accent); background: var(--accent); color: #fff; }
    .command-grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(340px, 1.1fr); gap: 18px; align-items: start; }
    .workbench-body { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 22px; align-items: start; }
    .workbench-body.focused { grid-template-columns: minmax(0, 1fr); }
    .workbench-body.focused .workbench-main { max-width: 1180px; width: 100%; justify-self: center; }
    .workbench-main { display: grid; gap: 16px; }
    .workbench-main.production-first-screen { align-content: start; }
    .overview-memory-map { order: 1; }
    .overview-activity { order: 2; }
    .overview-audit { order: 3; }
    .overview-review { order: 4; }
    .overview-command { order: 5; }
    .overview-operations { order: 6; }
    .workbench-main.production-first-screen > .secondary-workspace { order: 5; }
    .primary-workspace { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
    .command-card h3 { margin: 0 0 8px; font-size: 14px; }
    .row-link, .project-link { display: block; border-radius: 6px; }
    .row-link:hover .item, .project-link:hover .project { background: var(--surface-soft); }
    .item { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .item:first-child { border-top: 0; }
    .item h3 { font-size: 14px; margin: 0 0 5px; }
    .item p { margin: 0 0 8px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .item .why { color: var(--warning); }
    .item .source-note { color: var(--accent); font-size: 12px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 8px; }
    .badges span { display: inline-flex; gap: 5px; align-items: baseline; border: 1px solid #d6dde7; background: #f8fafc; border-radius: 999px; padding: 4px 7px; font-size: 11px; color: #445064; }
    .badges strong { color: #6a7280; font-weight: 600; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 0; font-size: 12px; }
    dt { color: #6a7280; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill { border: 1px solid #c9d2df; border-radius: 999px; padding: 5px 8px; font-size: 12px; background: var(--surface-soft); color: inherit; }
    a.pill:hover { border-color: var(--line-strong); background: #fff; color: #20242c; }
    .left-rail { align-self: start; position: sticky; top: 12px; }
    .secondary-workspace { display: block; }
    .operations-workspace { background: transparent; border: 0; box-shadow: none; padding: 2px 0 0; }
    .operations-workspace .section-head { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 4px; }
    .operations-workspace .section-head h2 { color: #303845; font-size: 14px; }
    .operations-workspace .section-head p { color: #647082; }
    .operation-panels { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: start; }
    .operation-panel { border: 1px solid var(--line); border-radius: var(--radius); background: #fbfcfe; padding: 12px; margin: 0; box-shadow: 0 1px 2px rgba(32, 36, 44, 0.03); }
    .operation-panel summary { border: 0; padding: 0; margin: 0; }
    .operation-panel summary span { display: block; font-size: 13px; font-weight: 750; }
    .operation-panel summary small { display: block; margin-top: 3px; color: #6a7280; font-size: 11px; font-weight: 500; line-height: 1.3; }
    .operation-panel[open] { grid-column: span 2; }
    .operation-panel[open] summary { margin-bottom: 10px; }
    .workbench-body.focused .operation-panels { grid-template-columns: minmax(0, 1fr); }
    .workbench-body.focused .operation-panel[open] { grid-column: span 1; }
    .section-head { display: flex; justify-content: space-between; gap: 18px; align-items: start; margin-bottom: 12px; }
    .section-head h2 { margin-bottom: 0; }
    .section-head p { max-width: 520px; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .section-kicker { display: block; color: var(--accent); font-size: 11px; font-weight: 750; letter-spacing: 0; margin-bottom: 4px; text-transform: uppercase; }
    .attention-list { margin: 0; padding-left: 18px; color: #303845; font-size: 13px; line-height: 1.45; }
    .signal-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0 0 14px; }
    .signal-strip span { border: 1px solid #dce3ec; border-radius: 999px; padding: 7px 10px; background: #f8fafc; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .signal-strip strong { color: #20242c; margin-right: 4px; }
    .action-plan p { margin: 0 0 10px; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .cleanup-flow p, .detach-result p { margin: 0 0 10px; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .detach-result { border: 1px solid #d9dee7; border-radius: 7px; padding: 10px; margin-bottom: 10px; background: #fbfcfe; }
    .detach-result strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .confirm-form { margin-top: 10px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .summary-grid span { border: 1px solid #dce3ec; border-radius: 6px; padding: 7px; color: #4f5867; font-size: 12px; background: #f8fafc; }
    .summary-grid strong { display: block; color: #20242c; font-size: 13px; }
    .selected-project-card { border: 1px solid #dce3ec; border-radius: 7px; padding: 9px; margin-bottom: 10px; background: #f8fafc; }
    .selected-project-card strong, .selected-project-card span { display: block; overflow-wrap: anywhere; }
    .selected-project-card strong { font-size: 14px; margin-bottom: 4px; }
    .selected-project-card span { color: #4f5867; font-size: 12px; line-height: 1.35; }
    .project-chooser { max-width: 1180px; width: 100%; justify-self: center; }
    .project-choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .project-choice { display: block; color: inherit; }
    .project-choice article { border: 1px solid #dbe5e1; border-radius: var(--radius); padding: 12px; background: var(--surface-soft); min-height: 100%; }
    .project-choice:hover article { border-color: var(--line-strong); background: #fff; }
    .project-choice h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
    .project-choice p { margin: 7px 0 0; color: #4f5867; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .project-choice-meta { grid-template-columns: 96px minmax(0, 1fr); gap: 5px 8px; margin-top: 10px; }
    .project-choice-meta dt { font-size: 11px; }
    .project-choice-meta dd { font-size: 12px; }
    .current-project-context { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid #d5e1dd; border-radius: var(--radius); padding: 12px; margin: 0 0 14px; background: #fff; }
    .current-project-context strong { display: block; color: #20242c; font-size: 15px; line-height: 1.2; overflow-wrap: anywhere; }
    .current-project-context p { margin: 6px 0 0; color: #4f5867; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .current-project-facts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .current-project-facts span { border: 1px solid #d6dde7; border-radius: 999px; padding: 3px 7px; background: #f8fafc; color: #4f5867; font-size: 11px; }
    .readiness strong { display: block; font-size: 15px; margin-bottom: 6px; }
    .readiness p { margin: 0 0 10px; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .readiness.ready strong { color: #166454; }
    .readiness.needs-work strong { color: #7a4d18; }
    .readiness .readiness-note { margin-top: 10px; margin-bottom: 0; color: #6a7280; font-size: 12px; }
    .project { border-top: 1px solid #e5e9f0; padding: 11px 0; }
    .project:first-child { border-top: 0; }
    .project.active { background: #f4f7fb; border-radius: 6px; padding-left: 10px; padding-right: 10px; }
    .project.active h3::after { content: " active"; color: #246b5a; font-size: 11px; font-weight: 600; }
    .project h3, .setting h3 { font-size: 14px; margin: 0 0 4px; }
    .project p { margin: 0; color: #4f5867; font-size: 13px; overflow-wrap: anywhere; }
    .project-meta, .metrics { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .project-meta span, .metrics span { background: #f2f5f8; border: 1px solid #dce3ec; border-radius: 999px; padding: 3px 7px; color: #4f5867; font-size: 11px; }
    .state.active { color: #166454; border-color: #bad8cf; background: #eef8f5; }
    .state.started { color: #715118; border-color: #e3d3a5; background: #fff9e8; }
    .state.registered { color: #526070; border-color: #d6dde7; background: #f8fafc; }
    .state.interrupted { color: #8a3c15; border-color: #e1b59b; background: #fff4ed; }
    .memory-space-groups { display: grid; gap: 12px; }
    .memory-space-group { border: 1px solid #dfe8e4; border-radius: var(--radius); padding: 10px; background: #fbfdfc; }
    .memory-space-group h3 { margin: 0 0 5px; font-size: 14px; }
    .memory-space-group > p { margin: 0 0 9px; color: #4f5867; font-size: 12px; line-height: 1.4; }
    .human-memory-slice { border-color: #c7ded6; background: #f4fbf8; }
    .memory-spaces { display: grid; gap: 9px; }
    .memory-space-link { display: block; }
    .memory-space { border: 1px solid #dbe5e1; border-radius: var(--radius); padding: 10px; background: var(--surface-soft); }
    .memory-space.human-domain { border-color: #c7ded6; background: #ffffff; }
    .memory-space.active { background: #eff7f4; border-color: #bdd8cf; box-shadow: inset 3px 0 0 var(--accent); }
    .memory-space-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .memory-space h3 { margin: 0; font-size: 14px; }
    .memory-space h3 a { text-decoration: none; }
    .memory-space .state { border-radius: 999px; padding: 3px 7px; font-size: 11px; white-space: nowrap; }
    .memory-space p { margin: 7px 0 0; color: #4f5867; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .memory-space-editor { border-top: 1px solid #e5e9f0; padding-top: 9px; margin-top: 10px; }
    .source-form { display: grid; gap: 8px; margin-top: 9px; }
    .source-form label { display: grid; gap: 5px; color: #303845; font-size: 12px; font-weight: 650; }
    .source-form input, .source-form select { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; font: inherit; font-size: 12px; background: #fff; color: #20242c; min-width: 0; }
    .source-form .checkbox-line { display: flex; align-items: center; gap: 7px; font-weight: 500; }
    .source-form .checkbox-line input { width: auto; }
    .source-workbench { border-color: #cdded9; background: var(--surface); }
    .source-map-legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
    .source-map-legend span { border: 1px solid #d4e1dd; border-radius: 999px; padding: 7px 10px; background: #f8fbfa; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .source-map-legend strong { color: #166454; margin-right: 4px; }
    .source-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; margin: 0 0 14px; }
    .source-overview span { border: 1px solid #d4e1dd; border-radius: 7px; padding: 9px; background: #fff; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .source-overview strong { display: block; color: #166454; font-size: 15px; }
    .source-tree { display: grid; grid-template-columns: minmax(220px, 0.38fr) minmax(0, 1fr); gap: 12px; align-items: stretch; margin: 0 0 14px; }
    .source-tree-root { border: 1px solid #cbded8; border-radius: var(--radius); padding: 12px; background: #f4fbf8; }
    .source-tree-root span, .source-tree-group h3 { display: block; color: var(--accent); font-size: 11px; font-weight: 750; margin: 0 0 6px; text-transform: uppercase; }
    .source-tree-root strong { display: block; font-size: 15px; line-height: 1.2; overflow-wrap: anywhere; }
    .source-tree-root p { margin: 8px 0 0; color: #4f5867; font-size: 12px; line-height: 1.4; }
    .source-tree-groups { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .source-tree-group { border: 1px solid #dbe4ea; border-radius: var(--radius); padding: 10px; background: var(--surface); }
    .source-tree-group.ready { border-color: #bdd8cf; }
    .source-tree-group.needs-setup { border-color: #e2d0a4; background: #fffdf7; }
    .source-tree-group.needs-attention { border-color: #dfb59c; background: #fff8f4; }
    .source-tree-group.detached { background: #f8fafc; }
    .source-tree-group > div { display: grid; gap: 8px; }
    .source-tree-node { border-top: 1px solid #e5e9f0; padding-top: 8px; }
    .source-tree-node:first-child { border-top: 0; padding-top: 0; }
    .source-tree-node strong { display: block; font-size: 13px; line-height: 1.25; overflow-wrap: anywhere; }
    .source-tree-node span { display: inline-block; border: 1px solid #d6dde7; border-radius: 999px; padding: 2px 6px; color: #5f6875; background: #f8fafc; font-size: 11px; margin: 4px 4px 0 0; }
    .source-tree-node p { margin: 6px 0 7px; color: #4f5867; font-size: 12px; line-height: 1.35; }
    .source-tree-node a { display: inline-flex; border: 1px solid #cfd8e5; border-radius: 999px; padding: 3px 7px; background: #f8fafc; color: #303845; font-size: 11px; }
    .source-filter-panel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.85fr); gap: 12px; align-items: start; border: 1px solid #d4e1dd; border-radius: var(--radius); padding: 12px; margin: 0 0 14px; background: var(--surface-soft); }
    .source-filter-panel h3 { margin: 0 0 6px; font-size: 14px; }
    .source-filter-panel p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .source-filter-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .source-filter-chip { display: inline-flex; border: 1px solid #cfd8e5; border-radius: 999px; padding: 5px 8px; color: #303845; background: #f8fafc; font-size: 12px; text-decoration: none; }
    .source-filter-chip.active { border-color: #166454; background: #eef8f5; color: #145a4d; font-weight: 700; }
    .source-workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 16px; align-items: start; }
    .source-management { display: grid; gap: 10px; }
    .source-list { display: grid; gap: 8px; }
    .source-card, .source-result { border: 1px solid #dfe8e4; border-radius: 7px; padding: 9px; background: var(--surface-soft); }
    .source-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
    .source-card strong, .source-result strong { display: block; font-size: 13px; margin-bottom: 4px; overflow-wrap: anywhere; }
    .source-card span { display: inline-block; font-size: 12px; margin: 0 4px 4px 0; }
    .source-kind { color: #6a7280; margin-left: 5px; }
    .source-health { border: 1px solid #cfd8e5; border-radius: 999px; padding: 2px 7px; background: #f8fafc; color: #445064; }
    .source-health.ready { border-color: #bad8cf; background: #eef8f5; color: #166454; }
    .source-health.needs-setup, .source-health.needs-attention { border-color: #e3d3a5; background: #fff9e8; color: #715118; }
    .source-health.detached { border-color: #d6dde7; background: #f8fafc; color: #6a7280; }
    .source-role, .source-readiness, .source-usability, .source-kind, .source-attachment { border: 1px solid #d6dde7; border-radius: 999px; padding: 2px 7px; background: #fff; color: #4f5867; }
    .source-card p, .source-result p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .source-card .source-action { color: #6a7280; }
    .source-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .source-card-actions a { border: 1px solid #cfd8e5; border-radius: 999px; padding: 3px 7px; background: #fff; color: #303845; font-size: 11px; }
    .detail h3 { font-size: 15px; margin: 0 0 7px; }
    .detail h4 { font-size: 12px; margin: 12px 0 6px; color: #4f5867; text-transform: uppercase; letter-spacing: .04em; }
    .detail p { margin: 0 0 10px; color: #303845; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    .provenance-drilldown { display: grid; gap: 8px; margin-top: 8px; }
    .provenance-drilldown article { border: 1px solid #dbe4ea; border-radius: 7px; padding: 8px; background: #fbfcfe; }
    .provenance-drilldown strong { display: block; font-size: 13px; margin-bottom: 4px; overflow-wrap: anywhere; }
    .provenance-drilldown span { display: inline-block; border: 1px solid #d4e1dd; border-radius: 999px; padding: 2px 6px; margin: 0 4px 4px 0; color: #4f5867; font-size: 11px; }
    .provenance-drilldown p { margin: 3px 0 0; color: #4f5867; font-size: 12px; line-height: 1.35; }
    details { border-top: 1px solid #e5e9f0; padding-top: 9px; margin-top: 10px; }
    summary { cursor: pointer; color: #303845; font-weight: 650; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .actions span { border: 1px solid #c9d2df; border-radius: 6px; padding: 4px 7px; font-size: 12px; background: #f7fafb; }
    .actions form { margin: 0; }
    .action-note { flex-basis: 100%; margin: 0; color: #7a4d18; font-size: 12px; line-height: 1.4; }
    .action-detail { width: 100%; }
    .action-detail form { display: grid; gap: 8px; margin-top: 8px; }
    .action-detail label { display: grid; gap: 4px; color: #4f5867; font-size: 12px; }
    .action-detail input, .action-detail textarea { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; font: inherit; font-size: 12px; }
    .danger-zone p, .forget-result p { margin: 8px 0; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .forget-result { border: 1px solid #d9dee7; border-radius: 7px; padding: 10px; margin: 10px 0; background: #fbfcfe; }
    .forget-result strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .duplicate-options { display: grid; gap: 8px; margin-top: 10px; }
    .duplicate-options article { border: 1px solid #e1e7ef; border-radius: 7px; padding: 8px; background: #fbfcfe; }
    .duplicate-options strong { display: block; font-size: 13px; margin-bottom: 5px; overflow-wrap: anywhere; }
    .duplicate-options p { margin: 0 0 8px; color: #4f5867; font-size: 12px; line-height: 1.4; }
    .duplicate-options form { display: inline-block; margin: 0 6px 6px 0; }
    .conflict-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .conflict-compare article { border: 1px solid #e1e7ef; border-radius: 7px; padding: 8px; background: #fbfcfe; }
    .conflict-compare span { display: block; color: #7a4d18; font-size: 12px; font-weight: 650; margin-bottom: 5px; }
    .conflict-compare strong { display: block; font-size: 13px; margin-bottom: 5px; overflow-wrap: anywhere; }
    .conflict-compare p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.4; }
    .conflict-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .conflict-actions form { margin: 0; }
    button { border: 1px solid #aeb9c8; border-radius: 6px; background: var(--surface); padding: 6px 9px; font: inherit; font-size: 12px; cursor: pointer; color: var(--text); max-width: 100%; overflow-wrap: anywhere; }
    button:hover { background: #f2f6fb; }
    button.danger { border-color: #b77f62; color: var(--danger); background: var(--danger-soft); }
    .actions.disabled span { color: #788292; background: #f9fafb; }
    .setting { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .setting:first-child { border-top: 0; }
    .setting-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .setting-head span { color: #6a7280; font-size: 12px; }
    .setting-value { margin: 0; color: #303845; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    .settings-grid { display: grid; gap: 8px; margin-top: 10px; }
    .setting-form { display: grid; gap: 6px; border: 1px solid #e1e7ef; border-radius: 7px; padding: 8px; background: #fbfcfe; }
    .setting-form label { display: grid; gap: 5px; color: #303845; font-size: 12px; font-weight: 650; }
    .setting-form select, .setting-form textarea { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; font: inherit; font-size: 12px; background: #fff; color: #20242c; }
    .setting-form button { justify-self: start; }
    .setting-result { border: 1px solid #d9dee7; border-radius: 7px; padding: 10px; margin-bottom: 10px; background: #fbfcfe; }
    .setting-result strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .setting-result p { margin: 0 0 8px; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .documentation-posture-panel { border: 1px solid #d5e1dd; border-radius: 8px; background: #fff; padding: 13px; margin: 0 0 16px; }
    .documentation-posture-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
    .documentation-posture-head h3 { margin: 2px 0 0; font-size: 17px; line-height: 1.2; }
    .posture-profile { border: 1px solid #bfd8d0; border-radius: 999px; padding: 4px 8px; color: #145a4d; background: #eef8f5; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .documentation-posture-panel > p { color: #4f5867; font-size: 12.5px; line-height: 1.4; margin: 0 0 10px; }
    .posture-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .posture-grid h4 { margin: 0 0 6px; font-size: 12px; color: #303845; }
    .posture-grid ul { margin: 0; padding-left: 18px; color: #4f5867; font-size: 12px; line-height: 1.45; }
    .posture-options { display: grid; gap: 7px; padding-left: 0 !important; list-style: none; }
    .posture-options li { border: 1px solid #e0e7e4; border-radius: 7px; padding: 8px; background: #f8fbfa; }
    .posture-options .recommended { border-color: #7eb6a9; background: #eef8f5; box-shadow: inset 3px 0 0 #0f6b5a; }
    .posture-options strong { display: block; color: #20242c; font-size: 12px; }
    .posture-options span { display: block; margin-top: 2px; color: #166454; font-size: 11px; font-weight: 700; }
    .posture-options p { margin: 4px 0 0; color: #4f5867; font-size: 11.5px; line-height: 1.35; }
    .strategy-note { margin: 0 0 7px !important; color: #4f5867; font-size: 11.5px; line-height: 1.35; }
    .strategy-reason { color: #5d6674 !important; }
    .posture-canon { border-top: 1px solid #e0e7e4; padding-top: 8px; }
    .canon-capability-summary { display: grid; gap: 8px; grid-column: 1 / -1; border: 1px solid #d8e5e1; border-radius: 7px; padding: 10px; background: #fbfdfc; }
    .canon-capability-summary h4 { margin: 0 0 4px; font-size: 12px; color: #303845; }
    .canon-capability-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .canon-capability-group { min-width: 0; }
    .canon-capability-group ul { display: grid; gap: 5px; margin: 0; padding-left: 0; list-style: none; }
    .canon-capability-group li { display: grid; gap: 2px; border: 1px solid #e3eae7; border-radius: 6px; padding: 6px; background: #fff; color: #303845; font-size: 11.5px; line-height: 1.3; overflow-wrap: anywhere; }
    .canon-capability-group span { color: #166454; font-size: 10.5px; font-weight: 700; }
    .rule-filters { display: grid; gap: 7px; margin-bottom: 12px; color: #4f5867; font-size: 12px; }
    .rule-filters h3 { margin: 0; font-size: 13px; color: #303845; }
    .rule-filters div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .rule-filters .filter-note { margin: 0; color: #166454; font-size: 12px; line-height: 1.35; }
    .filter-chip { display: inline-flex; border: 1px solid #cfd8e5; border-radius: 999px; padding: 2px 7px; color: #303845; background: var(--surface-soft); text-decoration: none; max-width: 100%; overflow-wrap: anywhere; }
    .filter-chip:hover { background: #eef4fb; }
    .review-workspace { display: grid; gap: 12px; }
    .review-guide { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(240px, 0.8fr); gap: 12px; border: 1px solid #cfded8; border-radius: var(--radius); padding: 14px; background: var(--surface-soft); }
    .review-guide span { display: block; color: #166454; font-size: 12px; font-weight: 750; margin-bottom: 5px; text-transform: uppercase; }
    .review-guide strong { display: block; color: #20242c; font-size: 18px; line-height: 1.2; margin-bottom: 6px; }
    .review-guide p { margin: 0; color: #425064; font-size: 13px; line-height: 1.45; }
    .review-guide ol { margin: 0; padding-left: 20px; color: #303845; font-size: 13px; line-height: 1.5; }
    .migration-review { display: grid; grid-template-columns: minmax(220px, 0.62fr) minmax(0, 1fr); gap: 10px; border: 1px solid #d8e1d8; border-radius: 7px; padding: 12px; background: #fbfdf9; }
    .migration-review-head span { display: block; color: #166454; font-size: 12px; font-weight: 750; margin-bottom: 5px; text-transform: uppercase; }
    .migration-review-head strong { display: block; color: #20242c; font-size: 16px; line-height: 1.2; margin-bottom: 6px; }
    .migration-review-head p { margin: 0 0 6px; color: #425064; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .migration-review-lanes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .migration-review-lanes article { border: 1px solid #dce3ec; border-radius: 7px; padding: 9px; background: #fff; }
    .migration-review-lanes span { display: block; color: #5f6875; font-size: 11px; font-weight: 750; margin-bottom: 4px; text-transform: uppercase; }
    .migration-review-lanes strong { display: block; color: #20242c; font-size: 16px; margin-bottom: 5px; }
    .migration-review-lanes p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .review-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .review-overview article { border: 1px solid #dce3ec; border-radius: 7px; padding: 10px; background: #fbfcfe; }
    .review-overview span { display: block; color: #6a7280; font-size: 12px; margin-bottom: 4px; }
    .review-overview strong { display: block; color: #20242c; font-size: 18px; margin-bottom: 5px; }
    .review-overview p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.35; }
    .review-lanes { display: grid; gap: 8px; }
    .review-lane { border: 1px solid #dfe8e4; border-radius: 7px; padding: 10px; margin: 0; background: var(--surface); }
    .review-lane summary { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 0; padding: 0; margin: 0; }
    .review-lane summary span { font-size: 14px; font-weight: 750; }
    .review-lane summary strong { border: 1px solid #d6dde7; border-radius: 999px; padding: 2px 8px; color: #445064; background: #f8fafc; font-size: 12px; }
    .review-lane[open] summary { margin-bottom: 8px; }
    .review-lane-note { margin: 0 0 10px; color: #4f5867; font-size: 12px; line-height: 1.4; }
    .graph-review { border: 1px solid #d7e1df; border-radius: 7px; padding: 12px; background: #fbfdfc; }
    .graph-review-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 10px; }
    .graph-review-head span { display: block; color: #166454; font-size: 11px; font-weight: 760; text-transform: uppercase; }
    .graph-review-head h3 { margin: 2px 0 5px; font-size: 15px; }
    .graph-review-head p, .graph-detail-head p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .graph-review-counts { display: grid; grid-template-columns: repeat(2, minmax(88px, 1fr)); gap: 6px; min-width: 220px; }
    .graph-review-counts span { border: 1px solid #dce3ec; border-radius: 7px; padding: 7px; background: #fff; color: #4f5867; text-transform: none; }
    .graph-review-counts strong { display: block; color: #20242c; font-size: 15px; }
    .graph-review-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.75fr); gap: 10px; align-items: start; }
    .graph-review-lanes, .graph-candidate-list, .graph-source-refs, .graph-review-history { display: grid; gap: 8px; }
    .graph-candidate-card, .graph-candidate-detail, .graph-source-refs article, .graph-review-history article { border: 1px solid #dfe6ee; border-radius: 7px; background: #fff; padding: 9px; min-width: 0; }
    .graph-candidate-card.selected { border-color: #7eb4a8; box-shadow: 0 0 0 1px rgba(23, 107, 93, 0.12); }
    .graph-candidate-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .graph-candidate-id, .graph-detail-head span { display: block; color: #5f6875; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .graph-candidate-card h3 { margin: 2px 0 5px; font-size: 14px; line-height: 1.25; overflow-wrap: anywhere; }
    .graph-candidate-card p, .graph-source-refs p, .graph-review-history p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.38; overflow-wrap: anywhere; }
    .graph-candidate-shape { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; border-top: 1px solid #edf1f5; margin-top: 8px; padding-top: 8px; font-size: 12px; color: #4f5867; overflow-wrap: anywhere; }
    .graph-candidate-shape strong { color: #20242c; overflow-wrap: anywhere; }
    .graph-detail-head strong { display: block; font-size: 15px; line-height: 1.25; margin: 2px 0 5px; overflow-wrap: anywhere; }
    .graph-candidate-detail h4 { margin: 10px 0 6px; font-size: 12px; color: #4f5867; text-transform: uppercase; }
    .graph-actions, .graph-target-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .graph-action-detail { border-top: 1px solid #edf1f5; margin-top: 8px; padding-top: 8px; }
    .graph-action-detail summary { font-size: 12px; font-weight: 700; }
    .graph-action-detail form { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; margin-top: 8px; }
    .graph-action-detail label, .graph-target-actions label { display: grid; gap: 3px; color: #5f6875; font-size: 11px; min-width: min(190px, 100%); }
    .graph-action-detail input, .graph-target-actions input { max-width: 100%; min-width: 0; }
    @media (max-width: 760px) {
      .graph-review-head, .graph-review-grid { display: grid; grid-template-columns: 1fr; }
      .graph-review-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; }
      .graph-actions, .graph-target-actions, .graph-action-detail form { display: grid; grid-template-columns: 1fr; }
    }
    .review-action-group { border-bottom: 1px solid #e3e8ef; padding-bottom: 8px; margin-bottom: 8px; }
    .risky-action-group { border: 1px solid #e5c7bf; border-radius: 7px; padding: 8px; background: #fffaf8; }
    .cost-summary h3 { margin: 10px 0 6px; font-size: 13px; color: #303845; }
    pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f8fb; border: 1px solid #e1e7ef; border-radius: 6px; padding: 8px; font-size: 12px; line-height: 1.35; }
    .chat { min-height: 92px; border: 1px dashed #b8c2d0; border-radius: 8px; padding: 10px; color: #565d6b; font-size: 13px; }
    .ask-panel { border-color: #9fc8bd; background: var(--surface); padding: 0; overflow: hidden; box-shadow: 0 18px 44px rgba(32, 36, 44, 0.08); }
    .ask-layout { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(340px, 0.85fr); gap: 0; align-items: stretch; }
    .ask-work { padding: 32px; }
    .ask-work h2 { font-size: 34px; margin-bottom: 10px; }
    .ask-work .workbench-promise { margin: 0 0 18px; color: #415363; font-size: 15px; line-height: 1.45; max-width: 860px; }
    .first-screen-snapshot { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 16px; }
    .first-screen-snapshot article { border: 1px solid #d5e1dd; border-radius: 8px; padding: 12px; background: #fff; min-height: 88px; }
    .first-screen-snapshot article.ready { border-color: #bdd8cf; background: #f4fbf8; }
    .first-screen-snapshot article.needs-work { border-color: #e2d0a4; background: #fffaf0; }
    .first-screen-snapshot span { display: block; color: #5f6976; font-size: 11px; font-weight: 750; margin-bottom: 5px; text-transform: uppercase; }
    .first-screen-snapshot strong { display: block; color: #20242c; font-size: 18px; line-height: 1.15; overflow-wrap: anywhere; }
    .first-screen-snapshot p { margin: 7px 0 0; color: #4f5867; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .memory-profile { border-left: 1px solid #d9e4df; padding: 24px 20px; color: #303845; background: #f4f8f7; }
    .memory-profile h3 { margin: 0 0 7px; font-size: 15px; overflow-wrap: anywhere; }
    .memory-profile .state { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 11px; margin-bottom: 8px; }
    .memory-profile p { margin: 7px 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .memory-profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
    .memory-profile-metrics span { border: 1px solid #dce3ec; border-radius: 6px; padding: 7px; background: #f8fafc; color: #4f5867; font-size: 11px; }
    .memory-profile-metrics strong { display: block; color: #20242c; font-size: 13px; }
    .chat-form { display: grid; gap: 10px; }
    .chat-form textarea { resize: vertical; min-height: 300px; border: 1px solid #b6c9c4; border-radius: 7px; padding: 14px; font: inherit; font-size: 16px; color: #20242c; background: #fff; }
    .chat-submit-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .chat-submit-row span { color: #607080; font-size: 12px; }
    .chat-form button { justify-self: start; border-color: #8fb9ad; background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; }
    .chat-answer { border-top: 1px solid #e5e9f0; margin-top: 12px; padding-top: 12px; max-height: 680px; overflow: auto; overscroll-behavior: contain; }
    .chat-answer h3 { font-size: 14px; margin: 0 0 8px; }
    .chat-answer p { margin: 0 0 9px; color: #303845; font-size: 13px; line-height: 1.45; }
    .chat-answer .warning { color: #8a3c15; font-weight: 650; }
    .chat-actions { display: grid; gap: 8px; margin-top: 10px; }
    .chat-actions h4 { font-size: 12px; margin: 0; color: #4f5867; text-transform: uppercase; letter-spacing: .04em; }
    .chat-actions article { border: 1px solid #d9dee7; border-radius: 7px; padding: 9px; background: #fbfcfe; }
    .chat-actions strong { display: block; font-size: 13px; }
    .chat-actions span { display: inline-block; margin-top: 5px; color: #6a7280; font-size: 12px; }
    .chat-actions p { margin: 6px 0; color: #4f5867; }
    .chat-actions code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f7fb; border-radius: 5px; padding: 6px; font-size: 12px; }
    .chat-action-form { margin-top: 8px; }
    .chat-action-form button { border-color: #8fb9ad; background: #eef8f5; color: #145a4d; font-weight: 700; }
    .chat-understanding { margin: 0 0 8px; color: #667085; font-size: 12px; }
    .chat-result { display: inline-flex; margin-left: 6px; border: 1px solid #d6dde7; border-radius: 999px; padding: 2px 7px; color: #303845; background: #f8fafc; }
    .activity-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
    .activity-summary span { border: 1px solid #dce3ec; border-radius: 7px; padding: 9px; background: #fbfcfe; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .activity-summary strong { display: block; color: #166454; font-size: 15px; }
    .audit-workbench { display: grid; gap: 12px; }
    .audit-filter-form { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; align-items: end; border: 1px solid #dce3ec; border-radius: 7px; padding: 10px; background: #fbfcfe; }
    .audit-filter-form label { display: grid; gap: 4px; color: #4f5867; font-size: 12px; font-weight: 650; }
    .audit-filter-form input { min-width: 0; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; font: inherit; font-size: 12px; }
    .audit-filter-form button { align-self: end; }
    .audit-summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
    .audit-summary span { border: 1px solid #dce3ec; border-radius: 7px; padding: 9px; background: #f8fafc; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .audit-summary strong { display: block; color: #166454; font-size: 15px; }
    .audit-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .audit-row-list { display: grid; gap: 8px; }
    .audit-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 0.34fr); gap: 10px; border: 1px solid #dfe8e4; border-radius: 7px; padding: 10px; background: var(--surface-soft); }
    .audit-row strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
    .audit-row p { margin: 4px 0; color: #4f5867; font-size: 12px; overflow-wrap: anywhere; }
    .audit-row time { color: #6f7785; font-size: 11px; }
    .audit-row dl { grid-template-columns: 58px minmax(0, 1fr); font-size: 11px; }
    .audit-recommendations ul { margin: 0; padding-left: 18px; color: #303845; font-size: 13px; line-height: 1.45; }
    .activity-list { display: grid; gap: 12px; }
    .activity-group { border: 1px solid #dfe8e4; border-radius: var(--radius); padding: 11px; background: var(--surface); }
    .activity-group-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 9px; }
    .activity-group-head h3 { margin: 0; font-size: 14px; }
    .activity-group-head p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.35; max-width: 520px; }
    .activity-item { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 10px; border-top: 1px solid #e5e9f0; padding-top: 9px; }
    .activity-item:first-child { border-top: 0; padding-top: 0; }
    .activity-item > span { justify-self: start; border: 1px solid #d6dde7; border-radius: 999px; padding: 3px 7px; color: #445064; background: #f8fafc; font-size: 11px; }
    .activity-item strong { display: block; font-size: 13px; margin-bottom: 3px; }
    .activity-item p { margin: 0 0 3px; color: #4f5867; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .activity-item time { color: #6f7785; font-size: 12px; }
    .panel, .operation-panel, .memory-space, .project-choice, .source-card, .source-result, .source-tree-group, .review-lane, .activity-group, .activity-item, .item { min-width: 0; }
    .empty { color: var(--muted); font-size: 13px; line-height: 1.4; border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 10px; background: var(--surface-soft); }
    a:focus-visible, button:focus-visible, summary:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #7eb6a9; outline-offset: 2px; }
    @media (max-width: 1180px) { .workbench-body { grid-template-columns: minmax(260px, 310px) minmax(0, 1fr); } .ask-layout, .source-filter-panel, .source-workspace-grid, .source-tree { grid-template-columns: 1fr; } .source-tree-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); } .source-filter-chips { justify-content: flex-start; } .operation-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); } .operation-panel[open] { grid-column: span 2; } .memory-profile { border-left: 0; border-top: 1px solid #d9e4df; } }
    @media (max-width: 760px) { header { align-items: flex-start; flex-direction: column; padding: 16px; } main { padding: 12px; } .workbench-body { grid-template-columns: 1fr; } .workbench-main { order: 1; } .left-rail { order: 2; position: static; } .command-grid, .operation-panels, .source-overview, .review-overview, .audit-summary, .review-guide, .signal-strip, .first-screen-snapshot, .posture-grid, .canon-capability-grid, .source-tree-groups, .activity-summary, .source-map-legend, .project-choice-grid, .current-project-context { grid-template-columns: 1fr; } .operation-panel[open] { grid-column: span 1; } .activity-group-head { display: block; } .activity-group-head p { margin-top: 5px; } .activity-item { grid-template-columns: 1fr; } .primary-workspace { grid-template-columns: 1fr; } .source-card { grid-template-columns: 1fr; } .section-head { display: block; } .memory-profile-metrics { grid-template-columns: 1fr; } .current-project-facts { justify-content: flex-start; } .ask-work, .memory-profile { padding: 16px; } .ask-work h2 { font-size: 28px; } .chat-form textarea { min-height: 240px; } }

    /* Stage 1 Workbench design architecture corrective pass */
    :root {
      --bg: #f4f2ec;
      --bg-subtle: #ebe8df;
      --surface: #fbfaf6;
      --surface-soft: #f7f5ee;
      --surface-raised: #ffffff;
      --surface-inset: #efede6;
      --text: #171a1f;
      --text-muted: #5e6673;
      --text-faint: #858c98;
      --line: #d8d5ca;
      --line-strong: #b9b4a8;
      --accent: #176b5d;
      --accent-strong: #0f5147;
      --accent-soft: #dcebe6;
      --info: #285c7d;
      --success: #16704f;
      --warning: #9a6400;
      --danger: #a33a2c;
      --neutral: #6b7280;
      --radius: 12px;
      --radius-sm: 7px;
      --shadow-soft: 0 1px 2px rgba(23, 26, 31, 0.05), 0 16px 40px rgba(23, 26, 31, 0.06);
      --shadow-panel: 0 1px 0 rgba(255, 255, 255, 0.72) inset, 0 18px 48px rgba(23, 26, 31, 0.08);
      --mono: "IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
      font-family: "IBM Plex Sans", "Aptos", "Segoe UI", sans-serif;
    }
    html { background: var(--bg); }
    body {
      background:
        radial-gradient(circle at 18% -18%, rgba(23, 107, 93, 0.12), transparent 32%),
        linear-gradient(180deg, #faf8f1 0%, var(--bg) 42%, #ece8dc 100%);
      color: var(--text);
      letter-spacing: -0.006em;
      font-size: 13px;
      text-wrap: pretty;
    }
    a { color: var(--accent-strong); }
    a:hover { color: #0a3d36; }
    header {
      position: sticky;
      top: 0;
      z-index: 30;
      min-height: 50px;
      padding: 10px 22px;
      background: rgba(250, 248, 241, 0.88);
      border-bottom: 1px solid rgba(185, 180, 168, 0.72);
      backdrop-filter: blur(18px) saturate(1.08);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.62) inset;
    }
    header h1 {
      font-size: 15px;
      letter-spacing: -0.02em;
      font-weight: 760;
    }
    header p { color: var(--text-muted); font-size: 12px; }
    header .status .pill {
      border-color: var(--line);
      background: rgba(255, 255, 255, 0.62);
      color: var(--text-muted);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
    }
    main {
      max-width: 1840px;
      padding: 18px 22px 34px;
      gap: 16px;
    }
    .workbench-body {
      grid-template-columns: minmax(276px, 320px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .left-rail {
      position: sticky;
      top: 70px;
      display: grid;
      gap: 12px;
      max-height: calc(100vh - 84px);
      overflow: auto;
      padding-right: 2px;
      scrollbar-width: thin;
    }
    .workbench-main.production-first-screen {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(318px, 372px);
      gap: 16px;
      align-items: start;
    }
    .workbench-main.production-first-screen > .ask-panel,
    .workbench-main.production-first-screen > .source-workbench,
    .workbench-main.production-first-screen > .overview-activity,
    .workbench-main.production-first-screen > .overview-audit,
    .workbench-main.production-first-screen > .overview-review,
    .workbench-main.production-first-screen > .overview-command {
      grid-column: 1;
    }
    .workbench-main.production-first-screen > .secondary-workspace {
      grid-column: 2;
      grid-row: 1 / span 4;
      order: initial;
      position: sticky;
      top: 70px;
      max-height: calc(100vh - 84px);
      overflow: auto;
    }
    .panel {
      background: rgba(251, 250, 246, 0.94);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.74) inset, 0 10px 28px rgba(23, 26, 31, 0.045);
    }
    .section-head,
    .activity-group-head {
      border-bottom: 1px solid rgba(216, 213, 202, 0.74);
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .section-kicker {
      font-family: var(--mono);
      color: var(--accent-strong);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
    }
    h2 {
      color: var(--text);
      font-size: 17px;
      line-height: 1.15;
      letter-spacing: -0.035em;
      font-weight: 760;
    }
    h3 { color: var(--text); letter-spacing: -0.018em; }
    p, li, dd { color: var(--text-muted); line-height: 1.45; }
    .workbench-nav {
      gap: 6px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(239, 237, 230, 0.72);
      width: fit-content;
    }
    .workbench-nav a {
      border: 0;
      border-radius: 999px;
      padding: 6px 10px;
      background: transparent;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 650;
    }
    .workbench-nav a:hover { background: rgba(255, 255, 255, 0.78); color: var(--text); }
    .workbench-nav a.active {
      background: var(--text);
      color: #fffdf7;
      box-shadow: 0 7px 18px rgba(23, 26, 31, 0.16);
    }
    .ask-panel {
      position: relative;
      overflow: hidden;
      border-color: rgba(23, 107, 93, 0.38);
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(247, 245, 238, 0.94)),
        radial-gradient(circle at 88% 14%, rgba(23, 107, 93, 0.16), transparent 28%);
      box-shadow: var(--shadow-panel);
    }
    .ask-panel::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(23, 26, 31, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(23, 26, 31, 0.028) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(90deg, transparent, #000 14%, #000 64%, transparent);
    }
    .ask-layout {
      position: relative;
      grid-template-columns: minmax(0, 2.15fr) minmax(292px, 0.82fr);
      isolation: isolate;
    }
    .ask-work { padding: 22px; }
    .ask-work h2 {
      max-width: 760px;
      font-size: clamp(28px, 3vw, 40px);
      letter-spacing: -0.055em;
      line-height: 0.98;
    }
    .ask-work .workbench-promise {
      max-width: 780px;
      color: #394550;
      font-size: 14px;
      line-height: 1.52;
    }
    .first-screen-snapshot {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .first-screen-snapshot span,
    .signal-strip span,
    .summary-grid span,
    .activity-summary span,
    .source-overview span,
    .review-overview span {
      border-color: rgba(216, 213, 202, 0.9);
      background: rgba(255, 255, 255, 0.72);
      border-radius: var(--radius-sm);
      box-shadow: 0 1px 0 rgba(255,255,255,0.72) inset;
    }
    .first-screen-snapshot strong,
    .signal-strip strong,
    .summary-grid strong,
    .activity-summary strong,
    .source-overview strong,
    .review-overview strong {
      color: var(--text);
      font-weight: 760;
    }
    .chat-form textarea,
    input,
    select {
      border-color: var(--line-strong);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.82);
      color: var(--text);
      box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset;
    }
    .chat-form textarea {
      min-height: 170px;
      font-size: 14px;
      line-height: 1.5;
    }
    .chat-form textarea:focus,
    input:focus,
    select:focus,
    button:focus-visible,
    a:focus-visible {
      outline: 2px solid rgba(23, 107, 93, 0.45);
      outline-offset: 2px;
    }
    button,
    .actions a,
    .source-card-actions a {
      border-radius: 999px;
      border-color: var(--line-strong);
      background: #fffdf7;
      color: var(--text);
      font-weight: 700;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }
    button:hover,
    .actions a:hover,
    .source-card-actions a:hover {
      transform: translateY(-1px);
      border-color: var(--accent);
      box-shadow: 0 8px 20px rgba(23, 26, 31, 0.08);
    }
    .chat-form button[type="submit"] {
      background: var(--accent);
      border-color: var(--accent-strong);
      color: #fffdf7;
      box-shadow: 0 12px 26px rgba(23, 107, 93, 0.22);
    }
    .memory-profile {
      border-left-color: rgba(23, 107, 93, 0.24);
      background: rgba(239, 237, 230, 0.68);
    }
    .memory-profile-metrics span {
      background: rgba(255, 255, 255, 0.7);
      border-color: var(--line);
    }
    .memory-space-group {
      border-color: var(--line);
      background: rgba(251, 250, 246, 0.72);
      padding: 12px;
    }
    .memory-spaces { gap: 8px; }
    .memory-space {
      position: relative;
      border-color: rgba(216, 213, 202, 0.95);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.64);
      padding: 11px 12px;
      box-shadow: none;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }
    .memory-space:hover {
      transform: translateY(-1px);
      border-color: var(--line-strong);
      background: #fffdf7;
      box-shadow: 0 10px 22px rgba(23, 26, 31, 0.055);
    }
    .memory-space.active {
      border-color: rgba(23, 107, 93, 0.48);
      background: linear-gradient(180deg, #ffffff, #edf6f2);
      box-shadow: 0 0 0 1px rgba(23, 107, 93, 0.08), 0 12px 28px rgba(23, 107, 93, 0.08);
    }
    .memory-space.active::before {
      content: "";
      position: absolute;
      width: 7px;
      height: 7px;
      top: 15px;
      left: -4px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 4px rgba(23, 107, 93, 0.14);
    }
    .memory-space h3 { font-size: 13px; }
    .memory-space p { font-size: 11.5px; color: var(--text-muted); }
    .project-chooser {
      background: rgba(251, 250, 246, 0.96);
    }
    .project-choice article,
    .current-project-context {
      border-color: rgba(216, 213, 202, 0.95);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.68);
      box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset;
    }
    .project-choice:hover article {
      transform: translateY(-1px);
      border-color: var(--accent);
      box-shadow: 0 10px 22px rgba(23, 26, 31, 0.055);
    }
    .project-choice-meta dt,
    .project-choice-meta dd,
    .current-project-facts span {
      font-family: var(--mono);
    }
    .memory-space .state,
    .badges span,
    .source-health,
    .source-map-legend span {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      color: var(--text-muted);
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .state.active,
    .source-health.ready,
    .source-tree-group.ready h3::before { color: var(--success); }
    .state.interrupted,
    .source-health.needs-attention { color: var(--danger); }
    .state.started,
    .source-health.needs-setup { color: var(--warning); }
    .source-workbench {
      background: linear-gradient(180deg, rgba(251, 250, 246, 0.96), rgba(244, 242, 236, 0.92));
    }
    .source-map-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .source-map-legend span { padding: 6px 9px; }
    .source-workspace-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    .source-tree {
      position: relative;
      grid-template-columns: minmax(210px, 0.28fr) minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
      border: 1px solid rgba(216, 213, 202, 0.86);
      border-radius: 14px;
      background:
        linear-gradient(90deg, rgba(23, 107, 93, 0.08) 0 1px, transparent 1px) 0 0 / 28px 28px,
        linear-gradient(rgba(23, 107, 93, 0.055) 0 1px, transparent 1px) 0 0 / 28px 28px,
        rgba(255, 255, 255, 0.54);
    }
    .source-tree-root {
      border-color: rgba(23, 107, 93, 0.34);
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 10px 24px rgba(23, 107, 93, 0.065);
    }
    .source-tree-groups {
      grid-template-columns: repeat(4, minmax(136px, 1fr));
      gap: 8px;
      position: relative;
    }
    .source-tree-group {
      border-radius: 11px;
      border-color: rgba(216, 213, 202, 0.92);
      background: rgba(255, 255, 255, 0.72);
      min-height: 210px;
    }
    .source-tree-group.ready { border-top: 3px solid var(--success); }
    .source-tree-group.needs-setup { border-top: 3px solid var(--warning); }
    .source-tree-group.needs-attention { border-top: 3px solid var(--danger); }
    .source-tree-group.detached { border-top: 3px solid var(--neutral); opacity: 0.88; }
    .source-tree-group h3 {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .source-card,
    .source-result,
    .provenance-source {
      border-color: rgba(216, 213, 202, 0.92);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.7);
      box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset;
    }
    .source-card strong,
    .source-result strong { font-size: 12.5px; }
    .source-card span,
    .source-card p,
    .source-result p { font-size: 11.5px; }
    .activity-group {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: rgba(255, 255, 255, 0.62);
    }
    .activity-list {
      position: relative;
      gap: 0;
      padding-left: 6px;
    }
    .activity-list::before {
      content: "";
      position: absolute;
      top: 4px;
      bottom: 8px;
      left: 47px;
      width: 1px;
      background: linear-gradient(var(--accent-soft), var(--line));
    }
    .activity-item {
      position: relative;
      grid-template-columns: 78px minmax(0, 1fr);
      border-top: 0;
      padding: 8px 0 10px;
    }
    .activity-item::before {
      content: "";
      position: absolute;
      top: 15px;
      left: 39px;
      width: 9px;
      height: 9px;
      border: 2px solid var(--surface-raised);
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px rgba(23, 107, 93, 0.13);
    }
    .activity-time {
      font-family: var(--mono);
      color: var(--text-faint);
      font-size: 10.5px;
    }
    .activity-item strong { font-size: 12.5px; }
    .overview-audit,
    .overview-review,
    .overview-command { background: rgba(251, 250, 246, 0.82); }
    .review-guide {
      border-color: rgba(23, 107, 93, 0.24);
      background: rgba(255, 255, 255, 0.68);
      border-radius: 14px;
    }
    .review-lane,
    .item,
    .selected-project-card,
    .setting-form {
      border-color: var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.68);
    }
    .secondary-workspace.operations-workspace {
      background: rgba(239, 237, 230, 0.7);
      border-color: rgba(185, 180, 168, 0.82);
      box-shadow: 0 1px 0 rgba(255,255,255,0.68) inset;
    }
    .secondary-workspace .section-head {
      display: block;
    }
    .secondary-workspace h2 { font-size: 15px; }
    .operation-panels {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }
    .operation-panel,
    .operation-panel[open] {
      grid-column: span 1;
      border-color: rgba(216, 213, 202, 0.95);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.66);
      box-shadow: none;
    }
    .operation-panel summary span { color: var(--text); font-size: 12.5px; }
    .operation-panel summary small { color: var(--text-faint); }
    details summary {
      cursor: pointer;
      color: var(--text);
    }
    .empty {
      border: 1px dashed rgba(185, 180, 168, 0.9);
      border-radius: 10px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.48);
      color: var(--text-muted);
    }
    dl, .badges, .source-note, code, pre {
      font-family: var(--mono);
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }
    @media (max-width: 1320px) {
      .workbench-main.production-first-screen {
        grid-template-columns: minmax(0, 1fr);
      }
      .workbench-main.production-first-screen > .secondary-workspace {
        grid-column: 1;
        grid-row: auto;
        position: static;
        max-height: none;
      }
      .operation-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 1180px) {
      .workbench-body { grid-template-columns: minmax(248px, 300px) minmax(0, 1fr); }
      .source-tree-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .source-tree { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      header { position: static; padding: 12px; }
      main { padding: 10px; }
      .workbench-body { grid-template-columns: 1fr; }
      .workbench-main { order: 1; }
      .left-rail {
        order: 2;
        position: static;
        max-height: none;
        overflow: visible;
      }
      .workbench-nav {
        width: 100%;
        overflow-x: auto;
        flex-wrap: nowrap;
        justify-content: flex-start;
      }
      .workbench-nav a { white-space: nowrap; }
      .ask-layout,
      .first-screen-snapshot,
      .source-tree-groups,
      .operation-panels,
      .activity-summary,
      .audit-summary,
      .audit-columns,
      .audit-filter-form,
      .audit-row,
      .summary-grid,
      .review-overview,
      .signal-strip { grid-template-columns: 1fr; }
      .ask-work { padding: 16px; }
      .ask-work h2 { font-size: 29px; }
      .chat-form textarea { min-height: 210px; }
      .activity-list { padding-left: 0; }
      .activity-list::before { left: 9px; }
      .activity-item { grid-template-columns: 1fr; padding-left: 28px; }
      .activity-item::before { left: 4px; }
    }


    /* Stage 1 Workbench order correction: keep primary map surface before secondary panels */
    .workbench-main.production-first-screen > .secondary-workspace {
      grid-column: 1;
      grid-row: auto;
      order: 5;
      position: static;
      max-height: none;
      overflow: visible;
    }
    .workbench-main.production-first-screen > .overview-activity { order: 3; }
    .workbench-main.production-first-screen > .overview-audit { order: 4; }
    .workbench-main.production-first-screen > .overview-review { order: 5; }
    .workbench-main.production-first-screen > .overview-command { order: 6; }
    .workbench-main.production-first-screen .operation-panels {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .workbench-main.production-first-screen .operation-panel[open] {
      grid-column: span 2;
    }
    @media (max-width: 1320px) {
      .workbench-main.production-first-screen .operation-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .workbench-main.production-first-screen .operation-panels { grid-template-columns: 1fr; }
      .workbench-main.production-first-screen .operation-panel[open] { grid-column: span 1; }
    }


    /* Stage 1 mobile overflow containment */
    @media (max-width: 760px) {
      html, body { max-width: 100%; overflow-x: hidden; }
      header, main, section, aside,
      .panel, .workbench-body, .workbench-main, .left-rail,
      .ask-panel, .ask-layout, .ask-work, .memory-profile, .project-chooser,
      .project-choice-grid, .project-choice, .current-project-context,
      .source-workbench, .source-tree, .source-tree-root, .source-tree-groups,
      .source-tree-group, .source-filter-panel, .source-filter-chips,
      .source-workspace-grid, .source-management, .source-list,
      .review-workspace, .review-guide, .migration-review, .migration-review-lanes, .review-lanes,
      .activity-list, .activity-group, .operation-panels, .operation-panel,
      .command-grid, .summary-grid, .signal-strip, .first-screen-snapshot {
        max-width: 100%;
        min-width: 0;
      }
      .workbench-nav {
        width: 100%;
        max-width: 100%;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        overflow: visible;
      }
      .workbench-nav a {
        min-width: 0;
        white-space: normal;
        text-align: center;
        line-height: 1.2;
      }
      .source-filter-chips { justify-content: flex-start; }
      .source-filter-chip, .filter-chip, .source-tree-node a, .source-card-actions a, button {
        max-width: 100%;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .source-tree-node span, .source-role, .source-readiness, .source-usability,
      .source-kind, .source-attachment, .badges span, .activity-item > span {
        max-width: 100%;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      pre, code, textarea { max-width: 100%; }
      .migration-review, .migration-review-lanes { grid-template-columns: 1fr; }
    }


    /* Stage 1 mobile Ask width correction */
    @media (max-width: 760px) {
      .ask-work { padding: 8px; }
      .memory-profile { padding: 12px; }
      .first-screen-snapshot { gap: 8px; }
      .first-screen-snapshot article { padding: 10px; }
    }


    /* Stage 1 mobile snapshot width correction */
    @media (max-width: 760px) {
      #ask-recallant .first-screen-snapshot {
        width: calc(100% + 20px);
        max-width: calc(100vw - 20px);
        margin-left: -10px;
        margin-right: -10px;
      }
    }


    /* Stage 1 Activity Replay timeline correction */
    .activity-group {
      overflow: hidden;
    }
    .activity-group-head h3 {
      letter-spacing: -0.025em;
    }
    .activity-list {
      padding-left: 0;
    }
    .activity-list::before {
      left: 17px;
      top: 8px;
      bottom: 12px;
      background: linear-gradient(180deg, rgba(23, 107, 93, 0.34), rgba(216, 213, 202, 0.72));
    }
    .activity-item {
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 10px;
      padding: 10px 0 12px;
      align-items: start;
    }
    .activity-item::before {
      top: 18px;
      left: 12px;
      width: 9px;
      height: 9px;
      background: var(--accent);
      border: 2px solid var(--surface-raised);
      box-shadow: 0 0 0 3px rgba(23, 107, 93, 0.14);
      z-index: 1;
    }
    .activity-item > span {
      grid-column: 2;
      justify-self: start;
      max-width: 100%;
      border: 0;
      border-radius: 0;
      padding: 0;
      margin: 0 0 3px;
      background: transparent;
      color: var(--accent-strong);
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 760;
      letter-spacing: 0.075em;
      line-height: 1.2;
      text-transform: uppercase;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .activity-item > div {
      grid-column: 2;
      min-width: 0;
    }
    .activity-item strong {
      display: block;
      color: var(--text);
      font-size: 13px;
      font-weight: 760;
      letter-spacing: -0.012em;
      line-height: 1.25;
      margin-bottom: 4px;
    }
    .activity-item p {
      color: var(--text-muted);
      font-size: 12.5px;
      line-height: 1.38;
      margin-bottom: 3px;
    }
    .activity-item time {
      color: var(--text-faint);
      font-family: var(--mono);
      font-size: 10.5px;
    }
    @media (max-width: 760px) {
      .activity-list::before { left: 14px; }
      .activity-item {
        grid-template-columns: 34px minmax(0, 1fr);
        padding-left: 0;
      }
      .activity-item::before { left: 9px; }
      .activity-item > span,
      .activity-item > div { grid-column: 2; }
    }

  </style>
</head>
<body>
  <header>
    <div>
      <h1>Recallant Workbench</h1>
      ${renderWorkbenchNav(data, activeView, { rootChooser: projectChooser })}
    </div>
    <div class="status">
      ${
        projectChooser
          ? `<span class="pill">Choose project</span>`
          : `<a class="pill" href="${escapeHtml(rootWorkbenchPath(activeView))}">Choose project</a><span class="pill">${escapeHtml(currentProjectHeaderLabel(data))}</span>`
      }
      <span class="pill">Private UI</span>
    </div>
  </header>
  <main>
    ${projectChooser ? renderProjectChooser(data, activeView) : ""}
    ${
      showAsk
        ? `<section class="panel ask-panel" id="ask-recallant">
      <div class="ask-layout">
        <div class="ask-work">
          <span class="section-kicker">AI control surface</span>
          <h2>Ask Recallant</h2>
          <p class="workbench-promise">Ask what Recallant remembers, whether agents are recording, which sources support an answer, what needs review, or how to act safely.</p>
          ${renderCurrentProjectContext(data)}
          ${renderFirstScreenSnapshot(data)}
          ${renderDocumentationPosture(data)}
          ${renderManagementChat(data, chat, activeView)}
        </div>
        ${renderCurrentMemoryProfile(data)}
      </div>
    </section>`
        : ""
    }
    ${
      showBody
        ? `<section class="workbench-body ${focused ? "focused" : ""}" aria-label="Recallant workspace">
      ${
        showMemory
          ? `<aside class="left-rail">
        <section class="panel" id="memory-spaces">
          <h2>Memory Spaces</h2>
          ${renderMemorySpaces(data, activeView)}
        </section>
      </aside>`
          : ""
      }
      <section class="workbench-main ${focused ? "" : "production-first-screen"}">
        <div class="${focused ? "" : "overview-memory-map"}">
          ${showSources ? renderSourceWorkbench(data, source) : ""}
        </div>
        ${
          showActivity
            ? `<section class="panel ${focused ? "" : "overview-activity"}" id="activity-replay">
          <h2>Activity / Replay</h2>
          ${renderActivityReplay(data)}
        </section>`
            : ""
        }
        ${
          showAudit
            ? `<section class="panel ${focused ? "" : "overview-audit"}" id="audit">
          <h2>Audit</h2>
          ${renderAuditWorkbench(data)}
        </section>`
            : ""
        }
        ${
          showReview
            ? `<section class="panel ${focused ? "" : "overview-review"}" id="review">
          <h2>Review</h2>
          ${renderReviewWorkspace(data)}
        </section>`
            : ""
        }
        ${
          showCommand
            ? `<section class="panel ${focused ? "" : "overview-command"}" id="command-center">
          <h2>Command Center</h2>
          ${renderCurrentSignals(data)}
          <div class="command-grid">
            <div class="command-card">
              <h3>What Needs Attention</h3>
              ${renderAttention(data)}
            </div>
            <div class="command-card">
              <h3>Agent Readiness</h3>
              ${renderReadiness(data)}
            </div>
          </div>
        </section>`
            : ""
        }
        ${
          showSettings
            ? `<section class="secondary-workspace operations-workspace" aria-label="Secondary workbench panels">
          <div class="section-head">
            <div>
              <span class="section-kicker">Secondary workspace · Governed operations</span>
              <h2>Operations drawer</h2>
            </div>
            <p>Review detail, cost controls, cleanup, and settings stay available here without crowding Ask Recallant, Memory Spaces, or the Source Map.</p>
          </div>
          <div class="operation-panels">
            ${
              focused
                ? ""
                : `<details class="operation-panel">
              <summary><span>Project Actions</span><small>Isolation and advanced cleanup entry points</small></summary>
              ${renderProjectActions(data)}
            </details>
            <details class="operation-panel">
              <summary><span>Selected Detail</span><small>Open only when reviewing a specific memory</small></summary>
              ${renderDetail(data.selected_detail, data.available_review_actions, data.current_project_id, memoryForget, data.duplicate_conflicts)}
            </details>
            <details class="operation-panel">
              <summary><span>Model costs and approvals</span><small>Paid API remains confirmation-gated</small></summary>
              ${renderCosts(data)}
            </details>`
            }
            ${
              focused && !focusedSettings
                ? ""
                : `
            <details class="operation-panel" id="cleanup-forget"${focusedSettings ? " open" : ""}>
              <summary><span>Cleanup / Forget</span><small>Dry-run first; permanent erasure is separate</small></summary>
              ${renderCleanup(data, detach, sanitize)}
            </details>`
            }
            <details class="operation-panel" id="settings"${focused ? " open" : ""}>
              <summary><span>Settings</span><small>Project controls and technical values</small></summary>
              ${renderSettings(data, setting)}
            </details>
            <details class="operation-panel" id="remote-credentials"${remoteCredential ? " open" : ""}>
              <summary><span>Remote MCP Credentials</span><small>Scoped bridge provisioning for external agents</small></summary>
              ${renderRemoteCredentials(data, remoteCredential)}
            </details>
          </div>
        </section>`
            : ""
        }
      </section>
    </section>`
        : ""
    }
  </main>
</body>
</html>`;
}

export function createRecallantHttpServer(options: RecallantHttpServerOptions = {}) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/health") {
      write(
        response,
        200,
        JSON.stringify({ ok: true, ...describeServerBoundary() }),
        "application/json"
      );
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === remoteMcpEndpointPath) {
      await handleRemoteMcpRequest(request, response, options.remoteMcpDatabase);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === remoteConnectBootstrapPath) {
      const serverUrl = remoteInviteServerUrl({}, request);
      write(response, 200, remoteConnectBootstrapScript(serverUrl), "text/x-shellscript");
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/connect/client-bootstrap.sh") {
      write(response, 200, remoteConnectClientBootstrapScript(), "text/x-shellscript");
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === remoteConnectStartPath) {
      const database = options.workbenchDatabase ?? createRecallantDbFromEnv();
      if (!database) {
        write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
        return;
      }
      try {
        enforceRemoteConnectRateLimit(request, requestUrl.pathname);
        const result = await handleRemoteConnectStart(
          database,
          request,
          (await readJson(request)) as RemoteConnectStartRequest
        );
        write(response, 200, JSON.stringify(result), "application/json");
      } catch (error) {
        write(
          response,
          409,
          JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
          "application/json"
        );
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === remoteConnectPollPath) {
      const database = options.workbenchDatabase ?? createRecallantDbFromEnv();
      if (!database) {
        write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
        return;
      }
      try {
        enforceRemoteConnectRateLimit(request, requestUrl.pathname);
        const result = await handleRemoteConnectPoll(
          database,
          request,
          (await readJson(request)) as RemoteConnectPollRequest
        );
        write(response, 200, JSON.stringify(result), "application/json");
      } catch (error) {
        write(
          response,
          409,
          JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
          "application/json"
        );
      }
      return;
    }
    if (request.method === "GET" && requestUrl.pathname.startsWith("/j/")) {
      const token = decodeURIComponent(requestUrl.pathname.slice("/j/".length));
      const serverUrl = remoteInviteServerUrl({}, request);
      write(response, 200, remoteInviteScript(serverUrl, token), "text/x-shellscript");
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/remote-invite/redeem") {
      const database = options.workbenchDatabase ?? createRecallantDbFromEnv();
      if (!database) {
        write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
        return;
      }
      try {
        const result = await handleRemoteInviteRedeem(
          database,
          request,
          (await readJson(request)) as RemoteInviteRedeemRequest
        );
        write(response, 200, JSON.stringify(result), "application/json");
      } catch (error) {
        write(
          response,
          409,
          JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
          "application/json"
        );
      }
      return;
    }
    const auth = authorize(request);
    const audit = await startHttpAudit(request, response, requestUrl, auth);
    let routeError: unknown;
    try {
      if (!auth.ok) {
        write(response, 401, "Unauthorized", "text/plain");
        return;
      }
      const sessionCookie =
        auth.mode === "cloudflare" && auth.email ? createSessionCookie(auth.email) : "";
      const database = options.workbenchDatabase ?? createRecallantDbFromEnv();
      if (!database) {
        write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
        return;
      }
      const dashboardInput = {
        project_id: requestUrl.searchParams.get("project_id"),
        selected_memory_id: requestUrl.searchParams.get("memory_id"),
        graph_candidate_id: requestUrl.searchParams.get("graph_candidate_id"),
        graph_lifecycle_state: requestUrl.searchParams.get("graph_lifecycle_state"),
        graph_candidate_kind: requestUrl.searchParams.get("graph_candidate_kind"),
        graph_extraction_method: requestUrl.searchParams.get("graph_extraction_method"),
        graph_source_kind: requestUrl.searchParams.get("graph_source_kind"),
        graph_node_kind: requestUrl.searchParams.get("graph_node_kind"),
        graph_relation_type: requestUrl.searchParams.get("graph_relation_type"),
        source_id: requestUrl.searchParams.get("source_id"),
        rule_scope: requestUrl.searchParams.get("scope"),
        rule_scope_kind: requestUrl.searchParams.get("scope_kind"),
        rule_memory_type: requestUrl.searchParams.get("rule_type"),
        rule_memory_domain: requestUrl.searchParams.get("rule_domain")
      };
      const workbenchView = normalizeWorkbenchView(requestUrl.searchParams.get("view"));
      const explicitProjectId = optionalInput(requestUrl.searchParams.get("project_id"));
      if (request.method === "GET" && requestUrl.pathname === remoteConnectApprovePath) {
        const code = optionalInput(requestUrl.searchParams.get("code"));
        const remoteConnectRequest = code
          ? await database.getRemoteConnectRequestForApproval({ deviceCode: code })
          : null;
        write(
          response,
          200,
          renderRemoteConnectApprovalPage({
            code: code ?? "",
            request: remoteConnectRequest,
            error: code ? null : "Missing remote connect approval code."
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === remoteConnectApprovePath) {
        const contentType = optionalInput(getHeaderValue(request, "content-type")) ?? "";
        const body = contentType.includes("application/json")
          ? ((await readJson(request)) as RemoteConnectApprovalRequest)
          : ((await readForm(request)) as RemoteConnectApprovalRequest);
        try {
          const result = await handleRemoteConnectApprove(
            database,
            body,
            auth.mode === "cloudflare" && auth.email ? auth.email : "workbench"
          );
          if (contentType.includes("application/json")) {
            write(response, 200, JSON.stringify(result), "application/json");
          } else {
            write(
              response,
              200,
              `<p>Remote connect ${htmlEscape(result.action)} recorded for request ${htmlEscape(result.request.id)}.</p>`,
              "text/html",
              sessionCookie ? { "set-cookie": sessionCookie } : {}
            );
          }
        } catch (error) {
          write(
            response,
            409,
            JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
            "application/json"
          );
        }
        return;
      }
      if (requestUrl.pathname === "/" || requestUrl.pathname === "/review") {
        const dashboard = await withAuditReport(
          database,
          sanitizeDashboardForClient(await database.getReviewDashboard(dashboardInput)),
          requestUrl,
          workbenchView
        );
        write(
          response,
          200,
          renderDashboard(dashboard, { view: workbenchView, projectChooser: !explicitProjectId }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (requestUrl.pathname === "/api/review-dashboard") {
        const dashboard = await withAuditReport(
          database,
          sanitizeDashboardForClient(await database.getReviewDashboard(dashboardInput)),
          requestUrl,
          workbenchView
        );
        write(response, 200, JSON.stringify(dashboard), "application/json");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/remote-credentials") {
        const body: RemoteCredentialProvisioningRequest = {
          action: "list",
          project_id: requestUrl.searchParams.get("project_id"),
          developer_id: requestUrl.searchParams.get("developer_id"),
          client_id: requestUrl.searchParams.get("client_id"),
          include_revoked: requestUrl.searchParams.get("include_revoked"),
          server_url: requestUrl.searchParams.get("server_url"),
          target: requestUrl.searchParams.get("target"),
          bridge_client_id: requestUrl.searchParams.get("bridge_client_id"),
          session_id: requestUrl.searchParams.get("session_id"),
          trace_id: requestUrl.searchParams.get("trace_id")
        };
        try {
          const result = await handleRemoteCredentialProvisioning(database, request, body);
          write(response, 200, JSON.stringify(result), "application/json");
        } catch (error) {
          write(
            response,
            409,
            JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
            "application/json"
          );
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/remote-credential") {
        const body = (await readJson(request)) as RemoteCredentialProvisioningRequest;
        try {
          const result = await handleRemoteCredentialProvisioning(database, request, body);
          write(response, 200, JSON.stringify(result), "application/json");
        } catch (error) {
          write(
            response,
            409,
            JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
            "application/json"
          );
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/connect/bootstrap-token") {
        const body = (await readJson(request)) as RemoteConnectBootstrapTokenRequest;
        try {
          const result = await handleRemoteConnectBootstrapToken(
            database,
            request,
            body,
            auth.mode === "cloudflare" && auth.email ? auth.email : "workbench"
          );
          write(response, 200, JSON.stringify(result), "application/json");
        } catch (error) {
          write(
            response,
            409,
            JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
            "application/json"
          );
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/remote-invite") {
        const body = (await readJson(request)) as RemoteInviteRequest;
        try {
          const result = await handleRemoteInviteCreate(database, request, body);
          write(response, 200, JSON.stringify(result), "application/json");
        } catch (error) {
          write(
            response,
            409,
            JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
            "application/json"
          );
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/remote-credential") {
        const body = (await readForm(request)) as RemoteCredentialProvisioningRequest & {
          view?: string;
        };
        let remoteCredential: RemoteCredentialRenderState;
        try {
          remoteCredential = {
            action: remoteCredentialAction(body.action),
            result: await handleRemoteCredentialProvisioning(database, request, body)
          };
        } catch (error) {
          remoteCredential = {
            action: "list",
            error: safeHttpAuditErrorMessage(error)
          };
        }
        const remoteCredentialDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: optionalInput(body.project_id) ?? dashboardInput.project_id,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          remoteCredential.error ? 409 : 200,
          renderDashboard(remoteCredentialDashboard, {
            remoteCredential,
            view: "settings"
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/management-chat") {
        const body = (await readJson(request)) as {
          project_id?: string | null;
          source_id?: string | null;
          selected_memory_id?: string | null;
          memory_id?: string | null;
          message?: string;
          clarification_context?: unknown;
        };
        const chatDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: optionalInput(body.project_id) ?? dashboardInput.project_id,
            source_id: optionalInput(body.source_id),
            selected_memory_id:
              optionalInput(body.selected_memory_id) ??
              optionalInput(body.memory_id) ??
              dashboardInput.selected_memory_id
          })
        );
        const result = await buildManagementChatResponse({
          message: String(body.message ?? ""),
          dashboard: chatDashboard,
          database,
          clarification_context: parseOptionalJsonObject(body.clarification_context)
        });
        write(response, 200, JSON.stringify(result), "application/json");
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/management-chat") {
        const body = await readForm(request);
        const chatDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: optionalInput(body.project_id) ?? dashboardInput.project_id,
            source_id: optionalInput(body.source_id),
            selected_memory_id: optionalInput(body.memory_id) ?? dashboardInput.selected_memory_id
          })
        );
        const question = String(body.message ?? "");
        const result = await buildManagementChatResponse({
          message: question,
          dashboard: chatDashboard,
          database,
          clarification_context: parseOptionalJsonObject(body.clarification_context)
        });
        write(
          response,
          200,
          renderDashboard(chatDashboard, {
            chat: { question, response: result },
            view: normalizeWorkbenchView(body.view)
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/review-action") {
        const body = (await readJson(request)) as Record<string, unknown>;
        if (isGraphReviewRequest(body)) {
          try {
            const result = await database.reviewGraphCandidate(buildGraphReviewInput(body));
            write(response, 200, JSON.stringify(result), "application/json");
          } catch (error) {
            write(
              response,
              409,
              JSON.stringify({ ok: false, error: safeHttpAuditErrorMessage(error) }),
              "application/json"
            );
          }
          return;
        }
        const result = await database.reviewAgentMemory({
          ...(body as ReviewAgentMemoryInput),
          actor_kind: (body as ReviewAgentMemoryInput).actor_kind ?? "user"
        });
        write(
          response,
          result.ok === false ? 409 : 200,
          JSON.stringify(result),
          "application/json"
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/review-action") {
        const body = await readForm(request);
        if (isGraphReviewRequest(body)) {
          try {
            const result = await database.reviewGraphCandidate(buildGraphReviewInput(body));
            const location = graphReviewRedirectPath(body, result.graph_candidate_id);
            write(response, 303, "See other", "text/plain", { location });
          } catch (error) {
            write(
              response,
              409,
              safeHttpAuditErrorMessage(error),
              "text/plain",
              sessionCookie ? { "set-cookie": sessionCookie } : {}
            );
          }
          return;
        }
        const action = String(body.action ?? "");
        const patch =
          action === "edit"
            ? {
                title: optionalInput(body.title),
                body: optionalInput(body.body)
              }
            : undefined;
        const mergeMemoryIds = optionalInput(body.merge_memory_ids)
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const result = await database.reviewAgentMemory({
          memory_id: String(body.memory_id ?? ""),
          action,
          actor_kind: "user",
          note: optionalInput(body.note),
          superseded_by: optionalInput(body.superseded_by),
          merge_memory_ids: mergeMemoryIds,
          patch
        });
        const location = reviewPath(body.project_id, result.memory_id);
        write(response, 303, "See other", "text/plain", { location });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/memory-forget") {
        const body = (await readJson(request)) as Record<string, unknown>;
        write(
          response,
          200,
          JSON.stringify(await database.forget(buildForgetInput(body))),
          "application/json"
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/memory-forget") {
        const body = await readForm(request);
        const result = await database.forget(buildForgetInput(body));
        const targetId = optionalInput(body.target_id) ?? optionalInput(body.memory_id);
        const targetKind = optionalInput(body.target_kind) ?? "agent_memory";
        const projectId = optionalInput(body.project_id) ?? dashboardInput.project_id;
        const forgetDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId,
            selected_memory_id: targetId
          })
        );
        write(
          response,
          200,
          renderDashboard(forgetDashboard, {
            memoryForget: {
              result: result as Record<string, unknown>,
              target: { kind: targetKind, id: targetId },
              reason: optionalInput(body.reason)
            }
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/project-detach") {
        const body = (await readJson(request)) as {
          project_id?: string | null;
          mode?: "live" | "sandbox";
          reason?: string | null;
          confirmation?: { confirmed?: boolean };
        };
        const result = await database.detachProject({
          project_id: optionalInput(body.project_id),
          mode: body.mode === "live" ? "live" : "sandbox",
          reason: optionalInput(body.reason) ?? "Review UI project removal",
          dry_run: body.confirmation?.confirmed === true ? false : true,
          actor_kind: "user",
          actor_id: "review-ui",
          confirmation: { confirmed: body.confirmation?.confirmed === true }
        });
        write(response, 200, JSON.stringify(result), "application/json");
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/project-sanitize") {
        const body = (await readJson(request)) as {
          project_id?: string | null;
          project_path?: string | null;
          mode?: "detach" | "purge";
          detach_mode?: "live" | "sandbox";
          reason?: string | null;
          confirmation?: { confirmed?: boolean; confirmation_token?: string | null };
        };
        const result = await database.sanitizeProject({
          project_id: optionalInput(body.project_id),
          project_path: optionalInput(body.project_path),
          mode: body.mode === "detach" ? "detach" : "purge",
          detach_mode: body.detach_mode === "sandbox" ? "sandbox" : "live",
          reason: optionalInput(body.reason) ?? "Review UI project sanitize",
          dry_run: body.confirmation?.confirmed === true ? false : true,
          actor_kind: "user",
          actor_id: "review-ui",
          request_source: "ui",
          confirmation: {
            confirmed: body.confirmation?.confirmed === true,
            confirmation_token: optionalInput(body.confirmation?.confirmation_token)
          }
        });
        write(response, 200, JSON.stringify(result), "application/json");
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/project-detach") {
        const body = await readForm(request);
        const projectId = optionalInput(body.project_id);
        const mode = body.mode === "live" ? "live" : "sandbox";
        const confirmed = body.confirm === "true";
        const result = await database.detachProject({
          project_id: projectId,
          mode,
          reason: "Review UI project removal",
          dry_run: confirmed ? false : true,
          actor_kind: "user",
          actor_id: "review-ui",
          confirmation: { confirmed }
        });
        if (confirmed && result.status === "detached") {
          write(response, 303, "See other", "text/plain", { location: "/review" });
          return;
        }
        const detachDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId ?? dashboardInput.project_id,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          200,
          renderDashboard(detachDashboard, { detach: { result } }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/project-sanitize") {
        const body = await readForm(request);
        const projectId = optionalInput(body.project_id);
        const projectPath = optionalInput(body.project_path);
        const confirmToken = optionalInput(body.confirm_token);
        const result = await database.sanitizeProject({
          project_id: projectId,
          project_path: projectPath,
          mode: body.mode === "detach" ? "detach" : "purge",
          detach_mode: body.detach_mode === "sandbox" ? "sandbox" : "live",
          reason: "Review UI project sanitize",
          dry_run: confirmToken ? false : true,
          actor_kind: "user",
          actor_id: "review-ui",
          request_source: "ui",
          confirmation: {
            confirmed: Boolean(confirmToken),
            confirmation_token: confirmToken
          }
        });
        if (result.status === "purged") {
          write(response, 303, "See other", "text/plain", { location: "/review" });
          return;
        }
        const sanitizeDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId ?? dashboardInput.project_id,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          200,
          renderDashboard(sanitizeDashboard, { sanitize: { result } }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/project-setting") {
        const body = (await readJson(request)) as ProjectSettingInput;
        const result = await database.setProjectSetting({
          ...body,
          actor_kind: body.actor_kind ?? "user"
        });
        write(response, result.ok ? 200 : 409, JSON.stringify(result), "application/json");
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/project-setting") {
        const body = await readForm(request);
        const key = String(body.key ?? "");
        const rawValue = String(body.value ?? "");
        const projectId = optionalInput(body.project_id) ?? dashboardInput.project_id;
        const result = await database.setProjectSetting({
          project_id: projectId,
          key,
          value: parseProjectSettingFormValue(key, rawValue),
          reason: optionalInput(body.reason) ?? "Review UI setting change",
          actor_kind: "user",
          actor_id: "review-ui",
          confirmation: { confirmed: body.confirm === "true" }
        });
        const settingDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          result.ok ? 200 : 409,
          renderDashboard(settingDashboard, {
            setting: {
              result: result as Record<string, unknown>,
              key,
              rawValue,
              reason: optionalInput(body.reason)
            },
            view: "settings"
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/memory-space") {
        const body = await readForm(request);
        const name = optionalInput(body.name);
        if (!name) {
          write(response, 400, "Memory space name is required", "text/plain");
          return;
        }
        const result = await database.createMemorySpace({
          name,
          projectKind: parseProjectKindFormValue(body.project_kind),
          memoryDomain: optionalInput(body.memory_domain) ?? "agent_work",
          primaryPath: optionalInput(body.primary_path)
        });
        const location = reviewPath(result.project_id);
        write(response, 303, "See other", "text/plain", { location });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/source-attach") {
        const body = await readForm(request);
        const projectId = optionalInput(body.project_id) ?? dashboardInput.project_id;
        const label = optionalInput(body.label);
        if (!projectId || !label) {
          write(response, 400, "Project and source label are required", "text/plain");
          return;
        }
        const sourceKind = parseSourceKindFormValue(body.source_kind);
        const result = await database.attachProjectSource({
          project_id: projectId,
          source_kind: sourceKind,
          label,
          uri: optionalInput(body.uri),
          is_primary: body.primary === "true",
          status: "active",
          metadata: { created_by: "review-ui" }
        });
        const sourceDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          200,
          renderDashboard(sourceDashboard, {
            source: { action: "attach_source", result: result as Record<string, unknown> },
            view: "sources"
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/source-detach") {
        const body = await readForm(request);
        const projectId = optionalInput(body.project_id) ?? dashboardInput.project_id;
        const sourceId = optionalInput(body.source_id);
        if (!projectId || !sourceId) {
          write(response, 400, "Project and source id are required", "text/plain");
          return;
        }
        const result = await database.detachProjectSource({
          source_id: sourceId,
          reason: "Review UI source detach"
        });
        const sourceDashboard = sanitizeDashboardForClient(
          await database.getReviewDashboard({
            project_id: projectId,
            selected_memory_id: dashboardInput.selected_memory_id
          })
        );
        write(
          response,
          200,
          renderDashboard(sourceDashboard, {
            source: { action: "detach_source", result: result as Record<string, unknown> },
            view: "sources"
          }),
          "text/html",
          sessionCookie ? { "set-cookie": sessionCookie } : {}
        );
        return;
      }
      write(response, 404, "Not found", "text/plain");
    } catch (error) {
      routeError = error;
      throw error;
    } finally {
      await finishHttpAudit(audit, response, routeError);
    }
  });
}

export async function startRecallantHttpServer() {
  const { host, port } = getRecallantHttpConfig();
  const server = createRecallantHttpServer();
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`Recallant HTTP server listening on http://${host}:${port}\n`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startRecallantHttpServer();
}
