import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  agentObservationAdapterDescriptor,
  supportedClientKinds
} from "../packages/adapters/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const repoRoot = process.cwd();

const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-cross-client-${projectId}`;
const token = `cross_client_token_${projectId.replaceAll("-", "_")}`;

function createClient(name) {
  const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
    cwd: repoRoot,
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
    if (!text)
      throw new Error(`Missing ${name} tool response for ${toolName}: ${JSON.stringify(response)}`);
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

  const userTurn = await writer.callTool("memory_append_turn", {
    session_id: writerSession.session_id,
    client_kind: "cursor",
    role: "user",
    text: `Cross-client fact written by Cursor fixture: ${token}`,
    dedup_key: `cross-client:${token}`
  });
  const assistantTurn = await writer.callTool("memory_append_turn", {
    session_id: writerSession.session_id,
    client_kind: "cursor",
    role: "assistant",
    text: "The cross-client fact was captured.",
    dedup_key: `cross-client-response:${token}`
  });
  if (
    userTurn.observation?.status !== "recorded" ||
    assistantTurn.observation?.status !== "recorded"
  ) {
    throw new Error(
      `Legacy turn dual-write failed: ${JSON.stringify({ userTurn, assistantTurn })}`
    );
  }

  const toolTrace = randomUUID();
  const toolCall = await writer.callTool("memory_append_event", {
    session_id: writerSession.session_id,
    client_kind: "cursor",
    event_kind: "tool_call",
    text: "Read the cross-client fixture.",
    metadata: {
      observation_kind: "tool_call",
      trace_id: toolTrace,
      tool_name: "fixture_reader"
    },
    raw_artifacts: [],
    dedup_key: `cross-client-tool-call:${token}`
  });
  await writer.callTool("memory_append_event", {
    session_id: writerSession.session_id,
    client_kind: "cursor",
    event_kind: "tool_result",
    text: "Fixture read succeeded.",
    metadata: {
      observation_kind: "tool_result",
      trace_id: toolTrace,
      parent_observation_id: toolCall.observation?.observation_id
    },
    raw_artifacts: [],
    dedup_key: `cross-client-tool-result:${token}`
  });

  for (const clientKind of supportedClientKinds) {
    const descriptor = agentObservationAdapterDescriptor({
      client_kind: clientKind,
      transport: clientKind === "codex" ? "project_hook" : "mcp"
    });
    if (
      descriptor.client_kind !== clientKind ||
      descriptor.project_scoped !== true ||
      descriptor.global_configuration_write !== false
    ) {
      throw new Error(`Invalid adapter descriptor: ${JSON.stringify(descriptor)}`);
    }
    await writer.callTool("memory_append_observation", {
      session_id: writerSession.session_id,
      kind: "system",
      status: "success",
      title: `${clientKind} adapter contract`,
      body: "Shared observation seam accepted this supported client kind.",
      client_kind: clientKind,
      dedup_key: `cross-client-observation:${clientKind}:${token}`
    });
  }

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

  const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
  try {
    const observations = await db.listAgentObservations({
      session_id: writerSession.session_id,
      limit: 100
    });
    const clientKinds = new Set(observations.map((item) => item.client_kind).filter(Boolean));
    if (!supportedClientKinds.every((clientKind) => clientKinds.has(clientKind))) {
      throw new Error(
        `Not every supported client reached the observation seam: ${JSON.stringify([...clientKinds])}`
      );
    }
    const completeness = await db.getAgentObservationCompleteness({
      session_id: writerSession.session_id
    });
    if (completeness.unmatched_tool_calls !== 0 || completeness.unmatched_user_prompts !== 0) {
      throw new Error(`Dual-write completeness failed: ${JSON.stringify(completeness)}`);
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "pass",
          supported_client_kinds: supportedClientKinds,
          observation_count: observations.length,
          legacy_dual_write: "pass",
          correlated_tool_pair: "pass",
          completeness
        },
        null,
        2
      )}\n`
    );
  } finally {
    await db.close();
  }
} finally {
  await Promise.allSettled([writer.close(), reader.close()]);
}
