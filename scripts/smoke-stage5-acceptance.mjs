import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const reportDir = join(tmpdir(), "recallant-pilot-reports");
const subStagesPath = "stage_goals/stage_5/Stage 5 sub stages.md";
const evidenceIndexPath = "stage_goals/stage_5/Stage 5 Pilot Evidence Index.md";
const acceptancePath = "stage_goals/stage_5/Stage 5 Acceptance Report.md";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function latestReport(prefix) {
  const files = (await readdir(reportDir)).filter(
    (file) => file.startsWith(prefix) && file.endsWith(".json")
  );
  assert(files.length > 0, `Missing report artifact prefix: ${prefix}`);
  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      path: join(reportDir, file),
      mtimeMs: (await stat(join(reportDir, file))).mtimeMs
    }))
  );
  withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const selected = withStats[0];
  return {
    path: selected.path,
    data: JSON.parse(await readFile(selected.path, "utf8"))
  };
}

function statusMap(markdown) {
  const map = new Map();
  const regex = /## Goal (5\.\d+): [^\n]+\n\nStatus: ([^.]+)\./g;
  let match;
  while ((match = regex.exec(markdown))) map.set(match[1], match[2]);
  return map;
}

const subStages = await readFile(subStagesPath, "utf8");
const statuses = statusMap(subStages);
for (const goal of ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"]) {
  assert(statuses.get(goal) === "completed", `Goal ${goal} must be completed before 5.9`);
}
assert(
  statuses.get("5.9") === "pending" || statuses.get("5.9") === "completed",
  "Goal 5.9 status must be pending or completed while acceptance runs"
);

const index = await readFile(evidenceIndexPath, "utf8");
for (const required of [
  "Clean empty project public proof: yes",
  "Copied existing sandbox recall: yes",
  "GutenDocx sampled sandbox original untouched: yes",
  "GutenDocx production dry-run safe: yes",
  "Cleanup matrix passed: yes",
  "Recallant dogfood later recall: yes",
  "Client matrix passed: yes"
]) {
  assert(index.includes(required), `Evidence index missing required proof: ${required}`);
}

const pilot = await latestReport("pilot-report-");
const cleanup = await latestReport("stage5-cleanup-matrix-");
const dogfood = await latestReport("stage5-dogfood-loop-");
const clients = await latestReport("stage5-client-pilot-matrix-");

assert(
  pilot.data.qa_summary?.all_required_scenarios_passed === true,
  `Pilot report required scenarios failed: ${JSON.stringify(pilot.data.qa_summary)}`
);
assert(
  typeof pilot.data.markdown_report_path === "string" &&
    existsSync(pilot.data.markdown_report_path),
  `Owner-readable pilot Markdown report is missing: ${pilot.data.markdown_report_path}`
);
assert(
  pilot.data.qa_summary?.workbench_capture_visible === true,
  "Pilot report is missing Workbench capture visibility proof"
);
assert(
  pilot.data.qa_summary?.copied_sandbox_original_untouched === true &&
    pilot.data.qa_summary?.gutendocx_sandbox_original_untouched === true,
  "Original untouched proof is missing"
);
assert(
  pilot.data.pilots?.clean_empty_project?.public_proof_flow?.later_recall_works === true &&
    pilot.data.pilots?.copied_existing_sandbox?.capture?.recalled_in_later_session === true,
  "Later recall proof is missing from pilot report"
);
assert(
  pilot.data.qa_summary?.gutendocx_production_dry_run_safe === true,
  "Production-sensitive dry-run proof is missing"
);

assert(
  cleanup.data.ok === true &&
    cleanup.data.project_detach?.physically_deleted_records === 0 &&
    cleanup.data.project_detach?.files_changed === 0 &&
    cleanup.data.forget_forever?.requires_confirmation === true &&
    cleanup.data.source_detach?.memory_space_remained === true,
  `Cleanup matrix acceptance failed: ${JSON.stringify(cleanup.data)}`
);
assert(
  dogfood.data.ok === true &&
    dogfood.data.proof?.session_started === true &&
    dogfood.data.proof?.context_read === true &&
    dogfood.data.proof?.memory_written === true &&
    dogfood.data.proof?.checkpoint_exists === true &&
    dogfood.data.proof?.workbench_capture_active_before_closeout === true &&
    dogfood.data.proof?.later_recall_works === true,
  `Dogfood acceptance failed: ${JSON.stringify(dogfood.data.proof)}`
);
assert(
  clients.data.ok === true &&
    clients.data.clients?.some((client) => client.client === "codex" && client.state === "capture_active") &&
    clients.data.clients?.some((client) => client.client === "cursor" && client.state === "configured_only") &&
    clients.data.project?.global_config_changed === false,
  `Client pilot acceptance failed: ${JSON.stringify(clients.data)}`
);

const generatedAt = new Date().toISOString();
const stageComplete = statuses.get("5.9") === "completed";
const lines = [
  "# Stage 5 Acceptance Report",
  "",
  `Generated: ${generatedAt}`,
  "",
  `Stage 5 acceptance gate: ${stageComplete ? "complete" : "passed; mark Goal 5.9 completed after this run"}.`,
  "",
  "## Verified",
  "",
  "- All Stage 5 goals 5.1 through 5.8 are completed.",
  "- Machine-readable pilot artifacts exist and pass required proof checks.",
  "- Owner-readable pilot Markdown report exists.",
  "- Clean project and copied sandbox later recall are proven.",
  "- GutenDocx copied sandbox proves original key files unchanged.",
  "- GutenDocx production-sensitive dry-run proves no file writes, no DB writes, and no restarts.",
  "- Cleanup matrix proves detach/source detach/reject/archive/forget boundaries.",
  "- Recallant dogfood loop proves Workbench activity plus later recall.",
  "- Client pilot matrix proves Codex capture-active and Cursor project-local configured-only without global config changes.",
  "",
  "## Artifacts",
  "",
  `- Pilot report JSON: \`${pilot.path}\``,
  `- Pilot report Markdown: \`${pilot.data.markdown_report_path}\``,
  `- Cleanup matrix JSON: \`${cleanup.path}\``,
  `- Dogfood loop JSON: \`${dogfood.path}\``,
  `- Client matrix JSON: \`${clients.path}\``,
  `- Evidence index: \`${evidenceIndexPath}\``,
  "",
  "## Decision",
  "",
  "Stage 5 can be closed without owner manual QA being the first proof."
];

await writeFile(acceptancePath, `${lines.join("\n")}\n`);
process.stdout.write(`Stage 5 acceptance smoke passed\n${acceptancePath}\n`);
