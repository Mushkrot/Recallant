import { continuityDatabaseUrl } from "./fixtures/continuity-database.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { URL, pathToFileURL } from "node:url";

const sourceRoot = resolve(process.argv[2] ?? ".");
const require = createRequire(join(sourceRoot, "package.json"));
const { Client } = require("pg");
const { RecallantDb } = await import(pathToFileURL(join(sourceRoot, "packages/db/dist/index.js")));
const cliPath = join(sourceRoot, "apps/cli/dist/index.js");
const databaseUrl = continuityDatabaseUrl();
const target = new URL(databaseUrl);

const started = performance.now();
const databaseName = `recallant_compaction_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
await admin.connect();
await admin.query(`CREATE DATABASE "${databaseName}"`);
const runTarget = new URL(target);
runTarget.pathname = `/${databaseName}`;
const client = new Client({ connectionString: runTarget.toString() });
const projectPath = await mkdtemp(join(tmpdir(), "recallant-compaction-precompact-"));
const developerId = randomUUID();
const projectId = randomUUID();
const chatId = "Compaction-meaningful-checkpoint";
const statePath = join(
  projectPath,
  ".recallant/sessions",
  `${createHash("sha256").update(chatId).digest("hex")}.json`
);
const db = new RecallantDb({
  databaseUrl: runTarget.toString(),
  developerId,
  projectId,
  projectPath
});

// Forward only the synthetic target, not the caller's provider or service configuration.
const cliEnv = {
  PATH: process.env.PATH,
  RECALLANT_ENV_FILE: join(projectPath, "missing.env"),
  RECALLANT_SERVICE_ENV_FILE: join(projectPath, "missing-service.env"),
  RECALLANT_DATABASE_URL: runTarget.toString(),
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: projectPath,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
};

function cli(args, input) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectPath,
    env: cliEnv,
    input,
    encoding: "utf8",
    timeout: 10000
  });
  assert.equal(result.signal, null, "local CLI timed out");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", "local CLI emitted an unexpected error");
  return result.stdout;
}

function hook(eventName, extra = {}) {
  const output = cli(
    ["codex-hook"],
    JSON.stringify({
      hook_event_name: eventName,
      session_id: chatId,
      cwd: projectPath,
      ...extra
    })
  );
  assert.equal(output, "", "native hook must keep stdout silent");
}

const readState = async () => JSON.parse(await readFile(statePath, "utf8"));
const checks = [];

try {
  await client.connect();
  await client.query(
    await readFile(join(sourceRoot, "packages/db/migrations/0001_initial.sql"), "utf8")
  );
  const project = await db.ensureProject();
  await mkdir(join(projectPath, ".recallant"), { recursive: true });
  await writeFile(
    join(projectPath, ".recallant/config"),
    JSON.stringify({ project_id: project.projectId })
  );
  await db.setCheckpoint(project.projectId, {
    current_focus: "Compaction legacy project checkpoint",
    current_status: "preserve legacy",
    next_step: "Keep the project checkpoint unchanged"
  });

  hook("SessionStart", { source: "startup" });
  const checkpointResult = JSON.parse(
    cli([
      "agent-checkpoint",
      "--project-dir",
      projectPath,
      "--external-session-id",
      chatId,
      "--focus",
      "Compaction repair checkpoint preservation",
      "--status",
      "verification_pending",
      "--next-step",
      "Verify the existing meaningful checkpoint after PreCompact"
    ])
  );
  assert.equal(checkpointResult.mode, "server");
  const beforeState = await readState();
  const sessionId = beforeState.session_id;
  const before = await db.getSessionCheckpoint(sessionId, project.projectId);
  assert.equal(before.payload.current_focus, "Compaction repair checkpoint preservation");
  assert.equal(before.payload.status, "verification_pending");
  const beforeContext = await db.getContextPack({
    session_id: sessionId,
    task_hint: "Compaction checkpoint preservation"
  });
  const legacyBefore = await db.getCheckpoint(project.projectId);

  for (const trigger of ["auto", "manual"]) {
    hook("PreCompact", { trigger, turn_id: `Compaction-${trigger}` });
    const after = await db.getSessionCheckpoint(sessionId, project.projectId);
    assert.deepEqual(after.payload, before.payload, `${trigger}: meaningful payload changed`);
    assert.equal(
      after.updated_at.getTime(),
      before.updated_at.getTime(),
      `${trigger}: checkpoint was rewritten`
    );
    const context = await db.getContextPack({
      session_id: sessionId,
      task_hint: "Compaction checkpoint preservation"
    });
    assert.deepEqual(
      context.sections.checkpoint.payload,
      beforeContext.sections.checkpoint.payload
    );
    const afterState = await readState();
    assert.equal(afterState.session_id, sessionId);
    assert.equal(afterState.last_checkpoint_at, beforeState.last_checkpoint_at);
    const legacyAfter = await db.getCheckpoint(project.projectId);
    assert.deepEqual(legacyAfter, legacyBefore);
    const observations = await client.query(
      `SELECT kind, status, title, redacted_metadata FROM agent_observations
       WHERE session_id = $1 AND title = 'Codex context compaction started'
         AND redacted_metadata->>'trigger' = $2`,
      [sessionId, trigger]
    );
    assert.equal(observations.rowCount, 1, `${trigger}: compaction audit event was not persisted`);
    assert.equal(observations.rows[0].kind, "system");
    assert.equal(observations.rows[0].status, "started");
    checks.push({
      trigger,
      checkpoint: "preserved",
      context_pack: "preserved",
      audit_event: "persisted"
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        boundary: "real local CLI/hook and disposable DB; no installed-runtime acceptance",
        target: "disposable loopback PostgreSQL",
        duration_ms: Math.round(performance.now() - started),
        full_payload_and_timestamp_unchanged: true,
        legacy_checkpoint_unchanged: true,
        checks
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
  await client.end().catch(() => undefined);
  await rm(projectPath, { recursive: true, force: true });
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
