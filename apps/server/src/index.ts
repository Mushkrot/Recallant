import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { getRecallantCoreInfo } from "@recallant/core";
import {
  createRecallantDbFromEnv,
  recallantDatabasePackage,
  type ForgetInput,
  type ProjectSourceKind,
  type ProjectSettingInput,
  type ReviewAgentMemoryInput
} from "@recallant/db";
import { recallantMcpServerName } from "@recallant/mcp";
import { buildManagementChatResponse, type ManagementChatResponse } from "./management-chat.js";

type ReviewDashboardData = Awaited<
  ReturnType<NonNullable<ReturnType<typeof createRecallantDbFromEnv>>["getReviewDashboard"]>
>;

type ChatRenderState = {
  question?: string;
  response?: ManagementChatResponse;
};

type DetachRenderState = {
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

function write(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/html",
  headers: Record<string, string | string[]> = {}
) {
  response.writeHead(statusCode, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

function shortId(value: unknown) {
  return String(value ?? "").slice(0, 8);
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
    embedding_route_enabled: "Semantic search",
    enabled_clients: "Enabled clients",
    embedding_route: "Local search by meaning",
    paid_api_mode: "Paid API mode",
    project_aliases: "Project aliases",
    project_paths: "Project paths",
    review_sensitivity: "Review sensitivity"
  };
  return labels[settingKey] ?? settingKey.replaceAll("_", " ");
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
    const provider = record.provider ? String(record.provider) : "local provider";
    const model = record.model ? String(record.model) : "configured model";
    const dims = record.dims ? `, ${String(record.dims)} dims` : "";
    return `Uses ${model} through ${provider}${dims}.`;
  }
  if (key === "paid_api_mode") {
    if (value === "confirm_each") return "Paid model calls require explicit confirmation.";
    if (value === "disabled") return "Paid model calls are disabled.";
    return `Paid API policy: ${formatDisplayValue(value)}.`;
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
          ? provenance.summary
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
                ["Status", humanStatus(row.status)],
                ["Use", humanPolicy(row.use_policy)],
                ["Type", memoryKindLabel(row.memory_type)]
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
      <label>Superseded by memory id <input name="superseded_by" /></label>
      <label>Note <input name="note" value="Owner superseded memory from Review UI" /></label>
      <button type="submit">Mark superseded</button>
    </form>
    <form method="post" action="/review-action">
      <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
      <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
      <input type="hidden" name="action" value="merge" />
      <label>Merge memory ids <input name="merge_memory_ids" placeholder="id1, id2" /></label>
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
        : "This is not ordinary cleanup. The receipt below contains only safe ids, counts, and status."
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
  return `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(sourcePath(row))}</strong>
    <p>${escapeHtml(currentEffect(row))}</p>
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
    source_refs?: Array<Record<string, unknown>>;
    review_actions?: Array<Record<string, unknown>>;
  };
  const memory = payload.memory;
  if (!memory) return `<p class="empty">No selected memory.</p>`;
  const actions = Array.isArray(availableActions) ? availableActions.map(String) : [];
  return `<article class="detail">
    <h3>${escapeHtml(sourcePath(memory))}</h3>
    ${renderBadges([
      ["Status", humanStatus(memory.status)],
      ["Use", humanPolicy(memory.use_policy)],
      ["Type", memoryKindLabel(memory.memory_type)]
    ])}
    <h4>What this is</h4>
    <p>${escapeHtml(currentEffect(memory))}</p>
    <h4>Why it needs review</h4>
    <p>${escapeHtml(riskSummary(memory))}</p>
    <h4>Recommended action</h4>
    <p>${escapeHtml(recommendedAction(memory))}</p>
    <h4>Actions</h4>
    <div class="actions">${renderReviewActions(memory, projectId, payload.source_refs?.length ?? 0)}${renderMemoryForgetAction(memory, projectId, memoryForget)}</div>
    ${renderDuplicateResolution(memory, projectId, duplicateRows)}
    ${renderConflictResolution(memory, projectId, duplicateRows)}
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
      <summary>Available action keys</summary>
      <div class="actions disabled">${actions.map((action) => `<span>${escapeHtml(action)}</span>`).join("")}</div>
    </details>
  </article>`;
}

function projectDisplayName(row: Record<string, unknown>) {
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
    return `${sourceKindLabel(primarySource.source_kind)}: ${String(primarySource.label ?? primarySource.uri ?? "Unnamed source")}`;
  }
  const path = row.primary_path;
  if (path) return `Workspace folder: ${String(path)}`;
  if (row.project_kind === "personal_domain") return "Virtual personal memory space";
  return "No attached source is recorded yet";
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

function attachedSourceSummary(row: Record<string, unknown>) {
  const sources = Array.isArray(row.sources) ? (row.sources as Array<Record<string, unknown>>) : [];
  if (sources.length === 0) return "No attached sources yet";
  const active = sources.filter((source) => source.status === "active");
  const detached = sources.filter((source) => source.status === "detached");
  const parts = [`${active.length} active source${active.length === 1 ? "" : "s"}`];
  if (detached.length > 0) parts.push(`${detached.length} detached`);
  return parts.join(", ");
}

function sharingPolicy(row: Record<string, unknown>) {
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
        ? "The memory space remains available; only this source binding was detached."
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
      <label>Optional folder or path<input name="primary_path" placeholder="/ai/example or leave empty" /></label>
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
      <label>Location or reference<input name="uri" placeholder="/ai/project, github:owner/repo, gdrive:folder-id" /></label>
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
        return `<article class="source-card">
          <div>
            <strong>${escapeHtml(source.display_label ?? source.label ?? sourceKindLabel(source.source_kind))}</strong>
            <span class="source-health ${escapeHtml(health.status)}">${escapeHtml(health.label)}</span>
            <p>${escapeHtml(source.uri ?? "No location recorded")}</p>
            <p>${escapeHtml(health.reason)}</p>
            <p class="source-action">${escapeHtml(health.action)}</p>
          </div>
          ${
            source.status === "active"
              ? `<form method="post" action="/source-detach">
                  <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
                  <input type="hidden" name="source_id" value="${escapeHtml(source.source_id ?? source.id)}" />
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
              ["source_health", source.source_health],
              ["is_primary", source.is_primary],
              ["metadata", source.metadata]
            ])}
          </details>
        </article>`;
      })
      .join("")}
  </div>`;
}

function renderMemorySpaces(data: ReviewDashboardData) {
  const spaceList =
    data.projects.length === 0
      ? `<p class="empty">No memory spaces yet.</p>`
      : `<div class="memory-spaces">
        ${data.projects
          .map((row) => {
            const active = row.project_id === data.current_project_id;
            const state = captureState(row);
            return `<article class="memory-space ${active ? "active" : ""}">
              <div class="memory-space-head">
                <h3><a href="${escapeHtml(reviewPath(row.project_id))}">${escapeHtml(projectDisplayName(row))}</a></h3>
                <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
              </div>
              <p>${escapeHtml(sourceLabel(row))}</p>
              <p>${escapeHtml(attachedSourceSummary(row))}</p>
              <p>${escapeHtml(sharingPolicy(row))}</p>
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
                  ["primary_path", row.primary_path],
                  ["sources", row.sources]
                ])}
              </details>
            </article>`;
          })
          .join("")}
      </div>`;
  return `<div class="memory-spaces">
    ${spaceList}
  </div>`;
}

function renderCurrentMemoryProfile(data: ReviewDashboardData) {
  const project = currentProject(data);
  const state = captureState(project);
  const sources = currentProjectSources(data);
  const activeSources = sources.filter((source) => source.status === "active");
  const title = projectDisplayName(project) || data.current_project_id;
  return `<aside class="memory-profile" aria-label="Current memory space profile">
    <span class="section-kicker">Current memory space</span>
    <h3>${escapeHtml(title)}</h3>
    <span class="state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
    <p>${escapeHtml(sourceLabel(project))}</p>
    <p>${escapeHtml(sharingPolicy(project))}</p>
    <div class="memory-profile-metrics">
      <span><strong>${escapeHtml(activeSources.length)}</strong> active sources</span>
      <span><strong>${escapeHtml(project.memory_count ?? 0)}</strong> memories</span>
      <span><strong>${escapeHtml(project.event_count ?? 0)}</strong> events</span>
    </div>
  </aside>`;
}

function renderSourceWorkbench(data: ReviewDashboardData, source?: SourceRenderState) {
  return `<section class="panel source-workbench" id="sources">
    <div class="section-head">
      <div>
        <span class="section-kicker">Memory space sources</span>
        <h2>Sources</h2>
      </div>
      <p>Attach folders, repositories, documents, connectors, or virtual/manual sources without merging unrelated memory.</p>
    </div>
    ${renderSourceResult(source)}
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
          <span>${escapeHtml(row.source)}</span>
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
    <h3>Current day</h3>
    <div class="summary-grid">
      <span><strong>${escapeHtml(summary.current_day_calls ?? 0)}</strong> calls</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_day_actual_usd))}</strong> actual</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_day_estimated_usd))}</strong> estimated</span>
      <span><strong>${escapeHtml(pendingApprovals.length)}</strong> pending approvals</span>
    </div>
    <h3>Current month</h3>
    <div class="summary-grid">
      <span><strong>${escapeHtml(summary.current_month_calls ?? callCount)}</strong> calls</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_month_actual_usd ?? actualUsd))}</strong> actual</span>
      <span><strong>${escapeHtml(formatUsd(summary.current_month_estimated_usd ?? estimatedUsd))}</strong> estimated</span>
      <span><strong>${escapeHtml(formatUsd(summary.pending_approval_estimated_usd))}</strong> pending estimate</span>
    </div>
    <details>
      <summary>Cost by project/provider/model/purpose</summary>
      ${renderRows(rows, "No model cost records in the last 30 days.")}
    </details>
    <details>
      <summary>Pending paid API approvals</summary>
      ${renderRows(pendingApprovals, "No paid API approvals are pending.")}
    </details>
  </div>`;
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
      const label = source.display_label ?? source.label ?? sourceKindLabel(source.source_kind);
      return link(String(label), { source_id: sourceId });
    })
  ].join(" ");
  const selectedSource = asRecord(sourceFilters.selected_source);
  const selectedSourceNote =
    current.source_id !== "all" && Object.keys(selectedSource).length > 0
      ? `<p class="filter-note">Showing source-linked memories from ${escapeHtml(
          selectedSource.display_label ?? selectedSource.label ?? current.source_id
        )}. Conflicts are still shown globally so high-risk issues are not hidden.</p>`
      : "";
  return `<div class="rule-filters" aria-label="Active rule filters">
    <h3>Rule filters</h3>
    <div><strong>Scope filter</strong> ${link("All", { scope: "all" })} ${link("Project", { scope: "project" })} ${link("Developer", { scope: "developer" })}</div>
    <div><strong>Type filter</strong> ${link("All", { rule_type: "all" })} ${link("Procedure", { rule_type: "procedure" })} ${link("Constraint", { rule_type: "constraint" })} ${link("Decision", { rule_type: "decision" })}</div>
    <div><strong>Source filter</strong> ${sourceLinks}</div>
    ${selectedSourceNote}
    <div><strong>Project filter</strong> <span>${escapeHtml(shortId(projectId))}</span></div>
    <div><strong>Domain filter</strong> <span>${escapeHtml(current.rule_domain)}</span></div>
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
    paidApprovals > 0
      ? `${paidApprovals} paid API approval${paidApprovals === 1 ? "" : "s"} are pending.`
      : ""
  ].filter(Boolean);
  return `<ul class="attention-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReadiness(data: ReviewDashboardData) {
  const readiness = asRecord(data.project_readiness);
  const registered = Boolean(readiness.project_registered);
  const checkpointUpdatedAt = readiness.checkpoint_updated_at;
  const lastContextReadAt = readiness.last_context_read_at;
  const lastMemoryWriteAt = readiness.last_memory_write_at;
  const activeSessions = Number(readiness.active_sessions ?? 0);
  const interruptedSessions = Number(readiness.interrupted_sessions ?? 0);
  const captureEvents = Number(readiness.capture_event_count ?? 0);
  const capturedDecisions = Number(readiness.captured_decision_count ?? 0);
  const reviewMemories = Number(readiness.review_memory_count ?? 0);
  const captureActive =
    registered &&
    interruptedSessions === 0 &&
    lastContextReadAt !== null &&
    lastContextReadAt !== undefined &&
    lastMemoryWriteAt !== null &&
    lastMemoryWriteAt !== undefined &&
    checkpointUpdatedAt !== null &&
    checkpointUpdatedAt !== undefined;
  const statusText = !registered
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
    <strong>${escapeHtml(statusText)}</strong>
    <p>${escapeHtml(note)}</p>
    <div class="summary-grid">
      <span><strong>${escapeHtml(readinessDate(lastContextReadAt))}</strong> last context read</span>
      <span><strong>${escapeHtml(readinessDate(lastMemoryWriteAt))}</strong> last memory write</span>
      <span><strong>${escapeHtml(readinessDate(checkpointUpdatedAt))}</strong> last checkpoint</span>
      <span><strong>${escapeHtml(captureEvents)}</strong> capture events</span>
      <span><strong>${escapeHtml(capturedDecisions)}</strong> captured decisions</span>
      <span><strong>${escapeHtml(reviewMemories)}</strong> needs review</span>
    </div>
    <p class="readiness-note">Last session: ${escapeHtml(formatDate(readiness.last_session_at))}</p>
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

function renderActivityReplay(data: ReviewDashboardData) {
  const rows = Array.isArray(data.recent_activity)
    ? (data.recent_activity as Array<Record<string, unknown>>)
    : [];
  if (rows.length === 0) {
    return `<p class="empty">No recent Recallant activity has been captured for this memory space yet.</p>`;
  }
  return `<div class="activity-list">
    ${rows
      .map(
        (row) => `<article class="activity-item">
          <span>${escapeHtml(activityIcon(row.activity_kind))}</span>
          <div>
            <strong>${escapeHtml(row.title)}</strong>
            <p>${escapeHtml(row.body)}</p>
            <time>${escapeHtml(formatDate(row.occurred_at))}</time>
          </div>
        </article>`
      )
      .join("")}
  </div>`;
}

function renderProjectActions(data: ReviewDashboardData) {
  const cleanup = asRecord(data.project_cleanup);
  return `<div class="action-plan">
    <p>Project memory stays isolated by default. Agents can ask for cross-project examples, but unrelated memories are not mixed into this project automatically.</p>
    <details>
      <summary>Detach / cleanup commands</summary>
      ${renderMeta([
        ["detach dry-run", cleanup.detach_command],
        ["sandbox cleanup dry-run", cleanup.sandbox_cleanup_command],
        ["local cleanup dry-run", cleanup.local_cleanup_command],
        ["permanent erasure", cleanup.permanent_erasure_separate ? "Separate forget workflow" : ""]
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

function renderCleanup(data: ReviewDashboardData, detach?: DetachRenderState) {
  const project = currentProject(data);
  const projectName =
    project.title ?? project.name ?? project.provider ?? project.key ?? data.current_project_id;
  const projectPath = project.primary_path ?? "No path recorded";
  return `<div class="cleanup-flow">
    <article class="selected-project-card">
      <strong>${escapeHtml(projectName)}</strong>
      <span>${escapeHtml(projectPath)}</span>
      <span>ID ${escapeHtml(data.current_project_id)}</span>
    </article>
    <p>This removes the selected project from active Recallant views and search. Project files on disk are not changed. Permanent erasure uses a separate forget-forever workflow.</p>
    ${renderProjectDetachResult(data, detach)}
    <form method="post" action="/project-detach">
      <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
      <input type="hidden" name="mode" value="sandbox" />
      <button type="submit">Dry-run remove selected project</button>
    </form>
  </div>`;
}

function renderManagementChat(data: ReviewDashboardData, chat?: ChatRenderState) {
  const selectedMemory = asRecord(asRecord(data.selected_detail).memory);
  const selectedMemoryId = selectedMemory.id;
  return `<form class="chat-form" method="post" action="/management-chat#ask-recallant">
    <input type="hidden" name="project_id" value="${escapeHtml(data.current_project_id)}" />
    ${
      selectedMemoryId
        ? `<input type="hidden" name="memory_id" value="${escapeHtml(selectedMemoryId)}" />`
        : ""
    }
    <textarea name="message" rows="4" placeholder="Ask what to review next, explain settings, or propose cleanup.">${escapeHtml(chat?.question ?? "")}</textarea>
    <button type="submit">Ask</button>
  </form>
  ${
    chat?.response
      ? `<article class="chat-answer">
          <h3>${chat.response.language === "ru" ? "Ответ Recallant" : "Recallant Answer"}</h3>
          <p class="chat-understanding">${escapeHtml(
            chat.response.language === "ru"
              ? chat.response.understanding.source === "local_ai"
                ? `Понято локальной AI-моделью${chat.response.understanding.model ? `: ${chat.response.understanding.model}` : ""}.`
                : "Понято безопасными локальными правилами; AI-модель недоступна."
              : chat.response.understanding.source === "local_ai"
                ? `Understood by local AI${chat.response.understanding.model ? `: ${chat.response.understanding.model}` : ""}.`
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
      : `<p class="empty">Ask in normal language. Recallant will answer read-only questions directly and turn risky requests into a dry-run/confirmation plan.</p>`
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
        (action) => `<article>
          <strong>${escapeHtml(action.label)}</strong>
          <span>${escapeHtml(actionKindLabel(action.kind, language))}</span>
          <p>${escapeHtml(action.reason)}</p>
          ${action.command ? `<code>${escapeHtml(action.command)}</code>` : ""}
        </article>`
      )
      .join("")}
  </div>`;
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

function renderDashboard(
  data: ReviewDashboardData,
  state?: {
    chat?: ChatRenderState;
    detach?: DetachRenderState;
    memoryForget?: MemoryForgetRenderState;
    setting?: SettingRenderState;
    source?: SourceRenderState;
  }
) {
  const chat = state?.chat;
  const detach = state?.detach;
  const memoryForget = state?.memoryForget;
  const setting = state?.setting;
  const source = state?.source;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Recallant Workbench</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f3f5f4; color: #20242c; }
    body { margin: 0; background: #f3f5f4; }
    header { padding: 22px 32px; border-bottom: 1px solid #d7dedb; background: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: minmax(300px, 340px) minmax(0, 1fr); gap: 20px; padding: 20px; align-items: start; max-width: 1720px; margin: 0 auto; }
    section, aside { min-width: 0; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    h3 { letter-spacing: 0; }
    a { color: inherit; text-decoration: none; }
    .panel { background: #fff; border: 1px solid #d7dedb; border-radius: 8px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(32, 36, 44, 0.04); }
    .workbench-nav { display: flex; gap: 8px; flex-wrap: wrap; }
    .workbench-nav a { border: 1px solid #d2dae6; border-radius: 999px; padding: 6px 9px; font-size: 12px; background: #f8fafc; }
    .command-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 0.95fr); gap: 14px; align-items: start; }
    .workbench-main { display: grid; gap: 16px; }
    .primary-workspace { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
    .command-card h3 { margin: 0 0 8px; font-size: 14px; }
    .row-link, .project-link { display: block; border-radius: 6px; }
    .row-link:hover .item, .project-link:hover .project { background: #f8fafc; }
    .item { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .item:first-child { border-top: 0; }
    .item h3 { font-size: 14px; margin: 0 0 5px; }
    .item p { margin: 0 0 8px; color: #565d6b; font-size: 13px; overflow-wrap: anywhere; }
    .item .why { color: #7a4d18; }
    .item .source-note { color: #166454; font-size: 12px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 8px; }
    .badges span { display: inline-flex; gap: 5px; align-items: baseline; border: 1px solid #d6dde7; background: #f8fafc; border-radius: 999px; padding: 4px 7px; font-size: 11px; color: #445064; }
    .badges strong { color: #6a7280; font-weight: 600; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 0; font-size: 12px; }
    dt { color: #6a7280; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill { border: 1px solid #c9d2df; border-radius: 999px; padding: 5px 8px; font-size: 12px; background: #f7fafb; }
    .left-rail { align-self: start; position: sticky; top: 12px; }
    .secondary-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .secondary-workspace .panel { margin-bottom: 0; }
    .section-head { display: flex; justify-content: space-between; gap: 18px; align-items: start; margin-bottom: 12px; }
    .section-head h2 { margin-bottom: 0; }
    .section-head p { max-width: 520px; margin: 0; color: #4f5867; font-size: 13px; line-height: 1.4; }
    .section-kicker { display: block; color: #166454; font-size: 11px; font-weight: 750; letter-spacing: 0; margin-bottom: 4px; text-transform: uppercase; }
    .attention-list { margin: 0; padding-left: 18px; color: #303845; font-size: 13px; line-height: 1.45; }
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
    .memory-spaces { display: grid; gap: 9px; }
    .memory-space-link { display: block; }
    .memory-space { border: 1px solid #e1e7ef; border-radius: 8px; padding: 10px; background: #fbfcfe; }
    .memory-space.active { background: #f4f8fb; border-color: #cdd9e7; }
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
    .source-workbench { border-color: #cdded9; }
    .source-workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 16px; align-items: start; }
    .source-management { display: grid; gap: 10px; }
    .source-list { display: grid; gap: 8px; }
    .source-card, .source-result { border: 1px solid #e1e7ef; border-radius: 7px; padding: 9px; background: #fbfcfe; }
    .source-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
    .source-card strong, .source-result strong { display: block; font-size: 13px; margin-bottom: 4px; overflow-wrap: anywhere; }
    .source-card span { display: inline-block; font-size: 12px; margin-bottom: 3px; }
    .source-health { border: 1px solid #cfd8e5; border-radius: 999px; padding: 2px 7px; background: #f8fafc; color: #445064; }
    .source-health.ready { border-color: #bad8cf; background: #eef8f5; color: #166454; }
    .source-health.needs-setup, .source-health.needs-attention { border-color: #e3d3a5; background: #fff9e8; color: #715118; }
    .source-health.detached { border-color: #d6dde7; background: #f8fafc; color: #6a7280; }
    .source-card p, .source-result p { margin: 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .source-card .source-action { color: #6a7280; }
    .detail h3 { font-size: 15px; margin: 0 0 7px; }
    .detail h4 { font-size: 12px; margin: 12px 0 6px; color: #4f5867; text-transform: uppercase; letter-spacing: .04em; }
    .detail p { margin: 0 0 10px; color: #303845; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
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
    button { border: 1px solid #aeb9c8; border-radius: 6px; background: #fff; padding: 6px 9px; font: inherit; font-size: 12px; cursor: pointer; }
    button:hover { background: #f2f6fb; }
    button.danger { border-color: #b77f62; color: #8a3c15; }
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
    .rule-filters { display: grid; gap: 7px; margin-bottom: 12px; color: #4f5867; font-size: 12px; }
    .rule-filters h3 { margin: 0; font-size: 13px; color: #303845; }
    .rule-filters div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .rule-filters .filter-note { margin: 0; color: #166454; font-size: 12px; line-height: 1.35; }
    .filter-chip { display: inline-flex; border: 1px solid #cfd8e5; border-radius: 999px; padding: 2px 7px; color: #303845; background: #f8fafc; text-decoration: none; }
    .filter-chip:hover { background: #eef4fb; }
    .cost-summary h3 { margin: 10px 0 6px; font-size: 13px; color: #303845; }
    pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f8fb; border: 1px solid #e1e7ef; border-radius: 6px; padding: 8px; font-size: 12px; line-height: 1.35; }
    .chat { min-height: 92px; border: 1px dashed #b8c2d0; border-radius: 8px; padding: 10px; color: #565d6b; font-size: 13px; }
    .ask-panel { border-color: #bdd7cf; background: #feffff; }
    .ask-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 18px; align-items: start; }
    .ask-work h2 { font-size: 18px; margin-bottom: 12px; }
    .memory-profile { border-left: 1px solid #d9e4df; padding-left: 16px; color: #303845; }
    .memory-profile h3 { margin: 0 0 7px; font-size: 15px; overflow-wrap: anywhere; }
    .memory-profile .state { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 11px; margin-bottom: 8px; }
    .memory-profile p { margin: 7px 0; color: #4f5867; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .memory-profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
    .memory-profile-metrics span { border: 1px solid #dce3ec; border-radius: 6px; padding: 7px; background: #f8fafc; color: #4f5867; font-size: 11px; }
    .memory-profile-metrics strong { display: block; color: #20242c; font-size: 13px; }
    .chat-form { display: grid; gap: 8px; }
    .chat-form textarea { resize: vertical; min-height: 144px; border: 1px solid #bfcbd6; border-radius: 7px; padding: 11px; font: inherit; font-size: 14px; color: #20242c; background: #fff; }
    .chat-form button { justify-self: start; }
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
    .chat-understanding { margin: 0 0 8px; color: #667085; font-size: 12px; }
    .chat-result { display: inline-flex; margin-left: 6px; border: 1px solid #d6dde7; border-radius: 999px; padding: 2px 7px; color: #303845; background: #f8fafc; }
    .activity-list { display: grid; gap: 9px; }
    .activity-item { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 10px; border-top: 1px solid #e5e9f0; padding-top: 9px; }
    .activity-item:first-child { border-top: 0; padding-top: 0; }
    .activity-item > span { justify-self: start; border: 1px solid #d6dde7; border-radius: 999px; padding: 3px 7px; color: #445064; background: #f8fafc; font-size: 11px; }
    .activity-item strong { display: block; font-size: 13px; margin-bottom: 3px; }
    .activity-item p { margin: 0 0 3px; color: #4f5867; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .activity-item time { color: #6f7785; font-size: 12px; }
    .empty { color: #6f7785; font-size: 13px; }
    @media (max-width: 1180px) { main { grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); } .ask-layout, .source-workspace-grid, .secondary-workspace { grid-template-columns: 1fr; } .memory-profile { border-left: 0; border-top: 1px solid #d9e4df; padding-left: 0; padding-top: 14px; } }
    @media (max-width: 760px) { header { align-items: flex-start; flex-direction: column; padding: 16px; } main { grid-template-columns: 1fr; padding: 12px; } .workbench-main { order: 1; } .left-rail { order: 2; position: static; } .secondary-workspace { display: block; } .secondary-workspace .panel { margin-bottom: 14px; } .command-grid { grid-template-columns: 1fr; } .activity-item { grid-template-columns: 1fr; } .primary-workspace { grid-template-columns: 1fr; } .source-card { grid-template-columns: 1fr; } .section-head { display: block; } .memory-profile-metrics { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Recallant Workbench</h1>
      <nav class="workbench-nav" aria-label="Workbench sections">
        <a href="#memory-spaces">Memory Spaces</a>
        <a href="#ask-recallant">Ask Recallant</a>
        <a href="#command-center">Command Center</a>
        <a href="#sources">Sources</a>
        <a href="#activity-replay">Activity / Replay</a>
        <a href="#review">Review</a>
        <a href="#settings">Settings</a>
      </nav>
    </div>
    <div class="status">
      <span class="pill">Project ${escapeHtml(shortId(data.current_project_id))}</span>
      <span class="pill">Private UI</span>
    </div>
  </header>
  <main>
    <aside class="left-rail">
      <section class="panel" id="memory-spaces">
        <h2>Memory Spaces</h2>
        ${renderMemorySpaces(data)}
      </section>
      <section class="panel">
        <h2>Current Signals</h2>
        <div class="status">
          <span class="pill">Active ${escapeHtml(data.critical?.active_sessions ?? 0)}</span>
          <span class="pill">Interrupted ${escapeHtml(data.critical?.interrupted_sessions ?? 0)}</span>
          <span class="pill">Review ${escapeHtml(data.critical?.pending_review ?? 0)}</span>
          <span class="pill">Conflicts ${escapeHtml(data.critical?.high_risk_conflicts ?? 0)}</span>
          <span class="pill">Paid API ${escapeHtml(data.critical?.pending_paid_approvals ?? 0)}</span>
        </div>
      </section>
      <section class="panel">
        <h2>Project Actions</h2>
        ${renderProjectActions(data)}
      </section>
    </aside>
    <section class="workbench-main">
      <div class="primary-workspace">
        <section class="panel ask-panel" id="ask-recallant">
          <div class="ask-layout">
            <div class="ask-work">
              <span class="section-kicker">AI control surface</span>
              <h2>Ask Recallant</h2>
              ${renderManagementChat(data, chat)}
            </div>
            ${renderCurrentMemoryProfile(data)}
          </div>
        </section>
        <section class="panel" id="command-center">
          <h2>Command Center</h2>
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
        </section>
      </div>
      ${renderSourceWorkbench(data, source)}
      <section class="panel" id="activity-replay">
        <h2>Activity / Replay</h2>
        ${renderActivityReplay(data)}
      </section>
      <section class="panel" id="review">
        <h2>Review</h2>
        <h3>Import Candidates</h3>
        ${renderRows(data.import_candidates, "No imported candidates require review.", data.current_project_id)}
        <h3>Review Inbox</h3>
        ${renderRows(data.inbox, "No candidate or high-risk memories require review.", data.current_project_id)}
        <h3>Conflicts / Duplicates</h3>
        ${renderRows(data.duplicate_conflicts, "No conflicts or duplicates detected.", data.current_project_id)}
        <h3>Active Rules</h3>
        ${renderRuleFilters(data)}
        ${renderRows(data.rules, "No instruction-grade rules match the current filters.", data.current_project_id)}
      </section>
      <section class="secondary-workspace" aria-label="Secondary workbench panels">
      <section class="panel">
        <h2>Selected Detail</h2>
        ${renderDetail(data.selected_detail, data.available_review_actions, data.current_project_id, memoryForget, data.duplicate_conflicts)}
      </section>
      <section class="panel">
        <h2>Cost / Paid API</h2>
        ${renderCosts(data)}
      </section>
      <section class="panel">
        <h2>Cleanup / Forget</h2>
        ${renderCleanup(data, detach)}
      </section>
      <section class="panel" id="settings">
        <h2>Settings</h2>
        ${renderSettings(data, setting)}
      </section>
      </section>
    </section>
  </main>
</body>
</html>`;
}

export function createRecallantHttpServer() {
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
    const auth = authorize(request);
    if (!auth.ok) {
      write(response, 401, "Unauthorized", "text/plain");
      return;
    }
    const sessionCookie =
      auth.mode === "cloudflare" && auth.email ? createSessionCookie(auth.email) : "";
    const database = createRecallantDbFromEnv();
    if (!database) {
      write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
      return;
    }
    const dashboardInput = {
      project_id: requestUrl.searchParams.get("project_id"),
      selected_memory_id: requestUrl.searchParams.get("memory_id"),
      source_id: requestUrl.searchParams.get("source_id"),
      rule_scope: requestUrl.searchParams.get("scope"),
      rule_scope_kind: requestUrl.searchParams.get("scope_kind"),
      rule_memory_type: requestUrl.searchParams.get("rule_type"),
      rule_memory_domain: requestUrl.searchParams.get("rule_domain")
    };
    if (requestUrl.pathname === "/" || requestUrl.pathname === "/review") {
      write(
        response,
        200,
        renderDashboard(
          sanitizeDashboardForClient(await database.getReviewDashboard(dashboardInput))
        ),
        "text/html",
        sessionCookie ? { "set-cookie": sessionCookie } : {}
      );
      return;
    }
    if (requestUrl.pathname === "/api/review-dashboard") {
      write(
        response,
        200,
        JSON.stringify(
          sanitizeDashboardForClient(await database.getReviewDashboard(dashboardInput))
        ),
        "application/json"
      );
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/management-chat") {
      const body = (await readJson(request)) as {
        project_id?: string | null;
        selected_memory_id?: string | null;
        memory_id?: string | null;
        message?: string;
      };
      const chatDashboard = sanitizeDashboardForClient(
        await database.getReviewDashboard({
          project_id: optionalInput(body.project_id) ?? dashboardInput.project_id,
          selected_memory_id:
            optionalInput(body.selected_memory_id) ??
            optionalInput(body.memory_id) ??
            dashboardInput.selected_memory_id
        })
      );
      const result = await buildManagementChatResponse({
        message: String(body.message ?? ""),
        dashboard: chatDashboard,
        database
      });
      write(response, 200, JSON.stringify(result), "application/json");
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/management-chat") {
      const body = await readForm(request);
      const chatDashboard = sanitizeDashboardForClient(
        await database.getReviewDashboard({
          project_id: optionalInput(body.project_id) ?? dashboardInput.project_id,
          selected_memory_id: optionalInput(body.memory_id) ?? dashboardInput.selected_memory_id
        })
      );
      const question = String(body.message ?? "");
      const result = await buildManagementChatResponse({
        message: question,
        dashboard: chatDashboard,
        database
      });
      write(
        response,
        200,
        renderDashboard(chatDashboard, { chat: { question, response: result } }),
        "text/html",
        sessionCookie ? { "set-cookie": sessionCookie } : {}
      );
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/review-action") {
      const body = (await readJson(request)) as ReviewAgentMemoryInput;
      const result = await database.reviewAgentMemory({
        ...body,
        actor_kind: body.actor_kind ?? "user"
      });
      write(response, result.ok === false ? 409 : 200, JSON.stringify(result), "application/json");
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/review-action") {
      const body = await readForm(request);
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
          }
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
          source: { action: "attach_source", result: result as Record<string, unknown> }
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
          source: { action: "detach_source", result: result as Record<string, unknown> }
        }),
        "text/html",
        sessionCookie ? { "set-cookie": sessionCookie } : {}
      );
      return;
    }
    write(response, 404, "Not found", "text/plain");
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
