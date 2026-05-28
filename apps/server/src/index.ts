import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { getRecallantCoreInfo } from "@recallant/core";
import {
  createRecallantDbFromEnv,
  recallantDatabasePackage,
  type ProjectSettingInput,
  type ReviewAgentMemoryInput
} from "@recallant/db";
import { recallantMcpServerName } from "@recallant/mcp";

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

function reviewPath(projectId: unknown, memoryId?: unknown) {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", String(projectId));
  if (memoryId) params.set("memory_id", String(memoryId));
  const query = params.toString();
  return `/review${query ? `?${query}` : ""}`;
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

function renderReviewActions(memory: Record<string, unknown>, projectId: unknown) {
  const safeActions = [
    ["accept", "Keep as usable memory"],
    ["reject", "Reject"],
    ["archive", "Archive"],
    ["mark_stale", "Mark stale"]
  ];
  return safeActions
    .map(
      ([action, label]) => `<form method="post" action="/review-action">
        <input type="hidden" name="project_id" value="${escapeHtml(projectId)}" />
        <input type="hidden" name="memory_id" value="${escapeHtml(memory.id)}" />
        <input type="hidden" name="action" value="${escapeHtml(action)}" />
        <button type="submit">${escapeHtml(label)}</button>
      </form>`
    )
    .join("");
}

function renderDetail(detail: unknown, availableActions: unknown, projectId: unknown) {
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
    <div class="actions">${renderReviewActions(memory, projectId)}</div>
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
      <summary>Advanced actions</summary>
      <div class="actions disabled">${actions
        .filter((action) => !["accept", "reject", "archive", "mark_stale"].includes(action))
        .map((action) => `<span>${escapeHtml(action)}</span>`)
        .join("")}</div>
    </details>
  </article>`;
}

function renderProjectRow(row: Record<string, unknown>, currentProjectId: unknown) {
  const active = row.project_id === currentProjectId;
  return `<a class="project-link" href="${escapeHtml(reviewPath(row.project_id))}">
    <article class="project ${active ? "active" : ""}">
      <div>
        <h3>${escapeHtml(row.title ?? row.name ?? row.provider ?? row.key ?? row.source_kind ?? row.action ?? row.project_id ?? row.id)}</h3>
        <p>${escapeHtml(row.primary_path ?? "No path recorded")}</p>
      </div>
      <div class="project-meta">
        <span>ID ${escapeHtml(shortId(row.project_id))}</span>
        <span>${escapeHtml(row.memory_domain ?? "agent_work")}</span>
        <span>${escapeHtml(formatDate(row.updated_at))}</span>
      </div>
      <div class="metrics">
        <span>${escapeHtml(row.session_count ?? 0)} sessions</span>
        <span>${escapeHtml(row.memory_count ?? 0)} memories</span>
        <span>${escapeHtml(row.event_count ?? 0)} events</span>
      </div>
    </article>
  </a>`;
}

function renderProjects(rows: Array<Record<string, unknown>>, currentProjectId: unknown) {
  if (rows.length === 0) return `<p class="empty">No managed projects yet.</p>`;
  return rows.map((row) => renderProjectRow(row, currentProjectId)).join("");
}

function renderSettings(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return `<p class="empty">No project settings configured.</p>`;
  return rows
    .map((row) => {
      const value = formatDisplayValue(row.value);
      const structured = value.includes("\n") || value.length > 48;
      return `<article class="setting">
        <div class="setting-head">
          <h3>${escapeHtml(row.key)}</h3>
          <span>${escapeHtml(row.source)}</span>
        </div>
        ${
          structured
            ? `<pre>${escapeHtml(value)}</pre>`
            : `<p class="setting-value">${escapeHtml(value || "Not set")}</p>`
        }
      </article>`;
    })
    .join("");
}

function renderDashboard(
  data: Awaited<
    ReturnType<NonNullable<ReturnType<typeof createRecallantDbFromEnv>>["getReviewDashboard"]>
  >
) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Recallant Review Command Center</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f6f7f9; color: #20242c; }
    body { margin: 0; }
    header { padding: 20px 28px; border-bottom: 1px solid #d9dee7; background: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(280px, 380px); gap: 18px; padding: 18px; }
    section, aside { min-width: 0; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    a { color: inherit; text-decoration: none; }
    .panel { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .row-link, .project-link { display: block; border-radius: 6px; }
    .row-link:hover .item, .project-link:hover .project { background: #f8fafc; }
    .item { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .item:first-child { border-top: 0; }
    .item h3 { font-size: 14px; margin: 0 0 5px; }
    .item p { margin: 0 0 8px; color: #565d6b; font-size: 13px; overflow-wrap: anywhere; }
    .item .why { color: #7a4d18; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 8px; }
    .badges span { display: inline-flex; gap: 5px; align-items: baseline; border: 1px solid #d6dde7; background: #f8fafc; border-radius: 999px; padding: 4px 7px; font-size: 11px; color: #445064; }
    .badges strong { color: #6a7280; font-weight: 600; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 0; font-size: 12px; }
    dt { color: #6a7280; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill { border: 1px solid #c9d2df; border-radius: 999px; padding: 5px 8px; font-size: 12px; background: #f7fafb; }
    .project { border-top: 1px solid #e5e9f0; padding: 11px 0; }
    .project:first-child { border-top: 0; }
    .project.active h3::after { content: " active"; color: #246b5a; font-size: 11px; font-weight: 600; }
    .project h3, .setting h3 { font-size: 14px; margin: 0 0 4px; }
    .project p { margin: 0; color: #4f5867; font-size: 13px; overflow-wrap: anywhere; }
    .project-meta, .metrics { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .project-meta span, .metrics span { background: #f2f5f8; border: 1px solid #dce3ec; border-radius: 999px; padding: 3px 7px; color: #4f5867; font-size: 11px; }
    .detail h3 { font-size: 15px; margin: 0 0 7px; }
    .detail h4 { font-size: 12px; margin: 12px 0 6px; color: #4f5867; text-transform: uppercase; letter-spacing: .04em; }
    .detail p { margin: 0 0 10px; color: #303845; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    details { border-top: 1px solid #e5e9f0; padding-top: 9px; margin-top: 10px; }
    summary { cursor: pointer; color: #303845; font-weight: 650; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .actions span { border: 1px solid #c9d2df; border-radius: 6px; padding: 4px 7px; font-size: 12px; background: #f7fafb; }
    .actions form { margin: 0; }
    button { border: 1px solid #aeb9c8; border-radius: 6px; background: #fff; padding: 5px 8px; font: inherit; font-size: 12px; cursor: pointer; }
    button:hover { background: #f2f6fb; }
    .actions.disabled span { color: #788292; background: #f9fafb; }
    .setting { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .setting:first-child { border-top: 0; }
    .setting-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .setting-head span { color: #6a7280; font-size: 12px; }
    .setting-value { margin: 0; color: #303845; font-size: 13px; overflow-wrap: anywhere; }
    pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f8fb; border: 1px solid #e1e7ef; border-radius: 6px; padding: 8px; font-size: 12px; line-height: 1.35; }
    .chat { min-height: 92px; border: 1px dashed #b8c2d0; border-radius: 8px; padding: 10px; color: #565d6b; font-size: 13px; }
    .empty { color: #6f7785; font-size: 13px; }
    @media (max-width: 980px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Recallant Review Command Center</h1>
    <div class="status">
      <span class="pill">Project ${escapeHtml(shortId(data.current_project_id))}</span>
      <span class="pill">Private UI</span>
    </div>
  </header>
  <main>
    <aside>
      <section class="panel">
        <h2>Projects</h2>
        ${renderProjects(data.projects, data.current_project_id)}
      </section>
      <section class="panel">
        <h2>Critical Status</h2>
        <div class="status">
          <span class="pill">Interrupted ${escapeHtml(data.critical?.interrupted_sessions ?? 0)}</span>
          <span class="pill">Review ${escapeHtml(data.critical?.pending_review ?? 0)}</span>
          <span class="pill">Paid API ${escapeHtml(data.critical?.pending_paid_approvals ?? 0)}</span>
        </div>
      </section>
    </aside>
    <section>
      <section class="panel">
        <h2>Import Candidates</h2>
        ${renderRows(data.import_candidates, "No imported candidates require review.", data.current_project_id)}
      </section>
      <section class="panel">
        <h2>Review Inbox</h2>
        ${renderRows(data.inbox, "No candidate or high-risk memories require review.", data.current_project_id)}
      </section>
      <section class="panel">
        <h2>Conflicts / Duplicates</h2>
        ${renderRows(data.duplicate_conflicts, "No conflicts or duplicates detected.", data.current_project_id)}
      </section>
      <section class="panel">
        <h2>Active Rules</h2>
        ${renderRows(data.rules, "No instruction-grade rules yet.", data.current_project_id)}
      </section>
    </section>
    <aside>
      <section class="panel">
        <h2>Selected Detail</h2>
        ${renderDetail(data.selected_detail, data.available_review_actions, data.current_project_id)}
      </section>
      <section class="panel">
        <h2>Cost / Paid API</h2>
        ${renderRows(data.costs, "No model cost records in the last 30 days.")}
      </section>
      <section class="panel">
        <h2>Cleanup / Forget</h2>
        <div class="chat">
          Detach uses a dry-run first and hides the project from active Recallant views without deleting records.
          Permanent erasure is separate.
        </div>
      </section>
      <section class="panel">
        <h2>Settings</h2>
        ${renderSettings(data.settings)}
      </section>
      <section class="panel">
        <h2>Management Chat</h2>
        <div class="chat">${escapeHtml(data.chat.placeholder)} Destructive actions require confirmation.</div>
      </section>
    </aside>
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
      selected_memory_id: requestUrl.searchParams.get("memory_id")
    };
    if (requestUrl.pathname === "/" || requestUrl.pathname === "/review") {
      write(
        response,
        200,
        renderDashboard(await database.getReviewDashboard(dashboardInput)),
        "text/html",
        sessionCookie ? { "set-cookie": sessionCookie } : {}
      );
      return;
    }
    if (requestUrl.pathname === "/api/review-dashboard") {
      write(
        response,
        200,
        JSON.stringify(await database.getReviewDashboard(dashboardInput)),
        "application/json"
      );
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/review-action") {
      const body = (await readJson(request)) as ReviewAgentMemoryInput;
      write(
        response,
        200,
        JSON.stringify(
          await database.reviewAgentMemory({ ...body, actor_kind: body.actor_kind ?? "user" })
        ),
        "application/json"
      );
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/review-action") {
      const body = await readForm(request);
      const result = await database.reviewAgentMemory({
        memory_id: String(body.memory_id ?? ""),
        action: String(body.action ?? ""),
        actor_kind: "user"
      });
      const location = reviewPath(body.project_id, result.memory_id);
      write(response, 303, "See other", "text/plain", { location });
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
