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

      return { developerId, projectId };
    });
  }

  async startSession(input: StartSessionInput) {
    const project = await this.ensureProject(input.project_path);
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query(
        `
          SELECT id, last_seen_at
          FROM sessions
          WHERE project_id = $1 AND status = 'active' AND ended_at IS NULL
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        [project.projectId]
      );
      const previousSession = previous.rows[0];
      if (previousSession) {
        await client.query(
          `
            UPDATE sessions
            SET status = 'interrupted', ended_reason = 'crash_or_unknown', last_seen_at = now()
            WHERE id = $1
          `,
          [previousSession.id]
        );
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
              recovery_status: "needs_review"
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

      const payload = { schema_version: 1, text: input.text, attachments: [], raw_artifacts: [] };
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
        text: input.text
      });
      return { event_id: event.id, chunk_ids: chunkIds, status: "created" };
    });
  }

  async appendEvent(input: AppendEventInput) {
    const context = await this.contextForSession(input.session_id);
    return withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      const existing = await this.findDedup(client, context.projectId, input.dedup_key);
      if (existing) return { event_id: existing, raw_artifact_ids: [], status: "duplicate" };

      const payload = {
        schema_version: 1,
        text: input.text ?? null,
        metadata: input.metadata ?? {},
        raw_artifacts: []
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

      return { event_id: event.id, raw_artifact_ids: rawArtifactIds, status: "created" };
    });
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
