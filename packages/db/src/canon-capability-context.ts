export type CanonCapabilityAuthority = {
  source: string;
  role: string;
  instruction_grade: false;
  notes: string[];
};

export type CanonCapabilityProvenance = {
  source_kind: "project_setting" | "project_source" | "agent_memory" | "imported_source" | "system";
  source_id: string | null;
  source_path: string | null;
  review_status:
    | "canonical"
    | "configured_reference"
    | "review_required"
    | "evidence_only"
    | "not_recorded";
};

export type CanonCapabilityReferenceState =
  | "configured"
  | "needed"
  | "missing"
  | "ready"
  | "review_required";

export type CanonCapabilityEnvironmentFact = {
  key: string;
  label: string;
  value_summary: string;
  status: CanonCapabilityReferenceState;
  provenance: CanonCapabilityProvenance;
  authority: CanonCapabilityAuthority;
};

export type CanonCapabilityReference = {
  id: string;
  label: string;
  kind: "connector" | "server" | "deployment" | "storage" | "model" | "other";
  status: CanonCapabilityReferenceState;
  access: "reference_only" | "configured_reference" | "consent_required";
  provenance: CanonCapabilityProvenance;
  authority: CanonCapabilityAuthority;
};

export type CanonCapabilitySecretReference = {
  name: string;
  reference: string;
  provider: string | null;
  status: "names_only" | "configured_reference" | "review_required";
  provenance: CanonCapabilityProvenance;
  authority: CanonCapabilityAuthority;
};

export type CanonCapabilityServerCanonLink = {
  kind: "security_baseline" | "ports_inventory" | "deployment_profile" | "backup_policy" | "other";
  label: string;
  status: "configured" | "needed" | "missing";
  reference: string | null;
  provenance: CanonCapabilityProvenance;
  authority: CanonCapabilityAuthority;
};

export type DocumentationAuthorityMapItem = {
  path: string;
  role:
    | "canonical_doc"
    | "generated_bootstrap"
    | "recallant_setting"
    | "imported_evidence"
    | "stale_handoff"
    | "review_required";
  status:
    | "canonical"
    | "configured_reference"
    | "review_required"
    | "evidence_only"
    | "not_recorded";
  reason: string;
  provenance: CanonCapabilityProvenance;
  authority: CanonCapabilityAuthority;
};

export type CanonCapabilityContext = {
  schema_version: 1;
  status: "not_recorded" | "ready" | "needs_review";
  summary: string;
  environment_facts: CanonCapabilityEnvironmentFact[];
  capability_references: CanonCapabilityReference[];
  secret_references: CanonCapabilitySecretReference[];
  server_canon_links: CanonCapabilityServerCanonLink[];
  documentation_authority_map: DocumentationAuthorityMapItem[];
  authority: CanonCapabilityAuthority;
};

export type CanonCapabilityContextInput = {
  environment_facts?: Array<Partial<CanonCapabilityEnvironmentFact>>;
  capability_references?: Array<Partial<CanonCapabilityReference>>;
  secret_references?: Array<Record<string, unknown>>;
  server_canon_links?: Array<Partial<CanonCapabilityServerCanonLink>>;
  documentation_authority_map?: Array<Partial<DocumentationAuthorityMapItem>>;
  max_items_per_category?: number;
};

export type CanonCapabilityDerivationInput = {
  documentation_posture?: unknown;
  starter_docs?: unknown;
  project_settings?: Array<Record<string, unknown>>;
  memories?: Array<Record<string, unknown>>;
  project_sources?: Array<Record<string, unknown>>;
  imports?: Array<Record<string, unknown>>;
  max_items_per_category?: number;
};

const rawSecretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /postgres:\/\/[^:\s]+:[^@\s]+@/i,
  /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['"]?[^'",\s]{6,}/i
];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => record(item) !== null)
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter((item) => item.length > 0)
    : [];
}

function slug(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function hasRawSecret(value: unknown): boolean {
  if (typeof value === "string") return rawSecretPatterns.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((item) => hasRawSecret(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
      if (
        ["value", "secret", "token", "password", "api_key", "apikey"].includes(key.toLowerCase())
      ) {
        return true;
      }
      return hasRawSecret(item);
    });
  }
  return false;
}

function authority(source: string, role = "startup_guidance"): CanonCapabilityAuthority {
  return {
    source,
    role,
    instruction_grade: false,
    notes: [
      "This context is guidance and provenance for agents, not a binding rule.",
      "Capability and secret references do not grant live access."
    ]
  };
}

function provenance(input?: Partial<CanonCapabilityProvenance>): CanonCapabilityProvenance {
  return {
    source_kind: input?.source_kind ?? "system",
    source_id: input?.source_id ?? null,
    source_path: input?.source_path ?? null,
    review_status: input?.review_status ?? "not_recorded"
  };
}

function limit<T>(items: readonly T[] | undefined, max: number) {
  return (items ?? []).slice(0, max);
}

function settingValue(settings: Array<Record<string, unknown>> | undefined, key: string) {
  return (settings ?? []).find((item) => text(item.key) === key)?.value;
}

function sourcePathFrom(row: Record<string, unknown>) {
  return text(row.source_path, text(row.path, text(row.uri))) || null;
}

function sourceIdFrom(row: Record<string, unknown>, fallback: string) {
  return text(row.id, text(row.source_id, fallback)) || fallback;
}

function reviewStatusFrom(value: unknown): CanonCapabilityProvenance["review_status"] {
  const status = text(value);
  if (
    status === "canonical" ||
    status === "configured_reference" ||
    status === "review_required" ||
    status === "evidence_only"
  ) {
    return status;
  }
  return "not_recorded";
}

function referenceStatusFrom(value: unknown): CanonCapabilityReferenceState {
  const status = text(value);
  if (
    status === "configured" ||
    status === "needed" ||
    status === "missing" ||
    status === "ready" ||
    status === "review_required"
  ) {
    return status;
  }
  if (status === "active") return "ready";
  if (status === "needs_review") return "review_required";
  return "review_required";
}

function capabilityKindFrom(value: unknown): CanonCapabilityReference["kind"] {
  const kind = text(value);
  if (kind === "connector") return "connector";
  if (kind === "server_path") return "server";
  if (kind === "repo" || kind === "workspace_path" || kind === "document_collection") {
    return "storage";
  }
  if (kind === "deployment" || kind === "server" || kind === "model" || kind === "storage") {
    return kind;
  }
  return "other";
}

function serverCanonKindFrom(value: unknown): CanonCapabilityServerCanonLink["kind"] {
  const marker = text(value).toLowerCase();
  if (marker.includes("security")) return "security_baseline";
  if (marker.includes("port")) return "ports_inventory";
  if (marker.includes("deploy") || marker.includes("runtime")) return "deployment_profile";
  if (marker.includes("backup")) return "backup_policy";
  return "other";
}

function conciseSummary(value: unknown, fallback: string) {
  const candidate = text(value, fallback).replace(/\s+/g, " ");
  return candidate.length > 180 ? `${candidate.slice(0, 177)}...` : candidate;
}

export function emptyCanonCapabilityContext(): CanonCapabilityContext {
  return {
    schema_version: 1,
    status: "not_recorded",
    summary:
      "No canon/capability context has been recorded yet. Ask Workbench or onboarding to review project references before relying on external capabilities.",
    environment_facts: [],
    capability_references: [],
    secret_references: [],
    server_canon_links: [
      {
        kind: "security_baseline",
        label: "Security baseline",
        status: "needed",
        reference: null,
        provenance: provenance(),
        authority: authority("canon_capability_context")
      },
      {
        kind: "ports_inventory",
        label: "Ports inventory",
        status: "needed",
        reference: null,
        provenance: provenance(),
        authority: authority("canon_capability_context")
      }
    ],
    documentation_authority_map: [],
    authority: authority("canon_capability_context", "context_pack_section")
  };
}

export function buildCanonCapabilityContext(
  input: CanonCapabilityContextInput = {}
): CanonCapabilityContext {
  const max = Math.max(1, Math.min(input.max_items_per_category ?? 12, 30));
  const environmentFacts = limit(input.environment_facts, max).map((item, index) => ({
    key: text(item.key, `environment_fact_${index + 1}`),
    label: text(item.label, text(item.key, "Environment fact")),
    value_summary: text(item.value_summary, "Configured reference recorded."),
    status: item.status ?? "configured",
    provenance: provenance(item.provenance),
    authority: item.authority ?? authority("canon_capability_context")
  }));
  const capabilityReferences = limit(input.capability_references, max).map((item, index) => ({
    id: text(item.id, `capability_${index + 1}`),
    label: text(item.label, "Capability reference"),
    kind: item.kind ?? "other",
    status: item.status ?? "review_required",
    access: item.access ?? "reference_only",
    provenance: provenance(item.provenance),
    authority: item.authority ?? authority("canon_capability_context")
  }));
  const secretReferences = limit(input.secret_references, max)
    .filter(
      (item) => !hasRawSecret(item.value) && !hasRawSecret(item.secret) && !hasRawSecret(item.token)
    )
    .map((item, index): CanonCapabilitySecretReference => {
      const status: CanonCapabilitySecretReference["status"] =
        item.status === "configured_reference" || item.status === "review_required"
          ? item.status
          : "names_only";
      return {
        name: text(item.name, `SECRET_REFERENCE_${index + 1}`),
        reference: text(item.reference, text(item.name, "secret_reference")),
        provider: text(item.provider, "") || null,
        status,
        provenance: provenance(item.provenance as Partial<CanonCapabilityProvenance> | undefined),
        authority: authority("canon_capability_context")
      };
    });
  const serverCanonLinks = limit(input.server_canon_links, max).map((item) => ({
    kind: item.kind ?? "other",
    label: text(item.label, "Server canon reference"),
    status: item.status ?? "needed",
    reference: text(item.reference, "") || null,
    provenance: provenance(item.provenance),
    authority: item.authority ?? authority("canon_capability_context")
  }));
  const documentationAuthorityMap = limit(input.documentation_authority_map, max).map((item) => ({
    path: text(item.path, "project documentation"),
    role: item.role ?? "review_required",
    status: item.status ?? "review_required",
    reason: text(item.reason, "Review this source before treating it as project authority."),
    provenance: provenance(item.provenance),
    authority: item.authority ?? authority("canon_capability_context")
  }));
  const populated =
    environmentFacts.length +
    capabilityReferences.length +
    secretReferences.length +
    serverCanonLinks.length +
    documentationAuthorityMap.length;
  return {
    schema_version: 1,
    status: populated > 0 ? "ready" : "not_recorded",
    summary:
      populated > 0
        ? "Canon/capability startup guidance is available as bounded references."
        : emptyCanonCapabilityContext().summary,
    environment_facts: environmentFacts,
    capability_references: capabilityReferences,
    secret_references: secretReferences,
    server_canon_links: serverCanonLinks.length
      ? serverCanonLinks
      : emptyCanonCapabilityContext().server_canon_links,
    documentation_authority_map: documentationAuthorityMap,
    authority: authority("canon_capability_context", "context_pack_section")
  };
}

export function deriveCanonCapabilityContext(
  input: CanonCapabilityDerivationInput = {}
): CanonCapabilityContext {
  const max = Math.max(1, Math.min(input.max_items_per_category ?? 12, 30));
  const posture = record(
    input.documentation_posture ?? settingValue(input.project_settings, "documentation_posture")
  );
  const starterDocs = record(
    input.starter_docs ?? settingValue(input.project_settings, "starter_docs")
  );
  const postureCanon = record(posture?.canon_context);
  const environmentFacts: Array<Partial<CanonCapabilityEnvironmentFact>> = [];
  const capabilityReferences: Array<Partial<CanonCapabilityReference>> = [];
  const secretReferences: Array<Record<string, unknown>> = [];
  const serverCanonLinks: Array<Partial<CanonCapabilityServerCanonLink>> = [];
  const documentationAuthorityMap: Array<Partial<DocumentationAuthorityMapItem>> = [];

  for (const memory of input.memories ?? []) {
    if (text(memory.status) !== "accepted") continue;
    const memoryType = text(memory.memory_type);
    const scopeKind = text(memory.scope_kind);
    const isEnvironmentLike =
      ["environment", "domain", "capability"].includes(scopeKind) ||
      ["environment_fact", "domain_fact", "capability_fact"].includes(memoryType);
    if (!isEnvironmentLike) continue;
    if (hasRawSecret(memory.body) || hasRawSecret(memory.metadata)) continue;
    environmentFacts.push({
      key: slug(text(memory.scope_id, text(memory.title)), `memory_${environmentFacts.length + 1}`),
      label: text(memory.title, "Accepted project fact"),
      value_summary: conciseSummary(memory.body, "Accepted project memory recorded."),
      status: referenceStatusFrom(memory.status),
      provenance: {
        source_kind: "agent_memory",
        source_id: sourceIdFrom(memory, `memory_${environmentFacts.length + 1}`),
        source_path: sourcePathFrom(memory),
        review_status: "canonical"
      },
      authority: authority("accepted_agent_memory")
    });
  }

  for (const setting of input.project_settings ?? []) {
    const key = text(setting.key);
    if (/(secret|api[_-]?key|token|password|database[_-]?url|auth)/i.test(key)) {
      secretReferences.push({
        name: key,
        reference: key,
        provider: text(setting.source, "") || null,
        status: "configured_reference",
        provenance: {
          source_kind: "project_setting",
          source_id: key,
          source_path: null,
          review_status: "configured_reference"
        }
      });
      continue;
    }
    if (!["runtime_profile", "project_profile", "capability_profile"].includes(key)) continue;
    const value = setting.value;
    if (hasRawSecret(value)) continue;
    environmentFacts.push({
      key,
      label: key.replace(/_/g, " "),
      value_summary: conciseSummary(value, "Project metadata reference is recorded."),
      status: "configured",
      provenance: {
        source_kind: "project_setting",
        source_id: key,
        source_path: null,
        review_status: "configured_reference"
      },
      authority: authority("project_settings")
    });
  }

  for (const source of input.project_sources ?? []) {
    const sourceKind = text(source.source_kind, text(source.kind));
    const metadata = record(source.metadata) ?? {};
    const contract =
      record(metadata.source_access_contract) ?? record(source.source_access_contract) ?? {};
    const status = referenceStatusFrom(
      contract.capability_binding_status ?? contract.readiness ?? source.status
    );
    const access =
      text(contract.consent_state) === "granted" || text(contract.access) === "configured_reference"
        ? "configured_reference"
        : text(contract.consent_state) === "pending" || text(contract.access) === "consent_required"
          ? "consent_required"
          : "reference_only";
    capabilityReferences.push({
      id: sourceIdFrom(source, slug(text(source.label, sourceKind), "project_source")),
      label: text(source.label, "Project source"),
      kind: capabilityKindFrom(sourceKind),
      status,
      access,
      provenance: {
        source_kind: "project_source",
        source_id: sourceIdFrom(source, "project_source"),
        source_path: sourcePathFrom(source),
        review_status:
          status === "ready" || status === "configured" ? "configured_reference" : "review_required"
      },
      authority: authority("project_sources")
    });

    for (const secretReference of records(metadata.secret_references)) {
      secretReferences.push({
        ...secretReference,
        provenance: {
          source_kind: "project_source",
          source_id: sourceIdFrom(source, "project_source"),
          source_path: sourcePathFrom(source),
          review_status: "evidence_only"
        }
      });
    }
  }

  for (const imported of input.imports ?? []) {
    const importId = sourceIdFrom(imported, `import_${secretReferences.length + 1}`);
    for (const secretReference of records(
      imported.secret_references ?? record(imported.metadata)?.secret_references
    )) {
      secretReferences.push({
        ...secretReference,
        provenance: {
          source_kind: "imported_source",
          source_id: importId,
          source_path: sourcePathFrom(imported),
          review_status: reviewStatusFrom(
            imported.review_status ?? imported.status ?? "evidence_only"
          )
        }
      });
    }
    const reviewRequired =
      imported.review_required === true || text(imported.status) === "needs_review";
    const path = sourcePathFrom(imported);
    if (path) {
      documentationAuthorityMap.push({
        path,
        role: reviewRequired ? "review_required" : "imported_evidence",
        status: reviewRequired ? "review_required" : "evidence_only",
        reason: reviewRequired
          ? "Imported source needs owner review before it becomes documentation authority."
          : "Imported source is evidence for agent startup, not binding instructions.",
        provenance: {
          source_kind: "imported_source",
          source_id: importId,
          source_path: path,
          review_status: reviewRequired ? "review_required" : "evidence_only"
        }
      });
    }
  }

  for (const reference of strings(postureCanon?.configured_references)) {
    if (hasRawSecret(reference)) continue;
    serverCanonLinks.push({
      kind: serverCanonKindFrom(reference),
      label: reference,
      status: "configured",
      reference,
      provenance: {
        source_kind: "project_setting",
        source_id: "documentation_posture",
        source_path: null,
        review_status: "configured_reference"
      },
      authority: authority("documentation_posture")
    });
  }
  const configuredKinds = new Set(serverCanonLinks.map((item) => item.kind));
  for (const needed of strings(postureCanon?.recommended_reference_kinds)) {
    const kind = serverCanonKindFrom(needed);
    if (configuredKinds.has(kind)) continue;
    serverCanonLinks.push({
      kind,
      label: needed,
      status: "needed",
      reference: null,
      provenance: {
        source_kind: "project_setting",
        source_id: "documentation_posture",
        source_path: null,
        review_status: "review_required"
      },
      authority: authority("documentation_posture")
    });
  }

  for (const path of strings(posture?.existing_docs)) {
    documentationAuthorityMap.push({
      path,
      role: "canonical_doc",
      status: "canonical",
      reason: "Documentation posture recognized this file as existing project documentation.",
      provenance: {
        source_kind: "project_setting",
        source_id: "documentation_posture",
        source_path: path,
        review_status: "canonical"
      },
      authority: authority("documentation_posture")
    });
  }
  for (const path of strings(posture?.missing_recommended_docs)) {
    documentationAuthorityMap.push({
      path,
      role: "review_required",
      status: "review_required",
      reason: "Documentation posture recommends deciding whether this file should exist.",
      provenance: {
        source_kind: "project_setting",
        source_id: "documentation_posture",
        source_path: path,
        review_status: "review_required"
      },
      authority: authority("documentation_posture")
    });
  }
  for (const path of strings(
    record(starterDocs?.outcome)?.generated_files ?? starterDocs?.generated_files
  )) {
    documentationAuthorityMap.push({
      path,
      role: "generated_bootstrap",
      status: "configured_reference",
      reason: "Starter-doc workflow generated this file as bootstrap documentation.",
      provenance: {
        source_kind: "project_setting",
        source_id: "starter_docs",
        source_path: path,
        review_status: "configured_reference"
      },
      authority: authority("starter_docs")
    });
  }

  return buildCanonCapabilityContext({
    environment_facts: environmentFacts,
    capability_references: capabilityReferences,
    secret_references: secretReferences,
    server_canon_links: serverCanonLinks,
    documentation_authority_map: documentationAuthorityMap,
    max_items_per_category: max
  });
}

export function canonCapabilityContextContainsRawSecret(value: unknown) {
  return hasRawSecret(value);
}
