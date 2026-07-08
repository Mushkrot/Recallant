import { randomUUID } from "node:crypto";
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
const projectOne = randomUUID();
const projectTwo = randomUUID();
const projectOnePath = `/tmp/recallant-graph-topology-${projectOne}`;
const projectTwoPath = `/tmp/recallant-graph-topology-${projectTwo}`;
const marker = `graph_topology_${randomUUID().replaceAll("-", "_")}`;
const forbiddenToken = ["sk", "graphtopologyleakfixture123"].join("-");
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
    assert(!serialized.includes(needle), `${label} leaked forbidden marker: ${needle}`);
  }
}

async function graphCandidateCount(db, projectId) {
  const result = await db.pool.query(
    "SELECT count(*)::int AS count FROM graph_candidates WHERE project_id = $1",
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function edgeCount(db, projectId) {
  const result = await db.pool.query(
    "SELECT count(*)::int AS count FROM edges WHERE project_id = $1",
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: projectOne,
  projectPath: projectOnePath
});
const otherDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: projectTwo,
  projectPath: projectTwoPath
});

try {
  await db.registerProject({
    projectId: projectOne,
    developerId,
    projectPath: projectOnePath,
    name: "graph-topology-smoke"
  });
  await otherDb.registerProject({
    projectId: projectTwo,
    developerId,
    projectPath: projectTwoPath,
    name: "graph-topology-smoke-decoy"
  });
  await db.ensureGraphCandidateSchema();
  await otherDb.ensureGraphCandidateSchema();

  const sourceRef = (label) => ({
    source_kind: "external",
    source_id: `${marker}-${label}`,
    anchor: label,
    quote: `${marker} bounded source evidence ${label}`
  });
  const activeCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: randomUUID(), label: `${marker} active source` },
    dst: { kind: "chunk", id: randomUUID(), label: `${marker} active target` },
    title: `${marker} active edge`,
    summary: "Compatible edge that should become active after explicit promotion.",
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [sourceRef("active")]
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: activeCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "graph topology active edge smoke"
  });
  const promotion = await db.promoteGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: activeCandidate.graph_candidate_id,
    actor_kind: "agent",
    note: "graph topology active edge smoke"
  });
  const stagedCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "same_topic_as",
    src: { kind: "chunk", id: randomUUID(), label: `${marker} staged source` },
    dst: { kind: "chunk", id: randomUUID(), label: `${marker} staged target` },
    title: `${marker} staged edge`,
    summary: "Unaccepted candidate edge that should stay staged.",
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [sourceRef("staged")]
  });
  const blockedNode = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} blocked node`,
    summary: "Node candidates are not promotable as active edges.",
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [sourceRef("node")]
  });
  const unsupportedCandidate = await db.createGraphCandidate({
    project_id: projectOne,
    candidate_kind: "edge",
    relation_type: "supports",
    src: { kind: "topic", id: `${marker}-topic`, label: "Unsupported topic endpoint" },
    dst: { kind: "decision_cluster", id: `${marker}-cluster`, label: "Unsupported cluster" },
    title: `${marker} unsupported edge`,
    summary: "Accepted unsupported endpoint should remain blocked.",
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [sourceRef("unsupported")]
  });
  await db.reviewGraphCandidate({
    project_id: projectOne,
    graph_candidate_id: unsupportedCandidate.graph_candidate_id,
    action: "accept",
    actor_kind: "agent",
    note: "graph topology unsupported edge smoke"
  });
  await otherDb.createGraphCandidate({
    project_id: projectTwo,
    candidate_kind: "node",
    node_kind: "topic",
    title: `${marker} other project decoy`,
    summary: "This decoy must not appear in project one topology.",
    extraction_method: "agent",
    created_by: "agent",
    source_refs: [sourceRef("decoy")]
  });

  const before = {
    candidates: await graphCandidateCount(db, projectOne),
    edges: await edgeCount(db, projectOne)
  };
  const topology = await db.getGraphTopology({
    project_id: projectOne,
    limit_candidates: 20,
    max_nodes: 80,
    max_links: 100
  });
  const after = {
    candidates: await graphCandidateCount(db, projectOne),
    edges: await edgeCount(db, projectOne)
  };
  const truncated = await db.getGraphTopology({
    project_id: projectOne,
    limit_candidates: 1,
    max_nodes: 2,
    max_links: 1
  });
  const serializedTopology = JSON.stringify(topology);
  assert(promotion.status === "promoted", "Active edge candidate should promote");
  assert(topology.governance.read_only === true, "Topology governance should be read-only");
  assert(topology.governance.mutates_candidates === false, "Topology must not mutate candidates");
  assert(topology.governance.mutates_edges === false, "Topology must not mutate edges");
  assert(before.candidates === after.candidates, "Topology read should not change candidate count");
  assert(before.edges === after.edges, "Topology read should not change edge count");
  assert(topology.summary.active_edge_count >= 1, "Topology should count active promoted edges");
  assert(topology.summary.candidate_edge_count >= 3, "Topology should count candidate edges");
  assert(topology.summary.source_ref_count >= 4, "Topology should count source refs");
  assert(topology.links.some((link) => link.link_kind === "active_edge" && link.active === true), "Topology should include an active edge link");
  assert(
    topology.links.some(
      (link) =>
        link.link_kind === "candidate_edge" &&
        link.graph_candidate_id === stagedCandidate.graph_candidate_id &&
        link.active === false
    ),
    "Topology should include staged candidate edge link"
  );
  assert(
    topology.links.some((link) => link.link_kind === "source_ref" && link.source_backed === true),
    "Topology should include source-ref links"
  );
  assert(
    topology.nodes.some(
      (node) =>
        node.graph_candidate_id === blockedNode.graph_candidate_id &&
        node.statuses.includes("blocked")
    ),
    "Topology should mark blocked node candidate"
  );
  assert(
    topology.nodes.some(
      (node) =>
        node.graph_candidate_id === unsupportedCandidate.graph_candidate_id &&
        node.statuses.includes("blocked")
    ),
    "Topology should mark unsupported accepted edge as blocked"
  );
  assert(!serializedTopology.includes(projectTwo), "Topology leaked other project id");
  assert(!serializedTopology.includes(`${marker} other project decoy`), "Topology leaked decoy title");
  assert(truncated.summary.truncated === true, "Small topology limits should report truncation");
  assert(
    truncated.summary.omitted_candidate_count > 0 ||
      truncated.summary.omitted_node_count > 0 ||
      truncated.summary.omitted_link_count > 0,
    "Truncated topology should report omitted counts"
  );
  assertNoForbidden(topology, "topology payload");

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        script: "scripts/smoke-graph-topology.mjs",
        package_script: "graph-topology:smoke",
        topology: {
          summary: topology.summary,
          node_kinds: Array.from(new Set(topology.nodes.map((node) => node.node_kind))).sort(),
          link_kinds: Array.from(new Set(topology.links.map((link) => link.link_kind))).sort(),
          active_links: topology.links.filter((link) => link.link_kind === "active_edge").length,
          staged_candidate_links: topology.links.filter(
            (link) => link.graph_candidate_id === stagedCandidate.graph_candidate_id
          ).length,
          source_ref_links: topology.links.filter((link) => link.link_kind === "source_ref").length,
          blocked_nodes: topology.nodes.filter((node) => node.statuses.includes("blocked")).length
        },
        read_only_counts: {
          before,
          after
        },
        truncation: {
          truncated: truncated.summary.truncated,
          omitted_candidate_count: truncated.summary.omitted_candidate_count,
          omitted_node_count: truncated.summary.omitted_node_count,
          omitted_link_count: truncated.summary.omitted_link_count
        },
        cross_project_decoy_absent: true,
        forbidden_token_absent: true
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
  await otherDb.close();
}
