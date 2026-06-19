import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function mustNotMatch(text, patterns, label) {
  for (const pattern of patterns) {
    assert(!pattern.test(text), `${label} contains forbidden public pattern: ${pattern}`);
  }
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

const forbidden = [
  /recallant\.unicloud\.ca/i,
  /highmac/i,
  /\/ai\/recallant-internal/i,
  /\/ai\/recallant(?:-data)?/i,
  /\/opt\/secure-configs/i,
  /\bPUBLIC_SYNC\.md\b/i,
  /\bPOSTGRES_PASSWORD\s*=/i,
  /\bRECALLANT_AUTH_TOKEN\s*=/i,
  /\bRECALLANT_SESSION_SECRET\s*=/i,
  /\b[A-Z0-9_]*API_KEY\s*=\s*[^<\s]/i,
  /postgres(?:ql)?:\/\/[^ <>"')]+:[^ <>"')]+@/i
];

for (const path of publicDocs) {
  const text = await read(path);
  mustNotMatch(text, forbidden, path);
}

const publicCode = [
  "apps/cli/src/index.ts",
  "apps/server/src/index.ts",
  "scripts/install-recallant.sh",
  "scripts/install-recallant-cli.sh",
  "scripts/install-recallant-bootstrap.sh",
  "scripts/install-recallant-client-bootstrap.sh",
  "scripts/recallant-prod-compose.sh",
  "scripts/recallant-production-backup.sh",
  "scripts/rollback-recallant-install.sh",
  "scripts/smoke-public-quickstart.mjs",
  "docker-compose.production.yml",
  "package.json"
];

const forbiddenOwnerCodeMarkers = [
  /\/ai\/SECURITY/i,
  /\/ai\/PORTS\.yaml/i,
  /\/ai\/recallant-data/i,
  /\/opt\/secure-configs/i,
  /unicloud\.ca/i
];
for (const path of publicCode) {
  const text = await read(path);
  mustNotMatch(text, forbiddenOwnerCodeMarkers, path);
}

const packageJson = JSON.parse(await read("package.json"));
assert(
  packageJson.scripts?.["security-review:smoke"] === "node scripts/smoke-security-review.mjs",
  "package.json must expose security-review:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes("npm run security-review:smoke"),
  "smoke:core must include security-review:smoke"
);

const securityDoc = await read("docs/SECURITY.md");
mustInclude(
  securityDoc,
  [
    "Automated Security Review",
    "npm run security-review:smoke",
    "install/auth/Workbench/backups/secrets",
    "browser-facing secret redaction",
    "redacted local backups",
    "System Activity Ledger",
    "redacted system activity ledger",
    "bodies, auth headers, cookies",
    "Project purge must account for the ledger",
    "Backups include the ledger table"
  ],
  "docs/SECURITY.md"
);

process.stdout.write("Public security smoke passed\n");
