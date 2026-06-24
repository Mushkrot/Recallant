import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const hostProjectId = randomUUID();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cliEnv() {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: hostProjectId,
    RECALLANT_PROJECT_PATH: repoRoot,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005"
  };
}

function runJson(args, options = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: options.cwd ?? repoRoot,
    env: cliEnv(),
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
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command did not return JSON: ${error}\n${result.stdout}`);
  }
}

function runJsonNoDb(args, options = {}) {
  const env = cliEnv();
  delete env.RECALLANT_DATABASE_URL;
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: options.cwd ?? repoRoot,
    env,
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
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command did not return JSON: ${error}\n${result.stdout}`);
  }
}

function runText(args, options = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: options.cwd ?? repoRoot,
    env: cliEnv(),
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

async function writeExistingProjectFixture(projectDir) {
  await mkdir(join(projectDir, ".cursor", "rules"), { recursive: true });
  await mkdir(join(projectDir, "docs"), { recursive: true });
  await writeFile(
    join(projectDir, "README.md"),
    [
      "# Neutral Existing Project",
      "",
      "This fixture represents a project that was not designed around Recallant.",
      "It has stale agent notes, a runbook, and env examples that should become reviewed evidence.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Legacy Rules",
      "",
      "Keep release notes deterministic.",
      "Never deploy fixture builds without review.",
      "Temporary local token example: OPENAI_API_KEY=sk-nonownerfixture123456",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "PROJECT_LOG.md"),
    [
      "# Project Log",
      "",
      "## Current Session",
      "",
      "Status: legacy agent workflow before Recallant.",
      "Current focus: preserve useful handoff context.",
      "Next step: migrate agent context safely.",
      "",
      "## Archive",
      "",
      "2025-01-05: The old agent wrote a release note.",
      "2025-02-12: The old agent copied setup notes into the log.",
      "2025-03-20: The old agent duplicated the handoff in another client.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, ".cursor", "SESSION_HANDOFF.md"),
    [
      "# Cursor Session Handoff",
      "",
      "The next agent should check the runbook before changing release steps.",
      "This handoff is stale but still useful as source-linked evidence.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, ".cursor", "rules", "release.mdc"),
    ["# Release Rule", "", "Release notes must mention the migration checklist.", ""].join("\n")
  );
  await writeFile(
    join(projectDir, "CLAUDE.md"),
    [
      "# Claude-Specific Notes",
      "",
      "Prefer a concise status summary when Claude Code works on this repository.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "docs", "RUNBOOK.md"),
    [
      "# Release Runbook",
      "",
      "1. Run tests.",
      "2. Review generated notes.",
      "3. Publish only after approval.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, ".env.example"),
    [
      "OPENAI_API_KEY=fixture-secret-value",
      "GITHUB_TOKEN=ghp_fixtureSecretValue1234567890",
      "DATABASE_URL=postgres://fixture:fixture-password@localhost:5432/app",
      ""
    ].join("\n")
  );
}

async function snapshotTree(root) {
  const files = {};
  async function walk(relativeDir = "") {
    const entries = await readdir(join(root, relativeDir), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = join(relativeDir, entry.name);
      const fullPath = join(root, relativePath);
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else {
        const content = await readFile(fullPath);
        files[relativePath] = createHash("sha256").update(content).digest("hex");
      }
    }
  }
  await walk();
  return files;
}

function assertNoRawSecrets(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const marker of [
    "sk-nonownerfixture123456",
    "fixture-secret-value",
    "fixture-password",
    "ghp_fixtureSecretValue1234567890"
  ]) {
    assert(!text.includes(marker), `${label} leaked raw secret marker ${marker}`);
  }
}

const migrationRiskClassNames = new Set([
  "large_archive_log",
  "raw_artifact",
  "backup",
  "credential_bearing_file",
  "customer_data",
  "private_key",
  "environment_config_risk"
]);

function migrationEntryRiskClasses(entry) {
  if (Array.isArray(entry?.classes) && entry.classes.length > 0) {
    return entry.classes.map(String).filter((item) => migrationRiskClassNames.has(item));
  }
  const legacyClass = String(
    entry?.risk_class ??
      entry?.path_class ??
      entry?.source_class ??
      entry?.classification ??
      entry?.class ??
      ""
  );
  return migrationRiskClassNames.has(legacyClass) ? [legacyClass] : [];
}

const originalDir = await mkdtemp(join(tmpdir(), "recallant-non-owner-original-"));
const sandboxDir = await mkdtemp(join(tmpdir(), "recallant-non-owner-sandbox-"));
await writeExistingProjectFixture(originalDir);
const originalBefore = await snapshotTree(originalDir);
await cp(originalDir, sandboxDir, { recursive: true });

const plan = runJson([
  "attach",
  sandboxDir,
  "--target",
  "codex",
  "--mode",
  "guided",
  "--format",
  "json"
]);
assert(
  plan.status === "needs_confirmation",
  `guided attach should require confirmation: ${JSON.stringify(plan)}`
);
assert(
  plan.writes_files === false,
  `guided attach should not write files: ${JSON.stringify(plan)}`
);
assert(
  plan.writes_database === false,
  `guided attach should not write DB: ${JSON.stringify(plan)}`
);
assert(
  plan.owner_report?.migration_summary?.selected_imports >= 6,
  `guided attach should expose planned migration summary: ${JSON.stringify(plan.owner_report)}`
);
assertNoRawSecrets(plan, "guided attach plan");
const planText = runText(["attach", sandboxDir, "--target", "codex", "--mode", "guided"]);
assert(
  planText.includes("Status: Plan ready; waiting for confirmation.") &&
    planText.includes("Migration summary:") &&
    planText.includes("Next command:"),
  `guided attach text should be an owner approval transcript:\n${planText}`
);

const discoveryNoDb = runJsonNoDb(["discover", "--dry-run", "--project-dir", sandboxDir]);
assert(
  discoveryNoDb.read_only === true &&
    discoveryNoDb.migration_plan?.owner_approval_required === true &&
    discoveryNoDb.migration_plan?.remote_mcp_tool_sequence?.includes("memory_create_agent_memory"),
  `remote-only discovery plan missing MCP migration guidance: ${JSON.stringify(discoveryNoDb)}`
);
const approvedRemoteEntry = discoveryNoDb.migration_plan.entries.find(
  (entry) => entry.action === "summarize_to_memory" && entry.memory_candidate
);
assert(approvedRemoteEntry, "remote-only plan did not expose a concise memory candidate");
const remoteMcpCreate = {
  name: "memory_create_agent_memory",
  arguments: {
    ...approvedRemoteEntry.memory_candidate,
    scope: "project",
    audience: [{ kind: "all_agents", id: null }],
    created_by: "agent",
    metadata: {
      migration_batch: "synthetic_non_owner_remote",
      review_status: approvedRemoteEntry.memory_candidate.review_status
    }
  }
};
assert(
  remoteMcpCreate.arguments.body.length < 700 &&
    remoteMcpCreate.arguments.source_refs?.[0]?.source_kind === "external" &&
    remoteMcpCreate.arguments.metadata.review_status === "needs_owner_approval",
  `remote MCP create shape was not bounded/source-linked: ${JSON.stringify(remoteMcpCreate)}`
);
const syntheticRemoteStore = [];
const createdRemoteMemory = {
  memory_id: randomUUID(),
  status: "accepted",
  use_policy: "recall_allowed",
  ...remoteMcpCreate.arguments
};
syntheticRemoteStore.push(createdRemoteMemory);
const remoteRecall = syntheticRemoteStore.filter((memory) =>
  String(memory.body).includes(approvedRemoteEntry.path)
);
assert(remoteRecall.length === 1, "synthetic remote MCP recall did not find approved marker");
const remoteCheckpoint = {
  name: "memory_set_checkpoint",
  arguments: {
    payload: {
      current_status: "approved migration marker recalled",
      current_focus: approvedRemoteEntry.path,
      next_step: "continue reviewed migration",
      open_questions: []
    }
  }
};
assertNoRawSecrets(remoteMcpCreate, "remote MCP memory create shape");
assertNoRawSecrets(remoteCheckpoint, "remote MCP checkpoint shape");

const attach = runJson([
  "attach",
  sandboxDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
const attachText = runText(["attach", sandboxDir, "--target", "codex", "--sandbox"]);
assert(
  attachText.includes("Migration summary:"),
  `attach text missing migration summary:\n${attachText}`
);
assert(
  attachText.includes("Needs attention:"),
  `attach text missing needs-attention line:\n${attachText}`
);
assertNoRawSecrets(attach, "attach JSON");
assertNoRawSecrets(attachText, "attach text");

const summary = attach.owner_report?.migration_summary ?? {};
if (
  attach.status !== "attached" ||
  attach.effective_mode !== "autopilot" ||
  attach.writes_files !== true ||
  attach.writes_database !== true ||
  attach.project_id === hostProjectId ||
  attach.imported?.length < 6 ||
  attach.backup?.manifest_path == null ||
  attach.secret_findings?.raw_secret_count < 2 ||
  attach.secret_findings?.masked_after_redacted_backup !== true ||
  summary.discovered_agent_files < 4 ||
  summary.selected_imports < 6 ||
  summary.imported_sources < 6 ||
  summary.review_needed < 3 ||
  summary.raw_secret_findings < 2 ||
  summary.local_backup_created !== true ||
  attach.startup_smoke?.status !== "ok" ||
  attach.review_visibility?.status !== "ok"
) {
  throw new Error(`Non-owner migration attach failed: ${JSON.stringify(attach)}`);
}

const originalAfter = await snapshotTree(originalDir);
assert(
  JSON.stringify(originalAfter) === JSON.stringify(originalBefore),
  "Non-owner migration smoke changed the original project instead of only the sandbox copy"
);

const agents = await readFile(join(sandboxDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(sandboxDir, "PROJECT_LOG.md"), "utf8");
const backupAgents = await readFile(join(attach.backup.path, "AGENTS.md"), "utf8");
const backupManifest = JSON.parse(await readFile(attach.backup.manifest_path, "utf8"));
const config = JSON.parse(await readFile(join(sandboxDir, ".recallant", "config"), "utf8"));
const mcpConfig = await readFile(join(sandboxDir, ".codex", "config.toml"), "utf8");
await stat(join(sandboxDir, ".recallant", "backups"));

assert(config.project_id === attach.project_id, "Attach config does not point at created project");
assert(
  mcpConfig.includes("[mcp_servers.recallant]"),
  "Codex MCP config does not reference Recallant"
);
assert(agents.includes("recallant agent-start"), "AGENTS.md does not route agents to Recallant");
assert(agents.includes("<redacted-token>"), "AGENTS.md did not mask the raw legacy token");
assert(!agents.includes("sk-nonownerfixture123456"), "AGENTS.md still contains raw legacy token");
assert(projectLog.includes("Status: attached to Recallant."), "PROJECT_LOG.md was not compacted");
assert(backupAgents.includes("<redacted-token>"), "Backup AGENTS.md was not redacted");
assert(!backupAgents.includes("sk-nonownerfixture123456"), "Backup AGENTS.md leaked raw token");
assert(
  backupManifest.discovered_agent_files.length >= 4,
  `Backup manifest did not record discovered agent files: ${JSON.stringify(backupManifest)}`
);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let dbSummary = null;
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM projects WHERE id = $1) AS project_count,
        (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND created_by = 'system' AND metadata->>'attach_bootstrap' = 'true') AS starter_memories,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND use_policy = 'instruction_grade') AS instruction_grade,
        (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND (text LIKE '%fixture-secret-value%' OR text LIKE '%fixture-password%' OR text LIKE '%sk-nonownerfixture123456%')) AS leaked_chunks,
        (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1 AND (excerpt LIKE '%fixture-secret-value%' OR excerpt LIKE '%fixture-password%' OR excerpt LIKE '%sk-nonownerfixture123456%')) AS leaked_raw_artifacts
    `,
    [attach.project_id]
  );
  const row = checks.rows[0];
  dbSummary = {
    project_count: row.project_count,
    import_events: row.import_events,
    starter_memories: row.starter_memories,
    instruction_grade: row.instruction_grade,
    leaked_chunks: row.leaked_chunks,
    leaked_raw_artifacts: row.leaked_raw_artifacts
  };
  if (
    row.project_count !== 1 ||
    row.import_events < 6 ||
    row.starter_memories !== 1 ||
    row.instruction_grade !== 0 ||
    row.leaked_chunks !== 0 ||
    row.leaked_raw_artifacts !== 0
  ) {
    throw new Error(`Non-owner migration DB checks failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

const migrationEntries = discoveryNoDb.migration_plan?.entries ?? [];
const skippedRiskClasses = [
  ...new Set(
    migrationEntries
      .filter((entry) => ["skip", "ask_owner"].includes(String(entry.action ?? "")))
      .flatMap(migrationEntryRiskClasses)
      .sort()
  )
];

process.stdout.write(
  `${JSON.stringify(
    {
      guided_migration_pilot_summary: {
        status: "pass",
        original_project_unchanged: true,
        owner_approval_required: true,
        read_only_inventory_before_write: true,
        selected_imports: summary.selected_imports,
        imported_sources: summary.imported_sources,
        review_needed: summary.review_needed,
        raw_secret_findings: summary.raw_secret_findings,
        local_backup_created: summary.local_backup_created,
        skipped_risk_classes: skippedRiskClasses,
        remote_only_plan: {
          memory_create_agent_memory_planned: true,
          recall_verification_planned: true,
          checkpoint_after_recall: true
        },
        database_checks: dbSummary,
        leaked_secret_values: false
      }
    },
    null,
    2
  )}\n`
);
