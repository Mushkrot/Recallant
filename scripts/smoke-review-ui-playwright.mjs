/* global console */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRecallantHttpServer, getRecallantHttpConfig } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/ai/playwright/browsers";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("@playwright/test");
  } catch {
    const requireGlobal = createRequire("/usr/lib/node_modules/@playwright/test/package.json");
    return requireGlobal("@playwright/test");
  }
}

async function noHorizontalScroll(page, label) {
  const metrics = await page.evaluate(() => {
    const document = globalThis.document;
    return {
      innerWidth: globalThis.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    };
  });
  assert(
    metrics.scrollWidth <= metrics.innerWidth + 2 &&
      metrics.bodyScrollWidth <= metrics.innerWidth + 2,
    `${label} has horizontal overflow: ${JSON.stringify(metrics)}`
  );
}

async function visibleBox(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounding box`);
  assert(box.width > 0 && box.height > 0, `${label} is not visible: ${JSON.stringify(box)}`);
  return box;
}

async function absent(locator, label) {
  const count = await locator.count();
  assert(count === 0, `${label} should not be present, found ${count}`);
}

async function run() {
  const { chromium } = loadPlaywright();
  const databaseUrl =
    process.env.RECALLANT_DATABASE_URL ??
    "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
  const token = `review-playwright-${randomUUID()}`;
  const developerId = randomUUID();
  const projectId = randomUUID();
  const projectPath = `/tmp/recallant-playwright-${randomUUID()}`;
  const reportDir = process.env.RECALLANT_PLAYWRIGHT_REPORT_DIR ?? "/ai/playwright/reports";

  process.env.RECALLANT_AUTH_TOKEN = token;
  process.env.RECALLANT_SESSION_SECRET = `review-playwright-session-${randomUUID()}`;
  process.env.RECALLANT_DATABASE_URL = databaseUrl;
  process.env.RECALLANT_DEVELOPER_ID = developerId;
  process.env.RECALLANT_PROJECT_ID = projectId;
  process.env.RECALLANT_PROJECT_PATH = projectPath;
  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;

  const defaultHttpConfig = getRecallantHttpConfig();
  assert(defaultHttpConfig.host === "127.0.0.1", "Review UI smoke must use localhost bind");
  assert(defaultHttpConfig.recallant_auth_required === true, "Review UI smoke must require auth");

  await mkdir(reportDir, { recursive: true });
  await mkdir(projectPath, { recursive: true });

  const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
  await db.ensureProject(projectPath);
  const importedDocSource = await db.attachProjectSource({
    project_id: projectId,
    source_kind: "document_collection",
    label: "AGENTS.md",
    uri: "AGENTS.md",
    metadata: { smoke: "playwright", purpose: "source-filtered activity visual state" }
  });
  await db.attachProjectSource({
    project_id: projectId,
    source_kind: "connector",
    label: "Google Drive planned connector",
    metadata: { smoke: "playwright", purpose: "planned connector visual state" }
  });
  await db.attachProjectSource({
    project_id: projectId,
    source_kind: "server_path",
    label: "Missing server docs path",
    uri: `/tmp/recallant-playwright-missing-source-${randomUUID()}`,
    metadata: { smoke: "playwright", purpose: "missing source visual state" }
  });
  await db.pool.query(
    `
      INSERT INTO project_settings (project_id, key, value, updated_by)
      VALUES
        ($1, 'capture_profile', '"detailed"', 'playwright-smoke'),
        ($1, 'project_lifecycle', '{"mode":"sandbox","cleanup":"dry-run first"}', 'playwright-smoke')
      ON CONFLICT (project_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
    `,
    [projectId]
  );

  const session = await db.startSession({
    client_kind: "codex",
    client_version: "playwright-smoke",
    project_path: projectPath,
    session_label: "review-ui-playwright",
    resume_policy: "normal"
  });
  const userEvent = await db.appendTurn({
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text: "Playwright visual QA is checking Recallant Workbench layout.",
    dedup_key: `playwright-turn-${randomUUID()}`
  });
  await db.appendEvent({
    session_id: session.session_id,
    client_kind: "codex",
    event_kind: "system",
    text: "Playwright smoke context read.",
    metadata: { capture_kind: "context_read" },
    raw_artifacts: [],
    dedup_key: `playwright-context-${randomUUID()}`
  });
  await db.createAgentMemory({
    memory_type: "decision",
    scope: "project",
    title: "Playwright visual QA is enabled",
    body: "Recallant Workbench should be checked with browser-level desktop and mobile layout smoke tests.",
    created_by: "agent",
    source_refs: [{ source_kind: "event", source_id: userEvent.event_id, quote: "visual QA" }]
  });
  await db.createAgentMemory({
    memory_type: "environment_fact",
    scope: "project",
    title: "AGENTS.md source is visible in Activity",
    body: "Source-filtered Activity / Replay should show memory writes that came from AGENTS.md.",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: importedDocSource.id,
        quote: "AGENTS.md",
        metadata: { project_source_id: importedDocSource.id, source_path: "AGENTS.md" }
      }
    ]
  });
  const rule = await db.createAgentMemory({
    memory_type: "procedure",
    scope: "developer",
    title: "Use browser QA for UI layout",
    body: "For Recallant Workbench UI changes, run Playwright desktop and mobile checks before asking the owner to inspect.",
    created_by: "user",
    source_refs: [{ source_kind: "event", source_id: userEvent.event_id, quote: "browser-level" }]
  });
  await db.reviewAgentMemory({
    memory_id: rule.memory_id,
    action: "promote_instruction",
    actor_kind: "user",
    note: "playwright smoke active rule"
  });
  await db.createAgentMemory({
    memory_type: "environment_fact",
    scope: "project",
    title: "Workbench review candidate",
    body: "This candidate exists so the Review lane has owner-visible work during Playwright QA.",
    created_by: "agent",
    confidence: 0.55,
    source_refs: [
      { source_kind: "event", source_id: userEvent.event_id, quote: "review candidate" }
    ]
  });
  await db.setCheckpoint(projectId, {
    summary: "Playwright visual smoke checkpoint",
    current_focus: "Verify Recallant Workbench desktop and mobile layout.",
    next_step: "Keep browser-level QA in the UI gate."
  });
  await db.pool.query(
    `
      INSERT INTO model_calls (
        developer_id, project_id, session_id, memory_domain, route_class, provider, model,
        purpose, routing_reason, confirmation_status, input_tokens, output_tokens,
        cost_estimate_usd, cost_actual_usd, latency_ms, status, metadata
      )
      VALUES ($1, $2, $3, 'agent_work', 'local_model', 'ollama', 'nomic-embed-text',
              'query_embedding', 'playwright review ui smoke', 'not_required',
              96, 0, 0, 0, 18, 'success', $4)
    `,
    [developerId, projectId, session.session_id, JSON.stringify({ smoke: "playwright" })]
  );

  const server = createRecallantHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to get Review UI server address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let browser;
  try {
    const unauthenticated = await fetch(`${baseUrl}/review`);
    assert(
      unauthenticated.status === 401,
      `Review UI did not require auth: ${unauthenticated.status}`
    );

    browser = await chromium.launch({ headless: true });
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { authorization: `Bearer ${token}` }
    });
    await desktop.goto(`${baseUrl}/review`, { waitUntil: "networkidle" });
    await desktop.getByRole("heading", { name: "Recallant Workbench" }).waitFor();
    await noHorizontalScroll(desktop, "desktop initial Workbench");

    const askBox = await visibleBox(desktop.locator("#ask-recallant"), "desktop Ask Recallant");
    const leftRailBox = await visibleBox(desktop.locator(".left-rail"), "desktop left rail");
    const sourcesBox = await visibleBox(desktop.locator("#sources"), "desktop Sources");
    const secondaryBox = await visibleBox(
      desktop.locator(".secondary-workspace"),
      "desktop secondary workspace"
    );
    assert(askBox.width >= 980, `desktop Ask Recallant is too narrow: ${JSON.stringify(askBox)}`);
    assert(
      askBox.y < leftRailBox.y && askBox.y < sourcesBox.y && sourcesBox.y < secondaryBox.y,
      `desktop Workbench order is not Ask-first with Sources before secondary panels: ${JSON.stringify(
        {
          askBox,
          leftRailBox,
          sourcesBox,
          secondaryBox
        }
      )}`
    );

    await visibleBox(desktop.locator("#memory-spaces"), "desktop Memory Spaces");
    await visibleBox(desktop.locator("#activity-replay"), "desktop Activity / Replay");
    await desktop.getByText("Primary workspace folder").first().waitFor();
    await desktop.locator(".source-health", { hasText: "Connector source needs setup" }).waitFor();
    await desktop.locator(".source-health", { hasText: "Local path not found" }).waitFor();
    await desktop.getByText("ready to cite").waitFor();
    await desktop.getByText("need setup").waitFor();
    await desktop.getByText("need attention").waitFor();
    await visibleBox(desktop.locator(".source-filter-panel").first(), "desktop source filter");
    await desktop.getByText("Showing all sources").first().waitFor();
    await visibleBox(desktop.locator("#review"), "desktop Review");
    await visibleBox(desktop.locator("#review .review-overview"), "desktop Review overview");
    await visibleBox(desktop.locator("#settings"), "desktop Settings");
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop.png"),
      fullPage: true
    });

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=ask`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Ask Recallant" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Ask view");
    const focusedAskBox = await visibleBox(
      desktop.locator("#ask-recallant"),
      "desktop focused Ask Recallant"
    );
    assert(
      focusedAskBox.width >= 980,
      `desktop focused Ask Recallant is too narrow: ${JSON.stringify(focusedAskBox)}`
    );
    await absent(desktop.locator("#command-center"), "focused Ask command center");
    await absent(desktop.locator("#sources"), "focused Ask sources");
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop-focused-ask.png"),
      fullPage: true
    });

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=sources`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Source Map" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Sources view");
    const focusedSourcesBox = await visibleBox(
      desktop.locator("#sources"),
      "desktop focused Sources"
    );
    assert(
      focusedSourcesBox.width >= 980,
      `desktop focused Sources is too narrow: ${JSON.stringify(focusedSourcesBox)}`
    );
    await desktop.locator(".workbench-body.focused").waitFor();
    await desktop.getByText("Attach a source to selected space").waitFor();
    await desktop.locator(".source-health", { hasText: "Connector source needs setup" }).waitFor();
    await desktop.locator(".source-health", { hasText: "Local path not found" }).waitFor();
    await absent(desktop.locator("#ask-recallant"), "focused Sources Ask panel");
    await absent(desktop.locator("#command-center"), "focused Sources command center");
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop-focused-sources.png"),
      fullPage: true
    });

    await desktop.goto(
      `${baseUrl}/review?project_id=${projectId}&view=activity&source_id=${importedDocSource.id}`,
      {
        waitUntil: "networkidle"
      }
    );
    await desktop.getByRole("heading", { name: "Activity / Replay" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused source-filtered Activity view");
    const focusedActivityBox = await visibleBox(
      desktop.locator("#activity-replay"),
      "desktop focused source-filtered Activity"
    );
    assert(
      focusedActivityBox.width >= 980,
      `desktop focused source-filtered Activity is too narrow: ${JSON.stringify(focusedActivityBox)}`
    );
    await desktop.getByText("Filtered to AGENTS.md").waitFor();
    await desktop.getByText("Source: AGENTS.md").waitFor();
    await desktop.getByText("Context was read").waitFor();
    await absent(desktop.locator("#ask-recallant"), "focused Activity Ask panel");
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop-focused-activity-source.png"),
      fullPage: true
    });

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=settings`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Operations" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Settings view");
    const focusedSettingsBox = await visibleBox(
      desktop.locator("#settings"),
      "desktop focused Settings"
    );
    assert(
      focusedSettingsBox.width >= 980,
      `desktop focused Settings is too narrow: ${JSON.stringify(focusedSettingsBox)}`
    );
    await desktop.locator("#settings[open]").waitFor();
    await desktop.getByText("Edit project settings").waitFor();
    await absent(desktop.getByText("Selected Detail"), "focused Settings selected detail");
    await absent(desktop.getByText("Cost / Paid API"), "focused Settings cost panel");
    await absent(desktop.getByText("Cleanup / Forget"), "focused Settings cleanup panel");
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop-focused-settings.png"),
      fullPage: true
    });

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}`, { waitUntil: "networkidle" });
    await desktop
      .locator('#ask-recallant textarea[name="message"]')
      .fill("Удали этот sandbox проект");
    await Promise.all([
      desktop.waitForLoadState("networkidle"),
      desktop.locator('#ask-recallant button[type="submit"]').click()
    ]);
    await desktop.getByText("Ответ Recallant").waitFor();
    await desktop.getByText("Перед рискованным действием требуется подтверждение.").waitFor();
    await noHorizontalScroll(desktop, "desktop chat answer");
    const chatBox = await visibleBox(
      desktop.locator("#ask-recallant .chat-answer"),
      "desktop chat answer"
    );
    assert(chatBox.width >= 520, `desktop chat answer is too narrow: ${JSON.stringify(chatBox)}`);
    assert(
      chatBox.height <= 700,
      `desktop chat answer escaped capped scroll area: ${JSON.stringify(chatBox)}`
    );
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-desktop-chat.png"),
      fullPage: true
    });

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { authorization: `Bearer ${token}` }
    });
    await mobile.goto(`${baseUrl}/review`, { waitUntil: "networkidle" });
    await mobile.getByRole("heading", { name: "Recallant Workbench" }).waitFor();
    await noHorizontalScroll(mobile, "mobile initial Workbench");
    const mobileAskBox = await visibleBox(mobile.locator("#ask-recallant"), "mobile Ask Recallant");
    assert(
      mobileAskBox.width >= 340,
      `mobile Ask Recallant is too narrow: ${JSON.stringify(mobileAskBox)}`
    );
    await mobile
      .locator('#ask-recallant textarea[name="message"]')
      .fill("Why is this rule not applied?");
    await Promise.all([
      mobile.waitForLoadState("networkidle"),
      mobile.locator('#ask-recallant button[type="submit"]').click()
    ]);
    await mobile.getByText("Recallant Answer").waitFor();
    await noHorizontalScroll(mobile, "mobile chat answer");
    await mobile.screenshot({
      path: join(reportDir, "recallant-workbench-mobile-chat.png"),
      fullPage: true
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          base_url: baseUrl,
          screenshots: [
            join(reportDir, "recallant-workbench-desktop.png"),
            join(reportDir, "recallant-workbench-desktop-focused-ask.png"),
            join(reportDir, "recallant-workbench-desktop-focused-sources.png"),
            join(reportDir, "recallant-workbench-desktop-focused-activity-source.png"),
            join(reportDir, "recallant-workbench-desktop-focused-settings.png"),
            join(reportDir, "recallant-workbench-desktop-chat.png"),
            join(reportDir, "recallant-workbench-mobile-chat.png")
          ],
          checks: [
            "auth_required",
            "desktop_no_horizontal_scroll",
            "central_ask_recallant_panel",
            "desktop_focused_ask_view",
            "desktop_focused_sources_view",
            "desktop_focused_source_filtered_activity_view",
            "desktop_focused_settings_view",
            "long_russian_chat_answer_readable",
            "mobile_no_horizontal_scroll",
            "mobile_chat_answer_readable"
          ]
        },
        null,
        2
      )
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
