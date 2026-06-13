/* global console */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
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
    assert(unauthenticated.status === 401, `Workbench did not require auth: ${unauthenticated.status}`);
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
    assert(row.project_count === 1, `${pilot.name} project was not registered: ${JSON.stringify(row)}`);
    assert(row.import_events >= 1, `${pilot.name} did not create import events: ${JSON.stringify(row)}`);
    assert(row.starter_memories === 1, `${pilot.name} missing starter memory: ${JSON.stringify(row)}`);
    assert(
      row.instruction_grade === 0,
      `${pilot.name} promoted imports to instruction-grade without review: ${JSON.stringify(row)}`
    );
    return row;
  } finally {
    await client.end();
  }
}

async function runPilot(originalPath) {
  const sourceRoot = resolve(originalPath);
  const sourceInfo = await stat(sourceRoot);
  assert(sourceInfo.isDirectory(), `${sourceRoot} is not a directory`);
  const name = basename(sourceRoot).replaceAll(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const selectedFiles = await walkCopyPlan(sourceRoot);
  assert(selectedFiles.length > 0, `${sourceRoot} did not produce any safe pilot files`);
  const originalBefore = await snapshotSelectedFiles(sourceRoot, selectedFiles);
  const pilotRoot = await mkdtemp(join(tmpdir(), `recallant-real-pilot-${name}-`));
  sandboxRoots.push(pilotRoot);
  const sandboxPath = join(pilotRoot, name);
  await copySandbox(sourceRoot, sandboxPath, selectedFiles);

  const guided = runJson([
    "attach",
    sandboxPath,
    "--target",
    "codex",
    "--mode",
    "guided",
    "--format",
    "json"
  ]);
  assert(guided.status === "needs_confirmation", `${name} guided attach did not wait: ${JSON.stringify(guided)}`);
  assert(guided.writes_files === false, `${name} guided attach would write files`);
  assert(guided.writes_database === false, `${name} guided attach would write database`);
  assertNoLikelyRawSecrets(guided, `${name} guided attach`);

  const attached = runJson(["attach", sandboxPath, "--target", "codex", "--sandbox", "--format", "json"]);
  assert(attached.status === "attached", `${name} sandbox attach failed: ${JSON.stringify(attached)}`);
  assert(attached.project_id && attached.project_id !== hostProjectId, `${name} did not get a pilot project id`);
  assert(attached.writes_files === true, `${name} sandbox attach did not write sandbox files`);
  assert(attached.writes_database === true, `${name} sandbox attach did not write database`);
  assert(attached.startup_smoke?.status === "ok", `${name} startup smoke failed: ${JSON.stringify(attached.startup_smoke)}`);
  assert(
    attached.review_visibility?.status === "ok",
    `${name} review visibility failed: ${JSON.stringify(attached.review_visibility)}`
  );
  assertNoLikelyRawSecrets(attached, `${name} sandbox attach`);

  const originalAfter = await snapshotSelectedFiles(sourceRoot, selectedFiles);
  assert(
    JSON.stringify(originalAfter) === JSON.stringify(originalBefore),
    `${name} pilot changed the original project`
  );
  const dbChecks = await databaseCheck({ name, project_id: attached.project_id });
  const summary = attached.owner_report?.migration_summary ?? {};
  assert(
    Number(summary.selected_imports ?? 0) >= 1,
    `${name} did not select any imports: ${JSON.stringify(summary)}`
  );
  await stat(join(sandboxPath, ".recallant", "config"));
  await stat(join(sandboxPath, ".recallant", "codex-mcp.json"));
  if (attached.backup?.manifest_path) await stat(join(sandboxPath, ".recallant", "backups"));

  return {
    name,
    original_path: sourceRoot,
    sandbox_path: sandboxPath,
    copied_files: selectedFiles.length,
    project_id: attached.project_id,
    migration_summary: summary,
    database: dbChecks,
    backup_manifest_path: attached.backup?.manifest_path ?? null
  };
}

const projects = parseProjectList();
const pilots = [];
const sandboxRoots = [];
try {
  for (const project of projects) {
    pilots.push(await runPilot(project));
  }
  const browser = await browserCheckPilots(pilots);
  const report = {
    status: "ok",
    projects: pilots.map((pilot) => ({
      name: pilot.name,
      copied_files: pilot.copied_files,
      project_id: pilot.project_id,
      migration_summary: pilot.migration_summary,
      database: pilot.database,
      backup_manifest_path: pilot.backup_manifest_path
        ? relative(pilot.sandbox_path, pilot.backup_manifest_path)
        : null
    })),
    browser
  };
  const reportPath = join(reportDir, "recallant-real-project-pilots.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
} finally {
  if (process.env.RECALLANT_KEEP_REAL_PROJECT_PILOT_SANDBOXES !== "1") {
    for (const sandboxRoot of sandboxRoots) await rm(sandboxRoot, { recursive: true, force: true });
  }
}
