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
  return metrics;
}

async function collectUiMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const visible = (element) => {
      const style = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const controls = Array.from(
      globalThis.document.querySelectorAll("a,button,input,textarea,select,summary")
    ).filter(visible);
    const targetSizes = controls.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        text: String(element.textContent ?? element.getAttribute("aria-label") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });
    return {
      height: globalThis.document.documentElement.scrollHeight,
      text_length: (globalThis.document.body.innerText ?? "").length,
      headings: globalThis.document.querySelectorAll("h1,h2,h3").length,
      links: globalThis.document.querySelectorAll("a").length,
      buttons: globalThis.document.querySelectorAll("button").length,
      forms: globalThis.document.querySelectorAll("form").length,
      details: globalThis.document.querySelectorAll("details").length,
      cards: globalThis.document.querySelectorAll(
        ".panel,.memory-space,.project-choice,.source-card,.source-result,.review-lane,.activity-group"
      ).length,
      visible_controls: controls.length,
      targets_below_24: targetSizes.filter((item) => item.width < 24 || item.height < 24).length,
      targets_below_44: targetSizes.filter((item) => item.width < 44 || item.height < 44).length
    };
  });
  assert(metrics.height > 0, `${label} returned an invalid document height`);
  return { label, ...metrics };
}

async function assertActionContracts(page, label) {
  const actions = await page
    .locator("form")
    .evaluateAll((forms) =>
      forms.map((form) => (form.getAttribute("action") ?? "").split("#", 1)[0]).filter(Boolean)
    );
  const requiredActions = ["/management-chat", "/review-action"];
  for (const action of requiredActions) {
    assert(
      actions.includes(action),
      `${label} lost required form action ${action}: ${actions.join(", ")}`
    );
  }
  assert(
    actions.some((action) => action.includes("project-")),
    `${label} lost project cleanup action contract: ${actions.join(", ")}`
  );
  return actions;
}

async function assertResponsiveBounds(page, label) {
  const offenders = await page.evaluate(() => {
    const document = globalThis.document;
    const selector = [
      "header",
      "main",
      ".panel",
      ".ask-panel",
      ".memory-space",
      ".source-card",
      ".source-tree-group",
      ".migration-review",
      ".migration-review-lanes article",
      ".review-lane",
      ".graph-review",
      ".graph-candidate-card",
      ".graph-candidate-detail",
      ".activity-group",
      ".activity-item",
      "button",
      ".filter-chip",
      ".source-filter-chip",
      ".workbench-nav a",
      ".pill"
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className ?? ""),
          text: String(element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 90),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          viewport: globalThis.innerWidth
        };
      })
      .filter((item) => item.width > 0)
      .filter(
        (item) => item.left < -2 || item.right > item.viewport + 2 || item.width > item.viewport + 2
      )
      .slice(0, 8);
  });
  assert(
    offenders.length === 0,
    `${label} has elements outside the viewport: ${JSON.stringify(offenders)}`
  );

  const clippedControls = await page.evaluate(() =>
    Array.from(
      globalThis.document.querySelectorAll(
        "button,.filter-chip,.source-filter-chip,.workbench-nav a,.pill"
      )
    )
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className ?? ""),
        text: String(element.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 2)
      .slice(0, 8)
  );
  assert(
    clippedControls.length === 0,
    `${label} has clipped controls: ${JSON.stringify(clippedControls)}`
  );
}

async function visibleBox(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounding box`);
  assert(box.width > 0 && box.height > 0, `${label} is not visible: ${JSON.stringify(box)}`);
  return box;
}

function boxesIntersect(first, second) {
  return !(
    first.x + first.width <= second.x + 1 ||
    second.x + second.width <= first.x + 1 ||
    first.y + first.height <= second.y + 1 ||
    second.y + second.height <= first.y + 1
  );
}

function assertNonIntersectingBoxes(namedBoxes, label) {
  const entries = Object.entries(namedBoxes);
  const overlaps = [];
  for (let outer = 0; outer < entries.length; outer += 1) {
    for (let inner = outer + 1; inner < entries.length; inner += 1) {
      const [firstName, firstBox] = entries[outer];
      const [secondName, secondBox] = entries[inner];
      if (boxesIntersect(firstBox, secondBox)) {
        overlaps.push({ firstName, secondName, firstBox, secondBox });
      }
    }
  }
  assert(overlaps.length === 0, `${label} has intersecting B9 boxes: ${JSON.stringify(overlaps)}`);
}

function compactBox(box) {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
}

async function absent(locator, label) {
  const count = await locator.count();
  assert(count === 0, `${label} should not be present, found ${count}`);
}

async function assertPublicSafePage(page, label, forbiddenText) {
  const visibleText = await page.locator("body").innerText();
  for (const forbidden of forbiddenText) {
    if (!forbidden) continue;
    assert(
      !visibleText.includes(forbidden),
      `${label} public screenshot text contains forbidden marker: ${forbidden}`
    );
  }
  assert(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(visibleText),
    `${label} public screenshot text contains a raw UUID`
  );
  assert(
    !/\bevent\s+[0-9a-f]{6,}\b/i.test(visibleText),
    `${label} public screenshot text contains a raw event id`
  );
}

async function assertHumanDefaultLanguage(page, label) {
  const visibleText = await page.locator("body").innerText();
  const forbiddenVisible = [
    "project_id",
    "memory_id",
    "source_id",
    "scope_kind",
    "memory_domain",
    "embedding_route",
    "route_class",
    "provider_api_key",
    "database_url",
    "Cost by project/provider/model/purpose",
    "Project filter",
    "Domain filter"
  ].filter((marker) => visibleText.includes(marker));
  assert(
    forbiddenVisible.length === 0,
    `${label} default visible text leaked technical language: ${JSON.stringify(forbiddenVisible)}`
  );
  for (const required of [
    "Home",
    "Ask & Search",
    "Review",
    "Sources",
    "Activity",
    "Settings",
    "Diagnostics"
  ]) {
    assert(
      visibleText.includes(required),
      `${label} missing human Workbench language: ${required}`
    );
  }
}

async function assertHomeNavigation(page, label) {
  const primary = page.locator(".workbench-nav-primary a");
  const secondary = page.locator(".workbench-nav-secondary a");
  assert(
    (await primary.count()) === 5,
    `${label} should expose five primary destinations, found ${await primary.count()}`
  );
  assert(
    (await secondary.count()) === 2,
    `${label} should expose two secondary destinations, found ${await secondary.count()}`
  );
  for (const name of ["Home", "Ask & Search", "Review", "Sources", "Activity"]) {
    await primary.getByRole("link", { name, exact: true }).waitFor();
  }
  for (const name of ["Settings", "Diagnostics"]) {
    await secondary.getByRole("link", { name, exact: true }).waitFor();
  }
  await visibleBox(page.locator("#home"), `${label} Home`);
  await visibleBox(page.locator(".home-actions"), `${label} Home actions`);
  await absent(page.locator("#command-center"), `${label} legacy command center`);
}

async function assertVisualBaseline(page, label) {
  const result = await page.evaluate(() => {
    const bodyStyle = globalThis.getComputedStyle(globalThis.document.body);
    const headerStyle = globalThis.getComputedStyle(globalThis.document.querySelector("header"));
    const controls = Array.from(
      globalThis.document.querySelectorAll(
        'button,input:not([type="hidden"]),select,textarea,summary,.workbench-nav a,.home-action'
      )
    ).filter((element) => {
      const elementStyle = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        elementStyle.display !== "none" && elementStyle.visibility !== "hidden" && rect.width > 0
      );
    });
    return {
      bodyBackgroundImage: bodyStyle.backgroundImage,
      headerBackdropFilter: headerStyle.backdropFilter,
      shortTargets: controls.filter((element) => element.getBoundingClientRect().height < 40).length
    };
  });
  assert(
    result.bodyBackgroundImage === "none",
    `${label} should use a flat body background: ${JSON.stringify(result)}`
  );
  assert(
    result.headerBackdropFilter === "none",
    `${label} should not use header blur: ${JSON.stringify(result)}`
  );
  assert(
    result.shortTargets === 0,
    `${label} has undersized primary controls: ${JSON.stringify(result)}`
  );
}

async function saveScreenshotPair(page, standardPath, publicPath, label, forbiddenText) {
  await page.screenshot({ path: standardPath, fullPage: true });
  await assertPublicSafePage(page, label, forbiddenText);
  await page.screenshot({ path: publicPath, fullPage: true });
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
  const missingSourcePath = `/tmp/recallant-playwright-missing-source-${randomUUID()}`;
  const reportDir = process.env.RECALLANT_PLAYWRIGHT_REPORT_DIR ?? "/ai/playwright/reports";
  const publicReportDir = join(reportDir, "public-safe-candidates");
  const publicScreenshots = {
    overview: join(publicReportDir, "recallant-workbench-overview.png"),
    ask: join(publicReportDir, "recallant-workbench-ask.png"),
    sources: join(publicReportDir, "recallant-workbench-sources.png"),
    activity: join(publicReportDir, "recallant-workbench-activity.png"),
    audit: join(publicReportDir, "recallant-workbench-audit.png"),
    review: join(publicReportDir, "recallant-workbench-review.png"),
    reviewMobile: join(publicReportDir, "recallant-workbench-review-mobile.png"),
    mobile: join(publicReportDir, "recallant-workbench-mobile.png")
  };
  const forbiddenPublicText = [
    projectId,
    projectId.slice(0, 8),
    developerId,
    developerId.slice(0, 8),
    projectPath,
    missingSourcePath,
    "/ai/",
    "owner-private-domain.example",
    "AGENTS.md",
    "sk-",
    "postgres://"
  ];
  const b9ReviewErgonomics = {
    check_names: ["b9_review_ergonomics_desktop", "b9_review_ergonomics_mobile"],
    screenshots: {
      desktop: join(reportDir, "recallant-workbench-desktop-focused-review.png"),
      desktop_public: publicScreenshots.review,
      mobile: join(reportDir, "recallant-workbench-mobile-focused-review.png"),
      mobile_public: publicScreenshots.reviewMobile
    },
    no_horizontal_overflow: {},
    boxes: {},
    markers: [
      "Graph review workload",
      "Next graph action",
      "Recommended graph decision",
      "Open candidate detail",
      "Source evidence",
      "Review history",
      "Promote candidate"
    ]
  };
  const uiMetrics = {};
  const actionContracts = {};

  process.env.RECALLANT_AUTH_TOKEN = token;
  process.env.RECALLANT_SESSION_SECRET = `review-playwright-session-${randomUUID()}`;
  process.env.RECALLANT_DATABASE_URL = databaseUrl;
  process.env.RECALLANT_DEVELOPER_ID = developerId;
  process.env.RECALLANT_PROJECT_ID = projectId;
  process.env.RECALLANT_PROJECT_PATH = projectPath;
  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
  process.env.RECALLANT_PUBLIC_SCREENSHOT_MODE = "true";
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;

  const defaultHttpConfig = getRecallantHttpConfig();
  assert(defaultHttpConfig.host === "127.0.0.1", "Review UI smoke must use localhost bind");
  assert(defaultHttpConfig.recallant_auth_required === true, "Review UI smoke must require auth");

  await mkdir(reportDir, { recursive: true });
  await mkdir(publicReportDir, { recursive: true });
  await mkdir(projectPath, { recursive: true });

  const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
  await db.ensureProject(projectPath);
  await db.pool.query(
    `
      UPDATE projects
      SET name = 'Demo Product Workspace',
          updated_at = now()
      WHERE id = $1
    `,
    [projectId]
  );
  const importedDocSource = await db.attachProjectSource({
    project_id: projectId,
    source_kind: "document_collection",
    label: "Team handbook",
    uri: "demo:team-handbook",
    metadata: { smoke: "playwright", purpose: "source-filtered activity visual state" }
  });
  await db.attachProjectSource({
    project_id: projectId,
    source_kind: "connector",
    label: "Planned Drive connector",
    metadata: { smoke: "playwright", purpose: "planned connector visual state" }
  });
  await db.attachProjectSource({
    project_id: projectId,
    source_kind: "server_path",
    label: "Archive source needs setup",
    uri: missingSourcePath,
    metadata: { smoke: "playwright", purpose: "missing source visual state" }
  });
  const denseSources = [
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "manual",
      label:
        "Owner decisions and launch notes with an intentionally long but ordinary readable name",
      metadata: {
        smoke: "playwright",
        purpose: "dense manual source with long label",
        source_path: "Owner decisions and launch notes"
      }
    }),
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "virtual",
      label: "Virtual memory space input for operations planning, onboarding, and later review",
      metadata: {
        smoke: "playwright",
        purpose: "dense virtual source with long label",
        source_path: "Operations planning virtual input"
      }
    }),
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "repo",
      label: "Public demo repository mirror waiting for governed sync",
      uri: "demo-repo://public-demo-product-workspace",
      metadata: { smoke: "playwright", purpose: "remote repo source visual state" }
    }),
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "connector",
      label: "Configured knowledge connector reference",
      uri: "demo-connector://knowledge-base",
      metadata: {
        smoke: "playwright",
        purpose: "ready connector visual state",
        capability_binding_status: "configured"
      }
    }),
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "document_collection",
      label: "Customer research summaries, support notes, and release planning documents",
      uri: "demo-docs://customer-research-release-planning",
      metadata: {
        smoke: "playwright",
        purpose: "dense document source",
        source_path: "Customer research summaries"
      }
    }),
    await db.attachProjectSource({
      project_id: projectId,
      source_kind: "other",
      label: "Archived design-review notes kept only as provenance",
      metadata: {
        smoke: "playwright",
        purpose: "other source visual state",
        source_path: "Archived design-review notes"
      }
    })
  ].filter(Boolean);

  const denseSpaces = [
    {
      id: randomUUID(),
      name: "Long Term Operations Memory Space With Source Map Stress State",
      project_kind: "personal_domain",
      memory_domain: "operations"
    },
    {
      id: randomUUID(),
      name: "Customer Research And Product Decisions Workspace",
      project_kind: "workspace",
      memory_domain: "agent_work"
    },
    {
      id: randomUUID(),
      name: "Server Access Patterns And Safe Automation Examples",
      project_kind: "other",
      memory_domain: "infrastructure"
    },
    {
      id: randomUUID(),
      name: "Archive Recovery Notes With A Very Long Human Readable Name",
      project_kind: "workspace",
      memory_domain: "archive"
    }
  ];
  for (const space of denseSpaces) {
    await db.pool.query(
      `
        INSERT INTO projects (id, developer_id, name, primary_path, project_kind, memory_domain)
        VALUES ($1, $2, $3, NULL, $4, $5)
      `,
      [space.id, developerId, space.name, space.project_kind, space.memory_domain]
    );
    await db.attachProjectSource({
      project_id: space.id,
      source_kind: "virtual",
      label: `${space.name} source`,
      metadata: { smoke: "playwright", purpose: "dense memory-space list" }
    });
  }
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
    title: "Team handbook source is visible in Activity",
    body: "Source-filtered Activity / Replay should show memory writes that came from the team handbook.",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: importedDocSource.id,
        quote: "team handbook",
        metadata: { project_source_id: importedDocSource.id, source_path: "Team handbook" }
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
  await db.ensureGraphCandidateSchema();
  await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "node",
    node_kind: "topic",
    title: "Playwright graph node candidate",
    summary:
      "Graph node candidate with a deliberately long readable summary that should wrap inside the Review view without creating horizontal scroll.",
    confidence: 0.86,
    extraction_method: "deterministic_rule",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "source",
        source_id: importedDocSource.id,
        quote: "Bounded graph node evidence for Playwright."
      }
    ],
    metadata: { smoke: "playwright-graph-review" }
  });
  const graphEdgeCandidate = await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "edge",
    relation_type: "supports",
    src: {
      kind: "external",
      id: "playwright-graph-source",
      label: "Playwright graph source endpoint"
    },
    dst: {
      kind: "external",
      id: "playwright-graph-destination",
      label: "Review Workbench graph destination"
    },
    title: "Playwright graph edge candidate",
    summary: "Graph edge candidate for focused Review view screenshots.",
    confidence: 0.79,
    extraction_method: "keeper",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "agent_memory",
        source_id: rule.memory_id,
        quote: "Bounded graph edge evidence for Playwright."
      }
    ],
    metadata: { smoke: "playwright-graph-review" }
  });
  await db.reviewGraphCandidate({
    project_id: projectId,
    graph_candidate_id: graphEdgeCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "user",
    note: "Playwright graph review history proof"
  });
  const denseMemorySources = [importedDocSource, ...denseSources].filter(Boolean);
  const denseActivityTitles = [
    "Decision from launch planning should stay readable even when the title is unusually long",
    "Action item captured from a source-linked document review",
    "Test result recorded after browser layout verification",
    "Owner preference about human language in the workbench",
    "Source map reminder for connectors that are configured but governed",
    "Follow-up note about recovery and archive search",
    "Capture-state observation from a later agent session",
    "Review queue item with cautious wording for a reusable memory"
  ];
  for (const [index, title] of denseActivityTitles.entries()) {
    const source = denseMemorySources[index % denseMemorySources.length] ?? importedDocSource;
    await db.createAgentMemory({
      memory_type: index % 3 === 0 ? "decision" : index % 3 === 1 ? "action" : "test_result",
      scope: "project",
      title,
      body: "Dense Workbench QA uses this synthetic record to prove long human-readable text remains scannable in Activity / Replay and Review without showing raw database fields.",
      created_by: "agent",
      confidence: index === denseActivityTitles.length - 1 ? 0.45 : 0.78,
      metadata: {
        smoke: "playwright",
        created_from: "recallant_agent_event",
        dense_fixture: true
      },
      source_refs: [
        {
          source_kind: "external",
          source_id: source.id,
          quote: "dense fixture source-linked memory",
          metadata: {
            project_source_id: source.id,
            source_path: source.label ?? source.display_label ?? "Dense fixture source"
          }
        }
      ]
    });
  }
  for (let index = 1; index <= 4; index += 1) {
    const source = denseMemorySources[index % denseMemorySources.length] ?? importedDocSource;
    const imported = await db.pool.query(
      `
        INSERT INTO agent_memories (
          developer_id, project_id, scope, scope_kind, scope_id, audience,
          memory_type, title, body, status, use_policy, confidence, created_by, metadata
        )
        VALUES ($1, $2, 'project', 'project', $7, $3, 'environment_fact', $4, $5,
                'candidate', 'evidence_only', 0.62, 'import', $6)
        RETURNING id
      `,
      [
        developerId,
        projectId,
        JSON.stringify([{ kind: "all_agents", id: null }]),
        `Imported demo evidence ${index} with a long but readable title`,
        "This imported evidence remains reviewable before agents rely on it. It is intentionally verbose so dense Review lanes have realistic text.",
        JSON.stringify({
          smoke: "playwright",
          dense_fixture: true,
          risk: "medium",
          risks: [{ code: "stale_history", severity: "warning" }],
          policy_reason: "import_candidate_review_required"
        }),
        projectId
      ]
    );
    const importedId = imported.rows[0]?.id;
    assert(importedId, "dense import candidate was not created");
    await db.pool.query(
      `
        INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
        VALUES ($1, 'external', $2, $3, $4)
      `,
      [
        importedId,
        source.id,
        "dense imported evidence excerpt",
        JSON.stringify({
          project_source_id: source.id,
          source_path: source.label ?? "Dense imported source"
        })
      ]
    );
  }
  const migrationSecretRef = await db.pool.query(
    `
      INSERT INTO agent_memories (
        developer_id, project_id, scope, scope_kind, scope_id, audience,
        memory_type, title, body, status, use_policy, confidence, created_by, metadata
      )
      VALUES ($1, $2, 'project', 'project', $7, $3, 'environment_fact', $4, $5,
              'candidate', 'evidence_only', 0.58, 'import', $6)
      RETURNING id
    `,
    [
      developerId,
      projectId,
      JSON.stringify([{ kind: "all_agents", id: null }]),
      "Imported capability reference needs owner review",
      "The migrated environment example named connector keys without storing values. Keep it as a capability reference only.",
      JSON.stringify({
        smoke: "playwright",
        dense_fixture: true,
        result_classes: [
          "secret_reference_names_only",
          "capability_binding",
          "connector_account_binding"
        ],
        risk: "high",
        policy_reason: "secret_reference_review_required"
      }),
      projectId
    ]
  );
  const migrationSecretRefId = migrationSecretRef.rows[0]?.id;
  assert(migrationSecretRefId, "migration secret-reference candidate was not created");
  await db.pool.query(
    `
      INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
      VALUES ($1, 'external', $2, 'migrated environment example', $3)
    `,
    [
      migrationSecretRefId,
      importedDocSource.id,
      JSON.stringify({
        project_source_id: importedDocSource.id,
        source_path: "Environment example"
      })
    ]
  );
  const migrationLowRisk = await db.pool.query(
    `
      INSERT INTO agent_memories (
        developer_id, project_id, scope, scope_kind, scope_id, audience,
        memory_type, title, body, status, use_policy, confidence, created_by, metadata
      )
      VALUES ($1, $2, 'project', 'project', $7, $3, 'environment_fact', $4, $5,
              'candidate', 'recall_allowed', 0.8, 'import', $6)
      RETURNING id
    `,
    [
      developerId,
      projectId,
      JSON.stringify([{ kind: "all_agents", id: null }]),
      "Imported low-risk project convention",
      "This migrated note is safe evidence after review and does not contain stale history or capability bindings.",
      JSON.stringify({
        smoke: "playwright",
        dense_fixture: true,
        result_classes: ["project_convention"],
        risk: "low",
        policy_reason: "migration_candidate_review"
      }),
      projectId
    ]
  );
  const migrationLowRiskId = migrationLowRisk.rows[0]?.id;
  assert(migrationLowRiskId, "migration low-risk candidate was not created");
  await db.pool.query(
    `
      INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
      VALUES ($1, 'external', $2, 'low-risk migrated convention', $3)
    `,
    [
      migrationLowRiskId,
      importedDocSource.id,
      JSON.stringify({
        project_source_id: importedDocSource.id,
        source_path: "Project convention note"
      })
    ]
  );
  const conflictSource = denseMemorySources.at(-1) ?? importedDocSource;
  const conflictMemory = await db.createAgentMemory({
    memory_type: "environment_fact",
    scope: "project",
    title: "Possible overlapping guidance about source review",
    body: "This synthetic conflict proves the Workbench can keep conflict review readable in a crowded state.",
    created_by: "agent",
    confidence: 0.52,
    metadata: {
      smoke: "playwright",
      dense_fixture: true,
      possible_conflict: true,
      conflict_group: "source-review-guidance"
    },
    source_refs: [
      {
        source_kind: "external",
        source_id: conflictSource.id,
        quote: "possible conflict dense fixture",
        metadata: {
          project_source_id: conflictSource.id,
          source_path: conflictSource.label ?? "Dense conflict source"
        }
      }
    ]
  });
  await db.pool.query(
    `
      UPDATE agent_memories
      SET status = 'needs_review',
          use_policy = 'evidence_only',
          metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb,
          updated_at = now()
      WHERE id = $1
    `,
    [
      conflictMemory.memory_id,
      JSON.stringify({
        review_candidate_action: "compare before relying on this guidance",
        recommended_action: "keep one clear source-review rule"
      })
    ]
  );
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
    await desktop.goto(`${baseUrl}/review?project_id=${projectId}`, { waitUntil: "networkidle" });
    await desktop.getByRole("heading", { name: "Recallant", exact: true }).waitFor();
    await noHorizontalScroll(desktop, "desktop initial Home");
    await assertResponsiveBounds(desktop, "desktop initial Home");
    await assertHumanDefaultLanguage(desktop, "desktop initial Home");
    await assertHomeNavigation(desktop, "desktop initial Home");
    await assertVisualBaseline(desktop, "desktop initial Home");
    uiMetrics.desktop_initial = await collectUiMetrics(desktop, "desktop_initial");
    actionContracts.desktop_initial = [];
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-dense-desktop.png"),
      fullPage: true
    });
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop.png"),
      publicScreenshots.overview,
      "desktop overview",
      forbiddenPublicText
    );
    const selectedDetailPanel = desktop
      .locator("details.operation-panel", { hasText: "Selected Detail" })
      .first();
    await selectedDetailPanel.locator("summary").first().click();
    await selectedDetailPanel.locator("summary", { hasText: "Technical details" }).waitFor();
    await selectedDetailPanel.locator("summary").first().click();

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=ask`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Ask Recallant" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Ask view");
    await assertResponsiveBounds(desktop, "desktop focused Ask view");
    actionContracts.desktop_ask = await assertActionContracts(desktop, "desktop focused Ask view");
    uiMetrics.desktop_ask = await collectUiMetrics(desktop, "desktop_ask");
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
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop-focused-ask.png"),
      publicScreenshots.ask,
      "desktop focused Ask",
      forbiddenPublicText
    );

    await desktop.goto(
      `${baseUrl}/review?project_id=${projectId}&view=ask&q=${encodeURIComponent("browser QA")}`,
      { waitUntil: "networkidle" }
    );
    await desktop.getByRole("heading", { name: /Results for/ }).waitFor();
    await desktop.locator(".memory-search-result").first().waitFor();
    await noHorizontalScroll(desktop, "desktop Ask search results");
    await assertResponsiveBounds(desktop, "desktop Ask search results");
    uiMetrics.desktop_search = await collectUiMetrics(desktop, "desktop_search");
    const firstSearchResult = desktop.locator(".memory-search-result").first();
    assert(
      (await firstSearchResult.getAttribute("href"))?.includes("view=review"),
      "Ask search result should link into Review"
    );

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=sources`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Source Map" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Sources view");
    await assertResponsiveBounds(desktop, "desktop focused Sources view");
    uiMetrics.desktop_sources = await collectUiMetrics(desktop, "desktop_sources");
    const focusedSourcesBox = await visibleBox(
      desktop.locator("#sources"),
      "desktop focused Sources"
    );
    await desktop.locator("details.source-map-advanced summary").click();
    await visibleBox(desktop.locator("#sources .source-tree"), "desktop Memory Tree source map");
    assert(
      focusedSourcesBox.width >= 980,
      `desktop focused Sources is too narrow: ${JSON.stringify(focusedSourcesBox)}`
    );
    await desktop.locator(".workbench-body.focused").waitFor();
    await desktop.getByRole("heading", { name: "Ready to cite" }).waitFor();
    await desktop.getByRole("heading", { name: "Needs setup" }).waitFor();
    await desktop.getByRole("heading", { name: "Needs attention" }).waitFor();
    await desktop
      .locator("#sources .source-tree", {
        hasText: "Recallant can cite memory from this source with provenance."
      })
      .waitFor();
    await desktop.getByText("Attach a source to selected space").waitFor();
    await desktop.locator(".source-health", { hasText: "Connector source needs setup" }).waitFor();
    await desktop.locator(".source-health", { hasText: "Local path not found" }).waitFor();
    const focusedSourceCardCount = await desktop.locator("#sources .source-card").count();
    assert(
      focusedSourceCardCount >= 8,
      `focused Sources should remain usable with many source cards, found ${focusedSourceCardCount}`
    );
    const visibleSourceListText = await desktop.locator("#sources .source-list").innerText();
    assert(
      !visibleSourceListText.includes(projectPath) &&
        !visibleSourceListText.includes(missingSourcePath),
      `visible source list leaked exact paths instead of keeping them in Technical details: ${visibleSourceListText}`
    );
    await absent(desktop.locator("#ask-recallant"), "focused Sources Ask panel");
    await absent(desktop.locator("#command-center"), "focused Sources command center");
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop-focused-sources.png"),
      publicScreenshots.sources,
      "desktop focused Sources",
      forbiddenPublicText
    );

    await desktop.goto(
      `${baseUrl}/review?project_id=${projectId}&view=activity&source_id=${importedDocSource.id}`,
      {
        waitUntil: "networkidle"
      }
    );
    await desktop.getByRole("heading", { name: "Activity / Replay" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused source-filtered Activity view");
    await assertResponsiveBounds(desktop, "desktop focused source-filtered Activity view");
    uiMetrics.desktop_activity = await collectUiMetrics(desktop, "desktop_activity");
    const focusedActivityBox = await visibleBox(
      desktop.locator("#activity-replay"),
      "desktop focused source-filtered Activity"
    );
    await visibleBox(
      desktop.locator("#activity-replay .activity-summary"),
      "desktop Activity replay summary"
    );
    assert(
      focusedActivityBox.width >= 980,
      `desktop focused source-filtered Activity is too narrow: ${JSON.stringify(focusedActivityBox)}`
    );
    await desktop.getByText("Filtered to Team handbook").waitFor();
    await desktop.getByRole("heading", { name: "Recording flow" }).waitFor();
    await desktop.getByRole("heading", { name: "Memory updates" }).waitFor();
    await desktop.getByRole("heading", { name: "Checkpoints" }).waitFor();
    await desktop
      .locator("#activity-replay .activity-summary", { hasText: "source-linked" })
      .waitFor();
    await desktop
      .getByText("Session starts and context reads prove the agent is entering Recallant.")
      .waitFor();
    await desktop.getByText("Source: Team handbook").first().waitFor();
    await desktop.getByText("Context was read").waitFor();
    await absent(desktop.locator("#ask-recallant"), "focused Activity Ask panel");
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop-focused-activity-source.png"),
      publicScreenshots.activity,
      "desktop focused Activity",
      forbiddenPublicText
    );

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=audit`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Audit", exact: true }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Audit view");
    await assertResponsiveBounds(desktop, "desktop focused Audit view");
    uiMetrics.desktop_audit = await collectUiMetrics(desktop, "desktop_audit");
    const focusedAuditBox = await visibleBox(desktop.locator("#audit"), "desktop focused Audit");
    assert(
      focusedAuditBox.width >= 980,
      `desktop focused Audit is too narrow: ${JSON.stringify(focusedAuditBox)}`
    );
    await desktop.getByText("System activity ledger").waitFor();
    await desktop.getByText("Audit report").waitFor();
    await visibleBox(desktop.locator("#audit .audit-summary"), "desktop Audit summary");
    await desktop.locator("#audit", { hasText: "activity rows" }).waitFor();
    await desktop.locator("#audit", { hasText: "Recommendations" }).waitFor();
    await absent(desktop.locator("#ask-recallant"), "focused Audit Ask panel");
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop-focused-audit.png"),
      publicScreenshots.audit,
      "desktop focused Audit",
      forbiddenPublicText
    );

    await desktop.goto(
      `${baseUrl}/review?project_id=${projectId}&view=review&graph_candidate_id=${graphEdgeCandidate.graph_candidate_id}`,
      {
        waitUntil: "networkidle"
      }
    );
    await desktop.getByRole("heading", { name: "Review", exact: true }).waitFor();
    b9ReviewErgonomics.no_horizontal_overflow.desktop = await noHorizontalScroll(
      desktop,
      "desktop focused Review view"
    );
    await assertResponsiveBounds(desktop, "desktop focused Review view");
    uiMetrics.desktop_review = await collectUiMetrics(desktop, "desktop_review");
    await visibleBox(desktop.locator("#review"), "desktop focused Review");
    await desktop.getByText("Review decision guide").first().waitFor();
    await desktop.getByText("Needs your decision").first().waitFor();
    const advancedReview = desktop.locator("details.advanced-review-panel").first();
    await advancedReview.locator("summary").click();
    await desktop.getByText("Graph review workload").first().waitFor();
    await desktop.getByText("Next graph action").first().waitFor();
    await desktop.getByText("Recommended graph decision").first().waitFor();
    await desktop.getByText("Open candidate detail").first().waitFor();
    const desktopGraphReviewBox = await visibleBox(
      desktop.locator("#review .graph-review"),
      "desktop graph review"
    );
    const desktopGraphOverviewBox = await visibleBox(
      desktop.locator("#review .graph-review-overview"),
      "desktop B9 graph review overview"
    );
    const desktopGraphCandidateListBox = await visibleBox(
      desktop.locator("#review .graph-candidate-list").first(),
      "desktop B9 graph candidate list"
    );
    const desktopGraphDetailBox = await visibleBox(
      desktop.locator("#review .graph-candidate-detail"),
      "desktop graph candidate detail"
    );
    const desktopGraphMaintenanceBox = await visibleBox(
      desktop.locator("#review .graph-maintenance"),
      "desktop B9 graph maintenance"
    );
    const desktopGraphTopologyBox = await visibleBox(
      desktop.locator("#review .graph-topology"),
      "desktop B9 graph topology"
    );
    assertNonIntersectingBoxes(
      {
        overview: desktopGraphOverviewBox,
        candidate_list: desktopGraphCandidateListBox,
        selected_detail: desktopGraphDetailBox,
        maintenance: desktopGraphMaintenanceBox,
        topology: desktopGraphTopologyBox
      },
      "desktop focused Review"
    );
    b9ReviewErgonomics.boxes.desktop = {
      graph_review: compactBox(desktopGraphReviewBox),
      overview: compactBox(desktopGraphOverviewBox),
      candidate_list: compactBox(desktopGraphCandidateListBox),
      selected_detail: compactBox(desktopGraphDetailBox),
      maintenance: compactBox(desktopGraphMaintenanceBox),
      topology: compactBox(desktopGraphTopologyBox)
    };
    await desktop.getByText("Graph candidates").first().waitFor();
    await desktop.getByText("Node candidates").first().waitFor();
    await desktop.getByText("Edge candidates").first().waitFor();
    await desktop.getByText("Playwright graph node candidate").first().waitFor();
    await desktop.getByText("Playwright graph source endpoint").first().waitFor();
    await desktop.getByText("Review Workbench graph destination").first().waitFor();
    await desktop.getByText("Source evidence").first().waitFor();
    await desktop.getByText("Review history").first().waitFor();
    await desktop.getByText("Accepted candidates remain staged review records").first().waitFor();
    await desktop.getByText("Promotion readiness").first().waitFor();
    await desktop.getByText("This accepted compatible edge can be promoted").first().waitFor();
    await desktop.getByRole("button", { name: "Promote candidate" }).waitFor();
    const migrationQueue = desktop.locator("#review .migration-review");
    await visibleBox(migrationQueue, "desktop migration review queue");
    await desktop.getByText("Migration review queue").waitFor();
    await desktop.getByText("Review imported evidence before active rules.").waitFor();
    const migrationLaneCount = await desktop
      .locator("#review .migration-review-lanes article")
      .count();
    assert(
      migrationLaneCount === 4,
      `migration review queue should show four priority lanes, found ${migrationLaneCount}`
    );
    const expectedMigrationLanes = [
      { label: "Conflicts and duplicates", min: 1 },
      { label: "Secret and capability references", min: 1 },
      { label: "Stale handoffs", min: 1 },
      { label: "Low-risk imported evidence", min: 1 }
    ];
    for (const expectedLane of expectedMigrationLanes) {
      const lane = desktop.locator("#review .migration-review-lanes article").filter({
        hasText: expectedLane.label
      });
      await visibleBox(lane.first(), `desktop migration lane ${expectedLane.label}`);
      const laneText = await lane.first().innerText();
      const laneCount = Number(laneText.match(/\n(\d+)\n/)?.[1] ?? "NaN");
      assert(
        laneCount >= expectedLane.min,
        `migration lane ${expectedLane.label} expected at least ${expectedLane.min}, found ${laneText}`
      );
    }
    const importedEvidenceLane = desktop.locator(".review-lane").filter({
      hasText: "Imported evidence"
    });
    const importedLaneCount = Number(
      await importedEvidenceLane.first().locator("summary strong").innerText()
    );
    assert(
      importedLaneCount >= 4,
      `dense Review should include imported evidence rows, found ${importedLaneCount}`
    );
    const conflictLane = desktop.locator(".review-lane").filter({ hasText: "Possible conflicts" });
    const conflictLaneCount = Number(
      await conflictLane.first().locator("summary strong").innerText()
    );
    assert(
      conflictLaneCount >= 1,
      `dense Review should include a possible conflict row, found ${conflictLaneCount}`
    );
    const denseReviewItemCount = await desktop.locator("#review .item").count();
    assert(
      denseReviewItemCount >= 6,
      `dense Review should show several scannable items, found ${denseReviewItemCount}`
    );
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-dense-review.png"),
      fullPage: true
    });
    await desktop.screenshot({
      path: join(reportDir, "recallant-workbench-migration-review-queue.png"),
      fullPage: true
    });
    await saveScreenshotPair(
      desktop,
      join(reportDir, "recallant-workbench-desktop-focused-review.png"),
      publicScreenshots.review,
      "desktop focused Review",
      forbiddenPublicText
    );

    await desktop.goto(`${baseUrl}/review?project_id=${projectId}&view=settings`, {
      waitUntil: "networkidle"
    });
    await desktop.getByRole("heading", { name: "Operations" }).waitFor();
    await noHorizontalScroll(desktop, "desktop focused Settings view");
    await assertResponsiveBounds(desktop, "desktop focused Settings view");
    uiMetrics.desktop_settings = await collectUiMetrics(desktop, "desktop_settings");
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
    await desktop.getByText("Cleanup / Forget").waitFor();
    await desktop.getByRole("button", { name: "Dry-run purge from Recallant" }).waitFor();
    await absent(desktop.getByText("Selected Detail"), "focused Settings selected detail");
    await absent(desktop.getByText("Cost / Paid API"), "focused Settings cost panel");
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
    await mobile.goto(`${baseUrl}/review?project_id=${projectId}`, { waitUntil: "networkidle" });
    await mobile.getByRole("heading", { name: "Recallant", exact: true }).waitFor();
    await noHorizontalScroll(mobile, "mobile initial Home");
    await assertResponsiveBounds(mobile, "mobile initial Home");
    await assertHumanDefaultLanguage(mobile, "mobile initial Home");
    await assertHomeNavigation(mobile, "mobile initial Home");
    await assertVisualBaseline(mobile, "mobile initial Home");
    uiMetrics.mobile_initial = await collectUiMetrics(mobile, "mobile_initial");
    await assertPublicSafePage(mobile, "mobile Home", forbiddenPublicText);
    await mobile.screenshot({
      path: join(reportDir, "recallant-workbench-dense-mobile.png"),
      fullPage: true
    });
    await mobile.screenshot({
      path: publicScreenshots.mobile,
      fullPage: true
    });
    await mobile.goto(
      `${baseUrl}/review?project_id=${projectId}&view=review&graph_candidate_id=${graphEdgeCandidate.graph_candidate_id}`,
      { waitUntil: "networkidle" }
    );
    await mobile.getByRole("heading", { name: "Review", exact: true }).waitFor();
    b9ReviewErgonomics.no_horizontal_overflow.mobile = await noHorizontalScroll(
      mobile,
      "mobile focused Review graph view"
    );
    await assertResponsiveBounds(mobile, "mobile focused Review graph view");
    uiMetrics.mobile_review = await collectUiMetrics(mobile, "mobile_review");
    await mobile.locator("details.advanced-review-panel").first().locator("summary").click();
    await mobile.getByText("Graph review workload").first().waitFor();
    await mobile.getByText("Next graph action").first().waitFor();
    await mobile.getByText("Recommended graph decision").first().waitFor();
    await mobile.getByText("Open candidate detail").first().waitFor();
    const mobileGraphReviewBox = await visibleBox(
      mobile.locator("#review .graph-review"),
      "mobile graph review"
    );
    const mobileGraphOverviewBox = await visibleBox(
      mobile.locator("#review .graph-review-overview"),
      "mobile B9 graph review overview"
    );
    const mobileGraphCandidateListBox = await visibleBox(
      mobile.locator("#review .graph-candidate-list").first(),
      "mobile B9 graph candidate list"
    );
    const mobileGraphDetailBox = await visibleBox(
      mobile.locator("#review .graph-candidate-detail"),
      "mobile graph candidate detail"
    );
    const mobileGraphMaintenanceBox = await visibleBox(
      mobile.locator("#review .graph-maintenance"),
      "mobile B9 graph maintenance"
    );
    const mobileGraphTopologyBox = await visibleBox(
      mobile.locator("#review .graph-topology"),
      "mobile B9 graph topology"
    );
    assertNonIntersectingBoxes(
      {
        overview: mobileGraphOverviewBox,
        candidate_list: mobileGraphCandidateListBox,
        selected_detail: mobileGraphDetailBox,
        maintenance: mobileGraphMaintenanceBox,
        topology: mobileGraphTopologyBox
      },
      "mobile focused Review"
    );
    b9ReviewErgonomics.boxes.mobile = {
      graph_review: compactBox(mobileGraphReviewBox),
      overview: compactBox(mobileGraphOverviewBox),
      candidate_list: compactBox(mobileGraphCandidateListBox),
      selected_detail: compactBox(mobileGraphDetailBox),
      maintenance: compactBox(mobileGraphMaintenanceBox),
      topology: compactBox(mobileGraphTopologyBox)
    };
    await mobile.getByText("Graph candidates").first().waitFor();
    await mobile.getByText("Node candidates").first().waitFor();
    await mobile.getByText("Edge candidates").first().waitFor();
    await mobile.getByText("Playwright graph edge candidate").first().waitFor();
    await mobile.getByText("Promotion readiness").first().waitFor();
    await mobile.getByRole("button", { name: "Promote candidate" }).waitFor();
    await saveScreenshotPair(
      mobile,
      join(reportDir, "recallant-workbench-mobile-focused-review.png"),
      publicScreenshots.reviewMobile,
      "mobile focused Review",
      forbiddenPublicText
    );
    await mobile.goto(`${baseUrl}/review?project_id=${projectId}`, { waitUntil: "networkidle" });
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
            join(reportDir, "recallant-workbench-dense-desktop.png"),
            join(reportDir, "recallant-workbench-desktop-focused-ask.png"),
            join(reportDir, "recallant-workbench-desktop-focused-sources.png"),
            join(reportDir, "recallant-workbench-desktop-focused-activity-source.png"),
            join(reportDir, "recallant-workbench-desktop-focused-audit.png"),
            join(reportDir, "recallant-workbench-desktop-focused-review.png"),
            join(reportDir, "recallant-workbench-dense-review.png"),
            join(reportDir, "recallant-workbench-migration-review-queue.png"),
            join(reportDir, "recallant-workbench-desktop-focused-settings.png"),
            join(reportDir, "recallant-workbench-desktop-chat.png"),
            join(reportDir, "recallant-workbench-dense-mobile.png"),
            join(reportDir, "recallant-workbench-mobile-focused-review.png"),
            join(reportDir, "recallant-workbench-mobile-chat.png")
          ],
          public_safe_screenshot_candidates: Object.values(publicScreenshots),
          b9_review_ergonomics: b9ReviewErgonomics,
          ui_metrics: uiMetrics,
          action_contracts: actionContracts,
          checks: [
            "auth_required",
            "desktop_no_horizontal_scroll",
            "central_ask_recallant_panel",
            "first_screen_snapshot_prominent",
            "documentation_strategy_visible",
            "desktop_focused_ask_view",
            "desktop_focused_sources_view",
            "memory_tree_source_map",
            "review_decision_workflow",
            "graph_review_workbench_desktop",
            "graph_review_workbench_mobile",
            "b9_review_ergonomics_desktop",
            "b9_review_ergonomics_mobile",
            "b9_review_no_horizontal_overflow",
            "b9_review_non_intersecting_boxes",
            "b9_review_public_safe_screenshots",
            "migration_review_queue_browser_qa",
            "public_safe_screenshot_candidates",
            "desktop_focused_source_filtered_activity_view",
            "activity_replay_readability",
            "desktop_focused_audit_view",
            "desktop_focused_settings_view",
            "visual_system_responsive_bounds",
            "default_visible_language_is_human_first",
            "dense_state_desktop_responsive",
            "dense_source_map_many_sources",
            "dense_review_scannable",
            "dense_state_mobile_responsive",
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
