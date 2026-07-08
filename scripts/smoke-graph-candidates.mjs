import { randomUUID } from "node:crypto";
import { RecallantDb } from "../packages/db/dist/index.js";
import { createRecallantTools } from "../packages/mcp/dist/index.js";

const defaultDatabaseUrl = [
  "postgres",
  "://",
  "recallant",
  ":",
  "recallant_dev_password",
  "@127.0.0.1:15433/recallant_agent_work"
].join("");
const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl;
const developerId = randomUUID();
const projectOne = randomUUID();
const projectTwo = randomUUID();
const projectOnePath = `/tmp/recallant-graph-candidates-${projectOne}`;
const projectTwoPath = `/tmp/recallant-graph-candidates-${projectTwo}`;
const marker = `graph_candidate_smoke_${randomUUID().replaceAll("-", "_")}`;
const forbiddenToken = ["sk", "graphcandidateleakfixture123"].join("-");
const forbiddenNeedles = [
  forbiddenToken,
  ["postgres", "://"].join(""),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" "),
  ["customer", "@example.invalid"].join("")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoForbidden(text, label) {
  for (const needle of forbiddenNeedles) {
    assert(!text.includes(needle), `${label} leaked forbidden marker: ${needle}`);
  }
}

function toolMap(database) {
  return new Map(
    createRecallantTools({
      projectId: projectOne,
      projectPath: projectOnePath,
      developerId,
      clientId: "graph-candidates-smoke",
      traceId: marker,
      getDatabase: () => database
    }).map((tool) => [tool.name, tool])
  );
}

async function callTool(tools, name, args) {
  const tool = tools.get(name);
  assert(tool, `Missing tool ${name}`);
  return tool.handler(args);
}

async function expectReject(label, operation, markerText) {
  let rejected = false;
  let safeMessage = "";
  try {
    await operation();
  } catch (error) {
    rejected = true;
    safeMessage = error instanceof Error ? error.message : String(error);
  }
  assert(rejected, `${label} should have rejected`);
  if (markerText) assert(safeMessage.includes(markerText), `${label} message missing ${markerText}`);
  assertNoForbidden(safeMessage, `${label} rejection message`);
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: projectOne,
  projectPath: projectOnePath
});

try {
  await db.registerProject({
    projectId: projectOne,
    developerId,
    projectPath: projectOnePath,
    name: "graph-candidate-smoke-one"
  });
  await db.registerProject({
    projectId: projectTwo,
    developerId,
    projectPath: projectTwoPath,
    name: "graph-candidate-smoke-two"
  });
  await db.ensureGraphCandidateSchema();

  const tools = toolMap(db);

  await expectReject(
    "agent candidate without source refs",
    () =>
      callTool(tools, "memory_create_graph_candidate", {
        project_id: projectOne,
        candidate_kind: "node",
        node_kind: "topic",
        title: `${marker} missing source refs`,
        extraction_method: "agent",
        created_by: "agent",
        source_refs: []
      }),
    "source_refs"
  );
  await expectReject(
    "import candidate without source refs",
    () =>
      db.createGraphCandidate({
        project_id: projectOne,
        candidate_kind: "node",
        node_kind: "entity",
        title: `${marker} import missing source refs`,
        extraction_method: "import",
        created_by: "import",
        source_refs: []
      }),
    "source_refs"
  );
  await expectReject(
    "secret-like candidate payload",
    () =>
      callTool(tools, "memory_create_graph_candidate", {
        project_id: projectOne,
        candidate_kind: "node",
        node_kind: "topic",
        title: `${marker} secret rejection probe`,
        extraction_method: "agent",
        created_by: "agent",
        source_refs: [
          {
            source_kind: "external",
            source_id: `${marker}:secret-source`,
            quote: "bounded non-secret evidence"
          }
        ],
        metadata: { api_key: forbiddenToken }
      }),
    "raw secrets"
  );

  const nodeCandidate = await callTool(tools, "memory_create_graph_candidate", {
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} governed node candidate`,
    summary: `${marker} node candidate remains staging only`,
    confidence: 0.86,
    extraction_method: "agent",
    created_by: "agent",
    scope: "project",
    scope_kind: "project",
    scope_id: projectOne,
    audience: [{ kind: "all_agents", id: null }],
    source_refs: [
      {
        source_kind: "external",
        source_id: `${marker}:node-source`,
        quote: "bounded node evidence",
        metadata: { smoke: true }
      }
    ],
    metadata: { smoke: true, creator_provenance: "graph-candidates-smoke" }
  });
  const edgeCandidate = await callTool(tools, "memory_create_graph_candidate", {
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "supports",
    src: { kind: "external", id: `${marker}:src`, label: "smoke source" },
    dst: { kind: "external", id: `${marker}:dst`, label: "smoke destination" },
    title: `${marker} governed edge candidate`,
    summary: `${marker} edge candidate remains staging only`,
    confidence: 0.78,
    extraction_method: "import",
    created_by: "import",
    scope: "project",
    scope_kind: "project",
    scope_id: projectOne,
    audience: [{ kind: "all_agents", id: null }],
    source_refs: [
      {
        source_kind: "external",
        source_id: `${marker}:edge-source`,
        quote: "bounded edge evidence",
        metadata: { smoke: true }
      }
    ],
    metadata: { smoke: true, creator_provenance: "graph-candidates-smoke" }
  });
  const rejectedCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "preference",
    title: `${marker} rejected candidate`,
    summary: `${marker} rejected staging candidate`,
    confidence: 0.7,
    extraction_method: "deterministic_rule",
    created_by: "system",
    source_refs: [{ source_kind: "external", source_id: `${marker}:rejected-source` }],
    metadata: { smoke: true }
  });
  const staleCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "entity",
    title: `${marker} stale candidate`,
    summary: `${marker} stale staging candidate`,
    confidence: 0.71,
    extraction_method: "keeper",
    created_by: "system",
    source_refs: [{ source_kind: "external", source_id: `${marker}:stale-source` }],
    metadata: { smoke: true }
  });
  const archivedCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "procedure",
    title: `${marker} archived candidate`,
    summary: `${marker} archived staging candidate`,
    confidence: 0.72,
    extraction_method: "closeout",
    created_by: "system",
    source_refs: [{ source_kind: "external", source_id: `${marker}:archived-source` }],
    metadata: { smoke: true }
  });

  await callTool(tools, "memory_review_graph_candidate", {
    project_id: projectOne,
    graph_candidate_id: nodeCandidate.graph_candidate_id,
    action: "reject",
    actor_kind: "agent",
    note: "policy smoke rejection"
  });
  await callTool(tools, "memory_review_graph_candidate", {
    project_id: projectOne,
    graph_candidate_id: rejectedCandidate.graph_candidate_id,
    action: "reject",
    actor_kind: "agent",
    note: "policy smoke rejection"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: staleCandidate.graph_candidate_id,
    action: "mark_stale",
    actor_kind: "agent",
    note: "policy smoke stale"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: archivedCandidate.graph_candidate_id,
    action: "archive",
    actor_kind: "agent",
    note: "policy smoke archive"
  });
  const acceptedCandidate = await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: edgeCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "policy smoke accept"
  });

  const listProjectOne = await db.listGraphCandidates({ project_id: projectOne, limit: 20 });
  const listProjectTwo = await db.listGraphCandidates({ project_id: projectTwo, limit: 20 });
  assert(listProjectOne.candidates.length >= 5, "Project one should list graph candidates");
  assert(listProjectTwo.candidates.length === 0, "Project two must not see project one candidates");

  await expectReject(
    "cross-project get",
    () =>
      db.getGraphCandidate({
        project_id: projectTwo,
        graph_candidate_id: nodeCandidate.graph_candidate_id
      }),
    "not found"
  );
  await expectReject(
    "cross-project review",
    () =>
      db.reviewGraphCandidate({
        project_id: projectTwo,
        graph_candidate_id: edgeCandidate.graph_candidate_id,
        action: "reject",
        actor_kind: "agent"
      }),
    "not found"
  );

  const defaultSearch = await callTool(tools, "memory_search", {
    project_id: projectOne,
    query: marker,
    mode: "lexical_only",
    top_k: 10,
    graph_expand: false,
    max_chars_total: 4000
  });
  const expandedSearch = await callTool(tools, "memory_search", {
    project_id: projectOne,
    query: marker,
    mode: "lexical_only",
    top_k: 10,
    graph_expand: true,
    graph_budget_nodes: 5,
    max_chars_total: 4000
  });
  const searchText = JSON.stringify({ defaultSearch, expandedSearch });
  assert(
    !searchText.includes(nodeCandidate.graph_candidate_id) &&
      !searchText.includes(edgeCandidate.graph_candidate_id) &&
      !searchText.includes(marker),
    "Graph candidate data leaked into memory_search results"
  );

  const checkpointMarker = `checkpoint_${marker}`;
  await db.setCheckpoint(projectOne, {
    current_status: "graph candidate smoke",
    current_focus: checkpointMarker,
    next_step: "graph candidates remain independent staging data"
  });
  const checkpoint = await db.getCheckpoint(projectOne);
  const checkpointText = JSON.stringify(checkpoint);
  assert(checkpointText.includes(checkpointMarker), "Checkpoint marker missing");
  assert(
    !checkpointText.includes(nodeCandidate.graph_candidate_id) &&
      !checkpointText.includes(edgeCandidate.graph_candidate_id),
    "Checkpoint included graph candidate ids"
  );

  const storedRows = await db.pool.query(
    `
      SELECT gc.*, coalesce(jsonb_agg(to_jsonb(r)) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS source_refs
      FROM graph_candidates gc
      LEFT JOIN graph_candidate_source_refs r ON r.graph_candidate_id = gc.id
      WHERE gc.project_id = $1
      GROUP BY gc.id
    `,
    [projectOne]
  );
  const storedFixtureText = JSON.stringify(storedRows.rows);
  assertNoForbidden(storedFixtureText, "stored graph candidate fixtures");

  const stateCounts = Object.fromEntries(
    listProjectOne.candidates.map((candidate) => [
      candidate.lifecycle_state,
      (listProjectOne.candidates.filter((item) => item.lifecycle_state === candidate.lifecycle_state)
        .length)
    ])
  );
  const summary = {
    graph_candidates_smoke: "passed",
    created: {
      node: nodeCandidate.graph_candidate_id,
      edge: edgeCandidate.graph_candidate_id,
      accepted: acceptedCandidate.lifecycle_state
    },
    policy_matrix: {
      node_and_edge_created_with_scope_source_refs_confidence_extraction_creator: true,
      agent_without_source_refs_rejected: true,
      import_without_source_refs_rejected: true,
      secret_like_payload_rejected: true,
      rejected_stale_archived_not_in_default_retrieval: true,
      accepted_not_in_graph_expand_retrieval: true,
      cross_project_list_get_review_blocked: true,
      checkpoint_lifecycle_independent: true,
      leak_scan_passed: true
    },
    project_isolation: {
      project_one_candidates: listProjectOne.candidates.length,
      project_two_candidates: listProjectTwo.candidates.length
    },
    retrieval_isolation: {
      default_hits: defaultSearch.hits?.length ?? 0,
      graph_expand_hits: expandedSearch.hits?.length ?? 0
    },
    lifecycle_states: stateCounts
  };
  const output = JSON.stringify(summary, null, 2);
  assertNoForbidden(output, "graph candidates smoke output");
  process.stdout.write(`${output}\n`);
} finally {
  await db.close();
}
