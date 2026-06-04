import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: "",
      RECALLANT_PROJECT_PATH: "",
      RECALLANT_EMBEDDING_PROVIDER: "deterministic",
      RECALLANT_EMBEDDING_DIMS: "8",
      RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
      ...(options.env ?? {})
    },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

function runJson(command, args, options = {}) {
  return JSON.parse(run(command, args, options));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const prefix = await mkdtemp(join(tmpdir(), "recallant-onboarding-prefix-"));
const projectDir = await mkdtemp(join(tmpdir(), "recallant-onboarding-project-"));
await writeFile(join(projectDir, "README.md"), "# Fresh onboarding smoke\n");

run("bash", ["scripts/install-recallant-cli.sh"], {
  env: {
    PREFIX: prefix
  }
});

const recallant = join(prefix, "recallant");
const lint = runJson(recallant, ["lint-context"], { cwd: projectDir });
assert(lint.ok === true, `installed wrapper did not run lint-context: ${JSON.stringify(lint)}`);

const attach = runJson(recallant, ["attach", ".", "--format", "json"], { cwd: projectDir });
assert(attach.status === "attached", `installed wrapper attach failed: ${JSON.stringify(attach)}`);
assert(
  attach.requested_mode === "autopilot" && attach.effective_mode === "autopilot",
  `installed wrapper attach did not use ordinary autopilot: ${JSON.stringify(attach)}`
);

const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
assert(agents.includes("recallant agent-start"), "installed wrapper attach did not write capture runtime instructions");

const start = runJson(recallant, ["agent-start", "--task-hint", "fresh onboarding smoke"], {
  cwd: projectDir
});
assert(start.session_id, `installed wrapper agent-start failed: ${JSON.stringify(start)}`);

const event = runJson(
  recallant,
  [
    "agent-event",
    "--kind",
    "decision",
    "--text",
    "Fresh onboarding smoke decision: installed recallant wrapper can attach and capture work."
  ],
  { cwd: projectDir }
);
assert(event.memory?.status === "accepted", `installed wrapper decision was not captured: ${JSON.stringify(event)}`);

const closeout = runJson(
  recallant,
  ["agent-closeout", "--summary", "Fresh onboarding smoke completed through installed wrapper."],
  { cwd: projectDir }
);
assert(closeout.closeout?.report_required === false, `installed wrapper closeout warned: ${JSON.stringify(closeout)}`);

process.stdout.write("Onboarding CLI smoke passed\n");
