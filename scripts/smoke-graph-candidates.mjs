import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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
  if (markerText)
    assert(safeMessage.includes(markerText), `${label} message missing ${markerText}`);
  assertNoForbidden(safeMessage, `${label} rejection message`);
}

async function edgeCount(db, projectId) {
  const result = await db.pool.query(
    "SELECT count(*)::int AS count FROM edges WHERE project_id = $1",
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function graphCandidateCount(db, projectId) {
  const result = await db.pool.query(
    "SELECT count(*)::int AS count FROM graph_candidates WHERE project_id = $1",
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function graphCandidateReviewActionCount(db, projectId) {
  const result = await db.pool.query(
    `
      SELECT count(a.id)::int AS count
      FROM graph_candidate_review_actions a
      JOIN graph_candidates gc ON gc.id = a.graph_candidate_id
      WHERE gc.project_id = $1
    `,
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

function runCli(args) {
  return spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId
    }
  });
}

function parseCliJson(result, label) {
  assert(result.status === 0, `${label} should exit 0: ${result.stderr || result.stdout}`);
  assertNoForbidden(`${result.stdout}\n${result.stderr}`, label);
  return JSON.parse(result.stdout);
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
  const promotionSrcChunkId = randomUUID();
  const promotionDstChunkId = randomUUID();
  const promotableCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: promotionSrcChunkId, label: "promotion source chunk" },
    dst: { kind: "chunk", id: promotionDstChunkId, label: "promotion destination chunk" },
    title: `${marker} promotable edge candidate`,
    summary: `${marker} accepted chunk edge can be explicitly promoted`,
    confidence: 0.91,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: promotionSrcChunkId,
        quote: "bounded non-secret promotion source evidence"
      }
    ],
    metadata: { smoke: true, promotion_case: "promotable_chunk_to_chunk" }
  });
  const duplicatePromotionCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: promotionSrcChunkId, label: "promotion source chunk duplicate" },
    dst: {
      kind: "chunk",
      id: promotionDstChunkId,
      label: "promotion destination chunk duplicate"
    },
    title: `${marker} duplicate promotable edge candidate`,
    summary: `${marker} duplicate accepted chunk edge is hygiene-visible`,
    confidence: 0.89,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: promotionDstChunkId,
        quote: "bounded non-secret duplicate promotion evidence"
      }
    ],
    metadata: { smoke: true, promotion_case: "duplicate_promotable_chunk_to_chunk" }
  });
  const unacceptedPromotionCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: randomUUID(), label: "unaccepted source chunk" },
    dst: { kind: "chunk", id: randomUUID(), label: "unaccepted destination chunk" },
    title: `${marker} unaccepted promotion candidate`,
    summary: `${marker} unaccepted edge must stay blocked`,
    confidence: 0.61,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: `${marker}:unaccepted-promotion-source`
      }
    ],
    metadata: { smoke: true, promotion_case: "unaccepted" }
  });
  const selfLoopChunkId = randomUUID();
  const selfLoopCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: selfLoopChunkId, label: "self loop chunk" },
    dst: { kind: "chunk", id: selfLoopChunkId, label: "self loop chunk" },
    title: `${marker} self loop promotion candidate`,
    summary: `${marker} self-loop edge must stay blocked`,
    confidence: 0.62,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: selfLoopChunkId,
        quote: "bounded non-secret self-loop evidence"
      }
    ],
    metadata: { smoke: true, promotion_case: "self_loop" }
  });
  const conflictReviewCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "conflicts_with",
    src: { kind: "chunk", id: randomUUID(), label: "conflict source chunk" },
    dst: { kind: "chunk", id: randomUUID(), label: "conflict destination chunk" },
    title: `${marker} conflict review candidate`,
    summary: `${marker} conflict-like edge should be visible in hygiene`,
    confidence: 0.63,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: `${marker}:conflict-review-source`
      }
    ],
    metadata: { smoke: true, possible_conflict: true }
  });
  const edgesBeforePromotion = await edgeCount(db, projectOne);
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: promotableCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "promotion smoke accept only"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: duplicatePromotionCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "promotion smoke duplicate accept"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: selfLoopCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "promotion smoke self-loop accept"
  });
  const edgesAfterAcceptOnly = await edgeCount(db, projectOne);
  assert(
    edgesAfterAcceptOnly === edgesBeforePromotion,
    "Accepting a graph candidate must not insert an edge"
  );
  const hygieneCandidateCountBefore = await graphCandidateCount(db, projectOne);
  const hygieneEdgeCountBefore = await edgeCount(db, projectOne);
  const hygieneBeforePromotion = await db.getGraphCandidateHygiene({ project_id: projectOne });
  const hygieneCandidateCountAfter = await graphCandidateCount(db, projectOne);
  const hygieneEdgeCountAfter = await edgeCount(db, projectOne);
  assert(
    hygieneCandidateCountAfter === hygieneCandidateCountBefore &&
      hygieneEdgeCountAfter === hygieneEdgeCountBefore,
    "Graph candidate hygiene should be read-only"
  );
  assert(
    hygieneBeforePromotion.counts.promotable >= 1,
    "Hygiene should count accepted compatible edge candidates as promotable"
  );
  assert(
    hygieneBeforePromotion.counts.duplicate >= 1 &&
      hygieneBeforePromotion.duplicate_groups.some((group) => group.count >= 2),
    "Hygiene should group duplicate edge candidates"
  );
  assert(
    hygieneBeforePromotion.counts.stale >= 2,
    "Hygiene should count stale and archived candidates separately"
  );
  assert(
    hygieneBeforePromotion.counts.conflict_review >= 1,
    "Hygiene should count conflict-like candidates"
  );
  assert(
    hygieneBeforePromotion.readiness.some(
      (item) =>
        item.graph_candidate_id === conflictReviewCandidate.graph_candidate_id &&
        item.conflict_review
    ),
    "Hygiene should mark conflict-like candidates for review"
  );
  assert(
    hygieneBeforePromotion.counts.blocked_reasons.candidate_not_accepted >= 1 &&
      hygieneBeforePromotion.counts.blocked_reasons.candidate_kind_not_edge >= 1 &&
      hygieneBeforePromotion.counts.blocked_reasons.unsupported_endpoint >= 1,
    "Hygiene should expose blocked reasons"
  );
  const hygieneProjectTwo = await db.getGraphCandidateHygiene({ project_id: projectTwo });
  assert(hygieneProjectTwo.counts.total === 0, "Graph hygiene must preserve project isolation");

  const maintenanceCandidateCountBefore = await graphCandidateCount(db, projectOne);
  const maintenanceReviewActionCountBefore = await graphCandidateReviewActionCount(db, projectOne);
  const maintenanceEdgeCountBefore = await edgeCount(db, projectOne);
  const maintenancePlan = await db.getGraphCandidateMaintenancePlan({
    project_id: projectOne,
    limit: 50
  });
  const maintenanceLimitedPlan = await db.getGraphCandidateMaintenancePlan({
    project_id: projectOne,
    limit: 2
  });
  const maintenanceWrongDeveloperPlan = await db.getGraphCandidateMaintenancePlan({
    project_id: projectOne,
    developer_id: randomUUID()
  });
  const maintenanceProjectTwoPlan = await db.getGraphCandidateMaintenancePlan({
    project_id: projectTwo
  });
  const maintenanceCandidateCountAfter = await graphCandidateCount(db, projectOne);
  const maintenanceReviewActionCountAfter = await graphCandidateReviewActionCount(db, projectOne);
  const maintenanceEdgeCountAfter = await edgeCount(db, projectOne);
  assert(
    maintenanceCandidateCountAfter === maintenanceCandidateCountBefore &&
      maintenanceReviewActionCountAfter === maintenanceReviewActionCountBefore &&
      maintenanceEdgeCountAfter === maintenanceEdgeCountBefore,
    "Graph candidate maintenance planner should be read-only"
  );
  assert(
    maintenancePlan.governance?.read_only_plan === true &&
      maintenancePlan.governance?.mutates_candidates === false &&
      maintenancePlan.governance?.mutates_edges === false &&
      maintenancePlan.governance?.retrieval_semantics_changed === false,
    "Graph maintenance plan should expose dry-run/read-only governance"
  );
  assert(
    maintenancePlan.lanes.map((lane) => lane.lane).join(",") ===
      "duplicates,stale_or_archived,blocked,conflict_review,promoted_cleanup",
    "Graph maintenance plan should return stable lane order"
  );
  assert(maintenancePlan.counts.duplicates >= 1, "Maintenance plan should flag duplicates");
  assert(
    maintenancePlan.counts.stale_or_archived >= 2,
    "Maintenance plan should flag stale and archived candidates"
  );
  assert(maintenancePlan.counts.blocked >= 1, "Maintenance plan should flag blocked candidates");
  assert(
    maintenancePlan.counts.conflict_review >= 1,
    "Maintenance plan should flag conflict-review candidates"
  );
  assert(
    maintenanceLimitedPlan.counts.truncated === true &&
      maintenanceLimitedPlan.counts.omitted_recommendations >= 1,
    "Maintenance plan should report truncation when bounded by limit"
  );
  assert(
    maintenanceWrongDeveloperPlan.counts.total_recommendations === 0 &&
      maintenanceWrongDeveloperPlan.lanes.every((lane) => lane.recommendations.length === 0),
    "Maintenance plan should be empty for a mismatched developer"
  );
  assert(
    maintenanceProjectTwoPlan.counts.total_recommendations === 0,
    "Maintenance plan should preserve project isolation"
  );
  const maintenanceRecommendations = maintenancePlan.lanes.flatMap((lane) => lane.recommendations);
  assert(
    maintenanceRecommendations.every(
      (recommendation) =>
        recommendation.action_id &&
        recommendation.action_kind &&
        recommendation.graph_candidate_id &&
        recommendation.reason_code &&
        recommendation.summary &&
        recommendation.lifecycle_state &&
        recommendation.risk_level
    ),
    "Maintenance recommendations should include the stable required fields"
  );
  assertNoForbidden(JSON.stringify(maintenancePlan), "graph maintenance plan");

  const unacceptedPromotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: unacceptedPromotionCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke unaccepted"
  });
  const nodePromotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: nodeCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke node blocked"
  });
  const unsupportedPromotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: edgeCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke unsupported endpoint"
  });
  const selfLoopPromotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: selfLoopCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke self-loop"
  });
  assert(
    unacceptedPromotion.status === "blocked" &&
      unacceptedPromotion.blocked_reason === "candidate_not_accepted",
    "Unaccepted edge candidate promotion should be blocked"
  );
  assert(
    nodePromotion.status === "blocked" &&
      nodePromotion.blocked_reason === "candidate_kind_not_edge",
    "Node candidate promotion should be blocked"
  );
  assert(
    unsupportedPromotion.status === "blocked" &&
      unsupportedPromotion.blocked_reason === "unsupported_endpoint",
    "Unsupported endpoint promotion should be blocked"
  );
  assert(
    selfLoopPromotion.status === "blocked" && selfLoopPromotion.blocked_reason === "self_loop",
    "Self-loop promotion should be blocked"
  );
  await expectReject(
    "secret-like promotion metadata",
    () =>
      db.promoteGraphCandidate({
        project_id: projectOne,
        graph_candidate_id: promotableCandidate.graph_candidate_id,
        actor_kind: "agent",
        metadata: { api_key: forbiddenToken }
      }),
    "forbidden fields"
  );
  const promotedCandidate = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: promotableCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke first promotion"
  });
  const edgesAfterFirstPromotion = await edgeCount(db, projectOne);
  const repeatedPromotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: promotableCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "promotion smoke repeat promotion"
  });
  const edgesAfterRepeatPromotion = await edgeCount(db, projectOne);
  assert(promotedCandidate.status === "promoted", "First promotion should create an edge");
  assert(promotedCandidate.retrieval_active === true, "Promoted edge should be retrieval active");
  assert(promotedCandidate.promoted_edge_id, "Promoted edge id should be recorded");
  assert(
    promotedCandidate.candidate.metadata?.promoted_edge_id === promotedCandidate.promoted_edge_id,
    "Candidate metadata should include promoted_edge_id"
  );
  assert(
    promotedCandidate.candidate.metadata?.promoted_at,
    "Candidate metadata should include promoted_at"
  );
  assert(
    edgesAfterFirstPromotion === edgesBeforePromotion + 1,
    "First promotion should insert exactly one edge"
  );
  assert(
    repeatedPromotion.status === "already_promoted" &&
      repeatedPromotion.promoted_edge_id === promotedCandidate.promoted_edge_id,
    "Repeat promotion should reuse the promoted edge"
  );
  assert(
    edgesAfterRepeatPromotion === edgesAfterFirstPromotion,
    "Repeat promotion should not create duplicate edges"
  );
  const promotedDuplicateKey = hygieneBeforePromotion.duplicate_groups[0]?.duplicate_key;
  const hygieneAfterPromotion = await db.getGraphCandidateHygiene({ project_id: projectOne });
  const maintenancePromotedCandidateCountBefore = await graphCandidateCount(db, projectOne);
  const maintenancePromotedReviewActionCountBefore = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  const maintenancePromotedEdgeCountBefore = await edgeCount(db, projectOne);
  const maintenanceAfterPromotion = await db.getGraphCandidateMaintenancePlan({
    project_id: projectOne,
    limit: 50
  });
  const maintenancePromotedCandidateCountAfter = await graphCandidateCount(db, projectOne);
  const maintenancePromotedReviewActionCountAfter = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  const maintenancePromotedEdgeCountAfter = await edgeCount(db, projectOne);
  assert(
    hygieneAfterPromotion.counts.promoted >= 1,
    "Hygiene should count promoted candidates after promotion"
  );
  assert(
    maintenancePromotedCandidateCountAfter === maintenancePromotedCandidateCountBefore &&
      maintenancePromotedReviewActionCountAfter === maintenancePromotedReviewActionCountBefore &&
      maintenancePromotedEdgeCountAfter === maintenancePromotedEdgeCountBefore,
    "Graph maintenance planner should remain read-only after promotion"
  );
  assert(
    maintenanceAfterPromotion.counts.promoted_cleanup >= 1,
    "Maintenance plan should flag promoted candidates for cleanup"
  );
  assertNoForbidden(JSON.stringify(maintenanceAfterPromotion), "graph maintenance promoted plan");
  assert(
    !hygieneAfterPromotion.readiness.some(
      (item) => item.duplicate_key === promotedDuplicateKey && item.status === "promotable"
    ),
    "Candidates whose active edge exists should not remain promotable"
  );
  await expectReject(
    "cross-project promote",
    () =>
      db.promoteGraphCandidate({
        project_id: projectTwo,
        graph_candidate_id: promotableCandidate.graph_candidate_id,
        actor_kind: "agent"
      }),
    "not found"
  );
  const cliPromotionCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: randomUUID(), label: "CLI promotion source chunk" },
    dst: { kind: "chunk", id: randomUUID(), label: "CLI promotion destination chunk" },
    title: `${marker} CLI promotable edge candidate`,
    summary: `${marker} CLI explicit promotion candidate`,
    confidence: 0.87,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:cli-promotion-source` }],
    metadata: { smoke: true, promotion_case: "cli_promote_candidate" }
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: cliPromotionCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "CLI promotion smoke accept"
  });
  const cliWithoutConfirm = runCli([
    "graph",
    "promote-candidate",
    cliPromotionCandidate.graph_candidate_id,
    "--project-id",
    projectOne,
    "--project-dir",
    projectOnePath,
    "--format",
    "json"
  ]);
  assert(
    cliWithoutConfirm.status !== 0 &&
      `${cliWithoutConfirm.stderr}\n${cliWithoutConfirm.stdout}`.includes("--confirm"),
    "CLI graph promotion should require --confirm"
  );
  assertNoForbidden(
    `${cliWithoutConfirm.stderr}\n${cliWithoutConfirm.stdout}`,
    "graph promotion no-confirm output"
  );
  const cliPromotion = parseCliJson(
    runCli([
      "graph",
      "promote-candidate",
      cliPromotionCandidate.graph_candidate_id,
      "--project-id",
      projectOne,
      "--project-dir",
      projectOnePath,
      "--format",
      "json",
      "--confirm"
    ]),
    "graph promote-candidate"
  );
  assert(
    cliPromotion.status === "promoted" && cliPromotion.retrieval_active === true,
    "CLI graph promotion should create a retrieval-active edge"
  );
  const cliHygiene = parseCliJson(
    runCli([
      "graph",
      "hygiene",
      "--project-id",
      projectOne,
      "--project-dir",
      projectOnePath,
      "--format",
      "json"
    ]),
    "graph hygiene"
  );
  assert(
    cliHygiene.governance?.read_only === true && cliHygiene.counts?.promoted >= 1,
    "CLI graph hygiene should return read-only counts"
  );
  const cliPathHygiene = parseCliJson(
    runCli(["graph", "hygiene", "--project-dir", projectOnePath, "--format", "json"]),
    "graph hygiene project-dir"
  );
  assert(
    cliPathHygiene.project_id === projectOne && cliPathHygiene.governance?.read_only === true,
    "CLI graph hygiene should resolve project-dir in the current developer scope"
  );
  const cliMaintenancePreview = parseCliJson(
    runCli([
      "graph",
      "maintenance",
      "--project-id",
      projectOne,
      "--project-dir",
      projectOnePath,
      "--format",
      "json",
      "--limit",
      "5"
    ]),
    "graph maintenance preview"
  );
  assert(
    cliMaintenancePreview.governance?.read_only_plan === true &&
      cliMaintenancePreview.governance?.mutates_edges === false &&
      cliMaintenancePreview.counts?.total_recommendations >= 1,
    "CLI graph maintenance preview should return a read-only plan"
  );
  const cliMaintenanceTextPreview = runCli([
    "graph",
    "maintenance",
    "--project-id",
    projectOne,
    "--project-dir",
    projectOnePath,
    "--format",
    "text",
    "--limit",
    "5"
  ]);
  assert(
    cliMaintenanceTextPreview.status === 0 &&
      cliMaintenanceTextPreview.stdout.includes("Recallant graph maintenance") &&
      cliMaintenanceTextPreview.stdout.includes("Apply requires confirm: true"),
    "CLI graph maintenance text preview should render bounded text"
  );
  assertNoForbidden(
    `${cliMaintenanceTextPreview.stdout}\n${cliMaintenanceTextPreview.stderr}`,
    "graph maintenance text preview"
  );
  const cliMaintenanceSrc = randomUUID();
  const cliMaintenanceDst = randomUUID();
  const cliMaintenanceTarget = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: cliMaintenanceSrc, label: "CLI maintenance source chunk" },
    dst: { kind: "chunk", id: cliMaintenanceDst, label: "CLI maintenance destination chunk" },
    title: `${marker} CLI maintenance target candidate`,
    summary: `${marker} CLI maintenance target`,
    confidence: 0.82,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "chunk", source_id: cliMaintenanceSrc }],
    metadata: { smoke: true, maintenance_case: "cli_target" }
  });
  const cliMaintenanceDuplicate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: cliMaintenanceSrc, label: "CLI maintenance source duplicate" },
    dst: { kind: "chunk", id: cliMaintenanceDst, label: "CLI maintenance destination duplicate" },
    title: `${marker} CLI maintenance duplicate candidate`,
    summary: `${marker} CLI maintenance duplicate`,
    confidence: 0.81,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "chunk", source_id: cliMaintenanceDst }],
    metadata: { smoke: true, maintenance_case: "cli_duplicate" }
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: cliMaintenanceTarget.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "CLI maintenance smoke target accept"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: cliMaintenanceDuplicate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "CLI maintenance smoke duplicate accept"
  });
  const cliMaintenanceWithoutConfirm = runCli([
    "graph",
    "maintenance",
    "apply",
    "archive_duplicate",
    cliMaintenanceDuplicate.graph_candidate_id,
    "--project-id",
    projectOne,
    "--project-dir",
    projectOnePath,
    "--target-graph-candidate-id",
    cliMaintenanceTarget.graph_candidate_id,
    "--format",
    "json"
  ]);
  assert(
    cliMaintenanceWithoutConfirm.status !== 0 &&
      `${cliMaintenanceWithoutConfirm.stderr}\n${cliMaintenanceWithoutConfirm.stdout}`.includes(
        "--confirm"
      ),
    "CLI graph maintenance apply should require --confirm"
  );
  assertNoForbidden(
    `${cliMaintenanceWithoutConfirm.stderr}\n${cliMaintenanceWithoutConfirm.stdout}`,
    "graph maintenance no-confirm output"
  );
  const cliMaintenanceApply = parseCliJson(
    runCli([
      "graph",
      "maintenance",
      "apply",
      "archive_duplicate",
      cliMaintenanceDuplicate.graph_candidate_id,
      "--project-id",
      projectOne,
      "--project-dir",
      projectOnePath,
      "--target-graph-candidate-id",
      cliMaintenanceTarget.graph_candidate_id,
      "--format",
      "json",
      "--confirm"
    ]),
    "graph maintenance apply"
  );
  assert(
    cliMaintenanceApply.status === "applied" &&
      cliMaintenanceApply.mutation?.confirmed === true &&
      cliMaintenanceApply.mutation?.mutates_edges === false,
    "CLI graph maintenance apply should confirm one lifecycle action without mutating edges"
  );

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

  const maintenanceApplySrc = randomUUID();
  const maintenanceApplyDst = randomUUID();
  const maintenanceApplyTarget = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: maintenanceApplySrc, label: "maintenance source chunk" },
    dst: { kind: "chunk", id: maintenanceApplyDst, label: "maintenance destination chunk" },
    title: `${marker} maintenance canonical edge`,
    summary: `${marker} maintenance target candidate`,
    confidence: 0.8,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "chunk", source_id: maintenanceApplySrc }],
    metadata: { smoke: true, maintenance_case: "canonical" }
  });
  const maintenanceApplyDuplicate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: maintenanceApplySrc, label: "maintenance source chunk duplicate" },
    dst: {
      kind: "chunk",
      id: maintenanceApplyDst,
      label: "maintenance destination chunk duplicate"
    },
    title: `${marker} maintenance duplicate edge`,
    summary: `${marker} maintenance duplicate candidate`,
    confidence: 0.79,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "chunk", source_id: maintenanceApplyDst }],
    metadata: { smoke: true, maintenance_case: "duplicate" }
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyTarget.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "maintenance smoke target accept"
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyDuplicate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "maintenance smoke duplicate accept"
  });
  const maintenanceStaleCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} maintenance mark stale candidate`,
    summary: `${marker} maintenance mark stale target`,
    confidence: 0.7,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-stale` }],
    metadata: { smoke: true, maintenance_case: "mark_stale" }
  });
  const maintenanceArchiveCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "entity",
    title: `${marker} maintenance archive candidate`,
    summary: `${marker} maintenance archive target`,
    confidence: 0.7,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-archive` }],
    metadata: { smoke: true, maintenance_case: "archive_candidate" }
  });
  const maintenanceMergeTarget = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "decision_cluster",
    title: `${marker} maintenance merge target`,
    summary: `${marker} maintenance merge target candidate`,
    confidence: 0.72,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-merge-target` }],
    metadata: { smoke: true, maintenance_case: "merge_target" }
  });
  const maintenanceMergeCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "decision_cluster",
    title: `${marker} maintenance merge candidate`,
    summary: `${marker} maintenance merge source candidate`,
    confidence: 0.71,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-merge` }],
    metadata: { smoke: true, maintenance_case: "merge_candidate" }
  });
  const maintenanceSupersedeTarget = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "procedure",
    title: `${marker} maintenance supersede target`,
    summary: `${marker} maintenance supersede target candidate`,
    confidence: 0.75,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-supersede-target` }],
    metadata: { smoke: true, maintenance_case: "supersede_target" }
  });
  const maintenanceSupersedeCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "procedure",
    title: `${marker} maintenance supersede candidate`,
    summary: `${marker} maintenance supersede source candidate`,
    confidence: 0.74,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-supersede` }],
    metadata: { smoke: true, maintenance_case: "supersede_candidate" }
  });
  const maintenanceRestoreCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "preference",
    title: `${marker} maintenance restore candidate`,
    summary: `${marker} maintenance restore target`,
    confidence: 0.7,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [{ source_kind: "external", source_id: `${marker}:maintenance-restore` }],
    metadata: { smoke: true, maintenance_case: "restore_candidate" }
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: maintenanceRestoreCandidate.graph_candidate_id,
    action: "archive",
    actor_kind: "agent",
    note: "maintenance smoke archive before restore"
  });

  const maintenanceApplyCandidateCountBefore = await graphCandidateCount(db, projectOne);
  const maintenanceApplyReviewActionCountBefore = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  const maintenanceApplyEdgeCountBefore = await edgeCount(db, projectOne);
  const dryRunArchive = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyDuplicate.graph_candidate_id,
    action_kind: "archive_duplicate",
    target_graph_candidate_id: maintenanceApplyTarget.graph_candidate_id,
    actor_kind: "agent",
    note: "maintenance smoke dry run archive duplicate"
  });
  const maintenanceApplyReviewActionCountAfterDryRun = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  const maintenanceApplyEdgeCountAfterDryRun = await edgeCount(db, projectOne);
  const duplicateBeforeConfirm = await db.getGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyDuplicate.graph_candidate_id
  });
  assert(
    dryRunArchive.status === "dry_run" &&
      dryRunArchive.mutation?.mutates_candidates === false &&
      dryRunArchive.mutation?.review_action_appended === false,
    "Maintenance apply should default to dry-run without confirm"
  );
  assert(
    maintenanceApplyReviewActionCountAfterDryRun === maintenanceApplyReviewActionCountBefore &&
      maintenanceApplyEdgeCountAfterDryRun === maintenanceApplyEdgeCountBefore,
    "Maintenance dry-run should not append review actions or mutate edges"
  );
  const confirmedArchive = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyDuplicate.graph_candidate_id,
    action_kind: "archive_duplicate",
    target_graph_candidate_id: maintenanceApplyTarget.graph_candidate_id,
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke confirm archive duplicate"
  });
  const maintenanceApplyReviewActionCountAfterConfirm = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  const maintenanceApplyEdgeCountAfterConfirm = await edgeCount(db, projectOne);
  assert(
    confirmedArchive.status === "applied" &&
      confirmedArchive.candidate?.lifecycle_state === "archived" &&
      confirmedArchive.mutation?.review_action_appended === true,
    "Maintenance confirm should archive duplicate through review history"
  );
  assert(
    (confirmedArchive.candidate?.source_refs?.length ?? 0) ===
      duplicateBeforeConfirm.source_refs.length,
    "Maintenance apply should preserve source refs"
  );
  assert(
    maintenanceApplyReviewActionCountAfterConfirm === maintenanceApplyReviewActionCountBefore + 1 &&
      maintenanceApplyEdgeCountAfterConfirm === maintenanceApplyEdgeCountBefore,
    "Maintenance confirm should append one review action without changing edges"
  );
  const repeatArchive = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceApplyDuplicate.graph_candidate_id,
    action_kind: "archive_duplicate",
    target_graph_candidate_id: maintenanceApplyTarget.graph_candidate_id,
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke repeat archive duplicate"
  });
  const maintenanceApplyReviewActionCountAfterRepeat = await graphCandidateReviewActionCount(
    db,
    projectOne
  );
  assert(
    repeatArchive.status === "already_applied" &&
      maintenanceApplyReviewActionCountAfterRepeat ===
        maintenanceApplyReviewActionCountAfterConfirm,
    "Maintenance repeat should be idempotent without duplicate review history"
  );
  const markStaleResult = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceStaleCandidate.graph_candidate_id,
    action_kind: "mark_stale",
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke mark stale"
  });
  const archiveCandidateResult = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceArchiveCandidate.graph_candidate_id,
    action_kind: "archive_candidate",
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke archive candidate"
  });
  const mergeResult = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceMergeCandidate.graph_candidate_id,
    action_kind: "merge_duplicate",
    target_graph_candidate_id: maintenanceMergeTarget.graph_candidate_id,
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke merge duplicate"
  });
  const supersedeResult = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceSupersedeCandidate.graph_candidate_id,
    action_kind: "supersede_candidate",
    target_graph_candidate_id: maintenanceSupersedeTarget.graph_candidate_id,
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke supersede"
  });
  const unarchiveResult = await db.applyGraphCandidateMaintenance({
    project_id: projectOne,
    graph_candidate_id: maintenanceRestoreCandidate.graph_candidate_id,
    action_kind: "unarchive_candidate",
    confirm: true,
    actor_kind: "agent",
    note: "maintenance smoke unarchive"
  });
  await expectReject(
    "maintenance merge missing target",
    () =>
      db.applyGraphCandidateMaintenance({
        project_id: projectOne,
        graph_candidate_id: maintenanceMergeCandidate.graph_candidate_id,
        action_kind: "merge_duplicate",
        confirm: true,
        actor_kind: "agent"
      }),
    "target_graph_candidate_id"
  );
  await expectReject(
    "maintenance forbidden metadata",
    () =>
      db.applyGraphCandidateMaintenance({
        project_id: projectOne,
        graph_candidate_id: maintenanceStaleCandidate.graph_candidate_id,
        action_kind: "mark_stale",
        confirm: true,
        actor_kind: "agent",
        metadata: { provider_token: forbiddenToken }
      }),
    "forbidden fields"
  );
  const maintenanceApplyCandidateCountAfter = await graphCandidateCount(db, projectOne);
  const maintenanceApplyEdgeCountAfter = await edgeCount(db, projectOne);
  assert(
    markStaleResult.candidate?.lifecycle_state === "stale" &&
      archiveCandidateResult.candidate?.lifecycle_state === "archived" &&
      mergeResult.candidate?.lifecycle_state === "archived" &&
      supersedeResult.candidate?.lifecycle_state === "stale" &&
      unarchiveResult.candidate?.lifecycle_state === "candidate",
    "Maintenance apply should support stale/archive/merge/supersede/unarchive lifecycles"
  );
  assert(
    maintenanceApplyCandidateCountAfter === maintenanceApplyCandidateCountBefore &&
      maintenanceApplyEdgeCountAfter === maintenanceApplyEdgeCountBefore,
    "Maintenance apply should preserve candidate rows and edges"
  );
  const maintenanceApplyProof = {
    dry_run_status: dryRunArchive.status,
    confirm_status: confirmedArchive.status,
    repeat_status: repeatArchive.status,
    mark_stale_state: markStaleResult.candidate?.lifecycle_state,
    archive_state: archiveCandidateResult.candidate?.lifecycle_state,
    merge_state: mergeResult.candidate?.lifecycle_state,
    supersede_state: supersedeResult.candidate?.lifecycle_state,
    unarchive_state: unarchiveResult.candidate?.lifecycle_state,
    source_refs_preserved:
      (confirmedArchive.candidate?.source_refs?.length ?? 0) ===
      duplicateBeforeConfirm.source_refs.length,
    review_actions_before: maintenanceApplyReviewActionCountBefore,
    review_actions_after_confirm: maintenanceApplyReviewActionCountAfterConfirm,
    review_actions_after_repeat: maintenanceApplyReviewActionCountAfterRepeat,
    edges_before: maintenanceApplyEdgeCountBefore,
    edges_after: maintenanceApplyEdgeCountAfter,
    candidates_before: maintenanceApplyCandidateCountBefore,
    candidates_after: maintenanceApplyCandidateCountAfter
  };
  assertNoForbidden(JSON.stringify(maintenanceApplyProof), "graph maintenance apply proof");

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
      listProjectOne.candidates.filter((item) => item.lifecycle_state === candidate.lifecycle_state)
        .length
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
      accepted_edge_promotion_explicit_only: true,
      promotion_idempotent: true,
      promotion_blocked_cases: true,
      promotion_forbidden_metadata_rejected: true,
      hygiene_read_only: true,
      hygiene_project_isolated: true,
      maintenance_plan_read_only: true,
      maintenance_plan_lanes_passed: true,
      maintenance_apply_confirm_required: true,
      maintenance_apply_lifecycle_actions_passed: true,
      cli_promotion_confirm_required: true,
      cli_promotion_and_hygiene_passed: true,
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
    promotion_core: {
      accept_only_edges_before: edgesBeforePromotion,
      accept_only_edges_after: edgesAfterAcceptOnly,
      first_promotion_status: promotedCandidate.status,
      repeated_promotion_status: repeatedPromotion.status,
      promoted_edge_reused:
        repeatedPromotion.promoted_edge_id === promotedCandidate.promoted_edge_id,
      edges_after_first_promotion: edgesAfterFirstPromotion,
      edges_after_repeat_promotion: edgesAfterRepeatPromotion,
      blocked_reasons: [
        unacceptedPromotion.blocked_reason,
        nodePromotion.blocked_reason,
        unsupportedPromotion.blocked_reason,
        selfLoopPromotion.blocked_reason
      ]
    },
    hygiene: {
      before_promotion_counts: hygieneBeforePromotion.counts,
      after_promotion_counts: hygieneAfterPromotion.counts,
      duplicate_groups: hygieneBeforePromotion.duplicate_groups.length,
      project_two_total: hygieneProjectTwo.counts.total,
      read_only_counts: {
        candidates_before: hygieneCandidateCountBefore,
        candidates_after: hygieneCandidateCountAfter,
        edges_before: hygieneEdgeCountBefore,
        edges_after: hygieneEdgeCountAfter
      }
    },
    maintenance: {
      before_promotion_counts: maintenancePlan.counts,
      after_promotion_counts: maintenanceAfterPromotion.counts,
      lanes: maintenancePlan.lanes.map((lane) => lane.lane),
      sample_actions: maintenanceRecommendations.slice(0, 5).map((recommendation) => ({
        action_id: recommendation.action_id,
        action_kind: recommendation.action_kind,
        lane: recommendation.lane,
        reason_code: recommendation.reason_code,
        risk_level: recommendation.risk_level,
        readiness_status: recommendation.readiness_status
      })),
      read_only_counts: {
        candidates_before: maintenanceCandidateCountBefore,
        candidates_after: maintenanceCandidateCountAfter,
        review_actions_before: maintenanceReviewActionCountBefore,
        review_actions_after: maintenanceReviewActionCountAfter,
        edges_before: maintenanceEdgeCountBefore,
        edges_after: maintenanceEdgeCountAfter
      },
      promoted_read_only_counts: {
        candidates_before: maintenancePromotedCandidateCountBefore,
        candidates_after: maintenancePromotedCandidateCountAfter,
        review_actions_before: maintenancePromotedReviewActionCountBefore,
        review_actions_after: maintenancePromotedReviewActionCountAfter,
        edges_before: maintenancePromotedEdgeCountBefore,
        edges_after: maintenancePromotedEdgeCountAfter
      },
      project_two_total: maintenanceProjectTwoPlan.counts.total_recommendations,
      wrong_developer_total: maintenanceWrongDeveloperPlan.counts.total_recommendations,
      limited_omitted: maintenanceLimitedPlan.counts.omitted_recommendations
    },
    maintenance_apply: maintenanceApplyProof,
    cli_graph: {
      no_confirm_rejected: cliWithoutConfirm.status !== 0,
      promotion_status: cliPromotion.status,
      promotion_retrieval_active: cliPromotion.retrieval_active,
      hygiene_read_only: cliHygiene.governance?.read_only,
      hygiene_promoted: cliHygiene.counts?.promoted,
      project_dir_hygiene_resolved: cliPathHygiene.project_id === projectOne,
      maintenance_preview_total: cliMaintenancePreview.counts?.total_recommendations,
      maintenance_text_preview: cliMaintenanceTextPreview.stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, 4),
      maintenance_no_confirm_rejected: cliMaintenanceWithoutConfirm.status !== 0,
      maintenance_apply_status: cliMaintenanceApply.status,
      maintenance_apply_mutates_edges: cliMaintenanceApply.mutation?.mutates_edges
    },
    lifecycle_states: stateCounts
  };
  const output = JSON.stringify(summary, null, 2);
  assertNoForbidden(output, "graph candidates smoke output");
  process.stdout.write(`${output}\n`);
} finally {
  await db.close();
}
