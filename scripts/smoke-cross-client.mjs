import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-cross-client-${projectId}`;
const token = `cross_client_token_${projectId.replaceAll("-", "_")}`;

function createClient(name) {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
    cwd: "/work",
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId,
      RECALLANT_PROJECT_PATH: projectPath
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = createInterface({ input: child.stdout });
  const responses = new Map();
  let stderr = "";
  let nextId = 1;

  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined) responses.set(message.id, message);
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function waitForResponse(id) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (responses.has(id)) return responses.get(id);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${name} MCP response id=${id}. stderr=${stderr}`);
  }

  async function request(method, params) {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return waitForResponse(id);
  }

  async function callTool(toolName, args) {
    const response = await request("tools/call", {
      name: toolName,
      arguments: args
    });
    const text = response.result?.content?.[0]?.text;
    if (!text) throw new Error(`Missing ${name} tool response for ${toolName}: ${JSON.stringify(response)}`);
    return JSON.parse(text);
  }

  async function initialize() {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name, version: "0.0.0" }
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  async function close() {
    child.stdin.end();
    child.kill();
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
  }

  return { callTool, close, initialize };
}

const writer = createClient("recallant-cross-client-writer");
const reader = createClient("recallant-cross-client-reader");

try {
  await writer.initialize();
  await reader.initialize();

  const writerSession = await writer.callTool("memory_start_session", {
    client_kind: "cursor",
    client_version: "smoke",
    project_path: projectPath,
    session_label: "cross-client-writer",
    resume_policy: "normal"
  });
  const readerSession = await reader.callTool("memory_start_session", {
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectPath,
    session_label: "cross-client-reader",
    resume_policy: "normal"
  });

  await writer.callTool("memory_append_turn", {
    session_id: writerSession.session_id,
    client_kind: "cursor",
    role: "user",
    text: `Cross-client fact written by Cursor fixture: ${token}`,
    dedup_key: `cross-client:${token}`
  });

  const search = await reader.callTool("memory_search", {
    session_id: readerSession.session_id,
    query: token,
    mode: "lexical_only",
    top_k: 3,
    max_chars_total: 2000
  });
  if (!search.hits?.some((hit) => String(hit.text_excerpt ?? hit.excerpt ?? "").includes(token))) {
    throw new Error(`Reader client did not find writer fact: ${JSON.stringify(search)}`);
  }
} finally {
  await Promise.allSettled([writer.close(), reader.close()]);
}

process.stdout.write("Cross-client smoke passed\n");
