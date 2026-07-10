import type {
  CreateGraphCandidateInput,
  GraphCandidateEndpointRef,
  GraphCandidateSourceRef,
  GraphTreeLifecycleState,
  GraphTreeNodeKind,
  GraphTreeRelationType
} from "@recallant/contracts";

export const memoryKeeperContractVersion = 1 as const;

export const memoryKeeperInputKindValues = [
  "text",
  "file",
  "source_excerpt",
  "event",
  "closeout",
  "agent_memory",
  "vault_item"
] as const;

export type MemoryKeeperInputKind = (typeof memoryKeeperInputKindValues)[number];

export type MemoryKeeperRiskLevel = "safe" | "needs_review" | "blocked";

export type MemoryKeeperSecretReference = {
  kind: "credential" | "database_url" | "private_key" | "customer_data" | "raw_artifact";
  code: string;
};

export type MemoryKeeperSourceInput = {
  input_kind: MemoryKeeperInputKind;
  text: string;
  source_kind?: GraphCandidateSourceRef["source_kind"];
  source_id?: string | null;
  uri?: string | null;
  path?: string | null;
  anchor?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown>;
  source_resolution?: MemoryKeeperSourceResolution | null;
};

export type MemoryKeeperSourceResolution = {
  project_source_id: string;
  project_source_kind: string;
  project_source_label: string;
  project_source_status: string;
  evidence_count: number;
  omitted_count: number;
  max_source_chars: number;
  max_source_memories: number;
  text_chars: number;
  empty: boolean;
  risk_reasons?: string[];
};

export type MemoryKeeperPolicyResult = {
  risk_level: MemoryKeeperRiskLevel;
  lifecycle_state: GraphTreeLifecycleState;
  confidence_cap: number;
  reasons: string[];
  secret_references: MemoryKeeperSecretReference[];
};

export type MemoryKeeperProposal = {
  proposal_id: string;
  candidate: CreateGraphCandidateInput;
  reason: string;
  risk_level: MemoryKeeperRiskLevel;
  signals: string[];
};

export type MemoryKeeperPlan = {
  contract_version: typeof memoryKeeperContractVersion;
  dry_run: true;
  writes_database: false;
  input: {
    input_kind: MemoryKeeperInputKind;
    label: string | null;
    source_kind: GraphCandidateSourceRef["source_kind"];
    source_id: string | null;
    path: string | null;
    anchor: string | null;
    source_resolution: MemoryKeeperSourceResolution | null;
  };
  policy: MemoryKeeperPolicyResult;
  proposals: MemoryKeeperProposal[];
  summary: {
    proposals: number;
    node_candidates: number;
    edge_candidates: number;
    lifecycle_states: GraphTreeLifecycleState[];
    source_refs_required: true;
  };
};

export type MemoryKeeperSignalKind = "project" | "topic" | "entity" | "decision_cluster";

export type MemoryKeeperSignal = {
  signal_kind: MemoryKeeperSignalKind;
  node_kind: GraphTreeNodeKind;
  value: string;
  line: number;
  anchor: string;
  source_quote: string;
  confidence: number;
  reason: string;
};

const credentialAssignmentPattern =
  /\b(?:api[_-]?key|token|secret|password|credential)\b\s*[:=]\s*["']?[^"'\s]+/gi;
const bearerTokenPattern = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g;
const databaseUrlPattern = /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/\S+/gi;
const privateKeyPattern =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function redactKeeperText(text: string) {
  return text
    .replace(privateKeyPattern, "[redacted_private_key]")
    .replace(databaseUrlPattern, "[redacted_database_url]")
    .replace(bearerTokenPattern, "[redacted_token]")
    .replace(credentialAssignmentPattern, (match) => {
      const [prefix] = match.split(/[:=]/, 1);
      return `${prefix?.trim() ?? "credential"}=[redacted]`;
    });
}

export function boundedKeeperQuote(text: string, maxChars = 240) {
  const normalized = normalizeWhitespace(redactKeeperText(text));
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

export function classifyMemoryKeeperInput(text: string): MemoryKeeperPolicyResult {
  const references: MemoryKeeperSecretReference[] = [];
  const reasons: string[] = [];

  if (privateKeyPattern.test(text)) {
    references.push({ kind: "private_key", code: "private_key_block" });
    reasons.push("private_key_marker_detected");
  }
  privateKeyPattern.lastIndex = 0;

  if (databaseUrlPattern.test(text)) {
    references.push({ kind: "database_url", code: "credentialed_database_url" });
    reasons.push("database_url_marker_detected");
  }
  databaseUrlPattern.lastIndex = 0;

  if (bearerTokenPattern.test(text) || credentialAssignmentPattern.test(text)) {
    references.push({ kind: "credential", code: "credential_marker" });
    reasons.push("credential_marker_detected");
  }
  bearerTokenPattern.lastIndex = 0;
  credentialAssignmentPattern.lastIndex = 0;

  if (/\b(customer|patient|ssn|passport|credit card)\b/i.test(text)) {
    references.push({ kind: "customer_data", code: "sensitive_personal_data_marker" });
    reasons.push("sensitive_personal_data_marker_detected");
  }

  if (/\b(raw artifact|backup dump|database dump)\b/i.test(text)) {
    references.push({ kind: "raw_artifact", code: "raw_artifact_marker" });
    reasons.push("raw_artifact_marker_detected");
  }

  if (references.length === 0) {
    return {
      risk_level: "safe",
      lifecycle_state: "candidate",
      confidence_cap: 0.88,
      reasons: ["no_sensitive_markers_detected"],
      secret_references: []
    };
  }

  return {
    risk_level: "needs_review",
    lifecycle_state: "needs_review",
    confidence_cap: 0.42,
    reasons,
    secret_references: references
  };
}

function sourceResolutionRiskReasons(input: MemoryKeeperSourceInput) {
  const reasons = input.source_resolution?.risk_reasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
    : [];
}

function applySourceResolutionRiskPolicy(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult
): MemoryKeeperPolicyResult {
  const riskReasons = sourceResolutionRiskReasons(input);
  if (riskReasons.length === 0) return policy;
  return {
    ...policy,
    risk_level: policy.risk_level === "blocked" ? "blocked" : "needs_review",
    lifecycle_state: "needs_review",
    confidence_cap: Math.min(policy.confidence_cap, 0.42),
    reasons: Array.from(new Set([...policy.reasons, ...riskReasons]))
  };
}

export function keeperSourceRef(
  input: MemoryKeeperSourceInput,
  quoteText = input.text
): GraphCandidateSourceRef {
  return {
    source_kind: input.source_kind ?? "external",
    source_id: input.source_id ?? null,
    uri: input.uri ?? null,
    path: input.path ?? null,
    anchor: input.anchor ?? null,
    quote: boundedKeeperQuote(quoteText),
    metadata: {
      ...(input.metadata ?? {}),
      input_kind: input.input_kind,
      extraction_route: "memory_keeper",
      source_resolution: input.source_resolution ?? null
    }
  };
}

export function keeperProposalId(parts: readonly string[]) {
  return parts
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .join(":");
}

function confidenceWithinPolicy(
  confidence: number | null | undefined,
  policy: MemoryKeeperPolicyResult
) {
  const value = typeof confidence === "number" ? confidence : policy.confidence_cap;
  return Math.max(0, Math.min(value, policy.confidence_cap));
}

function keeperSourceRefForProposal(
  input: MemoryKeeperSourceInput,
  options?: {
    quote_text?: string | null;
    anchor?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return keeperSourceRef(
    {
      ...input,
      anchor: options?.anchor ?? input.anchor,
      metadata: {
        ...(input.metadata ?? {}),
        ...(options?.metadata ?? {})
      }
    },
    options?.quote_text ?? input.text
  );
}

function keeperProvenanceMetadata(
  input: MemoryKeeperSourceInput,
  options?: {
    anchor?: string | null;
    rule?: string;
    line?: number | null;
  }
) {
  return {
    extraction_route: "memory_keeper",
    extraction_rule: options?.rule ?? "keeper_explicit_signal",
    source_kind: input.source_kind ?? "external",
    source_id: input.source_id ?? null,
    path: input.path ?? null,
    uri: input.uri ?? null,
    anchor: options?.anchor ?? input.anchor ?? null,
    line: options?.line ?? null
  };
}

export function keeperNodeCandidate(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult,
  node: {
    node_kind: GraphTreeNodeKind;
    title: string;
    summary?: string | null;
    confidence?: number | null;
    reason: string;
    metadata?: Record<string, unknown>;
    signals?: string[];
    source_quote?: string | null;
    source_anchor?: string | null;
    source_line?: number | null;
    extraction_rule?: string;
  }
): MemoryKeeperProposal {
  const title = boundedKeeperQuote(node.title, 120);
  const candidate: CreateGraphCandidateInput = {
    candidate_kind: "node",
    node_kind: node.node_kind,
    title,
    summary: node.summary ? boundedKeeperQuote(node.summary, 280) : null,
    lifecycle_state: policy.lifecycle_state,
    confidence: confidenceWithinPolicy(node.confidence, policy),
    extraction_method: "keeper",
    created_by: "agent",
    source_refs: [
      keeperSourceRefForProposal(input, {
        quote_text: node.source_quote,
        anchor: node.source_anchor,
        metadata: {
          line: node.source_line ?? null,
          extraction_rule: node.extraction_rule ?? "keeper_explicit_signal"
        }
      })
    ],
    metadata: {
      ...(node.metadata ?? {}),
      reason: node.reason,
      provenance: keeperProvenanceMetadata(input, {
        anchor: node.source_anchor,
        line: node.source_line,
        rule: node.extraction_rule
      }),
      risk_level: policy.risk_level,
      policy_reasons: policy.reasons,
      secret_references: policy.secret_references
    }
  };
  return {
    proposal_id: keeperProposalId(["keeper", "node", node.node_kind, title]),
    candidate,
    reason: node.reason,
    risk_level: policy.risk_level,
    signals: node.signals ?? []
  };
}

export function keeperEdgeCandidate(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult,
  edge: {
    relation_type: GraphTreeRelationType;
    src: GraphCandidateEndpointRef;
    dst: GraphCandidateEndpointRef;
    title?: string | null;
    summary?: string | null;
    confidence?: number | null;
    reason: string;
    metadata?: Record<string, unknown>;
    signals?: string[];
    source_quote?: string | null;
    source_anchor?: string | null;
    source_line?: number | null;
    extraction_rule?: string;
  }
): MemoryKeeperProposal {
  const candidate: CreateGraphCandidateInput = {
    candidate_kind: "edge",
    relation_type: edge.relation_type,
    src: edge.src,
    dst: edge.dst,
    title: edge.title ? boundedKeeperQuote(edge.title, 140) : null,
    summary: edge.summary ? boundedKeeperQuote(edge.summary, 280) : null,
    lifecycle_state: policy.lifecycle_state,
    confidence: confidenceWithinPolicy(edge.confidence, policy),
    extraction_method: "keeper",
    created_by: "agent",
    source_refs: [
      keeperSourceRefForProposal(input, {
        quote_text: edge.source_quote,
        anchor: edge.source_anchor,
        metadata: {
          line: edge.source_line ?? null,
          extraction_rule: edge.extraction_rule ?? "keeper_relation_rule"
        }
      })
    ],
    metadata: {
      ...(edge.metadata ?? {}),
      reason: edge.reason,
      provenance: keeperProvenanceMetadata(input, {
        anchor: edge.source_anchor,
        line: edge.source_line,
        rule: edge.extraction_rule ?? "keeper_relation_rule"
      }),
      risk_level: policy.risk_level,
      policy_reasons: policy.reasons,
      secret_references: policy.secret_references
    }
  };
  return {
    proposal_id: keeperProposalId(["keeper", "edge", edge.relation_type, edge.src.id, edge.dst.id]),
    candidate,
    reason: edge.reason,
    risk_level: policy.risk_level,
    signals: edge.signals ?? []
  };
}

function nodeKindForSignal(kind: MemoryKeeperSignalKind): GraphTreeNodeKind {
  if (kind === "decision_cluster") return "decision_cluster";
  return kind;
}

function normalizeKeeperSignalValue(value: string) {
  return boundedKeeperQuote(
    value
      .replace(/^\s*[-*]\s+/, "")
      .replace(/[`*_~]+/g, "")
      .replace(/\s+[.!?;:,]+$/g, "")
      .trim(),
    120
  );
}

function splitKeeperSignalValues(kind: MemoryKeeperSignalKind, value: string) {
  if (kind === "decision_cluster") return [value];
  return value
    .split(/[,;|]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourceAnchorForLine(line: number) {
  return `line:${line}`;
}

function addKeeperSignal(
  signals: MemoryKeeperSignal[],
  seen: Set<string>,
  input: {
    signal_kind: MemoryKeeperSignalKind;
    value: string;
    line: number;
    source_quote: string;
    confidence: number;
    reason: string;
  }
) {
  const value = normalizeKeeperSignalValue(input.value);
  if (value.length < 3) return;
  const key = keeperProposalId(["signal", input.signal_kind, value]);
  if (seen.has(key)) return;
  seen.add(key);
  signals.push({
    signal_kind: input.signal_kind,
    node_kind: nodeKindForSignal(input.signal_kind),
    value,
    line: input.line,
    anchor: sourceAnchorForLine(input.line),
    source_quote: boundedKeeperQuote(input.source_quote),
    confidence: input.confidence,
    reason: input.reason
  });
}

export function extractMemoryKeeperSignals(input: MemoryKeeperSourceInput): MemoryKeeperSignal[] {
  const signals: MemoryKeeperSignal[] = [];
  const seen = new Set<string>();
  const redactedLines = redactKeeperText(input.text).split(/\r?\n/);

  redactedLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    const marker = trimmed.match(
      /^(?:[-*]\s*)?(project|topics?|tags?|entities?|entity|decision)\s*:\s*(.+)$/i
    );
    if (marker) {
      const label = marker[1]?.toLowerCase() ?? "";
      const kind: MemoryKeeperSignalKind = label.startsWith("project")
        ? "project"
        : label.startsWith("topic") || label.startsWith("tag")
          ? "topic"
          : label.startsWith("entit")
            ? "entity"
            : "decision_cluster";
      for (const value of splitKeeperSignalValues(kind, marker[2] ?? "")) {
        addKeeperSignal(signals, seen, {
          signal_kind: kind,
          value,
          line: lineNumber,
          source_quote: trimmed,
          confidence: kind === "decision_cluster" ? 0.78 : 0.82,
          reason: `Explicit ${label} marker in keeper input.`
        });
      }
      return;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      addKeeperSignal(signals, seen, {
        signal_kind: "topic",
        value: heading[1] ?? "",
        line: lineNumber,
        source_quote: trimmed,
        confidence: 0.68,
        reason: "Markdown heading treated as a conservative topic signal."
      });
    }

    const tagMatches = trimmed.matchAll(/(?:^|[\s([{])#([A-Za-z][A-Za-z0-9_-]{2,48})\b/g);
    for (const match of tagMatches) {
      addKeeperSignal(signals, seen, {
        signal_kind: "topic",
        value: match[1] ?? "",
        line: lineNumber,
        source_quote: trimmed,
        confidence: 0.64,
        reason: "Markdown tag treated as a conservative topic signal."
      });
    }
  });

  return signals;
}

function keeperSourceEndpoint(input: MemoryKeeperSourceInput): GraphCandidateEndpointRef {
  const sourceId =
    input.source_id ??
    keeperProposalId([
      "keeper-source",
      input.path ?? input.uri ?? input.label ?? boundedKeeperQuote(input.text, 80)
    ]);
  return {
    kind: "source",
    id: sourceId,
    label: input.label ?? input.path ?? input.uri ?? "Keeper source",
    metadata: {
      input_kind: input.input_kind,
      source_kind: input.source_kind ?? "external",
      source_id: input.source_id ?? null,
      path: input.path ?? null,
      uri: input.uri ?? null,
      source_resolution: input.source_resolution ?? null
    }
  };
}

function signalEndpoint(signal: MemoryKeeperSignal): GraphCandidateEndpointRef {
  return {
    kind: signal.node_kind,
    id: keeperProposalId(["keeper", signal.node_kind, signal.value]),
    label: signal.value,
    metadata: {
      signal_kind: signal.signal_kind,
      extraction_method: "keeper"
    }
  };
}

function signalNodeProposal(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult,
  signal: MemoryKeeperSignal
) {
  return keeperNodeCandidate(input, policy, {
    node_kind: signal.node_kind,
    title: signal.value,
    summary: `Keeper ${signal.signal_kind.replace("_", " ")} candidate from controlled source text.`,
    confidence: signal.confidence,
    reason: signal.reason,
    signals: [signal.signal_kind, signal.value],
    source_quote: signal.source_quote,
    source_anchor: signal.anchor,
    source_line: signal.line,
    extraction_rule: "keeper_explicit_signal",
    metadata: {
      signal_kind: signal.signal_kind,
      signal_value: signal.value,
      line: signal.line
    }
  });
}

function relationProposal(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult,
  relation: {
    relation_type: GraphTreeRelationType;
    src: GraphCandidateEndpointRef;
    dst: GraphCandidateEndpointRef;
    signal: MemoryKeeperSignal;
    reason: string;
    confidence: number;
  }
) {
  return keeperEdgeCandidate(input, policy, {
    relation_type: relation.relation_type,
    src: relation.src,
    dst: relation.dst,
    title: `${relation.src.label ?? relation.src.id} ${relation.relation_type} ${
      relation.dst.label ?? relation.dst.id
    }`,
    summary: relation.reason,
    confidence: relation.confidence,
    reason: relation.reason,
    signals: [relation.signal.signal_kind, relation.signal.value, relation.relation_type],
    source_quote: relation.signal.source_quote,
    source_anchor: relation.signal.anchor,
    source_line: relation.signal.line,
    extraction_rule: "keeper_relation_rule",
    metadata: {
      relation_rule: relation.relation_type,
      signal_kind: relation.signal.signal_kind,
      line: relation.signal.line
    }
  });
}

export function buildMemoryKeeperPlan(input: MemoryKeeperSourceInput): MemoryKeeperPlan {
  const policy = applySourceResolutionRiskPolicy(input, classifyMemoryKeeperInput(input.text));
  const signals = extractMemoryKeeperSignals(input).slice(0, 16);
  const proposals: MemoryKeeperProposal[] = signals.map((signal) =>
    signalNodeProposal(input, policy, signal)
  );
  const sourceEndpoint = keeperSourceEndpoint(input);
  const projects = signals.filter((signal) => signal.signal_kind === "project");
  const topics = signals.filter((signal) => signal.signal_kind === "topic");
  const relations: MemoryKeeperProposal[] = [];

  for (const signal of signals) {
    relations.push(
      relationProposal(input, policy, {
        relation_type: "derived_from",
        src: signalEndpoint(signal),
        dst: sourceEndpoint,
        signal,
        confidence: Math.min(signal.confidence, 0.76),
        reason: `Keeper ${signal.signal_kind.replace("_", " ")} candidate is derived from the source text.`
      })
    );
  }

  if (projects.length > 0) {
    const project = projects[0]!;
    const projectEndpoint = signalEndpoint(project);
    for (const topic of topics.slice(0, 8)) {
      relations.push(
        relationProposal(input, policy, {
          relation_type: "belongs_to_project",
          src: signalEndpoint(topic),
          dst: projectEndpoint,
          signal: topic,
          confidence: 0.72,
          reason: `Topic ${topic.value} is grouped under project ${project.value} by explicit keeper markers.`
        })
      );
    }
  }

  const primaryTopic = topics[0] ?? null;
  if (primaryTopic) {
    const primaryTopicEndpoint = signalEndpoint(primaryTopic);
    for (const signal of signals.filter(
      (item) => item.signal_kind === "entity" || item.signal_kind === "decision_cluster"
    )) {
      relations.push(
        relationProposal(input, policy, {
          relation_type: "about",
          src: signalEndpoint(signal),
          dst: primaryTopicEndpoint,
          signal,
          confidence: 0.7,
          reason: `Keeper ${signal.signal_kind.replace("_", " ")} signal is about topic ${primaryTopic.value}.`
        })
      );
    }
  }

  if (topics.length > 1) {
    const primaryTopicEndpoint = signalEndpoint(topics[0]!);
    for (const topic of topics.slice(1, 8)) {
      relations.push(
        relationProposal(input, policy, {
          relation_type: "same_topic_as",
          src: signalEndpoint(topic),
          dst: primaryTopicEndpoint,
          signal: topic,
          confidence: 0.62,
          reason: `Keeper topic ${topic.value} appears in the same controlled source as ${topics[0]!.value}.`
        })
      );
    }
  }

  proposals.push(...relations.slice(0, 24));
  return summarizeMemoryKeeperPlan(input, policy, proposals);
}

export function summarizeMemoryKeeperPlan(
  input: MemoryKeeperSourceInput,
  policy: MemoryKeeperPolicyResult,
  proposals: MemoryKeeperProposal[]
): MemoryKeeperPlan {
  const lifecycleStates = Array.from(
    new Set(proposals.map((proposal) => proposal.candidate.lifecycle_state ?? "candidate"))
  );
  return {
    contract_version: memoryKeeperContractVersion,
    dry_run: true,
    writes_database: false,
    input: {
      input_kind: input.input_kind,
      label: input.label ?? null,
      source_kind: input.source_kind ?? "external",
      source_id: input.source_id ?? null,
      path: input.path ?? null,
      anchor: input.anchor ?? null,
      source_resolution: input.source_resolution ?? null
    },
    policy,
    proposals,
    summary: {
      proposals: proposals.length,
      node_candidates: proposals.filter((proposal) => proposal.candidate.candidate_kind === "node")
        .length,
      edge_candidates: proposals.filter((proposal) => proposal.candidate.candidate_kind === "edge")
        .length,
      lifecycle_states: lifecycleStates.length > 0 ? lifecycleStates : [policy.lifecycle_state],
      source_refs_required: true
    }
  };
}
