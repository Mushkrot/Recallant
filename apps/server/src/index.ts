import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
    reviewUi: "private-command-center"
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function authorized(request: IncomingMessage) {
  const token = process.env.RECALLANT_AUTH_TOKEN;
  if (!token) return false;
  const header = request.headers.authorization;
  return header === `Bearer ${token}`;
}

function write(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/html"
) {
  response.writeHead(statusCode, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store"
  });
  response.end(body);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function renderRows(rows: Array<Record<string, unknown>>, emptyLabel: string) {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return rows
    .map(
      (row) => `<article class="item">
        <h3>${escapeHtml(row.title ?? row.name ?? row.provider ?? row.key ?? row.project_id)}</h3>
        <p>${escapeHtml(row.body ?? row.primary_path ?? row.model ?? row.value ?? "")}</p>
        <dl>
          ${Object.entries(row)
            .filter(([key]) => !["title", "body", "name", "primary_path"].includes(key))
            .slice(0, 6)
            .map(
              ([key, value]) =>
                `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(JSON.stringify(value))}</dd></div>`
            )
            .join("")}
        </dl>
      </article>`
    )
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
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f7f7f4; color: #202124; }
    body { margin: 0; }
    header { padding: 20px 28px; border-bottom: 1px solid #d8d8d2; background: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 360px); gap: 18px; padding: 18px; }
    section, aside { min-width: 0; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    .panel { background: #fff; border: 1px solid #d8d8d2; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .item { border-top: 1px solid #e7e7e1; padding: 10px 0; }
    .item:first-child { border-top: 0; }
    .item h3 { font-size: 14px; margin: 0 0 5px; }
    .item p { margin: 0 0 8px; color: #55584f; font-size: 13px; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 0; font-size: 12px; }
    dt { color: #6d7068; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill { border: 1px solid #c9c9c2; border-radius: 999px; padding: 5px 8px; font-size: 12px; background: #f7f7f4; }
    .chat { min-height: 92px; border: 1px dashed #b8b8b0; border-radius: 8px; padding: 10px; color: #55584f; font-size: 13px; }
    .empty { color: #777a72; font-size: 13px; }
    @media (max-width: 980px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Recallant Review Command Center</h1>
    <div class="status">
      <span class="pill">Project ${escapeHtml(data.current_project_id)}</span>
      <span class="pill">Private UI</span>
    </div>
  </header>
  <main>
    <aside>
      <section class="panel">
        <h2>Projects</h2>
        ${renderRows(data.projects, "No managed projects yet.")}
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
        ${renderRows(data.settings, "No project settings configured.")}
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
    if (!authorized(request)) {
      write(response, 401, "Unauthorized", "text/plain");
      return;
    }
    const database = createRecallantDbFromEnv();
    if (!database) {
      write(response, 503, "RECALLANT_DATABASE_URL is required", "text/plain");
      return;
    }
    if (request.url === "/" || request.url === "/review") {
      write(response, 200, renderDashboard(await database.getReviewDashboard()));
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
  const host = process.env.RECALLANT_HOST ?? "127.0.0.1";
  const port = Number(process.env.RECALLANT_PORT ?? 3005);
  const server = createRecallantHttpServer();
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}

if (process.argv[1]?.endsWith("/index.js")) {
  await startRecallantHttpServer();
}
