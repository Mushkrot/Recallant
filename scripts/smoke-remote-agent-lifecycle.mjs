import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
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
const projectId = randomUUID();
const developerId = randomUUID();
const sessionId = randomUUID();
const contextPackId = randomUUID();
const eventId = randomUUID();
const memoryId = randomUUID();
const closeoutEventId = randomUUID();
const credential = "remote-agent-lifecycle-fixture-credential";
const requests = [];
let failNextEvent = false;
let failNextContext = false;
let failNextStart = false;

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
      session_id: sessionId,
      project_id: projectId,
      checkpoint: { payload: null, updated_at: null },
      previous_unclosed_session: null,
      previous_session_recovery: { status: "none" },
      recommended_next_calls: ["memory_get_context_pack"]
    };
  }
  if (name === "memory_get_context_pack") {
    assert(args.session_id === sessionId, "context pack used the wrong remote session");
    return {
      context_pack_id: contextPackId,
      project_id: projectId,
      session_id: sessionId,
      sections: { checkpoint: {}, working_memories: [] },
      truncated: false,
      budget: { max_chars_total: 12_000, used_chars_estimate: 0 }
    };
  }
  if (name === "memory_append_event") {
    assert(args.session_id === sessionId, "event used the wrong remote session");
    return { event_id: eventId, status: "created" };
  }
  if (name === "memory_create_agent_memory") {
    return { memory_id: memoryId, status: "accepted" };
  }
  if (name === "memory_closeout") {
    assert(args.session_id === sessionId, "closeout used the wrong remote session");
    return {
      ok: true,
      session_id: sessionId,
      checkpoint_updated_at: "2026-09-03T00:00:00.000Z",
      created_memory_ids: [],
      needs_review_ids: [],
      spool_sync_status: "synced",
      report_required: false,
      warnings: [],
      lifecycle: {
        mode: "server",
        project_id: projectId,
        session_id: sessionId,
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
    requests.push({
      method: body.method,
      tool: body.params?.name ?? null,
      authorization_present: Boolean(request.headers.authorization)
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
  } catch (error) {
    response.statusCode = 500;
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
      })
    );
  }
});

function cli(args) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: "postgres://127.0.0.1:1/should-not-be-used",
      RECALLANT_ENV_FILE: join(projectDir, "missing.env"),
      RECALLANT_PROJECT_PATH: ""
    },
    maxBuffer: 8 * 1024 * 1024
  }).then(({ stdout }) => JSON.parse(stdout));
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
  const contextReplay = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    contextReplay.transport === "remote_mcp" && contextReplay.synced_count === 1,
    "deferred remote context load was not replayed"
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

  const synced = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(synced.transport === "remote_mcp", "spool replay used local PostgreSQL");
  assert(synced.synced_count === 1, "remote spool replay did not deliver the pending event");

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
              next_step: "continue"
            }
          },
          raw_artifacts: []
        }
      }
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n"
  );
  const legacySynced = await cli(["sync-spool", "--project-dir", projectDir]);
  assert(
    legacySynced.transport === "remote_mcp" && legacySynced.synced_count === 2,
    "legacy event and closeout spool records were not replayed through remote MCP"
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
}
