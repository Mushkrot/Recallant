import { randomUUID } from "node:crypto";
import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";
const developerId = randomUUID();
const projectA = {
  id: randomUUID(),
  path: `/tmp/recallant-cross-project-a-${randomUUID()}`
};
const projectB = {
  id: randomUUID(),
  path: `/tmp/recallant-cross-project-b-${randomUUID()}`
};
const marker = `cross_project_fixture_${randomUUID().replaceAll("-", "_")}`;

function dbFor(project) {
  return new RecallantDb({
    databaseUrl,
    developerId,
    projectId: project.id,
    projectPath: project.path
  });
}

async function countProjectMemories(projectId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM agent_memories WHERE project_id = $1",
      [projectId]
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

async function getMemory(memoryId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT m.project_id, m.status, m.use_policy,
               (SELECT count(*)::int FROM agent_memory_source_refs r WHERE r.memory_id = m.id) AS source_ref_count
        FROM agent_memories m
        WHERE m.id = $1
      `,
      [memoryId]
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

const aDb = dbFor(projectA);
const bDb = dbFor(projectB);

try {
  await aDb.registerProject({
    projectId: projectA.id,
    developerId,
    projectPath: projectA.path,
    captureProfile: "standard"
  });
  await bDb.registerProject({
    projectId: projectB.id,
    developerId,
    projectPath: projectB.path,
    captureProfile: "standard"
  });

  const bPattern = await bDb.createAgentMemory({
    project_path: projectB.path,
    memory_type: "procedure",
    scope: "project",
    scope_kind: "project",
    scope_id: projectB.id,
    audience: [{ kind: "all_agents", id: null }],
    title: "Google Drive connector pattern",
    body: `A working Google Drive connector example uses an OAuth client helper and stores only secret references. Marker ${marker}.`,
    confidence: 0.92,
    created_by: "system",
    source_refs: [
      {
        source_kind: "external",
        source_id: "docs/google-drive-connector.md",
        quote: `Google Drive connector implementation note for ${marker}.`,
        metadata: {
          source_path: "docs/google-drive-connector.md",
          source_project_id: projectB.id
        }
      }
    ]
  });

  const bCapability = await bDb.createAgentMemory({
    project_path: projectB.path,
    memory_type: "artifact_reference",
    scope: "project",
    scope_kind: "capability",
    scope_id: "google_drive",
    audience: [{ kind: "all_agents", id: null }],
    title: "Google Drive capability secret reference",
    body: `Google Drive capability exists, but raw values must stay out of Recallant. OPENAI_API_KEY=sk-${marker} should be redacted in cross-project output.`,
    confidence: 0.9,
    created_by: "system",
    source_refs: [
      {
        source_kind: "external",
        source_id: "docs/capability.md",
        quote: `Capability note includes OPENAI_API_KEY=sk-${marker}.`,
        metadata: { source_path: "docs/capability.md" }
      }
    ]
  });

  const developerRule = await aDb.createAgentMemory({
    project_path: projectA.path,
    memory_type: "preference",
    scope: "developer",
    scope_kind: "developer",
    scope_id: developerId,
    audience: [{ kind: "all_agents", id: null }],
    title: "Cross-project smoke developer rule",
    body: `Developer-level rule for ${marker}: prefer source-linked examples over copied blind rules.`,
    confidence: 0.95,
    created_by: "system"
  });
  await aDb.reviewAgentMemory({
    memory_id: developerRule.memory_id,
    action: "promote_instruction",
    actor_kind: "system",
    note: "Phase 10 cross-project smoke fixture"
  });

  const beforeApplyCount = await countProjectMemories(projectA.id);
  const session = await aDb.startSession({
    client_kind: "codex",
    project_path: projectA.path,
    session_label: "phase10-cross-project-smoke",
    resume_policy: "normal"
  });
  const contextPack = await aDb.getContextPack({
    session_id: session.session_id,
    task_hint: `Need Google Drive example ${marker}`,
    include_raw_evidence: "auto",
    include_recovery: true
  });
  if (JSON.stringify(contextPack).includes(bPattern.memory_id) || JSON.stringify(contextPack).includes(projectB.id)) {
    throw new Error(`Default context pack leaked project B memory: ${JSON.stringify(contextPack)}`);
  }

  const similar = await aDb.crossProjectRecall({
    query: marker,
    mode: "similar_projects",
    top_k: 5,
    max_chars_total: 4000
  });
  const hit = similar.results.find((result) => result.memory_id === bPattern.memory_id);
  if (
    !hit ||
    hit.source_project?.project_id !== projectB.id ||
    hit.source_path !== "docs/google-drive-connector.md" ||
    hit.status !== "accepted" ||
    hit.use_policy !== "recall_allowed" ||
    hit.applicability !== "example_only" ||
    !hit.applicability_warning.includes("current-project rule")
  ) {
    throw new Error(`Explicit similar-project recall failed: ${JSON.stringify(similar)}`);
  }

  const developerRecall = await aDb.crossProjectRecall({
    query: marker,
    mode: "developer_rules",
    top_k: 5
  });
  if (
    !developerRecall.results.some(
      (result) =>
        result.memory_id === developerRule.memory_id &&
        result.use_policy === "instruction_grade" &&
        result.applicability === "directly_applicable"
    )
  ) {
    throw new Error(`Developer-rule recall failed: ${JSON.stringify(developerRecall)}`);
  }

  const environmentRecall = await aDb.crossProjectRecall({
    query: "OPENAI_API_KEY",
    mode: "environment",
    include_detached: false,
    top_k: 5
  });
  const capabilityHit = environmentRecall.results.find(
    (result) => result.memory_id === bCapability.memory_id
  );
  if (
    !capabilityHit ||
    JSON.stringify(capabilityHit).includes(`sk-${marker}`) ||
    !JSON.stringify(capabilityHit).includes("<redacted")
  ) {
    throw new Error(`Environment/capability recall leaked secret value: ${JSON.stringify(environmentRecall)}`);
  }

  const afterRecallCount = await countProjectMemories(projectA.id);
  if (afterRecallCount !== beforeApplyCount) {
    throw new Error("Cross-project recall created current-project memory before application.");
  }

  const applied = await aDb.createAgentMemory({
    project_path: projectA.path,
    memory_type: "decision",
    scope: "project",
    scope_kind: "project",
    scope_id: projectA.id,
    audience: [{ kind: "all_agents", id: null }],
    title: "Applied Google Drive connector example",
    body: `Project A applied the source-linked Google Drive connector pattern from project B for ${marker}.`,
    confidence: 0.86,
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: bPattern.memory_id,
        quote: "Applied after inspecting the source-linked cross-project example.",
        metadata: {
          source_project_id: projectB.id,
          source_memory_id: bPattern.memory_id,
          recall_trace_id: similar.trace_id
        }
      }
    ]
  });
  const appliedRow = await getMemory(applied.memory_id);
  if (
    appliedRow?.project_id !== projectA.id ||
    appliedRow?.use_policy === "instruction_grade" ||
    appliedRow?.source_ref_count < 1
  ) {
    throw new Error(`Applied pattern did not create safe project-A memory: ${JSON.stringify(appliedRow)}`);
  }

  if (!similar.policy || similar.policy.default_context_pack_includes_cross_project_examples !== false) {
    throw new Error(`Cross-project policy metadata missing: ${JSON.stringify(similar)}`);
  }
} finally {
  await Promise.allSettled([aDb.close(), bDb.close()]);
}

process.stdout.write("Phase 10 cross-project recall smoke passed\n");
