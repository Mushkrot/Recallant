import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const codeProjectId = randomUUID();
const codeProjectPath = await mkdtemp(join(tmpdir(), "recallant-stage6-code-"));
const marker = `stage6-personal-isolation-${randomUUID()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: codeProjectId,
  projectPath: codeProjectPath
});

try {
  await db.ensureProject(codeProjectPath);
  const personalSpace = await db.createMemorySpace({
    name: "Personal Operations Isolation Smoke",
    developerId,
    projectKind: "personal_domain",
    memoryDomain: "personal_life",
    primaryPath: null
  });
  assert(
    personalSpace.memory_profile?.profile_key === "personal_work_operations",
    `personal/work profile missing: ${JSON.stringify(personalSpace)}`
  );

  const personalMemory = await db.createAgentMemory({
    project_id: String(personalSpace.project_id),
    memory_type: "decision",
    scope: "project",
    scope_kind: "domain",
    scope_id: String(personalSpace.project_id),
    audience: [{ kind: "owner", id: developerId }],
    title: "Personal operations smoke memory",
    body: `Personal/work operations memory ${marker} must not enter coding-agent startup context.`,
    confidence: 0.93,
    created_by: "user",
    source_refs: [
      {
        source_kind: "external",
        source_id: `manual:${marker}`,
        quote: `Personal/work operations memory ${marker}`,
        metadata: {
          memory_space_profile: "personal_work_operations",
          source_policy: "manual_owner_supplied"
        }
      }
    ],
    metadata: {
      stage6_smoke: true,
      write_policy: "manual_owner_mediated",
      passive_capture: false
    }
  });
  assert(
    personalMemory.memory_id,
    `personal memory was not written: ${JSON.stringify(personalMemory)}`
  );

  const codeSession = await db.startSession({
    client_kind: "codex",
    client_version: "stage6-smoke",
    project_path: codeProjectPath,
    session_label: "stage6-personal-isolation"
  });
  const codeContext = await db.getContextPack({
    session_id: codeSession.session_id,
    task_hint: `coding project startup should not include ${marker}`,
    include_raw_evidence: "never"
  });
  assert(
    !JSON.stringify(codeContext).includes(marker),
    `coding-agent context leaked personal memory: ${JSON.stringify(codeContext)}`
  );

  const explicitRecall = await db.recallAgentMemories({
    project_id: String(personalSpace.project_id),
    query: marker,
    top_k: 5
  });
  const recalled = explicitRecall.memories.find((memory) =>
    String(memory.body ?? "").includes(marker)
  );
  assert(
    recalled,
    `explicit personal recall did not return marker: ${JSON.stringify(explicitRecall)}`
  );
  assert(
    Array.isArray(recalled.source_refs) && recalled.source_refs.length > 0,
    `explicit personal recall should be source-linked: ${JSON.stringify(recalled)}`
  );

  const codeRecall = await db.recallAgentMemories({
    project_id: codeProjectId,
    query: marker,
    top_k: 5
  });
  assert(
    !codeRecall.memories.some((memory) => String(memory.body ?? "").includes(marker)),
    `same query from coding project recalled personal memory by default: ${JSON.stringify(codeRecall)}`
  );
} finally {
  await db.close();
  await rm(codeProjectPath, { recursive: true, force: true });
}

process.stdout.write("Stage 6 personal isolation smoke passed\n");
