import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

type DiscoveryClass =
  | "repo_contract"
  | "startup_instruction"
  | "handoff_checkpoint"
  | "import_source"
  | "environment_fact"
  | "secret_reference_names_only"
  | "capability_binding"
  | "connector_account_binding"
  | "possible_conflict"
  | "possible_duplicate"
  | "stale_history"
  | "oversized_context_risk";

type MigrationClass =
  | "safe_source"
  | "useful_documentation"
  | "historical_handoff"
  | "large_archive_log"
  | "raw_artifact"
  | "backup"
  | "credential_bearing_file"
  | "customer_data"
  | "private_key"
  | "environment_config_risk";

type MigrationAction = "summarize_to_memory" | "keep_as_reference" | "skip" | "ask_owner";

type DiscoveryRisk = {
  code: string;
  severity: "info" | "warning" | "high";
  message: string;
};

type SecretReferencePreview = {
  name: string;
  sensitive: boolean;
  has_example_value: boolean;
  value_redacted: boolean;
};

export type DiscoveryCandidate = {
  path: string;
  source_type: string;
  sha256: string;
  source_ref: {
    path: string;
    sha256: string;
    size_bytes: number;
    line_count: number;
  };
  result_class: DiscoveryClass;
  result_classes: DiscoveryClass[];
  provisional_scope: "project" | "environment" | "client_adapter";
  scope: {
    scope_kind: "project" | "environment" | "client_adapter";
    scope_id: string | null;
  };
  provisional_audience: string;
  risk: "low" | "medium" | "high";
  risks: DiscoveryRisk[];
  migration_classes: MigrationClass[];
  migration_action: MigrationAction;
  migration_review_status: "owner_approval_required";
  migration_memory_candidate: {
    memory_type: "work_log" | "decision" | "procedure" | "environment_fact";
    title: string;
    body: string;
    confidence: number;
    review_status: "needs_owner_approval";
    source_refs: Array<{
      source_kind: "external";
      source_id: string;
      quote: string | null;
      metadata: {
        source_path: string;
        source_sha256: string;
        migration_classes: MigrationClass[];
      };
    }>;
  } | null;
  bounded_excerpt: string;
  context_budget: {
    status: "ok" | "warning" | "risk";
    size_bytes: number;
    line_count: number;
    warnings: string[];
  };
  secret_references: SecretReferencePreview[];
  suggested_command: string;
  import_suggestion: {
    importable: boolean;
    dry_run_command: string;
    command: string;
    note: string;
  };
};

const discoveryReadMaxBytes = 250_000;

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function safeRelativePath(input: string) {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Import target must stay inside --project-dir: ${input}`);
  }
  return normalized;
}

async function listSelectedProjectDocs(projectDir: string) {
  const selected: string[] = [];
  const docDirs = ["docs", "Docs", "runbooks", "Runbooks"];
  const selectedDocName =
    /^(README|RUNBOOK|RUNBOOKS|OPERATIONS|OPERATOR|DEPLOYMENT|ARCHITECTURE|SECURITY|QUICKSTART|Codex_Context_Index)([-_\w]*)?\.md$/i;
  for (const dir of docDirs) {
    let entries;
    try {
      entries = await readdir(join(projectDir, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && selectedDocName.test(entry.name)) {
        selected.push(`${dir}/${entry.name}`);
      }
      if (entry.isDirectory() && /^(runbooks?|operations?)$/i.test(entry.name)) {
        try {
          const nested = await readdir(join(projectDir, dir, entry.name), { withFileTypes: true });
          for (const nestedEntry of nested) {
            if (nestedEntry.isFile() && selectedDocName.test(nestedEntry.name)) {
              selected.push(`${dir}/${entry.name}/${nestedEntry.name}`);
            }
          }
        } catch {
          // Ignore directories that disappear during a read-only preflight scan.
        }
      }
    }
  }
  return selected;
}

async function listFilesIfPresent(projectDir: string, relativeDir: string) {
  const selected: string[] = [];
  let entries;
  try {
    entries = await readdir(join(projectDir, relativeDir), { withFileTypes: true });
  } catch {
    return selected;
  }
  for (const entry of entries) {
    if (entry.isFile()) selected.push(`${relativeDir}/${entry.name}`);
  }
  return selected;
}

async function listOneLevelFilesIfPresent(projectDir: string, relativeDir: string) {
  const selected: string[] = [];
  let entries;
  try {
    entries = await readdir(join(projectDir, relativeDir), { withFileTypes: true });
  } catch {
    return selected;
  }
  for (const entry of entries) {
    if (entry.isFile()) selected.push(`${relativeDir}/${entry.name}`);
  }
  return selected;
}

async function discoverCandidatePaths(projectDir: string) {
  const paths = new Set([
    "AGENTS.md",
    "PROJECT_LOG.md",
    ".cursor/SESSION_HANDOFF.md",
    "CLAUDE.md",
    "README.md",
    "Docs/Codex_Context_Index.md",
    ".env.example",
    ".env.sample",
    ".env.template",
    "env.example",
    "example.env",
    ".env",
    ".env.local"
  ]);
  try {
    const rootEntries = await readdir(projectDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && /^PROJECT_LOG_.+\.md$/i.test(entry.name)) {
        paths.add(entry.name);
      }
      if (
        entry.isFile() &&
        /(^|[-_.])(config|settings|deploy|deployment|compose|systemd|service)([-_.]|$)/i.test(
          entry.name
        )
      ) {
        paths.add(entry.name);
      }
      if (
        entry.isFile() &&
        /(\.log|\.bak|\.backup|\.dump|\.sql|\.pem|\.key|\.p8|\.zip|\.tar|\.tgz|\.tar\.gz)$/i.test(
          entry.name
        )
      ) {
        paths.add(entry.name);
      }
      if (entry.isFile() && /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(entry.name)) {
        paths.add(entry.name);
      }
    }
  } catch {
    // Ignore project roots that disappear during a read-only preflight scan.
  }
  for (const cursorRule of await listFilesIfPresent(projectDir, ".cursor/rules")) {
    paths.add(cursorRule);
  }
  for (const docPath of await listSelectedProjectDocs(projectDir)) {
    paths.add(docPath);
  }
  for (const dir of [
    "logs",
    "log",
    "backups",
    "backup",
    "raw",
    "raw_artifacts",
    "artifacts",
    "exports",
    "data",
    "customer_data",
    "customers"
  ]) {
    for (const riskyPath of await listOneLevelFilesIfPresent(projectDir, dir)) {
      paths.add(riskyPath);
    }
  }
  return Array.from(paths).sort();
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeForDuplicateDetection(content: string) {
  const withoutHeadings = content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  return createHash("sha256")
    .update(withoutHeadings.toLowerCase().replaceAll(/\s+/g, " ").trim())
    .digest("hex");
}

function isSecretReferencePath(path: string) {
  return /(^|\/)\.env($|\.|_)|(^|\/)(env\.example|example\.env)$/i.test(path);
}

function isSecretExamplePath(path: string) {
  return /(^|\/)(\.env\.(example|sample|template)|env\.example|example\.env)$/i.test(path);
}

function isSensitiveName(name: string) {
  return /(api[_-]?key|token|secret|password|passwd|pwd|private|credential|auth|cookie|session|webhook|database_url|dsn)/i.test(
    name
  );
}

function isCapabilityName(name: string) {
  return /(openai|gemini|anthropic|claude|ollama|supabase|resend|cloudflare|github|google|gmail|drive|calendar|postgres|database|ssh|docker|model)/i.test(
    name
  );
}

function isConnectorAccountName(name: string) {
  return /(google|gmail|drive|calendar|github|slack|notion|linear|jira)/i.test(name);
}

function envAssignment(line: string) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match?.[1]) return null;
  return {
    name: match[1],
    value: match[2] ?? ""
  };
}

function extractSecretReferences(content: string) {
  const refs = new Map<string, SecretReferencePreview>();
  for (const line of content.split("\n")) {
    const assignment = envAssignment(line);
    if (!assignment) continue;
    const hasExampleValue = assignment.value.trim().length > 0;
    refs.set(assignment.name, {
      name: assignment.name,
      sensitive: isSensitiveName(assignment.name),
      has_example_value: hasExampleValue,
      value_redacted: hasExampleValue
    });
  }
  return Array.from(refs.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function lineWithRedactedSecrets(line: string) {
  const assignment = envAssignment(line);
  if (assignment && assignment.value.trim().length > 0) {
    return line.replace(/=.*/, "=<redacted>");
  }
  return line
    .replaceAll(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "<redacted-private-key>"
    )
    .replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted-token>")
    .replaceAll(/gh[pousr]_[A-Za-z0-9_]{8,}/g, "<redacted-token>")
    .replaceAll(/xox[baprs]-[A-Za-z0-9-]{8,}/g, "<redacted-token>")
    .replaceAll(/:\/\/([^:\s/@]+):([^@\s]+)@/g, "://<redacted>:<redacted>@");
}

export function redactSecretValues(content: string) {
  return content.split("\n").map(lineWithRedactedSecrets).join("\n");
}

function boundedExcerpt(content: string) {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 4)
    .map(lineWithRedactedSecrets);
  const excerpt = lines.join("\n");
  return excerpt.length > 500 ? `${excerpt.slice(0, 497)}...` : excerpt;
}

function sourceTypeFor(path: string) {
  if (path === "AGENTS.md") return "agent_instructions";
  if (path === "PROJECT_LOG.md") return "project_log";
  if (path === ".cursor/SESSION_HANDOFF.md") return "cursor_handoff";
  if (path === "CLAUDE.md") return "client_specific_instructions";
  if (path === "README.md") return "readme";
  if (isSecretExamplePath(path)) return "secret_reference_example";
  if (isSecretReferencePath(path)) return "secret_file_names_only";
  return "selected_project_doc";
}

function audienceFor(path: string) {
  if (path === "CLAUDE.md") return "specific_client:claude_code";
  if (path === ".cursor/SESSION_HANDOFF.md") return "specific_client:cursor";
  if (isSecretReferencePath(path)) return "import_pipeline";
  return "all_agents";
}

function scopeFor(path: string) {
  if (isSecretReferencePath(path) || /(^|\/)(RUNBOOK|OPERATIONS|DEPLOYMENT|SECURITY)/i.test(path)) {
    return "environment" as const;
  }
  if (path === "CLAUDE.md" || path.startsWith(".cursor/")) {
    return "client_adapter" as const;
  }
  return "project" as const;
}

function countDateMentions(content: string) {
  return content.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g)?.length ?? 0;
}

function looksLikeHistoryDump(content: string) {
  const headings = content.match(/^#{1,3}\s+/gm)?.length ?? 0;
  const datedMentions = countDateMentions(content);
  return (
    headings >= 8 ||
    datedMentions >= 4 ||
    /session archive|historical log|previous sessions|old handoff|stale handoff/i.test(content)
  );
}

function hasRawSecretValue(content: string, secretReferences: SecretReferencePreview[]) {
  if (secretReferences.some((ref) => ref.sensitive && ref.has_example_value)) return true;
  return (
    /sk-[A-Za-z0-9_-]{8,}/.test(content) ||
    /gh[pousr]_[A-Za-z0-9_]{8,}/.test(content) ||
    /xox[baprs]-[A-Za-z0-9-]{8,}/.test(content) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ||
    /:\/\/[^:\s/@]+:[^@\s]+@/.test(content)
  );
}

function hasPolicyDirective(content: string) {
  return /\b(always|never|must|do not|don't|forbidden|required|use only|prefer)\b/i.test(content);
}

function highRiskOperationalContent(content: string) {
  return /\b(production|firewall|cloudflare|paid api|api key|secret|token|database|ssh|sudo|delete|erase|drop)\b/i.test(
    content
  );
}

function pathLooksLikeLargeArchiveOrLog(path: string) {
  return /(^|\/)(logs?|archives?)(\/|$)|(\.log|\.ndjson|\.jsonl)$/i.test(path);
}

function pathLooksLikeRawArtifact(path: string) {
  return /(^|\/)(raw|raw_artifacts|artifacts|exports)(\/|$)|(\.har|\.trace|\.transcript|\.capture)$/i.test(
    path
  );
}

function pathLooksLikeBackup(path: string) {
  return /(^|\/)(backups?|archive)(\/|$)|(\.bak|\.backup|\.dump|\.sql|\.zip|\.tar|\.tgz|\.tar\.gz)$/i.test(
    path
  );
}

function pathLooksLikeCustomerData(path: string) {
  return /(^|\/)(customer_data|customers?|tickets?|users?|contacts?)(\/|$)|customer|client|ticket|zendesk/i.test(
    path
  );
}

function pathLooksLikePrivateKey(path: string) {
  return /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$|(\.pem|\.key|\.p8)$/i.test(path);
}

function pathLooksLikeEnvironmentConfigRisk(path: string) {
  return (
    isSecretReferencePath(path) ||
    /(^|\/)(docker-compose|compose|systemd|deploy|deployment|config|settings|secrets?)(\/|\.|$)|(\.service|\.toml|\.ya?ml)$/i.test(
      path
    )
  );
}

function addRisk(risks: DiscoveryRisk[], risk: DiscoveryRisk) {
  if (!risks.some((existing) => existing.code === risk.code)) risks.push(risk);
}

function baseClassesFor(path: string, content: string, secretReferences: SecretReferencePreview[]) {
  const classes = new Set<DiscoveryClass>(["import_source"]);
  if (path === "AGENTS.md") {
    classes.add("repo_contract");
    classes.add("startup_instruction");
  }
  if (path === "README.md") classes.add("repo_contract");
  if (path === "PROJECT_LOG.md" || path === ".cursor/SESSION_HANDOFF.md") {
    classes.add("handoff_checkpoint");
  }
  if (path === "CLAUDE.md") classes.add("startup_instruction");
  if (isSecretReferencePath(path) || secretReferences.length > 0) {
    classes.add("secret_reference_names_only");
    classes.add("environment_fact");
  }
  if (
    secretReferences.some((ref) => isCapabilityName(ref.name)) ||
    /\b(ollama|postgres|cloudflare|supabase|openai|gemini|anthropic|github|google)\b/i.test(content)
  ) {
    classes.add("capability_binding");
  }
  if (
    secretReferences.some((ref) => isConnectorAccountName(ref.name)) ||
    /\b(gmail|google drive|calendar|github account|connector account)\b/i.test(content)
  ) {
    classes.add("connector_account_binding");
  }
  if (
    /\b(port|service|systemd|docker|localhost|127\.0\.0\.1|server|runtime|env)\b/i.test(content)
  ) {
    classes.add("environment_fact");
  }
  return classes;
}

function classesFromRisks(classes: Set<DiscoveryClass>, risks: DiscoveryRisk[]) {
  for (const risk of risks) {
    if (risk.code === "possible_conflict") classes.add("possible_conflict");
    if (risk.code === "possible_duplicate") classes.add("possible_duplicate");
    if (risk.code === "stale_history") classes.add("stale_history");
    if (risk.code === "oversized_context_risk") classes.add("oversized_context_risk");
  }
  return classes;
}

function primaryClass(classes: DiscoveryClass[]) {
  const priority: DiscoveryClass[] = [
    "secret_reference_names_only",
    "handoff_checkpoint",
    "repo_contract",
    "startup_instruction",
    "environment_fact",
    "capability_binding",
    "connector_account_binding",
    "possible_conflict",
    "possible_duplicate",
    "stale_history",
    "oversized_context_risk",
    "import_source"
  ];
  return priority.find((item) => classes.includes(item)) ?? "import_source";
}

function summarizeRisk(risks: DiscoveryRisk[]) {
  if (risks.some((risk) => risk.severity === "high")) return "high" as const;
  if (risks.some((risk) => risk.severity === "warning")) return "medium" as const;
  return "low" as const;
}

function contextBudgetFor(path: string, content: string, sizeBytes: number, lineCount: number) {
  const warnings: string[] = [];
  const agentFile = ["AGENTS.md", "CLAUDE.md", ".cursor/SESSION_HANDOFF.md"].includes(path);
  const logFile = path === "PROJECT_LOG.md";
  if ((agentFile && sizeBytes > 24_000) || (logFile && sizeBytes > 32_000)) {
    warnings.push("File exceeds the bootstrap context budget for its source type.");
  }
  if ((agentFile || logFile) && looksLikeHistoryDump(content)) {
    warnings.push(
      "File looks like a historical/session dump rather than a compact bootstrap surface."
    );
  }
  if (sizeBytes > discoveryReadMaxBytes || pathLooksLikeLargeArchiveOrLog(path)) {
    warnings.push(
      "File is treated as a large archive/log candidate; migrate only concise summaries."
    );
  }
  return {
    status: warnings.length > 0 ? ("risk" as const) : ("ok" as const),
    size_bytes: sizeBytes,
    line_count: lineCount,
    warnings
  };
}

function migrationClassesFor(input: {
  path: string;
  content: string;
  sizeBytes: number;
  secretReferences: readonly SecretReferencePreview[];
}) {
  const classes = new Set<MigrationClass>();
  const usefulDoc =
    input.path === "README.md" ||
    input.path === "AGENTS.md" ||
    /(^|\/)(docs?|runbooks?|operations?)\//i.test(input.path) ||
    /(RUNBOOK|ARCHITECTURE|SECURITY|QUICKSTART|DEPLOYMENT|OPERATIONS)\.md$/i.test(input.path);
  if (usefulDoc) classes.add("useful_documentation");
  if (
    input.path === "PROJECT_LOG.md" ||
    /^PROJECT_LOG_.+\.md$/i.test(input.path) ||
    input.path === ".cursor/SESSION_HANDOFF.md" ||
    looksLikeHistoryDump(input.content)
  ) {
    classes.add("historical_handoff");
  }
  if (pathLooksLikeLargeArchiveOrLog(input.path) || input.sizeBytes > discoveryReadMaxBytes) {
    classes.add("large_archive_log");
  }
  if (pathLooksLikeRawArtifact(input.path)) classes.add("raw_artifact");
  if (pathLooksLikeBackup(input.path)) classes.add("backup");
  if (isSecretReferencePath(input.path) || input.secretReferences.length > 0) {
    classes.add("credential_bearing_file");
  }
  if (pathLooksLikeCustomerData(input.path)) classes.add("customer_data");
  if (
    pathLooksLikePrivateKey(input.path) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input.content)
  ) {
    classes.add("private_key");
  }
  if (pathLooksLikeEnvironmentConfigRisk(input.path) || highRiskOperationalContent(input.content)) {
    classes.add("environment_config_risk");
  }
  const hasRiskyClass = Array.from(classes).some((item) =>
    [
      "large_archive_log",
      "raw_artifact",
      "backup",
      "credential_bearing_file",
      "customer_data",
      "private_key",
      "environment_config_risk"
    ].includes(item)
  );
  if (!hasRiskyClass) classes.add("safe_source");
  return Array.from(classes).sort();
}

function migrationActionFor(classes: readonly MigrationClass[]) {
  if (
    classes.some((item) =>
      ["private_key", "customer_data", "raw_artifact", "backup"].includes(item)
    )
  ) {
    return "skip" as const;
  }
  if (
    classes.some((item) => ["credential_bearing_file", "environment_config_risk"].includes(item))
  ) {
    return "ask_owner" as const;
  }
  if (classes.some((item) => ["historical_handoff", "large_archive_log"].includes(item))) {
    return "keep_as_reference" as const;
  }
  return "summarize_to_memory" as const;
}

function migrationMemoryTypeFor(classes: readonly MigrationClass[]) {
  if (classes.includes("environment_config_risk")) return "environment_fact" as const;
  if (classes.includes("useful_documentation")) return "procedure" as const;
  if (classes.includes("historical_handoff")) return "work_log" as const;
  return "work_log" as const;
}

function migrationMemoryCandidate(input: {
  path: string;
  sourceSha256: string;
  migrationClasses: readonly MigrationClass[];
  action: MigrationAction;
  excerpt: string;
}) {
  if (input.action === "skip") return null;
  const summary = input.excerpt
    ? input.excerpt.replaceAll(/\s+/g, " ").slice(0, 300)
    : "Metadata-only source; review the source path before writing memory.";
  return {
    memory_type: migrationMemoryTypeFor(input.migrationClasses),
    title: `Migration candidate: ${input.path}`.slice(0, 120),
    body: [
      `Concise migration candidate for ${input.path}.`,
      `Classes: ${input.migrationClasses.join(", ")}.`,
      `Approved action: ${input.action}.`,
      `Summary: ${summary}`
    ].join(" "),
    confidence: input.action === "summarize_to_memory" ? 0.75 : 0.6,
    review_status: "needs_owner_approval" as const,
    source_refs: [
      {
        source_kind: "external" as const,
        source_id: `${input.path}@${input.sourceSha256}`,
        quote: input.excerpt || null,
        metadata: {
          source_path: input.path,
          source_sha256: input.sourceSha256,
          migration_classes: [...input.migrationClasses]
        }
      }
    ]
  };
}

function buildDiscoveryCandidate(relativePath: string, content: string, sizeBytes: number) {
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  const secretReferences = extractSecretReferences(content);
  const risks: DiscoveryRisk[] = [];
  const contextBudget = contextBudgetFor(relativePath, content, sizeBytes, lineCount);
  if (contextBudget.warnings.length > 0) {
    addRisk(risks, {
      code: "oversized_context_risk",
      severity: "warning",
      message: contextBudget.warnings.join(" ")
    });
  }
  if (looksLikeHistoryDump(content)) {
    addRisk(risks, {
      code: "stale_history",
      severity: "warning",
      message:
        "Source may contain stale historical handoff material; import only selected current facts."
    });
  }
  if (isSecretReferencePath(relativePath) && !isSecretExamplePath(relativePath)) {
    addRisk(risks, {
      code: "secret_file_names_only",
      severity: "high",
      message:
        "Secret-like file detected. Discovery reports variable names only and import should not copy raw values."
    });
  }
  if (pathLooksLikePrivateKey(relativePath)) {
    addRisk(risks, {
      code: "private_key_path_detected",
      severity: "high",
      message: "Private-key-like path detected. Discovery reports path/class only."
    });
  }
  if (pathLooksLikeCustomerData(relativePath)) {
    addRisk(risks, {
      code: "customer_data_path_detected",
      severity: "high",
      message: "Customer-data-like path detected. Discovery reports path/class only."
    });
  }
  if (pathLooksLikeRawArtifact(relativePath)) {
    addRisk(risks, {
      code: "raw_artifact_path_detected",
      severity: "warning",
      message: "Raw-artifact-like path detected; do not migrate raw dumps."
    });
  }
  if (pathLooksLikeBackup(relativePath)) {
    addRisk(risks, {
      code: "backup_path_detected",
      severity: "warning",
      message: "Backup/archive-like path detected; keep as reference unless explicitly reviewed."
    });
  }
  if (hasRawSecretValue(content, secretReferences)) {
    addRisk(risks, {
      code: "raw_secret_value_detected",
      severity: "high",
      message: "Secret-like values were detected and redacted from discovery output."
    });
  }
  if (
    (relativePath === "CLAUDE.md" || relativePath.startsWith(".cursor/")) &&
    hasPolicyDirective(content)
  ) {
    addRisk(risks, {
      code: "possible_conflict",
      severity: "warning",
      message:
        "Client-specific instructions may conflict with universal agent behavior; keep them client-scoped unless reviewed."
    });
  }
  if (highRiskOperationalContent(content)) {
    addRisk(risks, {
      code: "high_risk_operational_context",
      severity: "warning",
      message:
        "Source mentions security, deployment, credentials, paid API, or destructive operations; review before promotion."
    });
  }

  const classes = classesFromRisks(baseClassesFor(relativePath, content, secretReferences), risks);
  const resultClasses = Array.from(classes).sort();
  const migrationClasses = migrationClassesFor({
    path: relativePath,
    content,
    sizeBytes,
    secretReferences
  });
  const migrationAction = migrationActionFor(migrationClasses);
  const sourceScope = scopeFor(relativePath);
  const commandPath = relativePath.includes(" ") ? JSON.stringify(relativePath) : relativePath;
  const importable =
    !(isSecretReferencePath(relativePath) && !isSecretExamplePath(relativePath)) &&
    !migrationClasses.some((item) =>
      ["private_key", "customer_data", "raw_artifact", "backup"].includes(item)
    );
  const excerpt = boundedExcerpt(content);
  return {
    path: relativePath,
    source_type: sourceTypeFor(relativePath),
    sha256: sha256(content),
    source_ref: {
      path: relativePath,
      sha256: sha256(content),
      size_bytes: sizeBytes,
      line_count: lineCount
    },
    result_class: primaryClass(resultClasses),
    result_classes: resultClasses,
    provisional_scope: sourceScope,
    scope: {
      scope_kind: sourceScope,
      scope_id: null
    },
    provisional_audience: audienceFor(relativePath),
    risk: summarizeRisk(risks),
    risks,
    migration_classes: migrationClasses,
    migration_action: migrationAction,
    migration_review_status: "owner_approval_required",
    migration_memory_candidate: migrationMemoryCandidate({
      path: relativePath,
      sourceSha256: sha256(content),
      migrationClasses,
      action: migrationAction,
      excerpt
    }),
    bounded_excerpt: excerpt,
    context_budget: contextBudget,
    secret_references: secretReferences,
    suggested_command: `recallant import --dry-run ${commandPath}`,
    import_suggestion: {
      importable,
      dry_run_command: `recallant import --dry-run ${commandPath}`,
      command: `recallant import ${commandPath}`,
      note: importable
        ? "Preview first; confirmed import must preserve source refs and avoid silent instruction promotion."
        : "Not importable by default because raw secret files may contain values."
    }
  } satisfies DiscoveryCandidate;
}

async function readDiscoveryInput(projectDir: string, relativePath: string) {
  const safePath = safeRelativePath(relativePath);
  const absolutePath = join(projectDir, safePath);
  let sizeBytes = 0;
  try {
    sizeBytes = (await stat(absolutePath)).size;
  } catch {
    return null;
  }
  const metadataOnly =
    sizeBytes > discoveryReadMaxBytes ||
    pathLooksLikePrivateKey(safePath) ||
    pathLooksLikeCustomerData(safePath) ||
    pathLooksLikeRawArtifact(safePath) ||
    pathLooksLikeBackup(safePath);
  if (metadataOnly && !isSecretReferencePath(safePath)) {
    return {
      safePath,
      content: "",
      sizeBytes
    };
  }
  return {
    safePath,
    content: (await readOptional(absolutePath)) ?? "",
    sizeBytes
  };
}

async function readDiscoveryCandidate(projectDir: string, relativePath: string) {
  const input = await readDiscoveryInput(projectDir, relativePath);
  if (!input) return null;
  return buildDiscoveryCandidate(input.safePath, input.content, input.sizeBytes);
}

function refreshCandidateDerivedFields(candidate: DiscoveryCandidate) {
  candidate.result_classes = Array.from(new Set(candidate.result_classes)).sort();
  candidate.result_class = primaryClass(candidate.result_classes);
  candidate.risk = summarizeRisk(candidate.risks);
  if (candidate.context_budget.warnings.length > 0) {
    candidate.context_budget.status = candidate.risk === "high" ? "risk" : "warning";
  }
}

export async function detectImportCandidates(projectDir: string) {
  const candidates: DiscoveryCandidate[] = [];
  const contentByPath = new Map<string, string>();
  const normalizedHashes = new Map<string, string[]>();
  for (const relativePath of await discoverCandidatePaths(projectDir)) {
    const input = await readDiscoveryInput(projectDir, relativePath);
    if (!input) continue;
    const candidate = buildDiscoveryCandidate(input.safePath, input.content, input.sizeBytes);
    if (!candidate) continue;
    candidates.push(candidate);
    contentByPath.set(input.safePath, input.content);
    if (!input.content) continue;
    const normalizedHash = normalizeForDuplicateDetection(input.content);
    normalizedHashes.set(normalizedHash, [
      ...(normalizedHashes.get(normalizedHash) ?? []),
      input.safePath
    ]);
  }

  for (const duplicatePaths of normalizedHashes.values()) {
    if (duplicatePaths.length < 2) continue;
    for (const duplicatePath of duplicatePaths) {
      const candidate = candidates.find((item) => item.path === duplicatePath);
      if (!candidate) continue;
      addRisk(candidate.risks, {
        code: "possible_duplicate",
        severity: "warning",
        message: `Content is duplicated with ${duplicatePaths.filter((path) => path !== duplicatePath).join(", ")}.`
      });
      candidate.result_classes.push("possible_duplicate");
      refreshCandidateDerivedFields(candidate);
    }
  }

  const directiveCandidates = candidates.filter((candidate) => {
    const content = contentByPath.get(candidate.path) ?? "";
    return candidate.result_classes.includes("startup_instruction") && hasPolicyDirective(content);
  });
  if (directiveCandidates.length > 1) {
    for (const candidate of directiveCandidates) {
      addRisk(candidate.risks, {
        code: "possible_conflict",
        severity: "warning",
        message:
          "Multiple startup instruction surfaces contain behavioral directives; import should preserve audience/scope and route conflicts to review."
      });
      candidate.result_classes.push("possible_conflict");
      refreshCandidateDerivedFields(candidate);
    }
  }

  return candidates.sort((left, right) => left.path.localeCompare(right.path));
}

export async function discoveryCandidateForImport(projectDir: string, target: string) {
  const safeTarget = safeRelativePath(target);
  const discovered = await detectImportCandidates(projectDir);
  const knownCandidate = discovered.find((candidate) => candidate.path === safeTarget);
  if (knownCandidate) return knownCandidate;
  return readDiscoveryCandidate(projectDir, safeTarget);
}

export async function readImportTextForCandidate(
  projectDir: string,
  candidate: DiscoveryCandidate
) {
  if (candidate.result_classes.includes("secret_reference_names_only")) {
    return candidate.secret_references
      .map((ref) =>
        [
          `secret_reference ${ref.name}`,
          `sensitive=${ref.sensitive}`,
          `has_example_value=${ref.has_example_value}`,
          "value=<redacted>"
        ].join(" ")
      )
      .join("\n");
  }
  const content = await readOptional(join(projectDir, safeRelativePath(candidate.path)));
  if (content === null) return "";
  return redactSecretValues(content);
}

function discoverySummary(candidates: DiscoveryCandidate[]) {
  const byRisk = { low: 0, medium: 0, high: 0 };
  const byClass: Record<string, number> = {};
  const byMigrationClass: Record<string, number> = {};
  const byMigrationAction: Record<string, number> = {};
  for (const candidate of candidates) {
    byRisk[candidate.risk] += 1;
    for (const resultClass of candidate.result_classes) {
      byClass[resultClass] = (byClass[resultClass] ?? 0) + 1;
    }
    for (const migrationClass of candidate.migration_classes) {
      byMigrationClass[migrationClass] = (byMigrationClass[migrationClass] ?? 0) + 1;
    }
    byMigrationAction[candidate.migration_action] =
      (byMigrationAction[candidate.migration_action] ?? 0) + 1;
  }
  return {
    candidate_count: candidates.length,
    by_risk: byRisk,
    by_class: byClass,
    by_migration_class: byMigrationClass,
    by_migration_action: byMigrationAction,
    high_risk_count: byRisk.high,
    context_budget_risk_count: candidates.filter((candidate) =>
      candidate.result_classes.includes("oversized_context_risk")
    ).length,
    secret_reference_count: candidates.reduce(
      (sum, candidate) => sum + candidate.secret_references.length,
      0
    )
  };
}

function riskInventory(candidates: DiscoveryCandidate[]) {
  const risky = candidates.filter(
    (candidate) =>
      candidate.risk !== "low" ||
      candidate.migration_classes.some(
        (item) => item !== "safe_source" && item !== "useful_documentation"
      )
  );
  const byClass: Record<string, number> = {};
  for (const candidate of risky) {
    for (const migrationClass of candidate.migration_classes) {
      byClass[migrationClass] = (byClass[migrationClass] ?? 0) + 1;
    }
  }
  return {
    risky_path_count: risky.length,
    by_class: byClass,
    findings: risky.map((candidate) => ({
      path: candidate.path,
      risk: candidate.risk,
      classes: candidate.migration_classes,
      risk_codes: candidate.risks.map((risk) => risk.code),
      secret_reference_names: candidate.secret_references.map((ref) => ref.name),
      values_redacted: true
    })),
    redaction_policy:
      "Inventory reports paths, classes, counts, and secret reference names only; raw values and private-key/customer/raw-artifact contents are not printed."
  };
}

function migrationPlan(projectDir: string, candidates: DiscoveryCandidate[]) {
  const entries = candidates.map((candidate) => ({
    path: candidate.path,
    action: candidate.migration_action,
    classes: candidate.migration_classes,
    review_status: candidate.migration_review_status,
    source_ref: candidate.source_ref,
    memory_candidate: candidate.migration_memory_candidate,
    import_candidate: {
      importable: candidate.import_suggestion.importable,
      review_status: "needs_owner_approval",
      dry_run_command: candidate.import_suggestion.dry_run_command,
      confirm_command: candidate.import_suggestion.command,
      promotes_instruction_grade: false
    }
  }));
  return {
    mode: "review_first",
    dry_run_default: true,
    owner_approval_required: true,
    writes_before_approval: false,
    approval_gate: {
      server_local:
        "Review this plan, then run explicit `recallant import <path>` commands or `recallant attach <project-dir> --mode guided --confirm`.",
      remote_only:
        "Review this plan, then use the configured remote MCP `memory_create_agent_memory` tool only for approved concise memory candidates; no local Postgres is required.",
      checkpoint:
        "After approved migration, verify recall of one safe marker and update checkpoint separately with memory_set_checkpoint or memory_agent_checkpoint."
    },
    bounded_counts: {
      entries: entries.length,
      memory_candidates: entries.filter((entry) => entry.memory_candidate !== null).length,
      import_candidates: entries.filter((entry) => entry.import_candidate.importable).length,
      skipped: entries.filter((entry) => entry.action === "skip").length,
      ask_owner: entries.filter((entry) => entry.action === "ask_owner").length
    },
    remote_mcp_tool_sequence: [
      "memory_create_agent_memory",
      "memory_recall_agent_memories",
      "memory_set_checkpoint"
    ],
    project_dir: projectDir,
    entries
  };
}

export function discoveryResult(projectDir: string, candidates: DiscoveryCandidate[]) {
  return {
    action: "discover",
    dry_run: true,
    read_only: true,
    project_dir: projectDir,
    summary: discoverySummary(candidates),
    risk_inventory: riskInventory(candidates),
    migration_plan: migrationPlan(projectDir, candidates),
    candidates,
    planned_changes: [
      {
        action: "none",
        writes_files: false,
        writes_database: false,
        writes_memory: false,
        promotes_instruction_grade: false,
        reason: "Discovery preflight only classifies source-linked candidates."
      }
    ],
    writes_memory: false,
    writes_files: false,
    promotes_instruction_grade: false
  };
}

export function formatDiscoveryText(result: ReturnType<typeof discoveryResult>) {
  const lines = [
    "Recallant discovery preflight",
    `Project: ${result.project_dir}`,
    "Mode: read-only; no files, database rows, active memories, or instruction-grade records are written.",
    `Candidates: ${result.summary.candidate_count} (high risk: ${result.summary.high_risk_count}, context risks: ${result.summary.context_budget_risk_count})`,
    `Risk inventory: ${result.risk_inventory.risky_path_count} path(s), classes=${
      Object.entries(result.risk_inventory.by_class)
        .map(([key, value]) => `${key}:${value}`)
        .join(", ") || "none"
    }`,
    "Migration plan: owner approval required before any memory/import writes.",
    ""
  ];
  for (const candidate of result.candidates) {
    lines.push(
      `- ${candidate.path} [${candidate.result_classes.join(", ")}] migration=[${candidate.migration_classes.join(", ")}] risk=${candidate.risk}`,
      `  scope=${candidate.provisional_scope} audience=${candidate.provisional_audience}`,
      `  action=${candidate.migration_action} review=${candidate.migration_review_status}`,
      `  source=${candidate.source_ref.sha256} size=${candidate.source_ref.size_bytes} bytes`,
      `  import=${candidate.import_suggestion.importable ? candidate.import_suggestion.dry_run_command : "not importable by default"}`
    );
    for (const risk of candidate.risks) {
      lines.push(`  risk:${risk.severity}:${risk.code} ${risk.message}`);
    }
  }
  lines.push(
    "",
    "Planned changes: none. Use `recallant import --dry-run <path>` to preview an explicit import."
  );
  return `${lines.join("\n")}\n`;
}
