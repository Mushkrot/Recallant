import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const repoRoot = process.cwd();

const spoolDir = await mkdtemp(join(tmpdir(), "recallant-spool-"));
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-spool-${projectId}`;
const token = `spool_token_${projectId.replaceAll("-", "_")}`;
const artifactSha = "3".repeat(64);

function run(args, expectSuccess = true) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId,
      RECALLANT_PROJECT_PATH: projectPath
    },
    encoding: "utf8"
  });
  if (expectSuccess && result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  if (!expectSuccess) return result;
  return JSON.parse(result.stdout);
}

const turn = run([
  "spool-append",
  "--spool-dir",
  spoolDir,
  "--kind",
  "turn",
  "--role",
  "user",
  "--text",
  `Offline spool turn ${token}`
]);
const event = run([
  "spool-append",
  "--spool-dir",
  spoolDir,
  "--kind",
  "event",
  "--event-kind",
  "terminal_output",
  "--text",
  "Offline spool raw artifact event",
  "--raw-artifact-json",
  JSON.stringify([
    {
      artifact_kind: "terminal_output",
      storage_backend: "local_spool",
      uri: "spool://terminal-output",
      sha256: artifactSha,
      size_bytes: 1024,
      content_type: "text/plain",
      excerpt: "bounded local spool excerpt",
      metadata: { smoke: true }
    }
  ])
]);

const spoolText = await readFile(join(spoolDir, "spool.jsonl"), "utf8");
if (!spoolText.includes(turn.local_id) || !spoolText.includes(event.local_id)) {
  throw new Error(`Spool append did not create JSONL records: ${spoolText}`);
}

const dryRun = run(["sync-spool", "--spool-dir", spoolDir, "--dry-run"]);
if (dryRun.writes_database !== false || dryRun.unsynced_count !== 2) {
  throw new Error(`sync-spool dry-run failed: ${JSON.stringify(dryRun)}`);
}

const contextPack = run([
  "context",
  "--project-dir",
  projectPath,
  "--spool-dir",
  spoolDir,
  "--task-hint",
  "offline spool"
]);
const packSpoolStatus = contextPack.sections?.local_spool_status;
if (packSpoolStatus?.status !== "unsynced" || packSpoolStatus?.unsynced_count !== 2) {
  throw new Error(
    `Context pack did not expose unsynced spool status: ${JSON.stringify(contextPack)}`
  );
}

const firstSync = run(["sync-spool", "--spool-dir", spoolDir]);
if (
  firstSync.synced_count !== 2 ||
  !firstSync.mappings[turn.local_id] ||
  !firstSync.mappings[event.local_id]
) {
  throw new Error(`sync-spool failed: ${JSON.stringify(firstSync)}`);
}

const secondSync = run(["sync-spool", "--spool-dir", spoolDir]);
if (secondSync.synced_count !== 0) {
  throw new Error(`sync-spool was not idempotent: ${JSON.stringify(secondSync)}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM events WHERE project_id = $1) AS event_count,
        (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1 AND sha256 = $2) AS raw_artifact_count,
        (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND text LIKE $3) AS chunk_count
    `,
    [projectId, artifactSha, `%${token}%`]
  );
  const row = checks.rows[0];
  if (row.event_count !== 2 || row.raw_artifact_count !== 1 || row.chunk_count < 1) {
    throw new Error(`Spool sync DB checks failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

const pruneBlocked = run(["prune-spool", "--spool-dir", spoolDir], false);
if (pruneBlocked.status === 0 || !pruneBlocked.stderr.includes("POLICY_BLOCKED")) {
  throw new Error(`prune-spool without --synced was not blocked: ${pruneBlocked.stderr}`);
}

const pruned = run(["prune-spool", "--spool-dir", spoolDir, "--synced"]);
if (pruned.pruned_count !== 2 || pruned.kept_unsynced_count !== 0) {
  throw new Error(`prune-spool failed: ${JSON.stringify(pruned)}`);
}
const prunedText = await readFile(join(spoolDir, "spool.jsonl"), "utf8");
if (prunedText.trim().length !== 0) {
  throw new Error(`prune-spool left synced records: ${prunedText}`);
}

process.stdout.write("Spool smoke passed\n");
