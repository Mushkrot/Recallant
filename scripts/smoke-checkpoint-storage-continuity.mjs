import { continuityDatabaseUrl } from "./fixtures/continuity-database.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { URL, pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const require = createRequire(join(root, "package.json"));
const { Client } = require("pg");
const { RecallantDb } = await import(pathToFileURL(join(root, "packages/db/dist/index.js")));
const url = continuityDatabaseUrl();
const target = new URL(url);
const admin = new Client({ connectionString: url });
await admin.connect();
const databases = [];
const results = [];
const started = performance.now();
const payload = (name) => ({
  current_focus: `Storage ${name}`,
  current_status: "verification pending",
  next_step: `Continue ${name} only`
});

async function database(schema) {
  const name = `recallant_storage_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  databases.push(name);
  const connection = new URL(target);
  connection.pathname = `/${name}`;
  const client = new Client({ connectionString: connection.toString() });
  await client.connect();
  await client.query(schema);
  return { client, connectionString: connection.toString() };
}

async function scenario(id, work) {
  const projectPath = await mkdtemp(join(tmpdir(), "recallant-storage-project-"));
  const fixture = await database(
    await readFile(join(root, "packages/db/migrations/0001_initial.sql"), "utf8")
  );
  const db = new RecallantDb({
    databaseUrl: fixture.connectionString,
    developerId: randomUUID(),
    projectId: randomUUID(),
    projectPath
  });
  try {
    const project = await db.ensureProject();
    const start = (chat, extra = {}) =>
      db.startSession({
        client_kind: "codex",
        project_path: projectPath,
        ...(chat ? { external_session_id: chat } : {}),
        ...extra
      });
    const write = (s, value) => db.setSessionCheckpoint(s.session_id, value, project.projectId);
    const row = async (s) =>
      (await fixture.client.query("SELECT * FROM sessions WHERE id = $1", [s.session_id])).rows[0];
    await work({ db, ...fixture, project, start, write, row });
    results.push({ id, status: "PASS" });
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    results.push({
      id,
      status: "FAIL",
      message: error.message,
      actual: error.actual,
      expected: error.expected
    });
  } finally {
    await db.close();
    await fixture.client.end();
    await rm(projectPath, { recursive: true, force: true });
  }
}

try {
  await scenario("C2_parallel_ownership", async ({ db, project, start, write }) => {
    const a = await start("A");
    await write(a, payload("A"));
    const b = await start("B");
    assert.equal(b.checkpoint.payload, null);
    await write(b, payload("B"));
    assert.deepEqual((await start("A")).checkpoint.payload, payload("A"));
    assert.deepEqual((await start("B")).checkpoint.payload, payload("B"));
    await assert.rejects(
      () => db.getSessionCheckpoint(a.session_id, randomUUID()),
      /PROJECT_ID_PATH_MISMATCH/
    );
    await assert.rejects(
      () => db.setSessionCheckpoint(a.session_id, payload("wrong"), randomUUID()),
      /PROJECT_ID_PATH_MISMATCH/
    );
    assert.deepEqual(
      (await db.getSessionCheckpoint(a.session_id, project.projectId)).payload,
      payload("A")
    );
  });

  await scenario("C3_interrupted_continuity", async ({ client, start, write, row, db }) => {
    const a = await start("A");
    const b = await start("B");
    await write(a, payload("A"));
    await write(b, payload("B"));
    const beforeB = await row(b);
    const checkpointB = await db.getSessionCheckpoint(b.session_id);
    await client.query(
      "UPDATE sessions SET last_seen_at = now() - interval '9 hours' WHERE id = $1",
      [a.session_id]
    );
    const resumed = await start("A");
    assert.notEqual(resumed.session_id, a.session_id);
    assert.deepEqual(resumed.checkpoint.payload, payload("A"));
    assert.equal(resumed.previous_session_recovery.status, "interrupted");
    assert.equal((await row(resumed)).recovered_from_session_id, a.session_id);
    assert.equal(
      (await start("A")).session_id,
      resumed.session_id,
      "second resume created another active session"
    );
    assert.deepEqual(await row(b), beforeB);
    assert.deepEqual(await db.getSessionCheckpoint(b.session_id), checkpointB);
  });

  await scenario("C2_client_kind_context_isolation", async ({ client, start, write, db }) => {
    const codex = await start("shared-external-id");
    await write(codex, payload("codex-only"));
    const other = await start("shared-external-id", { client_kind: "generic" });
    await write(other, payload("generic-only"));
    await client.query("UPDATE sessions SET status='interrupted' WHERE id=$1", [codex.session_id]);
    const pack = await db.getContextPack({
      session_id: other.session_id,
      task_hint: "Isolated context",
      include_recovery: true
    });
    assert.equal(pack.sections.recovery.length, 0);
    assert.equal(
      pack.sections.checkpoint.payload.current_focus,
      payload("generic-only").current_focus
    );
    assert.deepEqual(
      (await db.getSessionCheckpoint(other.session_id)).payload,
      payload("generic-only")
    );
    const resumed = await start("shared-external-id");
    const ownPack = await db.getContextPack({
      session_id: resumed.session_id,
      task_hint: "Own session recovery",
      include_recovery: true
    });
    assert.ok(ownPack.sections.recovery.some((s) => s.session_id === codex.session_id));
  });

  await scenario("C4_closed_continuity", async ({ db, start, write, row }) => {
    const a = await start("A");
    const b = await start("B");
    await write(a, payload("A"));
    await write(b, payload("B"));
    const beforeB = await row(b);
    const checkpointB = await db.getSessionCheckpoint(b.session_id);
    await db.closeout(a.session_id, payload("A"));
    const resumed = await start("A");
    assert.deepEqual(resumed.checkpoint.payload, payload("A"));
    assert.equal(resumed.previous_unclosed_session, null);
    assert.equal(resumed.previous_session_recovery.status, "none");
    assert.equal((await row(resumed)).recovered_from_session_id, null);
    assert.equal((await row(a)).status, "closed");
    assert.deepEqual(await row(b), beforeB);
    assert.deepEqual(await db.getSessionCheckpoint(b.session_id), checkpointB);
  });

  await scenario("C5_identity_validation", async ({ client, start, write, db }) => {
    const a = await start("A");
    await write(a, payload("A"));
    const anonymous = await start(null);
    assert.equal(anonymous.checkpoint.payload, null);
    assert.equal(anonymous.previous_unclosed_session, null);
    await client.query("UPDATE sessions SET status = 'interrupted' WHERE id = $1", [a.session_id]);
    await assert.rejects(
      () => start("B", { recover_session_id: a.session_id }),
      /different external chat/
    );
    await assert.rejects(
      () => start("A", { recover_session_id: a.session_id, client_kind: "cursor" }),
      /VALIDATION_ERROR/
    );
    await assert.rejects(
      () => start(null, { recover_session_id: randomUUID() }),
      /VALIDATION_ERROR/
    );
    const explicit = await start(null, { recover_session_id: a.session_id });
    assert.deepEqual(explicit.checkpoint.payload, payload("A"));
    assert.deepEqual((await db.getSessionCheckpoint(a.session_id)).payload, payload("A"));
  });

  await scenario("C6_concurrent_starts", async ({ client, start, write }) => {
    const same = await Promise.all(Array.from({ length: 6 }, () => start("A")));
    assert.equal(new Set(same.map((s) => s.session_id)).size, 1);
    await write(same[0], payload("A"));
    const other = await start("B");
    await write(other, payload("B"));
    const interleaved = await Promise.all(
      Array.from({ length: 8 }, (_, i) => start(i % 2 ? "A" : "B"))
    );
    interleaved.forEach((s, i) =>
      assert.deepEqual(s.checkpoint.payload, payload(i % 2 ? "A" : "B"))
    );
    await client.query("UPDATE sessions SET status = 'interrupted' WHERE id = $1", [
      same[0].session_id
    ]);
    const recovered = await Promise.all(
      Array.from({ length: 3 }, () => start("A", { recover_session_id: same[0].session_id }))
    );
    assert.equal(
      new Set(recovered.map((s) => s.session_id)).size,
      1,
      "explicit recovery created duplicate active sessions"
    );
    const c = await start("C");
    await write(c, payload("C"));
    await client.query("UPDATE sessions SET status = 'interrupted' WHERE id = $1", [c.session_id]);
    const anonymousRecovery = await Promise.all(
      Array.from({ length: 3 }, () => start(null, { recover_session_id: c.session_id }))
    );
    assert.equal(new Set(anonymousRecovery.map((s) => s.session_id)).size, 1);
    anonymousRecovery.forEach((s) => assert.deepEqual(s.checkpoint.payload, payload("C")));
  });

  const legacySql = await readFile(
    join(root, "scripts/fixtures/legacy-project-checkpoints.sql"), "utf8"
  );
  const legacy = await database(legacySql);
  let legacyDb;
  try {
    const developer = randomUUID();
    const project = randomUUID();
    const session = randomUUID();
    await legacy.client.query("INSERT INTO developers(id,name) VALUES($1,'Storage synthetic legacy')", [
      developer
    ]);
    await legacy.client.query(
      "INSERT INTO projects(id,developer_id,name,primary_path) VALUES($1,$2,'Storage legacy','/tmp/b3-legacy')",
      [project, developer]
    );
    await legacy.client.query(
      "INSERT INTO sessions(id,project_id,client_kind,status) VALUES($1,$2,'codex','interrupted')",
      [session, project]
    );
    await legacy.client.query(
      "INSERT INTO events(project_id,session_id,ingest_source,kind,payload,occurred_at) VALUES($1,$2,'b3-fixture','checkpoint',$3,'2026-10-13T00:00:00Z')",
      [project, session, JSON.stringify({ synthetic: "legacy history" })]
    );
    await legacy.client.query("INSERT INTO checkpoints(project_id,payload) VALUES($1,$2)", [
      project,
      JSON.stringify(payload("legacy"))
    ]);
    const beforeEvents = (await legacy.client.query("SELECT * FROM events")).rows;
    const beforeCheckpoints = (await legacy.client.query("SELECT * FROM checkpoints")).rows;
    const migration = await readFile(
      join(root, "packages/db/migrations/0002_session_scoped_checkpoints.sql"),
      "utf8"
    );
    await legacy.client.query(migration);
    await legacy.client.query(migration);
    assert.deepEqual((await legacy.client.query("SELECT * FROM events")).rows, beforeEvents);
    assert.deepEqual(
      (await legacy.client.query("SELECT * FROM checkpoints")).rows,
      beforeCheckpoints
    );
    assert.equal(
      (
        await legacy.client.query("SELECT external_session_id_hash FROM sessions WHERE id=$1", [
          session
        ])
      ).rows[0].external_session_id_hash,
      null
    );
    legacyDb = new RecallantDb({
      databaseUrl: legacy.connectionString,
      developerId: developer,
      projectId: project,
      projectPath: "/tmp/b3-legacy"
    });
    const newChat = await legacyDb.startSession({
      client_kind: "codex",
      project_id: project,
      external_session_id: "new chat"
    });
    assert.equal(newChat.checkpoint.payload, null);
    assert.equal(newChat.legacy_checkpoint.status, "ambiguous_owner");
    assert.equal(newChat.legacy_checkpoint.payload_included, false);
    results.push({ id: "C7_legacy_migration_twice", status: "PASS" });
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    results.push({ id: "C7_legacy_migration_twice", status: "FAIL", message: error.message });
  } finally {
    await legacyDb?.close();
    await legacy.client.end();
  }

  process.stdout.write(
    `${JSON.stringify({ target: "disposable loopback PostgreSQL", boundary: "DB storage/continuity; no MCP/remote or installed-runtime acceptance", duration_ms: Math.round(performance.now() - started), results }, null, 2)}\n`
  );
  process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
} finally {
  for (const name of databases) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
