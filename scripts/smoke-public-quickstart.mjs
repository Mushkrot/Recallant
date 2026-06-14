import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    throw new Error(
      `Expected JSON from ${command} ${args.join(" ")}: ${String(error)}\n${output}`
    );
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

const onboard = runJson(
  recallant,
  ["onboard", "--client", "codex", "--install-local-hooks", "--verify", "--format", "json"],
  { cwd: projectDir, timeout: 180000 }
);
assert(onboard.action === "onboard", `Onboard action mismatch: ${JSON.stringify(onboard)}`);
assert(onboard.project_already_attached === false, "Quickstart project should start unattached");
assert(onboard.attached?.status === "attached", `Onboard attach failed: ${JSON.stringify(onboard)}`);
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
  String(onboard.verify?.ask_answer ?? "").includes("The agent remembered this Recallant demo memory"),
  `Onboard ask proof did not recall the demo memory: ${JSON.stringify(onboard.verify)}`
);
assertNoPrivatePathLeak(onboard, "onboard result");

for (const expectedPath of [
  ".recallant/config",
  "AGENTS.md",
  "PROJECT_LOG.md",
  ".recallant/codex-mcp.json",
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
  [
    "ask",
    "what did the agent remember?",
    "--project-dir",
    projectDir,
    "--format",
    "json"
  ],
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

process.stdout.write(
  JSON.stringify(
    {
      status: "ok",
      clean_root: cleanRoot,
      project_dir: projectDir,
      installed_cli: recallant,
      project_id: doctorAfter.capture_readiness?.project_config?.project_id ?? null,
      proof: onboard.verify?.proof,
      structured_proof: onboard.verify?.stages,
      workbench: onboard.workbench,
      capture_ready: doctorAfter.capture_readiness?.ready === true,
      recalled: ask.recalled === true
    },
    null,
    2
  ) + "\n"
);
