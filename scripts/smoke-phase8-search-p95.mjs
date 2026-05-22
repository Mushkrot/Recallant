import { randomUUID } from "node:crypto";
import pg from "pg";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const chunkCount = Number.parseInt(process.env.RECALLANT_SEARCH_P95_FIXTURE_CHUNKS ?? "10000", 10);
const queryRuns = Number.parseInt(process.env.RECALLANT_SEARCH_P95_RUNS ?? "25", 10);
const budgetMs = Number.parseInt(process.env.RECALLANT_SEARCH_P95_BUDGET_MS ?? "1500", 10);

const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-phase8-search-${projectId}`;
const sessionId = randomUUID();
const eventId = randomUUID();
const targetToken = `perf_unique_token_${chunkCount - 1}`;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(
    `
      INSERT INTO developers (id, name)
      VALUES ($1, 'phase8 search p95 developer')
    `,
    [developerId]
  );
  await client.query(
    `
      INSERT INTO projects (id, developer_id, primary_path, name)
      VALUES ($1, $2, $3, 'phase8-search-p95')
    `,
    [projectId, developerId, projectPath]
  );
  await client.query(
    `
      INSERT INTO sessions (id, project_id, client_kind, client_version, status)
      VALUES ($1, $2, 'codex', 'smoke', 'active')
    `,
    [sessionId, projectId]
  );
  await client.query(
    `
      INSERT INTO events (id, project_id, session_id, ingest_source, kind, occurred_at, payload)
      VALUES ($1, $2, $3, 'fixture', 'turn_user', now(), $4)
    `,
    [eventId, projectId, sessionId, JSON.stringify({ text: "phase8 search p95 fixture" })]
  );

  const batchSize = 1000;
  for (let offset = 0; offset < chunkCount; offset += batchSize) {
    const size = Math.min(batchSize, chunkCount - offset);
    const values = [];
    const params = [];
    for (let index = 0; index < size; index += 1) {
      const chunkIndex = offset + index;
      const token = `perf_unique_token_${chunkIndex}`;
      values.push(
        `($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6}, 'project')`
      );
      params.push(
        projectId,
        developerId,
        eventId,
        `Phase 8 p95 fixture chunk ${chunkIndex} contains ${token} and common project recall text.`,
        chunkIndex,
        20
      );
    }
    await client.query(
      `
        INSERT INTO chunks (
          project_id, developer_id, source_event_id, text, chunk_index, token_count_est, scope
        )
        VALUES ${values.join(", ")}
      `,
      params
    );
  }
} finally {
  await client.end();
}

const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
try {
  const durations = [];
  for (let index = 0; index < queryRuns; index += 1) {
    const start = process.hrtime.bigint();
    const result = await db.search({
      session_id: sessionId,
      query: targetToken,
      mode: "lexical_only",
      top_k: 3,
      max_chars_total: 1000
    });
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    durations.push(durationMs);
    if (!result.hits.some((hit) => hit.text_excerpt.includes(targetToken))) {
      throw new Error(`Search fixture did not return target token: ${JSON.stringify(result)}`);
    }
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)];
  if (p95 > budgetMs) {
    throw new Error(
      `Search p95 exceeded budget: ${JSON.stringify({ p95_ms: p95, budget_ms: budgetMs, chunk_count: chunkCount, runs: queryRuns })}`
    );
  }
  process.stdout.write(
    `Phase 8 search p95 smoke passed ${JSON.stringify({
      p95_ms: Math.round(p95 * 100) / 100,
      budget_ms: budgetMs,
      chunk_count: chunkCount,
      runs: queryRuns
    })}\n`
  );
} finally {
  await db.close();
}
