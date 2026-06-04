import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} is missing required marker: ${marker}`);
  }
}

const publicDocs = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/QUICKSTART.md",
  "docs/WHY_RECALLANT.md",
  "docs/COMPARISON.md",
  "docs/ARCHITECTURE.md",
  "docs/SELF_HOSTING.md",
  "docs/CLIENT_SETUP.md",
  "docs/SECURITY.md",
  "docs/ROADMAP.md"
];

for (const path of publicDocs) {
  assert(existsSync(join(repoRoot, path)), `Missing public doc: ${path}`);
}

const docsEntries = await readdir(join(repoRoot, "docs"));
const allowedDocs = new Set(
  publicDocs.filter((path) => path.startsWith("docs/")).map((path) => path.slice("docs/".length))
);
for (const entry of docsEntries) {
  assert(allowedDocs.has(entry), `Unexpected public docs entry: docs/${entry}`);
}

assert(!existsSync(join(repoRoot, "stage_goals")), "stage_goals must not remain in public tree");
assert(!existsSync(join(repoRoot, "PROJECT_LOG.md")), "PROJECT_LOG.md must not remain in public tree");

const readme = await read("README.md");
mustInclude(
  readme,
  [
    "Self-hosted governed memory for Codex and MCP AI agents",
    "Why It Matters",
    "recallant doctor --project-dir . --require-capture",
    "capture active",
    "pre-release",
    "docs/WHY_RECALLANT.md",
    "docs/COMPARISON.md",
    "CONTRIBUTING.md"
  ],
  "README.md"
);

const quickstart = await read("docs/QUICKSTART.md");
mustInclude(
  quickstart,
  [
    "Install",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "recallant onboard --client codex --install-local-hooks --verify",
    "recallant demo-capture --project-dir .",
    "recallant ask \"what did the agent remember?\" --project-dir .",
    "capture active"
  ],
  "docs/QUICKSTART.md"
);

const why = await read("docs/WHY_RECALLANT.md");
mustInclude(why, ["The Maintainer Pain", "The Gap", "Why Codex And OSS Maintainers Benefit"], "WHY");

const comparison = await read("docs/COMPARISON.md");
mustInclude(comparison, ["Related Approaches", "What Is Different", "Honest Status"], "COMPARISON");

const roadmap = await read("docs/ROADMAP.md");
mustInclude(roadmap, ["Current", "Near Term", "Codex For OSS Use"], "ROADMAP");

const installer = readFileSync(join(repoRoot, "scripts", "install-recallant.sh"), "utf8");
assert(
  installer.includes('if [[ "$DRY_RUN" == "true" ]]'),
  "Installer must keep a dry-run path for public evaluation"
);

const dryRun = spawnSync("/bin/bash", ["scripts/install-recallant.sh", "--dry-run", "--profile", "single-user"], {
  cwd: repoRoot,
  env: process.env,
  encoding: "utf8"
});
if (dryRun.error?.code !== "EPERM") {
  if (dryRun.error) throw dryRun.error;
  assert(dryRun.status === 0, `single-user dry-run failed\n${dryRun.stderr}\n${dryRun.stdout}`);
  mustInclude(dryRun.stdout, ["Recallant install plan", "profile: single-user", "dry_run: true"], "installer dry-run");
}

process.stdout.write("Public readiness smoke passed\n");
