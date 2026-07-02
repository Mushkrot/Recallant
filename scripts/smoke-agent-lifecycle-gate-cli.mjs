import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "apps", "cli", "dist", "index.js");
const cliUrl = pathToFileURL(cliPath).href;
const { buildAgentLifecycleCloseoutResult } = await import("../packages/contracts/dist/index.js");
let cliImportCounter = 0;

const forbiddenNeedles = [
  ["RECALLANT", "DATABASE", "URL"].join("_"),
  ["postgres", "://", "secret"].join(""),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" "),
  ["raw", "artifact", "body"].join("_")
];

function assertNoForbiddenStrings(text, label) {
  for (const needle of forbiddenNeedles) {
    assert(!text.includes(needle), `${label} leaked forbidden fixture: ${needle}`);
  }
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${label} did not return JSON: ${error instanceof Error ? error.message : error}`
    );
  }
}

async function runCli(args, options = {}) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousEnv = new Map();
  const env = options.env ?? {};
  for (const key of Object.keys(env)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = env[key];
  }

  let stdout = "";
  let stderr = "";
  const previousStdoutWrite = process.stdout.write;
  const previousStderrWrite = process.stderr.write;
  process.stdout.write = function writeStdout(chunk, encoding, callback) {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  process.stderr.write = function writeStderr(chunk, encoding, callback) {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };

  let status = 0;
  try {
    process.argv = [process.execPath, cliPath, ...args];
    process.exitCode = undefined;
    await import(`${cliUrl}?agent_lifecycle_gate_smoke=${cliImportCounter++}`);
    status = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    status = 1;
    stderr += `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
  } finally {
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    process.stdout.write = previousStdoutWrite;
    process.stderr.write = previousStderrWrite;
    for (const [key, value] of previousEnv.entries()) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const result = { status, stdout, stderr };
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assertNoForbiddenStrings(combined, options.label ?? args.join(" "));
  return result;
}

function contractProof() {
  const memoryId = "memory-1";
  return {
    event: { ok: true, event_written: true, event_id: "event-1" },
    checkpoint: {
      ok: true,
      checkpoint_updated: true,
      checkpoint_updated_at: "2026-07-02T00:00:00.000Z",
      checkpoint_state_only: true
    },
    memory: {
      ok: true,
      searchable_memory_created: true,
      memory_status: "accepted",
      memory_id: memoryId,
      memory_type: "work_log"
    },
    recall: {
      ok: true,
      recall_verified: true,
      query: "agent-closeout-lifecycle:fixture",
      marker_found: true,
      recalled_memory_ids: [memoryId],
      checked_at: "2026-07-02T00:00:01.000Z"
    },
    next_session_context: {
      ok: true,
      next_session_context_verified: true,
      session_id: "session-2",
      context_pack_id: "context-pack-1",
      marker_found: true,
      checked_at: "2026-07-02T00:00:02.000Z"
    }
  };
}

function assertReadyLifecycle(lifecycle, label) {
  assert(lifecycle.next_agent_ready === true, `${label} did not become next-agent ready`);
  assert(lifecycle.proof.event.event_written === true, `${label} missing event proof`);
  assert(
    lifecycle.proof.checkpoint.checkpoint_updated === true,
    `${label} missing checkpoint proof`
  );
  assert(
    lifecycle.proof.memory.searchable_memory_created === true,
    `${label} missing memory proof`
  );
  assert(lifecycle.proof.recall.recall_verified === true, `${label} missing recall proof`);
  assert(
    lifecycle.proof.next_session_context.next_session_context_verified === true,
    `${label} missing next-session context proof`
  );
}

function assertContractPositive() {
  const lifecycle = buildAgentLifecycleCloseoutResult({
    mode: "server",
    project_id: "project-1",
    session_id: "session-1",
    closeout_event_id: "event-1",
    proof: contractProof()
  });
  assertReadyLifecycle(lifecycle, "contract server fixture");
  assert(lifecycle.failure_reasons.length === 0, "contract server fixture had failure reasons");
  assertNoForbiddenStrings(JSON.stringify(lifecycle), "contract server fixture");
}

async function withTempProject(callback) {
  const dir = await mkdtemp(join(tmpdir(), "recallant-agent-lifecycle-gate-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function assertOfflineSpoolCloseout() {
  return withTempProject(async (projectDir) => {
    const offlineEnv = {
      RECALLANT_DATABASE_URL: "",
      RECALLANT_ENV_FILE: join(projectDir, "missing.env")
    };
    const start = await runCli(
      [
        "agent-start",
        "--project-dir",
        projectDir,
        "--format",
        "json",
        "--task-hint",
        "agent lifecycle gate offline smoke"
      ],
      { env: offlineEnv, label: "offline agent-start" }
    );
    assert(start.status === 0, `offline agent-start failed: ${start.stderr}`);

    const closeout = await runCli(
      [
        "agent-closeout",
        "--project-dir",
        projectDir,
        "--status",
        "closed",
        "--focus",
        "agent lifecycle gate offline smoke",
        "--next-step",
        "resume later",
        "--summary",
        "agent lifecycle gate offline smoke"
      ],
      { env: offlineEnv, label: "offline agent-closeout" }
    );
    assert(closeout.status === 0, `offline agent-closeout failed: ${closeout.stderr}`);
    const output = parseJson(closeout.stdout, "offline agent-closeout");
    assert(output.lifecycle.next_agent_ready === false, "offline closeout returned ready");
    assert(
      output.lifecycle.failure_reasons.includes("server_unavailable_or_spooled"),
      "offline closeout missing server_unavailable_or_spooled"
    );
  });
}

async function assertNoActiveSessionCloseout() {
  return withTempProject(async (projectDir) => {
    const result = await runCli(
      ["agent-closeout", "--project-dir", projectDir, "--summary", "no active session smoke"],
      {
        env: {
          RECALLANT_DATABASE_URL: "",
          RECALLANT_ENV_FILE: join(projectDir, "missing.env")
        },
        label: "no-active-session agent-closeout"
      }
    );
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert(result.status !== 0, "no-active-session closeout unexpectedly succeeded");
    assert(combined.includes("VALIDATION_ERROR"), "no-active-session closeout was not clear");
    assert(
      !combined.includes('"next_agent_ready": true'),
      "no-active-session closeout pretended readiness"
    );
  });
}

async function assertLiveCliPositiveIfRequested() {
  const liveRequested = process.env.RECALLANT_AGENT_LIFECYCLE_LIVE === "1";
  if (!liveRequested || !process.env.RECALLANT_DATABASE_URL) {
    return { status: "skipped_host_live_only", cases: 0 };
  }

  await withTempProject(async (projectDir) => {
    const start = await runCli(
      [
        "agent-start",
        "--project-dir",
        projectDir,
        "--format",
        "json",
        "--task-hint",
        "agent lifecycle gate live positive smoke"
      ],
      { label: "live agent-start" }
    );
    assert(start.status === 0, `live agent-start failed: ${start.stderr}`);

    const closeout = await runCli(
      [
        "agent-closeout",
        "--project-dir",
        projectDir,
        "--summary",
        "agent lifecycle gate live positive smoke",
        "--focus",
        "agent lifecycle gate live positive smoke",
        "--next-step",
        "next agent should recover this closeout from context"
      ],
      { label: "live agent-closeout" }
    );
    assert(closeout.status === 0, `live agent-closeout failed: ${closeout.stderr}`);
    const output = parseJson(closeout.stdout, "live agent-closeout");
    assertReadyLifecycle(output.lifecycle, "live CLI server closeout");
  });

  return { status: "passed", cases: 1 };
}

assertContractPositive();
await assertOfflineSpoolCloseout();
await assertNoActiveSessionCloseout();
const livePositive = await assertLiveCliPositiveIfRequested();

process.stdout.write(
  JSON.stringify(
    {
      agent_lifecycle_gate_smoke: "passed",
      cli_positive_cases: livePositive.cases,
      cli_positive_status: livePositive.status,
      contract_positive_cases: 1,
      cli_negative_cases: 2,
      forbidden_output_check: "passed"
    },
    null,
    2
  ) + "\n"
);
