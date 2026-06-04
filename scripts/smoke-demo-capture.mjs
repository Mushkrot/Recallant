import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const projectDir = await mkdtemp(`${tmpdir()}/recallant-demo-capture-`);
const marker = `DEMO-SMOKE-${randomUUID()}`;

const env = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: "",
  RECALLANT_PROJECT_PATH: ""
};

function runJson(args) {
  const output = execFileSync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function runText(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const attach = runJson(["attach", ".", "--sandbox", "--format", "json"]);
  assert(attach.status === "attached", `attach failed: ${JSON.stringify(attach)}`);

  const demoText = runText(["demo-capture", "--marker", marker]);
  assert(
    demoText.includes("Recallant demo capture") &&
      demoText.includes("Session started: yes") &&
      demoText.includes("Memory written: yes") &&
      demoText.includes("Checkpoint exists: yes") &&
      demoText.includes("Later recall works: yes") &&
      demoText.includes("recallant doctor") &&
      demoText.includes("recallant ask"),
    `demo-capture human output did not prove the flow: ${demoText}`
  );

  const doctor = runJson(["doctor", "--project-dir", ".", "--require-capture", "--format", "json"]);
  assert(
    doctor.capture_readiness?.ready === true &&
      doctor.capture_readiness?.status === "capture_active" &&
      doctor.capture_readiness?.database_readiness?.last_context_read_at &&
      doctor.capture_readiness?.database_readiness?.last_memory_write_at &&
      doctor.capture_readiness?.database_readiness?.checkpoint_updated_at,
    `doctor --require-capture did not prove capture: ${JSON.stringify(doctor)}`
  );

  const answer = runJson([
    "ask",
    "what did the agent remember?",
    "--project-dir",
    ".",
    "--format",
    "json"
  ]);
  assert(answer.recalled === true, `ask did not recall memory: ${JSON.stringify(answer)}`);
  assert(
    answer.memories?.some((memory) => String(memory.body ?? "").includes(marker)),
    `ask did not return demo marker: ${JSON.stringify(answer)}`
  );

  const answerText = runText(["ask", "what did the agent remember?", "--project-dir", "."]);
  assert(
    answerText.includes("Recallant answer") && answerText.includes(marker),
    `ask human output did not include recalled memory: ${answerText}`
  );
} finally {
  await rm(projectDir, { recursive: true, force: true });
}

process.stdout.write("Demo capture smoke passed\n");
