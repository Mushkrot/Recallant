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
  "docs/REMOTE_CONNECT_PLAN.md",
  "docs/MCP_SPEC.md",
  "docs/CLIENT_SETUP.md",
  "docs/SECURITY.md",
  "docs/ROADMAP.md"
];

const forbidden = [
  /recallant\.unicloud\.ca/i,
  /highmac/i,
  /dish_recallant_safe_test/i,
  /ZenDesk-AI-Assistance/i,
  /\/Users\/vadim/i,
  /\/ai\/recallant-internal/i,
  /\/ai\/recallant(?:-data)?/i,
  /\/opt\/secure-configs/i,
  /\bPUBLIC_SYNC\.md\b/i,
  /\bPOSTGRES_PASSWORD\s*=/i,
  /\bRECALLANT_AUTH_TOKEN\s*=/i,
  /\bRECALLANT_SESSION_SECRET\s*=/i,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|RECALLANT_REMOTE_MCP_CREDENTIAL|RECALLANT_DATABASE_URL|POSTGRES_PASSWORD|PGPASSWORD|RECALLANT_AUTH_TOKEN|RECALLANT_SESSION_SECRET)\s*=\s*(?!<|\[redacted\]|redacted)[^<\s`]+/i,
  /\b[A-Z0-9_]*API_KEY\s*=\s*[^<\s]/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\braw_artifacts?_path\s*[:=]\s*(?!<|\[redacted\]|redacted)[^<\s`]+/i,
  /\bbackup_path\s*[:=]\s*(?!<|\[redacted\]|redacted)[^<\s`]+/i,
  /\bcustomer_(?:email|name|phone|id)\s*[:=]\s*(?!<|\[redacted\]|redacted)[^<\s`]+/i,
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
    "Public examples may name prohibited classes",
    "<scoped-remote-mcp-credential>",
    "redacted local backups",
    "System Activity Ledger",
    "redacted system activity ledger",
    "bodies, auth headers, cookies",
    "Project purge must account for the ledger",
    "Backups include the ledger table"
  ],
  "docs/SECURITY.md"
);

const remoteConnectPlan = await read("docs/REMOTE_CONNECT_PLAN.md");
mustInclude(
  remoteConnectPlan,
  [
    "GET /connect`: public shell bootstrap script",
    "POST /api/connect/start`: public, rate-limited pending request creation",
    "GET /connect/approve?code=<device-code>`: protected browser approval page",
    "POST /api/connect/approve`: protected approval action",
    "POST /api/connect/poll`: public, rate-limited polling endpoint",
    "POST /api/connect/cancel`: optional public cancellation endpoint",
    "Workbench, admin, raw artifact, backup, provider, and credential-management routes remain protected",
    "The central server also keeps a bounded payload check and a per-route abuse guard"
  ],
  "docs/REMOTE_CONNECT_PLAN.md route boundary"
);

const mcpSpec = await read("docs/MCP_SPEC.md");
mustInclude(
  mcpSpec,
  [
    "universal device-style pairing from",
    "curl -fsSL https://memory.example.com/connect | bash",
    "Agent runtime must",
    "not depend on a Cloudflare browser session",
    "RECALLANT_REMOTE_MCP_CREDENTIAL_REF",
    "Remote bridge hosts must not receive `RECALLANT_DATABASE_URL`, Postgres access, internal server",
    "paths, Workbench/admin auth, raw artifacts, backups, provider secrets, or raw deployment overlays",
    "The existing invite-command flow remains an",
    "advanced/admin fallback"
  ],
  "docs/MCP_SPEC.md remote security boundary"
);

process.stdout.write(
  `${JSON.stringify(
    {
      public_security_smoke: {
        status: "pass",
        docs_scanned: publicDocs.length,
        public_code_surfaces_scanned: publicCode.length,
        forbidden_doc_classes: [
          "owner_specific_domains",
          "owner_specific_paths",
          "raw_env_assignments",
          "raw_credentials",
          "private_key_blocks",
          "customer_data_values",
          "raw_artifact_paths",
          "backup_paths",
          "credentialed_database_urls"
        ],
        required_public_boundary_markers: [
          "public_examples_placeholder_only",
          "remote_connect_route_boundary",
          "remote_mcp_security_boundary"
        ],
        redacted: true
      }
    },
    null,
    2
  )}\n`
);
