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
- provenance, scope, confidence, extraction, review, and safety requirements;
- the current graph candidate, Markdown vault bridge, memory keeper candidate, graph retrieval
  profile, Workbench graph review, Workbench graph topology, and graph maintenance surfaces.

This contract does not implement:

- graph database migration;
- automatic promotion from reviewed candidates into active graph state;
- first-class graph-node storage beyond the current bounded `edges` table.

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

Recallant now includes the first candidate storage, MCP review, and Workbench review slice.
Candidate records live in project-scoped graph candidate tables, preserve source references and
review history, and are exposed through MCP tools, the Workbench review dashboard, and Workbench
review action routes. Accepting a candidate records the reviewed lifecycle state; it does not insert
rows into `edges`, create first-class graph nodes, or change default retrieval by itself.

B6 adds an explicit promotion path for the compatible edge subset. Promotion is separate from
review: accepted candidates remain review-only until a caller uses `memory_promote_graph_candidate`,
`recallant graph promote-candidate <graph-candidate-id> --confirm`, or the Workbench `Promote
candidate` action. Promotion creates or reuses a retrieval-active `edges` row only for accepted
chunk-to-chunk edge candidates.

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

## Workbench Graph Review Surface

The Workbench graph review slice is a human review surface for staged graph candidates, explicit B6
promotion readiness, B7 read-only topology visualization, B8 governed maintenance workflows, and B9
review ergonomics. It is not an automatic graph mutation engine, first-class graph-node store, or
graph database migration.

The dashboard API accepts graph filters alongside the existing Review UI filters:

- `graph_candidate_id`;
- `graph_lifecycle_state`;
- `graph_candidate_kind`;
- `graph_extraction_method`;
- `graph_source_kind`;
- `graph_node_kind`;
- `graph_relation_type`.

The dashboard response exposes graph review data under `graph_candidates`:

- `filters` - the applied graph filter values;
- `counts` - total candidate count plus grouped counts by candidate kind, lifecycle state,
  extraction method, source kind, node kind, and relation type;
- `candidates` - project-scoped queue rows with candidate identity, kind, lifecycle, confidence,
  extraction method, title, summary, endpoint labels for edge candidates, source-ref count,
  review-action count, and derived priority/next-action cues;
- `selected_candidate` - optional detail for the requested graph candidate, including source refs
  and review history;
- `promotion_readiness` - per-candidate status attached to queue rows and the selected candidate;
- `hygiene` - read-only graph candidate hygiene counts, readiness rows, and duplicate groups;
- `topology` - read-only topology nodes, links, groups, summary counts, truncation/omitted counts,
  and governance flags derived from graph candidates, source refs, promotion readiness, and active
  `edges`;
- `maintenance` - governed graph maintenance counts, lanes, recommendations, and governance flags
  for candidate lifecycle cleanup;
- `available_actions` - the bounded action set the UI may present;
- `governance` - explicit flags that candidate storage is staged only and not retrieval-active.

The `/review?view=review` Workbench view renders node and edge candidate lanes, selected candidate
detail, promotion readiness, hygiene counts, the `Graph topology` panel, the `Graph maintenance`
panel, source evidence, review history, empty state copy, and action forms. The topology panel uses
exact visible lanes named `Active promoted links`, `Candidate links`, `Blocked states`, and
`Source-backed evidence`. Its empty state is `No graph topology is visible for this project yet.`
The maintenance panel uses exact empty state copy
`No graph maintenance actions are recommended for this project.` The UI must make the staged
boundary visible: graph candidates can be reviewed and explicitly maintained, but they are not
default retrieval input and `accept` does not promote them into `edges`. Only the explicit
`Promote candidate` action may activate a compatible accepted edge.

B9 review ergonomics add exact public Review labels including `Graph review workload`,
`Graph review filters`, `Next graph action`, `Recommended graph decision`, and
`Open candidate detail`.
These labels are display and workflow guidance only. B9 does not add first-class graph storage,
automatic promotion policies, additional endpoint kinds, or retrieval semantics changes.

## Workbench Graph Topology

B7 topology is a read-only dashboard payload and visualization. It derives shape from existing
`graph_candidates`, `graph_candidate_source_refs`, per-candidate `promotion_readiness`, and active
promoted `edges`. It does not create graph nodes, does not create or update graph candidates, does
not create or update `edges`, does not auto-promote candidates, and does not change retrieval
semantics.

The topology payload contains:

- `nodes` - bounded candidate, endpoint, and source nodes with `label`, `public_safe_label`,
  lifecycle state, promotion status, source-ref counts, and status tags;
- `links` - bounded `candidate_edge`, `active_edge`, and `source_ref` links with relation labels,
  source/target topology ids, active/source-backed flags, lifecycle state, and promotion status;
- `groups` - compact counts for candidate nodes, candidate links, active promoted links, blocked
  candidates, and source-backed evidence;
- `summary` - candidate, active edge, source-ref, blocked, duplicate, promotable, promoted, stale,
  limit, omitted, and truncation counts;
- `governance` - explicit `read_only`, `mutates_candidates: false`, `mutates_edges: false`,
  `derived_from`, `supported_endpoint_policy: "chunk_to_chunk"`, and
  `retrieval_semantics_changed: false` flags.

The topology labels are bounded for display. Public-safe screenshot mode uses `public_safe_label`
instead of raw candidate ids, raw private paths, or long source quotes. Topology reads remain
project-scoped and developer-scoped; cross-project candidates, source refs, and active edges are
excluded.

Workbench review actions are accepted through `/api/review-action` and `/review-action` when the
request names a graph candidate, for example with `graph_candidate_id` or
`target_kind=graph_candidate`. The supported review actions are the graph review action set below.
The separate promotion action uses `action=promote`. Review and promotion requests must remain
project-scoped, validate candidate ids and action-specific metadata, preserve source refs and
review history, and return bounded validation errors without echoing raw request bodies.

## Graph Hygiene And Explicit Promotion

Graph hygiene is a read-only report. It does not mutate graph candidates or `edges`. The report
returns these buckets:

- `total` - scoped graph candidates considered by the report;
- `promotable` - accepted chunk-to-chunk edge candidates that can become active edges;
- `blocked` - candidates that cannot be promoted because of kind, lifecycle, endpoints, or similar
  validation;
- `duplicate` - later candidates with the same project, endpoints, and relation as an earlier
  candidate;
- `stale` - stale or archived candidates;
- `promoted` - candidates with an already active or recorded promoted edge;
- `conflict_review` - candidates whose metadata or review state indicates conflict review is
  needed;
- `blocked_reasons` - counts grouped by bounded reason codes.

The current promotable subset is intentionally narrow:

- candidate kind must be `edge`;
- lifecycle state must be `accepted`;
- `src.kind` and `dst.kind` must both be `chunk`;
- source and destination chunk ids must be present and must not be the same chunk;
- `relation_type` must be present.

Node candidates, non-accepted candidates, stale candidates, archived candidates, rejected
candidates, missing endpoints, unsupported endpoint kinds, self-loops, and unsafe payloads stay
blocked. Promotion creates an `edges` row when no equivalent active edge exists and reuses the
existing edge on repeat promotion.

The exact B6 promotion and hygiene surfaces are:

- MCP: `memory_promote_graph_candidate`;
- MCP: `memory_graph_hygiene`;
- CLI: `recallant graph hygiene`;
- CLI: `recallant graph promote-candidate <graph-candidate-id> --confirm`;
- Workbench: `Promote candidate`;
- HTTP: `/api/review-action` or `/review-action` with `target_kind=graph_candidate` and
  `action=promote`.

The public smoke gates for this slice include `npm run graph-promotion:smoke` and
`npm run graph-topology:smoke`. They prove accept-only non-activation, explicit retrieval
activation, idempotent promotion, hygiene count transitions, promoted active topology links, staged
candidate topology links, source-ref markers, blocked node and unsupported endpoint cases,
read-only topology counts, deterministic truncation, project isolation, and forbidden fixture token
absence.

## Graph Maintenance

B8 graph maintenance is an explicit candidate lifecycle workflow. The default path is a read-only
maintenance plan. Apply operations require an explicit candidate id, an action kind, and confirmation
before any lifecycle review action is appended. Merge and supersede actions also require an explicit
target graph candidate id.

The maintenance plan returns:

- `counts` - total recommendation counts plus duplicate, stale or archived, blocked,
  conflict-review, promoted-cleanup, omitted, and truncation counts;
- `lanes` - deterministic recommendation groups named `duplicates`, `stale_or_archived`, `blocked`,
  `conflict_review`, and `promoted_cleanup`;
- `recommendations` - stable action ids, action kinds, candidate ids, optional target candidate ids,
  reason codes, summaries, lifecycle states, readiness statuses, and risk levels;
- `governance` - explicit `read_only_plan`, `dry_run_default`, `apply_requires_confirm`,
  `deletes_candidates: false`, `mutates_edges: false`, `retrieval_semantics_changed: false`, and
  `preserves_source_refs: true` flags.

The exact B8 maintenance surfaces are:

- MCP: `memory_graph_maintenance`;
- CLI preview: `recallant graph maintenance`;
- CLI apply:
  `recallant graph maintenance apply <action> <graph-candidate-id> [--target-graph-candidate-id <id>] --confirm`;
- Workbench: `Graph maintenance`;
- HTTP: `/api/review-action` or `/review-action` with `action=maintenance`.

Maintenance actions may archive duplicates, mark candidates stale, archive candidates, unarchive
candidates, merge duplicate candidates, or mark one candidate as superseded by another. They append
bounded review history and update candidate lifecycle state. They do not delete candidate rows, do
not delete source refs, do not insert/update/delete `edges`, do not auto-promote candidates, and do
not change retrieval semantics.

The public smoke gates for this slice include `npm run graph-candidates:smoke`,
`npm run mcp:smoke`, and `npm run review-ui:smoke`. They prove read-only maintenance planning,
confirm-gated apply, target validation, idempotent/no-op repeat handling, source-ref preservation,
edge-count stability, Workbench labels and forms, project isolation, and forbidden fixture token
absence.

## Markdown Vault Bridge

Recallant includes a first Obsidian-compatible Markdown vault bridge. It is a compatibility bridge,
not an Obsidian plugin, Obsidian server dependency, passive sync daemon, or broad import path.

The CLI surface is:

```bash
recallant vault inventory <vault-dir> [--project-dir <project-dir>] [--format json|text]
recallant vault candidates <vault-dir> [--project-dir <project-dir>] [--write-candidates --confirm]
recallant vault export <vault-dir> [--output <dir>] [--write --confirm]
```

All vault commands are dry-run by default. `vault inventory` reads Markdown files and reports a
source-linked inventory without writing memory, database rows, or files. `vault candidates` maps
vault notes, headings, tags, links, external URLs, and media references into B1 graph candidate
proposals with extraction method `vault_bridge`; it persists candidates only when both
`--write-candidates` and `--confirm` are present. `vault export` previews four human-readable
Markdown review files and writes them only when both `--write` and `--confirm` are present:

- `Recallant/Decisions.md`;
- `Recallant/Checkpoints.md`;
- `Recallant/Open Questions.md`;
- `Recallant/Memory Review.md`.

The bridge deliberately ignores `.obsidian/` internals and generated `Recallant/` export folders.
It detects media references without copying or ingesting raw media. It treats secret-like source
content as review-required and reports only bounded names/codes, never raw secret values. Vault
candidate output remains staged review state and is not retrieval-active by default.

## Memory Keeper Candidate Pipeline

Recallant includes a deterministic local-first memory keeper candidate pipeline. It turns controlled
source text into governed graph candidate proposals; it does not silently promote those proposals
into recall-active memory or graph edges.

The CLI surface is:

```bash
recallant keeper candidates [--text <text>|--from-file <path>] [--project-dir <dir>] [--source-kind <kind>] [--source-id <id>] [--source-path <path>] [--format json|text]
recallant keeper candidates [--text <text>|--from-file <path>] [--project-dir <dir>] [--source-kind <kind>] [--source-id <id>] [--source-path <path>] [--format json|text] --write-candidates --confirm
recallant keeper candidates --from-source <project-source-id> [--project-dir <dir>] [--project-id <id>] [--max-source-chars <n>] [--max-source-memories <n>] [--format json|text]
recallant keeper candidates --from-source <project-source-id> [--project-dir <dir>] [--project-id <id>] [--max-source-chars <n>] [--max-source-memories <n>] [--format json|text] --write-candidates --confirm
```

`keeper candidates` is dry-run by default and does not require `RECALLANT_DATABASE_URL` unless the
caller explicitly passes both `--write-candidates` and `--confirm`. The text/file dry-run path
remains database-free. The exception is `--from-source`, which needs database access even for dry-runs because it resolves a configured project source to already-governed Recallant evidence. Dry-run output reports `dry_run: true`, `writes_database: false`, candidate counts, source refs,
lifecycle states, confidence, extraction method `keeper`, and reason/provenance metadata.

The B10 source-selected path uses `--from-source` for source selection. The older `--source-id`
flag remains source-reference provenance for explicit `--text` and `--from-file` inputs. A
source-selected keeper input has `input_kind: "source_excerpt"` and includes bounded source
resolution metadata: project source id, project source kind and label, source status, evidence
count, omitted count, source text character budget, memory count budget, and resolved text
character count.

The MCP companion is `memory_keeper_candidates`. It accepts controlled `text` or `from_source_id`,
keeps dry-run as the default, requires `write_candidates: true` plus `confirm: true` before
persistence, and returns the same staged proposal/governance shape as the CLI.

Source-selected keeper input consumes bounded governed evidence that Recallant already stores, such
as source-linked memory bodies and bounded source-reference quotes. It does not raw-read connector accounts, arbitrary URIs, server paths, local paths, raw artifacts, backups, passive vault sync streams, or raw media. If a source has no governed evidence, the source-selected path reports that
state without inventing graph candidates from source metadata alone.

The first deterministic extractor recognizes conservative, reviewable signals:

- `Project: ...`;
- `Topic:` / `Topics:` / `Tag:` / `Tags: ...`;
- `Entity:` / `Entities: ...`;
- `Decision: ...`;
- Markdown headings;
- Markdown tags.

Those signals produce staged node candidates for projects, topics, entities, and decision clusters.
They also produce relation candidates such as `derived_from`, `belongs_to_project`, `about`, and
`same_topic_as` when the input supplies enough structure. Every proposal includes source refs with
bounded quotes and source metadata. Secret-like input is redacted and marked `needs_review`; raw
tokens, private keys, database URLs, customer-data markers, and raw-artifact markers must not be
copied into proposal JSON or stored graph candidate rows.

Confirmed keeper writes call the same graph candidate storage used by other candidate sources.
Stored keeper candidates remain staged review records. They are not part of default retrieval, and
accepting or reviewing a candidate still does not by itself insert a row into `edges`. Compatible
accepted chunk-to-chunk edge candidates require the explicit B6 promotion path before they can
become active graph retrieval edges.

The public smoke gate for this surface is `npm run memory-keeper:smoke`. It checks dry-run behavior
without database configuration, database-required `--from-source` resolution, confirm-gated writes,
source refs, `needs_review` lifecycle on unsafe fixtures, source-selected CLI and MCP leak scans,
stored-payload leak scans, and default retrieval isolation.

## Graph Retrieval Profiles

Recallant includes the first named graph retrieval profile slice for `memory_search`. This is still
edge-based and one-hop: it expands from ordinary seed chunk hits through active `edges` rows and
returns additional chunk hits. It does not traverse graph candidate rows, automatically promote
accepted candidates, create first-class graph nodes, or evaluate a dedicated graph database.

The MCP `memory_search` input accepts:

- `graph_expand` - legacy compatibility boolean. When it is `true` and no explicit profile is
  supplied, Recallant uses `edge_neighborhood`.
- `graph_retrieval_profile` - optional explicit profile name.
- `graph_budget_nodes` - bounded count for expanded graph neighbors.

The first profile names are:

| Profile | Relation policy |
|---------|-----------------|
| `edge_neighborhood` | Legacy one-hop edge neighborhood. It preserves compatibility with existing free-form relation names. |
| `same_topic` | `same_topic_as`, `about`, and `mentions`. |
| `source_neighborhood` | `derived_from`, `mentions`, and `about`. |
| `decision_cluster` | `supports`, `conflicts_with`, `caused_by`, `derived_from`, and `about`. |
| `preference_chain` | `supports`, `supersedes`, `superseded_by`, `same_topic_as`, and `about`. |
| `conflict_check` | `conflicts_with`. |
| `supersession_trace` | `supersedes` and `superseded_by`. |
| `project_context` | `belongs_to_project`, `about`, and `same_topic_as`. |

All B4 profiles are one-hop, exclude archived chunks unless `include_archived` is explicitly true,
preserve the same project, developer, scope, audience, and source filters as seed search, and keep
graph candidate tables out of retrieval. Unknown profile names must fail with a bounded validation
error that lists allowed profile names without echoing raw request bodies.

Graph-expanded hits keep the legacy `why: "graph"` marker and add `graph_trace` metadata:

- `profile`;
- `seed_chunk_id`;
- `edge_id`;
- `relation_type`;
- `direction`;
- `inclusion_reason`;
- `max_hops`;
- `weight`.

Responses also include a compact `graph_retrieval` summary with the profile, one-hop policy,
allowed relation types, budget, included count, excluded-by-policy count, and budget cutoff count.

The public smoke gate for this surface is `npm run graph-retrieval-profiles:smoke`. It checks the
profile matrix, trace metadata, legacy `graph_expand` compatibility, archived/scope/audience/source
filter guards, graph candidate isolation, and forbidden fixture token absence.

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

Promotion is intentionally not part of the review action enum. It is an explicit activation path
with its own result status: `promoted`, `already_promoted`, or `blocked`.

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

Current graph-expanded search can add related chunks through bounded one-hop expansion. The first
named retrieval profiles request relation-aware neighborhoods such as decision clusters, preference
chains, source neighborhoods, conflict checks, and supersession traces. Profile expansion must
preserve provenance, scope, audience, source filters, archive policy, and compact trace metadata for
why each graph result was retrieved.

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

This document defines the graph tree contract and vocabulary, plus the current graph candidate,
Markdown vault bridge, deterministic keeper candidate, named one-hop graph retrieval profile,
explicit chunk-to-chunk candidate promotion, read-only hygiene report, Workbench graph review,
Workbench graph topology, governed graph maintenance workflow, B9 review ergonomics, and B10
source-selected keeper integration slices. It does not create automatic promotion, first-class graph
node storage, passive vault sync, raw media ingestion, human-memory expansion, additional endpoint
kinds, retrieval semantics changes, or a dedicated graph database migration.
