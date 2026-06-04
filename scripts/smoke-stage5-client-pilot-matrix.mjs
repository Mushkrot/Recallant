import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const cliPath = resolve("apps/cli/dist/index.js");
const reportDir = join(tmpdir(), "recallant-pilot-reports");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCli(projectDir, args) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      RECALLANT_DATABASE_URL: databaseUrl,
      RECALLANT_DEVELOPER_ID: developerId,
      RECALLANT_PROJECT_ID: "",
      RECALLANT_PROJECT_PATH: ""
    },
    maxBuffer: 12 * 1024 * 1024
  }).catch((error) => error);
  if (result.code !== undefined) {
    throw new Error(
      `Command failed: recallant ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`
    );
  }
  const stdout = result.stdout ?? "";
  return stdout.trim() ? JSON.parse(stdout) : {};
}

const projectDir = await mkdtemp(join(tmpdir(), "recallant-stage5-client-pilot-"));
await writeFile(
  join(projectDir, "README.md"),
  ["# Recallant Stage 5 Client Pilot", "", "Temporary multi-client pilot fixture."].join("\n")
);

const marker = `CLIENT_STAGE5_${randomUUID().replaceAll("-", "_")}`;

const attach = await runCli(projectDir, ["attach", ".", "--sandbox", "--format", "json"]);
assert(attach.status === "attached" && attach.project_id, `attach failed: ${JSON.stringify(attach)}`);

const codexConnect = await runCli(projectDir, [
  "connect",
  "codex",
  "--project-dir",
  ".",
  "--format",
  "json"
]);
assert(
  codexConnect.client === "codex" &&
    codexConnect.connection_status &&
    codexConnect.writes_global_config === false,
  `codex connect did not report safe project-local status: ${JSON.stringify(codexConnect)}`
);

await writeFile(
  join(projectDir, ".cursor", "mcp.json"),
  `${JSON.stringify({ mcpServers: { existing_search: { command: "search-helper", args: ["stdio"] } } }, null, 2)}\n`
).catch(async (error) => {
  if (error.code !== "ENOENT") throw error;
  await mkdir(join(projectDir, ".cursor"), { recursive: true });
  await writeFile(
    join(projectDir, ".cursor", "mcp.json"),
    `${JSON.stringify({ mcpServers: { existing_search: { command: "search-helper", args: ["stdio"] } } }, null, 2)}\n`
  );
});
const cursorDryRun = await runCli(projectDir, [
  "connect",
  "cursor",
  "--project-dir",
  ".",
  "--dry-run",
  "--format",
  "json"
]);
assert(
  cursorDryRun.client === "cursor" &&
    cursorDryRun.config_file === ".cursor/mcp.json" &&
    cursorDryRun.writes_files === false &&
    cursorDryRun.writes_global_config === false,
  `cursor dry-run should be configured-only and no-write: ${JSON.stringify(cursorDryRun)}`
);
const cursorConnected = await runCli(projectDir, [
  "connect",
  "cursor",
  "--project-dir",
  ".",
  "--format",
  "json"
]);
assert(
  cursorConnected.client === "cursor" &&
    cursorConnected.writes_global_config === false &&
    cursorConnected.planned_changes.some((change) => change.action === "merge_file"),
  `cursor project-local connect did not merge local config: ${JSON.stringify(cursorConnected)}`
);
const cursorConfig = JSON.parse(await readFile(join(projectDir, ".cursor", "mcp.json"), "utf8"));
assert(
  cursorConfig.mcpServers?.existing_search?.command === "search-helper" &&
    cursorConfig.mcpServers?.recallant?.args?.includes("mcp-server"),
  `cursor local config did not preserve existing server and add Recallant: ${JSON.stringify(cursorConfig)}`
);

const demo = await runCli(projectDir, [
  "demo-capture",
  "--project-dir",
  ".",
  "--marker",
  marker,
  "--format",
  "json"
]);
assert(
  demo.proof?.session_started === true &&
    demo.proof?.memory_written === true &&
    demo.proof?.checkpoint_exists === true &&
    demo.proof?.later_recall_works === true,
  `codex demo-capture proof failed: ${JSON.stringify(demo)}`
);

const doctor = await runCli(projectDir, [
  "doctor",
  "--project-dir",
  ".",
  "--require-capture",
  "--format",
  "json"
]);
assert(
  doctor.capture_readiness?.ready === true &&
    doctor.capture_readiness?.status === "capture_active" &&
    doctor.owner_summary?.actually_recording === true,
  `doctor --require-capture did not prove codex capture: ${JSON.stringify(doctor)}`
);

const ask = await runCli(projectDir, [
  "ask",
  "what did the agent remember?",
  "--project-dir",
  ".",
  "--format",
  "json"
]);
assert(
  ask.recalled === true && ask.memories?.some((memory) => String(memory.body ?? "").includes(marker)),
  `ask did not recall client pilot marker: ${JSON.stringify(ask)}`
);

const detachDryRun = await runCli(projectDir, [
  "detach",
  "--project-id",
  attach.project_id,
  "--project-dir",
  ".",
  "--mode",
  "sandbox",
  "--dry-run",
  "--format",
  "json"
]);
assert(
  detachDryRun.status === "pending_confirmation" && detachDryRun.writes_database === false,
  `detach dry-run failed: ${JSON.stringify(detachDryRun)}`
);
const detach = await runCli(projectDir, [
  "detach",
  "--project-id",
  attach.project_id,
  "--project-dir",
  ".",
  "--mode",
  "sandbox",
  "--confirm",
  "--format",
  "json"
]);
assert(
  detach.status === "detached" && detach.changes?.physically_deleted_records === 0,
  `detach cleanup failed: ${JSON.stringify(detach)}`
);

await mkdir(reportDir, { recursive: true });
const reportPath = join(
  reportDir,
  `stage5-client-pilot-matrix-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`
);
const nativeHooks = doctor.client_connection?.native_hooks ?? [];
const report = {
  ok: true,
  stage: 5,
  goal: "5.7 Real Client Pilot Matrix",
  project: {
    project_id: attach.project_id,
    project_path_redacted: true,
    temp_project_only: true,
    global_config_changed: false
  },
  clients: [
    {
      client: "codex",
      state: "capture_active",
      connect_state: codexConnect.connection_status,
      hook_state:
        nativeHooks.find((entry) => entry.client === "codex")?.status ??
        codexConnect.hook_status ??
        "unknown",
      capture_proof: {
        demo_capture: demo.proof,
        doctor_require_capture: doctor.capture_readiness?.status,
        ask_recalled: ask.recalled === true
      },
      closeout: "demo-capture closeout recorded",
      cleanup: detach.status
    },
    {
      client: "cursor",
      state: "configured_only",
      connect_state: cursorConnected.connection_status,
      hook_state:
        nativeHooks.find((entry) => entry.client === "cursor")?.status ??
        cursorConnected.hook_status ??
        "unsupported_native_hooks",
      capture_proof: "not expected in this pilot; Cursor path is project-local MCP config only",
      global_config_changed: false,
      project_local_config: ".cursor/mcp.json"
    }
  ],
  cleanup: {
    dry_run_status: detachDryRun.status,
    confirmed_status: detach.status,
    physically_deleted_records: detach.changes.physically_deleted_records
  },
  report_path: reportPath
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Stage 5 client pilot matrix smoke passed\n${reportPath}\n`);
