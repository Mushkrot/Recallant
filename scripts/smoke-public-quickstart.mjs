import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const cleanRoot = await mkdtemp(join(tmpdir(), "recallant-public-quickstart-"));
const home = join(cleanRoot, "home");
const prefix = join(cleanRoot, "bin");
const projectDir = join(cleanRoot, "project");
const envFile = join(cleanRoot, "missing.env");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${prefix}:${process.env.PATH ?? ""}`,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: "",
      RECALLANT_PROJECT_PATH: "",
      RECALLANT_ENV_FILE: envFile,
      RECALLANT_EMBEDDING_PROVIDER: "deterministic",
      RECALLANT_EMBEDDING_DIMS: "8",
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
      ...(options.env ?? {})
    },
    encoding: "utf8",
    timeout: options.timeout ?? 120000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`
    );
  }
  return result.stdout;
}

function runJson(command, args, options = {}) {
  const output = run(command, args, options);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}: ${String(error)}\n${output}`);
  }
}

async function runJsonAsync(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${prefix}:${process.env.PATH ?? ""}`,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: "",
      RECALLANT_PROJECT_PATH: "",
      RECALLANT_ENV_FILE: envFile,
      RECALLANT_EMBEDDING_PROVIDER: "deterministic",
      RECALLANT_EMBEDDING_DIMS: "8",
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
      ...(options.env ?? {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}: ${String(error)}\n${stdout}`);
  }
}

function assertNoPrivatePathLeak(value, label) {
  const text = JSON.stringify(value);
  const privateMarkers = [
    ["/ai", "SECURITY"].join("/"),
    ["/ai", "PORTS.yaml"].join("/"),
    ["/ai", "recallant-data"].join("/")
  ];
  for (const marker of privateMarkers) {
    assert(!text.includes(marker), `${label} leaked private host marker: ${marker}`);
  }
}

function acceptanceStatus(checks, warnings) {
  const blockingFailures = checks.filter((check) => check.status === "fail");
  return blockingFailures.length > 0 ? "fail" : warnings.length > 0 ? "pass_with_warnings" : "pass";
}

function makeAcceptanceReport({ checks, warnings, evidence, examples }) {
  const blockingFailures = checks.filter((check) => check.status === "fail");
  return {
    status: acceptanceStatus(checks, warnings),
    blocking_failures: blockingFailures,
    warnings,
    checks,
    evidence,
    examples
  };
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function withAuthRequiredOrigin(callback) {
  const server = createServer((_request, response) => {
    response.writeHead(401, {
      "content-type": "text/plain",
      "www-authenticate": "Bearer"
    });
    response.end("auth required");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to allocate auth origin port");
  try {
    return await callback(`http://127.0.0.1:${address.port}/review`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function publicReadiness(recallant, originUrl, extraEnv = {}) {
  return (
    await runJsonAsync(recallant, ["doctor", "--project-dir", projectDir, "--format", "json"], {
      cwd: projectDir,
      env: {
        RECALLANT_PUBLIC_WORKBENCH_URL: "https://recallant.example.invalid/review",
        RECALLANT_WORKBENCH_ORIGIN_URL: originUrl,
        RECALLANT_CLOUDFLARE_MODE: "enabled",
        RECALLANT_CLOUDFLARE_EDGE_AUTH: "required",
        RECALLANT_ADMIN_EMAILS: "admin@example.invalid",
        ...extraEnv
      }
    })
  ).production_readiness?.public_workbench_readiness;
}

async function workbenchNavigationProof(projectId) {
  const token = `quickstart-workbench-${randomUUID()}`;
  const envSnapshot = snapshotEnv([
    "RECALLANT_DATABASE_URL",
    "RECALLANT_DEVELOPER_ID",
    "RECALLANT_PROJECT_ID",
    "RECALLANT_PROJECT_PATH",
    "RECALLANT_AUTH_TOKEN",
    "RECALLANT_SESSION_SECRET",
    "RECALLANT_CLOUDFLARE_MODE",
    "RECALLANT_CLOUDFLARE_EDGE_AUTH",
    "RECALLANT_ADMIN_EMAILS"
  ]);
  Object.assign(process.env, {
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
    RECALLANT_PROJECT_PATH: projectDir,
    RECALLANT_AUTH_TOKEN: token,
    RECALLANT_SESSION_SECRET: `quickstart-session-${randomUUID()}`
  });
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;
  const server = createRecallantHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Workbench smoke server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const rootResponse = await fetch(`${baseUrl}/review`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const rootHtml = await rootResponse.text();
    const chooserResponse = await fetch(`${baseUrl}/review?choose_project=1&view=review`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const chooserHtml = await chooserResponse.text();
    const selectedResponse = await fetch(`${baseUrl}/review?project_id=${projectId}&view=ask`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const selectedHtml = await selectedResponse.text();
    const rootHome =
      rootResponse.status === 200 &&
      rootHtml.includes("Recallant is recording") &&
      !rootHtml.includes('id="project-chooser"');
    const rootChooser =
      chooserResponse.status === 200 &&
      chooserHtml.includes('id="project-chooser"') &&
      chooserHtml.includes("Choose a project for Review");
    const viewPreserved = chooserHtml.includes(
      `href="/review?project_id=${projectId}&amp;view=review"`
    );
    const selectedContext =
      selectedResponse.status === 200 &&
      selectedHtml.includes('aria-label="Selected project context"') &&
      selectedHtml.includes(`id ${projectId.slice(0, 8)}`);
    assert(rootHome, `Workbench root Home missing: ${rootHtml.slice(0, 900)}`);
    assert(rootChooser, `Workbench explicit chooser missing: ${chooserHtml.slice(0, 900)}`);
    assert(viewPreserved, `Workbench chooser did not preserve view: ${chooserHtml.slice(0, 900)}`);
    assert(
      selectedContext,
      `Workbench selected project context missing: ${selectedHtml.slice(0, 900)}`
    );
    return {
      root_home: rootHome,
      root_chooser: rootChooser,
      view_preserved: viewPreserved,
      selected_project_context: selectedContext
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    restoreEnv(envSnapshot);
  }
}

await mkdir(projectDir, { recursive: true });
await writeFile(
  join(projectDir, "README.md"),
  "# Public quickstart smoke\n\nFresh project for a new-user Recallant quickstart.\n"
);

run("/bin/bash", ["scripts/install-recallant-cli.sh"], {
  env: {
    PREFIX: prefix
  }
});

const recallant = join(prefix, "recallant");
assert(await exists(recallant), "Installer did not create the recallant CLI wrapper");
const wrapperStat = await stat(recallant);
assert((wrapperStat.mode & 0o111) !== 0, "Installed recallant wrapper is not executable");

const version = run(recallant, ["--version"], { cwd: projectDir }).trim();
assert(/^recallant \d+\.\d+\.\d+/.test(version), `Unexpected version output: ${version}`);
assert(
  !/^recallant 0\.0\.0(?:$|[-+])/.test(version),
  `Version output must not be 0.0.0: ${version}`
);

const doctorBefore = runJson(recallant, ["doctor", "--format", "json"], { cwd: projectDir });
assert(
  doctorBefore.postgres?.reachable === true,
  `Fresh doctor could not reach the configured database: ${JSON.stringify(doctorBefore)}`
);
assert(
  doctorBefore.owner_summary?.project_attached === false,
  `Fresh doctor should report unattached project: ${JSON.stringify(doctorBefore.owner_summary)}`
);
assertNoPrivatePathLeak(doctorBefore, "fresh doctor");

const onboard = runJson(recallant, ["onboard", "--yes", "--format", "json"], {
  cwd: projectDir,
  timeout: 180000
});
assert(onboard.action === "onboard", `Onboard action mismatch: ${JSON.stringify(onboard)}`);
assert(onboard.project_already_attached === false, "Quickstart project should start unattached");
assert(
  onboard.client === "codex" &&
    onboard.install_local_hooks === true &&
    onboard.verify_requested === true,
  `Quickstart onboard should keep beginner defaults implicit: ${JSON.stringify(onboard)}`
);
assert(
  onboard.version_control?.status === "initialized" || onboard.version_control?.status === "ready",
  `Onboard version-control safety failed: ${JSON.stringify(onboard.version_control)}`
);
assert(
  onboard.attached?.status === "attached",
  `Onboard attach failed: ${JSON.stringify(onboard)}`
);
assert(
  onboard.connected?.status === "connected",
  `Onboard connect failed: ${JSON.stringify(onboard)}`
);
assert(onboard.verify?.status === "passed", `Onboard verify failed: ${JSON.stringify(onboard)}`);
assert(
  onboard.verify?.proof?.demo === "done" &&
    onboard.verify?.proof?.doctor === "done" &&
    onboard.verify?.proof?.ask === "done",
  `Onboard proof steps incomplete: ${JSON.stringify(onboard.verify)}`
);
assert(
  onboard.verify?.stages?.capture?.status === "done" &&
    onboard.verify?.stages?.readiness?.status === "done" &&
    onboard.verify?.stages?.recall?.status === "done" &&
    onboard.verify?.capture_active === true,
  `Onboard structured proof stages incomplete: ${JSON.stringify(onboard.verify)}`
);
assert(
  onboard.verify?.evidence?.context_read === true &&
    onboard.verify?.evidence?.memory_write === true &&
    onboard.verify?.evidence?.checkpoint === true &&
    onboard.verify?.evidence?.recall === true,
  `Onboard proof evidence incomplete: ${JSON.stringify(onboard.verify?.evidence)}`
);
assert(
  onboard.workbench?.available === true &&
    typeof onboard.workbench?.url === "string" &&
    onboard.workbench.url.includes("/review") &&
    onboard.workbench?.auth_required === true &&
    onboard.workbench?.project_visible === true,
  `Onboard Workbench outcome incomplete: ${JSON.stringify(onboard.workbench)}`
);
assert(
  String(onboard.verify?.ask_answer ?? "").includes(
    "The agent remembered this Recallant demo memory"
  ),
  `Onboard ask proof did not recall the demo memory: ${JSON.stringify(onboard.verify)}`
);
assertNoPrivatePathLeak(onboard, "onboard result");

for (const expectedPath of [
  ".recallant/config",
  "AGENTS.md",
  "PROJECT_LOG.md",
  ".codex/config.toml",
  ".recallant/hooks/manifest.json",
  ".recallant/hooks/start-session.sh",
  ".recallant/hooks/capture-event.sh",
  ".recallant/hooks/checkpoint.sh",
  ".recallant/hooks/closeout.sh"
]) {
  assert(await exists(join(projectDir, expectedPath)), `Onboard did not create ${expectedPath}`);
}

const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
assert(
  agents.includes("recallant agent-start") && agents.includes("recallant agent-closeout"),
  "AGENTS.md does not route future agents into Recallant capture"
);

const doctorAfter = runJson(
  recallant,
  ["doctor", "--project-dir", projectDir, "--require-capture", "--format", "json"],
  { cwd: projectDir }
);
assert(
  doctorAfter.capture_readiness?.ready === true &&
    doctorAfter.owner_summary?.actually_recording === true,
  `doctor --require-capture did not prove capture active: ${JSON.stringify(doctorAfter)}`
);
assertNoPrivatePathLeak(doctorAfter, "capture-active doctor");

const ask = runJson(
  recallant,
  ["ask", "what did the agent remember?", "--project-dir", projectDir, "--format", "json"],
  { cwd: projectDir }
);
assert(ask.recalled === true, `Ask did not recall quickstart memory: ${JSON.stringify(ask)}`);
assert(
  ask.memories?.some((memory) =>
    String(memory.body ?? "").includes("The agent remembered this Recallant demo memory")
  ),
  `Ask did not return the demo memory body: ${JSON.stringify(ask.memories)}`
);
assertNoPrivatePathLeak(ask, "ask result");

const projectId = doctorAfter.capture_readiness?.project_config?.project_id;
assert(projectId, `doctor did not expose project id: ${JSON.stringify(doctorAfter)}`);

const codexConfig = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
assert(
  codexConfig.includes("[mcp_servers.recallant]") &&
    codexConfig.includes('RECALLANT_PROJECT_PATH = "') &&
    codexConfig.includes('env_vars = ["RECALLANT_DATABASE_URL"]'),
  `Codex MCP config did not include project identity/path: ${codexConfig}`
);
const hookManifest = JSON.parse(
  await readFile(join(projectDir, ".recallant", "hooks", "manifest.json"), "utf8")
);
assert(
  hookManifest.hooks?.some?.((hook) => hook.path?.includes("start-session.sh")) ||
    hookManifest.files?.some?.((file) => String(file).includes("start-session.sh")) ||
    JSON.stringify(hookManifest).includes("start-session.sh"),
  `Hook manifest did not include start-session hook: ${JSON.stringify(hookManifest)}`
);

const contextPack = runJson(
  recallant,
  ["context", "--project-dir", projectDir, "--task-hint", "Recallant demo memory"],
  { cwd: projectDir }
);
assert(
  contextPack.sections?.working_memories?.some((memory) =>
    String(memory.body ?? "").includes("The agent remembered this Recallant demo memory")
  ),
  `Context pack did not recall demo memory: ${JSON.stringify(contextPack.sections)}`
);

const projectLog = await readFile(join(projectDir, "PROJECT_LOG.md"), "utf8");
assert(
  projectLog.includes("Project id:") && projectLog.includes(projectId),
  `PROJECT_LOG.md did not preserve attached project checkpoint metadata: ${projectLog}`
);

const pendingChunks = Number(doctorAfter.pending_embeddings?.pending_chunks ?? 0);
assert(pendingChunks === 0, `Quickstart left pending embeddings: ${JSON.stringify(doctorAfter)}`);

const navigation = await workbenchNavigationProof(projectId);
const publicUiReadiness = await withAuthRequiredOrigin(async (originUrl) => {
  const authReady = await publicReadiness(recallant, originUrl);
  const missingEdgeAuth = await publicReadiness(recallant, originUrl, {
    RECALLANT_CLOUDFLARE_EDGE_AUTH: "disabled"
  });
  assert(
    authReady?.status === "auth_ready" &&
      authReady?.ready === true &&
      authReady?.origin?.status === "auth_required",
    `Auth-ready public UI fixture failed: ${JSON.stringify(authReady)}`
  );
  assert(
    missingEdgeAuth?.status === "cloudflare_access_not_required" &&
      missingEdgeAuth?.ready === false,
    `Missing-edge-auth fixture should not be public-ready: ${JSON.stringify(missingEdgeAuth)}`
  );
  return {
    auth_ready: {
      status: authReady.status,
      ready: authReady.ready,
      origin: authReady.origin.status
    },
    missing_edge_auth: {
      status: missingEdgeAuth.status,
      ready: missingEdgeAuth.ready
    }
  };
});

const checks = [
  {
    name: "one_command_onboarding_completed",
    status: onboard.status === "completed" ? "pass" : "fail",
    evidence: onboard.status
  },
  {
    name: "codex_mcp_config_written",
    status: codexConfig.includes("[mcp_servers.recallant]") ? "pass" : "fail",
    evidence: ".codex/config.toml"
  },
  {
    name: "hook_kit_installed",
    status: JSON.stringify(hookManifest).includes("start-session.sh") ? "pass" : "fail",
    evidence: ".recallant/hooks/manifest.json"
  },
  {
    name: "capture_active_doctor",
    status: doctorAfter.capture_readiness?.ready === true ? "pass" : "fail",
    evidence: doctorAfter.capture_readiness?.status ?? "unknown"
  },
  {
    name: "context_pack_recalled_memory",
    status: contextPack.sections?.working_memories?.length > 0 ? "pass" : "fail",
    evidence: contextPack.context_pack_id
  },
  {
    name: "checkpoint_sync_present",
    status: projectLog.includes(projectId) ? "pass" : "fail",
    evidence: "PROJECT_LOG.md"
  },
  {
    name: "workbench_project_navigation",
    status:
      navigation.root_chooser && navigation.view_preserved && navigation.selected_project_context
        ? "pass"
        : "fail",
    evidence: navigation
  },
  {
    name: "embedding_baseline",
    status: pendingChunks === 0 ? "pass" : "fail",
    evidence: {
      provider: "deterministic",
      pending_chunks: pendingChunks,
      recovery_available: doctorAfter.pending_embeddings?.recovery_available === true
    }
  },
  {
    name: "public_ui_readiness_fixture",
    status:
      publicUiReadiness.auth_ready.ready === true &&
      publicUiReadiness.missing_edge_auth.ready === false
        ? "pass"
        : "fail",
    evidence: publicUiReadiness
  }
];
const warnings =
  pendingChunks > 0
    ? [
        {
          code: "pending_embeddings",
          message: `${pendingChunks} embedding chunk(s) are waiting for local model recovery.`
        }
      ]
    : [];
const examples = {
  pass: acceptanceStatus([{ name: "all_required_checks", status: "pass" }], []),
  pass_with_warnings: acceptanceStatus(
    [{ name: "all_required_checks", status: "pass" }],
    [{ code: "pending_embeddings", message: "2 chunks are waiting for local model recovery." }]
  ),
  fail: acceptanceStatus([{ name: "capture_active_doctor", status: "fail" }], [])
};
assert(
  examples.pass === "pass" &&
    examples.pass_with_warnings === "pass_with_warnings" &&
    examples.fail === "fail",
  `Acceptance status examples failed: ${JSON.stringify(examples)}`
);
const acceptanceReport = makeAcceptanceReport({
  checks,
  warnings,
  evidence: {
    onboarding: {
      proof: onboard.verify?.proof,
      structured_proof: onboard.verify?.stages,
      workbench: onboard.workbench
    },
    context_pack: {
      context_pack_id: contextPack.context_pack_id,
      working_memory_count: contextPack.sections?.working_memories?.length ?? 0
    },
    embedding_baseline: {
      provider: "deterministic",
      pending_chunks: pendingChunks,
      recovery_available: doctorAfter.pending_embeddings?.recovery_available === true
    },
    public_ui_readiness: publicUiReadiness,
    workbench_navigation: navigation
  },
  examples
});
assert(
  acceptanceReport.status === "pass",
  `Acceptance report was not pass: ${JSON.stringify(acceptanceReport)}`
);

process.stdout.write(
  JSON.stringify(
    {
      status: "ok",
      clean_root: cleanRoot,
      project_dir: projectDir,
      installed_cli: recallant,
      project_id: projectId,
      proof: onboard.verify?.proof,
      structured_proof: onboard.verify?.stages,
      workbench: onboard.workbench,
      capture_ready: doctorAfter.capture_readiness?.ready === true,
      recalled: ask.recalled === true,
      acceptance_report: acceptanceReport
    },
    null,
    2
  ) + "\n"
);
