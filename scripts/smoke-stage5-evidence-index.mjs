import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const reportDir = join(tmpdir(), "recallant-pilot-reports");
const indexPath = "stage_goals/stage_5/Stage 5 Pilot Evidence Index.md";

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

function yes(value) {
  return value ? "yes" : "no";
}

const pilot = await latestReport("pilot-report-");
const cleanup = await latestReport("stage5-cleanup-matrix-");
const dogfood = await latestReport("stage5-dogfood-loop-");
const clients = await latestReport("stage5-client-pilot-matrix-");

assert(
  pilot.data.qa_summary?.all_required_scenarios_passed === true,
  `Pilot report does not show all required scenarios passed: ${JSON.stringify(pilot.data.qa_summary)}`
);
assert(cleanup.data.ok === true, `Cleanup matrix report failed: ${JSON.stringify(cleanup.data)}`);
assert(dogfood.data.ok === true, `Dogfood report failed: ${JSON.stringify(dogfood.data)}`);
assert(clients.data.ok === true, `Client pilot report failed: ${JSON.stringify(clients.data)}`);
assert(
  cleanup.data.project_detach?.physically_deleted_records === 0 &&
    cleanup.data.forget_forever?.requires_confirmation === true,
  `Cleanup boundaries missing: ${JSON.stringify(cleanup.data)}`
);
assert(
  dogfood.data.proof?.later_recall_works === true &&
    dogfood.data.proof?.workbench_capture_active_before_closeout === true,
  `Dogfood proof missing recall/workbench evidence: ${JSON.stringify(dogfood.data.proof)}`
);
assert(
  clients.data.clients?.some((client) => client.client === "codex" && client.state === "capture_active") &&
    clients.data.clients?.some((client) => client.client === "cursor" && client.state === "configured_only"),
  `Client matrix missing codex/cursor states: ${JSON.stringify(clients.data.clients)}`
);

const generatedAt = new Date().toISOString();
const lines = [
  "# Stage 5 Pilot Evidence Index",
  "",
  `Generated: ${generatedAt}`,
  "",
  "This index is the Stage 5 inspection point. It links the latest machine-readable pilot artifacts and summarizes what each pilot proves without exposing private project paths or raw content.",
  "",
  "## Summary",
  "",
  `- Clean empty project public proof: ${yes(pilot.data.pilots?.clean_empty_project?.public_proof_flow?.later_recall_works)}`,
  `- Copied existing sandbox recall: ${yes(pilot.data.pilots?.copied_existing_sandbox?.capture?.recalled_in_later_session)}`,
  `- GutenDocx sampled sandbox original untouched: ${yes(pilot.data.pilots?.gutendocx_sandbox?.untouched_original_key_files)}`,
  `- GutenDocx production dry-run safe: ${yes(pilot.data.pilots?.gutendocx_production_dry_run?.writes_files === false && pilot.data.pilots?.gutendocx_production_dry_run?.writes_database === false && pilot.data.pilots?.gutendocx_production_dry_run?.service_restarts === 0)}`,
  `- Cleanup matrix passed: ${yes(cleanup.data.ok)}`,
  `- Recallant dogfood later recall: ${yes(dogfood.data.proof?.later_recall_works)}`,
  `- Client matrix passed: ${yes(clients.data.ok)}`,
  "",
  "## Evidence Table",
  "",
  "| Area | Kind | What It Proves | Artifact | Last Verification Command |",
  "| --- | --- | --- | --- | --- |",
  `| Clean empty project | fixture/public proof | attach, connect, demo capture, doctor, ask, detach | \`${pilot.path}\` | \`npm run pilot-report:smoke\` |`,
  `| Copied existing sandbox | fixture-style copied project | source import, capture, recall, detach, copied original untouched | \`${pilot.path}\` | \`npm run pilot-report:smoke\` |`,
  `| GutenDocx sampled sandbox | real project copy | selected real project files imported from sandbox copy, original key files untouched | \`${pilot.path}\` | \`npm run pilot-report:smoke\` |`,
  `| GutenDocx production dry-run | real production-sensitive dry-run | autopilot downgraded to guided, no project writes, no DB writes, no restarts | \`${pilot.path}\` | \`npm run pilot-report:smoke\` |`,
  `| Cleanup matrix | focused product boundary | detach is not erasure, source detach keeps audit trail, reject/archive persist, forget needs confirmation | \`${cleanup.path}\` | \`npm run stage5:cleanup-matrix\` |`,
  `| Recallant dogfood loop | real repo dogfood | session start, context read, memory write, checkpoint, Workbench activity, closeout, later recall | \`${dogfood.path}\` | \`npm run stage5:dogfood-loop\` |`,
  `| Client pilot matrix | multi-client pilot | Codex capture-active, Cursor project-local configured-only, no global config changes, cleanup | \`${clients.path}\` | \`npm run stage5:client-pilot-matrix\` |`,
  "",
  "## Privacy Notes",
  "",
  "- Real private project paths are redacted in generated reports where they would otherwise leak owner-specific machine layout.",
  "- GutenDocx production-sensitive testing is dry-run only; the artifact records no service restart and no file/database writes.",
  "- Cursor client testing writes only inside a temporary project-local config, never global client config.",
  "",
  "## Current Status",
  "",
  "Stage 5 goals 5.1 through 5.8 have evidence. Goal 5.9 remains the final acceptance gate."
];

await writeFile(indexPath, `${lines.join("\n")}\n`);
process.stdout.write(`Stage 5 evidence index smoke passed\n${indexPath}\n`);
