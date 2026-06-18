import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  analyzeProjectDocumentationPosture,
  onboardDocumentationPostureStatuses,
  planStarterDocs,
  summarizeDocumentationPostureForOnboard
} = await import("../apps/cli/dist/documentation-posture.js");

const queuedAiResponses = [];
const seenAiRequests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mockAiFetch(url, init) {
  const requestUrl = new globalThis.URL(String(url));
  assert(requestUrl.pathname === "/api/chat", `Unexpected AI URL: ${requestUrl.href}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  seenAiRequests.push(body);
  const next = queuedAiResponses.shift();
  if (!next) {
    return new globalThis.Response(JSON.stringify({ error: "no queued AI response" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const content = typeof next === "string" ? next : JSON.stringify(next);
  return new globalThis.Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fixture(name) {
  return mkdtemp(join(tmpdir(), `recallant-doc-posture-${name}-`));
}

function hasSignal(posture, code) {
  return posture.signals.some((signal) => signal.code === code);
}

function missing(posture, label) {
  return posture.missing_recommended_docs.some((item) => item.includes(label));
}

function starterPlanFor(profile, existingTargetPaths = []) {
  return planStarterDocs({
    projectName: `starter-${profile}`,
    posture: {
      ...emptyPosture,
      profile
    },
    existingTargetPaths
  });
}

function starterPaths(plan) {
  return plan.files.map((file) => file.path).sort();
}

function assertStarterPaths(plan, expected, label) {
  const actual = starterPaths(plan);
  assert(
    JSON.stringify(actual) === JSON.stringify([...expected].sort()),
    `${label} starter paths mismatch: ${JSON.stringify(actual)}`
  );
}

function assertNoPrivateTemplateMarkers(plan, label) {
  const serialized = JSON.stringify(plan);
  const forbiddenMarkers = [
    `/${"ai"}/`,
    `${"uni"}${"cloud"}`,
    `${"recallant"}-${"internal"}`,
    `${"API"}_${"SECRET"}=`,
    `${"sk"}-`
  ];
  for (const marker of forbiddenMarkers) {
    assert(!serialized.includes(marker), `${label} starter template leaked marker ${marker}`);
  }
}

async function analyzeNoWrite(projectDir) {
  const beforeConfig = await exists(join(projectDir, ".recallant", "config"));
  const posture = await analyzeProjectDocumentationPosture(projectDir);
  const afterConfig = await exists(join(projectDir, ".recallant", "config"));
  assert(beforeConfig === false && afterConfig === false, "Analyzer created .recallant/config");
  assert(posture.writes_files === false, "Analyzer claimed file writes");
  assert(posture.writes_database === false, "Analyzer claimed database writes");
  return posture;
}

const emptyProject = await fixture("empty");
const emptyPosture = await analyzeNoWrite(emptyProject);
assert(emptyPosture.status === "docs_absent", `Empty project status failed: ${emptyPosture.status}`);
assert(
  summarizeDocumentationPostureForOnboard(emptyPosture).status === "empty",
  `Empty project summary status failed: ${JSON.stringify(
    summarizeDocumentationPostureForOnboard(emptyPosture)
  )}`
);
assert(hasSignal(emptyPosture, "docs_absent"), "Empty project missing docs_absent signal");
assert(missing(emptyPosture, "README.md"), "Empty project missing README recommendation");
assert(missing(emptyPosture, "AGENTS.md"), "Empty project missing AGENTS recommendation");

const starterUnknown = starterPlanFor("unknown");
assert(starterUnknown.status === "ready", `Unknown starter plan not ready: ${JSON.stringify(starterUnknown)}`);
assert(starterUnknown.eligible_for_apply === true, "Unknown starter plan should be eligible");
assert(starterUnknown.writes_files === false, "Starter plan should stay read-only before apply");
assertStarterPaths(
  starterUnknown,
  ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
  "unknown"
);
assertNoPrivateTemplateMarkers(starterUnknown, "unknown");

const starterService = starterPlanFor("service_app");
assertStarterPaths(
  starterService,
  ["README.md", "AGENTS.md", "PROJECT_LOG.md", "docs/RUNBOOK.md", "docs/ARCHITECTURE.md"],
  "service"
);
assertNoPrivateTemplateMarkers(starterService, "service");

const starterProduct = starterPlanFor("product_roadmap");
assertStarterPaths(
  starterProduct,
  ["README.md", "AGENTS.md", "PROJECT_LOG.md", "docs/STATUS.md", "docs/DECISIONS.md"],
  "product"
);
assertNoPrivateTemplateMarkers(starterProduct, "product");

const starterLibrary = starterPlanFor("library_package");
assertStarterPaths(
  starterLibrary,
  ["README.md", "AGENTS.md", "PROJECT_LOG.md", "docs/API.md"],
  "library"
);
assertNoPrivateTemplateMarkers(starterLibrary, "library");

const starterConflict = starterPlanFor("service_app", ["README.md"]);
assert(
  starterConflict.status === "targets_exist" &&
    starterConflict.eligible_for_apply === false &&
    starterConflict.skipped_files.some((file) => file.path === "README.md") &&
    starterConflict.writes_files === false,
  `Starter conflict plan failed: ${JSON.stringify(starterConflict)}`
);

const readmeProject = await fixture("readme");
await writeFile(join(readmeProject, "README.md"), "# README-only fixture\n");
const readmePosture = await analyzeNoWrite(readmeProject);
assert(
  readmePosture.status === "readme_only",
  `README-only status failed: ${JSON.stringify(readmePosture)}`
);
assert(
  summarizeDocumentationPostureForOnboard(readmePosture).status === "needs_attention",
  `README-only summary status failed: ${JSON.stringify(
    summarizeDocumentationPostureForOnboard(readmePosture)
  )}`
);
assert(hasSignal(readmePosture, "readme_only"), "README-only signal missing");
assert(hasSignal(readmePosture, "missing_agent_docs"), "README-only missing agent-doc signal");
assert(missing(readmePosture, "RUNBOOK"), "README-only missing runbook recommendation");
const starterReadmeOnly = planStarterDocs({
  projectName: "readme-only",
  posture: readmePosture,
  existingTargetPaths: ["README.md"]
});
assert(
  starterReadmeOnly.status === "not_empty" &&
    starterReadmeOnly.eligible_for_apply === false &&
    starterReadmeOnly.writes_files === false,
  `README-only starter plan should not be auto-applicable: ${JSON.stringify(starterReadmeOnly)}`
);

const staleProject = await fixture("stale");
await mkdir(join(staleProject, ".cursor"), { recursive: true });
await writeFile(join(staleProject, "README.md"), "# Stale service\n");
await writeFile(join(staleProject, "AGENTS.md"), "# Agent Notes\n\nAlways read the old handoff.\n");
await writeFile(
  join(staleProject, ".cursor", "SESSION_HANDOFF.md"),
  "# Session Archive\n\n2026-01-01 old handoff\n2026-01-02 old handoff\n"
);
await writeFile(
  join(staleProject, "PROJECT_LOG.md"),
  `${Array.from({ length: 900 }, (_, index) => `## 2026-01-${String((index % 28) + 1).padStart(2, "0")}\nHistorical log entry ${index}`).join("\n")}\n`
);
const stalePosture = await analyzeNoWrite(staleProject);
assert(hasSignal(stalePosture, "stale_handoff"), "Stale handoff signal missing");
assert(hasSignal(stalePosture, "oversized_project_log"), "Oversized PROJECT_LOG signal missing");
assert(
  hasSignal(stalePosture, "agent_docs_without_recallant_workflow"),
  "Agent docs without Recallant workflow signal missing"
);
const oversized = stalePosture.signals.find((signal) => signal.code === "oversized_project_log");
assert(
  oversized?.sources?.[0]?.size_bytes > 32_000 && oversized.sources[0].line_count > 0,
  `Oversized signal did not include size/line evidence: ${JSON.stringify(oversized)}`
);

const productionProject = await fixture("production");
await mkdir(join(productionProject, "docs"), { recursive: true });
await writeFile(
  join(productionProject, "README.md"),
  "# Production service\n\nDeploys a public Cloudflare protected systemd service on a server.\n"
);
await writeFile(
  join(productionProject, "docs", "RUNBOOK.md"),
  "# Runbook\n\nProduction deploy, server runtime, ports, and Cloudflare Access.\n"
);
await writeFile(join(productionProject, ".env.example"), "API_SECRET=fixture-secret-value\n");
const productionPosture = await analyzeNoWrite(productionProject);
assert(
  productionPosture.status === "needs_review",
  `Production detailed status changed: ${JSON.stringify(productionPosture)}`
);
assert(
  summarizeDocumentationPostureForOnboard(productionPosture).status === "risky",
  `Production summary status failed: ${JSON.stringify(
    summarizeDocumentationPostureForOnboard(productionPosture)
  )}`
);
assert(hasSignal(productionPosture, "production_or_server_hint"), "Production/server signal missing");
assert(hasSignal(productionPosture, "canon_links_needed"), "Canon-needed signal missing");
assert(productionPosture.canon_context.needed === true, "Canon context should be needed");
assert(
  productionPosture.canon_context.recommended_reference_kinds.includes("security_baseline") &&
    productionPosture.canon_context.recommended_reference_kinds.includes("ports_inventory"),
  `Canon reference kinds incomplete: ${JSON.stringify(productionPosture.canon_context)}`
);
const serializedProduction = JSON.stringify(productionPosture);
assert(
  !serializedProduction.includes("fixture-secret-value"),
  `Posture leaked secret-like value: ${serializedProduction}`
);

queuedAiResponses.push({
  profile: "library_package",
  confidence: 0.96,
  summary: "Mock AI intentionally misclassified a production service as a package.",
  review_needed_reason: null
});
const productionAiPosture = await analyzeProjectDocumentationPosture(productionProject, {
  ai: {
    enabled: true,
    model: "mock-doc-posture:latest",
    url: "http://mock-ollama.local",
    fetchImpl: mockAiFetch
  }
});
assert(productionAiPosture.analysis_source === "local_ai", "High-confidence AI was not used");
assert(productionAiPosture.profile === "library_package", "AI profile was not recorded");
assert(
  productionAiPosture.status === "needs_review" &&
    hasSignal(productionAiPosture, "production_or_server_hint") &&
    hasSignal(productionAiPosture, "canon_links_needed"),
  `Safety overlay failed to preserve production/canon signals: ${JSON.stringify(
    productionAiPosture
  )}`
);
const productionAiRequest = seenAiRequests.at(-1);
const productionAiInput = productionAiRequest.messages.at(-1).content;
assert(
  productionAiInput.length <= 6_000 && !productionAiInput.includes("fixture-secret-value"),
  `AI input was not bounded/redacted: ${productionAiInput}`
);

const recallantReadyProject = await fixture("ready");
await mkdir(join(recallantReadyProject, "docs"), { recursive: true });
await writeFile(join(recallantReadyProject, "README.md"), "# Ready docs\n");
await writeFile(
  join(recallantReadyProject, "AGENTS.md"),
  "# Agent Instructions\n\n## Memory (Recallant)\n\nCall memory_start_session and memory_get_context_pack.\n"
);
await writeFile(join(recallantReadyProject, "PROJECT_LOG.md"), "# Project Log\n\nCurrent state.\n");
await writeFile(join(recallantReadyProject, "docs", "RUNBOOK.md"), "# Runbook\n");
await writeFile(join(recallantReadyProject, "docs", "ARCHITECTURE.md"), "# Architecture\n");
const readyPosture = await analyzeNoWrite(recallantReadyProject);
assert(
  readyPosture.status === "recallant_ready",
  `Ready detailed status changed: ${JSON.stringify(readyPosture)}`
);
assert(
  summarizeDocumentationPostureForOnboard(readyPosture).status === "healthy",
  `Ready summary status failed: ${JSON.stringify(summarizeDocumentationPostureForOnboard(readyPosture))}`
);
assert(!hasSignal(readyPosture, "missing_recallant_workflow"), "Ready docs should have Recallant workflow");
assert(
  readyPosture.existing_docs.includes("docs/ARCHITECTURE.md") &&
    readyPosture.existing_docs.includes("docs/RUNBOOK.md"),
  `Ready docs inventory incomplete: ${JSON.stringify(readyPosture.existing_docs)}`
);

const aiProject = await fixture("ai");
await mkdir(join(aiProject, "docs"), { recursive: true });
await writeFile(
  join(aiProject, "README.md"),
  "# Product workspace\n\nRoadmap, milestones, and user-facing product decisions.\n"
);
await writeFile(
  join(aiProject, "docs", "STATUS.md"),
  "# Status\n\nCurrent roadmap and product milestone state.\n"
);
await writeFile(join(aiProject, ".env.example"), "PRODUCT_API_TOKEN=fixture-ai-secret\n");
queuedAiResponses.push({
  profile: "product_roadmap",
  confidence: 0.91,
  summary: "Mock AI classified this as product roadmap documentation.",
  review_needed_reason: null
});
const highConfidenceAi = await analyzeProjectDocumentationPosture(aiProject, {
  ai: {
    enabled: true,
    model: "mock-doc-posture:latest",
    url: "http://mock-ollama.local",
    fetchImpl: mockAiFetch
  }
});
assert(
  highConfidenceAi.analysis_source === "local_ai" &&
    highConfidenceAi.ai.status === "used" &&
    highConfidenceAi.ai.provider === "ollama" &&
    highConfidenceAi.ai.model === "mock-doc-posture:latest" &&
    highConfidenceAi.profile === "product_roadmap" &&
    highConfidenceAi.confidence === 0.91,
  `High-confidence AI result failed: ${JSON.stringify(highConfidenceAi)}`
);
const highAiInput = seenAiRequests.at(-1).messages.at(-1).content;
assert(
  !highAiInput.includes("fixture-ai-secret") && highAiInput.length <= 6_000,
  `High-confidence AI input leaked raw docs/secrets: ${highAiInput}`
);

queuedAiResponses.push({
  profile: "service_app",
  confidence: 0.41,
  summary: "Mock low-confidence classification.",
  review_needed_reason: "Low confidence."
});
const lowConfidenceAi = await analyzeProjectDocumentationPosture(readmeProject, {
  ai: {
    enabled: true,
    model: "mock-doc-posture:latest",
    url: "http://mock-ollama.local",
    minConfidence: 0.7,
    fetchImpl: mockAiFetch
  }
});
assert(
  lowConfidenceAi.analysis_source === "rules" &&
    lowConfidenceAi.ai.status === "low_confidence" &&
    lowConfidenceAi.review_needed_reason,
  `Low-confidence AI did not fall back safely: ${JSON.stringify(lowConfidenceAi)}`
);

queuedAiResponses.push("this is not json");
const malformedAi = await analyzeProjectDocumentationPosture(readmeProject, {
  ai: {
    enabled: true,
    model: "mock-doc-posture:latest",
    url: "http://mock-ollama.local",
    fetchImpl: mockAiFetch
  }
});
assert(
  malformedAi.analysis_source === "rules" && malformedAi.ai.status === "malformed",
  `Malformed AI did not fall back safely: ${JSON.stringify(malformedAi)}`
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      onboard_summary_statuses: {
        contract: onboardDocumentationPostureStatuses,
        empty: summarizeDocumentationPostureForOnboard(emptyPosture).status,
        readme_only: summarizeDocumentationPostureForOnboard(readmePosture).status,
        production: summarizeDocumentationPostureForOnboard(productionPosture).status,
        recallant_ready: summarizeDocumentationPostureForOnboard(readyPosture).status
      },
      cases: {
        empty: emptyPosture.status,
        readme_only: readmePosture.status,
        stale: stalePosture.status,
        production: productionPosture.status,
        recallant_ready: readyPosture.status
      },
      requested_signals: {
        docs_absent: hasSignal(emptyPosture, "docs_absent"),
        readme_only: hasSignal(readmePosture, "readme_only"),
        stale_handoff: hasSignal(stalePosture, "stale_handoff"),
        oversized_project_log: hasSignal(stalePosture, "oversized_project_log"),
        agent_docs_without_recallant_workflow: hasSignal(
          stalePosture,
          "agent_docs_without_recallant_workflow"
        ),
        production_or_server_hint: hasSignal(productionPosture, "production_or_server_hint"),
        canon_links_needed: hasSignal(productionPosture, "canon_links_needed")
      },
      starter_docs: {
        unknown: {
          status: starterUnknown.status,
          writes_files: starterUnknown.writes_files,
          files: starterPaths(starterUnknown)
        },
        service_app: starterPaths(starterService),
        product_roadmap: starterPaths(starterProduct),
        library_package: starterPaths(starterLibrary),
        conflict: {
          status: starterConflict.status,
          eligible_for_apply: starterConflict.eligible_for_apply,
          skipped_files: starterConflict.skipped_files.map((file) => file.path)
        },
        readme_only: {
          status: starterReadmeOnly.status,
          eligible_for_apply: starterReadmeOnly.eligible_for_apply
        },
        private_marker_free: [starterUnknown, starterService, starterProduct, starterLibrary].every(
          (plan) => {
            const serialized = JSON.stringify(plan);
            return [`/${"ai"}/`, `${"uni"}${"cloud"}`, `${"recallant"}-${"internal"}`].every(
              (marker) => !serialized.includes(marker)
            );
          }
        )
      },
      no_write: true,
      ai: {
        requests: seenAiRequests.length,
        input_sample: {
          chars: productionAiInput.length,
          excerpt: productionAiInput.slice(0, 360),
          leaked_fixture_secret: productionAiInput.includes("fixture-secret-value")
        },
        high_confidence: {
          source: highConfidenceAi.analysis_source,
          profile: highConfidenceAi.profile,
          status: highConfidenceAi.ai.status
        },
        low_confidence: {
          source: lowConfidenceAi.analysis_source,
          status: lowConfidenceAi.ai.status,
          review_needed: Boolean(lowConfidenceAi.review_needed_reason)
        },
        malformed: {
          source: malformedAi.analysis_source,
          status: malformedAi.ai.status
        },
        safety_overlay: {
          source: productionAiPosture.analysis_source,
          ai_profile: productionAiPosture.profile,
          deterministic_status: productionAiPosture.status,
          canon_preserved: hasSignal(productionAiPosture, "canon_links_needed")
        }
      },
      sample_production_posture: {
        status: productionPosture.status,
        profile: productionPosture.profile,
        missing_recommended_docs: productionPosture.missing_recommended_docs,
        canon_context: productionPosture.canon_context,
        signal_codes: productionPosture.signals.map((signal) => signal.code)
      }
    },
    null,
    2
  )}\n`
);
