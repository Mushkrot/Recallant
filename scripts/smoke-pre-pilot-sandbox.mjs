import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const fixtureSource = join(repoRoot, "tests", "fixtures", "pre-pilot-discovery");
const originalAgentsStat = await stat(join(fixtureSource, "AGENTS.md"));
const sandboxDir = await mkdtemp(join(tmpdir(), "recallant-pilot-sandbox-"));
await cp(fixtureSource, sandboxDir, { recursive: true });

const commonEnv = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: sandboxDir,
  RECALLANT_EMBEDDING_PROVIDER: "deterministic",
  RECALLANT_EMBEDDING_DIMS: "8"
};

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: commonEnv,
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

const discovery = runJson(["discover", "--dry-run", "--project-dir", sandboxDir]);
if (discovery.read_only !== true || discovery.candidates.length < 5) {
  throw new Error(`Sandbox discovery failed: ${JSON.stringify(discovery)}`);
}
const preview = runJson(["import", "--dry-run", "AGENTS.md", "--project-dir", sandboxDir]);
if (preview.writes_memory !== false || preview.source_ref?.path !== "AGENTS.md") {
  throw new Error(`Sandbox import preview failed: ${JSON.stringify(preview)}`);
}
const confirmed = runJson(["import", "AGENTS.md", "--project-dir", sandboxDir]);
if (confirmed.write_result?.status !== "created" || confirmed.write_result.memory_ids.length !== 1) {
  throw new Error(`Sandbox confirmed import failed: ${JSON.stringify(confirmed)}`);
}

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: repoRoot,
  env: commonEnv,
  stdio: ["pipe", "pipe", "pipe"]
});

const lines = createInterface({ input: child.stdout });
const responses = new Map();
let stderr = "";
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
  throw new Error(`Timed out waiting for MCP response id=${id}. stderr=${stderr}`);
}

async function callTool(id, name, args) {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const response = await waitForResponse(id);
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "recallant-prepilot-sandbox-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: sandboxDir,
  session_label: "pre-pilot-sandbox",
  resume_policy: "normal"
});
const contextPack = await callTool(3, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: "pilot sandbox imported AGENTS.md",
  include_raw_evidence: "auto",
  include_recovery: true
});
if (contextPack.sections?.checkpoint === undefined || contextPack.project_id !== projectId) {
  throw new Error(`Sandbox context pack failed: ${JSON.stringify(contextPack)}`);
}

const uniqueToken = `sandbox_unique_${randomUUID().replaceAll("-", "_")}`;
await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: `Pilot sandbox smoke writes searchable fact ${uniqueToken}.`,
  dedup_key: `sandbox-${uniqueToken}`
});
const search = await callTool(5, "memory_search", {
  session_id: started.session_id,
  query: uniqueToken,
  mode: "lexical_only",
  top_k: 3
});
if (!search.hits?.some((hit) => String(hit.text_excerpt).includes(uniqueToken))) {
  throw new Error(`Sandbox search did not find appended fact: ${JSON.stringify(search)}`);
}

const recall = await callTool(6, "memory_recall_agent_memories", {
  query: "Imported AGENTS.md",
  include_candidates: true,
  include_needs_review: true,
  top_k: 5
});
if (!recall.memories?.some((memory) => memory.memory_id === confirmed.write_result.memory_ids[0])) {
  throw new Error(`Sandbox recall did not include imported candidate: ${JSON.stringify(recall)}`);
}

const closeout = await callTool(7, "memory_closeout", {
  session_id: started.session_id,
  closeout_intent: "task_complete",
  summary: "Pre-pilot sandbox workflow smoke complete.",
  checkpoint_payload: {
    current_status: "sandbox smoke complete",
    current_focus: "pilot sandbox workflow",
    next_step: "detach sandbox and review pilot report",
    open_questions: []
  },
  governed_memory_candidates: [],
  artifact_refs: []
});
if (closeout.session_id !== started.session_id || closeout.report_required !== false) {
  throw new Error(`Sandbox closeout failed: ${JSON.stringify(closeout)}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM projects WHERE id = $1 AND primary_path = $2) AS sandbox_project,
        (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
        (SELECT count(*)::int FROM chunks WHERE project_id = $1) AS chunk_count,
        (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND created_by = 'import') AS import_memories,
        (SELECT status FROM sessions WHERE id = $3) AS session_status
    `,
    [projectId, sandboxDir, started.session_id]
  );
  const row = checks.rows[0];
  if (
    row.sandbox_project !== 1 ||
    row.import_events !== 1 ||
    row.chunk_count < 2 ||
    row.import_memories !== 1 ||
    row.session_status !== "closed"
  ) {
    throw new Error(`Sandbox DB verification failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

const originalAfterStat = await stat(join(fixtureSource, "AGENTS.md"));
if (
  originalAfterStat.mtimeMs !== originalAgentsStat.mtimeMs ||
  createHash("sha256").update(String(originalAfterStat.size)).digest("hex") !==
    createHash("sha256").update(String(originalAgentsStat.size)).digest("hex")
) {
  throw new Error("Sandbox workflow modified the original fixture project");
}

process.stdout.write("Pre-Pilot sandbox smoke passed\n");
