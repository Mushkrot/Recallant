const smokeDatabaseEnvKeys = [
  "RECALLANT_ENV_FILE",
  "RECALLANT_SERVICE_ENV_FILE",
  "RECALLANT_DATABASE_URL",
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "RECALLANT_DATA_DIR",
  "RECALLANT_BACKUP_TARGET",
  "RECALLANT_POSTGRES_HOST",
  "RECALLANT_POSTGRES_PORT",
  "RECALLANT_POSTGRES_CONTAINER_NAME",
  "RECALLANT_COMPOSE_PROJECT_NAME"
];

const defaultSmokeDatabaseUrl =
  "postgres://recallant:example-password@127.0.0.1:15433/recallant_agent_work";

export function smokeDatabaseUrl() {
  return process.env.RECALLANT_SMOKE_DATABASE_URL?.trim() || defaultSmokeDatabaseUrl;
}

export function smokeEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const key of smokeDatabaseEnvKeys) delete env[key];
  return {
    ...env,
    RECALLANT_DATABASE_URL: smokeDatabaseUrl(),
    ...extra
  };
}
