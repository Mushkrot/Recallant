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

export const graphTreeLifecycleStateValues = [
  "candidate",
  "accepted",
  "needs_review",
  "rejected",
  "stale",
  "archived"
] as const;

export type GraphTreeLifecycleState = (typeof graphTreeLifecycleStateValues)[number];

const graphTreeNodeKindSet = new Set<string>(graphTreeNodeKindValues);
const graphTreeRelationTypeSet = new Set<string>(graphTreeRelationTypeValues);
const graphTreeLifecycleStateSet = new Set<string>(graphTreeLifecycleStateValues);

export function isGraphTreeNodeKind(value: unknown): value is GraphTreeNodeKind {
  return typeof value === "string" && graphTreeNodeKindSet.has(value);
}

export function isGraphTreeRelationType(value: unknown): value is GraphTreeRelationType {
  return typeof value === "string" && graphTreeRelationTypeSet.has(value);
}

export function isGraphTreeLifecycleState(value: unknown): value is GraphTreeLifecycleState {
  return typeof value === "string" && graphTreeLifecycleStateSet.has(value);
}
