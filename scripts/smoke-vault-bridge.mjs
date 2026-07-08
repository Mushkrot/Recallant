import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-vault-bridge-${projectId}`;
const cli = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const forbiddenToken = ["sk", "vaultbridgeleakfixture123"].join("-");
const forbiddenNeedles = [
  forbiddenToken,
  ["postgres", "://"].join(""),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" ")
];
const env = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: projectPath
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoForbidden(text, label) {
  for (const needle of forbiddenNeedles) {
    assert(!text.includes(needle), `${label} leaked forbidden marker: ${needle}`);
  }
}

function runCli(args) {
  const output = execFileSync("node", [cli, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assertNoForbidden(output, `CLI ${args.join(" ")}`);
  return JSON.parse(output);
}

function expectCliReject(args, marker) {
  let rejected = false;
  let stderr = "";
  try {
    execFileSync("node", [cli, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    rejected = true;
    stderr = String(error.stderr ?? error.message ?? "");
  }
  assert(rejected, `${args.join(" ")} should reject`);
  assert(stderr.includes(marker), `${args.join(" ")} missing rejection marker ${marker}`);
  assertNoForbidden(stderr, `${args.join(" ")} rejection`);
}

function createFixtureVault() {
  const vault = mkdtempSync(join(tmpdir(), "recallant-vault-bridge-"));
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  mkdirSync(join(vault, "assets"), { recursive: true });
  mkdirSync(join(vault, "Recallant"), { recursive: true });
  writeFileSync(join(vault, ".obsidian", "workspace.json"), "{}\n");
  writeFileSync(join(vault, "assets", "diagram.png"), "not really an image\n");
  writeFileSync(join(vault, "Recallant", "Old.md"), "# Existing generated export\n");
  writeFileSync(
    join(vault, "Note.md"),
    [
      "---",
      "tags: [decisions]",
      "alias: Demo",
      "---",
      "# Decision Log",
      "See [[Other Note#Topic]] and [site](https://example.com).",
      "![diagram](assets/diagram.png)",
      "#tagged ^block-id",
      ""
    ].join("\n")
  );
  writeFileSync(join(vault, "Other Note.md"), "# Topic\nBack to [[Note]].\n");
  writeFileSync(join(vault, "Sensitive.md"), `api_key = ${forbiddenToken}\n# Sensitive\n`);
  return vault;
}

const vault = createFixtureVault();
const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath
});

try {
  await db.registerProject({
    projectId,
    developerId,
    projectPath,
    name: "vault-bridge-smoke"
  });

  const inventory = runCli(["vault", "inventory", vault, "--format", "json"]);
  assert(inventory.read_only === true, "inventory must be read-only");
  assert(inventory.writes_memory === false, "inventory must not write memory");
  assert(inventory.writes_files === false, "inventory must not write files");
  assert(inventory.summary.markdown_files === 3, `inventory markdown count: ${JSON.stringify(inventory.summary)}`);
  assert(
    inventory.skipped.some((item) => item.path === ".obsidian" && item.reason === "ignored_directory"),
    "inventory must ignore .obsidian"
  );
  assert(
    inventory.skipped.some((item) => item.path === "Recallant" && item.reason === "ignored_directory"),
    "inventory must ignore generated Recallant export dir"
  );
  assert(inventory.summary.media_references === 1, "inventory must report one media reference");
  assert(inventory.summary.unsafe_files === 1, "inventory must mark unsafe file");

  const beforeDryRun = await db.listGraphCandidates({
    project_id: projectId,
    extraction_method: "vault_bridge",
    limit: 100
  });
  const dryRun = runCli(["vault", "candidates", vault, "--project-dir", projectPath, "--format", "json"]);
  assert(dryRun.dry_run === true, "candidate proposal must default to dry-run");
  assert(dryRun.writes_database === false, "candidate dry-run must not write DB");
  assert(dryRun.summary.proposals > 5, "candidate dry-run should propose graph structure");
  assert(dryRun.summary.blocked_files === 1, "candidate dry-run should block unsafe source details");
  const afterDryRun = await db.listGraphCandidates({
    project_id: projectId,
    extraction_method: "vault_bridge",
    limit: 100
  });
  assert(
    beforeDryRun.candidates.length === afterDryRun.candidates.length,
    "candidate dry-run changed DB state"
  );

  expectCliReject(
    ["vault", "candidates", vault, "--project-dir", projectPath, "--write-candidates"],
    "--write-candidates --confirm"
  );
  const writtenCandidates = runCli([
    "vault",
    "candidates",
    vault,
    "--project-dir",
    projectPath,
    "--write-candidates",
    "--confirm",
    "--format",
    "json"
  ]);
  assert(writtenCandidates.dry_run === false, "confirmed candidate write should not be dry-run");
  assert(writtenCandidates.writes_database === true, "confirmed candidate write should write DB");
  assert(
    writtenCandidates.persisted.count === writtenCandidates.summary.proposals,
    "persisted candidate count must match proposal count"
  );
  const storedCandidates = await db.listGraphCandidates({
    project_id: projectId,
    extraction_method: "vault_bridge",
    limit: 100
  });
  assert(
    storedCandidates.candidates.length === writtenCandidates.persisted.count,
    "stored candidate count mismatch"
  );
  assert(
    storedCandidates.candidates.every((candidate) => candidate.source_refs.length > 0),
    "stored candidates must have source refs"
  );
  assertNoForbidden(JSON.stringify(storedCandidates), "stored vault candidates");

  const preview = runCli(["vault", "export", vault, "--format", "json"]);
  assert(preview.dry_run === true, "export must default to dry-run");
  assert(preview.writes_files === false, "export preview must not write files");
  assert(preview.files.length === 4, "export preview should include four files");
  expectCliReject(["vault", "export", vault, "--write"], "--write --confirm");

  const outputDir = join(vault, "ReviewExport");
  const exportWrite = runCli([
    "vault",
    "export",
    vault,
    "--output",
    outputDir,
    "--write",
    "--confirm",
    "--format",
    "json"
  ]);
  assert(exportWrite.dry_run === false, "confirmed export should not be dry-run");
  assert(exportWrite.writes_files === true, "confirmed export should write files");
  const exported = readdirSync(outputDir).sort();
  assert(
    JSON.stringify(exported) ===
      JSON.stringify(["Checkpoints.md", "Decisions.md", "Memory Review.md", "Open Questions.md"]),
    `unexpected export files: ${JSON.stringify(exported)}`
  );
  for (const file of exported) {
    const content = readFileSync(join(outputDir, file), "utf8");
    assert(content.startsWith("# Recallant "), `${file} missing Recallant heading`);
    assertNoForbidden(content, `export ${file}`);
  }
  assert(!existsSync(join(vault, "ReviewExport", "diagram.png")), "export must not copy media");

  process.stdout.write(
    `${JSON.stringify(
      {
        vault_bridge_smoke: "passed",
        inventory: {
          markdown_files: inventory.summary.markdown_files,
          skipped_files: inventory.summary.skipped_files,
          media_references: inventory.summary.media_references,
          unsafe_files: inventory.summary.unsafe_files
        },
        candidates: {
          dry_run_proposals: dryRun.summary.proposals,
          persisted: storedCandidates.candidates.length,
          lifecycle_states: Array.from(
            new Set(storedCandidates.candidates.map((candidate) => candidate.lifecycle_state))
          ).sort(),
          all_source_linked: storedCandidates.candidates.every(
            (candidate) => candidate.source_refs.length > 0
          )
        },
        export: {
          files: exported,
          raw_fixture_token_leaks: 0
        },
        policy_matrix: {
          dry_run_inventory_writes_nothing: true,
          candidate_dry_run_writes_nothing: true,
          candidate_confirm_required: true,
          export_confirm_required: true,
          media_references_only: true,
          raw_secret_not_persisted_or_exported: true
        }
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
}
