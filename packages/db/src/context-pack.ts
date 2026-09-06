type JsonRecord = Record<string, unknown>;

export type ContextPackOmissions = {
  sections: string[];
  items?: Record<string, number>;
  fields?: Record<string, number>;
  reason: "aggregate_budget" | "source_limit";
};

export type ContextPackBudget = {
  max_chars_total: number;
  used_chars_estimate?: number;
};

export type ContextPackPayload = JsonRecord & {
  context_pack_id?: unknown;
  project_id?: unknown;
  session_id?: unknown;
  sections?: JsonRecord;
  budget?: ContextPackBudget;
  omissions?: ContextPackOmissions;
  truncated?: boolean;
};

const DEFAULT_MAX_CHARS = 12_000;
const MAX_CHECKPOINT_TEXT = 160;
const MAX_MEMORY_TITLE = 180;
const MAX_MEMORY_BODY = 420;
const MAX_SUMMARY = 220;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown, fallback = "not_recorded") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function shorten(value: unknown, maxChars: number, fallback = "not_recorded") {
  const text = stringValue(value, fallback);
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactAudience(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item) => {
    const entry = record(item);
    return {
      kind: shorten(entry.kind, 32),
      id: typeof entry.id === "string" ? entry.id : null
    };
  });
}

function compactProvenance(value: unknown) {
  const entry = record(value);
  return {
    source_count: numberValue(entry.source_count) ?? 0,
    primary_source_kind: entry.primary_source_kind ?? null,
    primary_source_id: entry.primary_source_id ?? null,
    summary: shorten(entry.summary, 120)
  };
}

function minimalProvenance(value: unknown) {
  const entry = record(value);
  return {
    source_count: numberValue(entry.source_count) ?? 0,
    primary_source_kind: entry.primary_source_kind ?? null,
    summary: shorten(entry.summary, 80)
  };
}

function compactSourceRefs(value: unknown, includeQuotes: boolean) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => {
    const entry = record(item);
    return {
      source_kind: entry.source_kind ?? null,
      source_id: entry.source_id ?? null,
      ...(includeQuotes && typeof entry.quote === "string"
        ? { quote: shorten(entry.quote, 120) }
        : {})
    };
  });
}

function compactMemory(value: unknown, includeBody: boolean): JsonRecord {
  const entry = record(value);
  return {
    memory_id: entry.memory_id ?? entry.id ?? null,
    memory_type: entry.memory_type ?? null,
    title: shorten(entry.title, MAX_MEMORY_TITLE),
    ...(includeBody ? { body: shorten(entry.body, MAX_MEMORY_BODY) } : {}),
    status: entry.status ?? null,
    use_policy: entry.use_policy ?? null,
    scope: entry.scope ?? null,
    scope_kind: entry.scope_kind ?? null,
    scope_id: entry.scope_id ?? null,
    audience: compactAudience(entry.audience),
    ...(numberValue(entry.confidence) !== null ? { confidence: entry.confidence } : {}),
    updated_at: entry.updated_at ?? null,
    source_refs: compactSourceRefs(entry.source_refs, false),
    provenance: compactProvenance(entry.provenance)
  };
}

function minimalMemory(value: unknown): JsonRecord {
  const entry = record(value);
  return {
    memory_id: entry.memory_id ?? entry.id ?? null,
    ...(entry.use_policy === "instruction_grade" ? { title: shorten(entry.title, 80) } : {}),
    use_policy: entry.use_policy ?? null,
    audience: compactAudience(entry.audience),
    source_refs: compactSourceRefs(entry.source_refs, false),
    provenance: minimalProvenance(entry.provenance)
  };
}

function compactEvidence(value: unknown): JsonRecord {
  const entry = record(value);
  return {
    chunk_id: entry.chunk_id ?? null,
    source_event_id: entry.source_event_id ?? null,
    score: numberValue(entry.score) ?? 0,
    path: shorten(entry.path, 48),
    occurred_at: entry.occurred_at ?? null,
    provenance: compactProvenance(entry.provenance),
    text_excerpt: shorten(entry.text_excerpt ?? entry.excerpt, MAX_MEMORY_BODY)
  };
}

function minimalEvidence(value: unknown): JsonRecord {
  const entry = record(value);
  return {
    chunk_id: entry.chunk_id ?? null,
    source_event_id: entry.source_event_id ?? null,
    score: numberValue(entry.score) ?? 0
  };
}

function compactDocumentationPosture(value: unknown): JsonRecord {
  const entry = record(value);
  const authority = record(entry.authority);
  const canonContext = record(entry.canon_context);
  return {
    status: entry.status ?? "not_recorded",
    profile: entry.profile ?? "unknown",
    summary: shorten(entry.summary, MAX_SUMMARY),
    missing_recommended_docs: Array.isArray(entry.missing_recommended_docs)
      ? entry.missing_recommended_docs.slice(0, 6).map((item) => shorten(item, 80))
      : [],
    authority: {
      source: authority.source ?? null,
      key: authority.key ?? null,
      role: authority.role ?? "startup_guidance",
      instruction_grade: authority.instruction_grade === true
    },
    canon_context: {
      needed: canonContext.needed === true,
      reason: shorten(canonContext.reason, 140),
      recommended_reference_kinds: Array.isArray(canonContext.recommended_reference_kinds)
        ? canonContext.recommended_reference_kinds.slice(0, 5).map((item) => shorten(item, 48))
        : []
    },
    capability_hints: Array.isArray(entry.capability_hints)
      ? entry.capability_hints.slice(0, 5).map((item) => {
          const hint = record(item);
          return {
            kind: shorten(hint.kind, 48),
            status: shorten(hint.status, 32),
            guidance: shorten(hint.guidance, 140)
          };
        })
      : []
  };
}

function compactCanonCapabilityContext(value: unknown): JsonRecord {
  const entry = record(value);
  const compactAuthority = (value: unknown) => {
    const authority = record(value);
    return {
      source: shorten(authority.source, 80),
      role: shorten(authority.role, 80),
      instruction_grade: authority.instruction_grade === true,
      notes: Array.isArray(authority.notes)
        ? authority.notes.slice(0, 2).map((item) => shorten(item, 140))
        : []
    };
  };
  const compactReference = (item: unknown) => {
    const reference = record(item);
    return {
      id: reference.id ?? null,
      label: shorten(reference.label, 80),
      kind: shorten(reference.kind, 48),
      status: shorten(reference.status, 32),
      access: shorten(reference.access, 32),
      provenance: compactProvenance(reference.provenance),
      authority: compactAuthority(reference.authority)
    };
  };
  const compactFact = (item: unknown) => {
    const fact = record(item);
    return {
      key: shorten(fact.key, 80),
      label: shorten(fact.label, 100),
      value_summary: shorten(fact.value_summary, 140),
      status: shorten(fact.status, 32),
      provenance: compactProvenance(fact.provenance),
      authority: compactAuthority(fact.authority)
    };
  };
  const compactSecret = (item: unknown) => {
    const secret = record(item);
    return {
      name: shorten(secret.name, 80),
      reference: shorten(secret.reference, 120),
      provider: shorten(secret.provider, 80, ""),
      status: shorten(secret.status, 32),
      provenance: compactProvenance(secret.provenance),
      authority: compactAuthority(secret.authority)
    };
  };
  const compactDocumentationAuthority = (item: unknown) => {
    const documentation = record(item);
    return {
      path: shorten(documentation.path, 120),
      role: shorten(documentation.role, 40),
      status: shorten(documentation.status, 40),
      reason: shorten(documentation.reason, 160),
      provenance: compactProvenance(documentation.provenance),
      authority: compactAuthority(documentation.authority)
    };
  };
  return {
    schema_version: entry.schema_version ?? 1,
    status: entry.status ?? "not_recorded",
    summary: shorten(entry.summary, MAX_SUMMARY),
    environment_facts: Array.isArray(entry.environment_facts)
      ? entry.environment_facts.slice(0, 5).map(compactFact)
      : [],
    capability_references: Array.isArray(entry.capability_references)
      ? entry.capability_references.slice(0, 5).map(compactReference)
      : [],
    secret_references: Array.isArray(entry.secret_references)
      ? entry.secret_references.slice(0, 5).map(compactSecret)
      : [],
    server_canon_links: Array.isArray(entry.server_canon_links)
      ? entry.server_canon_links.slice(0, 5).map((item) => {
          const link = record(item);
          return {
            kind: shorten(link.kind, 48),
            label: shorten(link.label, 80),
            status: shorten(link.status, 32),
            reference: null,
            authority: compactAuthority(link.authority)
          };
        })
      : [],
    documentation_authority_map: Array.isArray(entry.documentation_authority_map)
      ? entry.documentation_authority_map.slice(0, 5).map(compactDocumentationAuthority)
      : [],
    authority: compactAuthority(entry.authority)
  };
}

function compactCheckpoint(value: unknown, aggressive = false): JsonRecord {
  const entry = record(value);
  const payload = record(entry.payload);
  const maxChars = aggressive ? 24 : MAX_CHECKPOINT_TEXT;
  return {
    payload: {
      current_status: shorten(payload.current_status, maxChars),
      current_focus: shorten(payload.current_focus, maxChars),
      next_step: shorten(payload.next_step, maxChars),
      ...(aggressive
        ? {}
        : {
            open_questions: Array.isArray(payload.open_questions)
              ? payload.open_questions.slice(0, 4).map((item) => shorten(item, 80))
              : []
          })
    },
    ...(aggressive ? {} : { updated_at: entry.updated_at ?? null })
  };
}

function compactRecovery(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item) => {
    const entry = record(item);
    return {
      session_id: entry.session_id ?? null,
      last_seen_at: entry.last_seen_at ?? null,
      status: entry.status ?? null
    };
  });
}

function compactLocalSpool(value: unknown) {
  const entry = record(value);
  return {
    status: entry.status ?? "unknown",
    ...(numberValue(entry.unsynced_count) !== null ? { unsynced_count: entry.unsynced_count } : {})
  };
}

function clonePayload(payload: ContextPackPayload) {
  return JSON.parse(JSON.stringify(payload)) as ContextPackPayload;
}

function serializedLength(payload: ContextPackPayload) {
  return JSON.stringify(payload, null, 2).length;
}

type OmissionState = {
  changed: boolean;
  initialTruncated: boolean;
  sections: Set<string>;
  items: Record<string, number>;
  fields: Record<string, number>;
};

function omissionState(payload: ContextPackPayload): OmissionState {
  const existing = record(payload.omissions);
  const sections = new Set(
    Array.isArray(existing.sections)
      ? existing.sections.filter((item): item is string => typeof item === "string")
      : []
  );
  const items = record(existing.items) as Record<string, number>;
  const fields = record(existing.fields) as Record<string, number>;
  const initialTruncated = payload.truncated === true;
  if (initialTruncated) fields.upstream_truncation = 1;
  return {
    changed:
      initialTruncated ||
      sections.size > 0 ||
      Object.keys(items).length > 0 ||
      Object.keys(fields).length > 0,
    initialTruncated,
    sections,
    items: { ...items },
    fields: { ...fields }
  };
}

function addCount(target: Record<string, number>, key: string, count = 1) {
  if (count > 0) target[key] = (target[key] ?? 0) + count;
}

function materializeOmissions(state: OmissionState): ContextPackOmissions | null {
  if (
    !state.changed &&
    state.sections.size === 0 &&
    Object.keys(state.items).length === 0 &&
    Object.keys(state.fields).length === 0
  ) {
    return null;
  }
  const result: ContextPackOmissions = {
    sections: Array.from(state.sections).sort(),
    reason: "aggregate_budget"
  };
  if (Object.keys(state.items).length > 0) {
    result.items = Object.fromEntries(
      Object.entries(state.items).sort(([left], [right]) => left.localeCompare(right))
    );
  }
  if (Object.keys(state.fields).length > 0) {
    result.fields = Object.fromEntries(
      Object.entries(state.fields).sort(([left], [right]) => left.localeCompare(right))
    );
  }
  return result;
}

function setBudgetMetadata(payload: ContextPackPayload, state: OmissionState, maxChars: number) {
  const omissions = materializeOmissions(state);
  payload.truncated = state.initialTruncated || state.changed || omissions !== null;
  if (omissions) payload.omissions = omissions;
  else delete payload.omissions;
  payload.budget = {
    ...record(payload.budget),
    max_chars_total: maxChars,
    used_chars_estimate: 0
  } as ContextPackBudget;
}

function tryFit(payload: ContextPackPayload, state: OmissionState, maxChars: number) {
  setBudgetMetadata(payload, state, maxChars);
  let measured = serializedLength(payload);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    payload.budget = {
      ...record(payload.budget),
      max_chars_total: maxChars,
      used_chars_estimate: measured
    } as ContextPackBudget;
    const next = serializedLength(payload);
    if (next === measured) break;
    measured = next;
  }
  payload.budget = {
    ...record(payload.budget),
    max_chars_total: maxChars,
    used_chars_estimate: measured
  } as ContextPackBudget;
  return measured <= maxChars;
}

function ensureRequiredFields(payload: ContextPackPayload) {
  payload.context_pack_id ??= "not_recorded";
  payload.project_id ??= "not_recorded";
  payload.session_id ??= "not_recorded";
  payload.profile ??= "compact";
  const sections = (payload.sections ??= {});
  const checkpoint = record(sections.checkpoint);
  const checkpointPayload = record(checkpoint.payload);
  sections.checkpoint = {
    ...checkpoint,
    payload: {
      ...checkpointPayload,
      current_status: checkpointPayload.current_status ?? "not_recorded",
      current_focus: checkpointPayload.current_focus ?? "not_recorded",
      next_step: checkpointPayload.next_step ?? "not_recorded",
      open_questions: checkpointPayload.open_questions ?? []
    }
  };
  payload.provenance ??= {
    source_kind: "project_context",
    source_id: stringValue(payload.project_id),
    scope: "project",
    authority: "startup_guidance",
    review_status: "not_recorded"
  };
}

function removeEvidence(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  const evidence = Array.isArray(sections.evidence_excerpts) ? sections.evidence_excerpts : [];
  if (evidence.length === 0) return;
  sections.evidence_excerpts = [];
  state.changed = true;
  state.sections.add("evidence_excerpts");
  addCount(state.items, "evidence_excerpts", evidence.length);
}

function compactLargeMetadata(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  if (Array.isArray(sections.binding_rules)) {
    const bindingRules = sections.binding_rules.map((item) => compactMemory(item, true));
    sections.binding_rules = bindingRules;
  }
  if (Array.isArray(sections.working_memories)) {
    const workingMemories = sections.working_memories.map((item) => compactMemory(item, true));
    sections.working_memories = workingMemories;
  }
  if (Array.isArray(sections.evidence_excerpts)) {
    const evidence = sections.evidence_excerpts.map(compactEvidence);
    sections.evidence_excerpts = evidence;
  }
  sections.documentation_posture = compactDocumentationPosture(sections.documentation_posture);
  sections.canon_capability_context = compactCanonCapabilityContext(
    sections.canon_capability_context
  );
  sections.recovery = compactRecovery(sections.recovery);
  sections.local_spool_status = compactLocalSpool(sections.local_spool_status);
  state.changed = true;
}

function shortenMemoryBodies(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  for (const sectionName of ["working_memories", "binding_rules"] as const) {
    const items = Array.isArray(sections[sectionName]) ? sections[sectionName] : null;
    if (!items) continue;
    const shortened = items.map(minimalMemory);
    const removedBodies = items.filter((item) => "body" in record(item)).length;
    sections[sectionName] = shortened;
    if (removedBodies > 0) {
      state.changed = true;
      state.fields[`${sectionName}.body`] =
        (state.fields[`${sectionName}.body`] ?? 0) + removedBodies;
    }
  }
}

function compactBudgetOverhead(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  const checkpoint = record(sections.checkpoint);
  if (Object.keys(checkpoint).length > 0) {
    const compactedCheckpoint = compactCheckpoint(checkpoint);
    delete compactedCheckpoint.updated_at;
    const checkpointPayload = record(compactedCheckpoint.payload);
    delete checkpointPayload.open_questions;
    sections.checkpoint = {
      payload: {
        current_status: checkpointPayload.current_status,
        current_focus: checkpointPayload.current_focus,
        next_step: checkpointPayload.next_step
      }
    };
    state.changed = true;
    state.fields["checkpoint.detail"] = 1;
  }

  const provenance = record(payload.provenance);
  if (Object.keys(provenance).length > 0) {
    payload.provenance = {
      source_kind: provenance.source_kind ?? "project_context",
      source_id: provenance.source_id ?? null,
      scope: provenance.scope ?? "project",
      authority: provenance.authority ?? "startup_guidance"
    };
    state.changed = true;
    state.fields["provenance.detail"] = 1;
  }

  if (Array.isArray(sections.recovery)) {
    sections.recovery = sections.recovery.slice(0, 1).map((item) => {
      const recovery = record(item);
      return {
        session_id: recovery.session_id ?? null,
        status: recovery.status ?? null
      };
    });
    state.changed = true;
    state.fields["recovery.detail"] = 1;
  }

  if (Array.isArray(sections.evidence_excerpts) && sections.evidence_excerpts.length > 0) {
    const evidence = sections.evidence_excerpts;
    sections.evidence_excerpts = evidence.slice(0, 2).map(minimalEvidence);
    const omittedEvidence = Math.max(0, evidence.length - 2);
    state.changed = true;
    state.sections.add("evidence_excerpts");
    addCount(state.items, "evidence_excerpts", omittedEvidence);
  }

  const posture = record(sections.documentation_posture);
  if (Object.keys(posture).length > 0) {
    delete sections.documentation_posture;
    state.changed = true;
    state.fields["documentation_posture.detail"] = 1;
    state.sections.add("documentation_posture");
  }

  const canonContext = record(sections.canon_capability_context);
  if (Object.keys(canonContext).length > 0) {
    delete sections.canon_capability_context;
    state.changed = true;
    state.fields["canon_capability_context.detail"] = 1;
    state.sections.add("canon_capability_context");
  }

  const audit = record(payload.audit);
  if (Object.keys(audit).length > 0) {
    payload.audit = {
      durable: audit.durable === true,
      surface: audit.surface ?? "mcp",
      status: audit.status ?? "recorded"
    };
    state.changed = true;
    state.fields["audit.detail"] = 1;
  }

  for (const sectionName of ["operational_bindings", "suggested_next_fetches"] as const) {
    if (Array.isArray(sections[sectionName]) && sections[sectionName].length === 0) {
      delete sections[sectionName];
      state.changed = true;
      state.sections.add(sectionName);
    }
  }
  const spool = record(sections.local_spool_status);
  if (spool.status === "unknown" && Object.keys(spool).length === 1) {
    delete sections.local_spool_status;
    state.changed = true;
    state.sections.add("local_spool_status");
  }
  const canon = record(sections.canon_capability_context);
  if (canon.status === "omitted" && Object.keys(canon).length === 2) {
    delete sections.canon_capability_context;
    state.changed = true;
    state.sections.add("canon_capability_context");
  }
  delete payload.profile;
  delete payload.trace_id;
  state.changed = true;
  state.sections.add("profile");
  state.fields.trace_id = (state.fields.trace_id ?? 0) + 1;
}

function evictArrayItems(
  payload: ContextPackPayload,
  state: OmissionState,
  sectionName: "working_memories" | "binding_rules",
  maxChars: number,
  minimumItems = 0
) {
  const sections = record(payload.sections);
  const items = Array.isArray(sections[sectionName]) ? sections[sectionName] : [];
  while (items.length > minimumItems) {
    const current = items.pop();
    if (current === undefined) break;
    state.changed = true;
    addCount(state.items, sectionName);
    state.sections.add(sectionName);
    if (tryFit(payload, state, maxChars)) return true;
  }
  return false;
}

function shortenOptionalSection(
  payload: ContextPackPayload,
  state: OmissionState,
  sectionName: string,
  value: unknown
) {
  if (value === undefined) return;
  const sections = record(payload.sections);
  sections[sectionName] = { status: "omitted", reason: "aggregate_budget" };
  state.changed = true;
  state.sections.add(sectionName);
}

function compactRequiredContent(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  sections.checkpoint = compactCheckpoint(sections.checkpoint, true);
  payload.provenance = {
    source_kind: "project_context",
    source_id: shorten(payload.project_id, 64),
    scope: "project"
  };
  delete payload.trace_id;
  payload.warnings = ["Omitted."];
  const audit = record(payload.audit);
  if (Object.keys(audit).length > 0) {
    payload.audit = {
      status: audit.status ?? "recorded"
    };
    state.fields["audit.detail"] = 1;
  }
  state.changed = true;
  state.fields["checkpoint.prose"] = 1;
  state.fields.trace_id = 1;
}

function minimalSections(payload: ContextPackPayload, state: OmissionState) {
  const sections = record(payload.sections);
  for (const sectionName of [
    "documentation_posture",
    "canon_capability_context",
    "recovery",
    "binding_rules",
    "working_memories",
    "operational_bindings",
    "local_spool_status",
    "evidence_excerpts",
    "suggested_next_fetches"
  ]) {
    if (sectionName in sections) {
      delete sections[sectionName];
      state.sections.add(sectionName);
    }
  }
  delete payload.profile;
  delete payload.trace_id;
  const audit = record(payload.audit);
  if (Object.keys(audit).length > 0) {
    payload.audit = { status: audit.status ?? "recorded" };
  }
  state.sections = new Set(["optional_sections"]);
  state.fields = {};
  state.changed = true;
}

export function isContextPackPayload(value: unknown): value is ContextPackPayload {
  const payload = record(value);
  return "context_pack_id" in payload && "sections" in payload && "budget" in payload;
}

export function boundContextPack<T extends ContextPackPayload>(
  input: T,
  requestedMaxChars = DEFAULT_MAX_CHARS
): T {
  const maxChars = Number.isFinite(requestedMaxChars)
    ? Math.max(1, Math.floor(requestedMaxChars))
    : DEFAULT_MAX_CHARS;
  const payload = clonePayload(input);
  const state = omissionState(payload);
  ensureRequiredFields(payload);

  if (tryFit(payload, state, maxChars)) return payload as T;

  removeEvidence(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  compactLargeMetadata(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  compactBudgetOverhead(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  if (evictArrayItems(payload, state, "working_memories", maxChars, 1)) return payload as T;

  shortenMemoryBodies(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  if (evictArrayItems(payload, state, "working_memories", maxChars)) return payload as T;
  if (evictArrayItems(payload, state, "binding_rules", maxChars)) return payload as T;

  const sections = record(payload.sections);
  for (const sectionName of [
    "canon_capability_context",
    "documentation_posture",
    "recovery",
    "local_spool_status",
    "operational_bindings",
    "suggested_next_fetches"
  ]) {
    shortenOptionalSection(payload, state, sectionName, sections[sectionName]);
    if (tryFit(payload, state, maxChars)) return payload as T;
  }

  compactRequiredContent(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  minimalSections(payload, state);
  if (tryFit(payload, state, maxChars)) return payload as T;

  throw new Error(
    `CONTEXT_PACK_BUDGET_TOO_SMALL: requested ${maxChars} characters cannot fit required context identity`
  );
}
