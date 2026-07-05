import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type DiscoveryCandidate, detectImportCandidates } from "./discovery.js";

export type DocumentationPostureStatus =
  | "docs_absent"
  | "readme_only"
  | "partial"
  | "needs_review"
  | "recallant_ready";

export const onboardDocumentationPostureStatuses = [
  "empty",
  "healthy",
  "needs_attention",
  "risky"
] as const;

export type OnboardDocumentationPostureStatus =
  (typeof onboardDocumentationPostureStatuses)[number];

export type DocumentationProfile =
  | "unknown"
  | "service_app"
  | "library_package"
  | "product_roadmap";

export type DocumentationPostureSignalCode =
  | "docs_absent"
  | "readme_only"
  | "missing_agent_docs"
  | "missing_status_doc"
  | "missing_runbook"
  | "missing_architecture"
  | "missing_recallant_workflow"
  | "stale_handoff"
  | "oversized_project_log"
  | "agent_docs_without_recallant_workflow"
  | "production_or_server_hint"
  | "canon_links_needed";

export type DocumentationPostureSignal = {
  code: DocumentationPostureSignalCode;
  severity: "info" | "warning" | "high";
  message: string;
  sources: DocumentationPostureSourceRef[];
};

export type DocumentationPostureSourceRef = {
  path: string;
  sha256: string | null;
  size_bytes: number | null;
  line_count: number | null;
  redacted: boolean;
};

export type DocumentationPosture = {
  status: DocumentationPostureStatus;
  profile: DocumentationProfile;
  analysis_source: "rules" | "local_ai";
  confidence: number;
  summary: string;
  review_needed_reason: string | null;
  ai: {
    status: "disabled" | "used" | "unavailable" | "low_confidence" | "malformed";
    provider: "ollama";
    model: string | null;
    input_chars: number;
    error: string | null;
  };
  existing_docs: string[];
  missing_recommended_docs: string[];
  signals: DocumentationPostureSignal[];
  review_options: Array<{
    option:
      | "keep_current_docs"
      | "canonicalize_for_recallant"
      | "create_starter_docs"
      | "discuss_first";
    recommended: boolean;
    reason: string;
  }>;
  canon_context: {
    needed: boolean;
    reason: string | null;
    recommended_reference_kinds: Array<"security_baseline" | "ports_inventory">;
    configured_references: string[];
  };
  writes_files: false;
  writes_database: false;
  source_summary: {
    candidate_count: number;
    redacted_source_count: number;
  };
};

export const documentationPostureSettingKey = "documentation_posture";

export type DocumentationPostureInput = {
  projectDir: string;
  candidates: readonly DiscoveryCandidate[];
  supplementalDocPaths?: readonly string[];
};

export type DocumentationPostureAiOptions = {
  enabled?: boolean;
  provider?: "ollama";
  model?: string;
  url?: string;
  minConfidence?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type StarterDocsPlanStatus = "ready" | "not_empty" | "targets_exist" | "unsupported_profile";

export type StarterDocsPlanFileKind =
  | "readme"
  | "agent_instructions"
  | "project_log"
  | "runbook"
  | "architecture"
  | "status"
  | "decisions"
  | "api";

export type StarterDocsPlanFile = {
  path: string;
  kind: StarterDocsPlanFileKind;
  profile: DocumentationProfile | "base";
  required: boolean;
  content: string;
};

export type StarterDocsPlan = {
  schema_version: 1;
  status: StarterDocsPlanStatus;
  profile: DocumentationProfile;
  reason: string;
  eligible_for_apply: boolean;
  writes_files: false;
  files: StarterDocsPlanFile[];
  skipped_files: Array<{
    path: string;
    reason: string;
  }>;
};

export type StarterDocsOutcome = {
  status: "generated" | "partial" | "skipped";
  reason: string;
  generated_files: string[];
  updated_files?: string[];
  skipped_files: Array<{
    path: string;
    reason: string;
  }>;
  conflict_files?: Array<{
    path: string;
    reason: string;
  }>;
};

export type StarterDocsAgentMode = "local_storage" | "remote_mcp";

export const starterDocsSettingKey = "starter_docs";

const agentDocPaths = new Set(["AGENTS.md", "CLAUDE.md", ".cursor/SESSION_HANDOFF.md"]);
const projectLogBytesWarning = 32_000;

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function sourceRef(candidate: DiscoveryCandidate): DocumentationPostureSourceRef {
  return {
    path: candidate.path,
    sha256: candidate.source_ref.sha256,
    size_bytes: candidate.source_ref.size_bytes,
    line_count: candidate.source_ref.line_count,
    redacted:
      candidate.secret_references.some((ref) => ref.value_redacted) ||
      candidate.risks.some((risk) => risk.code === "raw_secret_value_detected")
  };
}

function signal(
  code: DocumentationPostureSignalCode,
  severity: DocumentationPostureSignal["severity"],
  message: string,
  sources: DocumentationPostureSourceRef[] = []
): DocumentationPostureSignal {
  return { code, severity, message, sources };
}

function isDocumentationPath(path: string) {
  return (
    path === "README.md" ||
    path === "AGENTS.md" ||
    path === "PROJECT_LOG.md" ||
    path === "CLAUDE.md" ||
    path === ".cursor/SESSION_HANDOFF.md" ||
    path.startsWith("docs/") ||
    path.startsWith("Docs/") ||
    path.startsWith("runbooks/") ||
    path.startsWith("Runbooks/")
  );
}

function hasPath(paths: Set<string>, patterns: RegExp[]) {
  return Array.from(paths).some((path) => patterns.some((pattern) => pattern.test(path)));
}

function hasRecallantWorkflow(candidates: readonly DiscoveryCandidate[]) {
  return candidates.some(
    (candidate) =>
      agentDocPaths.has(candidate.path) &&
      /recallant|memory_start_session|memory_get_context_pack|agent-start|agent-checkpoint|agent-closeout/i.test(
        candidate.bounded_excerpt
      )
  );
}

function inferProfile(
  candidates: readonly DiscoveryCandidate[],
  paths: Set<string>
): DocumentationProfile {
  const combined = candidates
    .map((candidate) => `${candidate.path}\n${candidate.bounded_excerpt}`)
    .join("\n");
  if (
    hasPath(paths, [
      /(^|\/)(RUNBOOK|OPERATIONS|DEPLOYMENT|ARCHITECTURE)([-_\w]*)?\.md$/i,
      /^docker-compose/i
    ]) ||
    /\b(fastapi|service|server|systemd|docker|deploy|deployment|api|web app|application)\b/i.test(
      combined
    )
  ) {
    return "service_app";
  }
  if (
    hasPath(paths, [/(^|\/)(STATUS|ROADMAP|DECISIONS|ADR)([-_\w]*)?\.md$/i]) ||
    /\b(roadmap|status|decision|milestone|product)\b/i.test(combined)
  ) {
    return "product_roadmap";
  }
  if (/\b(library|package|sdk|api reference|module|npm package)\b/i.test(combined)) {
    return "library_package";
  }
  return "unknown";
}

function reviewOptions(status: DocumentationPostureStatus) {
  return [
    {
      option: "keep_current_docs" as const,
      recommended: status === "partial" || status === "recallant_ready",
      reason: "Preserve current documentation and add only the Recallant working layer."
    },
    {
      option: "canonicalize_for_recallant" as const,
      recommended: status === "needs_review",
      reason: "Review and normalize existing docs before changing canonical project guidance."
    },
    {
      option: "create_starter_docs" as const,
      recommended: status === "docs_absent" || status === "readme_only",
      reason: "Create the minimal starter documentation set when the project has little or no docs."
    },
    {
      option: "discuss_first" as const,
      recommended: status === "needs_review",
      reason:
        "Use Workbench discussion when production, stale, or conflicting docs need owner review."
    }
  ];
}

function titleFromProjectName(projectName: string) {
  return projectName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function starterReadme(projectName: string, profile: DocumentationProfile) {
  const title = titleFromProjectName(projectName) || "Project";
  const profileLine =
    profile === "service_app"
      ? "This appears to be a service or application project."
      : profile === "product_roadmap"
        ? "This appears to be a product or roadmap-oriented project."
        : profile === "library_package"
          ? "This appears to be a library or package project."
          : "Describe what this project does and who it serves.";
  return `# ${title}

${profileLine}

## Current State

- Recallant is attached to preserve agent memory, decisions, checkpoints, and reviewable context.
- Keep durable project knowledge in concise docs and Recallant memory instead of long session logs.

## Getting Started

1. Review this README and the agent instructions.
2. Start work through the configured Recallant-aware agent client.
3. Record meaningful decisions, actions, tests, and checkpoints in Recallant.

## Documentation

- \`AGENTS.md\` explains how agents should use Recallant for this project.
- \`PROJECT_LOG.md\` is a compact current-state fallback, not a full history archive.
`;
}

function starterAgents(mode: StarterDocsAgentMode = "local_storage") {
  const startLine =
    mode === "remote_mcp"
      ? "Start each session through the configured remote Recallant MCP/client integration."
      : "Start each session through the configured Recallant MCP/client integration.";
  const modeSpecific =
    mode === "remote_mcp"
      ? [
          "- This project uses a central Recallant server through remote MCP; do not set up local Postgres, Docker, or `RECALLANT_DATABASE_URL` just to work in this project.",
          "- Direct MCP startup: call `memory_start_session`, then `memory_get_context_pack` with the current task hint before making changes.",
          "- During work, write concise non-secret decisions, actions, tests, and governed memories with `memory_append_event` or `memory_create_agent_memory` when useful.",
          "- Use `memory_set_checkpoint` only for checkpoint state; it is not semantic recall proof.",
          "- On pause or finish, call `memory_closeout`. This is the normal MCP closeout path and includes checkpoint state, searchable memory, recall verification, and next-session readiness semantics.",
          "- If MCP is unavailable, use the CLI fallback against the configured remote project: `recallant agent-start --format json`, `recallant agent-event`, and `recallant agent-closeout`. Use `recallant agent-checkpoint` only as an advanced pause/compaction state helper.",
          "- `PROJECT_LOG.md` is a compact current-state fallback. Durable session history belongs in Recallant memory."
        ]
      : [
          "- If MCP is unavailable, use the CLI fallback: `recallant agent-start`, `recallant agent-event`, `recallant agent-checkpoint`, and `recallant agent-closeout`."
        ];
  const contextPackLine =
    mode === "remote_mcp"
      ? "- Keep checkpoint-only state separate from semantic memory proof."
      : "- Read the current context pack before making changes.";
  const memoryLines = [
    `- ${startLine}`,
    ...modeSpecific,
    contextPackLine,
    "- Record meaningful decisions, actions, tests, and checkpoints in Recallant.",
    "- On closeout, update the Recallant checkpoint instead of turning this file into a session log."
  ];
  return `# Agent Instructions

## Memory (Recallant)

${memoryLines.join("\n")}

## Project Docs

- Treat local docs as concise canonical pointers.
- Treat recalled memories as evidence until they are reviewed or promoted into project docs.
- Do not store secrets, credentials, tokens, private keys, or raw customer data in docs or memory.
`;
}

function starterProjectLog(projectName: string) {
  return `# Project Log

Project: ${projectName}

## Current State

- Recallant starter documentation was created for this project.
- The next agent should read the Recallant context pack before changing code or docs.

## Next Step

- Replace placeholder project details with verified facts from the owner or repository.

## Notes

- Keep this file compact. Durable session history belongs in Recallant memory.
`;
}

function starterRunbook() {
  return `# Runbook

## Purpose

Operational notes for running, checking, and recovering this service.

## Local Checks

- Document the normal health check command or endpoint.
- Document the normal start/stop mechanism without exposing secrets.

## Deployment Notes

- Record deployment steps only after they are verified.
- Keep private hostnames, credentials, and access details in the approved private environment profile.

## Recovery

- Document common failure symptoms and safe first checks.
`;
}

function starterArchitecture() {
  return `# Architecture

## Overview

Describe the main runtime components and their responsibilities.

## Data Flow

- Document important inputs, outputs, storage, and external integrations.

## Boundaries

- Note which services, ports, secrets, and deployment details are managed outside the public codebase.
`;
}

function starterStatus() {
  return `# Status

## Current Focus

- Capture the current product direction and next milestone.

## Done

- Recallant starter documentation has been created.

## Next

- Replace placeholder status with verified project priorities.
`;
}

function starterDecisions() {
  return `# Decisions

Record durable project decisions here after review.

## Template

- Date:
- Decision:
- Context:
- Consequences:
- Recallant memory/source reference:
`;
}

function starterApi() {
  return `# API

## Usage

Document the public package or module API here after it is verified.

## Examples

Add minimal examples that users can run safely.

## Compatibility

Record supported runtimes, versions, and migration notes.
`;
}

function starterDocsBaseFiles(
  projectName: string,
  profile: DocumentationProfile,
  agentMode: StarterDocsAgentMode
): StarterDocsPlanFile[] {
  return [
    {
      path: "README.md",
      kind: "readme",
      profile: "base",
      required: true,
      content: starterReadme(projectName, profile)
    },
    {
      path: "AGENTS.md",
      kind: "agent_instructions",
      profile: "base",
      required: true,
      content: starterAgents(agentMode)
    },
    {
      path: "PROJECT_LOG.md",
      kind: "project_log",
      profile: "base",
      required: true,
      content: starterProjectLog(projectName)
    }
  ];
}

function starterDocsProfileFiles(profile: DocumentationProfile): StarterDocsPlanFile[] {
  if (profile === "service_app") {
    return [
      {
        path: "docs/RUNBOOK.md",
        kind: "runbook",
        profile,
        required: false,
        content: starterRunbook()
      },
      {
        path: "docs/ARCHITECTURE.md",
        kind: "architecture",
        profile,
        required: false,
        content: starterArchitecture()
      }
    ];
  }
  if (profile === "product_roadmap") {
    return [
      {
        path: "docs/STATUS.md",
        kind: "status",
        profile,
        required: false,
        content: starterStatus()
      },
      {
        path: "docs/DECISIONS.md",
        kind: "decisions",
        profile,
        required: false,
        content: starterDecisions()
      }
    ];
  }
  if (profile === "library_package") {
    return [
      {
        path: "docs/API.md",
        kind: "api",
        profile,
        required: false,
        content: starterApi()
      }
    ];
  }
  return [];
}

export function planStarterDocs(input: {
  projectName: string;
  posture: Pick<DocumentationPosture, "status" | "profile" | "existing_docs">;
  existingTargetPaths?: readonly string[];
  agentMode?: StarterDocsAgentMode;
}): StarterDocsPlan {
  const profile = input.posture.profile;
  const agentMode = input.agentMode ?? "local_storage";
  const files = [
    ...starterDocsBaseFiles(input.projectName, profile, agentMode),
    ...starterDocsProfileFiles(profile)
  ];
  const existingTargets = new Set(input.existingTargetPaths ?? []);
  const skippedFiles = files
    .filter((file) => existingTargets.has(file.path))
    .map((file) => ({
      path: file.path,
      reason: "Target file already exists."
    }));
  if (input.posture.status !== "docs_absent") {
    return {
      schema_version: 1,
      status: "not_empty",
      profile,
      reason: "Starter docs are only eligible when no project documentation was discovered.",
      eligible_for_apply: false,
      writes_files: false,
      files,
      skipped_files: skippedFiles
    };
  }

  if (skippedFiles.length > 0) {
    return {
      schema_version: 1,
      status: "targets_exist",
      profile,
      reason: "Starter docs were not eligible because one or more target files already exist.",
      eligible_for_apply: false,
      writes_files: false,
      files,
      skipped_files: skippedFiles
    };
  }
  return {
    schema_version: 1,
    status: "ready",
    profile,
    reason: "No project documentation was discovered; starter docs can be created safely.",
    eligible_for_apply: true,
    writes_files: false,
    files,
    skipped_files: []
  };
}

export function compactStarterDocsForSetting(input: {
  plan: StarterDocsPlan;
  outcome: StarterDocsOutcome | null;
}) {
  return {
    schema_version: 1,
    status: input.outcome?.status ?? input.plan.status,
    profile: input.plan.profile,
    reason: input.outcome?.reason ?? input.plan.reason,
    eligible_for_apply: input.plan.eligible_for_apply,
    writes_files: input.plan.writes_files,
    planned_files: input.plan.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      profile: file.profile,
      required: file.required
    })),
    skipped_files: input.outcome?.skipped_files ?? input.plan.skipped_files,
    outcome: input.outcome
      ? {
          status: input.outcome.status,
          reason: input.outcome.reason,
          generated_files: input.outcome.generated_files,
          updated_files: input.outcome.updated_files ?? [],
          skipped_files: input.outcome.skipped_files,
          conflict_files: input.outcome.conflict_files ?? []
        }
      : null,
    authority: {
      source: "starter_docs_planner",
      role: "documentation_bootstrap",
      instruction_grade: false
    }
  };
}

function reviewNeededReason(
  status: DocumentationPostureStatus,
  signals: DocumentationPostureSignal[]
) {
  if (status !== "needs_review") return null;
  const signalNeedingReview = signals.find((item) =>
    [
      "stale_handoff",
      "oversized_project_log",
      "agent_docs_without_recallant_workflow",
      "production_or_server_hint",
      "canon_links_needed"
    ].includes(item.code)
  );
  return signalNeedingReview?.message ?? "Documentation posture needs owner or Workbench review.";
}

async function listSupplementalDocPaths(projectDir: string) {
  const paths = new Set<string>();
  async function addMarkdownFiles(relativeDir: string) {
    let entries;
    try {
      entries = await readdir(join(projectDir, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isFile() && /\.md$/i.test(entry.name)) paths.add(relativePath);
      if (
        entry.isDirectory() &&
        /^(docs|Docs|runbooks|Runbooks|adr|ADR|decisions|Decisions)$/i.test(entry.name)
      ) {
        await addMarkdownFiles(relativePath);
      }
    }
  }
  await addMarkdownFiles("");
  return Array.from(paths);
}

export function analyzeDocumentationPosture(
  input: DocumentationPostureInput
): DocumentationPosture {
  const candidatePaths = input.candidates.map((candidate) => candidate.path);
  const existingDocs = uniqueSorted(
    [...candidatePaths, ...(input.supplementalDocPaths ?? [])].filter(isDocumentationPath)
  );
  const pathSet = new Set(existingDocs);
  const signals: DocumentationPostureSignal[] = [];
  const hasReadme = pathSet.has("README.md");
  const hasAgentDocs = existingDocs.some((path) => agentDocPaths.has(path));
  const hasProjectLog = pathSet.has("PROJECT_LOG.md");
  const hasStatusDoc =
    hasProjectLog || hasPath(pathSet, [/(^|\/)(STATUS|PROJECT_STATUS)([-_\w]*)?\.md$/i]);
  const hasRunbook = hasPath(pathSet, [
    /(^|\/)(RUNBOOK|RUNBOOKS|OPERATIONS|DEPLOYMENT)([-_\w]*)?\.md$/i
  ]);
  const hasArchitecture = hasPath(pathSet, [/(^|\/)(ARCHITECTURE|DESIGN)([-_\w]*)?\.md$/i]);
  const recallantWorkflow = hasRecallantWorkflow(input.candidates);

  if (existingDocs.length === 0) {
    signals.push(
      signal(
        "docs_absent",
        "warning",
        "No README, agent, status, runbook, architecture, or handoff docs were discovered."
      )
    );
  }
  if (existingDocs.length === 1 && hasReadme) {
    signals.push(
      signal(
        "readme_only",
        "info",
        "README.md exists, but no agent/status/runbook surfaces were discovered."
      )
    );
  }
  if (!hasAgentDocs) {
    signals.push(
      signal("missing_agent_docs", "warning", "No agent instruction surface was discovered.")
    );
  }
  if (!hasStatusDoc) {
    signals.push(
      signal("missing_status_doc", "info", "No compact status/checkpoint document was discovered.")
    );
  }
  if (!hasRunbook) {
    signals.push(
      signal("missing_runbook", "info", "No runbook/operations/deployment document was discovered.")
    );
  }
  if (!hasArchitecture) {
    signals.push(
      signal("missing_architecture", "info", "No architecture/design document was discovered.")
    );
  }
  if (!recallantWorkflow) {
    signals.push(
      signal(
        "missing_recallant_workflow",
        "warning",
        "No Recallant startup/checkpoint/closeout workflow was found in agent docs."
      )
    );
  }
  if (hasAgentDocs && !recallantWorkflow) {
    signals.push(
      signal(
        "agent_docs_without_recallant_workflow",
        "warning",
        "Agent documentation exists, but it does not describe the Recallant workflow.",
        input.candidates.filter((candidate) => agentDocPaths.has(candidate.path)).map(sourceRef)
      )
    );
  }

  for (const candidate of input.candidates) {
    if (candidate.result_classes.includes("stale_history")) {
      signals.push(
        signal(
          "stale_handoff",
          "warning",
          `${candidate.path} looks like a historical handoff/checkpoint source.`,
          [sourceRef(candidate)]
        )
      );
    }
    if (
      candidate.path === "PROJECT_LOG.md" &&
      (candidate.source_ref.size_bytes > projectLogBytesWarning ||
        candidate.result_classes.includes("oversized_context_risk"))
    ) {
      signals.push(
        signal(
          "oversized_project_log",
          "warning",
          `PROJECT_LOG.md is ${candidate.source_ref.size_bytes} bytes and ${candidate.source_ref.line_count} lines; keep it compact.`,
          [sourceRef(candidate)]
        )
      );
    }
    if (
      candidate.result_classes.includes("environment_fact") ||
      candidate.result_classes.includes("capability_binding") ||
      candidate.risks.some((risk) => risk.code === "high_risk_operational_context")
    ) {
      signals.push(
        signal(
          "production_or_server_hint",
          "warning",
          `${candidate.path} contains production, server, environment, or capability hints.`,
          [sourceRef(candidate)]
        )
      );
    }
  }

  const needsCanon = signals.some((item) => item.code === "production_or_server_hint");
  if (needsCanon) {
    signals.push(
      signal(
        "canon_links_needed",
        "warning",
        "Server/security and port-inventory canon references are needed for this project."
      )
    );
  }

  const missingRecommendedDocs = uniqueSorted(
    [
      hasReadme ? null : "README.md",
      hasAgentDocs ? null : "AGENTS.md",
      hasStatusDoc ? null : "PROJECT_LOG.md or docs/STATUS.md",
      hasRunbook ? null : "docs/RUNBOOK.md",
      hasArchitecture ? null : "docs/ARCHITECTURE.md",
      recallantWorkflow ? null : "Recallant workflow in AGENTS.md"
    ].filter((item): item is string => item !== null)
  );
  const highOrReviewSignals = signals.filter((item) =>
    [
      "stale_handoff",
      "oversized_project_log",
      "agent_docs_without_recallant_workflow",
      "production_or_server_hint",
      "canon_links_needed"
    ].includes(item.code)
  );
  const status: DocumentationPostureStatus =
    existingDocs.length === 0
      ? "docs_absent"
      : existingDocs.length === 1 && hasReadme
        ? "readme_only"
        : highOrReviewSignals.length > 0
          ? "needs_review"
          : missingRecommendedDocs.length > 0
            ? "partial"
            : "recallant_ready";
  const profile = inferProfile(input.candidates, pathSet);
  const redactedSourceCount = input.candidates.filter(
    (candidate) => sourceRef(candidate).redacted
  ).length;

  return {
    status,
    profile,
    analysis_source: "rules",
    confidence: status === "recallant_ready" ? 0.85 : 0.74,
    summary:
      status === "docs_absent"
        ? "No project documentation was discovered."
        : `${existingDocs.length} documentation surface(s) discovered; ${missingRecommendedDocs.length} recommended surface(s) missing.`,
    review_needed_reason: reviewNeededReason(status, signals),
    ai: {
      status: "disabled",
      provider: "ollama",
      model: null,
      input_chars: 0,
      error: null
    },
    existing_docs: existingDocs,
    missing_recommended_docs: missingRecommendedDocs,
    signals,
    review_options: reviewOptions(status),
    canon_context: {
      needed: needsCanon,
      reason: needsCanon
        ? "Production/server/capability hints need configured owner/server canon references."
        : null,
      recommended_reference_kinds: needsCanon ? ["security_baseline", "ports_inventory"] : [],
      configured_references: []
    },
    writes_files: false,
    writes_database: false,
    source_summary: {
      candidate_count: input.candidates.length,
      redacted_source_count: redactedSourceCount
    }
  };
}

export function compactDocumentationPostureForSetting(posture: DocumentationPosture) {
  return {
    schema_version: 1,
    status: posture.status,
    profile: posture.profile,
    analysis_source: posture.analysis_source,
    confidence: posture.confidence,
    summary: posture.summary,
    review_needed_reason: posture.review_needed_reason,
    existing_docs: posture.existing_docs,
    missing_recommended_docs: posture.missing_recommended_docs,
    review_options: posture.review_options,
    canon_context: posture.canon_context,
    signals: posture.signals.map((item) => ({
      code: item.code,
      severity: item.severity,
      message: item.message
    })),
    source_summary: posture.source_summary,
    authority: {
      source: "documentation_posture_analyzer",
      role: "startup_guidance",
      instruction_grade: false,
      notes: [
        "Documentation posture is guidance for Workbench review and agent startup.",
        "It is not a binding rule and does not promote old handoffs to canonical instructions.",
        "Raw source text and raw secrets are intentionally excluded."
      ]
    }
  };
}

function topPostureSignal(posture: DocumentationPosture, codes: DocumentationPostureSignalCode[]) {
  return posture.signals.find((signalItem) => codes.includes(signalItem.code));
}

export function summarizeDocumentationPostureForOnboard(posture: DocumentationPosture): {
  status: OnboardDocumentationPostureStatus;
  found: string;
  workbench: string;
} {
  const riskySignal = topPostureSignal(posture, [
    "production_or_server_hint",
    "canon_links_needed"
  ]);
  const hasHighSeverity = posture.signals.some((signalItem) => signalItem.severity === "high");
  const hasRedactedSource = posture.source_summary.redacted_source_count > 0;
  const status: OnboardDocumentationPostureStatus =
    posture.status === "docs_absent"
      ? "empty"
      : riskySignal || hasHighSeverity || hasRedactedSource
        ? "risky"
        : posture.status === "recallant_ready"
          ? "healthy"
          : "needs_attention";
  const found =
    posture.status === "docs_absent"
      ? "no project documentation discovered"
      : `${posture.existing_docs.length} documentation surface(s), ${posture.missing_recommended_docs.length} missing/review item(s)`;
  const workbench =
    status === "empty"
      ? "open Workbench to create starter docs or discuss first"
      : status === "healthy"
        ? "open Workbench to review memory capture and keep current docs"
        : status === "risky"
          ? "open Workbench to review production/canon-sensitive findings before changing docs"
          : "open Workbench to keep current docs, canonicalize for Recallant, create starter docs, or discuss first";

  return { status, found, workbench };
}

function boundedAiInput(posture: DocumentationPosture) {
  const input = {
    status: posture.status,
    profile: posture.profile,
    summary: posture.summary,
    existing_docs: posture.existing_docs,
    missing_recommended_docs: posture.missing_recommended_docs,
    signals: posture.signals.map((item) => ({
      code: item.code,
      severity: item.severity,
      message: item.message,
      sources: item.sources.map((source) => ({
        path: source.path,
        size_bytes: source.size_bytes,
        line_count: source.line_count,
        redacted: source.redacted
      }))
    })),
    canon_context: posture.canon_context
  };
  const serialized = JSON.stringify(input);
  return serialized.length > 6_000 ? `${serialized.slice(0, 5_997)}...` : serialized;
}

function parseAiJson(text: string) {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const rawProfile = String(parsed.profile ?? "");
  const profile: DocumentationProfile =
    rawProfile === "service_app" ||
    rawProfile === "library_package" ||
    rawProfile === "product_roadmap" ||
    rawProfile === "unknown"
      ? rawProfile
      : "unknown";
  const confidence = Number(parsed.confidence ?? 0);
  if (!Number.isFinite(confidence)) throw new Error("AI confidence is not numeric");
  return {
    profile,
    confidence: Math.max(0, Math.min(1, confidence)),
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 500)
        : "Local AI classified documentation posture.",
    review_needed_reason:
      typeof parsed.review_needed_reason === "string" && parsed.review_needed_reason.trim()
        ? parsed.review_needed_reason.trim().slice(0, 500)
        : null
  };
}

async function classifyWithLocalAi(
  posture: DocumentationPosture,
  options: DocumentationPostureAiOptions
) {
  const provider = options.provider ?? "ollama";
  const model =
    options.model ??
    process.env.RECALLANT_DOCUMENTATION_POSTURE_MODEL ??
    process.env.RECALLANT_MANAGEMENT_CHAT_MODEL ??
    "nomic-embed-text";
  const url = options.url ?? process.env.RECALLANT_OLLAMA_URL ?? "http://127.0.0.1:11434";
  const fetchImpl = options.fetchImpl ?? fetch;
  const input = boundedAiInput(posture);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 1_500);
  try {
    const response = await fetchImpl(new URL("/api/chat", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Return compact JSON only: profile, confidence, summary, review_needed_reason. Profiles: service_app, library_package, product_roadmap, unknown."
          },
          {
            role: "user",
            content: input
          }
        ],
        options: { temperature: 0 }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const message = payload.message as Record<string, unknown> | undefined;
    const content =
      typeof message?.content === "string"
        ? message.content
        : typeof payload.response === "string"
          ? payload.response
          : "";
    if (!content.trim()) throw new Error("AI response content was empty");
    return {
      status: "used" as const,
      provider,
      model,
      input_chars: input.length,
      result: parseAiJson(content),
      error: null
    };
  } catch (error) {
    return {
      status: error instanceof SyntaxError ? ("malformed" as const) : ("unavailable" as const),
      provider,
      model,
      input_chars: input.length,
      result: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function applyAiResult(
  posture: DocumentationPosture,
  classification: Awaited<ReturnType<typeof classifyWithLocalAi>>,
  minConfidence: number
): DocumentationPosture {
  if (!classification.result) {
    return {
      ...posture,
      ai: {
        status: classification.status,
        provider: classification.provider,
        model: classification.model,
        input_chars: classification.input_chars,
        error: classification.error
      }
    };
  }
  if (classification.result.confidence < minConfidence) {
    return {
      ...posture,
      review_needed_reason:
        posture.review_needed_reason ??
        `Local AI confidence ${classification.result.confidence.toFixed(2)} is below ${minConfidence.toFixed(2)}.`,
      ai: {
        status: "low_confidence",
        provider: classification.provider,
        model: classification.model,
        input_chars: classification.input_chars,
        error: null
      }
    };
  }
  return {
    ...posture,
    analysis_source: "local_ai",
    profile: classification.result.profile,
    confidence: classification.result.confidence,
    summary: classification.result.summary,
    review_needed_reason:
      posture.review_needed_reason ?? classification.result.review_needed_reason,
    ai: {
      status: "used",
      provider: classification.provider,
      model: classification.model,
      input_chars: classification.input_chars,
      error: null
    }
  };
}

function documentationPostureAiEnabled(options?: DocumentationPostureAiOptions) {
  if (options?.enabled !== undefined) return options.enabled;
  return process.env.RECALLANT_DOCUMENTATION_POSTURE_AI === "on";
}

export async function analyzeProjectDocumentationPosture(
  projectDir: string,
  options: { ai?: DocumentationPostureAiOptions } = {}
) {
  const candidates = await detectImportCandidates(projectDir);
  const supplementalDocPaths = await listSupplementalDocPaths(projectDir);
  const posture = analyzeDocumentationPosture({ projectDir, candidates, supplementalDocPaths });
  if (!documentationPostureAiEnabled(options.ai)) return posture;
  const classification = await classifyWithLocalAi(posture, options.ai ?? {});
  return applyAiResult(posture, classification, options.ai?.minConfidence ?? 0.7);
}
