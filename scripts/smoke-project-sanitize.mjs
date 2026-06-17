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

function commandEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005"
  };
}

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commandEnv(),
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

async function writeFixture(projectDir, marker) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "AGENTS.md"),
    [
      "# Agent Instructions",
      "",
      "## Project Rules",
      "",
      `Keep ${marker} fixture source files untouched.`,
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
      `Status: existing ${marker} project fixture.`,
      ""
    ].join("\n")
  );
  await writeFile(join(projectDir, "README.md"), `# ${marker}\nSafe fixture for sanitize.\n`);
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function projectExists(projectId) {
  return withClient(async (client) => {
    const result = await client.query("SELECT count(*)::int AS count FROM projects WHERE id = $1", [
      projectId
    ]);
    return result.rows[0]?.count === 1;
  });
}

async function deleteProject(projectId) {
  await withClient(async (client) => {
    await client.query("DELETE FROM projects WHERE id = $1", [projectId]);
  });
}

async function countProjectRows(projectId) {
  return withClient(async (client) => {
    const result = await client.query(
      `
        SELECT
          (SELECT count(*)::int FROM projects WHERE id = $1) AS projects,
          (SELECT count(*)::int FROM events WHERE project_id = $1) AS events,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1) AS chunks,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1) AS agent_memories,
          (SELECT count(*)::int FROM recall_traces WHERE project_id = $1) AS recall_traces,
          (SELECT count(*)::int FROM model_calls WHERE project_id = $1) AS model_calls,
          (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1) AS paid_api_approvals,
          (SELECT count(*)::int FROM settings_audit_events WHERE scope_kind = 'project' AND scope_id = $1::text) AS settings_audit_events
      `,
      [projectId]
    );
    return result.rows[0];
  });
}

async function addGovernanceRows(projectId) {
  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO settings_audit_events (
          scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
        )
        VALUES ('project', $1, 'sanitize_smoke', '{}'::jsonb, '{"enabled":true}'::jsonb, 'system', 'smoke', 'project sanitize smoke')
      `,
      [projectId]
    );
    await client.query(
      `
        INSERT INTO recall_traces (
          developer_id, project_id, tool_name, query, returned_chunk_ids, returned_memory_ids, metadata
        )
        VALUES ($1, $2, 'sanitize_smoke', 'fixture query', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)
      `,
      [developerId, projectId]
    );
    await client.query(
      `
        INSERT INTO model_calls (
          developer_id, project_id, memory_domain, route_class, provider, model, purpose,
          routing_reason, confirmation_status, status, metadata
        )
        VALUES ($1, $2, 'agent_work', 'local_model', 'deterministic', 'smoke', 'sanitize smoke',
                'project sanitize smoke', 'not_required', 'success', '{}'::jsonb)
      `,
      [developerId, projectId]
    );
    await client.query(
      `
        INSERT INTO paid_api_approval_requests (
          developer_id, project_id, purpose, provider, model, routing_reason, status, requested_by
        )
        VALUES ($1, $2, 'sanitize smoke', 'example', 'example-model', 'project sanitize smoke',
                'pending', 'system')
      `,
      [developerId, projectId]
    );
  });
}

async function retainedReceiptCount(erasureId) {
  return withClient(async (client) => {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM erasure_requests WHERE id = $1 AND project_id IS NULL AND redacted_receipt->>'content_removed' = 'true'",
      [erasureId]
    );
    return result.rows[0]?.count ?? 0;
  });
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-project-sanitize-"));
const detachDir = await mkdtemp(join(tmpdir(), "recallant-project-sanitize-detach-"));
const staleConfigDir = await mkdtemp(join(tmpdir(), "recallant-project-sanitize-stale-"));
const orphanLocalDir = await mkdtemp(join(tmpdir(), "recallant-project-sanitize-orphan-"));
await writeFixture(projectDir, "sanitizemarker");
await writeFixture(detachDir, "detachmarker");
await writeFixture(staleConfigDir, "stalemarker");
await writeFixture(orphanLocalDir, "orphanmarker");

const attach = runJson(["attach", projectDir, "--target", "codex", "--sandbox", "--format", "json"]);
const detachAttach = runJson([
  "attach",
  detachDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
await addGovernanceRows(attach.project_id);

const dryRun = runJson([
  "project-sanitize",
  "--project-dir",
  projectDir,
  "--mode",
  "purge",
  "--dry-run",
  "--format",
  "json"
]);
const token = dryRun.database?.confirmation?.token;
const dryRunCounts = dryRun.database?.affected ?? {};
if (
  dryRun.database?.status !== "pending_confirmation" ||
  dryRun.database?.writes_database !== false ||
  !token ||
  dryRunCounts.events < 1 ||
  dryRunCounts.agent_memory_source_refs < 1 ||
  dryRunCounts.settings_audit_events < 1 ||
  dryRunCounts.recall_traces < 1 ||
  dryRunCounts.model_calls < 1 ||
  dryRunCounts.paid_api_approvals < 1 ||
  dryRun.local_cleanup?.writes_files !== false ||
  !dryRun.local_cleanup?.planned_changes?.some((change) => change.path === "AGENTS.md") ||
  !dryRun.local_cleanup?.planned_changes?.some((change) => change.path === "PROJECT_LOG.md")
) {
  throw new Error(`Project sanitize dry-run failed: ${JSON.stringify(dryRun, null, 2)}`);
}
if (!(await projectExists(attach.project_id)) || !(await exists(join(projectDir, ".recallant", "config")))) {
  throw new Error("Project sanitize dry-run changed database or local files.");
}

const wrongToken = runJson([
  "project-sanitize",
  "--project-dir",
  projectDir,
  "--mode",
  "purge",
  "--confirm-token",
  "wrong-token",
  "--format",
  "json"
]);
if (wrongToken.database?.status !== "pending_confirmation" || !(await projectExists(attach.project_id))) {
  throw new Error(`Wrong-token purge should remain a dry-run: ${JSON.stringify(wrongToken)}`);
}

const confirmed = runJson([
  "project-sanitize",
  "--project-dir",
  projectDir,
  "--mode",
  "purge",
  "--confirm-token",
  token,
  "--format",
  "json"
]);
const remainingRows = await countProjectRows(attach.project_id);
const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
if (
  confirmed.database?.status !== "purged" ||
  confirmed.database?.changes?.physically_deleted_records < 1 ||
  confirmed.local_cleanup?.status !== "cleaned" ||
  remainingRows.projects !== 0 ||
  remainingRows.events !== 0 ||
  remainingRows.chunks !== 0 ||
  remainingRows.agent_memories !== 0 ||
  remainingRows.recall_traces !== 0 ||
  remainingRows.model_calls !== 0 ||
  remainingRows.paid_api_approvals !== 0 ||
  remainingRows.settings_audit_events !== 0 ||
  (await exists(join(projectDir, ".recallant", "config"))) ||
  agents.includes("Memory (Recallant)") ||
  !agents.includes("Keep sanitizemarker fixture source files untouched") ||
  !projectLog.includes("Status: existing sanitizemarker project fixture") ||
  !(await exists(join(projectDir, "README.md"))) ||
  (await retainedReceiptCount(confirmed.database.erasure_id)) !== 1
) {
  throw new Error(
    `Confirmed project sanitize failed: ${JSON.stringify({ confirmed, remainingRows }, null, 2)}`
  );
}

const staleAttach = runJson([
  "attach",
  staleConfigDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
await deleteProject(staleAttach.project_id);
const liveAttach = runJson([
  "attach",
  staleConfigDir,
  "--target",
  "codex",
  "--sandbox",
  "--format",
  "json"
]);
await writeFile(
  join(staleConfigDir, ".recallant", "config"),
  JSON.stringify(
    {
      project_id: staleAttach.project_id,
      recallant_server_url: "http://127.0.0.1:3005"
    },
    null,
    2
  )
);
await writeFile(
  join(staleConfigDir, ".recallant", "current-session.json"),
  `${JSON.stringify({ session_id: "stale-local-session" }, null, 2)}\n`
);
const explicitStaleDryRun = runJson([
  "project-sanitize",
  "--project-id",
  staleAttach.project_id,
  "--project-dir",
  staleConfigDir,
  "--mode",
  "purge",
  "--dry-run",
  "--format",
  "json"
]);
if (
  explicitStaleDryRun.database?.status !== "not_found" ||
  explicitStaleDryRun.database?.project !== null ||
  explicitStaleDryRun.database?.target_resolution?.resolved_by !== "not_found" ||
  explicitStaleDryRun.database?.target_resolution?.requested_project_path !== null
) {
  throw new Error(
    `Explicit --project-id should remain strict for stale ids: ${JSON.stringify(explicitStaleDryRun, null, 2)}`
  );
}
const staleDryRun = runJson([
  "project-sanitize",
  "--project-dir",
  staleConfigDir,
  "--mode",
  "purge",
  "--dry-run",
  "--format",
  "json"
]);
const staleToken = staleDryRun.database?.confirmation?.token;
if (
  staleDryRun.database?.status !== "pending_confirmation" ||
  staleDryRun.database?.project?.project_id !== liveAttach.project_id ||
  staleDryRun.database?.target_resolution?.stale_project_id !== staleAttach.project_id ||
  staleDryRun.database?.target_resolution?.resolved_by !== "project_path_fallback" ||
  !staleDryRun.database?.warnings?.some((warning) => /missing project_id/.test(warning)) ||
  staleToken !== `recallant-purge-project-${liveAttach.project_id}`
) {
  throw new Error(
    `Stale config project sanitize dry-run did not resolve by path: ${JSON.stringify(staleDryRun, null, 2)}`
  );
}
const staleWrongToken = runJson([
  "project-sanitize",
  "--project-dir",
  staleConfigDir,
  "--mode",
  "purge",
  "--confirm-token",
  "wrong-token",
  "--format",
  "json"
]);
if (
  staleWrongToken.database?.status !== "pending_confirmation" ||
  !(await projectExists(liveAttach.project_id))
) {
  throw new Error(
    `Wrong-token stale config purge should keep resolved project: ${JSON.stringify(staleWrongToken)}`
  );
}
const staleConfirmed = runJson([
  "project-sanitize",
  "--project-dir",
  staleConfigDir,
  "--mode",
  "purge",
  "--confirm-token",
  staleToken,
  "--format",
  "json"
]);
if (
  staleConfirmed.database?.status !== "purged" ||
  staleConfirmed.database?.project?.project_id !== liveAttach.project_id ||
  (await projectExists(liveAttach.project_id)) ||
  (await exists(join(staleConfigDir, ".recallant", "config"))) ||
  (await exists(join(staleConfigDir, ".recallant", "current-session.json"))) ||
  !(await exists(join(staleConfigDir, "README.md"))) ||
  !(await readFile(join(staleConfigDir, "AGENTS.md"), "utf8")).includes(
    "Keep stalemarker fixture source files untouched"
  )
) {
  throw new Error(
    `Confirmed stale config purge failed: ${JSON.stringify(staleConfirmed, null, 2)}`
  );
}

await mkdir(join(orphanLocalDir, ".recallant"), { recursive: true });
await writeFile(
  join(orphanLocalDir, ".recallant", "config"),
  `${JSON.stringify({ project_id: randomUUID() }, null, 2)}\n`
);
await writeFile(
  join(orphanLocalDir, ".recallant", "current-session.json"),
  `${JSON.stringify({ session_id: "orphan-sanitize-session" }, null, 2)}\n`
);
const orphanDryRun = runJson([
  "project-sanitize",
  "--project-dir",
  orphanLocalDir,
  "--mode",
  "purge",
  "--allow-orphan-local",
  "--dry-run",
  "--format",
  "json"
]);
if (
  orphanDryRun.status !== "not_found" ||
  orphanDryRun.database?.status !== "not_found" ||
  orphanDryRun.database?.writes_database !== false ||
  orphanDryRun.local_only_cleanup !== true ||
  orphanDryRun.local_cleanup?.local_only !== true ||
  orphanDryRun.local_cleanup?.writes_database !== false ||
  orphanDryRun.local_cleanup?.writes_files !== false ||
  !orphanDryRun.local_cleanup?.planned_changes?.some(
    (change) => change.path === ".recallant/config"
  ) ||
  !orphanDryRun.warnings?.some((warning) => /No matching managed project/.test(warning))
) {
  throw new Error(`orphan project sanitize dry-run failed: ${JSON.stringify(orphanDryRun)}`);
}
const orphanConfirmed = runJson([
  "project-sanitize",
  "--project-dir",
  orphanLocalDir,
  "--mode",
  "purge",
  "--allow-orphan-local",
  "--confirm",
  "--format",
  "json"
]);
if (
  orphanConfirmed.status !== "orphan_local_cleaned" ||
  orphanConfirmed.database?.status !== "not_found" ||
  orphanConfirmed.database?.writes_database !== false ||
  orphanConfirmed.writes_database !== false ||
  orphanConfirmed.writes_files !== true ||
  orphanConfirmed.local_cleanup?.status !== "cleaned" ||
  (await exists(join(orphanLocalDir, ".recallant", "config"))) ||
  (await exists(join(orphanLocalDir, ".recallant", "current-session.json"))) ||
  !(await exists(join(orphanLocalDir, "README.md")))
) {
  throw new Error(
    `confirmed orphan project sanitize cleanup failed: ${JSON.stringify(orphanConfirmed, null, 2)}`
  );
}

const detachDryRun = runJson([
  "project-sanitize",
  "--project-id",
  detachAttach.project_id,
  "--mode",
  "detach",
  "--detach-mode",
  "sandbox",
  "--dry-run",
  "--format",
  "json"
]);
const detachConfirmed = runJson([
  "project-sanitize",
  "--project-id",
  detachAttach.project_id,
  "--mode",
  "detach",
  "--detach-mode",
  "sandbox",
  "--confirm",
  "--format",
  "json"
]);
if (
  detachDryRun.database?.status !== "pending_confirmation" ||
  detachConfirmed.database?.status !== "detached" ||
  detachConfirmed.database?.changes?.physically_deleted_records !== 0 ||
  !(await projectExists(detachAttach.project_id))
) {
  throw new Error(
    `Project sanitize detach mode regressed: ${JSON.stringify({ detachDryRun, detachConfirmed })}`
  );
}

const realProjectDryRunPath = process.env.RECALLANT_PROJECT_SANITIZE_REAL_DRY_RUN_PATH;
if (realProjectDryRunPath && (await exists(realProjectDryRunPath))) {
  process.stdout.write(
    "Opt-in real project path detected; smoke intentionally performs no confirmed purge there.\n"
  );
}

process.stdout.write("Project sanitize smoke passed\n");
