import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase7-"));
await writeFile(join(projectDir, ".env.example"), "OPENAI_API_KEY=\nPUBLIC_FLAG=true\n");
await writeFile(join(projectDir, "CLAUDE.md"), "# Claude project notes\n");

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: "/work",
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
      ...extraEnv
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

const dryRun = run(["init", "--target", "codex", "--dry-run", "--project-dir", projectDir]);
try {
  await stat(join(projectDir, ".recallant", "config"));
  throw new Error("Dry run created .recallant/config");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (dryRun.capture_profile !== "standard" || dryRun.import_candidates.length < 2) {
  throw new Error(`Unexpected init dry-run plan: ${JSON.stringify(dryRun)}`);
}

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
  throw new Error(`Init output/files failed: ${JSON.stringify({ init, config, agents, projectLog })}`);
}

const discover = run(["discover", "--dry-run", "--project-dir", projectDir]);
if (discover.writes_memory !== false || discover.candidates.length < 3) {
  throw new Error(`Discover dry run failed: ${JSON.stringify(discover)}`);
}

const envImport = run(["import", "--dry-run", ".env.example", "--project-dir", projectDir]);
if (
  envImport.writes_memory !== false ||
  envImport.result_class !== "secret_reference_names_only" ||
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
        (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events
    `,
    [init.project_id]
  );
  const row = checks.rows[0];
  if (row.project_count !== 1 || row.capture_profile !== "detailed" || row.import_events !== 0) {
    throw new Error(`Phase 7 DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

process.stdout.write("Phase 7 CLI smoke passed\n");
