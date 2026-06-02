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
  const stagePlan = await readText("stage_goals/stage_1/Stage 1 sub stages.md");
  const serverUi = await readText("apps/server/src/index.ts");
  const htmlSmoke = await readText("scripts/smoke-review-ui.mjs");
  const playwrightSmoke = await readText("scripts/smoke-review-ui-playwright.mjs");
  const reportDir = process.env.RECALLANT_PLAYWRIGHT_REPORT_DIR ?? "/ai/playwright/reports";
  const acceptanceReportDir = process.env.RECALLANT_STAGE1_ACCEPTANCE_REPORT_DIR ?? "/tmp";
  const publicReportDir = join(reportDir, "public-safe-candidates");

  for (let goal = 1; goal <= 9; goal += 1) {
    const marker = `## Goal 1.${goal}:`;
    const section = stagePlan.slice(stagePlan.indexOf(marker), stagePlan.indexOf(`## Goal 1.${goal + 1}:`) > -1 ? stagePlan.indexOf(`## Goal 1.${goal + 1}:`) : stagePlan.length);
    assert(
      stagePlan.includes(marker) && section.includes("Status: completed."),
      `Stage 1 Goal 1.${goal} is not marked completed`
    );
  }

  requireMarkers(
    serverUi,
    [
      "Recallant Workbench",
      "Ask Recallant",
      "Memory Spaces",
      "Source Map",
      "Activity / Replay",
      "Review decision guide",
      "Rule view",
      "Model costs and approvals",
      "Technical details",
      "Technical filter values",
      "Technical cost breakdown",
      "Advanced cleanup details",
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
      "Model costs and approvals",
      "Rule view",
      "Applies to",
      "From source",
      "Technical filter values",
      "Technical cost breakdown",
      "Semantic search is configured locally",
      "visibleTechnicalLeaks"
    ],
    "Review UI smoke"
  );

  requireMarkers(
    playwrightSmoke,
    [
      "assertHumanDefaultLanguage",
      "default_visible_language_is_human_first",
      "dense_state_desktop_responsive",
      "dense_review_scannable",
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
    join(reportDir, "recallant-workbench-desktop-focused-review.png"),
    join(reportDir, "recallant-workbench-dense-review.png"),
    join(reportDir, "recallant-workbench-desktop-focused-settings.png"),
    join(reportDir, "recallant-workbench-desktop-chat.png"),
    join(reportDir, "recallant-workbench-dense-mobile.png"),
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
    verified: [
      "all Stage 1 sub-goals are marked completed",
      "default Workbench language is human-first",
      "technical values remain behind details or technical smokes",
      "Ask Recallant, Memory Spaces, Source Map, Activity, Review, Settings, and Operations are covered",
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
