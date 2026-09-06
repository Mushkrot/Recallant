import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";
import pg from "pg";

// Explicit disposable database only; never inherit the service database URL.
const databaseUrl = process.env.RECALLANT_SECURITY_TEST_DATABASE_URL;
assert(databaseUrl, "RECALLANT_SECURITY_TEST_DATABASE_URL must select a disposable test database");
const target = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(target.hostname));
assert(target.pathname.startsWith("/recallant_security_validation_"));
const developerId = randomUUID();
const projects = [randomUUID(), randomUUID()];
const databases = projects.map(
  (projectId) =>
    new RecallantDb({
      databaseUrl,
      developerId,
      projectId,
      projectPath: `/tmp/recallant-security-${projectId}`
    })
);
const [database] = databases;
const server = createRecallantHttpServer({ remoteMcpDatabase: database });
const results = [];
try {
  for (const db of databases) await db.ensureProject();
  const setup = new pg.Client({ connectionString: databaseUrl });
  await setup.connect();
  try {
    await setup.query(
      `INSERT INTO developer_settings (developer_id, key, value, updated_by)
      VALUES ($1, 'embedding_route', $2, 'synthetic-test')
      ON CONFLICT (developer_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [
        developerId,
        JSON.stringify({
          route_class: "local_model",
          provider: "deterministic",
          model: "deterministic-security-test",
          dims: 768
        })
      ]
    );
  } finally {
    await setup.end();
  }
  await database.ensureSystemActivitySchema();
  const credentials = await Promise.all(
    projects.map((projectId) =>
      database.createRemoteMcpCredential({ projectId, developerId, clientId: "synthetic-client" })
    )
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/mcp`;
  async function call(project, name, args, invalid = false) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${invalid ? "synthetic-invalid" : credentials[project].secret}`,
        "x-recallant-project-id": projects[project],
        "x-recallant-developer-id": developerId,
        "x-recallant-client-id": "synthetic-client"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args }
      })
    });
    const body = await response.json();
    return {
      status: response.status,
      payload: body.result?.structuredContent,
      error: body.error?.data?.code
    };
  }
  const ordinary = {
    memory_type: "work_log",
    scope: "project",
    title: "Synthetic marker",
    body: "Neutral synthetic memory marker.",
    created_by: "agent",
    source_refs: [],
    audience: []
  };
  const foreign = await call(1, "memory_create_agent_memory", ordinary);
  assert.equal(foreign.status, 200, "legitimate project B creation");
  assert.equal(foreign.payload.status, "accepted");
  await database.createAgentMemory({
    ...ordinary,
    project_id: projects[0],
    scope: "developer",
    title: "Synthetic developer candidate",
    body: "uniquedevelopercandidate",
    source_refs: [{ source_kind: "external", source_id: "synthetic" }]
  });
  const referenceSetup = new pg.Client({ connectionString: databaseUrl });
  await referenceSetup.connect();
  let foreignSourceId;
  try {
    foreignSourceId = (
      await referenceSetup.query("SELECT id FROM project_sources WHERE project_id = $1 LIMIT 1", [
        projects[1]
      ])
    ).rows[0].id;
  } finally {
    await referenceSetup.end();
  }
  const externalRef = await call(0, "memory_create_agent_memory", {
    ...ordinary,
    source_refs: [{ source_kind: "external", source_id: foreignSourceId }]
  });
  assert.equal(externalRef.status, 200, "external labels remain valid provenance");
  const sessions = await Promise.all(
    projects.map((_, index) =>
      call(index, "memory_start_session", {
        client_kind: "generic",
        session_label: "Synthetic boundary session",
        resume_policy: "normal"
      })
    )
  );
  assert(
    sessions.every((result) => result.status === 200),
    "both legitimate sessions start"
  );
  const session = (index) => sessions[index].payload.session_id;
  const sessionless = await call(1, "memory_append_event", {
    client_kind: "generic",
    event_kind: "other",
    text: "syntheticsessionlessevent",
    metadata: {}
  });
  assert.equal(sessionless.status, 200, "sessionless capture remains available");
  const captureRead = new pg.Client({ connectionString: databaseUrl });
  await captureRead.connect();
  try {
    const eventRow = await captureRead.query("SELECT project_id FROM events WHERE id = $1", [
      sessionless.payload.event_id
    ]);
    assert.equal(
      eventRow.rows[0].project_id,
      projects[1],
      "sessionless event uses authenticated B, not server default A"
    );
  } finally {
    await captureRead.end();
  }
  const tests = [
    [
      "external source cannot resolve foreign details",
      () => call(0, "memory_get_agent_memory", { memory_id: externalRef.payload.memory_id }),
      false
    ],
    [
      "project recall excludes developer candidate",
      () =>
        call(0, "memory_recall_agent_memories", {
          query: "uniquedevelopercandidate",
          scope: "project",
          include_candidates: true
        }),
      false
    ],
    [
      "own graph memory reference allowed",
      () =>
        call(1, "memory_create_graph_candidate", {
          candidate_kind: "node",
          node_kind: "topic",
          title: "Synthetic graph candidate",
          extraction_method: "agent",
          created_by: "agent",
          source_refs: [{ source_kind: "agent_memory", source_id: foreign.payload.memory_id }]
        }),
      false
    ],
    [
      "foreign graph memory reference rejected",
      () =>
        call(0, "memory_create_graph_candidate", {
          candidate_kind: "node",
          node_kind: "topic",
          title: "Synthetic graph candidate",
          extraction_method: "agent",
          created_by: "agent",
          source_refs: [{ source_kind: "agent_memory", source_id: foreign.payload.memory_id }]
        }),
      true
    ],
    [
      "invalid credential rejected",
      () => call(0, "memory_list_agent_memories", { view: "all" }, true),
      true
    ],
    [
      "own project list allowed",
      () => call(0, "memory_list_agent_memories", { view: "all" }),
      false
    ],
    [
      "foreign project argument rejected",
      () => call(0, "memory_list_agent_memories", { view: "all", project_id: projects[1] }),
      true
    ],
    [
      "foreign memory ID rejected",
      () => call(0, "memory_get_agent_memory", { memory_id: foreign.payload.memory_id }),
      true
    ],
    [
      "own memory ID allowed",
      () => call(1, "memory_get_agent_memory", { memory_id: foreign.payload.memory_id }),
      false
    ],
    [
      "foreign session heartbeat rejected",
      () => call(0, "memory_heartbeat", { session_id: session(1), status: "active" }),
      true
    ],
    [
      "own session heartbeat allowed",
      () => call(1, "memory_heartbeat", { session_id: session(1), status: "active" }),
      false
    ],
    [
      "foreign session context rejected",
      () => call(0, "memory_get_context_pack", { session_id: session(1) }),
      true
    ],
    [
      "own session context allowed",
      () => call(1, "memory_get_context_pack", { session_id: session(1) }),
      false
    ],
    [
      "foreign project path rejected",
      () =>
        call(0, "memory_start_session", {
          client_kind: "generic",
          project_dir: `/tmp/recallant-security-${projects[1]}`
        }),
      true
    ],
    [
      "foreign memory source reference rejected",
      () =>
        call(0, "memory_create_agent_memory", {
          ...ordinary,
          source_refs: [{ source_kind: "event", source_id: sessionless.payload.event_id }]
        }),
      true
    ],
    [
      "owner impersonation rejected",
      () =>
        call(0, "memory_create_agent_memory", {
          ...ordinary,
          scope: "developer",
          created_by: "user",
          metadata: { owner_confirmed_global_rule: true }
        }),
      true
    ],
    [
      "agent self promotion rejected",
      () =>
        call(1, "memory_review_agent_memory", {
          memory_id: foreign.payload.memory_id,
          action: "promote_instruction",
          actor_kind: "agent"
        }),
      true
    ],
    [
      "owner promotion impersonation rejected",
      () =>
        call(1, "memory_review_agent_memory", {
          memory_id: foreign.payload.memory_id,
          action: "promote_instruction",
          actor_kind: "user"
        }),
      true
    ]
  ];
  const expectedErrors = {
    "foreign graph memory reference rejected": [400, "VALIDATION_ERROR"],
    "invalid credential rejected": [401, "INVALID_SCOPE_TOKEN"],
    "foreign project argument rejected": [400, "VALIDATION_ERROR"],
    "foreign memory ID rejected": [400, "VALIDATION_ERROR"],
    "foreign session heartbeat rejected": [400, "VALIDATION_ERROR"],
    "foreign session context rejected": [400, "VALIDATION_ERROR"],
    "foreign project path rejected": [400, "VALIDATION_ERROR"],
    "foreign memory source reference rejected": [400, "VALIDATION_ERROR"],
    "owner impersonation rejected": [403, "POLICY_BLOCKED"],
    "agent self promotion rejected": [403, "POLICY_BLOCKED"],
    "owner promotion impersonation rejected": [403, "POLICY_BLOCKED"]
  };
  async function contentSnapshot() {
    const observer = new pg.Client({ connectionString: databaseUrl });
    await observer.connect();
    try {
      const snapshot = {};
      for (const table of [
        "agent_memories",
        "agent_memory_source_refs",
        "agent_memory_review_actions",
        "sessions",
        "events",
        "chunks",
        "edges",
        "graph_candidates",
        "checkpoints"
      ]) {
        const result = await observer.query(`SELECT count(*)::int AS count,
          md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) AS digest FROM ${table} t`);
        snapshot[table] = result.rows[0];
      }
      return snapshot;
    } finally {
      await observer.end();
    }
  }
  for (const [name, run, reject] of tests) {
    const before = reject ? await contentSnapshot() : null;
    const result = await run();
    const [expectedStatus, expectedCode] = reject ? expectedErrors[name] : [200, null];
    const unchanged = !reject || JSON.stringify(before) === JSON.stringify(await contentSnapshot());
    const pass =
      result.status === expectedStatus && (result.error ?? null) === expectedCode && unchanged;
    if (name === "own memory ID allowed") {
      assert.equal(result.payload.memory.body, ordinary.body, "own memory body is returned");
    }
    if (name === "own project list allowed") {
      assert(
        !result.payload.memories.some((memory) => memory.memory_id === foreign.payload.memory_id),
        "view all must not leak project B memory"
      );
    }
    if (name === "project recall excludes developer candidate") {
      assert.equal(
        result.payload.memories.length,
        0,
        "project recall must exclude developer candidates"
      );
    }
    if (name === "external source cannot resolve foreign details") {
      assert(
        result.payload.source_refs.every((ref) => ref.project_source == null),
        "external reference must not resolve foreign project source"
      );
    }
    results.push({
      name,
      pass,
      http_status: result.status,
      error: result.error ?? null,
      rejected_content_unchanged: reject ? unchanged : null,
      memory_status: result.payload?.status ?? null,
      use_policy: result.payload?.use_policy ?? null
    });
  }
  const reviewed = await databases[1].reviewAgentMemory({
    memory_id: foreign.payload.memory_id,
    action: "promote_instruction",
    actor_kind: "user"
  });
  assert.equal(reviewed.use_policy, "instruction_grade", "trusted owner review remains available");
  const closeout = await call(1, "memory_closeout", {
    session_id: session(1),
    closeout_intent: "task_complete",
    summary: "Neutral synthetic completion marker.",
    checkpoint_payload: {
      current_status: "complete",
      current_focus: "Synthetic marker",
      next_step: "Read the marker",
      open_questions: []
    }
  });
  assert.equal(closeout.status, 200, "legitimate closeout returns successfully");
  assert.equal(
    closeout.payload.lifecycle.next_agent_ready,
    true,
    "neutral closeout semantic and next-session proof remains ready"
  );
  process.stdout.write(`${JSON.stringify({ tests: results }, null, 2)}\n`);
  assert(
    results.every((test) => test.pass),
    "remote MCP authorization boundaries failed"
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(databases.map((db) => db.close()));
}
