#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { createRecallantDbFromEnv } from "@recallant/db";
import type { RawArtifactInput } from "@recallant/db";
import { runRecallantStdioServer } from "@recallant/mcp";
import pg from "pg";

const memorySection = `## Memory (Recallant)

- At session start: call \`memory_start_session\`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call \`memory_get_context_pack\` with the current task hint.
- Use \`memory_search\` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in \`memory_search\`, not broad ones. One call per session start is usually enough.
- After meaningful progress: update checkpoint via \`memory_set_checkpoint\` and update \`PROJECT_LOG.md\` to match fields \`current_focus\` and \`next_step\`.
- On clear pause/exit/closeout intent: call \`memory_closeout\` and update \`PROJECT_LOG.md\` from the closeout payload.
- To share a pattern across projects: call \`memory_promote\` on the relevant chunk or create a governed memory proposal.
- Never paste secrets into memory tools.
- If MCP is unavailable: update \`PROJECT_LOG.md\` and, when available, write local spool.
`;

type InitOptions = {
  target: string;
  dryRun: boolean;
  captureProfile: "light" | "standard" | "detailed" | "custom";
  projectDir: string;
  serverUrl: string;
};

export function describeCliBoundary() {
  return {
    core: getRecallantCoreInfo(),
    supportedClientKinds
  };
}

function parseFlag(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function spoolDir(argv: readonly string[]) {
  return resolve(
    parseFlag(argv, "--spool-dir") ??
      process.env.RECALLANT_SPOOL_DIR ??
      join(process.cwd(), ".recallant", "spool")
  );
}

function spoolPath(argv: readonly string[]) {
  return join(spoolDir(argv), "spool.jsonl");
}

function spoolManifestPath(argv: readonly string[]) {
  return join(spoolDir(argv), "sync-manifest.json");
}

async function readJsonl(path: string) {
  const content = await readOptional(path);
  if (!content?.trim()) return [];
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readSpoolManifest(argv: readonly string[]) {
  const content = await readOptional(spoolManifestPath(argv));
  if (!content) return { synced: {} as Record<string, unknown> };
  const parsed = JSON.parse(content) as { synced?: Record<string, unknown> };
  return { synced: parsed.synced ?? {} };
}

function parseInitOptions(argv: readonly string[]): InitOptions {
  const captureProfile = parseFlag(argv, "--capture-profile") ?? "standard";
  if (!["light", "standard", "detailed", "custom"].includes(captureProfile)) {
    throw new Error(`Invalid --capture-profile: ${captureProfile}`);
  }
  return {
    target: parseFlag(argv, "--target") ?? "codex",
    dryRun: argv.includes("--dry-run"),
    captureProfile: captureProfile as InitOptions["captureProfile"],
    projectDir: resolve(parseFlag(argv, "--project-dir") ?? process.cwd()),
    serverUrl:
      parseFlag(argv, "--server-url") ?? process.env.RECALLANT_SERVER_URL ?? "http://127.0.0.1:3005"
  };
}

function configJson(projectId: string, serverUrl: string) {
  return `${JSON.stringify({ project_id: projectId, recallant_server_url: serverUrl }, null, 2)}\n`;
}

function codexMcpConfig(projectId: string, developerId: string) {
  return {
    mcpServers: {
      recallant: {
        command: "recallant",
        args: ["mcp-server"],
        env: {
          RECALLANT_PROJECT_ID: projectId,
          RECALLANT_DEVELOPER_ID: developerId,
          RECALLANT_DATABASE_URL: "${RECALLANT_DATABASE_URL}"
        }
      }
    }
  };
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function upsertMemorySection(existing: string | null) {
  if (!existing) return `# Agent Instructions\n\n${memorySection}`;
  const pattern = /## Memory \(Recallant\)[\s\S]*?(?=\n## |\n# |$)/;
  if (pattern.test(existing)) return existing.replace(pattern, memorySection.trimEnd());
  return `${existing.trimEnd()}\n\n${memorySection}`;
}

function projectLog(projectName: string) {
  return `# Project Log

## Current Session

Status: initialized with Recallant.
Current focus: project onboarding.
Next step: start a Recallant-backed agent session.

## Open Questions

- None recorded.

## Notes

- Long history belongs in Recallant memory, not this file.
- Project: ${projectName}
`;
}

async function detectImportCandidates(projectDir: string) {
  const candidates = [];
  for (const file of ["PROJECT_LOG.md", "AGENTS.md", "CLAUDE.md", ".env.example"]) {
    const path = join(projectDir, file);
    const content = await readOptional(path);
    if (content !== null) {
      candidates.push({
        path: file,
        sha256: createHash("sha256").update(content).digest("hex"),
        suggested_command: `recallant import --dry-run ${file}`
      });
    }
  }
  return candidates;
}

async function runInit(argv: readonly string[]) {
  const options = parseInitOptions(argv);
  const projectId = randomUUID();
  const developerId = process.env.RECALLANT_DEVELOPER_ID ?? randomUUID();
  const plan = {
    action: "init",
    target: options.target,
    dry_run: options.dryRun,
    project_dir: options.projectDir,
    project_id: projectId,
    developer_id: developerId,
    capture_profile: options.captureProfile,
    files: [".recallant/config", "AGENTS.md", "PROJECT_LOG.md"],
    import_candidates: await detectImportCandidates(options.projectDir),
    mcp_config: codexMcpConfig(projectId, developerId)
  };

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  await mkdir(join(options.projectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(options.projectDir, ".recallant", "config"),
    configJson(projectId, options.serverUrl)
  );
  const agentsPath = join(options.projectDir, "AGENTS.md");
  await writeFile(agentsPath, upsertMemorySection(await readOptional(agentsPath)));
  const projectLogPath = join(options.projectDir, "PROJECT_LOG.md");
  if ((await readOptional(projectLogPath)) === null) {
    await writeFile(
      projectLogPath,
      projectLog(options.projectDir.split("/").filter(Boolean).at(-1) ?? "project")
    );
  }

  const database = createRecallantDbFromEnv();
  if (database) {
    await database.registerProject({
      projectId,
      developerId,
      projectPath: options.projectDir,
      captureProfile: options.captureProfile
    });
  }

  process.stdout.write(
    `${JSON.stringify({ ...plan, dry_run: false, status: "created" }, null, 2)}\n`
  );
}

async function runDiscover(argv: readonly string[]) {
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const result = {
    action: "discover",
    dry_run: argv.includes("--dry-run"),
    project_dir: projectDir,
    candidates: await detectImportCandidates(projectDir),
    writes_memory: false,
    promotes_instruction_grade: false
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runImport(argv: readonly string[]) {
  const target = argv.find((arg, index) => index > 2 && !arg.startsWith("--"));
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const path = target ? join(projectDir, target) : null;
  const content = path ? await readOptional(path) : null;
  const isEnvExample = target?.endsWith(".env.example") ?? false;
  const result = {
    action: "import",
    dry_run: argv.includes("--dry-run"),
    target,
    writes_memory: false,
    result_class: isEnvExample ? "secret_reference_names_only" : "source_preview",
    provisional_scope: "project",
    provisional_audience: target === "CLAUDE.md" ? "specific_client:claude_code" : "all_agents",
    source_ref: content
      ? { path: target, sha256: createHash("sha256").update(content).digest("hex") }
      : null,
    warning: argv.includes("--dry-run")
      ? "Preview only. No import_batch events, active memories, or instruction-grade records were created."
      : "Write imports are not enabled in this implementation slice."
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runLintContext(argv: readonly string[]) {
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const agents = await readOptional(join(projectDir, "AGENTS.md"));
  const projectLog = await readOptional(join(projectDir, "PROJECT_LOG.md"));
  const failures = [];
  if (agents && agents.length > 24_000 && !agents.includes("large-project override")) {
    failures.push("AGENTS.md exceeds configured bootstrap context budget");
  }
  if (agents && (agents.match(/## Memory \(Recallant\)/g)?.length ?? 0) > 1) {
    failures.push("AGENTS.md contains duplicated Memory (Recallant) sections");
  }
  if (projectLog && projectLog.length > 32_000 && !projectLog.includes("large-project override")) {
    failures.push("PROJECT_LOG.md appears to contain long historical archive");
  }
  const result = { ok: failures.length === 0, failures, project_dir: projectDir };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function runContext(argv: readonly string[]) {
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for context preview");
  const projectDir = resolve(parseFlag(argv, "--project-dir") ?? process.cwd());
  const started = await database.startSession({
    client_kind: "codex",
    project_path: projectDir,
    session_label: "context-preview",
    resume_policy: "normal"
  });
  const pack = await database.getContextPack({
    session_id: String(started.session_id),
    task_hint: parseFlag(argv, "--task-hint") ?? "context preview",
    include_raw_evidence: "auto",
    include_recovery: true
  });
  process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
}

async function runDoctor() {
  const database = createRecallantDbFromEnv();
  let postgres = { configured: Boolean(process.env.RECALLANT_DATABASE_URL), reachable: false };
  if (database) {
    try {
      await database.ensureProject(process.env.RECALLANT_PROJECT_PATH ?? process.cwd());
      postgres = { configured: true, reachable: true };
    } catch {
      postgres = { configured: true, reachable: false };
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ...describeCliBoundary(),
        postgres,
        local_model: {
          provider: "ollama",
          url: process.env.RECALLANT_OLLAMA_URL ?? "http://localhost:11434",
          starts_service: false
        },
        paid_api_mode: "confirm_each",
        owner_server_notes: [
          "/ai/PORTS.yaml must be checked before service start",
          "/ai/SECURITY must be consulted before public exposure"
        ]
      },
      null,
      2
    )}\n`
  );
}

async function snapshotTables(client: pg.Client) {
  const tableNames = [
    "developers",
    "projects",
    "sessions",
    "events",
    "raw_artifacts",
    "chunks",
    "embeddings",
    "edges",
    "checkpoints",
    "agent_memories",
    "agent_memory_source_refs",
    "agent_memory_review_actions",
    "recall_traces",
    "ingest_dedup_keys",
    "erasure_requests",
    "paid_api_approval_requests",
    "model_calls",
    "system_settings",
    "developer_settings",
    "project_settings",
    "session_overrides",
    "client_adapter_settings",
    "settings_audit_events"
  ];
  const tables: Record<string, unknown[]> = {};
  for (const table of tableNames) {
    const result = await client.query(`SELECT * FROM ${table}`);
    tables[table] = result.rows;
  }
  return tables;
}

function rowsOf(tables: Record<string, unknown[]>, table: string) {
  return (tables[table] ?? []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
  );
}

async function runBackup(argv: readonly string[]) {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for backup");
  const targetDir = resolve(parseFlag(argv, "--target") ?? join(process.cwd(), "backups"));
  const backupId = `recallant-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
  const backupDir = join(targetDir, backupId);
  await mkdir(backupDir, { recursive: true });
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await snapshotTables(client);
    const tablesJson = `${JSON.stringify(tables, null, 2)}\n`;
    const tablesHash = createHash("sha256").update(tablesJson).digest("hex");
    await writeFile(join(backupDir, "tables.json"), tablesJson);
    const manifest = {
      backup_id: backupId,
      created_at: new Date().toISOString(),
      recallant_version: "0.0.0",
      schema_version: "0001_initial",
      included_dbs: ["recallant_agent_work"],
      raw_artifact_roots: [],
      files: [{ path: "tables.json", sha256: tablesHash, size_bytes: tablesJson.length }],
      target: { kind: "local_directory", path: backupDir, future_ssh_tailscale_supported: true },
      encryption: { status: "not_enabled_local_dev" },
      restore_verification: { status: "not_run" },
      secret_policy: "manifest excludes provider keys and raw secrets"
    };
    await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: true, manifest_path: join(backupDir, "manifest.json"), ...manifest }, null, 2)}\n`
    );
  } finally {
    await client.end();
  }
}

async function runBackupVerify(argv: readonly string[]) {
  const manifestPath = parseFlag(argv, "--manifest");
  if (!manifestPath) throw new Error("--manifest is required");
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for backup verification");
  const resolvedManifest = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
    schema_version: string;
  };
  const tablesJson = await readFile(join(resolvedManifest, "..", "tables.json"), "utf8");
  const actualHash = createHash("sha256").update(tablesJson).digest("hex");
  const expectedHash = manifest.files.find((file) => file.path === "tables.json")?.sha256;
  if (actualHash !== expectedHash) throw new Error("Backup hash verification failed");
  const tables = JSON.parse(tablesJson) as Record<string, unknown[]>;
  const checkpoints = rowsOf(tables, "checkpoints");
  const chunks = rowsOf(tables, "chunks");
  const agentMemories = rowsOf(tables, "agent_memories");
  const rawArtifacts = rowsOf(tables, "raw_artifacts");
  const searchQuery = parseFlag(argv, "--query")?.toLowerCase();
  const boundedSearchMatches = searchQuery
    ? chunks.filter((chunk) =>
        String(chunk.text ?? "")
          .toLowerCase()
          .includes(searchQuery)
      ).length
    : chunks.length;
  const rawArtifactPointerIssues = rawArtifacts.filter(
    (artifact) =>
      artifact.storage_backend !== "postgres_inline" && !artifact.uri && !artifact.sha256
  ).length;
  if (rawArtifactPointerIssues > 0) {
    throw new Error("Backup raw artifact pointer verification failed");
  }
  if (searchQuery && boundedSearchMatches === 0) {
    throw new Error("Backup bounded search verification failed");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `verify_${randomUUID().replaceAll("-", "_")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}.backup_snapshot (payload jsonb)`);
    await client.query(`INSERT INTO ${schema}.backup_snapshot (payload) VALUES ($1)`, [
      JSON.stringify(tables)
    ]);
    const checks = await client.query(
      `
        SELECT
          jsonb_array_length(payload->'projects') AS project_count,
          jsonb_array_length(payload->'checkpoints') AS checkpoint_count,
          jsonb_array_length(payload->'chunks') AS chunk_count,
          jsonb_array_length(payload->'agent_memories') AS governed_memory_count,
          jsonb_array_length(payload->'raw_artifacts') AS raw_artifact_count
        FROM ${schema}.backup_snapshot
        LIMIT 1
      `
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          restore_verification: "passed",
          temporary_schema: schema,
          project_count: checks.rows[0]?.project_count ?? 0,
          latest_checkpoint_present: checkpoints.length > 0,
          governed_memory_count: checks.rows[0]?.governed_memory_count ?? agentMemories.length,
          chunk_count: checks.rows[0]?.chunk_count ?? chunks.length,
          raw_artifact_count: checks.rows[0]?.raw_artifact_count ?? rawArtifacts.length,
          raw_artifact_pointer_issues: rawArtifactPointerIssues,
          bounded_search_checked: true,
          bounded_search_query: searchQuery ?? null,
          bounded_search_matches: boundedSearchMatches,
          schema_version: manifest.schema_version,
          production_overwritten: false
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

async function runRestorePlan(argv: readonly string[]) {
  const manifestPath = parseFlag(argv, "--manifest");
  if (!manifestPath) throw new Error("--manifest is required");
  const remapPath = parseFlag(argv, "--remap");
  const resolvedManifest = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
    schema_version: string;
  };
  const tablesJson = await readFile(join(resolvedManifest, "..", "tables.json"), "utf8");
  const actualHash = createHash("sha256").update(tablesJson).digest("hex");
  const expectedHash = manifest.files.find((file) => file.path === "tables.json")?.sha256;
  if (actualHash !== expectedHash) throw new Error("Backup hash verification failed");
  const tables = JSON.parse(tablesJson) as Record<string, unknown[]>;
  const remap = remapPath
    ? (JSON.parse(await readFile(resolve(remapPath), "utf8")) as Record<string, unknown>)
    : {};
  const projectRoots =
    remap.project_roots && typeof remap.project_roots === "object"
      ? (remap.project_roots as Record<string, string>)
      : {};
  const rawArtifactRoots =
    remap.raw_artifact_roots && typeof remap.raw_artifact_roots === "object"
      ? (remap.raw_artifact_roots as Record<string, string>)
      : {};
  const projects = rowsOf(tables, "projects").map((project) => {
    const oldPrimaryPath = String(project.primary_path ?? "");
    return {
      project_id: project.id,
      name: project.name,
      old_primary_path: oldPrimaryPath,
      new_primary_path: projectRoots[oldPrimaryPath] ?? oldPrimaryPath,
      needs_mapping: oldPrimaryPath.length > 0 && projectRoots[oldPrimaryPath] === undefined
    };
  });
  const rawArtifacts = rowsOf(tables, "raw_artifacts");
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "restore_plan",
        writes_database: false,
        production_overwritten: false,
        schema_version: manifest.schema_version,
        projects,
        raw_artifacts: {
          count: rawArtifacts.length,
          remapped_roots: rawArtifactRoots
        },
        secret_references: remap.secret_refs ?? {},
        connector_accounts: remap.connector_accounts ?? {},
        environment_facts: remap.environment_facts ?? {},
        port_assignments: remap.ports ?? {},
        warnings: projects.some((project) => project.needs_mapping)
          ? ["Some project roots have no remap entry."]
          : []
      },
      null,
      2
    )}\n`
  );
}

function parseDaysFlag(argv: readonly string[], name: string, fallback: number) {
  const raw = parseFlag(argv, name);
  if (!raw) return fallback;
  const normalized = raw.endsWith("d") ? raw.slice(0, -1) : raw;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function queryCleanupCandidates(argv: readonly string[]) {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for cleanup analysis");
  const notAccessedDays = parseDaysFlag(argv, "--not-accessed", 90);
  const olderThanDays = parseDaysFlag(argv, "--older-than", 180);
  const limit = Number.parseInt(parseFlag(argv, "--limit") ?? "50", 10);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const stale = await client.query(
      `
        SELECT id AS chunk_id, project_id, source_event_id, left(text, 180) AS excerpt,
               created_at, last_accessed_at, access_count
        FROM chunks
        WHERE archived_at IS NULL
          AND (
            created_at < now() - ($1::int * interval '1 day')
            OR (last_accessed_at IS NULL AND created_at < now() - ($2::int * interval '1 day'))
            OR last_accessed_at < now() - ($2::int * interval '1 day')
          )
        ORDER BY created_at ASC
        LIMIT $3::int
      `,
      [olderThanDays, notAccessedDays, Number.isFinite(limit) ? limit : 50]
    );
    const duplicates = await client.query(
      `
        WITH duplicate_text AS (
          SELECT text
          FROM chunks
          WHERE archived_at IS NULL
          GROUP BY text
          HAVING count(*) > 1
          LIMIT $1::int
        )
        SELECT c.id AS chunk_id, c.project_id, c.source_event_id, left(c.text, 180) AS excerpt,
               c.created_at, c.last_accessed_at, c.access_count
        FROM chunks c
        JOIN duplicate_text d ON d.text = c.text
        WHERE c.archived_at IS NULL
        ORDER BY c.text, c.created_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const superseded = await client.query(
      `
        SELECT c.id AS chunk_id, c.project_id, c.source_event_id, left(c.text, 180) AS excerpt,
               e.src_id AS superseded_by, c.created_at, c.last_accessed_at, c.access_count
        FROM edges e
        JOIN chunks c ON c.id::text = e.dst_id
        WHERE e.relation_type = 'supersedes'
          AND e.dst_kind = 'chunk'
          AND c.archived_at IS NULL
        ORDER BY e.created_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const lowValue = await client.query(
      `
        SELECT id AS chunk_id, project_id, source_event_id, left(text, 180) AS excerpt,
               created_at, last_accessed_at, access_count, token_count_est
        FROM chunks
        WHERE archived_at IS NULL
          AND access_count = 0
          AND token_count_est <= 4
        ORDER BY created_at ASC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const staleMemories = await client.query(
      `
        SELECT id AS memory_id, project_id, scope, memory_type, title, status, use_policy,
               updated_at, superseded_by
        FROM agent_memories
        WHERE status IN ('stale', 'superseded')
        ORDER BY updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const duplicateMemories = await client.query(
      `
        WITH duplicate_memory AS (
          SELECT lower(title) AS normalized_title
          FROM agent_memories
          WHERE status NOT IN ('rejected', 'archived', 'superseded')
          GROUP BY lower(title)
          HAVING count(*) > 1
          LIMIT $1::int
        )
        SELECT m.id AS memory_id, m.project_id, m.scope, m.memory_type, m.title,
               m.status, m.use_policy, m.updated_at
        FROM agent_memories m
        JOIN duplicate_memory d ON d.normalized_title = lower(m.title)
        WHERE m.status NOT IN ('rejected', 'archived', 'superseded')
        ORDER BY lower(m.title), m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const poorProvenanceMemories = await client.query(
      `
        SELECT m.id AS memory_id, m.project_id, m.scope, m.scope_kind, m.scope_id,
               m.memory_type, m.title, m.status, m.use_policy, m.created_by, m.updated_at
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE m.status NOT IN ('rejected', 'archived', 'superseded')
        GROUP BY m.id
        HAVING count(r.memory_id) = 0
        ORDER BY m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    const conflictingConnectorMemories = await client.query(
      `
        WITH connector_groups AS (
          SELECT scope_kind, scope_id, lower(title) AS normalized_title
          FROM agent_memories
          WHERE status IN ('accepted', 'needs_review', 'candidate')
            AND scope_kind = 'connector_account'
            AND scope_id IS NOT NULL
          GROUP BY scope_kind, scope_id, lower(title)
          HAVING count(DISTINCT body) > 1
          LIMIT $1::int
        )
        SELECT m.id AS memory_id, m.project_id, m.scope, m.scope_kind, m.scope_id,
               m.memory_type, m.title, m.status, m.use_policy, m.updated_at
        FROM agent_memories m
        JOIN connector_groups g
          ON g.scope_kind = m.scope_kind
         AND g.scope_id = m.scope_id
         AND g.normalized_title = lower(m.title)
        WHERE m.status IN ('accepted', 'needs_review', 'candidate')
        ORDER BY m.scope_id, lower(m.title), m.updated_at DESC
        LIMIT $1::int
      `,
      [Number.isFinite(limit) ? limit : 50]
    );
    return {
      policy: {
        not_accessed_days: notAccessedDays,
        older_than_days: olderThanDays,
        limit: Number.isFinite(limit) ? limit : 50
      },
      stale_chunks: stale.rows,
      duplicate_chunks: duplicates.rows,
      superseded_chunks: superseded.rows,
      low_value_chunks: lowValue.rows,
      stale_or_superseded_memories: staleMemories.rows,
      duplicate_memories: duplicateMemories.rows,
      poor_provenance_memories: poorProvenanceMemories.rows,
      conflicting_connector_memories: conflictingConnectorMemories.rows
    };
  } finally {
    await client.end();
  }
}

async function runAnalyze(argv: readonly string[]) {
  const report = await queryCleanupCandidates(argv);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "analyze",
        dry_run: argv.includes("--dry-run"),
        writes_database: false,
        report,
        summary: {
          stale_chunks: report.stale_chunks.length,
          duplicate_chunks: report.duplicate_chunks.length,
          superseded_chunks: report.superseded_chunks.length,
          low_value_chunks: report.low_value_chunks.length,
          stale_or_superseded_memories: report.stale_or_superseded_memories.length,
          duplicate_memories: report.duplicate_memories.length,
          poor_provenance_memories: report.poor_provenance_memories.length,
          conflicting_connector_memories: report.conflicting_connector_memories.length
        }
      },
      null,
      2
    )}\n`
  );
}

async function runCleanup(argv: readonly string[]) {
  if (argv.includes("--delete-archived")) {
    throw new Error(
      "POLICY_BLOCKED: cleanup hard delete must route through confirmed erasure policy"
    );
  }
  const dryRun = argv.includes("--dry-run");
  const archiveRequested = argv.includes("--archive");
  const confirmed = argv.includes("--confirm");
  if (!dryRun && (!archiveRequested || !confirmed)) {
    throw new Error("POLICY_BLOCKED: cleanup writes require --archive --confirm");
  }
  const report = await queryCleanupCandidates(argv);
  const candidates = [
    ...report.stale_chunks.map((candidate) => ({ ...candidate, reason: "stale_or_not_accessed" })),
    ...report.duplicate_chunks.map((candidate) => ({ ...candidate, reason: "duplicate_text" })),
    ...report.superseded_chunks.map((candidate) => ({ ...candidate, reason: "superseded" }))
  ];
  const uniqueChunkIds = Array.from(new Set(candidates.map((candidate) => candidate.chunk_id)));
  if (!dryRun && uniqueChunkIds.length > 0) {
    const databaseUrl = process.env.RECALLANT_DATABASE_URL;
    if (!databaseUrl) throw new Error("RECALLANT_DATABASE_URL is required for cleanup");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `
          UPDATE chunks
          SET archived_at = coalesce(archived_at, now())
          WHERE id = ANY($1::uuid[])
        `,
        [uniqueChunkIds]
      );
    } finally {
      await client.end();
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "cleanup",
        dry_run: dryRun,
        writes_database: !dryRun,
        archive_requested: archiveRequested,
        archived_chunk_ids: dryRun ? [] : uniqueChunkIds,
        candidates,
        warnings: dryRun
          ? [
              "Dry run only. No chunks, embeddings, L0 events, raw artifacts, or governed memories were changed."
            ]
          : [
              "Only derived chunks were archived. L0 events, raw artifacts, embeddings, and governed memories were not deleted."
            ]
      },
      null,
      2
    )}\n`
  );
}

async function runSpoolAppend(argv: readonly string[]) {
  const recordKind = parseFlag(argv, "--kind") ?? "turn";
  const role = parseFlag(argv, "--role") ?? "user";
  const text = parseFlag(argv, "--text") ?? "";
  const eventKind = parseFlag(argv, "--event-kind") ?? "other";
  const rawArtifactJson = parseFlag(argv, "--raw-artifact-json");
  const rawArtifacts = rawArtifactJson ? JSON.parse(rawArtifactJson) : [];
  const payload =
    recordKind === "event"
      ? {
          client_kind: "codex",
          event_kind: eventKind,
          text,
          metadata: {},
          raw_artifacts: rawArtifacts
        }
      : { client_kind: "codex", role, text };
  const dedupKey =
    parseFlag(argv, "--dedup-key") ??
    `spool:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  const record = {
    local_id: randomUUID(),
    created_at: new Date().toISOString(),
    record_kind: recordKind,
    dedup_key: dedupKey,
    payload: { ...payload, dedup_key: dedupKey }
  };
  await mkdir(spoolDir(argv), { recursive: true });
  await appendFile(spoolPath(argv), `${JSON.stringify(record)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "spool_append",
        spool_path: spoolPath(argv),
        local_id: record.local_id,
        dedup_key: dedupKey,
        synced: false
      },
      null,
      2
    )}\n`
  );
}

async function runSyncSpool(argv: readonly string[]) {
  const records = await readJsonl(spoolPath(argv));
  const manifest = await readSpoolManifest(argv);
  const unsynced = records.filter((record) => !manifest.synced[String(record.local_id)]);
  if (argv.includes("--dry-run")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "sync_spool",
          dry_run: true,
          writes_database: false,
          unsynced_count: unsynced.length,
          records: unsynced.map((record) => ({
            local_id: record.local_id,
            record_kind: record.record_kind,
            dedup_key: record.dedup_key
          }))
        },
        null,
        2
      )}\n`
    );
    return;
  }
  const database = createRecallantDbFromEnv();
  if (!database) throw new Error("RECALLANT_DATABASE_URL is required for sync-spool");
  const synced = { ...manifest.synced };
  try {
    for (const record of unsynced) {
      const payload = record.payload as Record<string, unknown>;
      const result =
        record.record_kind === "event"
          ? await database.appendEvent({
              client_kind: String(payload.client_kind ?? "codex"),
              event_kind: String(payload.event_kind ?? "other"),
              text: (payload.text as string | null | undefined) ?? null,
              metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
              raw_artifacts: (payload.raw_artifacts as RawArtifactInput[] | undefined) ?? [],
              dedup_key: String(payload.dedup_key ?? record.dedup_key)
            })
          : await database.appendTurn({
              client_kind: String(payload.client_kind ?? "codex"),
              role: payload.role === "assistant" ? "assistant" : "user",
              text: String(payload.text ?? ""),
              dedup_key: String(payload.dedup_key ?? record.dedup_key)
            });
      synced[String(record.local_id)] = {
        server_event_id: result.event_id,
        status: result.status,
        synced_at: new Date().toISOString()
      };
    }
  } finally {
    await database.close();
  }
  await mkdir(spoolDir(argv), { recursive: true });
  await writeFile(spoolManifestPath(argv), `${JSON.stringify({ synced }, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "sync_spool",
        dry_run: false,
        synced_count: unsynced.length,
        manifest_path: spoolManifestPath(argv),
        mappings: synced
      },
      null,
      2
    )}\n`
  );
}

async function runPruneSpool(argv: readonly string[]) {
  if (!argv.includes("--synced")) {
    throw new Error("POLICY_BLOCKED: prune-spool requires --synced");
  }
  const records = await readJsonl(spoolPath(argv));
  const manifest = await readSpoolManifest(argv);
  const kept = records.filter((record) => !manifest.synced[String(record.local_id)]);
  await mkdir(spoolDir(argv), { recursive: true });
  await writeFile(
    spoolPath(argv),
    kept.map((record) => JSON.stringify(record)).join("\n") + (kept.length ? "\n" : "")
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        action: "prune_spool",
        pruned_count: records.length - kept.length,
        kept_unsynced_count: kept.length,
        spool_path: spoolPath(argv)
      },
      null,
      2
    )}\n`
  );
}

async function main(argv: readonly string[]) {
  const command = argv[2];

  if (command === "mcp-server") {
    await runRecallantStdioServer();
    return;
  }
  if (command === "doctor") return runDoctor();
  if (command === "init") return runInit(argv);
  if (command === "discover") return runDiscover(argv);
  if (command === "import") return runImport(argv);
  if (command === "lint-context") return runLintContext(argv);
  if (command === "context") return runContext(argv);
  if (command === "backup") return runBackup(argv);
  if (command === "backup-verify") return runBackupVerify(argv);
  if (command === "restore-plan") return runRestorePlan(argv);
  if (command === "analyze") return runAnalyze(argv);
  if (command === "cleanup") return runCleanup(argv);
  if (command === "spool-append") return runSpoolAppend(argv);
  if (command === "sync-spool") return runSyncSpool(argv);
  if (command === "prune-spool") return runPruneSpool(argv);

  process.stderr.write(
    "Usage: recallant <mcp-server|doctor|init|discover|import|lint-context|context|backup|backup-verify|restore-plan|analyze|cleanup|spool-append|sync-spool|prune-spool>\n"
  );
  process.exitCode = 1;
}

await main(process.argv);
