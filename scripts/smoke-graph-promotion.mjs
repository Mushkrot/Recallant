import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecallantDb } from "../packages/db/dist/index.js";

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
const projectId = randomUUID();
const otherProjectId = randomUUID();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-graph-promotion-"));
const otherProjectPath = await mkdtemp(join(tmpdir(), "recallant-graph-promotion-other-"));
const marker = `graph_promotion_${randomUUID().replaceAll("-", "_")}`;
const seedToken = `${marker}_seed_anchor`;
const forbiddenToken = `FORBIDDEN_GRAPH_PROMOTION_${marker}`;
const forbiddenNeedles = [
  forbiddenToken,
  ["postgres", "://"].join(""),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" ")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoForbidden(value, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const needle of forbiddenNeedles) {
    assert(!serialized.includes(needle), `${label} leaked forbidden fixture: ${needle}`);
  }
}

async function appendTurn(db, sessionId, label, text) {
  return db.appendTurn({
    session_id: sessionId,
    client_kind: "codex",
    role: "user",
    text,
    dedup_key: `${label}-${randomUUID()}`
  });
}

async function setDeterministicEmbeddingRoute(db, targetProjectId) {
  await db.pool.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'embedding_route', $2, 'graph promotion smoke', 'smoke')
      ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [
      targetProjectId,
      JSON.stringify({
        route_class: "local_model",
        provider: "deterministic",
        model: "deterministic-bow-v1",
        dims: 16
      })
    ]
  );
}

async function edgeCount(db, targetProjectId) {
  const result = await db.pool.query(
    "SELECT count(*)::int AS count FROM edges WHERE project_id = $1",
    [targetProjectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

function graphHits(searchResult) {
  return searchResult.hits.filter((hit) => hit.why === "graph");
}

function hasChunk(searchResult, chunkId) {
  return searchResult.hits.some((hit) => hit.chunk_id === chunkId);
}

function searchExcerpt(searchResult, targetChunkId) {
  return {
    hit_count: searchResult.hits.length,
    graph_hit_count: graphHits(searchResult).length,
    target_present: hasChunk(searchResult, targetChunkId),
    graph_retrieval: searchResult.graph_retrieval
      ? {
          profile: searchResult.graph_retrieval.profile,
          included: searchResult.graph_retrieval.included,
          excluded_by_policy: searchResult.graph_retrieval.excluded_by_policy,
          budget_cutoff: searchResult.graph_retrieval.budget_cutoff
        }
      : null,
    graph_trace: graphHits(searchResult)[0]?.graph_trace ?? null
  };
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath
});

try {
  await db.registerProject({
    projectId,
    developerId,
    projectPath,
    name: "graph-promotion-smoke"
  });
  await db.registerProject({
    projectId: otherProjectId,
    developerId,
    projectPath: otherProjectPath,
    name: "graph-promotion-smoke-other"
  });
  await db.ensureGraphCandidateSchema();
  await setDeterministicEmbeddingRoute(db, projectId);
  await setDeterministicEmbeddingRoute(db, otherProjectId);

  const started = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectPath,
    session_label: "graph-promotion-smoke",
    resume_policy: "force_new"
  });

  const seed = await appendTurn(
    db,
    started.session_id,
    "seed",
    `${seedToken} governed graph promotion seed.`
  );
  const neighbor = await appendTurn(
    db,
    started.session_id,
    "neighbor",
    `${marker} promoted neighbor should appear only after explicit graph promotion.`
  );

  const candidate = await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: seed.chunk_ids[0], label: "promotion seed chunk" },
    dst: { kind: "chunk", id: neighbor.chunk_ids[0], label: "promotion neighbor chunk" },
    title: `${marker} promotable candidate`,
    summary: "Accepted candidate remains staging-only until explicit promotion.",
    confidence: 0.94,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: seed.chunk_ids[0],
        quote: "bounded non-secret graph promotion source evidence"
      }
    ],
    metadata: { smoke: "graph-promotion" }
  });

  const edgesBeforeAccept = await edgeCount(db, projectId);
  await db.reviewGraphCandidate({
    project_id: projectId,
    graph_candidate_id: candidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "graph promotion smoke accept"
  });
  const edgesAfterAccept = await edgeCount(db, projectId);

  const beforeSearch = await db.search({
    session_id: started.session_id,
    query: seedToken,
    mode: "lexical_only",
    top_k: 1,
    graph_retrieval_profile: "same_topic",
    graph_budget_nodes: 8,
    max_chars_total: 12_000
  });
  assert(
    !hasChunk(beforeSearch, neighbor.chunk_ids[0]),
    `Accepted-only graph candidate was retrieval-active before promotion: ${JSON.stringify(
      beforeSearch
    )}`
  );
  assert(edgesBeforeAccept === edgesAfterAccept, "Accepting a candidate created an edge");

  const hygieneBefore = await db.getGraphCandidateHygiene({ project_id: projectId });
  const readinessBefore = hygieneBefore.readiness.find(
    (item) => item.graph_candidate_id === candidate.graph_candidate_id
  );
  assert(
    hygieneBefore.counts.promotable === 1 &&
      hygieneBefore.counts.promoted === 0 &&
      readinessBefore?.status === "promotable",
    `Unexpected hygiene before promotion: ${JSON.stringify(hygieneBefore)}`
  );

  const firstPromotion = await db.promoteGraphCandidate({
    project_id: projectId,
    graph_candidate_id: candidate.graph_candidate_id,
    actor_kind: "agent",
    note: "graph promotion smoke explicit promotion"
  });
  const edgesAfterPromotion = await edgeCount(db, projectId);
  assert(
    firstPromotion.status === "promoted" &&
      firstPromotion.retrieval_active === true &&
      firstPromotion.promoted_edge_id &&
      edgesAfterPromotion === edgesAfterAccept + 1,
    `First promotion failed: ${JSON.stringify({ firstPromotion, edgesAfterPromotion })}`
  );

  const afterSearch = await db.search({
    session_id: started.session_id,
    query: seedToken,
    mode: "lexical_only",
    top_k: 1,
    graph_retrieval_profile: "same_topic",
    graph_budget_nodes: 8,
    max_chars_total: 12_000
  });
  assert(
    hasChunk(afterSearch, neighbor.chunk_ids[0]) &&
      graphHits(afterSearch).some((hit) => hit.chunk_id === neighbor.chunk_ids[0]),
    `Promoted edge did not activate graph retrieval: ${JSON.stringify(afterSearch)}`
  );

  const repeatPromotion = await db.promoteGraphCandidate({
    project_id: projectId,
    graph_candidate_id: candidate.graph_candidate_id,
    actor_kind: "agent",
    note: "graph promotion smoke repeat promotion"
  });
  const edgesAfterRepeat = await edgeCount(db, projectId);
  assert(
    repeatPromotion.status === "already_promoted" &&
      repeatPromotion.promoted_edge_id === firstPromotion.promoted_edge_id &&
      edgesAfterRepeat === edgesAfterPromotion,
    `Repeat promotion was not idempotent: ${JSON.stringify({
      repeatPromotion,
      edgesAfterPromotion,
      edgesAfterRepeat
    })}`
  );

  const hygieneAfter = await db.getGraphCandidateHygiene({ project_id: projectId });
  const readinessAfter = hygieneAfter.readiness.find(
    (item) => item.graph_candidate_id === candidate.graph_candidate_id
  );
  assert(
    hygieneAfter.counts.promotable === 0 &&
      hygieneAfter.counts.promoted === 1 &&
      readinessAfter?.status === "promoted" &&
      readinessAfter.promoted_edge_id === firstPromotion.promoted_edge_id,
    `Unexpected hygiene after promotion: ${JSON.stringify(hygieneAfter)}`
  );

  const nodeCandidate = await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} node candidate`,
    summary: "Node candidate cannot be promoted as an edge.",
    confidence: 0.7,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: seed.chunk_ids[0],
        quote: "bounded node promotion-block evidence"
      }
    ],
    metadata: { smoke: "graph-promotion-node-block" }
  });
  const nodePromotion = await db.promoteGraphCandidate({
    project_id: projectId,
    graph_candidate_id: nodeCandidate.graph_candidate_id,
    actor_kind: "agent"
  });
  assert(
    nodePromotion.status === "blocked" &&
      nodePromotion.blocked_reason === "candidate_kind_not_edge",
    `Node promotion was not blocked: ${JSON.stringify(nodePromotion)}`
  );

  const unsupportedCandidate = await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "edge",
    relation_type: "supports",
    src: { kind: "topic", id: "graph-promotion-topic", label: "topic source" },
    dst: { kind: "chunk", id: neighbor.chunk_ids[0], label: "chunk destination" },
    title: `${marker} unsupported endpoint candidate`,
    summary: "Unsupported endpoint candidate must not become retrieval-active.",
    confidence: 0.72,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: neighbor.chunk_ids[0],
        quote: "bounded unsupported promotion-block evidence"
      }
    ],
    metadata: { smoke: "graph-promotion-unsupported-block" }
  });
  await db.reviewGraphCandidate({
    project_id: projectId,
    graph_candidate_id: unsupportedCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent"
  });
  const unsupportedPromotion = await db.promoteGraphCandidate({
    project_id: projectId,
    graph_candidate_id: unsupportedCandidate.graph_candidate_id,
    actor_kind: "agent"
  });
  assert(
    unsupportedPromotion.status === "blocked" &&
      unsupportedPromotion.blocked_reason === "unsupported_endpoint",
    `Unsupported endpoint promotion was not blocked: ${JSON.stringify(unsupportedPromotion)}`
  );

  const otherCandidate = await db.createGraphCandidate({
    project_id: otherProjectId,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} other project candidate`,
    summary: `Other project fixture ${forbiddenToken} must not leak into project output.`,
    confidence: 0.4,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "external",
        source_id: randomUUID(),
        quote: `Other project quote ${forbiddenToken}`
      }
    ],
    metadata: { smoke: "graph-promotion-other-project" }
  });
  let crossProjectGetBlocked = false;
  try {
    await db.getGraphCandidate({
      project_id: projectId,
      graph_candidate_id: otherCandidate.graph_candidate_id
    });
  } catch (error) {
    crossProjectGetBlocked = String(error).includes("not found");
  }
  assert(crossProjectGetBlocked, "Project one could read other project graph candidate");
  const projectHygieneText = JSON.stringify(
    await db.getGraphCandidateHygiene({ project_id: projectId })
  );
  assert(
    !projectHygieneText.includes(otherCandidate.graph_candidate_id) &&
      !projectHygieneText.includes(forbiddenToken),
    "Project hygiene leaked other project candidate data"
  );

  const summary = {
    status: "pass",
    script: "scripts/smoke-graph-promotion.mjs",
    package_script: "graph-promotion:smoke",
    retrieval: {
      before_promotion: searchExcerpt(beforeSearch, neighbor.chunk_ids[0]),
      after_promotion: searchExcerpt(afterSearch, neighbor.chunk_ids[0])
    },
    edges: {
      before_accept: edgesBeforeAccept,
      after_accept: edgesAfterAccept,
      after_promote: edgesAfterPromotion,
      after_repeat_promote: edgesAfterRepeat
    },
    promotion: {
      first_status: firstPromotion.status,
      repeat_status: repeatPromotion.status,
      promoted_edge_reused: repeatPromotion.promoted_edge_id === firstPromotion.promoted_edge_id,
      retrieval_active: firstPromotion.retrieval_active === true
    },
    blocked: {
      node: nodePromotion.blocked_reason,
      unsupported_endpoint: unsupportedPromotion.blocked_reason
    },
    hygiene: {
      before_counts: hygieneBefore.counts,
      before_selected_status: readinessBefore?.status,
      after_counts: hygieneAfter.counts,
      after_selected_status: readinessAfter?.status,
      promoted_edge_recorded: Boolean(readinessAfter?.promoted_edge_id)
    },
    isolation: {
      cross_project_get_blocked: crossProjectGetBlocked,
      other_project_candidate_hidden: !projectHygieneText.includes(
        otherCandidate.graph_candidate_id
      )
    },
    forbidden_token_absent: true
  };
  assertNoForbidden(summary, "graph promotion smoke summary");
  assertNoForbidden(beforeSearch, "before promotion retrieval");
  assertNoForbidden(afterSearch, "after promotion retrieval");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await db.close();
}
