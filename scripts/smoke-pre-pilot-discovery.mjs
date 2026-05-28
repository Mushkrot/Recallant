import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const fixtureSource = join(repoRoot, "tests", "fixtures", "pre-pilot-discovery");
const projectDir = await mkdtemp(join(tmpdir(), "recallant-prepilot-discovery-"));
await cp(fixtureSource, projectDir, { recursive: true });
await appendFile(
  join(projectDir, "AGENTS.md"),
  `\n## Session Archive\n${"2025-05-01: Historical bootstrap note that should be imported selectively.\n".repeat(420)}`
);

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  if (!result.stdout.trim()) {
    throw new Error(
      `Command produced no JSON: recallant ${args.join(" ")}\nstatus=${result.status}\nstderr=${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function runText(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

const discovery = runJson(["discover", "--dry-run", "--project-dir", projectDir]);
const serializedDiscovery = JSON.stringify(discovery);
if (
  discovery.writes_memory !== false ||
  discovery.writes_files !== false ||
  discovery.promotes_instruction_grade !== false ||
  discovery.read_only !== true
) {
  throw new Error(`Discovery was not read-only: ${serializedDiscovery}`);
}
if (
  serializedDiscovery.includes("fixture-secret-value") ||
  serializedDiscovery.includes("fixture-password")
) {
  throw new Error(`Discovery leaked secret values: ${serializedDiscovery}`);
}

const byPath = new Map(discovery.candidates.map((candidate) => [candidate.path, candidate]));
for (const path of [
  "AGENTS.md",
  "PROJECT_LOG.md",
  ".cursor/SESSION_HANDOFF.md",
  "CLAUDE.md",
  "README.md",
  ".env.example",
  "docs/RUNBOOK.md"
]) {
  if (!byPath.has(path)) throw new Error(`Missing discovery candidate: ${path}`);
}

const agents = byPath.get("AGENTS.md");
if (
  !agents.result_classes.includes("repo_contract") ||
  !agents.result_classes.includes("startup_instruction") ||
  !agents.result_classes.includes("oversized_context_risk")
) {
  throw new Error(
    `AGENTS.md was not classified as a risky startup contract: ${JSON.stringify(agents)}`
  );
}

const envExample = byPath.get(".env.example");
if (
  envExample.result_class !== "secret_reference_names_only" ||
  !envExample.result_classes.includes("capability_binding") ||
  !envExample.result_classes.includes("connector_account_binding") ||
  !envExample.risks.some((risk) => risk.code === "raw_secret_value_detected") ||
  !envExample.secret_references.some((ref) => ref.name === "OPENAI_API_KEY") ||
  envExample.secret_references.some((ref) => Object.hasOwn(ref, "value"))
) {
  throw new Error(`Secret reference discovery failed: ${JSON.stringify(envExample)}`);
}

const claude = byPath.get("CLAUDE.md");
if (
  claude.provisional_audience !== "specific_client:claude_code" ||
  !claude.result_classes.includes("possible_conflict")
) {
  throw new Error(`Client-specific discovery failed: ${JSON.stringify(claude)}`);
}

const projectLog = byPath.get("PROJECT_LOG.md");
const cursorHandoff = byPath.get(".cursor/SESSION_HANDOFF.md");
if (
  !projectLog.result_classes.includes("possible_duplicate") ||
  !projectLog.result_classes.includes("stale_history") ||
  !cursorHandoff.result_classes.includes("possible_duplicate") ||
  !cursorHandoff.result_classes.includes("handoff_checkpoint")
) {
  throw new Error(
    `Duplicate/stale handoff discovery failed: ${JSON.stringify({ projectLog, cursorHandoff })}`
  );
}

const envImport = runJson(["import", "--dry-run", ".env.example", "--project-dir", projectDir]);
if (
  envImport.writes_memory !== false ||
  envImport.result_class !== "secret_reference_names_only" ||
  envImport.source_ref?.path !== ".env.example" ||
  envImport.provisional_scope !== "environment" ||
  JSON.stringify(envImport).includes("fixture-secret-value") ||
  JSON.stringify(envImport).includes("fixture-password")
) {
  throw new Error(`Import dry-run did not mirror discovery safely: ${JSON.stringify(envImport)}`);
}

const claudeImport = runJson(["import", "--dry-run", "CLAUDE.md", "--project-dir", projectDir]);
if (claudeImport.provisional_audience !== "specific_client:claude_code") {
  throw new Error(
    `Client-specific import dry-run audience failed: ${JSON.stringify(claudeImport)}`
  );
}

const text = runText(["discover", "--format", "text", "--project-dir", projectDir]);
if (!text.includes("Recallant discovery preflight") || !text.includes("Planned changes: none")) {
  throw new Error(`Human discovery summary failed:\n${text}`);
}

try {
  await stat(join(projectDir, ".recallant"));
  throw new Error("Discovery/import dry-runs created .recallant state");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

process.stdout.write("Pre-Pilot discovery smoke passed\n");
