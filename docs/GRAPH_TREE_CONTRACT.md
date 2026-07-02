# Governed Graph Tree Contract

This document defines the first public vocabulary for Recallant's governed graph tree. It is a
contract for future graph-memory work, not a claim that Recallant already has a self-growing memory
tree.

Recallant already has a bounded graph relation layer: memories and evidence can be linked, and
search can optionally expand from seed chunks through graph edges. This contract names the graph
node kinds, relation types, lifecycle states, and governance rules that future keeper, retrieval,
and review features must use.

## Scope

This contract covers:

- graph node kinds;
- graph relation types;
- graph lifecycle states;
- compatibility with the current `edges` table;
- provenance, scope, confidence, extraction, review, and safety requirements.

This contract does not implement:

- automatic keeper extraction;
- graph retrieval profiles;
- Obsidian vault bridges;
- graph database migration;
- Workbench topology or graph visualization.

## Current Compatibility Surface

The current physical graph table is `edges`. Its endpoint kinds are:

- `chunk`;
- `event`;
- `external`.

The current `relation_type` field remains free-form for compatibility. Existing edges and
`memory_link` calls must continue to work. In particular, this contract must not make existing
legacy relation names invalid by itself.

Conceptual graph node kinds map onto today's storage as follows:

| Conceptual kind | Current representation |
| --- | --- |
| `chunk` | Native `edges.src_kind` / `edges.dst_kind` value. |
| `event` | Native `edges.src_kind` / `edges.dst_kind` value. |
| `source` | Source-backed records or `external` edge endpoints until a first-class node table exists. |
| `memory` | Governed memory records, source refs, or `external` edge endpoints until a first-class node table exists. |
| `topic`, `entity`, `person`, `project`, `decision_cluster`, `open_question`, `preference`, `procedure` | Contract-level semantic nodes represented as governed records or `external` edge endpoints until a later storage phase defines first-class graph nodes. |

## Node Kinds

The first graph tree node kinds are:

- `source` - an original evidence source such as a file, event stream, imported document, connector
  record, or future media artifact.
- `chunk` - a bounded text evidence chunk.
- `event` - a captured workflow, session, system, or source-ingestion event.
- `memory` - a governed memory record such as a decision, lesson, preference, procedure, or
  checkpoint.
- `topic` - a durable subject area used to group related evidence and memories.
- `entity` - a named object, system, package, service, concept, or artifact.
- `person` - a person-like entity represented only when policy and consent allow it.
- `project` - a Recallant memory space or project-level boundary.
- `decision_cluster` - a group of related decisions and supporting/conflicting evidence.
- `open_question` - an unresolved question that should remain retrievable and reviewable.
- `preference` - a stable user, maintainer, or project preference.
- `procedure` - a repeatable workflow or operational pattern.

## Relation Types

The first canonical graph relation types are:

- `mentions` - a node mentions another node without claiming that the first node is mainly about the
  second.
- `about` - a node is primarily about another node.
- `supports` - a node supports another node, memory, decision, or claim.
- `conflicts_with` - a node conflicts with another node, memory, decision, or claim.
- `supersedes` - a newer node replaces an older node.
- `superseded_by` - an older node is replaced by a newer node.
- `caused_by` - a node or event was caused by another node or event.
- `derived_from` - a node was extracted from, summarized from, or otherwise derived from another
  node.
- `same_topic_as` - two nodes belong to the same topic neighborhood without a stronger relation.
- `belongs_to_project` - a node belongs to a project or memory space.
- `belongs_to_domain` - a node belongs to a broader memory domain or scope.
- `candidate_for` - a generated or imported node is a candidate for another node, memory, or review
  target.
- `reviewed_as` - a reviewed node was classified or accepted as another node kind or review outcome.

Future code may expose helper types for these canonical names, but storage and MCP callers must
remain compatible with existing relation names until a migration explicitly changes that behavior.

## Lifecycle States

Graph nodes and generated graph edges use these lifecycle states:

- `candidate` - proposed by an agent, import, keeper, or migration and not yet accepted.
- `accepted` - approved or created through a policy path that allows recall.
- `needs_review` - requires human or stricter policy review before ordinary recall use.
- `rejected` - reviewed and rejected for recall use.
- `stale` - may still be evidence, but should not be treated as current without stronger context.
- `archived` - hidden from ordinary retrieval unless explicitly requested.

Existing memory-specific statuses may have additional compatibility states, such as superseded
memory records. The graph contract should express replacement through `supersedes` and
`superseded_by` relations rather than requiring every storage table to share one identical status
enum.

## Graph Candidate Lifecycle

Graph candidate storage is the governed staging layer for proposed graph nodes and edges. It is
additive to the current `edges` table and does not make candidate graph data retrieval-active by
default.

The first typed candidate kinds are:

- `node` - a proposed graph node such as a topic, entity, project, decision cluster, open question,
  preference, or procedure.
- `edge` - a proposed relation between two endpoint refs.

Candidate records must preserve:

- project and developer scope when available;
- candidate kind;
- node kind for node candidates;
- relation type plus source and destination endpoint refs for edge candidates;
- title and summary;
- lifecycle state;
- confidence when available;
- extraction method;
- creator kind;
- audience when the candidate crosses an audience, project, or domain boundary;
- bounded non-secret metadata;
- one or more source refs for agent-generated or import-generated candidates.

The first extraction method values are:

- `human`;
- `agent`;
- `import`;
- `migration`;
- `closeout`;
- `keeper`;
- `deterministic_rule`;
- `connector`;
- `vault_bridge`;
- `other`.

The first source ref kinds are:

- `event`;
- `chunk`;
- `raw_artifact`;
- `edge`;
- `checkpoint`;
- `external`;
- `agent_memory`;
- `source`.

Source refs are bounded references, not a license to copy raw artifacts into candidate records.
Agent-generated and import-generated candidates must include source refs before they can be stored or
reviewed.

The first review actions are:

- `accept`;
- `approve`;
- `reject`;
- `archive`;
- `unarchive`;
- `mark_stale`;
- `edit`;
- `merge`;
- `supersede`.

Review actions must preserve source refs and review history. Merge and supersession paths should
record their target metadata without physically deleting the original candidate row.

## Governance Requirements

Every generated graph node or edge must preserve governance before it can affect retrieval:

- **Provenance required:** generated nodes and edges must identify their source evidence, source
  refs, or generating event.
- **Scope required:** project, developer, domain, or other scope must be explicit.
- **Audience required for cross-memory links:** cross-project, cross-domain, or cross-audience links
  must state who may use them.
- **Confidence recorded:** model-generated and import-generated proposals must record confidence
  when available.
- **Extraction method recorded:** proposals must identify whether they came from a human action,
  import, migration, closeout, keeper, deterministic rule, or other extraction path.
- **Review state recorded:** generated output starts as `candidate` or `needs_review` unless an
  existing accepted policy path allows immediate use.
- **Instruction-grade memories require review:** graph mutation must not silently turn agent output
  into binding instructions.
- **Secrets stay out:** raw secrets, credentials, private keys, database URLs, provider tokens,
  customer data, raw backups, and raw artifacts must be blocked or represented only as governed
  references before graph mutation.

## Retrieval Contract

Graph is a retrieval and governance substrate, not just visualization.

Current graph-expanded search can add related chunks through bounded one-hop expansion. Future
retrieval profiles may use this contract to request relation-aware neighborhoods such as decision
clusters, preference chains, source neighborhoods, contradiction checks, or supersession chains.
Those future profiles must preserve provenance and explain why each graph result was retrieved.

## Review Contract

Generated graph output should be reviewable before it becomes durable guidance. Review surfaces
should show:

- the proposed node or edge;
- source evidence and provenance;
- scope and audience;
- confidence and extraction method;
- current lifecycle state;
- available accept, reject, archive, supersede, and merge actions.

## Phase Boundary

This document defines the graph tree contract and vocabulary. It does not build the keeper pipeline,
add graph retrieval profiles, create a graph visualization, add an Obsidian bridge, or migrate
Recallant to a dedicated graph database.
