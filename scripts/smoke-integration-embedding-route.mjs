import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { RecallantDb } from "@recallant/db";
import pg from "pg";

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "example-password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();
const projectPath = await mkdtemp(join(tmpdir(), "recallant-integration-route-smoke-"));
const projectId = randomUUID();
const developerId = randomUUID();
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const setting = await client.query(
    "SELECT value, updated_by FROM system_settings WHERE key = 'embedding_route'"
  );
  const route = setting.rows[0]?.value;
  assert(
    route?.provider === "deterministic" &&
      route?.model === "deterministic-bow-v1" &&
      route?.dims === 8,
    `Integration embedding route is not deterministic: ${JSON.stringify(setting.rows[0] ?? null)}`
  );

  const database = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
  try {
    const session = await database.startSession({
      client_kind: "codex",
      client_version: "integration-route-smoke",
      project_path: projectPath,
      session_label: "integration-route-smoke",
      resume_policy: "normal"
    });
    const appended = await database.appendTurn({
      session_id: session.session_id,
      client_kind: "codex",
      role: "user",
      text: "Deterministic integration embedding route proof.",
      dedup_key: `integration-route-${randomUUID()}`
    });
    assert(
      appended.embedding?.status === "embedded" &&
        appended.embedding?.provider === "deterministic" &&
        appended.embedding?.model === "deterministic-bow-v1",
      `Integration append did not use the deterministic route: ${JSON.stringify(
        appended.embedding
      )}`
    );
  } finally {
    await database.close();
  }

  process.stdout.write(
    `${JSON.stringify({ status: "pass", provider: route.provider, model: route.model, dims: route.dims })}\n`
  );
} finally {
  await client.end().catch(() => undefined);
  await rm(projectPath, { recursive: true, force: true });
}
