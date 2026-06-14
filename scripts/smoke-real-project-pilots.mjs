import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { URL } from "node:url";
import pg from "pg";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

const repoRoot = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/ai/playwright/browsers";
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const hostProjectId = randomUUID();
const reportDir =
  process.env.RECALLANT_REAL_PROJECT_PILOT_REPORT_DIR ??
  join(tmpdir(), "recallant-real-project-pilot-reports");
const rawProjectList = process.env.RECALLANT_REAL_PROJECT_PILOTS ?? "";

const excludedDirs = new Set([
  ".git",
  ".recallant",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "dist",
  "build",
  "output",
  "outputs",
  "Uploads",
  "uploads",
  "downloads",
  "incomplete",
  "logs",
  "secrets",
  "data",
  "archive",
  "torrents",
  "fonts",
  "reports",
  ".config-libreoffice"
]);
const excludedFileNames = new Set([".env", ".env.local", "config.yaml"]);
const allowedExtensions = new Set([
  "",
  ".md",
  ".mdc",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".sh",
  ".dockerignore",
  ".gitignore",
  ".example",
  ".sample",
  ".template"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseProjectList() {
  const projects = rawProjectList
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
  assert(
    projects.length > 0,
    "Set RECALLANT_REAL_PROJECT_PILOTS to a comma-separated list of project paths."
  );
  return projects;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("@playwright/test");
  } catch {
    const requireGlobal = createRequire("/usr/lib/node_modules/@playwright/test/package.json");
    return requireGlobal("@playwright/test");
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cliEnv() {
  return {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: hostProjectId,
    RECALLANT_PROJECT_PATH: repoRoot,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005"
  };
}

function runJson(args) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    env: cliEnv(),
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Command failed to start: recallant ${args.join(" ")}\n${result.error}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command did not return JSON: ${error}\n${result.stdout}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readProjectConfig(projectDir) {
  const configPath = join(projectDir, ".recallant", "config");
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content);
}

function snapshotDigest(snapshot) {
  const hash = createHash("sha256");
  for (const [path, digest] of Object.entries(snapshot).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(path);
    hash.update("\0");
    hash.update(digest);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function boundedPath(path) {
  const tempRelative = relative(tmpdir(), path);
  if (tempRelative && !tempRelative.startsWith("..") && tempRelative !== path) {
    return join("$TMPDIR", tempRelative);
  }
  return join("[redacted-report-dir]", basename(path));
}

function workbenchUrlSummary(url) {
  if (!url) return { available_url: false, origin: null, path: null, project_id_present: false };
  try {
    const parsed = new URL(url);
    return {
      available_url: true,
      origin: parsed.origin,
      path: parsed.pathname,
      view: parsed.searchParams.get("view"),
      project_id_present: Boolean(parsed.searchParams.get("project_id"))
    };
  } catch {
    return {
      available_url: true,
      origin: "[invalid-url-redacted]",
      path: null,
      project_id_present: false
    };
  }
}

function onboardingSummary(payload) {
  const attach = objectValue(payload.attach_details);
  const production = objectValue(attach.production_sensitive);
  const migration = objectValue(attach.migration_summary);
  const verify = objectValue(payload.verify);
  const evidence = objectValue(verify.evidence);
  const stages = objectValue(verify.stages);
  const workbench = objectValue(payload.workbench);
  const reviewQueue = objectValue(workbench.migration_review_queue);
  return {
    status: payload.status,
    command: "recallant onboard <sandbox-copy>",
    storage: {
      status: objectValue(payload.storage).status ?? null,
      configured: objectValue(payload.storage).configured === true,
      reachable: objectValue(payload.storage).reachable === true
    },
    attach: {
      status: objectValue(payload.attached).status ?? null,
      handled_by_onboard: true,
      requested_mode: attach.requested_mode ?? null,
      effective_mode: attach.effective_mode ?? null,
      writes_files: attach.writes_files === true,
      writes_database: attach.writes_database === true,
      production_sensitive: production.production_sensitive === true,
      production_confirmation:
        production.production_sensitive === true ? "handled by onboard --yes" : "not required",
      selected_imports: Number(migration.selected_imports ?? 0),
      review_required: Number(migration.needs_review ?? 0),
      backup_created: Boolean(objectValue(attach.backup).manifest_path)
    },
    connect: {
      status: objectValue(payload.connected).status ?? null,
      install_local_hooks: payload.install_local_hooks === true
    },
    capture_proof: {
      status: verify.status ?? null,
      capture_active: verify.capture_active === true,
      evidence: {
        context_read: evidence.context_read === true,
        memory_write: evidence.memory_write === true,
        checkpoint: evidence.checkpoint === true
      },
      stage_status: objectValue(stages.capture).status ?? null
    },
    recall_proof: {
      status: objectValue(stages.recall).status ?? null,
      answer_present: typeof verify.ask_answer === "string" && verify.ask_answer.length > 0
    },
    workbench: {
      available: workbench.available === true,
      auth_required: workbench.auth_required === true,
      private_by_default: workbench.private_by_default === true,
      project_visible: workbench.project_visible === true,
      url: workbenchUrlSummary(typeof workbench.url === "string" ? workbench.url : null),
      migration_review_queue: {
        import_candidate_count: reviewQueue.import_candidate_count ?? null,
        pending_review: reviewQueue.pending_review ?? null,
        review_needed: reviewQueue.review_needed ?? null
      }
    }
  };
}

function extensionFor(path) {
  const name = basename(path);
  if (name === ".gitignore" || name === ".dockerignore") return name;
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function canCopyFile(relativePath, size) {
  const name = basename(relativePath);
  if (excludedFileNames.has(name)) return false;
  if (size > 128 * 1024) return false;
  if (relativePath.startsWith(".env.") || ["env.example", "example.env"].includes(name)) {
    return true;
  }
  return allowedExtensions.has(extensionFor(relativePath));
}

async function walkCopyPlan(sourceRoot) {
  const selected = [];
  let totalBytes = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(join(sourceRoot, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name) && totalBytes < 2 * 1024 * 1024) await walk(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      let info;
      try {
        info = await stat(join(sourceRoot, rel));
      } catch {
        continue;
      }
      if (!canCopyFile(rel, info.size)) continue;
      if (totalBytes + info.size > 2 * 1024 * 1024) continue;
      selected.push({ path: rel, size: info.size });
      totalBytes += info.size;
    }
  }
  await walk("");
  return selected;
}

async function copySandbox(sourceRoot, sandboxRoot, files) {
  await mkdir(sandboxRoot, { recursive: true });
  for (const file of files) {
    const from = join(sourceRoot, file.path);
    const to = join(sandboxRoot, file.path);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
  }
}

async function snapshotSelectedFiles(sourceRoot, files) {
  const snapshot = {};
  for (const file of files) {
    const path = join(sourceRoot, file.path);
    try {
      const content = await readFile(path);
      snapshot[file.path] = createHash("sha256").update(content).digest("hex");
    } catch {
      snapshot[file.path] = "unreadable";
    }
  }
  return snapshot;
}

function assertNoLikelyRawSecrets(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const patterns = [
    /sk-[A-Za-z0-9_-]{12,}/,
    /ghp_[A-Za-z0-9_]{12,}/,
    /postgres:\/\/[^"\s]+:[^"\s]+@/
  ];
  for (const pattern of patterns) {
    assert(!pattern.test(text), `${label} contains a likely raw secret matching ${pattern}`);
  }
}

async function noHorizontalScroll(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    bodyScrollWidth: globalThis.document.body.scrollWidth
  }));
  assert(
    metrics.scrollWidth <= metrics.innerWidth + 2 &&
      metrics.bodyScrollWidth <= metrics.innerWidth + 2,
    `${label} has horizontal overflow: ${JSON.stringify(metrics)}`
  );
}

async function browserCheckPilots(pilots) {
  const { chromium } = loadPlaywright();
  const token = `real-pilot-${randomUUID()}`;
  process.env.RECALLANT_AUTH_TOKEN = token;
  process.env.RECALLANT_SESSION_SECRET = `real-pilot-session-${randomUUID()}`;
  process.env.RECALLANT_DATABASE_URL = databaseUrl;
  process.env.RECALLANT_DEVELOPER_ID = developerId;
  process.env.RECALLANT_PROJECT_ID = hostProjectId;
  process.env.RECALLANT_PROJECT_PATH = repoRoot;
  process.env.RECALLANT_PUBLIC_SCREENSHOT_MODE = "true";
  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;

  await mkdir(reportDir, { recursive: true });
  const server = createRecallantHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to get Workbench server address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    const unauthenticated = await fetch(`${baseUrl}/review`);
    assert(
      unauthenticated.status === 401,
      `Workbench did not require auth: ${unauthenticated.status}`
    );
    browser = await chromium.launch({ headless: true });
    const screenshots = [];
    for (const pilot of pilots) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { authorization: `Bearer ${token}` }
      });
      await page.goto(`${baseUrl}/review?project_id=${pilot.project_id}&view=review`, {
        waitUntil: "networkidle"
      });
      await page.getByRole("heading", { name: "Recallant Workbench" }).waitFor();
      await page.getByRole("heading", { name: "Review", exact: true }).waitFor();
      await page.getByText("Review decision guide").first().waitFor();
      await page.getByText("Migration review queue").waitFor();
      await page.getByText("Imported evidence").first().waitFor();
      await noHorizontalScroll(page, `${pilot.name} focused Review`);
      const visibleText = await page.locator("body").innerText();
      if (visibleText.includes("Secret reference")) {
        assert(
          visibleText.includes("Review as a secret or capability reference."),
          `${pilot.name} secret-reference row did not explain the review boundary`
        );
      }
      assert(
        !/\.env\.example[\s\S]{0,500}Marked low risk by the import scanner\./.test(visibleText),
        `${pilot.name} showed a confusing low-risk summary for an environment example`
      );
      assert(
        !visibleText.includes(pilot.original_path) && !visibleText.includes(pilot.sandbox_path),
        `${pilot.name} visible Workbench leaked exact filesystem path`
      );
      const screenshotPath = join(reportDir, `recallant-real-pilot-${pilot.name}-review.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);
      await page.close();
    }
    return { base_url: baseUrl, screenshots };
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function databaseCheck(pilot) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const checks = await client.query(
      `
        SELECT
          (SELECT count(*)::int FROM projects WHERE id = $1) AS project_count,
          (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND created_by = 'system' AND metadata->>'attach_bootstrap' = 'true') AS starter_memories,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND use_policy = 'instruction_grade') AS instruction_grade
      `,
      [pilot.project_id]
    );
    const row = checks.rows[0];
    assert(
      row.project_count === 1,
      `${pilot.name} project was not registered: ${JSON.stringify(row)}`
    );
    assert(
      row.import_events >= 1,
      `${pilot.name} did not create import events: ${JSON.stringify(row)}`
    );
    assert(
      row.starter_memories === 1,
      `${pilot.name} missing starter memory: ${JSON.stringify(row)}`
    );
    assert(
      row.instruction_grade === 0,
      `${pilot.name} promoted imports to instruction-grade without review: ${JSON.stringify(row)}`
    );
    return row;
  } finally {
    await client.end();
  }
}

async function lifecycleCheck(projectId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const lifecycle = await client.query(
      `
        SELECT value
        FROM project_settings
        WHERE project_id = $1
          AND key = 'project_lifecycle'
      `,
      [projectId]
    );
    const value = lifecycle.rows[0]?.value ?? {};
    const active = await client.query(
      `
        SELECT count(*)::int AS visible_count
        FROM projects p
        LEFT JOIN project_settings lifecycle
          ON lifecycle.project_id = p.id
         AND lifecycle.key = 'project_lifecycle'
        WHERE p.developer_id = $1
          AND p.id = $2
          AND coalesce(lifecycle.value->>'visibility', 'active') <> 'hidden'
          AND coalesce(lifecycle.value->>'status', 'active') NOT IN ('detached', 'sandbox_cleaned')
      `,
      [developerId, projectId]
    );
    return {
      status: value.status ?? null,
      visibility: value.visibility ?? null,
      searchable: value.searchable ?? null,
      detach_mode: value.detach_mode ?? null,
      visible_in_active_project_list: active.rows[0]?.visible_count === 1
    };
  } finally {
    await client.end();
  }
}

async function cleanupPilot(pilot) {
  const dryRun = runJson([
    "detach",
    "--project-id",
    pilot.project_id,
    "--mode",
    "sandbox",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert(dryRun.status === "pending_confirmation", `${pilot.name} detach dry-run failed`);
  assert(dryRun.writes_database === false, `${pilot.name} detach dry-run changed database`);
  const detached = runJson([
    "detach",
    "--project-id",
    pilot.project_id,
    "--mode",
    "sandbox",
    "--confirm",
    "--format",
    "json"
  ]);
  assert(
    detached.status === "detached",
    `${pilot.name} detach failed: ${JSON.stringify(detached)}`
  );
  assert(
    detached.changes?.physically_deleted_records === 0,
    `${pilot.name} detach physically deleted records`
  );
  assert(detached.changes?.files_changed === 0, `${pilot.name} detach changed project files`);
  const lifecycle = await lifecycleCheck(pilot.project_id);
  assert(lifecycle.status === "sandbox_cleaned", `${pilot.name} lifecycle was not sandbox_cleaned`);
  assert(lifecycle.visibility === "hidden", `${pilot.name} lifecycle was not hidden`);
  assert(
    lifecycle.visible_in_active_project_list === false,
    `${pilot.name} was still visible after lifecycle cleanup`
  );
  return {
    dry_run_status: dryRun.status,
    confirmed_status: detached.status,
    lifecycle,
    physically_deleted_records: detached.changes?.physically_deleted_records ?? null,
    files_changed: detached.changes?.files_changed ?? null
  };
}

async function cleanupSandboxRoots() {
  const keep = process.env.RECALLANT_KEEP_REAL_PROJECT_PILOT_SANDBOXES === "1";
  const roots = [];
  for (const sandboxRoot of sandboxRoots) {
    if (!keep) await rm(sandboxRoot, { recursive: true, force: true });
    roots.push({
      sandbox_root_name: basename(sandboxRoot),
      kept: keep,
      removed: keep ? false : !(await pathExists(sandboxRoot))
    });
  }
  sandboxRootsCleaned = !keep;
  return {
    status: keep ? "kept_by_env" : "removed",
    root_count: roots.length,
    all_removed: keep ? false : roots.every((root) => root.removed),
    roots
  };
}

async function runPilot(originalPath) {
  const sourceRoot = resolve(originalPath);
  const sourceInfo = await stat(sourceRoot);
  assert(sourceInfo.isDirectory(), `${sourceRoot} is not a directory`);
  const name = basename(sourceRoot)
    .replaceAll(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
  const selectedFiles = await walkCopyPlan(sourceRoot);
  assert(selectedFiles.length > 0, `${sourceRoot} did not produce any safe pilot files`);
  const originalBefore = await snapshotSelectedFiles(sourceRoot, selectedFiles);
  const beforeFingerprint = snapshotDigest(originalBefore);
  const pilotRoot = await mkdtemp(join(tmpdir(), `recallant-real-pilot-${name}-`));
  sandboxRoots.push(pilotRoot);
  const sandboxPath = join(pilotRoot, name);
  await copySandbox(sourceRoot, sandboxPath, selectedFiles);

  const onboard = runJson(["onboard", sandboxPath, "--yes", "--format", "json"]);
  assert(onboard.status === "completed", `${name} onboard failed: ${JSON.stringify(onboard)}`);
  assert(
    onboard.client === "codex" &&
      onboard.install_local_hooks === true &&
      onboard.verify_requested === true,
    `${name} onboard did not use beginner defaults: ${JSON.stringify(onboard)}`
  );
  const summary = onboardingSummary(onboard);
  assert(summary.storage.reachable === true, `${name} onboard storage was not reachable`);
  assert(summary.attach.status === "attached", `${name} onboard did not attach`);
  assert(summary.attach.handled_by_onboard === true, `${name} attach was not handled by onboard`);
  assert(
    summary.attach.writes_files === true,
    `${name} onboard attach did not write sandbox files`
  );
  assert(summary.attach.writes_database === true, `${name} onboard attach did not write database`);
  assert(summary.connect.status === "connected", `${name} onboard did not connect codex`);
  assert(summary.capture_proof.status === "passed", `${name} capture proof did not pass`);
  assert(summary.capture_proof.capture_active === true, `${name} capture did not become active`);
  assert(summary.recall_proof.status === "done", `${name} recall proof did not complete`);
  assert(
    summary.recall_proof.answer_present === true,
    `${name} recall proof did not return an answer`
  );
  assert(summary.workbench.available === true, `${name} Workbench outcome was unavailable`);
  assert(summary.workbench.auth_required === true, `${name} Workbench was not auth-required`);
  assert(
    summary.workbench.private_by_default === true,
    `${name} Workbench was not private by default`
  );
  assert(
    summary.workbench.project_visible === true,
    `${name} Workbench did not show project visibility`
  );
  assertNoLikelyRawSecrets(onboard, `${name} onboard`);
  const config = await readProjectConfig(sandboxPath);
  assert(
    config.project_id && config.project_id !== hostProjectId,
    `${name} did not get a pilot project id`
  );

  const originalAfter = await snapshotSelectedFiles(sourceRoot, selectedFiles);
  const afterFingerprint = snapshotDigest(originalAfter);
  assert(
    JSON.stringify(originalAfter) === JSON.stringify(originalBefore),
    `${name} pilot changed the original project`
  );
  assert(
    beforeFingerprint === afterFingerprint,
    `${name} pilot changed the original project fingerprint`
  );
  const dbChecks = await databaseCheck({ name, project_id: config.project_id });
  assert(
    summary.attach.selected_imports >= 1,
    `${name} did not select any imports: ${JSON.stringify(summary.attach)}`
  );
  await stat(join(sandboxPath, ".recallant", "config"));
  await stat(join(sandboxPath, ".recallant", "codex-mcp.json"));
  if (summary.attach.backup_created) await stat(join(sandboxPath, ".recallant", "backups"));

  return {
    name,
    original_path: sourceRoot,
    sandbox_path: sandboxPath,
    sandbox_root: pilotRoot,
    copied_files: selectedFiles.length,
    project_id: config.project_id,
    onboarding: summary,
    database: dbChecks,
    original_integrity: {
      selected_file_count: selectedFiles.length,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint,
      unchanged: true
    }
  };
}

const projects = parseProjectList();
const pilots = [];
const sandboxRoots = [];
let sandboxRootsCleaned = false;
try {
  for (const project of projects) {
    pilots.push(await runPilot(project));
  }
  const browser = await browserCheckPilots(pilots);
  const cleanup = [];
  for (const pilot of pilots) {
    cleanup.push(await cleanupPilot(pilot));
  }
  const tempFiles = await cleanupSandboxRoots();
  const report = {
    status: "ok",
    projects: pilots.map((pilot, index) => ({
      name: pilot.name,
      copied_files: pilot.copied_files,
      project_id: pilot.project_id,
      onboarding: pilot.onboarding,
      database: pilot.database,
      original_integrity: pilot.original_integrity,
      cleanup: cleanup[index]
    })),
    browser: {
      auth_required: true,
      workbench_url: workbenchUrlSummary(browser.base_url),
      screenshots: browser.screenshots.map((screenshot) => boundedPath(screenshot))
    },
    temp_files: tempFiles
  };
  const reportPath = join(reportDir, "recallant-real-project-pilots.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const publicReport = { ...report, report_path: boundedPath(reportPath) };
  const publicReportText = JSON.stringify(publicReport, null, 2);
  for (const project of projects) {
    assert(
      !publicReportText.includes(project),
      `public pilot report leaked source path ${project}`
    );
  }
  for (const pilot of pilots) {
    assert(
      !publicReportText.includes(pilot.sandbox_path),
      `public pilot report leaked sandbox path ${pilot.sandbox_path}`
    );
  }
  process.stdout.write(`${publicReportText}\n`);
} finally {
  if (!sandboxRootsCleaned && process.env.RECALLANT_KEEP_REAL_PROJECT_PILOT_SANDBOXES !== "1") {
    for (const sandboxRoot of sandboxRoots) await rm(sandboxRoot, { recursive: true, force: true });
  }
}
