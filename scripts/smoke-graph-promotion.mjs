import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  graphActiveEdgeEndpointKindValues,
  graphEndpointPromotionCapabilities
} from "../packages/contracts/dist/index.js";
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

const endpointPolicyMatrix = graphActiveEdgeEndpointKindValues.flatMap((srcKind) =>
  graphActiveEdgeEndpointKindValues.map((dstKind) => ({
    src_kind: srcKind,
    dst_kind: dstKind,
    ...graphEndpointPromotionCapabilities(srcKind, dstKind)
  }))
);

assert(
  endpointPolicyMatrix.length === 9 &&
    endpointPolicyMatrix.every((entry) => entry.active_edge_supported) &&
    endpointPolicyMatrix.filter((entry) => entry.chunk_retrieval_supported).length === 1 &&
    endpointPolicyMatrix.some(
      (entry) =>
        entry.src_kind === "chunk" && entry.dst_kind === "chunk" && entry.chunk_retrieval_supported
    ) &&
    graphEndpointPromotionCapabilities("topic", "chunk").active_edge_supported === false,
  "Unexpected graph endpoint policy matrix: " + JSON.stringify(endpointPolicyMatrix)
);

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

async function graphCandidateReviewActionCount(db, targetProjectId) {
  const result = await db.pool.query(
    `
      SELECT count(a.id)::int AS count
      FROM graph_candidate_review_actions a
      JOIN graph_candidates gc ON gc.id = a.graph_candidate_id
      WHERE gc.project_id = $1
    `,
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
  const otherStarted = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: otherProjectPath,
    session_label: "graph-promotion-smoke-other",
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

  const foreignEndpoint = await appendTurn(
    db,
    otherStarted.session_id,
    "foreign-endpoint",
    "Other project endpoint must remain unavailable to this project."
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

  const createAcceptedMatrixCandidate = async ({ title, src, dst }) => {
    const candidate = await db.createGraphCandidate({
      project_id: projectId,
      candidate_kind: "edge",
      relation_type: "mentions",
      src,
      dst,
      title,
      summary: "Explicit B11 endpoint-matrix promotion candidate.",
      confidence: 0.9,
      extraction_method: "agent",
      created_by: "agent",
      source_refs: [
        {
          source_kind: "external",
          source_id: marker + ":matrix-source",
          quote: "bounded endpoint-matrix evidence"
        }
      ],
      metadata: { smoke: "graph-promotion-endpoint-matrix" }
    });
    await db.reviewGraphCandidate({
      project_id: projectId,
      graph_candidate_id: candidate.graph_candidate_id,
      action: "accept",
      actor_kind: "agent",
      note: "accept endpoint matrix candidate"
    });
    return candidate;
  };

  const matrixSources = [
    { kind: "chunk", id: seed.chunk_ids[0], label: "matrix source chunk" },
    { kind: "event", id: seed.event_id, label: "matrix source event" },
    { kind: "external", id: marker + ":matrix:external:src", label: "matrix source external" }
  ];
  const matrixDestinations = [
    { kind: "chunk", id: neighbor.chunk_ids[0], label: "matrix destination chunk" },
    { kind: "event", id: neighbor.event_id, label: "matrix destination event" },
    {
      kind: "external",
      id: marker + ":matrix:external:dst",
      label: "matrix destination external"
    }
  ];
  const endpointMatrix = [];
  for (const src of matrixSources) {
    for (const dst of matrixDestinations) {
      const edgesBeforeMatrixAccept = await edgeCount(db, projectId);
      const matrixCandidate = await createAcceptedMatrixCandidate({
        title: marker + " matrix " + src.kind + "-to-" + dst.kind,
        src,
        dst
      });
      const edgesAfterMatrixAccept = await edgeCount(db, projectId);
      assert(
        edgesAfterMatrixAccept === edgesBeforeMatrixAccept,
        "Accepting an endpoint matrix candidate created an active edge."
      );
      const edgesBeforeMatrixPromotion = await edgeCount(db, projectId);
      const first = await db.promoteGraphCandidate({
        project_id: projectId,
        graph_candidate_id: matrixCandidate.graph_candidate_id,
        actor_kind: "agent",
        note: "promote endpoint matrix candidate"
      });
      const edgesAfterMatrixPromotion = await edgeCount(db, projectId);
      const repeated = await db.promoteGraphCandidate({
        project_id: projectId,
        graph_candidate_id: matrixCandidate.graph_candidate_id,
        actor_kind: "agent",
        note: "repeat endpoint matrix promotion"
      });
      assert(
        first.status === "promoted" &&
          first.active_edge === true &&
          first.promoted_edge_id &&
          first.retrieval_active === (src.kind === "chunk" && dst.kind === "chunk") &&
          first.candidate.metadata?.graph_promotion?.active_edge === true &&
          first.candidate.metadata?.graph_promotion?.retrieval_active === first.retrieval_active &&
          edgesAfterMatrixPromotion === edgesBeforeMatrixPromotion + 1 &&
          repeated.status === "already_promoted" &&
          repeated.promoted_edge_id === first.promoted_edge_id &&
          repeated.active_edge === true &&
          repeated.retrieval_active === first.retrieval_active &&
          (await edgeCount(db, projectId)) === edgesAfterMatrixPromotion,
        "Endpoint matrix promotion failed: " +
          JSON.stringify({
            src,
            dst,
            first,
            repeated,
            edgesBeforeMatrixPromotion,
            edgesAfterMatrixPromotion
          })
      );
      endpointMatrix.push({
        graph_candidate_id: matrixCandidate.graph_candidate_id,
        src_kind: src.kind,
        dst_kind: dst.kind,
        first_status: first.status,
        repeat_status: repeated.status,
        active_edge: first.active_edge,
        retrieval_active: first.retrieval_active
      });
    }
  }
  const matrixHygiene = await db.getGraphCandidateHygiene({ project_id: projectId });
  assert(
    endpointMatrix.every((entry) =>
      matrixHygiene.readiness.some(
        (readiness) =>
          readiness.graph_candidate_id === entry.graph_candidate_id &&
          readiness.status === "promoted" &&
          Boolean(readiness.promoted_edge_id)
      )
    ) &&
      matrixHygiene.governance.supported_endpoint_policy === "current_edges" &&
      matrixHygiene.governance.active_edge_endpoint_kinds.join(",") === "chunk,event,external" &&
      matrixHygiene.governance.chunk_retrieval_endpoint_policy === "chunk_to_chunk",
    "Hygiene did not reflect the promoted endpoint matrix."
  );

  const ownershipCases = [
    {
      name: "foreign_chunk_source",
      src: { kind: "chunk", id: foreignEndpoint.chunk_ids[0], label: "foreign chunk source" },
      dst: { kind: "external", id: marker + ":ownership:dst-a", label: "external destination" },
      reason: "endpoint_outside_project"
    },
    {
      name: "foreign_chunk_destination",
      src: { kind: "external", id: marker + ":ownership:src-a", label: "external source" },
      dst: { kind: "chunk", id: foreignEndpoint.chunk_ids[0], label: "foreign chunk destination" },
      reason: "endpoint_outside_project"
    },
    {
      name: "foreign_event_source",
      src: { kind: "event", id: foreignEndpoint.event_id, label: "foreign event source" },
      dst: { kind: "external", id: marker + ":ownership:dst-b", label: "external destination" },
      reason: "endpoint_outside_project"
    },
    {
      name: "foreign_event_destination",
      src: { kind: "external", id: marker + ":ownership:src-b", label: "external source" },
      dst: { kind: "event", id: foreignEndpoint.event_id, label: "foreign event destination" },
      reason: "endpoint_outside_project"
    },
    {
      name: "missing_chunk_source",
      src: { kind: "chunk", id: randomUUID(), label: "missing chunk source" },
      dst: { kind: "external", id: marker + ":ownership:dst-c", label: "external destination" },
      reason: "governed_endpoint_not_found"
    },
    {
      name: "missing_chunk_destination",
      src: { kind: "external", id: marker + ":ownership:src-c", label: "external source" },
      dst: { kind: "chunk", id: randomUUID(), label: "missing chunk destination" },
      reason: "governed_endpoint_not_found"
    },
    {
      name: "missing_event_source",
      src: { kind: "event", id: randomUUID(), label: "missing event source" },
      dst: { kind: "external", id: marker + ":ownership:dst-d", label: "external destination" },
      reason: "governed_endpoint_not_found"
    },
    {
      name: "missing_event_destination",
      src: { kind: "external", id: marker + ":ownership:src-d", label: "external source" },
      dst: { kind: "event", id: randomUUID(), label: "missing event destination" },
      reason: "governed_endpoint_not_found"
    }
  ];
  const ownershipBlocks = [];
  for (const ownershipCase of ownershipCases) {
    const blockedCandidate = await createAcceptedMatrixCandidate({
      title: marker + " " + ownershipCase.name,
      src: ownershipCase.src,
      dst: ownershipCase.dst
    });
    const beforeBlockedPromotion = await edgeCount(db, projectId);
    const blockedPromotion = await db.promoteGraphCandidate({
      project_id: projectId,
      graph_candidate_id: blockedCandidate.graph_candidate_id,
      actor_kind: "agent",
      note: "verify endpoint ownership"
    });
    const afterBlockedPromotion = await edgeCount(db, projectId);
    assert(
      blockedPromotion.status === "blocked" &&
        blockedPromotion.active_edge === false &&
        blockedPromotion.retrieval_active === false &&
        blockedPromotion.blocked_reason === ownershipCase.reason &&
        afterBlockedPromotion === beforeBlockedPromotion,
      "Endpoint ownership guard failed: " +
        JSON.stringify({
          ownershipCase,
          blockedPromotion,
          beforeBlockedPromotion,
          afterBlockedPromotion
        })
    );
    ownershipBlocks.push({
      name: ownershipCase.name,
      blocked_reason: blockedPromotion.blocked_reason,
      edge_count_unchanged: afterBlockedPromotion === beforeBlockedPromotion
    });
  }

  let externalLengthRejected = false;
  try {
    await db.createGraphCandidate({
      project_id: projectId,
      candidate_kind: "edge",
      relation_type: "mentions",
      src: { kind: "external", id: "x".repeat(513), label: "too long external id" },
      dst: { kind: "external", id: marker + ":bounded-external", label: "external destination" },
      title: marker + " oversized external endpoint",
      extraction_method: "agent",
      created_by: "agent",
      source_refs: [{ source_kind: "external", source_id: marker + ":matrix-source" }]
    });
  } catch (error) {
    externalLengthRejected = String(error).includes("endpoint id");
  }
  assert(externalLengthRejected, "Oversized external endpoint id should be rejected");

  const afterMatrixSearch = await db.search({
    session_id: started.session_id,
    query: seedToken,
    mode: "lexical_only",
    top_k: 1,
    graph_retrieval_profile: "same_topic",
    graph_budget_nodes: 20,
    max_chars_total: 12_000
  });
  assert(
    graphHits(afterMatrixSearch).length === graphHits(afterSearch).length &&
      hasChunk(afterMatrixSearch, neighbor.chunk_ids[0]),
    "Mixed endpoint activation changed current chunk-neighbor retrieval."
  );

  const edgesBeforeMaintenance = await edgeCount(db, projectId);
  const reviewActionsBeforeMaintenance = await graphCandidateReviewActionCount(db, projectId);
  const maintenanceAfterPromotion = await db.applyGraphCandidateMaintenance({
    project_id: projectId,
    graph_candidate_id: candidate.graph_candidate_id,
    action_kind: "archive_candidate",
    confirm: true,
    actor_kind: "agent",
    note: "graph promotion smoke maintenance after promotion"
  });
  const edgesAfterMaintenance = await edgeCount(db, projectId);
  const reviewActionsAfterMaintenance = await graphCandidateReviewActionCount(db, projectId);
  const afterMaintenanceSearch = await db.search({
    session_id: started.session_id,
    query: seedToken,
    mode: "lexical_only",
    top_k: 1,
    graph_retrieval_profile: "same_topic",
    graph_budget_nodes: 8,
    max_chars_total: 12_000
  });
  assert(
    maintenanceAfterPromotion.status === "applied" &&
      maintenanceAfterPromotion.mutation.mutates_edges === false &&
      maintenanceAfterPromotion.mutation.retrieval_semantics_changed === false &&
      maintenanceAfterPromotion.next_lifecycle_state === "archived" &&
      reviewActionsAfterMaintenance === reviewActionsBeforeMaintenance + 1 &&
      edgesAfterMaintenance === edgesBeforeMaintenance,
    `Maintenance after promotion changed retrieval state or edge counts: ${JSON.stringify({
      maintenanceAfterPromotion,
      edgesBeforeMaintenance,
      edgesAfterMaintenance,
      reviewActionsBeforeMaintenance,
      reviewActionsAfterMaintenance
    })}`
  );
  assert(
    hasChunk(afterMaintenanceSearch, neighbor.chunk_ids[0]) &&
      graphHits(afterMaintenanceSearch).some((hit) => hit.chunk_id === neighbor.chunk_ids[0]),
    `Maintenance after promotion removed graph retrieval: ${JSON.stringify(afterMaintenanceSearch)}`
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
      after_repeat_promote: edgesAfterRepeat,
      before_maintenance: edgesBeforeMaintenance,
      after_maintenance: edgesAfterMaintenance
    },
    promotion: {
      first_status: firstPromotion.status,
      repeat_status: repeatPromotion.status,
      promoted_edge_reused: repeatPromotion.promoted_edge_id === firstPromotion.promoted_edge_id,
      active_edge: firstPromotion.active_edge === true,
      retrieval_active: firstPromotion.retrieval_active === true
    },
    endpoint_matrix: endpointMatrix,
    endpoint_ownership: {
      blocks: ownershipBlocks,
      bounded_external_id_rejected: externalLengthRejected,
      mixed_endpoint_retrieval_unchanged:
        graphHits(afterMatrixSearch).length === graphHits(afterSearch).length
    },
    maintenance_after_promotion: {
      status: maintenanceAfterPromotion.status,
      action_kind: maintenanceAfterPromotion.action_kind,
      next_lifecycle_state: maintenanceAfterPromotion.next_lifecycle_state,
      review_actions_before: reviewActionsBeforeMaintenance,
      review_actions_after: reviewActionsAfterMaintenance,
      mutates_edges: maintenanceAfterPromotion.mutation.mutates_edges,
      retrieval_semantics_changed: maintenanceAfterPromotion.mutation.retrieval_semantics_changed,
      retrieval_after_maintenance: searchExcerpt(afterMaintenanceSearch, neighbor.chunk_ids[0])
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
    matrix_hygiene: {
      promoted_count: endpointMatrix.filter((entry) =>
        matrixHygiene.readiness.some(
          (readiness) =>
            readiness.graph_candidate_id === entry.graph_candidate_id &&
            readiness.status === "promoted"
        )
      ).length,
      endpoint_policy: matrixHygiene.governance.supported_endpoint_policy,
      active_edge_endpoint_kinds: matrixHygiene.governance.active_edge_endpoint_kinds,
      chunk_retrieval_endpoint_policy: matrixHygiene.governance.chunk_retrieval_endpoint_policy
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
  assertNoForbidden(afterMaintenanceSearch, "after maintenance retrieval");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await db.close();
}
