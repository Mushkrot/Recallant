import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";

const root = await mkdtemp(join(tmpdir(), "recallant-approval-ux-"));
const project = join(root, "project");
const userHome = join(root, "user");
await mkdir(project);
await mkdir(userHome);
await writeFile(join(root, "empty.env"), "");
const cli = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const isolation = fileURLToPath(
  new URL("./fixtures/connect-approval-browser.mjs", import.meta.url)
);
const terminalDriver = fileURLToPath(
  new URL("./fixtures/connect-approval-pty.py", import.meta.url)
);
const browserReceipt = join(root, "browser.json");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("RECALLANT_"))
);
Object.assign(env, {
  RECALLANT_SMOKE_USER_HOME: userHome,
  RECALLANT_ENV_FILE: join(root, "empty.env"),
  RECALLANT_SMOKE_BROWSER_RECEIPT: browserReceipt
});
let starts = 0;
let polls = 0;
let mode = "pending";
const server = createServer(async (request, response) => {
  for await (const chunk of request) void chunk;
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/connect/start") {
    starts += 1;
    response.end(
      JSON.stringify({
        ok: true,
        request_id: "approval-ux-fixture",
        approve_url: `http://127.0.0.1:${server.address().port}/approve`,
        poll_token: "synthetic-poll-token",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        approval_mode: mode === "trusted-pending" ? "trusted_device" : "human_approval",
        trusted_device: {
          status: mode === "trusted-pending" ? "approved" : "fallback",
          reason: mode === "trusted-pending" ? null : "expired",
          browser_approval_required: mode !== "trusted-pending"
        }
      })
    );
  } else if (request.url === "/api/connect/poll") {
    polls += 1;
    response.end(
      JSON.stringify(
        mode === "approved" && polls > 1
          ? {
              ok: true,
              status: "approved",
              bootstrap: {
                server_url: `http://127.0.0.1:${server.address().port}`,
                credential: "rcl_mcp_approval_ux_fixture",
                project_id: "11111111-1111-4111-8111-111111111111",
                developer_id: "22222222-2222-4222-8222-222222222222",
                client_id: "remote-approval-ux-fixture",
                target: "codex"
              }
            }
          : { ok: true, status: ["approved", "trusted-pending"].includes(mode) ? "pending" : mode }
      )
    );
  } else {
    response.statusCode = 404;
    response.end("{}");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverUrl = `http://127.0.0.1:${server.address().port}`;

function run(args, { tty = false, reply = "yes", browserFails = false } = {}) {
  return new Promise((resolve, reject) => {
    const command = tty ? "python3" : process.execPath;
    const childArgs = tty
      ? [terminalDriver, process.execPath, "--import", isolation, cli, ...args]
      : ["--import", isolation, cli, ...args];
    const child = spawn(command, childArgs, {
      cwd: project,
      env: {
        ...env,
        RECALLANT_SMOKE_PTY_RESPONSE: reply,
        RECALLANT_SMOKE_BROWSER_FAIL: browserFails ? "1" : "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const result = await run([
    "onboard",
    ".",
    "--remote",
    "--server-url",
    serverUrl,
    "--yes",
    "--no-update-check",
    "--format",
    "json",
    "--poll-timeout-ms",
    "100",
    "--poll-interval-ms",
    "25"
  ]);
  assert.notEqual(result.code, 0, "An unapproved connection must not report success");
  assert.ok(
    result.stdout.trim(),
    "Approval timeout must return an actionable result, not only a validation error"
  );
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "approval_required");
  assert.equal(output.approval.reason, "device_trust_expired");
  assert.equal(output.approval.next_action, "approve_in_browser");
  assert.match(output.message, /expired/i);
  assert.match(output.message, /approve/i);
  assert.match(output.next_command, /recallant onboard/);
  assert.equal(result.stderr, "");
  assert.equal(starts, 1);
  assert.ok(polls > 0);
  await assert.rejects(access(browserReceipt));
  await assert.rejects(access(join(project, ".codex", "config.toml")));
  await assert.rejects(access(join(project, ".recallant", "remote-agent-consent.json")));
  console.log(
    "PASS: expired trust produces actionable approval guidance without claiming connection"
  );

  mode = "trusted-pending";
  const provisioning = await run([
    "connect-cloud",
    project,
    "--server-url",
    serverUrl,
    "--yes",
    "--format",
    "json",
    "--poll-timeout-ms",
    "100",
    "--poll-interval-ms",
    "25",
    "--skip-doctor"
  ]);
  const pending = JSON.parse(provisioning.stdout);
  assert.equal(pending.status, "connection_pending");
  assert.equal(pending.approval.next_action, "retry_connection");
  assert.equal(pending.approval.approve_url, null);
  assert.ok(!pending.message.includes("your browser"));
  await assert.rejects(access(browserReceipt));

  for (const outcome of ["denied", "expired"]) {
    mode = outcome;
    const declined = await run([
      "connect-cloud",
      project,
      "--server-url",
      serverUrl,
      "--yes",
      "--format",
      "json",
      "--poll-timeout-ms",
      "100",
      "--poll-interval-ms",
      "25",
      "--skip-doctor"
    ]);
    const result = JSON.parse(declined.stdout);
    assert.equal(result.status, outcome === "denied" ? "approval_denied" : "approval_expired");
    assert.notEqual(declined.code, 0);
    assert.equal(declined.stderr, "");
  }
  mode = "pending";
  polls = 0;
  const cancelled = await run(
    [
      "connect-cloud",
      project,
      "--server-url",
      serverUrl,
      "--yes",
      "--format",
      "text",
      "--poll-timeout-ms",
      "100",
      "--poll-interval-ms",
      "25",
      "--skip-doctor"
    ],
    { tty: true, reply: "cancel" }
  );
  assert.match(cancelled.stdout, /Trust for this computer has expired/);
  assert.match(cancelled.stdout, /Connection cancelled/);
  assert.equal(cancelled.code, 2);
  assert.equal(polls, 0);
  await assert.rejects(access(browserReceipt));
  await assert.rejects(access(join(project, ".codex", "config.toml")));
  console.log("PASS: real terminal explains expired trust and allows cancellation before polling");

  for (const browserFails of [false, true]) {
    mode = "approved";
    polls = 0;
    const approved = await run(
      [
        "connect-cloud",
        project,
        "--server-url",
        serverUrl,
        "--yes",
        "--format",
        "text",
        "--poll-timeout-ms",
        "1000",
        "--poll-interval-ms",
        "25",
        "--skip-doctor"
      ],
      { tty: true, browserFails }
    );
    assert.equal(approved.code, 0, approved.stdout);
    assert.match(approved.stdout, /Trust for this computer has expired/);
    assert.match(
      approved.stdout,
      browserFails ? /browser could not be opened/ : /Approval page opened/
    );
    assert.match(approved.stdout, /Approval received/);
    const opened = JSON.parse(await readFile(browserReceipt, "utf8"));
    assert.equal(opened.command, process.platform === "darwin" ? "open" : "xdg-open");
    assert.deepEqual(opened.args, [`${serverUrl}/approve`]);
    assert.ok(polls > 1);
    assert.ok(!approved.stdout.includes("rcl_mcp_approval_ux_fixture"));
    assert.ok(!approved.stdout.includes("VALIDATION_ERROR"));
    await rm(browserReceipt);
  }
  console.log(
    "PASS: real terminal opens the approval page or explains manual fallback and continues after approval"
  );

  polls = 0;
  const unattended = await run(
    [
      "connect-cloud",
      project,
      "--server-url",
      serverUrl,
      "--yes",
      "--format",
      "text",
      "--non-interactive",
      "--poll-timeout-ms",
      "1000",
      "--poll-interval-ms",
      "25",
      "--skip-doctor"
    ],
    { tty: true }
  );
  assert.equal(unattended.code, 0, unattended.stdout);
  assert.ok(!unattended.stdout.includes("Open approval page now?"));
  await assert.rejects(access(browserReceipt));
  console.log("PASS: non-interactive mode never opens a browser, even in a terminal");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
