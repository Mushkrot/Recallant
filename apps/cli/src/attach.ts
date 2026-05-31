import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRecallantDbFromEnv, type RecallantDb } from "@recallant/db";
import {
  type DiscoveryCandidate,
  detectImportCandidates,
  readImportTextForCandidate,
  redactSecretValues
} from "./discovery.js";

type AttachMode = "manual" | "guided" | "autopilot";

type AttachOptions = {
  requestedMode: AttachMode;
  modeWasProvided: boolean;
  target: string;
  dryRun: boolean;
  confirm: boolean;
  productionApproved: boolean;
  explicitProduction: boolean;
  explicitSandbox: boolean;
  projectDir: string;
  serverUrl: string;
  captureProfile: "light" | "standard" | "detailed" | "custom";
  format: "json" | "text";
};

type AttachConfig = {
  project_id?: string;
  recallant_server_url?: string;
};

type AgentFile = {
  path: string;
  sha256: string;
  size_bytes: number;
  redacted: boolean;
};

const attachMemorySection = `## Memory (Recallant)

- At session start: call \`memory_start_session\`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call \`memory_get_context_pack\` with the current task hint.
- Use \`memory_search\` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in \`memory_search\`, not broad ones. One call per session start is usually enough.
- After meaningful progress: write meaningful events/memories through \`memory_append_event\` or \`memory_create_agent_memory\`, update checkpoint via \`memory_set_checkpoint\`, and update \`PROJECT_LOG.md\` to match fields \`current_focus\` and \`next_step\`.
- On clear pause/exit/closeout intent: call \`memory_closeout\` and update \`PROJECT_LOG.md\` from the closeout payload.
- To reuse a pattern from another project: search explicitly for source-linked examples, adapt the pattern locally, and create current-project memory with source refs after applying it.
- Never paste secrets into memory tools.
- If direct MCP use is unavailable, use the CLI capture fallback: \`recallant agent-start\`,
  \`recallant agent-event\`, \`recallant agent-checkpoint\`, and \`recallant agent-closeout\`.
  If the server is unavailable, the CLI writes local spool for later \`recallant sync-spool\`.
`;

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseAttachProjectArg(argv: readonly string[]) {
  const flagsWithValues = new Set([
    "--project-dir",
    "--server-url",
    "--target",
    "--capture-profile",
    "--mode",
    "--format"
  ]);
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

function parseAttachMode(raw: string | undefined): AttachMode {
  if (!raw) return "autopilot";
  if (raw === "manual" || raw === "guided" || raw === "autopilot") return raw;
  throw new Error(`Invalid --mode: ${raw}`);
}

function parseCaptureProfile(raw: string | undefined): AttachOptions["captureProfile"] {
  const captureProfile = raw ?? "standard";
  if (!["light", "standard", "detailed", "custom"].includes(captureProfile)) {
    throw new Error(`Invalid --capture-profile: ${captureProfile}`);
  }
  return captureProfile as AttachOptions["captureProfile"];
}

function parseAttachOptions(argv: readonly string[]): AttachOptions {
  const modeFlag = parseFlag(argv, "--mode");
  const format = parseFlag(argv, "--format") ?? "json";
  if (format !== "json" && format !== "text") throw new Error(`Invalid --format: ${format}`);
  return {
    requestedMode: parseAttachMode(modeFlag),
    modeWasProvided: modeFlag !== undefined,
    target: parseFlag(argv, "--target") ?? "codex",
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
    productionApproved: argv.includes("--production-approved"),
    explicitProduction: argv.includes("--production") || argv.includes("--live"),
    explicitSandbox: argv.includes("--sandbox") || argv.includes("--test"),
    projectDir: resolve(
      parseFlag(argv, "--project-dir") ?? parseAttachProjectArg(argv) ?? process.cwd()
    ),
    serverUrl:
      parseFlag(argv, "--server-url") ??
      process.env.RECALLANT_SERVER_URL ??
      "http://127.0.0.1:3005",
    captureProfile: parseCaptureProfile(parseFlag(argv, "--capture-profile")),
    format
  };
}

function projectName(projectDir: string) {
  return projectDir.split("/").filter(Boolean).at(-1) ?? "recallant-project";
}

function configJson(projectId: string, serverUrl: string) {
  return `${JSON.stringify({ project_id: projectId, recallant_server_url: serverUrl }, null, 2)}\n`;
}

function codexMcpConfig(projectId: string, developerId: string) {
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["mcp-server"],
        env: {
          RECALLANT_PROJECT_ID: projectId,
          RECALLANT_DEVELOPER_ID: developerId,
          RECALLANT_DATABASE_URL: "${RECALLANT_DATABASE_URL}"
        }
      }
    }
  };
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readExistingConfig(projectDir: string) {
  const content = await readOptional(join(projectDir, ".recallant", "config"));
  if (!content) return { config: null as AttachConfig | null, error: null as string | null };
  try {
    return { config: JSON.parse(content) as AttachConfig, error: null };
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function upsertMemorySection(existing: string | null) {
  if (!existing) return `# Agent Instructions\n\n${attachMemorySection}`;
  const pattern = /## Memory \(Recallant\)[\s\S]*?(?=\n## |\n# |$)/;
  if (pattern.test(existing)) return existing.replace(pattern, attachMemorySection.trimEnd());
  return `${existing.trimEnd()}\n\n${attachMemorySection}`;
}

function compactProjectLog(input: {
  project: string;
  projectId: string;
  mode: AttachMode;
  productionSensitive: boolean;
}) {
  return `# Project Log

## Current Session

Status: attached to Recallant.
Current focus: Recallant-backed project work.
Next step: start the next agent session with \`recallant agent-start --task-hint "<current task>"\`.

## Active Constraints

- Recallant is the main source of truth for durable memory.
- This file is a compact fallback/checkpoint, not the full project history.
- If Recallant is unavailable, record only minimal fallback state here and sync it later.

## Open Questions

- None recorded.

## Recallant

- Project: ${input.project}
- Project id: ${input.projectId}
- Attach mode: ${input.mode}
- Production-sensitive: ${input.productionSensitive}
`;
}

async function upsertGitignore(projectDir: string) {
  const path = join(projectDir, ".gitignore");
  const existing = await readOptional(path);
  if (existing === null) return ".recallant/\n";
  const lines = existing.split("\n").map((line) => line.trim());
  if (lines.includes(".recallant/") || lines.includes(".recallant")) return existing;
  return `${existing.trimEnd()}\n.recallant/\n`;
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function candidateNeedsReview(candidate: DiscoveryCandidate) {
  return (
    candidate.risk !== "low" ||
    candidate.result_classes.some((resultClass) =>
      [
        "secret_reference_names_only",
        "capability_binding",
        "connector_account_binding",
        "possible_conflict",
        "stale_history",
        "oversized_context_risk"
      ].includes(resultClass)
    )
  );
}

function candidateImportable(candidate: DiscoveryCandidate) {
  return candidate.import_suggestion.importable;
}

async function generatedBootstrapCandidate(projectDir: string, candidate: DiscoveryCandidate) {
  const content = await readOptional(join(projectDir, candidate.path));
  if (!content) return false;
  if (candidate.path === "AGENTS.md" && content.includes("## Memory (Recallant)")) return true;
  if (candidate.path === "PROJECT_LOG.md" && content.includes("Status: attached to Recallant")) {
    return true;
  }
  return false;
}

async function selectAttachImportCandidates(input: {
  projectDir: string;
  candidates: readonly DiscoveryCandidate[];
  alreadyAttached: boolean;
}) {
  const selected: DiscoveryCandidate[] = [];
  for (const candidate of input.candidates) {
    if (!candidateImportable(candidate)) continue;
    if (input.alreadyAttached && (await generatedBootstrapCandidate(input.projectDir, candidate))) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
}

function candidateIsAgentFile(candidate: DiscoveryCandidate) {
  return (
    candidate.path === "AGENTS.md" ||
    candidate.path === "PROJECT_LOG.md" ||
    /^PROJECT_LOG_.+\.md$/i.test(candidate.path) ||
    candidate.path === "CLAUDE.md" ||
    candidate.path === ".cursor/SESSION_HANDOFF.md" ||
    candidate.path.startsWith(".cursor/rules/")
  );
}

async function discoverAgentFiles(projectDir: string, candidates: readonly DiscoveryCandidate[]) {
  const paths = new Set(candidates.filter(candidateIsAgentFile).map((candidate) => candidate.path));
  try {
    const cursorRules = await readdir(join(projectDir, ".cursor", "rules"), {
      withFileTypes: true
    });
    for (const entry of cursorRules) {
      if (entry.isFile()) paths.add(`.cursor/rules/${entry.name}`);
    }
  } catch {
    // Optional client-specific directory.
  }
  const files: AgentFile[] = [];
  for (const relativePath of Array.from(paths).sort()) {
    const absolutePath = join(projectDir, relativePath);
    const content = await readOptional(absolutePath);
    if (content === null) continue;
    const redacted = redactSecretValues(content);
    let sizeBytes = Buffer.byteLength(content);
    try {
      sizeBytes = (await stat(absolutePath)).size;
    } catch {
      // Keep UTF-8 byte length fallback.
    }
    files.push({
      path: relativePath,
      sha256: sha256(content),
      size_bytes: sizeBytes,
      redacted: redacted !== content
    });
  }
  return files;
}

function productionSignalsFromCandidate(candidate: DiscoveryCandidate) {
  const signals = [];
  const combined = `${candidate.path}\n${candidate.bounded_excerpt}\n${candidate.risks
    .map((risk) => `${risk.code} ${risk.message}`)
    .join("\n")}`;
  if (/docker-compose\.production|prod\.ya?ml|systemd|\.service\b/i.test(candidate.path)) {
    signals.push(`production path: ${candidate.path}`);
  }
  if (
    /\b(production|live service|public domain|cloudflare|dns|deploy|deployment|systemd|paid api|billing)\b/i.test(
      combined
    )
  ) {
    signals.push(`production hint in ${candidate.path}`);
  }
  return signals;
}

async function detectProductionSensitivity(
  projectDir: string,
  candidates: readonly DiscoveryCandidate[],
  options: AttachOptions
) {
  const signals: string[] = [];
  if (options.explicitProduction) signals.push("explicit production/live flag");
  if (options.explicitSandbox)
    return { production_sensitive: false, signals: ["explicit sandbox/test flag"] };
  const pathHints = [
    "docker-compose.production.yml",
    "docker-compose.prod.yml",
    "systemd",
    "deploy",
    "deployment",
    "fly.toml",
    "vercel.json",
    "cloudflare"
  ];
  for (const relativePath of pathHints) {
    try {
      await stat(join(projectDir, relativePath));
      signals.push(`production path: ${relativePath}`);
    } catch {
      // Optional project file.
    }
  }
  for (const candidate of candidates) signals.push(...productionSignalsFromCandidate(candidate));
  return {
    production_sensitive: signals.length > 0,
    signals: Array.from(new Set(signals))
  };
}

async function createLocalBackup(input: {
  projectDir: string;
  mode: AttachMode;
  productionSensitive: boolean;
  agentFiles: readonly AgentFile[];
  changedExistingAgentFiles: readonly string[];
}) {
  if (input.changedExistingAgentFiles.length === 0) return null;
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const backupRoot = join(input.projectDir, ".recallant", "backups", `attach-${timestamp}`);
  for (const file of input.agentFiles) {
    const content = await readOptional(join(input.projectDir, file.path));
    if (content === null) continue;
    await mkdir(join(backupRoot, file.path, ".."), { recursive: true });
    await writeFile(join(backupRoot, file.path), redactSecretValues(content));
  }
  const manifest = {
    attach_mode: input.mode,
    created_at: new Date().toISOString(),
    production_sensitive: input.productionSensitive,
    discovered_agent_files: input.agentFiles,
    changed_existing_agent_files: input.changedExistingAgentFiles,
    unchanged_agent_files: input.agentFiles
      .map((file) => file.path)
      .filter((path) => !input.changedExistingAgentFiles.includes(path)),
    redaction_notices: input.agentFiles
      .filter((file) => file.redacted)
      .map((file) => `${file.path} contained secret-like values; backup copy was redacted.`),
    rollback:
      "Restore these files manually if needed. Raw secret values are intentionally not recoverable from this backup."
  };
  await writeFile(join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    path: backupRoot,
    manifest_path: join(backupRoot, "manifest.json"),
    file_count: input.agentFiles.length,
    redacted_file_count: input.agentFiles.filter((file) => file.redacted).length
  };
}

async function resolveProjectIdentity(input: {
  database: RecallantDb | null;
  existingConfig: AttachConfig | null;
  projectDir: string;
}) {
  const developerId = process.env.RECALLANT_DEVELOPER_ID ?? randomUUID();
  if (input.existingConfig?.project_id) {
    if (!input.database) {
      return { projectId: input.existingConfig.project_id, developerId, source: "existing_config" };
    }
    const binding = await input.database.getProjectBinding(input.existingConfig.project_id);
    if (binding?.primary_path === input.projectDir) {
      return {
        projectId: input.existingConfig.project_id,
        developerId: binding.developer_id,
        source: "existing_config"
      };
    }
    const issue = binding
      ? `Existing .recallant/config points to project ${input.existingConfig.project_id} bound to ${binding.primary_path ?? "no path"}, not ${input.projectDir}. Ignoring stale/foreign config.`
      : `Existing .recallant/config points to missing project ${input.existingConfig.project_id}. Ignoring stale config.`;
    if (input.database) {
      const context = await input.database.ensureProject(input.projectDir);
      return {
        projectId: context.projectId,
        developerId: context.developerId,
        source: "database",
        existingConfigIssue: issue
      };
    }
  }
  if (input.database) {
    const context = await input.database.ensureProject(input.projectDir);
    return { projectId: context.projectId, developerId: context.developerId, source: "database" };
  }
  return { projectId: randomUUID(), developerId, source: "generated" };
}

function plannedChanges(input: {
  effectiveMode: AttachMode;
  executionAllowed: boolean;
  candidates: readonly DiscoveryCandidate[];
  changedFiles: readonly string[];
  productionSensitive: boolean;
}) {
  if (!input.executionAllowed) {
    return [
      {
        action: "plan_only",
        writes_files: false,
        writes_database: false,
        reason:
          input.effectiveMode === "manual"
            ? "Manual mode preserves explicit lower-level commands."
            : "Guided/dry-run mode waits for confirmation."
      }
    ];
  }
  return [
    ...input.changedFiles.map((path) => ({ action: "write_file", path })),
    ...input.candidates.filter(candidateImportable).map((candidate) => ({
      action: "import_source",
      path: candidate.path,
      review_required: candidateNeedsReview(candidate),
      promotes_instruction_grade: false
    })),
    {
      action: "register_project",
      writes_database: true
    },
    {
      action: "diagnostics",
      writes_database: false,
      production_sensitive: input.productionSensitive
    }
  ];
}

function rawSecretFindings(candidates: readonly DiscoveryCandidate[]) {
  return candidates
    .filter((candidate) =>
      candidate.risks.some((risk) => risk.code === "raw_secret_value_detected")
    )
    .map((candidate) => ({
      path: candidate.path,
      source_sha256: candidate.source_ref.sha256,
      risk: candidate.risk,
      source_modified: false,
      review_required: true,
      cleanup_plan:
        "Review the source file, rotate real secrets if needed, and keep only secret reference names in Recallant."
    }));
}

function contentTypeForPath(path: string) {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.includes(".env") || path.endsWith(".example")) return "text/plain";
  return "text/plain";
}

function audiencePreviewToJson(audience: string) {
  if (audience.startsWith("specific_client:")) {
    return [{ kind: "specific_client", id: audience.split(":")[1] ?? null }];
  }
  if (audience === "import_pipeline") {
    return [
      { kind: "import_pipeline", id: null },
      { kind: "review_ui", id: null }
    ];
  }
  return [{ kind: "all_agents", id: null }];
}

async function runAttachImports(input: {
  database: RecallantDb;
  projectDir: string;
  candidates: readonly DiscoveryCandidate[];
  importTextByPath: Map<string, string>;
}) {
  const imported = [];
  for (const candidate of input.candidates) {
    const writeResult = await input.database.importSource({
      project_path: input.projectDir,
      client_kind: "recallant-attach",
      source_path: candidate.path,
      source_type: candidate.source_type,
      source_sha256: candidate.source_ref.sha256,
      source_size_bytes: candidate.source_ref.size_bytes,
      content_type: contentTypeForPath(candidate.path),
      import_text: input.importTextByPath.get(candidate.path) ?? "",
      bounded_excerpt: candidate.bounded_excerpt,
      result_class: candidate.result_class,
      result_classes: candidate.result_classes,
      scope_kind: candidate.scope.scope_kind,
      scope_id: candidate.scope.scope_id,
      audience: audiencePreviewToJson(candidate.provisional_audience),
      risk: candidate.risk,
      risks: candidate.risks,
      secret_references: candidate.secret_references,
      metadata: {
        import_command: "recallant attach",
        attach_mode: "autopilot",
        import_preview_version: 1,
        promotes_instruction_grade: false
      }
    });
    imported.push({
      path: candidate.path,
      status: writeResult.status,
      event_id: writeResult.event_id,
      memory_ids: writeResult.memory_ids ?? [],
      review_required: candidateNeedsReview(candidate),
      use_policy: writeResult.memory_use_policy ?? null
    });
  }
  return imported;
}

async function createStarterMemory(input: {
  database: RecallantDb;
  projectDir: string;
  projectId: string;
  mode: AttachMode;
  changedFiles: readonly string[];
}) {
  return input.database.createAgentMemory({
    project_path: input.projectDir,
    memory_type: "environment_fact",
    scope: "project",
    scope_kind: "project",
    scope_id: input.projectId,
    audience: [{ kind: "all_agents", id: null }],
    title: "Recallant attach bootstrap",
    body: [
      `Project attached to Recallant in ${input.mode} mode.`,
      "Recallant is the main source of truth for durable project memory.",
      "`PROJECT_LOG.md` is a compact fallback/checkpoint file.",
      'Agents should start with `recallant agent-start --task-hint "<current task>"`; direct MCP tools remain the underlying transport when available.',
      `Bootstrap files changed: ${input.changedFiles.join(", ") || "none"}.`
    ].join(" "),
    confidence: 0.95,
    created_by: "system",
    metadata: {
      attach_bootstrap: true,
      attach_mode: input.mode
    }
  });
}

async function createStructuredSourceMemories(input: {
  database: RecallantDb;
  projectDir: string;
  projectId: string;
  imported: readonly { path: string; status: string; event_id: string; review_required: boolean }[];
  candidates: readonly DiscoveryCandidate[];
}) {
  const created = [];
  for (const imported of input.imported) {
    if (imported.status !== "created" || imported.review_required) continue;
    const candidate = input.candidates.find((item) => item.path === imported.path);
    if (!candidate) continue;
    const memory = await input.database.createAgentMemory({
      project_path: input.projectDir,
      memory_type: "environment_fact",
      scope: "project",
      scope_kind: "project",
      scope_id: input.projectId,
      audience: [{ kind: "all_agents", id: null }],
      title: `Attached source available: ${imported.path}`,
      body: `Recallant imported ${imported.path} as low-risk project evidence during attach. Use the source reference for details before relying on it.`,
      confidence: 0.8,
      created_by: "agent",
      source_refs: [
        {
          source_kind: "event",
          source_id: imported.event_id,
          quote: candidate.bounded_excerpt,
          metadata: {
            source_path: imported.path,
            source_sha256: candidate.source_ref.sha256,
            attach_extraction: true
          }
        }
      ],
      metadata: {
        attach_structured_extraction: true,
        source_path: imported.path
      }
    });
    created.push({ path: imported.path, ...memory });
  }
  return created;
}

async function runStartupSmoke(input: { database: RecallantDb; projectDir: string }) {
  const started = await input.database.startSession({
    client_kind: "recallant-attach",
    project_path: input.projectDir,
    session_label: "attach-startup-smoke",
    resume_policy: "normal"
  });
  const pack = await input.database.getContextPack({
    session_id: String(started.session_id),
    task_hint: "attach startup smoke",
    include_raw_evidence: "auto",
    include_recovery: true,
    local_spool_status: {
      status: "not_checked",
      record_count: 0,
      unsynced_count: 0
    }
  });
  await input.database.closeout(
    String(started.session_id),
    {
      current_status: "attach startup smoke complete",
      current_focus: "Recallant-backed project work",
      next_step: "start the next agent session with recallant agent-start --task-hint",
      open_questions: []
    },
    "closeout",
    { status: "not_checked", record_count: 0, unsynced_count: 0 }
  );
  return {
    status: "ok",
    session_id: started.session_id,
    session_closed: true,
    has_checkpoint_section: pack.sections?.checkpoint !== undefined,
    has_binding_rules_section: pack.sections?.binding_rules !== undefined
  };
}

async function runReviewVisibility(input: { database: RecallantDb; projectId: string }) {
  const dashboard = await input.database.getReviewDashboard({ project_id: input.projectId });
  return {
    status: "ok",
    project_visible: dashboard.projects.some((project) => project.project_id === input.projectId),
    import_candidate_count: dashboard.import_candidates.length,
    pending_review: dashboard.critical?.pending_review ?? 0,
    detach_cleanup_entrypoint: true
  };
}

function textReport(result: Record<string, unknown>) {
  const ownerReport = result.owner_report as Record<string, unknown>;
  return (
    [
      `Recallant attach: ${ownerReport.ready_status}`,
      `Done: ${ownerReport.what_was_done}`,
      `Needs attention: ${ownerReport.what_needs_attention}`,
      `Check: ${ownerReport.how_to_check}`,
      `Next: ${ownerReport.next_step}`
    ].join("\n") + "\n"
  );
}

export async function runAttach(argv: readonly string[]) {
  const options = parseAttachOptions(argv);
  const candidates = await detectImportCandidates(options.projectDir);
  const existingConfigResult = await readExistingConfig(options.projectDir);
  const alreadyAttached = Boolean(existingConfigResult.config?.project_id);
  const importCandidates = await selectAttachImportCandidates({
    projectDir: options.projectDir,
    candidates,
    alreadyAttached
  });
  const production = await detectProductionSensitivity(options.projectDir, candidates, options);
  const effectiveMode: AttachMode =
    options.requestedMode === "autopilot" &&
    production.production_sensitive &&
    !options.productionApproved
      ? "guided"
      : options.requestedMode;
  const confirmationRequired =
    effectiveMode === "guided" &&
    !options.confirm &&
    !(
      options.requestedMode === "autopilot" &&
      !options.modeWasProvided &&
      !production.production_sensitive
    );
  const executionAllowed =
    !options.dryRun &&
    (effectiveMode === "autopilot" || (effectiveMode === "guided" && options.confirm));
  const database = executionAllowed ? createRecallantDbFromEnv() : null;
  const identity = executionAllowed
    ? await resolveProjectIdentity({
        database,
        existingConfig: existingConfigResult.config,
        projectDir: options.projectDir
      })
    : {
        projectId: existingConfigResult.config?.project_id ?? randomUUID(),
        developerId: process.env.RECALLANT_DEVELOPER_ID ?? randomUUID(),
        source: existingConfigResult.config?.project_id ? "existing_config" : "planned"
      };
  const importTextByPath = new Map<string, string>();
  for (const candidate of importCandidates) {
    importTextByPath.set(
      candidate.path,
      await readImportTextForCandidate(options.projectDir, candidate)
    );
  }

  const agentsPath = join(options.projectDir, "AGENTS.md");
  const projectLogPath = join(options.projectDir, "PROJECT_LOG.md");
  const existingAgents = await readOptional(agentsPath);
  const existingProjectLog = await readOptional(projectLogPath);
  const changedFiles = [
    ".recallant/config",
    ".recallant/codex-mcp.json",
    ".gitignore",
    "AGENTS.md",
    "PROJECT_LOG.md"
  ];
  const changedExistingAgentFiles = [
    existingAgents === null ? null : "AGENTS.md",
    existingProjectLog === null ? null : "PROJECT_LOG.md"
  ].filter((item): item is string => item !== null);
  const agentFiles = await discoverAgentFiles(options.projectDir, candidates);
  const secretFindings = rawSecretFindings(candidates);
  const plan = plannedChanges({
    effectiveMode,
    executionAllowed,
    candidates: importCandidates,
    changedFiles,
    productionSensitive: production.production_sensitive
  });

  const result: Record<string, unknown> = {
    action: "attach",
    requested_mode: options.requestedMode,
    effective_mode: effectiveMode,
    dry_run: options.dryRun || !executionAllowed,
    status: executionAllowed
      ? "attaching"
      : confirmationRequired
        ? "needs_confirmation"
        : "plan_only",
    target: options.target,
    project_dir: options.projectDir,
    project_id: identity.projectId,
    project_id_source: identity.source,
    production_sensitive: production,
    existing_config_error:
      existingConfigResult.error ??
      ("existingConfigIssue" in identity ? String(identity.existingConfigIssue) : null),
    writes_files: executionAllowed,
    writes_database: executionAllowed && database !== null,
    planned_changes: plan,
    discovery_summary: {
      candidates: candidates.length,
      importable: candidates.filter(candidateImportable).length,
      selected_for_import: importCandidates.length,
      review_needed: candidates.filter(candidateNeedsReview).length,
      agent_files: agentFiles.length
    },
    secret_findings: {
      raw_secret_count: secretFindings.length,
      findings: secretFindings,
      live_policy:
        "Live/production-sensitive attach never edits source files for secret cleanup during preflight.",
      sandbox_policy:
        "Sandbox/test attach may mask changed bootstrap files only after a redacted local backup exists."
    }
  };

  if (!executionAllowed) {
    result.owner_report = {
      ready_status: confirmationRequired ? "Plan ready; waiting for confirmation." : "Plan ready.",
      what_was_done: "No files or database records were changed.",
      what_needs_attention: production.production_sensitive
        ? "Project looks production-sensitive; review the plan before writing."
        : "Nothing urgent.",
      how_to_check:
        "Review planned_changes and rerun with --confirm for guided execution if desired.",
      next_step:
        effectiveMode === "manual"
          ? "Use lower-level init/discover/import commands for explicit manual work."
          : "Rerun with --confirm or use --mode autopilot for an ordinary project."
    };
    process.stdout.write(
      options.format === "text" ? textReport(result) : `${JSON.stringify(result, null, 2)}\n`
    );
    if (database) await database.close();
    return;
  }

  try {
    await mkdir(join(options.projectDir, ".recallant"), { recursive: true });
    const backup = await createLocalBackup({
      projectDir: options.projectDir,
      mode: effectiveMode,
      productionSensitive: production.production_sensitive,
      agentFiles,
      changedExistingAgentFiles
    });
    const maskChangedBootstrapSecrets =
      options.explicitSandbox &&
      !production.production_sensitive &&
      (backup?.redacted_file_count ?? 0) > 0;
    await writeFile(
      join(options.projectDir, ".recallant", "config"),
      configJson(identity.projectId, options.serverUrl)
    );
    await writeFile(
      join(options.projectDir, ".recallant", "codex-mcp.json"),
      `${JSON.stringify(codexMcpConfig(identity.projectId, identity.developerId), null, 2)}\n`
    );
    await writeFile(
      join(options.projectDir, ".gitignore"),
      await upsertGitignore(options.projectDir)
    );
    await writeFile(
      agentsPath,
      upsertMemorySection(
        maskChangedBootstrapSecrets && existingAgents !== null
          ? redactSecretValues(existingAgents)
          : existingAgents
      )
    );
    await writeFile(
      projectLogPath,
      compactProjectLog({
        project: projectName(options.projectDir),
        projectId: identity.projectId,
        mode: effectiveMode,
        productionSensitive: production.production_sensitive
      })
    );

    let imported: unknown[] = [];
    let starterMemory: unknown = null;
    let structuredMemories: unknown[] = [];
    let startupSmoke: unknown = {
      status: "skipped",
      reason: "RECALLANT_DATABASE_URL is not configured"
    };
    let reviewVisibility: unknown = {
      status: "skipped",
      reason: "RECALLANT_DATABASE_URL is not configured"
    };
    if (database) {
      await database.registerProject({
        projectId: identity.projectId,
        developerId: identity.developerId,
        projectPath: options.projectDir,
        captureProfile: options.captureProfile
      });
      imported = await runAttachImports({
        database,
        projectDir: options.projectDir,
        candidates: importCandidates,
        importTextByPath
      });
      if (identity.source !== "existing_config") {
        starterMemory = await createStarterMemory({
          database,
          projectDir: options.projectDir,
          projectId: identity.projectId,
          mode: effectiveMode,
          changedFiles
        });
      }
      structuredMemories = await createStructuredSourceMemories({
        database,
        projectDir: options.projectDir,
        projectId: identity.projectId,
        imported: imported as {
          path: string;
          status: string;
          event_id: string;
          review_required: boolean;
        }[],
        candidates: importCandidates
      });
      startupSmoke = await runStartupSmoke({ database, projectDir: options.projectDir });
      reviewVisibility = await runReviewVisibility({ database, projectId: identity.projectId });
    }
    const diagnostics = {
      postgres: { configured: database !== null, used: database !== null },
      local_model: await checkOllama()
    };
    Object.assign(result, {
      dry_run: false,
      status: "attached",
      backup,
      secret_findings: {
        raw_secret_count: secretFindings.length,
        findings: secretFindings.map((finding) => ({
          ...finding,
          source_modified:
            maskChangedBootstrapSecrets &&
            changedExistingAgentFiles.includes(finding.path) &&
            candidateIsAgentFile(candidates.find((candidate) => candidate.path === finding.path)!)
        })),
        live_policy:
          "Live/production-sensitive attach never edits source files for secret cleanup during preflight.",
        sandbox_policy:
          "Sandbox/test attach may mask changed bootstrap files only after a redacted local backup exists.",
        masked_after_redacted_backup: maskChangedBootstrapSecrets,
        backup_manifest_path: backup?.manifest_path ?? null
      },
      changed_files: changedFiles,
      imported,
      starter_memory: starterMemory,
      structured_memories: structuredMemories,
      startup_smoke: startupSmoke,
      review_visibility: reviewVisibility,
      diagnostics,
      owner_report: {
        ready_status: "Project attached; agent capture is ready to start.",
        what_was_done: `Updated bootstrap files, prepared Recallant capture startup, and imported ${imported.length} source(s).`,
        what_needs_attention:
          candidates.filter(candidateNeedsReview).length > 0
            ? `${candidates.filter(candidateNeedsReview).length} imported item(s) need review.`
            : "Nothing urgent.",
        how_to_check:
          "Open the Review UI or inspect .recallant/config, AGENTS.md, and PROJECT_LOG.md.",
        next_step: 'Start an agent session with recallant agent-start --task-hint "<current task>".'
      }
    });
  } finally {
    if (database) await database.close();
  }

  process.stdout.write(
    options.format === "text" ? textReport(result) : `${JSON.stringify(result, null, 2)}\n`
  );
}

async function checkOllama() {
  const url = process.env.RECALLANT_OLLAMA_URL ?? "http://localhost:11434";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(new URL("/api/tags", url), { signal: controller.signal });
    return {
      provider: "ollama",
      reachable: response.ok,
      starts_service: false,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      provider: "ollama",
      reachable: false,
      starts_service: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
