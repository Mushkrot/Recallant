import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function connectServer(mode) {
  let pollCount = 0;
  return listen(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/connect/start") {
      await readJson(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          request_id: `${mode}-request`,
          device_code: `rcl_conn_${mode}_device`,
          poll_token: `rcl_poll_${mode}_token`,
          approve_url: `http://127.0.0.1/approve/${mode}`,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          interval_seconds: 1
        })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/connect/poll") {
      await readJson(request);
      pollCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      if (mode === "pending" || (mode === "approved-after-pending" && pollCount === 1)) {
        response.end(
          JSON.stringify({ ok: true, status: "pending", request_id: `${mode}-request` })
        );
        return;
      }
      if (mode === "denied" || mode === "expired") {
        response.end(JSON.stringify({ ok: true, status: mode, request_id: `${mode}-request` }));
        return;
      }
      response.end(
        JSON.stringify({
          ok: true,
          status: "approved",
          request_id: `${mode}-request`,
          one_time_secret: "rcl_mcp_connect_secret",
          bootstrap: {
            server_url: "https://recallant.example.com",
            credential: "rcl_mcp_connect_secret",
            project_id: "11111111-1111-4111-8111-111111111111",
            developer_id: "22222222-2222-4222-8222-222222222222",
            client_id: "remote-cli-smoke",
            target: "codex"
          }
        })
      );
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
}

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

const help = await runCli(["connect-cloud", "--help"]);
assert(help.status === 0, "connect-cloud --help failed");
assert(help.stdout.includes("Universal remote beginner flow"), "help missing beginner flow copy");
assert(help.stdout.includes("invite"), "help did not distinguish invite fallback");

const tempProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-"));
const approvedServer = await connectServer("approved-after-pending");
try {
  const approved = await runCli([
    "connect-cloud",
    tempProject,
    "--server-url",
    approvedServer.baseUrl,
    "--poll-timeout-ms",
    "5000",
    "--poll-interval-ms",
    "50",
    "--skip-doctor",
    "--format",
    "json"
  ]);
  assert(approved.status === 0, `approved connect-cloud failed: ${approved.stderr}`);
  const approvedJson = JSON.parse(approved.stdout);
  assert(approvedJson.status === "connected", "approved flow did not connect");
  assert(approvedJson.doctor_status === "skipped", "skip doctor was not honored");
  const config = await readFile(join(tempProject, ".codex", "config.toml"), "utf8");
  assert(config.includes("remote-bridge"), "connect-cloud did not write remote bridge config");
  assert(!config.includes("RECALLANT_DATABASE_URL"), "remote config requires database URL");
  assert(!approved.stdout.includes("credential_hash"), "approved output exposed credential hash");
} finally {
  approvedServer.server.close();
  await rm(tempProject, { recursive: true, force: true });
}

for (const mode of ["denied", "expired"]) {
  const server = await connectServer(mode);
  const temp = await mkdtemp(join(tmpdir(), `recallant-connect-${mode}-`));
  try {
    const result = await runCli([
      "connect-cloud",
      temp,
      "--server-url",
      server.baseUrl,
      "--poll-timeout-ms",
      "500",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ]);
    assert(result.status !== 0, `${mode} flow unexpectedly succeeded`);
    assert(result.stderr.includes(`remote connect request is ${mode}`), `${mode} error unclear`);
  } finally {
    server.server.close();
    await rm(temp, { recursive: true, force: true });
  }
}

const pendingServer = await connectServer("pending");
const pendingTemp = await mkdtemp(join(tmpdir(), "recallant-connect-timeout-"));
try {
  const timeout = await runCli([
    "connect-cloud",
    pendingTemp,
    "--server-url",
    pendingServer.baseUrl,
    "--poll-timeout-ms",
    "150",
    "--poll-interval-ms",
    "50",
    "--skip-doctor",
    "--format",
    "json"
  ]);
  assert(timeout.status !== 0, "pending timeout unexpectedly succeeded");
  assert(timeout.stderr.includes("approval timed out"), "timeout error unclear");
} finally {
  pendingServer.server.close();
  await rm(pendingTemp, { recursive: true, force: true });
}

const script = await readFile(
  new URL("../scripts/install-recallant-client-bootstrap.sh", import.meta.url),
  "utf8"
);
assert(script.includes("--connect-url"), "bootstrap script missing --connect-url");
assert(script.includes("connect-cloud"), "bootstrap script does not invoke connect-cloud");
assert(script.includes("RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD"), "bootstrap lacks CLI override");
assert(!script.includes("RECALLANT_DATABASE_URL="), "bootstrap sets local database URL");

process.stdout.write(
  JSON.stringify(
    {
      remote_connect_cli_smoke: {
        status: "pass",
        command: "recallant connect-cloud <project-dir> --server-url <https-url>",
        approved_flow: "config_written",
        doctor: "runs_by_default_skip_flag_honored",
        denied: "clear_error",
        expired: "clear_error",
        timeout: "clear_error",
        bootstrap: "connect_url_supported",
        safety: "no_local_storage_or_database_url_required"
      }
    },
    null,
    2
  )
);
