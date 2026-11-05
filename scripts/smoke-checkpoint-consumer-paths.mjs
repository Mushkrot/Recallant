import { continuityDatabaseUrl } from "./fixtures/continuity-database.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { clearTimeout } from "node:timers";
import { URL, pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const replayOnly = process.argv.includes("--replay-only");
const require = createRequire(join(root, "package.json"));
const { Client } = require("pg");
const { RecallantDb } = await import(pathToFileURL(join(root, "packages/db/dist/index.js")));
const { createRecallantHttpServer } = await import(
  pathToFileURL(join(root, "apps/server/dist/index.js"))
);
const url = continuityDatabaseUrl();
const target = new URL(url);
const started = performance.now();
const name = `recallant_consumer_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
const runTarget = new URL(target);
runTarget.pathname = `/${name}`;
const client = new Client({ connectionString: runTarget.toString() });
const projectPath = await mkdtemp(join(tmpdir(), "recallant-consumer-consumers-"));
const developerId = randomUUID();
const projectId = randomUUID();
const db = new RecallantDb({
  databaseUrl: runTarget.toString(),
  developerId,
  projectId,
  projectPath
});
const cliPath = join(root, "apps/cli/dist/index.js");
const localEnv = {
  PATH: process.env.PATH,
  RECALLANT_ENV_FILE: join(projectPath, "missing.env"),
  RECALLANT_DATABASE_URL: runTarget.toString(),
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: projectPath,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
};
const remoteEnv = {
  PATH: process.env.PATH,
  RECALLANT_ENV_FILE: join(projectPath, "missing.env"),
  RECALLANT_DATABASE_URL: "",
  RECALLANT_PROJECT_PATH: projectPath
};
const results = [];
let server;
let serverPort;
let mcp;

async function cli(args, env, input, expectedError) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: projectPath,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (s) => {
    out += s;
  });
  child.stderr.on("data", (s) => {
    err += s;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 10000);
  child.stdin.end(input);
  const code = await new Promise((done) => child.once("exit", done));
  clearTimeout(timer);
  if (expectedError) {
    if (code === 0) {
      const result = JSON.parse(out);
      assert.equal(result.mode, "offline_spool");
      assert.match(result.remote_failure.message, expectedError);
      return result;
    } else {
      assert.notEqual(code, null, "CLI timed out");
      assert.match(err, expectedError);
    }
    return null;
  }
  assert.equal(code, 0, err || "CLI timed out");
  assert.equal(err, "");
  return out ? JSON.parse(out) : null;
}

async function openMcp() {
  const child = spawn(process.execPath, [cliPath, "mcp-server"], {
    cwd: projectPath,
    env: localEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) =>
    new Promise((done, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 10000);
      pending.set(requestId, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else done(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
    });
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "consumer-synthetic", version: "1" }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    child,
    lines,
    call: async (tool, args) => {
      const result = await rpc("tools/call", { name: tool, arguments: args });
      assert.notEqual(result.isError, true, `MCP ${tool}: ${result.content?.[0]?.text}`);
      return JSON.parse(result.content[0].text);
    }
  };
}

async function closeMcp() {
  if (!mcp) return;
  mcp.child.stdin.end();
  await new Promise((done) =>
    mcp.child.exitCode !== null ? done() : mcp.child.once("exit", done)
  );
  mcp.lines.close();
  mcp = null;
}
async function listen() {
  await new Promise((done) => server.listen(serverPort ?? 0, "127.0.0.1", done));
  serverPort = server.address().port;
}
async function stopServer() {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
const checkpoint = (path, chat) => ({
  current_focus: `Consumer ${path} ${chat}`,
  current_status: "verification_pending",
  next_step: `Continue ${path} ${chat} only`
});

try {
  await client.connect();
  await client.query(await readFile(join(root, "packages/db/migrations/0001_initial.sql"), "utf8"));
  const project = await db.ensureProject();
  await mkdir(join(projectPath, ".recallant"), { recursive: true });
  await writeFile(
    join(projectPath, ".recallant/config"),
    JSON.stringify({ project_id: project.projectId })
  );
  const fact = await db.createAgentMemory({
    memory_type: "domain_fact",
    scope: "project",
    title: "Consumer shared synthetic fact",
    body: "Consumer shared synthetic fact is available to all project chats.",
    created_by: "user"
  });
  await db.reviewAgentMemory({ memory_id: fact.memory_id, action: "accept", actor_kind: "user" });
  server = createRecallantHttpServer({ remoteMcpDatabase: db, workbenchDatabase: db });
  await listen();
  const credential = await db.createRemoteMcpCredential({
    projectId,
    developerId,
    clientId: "consumer-synthetic",
    label: "Consumer disposable"
  });
  const rpc = async (tool, args) => {
    const response = await globalThis.fetch(`http://127.0.0.1:${serverPort}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.secret}`,
        "X-Recallant-Project-Id": projectId,
        "X-Recallant-Developer-Id": developerId,
        "X-Recallant-Client-Id": "consumer-synthetic"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args }
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.error, undefined, JSON.stringify(body));
    assert.notEqual(body.result.isError, true, body.result.content?.[0]?.text);
    return JSON.parse(body.result.content[0].text);
  };
  const configureRemote = async () => {
    await mkdir(join(projectPath, ".codex"), { recursive: true });
    await writeFile(
      join(projectPath, ".codex/config.toml"),
      `[mcp_servers.recallant]\ncommand = "recallant"\nargs = ["remote-bridge"]\nenv = { RECALLANT_REMOTE_MCP_URL = "http://127.0.0.1:${serverPort}", RECALLANT_PROJECT_ID = "${projectId}", RECALLANT_DEVELOPER_ID = "${developerId}", RECALLANT_REMOTE_MCP_CLIENT_ID = "consumer-synthetic", RECALLANT_REMOTE_MCP_CREDENTIAL = "${credential.secret}" }\n`
    );
  };
  if (replayOnly) await configureRemote();
  else mcp = await openMcp();

  for (const path of replayOnly ? [] : ["stdio_mcp", "local_cli", "remote_cli"]) {
    if (path === "remote_cli") {
      await closeMcp();
      await configureRemote();
    }
    const env = path === "remote_cli" ? remoteEnv : localEnv;
    const call = path === "stdio_mcp" ? mcp.call : rpc;
    const external = (chat) => `${path}-${chat}`;
    const start = async (chat) => {
      const result =
        path === "stdio_mcp"
          ? await call("memory_start_session", {
              client_kind: "codex",
              project_path: projectPath,
              ...(chat ? { external_session_id: external(chat) } : {})
            })
          : await cli(
              [
                "agent-start",
                "--project-dir",
                projectPath,
                ...(chat ? ["--external-session-id", external(chat)] : []),
                "--task-hint",
                "Consumer shared synthetic fact",
                "--format",
                "json"
              ],
              env
            );
      if (path === "remote_cli")
        assert.equal(
          result.mode,
          "remote_mcp_ready",
          "remote startup did not reach the real server"
        );
      return result;
    };
    const write = async (chat, session) =>
      path === "stdio_mcp"
        ? call("memory_set_checkpoint", {
            session_id: session.session_id,
            payload: checkpoint(path, chat)
          })
        : cli(
            [
              "agent-checkpoint",
              "--project-dir",
              projectPath,
              "--external-session-id",
              external(chat),
              "--focus",
              checkpoint(path, chat).current_focus,
              "--status",
              "verification_pending",
              "--next-step",
              checkpoint(path, chat).next_step
            ],
            env
          );
    const a = await start("A");
    await write("A", a);
    const beforeA = await db.getSessionCheckpoint(a.session_id);
    const b = await start("B");
    assert.equal((await db.getSessionCheckpoint(b.session_id)).payload, null);
    await write("B", b);
    const beforeB = await db.getSessionCheckpoint(b.session_id);
    assert.equal((await start("A")).session_id, a.session_id);
    const pack = await call("memory_get_context_pack", {
      session_id: a.session_id,
      task_hint: "Consumer shared synthetic fact"
    });
    assert.equal(
      pack.sections.checkpoint.payload.current_focus,
      checkpoint(path, "A").current_focus
    );
    assert.ok(
      JSON.stringify(pack).includes("Consumer shared synthetic fact"),
      "shared project knowledge disappeared"
    );
    await cli(
      ["codex-hook"],
      env,
      JSON.stringify({
        hook_event_name: "PreCompact",
        session_id: external("A"),
        cwd: projectPath,
        trigger: "auto",
        turn_id: `${path}-compact`
      })
    );
    assert.deepEqual(await db.getSessionCheckpoint(a.session_id), beforeA);
    assert.deepEqual(await db.getSessionCheckpoint(b.session_id), beforeB);
    const captured = await client.query(
      "SELECT count(*)::int AS count FROM agent_observations WHERE session_id=$1 AND title='Codex context compaction started'",
      [a.session_id]
    );
    assert.equal(captured.rows[0].count, 1);
    await client.query(
      "UPDATE sessions SET last_seen_at = now() - interval '9 hours' WHERE id=$1",
      [a.session_id]
    );
    const recovered = await start("A");
    assert.notEqual(recovered.session_id, a.session_id);
    assert.deepEqual(
      (await db.getSessionCheckpoint(recovered.session_id)).payload,
      beforeA.payload
    );
    assert.equal((await start("A")).session_id, recovered.session_id);
    if (path === "stdio_mcp")
      await call("memory_closeout", {
        session_id: recovered.session_id,
        closeout_intent: "task_complete",
        summary: "Consumer synthetic closeout",
        checkpoint_payload: checkpoint(path, "A")
      });
    else
      await cli(
        [
          "agent-closeout",
          "--project-dir",
          projectPath,
          "--external-session-id",
          external("A"),
          "--focus",
          checkpoint(path, "A").current_focus,
          "--next-step",
          checkpoint(path, "A").next_step,
          "--summary",
          "Consumer synthetic closeout"
        ],
        env
      );
    const closed = await db.getSessionCheckpoint(recovered.session_id);
    const continued = await start("A");
    assert.deepEqual((await db.getSessionCheckpoint(continued.session_id)).payload, closed.payload);
    assert.equal(
      (await client.query("SELECT status FROM sessions WHERE id=$1", [recovered.session_id]))
        .rows[0].status,
      "closed"
    );
    const anonymous = await start(null);
    assert.equal((await db.getSessionCheckpoint(anonymous.session_id)).payload, null);
    for (const invalid of [
      {
        external: external("B"),
        client: "codex",
        recover: a.session_id,
        error: /different external chat/
      },
      {
        external: external("A"),
        client: "generic",
        recover: a.session_id,
        error: /this client kind/
      },
      { external: external("A"), client: "codex", recover: randomUUID(), error: /this client kind/ }
    ]) {
      if (path === "local_cli") {
        await cli(
          [
            "agent-start",
            "--project-dir",
            projectPath,
            "--external-session-id",
            invalid.external,
            "--client-kind",
            invalid.client,
            "--recover-session-id",
            invalid.recover,
            "--format",
            "json"
          ],
          env,
          undefined,
          invalid.error
        );
      } else {
        await assert.rejects(
          () =>
            call("memory_start_session", {
              client_kind: invalid.client,
              external_session_id: invalid.external,
              recover_session_id: invalid.recover
            }),
          invalid.error
        );
      }
    }
    assert.deepEqual(await db.getSessionCheckpoint(b.session_id), beforeB);
    results.push({
      path,
      C1: "PASS",
      C2: "PASS",
      C3: "PASS",
      C4: "PASS",
      C5: "PASS",
      shared_knowledge_and_capture: "PASS"
    });
  }

  const timestampId = "remote-cli-first-hook-timestamp";
  const timestampStart = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      timestampId,
      "--format",
      "json"
    ],
    remoteEnv
  );
  await cli(
    [
      "agent-checkpoint",
      "--project-dir",
      projectPath,
      "--external-session-id",
      timestampId,
      "--focus",
      "Preserve first-hook checkpoint date",
      "--next-step",
      "Continue own task"
    ],
    remoteEnv
  );
  const timestampBefore = JSON.parse(await readFile(timestampStart.state_path, "utf8"));
  assert.ok(timestampBefore.last_checkpoint_at);
  assert.equal(timestampBefore.native_hook, undefined);
  const storedTimestampBefore = await db.getSessionCheckpoint(timestampStart.session_id);
  const timestampB = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      "remote-cli-timestamp-B",
      "--format",
      "json"
    ],
    remoteEnv
  );
  const timestampBBytes = await readFile(timestampB.state_path, "utf8");
  for (const trigger of ["auto", "manual"]) {
    await cli(
      ["codex-hook"],
      remoteEnv,
      JSON.stringify({
        hook_event_name: "PreCompact",
        session_id: timestampId,
        cwd: projectPath,
        trigger,
        turn_id: `first-hook-timestamp-${trigger}`
      })
    );
    const after = JSON.parse(await readFile(timestampStart.state_path, "utf8"));
    assert.equal(after.session_id, timestampBefore.session_id);
    assert.equal(after.external_session_id_hash, timestampBefore.external_session_id_hash);
    assert.equal(
      after.last_checkpoint_at,
      timestampBefore.last_checkpoint_at,
      "first native hook discarded the CLI checkpoint timestamp"
    );
    assert.deepEqual(
      await db.getSessionCheckpoint(timestampStart.session_id),
      storedTimestampBefore
    );
    assert.equal(await readFile(timestampB.state_path, "utf8"), timestampBBytes);
  }
  const timestampPack = await rpc("memory_get_context_pack", {
    session_id: timestampStart.session_id,
    task_hint: "Preserve first-hook checkpoint date"
  });
  assert.deepEqual(timestampPack.sections.checkpoint.payload, storedTimestampBefore.payload);
  results.push({
    path: "cli_checkpoint_first_native_hook",
    local_timestamp_and_authoritative_state: "PASS",
    parallel_chat_unchanged: "PASS"
  });

  const replayStart = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      "remote-replay",
      "--format",
      "json"
    ],
    remoteEnv
  );
  await cli(
    [
      "agent-checkpoint",
      "--project-dir",
      projectPath,
      "--external-session-id",
      "remote-replay",
      "--focus",
      "Consumer replay checkpoint",
      "--next-step",
      "Preserve replay identity"
    ],
    remoteEnv
  );
  const replayCheckpoint = await db.getSessionCheckpoint(replayStart.session_id);
  await stopServer();
  await cli(
    ["codex-hook"],
    remoteEnv,
    JSON.stringify({
      hook_event_name: "PreCompact",
      session_id: "remote-replay",
      cwd: projectPath,
      trigger: "manual",
      turn_id: "Consumer-offline-replay"
    })
  );
  await listen();
  const replay = await cli(["sync-spool", "--project-dir", projectPath], remoteEnv);
  assert.equal(replay.remaining_count, 0);
  assert.ok(replay.synced_count >= 1);
  assert.deepEqual(await db.getSessionCheckpoint(replayStart.session_id), replayCheckpoint);
  const replayOwners = await client.query(
    "SELECT o.session_id, s.client_kind, s.external_session_id_hash FROM agent_observations o JOIN sessions s ON s.id=o.session_id WHERE o.title='Codex context compaction started' AND o.redacted_metadata->>'external_session_id'='remote-replay'"
  );
  assert.equal(replayOwners.rows.length, 1);
  assert.equal(replayOwners.rows[0].session_id, replayStart.session_id);
  const repeatReplay = await cli(["sync-spool", "--project-dir", projectPath], remoteEnv);
  assert.equal(repeatReplay.synced_count, 0);
  assert.equal(repeatReplay.remaining_count, 0);
  results.push({
    path: "real_remote_hook_replay",
    identity_and_checkpoint: "PASS",
    idempotency: "PASS"
  });

  const knownCliId = "remote-known-cli-replay";
  const knownCli = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      knownCliId,
      "--format",
      "json"
    ],
    remoteEnv
  );
  const untouchedState = await readFile(replayStart.state_path, "utf8");
  await stopServer();
  const offlineCheckpoint = await cli(
    [
      "agent-checkpoint",
      "--project-dir",
      projectPath,
      "--external-session-id",
      knownCliId,
      "--focus",
      "Known CLI offline checkpoint",
      "--next-step",
      "Reconcile local state"
    ],
    remoteEnv
  );
  assert.equal(offlineCheckpoint.mode, "offline_spool");
  assert.equal(JSON.parse(await readFile(knownCli.state_path, "utf8")).status, "offline");
  await listen();
  assert.equal(
    (await cli(["sync-spool", "--project-dir", projectPath], remoteEnv)).remaining_count,
    0
  );
  const knownState = JSON.parse(await readFile(knownCli.state_path, "utf8"));
  assert.equal(knownState.session_id, knownCli.session_id);
  assert.equal(knownState.status, "active", "known CLI checkpoint replay left local state offline");
  assert.equal(
    (await db.getSessionCheckpoint(knownCli.session_id)).payload.current_focus,
    "Known CLI offline checkpoint"
  );
  assert.equal(
    await readFile(replayStart.state_path, "utf8"),
    untouchedState,
    "replay changed an unrelated chat file"
  );
  const settledState = await readFile(knownCli.state_path, "utf8");
  assert.equal(
    (await cli(["sync-spool", "--project-dir", projectPath], remoteEnv)).synced_count,
    0
  );
  assert.equal(await readFile(knownCli.state_path, "utf8"), settledState);

  await stopServer();
  const offlineCloseout = await cli(
    [
      "agent-closeout",
      "--project-dir",
      projectPath,
      "--external-session-id",
      knownCliId,
      "--summary",
      "Known CLI replay closeout",
      "--next-step",
      "Continue own checkpoint"
    ],
    remoteEnv
  );
  assert.equal(offlineCloseout.mode, "offline_spool");
  await listen();
  assert.equal(
    (await cli(["sync-spool", "--project-dir", projectPath], remoteEnv)).remaining_count,
    0
  );
  const closedState = JSON.parse(await readFile(knownCli.state_path, "utf8"));
  assert.equal(closedState.session_id, knownCli.session_id);
  assert.equal(closedState.status, "closed", "known CLI closeout replay left local state offline");
  assert.equal(await readFile(replayStart.state_path, "utf8"), untouchedState);
  const settledCloseout = await readFile(knownCli.state_path, "utf8");
  assert.equal(
    (await cli(["sync-spool", "--project-dir", projectPath], remoteEnv)).synced_count,
    0
  );
  assert.equal(await readFile(knownCli.state_path, "utf8"), settledCloseout);
  results.push({
    path: "known_cli_checkpoint_and_closeout_replay",
    local_state_and_isolation: "PASS",
    idempotency: "PASS"
  });

  await stopServer();
  const offlineChats = ["remote-offline-new-A", "remote-offline-new-B"];
  for (const externalId of offlineChats) {
    await cli(
      ["codex-hook"],
      remoteEnv,
      JSON.stringify({
        hook_event_name: "PreCompact",
        session_id: externalId,
        cwd: projectPath,
        trigger: "auto",
        turn_id: `${externalId}-compact`
      })
    );
  }
  const offlineCliId = "remote-offline-cli-start";
  const offlineCli = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      offlineCliId,
      "--format",
      "json"
    ],
    remoteEnv
  );
  assert.equal(offlineCli.mode, "offline_spool");
  await listen();
  const freshReplay = await cli(["sync-spool", "--project-dir", projectPath], remoteEnv);
  assert.equal(freshReplay.remaining_count, 0);
  assert.equal(freshReplay.synced_count, offlineChats.length + 2);
  const freshOwners = [];
  for (const externalId of offlineChats) {
    const owners = await client.query(
      "SELECT o.session_id, s.client_kind, s.external_session_id_hash FROM agent_observations o JOIN sessions s ON s.id=o.session_id WHERE o.title='Codex context compaction started' AND o.redacted_metadata->>'external_session_id'=$1",
      [externalId]
    );
    assert.equal(owners.rows.length, 1);
    const owner = owners.rows[0];
    assert.equal(owner.client_kind, "codex");
    assert.equal(
      owner.external_session_id_hash,
      createHash("sha256").update(externalId).digest("hex")
    );
    const localState = JSON.parse(
      await readFile(
        join(projectPath, ".recallant/sessions", `${owner.external_session_id_hash}.json`),
        "utf8"
      )
    );
    assert.equal(
      localState.session_id,
      owner.session_id,
      "replay left the chat state bound to a local placeholder"
    );
    assert.equal(localState.status, "active");
    const continued = await cli(
      [
        "agent-start",
        "--project-dir",
        projectPath,
        "--external-session-id",
        externalId,
        "--format",
        "json"
      ],
      remoteEnv
    );
    assert.equal(continued.mode, "remote_mcp_ready");
    assert.equal(continued.session_id, owner.session_id);
    assert.equal((await db.getSessionCheckpoint(owner.session_id)).payload, null);
    freshOwners.push(owner.session_id);
  }
  const cliState = JSON.parse(await readFile(offlineCli.state_path, "utf8"));
  assert.notEqual(
    cliState.session_id,
    offlineCli.session_id,
    "offline CLI state was not reconciled"
  );
  assert.equal(cliState.status, "active");
  const cliResume = await rpc("memory_start_session", {
    client_kind: "codex",
    external_session_id: offlineCliId
  });
  assert.equal(cliState.session_id, cliResume.session_id);
  assert.ok(cliState.context_pack_id);
  assert.ok(cliState.last_context_read_at);
  results.push({ path: "new_offline_cli_replay", local_binding_and_context: "PASS" });
  assert.notEqual(freshOwners[0], freshOwners[1]);
  assert.deepEqual(await db.getSessionCheckpoint(replayStart.session_id), replayCheckpoint);
  results.push({ path: "new_offline_chats_remote_replay", identity_and_isolation: "PASS" });
  const quarantineIds = [randomUUID(), randomUUID(), randomUUID()];
  const quarantineExternal = "quarantined-task-artifact";
  const quarantinedRecords = [
    "memory_start_session",
    "memory_get_context_pack",
    "memory_closeout"
  ].map((tool, i) => ({
    local_id: quarantineIds[i],
    record_kind: "remote_tool",
    created_at: new Date().toISOString(),
    payload: {
      local_session_id: "local-quarantined",
      tool_name: tool,
      arguments: {
        client_kind: "codex",
        external_session_id: quarantineExternal,
        session_id: "local-quarantined"
      }
    }
  }));
  const ordinaryId = randomUUID();
  const ordinaryRecord = {
    local_id: ordinaryId,
    record_kind: "remote_tool",
    created_at: new Date().toISOString(),
    payload: {
      local_session_id: timestampStart.session_id,
      tool_name: "memory_append_event",
      arguments: {
        session_id: timestampStart.session_id,
        client_kind: "codex",
        event_kind: "other",
        text: "Synthetic permitted queue event",
        metadata: {},
        dedup_key: `quarantine-control-${ordinaryId}`
      }
    }
  };
  const queuePath = join(projectPath, ".recallant/spool/spool.jsonl");
  const preservedQueue =
    (await readFile(queuePath, "utf8")) +
    [...quarantinedRecords, ordinaryRecord].map((record) => JSON.stringify(record) + "\n").join("");
  await writeFile(queuePath, preservedQueue);
  await writeFile(
    join(projectPath, ".recallant/spool/local-quarantine.json"),
    JSON.stringify({ version: 1, local_ids: quarantineIds })
  );
  const legacyPath = join(projectPath, ".recallant/current-session.json");
  const unknownLegacy = JSON.stringify({
    schema_version: 1,
    status: "offline",
    session_id: "local-ambiguous-owner",
    project_id: projectId,
    project_dir: projectPath,
    client_kind: "codex",
    task_hint: "Unknown legacy task",
    external_session_id_hash: null,
    last_checkpoint_at: "2020-01-01T00:00:00.000Z"
  });
  await writeFile(legacyPath, unknownLegacy);
  const quarantineDry = await cli(
    ["sync-spool", "--project-dir", projectPath, "--dry-run"],
    remoteEnv
  );
  assert.equal(quarantineDry.quarantined_count, 3);
  assert.equal(quarantineDry.unsynced_count, 1);
  assert.deepEqual(
    quarantineDry.records.map((record) => record.local_id),
    [ordinaryId]
  );
  const afterQuarantine = await cli(
    [
      "agent-start",
      "--project-dir",
      projectPath,
      "--external-session-id",
      "after-local-quarantine",
      "--format",
      "json"
    ],
    remoteEnv
  );
  assert.equal(afterQuarantine.spool_replay.synced_count, 1);
  assert.equal(afterQuarantine.spool_replay.quarantined_count, 3);
  assert.equal((await db.getSessionCheckpoint(afterQuarantine.session_id)).payload, null);
  assert.equal(await readFile(legacyPath, "utf8"), unknownLegacy);
  const heldStatus = await cli(
    ["spool-status", "--project-dir", projectPath, "--format", "json"],
    remoteEnv
  );
  assert.equal(heldStatus.status, "quarantined");
  assert.equal(heldStatus.quarantined_count, 3);
  assert.equal(heldStatus.unsynced_count, 0);
  const heldManifest = JSON.parse(
    await readFile(join(projectPath, ".recallant/spool/sync-manifest.json"), "utf8")
  );
  for (const id of quarantineIds) assert.equal(heldManifest.synced[id], undefined);
  assert.ok(heldManifest.synced[ordinaryId].server_event_id);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS count FROM sessions WHERE project_id=$1 AND external_session_id_hash=$2",
        [projectId, createHash("sha256").update(quarantineExternal).digest("hex")]
      )
    ).rows[0].count,
    0
  );
  assert.equal(await readFile(queuePath, "utf8"), preservedQueue);
  const heldAgain = await cli(["sync-spool", "--project-dir", projectPath], remoteEnv);
  assert.equal(heldAgain.synced_count, 0);
  assert.equal(heldAgain.quarantined_count, 3);
  assert.equal(await readFile(queuePath, "utf8"), preservedQueue);
  results.push({
    path: "local_quarantine",
    no_upload_and_no_false_sync: "PASS",
    other_records_and_legacy_state_preserved: "PASS"
  });

  await stopServer();
  const offlineCheckpointId = "new-offline-checkpoint";
  for (const focus of ["first offline checkpoint", "latest offline checkpoint"]) {
    const saved = await cli(
      ["agent-checkpoint", "--project-dir", projectPath,
        "--external-session-id", offlineCheckpointId, "--focus", focus,
        "--next-step", "Resume the same chat", "--format", "json"],
      remoteEnv
    );
    assert.equal(saved.mode, "offline_spool");
  }
  await listen();
  const checkpointReplay = await cli(["sync-spool", "--project-dir", projectPath], remoteEnv);
  assert.equal(checkpointReplay.remaining_count, 0);
  const checkpointResume = await rpc("memory_start_session", {
    client_kind: "codex", external_session_id: offlineCheckpointId
  });
  assert.equal(
    (await db.getSessionCheckpoint(checkpointResume.session_id)).payload.current_focus,
    "latest offline checkpoint"
  );
  assert.equal(
    (await db.getSessionCheckpoint(checkpointResume.session_id)).payload.next_step,
    "Resume the same chat"
  );
  assert.deepEqual(await db.getSessionCheckpoint(replayStart.session_id), replayCheckpoint);
  results.push({ path: "first_and_repeated_offline_checkpoint", replay_and_isolation: "PASS" });

  if (!replayOnly) {
    await client.query(
      "UPDATE sessions SET last_seen_at = now() - interval '9 hours' WHERE id=$1",
      [replayStart.session_id]
    );
    const invalid = await cli(
      [
        "agent-start",
        "--project-dir",
        projectPath,
        "--external-session-id",
        "remote-invalid-recovery",
        "--recover-session-id",
        replayStart.session_id,
        "--format",
        "json"
      ],
      remoteEnv,
      undefined,
      /Remote MCP returned a JSON-RPC error/
    );
    assert.notEqual(invalid.session_id, replayStart.session_id);
    const invalidState = JSON.parse(await readFile(invalid.state_path, "utf8"));
    assert.equal(invalidState.last_checkpoint_at ?? null, null);
    const pending = (await readFile(invalid.spool_path, "utf8")).trim().split("\n").map(JSON.parse);
    const failedStart = pending.find(
      (record) =>
        record.payload?.tool_name === "memory_start_session" &&
        record.payload.arguments?.external_session_id === "remote-invalid-recovery"
    );
    assert.ok(failedStart);
    assert.equal(failedStart.payload.arguments.recover_session_id, replayStart.session_id);
    assert.deepEqual(await db.getSessionCheckpoint(replayStart.session_id), replayCheckpoint);
    results.push({ path: "remote_cli_invalid_explicit_recovery", safe_offline_diagnostic: "PASS" });
  }
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", target: "disposable PostgreSQL and real loopback HTTP server", duration_ms: Math.round(performance.now() - started), results }, null, 2)}\n`
  );
} finally {
  await closeMcp();
  await stopServer();
  await db.close();
  await client.end().catch(() => undefined);
  await rm(projectPath, { recursive: true, force: true });
  await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
