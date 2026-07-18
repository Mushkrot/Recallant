import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";

import { RecallantDb } from "../packages/db/dist/index.js";

const cliPath = resolve("apps/cli/dist/index.js");
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = `/tmp/recallant-codex-hook-${randomUUID()}`;
const offlineDir = `${projectDir}-offline`;
const smokeHome = `${projectDir}-home`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath: projectDir });
const client = new pg.Client({ connectionString: databaseUrl });
const fakeSecret = `sk-codex-hook-${randomUUID().replaceAll("-", "")}`;

const onlineEnv = {
  ...process.env,
  HOME: smokeHome,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: projectDir,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
};

function runHook(projectPath, payload, env = onlineEnv) {
  const startedAt = Date.now();
  const debug = process.env.RECALLANT_CODEX_HOOK_SMOKE_DEBUG === "1";
  const result = spawnSync(process.execPath, [cliPath, "codex-hook", ...(debug ? ["--debug"] : [])], {
    cwd: projectPath,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
  assert.equal(result.signal, null, `hook timed out: ${result.error?.message ?? ""}`);
  assert.equal(result.stdout, "", `hook wrote to stdout: ${result.stdout}`);
  if (!debug) assert.equal(result.stderr, "", `hook wrote to stderr: ${result.stderr}`);
  else if (result.stderr) process.stderr.write(result.stderr);
  return Date.now() - startedAt;
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
await rm(smokeHome, { recursive: true, force: true });
await mkdir(`${projectDir}/.recallant`, { recursive: true });
await mkdir(`${offlineDir}/.recallant`, { recursive: true });
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
    await readFile(`${projectDir}/.recallant/current-session.json`, "utf8")
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
    (item) => item.kind === "tool_call" && item.redacted_metadata.external_tool_use_id === "tool-success"
  );
  const successfulResult = observations.find(
    (item) =>
      item.kind === "tool_result" &&
      item.redacted_metadata.external_tool_use_id === "tool-success"
  );
  assert.equal(successfulCall?.trace_id, successfulResult?.trace_id, "tool correlation was lost");
  assert.equal(successfulResult?.status, "success");

  const failedResult = observations.find(
    (item) =>
      item.kind === "tool_result" &&
      item.redacted_metadata.external_tool_use_id === "tool-failure"
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
  assert.equal(checkpoint?.payload?.source, "codex-native-hook");
  assert.equal(checkpoint?.payload?.external_session_id, "external-codex-session");

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
    await readFile(`${offlineDir}/.recallant/current-session.json`, "utf8")
  );
  assert.equal(offlineState.status, "offline");
  assert.equal(offlineState.native_hook.last_mode, "offline_spool");
  assert.ok(offlineDurationMs < 5_000, `offline hook was too slow: ${offlineDurationMs}ms`);

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
        redaction: "pass",
        transcript_parsing: false,
        silent_stdout: true,
        offline_spool: "pass",
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
  await rm(smokeHome, { recursive: true, force: true });
}
