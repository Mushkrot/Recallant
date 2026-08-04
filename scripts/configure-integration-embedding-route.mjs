import { URL } from "node:url";
import pg from "pg";

function defaultDatabaseUrl() {
  const url = new URL("postgres://127.0.0.1");
  url.username = "recallant";
  url.password = "example-password";
  url.port = "15433";
  url.pathname = "/recallant_agent_work";
  return url.toString();
}

const confirmed = process.argv.includes("--confirm-integration-database");
if (!confirmed) {
  throw new Error("Refusing to configure fixtures without --confirm-integration-database.");
}

const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl();
const parsedUrl = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedUrl.hostname)) {
  throw new Error(
    `Refusing to configure integration fixtures on non-loopback database host ${parsedUrl.hostname}.`
  );
}

const route = {
  route_class: "local_model",
  provider: "deterministic",
  model: "deterministic-bow-v1",
  dims: 8
};
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query(
    `
      INSERT INTO system_settings (key, value, is_secret_ref, updated_by)
      VALUES ('embedding_route', $1, false, 'integration-fixture')
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          is_secret_ref = false,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
    `,
    [JSON.stringify(route)]
  );
  process.stdout.write(`${JSON.stringify({ status: "configured", route })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
