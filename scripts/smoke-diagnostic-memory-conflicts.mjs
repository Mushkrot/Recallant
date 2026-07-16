import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-diagnostic-conflicts-"));
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function acceptedMemory({ title, body, diagnosticMarker }) {
  const memory = await db.createAgentMemory({
    project_id: projectId,
    project_path: projectPath,
    memory_type: "environment_fact",
    scope: "project",
    title,
    body,
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: `diagnostic-conflict-smoke:${randomUUID()}`,
        quote: "Synthetic non-secret regression evidence."
      }
    ],
    metadata: diagnosticMarker ? { diagnostic_marker: true } : { smoke: true }
  });
  await db.reviewAgentMemory({
    memory_id: memory.memory_id,
    action: "accept",
    actor_kind: "system",
    note: "diagnostic conflict regression fixture"
  });
  return String(memory.memory_id);
}

try {
  await db.registerProject({
    projectId,
    developerId,
    projectPath,
    name: "diagnostic-conflict-smoke",
    captureProfile: "standard"
  });
  const diagnosticIds = [
    await acceptedMemory({
      title: "Local doctor semantic marker",
      body: "Diagnostic marker body alpha",
      diagnosticMarker: true
    }),
    await acceptedMemory({
      title: "Local doctor semantic marker",
      body: "Diagnostic marker body beta",
      diagnosticMarker: true
    })
  ];
  const genuineIds = [
    await acceptedMemory({
      title: "Real owner policy conflict",
      body: "Use policy alpha.",
      diagnosticMarker: false
    }),
    await acceptedMemory({
      title: "Real owner policy conflict",
      body: "Use policy beta.",
      diagnosticMarker: false
    })
  ];

  const conflicts = await db.listAgentMemories({ project_id: projectId, view: "conflicts" });
  const conflictIds = conflicts.memories.map((memory) => String(memory.memory_id));
  assert(
    diagnosticIds.every((memoryId) => !conflictIds.includes(memoryId)),
    `diagnostic markers leaked into conflict review: ${JSON.stringify(conflictIds)}`
  );
  assert(
    genuineIds.every((memoryId) => conflictIds.includes(memoryId)),
    `genuine conflict was not reported: ${JSON.stringify(conflictIds)}`
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        diagnostic_memory_conflicts_smoke: "passed",
        diagnostic_markers_excluded: diagnosticIds.length,
        genuine_conflicts_reported: genuineIds.length
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
  await rm(projectPath, { recursive: true, force: true });
}
