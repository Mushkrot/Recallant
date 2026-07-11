import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRecallantMcpServer } from "../packages/mcp/dist/index.js";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const projectDir = await mkdtemp(join(tmpdir(), "recallant-phase6-graph-context-"));

async function assertCliMcpServerLifecycle() {
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
  let stderr = "";
  let exit = null;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (exit) {
    throw new Error(
      `CLI mcp-server exited before client close: ${JSON.stringify({ exit, stderr })}`
    );
  }
  child.kill();
  await once(child, "close");
}

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

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

await assertCliMcpServerLifecycle();

const mcpEnvKeys = [
  "RECALLANT_DATABASE_URL",
  "RECALLANT_DEVELOPER_ID",
  "RECALLANT_PROJECT_ID",
  "RECALLANT_PROJECT_PATH"
];
const mcpEnvSnapshot = snapshotEnv(mcpEnvKeys);
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = projectDir;

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpClient = new Client({
  name: "recallant-phase6-graph-context-smoke",
  version: "0.0.0"
});
const mcpServer = createRecallantMcpServer();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

async function callTool(id, name, args) {
  const response = await mcpClient.callTool({ name, arguments: args }, undefined, {
    timeout: 30_000
  });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error(`Missing tool response text for ${name}: ${JSON.stringify(response)}`);
  return JSON.parse(String(text));
}

async function expectToolError(name, args, expectedText) {
  const response = await mcpClient.callTool({ name, arguments: args });
  const rendered = JSON.stringify(response);
  if (response.isError !== true || !rendered.includes(expectedText)) {
    throw new Error(`Expected ${name} to fail with ${expectedText}: ${JSON.stringify(response)}`);
  }
  return rendered;
}

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
const rawEvent = await callTool(31, "memory_append_event", {
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
      metadata: { smoke: true, sentinel: rawSentinel }
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
await callTool(42, "memory_search", {
  session_id: started.session_id,
  query: "alpha raw artifact summary",
  mode: "lexical_only",
  top_k: 3,
  max_chars_total: 2000
});
await client.query(
  `
    INSERT INTO recall_traces (
      developer_id, project_id, tool_name, query, returned_chunk_ids, metadata
    ) VALUES ($1, $2, 'phase6_direct_event_fixture', $3, $4, $5)
  `,
  [
    developerId,
    projectId,
    rawSentinel,
    JSON.stringify(rawEvent.chunk_ids),
    JSON.stringify({ sentinel: rawSentinel })
  ]
);

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
await callTool(41, "memory_link", {
  src_kind: "chunk",
  src_id: alpha.chunk_ids[0],
  dst_kind: "chunk",
  dst_id: rawEvent.chunk_ids[0],
  relation_type: "related",
  weight: 1,
  metadata: { smoke: true, sentinel: rawSentinel }
});

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
const packRule = pack.sections?.binding_rules?.find(
  (memory) => memory.memory_id === rule.memory_id
);
const packWorkingMemory = pack.sections?.working_memories?.find(
  (memory) => memory.memory_id === workingMemory.memory_id
);
if (
  pack.sections?.checkpoint?.payload?.current_focus !== "context pack" ||
  !packRule ||
  !packWorkingMemory ||
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
if (
  !packRule.source_refs?.some((sourceRef) => sourceRef.source_id === alpha.event_id) ||
  packRule.provenance?.primary_source_kind !== "event" ||
  !String(packRule.provenance?.summary ?? "").includes("event") ||
  !packWorkingMemory.source_refs?.some((sourceRef) => sourceRef.source_id === alpha.event_id) ||
  packWorkingMemory.provenance?.source_count !== 1
) {
  throw new Error(
    `Context pack did not include source provenance for governed memories: ${JSON.stringify({
      packRule,
      packWorkingMemory
    })}`
  );
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

await expectToolError(
  "memory_forget",
  {
    target: { kind: "chunk", selector: {} },
    dry_run: true,
    confirmation: { confirmed: false }
  },
  "target id is required"
);
await expectToolError(
  "memory_forget",
  {
    target: { kind: "search_query", selector: { query: "phase6_no_match_marker" } },
    dry_run: true,
    confirmation: { confirmed: false }
  },
  "matched no Recallant-controlled content"
);
const broadPreview = await callTool(40, "memory_forget", {
  target: { kind: "search_query", selector: { query: "alpha_anchor" } },
  reason: "must not be persisted in preview",
  dry_run: true,
  confirmation: { confirmed: false }
});
if (
  broadPreview.status !== "pending_confirmation" ||
  broadPreview.affected?.events < 1 ||
  broadPreview.affected?.chunks < 1 ||
  !/^forget-v1:[0-9a-f]{64}$/.test(broadPreview.confirmation_token ?? "") ||
  !/^[0-9a-f]{64}$/.test(broadPreview.selection_digest ?? "") ||
  JSON.stringify(broadPreview).includes("must not be persisted in preview")
) {
  throw new Error(`Broad forget preview contract failed: ${JSON.stringify(broadPreview)}`);
}
const previewReceiptLeak = await client.query(
  "SELECT count(*)::int AS count FROM erasure_requests WHERE target_selector::text ILIKE '%alpha_anchor%' OR reason ILIKE '%must not be persisted%'"
);
if (previewReceiptLeak.rows[0]?.count !== 0) {
  throw new Error(
    `Broad preview persisted sensitive selector text: ${JSON.stringify(previewReceiptLeak.rows)}`
  );
}

const betaTraceToken = `BETA_TRACE_SENTINEL_${randomUUID()}`;
const betaTrace = await client.query(
  `
    INSERT INTO recall_traces (
      developer_id, project_id, tool_name, query, returned_chunk_ids, metadata
    ) VALUES ($1, $2, 'phase6_direct_chunk_fixture', $3, $4, $5)
    RETURNING id
  `,
  [
    developerId,
    projectId,
    betaTraceToken,
    JSON.stringify([beta.chunk_ids[0]]),
    JSON.stringify({ sentinel: betaTraceToken })
  ]
);

const erased = await callTool(13, "memory_forget", {
  target: { kind: "chunk", id: beta.chunk_ids[0], selector: {} },
  reason: "phase6 smoke confirmed",
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-smoke" }
});
if (
  erased.status !== "completed" ||
  erased.redacted_receipt?.affected?.chunks !== 1 ||
  erased.redacted_receipt?.affected?.recall_traces !== 1
) {
  throw new Error(`Confirmed forget failed: ${JSON.stringify(erased)}`);
}
const betaTraceAfter = await client.query("SELECT * FROM recall_traces WHERE id = $1", [
  betaTrace.rows[0].id
]);
if (
  JSON.stringify(betaTraceAfter.rows).includes(betaTraceToken) ||
  betaTraceAfter.rows[0]?.query !== null ||
  JSON.stringify(betaTraceAfter.rows[0]?.returned_chunk_ids) !== "[]" ||
  betaTraceAfter.rows[0]?.metadata?.redacted !== true
) {
  throw new Error(`Direct chunk trace scrub failed: ${JSON.stringify(betaTraceAfter.rows)}`);
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

const eventRefMemory = await callTool(50, "memory_create_agent_memory", {
  memory_type: "artifact_reference",
  scope: "project",
  title: "Event ref control memory",
  body: "The governed memory remains while its erased event provenance is redacted.",
  created_by: "agent",
  confidence: 0.9,
  source_refs: [
    {
      source_kind: "event",
      source_id: rawEvent.event_id,
      quote: rawSentinel,
      metadata: { sentinel: rawSentinel }
    }
  ]
});

const erasedEvent = await callTool(43, "memory_forget", {
  target: { kind: "event", id: rawEvent.event_id, selector: {} },
  reason: `${rawSentinel} must not persist as an erasure reason`,
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-event" }
});
if (
  erasedEvent.status !== "completed" ||
  erasedEvent.affected?.events !== 1 ||
  erasedEvent.affected?.chunks !== 1 ||
  erasedEvent.affected?.raw_artifacts !== 1 ||
  erasedEvent.affected?.edges !== 1 ||
  erasedEvent.affected?.source_refs !== 1 ||
  erasedEvent.affected?.recall_traces < 1
) {
  throw new Error(`Direct event erasure counts failed: ${JSON.stringify(erasedEvent)}`);
}
const eventRefDetail = await callTool(51, "memory_get_agent_memory", {
  memory_id: eventRefMemory.memory_id
});
if (
  eventRefDetail.memory?.body !==
    "The governed memory remains while its erased event provenance is redacted." ||
  eventRefDetail.source_refs[0]?.source_id !== "[REDACTED]" ||
  eventRefDetail.source_refs[0]?.quote !== null ||
  JSON.stringify(eventRefDetail.source_refs[0]?.metadata).includes(rawSentinel)
) {
  throw new Error(`Direct event source-ref scrub failed: ${JSON.stringify(eventRefDetail)}`);
}
const erasedEventState = await client.query(
  `
    SELECT
      (SELECT payload FROM events WHERE id = $1) AS event_payload,
      (SELECT payload_hash FROM events WHERE id = $1) AS event_payload_hash,
      (SELECT text FROM chunks WHERE id = $2) AS chunk_text,
      (SELECT count(*)::int FROM embeddings WHERE chunk_id = $2) AS embeddings,
      (SELECT count(*)::int FROM edges WHERE src_id = $2::text OR dst_id = $2::text) AS edges,
      (SELECT uri FROM raw_artifacts WHERE id = $3) AS artifact_uri,
      (SELECT excerpt FROM raw_artifacts WHERE id = $3) AS artifact_excerpt,
      (SELECT metadata FROM raw_artifacts WHERE id = $3) AS artifact_metadata,
      (SELECT deleted_at FROM raw_artifacts WHERE id = $3) AS artifact_deleted_at
  `,
  [rawEvent.event_id, rawEvent.chunk_ids[0], rawEvent.raw_artifact_ids[0]]
);
if (
  JSON.stringify(erasedEventState.rows).includes(rawSentinel) ||
  erasedEventState.rows[0]?.event_payload_hash !== null ||
  erasedEventState.rows[0]?.chunk_text !== "[REDACTED]" ||
  erasedEventState.rows[0]?.embeddings !== 0 ||
  erasedEventState.rows[0]?.edges !== 0 ||
  erasedEventState.rows[0]?.artifact_uri !== "redacted://erasure" ||
  erasedEventState.rows[0]?.artifact_excerpt !== null ||
  !erasedEventState.rows[0]?.artifact_metadata?.redacted ||
  erasedEventState.rows[0]?.artifact_deleted_at === null
) {
  throw new Error(`Direct event dependent scrub failed: ${JSON.stringify(erasedEventState.rows)}`);
}

const directArtifactToken = `DIRECT_ARTIFACT_SENTINEL_${randomUUID()}`;
const directArtifactEvent = await callTool(44, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "tool_result",
  text: "unrelated artifact parent remains readable",
  raw_artifacts: [
    {
      artifact_kind: "tool_output",
      storage_backend: "external",
      uri: `external://owner/${directArtifactToken}`,
      sha256: directArtifactToken,
      size_bytes: directArtifactToken.length,
      content_type: "text/plain",
      excerpt: directArtifactToken,
      metadata: { sentinel: directArtifactToken }
    }
  ],
  dedup_key: `phase6-direct-artifact-${randomUUID()}`
});
const erasedArtifact = await callTool(45, "memory_forget", {
  target: { kind: "raw_artifact", id: directArtifactEvent.raw_artifact_ids[0], selector: {} },
  reason: directArtifactToken,
  dry_run: false,
  confirmation: { confirmed: true }
});
const directArtifactState = await client.query(
  `
    SELECT a.uri, a.sha256, a.size_bytes, a.content_type, a.excerpt, a.metadata, a.deleted_at,
           e.payload AS parent_payload, c.text AS parent_chunk
    FROM raw_artifacts a
    JOIN events e ON e.id = a.source_event_id
    JOIN chunks c ON c.source_event_id = e.id
    WHERE a.id = $1
  `,
  [directArtifactEvent.raw_artifact_ids[0]]
);
if (
  erasedArtifact.affected?.raw_artifacts !== 1 ||
  erasedArtifact.affected?.external_artifacts !== 1 ||
  !erasedArtifact.warnings?.some((warning) => warning.includes("external objects")) ||
  JSON.stringify(directArtifactState.rows).includes(directArtifactToken) ||
  directArtifactState.rows[0]?.uri !== "redacted://erasure" ||
  directArtifactState.rows[0]?.sha256 !== null ||
  directArtifactState.rows[0]?.size_bytes !== null ||
  directArtifactState.rows[0]?.content_type !== null ||
  directArtifactState.rows[0]?.excerpt !== null ||
  directArtifactState.rows[0]?.deleted_at === null ||
  directArtifactState.rows[0]?.parent_chunk !== "unrelated artifact parent remains readable"
) {
  throw new Error(
    `Direct raw-artifact scrub failed: ${JSON.stringify({ erasedArtifact, rows: directArtifactState.rows })}`
  );
}

const forgetMemoryToken = `forget_agent_memory_${randomUUID()}`;
const unrelatedMemoryToken = `unrelated_memory_${randomUUID()}`;
const unrelatedMemory = await callTool(46, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Unrelated governed memory control",
  body: unrelatedMemoryToken,
  created_by: "agent",
  confidence: 0.9,
  source_refs: [{ source_kind: "event", source_id: alpha.event_id, quote: unrelatedMemoryToken }]
});
const forgetMemory = await callTool(34, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: "Forget governed memory target",
  body: `${forgetMemoryToken} should disappear from governed memory recall and detail bodies.`,
  created_by: "agent",
  confidence: 0.9,
  metadata: { sentinel: forgetMemoryToken },
  source_refs: [
    { source_kind: "event", source_id: alpha.event_id, quote: `${forgetMemoryToken} source quote` }
  ]
});
await callTool(47, "memory_review_agent_memory", {
  memory_id: forgetMemory.memory_id,
  action: "edit",
  actor_kind: "agent",
  note: `${forgetMemoryToken} review note`,
  patch: { title: "Forget governed memory target" }
});
await client.query(
  `
    INSERT INTO recall_traces (
      developer_id, project_id, tool_name, query, returned_memory_ids, used_memory_ids, metadata
    ) VALUES ($1, $2, 'phase6_direct_memory_fixture', $3, $4, $4, $5)
  `,
  [
    developerId,
    projectId,
    forgetMemoryToken,
    JSON.stringify([forgetMemory.memory_id]),
    JSON.stringify({ sentinel: forgetMemoryToken })
  ]
);
const erasedMemory = await callTool(35, "memory_forget", {
  target: { kind: "agent_memory", id: forgetMemory.memory_id, selector: {} },
  reason: "phase6 governed memory forget",
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: "phase6-agent-memory" }
});
if (
  erasedMemory.status !== "completed" ||
  erasedMemory.redacted_receipt?.affected?.agent_memories !== 1 ||
  erasedMemory.redacted_receipt?.affected?.review_actions !== 1 ||
  erasedMemory.redacted_receipt?.affected?.recall_traces !== 1
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
  forgottenDetail.memory.review_reason !== null ||
  JSON.stringify(forgottenDetail.memory.metadata).includes(forgetMemoryToken) ||
  forgottenDetail.source_refs.some(
    (sourceRef) =>
      sourceRef.quote !== null ||
      sourceRef.source_id !== "[REDACTED]" ||
      JSON.stringify(sourceRef.metadata).includes(forgetMemoryToken)
  ) ||
  forgottenDetail.review_actions.some(
    (action) =>
      action.note !== null ||
      action.actor_id !== null ||
      JSON.stringify(action.metadata).includes(forgetMemoryToken)
  )
) {
  throw new Error(`Governed-memory detail was not redacted: ${JSON.stringify(forgottenDetail)}`);
}
const repeatedMemoryErase = await callTool(48, "memory_forget", {
  target: { kind: "agent_memory", id: forgetMemory.memory_id, selector: {} },
  reason: forgetMemoryToken,
  dry_run: false,
  confirmation: { confirmed: true }
});
if (
  repeatedMemoryErase.status !== "completed" ||
  JSON.stringify(repeatedMemoryErase).includes(forgetMemoryToken)
) {
  throw new Error(
    `Repeated governed-memory erase was unsafe: ${JSON.stringify(repeatedMemoryErase)}`
  );
}
const unrelatedDetail = await callTool(49, "memory_get_agent_memory", {
  memory_id: unrelatedMemory.memory_id
});
if (!String(unrelatedDetail.memory?.body).includes(unrelatedMemoryToken)) {
  throw new Error(`Unrelated governed memory was changed: ${JSON.stringify(unrelatedDetail)}`);
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

const searchEraseToken = `SEARCH_ERASE_SENTINEL_${randomUUID()}`;
const searchEvent = await callTool(60, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "tool_result",
  text: `${searchEraseToken} event payload`,
  metadata: { sentinel: searchEraseToken },
  raw_artifacts: [
    {
      artifact_kind: "tool_output",
      storage_backend: "postgres_inline",
      uri: `inline://${searchEraseToken}`,
      excerpt: searchEraseToken,
      metadata: { sentinel: searchEraseToken }
    }
  ],
  dedup_key: `phase6-search-erase-${randomUUID()}`
});
const searchMemory = await callTool(61, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  title: `${searchEraseToken} memory`,
  body: `${searchEraseToken} governed body`,
  created_by: "agent",
  confidence: 0.9,
  metadata: { sentinel: searchEraseToken },
  source_refs: [
    {
      source_kind: "event",
      source_id: searchEvent.event_id,
      quote: searchEraseToken,
      metadata: { sentinel: searchEraseToken }
    }
  ]
});
await callTool(62, "memory_review_agent_memory", {
  memory_id: searchMemory.memory_id,
  action: "edit",
  actor_kind: "agent",
  note: `${searchEraseToken} review action`,
  patch: { title: `${searchEraseToken} memory` }
});
await callTool(63, "memory_set_checkpoint", {
  payload: {
    current_status: searchEraseToken,
    current_focus: searchEraseToken,
    next_step: searchEraseToken,
    open_questions: []
  }
});
await client.query(
  `
    INSERT INTO recall_traces (
      developer_id, project_id, tool_name, query, returned_chunk_ids, returned_memory_ids, metadata
    ) VALUES ($1, $2, 'phase6_search_selector_fixture', $3, $4, $5, $6)
  `,
  [
    developerId,
    projectId,
    searchEraseToken,
    JSON.stringify(searchEvent.chunk_ids),
    JSON.stringify([searchMemory.memory_id]),
    JSON.stringify({ sentinel: searchEraseToken })
  ]
);
const foreignProjectId = randomUUID();
const foreignEventId = randomUUID();
await client.query(
  `
    INSERT INTO projects (id, developer_id, name, primary_path)
    VALUES ($1, $2, 'phase6 foreign erasure control', $3)
  `,
  [foreignProjectId, developerId, `${projectDir}-foreign`]
);
await client.query(
  `
    INSERT INTO events (id, project_id, ingest_source, kind, occurred_at, payload)
    VALUES ($1, $2, 'phase6_foreign_control', 'other', now(), $3)
  `,
  [foreignEventId, foreignProjectId, JSON.stringify({ text: searchEraseToken })]
);

const searchPreview = await callTool(64, "memory_forget", {
  target: { kind: "search_query", selector: { query: searchEraseToken } },
  reason: searchEraseToken,
  dry_run: true,
  confirmation: { confirmed: false }
});
if (
  searchPreview.affected?.events !== 1 ||
  searchPreview.affected?.agent_memories !== 1 ||
  searchPreview.affected?.raw_artifacts !== 1 ||
  searchPreview.affected?.review_actions !== 1 ||
  searchPreview.affected?.recall_traces !== 1 ||
  searchPreview.affected?.checkpoints !== 1 ||
  !searchPreview.confirmation_token
) {
  throw new Error(`Search erasure preview coverage failed: ${JSON.stringify(searchPreview)}`);
}
const staleMatch = await callTool(65, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "other",
  text: `${searchEraseToken} changed manifest`,
  dedup_key: `phase6-search-stale-${randomUUID()}`
});
await expectToolError(
  "memory_forget",
  {
    target: { kind: "search_query", selector: { query: searchEraseToken } },
    reason: searchEraseToken,
    dry_run: false,
    confirmation: { confirmed: true, confirmation_token: searchPreview.confirmation_token }
  },
  "confirmation token is missing, invalid, or stale"
);
const staleTargetBeforeConfirm = await client.query("SELECT text FROM chunks WHERE id = $1", [
  staleMatch.chunk_ids[0]
]);
if (!staleTargetBeforeConfirm.rows[0]?.text.includes(searchEraseToken)) {
  throw new Error("Stale confirmation mutated the changed manifest");
}
const refreshedSearchPreview = await callTool(66, "memory_forget", {
  target: { kind: "search_query", selector: { query: searchEraseToken } },
  reason: searchEraseToken,
  dry_run: true,
  confirmation: { confirmed: false }
});
const searchErased = await callTool(67, "memory_forget", {
  target: { kind: "search_query", selector: { query: searchEraseToken } },
  reason: searchEraseToken,
  dry_run: false,
  confirmation: {
    confirmed: true,
    confirmation_token: refreshedSearchPreview.confirmation_token
  }
});
if (
  searchErased.status !== "completed" ||
  searchErased.selection_digest !== refreshedSearchPreview.selection_digest ||
  JSON.stringify(searchErased).includes(searchEraseToken)
) {
  throw new Error(`Search erasure execution failed: ${JSON.stringify(searchErased)}`);
}
const searchReceipt = await client.query(
  `
    SELECT target_selector, reason, redacted_receipt
    FROM erasure_requests
    WHERE target_selector->>'selection_digest' = $1
  `,
  [searchErased.selection_digest]
);
if (
  searchReceipt.rowCount !== 1 ||
  searchReceipt.rows[0]?.reason !== null ||
  searchReceipt.rows[0]?.target_selector?.id !== null ||
  JSON.stringify(searchReceipt.rows).includes(searchEraseToken) ||
  searchReceipt.rows[0]?.redacted_receipt?.governance_receipt_content_free !== true
) {
  throw new Error(`Search erasure receipt leaked content: ${JSON.stringify(searchReceipt.rows)}`);
}
const searchCheckpoint = await callTool(68, "memory_get_checkpoint", {});
if (
  searchCheckpoint.payload?.current_status !== "idle" ||
  JSON.stringify(searchCheckpoint).includes(searchEraseToken)
) {
  throw new Error(
    `Search erasure checkpoint was not neutralized: ${JSON.stringify(searchCheckpoint)}`
  );
}
const foreignSearchControl = await client.query("SELECT payload FROM events WHERE id = $1", [
  foreignEventId
]);
if (!JSON.stringify(foreignSearchControl.rows).includes(searchEraseToken)) {
  throw new Error("Search erasure crossed the project boundary");
}

const scopeEraseId = `scope_erase_${randomUUID()}`;
const scopeEvent = await callTool(69, "memory_append_event", {
  session_id: started.session_id,
  client_kind: "codex",
  event_kind: "tool_result",
  text: `${scopeEraseId} scoped event`,
  raw_artifacts: [
    {
      artifact_kind: "tool_output",
      storage_backend: "postgres_inline",
      uri: `inline://${scopeEraseId}`,
      excerpt: scopeEraseId,
      metadata: { scope_id: scopeEraseId }
    }
  ],
  dedup_key: `phase6-scope-erase-${randomUUID()}`
});
await client.query(
  "UPDATE chunks SET scope_kind = 'case', scope_id = $2, audience = $3 WHERE id = $1",
  [scopeEvent.chunk_ids[0], scopeEraseId, JSON.stringify([{ kind: "case", id: scopeEraseId }])]
);
const scopeMemory = await callTool(70, "memory_create_agent_memory", {
  memory_type: "decision",
  scope: "project",
  scope_kind: "case",
  scope_id: scopeEraseId,
  audience: [{ kind: "all_agents", id: null }],
  title: `${scopeEraseId} scoped memory`,
  body: scopeEraseId,
  created_by: "agent",
  confidence: 0.9,
  metadata: { scope_id: scopeEraseId },
  source_refs: [{ source_kind: "event", source_id: scopeEvent.event_id, quote: scopeEraseId }]
});
await callTool(71, "memory_set_checkpoint", {
  payload: {
    current_status: scopeEraseId,
    current_focus: scopeEraseId,
    next_step: scopeEraseId,
    open_questions: []
  }
});
await expectToolError(
  "memory_forget",
  {
    target: { kind: "scope_selector", selector: { scope_kind: "case" } },
    dry_run: true,
    confirmation: { confirmed: false }
  },
  "requires bounded scope_kind and scope_id"
);
await expectToolError(
  "memory_forget",
  {
    target: {
      kind: "scope_selector",
      selector: { scope_kind: "case", scope_id: scopeEraseId, max_matches: 1 }
    },
    dry_run: true,
    confirmation: { confirmed: false }
  },
  "above max_matches 1"
);
const scopePreview = await callTool(72, "memory_forget", {
  target: {
    kind: "scope_selector",
    selector: { scope_kind: "case", scope_id: scopeEraseId }
  },
  reason: scopeEraseId,
  dry_run: true,
  confirmation: { confirmed: false }
});
await expectToolError(
  "memory_forget",
  {
    target: {
      kind: "scope_selector",
      selector: { scope_kind: "case", scope_id: scopeEraseId }
    },
    reason: scopeEraseId,
    dry_run: false,
    confirmation: { confirmed: true }
  },
  "confirmation token is missing, invalid, or stale"
);
const scopeErased = await callTool(73, "memory_forget", {
  target: {
    kind: "scope_selector",
    selector: { scope_kind: "case", scope_id: scopeEraseId }
  },
  reason: scopeEraseId,
  dry_run: false,
  confirmation: { confirmed: true, confirmation_token: scopePreview.confirmation_token }
});
if (
  scopeErased.affected?.events !== 1 ||
  scopeErased.affected?.chunks !== 1 ||
  scopeErased.affected?.raw_artifacts !== 1 ||
  scopeErased.affected?.agent_memories !== 1 ||
  scopeErased.affected?.checkpoints !== 1 ||
  JSON.stringify(scopeErased).includes(scopeEraseId)
) {
  throw new Error(`Scope erasure execution failed: ${JSON.stringify(scopeErased)}`);
}
const scopeState = await client.query(
  `
    SELECT
      (SELECT scope_kind FROM chunks WHERE id = $1) AS chunk_scope_kind,
      (SELECT scope_id FROM chunks WHERE id = $1) AS chunk_scope_id,
      (SELECT scope_kind FROM agent_memories WHERE id = $2) AS memory_scope_kind,
      (SELECT scope_id FROM agent_memories WHERE id = $2) AS memory_scope_id
  `,
  [scopeEvent.chunk_ids[0], scopeMemory.memory_id]
);
if (
  scopeState.rows[0]?.chunk_scope_kind !== "redacted" ||
  scopeState.rows[0]?.chunk_scope_id !== null ||
  scopeState.rows[0]?.memory_scope_kind !== "redacted" ||
  scopeState.rows[0]?.memory_scope_id !== null ||
  JSON.stringify(scopeState.rows).includes(scopeEraseId)
) {
  throw new Error(`Scope identifiers survived erasure: ${JSON.stringify(scopeState.rows)}`);
}

try {
  const checks = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM edges WHERE src_id = $1 AND dst_id = $2) AS edge_count,
        (SELECT count(*)::int FROM erasure_requests WHERE status = 'completed') AS erasure_count,
        (SELECT count(*)::int FROM embeddings WHERE chunk_id = $2::uuid) AS erased_embedding_count,
        (SELECT body FROM agent_memories WHERE id = $3) AS erased_memory_body,
        (SELECT count(*)::int FROM agent_memory_source_refs WHERE memory_id = $3 AND quote IS NULL) AS erased_memory_redacted_refs,
        (
          SELECT count(*)::int FROM (
            SELECT 'events' AS source, payload::text AS content FROM events WHERE project_id = $4
            UNION ALL SELECT 'chunks', text FROM chunks WHERE project_id = $4
            UNION ALL SELECT 'raw_artifacts', concat_ws(' ', uri, excerpt, metadata::text) FROM raw_artifacts WHERE project_id = $4
            UNION ALL SELECT 'agent_memories', concat_ws(' ', title, body, review_reason, metadata::text) FROM agent_memories WHERE project_id = $4
            UNION ALL SELECT 'source_refs', concat_ws(' ', r.source_id, r.quote, r.metadata::text) FROM agent_memory_source_refs r JOIN agent_memories m ON m.id = r.memory_id WHERE m.project_id = $4
            UNION ALL SELECT 'review_actions', concat_ws(' ', a.note, a.metadata::text) FROM agent_memory_review_actions a JOIN agent_memories m ON m.id = a.memory_id WHERE m.project_id = $4
            UNION ALL SELECT 'recall_traces', concat_ws(' ', query, metadata::text) FROM recall_traces WHERE project_id = $4
            UNION ALL SELECT 'erasure_requests', concat_ws(' ', reason, target_selector::text, redacted_receipt::text) FROM erasure_requests WHERE project_id = $4
            UNION ALL SELECT 'edges', metadata::text FROM edges WHERE project_id = $4
          ) content_rows
          WHERE content ILIKE ANY($5::text[])
        ) AS erased_sentinel_matches,
        (
          SELECT coalesce(jsonb_agg(jsonb_build_object('source', source, 'content', content) ORDER BY source), '[]'::jsonb) FROM (
            SELECT 'events' AS source, payload::text AS content FROM events WHERE project_id = $4
            UNION ALL SELECT 'chunks', text FROM chunks WHERE project_id = $4
            UNION ALL SELECT 'raw_artifacts', concat_ws(' ', uri, excerpt, metadata::text) FROM raw_artifacts WHERE project_id = $4
            UNION ALL SELECT 'agent_memories', concat_ws(' ', title, body, review_reason, metadata::text) FROM agent_memories WHERE project_id = $4
            UNION ALL SELECT 'source_refs', concat_ws(' ', r.source_id, r.quote, r.metadata::text) FROM agent_memory_source_refs r JOIN agent_memories m ON m.id = r.memory_id WHERE m.project_id = $4
            UNION ALL SELECT 'review_actions', concat_ws(' ', a.note, a.metadata::text) FROM agent_memory_review_actions a JOIN agent_memories m ON m.id = a.memory_id WHERE m.project_id = $4
            UNION ALL SELECT 'recall_traces', concat_ws(' ', query, metadata::text) FROM recall_traces WHERE project_id = $4
            UNION ALL SELECT 'erasure_requests', concat_ws(' ', reason, target_selector::text, redacted_receipt::text) FROM erasure_requests WHERE project_id = $4
            UNION ALL SELECT 'edges', metadata::text FROM edges WHERE project_id = $4
          ) content_rows
          WHERE content ILIKE ANY($5::text[])
        ) AS erased_sentinel_sources
    `,
    [
      alpha.chunk_ids[0],
      beta.chunk_ids[0],
      forgetMemory.memory_id,
      projectId,
      [
        `%${rawSentinel}%`,
        `%${directArtifactToken}%`,
        `%${betaTraceToken}%`,
        `%${forgetMemoryToken}%`,
        `%${searchEraseToken}%`,
        `%${scopeEraseId}%`
      ]
    ]
  );
  const row = checks.rows[0];
  if (
    row.edge_count !== 0 ||
    row.erasure_count < 2 ||
    row.erased_embedding_count !== 0 ||
    row.erased_memory_body !== "[REDACTED]" ||
    row.erased_memory_redacted_refs !== 1 ||
    row.erased_sentinel_matches !== 0
  ) {
    throw new Error(`Graph/context/forget DB state failed: ${JSON.stringify(row)}`);
  }
} finally {
  await client.end();
}

await mcpClient.close();
await mcpServer.close();
restoreEnv(mcpEnvSnapshot);

process.stdout.write("Phase 6 graph/context/forget smoke passed\n");
