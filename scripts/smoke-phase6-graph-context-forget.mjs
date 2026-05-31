import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase6-graph-context-"));

const child = spawn(process.execPath, ["apps/cli/dist/index.js", "mcp-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
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

function runCliContext(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: projectId,
      RECALLANT_PROJECT_PATH: projectDir
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`CLI context failed: ${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

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
    clientInfo: { name: "recallant-phase6-graph-context-smoke", version: "0.0.0" }
  }
});
await waitForResponse(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

const started = await callTool(2, "memory_start_session", {
  client_kind: "codex",
  client_version: "smoke",
  project_path: projectDir,
  session_label: "phase6-graph-context-smoke",
  resume_policy: "normal"
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `
    INSERT INTO project_settings (project_id, key, value, reason, updated_by)
    VALUES ($1, 'embedding_route', $2, 'phase6 deterministic graph smoke', 'smoke')
    ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `,
  [
    projectId,
    JSON.stringify({
      route_class: "local_model",
      provider: "deterministic",
      model: "deterministic-bow-v1",
      dims: 16
    })
  ]
);

const checkpointPayload = {
  current_status: "phase6 graph context smoke",
  current_focus: "context pack",
  next_step: "verify graph and forget",
  open_questions: []
};
await callTool(3, "memory_set_checkpoint", {
  payload: checkpointPayload
});
const checkpoint = await callTool(30, "memory_get_checkpoint", {});
if (
  checkpoint.payload?.current_status !== checkpointPayload.current_status ||
  checkpoint.payload?.current_focus !== checkpointPayload.current_focus ||
  checkpoint.payload?.next_step !== checkpointPayload.next_step ||
  JSON.stringify(checkpoint.payload?.open_questions ?? []) !==
    JSON.stringify(checkpointPayload.open_questions)
) {
  throw new Error(`Checkpoint round trip failed: ${JSON.stringify(checkpoint)}`);
}

const alpha = await callTool(4, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "alpha_anchor graph seed chunk",
  dedup_key: `phase6-alpha-${randomUUID()}`
});
const beta = await callTool(5, "memory_append_turn", {
  session_id: started.session_id,
  client_kind: "codex",
  role: "user",
  text: "beta_neighbor graph expanded chunk",
  dedup_key: `phase6-beta-${randomUUID()}`
});
const rawSentinel = `FULL_RAW_ARTIFACT_SENTINEL_${randomUUID()}`;
await callTool(31, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "tool_result",
  text: "alpha raw artifact summary only",
  raw_artifacts: [
    {
      artifact_kind: "tool_output",
      storage_backend: "postgres_inline",
      uri: "inline://phase6/raw-artifact",
      sha256: randomUUID(),
      size_bytes: rawSentinel.length,
      content_type: "text/plain",
      excerpt: `${rawSentinel} should never appear in a context pack.`,
      metadata: { smoke: true }
    }
  ],
  dedup_key: `phase6-raw-${randomUUID()}`
});
await writeFile(
  join(projectDir, "PROJECT_LOG.md"),
  `# Historical project log\n\nHISTORICAL_DOC_SENTINEL_${randomUUID()} should not be imported by context pack.\n`
);

await callTool(6, "memory_link", {
  src_kind: "chunk",
  src_id: alpha.chunk_ids[0],
  dst_kind: "chunk",
  dst_id: beta.chunk_ids[0],
  relation_type: "related",
  weight: 1,
  metadata: { smoke: true }
});

const graph = await callTool(7, "memory_search", {
  session_id: started.session_id,
  query: "alpha_anchor",
  mode: "lexical_only",
  top_k: 1,
  graph_expand: true,
  graph_budget_nodes: 1,
  max_chars_total: 2000
});
if (
  !graph.hits.some((hit) => hit.source_event_id === alpha.event_id) ||
  !graph.hits.some((hit) => hit.source_event_id === beta.event_id && hit.why === "graph")
) {
  throw new Error(`Graph expansion failed: ${JSON.stringify(graph)}`);
}

const rule = await callTool(8, "memory_create_agent_memory", {
  memory_type: "procedure",
  scope: "project",
  title: "Context pack smoke rule",
  body: "Context packs must separate instruction-grade binding rules from ordinary working memory.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: alpha.event_id, quote: "Context pack" }]
});
await callTool(9, "memory_review_agent_memory", {
  memory_id: rule.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "phase6 context pack smoke"
});
const workingMemory = await callTool(32, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Alpha context pack working memory",
  body: "alpha context pack working memory should be recalled as ordinary working memory.",
  created_by: "agent",
  confidence: 0.9,
  source_refs: [{ source_kind: "event", source_id: alpha.event_id, quote: "alpha context" }]
});
await client.query(
  `
    INSERT INTO sessions (project_id, client_kind, client_version, status, last_seen_at)
    VALUES ($1, 'codex', 'smoke', 'interrupted', now() - interval '5 minutes')
  `,
  [projectId]
);

const pack = await callTool(10, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: "alpha context pack",
  include_raw_evidence: "always",
  include_recovery: true,
  max_chars_total: 3000
});
if (
  pack.sections?.checkpoint?.payload?.current_focus !== "context pack" ||
  !pack.sections?.binding_rules?.some((memory) => memory.memory_id === rule.memory_id) ||
  !pack.sections?.working_memories?.some(
    (memory) => memory.memory_id === workingMemory.memory_id
  ) ||
  pack.sections?.working_memories?.some((memory) => memory.memory_id === rule.memory_id) ||
  !Array.isArray(pack.sections?.recovery) ||
  pack.sections.recovery.length === 0 ||
  !pack.sections?.evidence_excerpts?.some((hit) => hit.source_event_id === alpha.event_id)
) {
  throw new Error(`Context pack composition failed: ${JSON.stringify(pack)}`);
}
const serializedPack = JSON.stringify(pack);
if (serializedPack.includes(rawSentinel) || serializedPack.includes("HISTORICAL_DOC_SENTINEL")) {
  throw new Error(`Context pack leaked raw artifact or historical project file: ${serializedPack}`);
}

const mcpPreviewPack = await callTool(11, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: "alpha context pack",
  include_recovery: true
});
const cliPreviewPack = runCliContext([
  "context",
  "--project-dir",
  projectDir,
  "--session-id",
  started.session_id,
  "--task-hint",
  "alpha context pack"
]);
if (
  JSON.stringify(cliPreviewPack.sections?.checkpoint ?? null) !==
    JSON.stringify(mcpPreviewPack.sections?.checkpoint ?? null) ||
  JSON.stringify(cliPreviewPack.sections?.binding_rules ?? []) !==
    JSON.stringify(mcpPreviewPack.sections?.binding_rules ?? []) ||
  JSON.stringify(cliPreviewPack.sections?.working_memories ?? []) !==
    JSON.stringify(mcpPreviewPack.sections?.working_memories ?? []) ||
  JSON.stringify(cliPreviewPack.sections?.suggested_next_fetches ?? []) !==
    JSON.stringify(mcpPreviewPack.sections?.suggested_next_fetches ?? [])
) {
  throw new Error(
    `CLI context preview diverged from MCP context pack: ${JSON.stringify({
      cliPreviewPack,
      mcpPreviewPack
    })}`
  );
}

const dryRun = await callTool(12, "memory_forget", {
  target: { kind: "chunk", id: beta.chunk_ids[0], selector: {} },
  reason: "phase6 smoke dry run",
  dry_run: true,
  confirmation: { confirmed: false }
});
if (dryRun.status !== "pending_confirmation" || dryRun.affected?.chunks !== 1) {
  throw new Error(`Forget dry run failed: ${JSON.stringify(dryRun)}`);
}

const erased = await callTool(13, "memory_forget", {
  target: { kind: "chunk", id: beta.chunk_ids[0], selector: {} },
  reason: "phase6 smoke confirmed",
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-smoke" }
});
if (erased.status !== "completed" || erased.redacted_receipt?.affected?.chunks !== 1) {
  throw new Error(`Confirmed forget failed: ${JSON.stringify(erased)}`);
}

const fetched = await callTool(14, "memory_fetch_chunk", {
  chunk_id: beta.chunk_ids[0],
  max_chars: 2000
});
if (fetched.text !== "[REDACTED]" || fetched.archived_at === null) {
  throw new Error(
    `Fetch after forget did not return redacted archived chunk: ${JSON.stringify(fetched)}`
  );
}

const afterChunkForgetPack = await callTool(33, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: "beta_neighbor",
  include_raw_evidence: "always",
  max_chars_total: 3000
});
if (JSON.stringify(afterChunkForgetPack).includes("beta_neighbor graph expanded chunk")) {
  throw new Error(
    `Context pack returned forgotten chunk content: ${JSON.stringify(afterChunkForgetPack)}`
  );
}

const forgetMemoryToken = `forget_agent_memory_${randomUUID()}`;
const forgetMemory = await callTool(34, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Forget governed memory target",
  body: `${forgetMemoryToken} should disappear from governed memory recall and detail bodies.`,
  created_by: "agent",
  confidence: 0.9,
  source_refs: [
    { source_kind: "event", source_id: alpha.event_id, quote: `${forgetMemoryToken} source quote` }
  ]
});
const erasedMemory = await callTool(35, "memory_forget", {
  target: { kind: "agent_memory", id: forgetMemory.memory_id, selector: {} },
  reason: "phase6 governed memory forget",
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-agent-memory" }
});
if (
  erasedMemory.status !== "completed" ||
  erasedMemory.redacted_receipt?.affected?.agent_memories !== 1
) {
  throw new Error(`Confirmed governed-memory forget failed: ${JSON.stringify(erasedMemory)}`);
}
const forgottenDetail = await callTool(36, "memory_get_agent_memory", {
  memory_id: forgetMemory.memory_id
});
if (
  forgottenDetail.memory.title !== "[REDACTED]" ||
  forgottenDetail.memory.body !== "[REDACTED]" ||
  forgottenDetail.memory.status !== "archived" ||
  forgottenDetail.memory.use_policy !== "do_not_use" ||
  forgottenDetail.source_refs.some((sourceRef) => sourceRef.quote !== null)
) {
  throw new Error(`Governed-memory detail was not redacted: ${JSON.stringify(forgottenDetail)}`);
}
const forgottenList = await callTool(39, "memory_list_agent_memories", {
  view: "all",
  status: "archived",
  limit: 20
});
if (!Array.isArray(forgottenList.memories)) {
  throw new Error(
    `Governed-memory list response missing memories: ${JSON.stringify(forgottenList)}`
  );
}
const forgottenListRow = forgottenList.memories.find(
  (memory) => memory.memory_id === forgetMemory.memory_id
);
if (
  !forgottenListRow ||
  forgottenListRow.title !== "[REDACTED]" ||
  forgottenListRow.body !== "[REDACTED]" ||
  JSON.stringify(forgottenListRow).includes(forgetMemoryToken)
) {
  throw new Error(
    `Governed-memory list response was not redacted: ${JSON.stringify(forgottenList)}`
  );
}
const forgottenRecall = await callTool(37, "memory_recall_agent_memories", {
  query: forgetMemoryToken,
  scope: "project",
  top_k: 5,
  max_chars_total: 2000
});
const forgottenContextPack = await callTool(38, "memory_get_context_pack", {
  session_id: started.session_id,
  task_hint: forgetMemoryToken,
  include_raw_evidence: "always",
  max_chars_total: 3000
});
if (
  forgottenRecall.memories.length !== 0 ||
  JSON.stringify(forgottenContextPack).includes(forgetMemoryToken)
) {
  throw new Error(
    `Forgotten governed memory remained recallable: ${JSON.stringify({
      forgottenRecall,
      forgottenContextPack
    })}`
  );
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM edges WHERE src_id = $1 AND dst_id = $2) AS edge_count,
        (SELECT count(*)::int FROM erasure_requests WHERE status = 'completed') AS erasure_count,
        (SELECT count(*)::int FROM embeddings WHERE chunk_id = $2::uuid) AS erased_embedding_count,
        (SELECT body FROM agent_memories WHERE id = $3) AS erased_memory_body,
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $3 AND quote IS NULL) AS erased_memory_redacted_refs
    `,
    [alpha.chunk_ids[0], beta.chunk_ids[0], forgetMemory.memory_id]
  );
  const row = checks.rows[0];
  if (
    row.edge_count !== 1 ||
    row.erasure_count < 2 ||
    row.erased_embedding_count !== 0 ||
    row.erased_memory_body !== "[REDACTED]" ||
    row.erased_memory_redacted_refs !== 1
  ) {
    throw new Error(`Graph/context/forget DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

child.stdin.end();
child.kill();
await once(child, "close");

process.stdout.write("Phase 6 graph/context/forget smoke passed\n");
