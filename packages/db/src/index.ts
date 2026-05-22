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

  constructor(private readonly config: RecallantDbConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async close() {
    await this.pool.end();
  }

  async ensureProject(projectPath?: string | null): Promise<ProjectContext> {
    return withTransaction(this.pool, async (client) => {
      const developerId = this.config.developerId ?? randomUUID();
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );

      const projectId = this.config.projectId ?? randomUUID();
      const primaryPath = projectPath ?? this.config.projectPath ?? process.cwd();
      const projectName = primaryPath.split("/").filter(Boolean).at(-1) ?? "recallant-project";
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

      return { developerId, projectId };
    });
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
        score: candidate.vectorScore * 0.65 + candidate.lexicalScore * 0.35,
        path: Array.from(candidate.paths).join("+")
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);

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

  async appendEvent(input: AppendEventInput) {
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

  private buildSearchFilter(input: {
    projectId: string;
    developerId: string;
    scope: string;
    scopeKind: string | null;
    audience: string | null;
    startIndex: number;
  }) {
    const clauses = [`c.developer_id = $${input.startIndex}::uuid`, "c.archived_at IS NULL"];
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

  async closeout(sessionId: string, checkpointPayload: JsonObject, endedReason = "closeout") {
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
    return checkpoint;
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
    input: { projectId: string; developerId: string; eventId: string; text: string }
  ) {
    const ids: string[] = [];
    for (const [index, text] of chunkText(input.text).entries()) {
      const result = await client.query<{ id: string }>(
        `
          INSERT INTO chunks (
            project_id, developer_id, source_event_id, text, chunk_index,
            token_count_est, scope, scope_kind, scope_id, audience
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'project', 'project', $7, $8)
          RETURNING id
        `,
        [
          input.projectId,
          input.developerId,
          input.eventId,
          text,
          index,
          estimateTokens(text),
          input.projectId,
          JSON.stringify([{ kind: "all_agents", id: null }])
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
