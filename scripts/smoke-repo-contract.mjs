import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const projectDir = await mkdtemp(join(tmpdir(), "recallant-repo-contract-"));
const projectLogPath = join(projectDir, "PROJECT_LOG.md");
await writeFile(
  projectLogPath,
  `# Project Log

## Current Session

Status: old
Current focus: old focus
Next step: old step

## Open Questions

- old question

## Notes

- Preserve this note.
`
);

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: randomUUID(),
    RECALLANT_PROJECT_ID: randomUUID(),
    RECALLANT_PROJECT_PATH: projectDir
  },
  stdio: ["pipe", "pipe", "pipe"]
});

const lines = createInterface({ input: child.stdout });
const responses = new Map();
lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id !== undefined) responses.set(message.id, message);
});

let stderr = "";
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
  throw new Error(`Timed out waiting for MCP response id=${id}. stderr=${stderr}`);
}

async function callTool(id, name, args) {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const response = await waitForResponse(id);
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "recallant-repo-contract-smoke", version: "0.0.0" }
    }
  });
  await waitForResponse(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  await callTool(2, "memory_start_session", {
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectDir,
    session_label: "repo-contract-smoke",
    resume_policy: "normal"
  });

  const checkpoint = {
    current_status: "repo contract smoke synced",
    current_focus: "repo checkpoint mirror",
    next_step: "continue implementation",
    open_questions: ["How often should async sync retry?"]
  };
  const set = await callTool(3, "memory_set_checkpoint", { payload: checkpoint });
  if (set.ok !== true || set.repo_sync?.status !== "updated") {
    throw new Error(`Checkpoint repo sync failed: ${JSON.stringify(set)}`);
  }
  const get = await callTool(4, "memory_get_checkpoint", {});
  if (
    get.payload?.current_focus !== checkpoint.current_focus ||
    get.payload?.next_step !== checkpoint.next_step
  ) {
    throw new Error(`Checkpoint readback failed: ${JSON.stringify(get)}`);
  }
  const projectLog = await readFile(projectLogPath, "utf8");
  if (
    !projectLog.includes("Current focus: repo checkpoint mirror") ||
    !projectLog.includes("Next step: continue implementation") ||
    !projectLog.includes("- How often should async sync retry?") ||
    !projectLog.includes("- Preserve this note.")
  ) {
    throw new Error(`PROJECT_LOG.md was not synced correctly:\n${projectLog}`);
  }
} finally {
  child.stdin.end();
  child.kill();
  await once(child, "close");
}

process.stdout.write("Repo contract smoke passed\n");
