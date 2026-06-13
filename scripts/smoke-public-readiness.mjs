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
  "docs/AGENT_READY_PROJECTS.md",
  "docs/CONTRACT_STATUS.md",
  "docs/WHY_RECALLANT.md",
  "docs/COMPARISON.md",
  "docs/REFERENCE_PROJECTS.md",
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
    "docs/AGENT_READY_PROJECTS.md",
    "docs/CONTRACT_STATUS.md",
    "pre-release",
    "docs/WHY_RECALLANT.md",
    "docs/COMPARISON.md",
    "docs/REFERENCE_PROJECTS.md",
    "CONTRIBUTING.md"
  ],
  "README.md"
);

const quickstart = await read("docs/QUICKSTART.md");
mustInclude(
  quickstart,
  [
    "Install",
    "Make A Project Agent-Ready",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "recallant onboard --client codex --install-local-hooks --verify",
    "recallant demo-capture --project-dir .",
    "recallant ask \"what did the agent remember?\" --project-dir .",
    "capture active",
    "Agent-ready projects"
  ],
  "docs/QUICKSTART.md"
);

const why = await read("docs/WHY_RECALLANT.md");
mustInclude(
  why,
  [
    "The Maintainer Pain",
    "The Gap",
    "Manual project bootstrap",
    "Why Codex And OSS Maintainers Benefit"
  ],
  "WHY"
);

const agentReadyProjects = await read("docs/AGENT_READY_PROJECTS.md");
mustInclude(
  agentReadyProjects,
  [
    "Agent-Ready Projects",
    "Product Contract",
    "recallant attach .",
    "New Project Bootstrap",
    "Existing Project Migration",
    "Agent Session Contract",
    "Sources, Capabilities, And Secret References",
    "Cross-Project Examples",
    "Safety Gates",
    "Public And Private Boundary",
    "capture active"
  ],
  "AGENT_READY_PROJECTS"
);

const contractStatus = await read("docs/CONTRACT_STATUS.md");
mustInclude(
  contractStatus,
  [
    "Product Contract Status",
    "Contract Coverage",
    "Agent-ready project onboarding",
    "Existing-project migration",
    "Capture-active proof",
    "Source, capability, and secret references",
    "Cross-project examples",
    "Safety gates",
    "npm run public-clean-host:smoke",
    "npm run public-install-rollback:smoke",
    "npm run non-owner-migration:smoke",
    "npm run real-project-pilots:smoke",
    "npm run review-ui:playwright",
    "Workbench migration review queue",
    "Release-Candidate Bar"
  ],
  "CONTRACT_STATUS"
);

const comparison = await read("docs/COMPARISON.md");
mustInclude(
  comparison,
  [
    "Related Approaches",
    "Reference Projects",
    "Open Brain / OB1",
    "MemPalace",
    "AgentMemory",
    "Journey / Journey Kits",
    "OpenMemory variants",
    "MF0.ai / MF0-1984",
    "Odysseus",
    "What Is Different",
    "Honest Status"
  ],
  "COMPARISON"
);

const referenceProjects = await read("docs/REFERENCE_PROJECTS.md");
mustInclude(
  referenceProjects,
  [
    "Open Brain / OB1",
    "MemPalace",
    "AgentMemory",
    "Journey / Journey Kits",
    "OpenMemory Variants",
    "Odysseus",
    "MF0.ai / MF0-1984",
    "Kortix / Suna",
    "Kortex / Eden",
    "Refresh Checklist"
  ],
  "REFERENCE_PROJECTS"
);

const roadmap = await read("docs/ROADMAP.md");
mustInclude(
  roadmap,
  [
    "Current",
    "Agent-ready project bootstrap",
    "Neutral non-owner migration smoke",
    "Opt-in real-project pilot smoke",
    "Workbench migration review queue",
    "autonomous browser QA",
    "Autonomous attach polish",
    "rollback smoke",
    "opt-in Docker-backed managed",
    "Deployment-profile",
    "Codex For OSS Use"
  ],
  "ROADMAP"
);

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assert(
  packageJson.scripts?.["non-owner-migration:smoke"] ===
    "node scripts/smoke-non-owner-migration.mjs",
  "package.json must expose non-owner-migration:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes("npm run non-owner-migration:smoke"),
  "smoke:core must include non-owner-migration:smoke"
);

const forbiddenPrivateMarkers = [
  "/ai/SECURITY",
  "/ai/PORTS.yaml",
  "/opt/secure-configs",
  "unicloud.ca",
  "recallant-internal"
];
for (const path of publicDocs) {
  const content = await read(path);
  for (const marker of forbiddenPrivateMarkers) {
    assert(!content.includes(marker), `${path} must not contain private marker: ${marker}`);
  }
}

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
