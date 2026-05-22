import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@localhost:5432/recallant_agent_work";

const backupRoot = await mkdtemp(join(tmpdir(), "recallant-phase8-backup-"));
const projectId = randomUUID();
const developerId = randomUUID();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(
    `
      INSERT INTO developers (id, name)
      VALUES ($1, 'phase8 backup smoke developer')
      ON CONFLICT (id) DO NOTHING
    `,
    [developerId]
  );
  await client.query(
    `
      INSERT INTO projects (id, developer_id, primary_path, name)
      VALUES ($1, $2, $3, 'phase8-backup-smoke')
      ON CONFLICT (id) DO NOTHING
    `,
    [projectId, developerId, `/tmp/recallant-phase8-${projectId}`]
  );
  await client.query(
    `
      INSERT INTO checkpoints (project_id, payload)
      VALUES ($1, $2)
    `,
    [
      projectId,
      JSON.stringify({
        current_status: "phase8 backup smoke",
        current_focus: "backup verification",
        next_step: "continue hardening",
        open_questions: []
      })
    ]
  );
  await client.query(
    `
      INSERT INTO project_settings (project_id, key, value, reason, updated_by)
      VALUES ($1, 'capture_profile', $2, 'phase8 backup smoke', 'smoke')
      ON CONFLICT (project_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [projectId, JSON.stringify("standard")]
  );
} finally {
  await client.end();
}

function run(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: "/work",
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

const backup = run(["backup", "--target", backupRoot]);
if (
  backup.ok !== true ||
  !backup.manifest_path ||
  backup.restore_verification?.status !== "not_run" ||
  backup.secret_policy !== "manifest excludes provider keys and raw secrets"
) {
  throw new Error(`Backup output failed: ${JSON.stringify(backup)}`);
}

const manifest = JSON.parse(await readFile(backup.manifest_path, "utf8"));
const tablesPath = join(backup.manifest_path, "..", "tables.json");
const tablesJson = await readFile(tablesPath, "utf8");
const tables = JSON.parse(tablesJson);
const tablesHash = createHash("sha256").update(tablesJson).digest("hex");
const manifestTables = manifest.files.find((file) => file.path === "tables.json");

if (
  manifest.backup_id !== backup.backup_id ||
  manifest.schema_version !== "0001_initial" ||
  manifestTables?.sha256 !== tablesHash ||
  !Array.isArray(tables.embeddings) ||
  !Array.isArray(tables.edges) ||
  !Array.isArray(tables.model_calls) ||
  !Array.isArray(tables.settings_audit_events) ||
  !tables.projects.some((project) => project.id === projectId) ||
  !tables.checkpoints.some((checkpoint) => checkpoint.project_id === projectId)
) {
  throw new Error(`Backup manifest/tables failed: ${JSON.stringify({ manifest, tablesHash })}`);
}

const forbiddenFragments = ["OPENAI_API_KEY=", "ANTHROPIC_API_KEY=", "GEMINI_API_KEY="];
const combined = `${JSON.stringify(manifest)}\n${tablesJson}`;
for (const fragment of forbiddenFragments) {
  if (combined.includes(fragment)) {
    throw new Error(`Backup leaked forbidden secret fragment: ${fragment}`);
  }
}

const verify = run(["backup-verify", "--manifest", backup.manifest_path]);
if (
  verify.ok !== true ||
  verify.restore_verification !== "passed" ||
  verify.production_overwritten !== false ||
  Number(verify.project_count) < 1
) {
  throw new Error(`Backup verification failed: ${JSON.stringify(verify)}`);
}

process.stdout.write("Phase 8 backup smoke passed\n");
