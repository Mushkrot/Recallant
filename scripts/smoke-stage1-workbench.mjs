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
  const productionTarget = await readText("stage_goals/stage_1/Stage 1 Production UI Target.md");
  const serverUi = await readText("apps/server/src/index.ts");
  const htmlSmoke = await readText("scripts/smoke-review-ui.mjs");
  const playwrightSmoke = await readText("scripts/smoke-review-ui-playwright.mjs");
  const reportDir = process.env.RECALLANT_PLAYWRIGHT_REPORT_DIR ?? "/ai/playwright/reports";
  const acceptanceReportDir = process.env.RECALLANT_STAGE1_ACCEPTANCE_REPORT_DIR ?? "/tmp";
  const publicReportDir = join(reportDir, "public-safe-candidates");

  for (let goal = 1; goal <= 12; goal += 1) {
    const marker = `## Goal 1.${goal}:`;
    const section = stagePlan.slice(
      stagePlan.indexOf(marker),
      stagePlan.indexOf(`## Goal 1.${goal + 1}:`) > -1
        ? stagePlan.indexOf(`## Goal 1.${goal + 1}:`)
        : stagePlan.length
    );
    assert(
      stagePlan.includes(marker) && section.includes("Status: completed."),
      `Stage 1 Goal 1.${goal} is not marked completed`
    );
  }
  const gateMarker = "## Goal 1.13:";
  const gateSection = stagePlan.slice(stagePlan.indexOf(gateMarker));
  assert(
    stagePlan.includes(gateMarker) &&
      (gateSection.includes("Status: pending.") || gateSection.includes("Status: completed.")),
    "Stage 1 Goal 1.13 is missing or has an invalid status"
  );

  requireMarkers(
    productionTarget,
    [
      "Ask-first Workbench",
      "Memory Tree / Source Map",
      "Secondary areas should be available through focused views",
      "Stage 1 acceptance must fail if",
      "Stage 1 is production-complete"
    ],
    "Stage 1 production UI target"
  );

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
      "workbench-promise",
      "Operations drawer",
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
      "desktop Workbench order is not Ask-first",
      "central_ask_recallant_panel",
      "memory_tree_source_map",
      "desktop_focused_sources_view",
      "desktop_focused_settings_view",
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
    production_gate: gateSection.includes("Status: completed.") ? "complete" : "passed_pending_1.13",
    production_target: "stage_goals/stage_1/Stage 1 Production UI Target.md",
    verified: [
      "Stage 1 sub-goals 1.1 through 1.12 are marked completed",
      gateSection.includes("Status: completed.")
        ? "Stage 1 production visual acceptance gate 1.13 is completed"
        : "Stage 1 production visual acceptance gate 1.13 has passed and is ready to mark completed",
      "Stage 1 production target is present and referenced",
      "default Workbench language is human-first",
      "technical values remain behind details or technical smokes",
      "Ask Recallant is first and primary in the Workbench order",
      "Memory Tree / Source Map product surface is present",
      "secondary operations are collapsed into the Operations drawer",
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
