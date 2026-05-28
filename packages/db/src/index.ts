import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export const recallantDatabasePackage = "recallant-db";

export type RecallantDbConfig = {
  databaseUrl: string;
  developerId?: string;
  projectId?: string;
  projectPath?: string;
};

export type JsonObject = Record<string, unknown>;

export type StartSessionInput = {
  client_kind: string;
  client_version?: string | null;
  project_path?: string | null;
  session_label?: string | null;
  resume_policy?: string;
};

export type AppendTurnInput = {
  session_id?: string | null;
  client_kind: string;
  role: "user" | "assistant";
  text: string;
  occurred_at?: string | null;
  dedup_key?: string | null;
};

export type RawArtifactInput = {
  artifact_kind: string;
  storage_backend: string;
  uri?: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
  content_type?: string | null;
  excerpt?: string | null;
  metadata?: JsonObject;
};

export type AppendEventInput = {
  session_id?: string | null;
  client_kind: string;
  event_kind: string;
  text?: string | null;
  metadata?: JsonObject;
  raw_artifacts?: RawArtifactInput[];
  occurred_at?: string | null;
  dedup_key?: string | null;
};

export type ImportSourceInput = {
  client_kind?: string;
  project_path?: string | null;
  source_path: string;
  source_type: string;
  source_sha256: string;
  source_size_bytes?: number | null;
  content_type?: string | null;
  import_text: string;
  bounded_excerpt?: string | null;
  result_class: string;
  result_classes?: string[];
  scope_kind?: string | null;
  scope_id?: string | null;
  audience?: unknown[];
  risk?: string | null;
  risks?: JsonObject[];
  secret_references?: JsonObject[];
  metadata?: JsonObject;
  dedup_key?: string | null;
};

export type AgentMemorySourceRefInput = {
  source_kind: string;
  source_id: string;
  quote?: string | null;
  metadata?: JsonObject;
};

export type CreateAgentMemoryInput = {
  memory_type: string;
  scope: "project" | "developer";
  scope_kind?: string | null;
  scope_id?: string | null;
  audience?: unknown[];
  title: string;
  body: string;
  confidence?: number | null;
  source_refs?: AgentMemorySourceRefInput[];
  created_by: "agent" | "user" | "system" | "import";
  metadata?: JsonObject;
};

export type ReviewAgentMemoryInput = {
  memory_id: string;
  action: string;
  superseded_by?: string | null;
  merge_memory_ids?: string[];
  patch?: {
    title?: string | null;
    body?: string | null;
    scope?: "project" | "developer" | null;
    scope_kind?: string | null;
    scope_id?: string | null;
    audience?: unknown[];
    memory_type?: string | null;
  };
  note?: string | null;
  actor_kind: "user" | "agent" | "system";
};

export type ListAgentMemoriesInput = {
  view: string;
  project_id?: string | null;
  scope?: string | null;
  scope_kind?: string | null;
  audience_kind?: string | null;
  memory_domain?: string | null;
  status?: string | null;
  use_policy?: string | null;
  limit?: number;
};

export type RecallAgentMemoriesInput = {
  query: string;
  scope?: string;
  scope_kind?: string | null;
  audience_kind?: string | null;
  memory_types?: string[];
  include_candidates?: boolean;
  include_stale?: boolean;
  include_needs_review?: boolean;
  top_k?: number;
  max_chars_total?: number;
};

export type ReportRecallUsageInput = {
  trace_id: string;
  used_memory_ids?: string[];
  ignored_memory_ids?: string[];
  used_chunk_ids?: string[];
  note?: string | null;
};

export type LinkMemoryInput = {
  src_kind: string;
  src_id: string;
  dst_kind: string;
  dst_id: string;
  relation_type: string;
  weight?: number;
  metadata?: JsonObject;
};

export type ArchiveInput = {
  chunk_id: string;
  action: "archive" | "unarchive";
};

export type ContextPackInput = {
  session_id: string;
  task_hint?: string | null;
  project_id?: string | null;
  max_chars_total?: number;
  include_raw_evidence?: "auto" | "never" | "always";
  include_recovery?: boolean;
  local_spool_status?: JsonObject | null;
};

export type ForgetInput = {
  target: {
    kind: string;
    id?: string | null;
    selector?: JsonObject;
  };
  reason?: string | null;
  dry_run?: boolean;
  confirmation?: {
    confirmed?: boolean;
    confirmation_token?: string | null;
  };
};

export type ProjectSettingInput = {
  key: string;
  value: unknown;
  reason?: string | null;
  actor_kind?: "user" | "agent" | "system";
  actor_id?: string | null;
  confirmation?: {
    confirmed?: boolean;
  };
};

type ProjectContext = {
  developerId: string;
  projectId: string;
};

type CaptureProfile = "light" | "standard" | "detailed" | "custom";

type CapturePolicy = {
  profile: CaptureProfile;
  source: string;
  turnTextMaxChars: number;
  workflowTextMaxChars: number;
};

type EmbeddingRoute = {
  routeClass: "local_model" | "paid_api_provider";
  provider: string;
  model: string;
  dims: number;
  source: string;
  routingReason: string;
};

const capturePolicies: Record<CaptureProfile, Omit<CapturePolicy, "profile" | "source">> = {
  light: {
    turnTextMaxChars: 1_000,
    workflowTextMaxChars: 500
  },
  standard: {
    turnTextMaxChars: 12_000,
    workflowTextMaxChars: 2_000
  },
  detailed: {
    turnTextMaxChars: 50_000,
    workflowTextMaxChars: 8_000
  },
  custom: {
    turnTextMaxChars: 12_000,
    workflowTextMaxChars: 2_000
  }
};

function isCaptureProfile(value: unknown): value is CaptureProfile {
  return value === "light" || value === "standard" || value === "detailed" || value === "custom";
}

function readCaptureProfile(value: unknown) {
  if (isCaptureProfile(value)) return value;
  if (value && typeof value === "object" && "profile" in value) {
    const profile = (value as { profile?: unknown }).profile;
    if (isCaptureProfile(profile)) return profile;
  }
  return null;
}

function buildCapturePolicy(profile: CaptureProfile, source: string): CapturePolicy {
  return { profile, source, ...capturePolicies[profile] };
}

function readNumberSetting(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "minutes" in value) {
    const minutes = (value as { minutes?: unknown }).minutes;
    if (typeof minutes === "number" && Number.isFinite(minutes)) return minutes;
  }
  return null;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveFloatEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloatEnvInRange(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function assertMaxChars(kind: string, text: string | null | undefined, maxChars: number) {
  const length = text?.length ?? 0;
  if (length > maxChars) {
    throw new Error(
      `VALIDATION_ERROR: ${kind} exceeds configured limit (${length} > ${maxChars} chars)`
    );
  }
}

function readObjectSetting(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function vectorLiteral(values: readonly number[]) {
  return `[${values.map((value) => value.toFixed(6)).join(",")}]`;
}

function deterministicEmbedding(text: string, dims: number) {
  const values = Array.from({ length: dims }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [text.toLowerCase()];
  for (const token of tokens) {
    const normalizedToken =
      {
        connectivity: "network",
        delay: "latency",
        fruit: "banana",
        outage: "network",
        slow: "latency",
        slowness: "latency"
      }[token] ?? token;
    const hash = createHash("sha256").update(normalizedToken).digest();
    const index = hash.readUInt32BE(0) % dims;
    const sign = hash.readUInt32BE(4) % 2 === 0 ? 1 : -1;
    values[index] = (values[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function capText(text: string | null | undefined, maxChars: number) {
  if (text === null || text === undefined) return null;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function truncationMetadata(text: string | null | undefined, captured: string | null) {
  if (text === null || text === undefined || captured === null) {
    return { original_chars: text?.length ?? 0, captured_chars: 0, truncated: false };
  }
  return {
    original_chars: text.length,
    captured_chars: captured.length,
    truncated: captured.length < text.length
  };
}

function hasInstructionSignal(value: string) {
  return /\b(always|never|default|from now on|every project|all projects|instruction|rule)\b/i.test(
    value
  );
}

function hasHighRiskSignal(value: string) {
  return /\b(secret|security|deploy|public|paid api|cost|delete|destructive|provider|model)\b/i.test(
    value
  );
}

function importMemoryType(resultClasses: readonly string[]) {
  if (resultClasses.includes("secret_reference_names_only")) return "secret_reference";
  if (resultClasses.includes("handoff_checkpoint")) return "checkpoint_seed";
  if (resultClasses.includes("repo_contract") || resultClasses.includes("startup_instruction")) {
    return "repo_contract";
  }
  if (
    resultClasses.includes("environment_fact") ||
    resultClasses.includes("capability_binding") ||
    resultClasses.includes("connector_account_binding")
  ) {
    return "environment_fact";
  }
  return "import_candidate";
}

function importMemoryBody(input: ImportSourceInput, resultClasses: readonly string[]) {
  const riskSummary = input.risks?.length
    ? input.risks.map((risk) => `${risk.code}:${risk.severity}`).join(", ")
    : "none";
  const secretSummary = input.secret_references?.length
    ? ` Secret references: ${input.secret_references
        .map((ref) => String(ref.name ?? "unknown"))
        .join(", ")}. Values are redacted.`
    : "";
  return [
    `Imported source ${input.source_path} as ${resultClasses.join(", ")}.`,
    `Risk: ${input.risk ?? "low"} (${riskSummary}).`,
    secretSummary,
    "This imported record is reviewable evidence and must not become instruction_grade without explicit review promotion."
  ]
    .filter(Boolean)
    .join(" ");
}

function isDangerousSetting(key: string, value: unknown) {
  if (
    [
      "paid_api_mode",
      "subscription_worker",
      "model_router_profile",
      "embedding_route",
      "capture_profile",
      "context_budget_profile"
    ].includes(key)
  ) {
    return true;
  }
  return JSON.stringify(value).includes("auto_with_caps");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseIsoOrNow(value: string | null | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function retrievalDecay(occurredAt: string) {
  if (process.env.RECALLANT_DECAY_ENABLED === "false") return 1;
  const halflifeDays = readPositiveFloatEnv("RECALLANT_DECAY_HALFLIFE_DAYS", 365);
  const minDecay = readFloatEnvInRange("RECALLANT_DECAY_MIN", 0.15, 0, 1);
  const ageMs = Math.max(0, Date.now() - new Date(occurredAt).getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.max(minDecay, 0.5 ** (ageDays / halflifeDays));
}

function chunkText(text: string, maxChars = 4_000) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks.length > 0 ? chunks : [""];
}

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class RecallantDb {
  private readonly pool: Pool;
  private readonly fallbackDeveloperId = randomUUID();
  private projectContext?: ProjectContext;

  constructor(private readonly config: RecallantDbConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async close() {
    await this.pool.end();
  }

  async ensureProject(projectPath?: string | null): Promise<ProjectContext> {
    const developerId = this.config.developerId ?? this.fallbackDeveloperId;
    const primaryPath = projectPath ?? this.config.projectPath ?? process.cwd();
    if (
      this.projectContext &&
      this.projectContext.developerId === developerId &&
      (this.config.projectId || !projectPath || primaryPath === this.config.projectPath)
    ) {
      return this.projectContext;
    }
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );

      let projectId = this.config.projectId;
      const projectName = primaryPath.split("/").filter(Boolean).at(-1) ?? "recallant-project";
      if (!projectId) {
        const existing = await client.query<{ id: string }>(
          `
            SELECT p.id
            FROM projects p
            WHERE p.developer_id = $1
              AND p.primary_path IS NOT DISTINCT FROM $2
            ORDER BY (
              (SELECT count(*) FROM sessions s WHERE s.project_id = p.id) +
              (SELECT count(*) FROM events e WHERE e.project_id = p.id) +
              (SELECT count(*) FROM agent_memories m WHERE m.project_id = p.id)
            ) DESC,
            p.updated_at DESC
            LIMIT 1
          `,
          [developerId, primaryPath]
        );
        projectId = existing.rows[0]?.id ?? randomUUID();
      }
      await client.query(
        `
          INSERT INTO projects (id, developer_id, name, primary_path)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET primary_path = coalesce(EXCLUDED.primary_path, projects.primary_path),
              updated_at = now()
        `,
        [projectId, developerId, projectName, primaryPath]
      );
      await this.ensureDefaultModelSettings(client);

      const context = { developerId, projectId };
      if (this.config.projectId || !projectPath || primaryPath === this.config.projectPath) {
        this.projectContext = context;
      }
      return context;
    });
  }

  async registerProject(input: {
    projectId: string;
    developerId?: string;
    projectPath: string;
    name?: string;
    captureProfile?: CaptureProfile;
  }) {
    const developerId = input.developerId ?? this.config.developerId ?? this.fallbackDeveloperId;
    const projectName =
      input.name ?? input.projectPath.split("/").filter(Boolean).at(-1) ?? "recallant-project";
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );
      await client.query(
        `
          INSERT INTO projects (id, developer_id, name, primary_path)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              primary_path = EXCLUDED.primary_path,
              updated_at = now()
        `,
        [input.projectId, developerId, projectName, input.projectPath]
      );
      await this.ensureDefaultModelSettings(client);
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, 'capture_profile', $2, 'recallant init', 'recallant-cli')
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
        `,
        [input.projectId, JSON.stringify(input.captureProfile ?? "standard")]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, 'capture_profile', NULL, $2, 'system', 'recallant-cli', 'recallant init')
        `,
        [input.projectId, JSON.stringify(input.captureProfile ?? "standard")]
      );
    });
    return { developerId, projectId: input.projectId };
  }

  async startSession(input: StartSessionInput) {
    const project = await this.ensureProject(input.project_path);
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query(
        `
          SELECT id, last_seen_at, extract(epoch from (now() - last_seen_at)) / 60 AS age_minutes
          FROM sessions
          WHERE project_id = $1 AND status = 'active' AND ended_at IS NULL
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        [project.projectId]
      );
      const previousSession = previous.rows[0];
      const staleThresholdMinutes = await this.resolveStaleSessionThreshold(
        client,
        project.projectId,
        project.developerId
      );
      const ageMinutes = Number(previousSession?.age_minutes ?? 0);
      const previousIsStale = previousSession ? ageMinutes >= staleThresholdMinutes : false;
      if (previousSession) {
        if (previousIsStale) {
          await client.query(
            `
              UPDATE sessions
              SET status = 'interrupted', ended_reason = 'crash_or_unknown', last_seen_at = now()
              WHERE id = $1
            `,
            [previousSession.id]
          );
        }
      }

      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO sessions (project_id, client_kind, client_version, recovered_from_session_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          project.projectId,
          input.client_kind,
          input.client_version ?? null,
          previousSession?.id ?? null
        ]
      );

      const checkpoint = await client.query(
        "SELECT payload, updated_at FROM checkpoints WHERE project_id = $1",
        [project.projectId]
      );

      return {
        session_id: inserted.rows[0]?.id,
        project_id: project.projectId,
        checkpoint: checkpoint.rows[0] ?? { payload: null, updated_at: null },
        previous_unclosed_session: previousSession
          ? {
              session_id: previousSession.id,
              last_seen_at: previousSession.last_seen_at,
              last_event_id: await this.findLastEventId(client, previousSession.id),
              recovery_status: "needs_review",
              is_stale: previousIsStale,
              age_minutes: ageMinutes,
              stale_after_minutes: staleThresholdMinutes
            }
          : null,
        recommended_next_calls: ["memory_get_context_pack"]
      };
    });
  }

  async heartbeat(sessionId: string, status: string, note?: string | null, metadata?: JsonObject) {
    const boundedMetadata = { ...(metadata ?? {}), note: note ?? undefined };
    const result = await this.pool.query(
      `
        UPDATE sessions
        SET last_seen_at = now(),
            last_heartbeat_at = now(),
            heartbeat_status = $2,
            heartbeat_metadata = $3
        WHERE id = $1
        RETURNING id, last_seen_at, last_heartbeat_at
      `,
      [sessionId, status, JSON.stringify(boundedMetadata)]
    );
    return result.rows[0];
  }

  async appendTurn(input: AppendTurnInput) {
    assertMaxChars(
      "memory_append_turn.text",
      input.text,
      readPositiveIntEnv("RECALLANT_APPEND_TURN_MAX_CHARS", 200_000)
    );
    const context = await this.contextForSession(input.session_id);
    return withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      const existing = await this.findDedup(client, context.projectId, input.dedup_key);
      if (existing) return { event_id: existing, status: "duplicate" };

      const policy = await this.resolveCapturePolicy(
        client,
        context.projectId,
        context.developerId,
        input.session_id
      );
      const capturedText = capText(input.text, policy.turnTextMaxChars) ?? "";
      const payload = {
        schema_version: 1,
        text: capturedText,
        attachments: [],
        raw_artifacts: [],
        capture: {
          profile: policy.profile,
          source: policy.source,
          ...truncationMetadata(input.text, capturedText)
        }
      };
      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        ingestSource: "mcp_append",
        kind: input.role === "user" ? "turn_user" : "turn_assistant",
        occurredAt: parseIsoOrNow(input.occurred_at),
        payload
      });
      await this.insertDedup(client, context.projectId, input.dedup_key, event.id);

      const chunkIds = await this.insertChunks(client, {
        projectId: context.projectId,
        developerId: context.developerId,
        eventId: event.id,
        text: capturedText
      });
      const embeddingResult = await this.embedChunks(client, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        chunkIds,
        texts: chunkText(capturedText)
      });
      return {
        event_id: event.id,
        chunk_ids: chunkIds,
        status: "created",
        capture_profile: policy.profile,
        captured_text_chars: capturedText.length,
        embedding: embeddingResult
      };
    });
  }

  async search(input: {
    query: string;
    mode?: string;
    top_k?: number;
    max_chars_total?: number;
    session_id?: string | null;
    scope?: string;
    scope_kind?: string | null;
    audience?: string | null;
    graph_expand?: boolean;
    graph_budget_nodes?: number;
    include_archived?: boolean;
  }) {
    const context = input.session_id
      ? await this.contextForSession(input.session_id)
      : await this.ensureProject();
    const route = await this.resolveEmbeddingRoute(
      this.pool,
      context.projectId,
      context.developerId
    );
    const mode = input.mode ?? "hybrid";
    const topK = input.top_k ?? 8;
    const candidateLimit = Math.max(topK * 2, 8);
    const filter = this.buildSearchFilter({
      projectId: context.projectId,
      developerId: context.developerId,
      scope: input.scope ?? "project",
      scopeKind: input.scope_kind ?? null,
      audience: input.audience ?? null,
      includeArchived: input.include_archived === true,
      startIndex: 2
    });
    const candidates = new Map<
      string,
      {
        id: string;
        text: string;
        source_event_id: string;
        occurred_at: string;
        vectorScore: number;
        lexicalScore: number;
        paths: Set<string>;
      }
    >();

    if ((mode === "hybrid" || mode === "vector_only") && route.provider === "deterministic") {
      const queryVector = deterministicEmbedding(input.query, route.dims);
      await this.recordModelCall(this.pool, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        route,
        purpose: "query_embedding",
        status: "success",
        metadata: { text_count: 1 }
      });
      const vectorRows = await this.pool.query<{
        id: string;
        text: string;
        source_event_id: string;
        occurred_at: string;
        distance: number;
      }>(
        `
          SELECT c.id, c.text, c.source_event_id, ev.occurred_at, e.vector <=> $1::vector AS distance
          FROM chunks c
          JOIN events ev ON ev.id = c.source_event_id
          JOIN embeddings e ON e.chunk_id = c.id
          WHERE ${filter.whereSql}
          ORDER BY e.vector <=> $1::vector
          LIMIT $${filter.params.length + 2}::int
        `,
        [vectorLiteral(queryVector), ...filter.params, candidateLimit]
      );
      for (const row of vectorRows.rows) {
        candidates.set(row.id, {
          id: row.id,
          text: row.text,
          source_event_id: row.source_event_id,
          occurred_at: row.occurred_at,
          vectorScore: Math.max(0, 1 - Number(row.distance)),
          lexicalScore: 0,
          paths: new Set(["vector"])
        });
      }
    }

    if (mode === "hybrid" || mode === "lexical_only" || candidates.size === 0) {
      const lexicalRows = await this.pool.query<{
        id: string;
        text: string;
        source_event_id: string;
        occurred_at: string;
        rank: number;
      }>(
        `
          SELECT c.id, c.text, c.source_event_id, ev.occurred_at,
                 ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS rank
          FROM chunks c
          JOIN events ev ON ev.id = c.source_event_id
          WHERE ${filter.whereSql}
            AND c.tsv @@ plainto_tsquery('simple', $1)
          ORDER BY rank DESC, c.created_at DESC
          LIMIT $${filter.params.length + 2}::int
        `,
        [input.query, ...filter.params, candidateLimit]
      );
      for (const row of lexicalRows.rows) {
        const existing = candidates.get(row.id);
        if (existing) {
          existing.lexicalScore = Number(row.rank);
          existing.paths.add("lexical");
        } else {
          candidates.set(row.id, {
            id: row.id,
            text: row.text,
            source_event_id: row.source_event_id,
            occurred_at: row.occurred_at,
            vectorScore: 0,
            lexicalScore: Number(row.rank),
            paths: new Set(["lexical"])
          });
        }
      }
    }

    const rows = Array.from(candidates.values())
      .map((candidate) => ({
        id: candidate.id,
        text: candidate.text,
        source_event_id: candidate.source_event_id,
        occurred_at: candidate.occurred_at,
        score:
          (candidate.vectorScore * 0.65 + candidate.lexicalScore * 0.35) *
          retrievalDecay(candidate.occurred_at),
        path: Array.from(candidate.paths).join("+"),
        superseded_by: null as string | null
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);

    if (rows.length > 0) {
      const superseded = await this.pool.query<{ dst_id: string; src_id: string }>(
        `
          SELECT dst_id, src_id
          FROM edges
          WHERE project_id = $1
            AND relation_type = 'supersedes'
            AND src_kind = 'chunk'
            AND dst_kind = 'chunk'
            AND dst_id = ANY($2::text[])
        `,
        [context.projectId, rows.map((row) => row.id)]
      );
      const supersededBy = new Map(superseded.rows.map((row) => [row.dst_id, row.src_id]));
      const penalty = readFloatEnvInRange("RECALLANT_SUPERSEDES_SCORE_MULTIPLIER", 0.2, 0, 1);
      for (const row of rows) {
        const replacement = supersededBy.get(row.id);
        if (replacement) {
          row.score *= penalty;
          row.path = `${row.path}+superseded`;
          row.superseded_by = replacement;
        }
      }
      rows.sort((left, right) => right.score - left.score);
    }

    if (input.graph_expand && rows.length > 0) {
      const graphRows = await this.expandGraphRows({
        projectId: context.projectId,
        seedChunkIds: rows.map((row) => row.id),
        budget: input.graph_budget_nodes ?? 8,
        existingChunkIds: new Set(rows.map((row) => row.id))
      });
      rows.push(...graphRows);
      rows.sort((left, right) => right.score - left.score);
    }

    let usedChars = 0;
    const maxChars = input.max_chars_total ?? 12_000;
    const hits = [];
    for (const row of rows) {
      if (usedChars >= maxChars) break;
      const remaining = maxChars - usedChars;
      const excerpt = row.text.slice(0, remaining);
      usedChars += excerpt.length;
      hits.push({
        chunk_id: row.id,
        source_event_id: row.source_event_id,
        score: row.score,
        path: row.path,
        why: row.path,
        superseded_by: row.superseded_by,
        occurred_at: row.occurred_at,
        text_excerpt: excerpt,
        excerpt
      });
    }
    if (hits.length > 0) {
      await this.pool.query(
        `
          UPDATE chunks
          SET last_accessed_at = now(), access_count = access_count + 1
          WHERE id = ANY($1::uuid[])
        `,
        [hits.map((hit) => hit.chunk_id)]
      );
    }
    return {
      hits,
      truncated: rows.length > hits.length,
      route: { provider: route.provider, model: route.model, dims: route.dims }
    };
  }

  async fetchChunk(chunkId: string, maxChars = 16_000) {
    const result = await this.pool.query(
      `
        UPDATE chunks
        SET last_accessed_at = now(), access_count = access_count + 1
        WHERE id = $1
        RETURNING id AS chunk_id, text, source_event_id, scope, scope_kind, scope_id, audience,
                  embed_status, embed_model, archived_at, created_at
      `,
      [chunkId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown chunk_id: ${chunkId}`);
    return {
      ...row,
      text: String(row.text ?? "").slice(0, maxChars),
      truncated: String(row.text ?? "").length > maxChars
    };
  }

  async archiveChunk(input: ArchiveInput) {
    const result = await this.pool.query<{ id: string; archived_at: string | null }>(
      `
        UPDATE chunks
        SET archived_at = CASE WHEN $2 = 'archive' THEN now() ELSE NULL END
        WHERE id = $1
        RETURNING id, archived_at
      `,
      [input.chunk_id, input.action]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`VALIDATION_ERROR: unknown chunk_id ${input.chunk_id}`);
    return {
      ok: true,
      chunk_id: row.id,
      action: input.action,
      archived_at: row.archived_at
    };
  }

  async linkMemory(input: LinkMemoryInput) {
    const context = await this.ensureProject();
    const result = await this.pool.query<{ id: string }>(
      `
        INSERT INTO edges (project_id, src_kind, src_id, dst_kind, dst_id, relation_type, weight, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        context.projectId,
        input.src_kind,
        input.src_id,
        input.dst_kind,
        input.dst_id,
        input.relation_type,
        input.weight ?? 1,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return { edge_id: result.rows[0]?.id };
  }

  async getContextPack(input: ContextPackInput) {
    const context = await this.contextForSession(input.session_id);
    const checkpoint = await this.getCheckpoint(context.projectId);
    const recovery = await this.pool.query(
      `
        SELECT id AS session_id, last_seen_at, status
        FROM sessions
        WHERE project_id = $1 AND status = 'interrupted'
        ORDER BY last_seen_at DESC
        LIMIT 3
      `,
      [context.projectId]
    );
    const rules = await this.pool.query(
      `
        SELECT id AS memory_id, title, body, scope, scope_kind, scope_id, use_policy
        FROM agent_memories
        WHERE developer_id = $1 AND (project_id = $2 OR scope = 'developer')
          AND status = 'accepted' AND use_policy = 'instruction_grade'
        ORDER BY updated_at DESC
        LIMIT 8
      `,
      [context.developerId, context.projectId]
    );
    const working =
      input.task_hint && input.task_hint.trim()
        ? await this.recallAgentMemories({
            query: input.task_hint,
            top_k: 8,
            max_chars_total: Math.floor((input.max_chars_total ?? 12_000) / 2)
          })
        : { memories: [], trace_id: null };
    const evidence =
      input.include_raw_evidence === "always" && input.task_hint
        ? await this.search({
            session_id: input.session_id,
            query: input.task_hint,
            mode: "hybrid",
            top_k: 4,
            max_chars_total: Math.floor((input.max_chars_total ?? 12_000) / 3)
          })
        : { hits: [] };
    return {
      context_pack_id: randomUUID(),
      project_id: context.projectId,
      session_id: input.session_id,
      profile: "compact",
      sections: {
        checkpoint,
        recovery: input.include_recovery === false ? [] : recovery.rows,
        binding_rules: rules.rows,
        working_memories: working.memories,
        operational_bindings: [],
        local_spool_status: input.local_spool_status ?? { status: "unknown" },
        evidence_excerpts: evidence.hits,
        suggested_next_fetches: []
      },
      trace_id: "trace_id" in working ? working.trace_id : null,
      truncated: false,
      budget: { max_chars_total: input.max_chars_total ?? 12_000 }
    };
  }

  async forget(input: ForgetInput) {
    const targetId = input.target.id;
    if (!targetId) throw new Error("VALIDATION_ERROR: forget target id is required");
    const affected = await this.countForgetTarget(input.target.kind, targetId);
    if (input.dry_run !== false || input.confirmation?.confirmed !== true) {
      return {
        erasure_id: randomUUID(),
        status: "pending_confirmation",
        requires_confirmation: true,
        affected,
        warnings: ["Dry run only. No Recallant-controlled content was erased."],
        redacted_receipt: {}
      };
    }
    const erasureId = randomUUID();
    await withTransaction(this.pool, async (client) => {
      if (input.target.kind === "chunk") {
        await client.query("DELETE FROM embeddings WHERE chunk_id = $1", [targetId]);
        await client.query(
          "UPDATE chunks SET text = '[REDACTED]', archived_at = now() WHERE id = $1",
          [targetId]
        );
      } else if (input.target.kind === "event") {
        await client.query(
          "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE source_event_id = $1)",
          [targetId]
        );
        await client.query(
          "UPDATE chunks SET text = '[REDACTED]', archived_at = now() WHERE source_event_id = $1",
          [targetId]
        );
        await client.query("UPDATE events SET payload = $2 WHERE id = $1", [
          targetId,
          JSON.stringify({ redacted: true, erasure_id: erasureId })
        ]);
      } else if (input.target.kind === "agent_memory") {
        await client.query(
          "UPDATE agent_memories SET title = '[REDACTED]', body = '[REDACTED]', status = 'archived', use_policy = 'do_not_use' WHERE id = $1",
          [targetId]
        );
        await client.query(
          "UPDATE agent_memory_source_refs SET quote = NULL WHERE memory_id = $1",
          [targetId]
        );
      }
      await client.query(
        `
          INSERT INTO erasure_requests (
            id, developer_id, project_id, requested_by, request_source, target_selector,
            reason, status, requires_confirmation, confirmed_by, confirmed_at, executed_at, redacted_receipt
          )
          VALUES ($1, coalesce((SELECT developer_id FROM projects LIMIT 1), gen_random_uuid()), NULL,
                  'owner', 'mcp', $2, $3, 'completed', true, 'owner', now(), now(), $4)
        `,
        [
          erasureId,
          JSON.stringify({ kind: input.target.kind, id: targetId }),
          input.reason ?? null,
          JSON.stringify({ affected, content_redacted: true })
        ]
      );
    });
    return {
      erasure_id: erasureId,
      status: "completed",
      requires_confirmation: false,
      affected,
      warnings: [],
      redacted_receipt: { affected, content_redacted: true }
    };
  }

  async appendEvent(input: AppendEventInput) {
    assertMaxChars(
      "memory_append_event.text",
      input.text,
      readPositiveIntEnv("RECALLANT_APPEND_EVENT_TEXT_MAX_CHARS", 100_000)
    );
    const artifactExcerptMaxChars = readPositiveIntEnv(
      "RECALLANT_RAW_ARTIFACT_EXCERPT_MAX_CHARS",
      16_000
    );
    for (const [index, artifact] of (input.raw_artifacts ?? []).entries()) {
      assertMaxChars(
        `memory_append_event.raw_artifacts[${index}].excerpt`,
        artifact.excerpt,
        artifactExcerptMaxChars
      );
    }
    const context = await this.contextForSession(input.session_id);
    return withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      const existing = await this.findDedup(client, context.projectId, input.dedup_key);
      if (existing) return { event_id: existing, raw_artifact_ids: [], status: "duplicate" };

      const policy = await this.resolveCapturePolicy(
        client,
        context.projectId,
        context.developerId,
        input.session_id
      );
      const capturedText = capText(input.text, policy.workflowTextMaxChars);
      const payload = {
        schema_version: 1,
        text: capturedText,
        metadata: input.metadata ?? {},
        raw_artifacts: [],
        capture: {
          profile: policy.profile,
          source: policy.source,
          ...truncationMetadata(input.text, capturedText)
        }
      };
      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        ingestSource: "mcp_append",
        kind: input.event_kind,
        occurredAt: parseIsoOrNow(input.occurred_at),
        payload
      });

      const rawArtifactIds = [];
      for (const artifact of input.raw_artifacts ?? []) {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO raw_artifacts (
              project_id, session_id, source_event_id, artifact_kind, storage_backend,
              uri, sha256, size_bytes, content_type, excerpt, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
          `,
          [
            context.projectId,
            input.session_id ?? null,
            event.id,
            artifact.artifact_kind,
            artifact.storage_backend,
            artifact.uri ?? "",
            artifact.sha256 ?? null,
            artifact.size_bytes ?? null,
            artifact.content_type ?? null,
            artifact.excerpt ?? null,
            JSON.stringify(artifact.metadata ?? {})
          ]
        );
        rawArtifactIds.push(inserted.rows[0]?.id);
      }

      await client.query("UPDATE events SET payload = payload || $2::jsonb WHERE id = $1", [
        event.id,
        JSON.stringify({ raw_artifact_ids: rawArtifactIds })
      ]);
      await this.insertDedup(client, context.projectId, input.dedup_key, event.id);

      return {
        event_id: event.id,
        raw_artifact_ids: rawArtifactIds,
        status: "created",
        capture_profile: policy.profile,
        captured_text_chars: capturedText?.length ?? 0
      };
    });
  }

  async importSource(input: ImportSourceInput) {
    assertMaxChars(
      "recallant_import.import_text",
      input.import_text,
      readPositiveIntEnv("RECALLANT_IMPORT_TEXT_MAX_CHARS", 250_000)
    );
    const context = await this.ensureProject(input.project_path);
    const resultClasses = input.result_classes?.length
      ? input.result_classes
      : [input.result_class];
    const dedupKey =
      input.dedup_key ??
      `import:${input.source_path}:${input.source_sha256}:${resultClasses.sort().join(",")}`;
    return withTransaction(this.pool, async (client) => {
      const existing = await this.findDedup(client, context.projectId, dedupKey);
      if (existing) {
        const counts = await client.query<{
          chunk_count: number;
          raw_artifact_count: number;
          memory_ids: string[];
        }>(
          `
            SELECT
              (SELECT count(*)::int FROM chunks WHERE source_event_id = $1) AS chunk_count,
              (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS raw_artifact_count,
              coalesce(
                (SELECT array_agg(id::text)
                 FROM agent_memories
                 WHERE metadata->>'import_dedup_key' = $2),
                ARRAY[]::text[]
              ) AS memory_ids
          `,
          [existing, dedupKey]
        );
        const row = counts.rows[0];
        return {
          status: "duplicate",
          event_id: existing,
          chunk_count: row?.chunk_count ?? 0,
          raw_artifact_count: row?.raw_artifact_count ?? 0,
          memory_ids: row?.memory_ids ?? [],
          dedup_key: dedupKey
        };
      }

      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: null,
        ingestSource: "cli_import",
        kind: "import_batch",
        occurredAt: new Date(),
        payload: {
          schema_version: 1,
          source_ref: {
            path: input.source_path,
            sha256: input.source_sha256,
            size_bytes: input.source_size_bytes ?? null,
            content_type: input.content_type ?? null
          },
          source_type: input.source_type,
          result_class: input.result_class,
          result_classes: resultClasses,
          scope_kind: input.scope_kind ?? "project",
          scope_id: input.scope_id ?? null,
          audience: input.audience ?? [{ kind: "all_agents", id: null }],
          risk: input.risk ?? "low",
          risks: input.risks ?? [],
          secret_references: input.secret_references ?? [],
          text_excerpt: input.bounded_excerpt ?? input.import_text.slice(0, 500),
          metadata: input.metadata ?? {}
        }
      });
      await this.insertDedup(client, context.projectId, dedupKey, event.id);

      const rawArtifact = await client.query<{ id: string }>(
        `
          INSERT INTO raw_artifacts (
            project_id, session_id, source_event_id, artifact_kind, storage_backend,
            uri, sha256, size_bytes, content_type, excerpt, metadata
          )
          VALUES ($1, NULL, $2, 'transcript_export', 'postgres_inline', $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        [
          context.projectId,
          event.id,
          `import://${input.source_path}`,
          input.source_sha256,
          input.source_size_bytes ?? null,
          input.content_type ?? "text/markdown",
          input.bounded_excerpt ?? input.import_text.slice(0, 500),
          JSON.stringify({
            source_type: input.source_type,
            result_classes: resultClasses,
            secret_policy: "secret values redacted before import"
          })
        ]
      );
      const rawArtifactId = rawArtifact.rows[0]?.id;

      const audience = input.audience ?? [{ kind: "all_agents", id: null }];
      const scopeKind = input.scope_kind ?? "project";
      const chunkIds = await this.insertChunks(client, {
        projectId: context.projectId,
        developerId: context.developerId,
        eventId: event.id,
        text: input.import_text,
        scope: "project",
        scopeKind,
        scopeId:
          input.scope_id ?? (scopeKind === "project" ? context.projectId : input.source_path),
        audience
      });
      const embedding = await this.embedChunks(client, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: null,
        chunkIds,
        texts: chunkText(input.import_text)
      });

      const isHighRisk =
        input.risk === "high" ||
        (input.risks ?? []).some((risk) => risk.severity === "high") ||
        resultClasses.some((resultClass) =>
          [
            "secret_reference_names_only",
            "capability_binding",
            "connector_account_binding",
            "possible_conflict"
          ].includes(resultClass)
        );
      const memory = await client.query<{ id: string; status: string; use_policy: string }>(
        `
          INSERT INTO agent_memories (
            developer_id, project_id, scope, scope_kind, scope_id, audience,
            memory_type, title, body, status, use_policy, confidence, created_by, metadata
          )
          VALUES ($1, $2, 'project', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'import', $12)
          RETURNING id, status, use_policy
        `,
        [
          context.developerId,
          context.projectId,
          scopeKind,
          input.scope_id ?? (scopeKind === "project" ? context.projectId : input.source_path),
          JSON.stringify(audience),
          importMemoryType(resultClasses),
          `Imported ${input.source_path}`,
          importMemoryBody(input, resultClasses),
          isHighRisk ? "needs_review" : "candidate",
          isHighRisk ? "evidence_only" : "recall_allowed",
          isHighRisk ? 0.6 : 0.75,
          JSON.stringify({
            import_dedup_key: dedupKey,
            import_event_id: event.id,
            raw_artifact_id: rawArtifactId ?? null,
            result_class: input.result_class,
            result_classes: resultClasses,
            risk: input.risk ?? "low",
            risks: input.risks ?? [],
            policy_reason: isHighRisk
              ? "import_high_risk_review_required"
              : "import_candidate_review_required"
          })
        ]
      );
      const memoryId = memory.rows[0]?.id;
      if (!memoryId) throw new Error("Failed to create import candidate memory");
      await client.query(
        `
          INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
          VALUES ($1, 'event', $2, $3, $4)
        `,
        [
          memoryId,
          event.id,
          input.bounded_excerpt ?? input.import_text.slice(0, 500),
          JSON.stringify({
            source_path: input.source_path,
            source_sha256: input.source_sha256,
            raw_artifact_id: rawArtifactId ?? null
          })
        ]
      );

      return {
        status: "created",
        event_id: event.id,
        raw_artifact_ids: rawArtifactId ? [rawArtifactId] : [],
        chunk_ids: chunkIds,
        memory_ids: [memoryId],
        memory_status: memory.rows[0]?.status,
        memory_use_policy: memory.rows[0]?.use_policy,
        embedding,
        dedup_key: dedupKey
      };
    });
  }

  async createAgentMemory(input: CreateAgentMemoryInput) {
    if (input.created_by === "agent" && (input.source_refs?.length ?? 0) === 0) {
      throw new Error("VALIDATION_ERROR: agent-created memories require source_refs");
    }
    const context = await this.ensureProject();
    return withTransaction(this.pool, async (client) => {
      const policy = this.classifyAgentMemory(input);
      const result = await client.query<{ id: string; status: string; use_policy: string }>(
        `
          INSERT INTO agent_memories (
            developer_id, project_id, scope, scope_kind, scope_id, audience,
            memory_type, title, body, status, use_policy, confidence, created_by, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id, status, use_policy
        `,
        [
          context.developerId,
          input.scope === "project" ? context.projectId : null,
          input.scope,
          input.scope_kind ?? input.scope,
          input.scope_id ?? (input.scope === "project" ? context.projectId : context.developerId),
          JSON.stringify(input.audience ?? [{ kind: "all_agents", id: null }]),
          input.memory_type,
          input.title,
          input.body,
          policy.status,
          policy.usePolicy,
          input.confidence ?? null,
          input.created_by,
          JSON.stringify({ ...(input.metadata ?? {}), policy_reason: policy.reason })
        ]
      );
      const memoryId = result.rows[0]?.id;
      if (!memoryId) throw new Error("Failed to create agent memory");
      for (const ref of input.source_refs ?? []) {
        await client.query(
          `
            INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            memoryId,
            ref.source_kind,
            ref.source_id,
            ref.quote ?? null,
            JSON.stringify(ref.metadata ?? {})
          ]
        );
      }
      return {
        memory_id: memoryId,
        status: result.rows[0]?.status,
        use_policy: result.rows[0]?.use_policy,
        review_reason: policy.reason
      };
    });
  }

  async reviewAgentMemory(input: ReviewAgentMemoryInput) {
    return withTransaction(this.pool, async (client) => {
      const before = await client.query("SELECT * FROM agent_memories WHERE id = $1", [
        input.memory_id
      ]);
      const previous = before.rows[0];
      if (!previous) throw new Error(`Unknown memory_id: ${input.memory_id}`);

      const action = input.action === "approve" ? "accept" : input.action;
      const updates: string[] = ["updated_at = now()"];
      const values: unknown[] = [input.memory_id];
      const set = (sql: string, value: unknown) => {
        values.push(value);
        updates.push(`${sql} = $${values.length}`);
      };

      if (action === "accept") {
        set("status", "accepted");
        set("use_policy", "recall_allowed");
        set("accepted_by", input.actor_kind);
      } else if (action === "reject") {
        set("status", "rejected");
        set("use_policy", "do_not_use");
        set("rejected_by", input.actor_kind);
      } else if (action === "archive") {
        set("status", "archived");
      } else if (action === "unarchive") {
        set("status", "accepted");
      } else if (action === "mark_stale") {
        set("status", "stale");
        set("use_policy", "evidence_only");
      } else if (action === "promote_instruction") {
        set("status", "accepted");
        set("use_policy", "instruction_grade");
        set("accepted_by", input.actor_kind);
      } else if (action === "demote_instruction") {
        set("use_policy", "recall_allowed");
      } else if (action === "supersede") {
        set("status", "superseded");
        set("superseded_by", input.superseded_by ?? null);
      } else if (action === "edit") {
        if (input.patch?.title !== undefined) set("title", input.patch.title);
        if (input.patch?.body !== undefined) set("body", input.patch.body);
        if (input.patch?.scope !== undefined) set("scope", input.patch.scope);
        if (input.patch?.scope_kind !== undefined) set("scope_kind", input.patch.scope_kind);
        if (input.patch?.scope_id !== undefined) set("scope_id", input.patch.scope_id);
        if (input.patch?.audience !== undefined)
          set("audience", JSON.stringify(input.patch.audience));
        if (input.patch?.memory_type !== undefined) set("memory_type", input.patch.memory_type);
      } else if (action === "merge") {
        for (const mergeId of input.merge_memory_ids ?? []) {
          await client.query(
            `
              UPDATE agent_memories
              SET status = 'superseded', superseded_by = $1, updated_at = now()
              WHERE id = $2
            `,
            [input.memory_id, mergeId]
          );
        }
      }

      set("review_reason", input.note ?? action);
      await client.query(`UPDATE agent_memories SET ${updates.join(", ")} WHERE id = $1`, values);
      await client.query(
        `
          INSERT INTO agent_memory_review_actions (memory_id, action, actor_kind, note, metadata)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          input.memory_id,
          action,
          input.actor_kind,
          input.note ?? null,
          JSON.stringify({
            previous,
            patch: input.patch ?? {},
            merge_memory_ids: input.merge_memory_ids ?? []
          })
        ]
      );
      const after = await client.query<{ status: string; use_policy: string }>(
        "SELECT status, use_policy FROM agent_memories WHERE id = $1",
        [input.memory_id]
      );
      return { ok: true, memory_id: input.memory_id, ...after.rows[0] };
    });
  }

  async listAgentMemories(input: ListAgentMemoriesInput) {
    const context = await this.ensureProject();
    const values: unknown[] = [input.project_id ?? context.projectId, context.developerId];
    const clauses = ["developer_id = $2::uuid"];
    if (input.view !== "all") clauses.push("(project_id = $1::uuid OR scope = 'developer')");
    if (input.view === "inbox") {
      clauses.push(
        "(status IN ('candidate', 'needs_review') OR metadata->>'policy_reason' LIKE '%high_risk%')"
      );
    } else if (input.view === "rules") {
      clauses.push("status = 'accepted' AND use_policy = 'instruction_grade'");
    } else if (input.view === "candidates") {
      clauses.push("status IN ('candidate', 'needs_review')");
    } else if (input.status) {
      values.push(input.status);
      clauses.push(`status = $${values.length}`);
    }
    if (input.use_policy) {
      values.push(input.use_policy);
      clauses.push(`use_policy = $${values.length}`);
    }
    if (input.scope) {
      values.push(input.scope);
      clauses.push(`scope = $${values.length}`);
    }
    if (input.scope_kind) {
      values.push(input.scope_kind);
      clauses.push(`scope_kind = $${values.length}`);
    }
    values.push(input.limit ?? 50);
    const result = await this.pool.query(
      `
        SELECT id AS memory_id, memory_type, title, body, status, use_policy, scope, scope_kind,
               scope_id, audience, confidence, created_by, updated_at
        FROM agent_memories
        WHERE ${clauses.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT $${values.length}::int
      `,
      values
    );
    return { memories: result.rows };
  }

  async getAgentMemory(memoryId: string) {
    const memory = await this.pool.query("SELECT * FROM agent_memories WHERE id = $1", [memoryId]);
    const sourceRefs = await this.pool.query(
      "SELECT * FROM agent_memory_source_refs WHERE memory_id = $1 ORDER BY created_at ASC",
      [memoryId]
    );
    const reviewActions = await this.pool.query(
      "SELECT * FROM agent_memory_review_actions WHERE memory_id = $1 ORDER BY created_at DESC",
      [memoryId]
    );
    return {
      memory: memory.rows[0] ?? null,
      source_refs: sourceRefs.rows,
      review_actions: reviewActions.rows,
      related_memories: []
    };
  }

  async recallAgentMemories(input: RecallAgentMemoriesInput) {
    const context = await this.ensureProject();
    const statuses = ["accepted"];
    if (input.include_candidates) statuses.push("candidate");
    if (input.include_needs_review) statuses.push("needs_review");
    if (input.include_stale) statuses.push("stale");
    const values: unknown[] = [context.developerId, context.projectId, input.query, statuses];
    const clauses = [
      "developer_id = $1::uuid",
      "(project_id = $2::uuid OR scope = 'developer')",
      "status = ANY($4::text[])",
      "use_policy <> 'do_not_use'",
      "(title ILIKE '%' || $3 || '%' OR body ILIKE '%' || $3 || '%' OR memory_type ILIKE '%' || $3 || '%')"
    ];
    if (!input.include_candidates) clauses.push("status <> 'candidate'");
    if (!input.include_needs_review) clauses.push("status <> 'needs_review'");
    if (!input.include_stale) clauses.push("status <> 'stale'");
    if (input.memory_types && input.memory_types.length > 0) {
      values.push(input.memory_types);
      clauses.push(`memory_type = ANY($${values.length}::text[])`);
    }
    if (input.scope_kind) {
      values.push(input.scope_kind);
      clauses.push(`scope_kind = $${values.length}`);
    }
    const result = await this.pool.query(
      `
        SELECT id AS memory_id, memory_type, title, body, status, use_policy, scope, scope_kind,
               scope_id, audience, confidence, updated_at
        FROM agent_memories
        WHERE ${clauses.join(" AND ")}
        ORDER BY
          CASE use_policy WHEN 'instruction_grade' THEN 0 WHEN 'recall_allowed' THEN 1 ELSE 2 END,
          updated_at DESC
        LIMIT $${values.length + 1}::int
      `,
      [...values, input.top_k ?? 8]
    );
    let usedChars = 0;
    const maxChars = input.max_chars_total ?? 12_000;
    const memories = [];
    for (const row of result.rows) {
      if (usedChars >= maxChars) break;
      const body = String(row.body ?? "");
      const remaining = maxChars - usedChars;
      memories.push({ ...row, body: body.slice(0, remaining) });
      usedChars += Math.min(body.length, remaining);
    }
    const trace = await this.pool.query<{ id: string }>(
      `
        INSERT INTO recall_traces (
          developer_id, project_id, tool_name, query, returned_memory_ids, metadata
        )
        VALUES ($1, $2, 'memory_recall_agent_memories', $3, $4, $5)
        RETURNING id
      `,
      [
        context.developerId,
        context.projectId,
        input.query,
        JSON.stringify(memories.map((memory) => memory.memory_id)),
        JSON.stringify({ truncated: result.rows.length > memories.length })
      ]
    );
    return {
      trace_id: trace.rows[0]?.id,
      memories,
      truncated: result.rows.length > memories.length
    };
  }

  async reportRecallUsage(input: ReportRecallUsageInput) {
    await this.pool.query(
      `
        UPDATE recall_traces
        SET used_memory_ids = $2, ignored_memory_ids = $3, used_chunk_ids = $4,
            metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb
        WHERE id = $1
      `,
      [
        input.trace_id,
        JSON.stringify(input.used_memory_ids ?? []),
        JSON.stringify(input.ignored_memory_ids ?? []),
        JSON.stringify(input.used_chunk_ids ?? []),
        JSON.stringify({ usage_note: input.note ?? null })
      ]
    );
    return { ok: true, trace_id: input.trace_id };
  }

  async getReviewDashboard() {
    const context = await this.ensureProject();
    const projects = await this.pool.query(
      `
        WITH project_usage AS (
          SELECT
            p.id,
            p.name,
            p.primary_path,
            p.project_kind,
            p.memory_domain,
            p.updated_at,
            (SELECT count(*)::int FROM sessions s WHERE s.project_id = p.id) AS session_count,
            (SELECT count(*)::int FROM events e WHERE e.project_id = p.id) AS event_count,
            (SELECT count(*)::int FROM agent_memories m WHERE m.project_id = p.id) AS memory_count
          FROM projects p
          WHERE p.developer_id = $1
        ),
        ranked AS (
          SELECT *,
            row_number() OVER (
              PARTITION BY coalesce(primary_path, id::text)
              ORDER BY (session_count + event_count + memory_count) DESC, updated_at DESC
            ) AS rank
          FROM project_usage
        )
        SELECT id AS project_id, name, primary_path, project_kind, memory_domain, updated_at,
               session_count, event_count, memory_count
        FROM ranked
        WHERE rank = 1
        ORDER BY updated_at DESC
        LIMIT 20
      `,
      [context.developerId]
    );
    const inbox = await this.listAgentMemories({ view: "inbox", limit: 25 });
    const rules = await this.listAgentMemories({ view: "rules", limit: 25 });
    const importCandidates = await this.pool.query(
      `
        SELECT id AS memory_id, memory_type, title, body, status, use_policy, scope, scope_kind,
               scope_id, audience, confidence, created_by, metadata, updated_at
        FROM agent_memories
        WHERE developer_id = $1
          AND (project_id = $2 OR scope = 'developer')
          AND created_by = 'import'
          AND status IN ('candidate', 'needs_review')
        ORDER BY updated_at DESC
        LIMIT 25
      `,
      [context.developerId, context.projectId]
    );
    const duplicateConflicts = await this.pool.query(
      `
        SELECT id AS memory_id, memory_type, title, body, status, use_policy, scope, scope_kind,
               scope_id, audience, confidence, created_by, metadata, updated_at
        FROM agent_memories
        WHERE developer_id = $1
          AND (project_id = $2 OR scope = 'developer')
          AND (
            metadata::text ILIKE '%possible_duplicate%'
            OR metadata::text ILIKE '%possible_conflict%'
            OR metadata::text ILIKE '%duplicate%'
            OR metadata::text ILIKE '%conflict%'
          )
        ORDER BY updated_at DESC
        LIMIT 25
      `,
      [context.developerId, context.projectId]
    );
    const critical = await this.pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'interrupted') AS interrupted_sessions,
          (SELECT count(*)::int FROM agent_memories WHERE (project_id = $1 OR scope = 'developer') AND status IN ('candidate', 'needs_review')) AS pending_review,
          (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1 AND status = 'pending') AS pending_paid_approvals
      `,
      [context.projectId]
    );
    const costs = await this.pool.query(
      `
        SELECT provider, model, purpose,
               coalesce(sum(cost_actual_usd), 0)::float AS actual_usd,
               coalesce(sum(cost_estimate_usd), 0)::float AS estimated_usd,
               count(*)::int AS call_count
        FROM model_calls
        WHERE project_id = $1
          AND created_at >= now() - interval '30 days'
        GROUP BY provider, model, purpose
        ORDER BY estimated_usd DESC, call_count DESC
        LIMIT 20
      `,
      [context.projectId]
    );
    const settings = await this.pool.query(
      `
        SELECT key, value, 'project_settings' AS source
        FROM project_settings
        WHERE project_id = $1
        UNION ALL
        SELECT key, value, 'system_settings' AS source
        FROM system_settings
        WHERE key IN ('capture_profile', 'embedding_route', 'paid_api_mode')
        ORDER BY key, source
      `,
      [context.projectId]
    );
    const selectedMemoryId =
      importCandidates.rows[0]?.memory_id ??
      inbox.memories[0]?.memory_id ??
      rules.memories[0]?.memory_id;
    const selectedDetail = selectedMemoryId ? await this.getAgentMemory(selectedMemoryId) : null;
    return {
      current_project_id: context.projectId,
      projects: projects.rows,
      critical: critical.rows[0],
      inbox: inbox.memories,
      import_candidates: importCandidates.rows,
      duplicate_conflicts: duplicateConflicts.rows,
      selected_detail: selectedDetail,
      available_review_actions: [
        "accept",
        "reject",
        "promote_instruction",
        "demote_instruction",
        "archive",
        "unarchive",
        "mark_stale",
        "edit",
        "merge",
        "supersede"
      ],
      rules: rules.memories,
      costs: costs.rows,
      settings: settings.rows,
      chat: {
        placeholder: "Ask Recallant about memory, context packs, cleanup, or settings.",
        destructive_actions_require_confirmation: true
      }
    };
  }

  async setProjectSetting(input: ProjectSettingInput) {
    const context = await this.ensureProject();
    if (isDangerousSetting(input.key, input.value) && input.confirmation?.confirmed !== true) {
      return {
        ok: false,
        status: "confirmation_required",
        key: input.key,
        dangerous: true
      };
    }
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query<{ value: unknown }>(
        "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
        [context.projectId, input.key]
      );
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value,
              reason = EXCLUDED.reason,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
        `,
        [
          context.projectId,
          input.key,
          JSON.stringify(input.value),
          input.reason ?? null,
          input.actor_id ?? input.actor_kind ?? "user"
        ]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, $2, $3, $4, $5, $6, $7)
        `,
        [
          context.projectId,
          input.key,
          previous.rows[0]?.value === undefined ? null : JSON.stringify(previous.rows[0]?.value),
          JSON.stringify(input.value),
          input.actor_kind ?? "user",
          input.actor_id ?? null,
          input.reason ?? null
        ]
      );
      return {
        ok: true,
        status: "updated",
        project_id: context.projectId,
        key: input.key,
        source: "project_settings"
      };
    });
  }

  private classifyAgentMemory(input: CreateAgentMemoryInput) {
    const combined = `${input.title}\n${input.body}`;
    if (
      input.created_by === "agent" &&
      (hasHighRiskSignal(combined) || (input.confidence ?? 1) < 0.5)
    ) {
      return {
        status: "needs_review",
        usePolicy: "evidence_only",
        reason: "high_risk_or_low_confidence"
      };
    }
    if (
      input.created_by === "agent" &&
      (hasInstructionSignal(combined) ||
        input.scope === "developer" ||
        input.memory_type === "procedure")
    ) {
      return {
        status: "candidate",
        usePolicy: "recall_allowed",
        reason: "candidate_rule_not_binding"
      };
    }
    return { status: "accepted", usePolicy: "recall_allowed", reason: "ordinary_memory" };
  }

  private buildSearchFilter(input: {
    projectId: string;
    developerId: string;
    scope: string;
    scopeKind: string | null;
    audience: string | null;
    includeArchived?: boolean;
    startIndex: number;
  }) {
    const clauses = [`c.developer_id = $${input.startIndex}::uuid`];
    if (!input.includeArchived) clauses.push("c.archived_at IS NULL");
    const params: unknown[] = [input.developerId];
    if (input.scope === "developer") {
      clauses.push("c.scope = 'developer'");
    } else if (input.scope === "project") {
      params.push(input.projectId);
      clauses.push(
        `(c.project_id = $${input.startIndex + params.length - 1}::uuid OR c.scope = 'developer')`
      );
    }
    if (input.scopeKind) {
      params.push(input.scopeKind);
      clauses.push(`c.scope_kind = $${input.startIndex + params.length - 1}`);
    }
    if (input.audience) {
      params.push(input.audience);
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(c.audience, '[]'::jsonb)) AS audience_item
          WHERE audience_item->>'kind' = $${input.startIndex + params.length - 1}
        )`
      );
    }
    return { whereSql: clauses.join(" AND "), params };
  }

  private async expandGraphRows(input: {
    projectId: string;
    seedChunkIds: string[];
    budget: number;
    existingChunkIds: Set<string>;
  }) {
    if (input.budget <= 0) return [];
    const result = await this.pool.query<{
      id: string;
      text: string;
      source_event_id: string;
      occurred_at: string;
      weight: number;
    }>(
      `
        WITH neighbors AS (
          SELECT
            CASE
              WHEN e.src_kind = 'chunk' AND e.src_id = ANY($2::text[]) THEN e.dst_id
              WHEN e.dst_kind = 'chunk' AND e.dst_id = ANY($2::text[]) THEN e.src_id
            END AS chunk_id,
            max(e.weight) AS weight
          FROM edges e
          WHERE e.project_id = $1
            AND (
              (e.src_kind = 'chunk' AND e.src_id = ANY($2::text[]))
              OR (e.dst_kind = 'chunk' AND e.dst_id = ANY($2::text[]))
            )
          GROUP BY chunk_id
        )
        SELECT c.id, c.text, c.source_event_id, ev.occurred_at, n.weight
        FROM neighbors n
        JOIN chunks c ON c.id::text = n.chunk_id
        JOIN events ev ON ev.id = c.source_event_id
        WHERE c.archived_at IS NULL
        LIMIT $3
      `,
      [input.projectId, input.seedChunkIds, input.budget]
    );
    return result.rows
      .filter((row) => !input.existingChunkIds.has(row.id))
      .map((row) => ({
        id: row.id,
        text: row.text,
        source_event_id: row.source_event_id,
        occurred_at: row.occurred_at,
        score: Number(row.weight) * 0.2,
        path: "graph",
        superseded_by: null
      }));
  }

  private async countForgetTarget(kind: string, targetId: string) {
    if (kind === "event") {
      const result = await this.pool.query(
        `
          SELECT
            1 AS events,
            (SELECT count(*)::int FROM chunks WHERE source_event_id = $1) AS chunks,
            (SELECT count(*)::int FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE source_event_id = $1)) AS embeddings,
            0 AS agent_memories,
            (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    if (kind === "chunk") {
      const result = await this.pool.query(
        `
          SELECT
            0 AS events,
            (SELECT count(*)::int FROM chunks WHERE id = $1) AS chunks,
            (SELECT count(*)::int FROM embeddings WHERE chunk_id = $1) AS embeddings,
            0 AS agent_memories,
            0 AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    if (kind === "agent_memory") {
      const result = await this.pool.query(
        `
          SELECT
            0 AS events,
            0 AS chunks,
            0 AS embeddings,
            (SELECT count(*)::int FROM agent_memories WHERE id = $1) AS agent_memories,
            0 AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    return {
      events: 0,
      chunks: 0,
      embeddings: 0,
      agent_memories: 0,
      raw_artifacts: 0,
      derived_summaries: 0
    };
  }

  async setCheckpoint(projectId: string | null | undefined, payload: JsonObject) {
    const context = projectId ? { projectId } : await this.ensureProject();
    const result = await this.pool.query(
      `
        INSERT INTO checkpoints (project_id, payload)
        VALUES ($1, $2)
        ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
        RETURNING updated_at
      `,
      [context.projectId, JSON.stringify(payload)]
    );
    return result.rows[0];
  }

  async getCheckpoint(projectId?: string | null) {
    const context = projectId ? { projectId } : await this.ensureProject();
    const result = await this.pool.query(
      "SELECT payload, updated_at FROM checkpoints WHERE project_id = $1",
      [context.projectId]
    );
    return result.rows[0] ?? { payload: null, updated_at: null };
  }

  async closeout(
    sessionId: string,
    checkpointPayload: JsonObject,
    endedReason = "closeout",
    localSpoolStatus?: JsonObject | null
  ) {
    const context = await this.contextForSession(sessionId);
    const checkpoint = await this.setCheckpoint(context.projectId, checkpointPayload);
    await this.pool.query(
      `
        UPDATE sessions
        SET status = 'closed', ended_reason = $2, ended_at = now(), last_seen_at = now()
        WHERE id = $1
      `,
      [sessionId, endedReason]
    );
    const warnings: string[] = [];
    const unsyncedCount =
      typeof localSpoolStatus?.unsynced_count === "number" ? localSpoolStatus.unsynced_count : 0;
    const spoolStatus = String(localSpoolStatus?.status ?? "not_provided");
    if (spoolStatus === "unsynced" || unsyncedCount > 0) {
      warnings.push(
        `Local spool has ${unsyncedCount} unsynced record(s). Run recallant sync-spool.`
      );
    }
    return {
      ...checkpoint,
      spool_sync_status: spoolStatus,
      report_required: warnings.length > 0,
      warnings
    };
  }

  private async contextForSession(sessionId?: string | null): Promise<ProjectContext> {
    if (!sessionId) return this.ensureProject();
    const result = await this.pool.query<{
      project_id: string;
      developer_id: string;
    }>(
      `
        SELECT s.project_id, p.developer_id
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = $1
      `,
      [sessionId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown session_id: ${sessionId}`);
    return { projectId: row.project_id, developerId: row.developer_id };
  }

  private async resolveCapturePolicy(
    client: PoolClient,
    projectId: string,
    developerId: string,
    sessionId?: string | null
  ): Promise<CapturePolicy> {
    if (sessionId) {
      const sessionOverride = await client.query<{ value: unknown }>(
        `
          SELECT value
          FROM session_overrides
          WHERE session_id = $1
            AND key = 'capture_profile'
            AND cleared_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [sessionId]
      );
      const profile = readCaptureProfile(sessionOverride.rows[0]?.value);
      if (profile) return buildCapturePolicy(profile, "session_overrides");
    }

    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'capture_profile'",
      [projectId]
    );
    const projectProfile = readCaptureProfile(projectSetting.rows[0]?.value);
    if (projectProfile) return buildCapturePolicy(projectProfile, "project_settings");

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = 'capture_profile'",
      [developerId]
    );
    const developerProfile = readCaptureProfile(developerSetting.rows[0]?.value);
    if (developerProfile) return buildCapturePolicy(developerProfile, "developer_settings");

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = 'capture_profile'"
    );
    const systemProfile = readCaptureProfile(systemSetting.rows[0]?.value);
    if (systemProfile) return buildCapturePolicy(systemProfile, "system_settings");

    return buildCapturePolicy("standard", "built_in_default");
  }

  private async resolveStaleSessionThreshold(
    client: PoolClient,
    projectId: string,
    developerId: string
  ) {
    const key = "stale_session_threshold_minutes";
    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
      [projectId, key]
    );
    const projectValue = readNumberSetting(projectSetting.rows[0]?.value);
    if (projectValue !== null) return projectValue;

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = $2",
      [developerId, key]
    );
    const developerValue = readNumberSetting(developerSetting.rows[0]?.value);
    if (developerValue !== null) return developerValue;

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const systemValue = readNumberSetting(systemSetting.rows[0]?.value);
    if (systemValue !== null) return systemValue;

    return 480;
  }

  private async insertEvent(
    client: PoolClient,
    input: {
      projectId: string;
      sessionId: string | null;
      ingestSource: string;
      kind: string;
      occurredAt: Date;
      payload: JsonObject;
    }
  ) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO events (project_id, session_id, ingest_source, kind, occurred_at, payload, payload_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.projectId,
        input.sessionId,
        input.ingestSource,
        input.kind,
        input.occurredAt,
        JSON.stringify(input.payload),
        sha256(input.payload)
      ]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Failed to insert event");
    return { id };
  }

  private async insertChunks(
    client: PoolClient,
    input: {
      projectId: string;
      developerId: string;
      eventId: string;
      text: string;
      scope?: "project" | "developer";
      scopeKind?: string | null;
      scopeId?: string | null;
      audience?: unknown[];
    }
  ) {
    const ids: string[] = [];
    for (const [index, text] of chunkText(input.text).entries()) {
      const result = await client.query<{ id: string }>(
        `
          INSERT INTO chunks (
            project_id, developer_id, source_event_id, text, chunk_index,
            token_count_est, scope, scope_kind, scope_id, audience
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `,
        [
          input.projectId,
          input.developerId,
          input.eventId,
          text,
          index,
          estimateTokens(text),
          input.scope ?? "project",
          input.scopeKind ?? "project",
          input.scopeId ?? input.projectId,
          JSON.stringify(input.audience ?? [{ kind: "all_agents", id: null }])
        ]
      );
      const id = result.rows[0]?.id;
      if (id) ids.push(id);
    }
    return ids;
  }

  private async ensureDefaultModelSettings(client: PoolClient) {
    await client.query(
      `
        INSERT INTO system_settings (key, value, updated_by)
        VALUES
          ('embedding_route', $1, 'system'),
          ('embedding_fallback_candidates', $2, 'system'),
          ('paid_api_mode', $3, 'system')
        ON CONFLICT (key) DO NOTHING
      `,
      [
        JSON.stringify({
          route_class: "local_model",
          provider: "ollama",
          model: "nomic-embed-text",
          dims: 768
        }),
        JSON.stringify([
          {
            route_class: "paid_api_provider",
            provider: "openai",
            model: "text-embedding-3-small",
            dims: 1536
          },
          {
            route_class: "paid_api_provider",
            provider: "gemini",
            model: "gemini-embedding-001"
          },
          {
            route_class: "paid_api_provider",
            provider: "gemini",
            model: "gemini-embedding-2"
          }
        ]),
        JSON.stringify("confirm_each")
      ]
    );
  }

  private async resolveEmbeddingRoute(
    client: Pick<Pool | PoolClient, "query">,
    projectId: string,
    developerId: string
  ): Promise<EmbeddingRoute> {
    const key = "embedding_route";
    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
      [projectId, key]
    );
    const projectRoute = this.readEmbeddingRoute(projectSetting.rows[0]?.value, "project_settings");
    if (projectRoute) return projectRoute;

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = $2",
      [developerId, key]
    );
    const developerRoute = this.readEmbeddingRoute(
      developerSetting.rows[0]?.value,
      "developer_settings"
    );
    if (developerRoute) return developerRoute;

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const systemRoute = this.readEmbeddingRoute(systemSetting.rows[0]?.value, "system_settings");
    if (systemRoute) return systemRoute;

    return {
      routeClass: "local_model",
      provider: "ollama",
      model: "nomic-embed-text",
      dims: 768,
      source: "built_in_default",
      routingReason: "default_local_embedding"
    };
  }

  private readEmbeddingRoute(value: unknown, source: string): EmbeddingRoute | null {
    const object = readObjectSetting(value);
    if (!object) return null;
    const provider = typeof object.provider === "string" ? object.provider : null;
    const model = typeof object.model === "string" ? object.model : null;
    const dims =
      typeof object.dims === "number" && Number.isInteger(object.dims) ? object.dims : 768;
    const routeClass =
      object.route_class === "paid_api_provider" ? "paid_api_provider" : "local_model";
    if (!provider || !model) return null;
    return {
      routeClass,
      provider,
      model,
      dims,
      source,
      routingReason: source === "built_in_default" ? "default_local_embedding" : "settings_override"
    };
  }

  private async embedChunks(
    client: PoolClient,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      chunkIds: string[];
      texts: string[];
    }
  ) {
    if (input.chunkIds.length === 0) return { status: "skipped", reason: "no_chunks" };
    const route = await this.resolveEmbeddingRoute(client, input.projectId, input.developerId);
    const existingModels = await client.query<{ embed_model: string; embed_status: string }>(
      `
        SELECT DISTINCT embed_model, embed_status
        FROM chunks
        WHERE project_id = $1 AND embed_model IS NOT NULL
      `,
      [input.projectId]
    );
    const incompatibleModel = existingModels.rows.find(
      (row) => row.embed_model && row.embed_model !== route.model
    );
    if (incompatibleModel) {
      throw new Error(
        `Embedding model switch from ${incompatibleModel.embed_model} to ${route.model} requires explicit reindex`
      );
    }

    if (route.routeClass === "paid_api_provider") {
      const approval = await this.createPaidApiApproval(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding"
      });
      await this.recordModelCall(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding",
        status: "cancelled",
        confirmationStatus: "required_pending",
        approvalRequestId: approval.id,
        metadata: { text_count: input.texts.length, blocked_before_provider_call: true }
      });
      await client.query("UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])", [
        input.chunkIds
      ]);
      return {
        status: "pending_approval",
        provider: route.provider,
        model: route.model,
        approval_request_id: approval.id
      };
    }

    if (route.provider !== "deterministic") {
      await this.recordModelCall(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding",
        status: "failed",
        errorCode: "UNAVAILABLE",
        metadata: { text_count: input.texts.length, message: "Embedding provider is not connected" }
      });
      await client.query("UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])", [
        input.chunkIds
      ]);
      return {
        status: "pending",
        provider: route.provider,
        model: route.model,
        error: "UNAVAILABLE"
      };
    }

    for (const [index, chunkId] of input.chunkIds.entries()) {
      const embedding = deterministicEmbedding(input.texts[index] ?? "", route.dims);
      await client.query(
        `
          INSERT INTO embeddings (chunk_id, model, dims, vector)
          VALUES ($1, $2, $3, $4::vector)
          ON CONFLICT (chunk_id) DO UPDATE
          SET model = EXCLUDED.model, dims = EXCLUDED.dims, vector = EXCLUDED.vector, created_at = now()
        `,
        [chunkId, route.model, route.dims, vectorLiteral(embedding)]
      );
    }
    await client.query(
      "UPDATE chunks SET embed_status = 'embedded', embed_model = $2 WHERE id = ANY($1::uuid[])",
      [input.chunkIds, route.model]
    );
    await this.recordModelCall(client, {
      developerId: input.developerId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      route,
      purpose: "chunk_embedding",
      status: "success",
      metadata: { text_count: input.texts.length }
    });
    return { status: "embedded", provider: route.provider, model: route.model, dims: route.dims };
  }

  private async createPaidApiApproval(
    client: PoolClient,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      route: EmbeddingRoute;
      purpose: string;
    }
  ) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO paid_api_approval_requests (
          developer_id, project_id, session_id, purpose, provider, model,
          routing_reason, attempted_routes, requested_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system')
        RETURNING id
      `,
      [
        input.developerId,
        input.projectId,
        input.sessionId,
        input.purpose,
        input.route.provider,
        input.route.model,
        input.route.routingReason,
        JSON.stringify([{ provider: input.route.provider, model: input.route.model }])
      ]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Failed to create paid API approval request");
    return { id };
  }

  private async recordModelCall(
    client: Pick<Pool | PoolClient, "query">,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      route: EmbeddingRoute;
      purpose: string;
      status: "success" | "failed" | "cancelled";
      confirmationStatus?: string;
      approvalRequestId?: string;
      errorCode?: string;
      metadata?: JsonObject;
    }
  ) {
    await client.query(
      `
        INSERT INTO model_calls (
          developer_id, project_id, session_id, memory_domain, route_class,
          provider, model, purpose, routing_reason, confirmation_status,
          approval_request_id, status, error_code, metadata
        )
        VALUES ($1, $2, $3, 'agent_work', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        input.developerId,
        input.projectId,
        input.sessionId,
        input.route.routeClass,
        input.route.provider,
        input.route.model,
        input.purpose,
        input.route.routingReason,
        input.confirmationStatus ?? "not_required",
        input.approvalRequestId ?? null,
        input.status,
        input.errorCode ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  private async findLastEventId(client: PoolClient, sessionId: string) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE session_id = $1 ORDER BY occurred_at DESC, created_at DESC LIMIT 1",
      [sessionId]
    );
    return result.rows[0]?.id ?? null;
  }

  private async touchSession(client: PoolClient, sessionId?: string | null) {
    if (!sessionId) return;
    await client.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
  }

  private async findDedup(client: PoolClient, projectId: string, dedupKey?: string | null) {
    if (!dedupKey) return null;
    const result = await client.query<{ event_id: string }>(
      "SELECT event_id FROM ingest_dedup_keys WHERE project_id = $1 AND dedup_key = $2",
      [projectId, dedupKey]
    );
    return result.rows[0]?.event_id ?? null;
  }

  private async insertDedup(
    client: PoolClient,
    projectId: string,
    dedupKey: string | null | undefined,
    eventId: string
  ) {
    if (!dedupKey) return;
    await client.query(
      `
        INSERT INTO ingest_dedup_keys (project_id, dedup_key, event_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, dedup_key) DO NOTHING
      `,
      [projectId, dedupKey, eventId]
    );
  }
}

let cachedDb: RecallantDb | null | undefined;

export function createRecallantDbFromEnv() {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) return null;
  cachedDb ??= new RecallantDb({
    databaseUrl,
    developerId: process.env.RECALLANT_DEVELOPER_ID,
    projectId: process.env.RECALLANT_PROJECT_ID,
    projectPath: process.env.RECALLANT_PROJECT_PATH
  });
  return cachedDb;
}
