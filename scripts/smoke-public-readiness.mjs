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
    "bash -s -- --onboard .",
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
    "Make This Project Agent-Ready",
    "bash -s -- --onboard .",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "recallant onboard /path/to/project",
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
  String(packageJson.scripts?.["smoke:core"] ?? "").includes(
    "npm run documentation-posture:smoke"
  ),
  "smoke:core must include documentation-posture:smoke"
);

function runDoctorFixture(projectDir, doctorEnv, label) {
  const token = Math.random().toString(36).slice(2);
  const stdoutPath = join(projectDir, `.smoke-doctor-${token}-stdout.txt`);
  const stderrPath = join(projectDir, `.smoke-doctor-${token}-stderr.txt`);
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "doctor", "--project-dir", projectDir, "--format", "json"], {
    cwd: repoRoot,
    env: doctorEnv,
    stdio: ["ignore", stdoutFd, stderrFd]
  });

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
  const parsed = runDoctorFixture(projectDir, {
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
  }, "doctor public readiness fixture");

  return parsed?.public_workbench_readiness;
}

async function runServiceRuntimeFixture(projectDir, extraEnv = {}) {
  const parsed = runDoctorFixture(projectDir, {
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
  }, "doctor service runtime fixture");

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

process.stdout.write(
  `${JSON.stringify(
    {
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
