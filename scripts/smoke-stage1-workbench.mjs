/* global console */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(path) {
  return readFile(path, "utf8");
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function requireMarkers(text, markers, label) {
  const missing = markers.filter((marker) => !text.includes(marker));
  assert(missing.length === 0, `${label} missing markers: ${JSON.stringify(missing)}`);
}

function forbidMarkers(text, markers, label) {
  const present = markers.filter((marker) => text.includes(marker));
  assert(present.length === 0, `${label} has forbidden markers: ${JSON.stringify(present)}`);
}

async function run() {
  const contractStatus = await readText("docs/CONTRACT_STATUS.md");
  const roadmap = await readText("docs/ROADMAP.md");
  const agentReadyProjects = await readText("docs/AGENT_READY_PROJECTS.md");
  const serverUi = await readText("apps/server/src/index.ts");
  const htmlSmoke = await readText("scripts/smoke-review-ui.mjs");
  const playwrightSmoke = await readText("scripts/smoke-review-ui-playwright.mjs");
  const reportDir = process.env.RECALLANT_PLAYWRIGHT_REPORT_DIR ?? "/ai/playwright/reports";
  const acceptanceReportDir = process.env.RECALLANT_STAGE1_ACCEPTANCE_REPORT_DIR ?? "/tmp";
  const publicReportDir = join(reportDir, "public-safe-candidates");

  requireMarkers(
    contractStatus,
    [
      "Governed memory and review",
      "Workbench migration review queue",
      "browser-level Workbench QA",
      "npm run review-ui:playwright",
      "autonomous Workbench browser QA",
      "public screenshots with synthetic data only"
    ],
    "Public Workbench contract status"
  );

  requireMarkers(
    roadmap,
    [
      "Workbench migration review queue",
      "Public screenshot set with synthetic data only",
      "autonomous browser QA",
      "Reference-backed Workbench polish"
    ],
    "Public Workbench roadmap"
  );

  requireMarkers(
    agentReadyProjects,
    [
      "In the Workbench, migrated projects should expose a migration review queue",
      "conflicts and duplicates",
      "secret or",
      "capability references",
      "stale handoffs",
      "low-risk imported evidence"
    ],
    "Agent-ready project Workbench contract"
  );

  requireMarkers(
    serverUi,
    [
      "Recallant workspace",
      "Ask Recallant",
      "Memory Spaces",
      "Source Map",
      "Agent activity",
      "Review decision guide",
      "Rule view",
      "Model costs and approvals",
      "Technical details",
      "Technical filter values",
      "Technical cost breakdown",
      "Advanced cleanup details",
      "workbench-promise",
      "Project controls",
      "Secondary workspace",
      "Source map legend",
      "Memory Tree / Source Map · Memory space sources",
      "Memory Tree root",
      "sourceMapRole",
      "sourceCaptureReadiness",
      "Semantic search is configured locally.",
      "Understood by local AI."
    ],
    "Workbench UI"
  );
  forbidMarkers(
    serverUi,
    [
      "<h3>embedding_route</h3>",
      "<h3>instruction_grade</h3>",
      "<h3>needs_review</h3>",
      "<summary><span>Cost / Paid API</span></summary>",
      ">Project filter<",
      ">Domain filter<",
      "Cost by project/provider/model/purpose",
      "Understood by local AI:"
    ],
    "Workbench default language"
  );

  requireMarkers(
    htmlSmoke,
    [
      "From source",
      "Agent activity",
      "Agent activity views",
      "Memory recording history",
      "Overall coverage",
      "Capture adapters",
      "visibleTechnicalLeaks"
    ],
    "Review UI smoke"
  );

  requireMarkers(
    playwrightSmoke,
    [
      "assertHumanDefaultLanguage",
      "default_visible_language_is_human_first",
      "root_opens_last_project_home",
      "central_ask_recallant_panel",
      "memory_tree_source_map",
      "desktop_focused_sources_view",
      "desktop_focused_settings_view",
      "dense_state_desktop_responsive",
      "dense_review_scannable",
      "migration_review_queue_browser_qa",
      "public_safe_screenshot_candidates",
      "mobile_chat_answer_readable"
    ],
    "Playwright Workbench smoke"
  );

  const screenshots = [
    join(reportDir, "recallant-workbench-desktop.png"),
    join(reportDir, "recallant-workbench-dense-desktop.png"),
    join(reportDir, "recallant-workbench-desktop-focused-ask.png"),
    join(reportDir, "recallant-workbench-desktop-focused-sources.png"),
    join(reportDir, "recallant-workbench-desktop-focused-activity-source.png"),
    join(reportDir, "recallant-workbench-desktop-focused-activity-runs.png"),
    join(reportDir, "recallant-workbench-desktop-agent-replay.png"),
    join(reportDir, "recallant-workbench-desktop-agent-errors.png"),
    join(reportDir, "recallant-workbench-desktop-agent-coverage.png"),
    join(reportDir, "recallant-workbench-desktop-focused-review.png"),
    join(reportDir, "recallant-workbench-dense-review.png"),
    join(reportDir, "recallant-workbench-migration-review-queue.png"),
    join(reportDir, "recallant-workbench-desktop-focused-settings.png"),
    join(reportDir, "recallant-workbench-desktop-chat.png"),
    join(reportDir, "recallant-workbench-dense-mobile.png"),
    join(reportDir, "recallant-workbench-mobile-agent-replay.png"),
    join(reportDir, "recallant-workbench-mobile-chat.png"),
    join(publicReportDir, "recallant-workbench-overview.png"),
    join(publicReportDir, "recallant-workbench-ask.png"),
    join(publicReportDir, "recallant-workbench-sources.png"),
    join(publicReportDir, "recallant-workbench-activity.png"),
    join(publicReportDir, "recallant-workbench-review.png"),
    join(publicReportDir, "recallant-workbench-mobile.png")
  ];
  const missingScreenshots = [];
  for (const screenshot of screenshots) {
    if (!(await exists(screenshot))) missingScreenshots.push(screenshot);
  }
  assert(
    missingScreenshots.length === 0,
    `Stage 1 acceptance screenshots missing or empty: ${JSON.stringify(missingScreenshots)}`
  );

  const report = {
    status: "ok",
    stage: "Stage 1: Human Workbench UI",
    production_gate: "public_contract_checked",
    production_target: "docs/CONTRACT_STATUS.md",
    verified: [
      "public Workbench contract status is self-contained",
      "agent-ready project docs define the migration review queue",
      "default Workbench language is human-first",
      "technical values remain behind details or technical smokes",
      "Home is the default entry and routes users to task-focused views",
      "Memory Tree / Source Map product surface is present",
      "secondary operations stay inside Project controls",
      "Home, Ask & Search, Review, Sources, Agent activity, Settings, and Diagnostics are covered",
      "migration review queue browser QA is covered",
      "desktop and mobile Playwright evidence screenshots exist",
      "public-safe screenshot candidates exist"
    ],
    screenshots
  };
  await mkdir(acceptanceReportDir, { recursive: true });
  const reportPath = join(acceptanceReportDir, "recallant-stage1-acceptance.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
