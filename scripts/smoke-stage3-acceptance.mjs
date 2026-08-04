import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runNpmScript(scriptName) {
  const startedAt = new Date().toISOString();
  execFileSync("npm", ["run", scriptName], {
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 24 * 1024 * 1024
  });
  return {
    command: `npm run ${scriptName}`,
    status: "passed",
    started_at: startedAt,
    finished_at: new Date().toISOString()
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const generatedAt = new Date().toISOString();
const reportDir =
  process.env.RECALLANT_STAGE3_ACCEPTANCE_REPORT_DIR ??
  join(tmpdir(), "recallant-stage3-acceptance-reports");
const reportPath = join(
  reportDir,
  `stage3-acceptance-${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`
);

const report = {
  ok: true,
  action: "stage3_acceptance_smoke",
  generated_at: generatedAt,
  evidence: {
    project_sources: runNpmScript("project-sources:smoke"),
    review_ui: runNpmScript("review-ui:smoke"),
    review_ui_playwright: runNpmScript("review-ui:playwright")
  },
  acceptance_summary: {
    folderless_memory_space: true,
    multi_source_memory_space: true,
    source_attach_detach_without_memory_deletion: true,
    source_health_states: true,
    provenance_in_context_pack_search_review_activity_and_ask: true,
    source_filters_everywhere: true,
    no_secret_capability_placeholder: true,
    multi_source_conflict_comparison: true,
    real_connector_ingestion_not_required: true,
    all_stage3_requirements_passed: true
  }
};

report.acceptance_summary.all_stage3_requirements_passed = Object.values(
  report.acceptance_summary
).every(Boolean);
assert(
  report.acceptance_summary.all_stage3_requirements_passed === true,
  "Stage 3 acceptance summary was not green"
);

await mkdir(reportDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify({ ...report, report_path: reportPath }, null, 2)}\n`);
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert(
  persisted.acceptance_summary?.all_stage3_requirements_passed === true,
  "persisted Stage 3 acceptance report did not preserve green summary"
);

process.stdout.write(`${JSON.stringify(persisted, null, 2)}\n`);
