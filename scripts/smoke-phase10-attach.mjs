import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const hostProjectId = randomUUID();

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: hostProjectId,
      RECALLANT_PROJECT_PATH: repoRoot,
      RECALLANT_EMBEDDING_PROVIDER: "deterministic",
      RECALLANT_EMBEDDING_DIMS: "8",
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005"
    },
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
  return JSON.parse(result.stdout);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFixture(projectDir) {
  await mkdir(join(projectDir, ".cursor", "rules"), { recursive: true });
  await mkdir(join(projectDir, "docs"), { recursive: true });
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Project Rules",
      "",
      "Always keep the fixture formatter deterministic.",
      "Temporary local token example: OPENAI_API_KEY=sk-fixturetoken123456",
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
      "Status: existing project fixture.",
      "Current focus: migrate into Recallant.",
      "Next step: attach safely.",
      "",
      "## Historical Log",
      "",
      "2025-01-10: Old note.",
      "2025-02-10: Old note.",
      "2025-03-10: Old note.",
      "2025-04-10: Old note.",
      ""
    ].join("\n")
  );
  await writeFile(
    join(projectDir, "CLAUDE.md"),
    "# Claude Notes\nUse Claude-specific notes only for Claude.\n"
  );
  await writeFile(
    join(projectDir, ".cursor", "SESSION_HANDOFF.md"),
    "# Cursor Handoff\n2025-01-10: old cursor handoff.\n"
  );
  await writeFile(
    join(projectDir, ".cursor", "rules", "formatter.mdc"),
    "# Formatter Rule\nUse the deterministic fixture formatter.\n"
  );
  await writeFile(
    join(projectDir, "README.md"),
    "# Attach Fixture\nA small safe attach fixture.\n"
  );
  await writeFile(join(projectDir, "docs", "README.md"), "# Docs\nFixture docs for attach.\n");
  await writeFile(
    join(projectDir, ".env.example"),
    "OPENAI_API_KEY=fixture-secret-value\nDATABASE_URL=postgres://fixture:fixture-password@localhost:5432/app\n"
  );
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase10-attach-"));
await writeFixture(projectDir);

const manual = runJson([
  "attach",
  projectDir,
  "--target",
  "codex",
  "--mode",
  "manual",
  "--dry-run"
]);
if (
  manual.effective_mode !== "manual" ||
  manual.writes_files !== false ||
  manual.writes_database !== false ||
  (await exists(join(projectDir, ".recallant", "config")))
) {
  throw new Error(`Manual attach dry-run wrote data: ${JSON.stringify(manual)}`);
}

const guided = runJson(["attach", projectDir, "--target", "codex", "--mode", "guided"]);
if (
  guided.status !== "needs_confirmation" ||
  guided.effective_mode !== "guided" ||
  guided.writes_files !== false ||
  guided.writes_database !== false ||
  (await exists(join(projectDir, ".recallant", "config")))
) {
  throw new Error(`Guided attach did not wait: ${JSON.stringify(guided)}`);
}

const readOnlyClient = new pg.Client({ connectionString: databaseUrl });
await readOnlyClient.connect();
try {
  await readOnlyClient.query(
    "INSERT INTO developers (id, name) VALUES ($1, 'Smoke Developer') ON CONFLICT (id) DO NOTHING",
    [developerId]
  );
  await readOnlyClient.query(
    "INSERT INTO projects (id, developer_id, name, primary_path) VALUES ($1, $2, 'recallant', $3) ON CONFLICT (id) DO UPDATE SET primary_path = EXCLUDED.primary_path",
    [hostProjectId, developerId, repoRoot]
  );
  const readOnlyChecks = await readOnlyClient.query(
    "SELECT count(*)::int AS project_count FROM projects WHERE developer_id = $1",
    [developerId]
  );
  if (readOnlyChecks.rows[0]?.project_count !== 1) {
    throw new Error(`Plan-only attach wrote DB rows: ${JSON.stringify(readOnlyChecks.rows[0])}`);
  }
} finally {
  await readOnlyClient.end();
}

const attach = runJson(["attach", projectDir, "--target", "codex", "--sandbox"]);
if (
  attach.requested_mode !== "autopilot" ||
  attach.effective_mode !== "autopilot" ||
  attach.status !== "attached" ||
  attach.project_id === hostProjectId ||
  attach.writes_files !== true ||
  attach.writes_database !== true ||
  attach.imported.length < 5 ||
  attach.startup_smoke?.status !== "ok" ||
  attach.startup_smoke?.session_closed !== true ||
  attach.review_visibility?.status !== "ok" ||
  attach.review_visibility?.project_visible !== true ||
  !attach.backup?.manifest_path ||
  attach.backup?.redacted_file_count < 1 ||
  attach.secret_findings?.raw_secret_count < 1 ||
  attach.secret_findings?.masked_after_redacted_backup !== true ||
  !attach.owner_report?.ready_status
) {
  throw new Error(`Autopilot attach failed: ${JSON.stringify(attach)}`);
}

const config = JSON.parse(await readFile(join(projectDir, ".recallant", "config"), "utf8"));
const mcpConfig = JSON.parse(
  await readFile(join(projectDir, ".recallant", "codex-mcp.json"), "utf8")
);
const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
const gitignore = await readFile(join(projectDir, ".gitignore"), "utf8");
const backupAgents = await readFile(join(attach.backup.path, "AGENTS.md"), "utf8");
const backupCursorRule = await readFile(
  join(attach.backup.path, ".cursor", "rules", "formatter.mdc"),
  "utf8"
);
const backupManifest = JSON.parse(await readFile(attach.backup.manifest_path, "utf8"));

if (
  config.project_id !== attach.project_id ||
  !JSON.stringify(mcpConfig).includes("recallant") ||
  !agents.includes("Always keep the fixture formatter deterministic.") ||
  !agents.includes("memory_start_session") ||
  !agents.includes("recallant agent-start") ||
  agents.includes("memory_promote") ||
  agents.includes("sk-fixturetoken123456") ||
  !agents.includes("<redacted-token>") ||
  !projectLog.includes("Status: attached to Recallant.") ||
  !projectLog.includes("recallant agent-start") ||
  !projectLog.includes("compact fallback/checkpoint") ||
  !gitignore.includes(".recallant/") ||
  backupAgents.includes("sk-fixturetoken123456") ||
  !backupAgents.includes("<redacted-token>") ||
  !backupCursorRule.includes("deterministic fixture formatter") ||
  backupManifest.discovered_agent_files.length < 4
) {
  throw new Error(
    `Attach files failed: ${JSON.stringify({
      config,
      mcpConfig,
      agents,
      projectLog,
      gitignore,
      backupAgents,
      backupCursorRule,
      backupManifest
    })}`
  );
}

const rerun = runJson(["attach", projectDir, "--target", "codex", "--sandbox"]);
if (rerun.project_id !== attach.project_id || rerun.project_id_source !== "existing_config") {
  throw new Error(`Attach rerun did not reuse project id: ${JSON.stringify(rerun)}`);
}

const staleConfigDir = await mkdtemp(join(tmpdir(), "recallant-phase10-stale-config-"));
await mkdir(join(staleConfigDir, ".recallant"), { recursive: true });
await writeFile(
  join(staleConfigDir, ".recallant", "config"),
  `${JSON.stringify({ project_id: hostProjectId, recallant_server_url: "http://127.0.0.1:3005" }, null, 2)}\n`
);
const staleAttach = runJson(["attach", staleConfigDir, "--target", "codex", "--sandbox"]);
if (
  staleAttach.project_id === hostProjectId ||
  staleAttach.project_id_source !== "database" ||
  staleAttach.starter_memory?.status !== "accepted" ||
  !String(staleAttach.existing_config_error ?? "").includes("Ignoring stale/foreign config")
) {
  throw new Error(`Attach reused stale foreign config: ${JSON.stringify(staleAttach)}`);
}

const prodDir = await mkdtemp(join(tmpdir(), "recallant-phase10-prod-"));
await writeFile(join(prodDir, "README.md"), "# Live Project\nProduction deploy uses Cloudflare.\n");
await writeFile(
  join(prodDir, "AGENTS.md"),
  "# Live Agent Instructions\nProduction token example: OPENAI_API_KEY=sk-livefixture123456\n"
);
const prodPlan = runJson(["attach", prodDir, "--target", "codex", "--mode", "autopilot"]);
const prodAgentsAfter = await readFile(join(prodDir, "AGENTS.md"), "utf8");
if (
  prodPlan.effective_mode !== "guided" ||
  prodPlan.status !== "needs_confirmation" ||
  prodPlan.writes_files !== false ||
  (await exists(join(prodDir, ".recallant", "config"))) ||
  prodPlan.production_sensitive?.production_sensitive !== true ||
  prodPlan.secret_findings?.raw_secret_count < 1 ||
  prodPlan.secret_findings?.findings?.some((finding) => finding.source_modified !== false) ||
  !prodPlan.secret_findings?.live_policy?.includes("never edits source files") ||
  !prodAgentsAfter.includes("sk-livefixture123456")
) {
  throw new Error(`Production-sensitive downgrade failed: ${JSON.stringify(prodPlan)}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM projects WHERE id = $1) AS project_count,
        (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
        (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND client_kind = 'recallant-attach' AND status = 'active') AS active_attach_sessions,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND created_by = 'system' AND metadata->>'attach_bootstrap' = 'true') AS starter_memories,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND use_policy = 'instruction_grade') AS instruction_grade,
        (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1 AND excerpt LIKE '%fixture-secret-value%') AS leaked_raw_artifacts,
        (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND text LIKE '%fixture-secret-value%') AS leaked_chunks
    `,
    [attach.project_id]
  );
  const row = checks.rows[0];
  if (
    row.project_count !== 1 ||
    row.import_events < 5 ||
    row.active_attach_sessions !== 0 ||
    row.starter_memories !== 1 ||
    row.instruction_grade !== 0 ||
    row.leaked_raw_artifacts !== 0 ||
    row.leaked_chunks !== 0
  ) {
    throw new Error(`Attach DB checks failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

process.stdout.write("Phase 10 attach smoke passed\n");
