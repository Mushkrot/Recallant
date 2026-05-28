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
  for (const docPath of await listSelectedProjectDocs(projectDir)) {
    paths.add(docPath);
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
    .replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted-token>")
    .replaceAll(/gh[pousr]_[A-Za-z0-9_]{8,}/g, "<redacted-token>")
    .replaceAll(/xox[baprs]-[A-Za-z0-9-]{8,}/g, "<redacted-token>")
    .replaceAll(/:\/\/([^:\s/@]+):([^@\s]+)@/g, "://<redacted>:<redacted>@");
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
  return {
    status: warnings.length > 0 ? ("risk" as const) : ("ok" as const),
    size_bytes: sizeBytes,
    line_count: lineCount,
    warnings
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
  const sourceScope = scopeFor(relativePath);
  const commandPath = relativePath.includes(" ") ? JSON.stringify(relativePath) : relativePath;
  const importable = !(isSecretReferencePath(relativePath) && !isSecretExamplePath(relativePath));
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
    bounded_excerpt: boundedExcerpt(content),
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

async function readDiscoveryCandidate(projectDir: string, relativePath: string) {
  const safePath = safeRelativePath(relativePath);
  const absolutePath = join(projectDir, safePath);
  const content = await readOptional(absolutePath);
  if (content === null) return null;
  let sizeBytes = Buffer.byteLength(content);
  try {
    sizeBytes = (await stat(absolutePath)).size;
  } catch {
    // Fall back to UTF-8 byte length if stat is unavailable during read-only discovery.
  }
  return buildDiscoveryCandidate(safePath, content, sizeBytes);
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
    const safePath = safeRelativePath(relativePath);
    const absolutePath = join(projectDir, safePath);
    const content = await readOptional(absolutePath);
    if (content === null) continue;
    const candidate = await readDiscoveryCandidate(projectDir, safePath);
    if (!candidate) continue;
    candidates.push(candidate);
    contentByPath.set(safePath, content);
    const normalizedHash = normalizeForDuplicateDetection(content);
    normalizedHashes.set(normalizedHash, [
      ...(normalizedHashes.get(normalizedHash) ?? []),
      safePath
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

function discoverySummary(candidates: DiscoveryCandidate[]) {
  const byRisk = { low: 0, medium: 0, high: 0 };
  const byClass: Record<string, number> = {};
  for (const candidate of candidates) {
    byRisk[candidate.risk] += 1;
    for (const resultClass of candidate.result_classes) {
      byClass[resultClass] = (byClass[resultClass] ?? 0) + 1;
    }
  }
  return {
    candidate_count: candidates.length,
    by_risk: byRisk,
    by_class: byClass,
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

export function discoveryResult(projectDir: string, candidates: DiscoveryCandidate[]) {
  return {
    action: "discover",
    dry_run: true,
    read_only: true,
    project_dir: projectDir,
    summary: discoverySummary(candidates),
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
    ""
  ];
  for (const candidate of result.candidates) {
    lines.push(
      `- ${candidate.path} [${candidate.result_classes.join(", ")}] risk=${candidate.risk}`,
      `  scope=${candidate.provisional_scope} audience=${candidate.provisional_audience}`,
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
