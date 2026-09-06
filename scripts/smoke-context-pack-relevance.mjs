import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl = process.env.RECALLANT_DATABASE_URL;
if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required");

const developerId = randomUUID();
const projectId = randomUUID();
const otherProjectId = randomUUID();
const projectPath = `/tmp/recallant-context-relevance-${projectId}`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });

async function insertMemory({ project = projectId, title, body, type = "decision", metadata = {}, policy = "recall_allowed", updatedAt }) {
  const result = await db.pool.query(
    `INSERT INTO agent_memories (
       developer_id, project_id, scope, scope_kind, scope_id, audience,
       memory_type, title, body, status, use_policy, confidence, created_by, metadata, updated_at
     ) VALUES ($1, $2, 'project', 'project', $9, '[]'::jsonb, $3, $4, $5,
               'accepted', $6, 0.95, 'agent', $7::jsonb, $8)
     RETURNING id`,
    [developerId, project, type, title, body, policy, JSON.stringify(metadata), updatedAt, project]
  );
  return String(result.rows[0].id);
}

try {
  await db.ensureProject(projectPath);
  await db.pool.query(
    "INSERT INTO projects (id, developer_id, primary_path, name) VALUES ($1, $2, $3, 'foreign relevance fixture')",
    [otherProjectId, developerId, `/tmp/foreign-${otherProjectId}`]
  );
  const session = await db.startSession({
    client_kind: "codex",
    client_version: "r2-smoke",
    project_path: projectPath,
    session_label: "context relevance"
  });
  const oldCloseoutId = await insertMemory({
    title: "MCP startup context closeout",
    body: "Historical MCP startup context handoff from an old task.",
    type: "work_log",
    metadata: { created_from: "memory_closeout_lifecycle" },
    updatedAt: "2020-01-01T00:00:00.000Z"
  });
  const billingId = await insertMemory({
    title: "Billing invoice export repair",
    body: "The current invoice export pipeline needs a repair before the next release.",
    updatedAt: "2026-08-11T00:00:00.000Z"
  });
  const searchId = await insertMemory({
    title: "Search indexing repair",
    body: "The search index rebuild has a separate failure mode and owner.",
    updatedAt: "2026-08-11T00:00:00.000Z"
  });
  const foreignId = await insertMemory({
    project: otherProjectId,
    title: "Billing invoice export repair from another project",
    body: "Foreign project memory must not enter ordinary startup context.",
    updatedAt: "2026-08-11T00:00:00.000Z"
  });
  const ruleId = await insertMemory({
    title: "Approved billing rule",
    body: "Keep billing changes reviewable.",
    type: "procedure",
    policy: "instruction_grade",
    updatedAt: "2026-08-11T00:00:00.000Z"
  });

  const billingPack = await db.getContextPack({
    session_id: session.session_id,
    task_hint: "repair the billing invoice export pipeline",
    include_raw_evidence: "never",
    max_chars_total: 8000
  });
  const billingWorking = billingPack.sections.working_memories;
  assert(billingWorking.some((memory) => memory.memory_id === billingId));
  assert(!billingWorking.some((memory) => memory.memory_id === oldCloseoutId));
  assert(!billingWorking.some((memory) => memory.memory_id === searchId));
  assert(!billingWorking.some((memory) => memory.memory_id === foreignId));
  assert(!billingWorking.some((memory) => memory.memory_id === ruleId));
  assert(billingPack.sections.binding_rules.some((memory) => memory.memory_id === ruleId));

  const searchPack = await db.getContextPack({
    session_id: session.session_id,
    task_hint: "repair the search indexing failure",
    include_raw_evidence: "never",
    max_chars_total: 8000
  });
  const searchWorking = searchPack.sections.working_memories;
  assert(searchWorking.some((memory) => memory.memory_id === searchId));
  assert(!searchWorking.some((memory) => memory.memory_id === billingId));
  assert(!searchWorking.some((memory) => memory.memory_id === oldCloseoutId));

  const genericPack = await db.getContextPack({
    session_id: session.session_id,
    task_hint: "MCP startup context",
    include_raw_evidence: "never",
    max_chars_total: 8000
  });
  assert.equal(genericPack.sections.working_memories.length, 0);

  const explicitHistory = await db.recallAgentMemories({
    project_id: projectId,
    query: "MCP startup context",
    top_k: 8
  });
  assert(explicitHistory.memories.some((memory) => memory.memory_id === oldCloseoutId));

  process.stdout.write(
    `${JSON.stringify({ status: "pass", billing_id: billingId, search_id: searchId })}\n`
  );
} finally {
  await db.pool.query("DELETE FROM projects WHERE id = ANY($1::uuid[])", [[projectId, otherProjectId]]);
  await db.close();
}
