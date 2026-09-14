import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve("apps/cli/dist/index.js");
const projectId = "755417eb-08e5-4fe7-a27b-31037a85ec89";
const developerId = "7ebb3031-7926-4102-9ebd-540c76eebd27";
const clientId = "remote-r2-hook-fixture";
const credential = "synthetic-r2-hook-credential";
const remoteSessionId = randomUUID();
const projectDir = join(tmpdir(), `recallant-r2-remote-hook-${randomUUID()}`);
const requests = [];
let rejectWrites = false;

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

function jsonRpcResult(id, payload) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: false
    }
  };
}

async function runHook(payload) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, "codex-hook", "--debug"], {
      cwd: projectDir,
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: "",
        RECALLANT_ENV_FILE: "/dev/null",
        RECALLANT_PROJECT_PATH: projectDir
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  const debug = JSON.parse(result.stderr.trim());
  assert.equal(debug.ok, true, result.stderr);
  return debug;
}

const server = createServer(async (request, response) => {
  const body = JSON.parse(await readBody(request));
  requests.push({
    authorization: request.headers.authorization,
    project: request.headers["x-recallant-project-id"],
    developer: request.headers["x-recallant-developer-id"],
    client: request.headers["x-recallant-client-id"],
    session: request.headers["x-recallant-session-id"] ?? null,
    body
  });
  const toolName = body.params?.name;
  if (rejectWrites && toolName !== "memory_start_session") {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32053, message: "synthetic remote outage" }
      })
    );
    return;
  }
  let payload;
  if (toolName === "memory_start_session") {
    payload = { session_id: remoteSessionId, project_id: projectId, status: "started" };
  } else if (toolName === "memory_append_observation") {
    payload = { id: randomUUID(), status: "success", durable: true };
  } else if (toolName === "memory_set_checkpoint") {
    payload = { ok: true, updated_at: new Date().toISOString(), checkpoint_state_only: true };
  } else {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: `unexpected tool ${String(toolName)}` }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(jsonRpcResult(body.id, payload)));
});

await mkdir(join(projectDir, ".codex"), { recursive: true });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address !== "string");
await writeFile(
  join(projectDir, ".codex", "config.toml"),
  `[mcp_servers.recallant]\ncommand = "recallant"\nargs = ["remote-bridge"]\n\n[mcp_servers.recallant.env]\nRECALLANT_REMOTE_MCP_URL = "http://127.0.0.1:${address.port}"\nRECALLANT_REMOTE_MCP_CREDENTIAL = "${credential}"\nRECALLANT_PROJECT_ID = "${projectId}"\nRECALLANT_DEVELOPER_ID = "${developerId}"\nRECALLANT_REMOTE_MCP_CLIENT_ID = "${clientId}"\n`
);

try {
  const sessionId = "external-r2-session";
  const first = await runHook({
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd: projectDir,
    model: "gpt-5",
    source: "startup"
  });
  assert.equal(first.mode, "remote_mcp");
  assert.equal(first.transport, "remote_mcp");
  assert.equal(first.actions, 1);

  const secret = `sk-r2-hook-${randomUUID().replaceAll("-", "")}`;
  const second = await runHook({
    hook_event_name: "PreCompact",
    session_id: sessionId,
    cwd: projectDir,
    turn_id: "turn-r2",
    trigger: "auto",
    prompt: `never persist api_key=${secret}`
  });
  assert.equal(second.mode, "remote_mcp");
  assert.equal(second.actions, 2);

  assert.deepEqual(
    requests.map((request) => request.body.params.name),
    [
      "memory_start_session",
      "memory_append_observation",
      "memory_append_observation",
      "memory_set_checkpoint"
    ]
  );
  for (const request of requests) {
    assert.equal(request.authorization, `Bearer ${credential}`);
    assert.equal(request.project, projectId);
    assert.equal(request.developer, developerId);
    assert.equal(request.client, clientId);
  }
  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes(secret), false, "remote hook payload leaked a secret");
  assert.equal(
    await readFile(join(projectDir, ".recallant", "current-session.json"), "utf8").then(
      (value) => JSON.parse(value).native_hook.last_mode
    ),
    "server"
  );
  await assert.rejects(readFile(join(projectDir, ".recallant", "spool", "spool.jsonl")));
  rejectWrites = true;
  const fallback = await runHook({
    hook_event_name: "PostCompact",
    session_id: sessionId,
    cwd: projectDir,
    turn_id: "turn-r2",
    trigger: "auto"
  });
  assert.equal(fallback.mode, "offline_spool");
  const spool = JSON.parse(
    (await readFile(join(projectDir, ".recallant", "spool", "spool.jsonl"), "utf8")).trim()
  );
  assert.equal(spool.record_kind, "remote_tool");
  assert.equal(spool.payload.tool_name, "memory_append_observation");
  const fallbackState = JSON.parse(
    await readFile(join(projectDir, ".recallant", "current-session.json"), "utf8")
  );
  assert.equal(fallbackState.status, "offline");
  assert.equal(fallbackState.native_hook.transport, "remote_mcp");
  process.stdout.write(
    `${JSON.stringify({ status: "pass", transport: "remote_mcp", observations: 2, checkpoint: "pass", redaction: "pass", local_database: "not_used", local_spool: "ordered_fallback" }, null, 2)}\n`
  );
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(projectDir, { recursive: true, force: true });
}
