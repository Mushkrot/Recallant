import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createRecallantTools } from "../packages/mcp/dist/tools.js";
import { assertRemoteMcpBodyIsAllowed } from "../apps/server/dist/index.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("apps/cli/dist/index.js");
const projectDir = await mkdtemp(join(tmpdir(), "recallant-remote-agent-lifecycle-"));
let secondaryProjectDir = null;
const projectId = randomUUID();
const developerId = randomUUID();
const sessionId = randomUUID();
const secondarySessionId = randomUUID();
const contextPackId = randomUUID();
const eventId = randomUUID();
const memoryId = randomUUID();
const closeoutEventId = randomUUID();
const credential = "remote-agent-lifecycle-fixture-credential";
const requests = [];
const durableEventDedupKeys = new Set();
let failNextEvent = false;
let failNextContext = false;
let failNextStart = false;
let failCloseoutReference = false;
let delayNextEventMs = 0;
let dropNextEventResponse = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function toolPayload(body) {
  const name = body.params?.name;
  const args = body.params?.arguments ?? {};
  if (name === "memory_get_readiness_status") {
    return {
      readiness_status: "context_ready",
      readiness_contract: {
        configured: true,
        remote_mcp_ready: true,
        context_ready: true,
        semantic_memory_ready: false,
        memory_loop_ready: false,
        capture_active: false,
        ingestion_approved: false,
        primary_state: "context_ready",
        evidence: { last_semantic_recall_proof_at: null }
      }
    };
  }
  if (name === "memory_start_session") {
    const startSchema = createRecallantTools().find((tool) => tool.name === name).inputSchema;
    const parsed = startSchema.safeParse(args);
    assert(
      parsed.success,
      `remote session start violates the actual MCP schema: ${parsed.error?.message ?? ""}`
    );
    return {
      session_id:
        args.session_label === "second-independent-session" ? secondarySessionId : sessionId,
      project_id: projectId,
      checkpoint: { payload: null, updated_at: null },
      previous_unclosed_session: null,
      previous_session_recovery: { status: "none" },
      recommended_next_calls: ["memory_get_context_pack"]
    };
  }
  if (name === "memory_get_context_pack") {
    assert(
      args.session_id === sessionId || args.session_id === secondarySessionId,
      "context pack used the wrong remote session"
    );
    return {
      context_pack_id: contextPackId,
      project_id: projectId,
      session_id: args.session_id === secondarySessionId ? secondarySessionId : sessionId,
      sections: { checkpoint: {}, working_memories: [] },
      truncated: false,
      budget: { max_chars_total: 12_000, used_chars_estimate: 0 }
    };
  }
  if (name === "memory_append_event") {
    assert(
      args.session_id === sessionId || args.session_id === secondarySessionId,
      "event used the wrong remote session"
    );
    const dedupKey = typeof args.dedup_key === "string" ? args.dedup_key : null;
    const duplicate = dedupKey !== null && durableEventDedupKeys.has(dedupKey);
    if (dedupKey) durableEventDedupKeys.add(dedupKey);
    return { event_id: eventId, status: duplicate ? "duplicate" : "created" };
  }
  if (name === "memory_create_agent_memory") {
    return { memory_id: memoryId, status: "accepted" };
  }
  if (name === "memory_closeout") {
    assert(
      args.session_id === sessionId || args.session_id === secondarySessionId,
      "closeout used the wrong remote session"
    );
    return {
      ok: true,
      session_id: args.session_id,
      checkpoint_updated_at: "2026-09-03T00:00:00.000Z",
      created_memory_ids: [],
      needs_review_ids: [],
      spool_sync_status: "synced",
      report_required: false,
      warnings: [],
      lifecycle: {
        mode: "server",
        project_id: projectId,
        session_id: args.session_id,
        closeout_event_id: closeoutEventId,
        spool_sync_status: "synced",
        next_agent_ready: true,
        report_required: false,
        failure_reasons: [],
        warnings: [],
        proof: {}
      },
      project_log_update: { status: "disabled", reason: "project_log_sync_disabled" }
    };
  }
  throw new Error(`unexpected tool ${name}`);
}

const server = createServer(async (request, response) => {
  try {
    const body = JSON.parse(await readBody(request));
    const args = body.params?.arguments ?? {};
    requests.push({
      method: body.method,
      tool: body.params?.name ?? null,
      event_text: body.params?.name === "memory_append_event" ? (args.text ?? null) : null,
      event_dedup_key:
        body.params?.name === "memory_append_event" ? (args.dedup_key ?? null) : null,
      authorization_present: Boolean(request.headers.authorization),
      closeout_last_event_id_present:
        body.params?.name === "memory_closeout" && args.checkpoint_payload?.last_event_id != null,
      closeout_replay_sanitized:
        body.params?.name === "memory_closeout"
          ? (args.closeout_diagnostics?.replay_sanitization?.last_event_id ?? null)
          : null
    });
    response.setHeader("content-type", "application/json");
    if (request.url !== "/api/mcp" || request.method !== "POST") {
      response.statusCode = 404;
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601 } }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${credential}`) {
      response.statusCode = 401;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32001, message: "INVALID_SCOPE_TOKEN" }
        })
      );
      return;
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_start_session" &&
      failNextStart
    ) {
      failNextStart = false;
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32053, message: "temporary start transport failure" }
        })
      );
      return;
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_append_event" &&
      failNextEvent
    ) {
      failNextEvent = false;
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32053, message: "temporary transport failure" }
        })
      );
      return;
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_append_event" &&
      dropNextEventResponse
    ) {
      dropNextEventResponse = false;
      assertRemoteMcpBodyIsAllowed(body);
      toolPayload(body);
      response.destroy();
      return;
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_append_event" &&
      delayNextEventMs
    ) {
      const delay = delayNextEventMs;
      delayNextEventMs = 0;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_get_context_pack" &&
      failNextContext
    ) {
      failNextContext = false;
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32053, message: "temporary context transport failure" }
        })
      );
      return;
    }
    if (
      body.method === "tools/call" &&
      body.params?.name === "memory_closeout" &&
      failCloseoutReference &&
      args.checkpoint_payload?.last_event_id
    ) {
      failCloseoutReference = false;
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32600, message: "invalid event reference" }
        })
      );
      return;
    }
    if (body.method === "tools/call") {
      assertRemoteMcpBodyIsAllowed(body);
      const payload = toolPayload(body);
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
        })
      );
      return;
    }
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "remote-agent-lifecycle-fixture", version: "0.0.0" }
              }
            : { tools: [] }
      })
    );
  } catch {
    response.statusCode = 500;
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "fixture request failed" }
      })
    );
  }
});

function cli(args, cwd = projectDir) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: "postgres://127.0.0.1:1/should-not-be-used",
      RECALLANT_ENV_FILE: join(projectDir, "missing.env"),
      RECALLANT_PROJECT_PATH: ""
    },
    maxBuffer: 8 * 1024 * 1024
  }).then(({ stdout }) => JSON.parse(stdout));
}

function cliAttempt(args) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: "postgres://127.0.0.1:1/should-not-be-used",
      RECALLANT_ENV_FILE: join(projectDir, "missing.env"),
      RECALLANT_PROJECT_PATH: ""
    },
    maxBuffer: 8 * 1024 * 1024
  }).then(
    ({ stdout }) => ({ exit_code: 0, result: JSON.parse(stdout) }),
    (error) => ({
      exit_code: Number(error.code ?? 1),
      result: JSON.parse(String(error.stdout ?? "{}"))
    })
  );
}

try {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert(address && typeof address === "object", "fixture did not bind a port");
  const serverUrl = `http://127.0.0.1:${address.port}`;
  await mkdir(join(projectDir, ".codex"), { recursive: true });
  await writeFile(
    join(projectDir, ".codex", "config.toml"),
    [
      "[mcp_servers.recallant]",
      'command = "recallant"',
      'args = ["remote-bridge"]',
      `env = { RECALLANT_REMOTE_MCP_URL = "${serverUrl}", RECALLANT_PROJECT_ID = "${projectId}", RECALLANT_DEVELOPER_ID = "${developerId}", RECALLANT_REMOTE_MCP_CLIENT_ID = "remote-agent-lifecycle", RECALLANT_REMOTE_MCP_CREDENTIAL = "${credential}" }`,
      ""
    ].join("\n")
  );

  failNextStart = true;
  const deferredEventStart = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event that must survive a remote start failure"
  ]);
  assert(
    deferredEventStart.mode === "offline_spool",
    "event was not spooled after remote start failure"
  );
  const replayRequestStart = requests.length;
  const startReplay = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    startReplay.transport === "remote_mcp" && startReplay.synced_count === 3,
    "deferred remote start, context load, and event were not replayed together"
  );
  const replayedStartState = JSON.parse(
    await readFile(join(projectDir, ".recallant", "current-session.json"), "utf8")
  );
  assert(
    replayedStartState.session_id === sessionId &&
      replayedStartState.context_pack_id === contextPackId,
    "replayed remote startup did not persist session/context identity"
  );
  assert(
    JSON.stringify(requests.slice(replayRequestStart).map((request) => request.tool)) ===
      JSON.stringify(["memory_start_session", "memory_get_context_pack", "memory_append_event"]),
    "remote spool replay changed the original startup/context/event ordering"
  );

  failNextContext = true;
  const deferredContext = await cli([
    "agent-start",
    "--project-dir",
    projectDir,
    "--task-hint",
    "context failure regression",
    "--format",
    "json"
  ]);
  assert(deferredContext.mode === "offline_spool", "failed context load was not spooled");
  assert(
    deferredContext.session_id === sessionId,
    "successful remote session id was lost after context failure"
  );
  const contextReplay = await cli([
    "agent-start",
    "--project-dir",
    projectDir,
    "--task-hint",
    "automatic startup replay regression",
    "--format",
    "json"
  ]);
  assert(
    contextReplay.mode === "remote_mcp_ready" &&
      contextReplay.spool_replay?.trigger === "startup" &&
      contextReplay.spool_replay?.synced_count === 1 &&
      contextReplay.spool_replay?.remaining_count === 0,
    "deferred remote context load was not replayed automatically at startup"
  );

  const started = await cli([
    "agent-start",
    "--project-dir",
    projectDir,
    "--task-hint",
    "remote lifecycle regression",
    "--format",
    "json"
  ]);
  assert(
    started.mode === "remote_mcp_ready" && started.transport === "remote_mcp",
    `remote start did not execute MCP: ${JSON.stringify(started)}`
  );
  assert(started.session_id === sessionId, "remote start did not return the remote session id");
  assert(started.context_pack_id === contextPackId, "remote start did not read the context pack");

  failNextEvent = true;
  const spooled = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event that must survive a temporary remote failure"
  ]);
  assert(spooled.mode === "offline_spool", "temporary remote failure did not spool");
  assert(
    spooled.remote_failure?.code === "REMOTE_MCP_JSON_RPC_ERROR",
    "remote failure was not classified"
  );

  const autoReplayed = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event that triggers automatic replay"
  ]);
  assert(
    autoReplayed.mode === "remote_mcp" &&
      autoReplayed.spool_replay?.trigger === "next_event" &&
      autoReplayed.spool_replay?.synced_count === 1 &&
      autoReplayed.spool_replay?.remaining_count === 0,
    "pending event was not replayed automatically before the next event"
  );
  const synced = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    synced.transport === "remote_mcp" && synced.synced_count === 0,
    "manual replay found records after automatic replay"
  );

  failNextEvent = true;
  const concurrentSpooled = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event for concurrent replay protection"
  ]);
  assert(concurrentSpooled.mode === "offline_spool", "concurrent replay fixture was not spooled");
  delayNextEventMs = 150;
  const concurrentAttempts = await Promise.all([
    cliAttempt(["sync-spool", "--project-dir", projectDir]),
    cliAttempt(["sync-spool", "--project-dir", projectDir])
  ]);
  assert(
    concurrentAttempts.some(
      (attempt) => attempt.exit_code === 0 && attempt.result.synced_count === 1
    ),
    `concurrent replay did not deliver the pending event: ${JSON.stringify(concurrentAttempts)}`
  );
  assert(
    concurrentAttempts.some(
      (attempt) =>
        attempt.exit_code !== 0 &&
        attempt.result.remote_failure?.code === "REMOTE_MCP_SYNC_IN_PROGRESS"
    ),
    `concurrent replay was not serialized: ${JSON.stringify(concurrentAttempts)}`
  );
  const afterConcurrent = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    afterConcurrent.transport === "remote_mcp" && afterConcurrent.synced_count === 0,
    "concurrent replay left a pending record"
  );

  const lostAckText = "event whose remote acknowledgement is lost";
  dropNextEventResponse = true;
  const lostAck = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    lostAckText
  ]);
  assert(
    lostAck.mode === "offline_spool" && lostAck.remote_failure?.retryable === true,
    "lost acknowledgement was not retained for retry"
  );
  const afterLostAck = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event after lost acknowledgement"
  ]);
  assert(
    afterLostAck.mode === "remote_mcp" &&
      afterLostAck.spool_replay?.trigger === "next_event" &&
      afterLostAck.spool_replay?.synced_count === 1 &&
      afterLostAck.spool_replay?.remaining_count === 0,
    "lost acknowledgement was not replayed automatically"
  );
  const lostAckRequests = requests.filter(
    (request) => request.tool === "memory_append_event" && request.event_text === lostAckText
  );
  assert(
    lostAckRequests.length === 2 &&
      lostAckRequests[0].event_dedup_key &&
      lostAckRequests[0].event_dedup_key === lostAckRequests[1].event_dedup_key &&
      durableEventDedupKeys.has(lostAckRequests[0].event_dedup_key),
    "lost acknowledgement replay did not preserve deduplication"
  );

  failNextEvent = true;
  const disconnectedReplay = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event for interrupted replay"
  ]);
  assert(disconnectedReplay.mode === "offline_spool", "disconnect replay fixture was not spooled");
  dropNextEventResponse = true;
  const interrupted = await cliAttempt(["sync-spool", "--project-dir", projectDir]);
  assert(
    interrupted.exit_code !== 0 &&
      interrupted.result.ok === false &&
      interrupted.result.remaining_count === 1 &&
      interrupted.result.remote_failure?.code === "REMOTE_MCP_NETWORK_ERROR",
    `in-flight disconnect did not leave replay pending: ${JSON.stringify(interrupted)}`
  );
  const lockWasReleased = await readFile(join(projectDir, ".recallant", "spool", "sync.lock")).then(
    () => false,
    () => true
  );
  assert(lockWasReleased, "in-flight disconnect left the spool replay lock behind");
  const recoveredAfterDisconnect = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    recoveredAfterDisconnect.transport === "remote_mcp" &&
      recoveredAfterDisconnect.synced_count === 1 &&
      recoveredAfterDisconnect.remaining_count === 0,
    "replay did not recover after an in-flight disconnect"
  );

  failNextEvent = true;
  const sigtermSpooled = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "action",
    "--text",
    "event for SIGTERM replay cleanup"
  ]);
  assert(sigtermSpooled.mode === "offline_spool", "SIGTERM replay fixture was not spooled");
  delayNextEventMs = 1_000;
  const terminatedReplay = spawn(
    process.execPath,
    [cliPath, "sync-spool", "--project-dir", projectDir],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: "postgres://127.0.0.1:1/should-not-be-used",
        RECALLANT_ENV_FILE: join(projectDir, "missing.env"),
        RECALLANT_PROJECT_PATH: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  terminatedReplay.stdout.resume();
  terminatedReplay.stderr.resume();
  let sigtermLockSeen = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    sigtermLockSeen = await readFile(join(projectDir, ".recallant", "spool", "sync.lock")).then(
      () => true,
      () => false
    );
    if (sigtermLockSeen) break;
    await new Promise((resolveReady) => setTimeout(resolveReady, 25));
  }
  assert(sigtermLockSeen, "SIGTERM replay did not acquire the spool lock before termination");
  terminatedReplay.kill("SIGTERM");
  const [terminatedCode, terminatedSignal] = await new Promise((resolveExit) =>
    terminatedReplay.once("exit", (code, signal) => resolveExit([code, signal]))
  );
  assert(
    terminatedCode === 143 && terminatedSignal === null,
    `SIGTERM replay did not exit cleanly: ${terminatedCode}/${terminatedSignal}`
  );
  const sigtermLockWasReleased = await readFile(
    join(projectDir, ".recallant", "spool", "sync.lock")
  ).then(
    () => false,
    () => true
  );
  assert(sigtermLockWasReleased, "SIGTERM replay left the spool lock behind");
  delayNextEventMs = 0;
  const recoveredAfterSigterm = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    recoveredAfterSigterm.transport === "remote_mcp" &&
      recoveredAfterSigterm.synced_count === 1 &&
      recoveredAfterSigterm.remaining_count === 0,
    "replay did not recover after SIGTERM"
  );

  const legacyLocalId = randomUUID();
  const legacyCloseoutLocalId = randomUUID();
  await appendFile(
    join(projectDir, ".recallant", "spool", "spool.jsonl"),
    [
      {
        local_id: legacyLocalId,
        created_at: "2026-09-03T00:00:00.000Z",
        record_kind: "event",
        dedup_key: `legacy-${legacyLocalId}`,
        payload: {
          session_id: `local-${randomUUID()}`,
          client_kind: "codex",
          event_kind: "other",
          text: "legacy remote event waiting in the old spool format",
          metadata: { capture_kind: "agent_action" },
          raw_artifacts: [],
          dedup_key: `legacy-${legacyLocalId}`
        }
      },
      {
        local_id: legacyCloseoutLocalId,
        created_at: "2026-09-03T00:00:01.000Z",
        record_kind: "event",
        dedup_key: `legacy-${legacyCloseoutLocalId}`,
        payload: {
          session_id: `local-${randomUUID()}`,
          client_kind: "codex",
          event_kind: "system",
          text: "legacy closeout",
          metadata: {
            capture_kind: "agent_closeout",
            checkpoint_payload: {
              status: "closed",
              current_focus: "legacy remote closeout",
              next_step: "continue",
              last_event_id: randomUUID()
            }
          },
          raw_artifacts: []
        }
      }
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n"
  );
  failCloseoutReference = true;
  const legacySynced = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    legacySynced.transport === "remote_mcp" && legacySynced.synced_count === 2,
    "legacy event and sanitized closeout spool records were not replayed through remote MCP"
  );
  const legacyCloseoutRequests = requests.filter((request) => request.tool === "memory_closeout");
  assert(
    legacyCloseoutRequests.some((request) => request.closeout_last_event_id_present) &&
      legacyCloseoutRequests.some(
        (request) =>
          !request.closeout_last_event_id_present &&
          request.closeout_replay_sanitized === "cleared_after_remote_validation"
      ),
    "closeout replay did not retry with the invalid event reference removed"
  );

  const decision = await cli([
    "agent-event",
    "--project-dir",
    projectDir,
    "--kind",
    "decision",
    "--text",
    "remote lifecycle decision"
  ]);
  assert(decision.mode === "remote_mcp" && decision.event_id, "remote event was not delivered");
  assert(decision.memory?.memory_id === memoryId, "remote decision memory was not created");

  const closeout = await cli([
    "agent-closeout",
    "--project-dir",
    projectDir,
    "--summary",
    "remote lifecycle complete"
  ]);
  assert(closeout.mode === "remote_mcp", "remote closeout used local PostgreSQL");
  assert(closeout.lifecycle?.next_agent_ready === true, "remote closeout result was not returned");

  const state = JSON.parse(
    await readFile(join(projectDir, ".recallant", "current-session.json"), "utf8")
  );
  assert(
    state.status === "closed" && state.session_id === sessionId,
    "remote session state was not closed"
  );
  assert(
    requests.some((request) => request.tool === "memory_start_session") &&
      requests.some((request) => request.tool === "memory_get_context_pack") &&
      requests.some((request) => request.tool === "memory_append_event") &&
      requests.some((request) => request.tool === "memory_closeout"),
    `remote lifecycle calls were incomplete: ${JSON.stringify(requests)}`
  );

  secondaryProjectDir = await mkdtemp(join(tmpdir(), "recallant-remote-agent-lifecycle-second-"));
  await mkdir(join(secondaryProjectDir, ".codex"), { recursive: true });
  await writeFile(
    join(secondaryProjectDir, ".codex", "config.toml"),
    [
      "[mcp_servers.recallant]",
      'command = "recallant"',
      'args = ["remote-bridge"]',
      `env = { RECALLANT_REMOTE_MCP_URL = "${serverUrl}", RECALLANT_PROJECT_ID = "${projectId}", RECALLANT_DEVELOPER_ID = "${developerId}", RECALLANT_REMOTE_MCP_CLIENT_ID = "remote-agent-lifecycle-second", RECALLANT_REMOTE_MCP_CREDENTIAL = "${credential}" }`,
      ""
    ].join("\n")
  );
  const secondStarted = await cli(
    [
      "agent-start",
      "--project-dir",
      secondaryProjectDir,
      "--session-label",
      "second-independent-session",
      "--task-hint",
      "second session isolation regression",
      "--format",
      "json"
    ],
    secondaryProjectDir
  );
  assert(
    secondStarted.mode === "remote_mcp_ready" && secondStarted.session_id === secondarySessionId,
    `second independent session was not created: ${JSON.stringify(secondStarted)}`
  );
  const secondEvent = await cli(
    [
      "agent-event",
      "--project-dir",
      secondaryProjectDir,
      "--kind",
      "action",
      "--text",
      "second session event"
    ],
    secondaryProjectDir
  );
  assert(
    secondEvent.mode === "remote_mcp" && secondEvent.session_id === secondarySessionId,
    `second session event used the wrong identity: ${JSON.stringify(secondEvent)}`
  );
  const secondCloseout = await cli(
    [
      "agent-closeout",
      "--project-dir",
      secondaryProjectDir,
      "--summary",
      "second session complete"
    ],
    secondaryProjectDir
  );
  assert(
    secondCloseout.mode === "remote_mcp" && secondCloseout.session_id === secondarySessionId,
    `second session closeout used the wrong identity: ${JSON.stringify(secondCloseout)}`
  );
  const secondState = JSON.parse(
    await readFile(join(secondaryProjectDir, ".recallant", "current-session.json"), "utf8")
  );
  assert(
    secondState.status === "closed" && secondState.session_id === secondarySessionId,
    "second session state was mixed with the first session"
  );

  const artifactLocalId = randomUUID();
  const eventCallsBeforeArtifact = requests.filter(
    (request) => request.tool === "memory_append_event"
  ).length;
  await appendFile(
    join(projectDir, ".recallant", "spool", "spool.jsonl"),
    `${JSON.stringify({
      local_id: artifactLocalId,
      record_kind: "event",
      dedup_key: `artifact-${artifactLocalId}`,
      payload: {
        session_id: sessionId,
        client_kind: "codex",
        event_kind: "other",
        text: "artifact retention fixture",
        raw_artifacts: [
          { artifact_kind: "other", storage_backend: "local_spool", uri: "fixture-only" }
        ]
      }
    })}\n`
  );
  const artifactAttempt = await cli(["sync-spool", "--project-dir", projectDir]).then(
    (result) => ({ result, failed: false }),
    (error) => ({ result: JSON.parse(error.stdout), failed: true })
  );
  assert(artifactAttempt.failed, "nonempty artifacts must remain local");
  assert(
    artifactAttempt.result.remaining_count === 1 && artifactAttempt.result.synced_count === 0,
    "artifact record was dropped or marked as synced"
  );
  assert(
    requests.filter((request) => request.tool === "memory_append_event").length ===
      eventCallsBeforeArtifact,
    "artifact payload reached the remote event endpoint"
  );
  const retainedManifest = JSON.parse(
    await readFile(join(projectDir, ".recallant", "spool", "sync-manifest.json"), "utf8")
  );
  assert(!retainedManifest.synced[artifactLocalId], "artifact record must remain pending");

  const output = {
    remote_agent_lifecycle_smoke: "passed",
    remote_start_and_context: "passed",
    event_start_failure_replay: "passed",
    partial_start_context_replay: "passed",
    remote_event_and_decision_memory: "passed",
    transport_failure_classification: "passed",
    remote_spool_replay: "passed",
    legacy_spool_compatibility: "passed",
    remote_closeout_result_delivery: "passed",
    local_postgres_used: false
  };
  const serialized = JSON.stringify(output, null, 2);
  assert(!serialized.includes(credential), "smoke output leaked the fixture credential");
  process.stdout.write(`${serialized}\n`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(projectDir, { recursive: true, force: true });
  if (secondaryProjectDir) await rm(secondaryProjectDir, { recursive: true, force: true });
}
