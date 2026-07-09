export const graphTreeContractVersion = 1 as const;

export const graphTreeNodeKindValues = [
  "source",
  "chunk",
  "event",
  "memory",
  "topic",
  "entity",
  "person",
  "project",
  "decision_cluster",
  "open_question",
  "preference",
  "procedure"
] as const;

export type GraphTreeNodeKind = (typeof graphTreeNodeKindValues)[number];

export const graphTreeRelationTypeValues = [
  "mentions",
  "about",
  "supports",
  "conflicts_with",
  "supersedes",
  "superseded_by",
  "caused_by",
  "derived_from",
  "same_topic_as",
  "belongs_to_project",
  "belongs_to_domain",
  "candidate_for",
  "reviewed_as"
] as const;

export type GraphTreeRelationType = (typeof graphTreeRelationTypeValues)[number];

export const graphRetrievalProfileValues = [
  "edge_neighborhood",
  "same_topic",
  "source_neighborhood",
  "decision_cluster",
  "preference_chain",
  "conflict_check",
  "supersession_trace",
  "project_context"
] as const;

export type GraphRetrievalProfile = (typeof graphRetrievalProfileValues)[number];

export type GraphRetrievalCandidatePolicy = "exclude_candidates";

export type GraphRetrievalStalePolicy = "exclude_archived";

export type GraphRetrievalScopePolicy = "seed_scope_and_project";

export type GraphRetrievalProfilePolicy = {
  profile: GraphRetrievalProfile;
  allowed_relation_types: readonly GraphTreeRelationType[];
  allow_unlisted_relation_types: boolean;
  max_hops: 1;
  default_budget_nodes: number;
  candidate_policy: GraphRetrievalCandidatePolicy;
  stale_policy: GraphRetrievalStalePolicy;
  scope_policy: GraphRetrievalScopePolicy;
  explanation: string;
};

const graphRetrievalProfilePolicyBase = {
  max_hops: 1,
  default_budget_nodes: 8,
  candidate_policy: "exclude_candidates",
  stale_policy: "exclude_archived",
  scope_policy: "seed_scope_and_project"
} as const;

export const graphRetrievalProfilePolicies = {
  edge_neighborhood: {
    ...graphRetrievalProfilePolicyBase,
    profile: "edge_neighborhood",
    allowed_relation_types: graphTreeRelationTypeValues,
    allow_unlisted_relation_types: true,
    explanation: "Legacy one-hop accepted-edge neighborhood used by graph_expand compatibility."
  },
  same_topic: {
    ...graphRetrievalProfilePolicyBase,
    profile: "same_topic",
    allowed_relation_types: ["same_topic_as", "about", "mentions"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop topic-adjacent memories connected by same-topic, about, or mention edges."
  },
  source_neighborhood: {
    ...graphRetrievalProfilePolicyBase,
    profile: "source_neighborhood",
    allowed_relation_types: ["derived_from", "mentions", "about"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop memories tied to the same source lineage or explicit source mentions."
  },
  decision_cluster: {
    ...graphRetrievalProfilePolicyBase,
    profile: "decision_cluster",
    allowed_relation_types: ["supports", "conflicts_with", "caused_by", "derived_from", "about"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop decision support, conflict, cause, and source-lineage context."
  },
  preference_chain: {
    ...graphRetrievalProfilePolicyBase,
    profile: "preference_chain",
    allowed_relation_types: ["supports", "supersedes", "superseded_by", "same_topic_as", "about"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop preference evolution and related topic context."
  },
  conflict_check: {
    ...graphRetrievalProfilePolicyBase,
    profile: "conflict_check",
    allowed_relation_types: ["conflicts_with"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop memories that explicitly conflict with the seed result set."
  },
  supersession_trace: {
    ...graphRetrievalProfilePolicyBase,
    profile: "supersession_trace",
    allowed_relation_types: ["supersedes", "superseded_by"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop supersession context for newer or older related memories."
  },
  project_context: {
    ...graphRetrievalProfilePolicyBase,
    profile: "project_context",
    allowed_relation_types: ["belongs_to_project", "about", "same_topic_as"],
    allow_unlisted_relation_types: false,
    explanation: "One-hop project membership and project-topic context."
  }
} as const satisfies Record<GraphRetrievalProfile, GraphRetrievalProfilePolicy>;

export const graphExpandCompatibilityProfile = "edge_neighborhood" as const;

export const graphTreeLifecycleStateValues = [
  "candidate",
  "accepted",
  "needs_review",
  "rejected",
  "stale",
  "archived"
] as const;

export type GraphTreeLifecycleState = (typeof graphTreeLifecycleStateValues)[number];

export const graphCandidateKindValues = ["node", "edge"] as const;

export type GraphCandidateKind = (typeof graphCandidateKindValues)[number];

export const graphCandidateExtractionMethodValues = [
  "human",
  "agent",
  "import",
  "migration",
  "closeout",
  "keeper",
  "deterministic_rule",
  "connector",
  "vault_bridge",
  "other"
] as const;

export type GraphCandidateExtractionMethod = (typeof graphCandidateExtractionMethodValues)[number];

export const graphCandidateSourceRefKindValues = [
  "event",
  "chunk",
  "raw_artifact",
  "edge",
  "checkpoint",
  "external",
  "agent_memory",
  "source"
] as const;

export type GraphCandidateSourceRefKind = (typeof graphCandidateSourceRefKindValues)[number];

export const graphCandidateReviewActionValues = [
  "accept",
  "approve",
  "reject",
  "archive",
  "unarchive",
  "mark_stale",
  "edit",
  "merge",
  "supersede"
] as const;

export type GraphCandidateReviewAction = (typeof graphCandidateReviewActionValues)[number];

export type GraphCandidateCreatedBy = "agent" | "user" | "system" | "import";

export type GraphCandidateAudience = {
  kind: string;
  id?: string | null;
};

export type GraphCandidateMetadata = Record<string, unknown>;

export type GraphCandidateSourceRef = {
  source_ref_id?: string;
  source_kind: GraphCandidateSourceRefKind;
  source_id?: string | null;
  uri?: string | null;
  path?: string | null;
  anchor?: string | null;
  quote?: string | null;
  metadata?: GraphCandidateMetadata;
};

export type GraphCandidateEndpointRef = {
  kind: GraphTreeNodeKind | "external";
  id: string;
  label?: string | null;
  metadata?: GraphCandidateMetadata;
};

export type GraphCandidateBase = {
  graph_candidate_id?: string;
  project_id?: string;
  developer_id?: string;
  scope?: "project" | "developer" | "domain" | "all";
  scope_kind?: string | null;
  scope_id?: string | null;
  lifecycle_state?: GraphTreeLifecycleState;
  confidence?: number | null;
  extraction_method: GraphCandidateExtractionMethod;
  created_by: GraphCandidateCreatedBy;
  audience?: GraphCandidateAudience[];
  source_refs: GraphCandidateSourceRef[];
  metadata?: GraphCandidateMetadata;
};

export type GraphNodeCandidate = GraphCandidateBase & {
  candidate_kind: "node";
  node_kind: GraphTreeNodeKind;
  title: string;
  summary?: string | null;
};

export type GraphEdgeCandidate = GraphCandidateBase & {
  candidate_kind: "edge";
  relation_type: GraphTreeRelationType | string;
  src: GraphCandidateEndpointRef;
  dst: GraphCandidateEndpointRef;
  title?: string | null;
  summary?: string | null;
};

export type GraphCandidate = GraphNodeCandidate | GraphEdgeCandidate;

export type CreateGraphCandidateInput = GraphCandidate;

export type ListGraphCandidatesInput = {
  project_id?: string;
  developer_id?: string;
  candidate_kind?: GraphCandidateKind;
  lifecycle_state?: GraphTreeLifecycleState;
  source_kind?: GraphCandidateSourceRefKind;
  extraction_method?: GraphCandidateExtractionMethod;
  created_by?: GraphCandidateCreatedBy;
  audience_kind?: string | null;
  limit?: number;
};

export type GetGraphCandidateInput = {
  graph_candidate_id: string;
};

export type GraphCandidateReviewPatch = {
  node_kind?: GraphTreeNodeKind;
  relation_type?: GraphTreeRelationType | string;
  title?: string | null;
  summary?: string | null;
  confidence?: number | null;
  lifecycle_state?: GraphTreeLifecycleState;
  audience?: GraphCandidateAudience[];
  metadata?: GraphCandidateMetadata;
};

export type ReviewGraphCandidateInput = {
  graph_candidate_id: string;
  action: GraphCandidateReviewAction;
  actor_kind: "agent" | "user" | "system";
  note?: string | null;
  patch?: GraphCandidateReviewPatch;
  merge_target_id?: string | null;
  superseded_by?: string | null;
  metadata?: GraphCandidateMetadata;
};

export type PromoteGraphCandidateInput = {
  graph_candidate_id: string;
  actor_kind?: "agent" | "user" | "system";
  note?: string | null;
  metadata?: GraphCandidateMetadata;
};

export type PromoteGraphCandidateStatus = "promoted" | "already_promoted" | "blocked";

export type PromoteGraphCandidateBlockedReason =
  | "candidate_kind_not_edge"
  | "candidate_not_accepted"
  | "missing_endpoint"
  | "unsupported_endpoint"
  | "self_loop";

export type PromoteGraphCandidateResult = {
  graph_candidate_id: string;
  status: PromoteGraphCandidateStatus;
  retrieval_active: boolean;
  promoted_edge_id?: string | null;
  blocked_reason?: PromoteGraphCandidateBlockedReason | null;
  blocked_detail?: string | null;
  candidate: GraphCandidateRecord;
  governance: {
    explicit_promotion: true;
    accept_remains_review_only: true;
    active_graph_table: "edges";
    retrieval_active: boolean;
    supported_endpoint_policy: "chunk_to_chunk";
  };
};

export type GraphCandidatePromotionReadinessStatus =
  | "promotable"
  | "blocked"
  | "duplicate"
  | "promoted"
  | "stale";

export type GraphCandidatePromotionReadiness = {
  graph_candidate_id: string;
  candidate_kind: GraphCandidateKind;
  lifecycle_state: GraphTreeLifecycleState;
  status: GraphCandidatePromotionReadinessStatus;
  relation_type?: string | null;
  duplicate_key?: string | null;
  promoted_edge_id?: string | null;
  blocked_reason?: PromoteGraphCandidateBlockedReason | "duplicate_candidate" | null;
  blocked_detail?: string | null;
  conflict_review: boolean;
};

export type GraphCandidateDuplicateGroup = {
  duplicate_key: string;
  relation_type: string;
  src: GraphCandidateEndpointRef;
  dst: GraphCandidateEndpointRef;
  candidate_ids: string[];
  count: number;
};

export type GraphCandidateHygieneResult = {
  generated_at: string;
  project_id?: string | null;
  counts: {
    total: number;
    promotable: number;
    blocked: number;
    duplicate: number;
    stale: number;
    promoted: number;
    conflict_review: number;
    blocked_reasons: Record<string, number>;
  };
  readiness: GraphCandidatePromotionReadiness[];
  duplicate_groups: GraphCandidateDuplicateGroup[];
  governance: {
    read_only: true;
    mutates_candidates: false;
    mutates_edges: false;
    supported_endpoint_policy: "chunk_to_chunk";
  };
};

export type GetGraphCandidateHygieneInput = {
  project_id?: string;
  developer_id?: string;
  limit?: number;
};

export const graphCandidateMaintenanceActionKindValues = [
  "archive_duplicate",
  "archive_candidate",
  "mark_stale",
  "merge_duplicate",
  "supersede_candidate",
  "unarchive_candidate"
] as const;

export type GraphCandidateMaintenanceActionKind =
  (typeof graphCandidateMaintenanceActionKindValues)[number];

export type GraphCandidateMaintenanceLaneKey =
  | "duplicates"
  | "stale_or_archived"
  | "blocked"
  | "conflict_review"
  | "promoted_cleanup";

export type GraphCandidateMaintenanceRiskLevel = "low" | "medium" | "high";

export type GraphCandidateMaintenanceReasonCode =
  | "duplicate_candidate"
  | "stale_candidate"
  | "archived_candidate"
  | "blocked_promotion"
  | "conflict_review"
  | "already_promoted"
  | "restore_candidate";

export type GraphCandidateMaintenanceGovernance = {
  read_only_plan: boolean;
  dry_run_default: true;
  apply_requires_confirm: true;
  deletes_candidates: false;
  mutates_edges: false;
  retrieval_semantics_changed: false;
  preserves_source_refs: true;
};

export type GraphCandidateMaintenanceRecommendation = {
  action_id: string;
  action_kind: GraphCandidateMaintenanceActionKind;
  lane: GraphCandidateMaintenanceLaneKey;
  graph_candidate_id: string;
  target_graph_candidate_id?: string | null;
  reason_code: GraphCandidateMaintenanceReasonCode;
  summary: string;
  lifecycle_state: GraphTreeLifecycleState;
  readiness_status?: GraphCandidatePromotionReadinessStatus | null;
  risk_level: GraphCandidateMaintenanceRiskLevel;
};

export type GraphCandidateMaintenanceLane = {
  lane: GraphCandidateMaintenanceLaneKey;
  label: string;
  count: number;
  recommendations: GraphCandidateMaintenanceRecommendation[];
  omitted_count: number;
  truncated: boolean;
};

export type GraphCandidateMaintenanceCounts = {
  total_recommendations: number;
  duplicates: number;
  stale_or_archived: number;
  blocked: number;
  conflict_review: number;
  promoted_cleanup: number;
  omitted_recommendations: number;
  truncated: boolean;
  limits: {
    recommendations: number;
  };
};

export type GraphCandidateMaintenancePlan = {
  generated_at: string;
  project_id?: string | null;
  developer_id?: string | null;
  scope: {
    project_id?: string | null;
    developer_id?: string | null;
  };
  counts: GraphCandidateMaintenanceCounts;
  lanes: GraphCandidateMaintenanceLane[];
  governance: GraphCandidateMaintenanceGovernance & {
    read_only_plan: true;
    mutates_candidates: false;
  };
};

export type GetGraphCandidateMaintenancePlanInput = {
  project_id?: string;
  developer_id?: string;
  limit?: number;
};

type GraphCandidateMaintenanceApplyBase = {
  action_kind: GraphCandidateMaintenanceActionKind;
  graph_candidate_id: string;
  project_id?: string;
  developer_id?: string;
  actor_kind?: "agent" | "user" | "system";
  note?: string | null;
  metadata?: GraphCandidateMetadata;
  confirm?: boolean;
  dry_run?: boolean;
};

export type GraphCandidateMaintenanceApplyInput =
  | (GraphCandidateMaintenanceApplyBase & {
      action_kind: "archive_duplicate" | "archive_candidate" | "mark_stale" | "unarchive_candidate";
      target_graph_candidate_id?: string | null;
    })
  | (GraphCandidateMaintenanceApplyBase & {
      action_kind: "merge_duplicate" | "supersede_candidate";
      target_graph_candidate_id: string;
    });

export type GraphCandidateMaintenanceApplyStatus =
  | "dry_run"
  | "applied"
  | "already_applied"
  | "rejected";

export type GraphCandidateMaintenanceMutationFlags = {
  dry_run: boolean;
  confirmed: boolean;
  mutates_candidates: boolean;
  review_action_appended: boolean;
  deletes_candidates: false;
  mutates_edges: false;
  retrieval_semantics_changed: false;
};

export type GraphCandidateMaintenanceApplyResult = {
  generated_at: string;
  project_id?: string | null;
  developer_id?: string | null;
  action_kind: GraphCandidateMaintenanceActionKind;
  graph_candidate_id: string;
  target_graph_candidate_id?: string | null;
  status: GraphCandidateMaintenanceApplyStatus;
  previous_lifecycle_state?: GraphTreeLifecycleState | null;
  next_lifecycle_state?: GraphTreeLifecycleState | null;
  candidate?: GraphCandidateRecord | null;
  mutation: GraphCandidateMaintenanceMutationFlags;
  governance: GraphCandidateMaintenanceGovernance & {
    read_only_plan: false;
  };
};

export type GraphTopologyNodeKind = "candidate" | "endpoint" | "source";

export type GraphTopologyLinkKind = "candidate_edge" | "active_edge" | "source_ref";

export type GraphTopologyNodeStatus =
  | "active"
  | "candidate"
  | "accepted"
  | "blocked"
  | "duplicate"
  | "promotable"
  | "promoted"
  | "source_backed"
  | "stale";

export type GraphTopologyNode = {
  topology_node_id: string;
  node_kind: GraphTopologyNodeKind;
  label: string;
  public_safe_label: string;
  detail?: string | null;
  graph_candidate_id?: string | null;
  candidate_kind?: GraphCandidateKind | null;
  graph_node_kind?: GraphTreeNodeKind | "external" | null;
  lifecycle_state?: GraphTreeLifecycleState | null;
  promotion_status?: GraphCandidatePromotionReadinessStatus | null;
  source_ref_count: number;
  statuses: GraphTopologyNodeStatus[];
};

export type GraphTopologyLink = {
  topology_link_id: string;
  link_kind: GraphTopologyLinkKind;
  source_node_id: string;
  target_node_id: string;
  label: string;
  public_safe_label: string;
  relation_type?: string | null;
  graph_candidate_id?: string | null;
  edge_id?: string | null;
  lifecycle_state?: GraphTreeLifecycleState | null;
  promotion_status?: GraphCandidatePromotionReadinessStatus | null;
  active: boolean;
  source_backed: boolean;
};

export type GraphTopologyGroup = {
  group_key: string;
  label: string;
  count: number;
  status?: GraphTopologyNodeStatus | null;
};

export type GraphTopologySummary = {
  candidate_count: number;
  candidate_node_count: number;
  candidate_edge_count: number;
  active_edge_count: number;
  source_ref_count: number;
  blocked_count: number;
  duplicate_count: number;
  promotable_count: number;
  promoted_count: number;
  stale_count: number;
  omitted_candidate_count: number;
  omitted_node_count: number;
  omitted_link_count: number;
  truncated: boolean;
  limits: {
    candidates: number;
    nodes: number;
    links: number;
  };
};

export type GraphTopologyResult = {
  generated_at: string;
  project_id?: string | null;
  nodes: GraphTopologyNode[];
  links: GraphTopologyLink[];
  groups: GraphTopologyGroup[];
  summary: GraphTopologySummary;
  governance: {
    read_only: true;
    mutates_candidates: false;
    mutates_edges: false;
    derived_from: Array<
      "graph_candidates" | "graph_candidate_source_refs" | "promotion_readiness" | "edges"
    >;
    supported_endpoint_policy: "chunk_to_chunk";
    retrieval_semantics_changed: false;
  };
};

export type GetGraphTopologyInput = {
  project_id?: string;
  developer_id?: string;
  limit_candidates?: number;
  max_nodes?: number;
  max_links?: number;
};

export type GraphCandidateReviewRecord = {
  review_action_id?: string;
  graph_candidate_id: string;
  action: GraphCandidateReviewAction;
  actor_kind: "agent" | "user" | "system";
  note?: string | null;
  metadata?: GraphCandidateMetadata;
  created_at?: string;
};

export type GraphCandidateRecord = GraphCandidate & {
  graph_candidate_id: string;
  lifecycle_state: GraphTreeLifecycleState;
  review_actions?: GraphCandidateReviewRecord[];
  created_at?: string;
  updated_at?: string;
};

export type CreateGraphCandidateResult = GraphCandidateRecord;

export type ListGraphCandidatesResult = {
  candidates: GraphCandidateRecord[];
};

export type GetGraphCandidateResult = GraphCandidateRecord;

export type ReviewGraphCandidateResult = GraphCandidateRecord;

const graphTreeNodeKindSet = new Set<string>(graphTreeNodeKindValues);
const graphTreeRelationTypeSet = new Set<string>(graphTreeRelationTypeValues);
const graphRetrievalProfileSet = new Set<string>(graphRetrievalProfileValues);
const graphTreeLifecycleStateSet = new Set<string>(graphTreeLifecycleStateValues);
const graphCandidateKindSet = new Set<string>(graphCandidateKindValues);
const graphCandidateExtractionMethodSet = new Set<string>(graphCandidateExtractionMethodValues);
const graphCandidateSourceRefKindSet = new Set<string>(graphCandidateSourceRefKindValues);
const graphCandidateReviewActionSet = new Set<string>(graphCandidateReviewActionValues);
const graphCandidateMaintenanceActionKindSet = new Set<string>(
  graphCandidateMaintenanceActionKindValues
);

export function isGraphTreeNodeKind(value: unknown): value is GraphTreeNodeKind {
  return typeof value === "string" && graphTreeNodeKindSet.has(value);
}

export function isGraphTreeRelationType(value: unknown): value is GraphTreeRelationType {
  return typeof value === "string" && graphTreeRelationTypeSet.has(value);
}

export function isGraphRetrievalProfile(value: unknown): value is GraphRetrievalProfile {
  return typeof value === "string" && graphRetrievalProfileSet.has(value);
}

export class GraphRetrievalProfileValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor() {
    super(`graph_retrieval_profile must be one of: ${graphRetrievalProfileValues.join(", ")}`);
    this.name = "GraphRetrievalProfileValidationError";
  }
}

export function parseGraphRetrievalProfile(value: unknown): GraphRetrievalProfile | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (isGraphRetrievalProfile(value)) {
    return value;
  }
  throw new GraphRetrievalProfileValidationError();
}

export function graphRetrievalProfilePolicy(
  profile: GraphRetrievalProfile
): GraphRetrievalProfilePolicy {
  return graphRetrievalProfilePolicies[profile];
}

export function graphRetrievalProfileForGraphExpand(input: {
  graph_expand?: boolean | null;
  graph_retrieval_profile?: GraphRetrievalProfile | null;
}): GraphRetrievalProfile | null {
  if (input.graph_retrieval_profile) {
    return input.graph_retrieval_profile;
  }
  return input.graph_expand === true ? graphExpandCompatibilityProfile : null;
}

export function isGraphTreeLifecycleState(value: unknown): value is GraphTreeLifecycleState {
  return typeof value === "string" && graphTreeLifecycleStateSet.has(value);
}

export function isGraphCandidateKind(value: unknown): value is GraphCandidateKind {
  return typeof value === "string" && graphCandidateKindSet.has(value);
}

export function isGraphCandidateExtractionMethod(
  value: unknown
): value is GraphCandidateExtractionMethod {
  return typeof value === "string" && graphCandidateExtractionMethodSet.has(value);
}

export function isGraphCandidateSourceRefKind(
  value: unknown
): value is GraphCandidateSourceRefKind {
  return typeof value === "string" && graphCandidateSourceRefKindSet.has(value);
}

export function isGraphCandidateReviewAction(value: unknown): value is GraphCandidateReviewAction {
  return typeof value === "string" && graphCandidateReviewActionSet.has(value);
}

export function isGraphCandidateMaintenanceActionKind(
  value: unknown
): value is GraphCandidateMaintenanceActionKind {
  return typeof value === "string" && graphCandidateMaintenanceActionKindSet.has(value);
}
