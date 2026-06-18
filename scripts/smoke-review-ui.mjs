import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { URLSearchParams } from "node:url";
import { createRecallantHttpServer, getRecallantHttpConfig } from "../apps/server/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

function htmlTextExcerpt(html, marker, length = 520) {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const index = text.indexOf(marker);
  return index >= 0 ? text.slice(index, index + length) : text.slice(0, length);
}

const token = `review-smoke-${randomUUID()}`;
process.env.RECALLANT_AUTH_TOKEN = token;
process.env.RECALLANT_SESSION_SECRET = `review-session-${randomUUID()}`;
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
delete process.env.RECALLANT_CLOUDFLARE_MODE;
delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
delete process.env.RECALLANT_ADMIN_EMAILS;

const defaultHttpConfig = getRecallantHttpConfig();
if (
  defaultHttpConfig.host !== "127.0.0.1" ||
  defaultHttpConfig.cloudflare.mode !== "disabled" ||
  defaultHttpConfig.recallant_auth_required !== true
) {
  throw new Error(`Unexpected default HTTP security config: ${JSON.stringify(defaultHttpConfig)}`);
}

const originalHost = process.env.RECALLANT_HOST;
const originalAllowPublicBind = process.env.RECALLANT_ALLOW_PUBLIC_BIND;
try {
  process.env.RECALLANT_HOST = "0.0.0.0";
  delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  try {
    getRecallantHttpConfig();
    throw new Error("Public bind was allowed without explicit opt-in");
  } catch (error) {
    if (!String(error).includes("VALIDATION_ERROR")) throw error;
  }
  process.env.RECALLANT_ALLOW_PUBLIC_BIND = "true";
  const publicOptInConfig = getRecallantHttpConfig();
  if (publicOptInConfig.public_bind_allowed !== true) {
    throw new Error(`Public bind opt-in config failed: ${JSON.stringify(publicOptInConfig)}`);
  }
} finally {
  if (originalHost === undefined) delete process.env.RECALLANT_HOST;
  else process.env.RECALLANT_HOST = originalHost;
  if (originalAllowPublicBind === undefined) delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  else process.env.RECALLANT_ALLOW_PUBLIC_BIND = originalAllowPublicBind;
}

const developerId = randomUUID();
const projectId = randomUUID();
const sandboxProjectId = randomUUID();
const emptyDocsProjectId = randomUUID();
const sandboxPath = `/ai/recallant-pilots/review-ui-sandbox-${randomUUID()}`;
const emptyDocsPath = `starter-docs-fixture-${randomUUID()}`;
process.env.RECALLANT_DATABASE_URL = databaseUrl;
process.env.RECALLANT_DEVELOPER_ID = developerId;
process.env.RECALLANT_PROJECT_ID = projectId;
process.env.RECALLANT_PROJECT_PATH = process.cwd();

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath: process.cwd() });
const sandboxDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: sandboxProjectId,
  projectPath: sandboxPath
});
const emptyDocsDb = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: emptyDocsProjectId,
  projectPath: emptyDocsPath
});
await db.ensureProject(process.cwd());
await sandboxDb.ensureProject(sandboxPath);
await emptyDocsDb.ensureProject(emptyDocsPath);
const humanMemorySpace = await db.createMemorySpace({
  name: "Personal Operations UI Smoke",
  developerId,
  projectKind: "personal_domain",
  memoryDomain: "personal_life",
  primaryPath: null
});
if (humanMemorySpace.memory_profile?.profile_key !== "personal_work_operations") {
  throw new Error(
    `Human memory profile missing in UI fixture: ${JSON.stringify(humanMemorySpace)}`
  );
}
const rawProviderSecret = `sk-review-ui-${randomUUID()}`;
const rawDatabaseSecret = `postgres://recallant:${randomUUID()}@db/recallant_agent_work`;
const expectedDocumentationStrategyOptions = [
  "keep_current_docs",
  "canonicalize_for_recallant",
  "create_starter_docs",
  "discuss_first"
];
const documentationPostureFixture = {
  schema_version: 1,
  status: "needs_review",
  profile: "service_app",
  analysis_source: "rules",
  confidence: 0.74,
  summary: "Review UI fixture documentation posture.",
  review_needed_reason: "Agent docs do not describe Recallant workflow.",
  existing_docs: ["README.md", "docs/RUNBOOK.md"],
  missing_recommended_docs: ["AGENTS.md", "docs/ARCHITECTURE.md"],
  review_options: [
    {
      option: "keep_current_docs",
      recommended: false,
      reason: "Preserve current documentation and add only the Recallant working layer."
    },
    {
      option: "canonicalize_for_recallant",
      recommended: true,
      reason: "Review and normalize existing docs before changing canonical project guidance."
    },
    {
      option: "create_starter_docs",
      recommended: false,
      reason: "Create missing starter surfaces after owner review."
    },
    {
      option: "discuss_first",
      recommended: true,
      reason: "Use Workbench discussion for production or conflicting docs."
    }
  ],
  canon_context: {
    needed: true,
    reason: "Production/server/capability hints need configured owner/server canon references.",
    recommended_reference_kinds: ["security_baseline", "ports_inventory"],
    configured_references: []
  },
  signals: [
    {
      code: "missing_recallant_workflow",
      severity: "warning",
      message: "No Recallant startup/checkpoint/closeout workflow was found in agent docs."
    },
    {
      code: "canon_links_needed",
      severity: "warning",
      message: "Server/security and port-inventory canon references are needed for this project."
    }
  ],
  source_summary: { candidate_count: 3, redacted_source_count: 0 },
  authority: {
    source: "documentation_posture_analyzer",
    role: "startup_guidance",
    instruction_grade: false
  }
};
const healthyDocumentationPostureFixture = {
  schema_version: 1,
  status: "recallant_ready",
  profile: "service_app",
  analysis_source: "rules",
  confidence: 0.91,
  summary: "Review UI fixture healthy documentation posture.",
  review_needed_reason: null,
  existing_docs: ["README.md", "AGENTS.md", "PROJECT_LOG.md", "docs/RUNBOOK.md"],
  missing_recommended_docs: [],
  review_options: [
    {
      option: "keep_current_docs",
      recommended: true,
      reason: "Docs already describe the Recallant workflow; keep them and add memory context."
    },
    {
      option: "canonicalize_for_recallant",
      recommended: false,
      reason: "Canonicalization is not needed for this healthy fixture."
    },
    {
      option: "create_starter_docs",
      recommended: false,
      reason: "Starter docs already exist."
    },
    {
      option: "discuss_first",
      recommended: false,
      reason: "No owner decision is required before routine work."
    }
  ],
  canon_context: {
    needed: false,
    reason: null,
    recommended_reference_kinds: [],
    configured_references: []
  },
  signals: [],
  source_summary: { candidate_count: 4, redacted_source_count: 0 },
  authority: {
    source: "documentation_posture_analyzer",
    role: "startup_guidance",
    instruction_grade: false
  }
};
const emptyDocumentationPostureFixture = {
  schema_version: 1,
  status: "docs_absent",
  profile: "unknown",
  analysis_source: "rules",
  confidence: 0.88,
  summary: "No project documentation was found.",
  review_needed_reason: "Create starter docs before routine agent work.",
  existing_docs: [],
  missing_recommended_docs: ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
  review_options: [
    {
      option: "keep_current_docs",
      recommended: false,
      reason: "There are no docs to keep as the working baseline."
    },
    {
      option: "canonicalize_for_recallant",
      recommended: false,
      reason: "Canonicalization needs existing docs."
    },
    {
      option: "create_starter_docs",
      recommended: true,
      reason: "Create the minimal starter documentation set for an agent-ready project."
    },
    {
      option: "discuss_first",
      recommended: false,
      reason: "The empty-project starter path is clear."
    }
  ],
  canon_context: {
    needed: false,
    reason: null,
    recommended_reference_kinds: [],
    configured_references: []
  },
  signals: [
    {
      code: "docs_absent",
      severity: "warning",
      message: "No documentation files were found."
    }
  ],
  source_summary: { candidate_count: 0, redacted_source_count: 0 },
  authority: {
    source: "documentation_posture_analyzer",
    role: "startup_guidance",
    instruction_grade: false
  }
};
const generatedStarterDocsFixture = {
  schema_version: 1,
  status: "generated",
  profile: "service_app",
  reason: "Starter docs were generated for an empty project.",
  eligible_for_apply: true,
  writes_files: false,
  planned_files: [
    { path: "README.md", kind: "readme", profile: "base", required: true },
    { path: "AGENTS.md", kind: "agent_instructions", profile: "base", required: true },
    { path: "PROJECT_LOG.md", kind: "project_log", profile: "base", required: true },
    { path: "docs/RUNBOOK.md", kind: "runbook", profile: "service_app", required: false },
    {
      path: "docs/ARCHITECTURE.md",
      kind: "architecture",
      profile: "service_app",
      required: false
    }
  ],
  skipped_files: [],
  outcome: {
    status: "generated",
    reason: "Starter docs were generated for an empty project.",
    generated_files: [
      "README.md",
      "AGENTS.md",
      "PROJECT_LOG.md",
      "docs/RUNBOOK.md",
      "docs/ARCHITECTURE.md"
    ],
    skipped_files: []
  },
  authority: {
    source: "starter_docs_planner",
    role: "documentation_bootstrap",
    instruction_grade: false
  }
};
const skippedStarterDocsFixture = {
  schema_version: 1,
  status: "not_empty",
  profile: "service_app",
  reason: "Starter docs are only generated for empty projects.",
  eligible_for_apply: false,
  writes_files: false,
  planned_files: [],
  skipped_files: [],
  outcome: {
    status: "skipped",
    reason: "Starter docs are only generated for empty projects.",
    generated_files: [],
    skipped_files: []
  },
  authority: {
    source: "starter_docs_planner",
    role: "documentation_bootstrap",
    instruction_grade: false
  }
};
const plannedStarterDocsFixture = {
  schema_version: 1,
  status: "ready",
  profile: "unknown",
  reason: "Project has no docs and is eligible for starter docs.",
  eligible_for_apply: true,
  writes_files: false,
  planned_files: [
    { path: "README.md", kind: "readme", profile: "base", required: true },
    { path: "AGENTS.md", kind: "agent_instructions", profile: "base", required: true },
    { path: "PROJECT_LOG.md", kind: "project_log", profile: "base", required: true }
  ],
  skipped_files: [],
  outcome: null,
  authority: {
    source: "starter_docs_planner",
    role: "documentation_bootstrap",
    instruction_grade: false
  }
};
await db.pool.query(
  `
    INSERT INTO system_settings (key, value, is_secret_ref, updated_by)
    VALUES
      ('provider_api_key', $1, true, 'review-ui-smoke'),
      ('database_url', $2, true, 'review-ui-smoke')
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        is_secret_ref = EXCLUDED.is_secret_ref,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  `,
  [JSON.stringify(rawProviderSecret), JSON.stringify(rawDatabaseSecret)]
);
await db.pool.query(
  `
    INSERT INTO project_settings (project_id, key, value, updated_by)
    VALUES
      ($1, 'capture_profile', '"detailed"', 'review-ui-smoke'),
      ($1, 'project_lifecycle', '{"mode":"sandbox","cleanup":"dry-run first"}', 'review-ui-smoke'),
      ($1, 'documentation_posture', $2, 'review-ui-smoke'),
      ($1, 'starter_docs', $3, 'review-ui-smoke')
    ON CONFLICT (project_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  `,
  [projectId, JSON.stringify(documentationPostureFixture), JSON.stringify(generatedStarterDocsFixture)]
);
await db.pool.query(
  `
    INSERT INTO project_settings (project_id, key, value, updated_by)
    VALUES
      ($1, 'documentation_posture', $2, 'review-ui-smoke'),
      ($1, 'starter_docs', $3, 'review-ui-smoke')
    ON CONFLICT (project_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  `,
  [
    sandboxProjectId,
    JSON.stringify(healthyDocumentationPostureFixture),
    JSON.stringify(skippedStarterDocsFixture)
  ]
);
await db.pool.query(
  `
    INSERT INTO project_settings (project_id, key, value, updated_by)
    VALUES
      ($1, 'documentation_posture', $2, 'review-ui-smoke'),
      ($1, 'starter_docs', $3, 'review-ui-smoke')
    ON CONFLICT (project_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  `,
  [
    emptyDocsProjectId,
    JSON.stringify(emptyDocumentationPostureFixture),
    JSON.stringify(plannedStarterDocsFixture)
  ]
);
const session = await db.startSession({
  client_kind: "codex",
  client_version: "smoke",
  project_path: process.cwd(),
  session_label: "review-ui-smoke",
  resume_policy: "normal"
});
const event = await db.appendTurn({
  session_id: session.session_id,
  client_kind: "codex",
  role: "user",
  text: "Review UI smoke source event.",
  dedup_key: `review-ui-${randomUUID()}`
});
await db.appendEvent({
  session_id: session.session_id,
  client_kind: "codex",
  event_kind: "system",
  text: "Review UI smoke context read with unsynced spool status.",
  metadata: {
    capture_kind: "context_read",
    local_spool_status: { status: "unsynced", unsynced_count: 2 }
  },
  raw_artifacts: [],
  dedup_key: `review-ui-context-read-${randomUUID()}`
});
await db.pool.query(
  `
    INSERT INTO sessions (project_id, client_kind, client_version, status, ended_reason)
    VALUES ($1, 'codex', 'smoke', 'interrupted', 'crash_or_unknown')
  `,
  [projectId]
);
await db.pool.query(
  `
    INSERT INTO model_calls (
      developer_id, project_id, session_id, memory_domain, route_class, provider, model,
      purpose, routing_reason, confirmation_status, input_tokens, output_tokens,
      cost_estimate_usd, cost_actual_usd, latency_ms, status, metadata
    )
    VALUES
      ($1, $2, $3, 'agent_work', 'local_model', 'ollama', 'nomic-embed-text',
       'chunk_embedding', 'review ui smoke', 'not_required', 128, 0, 0.0012, 0.0000, 12, 'success', $4),
      ($1, $2, $3, 'agent_work', 'paid_api_provider', 'openai', 'gpt-5.4-mini',
       'planning', 'review ui smoke', 'approved', 256, 64, 0.0450, 0.0430, 320, 'success', $4)
  `,
  [developerId, projectId, session.session_id, JSON.stringify({ smoke: true })]
);
await db.pool.query(
  `
    INSERT INTO paid_api_approval_requests (
      developer_id, project_id, session_id, purpose, provider, model,
      routing_reason, attempted_routes, input_tokens_estimate, output_tokens_estimate,
      cost_estimate_usd, status, requested_by
    )
    VALUES ($1, $2, $3, 'research', 'openai', 'gpt-5.4',
            'review ui pending approval smoke', $4, 1000, 500, 0.25, 'pending', 'agent')
  `,
  [
    developerId,
    projectId,
    session.session_id,
    JSON.stringify([{ provider: "openai", model: "gpt-5.4" }])
  ]
);
const envImportText =
  "Imported .env.example references OPENAI_API_KEY, GITHUB_TOKEN, and DATABASE_URL without storing values.";
const envImport = await db.importSource({
  client_kind: "recallant-review-smoke",
  project_path: process.cwd(),
  source_path: ".env.example",
  source_type: "env_example",
  source_sha256: createHash("sha256").update(envImportText).digest("hex"),
  source_size_bytes: envImportText.length,
  content_type: "text/plain",
  import_text: envImportText,
  bounded_excerpt: envImportText,
  result_class: "secret_reference_names_only",
  result_classes: [
    "secret_reference_names_only",
    "capability_binding",
    "connector_account_binding"
  ],
  scope_kind: "environment",
  scope_id: projectId,
  audience: [{ kind: "review_ui", id: null }],
  risk: "high",
  risks: [{ code: "raw_secret_value_detected", severity: "high", message: "secret refs only" }]
});
const envImportMemoryId = envImport.memory_ids[0];
if (!envImportMemoryId)
  throw new Error(`Env import did not create memory: ${JSON.stringify(envImport)}`);
const handoffImportText =
  "Imported SESSION_HANDOFF.md is stale and duplicates older project log guidance.";
const handoffImport = await db.importSource({
  client_kind: "recallant-review-smoke",
  project_path: process.cwd(),
  source_path: ".cursor/SESSION_HANDOFF.md",
  source_type: "handoff",
  source_sha256: createHash("sha256").update(handoffImportText).digest("hex"),
  source_size_bytes: handoffImportText.length,
  content_type: "text/markdown",
  import_text: handoffImportText,
  bounded_excerpt: handoffImportText,
  result_class: "handoff_checkpoint",
  result_classes: ["handoff_checkpoint", "stale_history", "possible_duplicate"],
  scope_kind: "project",
  scope_id: projectId,
  audience: [{ kind: "all_agents", id: null }],
  risk: "medium",
  risks: [{ code: "stale_history", severity: "warning", message: "old handoff" }]
});
const handoffImportMemoryId = handoffImport.memory_ids[0];
if (!handoffImportMemoryId)
  throw new Error(`Handoff import did not create memory: ${JSON.stringify(handoffImport)}`);
const importText =
  "Imported AGENTS.md says the pilot sandbox should review source refs before promotion.";
const importSource = await db.importSource({
  client_kind: "recallant-review-smoke",
  project_path: process.cwd(),
  source_path: "AGENTS.md",
  source_type: "agent_instructions",
  source_sha256: createHash("sha256").update(importText).digest("hex"),
  source_size_bytes: importText.length,
  content_type: "text/markdown",
  import_text: importText,
  bounded_excerpt: importText,
  result_class: "repo_contract",
  result_classes: ["repo_contract", "startup_instruction", "possible_conflict"],
  scope_kind: "project",
  scope_id: projectId,
  audience: [{ kind: "all_agents", id: null }],
  risk: "medium",
  risks: [{ code: "possible_conflict", severity: "warning", message: "smoke conflict" }]
});
const importMemoryId = importSource.memory_ids[0];
if (!importMemoryId)
  throw new Error(`Import source did not create memory: ${JSON.stringify(importSource)}`);
const importedDocSource = await db.attachProjectSource({
  project_id: projectId,
  source_kind: "document_collection",
  label: "AGENTS.md",
  uri: "AGENTS.md",
  metadata: { smoke: true, purpose: "source filter provenance smoke" }
});
const plannedConnectorSource = await db.attachProjectSource({
  project_id: projectId,
  source_kind: "connector",
  label: "Google Drive planned connector",
  metadata: { smoke: true, purpose: "connector source health smoke" }
});
const missingPathSource = await db.attachProjectSource({
  project_id: projectId,
  source_kind: "server_path",
  label: "Missing server docs path",
  uri: `/tmp/recallant-missing-source-${randomUUID()}`,
  metadata: { smoke: true, purpose: "missing source health smoke" }
});
const candidate = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "developer",
  title: "Always review important rules",
  body: "Always review important rules in the Review Command Center.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "Review UI smoke" }]
});
const rule = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "project",
  title: "Review UI active rule",
  body: "Instruction-grade rules must appear separately from ordinary memories.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "active rule" }]
});
await db.reviewAgentMemory({
  memory_id: rule.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "review ui smoke"
});
const filteredRule = await db.createAgentMemory({
  memory_type: "constraint",
  scope: "project",
  title: "Review UI constraint rule",
  body: "Constraint rules must be filterable separately from procedure rules.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "constraint rule" }]
});
await db.reviewAgentMemory({
  memory_id: filteredRule.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "review ui filter smoke"
});
const sourceLinkedDetail = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Source-linked provenance drilldown",
  body: "A memory detail should show the memory space, source label, source kind, source health, and source status.",
  created_by: "agent",
  source_refs: [
    {
      source_kind: "external",
      source_id: importedDocSource.id,
      quote: "source-linked provenance drilldown",
      metadata: {
        project_source_id: importedDocSource.id,
        source_path: "AGENTS.md"
      }
    }
  ]
});
const altDomainRuleId = randomUUID();
await db.pool.query(
  `
    INSERT INTO agent_memories (
      id, developer_id, project_id, memory_domain, scope, scope_kind, scope_id, audience,
      memory_type, title, body, status, use_policy, confidence, created_by, metadata
    )
    VALUES ($1, $2, $3::uuid, 'personal_life', 'project', 'project', $3::text, $4,
            'procedure', 'Out-of-domain active rule',
            'This rule should not appear while the active rule domain filter is agent_work.',
            'accepted', 'instruction_grade', 0.9, 'user', $5)
  `,
  [
    altDomainRuleId,
    developerId,
    projectId,
    JSON.stringify([{ kind: "all_agents", id: null }]),
    JSON.stringify({ smoke: true })
  ]
);
const editable = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI editable memory",
  body: "Review UI should edit this memory through a browser form.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "editable memory" }]
});
const duplicate = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI duplicate memory",
  body: "Review UI should merge this duplicate into another memory.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate memory" }],
  metadata: { possible_duplicate: true, duplicate_group: "review-ui-smoke" }
});
const duplicatePeer = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI duplicate peer",
  body: "Review UI should offer this peer as another canonical option.",
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "duplicate peer" }],
  metadata: { possible_duplicate: true, duplicate_group: "review-ui-smoke" }
});
const conflictOld = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "project",
  title: "Review UI old conflicting rule",
  body: "Old rule says to keep the previous behavior.",
  created_by: "agent",
  source_refs: [
    {
      source_kind: "external",
      source_id: importedDocSource.id,
      quote: "old conflict from document source",
      metadata: { project_source_id: importedDocSource.id, source_path: "AGENTS.md" }
    }
  ],
  metadata: {
    possible_conflict: true,
    conflict_group: "review-ui-conflict-smoke",
    conflict_role: "old"
  }
});
await db.reviewAgentMemory({
  memory_id: conflictOld.memory_id,
  action: "promote_instruction",
  actor_kind: "user",
  note: "review ui conflict old rule smoke"
});
const conflictNew = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "project",
  title: "Review UI new conflicting rule",
  body: "New rule says to use the updated behavior.",
  created_by: "agent",
  source_refs: [
    {
      source_kind: "external",
      source_id: plannedConnectorSource.id,
      quote: "new conflict from connector source",
      metadata: {
        project_source_id: plannedConnectorSource.id,
        source_path: "Google Drive planned connector"
      }
    }
  ],
  metadata: {
    possible_conflict: true,
    conflict_group: "review-ui-conflict-smoke",
    conflict_role: "new"
  }
});
await db.reviewAgentMemory({
  memory_id: conflictNew.memory_id,
  action: "accept",
  actor_kind: "user",
  note: "review ui conflict new memory smoke"
});
await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI high risk production provider conflict",
  body: "Production provider conflict mentions secrets and paid API routing.",
  created_by: "user",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: "high risk conflict" }],
  metadata: { possible_conflict: true, conflict_group: "review-ui-critical-conflict" }
});
const noSourcePromotion = await db.createAgentMemory({
  memory_type: "procedure",
  scope: "project",
  title: "Review UI no source promotion",
  body: "This memory must not be promoted without visible source refs.",
  created_by: "user",
  source_refs: []
});
const forgetSecret = `REVIEW_UI_FORGET_SECRET_${randomUUID()}`;
const forgettable = await db.createAgentMemory({
  memory_type: "decision",
  scope: "project",
  title: "Review UI forget forever memory",
  body: `This memory contains ${forgetSecret} and must be redacted by forget forever.`,
  created_by: "agent",
  source_refs: [{ source_kind: "event", source_id: event.event_id, quote: forgetSecret }]
});

const server = createRecallantHttpServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to get review UI address");
const baseUrl = `http://127.0.0.1:${address.port}`;
let dashboardPostureExcerpt = null;
let dashboardCanonCapabilityExcerpt = null;
let defaultPostureExcerpt = null;
let fallbackPostureExcerpt = "";
let emptyStarterDocsExcerpt = null;
let healthyPostureExcerpt = null;
let workbenchPostureExcerpt = "";

try {
  const unauthorized = await fetch(`${baseUrl}/review`);
  if (unauthorized.status !== 401) {
    throw new Error(`Review UI did not require auth: ${unauthorized.status}`);
  }
  for (const publicPath of [
    "/api/review-dashboard",
    "/api/management-chat",
    "/api/project-detach",
    "/backups/latest",
    "/raw-artifacts/review-smoke",
    "/mcp"
  ]) {
    const publicResponse = await fetch(`${baseUrl}${publicPath}`);
    if (publicResponse.status !== 401) {
      throw new Error(`Unauthenticated route was exposed: ${publicPath} ${publicResponse.status}`);
    }
  }

  const chooser = await fetch(`${baseUrl}/review?view=review`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const chooserText = await chooser.text();
  const chooserRequired = [
    "Project chooser",
    "Choose a memory space",
    "Selecting a space opens the requested Workbench view for that project.",
    `href="/review?project_id=${projectId}&amp;view=review"`,
    projectId.slice(0, 8),
    process.cwd(),
    "Primary path",
    "Short id",
    "Personal Operations UI Smoke",
    "Registered only"
  ];
  const chooserMissing = chooserRequired.filter((marker) => !chooserText.includes(marker));
  const chooserProjectCaptureStatus = [
    "Interrupted",
    "Capture active",
    "Started, not complete"
  ].some((marker) => chooserText.includes(marker));
  if (
    chooser.status !== 200 ||
    chooserMissing.length > 0 ||
    !chooserProjectCaptureStatus ||
    chooserText.includes('id="ask-recallant"') ||
    chooserText.includes('id="command-center"')
  ) {
    throw new Error(
      `Project chooser smoke failed: ${chooser.status}; missing ${JSON.stringify(chooserMissing)}; captureStatus=${chooserProjectCaptureStatus}; ${chooserText.slice(0, 900)}`
    );
  }

  const html = await fetch(`${baseUrl}/review?project_id=${projectId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const htmlText = await html.text();
  workbenchPostureExcerpt = htmlTextExcerpt(htmlText, "Documentation posture");
  if (htmlText.includes(rawProviderSecret) || htmlText.includes(rawDatabaseSecret)) {
    throw new Error("Review UI HTML leaked raw secret setting values");
  }
  const requiredHtml = [
    "Recallant Workbench",
    "Command Center",
    "What Needs Attention",
    "Memory Spaces",
    "Audit",
    "Human memory domains",
    "Virtual personal / work memory",
    "Personal Operations UI Smoke",
    "Personal / Work Operations",
    "No passive capture.",
    "Connectors:",
    "not connected",
    "Agent workspaces",
    "Activity / Replay",
    "Project Actions",
    "4 active sources",
    "AI control surface",
    "Workbench status snapshot",
    "Needs attention",
    "Memory capture",
    "Documentation posture",
    "needs review",
    "service app",
    "Top missing / risk signals",
    "Documentation strategy",
    "Existing documentation rewrites still require owner review.",
    "Generated starter docs",
    "docs/RUNBOOK.md",
    "Canon and capability context",
    "References are guidance and provenance for agents.",
    "They do not activate connectors, grant secret access, or create binding rules.",
    "Environment facts",
    "Capabilities",
    "Secret references",
    "Server canon",
    "Documentation authority",
    "Google Drive planned connector",
    "provider_api_key",
    "database_url",
    "security_baseline",
    "ports_inventory",
    "Keep current docs, add Recallant layer",
    "Canonicalize docs for Recallant-aware workflow",
    "Create starter docs",
    "Discuss first",
    "Current memory space",
    "Sources",
    "Source Map",
    "Memory Tree source map",
    "Ready to cite",
    "Needs setup",
    "Needs attention",
    "Attached source",
    "Usable for citations",
    "Planned; setup needed",
    "Needs attention before use",
    "Governed access or capability binding is needed before live capture.",
    "Raw secrets stay outside Recallant.",
    "Recallant can cite memory from this source with provenance.",
    "Visible in the map, but setup is needed before agents should rely on it.",
    "Memory space sources",
    "Source view",
    "Showing all sources",
    "Sources for selected space",
    "Primary workspace folder",
    "Primary local source ready",
    "Document source reference ready",
    "Connector source needs setup",
    "Local path not found",
    "ready to cite",
    "need setup",
    "need attention",
    "Show source memories",
    "Use as provenance filter",
    "Create a memory space",
    "Attach a source to selected space",
    "Detach source",
    "Review decision guide",
    "Imported evidence",
    "Needs your decision",
    "Possible conflicts",
    "Active rules",
    "Usable memory",
    "Active rule",
    "Resolve conflict states before routine review.",
    "Normal review actions",
    "Separate sensitive cleanup",
    "Selected Detail",
    "Evidence excerpts",
    "Recommended action",
    "Where this came from",
    "Memory space",
    "Technical details",
    "Promote to rule",
    "Edit memory",
    "Supersede / merge",
    "Duplicate resolution",
    "Keep this, merge other",
    "Conflict resolution",
    "Use newer, supersede older",
    "Forget forever",
    "AGENTS.md",
    importMemoryId,
    candidate.memory_id,
    rule.memory_id,
    "Model costs and approvals",
    "Settings",
    "Edit project settings",
    "Context budget",
    "Enabled clients",
    "Project aliases",
    "Database connection",
    "Provider API key reference",
    "Project lifecycle",
    "Project setting",
    "System setting",
    "Ask Recallant",
    'id="ask-recallant"',
    "Selected project",
    `id ${projectId.slice(0, 8)}`,
    process.cwd(),
    "Agent Readiness",
    "Current Recallant signals",
    "Interrupted",
    "Context was read",
    "Memory was written",
    "Activity replay summary",
    "Recording flow",
    "Memory updates",
    "source-linked",
    "Session starts and context reads prove the agent is entering Recallant.",
    "These records show what Recallant captured as usable working memory.",
    "Capture active. Checkpoint is still missing.",
    "last context read",
    "last memory write",
    "unclosed active session",
    "interrupted session",
    "local spool records are not synced yet",
    "high-risk conflict",
    "Rule view",
    "Applies to",
    "Kind",
    "From source",
    "All sources",
    "From source AGENTS.md",
    "Technical filter values",
    "Today",
    "This month",
    "Technical cost breakdown",
    "Pending paid model approvals",
    "local cleanup dry-run",
    "Ask Recallant what to check",
    "Private, policy protected",
    "Governed operations",
    "Operations",
    "selected source",
    "Local search by meaning",
    "Semantic search is configured locally"
  ];
  const missingHtml = requiredHtml.filter((marker) => !htmlText.includes(marker));
  const recommendedStrategyCount = (htmlText.match(/Recommended strategy/g) ?? []).length;
  if (html.status !== 200 || missingHtml.length > 0 || recommendedStrategyCount !== 1) {
    throw new Error(
      `Review UI HTML smoke failed: ${html.status}; missing ${JSON.stringify(missingHtml)}; recommendedStrategyCount=${recommendedStrategyCount}; ${htmlText.slice(0, 500)}`
    );
  }

  const askView = await fetch(`${baseUrl}/review?project_id=${projectId}&view=ask`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const askViewText = await askView.text();
  if (
    askView.status !== 200 ||
    !askViewText.includes('class="active" href="/review?project_id=') ||
    !askViewText.includes("Ask Recallant") ||
    !askViewText.includes('id="ask-recallant"') ||
    askViewText.includes("Source Map") ||
    askViewText.includes('id="command-center"')
  ) {
    throw new Error(`Ask focused view failed: ${askView.status}; ${askViewText.slice(0, 500)}`);
  }

  const sourcesView = await fetch(`${baseUrl}/review?project_id=${projectId}&view=sources`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const sourcesViewText = await sourcesView.text();
  if (
    sourcesView.status !== 200 ||
    !sourcesViewText.includes("Source Map") ||
    !sourcesViewText.includes("Sources for selected space") ||
    !sourcesViewText.includes("workbench-body focused") ||
    sourcesViewText.includes('id="ask-recallant"') ||
    sourcesViewText.includes("What Needs Attention")
  ) {
    throw new Error(
      `Sources focused view failed: ${sourcesView.status}; ${sourcesViewText.slice(0, 500)}`
    );
  }

  const settingsView = await fetch(`${baseUrl}/review?project_id=${projectId}&view=settings`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const settingsViewText = await settingsView.text();
  if (
    settingsView.status !== 200 ||
    !settingsViewText.includes('id="settings" open') ||
    !settingsViewText.includes("Edit project settings") ||
    settingsViewText.includes("Cost / Paid API") ||
    settingsViewText.includes("Cleanup / Forget") ||
    settingsViewText.includes("Selected Detail")
  ) {
    throw new Error(
      `Settings focused view failed: ${settingsView.status}; ${settingsViewText.slice(0, 500)}`
    );
  }

  const auditApi = await fetch(`${baseUrl}/api/review-dashboard?project_id=${projectId}&view=audit`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const auditJson = await auditApi.json();
  if (
    auditApi.status !== 200 ||
    !auditJson.audit_report ||
    auditJson.audit_report.summary?.total < 1 ||
    !Array.isArray(auditJson.audit_report.timeline) ||
    !Array.isArray(auditJson.audit_report.recommendations)
  ) {
    throw new Error(`Audit API failed: ${auditApi.status}; ${JSON.stringify(auditJson.audit_report)}`);
  }
  const auditView = await fetch(`${baseUrl}/review?project_id=${projectId}&view=audit`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const auditViewText = await auditView.text();
  if (
    auditView.status !== 200 ||
    !auditViewText.includes('id="audit"') ||
    !auditViewText.includes("System activity ledger") ||
    !auditViewText.includes("Audit report") ||
    !auditViewText.includes("activity rows") ||
    !auditViewText.includes("Recommendations") ||
    auditViewText.includes(rawProviderSecret) ||
    auditViewText.includes(rawDatabaseSecret)
  ) {
    throw new Error(`Audit focused view failed: ${auditView.status}; ${auditViewText.slice(0, 700)}`);
  }
  const futureSince = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const emptyAuditView = await fetch(
    `${baseUrl}/review?project_id=${projectId}&view=audit&since=${encodeURIComponent(futureSince)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const emptyAuditText = await emptyAuditView.text();
  if (
    emptyAuditView.status !== 200 ||
    !emptyAuditText.includes("No audit activity matched these filters.")
  ) {
    throw new Error(`Audit empty state failed: ${emptyAuditView.status}; ${emptyAuditText.slice(0, 700)}`);
  }
  const requiredLayoutContracts = [
    "main { display: grid; grid-template-columns: minmax(0, 1fr)",
    ".workbench-body { display: grid",
    ".ask-layout { display: grid",
    ".first-screen-snapshot { display: grid",
    ".primary-workspace { display: grid",
    ".command-grid { display: grid",
    ".signal-strip { display: grid",
    ".source-overview { display: grid",
    ".source-tree { display: grid",
    ".source-tree-groups { display: grid",
    ".source-filter-panel { display: grid",
    ".source-workspace-grid { display: grid",
    ".review-overview { display: grid",
    ".review-lanes { display: grid",
    ".activity-summary { display: grid",
    ".audit-summary { display: grid",
    ".audit-filter-form { display: grid",
    ".audit-row { display: grid",
    ".activity-group { border:",
    ".secondary-workspace { display: block",
    ".operation-panels { display: grid",
    ".chat-answer { border-top",
    "max-height: 680px",
    "@media (max-width: 1180px)",
    "@media (max-width: 760px)"
  ];
  const missingLayoutContracts = requiredLayoutContracts.filter(
    (marker) => !htmlText.includes(marker)
  );
  const askRecallantIndex = htmlText.indexOf('id="ask-recallant"');
  const sourcesIndex = htmlText.indexOf('id="sources"');
  const secondaryWorkspaceIndex = htmlText.indexOf(
    'class="secondary-workspace operations-workspace"'
  );
  const visibleTechnicalLeaks = [
    "<h3>embedding_route</h3>",
    "<h3>instruction_grade</h3>",
    "<h3>needs_review</h3>",
    "<h3>database url</h3>",
    "<h3>provider api key</h3>",
    "<h3>system_settings</h3>",
    "scope_kind: developer",
    "<h2>Current Signals</h2>",
    ">Project filter<",
    ">Domain filter<",
    "Cost by project/provider/model/purpose",
    "Understood by local AI:"
  ].filter((marker) => htmlText.includes(marker));
  const missingMigrationReviewUi = [
    "Migration review queue",
    "Conflicts and duplicates",
    "Secret and capability references",
    "Stale handoffs",
    "Low-risk imported evidence",
    "Review imported evidence before active rules."
  ].filter((marker) => !htmlText.includes(marker));
  if (
    missingLayoutContracts.length > 0 ||
    missingMigrationReviewUi.length > 0 ||
    askRecallantIndex < 0 ||
    sourcesIndex < 0 ||
    secondaryWorkspaceIndex < 0 ||
    askRecallantIndex > sourcesIndex ||
    sourcesIndex > secondaryWorkspaceIndex ||
    visibleTechnicalLeaks.length > 0
  ) {
    throw new Error(
      `Workbench layout contract failed: ${JSON.stringify({
        missingLayoutContracts,
        missingMigrationReviewUi,
        askRecallantIndex,
        sourcesIndex,
        secondaryWorkspaceIndex,
        visibleTechnicalLeaks
      })}`
    );
  }

  const api = await fetch(`${baseUrl}/api/review-dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const json = await api.json();
  dashboardPostureExcerpt = {
    status: json.documentation_posture?.status,
    profile: json.documentation_posture?.profile,
    authority_key: json.documentation_posture?.authority?.key,
    instruction_grade: json.documentation_posture?.authority?.instruction_grade,
    starter_docs_status: json.starter_docs?.status,
    starter_docs_generated_files: json.starter_docs?.generated_files,
    starter_docs_authority_key: json.starter_docs?.authority?.key,
    strategy_option_keys: json.documentation_posture?.review_options?.map(
      (option) => option.option
    ),
    recommended_option: json.documentation_posture?.review_options?.find(
      (option) => option.recommended === true
    )?.option,
    signal_codes: json.documentation_posture?.signals?.map((signal) => signal.code)
  };
  dashboardCanonCapabilityExcerpt = {
    status: json.canon_capability_context?.status,
    environment_facts: json.canon_capability_context?.environment_facts?.length ?? 0,
    capability_labels: json.canon_capability_context?.capability_references?.map(
      (item) => item.label
    ),
    secret_names: json.canon_capability_context?.secret_references?.map((item) => item.name),
    server_canon: json.canon_capability_context?.server_canon_links?.map((item) => ({
      kind: item.kind,
      status: item.status
    })),
    documentation_roles: json.canon_capability_context?.documentation_authority_map?.map(
      (item) => item.role
    ),
    instruction_grade: json.canon_capability_context?.authority?.instruction_grade
  };
  const serializedDashboard = JSON.stringify(json);
  if (
    api.status !== 200 ||
    serializedDashboard.includes(rawProviderSecret) ||
    serializedDashboard.includes(rawDatabaseSecret) ||
    !json.settings.some(
      (setting) =>
        setting.key === "provider_api_key" &&
        setting.value?.redacted === true &&
        setting.value?.status === "configured"
    ) ||
    json.starter_docs?.status !== "generated" ||
    json.starter_docs?.authority?.key !== "starter_docs" ||
    json.starter_docs?.authority?.instruction_grade !== false ||
    !json.starter_docs?.generated_files?.includes("README.md") ||
    !json.starter_docs?.generated_files?.includes("docs/RUNBOOK.md") ||
    JSON.stringify(json.starter_docs).includes("Recallant is attached") ||
    !json.import_candidates.some((memory) => memory.memory_id === importMemoryId) ||
    !json.import_candidates.some((memory) => memory.memory_id === envImportMemoryId) ||
    !json.import_candidates.some((memory) => memory.memory_id === handoffImportMemoryId) ||
    !json.import_candidates.some(
      (memory) =>
        memory.memory_id === importMemoryId && memory.provenance?.source_path === "AGENTS.md"
    ) ||
    json.selected_detail?.memory?.id !== importMemoryId ||
    !json.selected_detail?.source_refs?.some((ref) => ref.source_id === importSource.event_id) ||
    !json.duplicate_conflicts.some((memory) => memory.memory_id === importMemoryId) ||
    !json.duplicate_conflicts.some(
      (memory) =>
        memory.memory_id === conflictOld.memory_id && memory.provenance?.source_path === "AGENTS.md"
    ) ||
    !json.duplicate_conflicts.some(
      (memory) =>
        memory.memory_id === conflictNew.memory_id &&
        memory.provenance?.source_path === "Google Drive planned connector"
    ) ||
    !json.inbox.some((memory) => memory.memory_id === candidate.memory_id) ||
    !json.rules.some((memory) => memory.memory_id === rule.memory_id) ||
    json.documentation_posture?.status !== "needs_review" ||
    json.documentation_posture?.profile !== "service_app" ||
    json.documentation_posture?.authority?.key !== "documentation_posture" ||
    json.documentation_posture?.authority?.instruction_grade !== false ||
    JSON.stringify(json.documentation_posture?.review_options?.map((option) => option.option)) !==
      JSON.stringify(expectedDocumentationStrategyOptions) ||
    !json.documentation_posture?.review_options?.some(
      (option) => option.option === "canonicalize_for_recallant" && option.recommended === true
    ) ||
    !json.documentation_posture?.signals?.some((signal) => signal.code === "canon_links_needed") ||
    json.canon_capability_context?.status !== "ready" ||
    json.canon_capability_context?.authority?.instruction_grade !== false ||
    !json.canon_capability_context?.capability_references?.some(
      (item) =>
        item.label === "Google Drive planned connector" &&
        item.kind === "connector" &&
        item.access === "reference_only"
    ) ||
    !json.canon_capability_context?.secret_references?.some(
      (item) => item.name === "provider_api_key" && item.status === "configured_reference"
    ) ||
    !json.canon_capability_context?.secret_references?.some(
      (item) => item.name === "database_url" && item.status === "configured_reference"
    ) ||
    !json.canon_capability_context?.server_canon_links?.some(
      (item) => item.kind === "security_baseline" && item.status === "needed"
    ) ||
    !json.canon_capability_context?.server_canon_links?.some(
      (item) => item.kind === "ports_inventory" && item.status === "needed"
    ) ||
    !json.canon_capability_context?.documentation_authority_map?.some(
      (item) => item.path === "README.md" && item.role === "canonical_doc"
    ) ||
    json.project_readiness?.project_registered !== true ||
    Number(json.migration_review?.total_imported ?? 0) < 3 ||
    Number(json.migration_review?.review_required ?? 0) < 3 ||
    Number(json.migration_review?.conflicts_or_duplicates ?? 0) < 1 ||
    Number(json.migration_review?.secret_or_capability_references ?? 0) < 1 ||
    Number(json.migration_review?.stale_handoffs ?? 0) < 1 ||
    !String(json.migration_review?.first_action ?? "").includes("Resolve conflicts") ||
    !json.migration_review?.lane_order?.some(
      (lane) => lane.key === "secret_refs" && lane.count >= 1
    ) ||
    typeof json.project_readiness?.capture_event_count !== "number" ||
    !json.project_readiness?.last_context_read_at ||
    !Array.isArray(json.recent_activity) ||
    !json.recent_activity.some((row) => row.activity_kind === "context_read") ||
    !json.recent_activity.some((row) => row.activity_kind === "memory_write") ||
    !json.recent_activity.some(
      (row) => row.activity_kind === "memory_write" && row.source_summary
    ) ||
    !json.projects.some(
      (project) =>
        project.project_id === projectId &&
        project.last_context_read_at &&
        project.sources?.some(
          (source) =>
            source.source_kind === "workspace_path" &&
            source.source_health?.status === "ready" &&
            source.source_health?.label === "Primary local source ready"
        ) &&
        project.sources?.some(
          (source) =>
            source.source_id === importedDocSource.id &&
            source.source_health?.status === "ready" &&
            source.display_label === "AGENTS.md"
        ) &&
        project.sources?.some(
          (source) =>
            source.source_id === plannedConnectorSource.id &&
            source.source_health?.status === "needs_setup" &&
            source.source_health?.label === "Connector source needs setup"
        ) &&
        project.sources?.some(
          (source) =>
            source.source_id === missingPathSource.id &&
            source.source_health?.status === "needs_attention" &&
            source.source_health?.label === "Local path not found"
        )
    ) ||
    !json.source_filters?.sources?.some(
      (source) =>
        source.source_id === importedDocSource.id && source.source_health?.status === "ready"
    ) ||
    !json.source_filters?.sources?.some(
      (source) =>
        source.source_id === plannedConnectorSource.id &&
        source.source_health?.status === "needs_setup" &&
        String(source.source_health?.reason ?? "").includes("Raw secrets must stay outside")
    ) ||
    !json.source_filters?.sources?.some(
      (source) =>
        source.source_id === missingPathSource.id &&
        source.source_health?.status === "needs_attention"
    ) ||
    !String(json.project_cleanup?.local_cleanup_command ?? "").includes(
      "recallant local-cleanup"
    ) ||
    json.critical.pending_review < 1 ||
    json.critical.active_sessions < 1 ||
    json.critical.interrupted_sessions < 1 ||
    json.critical.unsynced_spool_records !== 2 ||
    json.critical.high_risk_conflicts < 1 ||
    json.cost_summary?.current_day_estimated_usd <= 0 ||
    json.cost_summary?.current_month_estimated_usd <= 0 ||
    json.cost_summary?.pending_approval_count !== 1 ||
    !json.pending_paid_api_approvals.some((approval) => approval.provider === "openai") ||
    !json.costs.some(
      (row) =>
        row.project_id === projectId && row.provider === "openai" && row.purpose === "planning"
    ) ||
    json.rules.some((memory) => memory.memory_id === altDomainRuleId)
  ) {
    throw new Error(`Review dashboard API smoke failed: ${JSON.stringify(json)}`);
  }

  const emptyPostureApi = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${humanMemorySpace.project_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const emptyPostureJson = await emptyPostureApi.json();
  defaultPostureExcerpt = {
    status: emptyPostureJson.documentation_posture?.status,
    authority_key: emptyPostureJson.documentation_posture?.authority?.key,
    instruction_grade: emptyPostureJson.documentation_posture?.authority?.instruction_grade,
    recommended_option: emptyPostureJson.documentation_posture?.review_options?.find(
      (option) => option.recommended === true
    )?.option
  };
  if (
    emptyPostureApi.status !== 200 ||
    emptyPostureJson.documentation_posture?.status !== "not_recorded" ||
    emptyPostureJson.documentation_posture?.authority?.key !== "documentation_posture" ||
    emptyPostureJson.documentation_posture?.authority?.instruction_grade !== false ||
    !emptyPostureJson.documentation_posture?.review_options?.some(
      (option) => option.option === "discuss_first" && option.recommended === true
    )
  ) {
    throw new Error(
      `Review dashboard default posture failed: ${JSON.stringify(
        emptyPostureJson.documentation_posture
      )}`
    );
  }
  const emptyPostureHtml = await fetch(
    `${baseUrl}/review?project_id=${humanMemorySpace.project_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const emptyPostureHtmlText = await emptyPostureHtml.text();
  fallbackPostureExcerpt = htmlTextExcerpt(emptyPostureHtmlText, "Documentation strategy");
  const fallbackRecommendedCount =
    (emptyPostureHtmlText.match(/Recommended strategy/g) ?? []).length;
  if (
    emptyPostureHtml.status !== 200 ||
    emptyPostureHtmlText.includes(rawProviderSecret) ||
    emptyPostureHtmlText.includes(rawDatabaseSecret) ||
    !emptyPostureHtmlText.includes("Documentation strategy") ||
    !emptyPostureHtmlText.includes("Discuss first") ||
    fallbackRecommendedCount !== 1
  ) {
    throw new Error(
      `Review UI default posture fallback failed: ${JSON.stringify({
        status: emptyPostureHtml.status,
        fallbackRecommendedCount,
        excerpt: fallbackPostureExcerpt
      })}`
    );
  }

  const emptyDocsApi = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${emptyDocsProjectId}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const emptyDocsJson = await emptyDocsApi.json();
  emptyStarterDocsExcerpt = {
    status: emptyDocsJson.documentation_posture?.status,
    recommended_option: emptyDocsJson.documentation_posture?.review_options?.find(
      (option) => option.recommended === true
    )?.option,
    starter_docs_status: emptyDocsJson.starter_docs?.status,
    starter_docs_outcome: emptyDocsJson.starter_docs?.outcome,
    planned_files: emptyDocsJson.starter_docs?.planned_files?.map((file) => file.path)
  };
  if (
    emptyDocsApi.status !== 200 ||
    emptyDocsJson.documentation_posture?.status !== "docs_absent" ||
    !emptyDocsJson.documentation_posture?.review_options?.some(
      (option) => option.option === "create_starter_docs" && option.recommended === true
    ) ||
    emptyDocsJson.starter_docs?.status !== "ready" ||
    emptyDocsJson.starter_docs?.outcome !== null ||
    !emptyDocsJson.starter_docs?.planned_files?.some((file) => file.path === "README.md")
  ) {
    throw new Error(
      `Review dashboard empty starter-doc plan failed: ${JSON.stringify({
        posture: emptyDocsJson.documentation_posture,
        starter_docs: emptyDocsJson.starter_docs
      })}`
    );
  }
  const emptyDocsHtml = await fetch(`${baseUrl}/review?project_id=${emptyDocsProjectId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const emptyDocsHtmlText = await emptyDocsHtml.text();
  if (
    emptyDocsHtml.status !== 200 ||
    !emptyDocsHtmlText.includes("Starter docs plan") ||
    !emptyDocsHtmlText.includes("README.md") ||
    !emptyDocsHtmlText.includes("Create starter docs")
  ) {
    throw new Error(
      `Review UI empty starter-doc plan failed: ${JSON.stringify({
        status: emptyDocsHtml.status,
        excerpt: htmlTextExcerpt(emptyDocsHtmlText, "Starter docs")
      })}`
    );
  }

  const healthyPostureApi = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${sandboxProjectId}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const healthyPostureJson = await healthyPostureApi.json();
  healthyPostureExcerpt = {
    status: healthyPostureJson.documentation_posture?.status,
    starter_docs_status: healthyPostureJson.starter_docs?.status,
    starter_docs_generated_count: healthyPostureJson.starter_docs?.generated_files?.length,
    recommended_option: healthyPostureJson.documentation_posture?.review_options?.find(
      (option) => option.recommended === true
    )?.option,
    rewrite_recommended: healthyPostureJson.documentation_posture?.review_options?.some(
      (option) =>
        ["canonicalize_for_recallant", "create_starter_docs"].includes(option.option) &&
        option.recommended === true
    )
  };
  if (
    healthyPostureApi.status !== 200 ||
    healthyPostureJson.documentation_posture?.status !== "recallant_ready" ||
    !healthyPostureJson.documentation_posture?.review_options?.some(
      (option) => option.option === "keep_current_docs" && option.recommended === true
    ) ||
    healthyPostureJson.starter_docs?.status !== "not_empty" ||
    (healthyPostureJson.starter_docs?.generated_files?.length ?? 0) !== 0 ||
    healthyPostureJson.documentation_posture?.review_options?.some(
      (option) =>
        ["canonicalize_for_recallant", "create_starter_docs"].includes(option.option) &&
        option.recommended === true
    )
  ) {
    throw new Error(
      `Review dashboard healthy posture failed: ${JSON.stringify(
        healthyPostureJson.documentation_posture
      )}`
    );
  }

  const provenanceDetailResponse = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${projectId}&memory_id=${sourceLinkedDetail.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const provenanceDetail = await provenanceDetailResponse.json();
  const resolvedSource =
    provenanceDetail.selected_detail?.resolved_source_refs?.[0]?.project_source;
  if (
    provenanceDetailResponse.status !== 200 ||
    provenanceDetail.selected_detail?.memory?.id !== sourceLinkedDetail.memory_id ||
    provenanceDetail.selected_detail?.memory_space?.project_id !== projectId ||
    resolvedSource?.source_id !== importedDocSource.id ||
    resolvedSource?.label !== "AGENTS.md" ||
    resolvedSource?.source_kind !== "document_collection" ||
    resolvedSource?.status !== "active" ||
    resolvedSource?.source_health?.label !== "Document source reference ready"
  ) {
    throw new Error(`Provenance drilldown API failed: ${JSON.stringify(provenanceDetail)}`);
  }
  const provenanceDetailHtml = await fetch(
    `${baseUrl}/review?project_id=${projectId}&memory_id=${sourceLinkedDetail.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const provenanceDetailHtmlText = await provenanceDetailHtml.text();
  if (
    provenanceDetailHtml.status !== 200 ||
    !provenanceDetailHtmlText.includes("Where this came from") ||
    !provenanceDetailHtmlText.includes("AGENTS.md") ||
    !provenanceDetailHtmlText.includes("Document collection") ||
    !provenanceDetailHtmlText.includes("Document source reference ready") ||
    !provenanceDetailHtmlText.includes("Memory space")
  ) {
    throw new Error(
      `Provenance drilldown HTML failed: ${provenanceDetailHtml.status}; ${provenanceDetailHtmlText.slice(0, 700)}`
    );
  }
  const conflictDetailHtml = await fetch(
    `${baseUrl}/review?project_id=${projectId}&memory_id=${conflictNew.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const conflictDetailHtmlText = await conflictDetailHtml.text();
  const conflictDetailRequired = [
    "Source comparison",
    "Cross-source conflicts stay in review.",
    "Source: From source AGENTS.md",
    "Source: From source Google Drive planned connector",
    "Active rule",
    "Usable memory"
  ];
  const conflictDetailMissing = conflictDetailRequired.filter(
    (text) => !conflictDetailHtmlText.includes(text)
  );
  if (conflictDetailHtml.status !== 200 || conflictDetailMissing.length > 0) {
    throw new Error(
      `Conflict source comparison HTML failed: ${conflictDetailHtml.status}; missing ${JSON.stringify(conflictDetailMissing)}; ${conflictDetailHtmlText.slice(0, 1200)}`
    );
  }

  const filteredRules = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${projectId}&rule_type=procedure`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const filteredRulesJson = await filteredRules.json();
  if (
    filteredRules.status !== 200 ||
    filteredRulesJson.rule_filters?.memory_type !== "procedure" ||
    filteredRulesJson.rule_filters?.memory_domain !== "agent_work" ||
    !filteredRulesJson.rules.some((memory) => memory.memory_id === rule.memory_id) ||
    filteredRulesJson.rules.some((memory) => memory.memory_id === filteredRule.memory_id) ||
    filteredRulesJson.rules.some((memory) => memory.memory_id === altDomainRuleId)
  ) {
    throw new Error(`Rule filter API smoke failed: ${JSON.stringify(filteredRulesJson)}`);
  }

  const sourceFiltered = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${projectId}&source_id=${importedDocSource.id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const sourceFilteredJson = await sourceFiltered.json();
  if (
    sourceFiltered.status !== 200 ||
    sourceFilteredJson.source_filters?.selected_source_id !== importedDocSource.id ||
    sourceFilteredJson.rule_filters?.source_id !== importedDocSource.id ||
    !sourceFilteredJson.import_candidates.some((memory) => memory.memory_id === importMemoryId) ||
    sourceFilteredJson.rules.some((memory) => memory.memory_id === rule.memory_id) ||
    !sourceFilteredJson.source_filters?.selected_source?.source_health ||
    sourceFilteredJson.source_filters.selected_source.display_label !== "AGENTS.md" ||
    !sourceFilteredJson.recent_activity.some(
      (row) =>
        row.activity_kind === "memory_write" &&
        String(row.source_summary ?? "").includes("AGENTS.md")
    ) ||
    sourceFilteredJson.recent_activity.some(
      (row) =>
        row.activity_kind === "memory_write" &&
        !String(row.source_summary ?? "").includes("AGENTS.md")
    )
  ) {
    throw new Error(`Source filter API smoke failed: ${JSON.stringify(sourceFilteredJson)}`);
  }

  const sourceFilteredRecall = await db.recallAgentMemories({
    query: "AGENTS.md source refs",
    source_id: importedDocSource.id,
    include_needs_review: true,
    top_k: 5,
    max_chars_total: 1_200
  });
  if (
    !sourceFilteredRecall.memories.some((memory) => memory.memory_id === importMemoryId) ||
    sourceFilteredRecall.memories.some((memory) => memory.memory_id === rule.memory_id)
  ) {
    throw new Error(
      `Source-filtered governed recall failed: ${JSON.stringify(sourceFilteredRecall)}`
    );
  }
  const sourceFilteredRawSearch = await db.search({
    query: "pilot sandbox source refs",
    source_id: importedDocSource.id,
    mode: "lexical_only",
    top_k: 5
  });
  const otherSourceRawSearch = await db.search({
    query: "pilot sandbox source refs",
    source_id: plannedConnectorSource.id,
    mode: "lexical_only",
    top_k: 5
  });
  if (
    !sourceFilteredRawSearch.hits.some((hit) =>
      String(hit.text_excerpt ?? "").includes("AGENTS.md")
    ) ||
    otherSourceRawSearch.hits.some((hit) => String(hit.text_excerpt ?? "").includes("AGENTS.md"))
  ) {
    throw new Error(
      `Source-filtered raw search failed: ${JSON.stringify({ sourceFilteredRawSearch, otherSourceRawSearch })}`
    );
  }

  const sourceFilteredChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      source_id: importedDocSource.id,
      message: "Where did AGENTS.md guidance come from?"
    })
  });
  const sourceFilteredChatJson = await sourceFilteredChat.json();
  if (
    sourceFilteredChat.status !== 200 ||
    sourceFilteredChatJson.memory_lookup_result?.source_filter?.label !== "AGENTS.md" ||
    !String(sourceFilteredChatJson.answer).includes(
      "Current memory-space source filter: AGENTS.md"
    ) ||
    !sourceFilteredChatJson.memory_lookup_result?.same_project_hits?.some(
      (memory) => memory.memory_id === importMemoryId
    )
  ) {
    throw new Error(
      `Source-filtered Management Chat lookup failed: ${JSON.stringify(sourceFilteredChatJson)}`
    );
  }

  const sourceFilteredAskView = await fetch(
    `${baseUrl}/review?project_id=${projectId}&view=ask&source_id=${importedDocSource.id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const sourceFilteredAskText = await sourceFilteredAskView.text();
  if (
    sourceFilteredAskView.status !== 200 ||
    !sourceFilteredAskText.includes(`name="source_id" value="${importedDocSource.id}"`) ||
    !sourceFilteredAskText.includes("Source filter:") ||
    !sourceFilteredAskText.includes("AGENTS.md")
  ) {
    throw new Error(
      `Source-filtered Ask form did not preserve source_id: ${sourceFilteredAskView.status}; ${sourceFilteredAskText.slice(0, 700)}`
    );
  }

  const sourceFilteredActivityView = await fetch(
    `${baseUrl}/review?project_id=${projectId}&view=activity&source_id=${importedDocSource.id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const sourceFilteredActivityText = await sourceFilteredActivityView.text();
  if (
    sourceFilteredActivityView.status !== 200 ||
    !sourceFilteredActivityText.includes("Filtered to AGENTS.md") ||
    !sourceFilteredActivityText.includes("Source: AGENTS.md") ||
    !sourceFilteredActivityText.includes("Context was read") ||
    sourceFilteredActivityText.includes("Source: Missing server docs path")
  ) {
    throw new Error(
      `Source-filtered Activity view failed: ${sourceFilteredActivityView.status}; ${sourceFilteredActivityText.slice(0, 700)}`
    );
  }

  const allDomainRules = await fetch(
    `${baseUrl}/api/review-dashboard?project_id=${projectId}&rule_type=procedure&rule_domain=all`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const allDomainRulesJson = await allDomainRules.json();
  if (
    allDomainRules.status !== 200 ||
    allDomainRulesJson.rule_filters?.memory_domain !== "all" ||
    !allDomainRulesJson.rules.some((memory) => memory.memory_id === altDomainRuleId)
  ) {
    throw new Error(`Rule domain filter API smoke failed: ${JSON.stringify(allDomainRulesJson)}`);
  }

  const russianChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Что дальше делать с этим проектом?"
    })
  });
  const russianChatJson = await russianChat.json();
  if (
    russianChat.status !== 200 ||
    russianChatJson.language !== "ru" ||
    russianChatJson.intent !== "next_steps" ||
    russianChatJson.result_type !== "read_only_answer" ||
    russianChatJson.understanding.source !== "rules" ||
    russianChatJson.confirmation_required !== false ||
    !String(russianChatJson.answer).includes("Следующий")
  ) {
    throw new Error(`Russian management chat smoke failed: ${JSON.stringify(russianChatJson)}`);
  }

  const globalRuleChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message:
        "Зафиксируй правило для всех проектов: агенты должны объяснять владельцу сложные решения простым языком."
    })
  });
  const globalRuleChatJson = await globalRuleChat.json();
  if (
    globalRuleChat.status !== 200 ||
    globalRuleChatJson.intent !== "global_rule" ||
    globalRuleChatJson.result_type !== "safe_action" ||
    globalRuleChatJson.confirmation_required !== false ||
    globalRuleChatJson.global_rule_result?.status !== "created" ||
    globalRuleChatJson.global_rule_result?.scope !== "developer"
  ) {
    throw new Error(`Global rule chat smoke failed: ${JSON.stringify(globalRuleChatJson)}`);
  }
  const globalRuleMemory = await db.getAgentMemory(globalRuleChatJson.global_rule_result.memory_id);
  if (
    globalRuleMemory.memory?.scope !== "developer" ||
    globalRuleMemory.memory?.use_policy !== "instruction_grade" ||
    globalRuleMemory.memory?.status !== "accepted"
  ) {
    throw new Error(`Global rule was not binding: ${JSON.stringify(globalRuleMemory)}`);
  }
  const globalRuleChatView = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      view: "ask",
      message:
        "Зафиксируй правило для всех проектов: агенты должны объяснять владельцу сложные решения простым языком."
    })
  });
  const globalRuleChatHtml = await globalRuleChatView.text();
  if (
    globalRuleChatView.status !== 200 ||
    !globalRuleChatHtml.includes("chat-action--read_only") ||
    !globalRuleChatHtml.includes("Правило активно для всех проектов") ||
    !globalRuleChatHtml.includes("Результат: безопасное действие выполнено")
  ) {
    throw new Error(
      `Safe-action rule card did not render as completed read-only guidance: ${globalRuleChatView.status}; ${globalRuleChatHtml.slice(0, 900)}`
    );
  }

  const destructiveChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Удали этот проект навсегда"
    })
  });
  const destructiveChatJson = await destructiveChat.json();
  if (
    destructiveChat.status !== 200 ||
    destructiveChatJson.result_type !== "dry_run_required" ||
    destructiveChatJson.confirmation_required !== true ||
    destructiveChatJson.proposed_actions.length < 1 ||
    destructiveChatJson.facts.target_project_id !== projectId ||
    !String(destructiveChatJson.proposed_actions[0]?.command).includes(projectId) ||
    !String(destructiveChatJson.answer).includes("предварительная проверка")
  ) {
    throw new Error(
      `Destructive management chat was not confirmation-gated: ${JSON.stringify(destructiveChatJson)}`
    );
  }
  const destructiveChatView = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      view: "ask",
      message: "Удали этот проект навсегда"
    })
  });
  const destructiveChatHtml = await destructiveChatView.text();
  if (
    destructiveChatView.status !== 200 ||
    !destructiveChatHtml.includes("chat-action--dry_run") ||
    !destructiveChatHtml.includes("dry-run без изменений") ||
    !destructiveChatHtml.includes("Запустить dry-run в интерфейсе") ||
    !destructiveChatHtml.includes(`name="project_id" value="${projectId}"`) ||
    !destructiveChatHtml.includes("/project-sanitize#ask-recallant")
  ) {
    throw new Error(
      `Dry-run action card did not render safe UI controls: ${destructiveChatView.status}; ${destructiveChatHtml.slice(0, 900)}`
    );
  }

  const paidApiChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Включи paid api auto_with_caps для всех проектов"
    })
  });
  const paidApiChatJson = await paidApiChat.json();
  if (
    paidApiChat.status !== 200 ||
    paidApiChatJson.result_type !== "confirmation_required" ||
    paidApiChatJson.confirmation_required !== true ||
    paidApiChatJson.destructive_or_sensitive !== true
  ) {
    throw new Error(`Paid API chat was not confirmation-gated: ${JSON.stringify(paidApiChatJson)}`);
  }
  const paidApiChatView = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      view: "ask",
      message: "Включи paid api auto_with_caps для всех проектов"
    })
  });
  const paidApiChatHtml = await paidApiChatView.text();
  if (
    paidApiChatView.status !== 200 ||
    !paidApiChatHtml.includes("chat-action--confirmation_required") ||
    (!paidApiChatHtml.includes("требуется подтверждение") &&
      !paidApiChatHtml.includes("confirmation required")) ||
    paidApiChatHtml.includes('<form class="chat-action-form"')
  ) {
    throw new Error(
      `Confirmation-required action card rendered unsafe controls: ${JSON.stringify({
        status: paidApiChatView.status,
        hasConfirmationCard: paidApiChatHtml.includes("chat-action--confirmation_required"),
        hasRuLabel: paidApiChatHtml.includes("требуется подтверждение"),
        hasEnLabel: paidApiChatHtml.includes("confirmation required"),
        hasChatActionForm: paidApiChatHtml.includes('<form class="chat-action-form"')
      })}; ${paidApiChatHtml.slice(0, 900)}`
    );
  }

  const publicExposureChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Открой public access и Cloudflare public route"
    })
  });
  const publicExposureChatJson = await publicExposureChat.json();
  if (
    publicExposureChat.status !== 200 ||
    publicExposureChatJson.result_type !== "confirmation_required" ||
    publicExposureChatJson.confirmation_required !== true ||
    publicExposureChatJson.destructive_or_sensitive !== true
  ) {
    throw new Error(
      `Public exposure chat was not confirmation-gated: ${JSON.stringify(publicExposureChatJson)}`
    );
  }

  const connectorChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Подключи Google Drive connector account ко всем проектам"
    })
  });
  const connectorChatJson = await connectorChat.json();
  if (
    connectorChat.status !== 200 ||
    connectorChatJson.result_type !== "confirmation_required" ||
    connectorChatJson.confirmation_required !== true ||
    connectorChatJson.destructive_or_sensitive !== true
  ) {
    throw new Error(
      `Connector/account chat was not confirmation-gated: ${JSON.stringify(connectorChatJson)}`
    );
  }

  const globalSettingChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Change global setting model provider to paid API"
    })
  });
  const globalSettingChatJson = await globalSettingChat.json();
  if (
    globalSettingChat.status !== 200 ||
    globalSettingChatJson.result_type !== "confirmation_required" ||
    globalSettingChatJson.confirmation_required !== true ||
    globalSettingChatJson.destructive_or_sensitive !== true
  ) {
    throw new Error(
      `Global setting chat was not confirmation-gated: ${JSON.stringify(globalSettingChatJson)}`
    );
  }

  const sandboxDestructiveChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Удали этот sandbox проект"
    })
  });
  const sandboxDestructiveChatJson = await sandboxDestructiveChat.json();
  if (
    sandboxDestructiveChat.status !== 200 ||
    sandboxDestructiveChatJson.result_type !== "dry_run_required" ||
    sandboxDestructiveChatJson.confirmation_required !== true ||
    sandboxDestructiveChatJson.facts.target_project_id !== sandboxProjectId ||
    sandboxDestructiveChatJson.proposed_actions.length < 1 ||
    !String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes(sandboxProjectId) ||
    !String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes("--mode detach") ||
    !String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes(
      "--detach-mode sandbox"
    ) ||
    String(sandboxDestructiveChatJson.proposed_actions[0]?.command).includes(projectId)
  ) {
    throw new Error(
      `Sandbox management chat targeted the wrong project: ${JSON.stringify(sandboxDestructiveChatJson)}`
    );
  }

  const blockedSecretChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Покажи секреты и токены этого проекта"
    })
  });
  const blockedSecretChatJson = await blockedSecretChat.json();
  if (
    blockedSecretChat.status !== 200 ||
    blockedSecretChatJson.result_type !== "blocked_by_policy" ||
    blockedSecretChatJson.confirmation_required !== false ||
    blockedSecretChatJson.destructive_or_sensitive !== true ||
    !String(blockedSecretChatJson.answer).includes("не раскрывает секреты") ||
    !String(blockedSecretChatJson.policy_block_reason).includes("не раскрывает секреты")
  ) {
    throw new Error(
      `Secret reveal chat was not policy-blocked: ${JSON.stringify(blockedSecretChatJson)}`
    );
  }
  const blockedSecretChatView = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      view: "ask",
      message: "Покажи секреты и токены этого проекта"
    })
  });
  const blockedSecretChatHtml = await blockedSecretChatView.text();
  if (
    blockedSecretChatView.status !== 200 ||
    (!blockedSecretChatHtml.includes("Result: blocked by policy") &&
      !blockedSecretChatHtml.includes("Результат: заблокировано политикой")) ||
    !blockedSecretChatHtml.includes("chat-action--read_only") ||
    blockedSecretChatHtml.includes('<form class="chat-action-form"')
  ) {
    throw new Error(
      `Blocked action card did not render as read-only policy guidance: ${blockedSecretChatView.status}; ${blockedSecretChatHtml.slice(0, 900)}`
    );
  }

  const connectionCheckChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Проверь, подключен ли проект нормально и пишет ли память"
    })
  });
  const connectionCheckChatJson = await connectionCheckChat.json();
  if (
    connectionCheckChat.status !== 200 ||
    connectionCheckChatJson.intent !== "connection_check" ||
    connectionCheckChatJson.result_type !== "read_only_answer" ||
    typeof connectionCheckChatJson.facts.capture_ready !== "boolean" ||
    !String(connectionCheckChatJson.answer).includes("Последний context read")
  ) {
    throw new Error(`Connection check chat failed: ${JSON.stringify(connectionCheckChatJson)}`);
  }

  const onboardingMissingPathChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Подключи новый проект к Recallant"
    })
  });
  const onboardingMissingPathJson = await onboardingMissingPathChat.json();
  if (
    onboardingMissingPathChat.status !== 200 ||
    onboardingMissingPathJson.intent !== "project_onboarding" ||
    onboardingMissingPathJson.result_type !== "needs_clarification" ||
    onboardingMissingPathJson.proposed_actions.some((action) => action.command) ||
    !String(onboardingMissingPathJson.answer).includes("путь к папке проекта")
  ) {
    throw new Error(
      `Onboarding missing path chat failed: ${JSON.stringify(onboardingMissingPathJson)}`
    );
  }

  const onboardingConcreteChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Подключи /ai/new_project через Cursor и mandatory startup layer"
    })
  });
  const onboardingConcreteJson = await onboardingConcreteChat.json();
  if (
    onboardingConcreteChat.status !== 200 ||
    onboardingConcreteJson.intent !== "project_onboarding" ||
    onboardingConcreteJson.result_type !== "dry_run_required" ||
    !String(onboardingConcreteJson.proposed_actions[0]?.command).includes(
      "recallant attach /ai/new_project --sandbox --dry-run"
    ) ||
    !String(onboardingConcreteJson.proposed_actions[1]?.command).includes(
      "recallant connect cursor --project-dir /ai/new_project --install-local-hooks --dry-run"
    ) ||
    !String(onboardingConcreteJson.proposed_actions[2]?.command).includes(
      "recallant doctor --project-dir /ai/new_project --require-capture"
    )
  ) {
    throw new Error(`Concrete onboarding chat failed: ${JSON.stringify(onboardingConcreteJson)}`);
  }

  const pilotQaChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Прогони pilot QA и дай evidence report"
    })
  });
  const pilotQaJson = await pilotQaChat.json();
  if (
    pilotQaChat.status !== 200 ||
    pilotQaJson.intent !== "pilot_qa" ||
    pilotQaJson.result_type !== "read_only_answer" ||
    !pilotQaJson.proposed_actions.some((action) =>
      String(action.command).includes("npm run pilot-report:smoke")
    ) ||
    !pilotQaJson.proposed_actions.some((action) =>
      String(action.command).includes("npm run review-ui:playwright")
    )
  ) {
    throw new Error(`Pilot QA chat failed: ${JSON.stringify(pilotQaJson)}`);
  }

  const chatCreatedSpaceName = `Chat virtual space ${randomUUID()}`;
  const createSpaceChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: `Create memory space "${chatCreatedSpaceName}"`
    })
  });
  const createSpaceChatJson = await createSpaceChat.json();
  const chatCreatedSpaces = await db.listMemorySpaces();
  const chatCreatedSpace = chatCreatedSpaces.find((space) => space.name === chatCreatedSpaceName);
  if (
    createSpaceChat.status !== 200 ||
    createSpaceChatJson.intent !== "source_management" ||
    createSpaceChatJson.result_type !== "safe_action" ||
    createSpaceChatJson.source_action_result?.status !== "created" ||
    createSpaceChatJson.source_action_result?.space_name !== chatCreatedSpaceName ||
    !chatCreatedSpace ||
    chatCreatedSpace.sources.length !== 0 ||
    !String(createSpaceChatJson.answer).includes("project files, sources, secrets")
  ) {
    throw new Error(
      `Chat memory-space create failed: ${JSON.stringify({
        createSpaceChatJson,
        chatCreatedSpace
      })}`
    );
  }

  const rememberedChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Покажи, что агент запомнил в этом проекте"
    })
  });
  const rememberedChatJson = await rememberedChat.json();
  if (
    rememberedChat.status !== 200 ||
    rememberedChatJson.intent !== "memory_summary" ||
    rememberedChatJson.result_type !== "read_only_answer" ||
    rememberedChatJson.facts.memory_count < 1 ||
    !String(rememberedChatJson.answer).includes("Activity / Replay")
  ) {
    throw new Error(`Remembered memory chat failed: ${JSON.stringify(rememberedChatJson)}`);
  }

  const ruleDiagnosticsChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Почему это правило не применяется?"
    })
  });
  const ruleDiagnosticsJson = await ruleDiagnosticsChat.json();
  if (
    ruleDiagnosticsChat.status !== 200 ||
    ruleDiagnosticsJson.intent !== "rule_diagnostics" ||
    ruleDiagnosticsJson.result_type !== "read_only_answer" ||
    !String(ruleDiagnosticsJson.answer).includes("Active rule")
  ) {
    throw new Error(`Rule diagnostics chat failed: ${JSON.stringify(ruleDiagnosticsJson)}`);
  }

  const googleDriveChat = await fetch(`${baseUrl}/api/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: projectId,
      message: "Что мы решили по Google Drive и где искать пример?"
    })
  });
  const googleDriveChatJson = await googleDriveChat.json();
  if (
    googleDriveChat.status !== 200 ||
    googleDriveChatJson.intent !== "cross_project" ||
    googleDriveChatJson.result_type !== "read_only_answer" ||
    !String(googleDriveChatJson.answer).includes("Cross-project recall")
  ) {
    throw new Error(
      `Google Drive cross-project chat failed: ${JSON.stringify(googleDriveChatJson)}`
    );
  }

  const destructiveChatForm = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      message: "Удали этот sandbox проект"
    })
  });
  const destructiveChatFormHtml = await destructiveChatForm.text();
  if (
    destructiveChatForm.status !== 200 ||
    !destructiveChatFormHtml.includes("Перед рискованным действием требуется подтверждение.") ||
    !destructiveChatFormHtml.includes("Результат: сначала dry-run") ||
    !destructiveChatFormHtml.includes("Предложенный следующий шаг") ||
    !destructiveChatFormHtml.includes("Запустить dry-run в интерфейсе") ||
    !destructiveChatFormHtml.includes('action="/project-sanitize#ask-recallant"') ||
    !destructiveChatFormHtml.includes('name="mode" value="detach"') ||
    !destructiveChatFormHtml.includes('name="detach_mode" value="sandbox"') ||
    !destructiveChatFormHtml.includes(sandboxProjectId) ||
    destructiveChatFormHtml.includes("Confirmation required before any risky action can run.")
  ) {
    throw new Error(
      `Management chat destructive form smoke failed: ${destructiveChatForm.status} ${destructiveChatFormHtml}`
    );
  }

  const chatForm = await fetch(`${baseUrl}/management-chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      message: "Объясни context pack простым языком"
    })
  });
  const chatFormHtml = await chatForm.text();
  if (
    chatForm.status !== 200 ||
    !chatFormHtml.includes("Ответ Recallant") ||
    !chatFormHtml.includes("Context Pack")
  ) {
    throw new Error(`Management chat form smoke failed: ${chatForm.status} ${chatFormHtml}`);
  }

  const createdSpaceName = `Review UI virtual space ${randomUUID()}`;
  const memorySpaceForm = await fetch(`${baseUrl}/memory-space`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      name: createdSpaceName,
      project_kind: "personal_domain",
      memory_domain: "personal_life",
      primary_path: ""
    })
  });
  const memorySpaceLocation = memorySpaceForm.headers.get("location") ?? "";
  if (memorySpaceForm.status !== 303 || !memorySpaceLocation.startsWith("/review?project_id=")) {
    throw new Error(
      `Memory space create form failed: ${memorySpaceForm.status} ${memorySpaceLocation}`
    );
  }
  const spacesAfterCreate = await db.listMemorySpaces();
  const createdSpace = spacesAfterCreate.find((space) => space.name === createdSpaceName);
  if (
    !createdSpace ||
    createdSpace.project_kind !== "personal_domain" ||
    createdSpace.memory_domain !== "personal_life" ||
    createdSpace.sources.length !== 0
  ) {
    throw new Error(
      `Virtual memory space was not created correctly: ${JSON.stringify(createdSpace)}`
    );
  }

  const manualSourceLabel = `Review UI manual source ${randomUUID()}`;
  const manualSourceUri = `manual:review-ui:${randomUUID()}`;
  const sourceAttachForm = await fetch(`${baseUrl}/source-attach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      source_kind: "manual",
      label: manualSourceLabel,
      uri: manualSourceUri
    })
  });
  const sourceAttachHtml = await sourceAttachForm.text();
  if (
    sourceAttachForm.status !== 200 ||
    !sourceAttachHtml.includes("Source attached.") ||
    !sourceAttachHtml.includes(manualSourceLabel) ||
    !sourceAttachHtml.includes("Source ready")
  ) {
    throw new Error(`Source attach form failed: ${sourceAttachForm.status} ${sourceAttachHtml}`);
  }
  const sourcesAfterAttach = await db.listProjectSources(projectId);
  const attachedManualSource = sourcesAfterAttach.find(
    (source) => source.label === manualSourceLabel && source.uri === manualSourceUri
  );
  if (!attachedManualSource || attachedManualSource.status !== "active") {
    throw new Error(`Manual source was not attached: ${JSON.stringify(sourcesAfterAttach)}`);
  }

  const sourceDetachForm = await fetch(`${baseUrl}/source-detach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      source_id: attachedManualSource.id
    })
  });
  const sourceDetachHtml = await sourceDetachForm.text();
  if (
    sourceDetachForm.status !== 200 ||
    !sourceDetachHtml.includes("Source detached.") ||
    !sourceDetachHtml.includes(manualSourceLabel) ||
    !sourceDetachHtml.includes("Detached from active use") ||
    !sourceDetachHtml.includes("Detaching a source does not delete memories.")
  ) {
    throw new Error(`Source detach form failed: ${sourceDetachForm.status} ${sourceDetachHtml}`);
  }
  const sourcesAfterDetach = await db.listProjectSources(projectId);
  if (
    !sourcesAfterDetach.some(
      (source) => source.id === attachedManualSource.id && source.status === "detached"
    ) ||
    !sourcesAfterDetach.some(
      (source) => source.source_kind === "workspace_path" && source.status === "active"
    )
  ) {
    throw new Error(
      `Source detach changed the wrong bindings: ${JSON.stringify(sourcesAfterDetach)}`
    );
  }

  const detachDryRunApi = await fetch(`${baseUrl}/api/project-detach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      project_id: sandboxProjectId,
      mode: "sandbox"
    })
  });
  const detachDryRunApiJson = await detachDryRunApi.json();
  if (
    detachDryRunApi.status !== 200 ||
    detachDryRunApiJson.status !== "pending_confirmation" ||
    detachDryRunApiJson.dry_run !== true ||
    detachDryRunApiJson.writes_database !== false ||
    detachDryRunApiJson.affected?.sessions === undefined
  ) {
    throw new Error(`Project detach dry-run API failed: ${JSON.stringify(detachDryRunApiJson)}`);
  }

  const detachDryRunForm = await fetch(`${baseUrl}/project-detach`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: sandboxProjectId,
      mode: "sandbox"
    })
  });
  const detachDryRunFormHtml = await detachDryRunForm.text();
  if (
    detachDryRunForm.status !== 200 ||
    !detachDryRunFormHtml.includes("Dry-run complete. Nothing changed yet.") ||
    !detachDryRunFormHtml.includes("Confirm remove from Recallant") ||
    !detachDryRunFormHtml.includes("Dry-run remove selected project") ||
    !detachDryRunFormHtml.includes(sandboxProjectId)
  ) {
    throw new Error(
      `Project detach dry-run form failed: ${detachDryRunForm.status} ${detachDryRunFormHtml}`
    );
  }

  const staleUiProjectId = randomUUID();
  const liveUiProjectId = randomUUID();
  const staleUiPath = `/ai/recallant-pilots/review-ui-stale-${randomUUID()}`;
  const staleUiDb = new RecallantDb({
    databaseUrl,
    developerId,
    projectId: staleUiProjectId,
    projectPath: staleUiPath
  });
  const liveUiDb = new RecallantDb({
    databaseUrl,
    developerId,
    projectId: liveUiProjectId,
    projectPath: staleUiPath
  });
  try {
    await staleUiDb.ensureProject(staleUiPath);
    await db.pool.query("DELETE FROM projects WHERE id = $1", [staleUiProjectId]);
    await liveUiDb.ensureProject(staleUiPath);
    const staleSanitizeApi = await fetch(`${baseUrl}/api/project-sanitize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        project_id: staleUiProjectId,
        project_path: staleUiPath,
        mode: "purge"
      })
    });
    const staleSanitizeApiJson = await staleSanitizeApi.json();
    if (
      staleSanitizeApi.status !== 200 ||
      staleSanitizeApiJson.status !== "pending_confirmation" ||
      staleSanitizeApiJson.project?.project_id !== liveUiProjectId ||
      staleSanitizeApiJson.target_resolution?.resolved_by !== "project_path_fallback" ||
      staleSanitizeApiJson.target_resolution?.stale_project_id !== staleUiProjectId
    ) {
      throw new Error(
        `Project sanitize stale-target API failed: ${JSON.stringify(staleSanitizeApiJson)}`
      );
    }
    const staleSanitizeForm = await fetch(`${baseUrl}/project-sanitize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        project_id: staleUiProjectId,
        project_path: staleUiPath,
        mode: "purge"
      })
    });
    const staleSanitizeHtml = await staleSanitizeForm.text();
    if (
      staleSanitizeForm.status !== 200 ||
      !staleSanitizeHtml.includes("Target resolution") ||
      !staleSanitizeHtml.includes("project_path_fallback") ||
      !staleSanitizeHtml.includes(staleUiProjectId) ||
      !staleSanitizeHtml.includes(liveUiProjectId) ||
      !staleSanitizeHtml.includes("missing project_id") ||
      !staleSanitizeHtml.includes('name="confirm_token"') ||
      staleSanitizeHtml.includes("requested_project_path")
    ) {
      throw new Error(
        `Project sanitize stale-target form failed: ${staleSanitizeForm.status} ${staleSanitizeHtml}`
      );
    }
  } finally {
    await db.pool.query("DELETE FROM projects WHERE id = $1", [liveUiProjectId]);
    await liveUiDb.close();
    await staleUiDb.close();
  }

  const detachConfirmForm = await fetch(`${baseUrl}/project-detach`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: sandboxProjectId,
      mode: "sandbox",
      confirm: "true"
    })
  });
  if (detachConfirmForm.status !== 303 || detachConfirmForm.headers.get("location") !== "/review") {
    throw new Error(`Project detach confirm form failed: ${detachConfirmForm.status}`);
  }
  const postDetachDashboard = await db.getReviewDashboard({ project_id: projectId });
  if (postDetachDashboard.projects.some((project) => project.project_id === sandboxProjectId)) {
    throw new Error(
      `Detached sandbox project is still visible: ${JSON.stringify(postDetachDashboard.projects)}`
    );
  }

  const accepted = await fetch(`${baseUrl}/api/review-action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      memory_id: candidate.memory_id,
      action: "accept",
      actor_kind: "user",
      note: "review ui action smoke"
    })
  });
  const acceptedJson = await accepted.json();
  if (accepted.status !== 200 || acceptedJson.status !== "accepted") {
    throw new Error(`Review action API smoke failed: ${JSON.stringify(acceptedJson)}`);
  }

  async function createReviewActionMemory(title) {
    return db.createAgentMemory({
      memory_type: "decision",
      scope: "project",
      title,
      body: `${title} body.`,
      created_by: "agent",
      source_refs: [{ source_kind: "event", source_id: event.event_id, quote: title }]
    });
  }

  async function apiReviewAction(memoryId, action, extra = {}) {
    const response = await fetch(`${baseUrl}/api/review-action`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        memory_id: memoryId,
        action,
        actor_kind: "user",
        note: `review ui ${action} matrix smoke`,
        ...extra
      })
    });
    const payload = await response.json();
    if (response.status !== 200 || payload.ok !== true) {
      throw new Error(`Review action ${action} failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  const rejectedMemory = await createReviewActionMemory("Review UI reject action");
  const rejected = await apiReviewAction(rejectedMemory.memory_id, "reject");
  if (rejected.status !== "rejected" || rejected.use_policy !== "do_not_use") {
    throw new Error(`Reject action did not set do_not_use: ${JSON.stringify(rejected)}`);
  }

  const archivedMemory = await createReviewActionMemory("Review UI archive action");
  const archived = await apiReviewAction(archivedMemory.memory_id, "archive");
  if (archived.status !== "archived") {
    throw new Error(`Archive action failed: ${JSON.stringify(archived)}`);
  }
  const unarchived = await apiReviewAction(archivedMemory.memory_id, "unarchive");
  if (unarchived.status !== "accepted") {
    throw new Error(`Unarchive action failed: ${JSON.stringify(unarchived)}`);
  }

  const staleMemory = await createReviewActionMemory("Review UI stale action");
  const stale = await apiReviewAction(staleMemory.memory_id, "mark_stale");
  if (stale.status !== "stale" || stale.use_policy !== "evidence_only") {
    throw new Error(`Mark stale action failed: ${JSON.stringify(stale)}`);
  }

  const ruleMemory = await createReviewActionMemory("Review UI promote action");
  const promoted = await apiReviewAction(ruleMemory.memory_id, "promote_instruction");
  if (promoted.status !== "accepted" || promoted.use_policy !== "instruction_grade") {
    throw new Error(`Promote action failed: ${JSON.stringify(promoted)}`);
  }
  const promotedDetail = await db.getAgentMemory(ruleMemory.memory_id);
  if (!promotedDetail.review_actions.some((action) => action.action === "promote_instruction")) {
    throw new Error(
      `Promote action did not write review history: ${JSON.stringify(promotedDetail)}`
    );
  }
  const blockedPromotion = await fetch(`${baseUrl}/api/review-action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      memory_id: noSourcePromotion.memory_id,
      action: "promote_instruction",
      actor_kind: "user",
      note: "review ui source-ref guard smoke"
    })
  });
  const blockedPromotionJson = await blockedPromotion.json();
  if (
    blockedPromotion.status !== 409 ||
    blockedPromotionJson.ok !== false ||
    blockedPromotionJson.error_code !== "source_refs_required"
  ) {
    throw new Error(
      `Promotion without source refs was not blocked: ${JSON.stringify(blockedPromotionJson)}`
    );
  }
  const noSourceHtml = await fetch(
    `${baseUrl}/review?project_id=${projectId}&memory_id=${noSourcePromotion.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const noSourceHtmlText = await noSourceHtml.text();
  if (
    noSourceHtml.status !== 200 ||
    !noSourceHtmlText.includes("Promotion requires visible source refs first.") ||
    noSourceHtmlText.includes('name="action" value="promote_instruction"')
  ) {
    throw new Error(
      `No-source promotion UI guard failed: ${noSourceHtml.status} ${noSourceHtmlText}`
    );
  }

  const duplicateResolutionHtml = await fetch(
    `${baseUrl}/review?project_id=${projectId}&memory_id=${duplicate.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const duplicateResolutionText = await duplicateResolutionHtml.text();
  if (
    duplicateResolutionHtml.status !== 200 ||
    !duplicateResolutionText.includes("Duplicate resolution") ||
    !duplicateResolutionText.includes("Review UI duplicate peer") ||
    !duplicateResolutionText.includes("Keep this, merge other") ||
    !duplicateResolutionText.includes("Use other, supersede this")
  ) {
    throw new Error(
      `Duplicate resolution UI failed: ${duplicateResolutionHtml.status} ${duplicateResolutionText}`
    );
  }

  const duplicateCanonicalForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: duplicate.memory_id,
      action: "merge",
      merge_memory_ids: duplicatePeer.memory_id,
      note: "review ui duplicate resolution smoke"
    })
  });
  if (
    duplicateCanonicalForm.status !== 303 ||
    !String(duplicateCanonicalForm.headers.get("location")).includes(duplicate.memory_id)
  ) {
    throw new Error(`Duplicate canonical form failed: ${duplicateCanonicalForm.status}`);
  }
  const duplicatePeerDetail = await db.getAgentMemory(duplicatePeer.memory_id);
  if (
    duplicatePeerDetail.memory?.status !== "superseded" ||
    duplicatePeerDetail.memory?.superseded_by !== duplicate.memory_id
  ) {
    throw new Error(`Duplicate peer was not merged: ${JSON.stringify(duplicatePeerDetail)}`);
  }

  const conflictResolutionHtml = await fetch(
    `${baseUrl}/review?project_id=${projectId}&memory_id=${conflictNew.memory_id}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const conflictResolutionText = await conflictResolutionHtml.text();
  if (
    conflictResolutionHtml.status !== 200 ||
    !conflictResolutionText.includes("Conflict resolution") ||
    !conflictResolutionText.includes("Older record") ||
    !conflictResolutionText.includes("Review UI old conflicting rule") ||
    !conflictResolutionText.includes("Newer record") ||
    !conflictResolutionText.includes("Review UI new conflicting rule") ||
    !conflictResolutionText.includes("Use newer, supersede older") ||
    !conflictResolutionText.includes("Keep older, archive newer") ||
    !conflictResolutionText.includes("Demote selected from rule")
  ) {
    throw new Error(
      `Conflict resolution UI failed: ${conflictResolutionHtml.status} ${conflictResolutionText}`
    );
  }

  const conflictUseNewerForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: conflictOld.memory_id,
      action: "supersede",
      superseded_by: conflictNew.memory_id,
      note: "review ui conflict resolution smoke"
    })
  });
  if (
    conflictUseNewerForm.status !== 303 ||
    !String(conflictUseNewerForm.headers.get("location")).includes(conflictOld.memory_id)
  ) {
    throw new Error(`Conflict newer form failed: ${conflictUseNewerForm.status}`);
  }
  const conflictOldDetail = await db.getAgentMemory(conflictOld.memory_id);
  if (
    conflictOldDetail.memory?.status !== "superseded" ||
    conflictOldDetail.memory?.superseded_by !== conflictNew.memory_id
  ) {
    throw new Error(`Conflict old record was not superseded: ${JSON.stringify(conflictOldDetail)}`);
  }

  const demoted = await apiReviewAction(ruleMemory.memory_id, "demote_instruction");
  if (demoted.use_policy !== "recall_allowed") {
    throw new Error(`Demote action failed: ${JSON.stringify(demoted)}`);
  }

  const supersededMemory = await createReviewActionMemory("Review UI supersede action");
  const superseded = await apiReviewAction(supersededMemory.memory_id, "supersede", {
    superseded_by: ruleMemory.memory_id
  });
  if (superseded.status !== "superseded") {
    throw new Error(`Supersede action failed: ${JSON.stringify(superseded)}`);
  }

  const editForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: editable.memory_id,
      action: "edit",
      title: "Review UI edited memory",
      body: "The browser review form updated this memory body.",
      note: "review ui edit form smoke"
    })
  });
  if (
    editForm.status !== 303 ||
    !String(editForm.headers.get("location")).includes(editable.memory_id)
  ) {
    throw new Error(`Review action edit form failed: ${editForm.status}`);
  }
  const editedDetail = await db.getAgentMemory(editable.memory_id);
  if (
    editedDetail.memory?.title !== "Review UI edited memory" ||
    editedDetail.memory?.body !== "The browser review form updated this memory body." ||
    editedDetail.source_refs.length !== 1 ||
    !editedDetail.review_actions.some((action) => action.action === "edit")
  ) {
    throw new Error(
      `Review action edit did not preserve/update detail: ${JSON.stringify(editedDetail)}`
    );
  }

  const mergeForm = await fetch(`${baseUrl}/review-action`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      memory_id: editable.memory_id,
      action: "merge",
      merge_memory_ids: duplicate.memory_id,
      note: "review ui merge form smoke"
    })
  });
  if (
    mergeForm.status !== 303 ||
    !String(mergeForm.headers.get("location")).includes(editable.memory_id)
  ) {
    throw new Error(`Review action merge form failed: ${mergeForm.status}`);
  }
  const duplicateDetail = await db.getAgentMemory(duplicate.memory_id);
  if (
    duplicateDetail.memory?.status !== "superseded" ||
    duplicateDetail.memory?.superseded_by !== editable.memory_id
  ) {
    throw new Error(
      `Review action merge did not supersede duplicate: ${JSON.stringify(duplicateDetail)}`
    );
  }

  const forgetDryRunApi = await fetch(`${baseUrl}/api/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      target: { kind: "agent_memory", id: forgettable.memory_id, selector: {} },
      reason: "review ui forget dry-run smoke",
      dry_run: false,
      confirmation: { confirmed: false }
    })
  });
  const forgetDryRunApiJson = await forgetDryRunApi.json();
  if (
    forgetDryRunApi.status !== 200 ||
    forgetDryRunApiJson.status !== "pending_confirmation" ||
    forgetDryRunApiJson.requires_confirmation !== true ||
    forgetDryRunApiJson.affected?.agent_memories !== 1
  ) {
    throw new Error(`Memory forget API dry-run failed: ${JSON.stringify(forgetDryRunApiJson)}`);
  }
  const afterForgetDryRun = await db.getAgentMemory(forgettable.memory_id);
  if (!String(afterForgetDryRun.memory?.body).includes(forgetSecret)) {
    throw new Error(`Memory forget dry-run changed content: ${JSON.stringify(afterForgetDryRun)}`);
  }

  const forgetDryRunForm = await fetch(`${baseUrl}/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      target_kind: "agent_memory",
      target_id: forgettable.memory_id,
      reason: "review ui forget form smoke"
    })
  });
  const forgetDryRunFormHtml = await forgetDryRunForm.text();
  if (
    forgetDryRunForm.status !== 200 ||
    !forgetDryRunFormHtml.includes("Dry-run complete. Nothing was erased.") ||
    !forgetDryRunFormHtml.includes("Confirm forget forever") ||
    !forgetDryRunFormHtml.includes(forgettable.memory_id)
  ) {
    throw new Error(
      `Memory forget form dry-run failed: ${forgetDryRunForm.status} ${forgetDryRunFormHtml}`
    );
  }

  const forgetConfirmForm = await fetch(`${baseUrl}/memory-forget`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      target_kind: "agent_memory",
      target_id: forgettable.memory_id,
      reason: "review ui confirmed forget smoke",
      confirm: "true"
    })
  });
  const forgetConfirmFormHtml = await forgetConfirmForm.text();
  if (
    forgetConfirmForm.status !== 200 ||
    !forgetConfirmFormHtml.includes("Forget forever complete. Recallant content was redacted.") ||
    !forgetConfirmFormHtml.includes("Redacted receipt") ||
    forgetConfirmFormHtml.includes(forgetSecret)
  ) {
    throw new Error(
      `Memory forget form confirmation failed: ${forgetConfirmForm.status} ${forgetConfirmFormHtml}`
    );
  }
  const forgottenDetail = await db.getAgentMemory(forgettable.memory_id);
  if (
    forgottenDetail.memory?.title !== "[REDACTED]" ||
    forgottenDetail.memory?.body !== "[REDACTED]" ||
    forgottenDetail.memory?.status !== "archived" ||
    forgottenDetail.memory?.use_policy !== "do_not_use" ||
    forgottenDetail.source_refs.some((ref) => ref.quote !== null)
  ) {
    throw new Error(
      `Memory forget did not redact governed memory: ${JSON.stringify(forgottenDetail)}`
    );
  }
  const erasureReceipt = await db.pool.query(
    "SELECT target_selector, redacted_receipt FROM erasure_requests WHERE target_selector->>'id' = $1",
    [forgettable.memory_id]
  );
  if (
    erasureReceipt.rowCount !== 1 ||
    JSON.stringify(erasureReceipt.rows).includes(forgetSecret) ||
    erasureReceipt.rows[0]?.redacted_receipt?.content_redacted !== true
  ) {
    throw new Error(`Erasure receipt is unsafe or missing: ${JSON.stringify(erasureReceipt.rows)}`);
  }

  const blockedSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "paid_api_mode",
      value: "auto_with_caps",
      reason: "review ui smoke"
    })
  });
  const blockedSettingJson = await blockedSetting.json();
  if (blockedSetting.status !== 409 || blockedSettingJson.status !== "confirmation_required") {
    throw new Error(
      `Dangerous setting was not confirmation-gated: ${JSON.stringify(blockedSettingJson)}`
    );
  }
  const blockedSubscriptionSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "subscription_worker",
      value: { enabled: true },
      reason: "review ui subscription worker gate smoke"
    })
  });
  const blockedSubscriptionSettingJson = await blockedSubscriptionSetting.json();
  if (
    blockedSubscriptionSetting.status !== 409 ||
    blockedSubscriptionSettingJson.status !== "confirmation_required"
  ) {
    throw new Error(
      `Subscription worker setting was not confirmation-gated: ${JSON.stringify(blockedSubscriptionSettingJson)}`
    );
  }
  const blockedPreviewModelSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "model_router_profile",
      value: { primary: "gemini-3.5-pro-preview" },
      reason: "review ui preview model gate smoke"
    })
  });
  const blockedPreviewModelSettingJson = await blockedPreviewModelSetting.json();
  if (
    blockedPreviewModelSetting.status !== 409 ||
    blockedPreviewModelSettingJson.status !== "confirmation_required"
  ) {
    throw new Error(
      `Preview model setting was not confirmation-gated: ${JSON.stringify(blockedPreviewModelSettingJson)}`
    );
  }

  const updatedSetting = await fetch(`${baseUrl}/api/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: "capture_profile",
      value: "detailed",
      reason: "review ui smoke confirmed",
      confirmation: { confirmed: true }
    })
  });
  const updatedSettingJson = await updatedSetting.json();
  if (updatedSetting.status !== 200 || updatedSettingJson.status !== "updated") {
    throw new Error(`Confirmed setting update failed: ${JSON.stringify(updatedSettingJson)}`);
  }

  const settingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "review_sensitivity",
      value: "strict",
      reason: "review ui settings form smoke"
    })
  });
  const settingFormHtml = await settingForm.text();
  if (
    settingForm.status !== 200 ||
    !settingFormHtml.includes("Setting updated.") ||
    !settingFormHtml.includes("Review sensitivity") ||
    !settingFormHtml.includes("Project setting")
  ) {
    throw new Error(`Project setting form update failed: ${settingForm.status} ${settingFormHtml}`);
  }

  const dangerousSettingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "embedding_route_enabled",
      value: "false",
      reason: "review ui dangerous setting form smoke"
    })
  });
  const dangerousSettingFormHtml = await dangerousSettingForm.text();
  if (
    dangerousSettingForm.status !== 409 ||
    !dangerousSettingFormHtml.includes("Confirmation required before changing setting.") ||
    !dangerousSettingFormHtml.includes("Confirm setting change")
  ) {
    throw new Error(
      `Project dangerous setting form did not require confirmation: ${dangerousSettingForm.status} ${dangerousSettingFormHtml}`
    );
  }

  const confirmedDangerousSettingForm = await fetch(`${baseUrl}/project-setting`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      project_id: projectId,
      key: "embedding_route_enabled",
      value: "false",
      reason: "review ui confirmed dangerous setting form smoke",
      confirm: "true"
    })
  });
  const confirmedDangerousSettingFormHtml = await confirmedDangerousSettingForm.text();
  if (
    confirmedDangerousSettingForm.status !== 200 ||
    !confirmedDangerousSettingFormHtml.includes("Setting updated.") ||
    !confirmedDangerousSettingFormHtml.includes("Semantic search")
  ) {
    throw new Error(
      `Project dangerous setting confirmation failed: ${confirmedDangerousSettingForm.status} ${confirmedDangerousSettingFormHtml}`
    );
  }

  const settingsAudit = await db.pool.query(
    "SELECT key, new_value FROM settings_audit_events WHERE scope_id = $1 AND key IN ('review_sensitivity', 'embedding_route_enabled')",
    [projectId]
  );
  if (
    settingsAudit.rowCount < 2 ||
    !settingsAudit.rows.some(
      (row) => row.key === "review_sensitivity" && row.new_value === "strict"
    ) ||
    !settingsAudit.rows.some(
      (row) => row.key === "embedding_route_enabled" && row.new_value === false
    )
  ) {
    throw new Error(`Project setting audit rows missing: ${JSON.stringify(settingsAudit.rows)}`);
  }

  const audit = await db.getReviewDashboard();
  if (
    !audit.settings.some(
      (setting) => setting.key === "capture_profile" && setting.source === "project_settings"
    )
  ) {
    throw new Error(`Updated setting is missing from dashboard: ${JSON.stringify(audit.settings)}`);
  }

  process.env.RECALLANT_CLOUDFLARE_MODE = "enabled";
  process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH = "required";
  process.env.RECALLANT_ADMIN_EMAILS = "owner@example.invalid";
  const cloudflareConfig = getRecallantHttpConfig();
  if (
    cloudflareConfig.cloudflare.edge_auth_required !== true ||
    cloudflareConfig.cloudflare.admin_email_count !== 1
  ) {
    throw new Error(`Cloudflare config failed: ${JSON.stringify(cloudflareConfig)}`);
  }
  const bearerStillAuthorized = await fetch(`${baseUrl}/review`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (bearerStillAuthorized.status !== 200) {
    throw new Error(
      `Cloudflare mode blocked Recallant bearer API auth: ${bearerStillAuthorized.status}`
    );
  }
  const browserMissingEdgeAuth = await fetch(`${baseUrl}/review`);
  if (browserMissingEdgeAuth.status !== 401) {
    throw new Error(
      `Cloudflare mode allowed browser without edge auth: ${browserMissingEdgeAuth.status}`
    );
  }
  const wrongEdgeIdentity = await fetch(`${baseUrl}/review`, {
    headers: {
      "cf-access-authenticated-user-email": "intruder@example.invalid",
      "cf-access-jwt-assertion": "signed-by-cloudflare"
    }
  });
  if (wrongEdgeIdentity.status !== 401) {
    throw new Error(`Cloudflare mode allowed non-admin identity: ${wrongEdgeIdentity.status}`);
  }
  const edgeAuthorized = await fetch(`${baseUrl}/review`, {
    headers: {
      "cf-access-authenticated-user-email": "owner@example.invalid",
      "cf-access-jwt-assertion": "signed-by-cloudflare"
    }
  });
  if (edgeAuthorized.status !== 200) {
    throw new Error(`Cloudflare edge-auth browser session failed: ${edgeAuthorized.status}`);
  }
  const setCookie = edgeAuthorized.headers.get("set-cookie");
  if (!setCookie?.includes("recallant_session=") || !setCookie.includes("HttpOnly")) {
    throw new Error(`Cloudflare edge-auth did not issue a secure session cookie: ${setCookie}`);
  }
  const sessionAuthorized = await fetch(`${baseUrl}/api/review-dashboard`, {
    headers: { cookie: setCookie.split(";")[0] }
  });
  if (sessionAuthorized.status !== 200) {
    throw new Error(`Recallant session cookie auth failed: ${sessionAuthorized.status}`);
  }
} finally {
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;
  server.close();
  await emptyDocsDb.close();
  await sandboxDb.close();
  await db.close();
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      dashboard_posture_excerpt: dashboardPostureExcerpt,
      dashboard_canon_capability_excerpt: dashboardCanonCapabilityExcerpt,
      default_posture_excerpt: defaultPostureExcerpt,
      fallback_posture_excerpt: fallbackPostureExcerpt,
      empty_starter_docs_excerpt: emptyStarterDocsExcerpt,
      healthy_posture_excerpt: healthyPostureExcerpt,
      workbench_posture_excerpt: workbenchPostureExcerpt
    },
    null,
    2
  )}\n`
);
process.stdout.write("Review UI smoke passed\n");
