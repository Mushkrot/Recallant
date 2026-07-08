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
const projectPath = await mkdtemp(join(tmpdir(), "recallant-graph-retrieval-profiles-"));
const marker = `graph_retrieval_profiles_${randomUUID().replaceAll("-", "_")}`;
const seedToken = `${marker}_seed_anchor`;
const forbiddenToken = `FORBIDDEN_PROFILE_LEAK_${marker}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoForbidden(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes(forbiddenToken), `${label} leaked forbidden fixture token`);
}

function graphHits(searchResult) {
  return searchResult.hits.filter((hit) => hit.why === "graph");
}

function graphEventIds(searchResult) {
  return new Set(graphHits(searchResult).map((hit) => hit.source_event_id));
}

function graphRelations(searchResult) {
  return graphHits(searchResult)
    .map((hit) => String(hit.graph_trace?.relation_type ?? "missing_trace"))
    .sort();
}

function assertTrace(hit, profile) {
  assert(hit.graph_trace?.profile === profile, `${profile} trace profile mismatch`);
  assert(hit.graph_trace?.seed_chunk_id, `${profile} trace missing seed_chunk_id`);
  assert(hit.graph_trace?.edge_id, `${profile} trace missing edge_id`);
  assert(hit.graph_trace?.relation_type, `${profile} trace missing relation_type`);
  assert(
    ["outbound", "inbound"].includes(hit.graph_trace?.direction),
    `${profile} trace direction`
  );
  assert(hit.graph_trace?.max_hops === 1, `${profile} trace max_hops mismatch`);
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

async function setDeterministicEmbeddingRoute(db) {
  await db.pool.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'embedding_route', $2, 'graph retrieval profiles smoke', 'smoke')
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
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId,
  projectPath
});

try {
  const started = await db.startSession({
    client_kind: "codex",
    client_version: "smoke",
    project_path: projectPath,
    session_label: "graph-retrieval-profiles-smoke",
    resume_policy: "force_new"
  });
  await setDeterministicEmbeddingRoute(db);

  const seed = await appendTurn(db, started.session_id, "seed", `${seedToken} profile seed.`);
  const relationFixtures = [
    ["same_topic_as", "same topic profile neighbor"],
    ["derived_from", "source lineage profile neighbor"],
    ["supports", "supporting decision profile neighbor"],
    ["conflicts_with", "conflicting decision profile neighbor"],
    ["supersedes", "supersession profile neighbor"],
    ["belongs_to_project", "project context profile neighbor"],
    ["related", "legacy custom relation profile neighbor"]
  ];
  const relationEvents = new Map();
  for (const [relation, text] of relationFixtures) {
    const turn = await appendTurn(db, started.session_id, relation, `${marker} ${text}.`);
    relationEvents.set(relation, turn);
    await db.linkMemory({
      src_kind: "chunk",
      src_id: seed.chunk_ids[0],
      dst_kind: "chunk",
      dst_id: turn.chunk_ids[0],
      relation_type: relation,
      weight: 1
    });
  }

  const archived = await appendTurn(
    db,
    started.session_id,
    "archived",
    `${marker} archived graph neighbor ${forbiddenToken}.`
  );
  await db.linkMemory({
    src_kind: "chunk",
    src_id: seed.chunk_ids[0],
    dst_kind: "chunk",
    dst_id: archived.chunk_ids[0],
    relation_type: "same_topic_as",
    weight: 1
  });
  await db.archiveChunk({ chunk_id: archived.chunk_ids[0], action: "archive" });

  const scoped = await db.importSource({
    project_path: projectPath,
    source_path: `smoke/${marker}/scoped.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${marker} scoped graph neighbor ${forbiddenToken}.`,
    bounded_excerpt: `${marker} scoped graph neighbor`,
    result_class: "environment_fact",
    scope_kind: "environment",
    scope_id: "server:other-instance",
    audience: [{ kind: "context_pack", id: null }],
    risk: "low",
    risks: [],
    secret_references: []
  });
  await db.linkMemory({
    src_kind: "chunk",
    src_id: seed.chunk_ids[0],
    dst_kind: "chunk",
    dst_id: scoped.chunk_ids[0],
    relation_type: "same_topic_as",
    weight: 1
  });

  const wrongAudience = await db.importSource({
    project_path: projectPath,
    source_path: `smoke/${marker}/audience.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${marker} wrong audience graph neighbor ${forbiddenToken}.`,
    bounded_excerpt: `${marker} wrong audience graph neighbor`,
    result_class: "startup_instruction",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "specific_client", id: "claude_code" }],
    risk: "low",
    risks: [],
    secret_references: []
  });
  await db.linkMemory({
    src_kind: "chunk",
    src_id: seed.chunk_ids[0],
    dst_kind: "chunk",
    dst_id: wrongAudience.chunk_ids[0],
    relation_type: "same_topic_as",
    weight: 1
  });

  const candidateOnly = await appendTurn(
    db,
    started.session_id,
    "candidate-only",
    `${marker} candidate only neighbor must stay outside graph expansion.`
  );
  const candidate = await db.createGraphCandidate({
    project_id: projectId,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: seed.chunk_ids[0], label: "seed" },
    dst: { kind: "chunk", id: candidateOnly.chunk_ids[0], label: "candidate only neighbor" },
    title: `${marker} accepted edge candidate`,
    summary: `${marker} accepted edge candidate remains staging only`,
    confidence: 0.9,
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [
      {
        source_kind: "chunk",
        source_id: seed.chunk_ids[0],
        quote: "bounded non-secret graph candidate evidence"
      }
    ],
    metadata: { smoke: true }
  });
  const acceptedCandidate = await db.reviewGraphCandidate({
    project_id: projectId,
    graph_candidate_id: candidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "graph retrieval profiles smoke accept"
  });

  const profileExpectations = {
    edge_neighborhood: {
      include: [
        "same_topic_as",
        "derived_from",
        "supports",
        "conflicts_with",
        "supersedes",
        "belongs_to_project",
        "related"
      ],
      exclude: []
    },
    same_topic: {
      include: ["same_topic_as"],
      exclude: ["conflicts_with", "related", "derived_from", "supports"]
    },
    source_neighborhood: {
      include: ["derived_from"],
      exclude: ["same_topic_as", "conflicts_with", "related"]
    },
    decision_cluster: {
      include: ["supports", "conflicts_with", "derived_from"],
      exclude: ["same_topic_as", "supersedes", "related"]
    },
    preference_chain: {
      include: ["supports", "supersedes", "same_topic_as"],
      exclude: ["conflicts_with", "derived_from", "related"]
    },
    conflict_check: {
      include: ["conflicts_with"],
      exclude: ["same_topic_as", "supports", "related"]
    },
    supersession_trace: {
      include: ["supersedes"],
      exclude: ["same_topic_as", "supports", "related"]
    },
    project_context: {
      include: ["belongs_to_project", "same_topic_as"],
      exclude: ["conflicts_with", "derived_from", "related"]
    }
  };

  const profileMatrix = {};
  let traceExcerpt = null;
  for (const [profile, expectation] of Object.entries(profileExpectations)) {
    const result = await db.search({
      session_id: started.session_id,
      query: seedToken,
      mode: "lexical_only",
      top_k: 1,
      graph_retrieval_profile: profile,
      graph_budget_nodes: 20,
      max_chars_total: 20_000
    });
    const eventIds = graphEventIds(result);
    for (const relation of expectation.include) {
      assert(
        eventIds.has(relationEvents.get(relation).event_id),
        `${profile} missing relation ${relation}: ${JSON.stringify(result)}`
      );
    }
    for (const relation of expectation.exclude) {
      assert(
        !eventIds.has(relationEvents.get(relation).event_id),
        `${profile} included disallowed relation ${relation}: ${JSON.stringify(result)}`
      );
    }
    assert(
      !eventIds.has(archived.event_id),
      `${profile} returned archived graph neighbor: ${JSON.stringify(result)}`
    );
    assert(
      !eventIds.has(scoped.event_id),
      `${profile} returned scoped graph neighbor: ${JSON.stringify(result)}`
    );
    assert(
      !eventIds.has(wrongAudience.event_id),
      `${profile} returned audience-mismatched graph neighbor: ${JSON.stringify(result)}`
    );
    assert(
      !eventIds.has(candidateOnly.event_id),
      `${profile} returned accepted graph candidate edge as active graph: ${JSON.stringify(result)}`
    );
    const firstGraphHit = graphHits(result)[0];
    if (firstGraphHit) assertTrace(firstGraphHit, profile);
    if (profile === "same_topic") traceExcerpt = graphHits(result)[0]?.graph_trace ?? null;
    profileMatrix[profile] = {
      included_relations: graphRelations(result),
      included: result.graph_retrieval?.included,
      excluded_by_policy: result.graph_retrieval?.excluded_by_policy,
      budget_cutoff: result.graph_retrieval?.budget_cutoff
    };
    assertNoForbidden(result, `${profile} search result`);
  }

  const legacy = await db.search({
    session_id: started.session_id,
    query: seedToken,
    mode: "lexical_only",
    top_k: 1,
    graph_expand: true,
    graph_budget_nodes: 20,
    max_chars_total: 20_000
  });
  assert(
    legacy.graph_retrieval?.profile === "edge_neighborhood",
    `Legacy graph_expand did not map to edge_neighborhood: ${JSON.stringify(legacy)}`
  );
  assert(
    graphEventIds(legacy).has(relationEvents.get("related").event_id),
    `Legacy graph_expand did not include custom relation edge: ${JSON.stringify(legacy)}`
  );

  const sourceA = await db.attachProjectSource({
    project_id: projectId,
    source_kind: "document_collection",
    label: "Graph Profile Source A",
    uri: `docs/${marker}/source-a.md`,
    metadata: { source_path: `docs/${marker}/source-a.md` }
  });
  const sourceB = await db.attachProjectSource({
    project_id: projectId,
    source_kind: "document_collection",
    label: "Graph Profile Source B",
    uri: `docs/${marker}/source-b.md`,
    metadata: { source_path: `docs/${marker}/source-b.md` }
  });
  assert(sourceA?.id && sourceB?.id, "Project source fixtures were not created");
  const sourceSeed = await db.importSource({
    project_path: projectPath,
    source_path: `docs/${marker}/source-a.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${marker}_source_seed belongs to source A.`,
    bounded_excerpt: `${marker}_source_seed source A`,
    result_class: "environment_fact",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "all_agents", id: null }],
    risk: "low",
    risks: [],
    secret_references: [],
    metadata: { project_source_id: sourceA.id }
  });
  const sourceNeighborA = await db.importSource({
    project_path: projectPath,
    source_path: `docs/${marker}/source-a.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${marker} source A graph neighbor.`,
    bounded_excerpt: `${marker} source A graph neighbor`,
    result_class: "environment_fact",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "all_agents", id: null }],
    risk: "low",
    risks: [],
    secret_references: [],
    metadata: { project_source_id: sourceA.id }
  });
  const sourceNeighborB = await db.importSource({
    project_path: projectPath,
    source_path: `docs/${marker}/source-b.md`,
    source_type: "smoke_fixture",
    source_sha256: randomUUID(),
    import_text: `${marker} source B graph neighbor ${forbiddenToken}.`,
    bounded_excerpt: `${marker} source B graph neighbor`,
    result_class: "environment_fact",
    scope_kind: "project",
    scope_id: projectId,
    audience: [{ kind: "all_agents", id: null }],
    risk: "low",
    risks: [],
    secret_references: [],
    metadata: { project_source_id: sourceB.id }
  });
  await db.linkMemory({
    src_kind: "chunk",
    src_id: sourceSeed.chunk_ids[0],
    dst_kind: "chunk",
    dst_id: sourceNeighborA.chunk_ids[0],
    relation_type: "same_topic_as",
    weight: 1
  });
  await db.linkMemory({
    src_kind: "chunk",
    src_id: sourceSeed.chunk_ids[0],
    dst_kind: "chunk",
    dst_id: sourceNeighborB.chunk_ids[0],
    relation_type: "same_topic_as",
    weight: 1
  });
  const sourceFiltered = await db.search({
    session_id: started.session_id,
    source_id: sourceA.id,
    query: `${marker}_source_seed`,
    mode: "lexical_only",
    top_k: 1,
    graph_retrieval_profile: "same_topic",
    graph_budget_nodes: 4,
    max_chars_total: 8_000
  });
  const sourceFilteredEventIds = graphEventIds(sourceFiltered);
  assert(
    sourceFiltered.source_filter?.source_id === sourceA.id,
    `Source filter was not applied: ${JSON.stringify(sourceFiltered)}`
  );
  assert(
    sourceFilteredEventIds.has(sourceNeighborA.event_id),
    `Source A graph neighbor missing: ${JSON.stringify(sourceFiltered)}`
  );
  assert(
    !sourceFilteredEventIds.has(sourceNeighborB.event_id),
    `Source B graph neighbor leaked through source filter: ${JSON.stringify(sourceFiltered)}`
  );
  assertNoForbidden(sourceFiltered, "source-filtered search result");

  const candidateSearch = await db.search({
    session_id: started.session_id,
    query: acceptedCandidate.graph_candidate_id,
    mode: "lexical_only",
    top_k: 10,
    graph_retrieval_profile: "edge_neighborhood",
    graph_budget_nodes: 20,
    max_chars_total: 8_000
  });
  assert(
    candidateSearch.hits.length === 0,
    `Graph candidate id appeared in search: ${JSON.stringify(candidateSearch)}`
  );

  const summary = {
    graph_retrieval_profiles_smoke: "passed",
    profile_matrix: profileMatrix,
    trace_excerpt: traceExcerpt,
    guard_matrix: {
      archived_graph_neighbor_excluded: true,
      scoped_graph_neighbor_excluded: true,
      audience_mismatched_graph_neighbor_excluded: true,
      source_filter_preserved_for_graph_expansion: true,
      accepted_graph_candidate_edge_not_retrieval_active: true,
      graph_candidate_id_not_searchable: true,
      forbidden_fixture_token_not_returned: true
    },
    legacy_compatibility: {
      graph_expand_maps_to: legacy.graph_retrieval?.profile,
      custom_unlisted_relation_included: graphEventIds(legacy).has(
        relationEvents.get("related").event_id
      ),
      graph_hit_why_values: [...new Set(graphHits(legacy).map((hit) => hit.why))]
    },
    candidate_isolation: {
      accepted_candidate_state: acceptedCandidate.lifecycle_state,
      accepted_candidate_edge_retrieval_active: false
    },
    source_filter: {
      source_id: sourceFiltered.source_filter?.source_id,
      included_source_a_neighbor: true,
      excluded_source_b_neighbor: true
    }
  };
  assertNoForbidden(summary, "smoke summary");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write("Graph retrieval profiles smoke passed\n");
} finally {
  await db.close();
}
