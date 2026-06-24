import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { readdir, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
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

function mustNotInclude(text, markers, label) {
  for (const marker of markers) {
    assert(!text.includes(marker), `${label} contains retired marker: ${marker}`);
  }
}

function mustNotMatch(text, patterns, label) {
  for (const pattern of patterns) {
    assert(!pattern.test(text), `${label} contains forbidden pattern: ${pattern}`);
  }
}

function mustAppearBefore(text, first, second, label) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert(firstIndex >= 0, `${label} is missing required first marker: ${first}`);
  assert(secondIndex >= 0, `${label} is missing required second marker: ${second}`);
  assert(firstIndex < secondIndex, `${label} must lead with ${first} before ${second}`);
}

function fixtureStderrExcerpt(stderr) {
  const trimmed = stderr.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1000) : "<empty>";
}

function parseDoctorFixtureJson(stdout, stderr, code, label) {
  const stdoutLength = stdout.length;
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `${label} produced empty stdout; exit_code=${code}; stdout_length=${stdoutLength}; stderr=${fixtureStderrExcerpt(
        stderr
      )}`
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `${label} produced malformed JSON stdout; exit_code=${code}; stdout_length=${stdoutLength}; stderr=${fixtureStderrExcerpt(
        stderr
      )}; parse_error=${error instanceof Error ? error.message : String(error)}; stdout_excerpt=${trimmed.slice(
        0,
        1000
      )}`
    );
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
  "docs/REMOTE_CONNECT_PLAN.md",
  "docs/MCP_SPEC.md",
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
assert(
  !existsSync(join(repoRoot, "PROJECT_LOG.md")),
  "PROJECT_LOG.md must not remain in public tree"
);

const readme = await read("README.md");
mustInclude(
  readme,
  [
    "Self-hosted governed memory for Codex and MCP AI agents",
    "Why It Matters",
    "local self-host evaluation",
    "existing central Recallant server",
    "recallant onboard /path/to/project",
    "storage_blocked",
    "Workbench link",
    "capture active",
    "System activity ledger",
    "redacted system activity audit reports",
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
    "Install Local Recallant",
    "Remote Existing-Server Setup",
    "curl -fsSL https://memory.example.com/connect | bash",
    "works even when `recallant` is missing or old",
    "registers a local trusted-device key",
    "credential reference, not the raw",
    "--bootstrap-token <one-time-token>",
    "Advanced/admin fallback",
    "recallant invite /path/to/project --server-url https://memory.example.com",
    "curl -fsSL https://memory.example.com/j/<one-time-invite-token> | bash",
    "It is not the primary beginner remote UX",
    "short-lived and one-time",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "recallant onboard /path/to/project",
    "recallant connect /path/to/project",
    "recallant connect /path/to/project --server-url https://memory.example.com",
    "Capture active: yes",
    "documentation posture summary",
    "Documentation posture: empty | healthy |",
    "needs_attention | risky",
    "Found:",
    "Workbench:",
    "storage_blocked",
    "production-sensitive",
    "Workbench link",
    "documentation strategy",
    "surface with four choices",
    "keep current docs and add a Recallant layer",
    "canonicalize docs for a",
    "Recallant-aware workflow",
    "create starter docs",
    "discuss first",
    "Empty projects may receive starter docs during the confirmed",
    "Existing-doc canonicalization and broader doc rewriting",
    "Audit view",
    "recallant audit --project-dir /path/to/project",
    "bodies, auth headers, cookies",
    "Project purge also accounts for the system activity ledger",
    "Advanced / Debug CLI",
    "Agent-ready projects"
  ],
  "docs/QUICKSTART.md"
);
mustAppearBefore(
  quickstart,
  "curl -fsSL https://memory.example.com/connect | bash",
  "recallant invite /path/to/project --server-url https://memory.example.com",
  "docs/QUICKSTART.md"
);

const clientSetup = await read("docs/CLIENT_SETUP.md");
mustInclude(
  clientSetup,
  [
    "curl -fsSL https://memory.example.com/connect | bash",
    "recallant connect <project>",
    "recallant connect <project> --server-url https://memory.example.com",
    "recallant connect .",
    "It works even when `recallant` is missing or old",
    "Advanced/admin fallback",
    "not the universal first-run command",
    "RECALLANT_REMOTE_MCP_CREDENTIAL_REF",
    "does not require Cloudflare browser",
    "The remote machine must not receive Postgres access, `RECALLANT_DATABASE_URL`, internal server paths,",
    "Workbench/admin auth, raw artifacts, backups, or provider secrets",
    "Remote Live External Canary",
    "npm run remote-live-external-canary:smoke",
    "remote-live-external-canary -- --live --json",
    "server_trace_validation_skipped",
    "not_release_pass",
    "default autonomous regression net",
    "fixture-backed proof",
    "release-pass live canary requires explicit server-local inputs",
    "Operator Server-Side CLI Update",
    "systemctl restart <recallant-service>",
    "restart alone is not a"
  ],
  "docs/CLIENT_SETUP.md"
);
mustAppearBefore(
  clientSetup,
  "curl -fsSL https://memory.example.com/connect | bash",
  "recallant invite /path/to/project --server-url https://memory.example.com",
  "docs/CLIENT_SETUP.md"
);

const remoteConnectPlan = await read("docs/REMOTE_CONNECT_PLAN.md");
mustInclude(
  remoteConnectPlan,
  [
    "Status: the universal remote connect model is implemented",
    "curl -fsSL https://memory.example.com/connect | bash",
    "does not depend on an already installed or up-to-date local `recallant` CLI",
    "credential reference, not the raw secret",
    "Server-generated invites remain supported as an advanced/admin path",
    "Workbench, admin, raw artifact, backup, provider, and credential-management routes remain protected"
  ],
  "docs/REMOTE_CONNECT_PLAN.md"
);

const mcpSpec = await read("docs/MCP_SPEC.md");
mustInclude(
  mcpSpec,
  [
    "session/context readiness evidence",
    "`--semantic-proof`",
    "governed semantic-memory proof",
    "`memory_create_agent_memory` marker",
    "`memory_recall_agent_memories`",
    "`memory_set_checkpoint` / `memory_get_checkpoint` round trip proves checkpoint state, not semantic",
    "baseline checkpoint parity contract keeps `memory_set_checkpoint` state-only",
    "`memory_agent_checkpoint` tool",
    "Governed Memory Tool UX",
    '[{ "kind": "all_agents", "id": null }]',
    "Synthetic non-secret marker recallant_safe_semantic_marker_example",
    "Passing `audience` as a string",
    "raw request bodies",
    "remote-live-external-canary:smoke",
    "RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE=1",
    "server_trace_validation_skipped",
    "not_release_pass"
  ],
  "docs/MCP_SPEC.md proof taxonomy"
);

mustInclude(
  quickstart,
  [
    '`recallant agent-start --format json` reports `mode: "remote_mcp_ready"`',
    '`recommended_next_call: "memory_get_context_pack"`',
    '`recommended_next_proof_call: "memory_create_agent_memory"`',
    "`remote-ready, local storage not attached`",
    "session/context readiness is proven by `memory_start_session` plus `memory_get_context_pack`",
    "a checkpoint can be written and read back with `memory_set_checkpoint`",
    "governed semantic memory is proven separately",
    "Do not treat a checkpoint-only readback as semantic recall proof",
    "`memory_set_checkpoint` remains state-only",
    "`memory_agent_checkpoint`"
  ],
  "docs/QUICKSTART.md remote proof taxonomy"
);

mustInclude(
  clientSetup,
  [
    "Remote Readiness Versus Recall Proof",
    "Safe remote existing-project sequence",
    "prove session/context readiness with `memory_start_session` plus `memory_get_context_pack`",
    "optionally prove checkpoint state",
    "prove governed semantic recall",
    "run read-only migration inventory",
    "remote consent/config boundary",
    "`memory_set_checkpoint` followed by `memory_get_checkpoint` proves the current project checkpoint",
    "`memory_create_agent_memory` followed by `memory_recall_agent_memories` proves governed semantic",
    "proof that semantic recall is populated",
    "baseline checkpoint parity contract is state-only",
    "`memory_agent_checkpoint`"
  ],
  "docs/CLIENT_SETUP.md remote proof taxonomy"
);

const remoteBeginnerDocs = [
  ["docs/QUICKSTART.md", quickstart],
  ["docs/CLIENT_SETUP.md", clientSetup],
  ["docs/REMOTE_CONNECT_PLAN.md", remoteConnectPlan]
];
for (const [label, text] of remoteBeginnerDocs) {
  mustNotInclude(
    text,
    [
      "Until universal remote connect is implemented",
      "Until universal connect ships",
      "still needs implementation",
      "the planned beginner remote",
      "planned universal remote connect flow",
      "invite command is the simple path for remote projects"
    ],
    label
  );
}

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
    "Beginner Onboarding Contract",
    "recallant onboard <project>",
    "Database not configured",
    "advanced/debug APIs",
    "recallant attach .",
    "recallant connect codex --project-dir .",
    "recallant doctor --project-dir . --require-capture",
    "recallant agent-start",
    "Documentation Posture And Context Packs",
    "`documentation_posture`",
    "`sections.documentation_posture`",
    "`sections.canon_capability_context`",
    "guidance, not a binding rule",
    "environment facts from accepted project/developer memories or safe project metadata",
    "secret references by name/reference only, without raw values",
    "does not grant live access",
    "full external resource registry",
    "activation, remote resource ingestion",
    "broader registry workflows remain governed future work",
    "`empty`",
    "`healthy`",
    "`needs_attention`",
    "`risky`",
    "documentation strategy surface",
    "Keep current docs, add Recallant layer",
    "Canonicalize docs for Recallant-aware workflow",
    "Create starter docs",
    "Discuss first",
    "`recallant onboard <project>` can now create starter docs",
    "Starter docs always include the base `README.md`, `AGENTS.md`, and `PROJECT_LOG.md`",
    "must not overwrite existing project docs",
    "New Project Bootstrap",
    "Existing Project Migration",
    "prove session/context readiness with `memory_start_session` plus `memory_get_context_pack`",
    "optionally prove checkpoint state with `memory_set_checkpoint` plus `memory_get_checkpoint`",
    "Safe Recallant semantic marker",
    "recallant_safe_semantic_marker_example",
    '"audience": [{ "kind": "all_agents", "id": null }]',
    'Recall it with `query: "recallant_safe_semantic_marker_example"`',
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
    "installed-host one-command MVP",
    "Browser-first project attachment from the Workbench is future work",
    "recallant onboard <project>",
    "Database not configured",
    "Existing-project migration",
    "Capture-active proof",
    "Documentation posture + context routing",
    "System activity ledger and audit reports",
    "Redacted `system_activity_events` schema",
    "recallant audit",
    "Workbench Audit view",
    "project-sanitize de-identification policy",
    "backup inclusion",
    "Working slice with Workbench strategy surface, empty-project starter docs, and minimal canon/capability context",
    "compact `starter_docs` plan/outcome",
    "`sections.canon_capability_context`",
    "environment facts, capability references, secret reference names, server canon link status, and documentation authority labels",
    "empty projects can receive base starter docs plus profile-specific service/product/library docs",
    "`empty`, `healthy`, `needs_attention`, or `risky`",
    "Workbench shows documentation strategy choices plus environment facts",
    "full external resource registry",
    "connector activation",
    "Workbench-confirmed existing-doc rewriting",
    "npm run documentation-posture:smoke",
    "Source, capability, and secret references",
    "Cross-project examples",
    "Safety gates",
    "npm run public-clean-host:smoke",
    "npm run public-quickstart:smoke",
    "npm run public-install-rollback:smoke",
    "npm run security-review:smoke",
    "npm run non-owner-migration:smoke",
    "npm run real-project-pilots:smoke",
    "npm run review-ui:playwright",
    "npm run system-audit:schema-smoke",
    "npm run system-audit:mcp-smoke",
    "npm run system-audit:cli-smoke",
    "npm run system-audit:http-smoke",
    "npm run system-audit:report-smoke",
    "npm run phase8:smoke:backup",
    "Workbench migration review queue",
    "Current Remote Existing-Project Findings",
    '`mode: "remote_mcp_ready"`',
    "`remote-ready, local storage not attached`",
    "session/context readiness",
    "checkpoint readback and governed semantic recall are separate surfaces",
    "baseline checkpoint parity contract is state-only",
    "memory_agent_checkpoint",
    "Remote Existing-Project Release Gate Matrix",
    "Remote MCP ready",
    "Session/context ready",
    "Governed semantic recall",
    "External-machine evidence",
    "Remote live external canary",
    "npm run remote-live-external-canary:smoke",
    "manual remote-client checks",
    "Local `attach --confirm`",
    "Not a remote-next-step",
    "Release-Candidate Bar"
  ],
  "CONTRACT_STATUS"
);
mustInclude(
  contractStatus,
  [
    "universal `curl .../connect \\| bash` beginner UX are present",
    "trusted-device registration/reconnect",
    "headless",
    "bootstrap-token redemption",
    "local credential-store references",
    "GET /connect",
    "/api/connect/start",
    "/api/connect/poll",
    "protected `/connect/approve`",
    "`recallant invite` and `/j/<token>` remain the advanced/admin one-time onboarding fallback",
    "remote live external canary"
  ],
  "CONTRACT_STATUS remote connect"
);
mustNotInclude(
  contractStatus,
  [
    "universal `curl .../connect \\| bash` device-pairing is the planned beginner UX",
    "which still needs implementation"
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

const architecture = await read("docs/ARCHITECTURE.md");
mustInclude(
  architecture,
  [
    "System Activity Ledger",
    "redacted operational record",
    "recallant audit",
    "Workbench Audit view",
    "not a raw traffic log",
    "Backups include it",
    "de-identifies them during confirmed purge"
  ],
  "ARCHITECTURE"
);

const selfHosting = await read("docs/SELF_HOSTING.md");
mustInclude(
  selfHosting,
  [
    "System Activity Audits",
    "recallant audit --project-dir /path/to/project",
    "--surface mcp --status error --format json",
    "system_activity_events",
    "backup-verify",
    "confirmed purge de-identifies"
  ],
  "SELF_HOSTING"
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
    "Public quickstart smoke",
    "Documentation posture analyzer",
    "Documentation posture follow-through",
    "autonomous browser QA",
    "Security review smoke",
    "One-command beginner onboarding hardening",
    "recallant onboard <project>",
    "Autonomous attach polish",
    "Remote existing-project readiness gates",
    "session/context readiness",
    "governed semantic marker recall",
    "external-machine evidence bundles",
    "Remote existing-project pilot hardening",
    "remote live external canary",
    "before manual remote-client",
    "rollback smoke",
    "opt-in Docker-backed managed",
    "Deployment-profile",
    "Codex For OSS Use"
  ],
  "ROADMAP"
);

const remoteProofDocs = [
  ["docs/QUICKSTART.md", quickstart],
  ["docs/CLIENT_SETUP.md", clientSetup],
  ["docs/AGENT_READY_PROJECTS.md", agentReadyProjects],
  ["docs/MCP_SPEC.md", mcpSpec],
  ["docs/CONTRACT_STATUS.md", contractStatus],
  ["docs/ROADMAP.md", roadmap]
];
const checkpointSemanticCollapsePhrases = [
  "checkpoint readback proves semantic recall",
  "checkpoint-only readback proves semantic recall",
  "memory_set_checkpoint proves semantic recall",
  "memory_get_checkpoint proves semantic recall",
  "checkpoint state proves semantic recall",
  "checkpoint state proof is semantic recall proof"
];
const checkpointSemanticCollapsePatterns = [
  /\bcheckpoint(?:-only)?\s+readback\s+proves\s+semantic\s+recall\b/i,
  /\bcheckpoint\s+state\s+proves\s+semantic\s+recall\b/i,
  /\bmemory_set_checkpoint\s+proves\s+semantic\s+recall\b/i,
  /\bmemory_get_checkpoint\s+proves\s+semantic\s+recall\b/i
];
for (const [label, text] of remoteProofDocs) {
  mustNotInclude(text, checkpointSemanticCollapsePhrases, label);
  mustNotMatch(text, checkpointSemanticCollapsePatterns, label);
}

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
assert(
  packageJson.scripts?.["public-quickstart:smoke"] === "node scripts/smoke-public-quickstart.mjs",
  "package.json must expose public-quickstart:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes("npm run public-quickstart:smoke"),
  "smoke:core must include public-quickstart:smoke"
);
assert(
  packageJson.scripts?.["security-review:smoke"] === "node scripts/smoke-security-review.mjs",
  "package.json must expose security-review:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes("npm run security-review:smoke"),
  "smoke:core must include security-review:smoke"
);
assert(
  packageJson.scripts?.["documentation-posture:smoke"] ===
    "node scripts/smoke-documentation-posture.mjs",
  "package.json must expose documentation-posture:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes("npm run documentation-posture:smoke"),
  "smoke:core must include documentation-posture:smoke"
);
assert(
  packageJson.scripts?.["remote-live-external-canary"] ===
    "node scripts/remote-live-external-canary.mjs",
  "package.json must expose remote-live-external-canary"
);
assert(
  packageJson.scripts?.["remote-live-external-canary:smoke"] ===
    "node scripts/smoke-remote-live-external-canary.mjs",
  "package.json must expose remote-live-external-canary:smoke"
);
assert(
  String(packageJson.scripts?.["smoke:core"] ?? "").includes(
    "npm run remote-live-external-canary:smoke"
  ),
  "smoke:core must include remote-live-external-canary:smoke"
);

const remoteMcpLiveReadiness = readFileSync(
  join(repoRoot, "scripts", "smoke-remote-mcp-live-readiness.mjs"),
  "utf8"
);
mustInclude(
  remoteMcpLiveReadiness,
  [
    "skipped_live_remote_mcp_readiness",
    "operator_live_remote_mcp_env_not_provided",
    "failed_live_remote_mcp_readiness_input",
    "required_env",
    "coverage_model"
  ],
  "scripts/smoke-remote-mcp-live-readiness.mjs"
);
const remoteConnectLiveReadiness = readFileSync(
  join(repoRoot, "scripts", "smoke-remote-connect-live-readiness.mjs"),
  "utf8"
);
mustInclude(
  remoteConnectLiveReadiness,
  [
    "skipped_live_remote_connect_readiness",
    "blocked_live_remote_connect_readiness_input",
    "RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL",
    "coverage_model",
    "deterministic_fixture"
  ],
  "scripts/smoke-remote-connect-live-readiness.mjs"
);

function runDoctorFixture(projectDir, doctorEnv, label) {
  const token = Math.random().toString(36).slice(2);
  const stdoutPath = join(projectDir, `.smoke-doctor-${token}-stdout.txt`);
  const stderrPath = join(projectDir, `.smoke-doctor-${token}-stderr.txt`);
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "doctor", "--project-dir", projectDir, "--format", "json"],
    {
      cwd: repoRoot,
      env: doctorEnv,
      stdio: ["ignore", stdoutFd, stderrFd]
    }
  );

  closeSync(stdoutFd);
  closeSync(stderrFd);

  let stdout = "";
  let stderr = "";
  try {
    stdout = readFileSync(stdoutPath, "utf8");
    stderr = readFileSync(stderrPath, "utf8");
  } finally {
    try {
      unlinkSync(stdoutPath);
    } catch {
      // best effort cleanup
    }
    try {
      unlinkSync(stderrPath);
    } catch {
      // best effort cleanup
    }
  }

  if (result.error) throw result.error;
  const code = result.status ?? 0;
  if (code !== 0) {
    throw new Error(
      `${label} fixture failed; exit_code=${code}; stdout_length=${stdout.length}; stderr=${fixtureStderrExcerpt(
        stderr
      )}; stdout_excerpt=${stdout.slice(0, 1000)}`
    );
  }

  const parsed = parseDoctorFixtureJson(stdout, stderr, code, label);
  return parsed.production_readiness;
}

async function runDoctorWithOrigin(projectDir, originUrl, extraEnv = {}) {
  const parsed = runDoctorFixture(
    projectDir,
    {
      ...process.env,
      RECALLANT_DATABASE_URL: "",
      RECALLANT_ENV_FILE: join(projectDir, "missing-recallant.env"),
      RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
      RECALLANT_PUBLIC_WORKBENCH_URL: "https://recallant.example.invalid/review",
      RECALLANT_WORKBENCH_ORIGIN_URL: originUrl,
      RECALLANT_CLOUDFLARE_MODE: "enabled",
      RECALLANT_CLOUDFLARE_EDGE_AUTH: "required",
      RECALLANT_ADMIN_EMAILS: "admin@example.invalid",
      ...extraEnv
    },
    "doctor public readiness fixture"
  );

  return parsed?.public_workbench_readiness;
}

async function runServiceRuntimeFixture(projectDir, extraEnv = {}) {
  const parsed = runDoctorFixture(
    projectDir,
    {
      ...process.env,
      RECALLANT_DATABASE_URL: "",
      RECALLANT_ENV_FILE: join(projectDir, "missing-recallant.env"),
      RECALLANT_DISABLE_SYSTEMD_ENV_DISCOVERY: "true",
      RECALLANT_SERVICE_ACTIVE_STATUS: "active",
      RECALLANT_SERVICE_ENABLED_STATUS: "enabled",
      RECALLANT_SERVICE_RESTART_POLICY: "on-failure",
      RECALLANT_HOST: "127.0.0.1",
      RECALLANT_SERVICE_HEALTH_STATUS: "200",
      RECALLANT_PUBLIC_WORKBENCH_ROUTE_STATUS: "302",
      ...extraEnv
    },
    "doctor service runtime fixture"
  );

  return parsed?.service_runtime;
}

const publicUiFixtureDir = await mkdtemp(join(tmpdir(), "recallant-public-ui-readiness-"));
const publicBindHost = ["0", "0", "0", "0"].join(".");
const closedOriginUrl = "http://127.0.0.1:1/review";
const notConfigured = await runDoctorWithOrigin(publicUiFixtureDir, "", {
  RECALLANT_PUBLIC_WORKBENCH_URL: "",
  RECALLANT_WORKBENCH_ORIGIN_URL: "",
  RECALLANT_CLOUDFLARE_MODE: "disabled",
  RECALLANT_CLOUDFLARE_EDGE_AUTH: "",
  RECALLANT_ADMIN_EMAILS: ""
});
assert(
  notConfigured?.status === "not_configured" &&
    notConfigured?.configured === false &&
    notConfigured?.ready === false,
  `Unconfigured readiness did not report not_configured: ${JSON.stringify(notConfigured)}`
);

const downReadiness = await runDoctorWithOrigin(publicUiFixtureDir, closedOriginUrl);
assert(
  downReadiness?.status === "origin_unreachable" &&
    downReadiness?.origin?.status === "down" &&
    downReadiness?.ready === false,
  `Down-origin readiness did not report origin_unreachable: ${JSON.stringify(downReadiness)}`
);
assert(
  !String(downReadiness.operator_action ?? "").includes(publicBindHost),
  `Down-origin action must not recommend public bind: ${downReadiness.operator_action}`
);

const authReady = await runDoctorWithOrigin(publicUiFixtureDir, closedOriginUrl, {
  RECALLANT_WORKBENCH_ORIGIN_STATUS: "401"
});
assert(
  authReady?.status === "auth_ready" &&
    authReady?.ready === true &&
    authReady?.origin?.status === "auth_required" &&
    authReady?.cloudflare_access?.edge_auth_required === true,
  `Auth-ready readiness failed: ${JSON.stringify(authReady)}`
);
assert(
  String(authReady.operator_action ?? "").includes("protected public URL") &&
    !String(authReady.operator_action ?? "").includes(publicBindHost),
  `Auth-ready operator action is unsafe or unclear: ${authReady.operator_action}`
);

const missingEdgeAuth = await runDoctorWithOrigin(publicUiFixtureDir, closedOriginUrl, {
  RECALLANT_WORKBENCH_ORIGIN_STATUS: "401",
  RECALLANT_CLOUDFLARE_EDGE_AUTH: "disabled"
});
assert(
  missingEdgeAuth?.status === "cloudflare_access_not_required" && missingEdgeAuth?.ready === false,
  `Missing edge auth should not be public-ready: ${JSON.stringify(missingEdgeAuth)}`
);

const anonymousOrigin = await runDoctorWithOrigin(publicUiFixtureDir, closedOriginUrl, {
  RECALLANT_WORKBENCH_ORIGIN_STATUS: "200"
});
assert(
  anonymousOrigin?.status === "origin_allows_anonymous_access" &&
    anonymousOrigin?.origin?.status === "anonymous_access" &&
    anonymousOrigin?.ready === false,
  `Anonymous origin should not be public-ready: ${JSON.stringify(anonymousOrigin)}`
);

const runtimeReady = await runServiceRuntimeFixture(publicUiFixtureDir);
assert(
  runtimeReady?.status === "ready" &&
    runtimeReady?.ok === true &&
    runtimeReady?.health?.status === "healthy" &&
    runtimeReady?.public_route?.status === "auth_required",
  `Runtime ready fixture failed: ${JSON.stringify(runtimeReady)}`
);
const runtimeInactive = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_SERVICE_ACTIVE_STATUS: "inactive"
});
assert(
  runtimeInactive?.status === "service_inactive" && runtimeInactive?.ok === false,
  `Runtime inactive fixture failed: ${JSON.stringify(runtimeInactive)}`
);
const runtimeDisabled = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_SERVICE_ENABLED_STATUS: "disabled"
});
assert(
  runtimeDisabled?.status === "service_disabled" && runtimeDisabled?.ok === false,
  `Runtime disabled fixture failed: ${JSON.stringify(runtimeDisabled)}`
);
const runtimeWrongBind = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_HOST: publicBindHost
});
assert(
  runtimeWrongBind?.status === "wrong_bind_host" && runtimeWrongBind?.bind?.private === false,
  `Runtime wrong-bind fixture failed: ${JSON.stringify(runtimeWrongBind)}`
);
const runtimeMissingEnv = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_SERVICE_ENV_FILE: join(publicUiFixtureDir, "missing-service.env")
});
assert(
  runtimeMissingEnv?.status === "service_env_missing" && runtimeMissingEnv?.ok === false,
  `Runtime missing-env fixture failed: ${JSON.stringify(runtimeMissingEnv)}`
);
const runtimeHealthFailed = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_SERVICE_HEALTH_STATUS: "503"
});
assert(
  runtimeHealthFailed?.status === "health_failed" &&
    runtimeHealthFailed?.health?.status === "unhealthy",
  `Runtime health-failed fixture failed: ${JSON.stringify(runtimeHealthFailed)}`
);
const runtimeBadGateway = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_PUBLIC_WORKBENCH_ROUTE_STATUS: "502"
});
assert(
  runtimeBadGateway?.status === "public_bad_gateway" &&
    runtimeBadGateway?.public_route?.status === "bad_gateway",
  `Runtime bad-gateway fixture failed: ${JSON.stringify(runtimeBadGateway)}`
);
const runtimeAnonymousPublic = await runServiceRuntimeFixture(publicUiFixtureDir, {
  RECALLANT_PUBLIC_WORKBENCH_ROUTE_STATUS: "200"
});
assert(
  runtimeAnonymousPublic?.status === "public_anonymous_access" &&
    runtimeAnonymousPublic?.public_route?.status === "anonymous_access",
  `Runtime public-anonymous fixture failed: ${JSON.stringify(runtimeAnonymousPublic)}`
);

const remoteExistingProjectDocsSummary = {
  "docs/QUICKSTART.md": [
    "remote_mcp_ready",
    "session_context_readiness",
    "checkpoint_state_optional",
    "governed_semantic_marker_proof",
    "guided_migration_after_owner_approval"
  ],
  "docs/CLIENT_SETUP.md": [
    "safe_remote_existing_project_sequence",
    "capture_proof_is_session_context_only",
    "checkpoint_state_is_not_semantic_recall",
    "no_local_attach_confirm_as_remote_next_step"
  ],
  "docs/AGENT_READY_PROJECTS.md": [
    "read_only_inventory",
    "risk_classification",
    "owner_approval",
    "concise_governed_memories",
    "recall_verification"
  ],
  "docs/MCP_SPEC.md": ["semantic_proof", "governed_memory_tool_ux", "checkpoint_parity_state_only"]
};
const publicReadinessMarkers = {
  remote_sequence_guard: "pass",
  checkpoint_semantic_collapse_guard: "pass",
  live_readiness_gates_are_opt_in: "pass",
  public_private_boundary_markers: "pass"
};
const releaseGateMatrix = {
  mandatory: [
    "remote_mcp_ready",
    "session_context_ready",
    "governed_semantic_marker_recall",
    "read_only_inventory_owner_approval",
    "redacted_external_machine_evidence",
    "public_readiness_and_security_smokes"
  ],
  optional: [
    "checkpoint_state_proof",
    "searchable_checkpoint_memory",
    "live_central_server_readiness_smokes",
    "local_attach_confirm_for_server_local_projects"
  ]
};

process.stdout.write(
  `${JSON.stringify(
    {
      remote_existing_project_docs: remoteExistingProjectDocsSummary,
      public_readiness_markers: publicReadinessMarkers,
      release_gate_matrix: releaseGateMatrix,
      public_workbench_readiness: {
        not_configured: {
          status: notConfigured.status,
          ready: notConfigured.ready
        },
        down_origin: {
          status: downReadiness.status,
          ready: downReadiness.ready,
          origin: downReadiness.origin.status
        },
        auth_ready: {
          status: authReady.status,
          ready: authReady.ready,
          origin: authReady.origin.status,
          edge_auth_required: authReady.cloudflare_access.edge_auth_required
        },
        missing_edge_auth: {
          status: missingEdgeAuth.status,
          ready: missingEdgeAuth.ready
        },
        anonymous_origin: {
          status: anonymousOrigin.status,
          ready: anonymousOrigin.ready,
          origin: anonymousOrigin.origin.status
        }
      },
      service_runtime: {
        ready: {
          status: runtimeReady.status,
          health: runtimeReady.health.status,
          public_route: runtimeReady.public_route.status
        },
        inactive: { status: runtimeInactive.status, ok: runtimeInactive.ok },
        disabled: { status: runtimeDisabled.status, ok: runtimeDisabled.ok },
        wrong_bind: { status: runtimeWrongBind.status, private: runtimeWrongBind.bind.private },
        missing_env: { status: runtimeMissingEnv.status, ok: runtimeMissingEnv.ok },
        health_503: {
          status: runtimeHealthFailed.status,
          health: runtimeHealthFailed.health.status
        },
        public_502: {
          status: runtimeBadGateway.status,
          public_route: runtimeBadGateway.public_route.status
        },
        public_anonymous: {
          status: runtimeAnonymousPublic.status,
          public_route: runtimeAnonymousPublic.public_route.status
        }
      }
    },
    null,
    2
  )}\n`
);

const forbiddenPrivateMarkers = [
  ["/ai", "SECURITY"].join("/"),
  ["/ai", "PORTS.yaml"].join("/"),
  ["/opt", "secure-configs"].join("/"),
  ["unicloud", "ca"].join("."),
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

const dryRun = spawnSync(
  "/bin/bash",
  ["scripts/install-recallant.sh", "--dry-run", "--profile", "single-user"],
  {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8"
  }
);
if (dryRun.error?.code !== "EPERM") {
  if (dryRun.error) throw dryRun.error;
  assert(dryRun.status === 0, `single-user dry-run failed\n${dryRun.stderr}\n${dryRun.stdout}`);
  mustInclude(
    dryRun.stdout,
    ["Recallant install plan", "profile: single-user", "dry_run: true"],
    "installer dry-run"
  );
}

process.stdout.write("Public readiness smoke passed\n");
