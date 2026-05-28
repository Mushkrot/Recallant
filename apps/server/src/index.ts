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

function renderRows(rows: Array<Record<string, unknown>>, emptyLabel: string) {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return rows
    .map(
      (row) => `<article class="item">
        <h3>${escapeHtml(row.title ?? row.name ?? row.provider ?? row.key ?? row.project_id)}</h3>
        <p>${escapeHtml(row.body ?? row.primary_path ?? row.model ?? formatDisplayValue(row.value))}</p>
        ${renderMeta(
          Object.entries(row)
            .filter(([key]) => !["title", "body", "name", "primary_path"].includes(key))
            .slice(0, 6)
        )}
      </article>`
    )
    .join("");
}

function renderProjects(rows: Array<Record<string, unknown>>, currentProjectId: unknown) {
  if (rows.length === 0) return `<p class="empty">No managed projects yet.</p>`;
  return rows
    .map((row) => {
      const active = row.project_id === currentProjectId;
      return `<article class="project ${active ? "active" : ""}">
        <div>
          <h3>${escapeHtml(row.name ?? "project")}</h3>
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
      </article>`;
    })
    .join("");
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
    .panel { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .item { border-top: 1px solid #e5e9f0; padding: 10px 0; }
    .item:first-child { border-top: 0; }
    .item h3 { font-size: 14px; margin: 0 0 5px; }
    .item p { margin: 0 0 8px; color: #565d6b; font-size: 13px; overflow-wrap: anywhere; }
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
        <h2>Review Inbox</h2>
        ${renderRows(data.inbox, "No candidate or high-risk memories require review.")}
      </section>
      <section class="panel">
        <h2>Active Rules</h2>
        ${renderRows(data.rules, "No instruction-grade rules yet.")}
      </section>
    </section>
    <aside>
      <section class="panel">
        <h2>Cost / Paid API</h2>
        ${renderRows(data.costs, "No model cost records in the last 30 days.")}
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
    if (request.url === "/health") {
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
    if (request.url === "/" || request.url === "/review") {
      write(
        response,
        200,
        renderDashboard(await database.getReviewDashboard()),
        "text/html",
        sessionCookie ? { "set-cookie": sessionCookie } : {}
      );
      return;
    }
    if (request.url === "/api/review-dashboard") {
      write(response, 200, JSON.stringify(await database.getReviewDashboard()), "application/json");
      return;
    }
    if (request.method === "POST" && request.url === "/api/review-action") {
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
    if (request.method === "POST" && request.url === "/api/project-setting") {
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
