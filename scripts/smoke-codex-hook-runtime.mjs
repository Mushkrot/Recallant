import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

import pg from "pg";

import { RecallantDb } from "../packages/db/dist/index.js";
import { smokeDatabaseUrl, smokeEnvironment } from "./smoke-database-env.mjs";

const cliPath = resolve("apps/cli/dist/index.js");

const databaseUrl = smokeDatabaseUrl();

const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = `/tmp/recallant-codex-hook-${randomUUID()}`;
const offlineDir = `${projectDir}-offline`;
const remoteOnlyDir = `${projectDir}-remote-only`;
const smokeHome = `${projectDir}-home`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath: projectDir });
const client = new pg.Client({ connectionString: databaseUrl });
const fakeSecret = `sk-codex-hook-${randomUUID().replaceAll("-", "")}`;

const onlineEnv = smokeEnvironment({
  HOME: smokeHome,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: projectDir,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
});

function runHook(projectPath, payload, env = onlineEnv) {
  const startedAt = Date.now();
  const debug = process.env.RECALLANT_CODEX_HOOK_SMOKE_DEBUG === "1";
  const result = spawnSync(
    process.execPath,
    [cliPath, "codex-hook", ...(debug ? ["--debug"] : [])],
    {
      cwd: projectPath,
      env,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 10_000
    }
  );
  assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
  assert.equal(result.signal, null, `hook timed out: ${result.error?.message ?? ""}`);
  assert.equal(result.stdout, "", `hook wrote to stdout: ${result.stdout}`);
  if (!debug) assert.equal(result.stderr, "", `hook wrote to stderr: ${result.stderr}`);
  else if (result.stderr) process.stderr.write(result.stderr);
  return Date.now() - startedAt;
}

function sessionStatePath(projectPath, externalSessionId) {
  const hash = createHash("sha256").update(externalSessionId).digest("hex");
  return `${projectPath}/.recallant/sessions/${hash}.json`;
}

function runCli(args, env = onlineEnv) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.equal(result.signal, null, `CLI timed out: ${result.error?.message ?? ""}`);
  return JSON.parse(result.stdout);
}

async function withMcpClient(work) {
  const child = spawn(process.execPath, [cliPath, "mcp-server"], {
    cwd: projectDir,
    env: onlineEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const responses = new Map();
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined) responses.set(message.id, message);
  });
  let nextId = 1;
  const callRpc = async (method, params = {}) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (responses.has(id)) {
        const response = responses.get(id);
        if (response.error) throw new Error(JSON.stringify(response.error));
        return response.result;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Timed out waiting for MCP response ${method}: ${stderr}`);
  };
  try {
    await callRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "checkpoint-isolation-smoke", version: "1" }
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`
    );
    const callTool = async (name, args) => {
      const result = await callRpc("tools/call", { name, arguments: args });
      const body = result.content?.[0]?.text;
      assert.ok(body, `MCP ${name} returned no text result`);
      return JSON.parse(body);
    };
    await work(callTool);
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) return resolveExit();
      child.once("exit", resolveExit);
      setTimeout(() => child.kill("SIGTERM"), 2_000).unref();
    });
    lines.close();
  }
}

function common(eventName, turnId = "turn-1") {
  return {
    session_id: "external-codex-session",
    cwd: projectDir,
    hook_event_name: eventName,
    model: "gpt-5",
    turn_id: turnId,
    transcript_path: `/tmp/transcript-${fakeSecret}.jsonl`
  };
}

await rm(projectDir, { recursive: true, force: true });
await rm(offlineDir, { recursive: true, force: true });
await rm(remoteOnlyDir, { recursive: true, force: true });
await rm(smokeHome, { recursive: true, force: true });
await mkdir(`${projectDir}/.recallant`, { recursive: true });
await mkdir(`${offlineDir}/.recallant`, { recursive: true });
await mkdir(`${remoteOnlyDir}/.recallant`, { recursive: true });
await mkdir(smokeHome, { recursive: true });
await client.connect();

try {
  const project = await db.ensureProject();
  await writeFile(
    `${projectDir}/.recallant/config`,
    `${JSON.stringify(
      { project_id: project.projectId, recallant_server_url: "http://127.0.0.1:3005" },
      null,
      2
    )}\n`
  );

  await db.setCheckpoint(project.projectId, {
    source: "owner-reviewed-project-checkpoint",
    next_step: "Keep project-wide guidance unchanged during Codex compaction."
  });

  await withMcpClient(async (callTool) => {
    const mcpA = await callTool("memory_start_session", {
      client_kind: "codex",
      client_version: "smoke",
      project_path: projectDir,
      external_session_id: "mcp-chat-A"
    });
    const mcpB = await callTool("memory_start_session", {
      client_kind: "codex",
      client_version: "smoke",
      project_path: projectDir,
      external_session_id: "mcp-chat-B"
    });
    assert.notEqual(mcpA.session_id, mcpB.session_id);
    const emptyB = await callTool("memory_get_context_pack", {
      session_id: mcpB.session_id,
      task_hint: "new chat has no inherited checkpoint"
    });
    assert.equal(emptyB.sections.checkpoint.payload.current_focus, "not_recorded");
    assert.equal(emptyB.sections.checkpoint.legacy_project_checkpoint.payload_included, false);

    const payloadA = {
      current_status: "in_progress",
      current_focus: "MCP chat A",
      next_step: "Resume MCP chat A"
    };
    const payloadB = {
      current_status: "in_progress",
      current_focus: "MCP chat B",
      next_step: "Resume MCP chat B"
    };
    await callTool("memory_set_checkpoint", { session_id: mcpA.session_id, payload: payloadA });
    await callTool("memory_set_checkpoint", { session_id: mcpB.session_id, payload: payloadB });
    const resumedA = await callTool("memory_start_session", {
      client_kind: "codex",
      client_version: "smoke",
      project_path: projectDir,
      external_session_id: "mcp-chat-A"
    });
    assert.equal(resumedA.session_id, mcpA.session_id);
    const contextA = await callTool("memory_get_context_pack", {
      session_id: mcpA.session_id,
      task_hint: "MCP chat A resume"
    });
    const contextB = await callTool("memory_get_context_pack", {
      session_id: mcpB.session_id,
      task_hint: "MCP chat B resume"
    });
    assert.equal(contextA.sections.checkpoint.payload.current_focus, payloadA.current_focus);
    assert.equal(contextB.sections.checkpoint.payload.current_focus, payloadB.current_focus);
  });

  const payloads = [
    { ...common("SessionStart", null), source: "startup" },
    {
      ...common("UserPromptSubmit"),
      prompt: `Inspect the failure; api_key=${fakeSecret}`
    },
    {
      ...common("PreToolUse"),
      tool_name: "Bash",
      tool_use_id: "tool-success",
      tool_input: { command: "npm test", password: fakeSecret }
    },
    {
      ...common("PostToolUse"),
      tool_name: "Bash",
      tool_use_id: "tool-success",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 0, output: "tests passed" }
    },
    {
      ...common("PreToolUse"),
      tool_name: "Bash",
      tool_use_id: "tool-failure",
      tool_input: { command: "exit 9" }
    },
    {
      ...common("PostToolUse"),
      tool_name: "Bash",
      tool_use_id: "tool-failure",
      tool_input: { command: "exit 9" },
      tool_response: { exit_code: 9, output: `Bearer ${fakeSecret}` }
    },
    { ...common("PreCompact"), trigger: "auto" },
    { ...common("PostCompact"), trigger: "auto" },
    {
      ...common("SubagentStart"),
      agent_id: "child-1",
      agent_type: "explorer"
    },
    {
      ...common("SubagentStop"),
      agent_id: "child-1",
      agent_type: "explorer",
      last_assistant_message: "Child audit finished."
    },
    { ...common("Stop"), last_assistant_message: "Main response finished." }
  ];

  for (const payload of payloads) runHook(projectDir, payload);
  runHook(projectDir, payloads[1]);
  runHook(projectDir, payloads[3]);

  const state = JSON.parse(
    await readFile(sessionStatePath(projectDir, "external-codex-session"), "utf8")
  );
  assert.equal(state.status, "active");
  assert.equal(state.native_hook.external_session_id, "external-codex-session");
  assert.equal(state.native_hook.last_event_name, "PostToolUse");
  assert.equal(state.native_hook.last_mode, "server");
  assert.equal(state.native_hook.observation_count, 14);

  const observations = await db.listAgentObservations({
    session_id: state.session_id,
    limit: 100
  });
  assert.equal(
    observations.length,
    12,
    `unexpected observations: ${JSON.stringify(
      observations.map((item) => ({
        kind: item.kind,
        title: item.title,
        dedup_key: item.dedup_key,
        trace_id: item.trace_id
      }))
    )}`
  );
  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes(fakeSecret), false, "stored observations leaked a secret");
  assert.equal(serialized.includes("transcript_path"), false, "transcript metadata was persisted");

  const prompt = observations.find((item) => item.kind === "user_prompt");
  const response = observations.find(
    (item) => item.kind === "assistant_response" && item.run_id === state.session_id
  );
  assert.equal(prompt?.turn_id, "turn-1");
  assert.equal(response?.turn_id, "turn-1");
  assert.equal(prompt?.trace_id, response?.trace_id, "turn correlation was lost");

  const successfulCall = observations.find(
    (item) =>
      item.kind === "tool_call" && item.redacted_metadata.external_tool_use_id === "tool-success"
  );
  const successfulResult = observations.find(
    (item) =>
      item.kind === "tool_result" && item.redacted_metadata.external_tool_use_id === "tool-success"
  );
  assert.equal(successfulCall?.trace_id, successfulResult?.trace_id, "tool correlation was lost");
  assert.equal(successfulResult?.status, "success");

  const failedResult = observations.find(
    (item) =>
      item.kind === "tool_result" && item.redacted_metadata.external_tool_use_id === "tool-failure"
  );
  const error = observations.find(
    (item) => item.kind === "error" && item.trace_id === failedResult?.trace_id
  );
  assert.equal(failedResult?.status, "error");
  assert.equal(error?.error_code, "CODEX_TOOL_EXIT_9");
  assert.equal(error?.resolution_status, "unresolved");

  const childStart = observations.find(
    (item) => item.kind === "system" && item.title?.startsWith("Codex subagent started")
  );
  const childStop = observations.find(
    (item) => item.kind === "assistant_response" && item.run_id === childStart?.run_id
  );
  assert.ok(childStart);
  assert.equal(childStart?.run_id, childStop?.run_id);
  assert.notEqual(childStart?.run_id, state.session_id);

  const checkpoint = await db.getCheckpoint(project.projectId);
  assert.equal(
    checkpoint?.payload?.source,
    "owner-reviewed-project-checkpoint",
    "PreCompact must not replace project-wide checkpoint with chat-specific state"
  );

  const checkpointA = {
    status: "in_progress",
    current_focus: "Chat A private task",
    next_step: "Resume chat A after process restart."
  };
  runCli([
    "agent-checkpoint",
    "--project-dir",
    projectDir,
    "--external-session-id",
    "external-codex-session",
    "--focus",
    checkpointA.current_focus,
    "--next-step",
    checkpointA.next_step
  ]);
  const stateA = JSON.parse(
    await readFile(sessionStatePath(projectDir, "external-codex-session"), "utf8")
  );
  const checkpointB = {
    current_focus: "Chat B private task",
    next_step: "Continue chat B independently."
  };
  runHook(projectDir, {
    ...common("SessionStart", null),
    session_id: "second-external-codex-session",
    source: "startup"
  });
  runCli([
    "agent-checkpoint",
    "--project-dir",
    projectDir,
    "--external-session-id",
    "second-external-codex-session",
    "--focus",
    checkpointB.current_focus,
    "--next-step",
    checkpointB.next_step
  ]);
  const stateB = JSON.parse(
    await readFile(sessionStatePath(projectDir, "second-external-codex-session"), "utf8")
  );
  assert.notEqual(stateA.session_id, stateB.session_id, "two Codex chats shared one Recallant session");
  assert.equal(
    (await db.getSessionCheckpoint(stateA.session_id)).payload.current_focus,
    checkpointA.current_focus
  );
  assert.equal(
    (await db.getSessionCheckpoint(stateB.session_id)).payload.current_focus,
    checkpointB.current_focus
  );
  const contextA = await db.getContextPack({ session_id: stateA.session_id, task_hint: "resume A" });
  const contextB = await db.getContextPack({ session_id: stateB.session_id, task_hint: "resume B" });
  assert.equal(contextA.sections.checkpoint.payload.current_focus, checkpointA.current_focus);
  assert.equal(contextB.sections.checkpoint.payload.current_focus, checkpointB.current_focus);
  assert.equal(contextA.sections.checkpoint.legacy_project_checkpoint.payload_included, false);

  await client.query(
    "UPDATE sessions SET last_seen_at = now() - interval '9 hours' WHERE id = $1",
    [stateA.session_id]
  );
  runHook(projectDir, { ...common("SessionStart", null), source: "startup" });
  const recoveredStateA = JSON.parse(
    await readFile(sessionStatePath(projectDir, "external-codex-session"), "utf8")
  );
  assert.notEqual(recoveredStateA.session_id, stateA.session_id);
  const recovered = await client.query(
    "SELECT recovered_from_session_id, status FROM sessions WHERE id = $1",
    [recoveredStateA.session_id]
  );
  assert.equal(recovered.rows[0].recovered_from_session_id, stateA.session_id);
  assert.equal(recovered.rows[0].status, "active");
  assert.equal(
    (await db.getSessionCheckpoint(recoveredStateA.session_id)).payload.current_focus,
    checkpointA.current_focus,
    "new Recallant session for the same external Codex chat must recover its checkpoint"
  );
  const restarted = runCli([
    "agent-start",
    "--project-dir",
    projectDir,
    "--external-session-id",
    "external-codex-session",
    "--format",
    "json"
  ]);
  assert.equal(restarted.session_id, recoveredStateA.session_id);
  await assert.rejects(
    readFile(`${projectDir}/.recallant/current-session.json`, "utf8"),
    { code: "ENOENT" },
    "chat-specific state must not create or overwrite the legacy shared state file"
  );

  await writeFile(
    `${offlineDir}/.recallant/config`,
    `${JSON.stringify({ project_id: project.projectId }, null, 2)}\n`
  );
  const offlineSecret = `sk-offline-${randomUUID().replaceAll("-", "")}`;
  const offlineDurationMs = runHook(
    offlineDir,
    {
      session_id: "offline-codex-session",
      cwd: offlineDir,
      hook_event_name: "UserPromptSubmit",
      turn_id: "offline-turn",
      prompt: `Do not leak api_key=${offlineSecret}`
    },
    {
      ...onlineEnv,
      HOME: `${offlineDir}/home`,
      RECALLANT_DATABASE_URL: "",
      RECALLANT_ENV_FILE: `${offlineDir}/missing.env`,
      RECALLANT_PROJECT_PATH: offlineDir
    }
  );
  const spool = await readFile(`${offlineDir}/.recallant/spool/spool.jsonl`, "utf8");
  assert.equal(spool.includes(offlineSecret), false, "offline spool leaked a secret");
  assert.equal(JSON.parse(spool.trim()).record_kind, "observation");
  const offlineState = JSON.parse(
    await readFile(sessionStatePath(offlineDir, "offline-codex-session"), "utf8")
  );
  assert.equal(offlineState.status, "offline");
  assert.equal(offlineState.native_hook.last_mode, "offline_spool");
  assert.ok(offlineDurationMs < 5_000, `offline hook was too slow: ${offlineDurationMs}ms`);

  const remoteOnlySecret = `sk-remote-only-${randomUUID().replaceAll("-", "")}`;
  await writeFile(
    `${remoteOnlyDir}/.recallant/remote-consent.json`,
    `${JSON.stringify(
      {
        schema_version: 1,
        project_id: project.projectId,
        server_url: "https://recallant.example.test",
        endpoint_path: "/api/mcp",
        credential_ref: "local_file_v1:remote-only-test",
        developer_id: developerId,
        client_id: "remote-only-codex-hook"
      },
      null,
      2
    )}\n`
  );
  runHook(
    remoteOnlyDir,
    {
      session_id: "remote-only-codex-session",
      cwd: remoteOnlyDir,
      hook_event_name: "UserPromptSubmit",
      turn_id: "remote-only-turn",
      prompt: `Remote-only native capture api_key=${remoteOnlySecret}`
    },
    {
      ...onlineEnv,
      HOME: `${remoteOnlyDir}/home`,
      RECALLANT_DATABASE_URL: "",
      RECALLANT_ENV_FILE: `${remoteOnlyDir}/missing.env`,
      RECALLANT_PROJECT_PATH: remoteOnlyDir
    }
  );
  const remoteOnlySpool = await readFile(
    `${remoteOnlyDir}/.recallant/spool/spool.jsonl`,
    "utf8"
  );
  assert.equal(
    remoteOnlySpool.includes(remoteOnlySecret),
    false,
    "remote-only spool leaked a secret"
  );
  assert.equal(JSON.parse(remoteOnlySpool.trim()).record_kind, "observation");
  const remoteOnlyState = JSON.parse(
    await readFile(sessionStatePath(remoteOnlyDir, "remote-only-codex-session"), "utf8")
  );
  assert.equal(remoteOnlyState.status, "offline");
  assert.equal(remoteOnlyState.native_hook.last_mode, "offline_spool");
  assert.equal(remoteOnlyState.native_hook.observation_count, 1);

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        observations: observations.length,
        deduplication: "pass",
        turn_correlation: "pass",
        tool_correlation: "pass",
        error_capture: "pass",
        subagent_run: "pass",
        checkpoint: "pass",
        mcp_session_identity: "pass",
        redaction: "pass",
        transcript_parsing: false,
        silent_stdout: true,
        offline_spool: "pass",
        remote_only_root_discovery: "pass",
        offline_duration_ms: offlineDurationMs
      },
      null,
      2
    )}\n`
  );
} finally {
  await client.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
  await db.close();
  await client.end();
  await rm(projectDir, { recursive: true, force: true });
  await rm(offlineDir, { recursive: true, force: true });
  await rm(remoteOnlyDir, { recursive: true, force: true });
  await rm(smokeHome, { recursive: true, force: true });
}
