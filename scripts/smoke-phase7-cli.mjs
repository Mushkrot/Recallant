import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const repoRoot = process.cwd();

const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-"));
await writeFile(join(projectDir, ".env.example"), "OPENAI_API_KEY=\nPUBLIC_FLAG=true\n");
await writeFile(join(projectDir, "CLAUDE.md"), "# Claude project notes\n");

function runRaw(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
      ...extraEnv
    },
    encoding: "utf8"
  });
}

function run(args, extraEnv = {}) {
  const result = runRaw(args, extraEnv);
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return JSON.parse(result.stdout);
}

function runExpectedFailure(args) {
  const result = runRaw(args);
  if (result.status === 0) {
    throw new Error(`Command unexpectedly passed: recallant ${args.join(" ")}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function withClient(callback) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

function hasFailure(result, code) {
  return result.failures?.some((failure) => failure.code === code);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertMissing(path, message) {
  try {
    await stat(path);
    throw new Error(message);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const dryRun = run(["init", "--target", "codex", "--dry-run", "--project-dir", projectDir]);
await assertMissing(join(projectDir, ".recallant", "config"), "Dry run created .recallant/config");
await assertMissing(join(projectDir, "AGENTS.md"), "Dry run created AGENTS.md");
await assertMissing(join(projectDir, "PROJECT_LOG.md"), "Dry run created PROJECT_LOG.md");
if (dryRun.capture_profile !== "standard" || dryRun.import_candidates.length < 2) {
  throw new Error(`Unexpected init dry-run plan: ${JSON.stringify(dryRun)}`);
}

const defaultProjectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-default-"));
const defaultInit = run(["init", "--target", "codex", "--project-dir", defaultProjectDir]);
assert(
  defaultInit.capture_profile === "standard" && isUuid(defaultInit.project_id),
  `Default init did not report standard profile/valid id: ${JSON.stringify(defaultInit)}`
);

const init = run([
  "init",
  "--target",
  "codex",
  "--capture-profile",
  "detailed",
  "--project-dir",
  projectDir
]);
const config = JSON.parse(await readFile(join(projectDir, ".recallant", "config"), "utf8"));
const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
if (
  config.project_id !== init.project_id ||
  !isUuid(config.project_id) ||
  Object.keys(config).sort().join(",") !== "project_id,recallant_server_url" ||
  config.recallant_server_url !== "http://127.0.0.1:3005" ||
  !agents.includes("## Memory (Recallant)") ||
  !agents.includes("memory_start_session") ||
  !agents.includes("memory_get_context_pack") ||
  !agents.includes("memory_create_agent_memory") ||
  agents.includes("memory_promote") ||
  !projectLog.includes("Current focus: project onboarding") ||
  init.capture_profile !== "detailed" ||
  !JSON.stringify(init.mcp_config).includes("recallant")
) {
  throw new Error(
    `Init output/files failed: ${JSON.stringify({ init, config, agents, projectLog })}`
  );
}

const discover = run(["discover", "--dry-run", "--project-dir", projectDir]);
if (
  discover.writes_memory !== false ||
  discover.promotes_instruction_grade !== false ||
  discover.candidates.length < 3
) {
  throw new Error(`Discover dry run failed: ${JSON.stringify(discover)}`);
}

const envImport = run(["import", "--dry-run", ".env.example", "--project-dir", projectDir]);
if (
  envImport.writes_memory !== false ||
  envImport.result_class !== "secret_reference_names_only" ||
  envImport.source_refs?.length !== 1 ||
  !Array.isArray(envImport.risks) ||
  envImport.secret_references?.length < 1 ||
  envImport.planned_changes?.[0]?.writes_database !== false ||
  !envImport.warning.includes("Preview only")
) {
  throw new Error(`Import dry run failed: ${JSON.stringify(envImport)}`);
}

const claudeImport = run(["import", "--dry-run", "CLAUDE.md", "--project-dir", projectDir]);
if (claudeImport.provisional_audience !== "specific_client:claude_code") {
  throw new Error(`Client-specific import audience failed: ${JSON.stringify(claudeImport)}`);
}

const lint = run(["lint-context", "--project-dir", projectDir]);
if (lint.ok !== true) {
  throw new Error(`lint-context failed on fresh bootstrap: ${JSON.stringify(lint)}`);
}
await withClient(async (client) => {
  await client.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'context_budget_profile', $2, 'phase7 smoke expanded context policy', 'smoke')
      ON CONFLICT (project_id, key) DO UPDATE
      SET value = EXCLUDED.value, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
    `,
    [init.project_id, JSON.stringify("expanded")]
  );
});
const expandedAgents = `${agents}\n${"Large routing note for an intentionally expanded project.\n".repeat(700)}`;
await writeFile(join(projectDir, "AGENTS.md"), expandedAgents);
const expandedLint = run(["lint-context", "--project-dir", projectDir]);
assert(
  expandedLint.ok === true &&
    expandedLint.policy?.profile === "expanded" &&
    expandedLint.policy?.source === "project_settings",
  `lint-context did not apply project context policy: ${JSON.stringify(expandedLint)}`
);
await writeFile(join(projectDir, "AGENTS.md"), agents);

const largeProjectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-large-lint-"));
await writeFile(
  join(largeProjectDir, "AGENTS.md"),
  `# Agent Instructions\n\n${"Large but ordinary bootstrap routing note.\n".repeat(800)}`
);
const largeDefaultLint = runExpectedFailure(["lint-context", "--project-dir", largeProjectDir]);
assert(
  hasFailure(largeDefaultLint, "context_budget_exceeded"),
  `Default lint policy did not fail oversized bootstrap: ${JSON.stringify(largeDefaultLint)}`
);
const largeOverrideLint = run([
  "lint-context",
  "--project-dir",
  largeProjectDir,
  "--context-profile",
  "expanded",
  "--override-reason",
  "Large ops-heavy project fixture"
]);
assert(
  largeOverrideLint.ok === true && largeOverrideLint.policy?.override_reason,
  `Explicit large-project override was not accepted: ${JSON.stringify(largeOverrideLint)}`
);
const historyProjectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-history-lint-"));
await writeFile(
  join(historyProjectDir, "AGENTS.md"),
  `# Agent Instructions\n\n${Array.from(
    { length: 12 },
    (_, index) =>
      `## Session ${index}\nStatus: old work\nCurrent focus: archive\nNext step: keep reading logs\nLast updated: 2026-05-${String(
        index + 1
      ).padStart(2, "0")}T00:00:00Z\n`
  ).join("\n")}`
);
const historyLint = runExpectedFailure([
  "lint-context",
  "--project-dir",
  historyProjectDir,
  "--context-profile",
  "expanded",
  "--override-reason",
  "Large project still cannot duplicate history"
]);
assert(
  hasFailure(historyLint, "history_dump"),
  `History dump lint failure missing: ${JSON.stringify(historyLint)}`
);
const secretProjectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-secret-lint-"));
await writeFile(join(secretProjectDir, "AGENTS.md"), "OPENAI_API_KEY=sk-fixture-secret\n");
const secretLint = runExpectedFailure([
  "lint-context",
  "--project-dir",
  secretProjectDir,
  "--context-profile",
  "expanded",
  "--override-reason",
  "Secret check fixture"
]);
assert(
  hasFailure(secretLint, "secret_value"),
  `Secret lint failure missing: ${JSON.stringify(secretLint)}`
);

const context = run(["context", "--project-dir", projectDir, "--task-hint", "project onboarding"]);
if (context.sections?.checkpoint === undefined || context.sections?.binding_rules === undefined) {
  throw new Error(`context preview failed: ${JSON.stringify(context)}`);
}

const doctor = run(["doctor", "--project-dir", projectDir]);
if (
  doctor.postgres?.reachable !== true ||
  doctor.project_config?.present !== true ||
  doctor.local_model?.starts_service !== false ||
  doctor.local_model?.provider !== "ollama" ||
  doctor.model_routes?.paid_api_provider?.requires_approval !== true ||
  doctor.model_routes?.subscription_worker?.enabled !== false ||
  doctor.paid_api_mode !== "confirm_each" ||
  doctor.policy?.hidden_api_routes_allowed !== false
) {
  throw new Error(`doctor failed: ${JSON.stringify(doctor)}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM projects WHERE id = $1) AS project_count,
        (SELECT value FROM project_settings WHERE project_id = $1 AND key = 'capture_profile') AS capture_profile,
        (SELECT count(*)::int FROM projects WHERE id = $2) AS default_project_count,
        (SELECT value FROM project_settings WHERE project_id = $2 AND key = 'capture_profile') AS default_capture_profile,
        (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1) AS agent_memories
    `,
    [init.project_id, defaultInit.project_id]
  );
  const row = checks.rows[0];
  if (
    row.project_count !== 1 ||
    row.capture_profile !== "detailed" ||
    row.default_project_count !== 1 ||
    row.default_capture_profile !== "standard" ||
    row.import_events !== 0 ||
    row.agent_memories !== 0
  ) {
    throw new Error(`Phase 7 DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

process.stdout.write("Phase 7 CLI smoke passed\n");
