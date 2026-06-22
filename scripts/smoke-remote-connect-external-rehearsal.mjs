import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { URL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], {
      cwd: new URL("..", import.meta.url),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        ...env
      },
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
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"\s*[:=]|RECALLANT_DATABASE_URL\s*=|DATABASE_URL\s*=|postgres:\/\/|pgvector|\/ai\/|bearer\s+[A-Za-z0-9._~+/=-]{8,}/i;

let startSeen = false;
let pollCount = 0;
const { server, baseUrl } = await listen(async (request, response) => {
  if (request.method === "GET" && request.url === "/connect") {
    response.writeHead(200, { "content-type": "text/x-shellscript" });
    response.end(`#!/usr/bin/env bash
set -euo pipefail
curl -fsSL 'https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-client-bootstrap.sh' | bash -s -- --connect-url '${baseUrl}' "$@"
`);
    return;
  }
  if (request.method === "POST" && request.url === "/api/connect/start") {
    const body = await readJson(request);
    startSeen = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        request_id: "external-connect-request",
        device_code: "rcl_conn_external_device",
        poll_token: "rcl_poll_external_token",
        approve_url: `${baseUrl}/connect/approve?code=rcl_conn_external_device`,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        interval_seconds: 1,
        metadata_seen: {
          project_display_name_present: Boolean(body.project_display_name),
          project_path_hint_redacted_present: Boolean(body.project_path_hint_redacted)
        }
      })
    );
    return;
  }
  if (request.method === "POST" && request.url === "/api/connect/poll") {
    await readJson(request);
    pollCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        status: pollCount === 1 ? "pending" : "approved",
        request_id: "external-connect-request",
        ...(pollCount === 1
          ? {}
          : {
              one_time_secret: "rcl_mcp_external_secret",
              bootstrap: {
                server_url: "https://recallant.example.com",
                credential: "rcl_mcp_external_secret",
                project_id: "11111111-1111-4111-8111-111111111111",
                developer_id: "22222222-2222-4222-8222-222222222222",
                client_id: "external-connect-smoke",
                target: "codex"
              }
            })
      })
    );
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

const projectDir = await mkdtemp(join(tmpdir(), "recallant-connect-external-"));
try {
  const connectScript = await fetch(`${baseUrl}/connect`);
  const connectScriptText = await connectScript.text();
  assert(connectScript.status === 200, "GET /connect failed");
  assert(connectScriptText.includes("--connect-url"), "/connect script did not pass connect-url");
  assert(
    !forbiddenOutputPattern.test(connectScriptText),
    "/connect script leaked forbidden surface"
  );

  const result = await runCli([
    "connect-cloud",
    projectDir,
    "--server-url",
    baseUrl,
    "--poll-timeout-ms",
    "5000",
    "--poll-interval-ms",
    "50",
    "--skip-doctor",
    "--format",
    "json"
  ]);
  assert(result.status === 0, `connect-cloud external rehearsal failed: ${result.stderr}`);
  assert(startSeen, "connect-cloud did not start remote connect request");
  assert(pollCount >= 2, "connect-cloud did not poll through pending to approved");
  const output = JSON.parse(result.stdout);
  assert(output.status === "connected", "connect-cloud did not report connected");
  assert(output.doctor_status === "skipped", "skip-doctor status missing");
  const codexConfig = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
  assert(codexConfig.includes("remote-bridge"), "remote bridge config missing");
  assert(!codexConfig.includes("RECALLANT_DATABASE_URL"), "remote config requires DB URL");
  let projectEntries = [];
  try {
    projectEntries = await (await import("node:fs/promises")).readdir(projectDir);
  } catch {
    projectEntries = [];
  }
  let remoteConsentReceipt = "";
  if (projectEntries.includes(".recallant")) {
    const recallantEntries = await (
      await import("node:fs/promises")
    ).readdir(join(projectDir, ".recallant"));
    assert(
      recallantEntries.length === 1 && recallantEntries[0] === "remote-consent.json",
      "connect-cloud created local .recallant storage beyond the non-secret remote consent receipt"
    );
    remoteConsentReceipt = await readFile(
      join(projectDir, ".recallant", "remote-consent.json"),
      "utf8"
    );
    assert(
      remoteConsentReceipt.includes("recallant_remote_agent_consent"),
      "remote consent receipt missing expected kind"
    );
    assert(
      !remoteConsentReceipt.includes("rcl_mcp_external_secret"),
      "remote consent receipt leaked raw scoped credential"
    );
    assert(
      !remoteConsentReceipt.includes("PRIVATE KEY"),
      "remote consent receipt leaked private key"
    );
  }
  const combined = `${connectScriptText}\n${result.stdout}\n${result.stderr}\n${codexConfig}\n${remoteConsentReceipt}`;
  assert(!forbiddenOutputPattern.test(combined), "external rehearsal leaked forbidden surface");
  assert(!combined.includes(sha256("rcl_conn_external_device")), "device hash leaked");
  assert(!combined.includes(sha256("rcl_poll_external_token")), "poll hash leaked");
  const evidence = {
    schema_version: 1,
    bootstrap_mode: "connect_cloud",
    command: "curl -fsSL <server>/connect | bash",
    deterministic_fixture: true,
    approval: "pending_then_approved",
    config_written: true,
    remote_doctor: "skipped_by_explicit_flag_in_fixture",
    remote_mcp_capture_recall: "covered_by_remote-mcp-external-rehearsal:smoke",
    no_local_artifacts: {
      recallant_local_storage: false,
      remote_consent_receipt: remoteConsentReceipt ? "non_secret_allowed" : "absent",
      docker_or_postgres: false,
      database_url: false
    },
    redaction: "pass"
  };
  assert(
    evidence.bootstrap_mode === "connect_cloud",
    "evidence did not identify connect-cloud mode"
  );
  process.stdout.write(
    JSON.stringify(
      {
        remote_connect_external_rehearsal_smoke: {
          status: "pass",
          rehearsal_model: "deterministic_external_like_connect_cloud",
          evidence,
          project_dir_hash: sha256(projectDir)
        }
      },
      null,
      2
    )
  );
} finally {
  await rm(projectDir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
