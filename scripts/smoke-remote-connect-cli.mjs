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
  const startBodies = [];
  const serverState = { startBodies };
  const listener = listen(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/connect/start") {
      startBodies.push(await readJson(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          request_id: `${mode}-request`,
          device_code: `rcl_conn_${mode}_device`,
          poll_token: `rcl_poll_${mode}_token`,
          approve_url: `http://127.0.0.1/approve/${mode}`,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          interval_seconds: 1,
          approval_mode:
            mode === "trusted-approved"
              ? "trusted_device"
              : mode === "bootstrap-approved"
                ? "bootstrap_token"
                : "human_approval",
          bootstrap_token:
            mode === "bootstrap-approved"
              ? {
                  status: "approved",
                  approval_mode: "bootstrap_token",
                  browser_approval_required: false,
                  token_prefix: "bootprefix"
                }
              : null,
          trusted_device:
            mode === "bootstrap-approved"
              ? null
              : mode === "trusted-approved"
                ? {
                    status: "approved",
                    approval_mode: "trusted_device",
                    browser_approval_required: false,
                    device_key_prefix: startBodies.at(-1)?.trusted_device?.device_key_prefix,
                    public_key_fingerprint:
                      startBodies.at(-1)?.trusted_device?.public_key_fingerprint
                  }
                : {
                    status: "fallback",
                    reason: "invalid_device",
                    browser_approval_required: true,
                    device_key_prefix: startBodies.at(-1)?.trusted_device?.device_key_prefix,
                    public_key_fingerprint:
                      startBodies.at(-1)?.trusted_device?.public_key_fingerprint
                  }
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
          approval_mode:
            mode === "trusted-approved"
              ? "trusted_device"
              : mode === "bootstrap-approved"
                ? "bootstrap_token"
                : "human_approval",
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
  return listener.then((value) => ({ ...value, state: serverState }));
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

const cliSource = await readFile(new URL("../apps/cli/src/index.ts", import.meta.url), "utf8");
assert(cliSource.includes("Universal remote beginner flow"), "help missing beginner flow copy");
assert(
  cliSource.includes("registers a local trusted device key"),
  "help missing trusted device copy"
);
assert(cliSource.includes("invite"), "help did not distinguish invite fallback");

const tempProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-"));
const secondProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-second-"));
const tempHome = await mkdtemp(join(tmpdir(), "recallant-connect-home-"));
const approvedServer = await connectServer("approved-after-pending");
const trustedServer = await connectServer("trusted-approved");
const bootstrapServer = await connectServer("bootstrap-approved");
const universalServer = await connectServer("universal-approved");
const universalProject = await mkdtemp(join(tmpdir(), "recallant-connect-universal-"));
const universalHome = await mkdtemp(join(tmpdir(), "recallant-connect-universal-home-"));
try {
  const universal = await runCli(
    [
      "connect",
      universalProject,
      "--server-url",
      universalServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: universalHome }
    }
  );
  assert(universal.status === 0, `universal connect failed: ${universal.stderr}`);
  const universalJson = JSON.parse(universal.stdout);
  assert(universalJson.action === "connect_cloud", "universal connect did not route to remote");
  assert(universalJson.status === "connected", "universal connect did not finish remote connect");
  assert(
    universalServer.state.startBodies.length === 1,
    "universal connect did not start remote request once"
  );
  const universalConfig = await readFile(join(universalProject, ".codex", "config.toml"), "utf8");
  assert(
    universalConfig.includes("remote-bridge") &&
      universalConfig.includes("RECALLANT_REMOTE_MCP_CREDENTIAL_REF"),
    "universal connect did not write remote bridge config"
  );

  const approved = await runCli(
    [
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
    ],
    {
      env: { HOME: tempHome }
    }
  );
  assert(approved.status === 0, `approved connect-cloud failed: ${approved.stderr}`);
  const approvedJson = JSON.parse(approved.stdout);
  assert(approvedJson.status === "connected", "approved flow did not connect");
  assert(approvedJson.doctor_status === "skipped", "skip doctor was not honored");
  assert(
    approvedJson.trusted_device?.store_path?.includes(".config/recallant/trusted-device.json"),
    "trusted device store path missing"
  );
  assert(
    approvedJson.trusted_device?.private_key_printed === false,
    "private key print flag wrong"
  );
  assert(!approved.stdout.includes("PRIVATE KEY"), "connect-cloud printed private key material");
  assert(approvedServer.state.startBodies.length === 1, "connect-cloud did not call start once");
  const startBody = approvedServer.state.startBodies[0];
  assert(
    startBody.trusted_device_registration?.device_key_prefix,
    "start body missing trusted device prefix"
  );
  assert(
    startBody.trusted_device_registration?.public_key_fingerprint,
    "start body missing trusted device fingerprint"
  );
  assert(
    startBody.trusted_device_registration?.public_key_material?.includes("BEGIN PUBLIC KEY"),
    "start body missing trusted device public key"
  );
  assert(
    !JSON.stringify(startBody.trusted_device_registration).includes("PRIVATE KEY"),
    "start body leaked private key"
  );
  assert(startBody.trusted_device?.challenge_nonce, "start body missing trusted challenge nonce");
  assert(
    startBody.trusted_device?.challenge_signature,
    "start body missing trusted challenge signature"
  );
  assert(
    startBody.trusted_device?.public_key_material?.includes("BEGIN PUBLIC KEY"),
    "start body missing trusted challenge public key"
  );
  assert(
    !JSON.stringify(startBody.trusted_device).includes("PRIVATE KEY"),
    "trusted challenge body leaked private key"
  );
  const trustedDeviceStore = await readFile(
    join(tempHome, ".config", "recallant", "trusted-device.json"),
    "utf8"
  );
  assert(trustedDeviceStore.includes("PRIVATE KEY"), "local trusted device private key missing");
  const config = await readFile(join(tempProject, ".codex", "config.toml"), "utf8");
  assert(config.includes("remote-bridge"), "connect-cloud did not write remote bridge config");
  assert(
    config.includes("RECALLANT_REMOTE_MCP_CREDENTIAL_REF"),
    "remote config did not use credential ref"
  );
  assert(
    !config.includes("rcl_mcp_connect_secret"),
    "remote config embedded raw scoped credential"
  );
  assert(!config.includes("RECALLANT_DATABASE_URL"), "remote config requires database URL");
  const remoteCredentialStore = await readFile(
    join(tempHome, ".config", "recallant", "remote-mcp-credentials.json"),
    "utf8"
  );
  assert(
    remoteCredentialStore.includes("rcl_mcp_connect_secret"),
    "local credential store missing scoped credential"
  );
  const consentReceipt = await readFile(
    join(tempProject, ".recallant", "remote-consent.json"),
    "utf8"
  );
  const parsedConsentReceipt = JSON.parse(consentReceipt);
  assert(
    parsedConsentReceipt.kind === "recallant_remote_agent_consent",
    "connect-cloud did not write remote consent receipt"
  );
  assert(
    parsedConsentReceipt.no_raw_credentials_or_private_keys === true,
    "remote consent receipt missing no-secret assertion"
  );
  assert(
    parsedConsentReceipt.consent_scope?.destination?.endpoint_path === "/api/mcp",
    "remote consent receipt missing MCP endpoint"
  );
  for (const secretClass of [
    ".env",
    "private keys",
    "raw credentials",
    "customer data",
    "provider secrets",
    "database URLs",
    "raw artifacts",
    "backups"
  ]) {
    assert(
      parsedConsentReceipt.consent_scope?.not_sent?.includes(secretClass),
      `remote consent receipt missing ${secretClass}`
    );
  }
  assert(
    !consentReceipt.includes("rcl_mcp_connect_secret"),
    "remote consent receipt leaked raw credential"
  );
  assert(!consentReceipt.includes("PRIVATE KEY"), "remote consent receipt leaked private key text");
  assert(!approved.stdout.includes("credential_hash"), "approved output exposed credential hash");

  const trusted = await runCli(
    [
      "connect-cloud",
      secondProject,
      "--server-url",
      trustedServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ],
    {
      env: { HOME: tempHome }
    }
  );
  assert(trusted.status === 0, `trusted reconnect failed: ${trusted.stderr}`);
  const trustedJson = JSON.parse(trusted.stdout);
  assert(trustedJson.status === "connected", "trusted reconnect did not connect");
  assert(trustedJson.approval_mode === "trusted_device", "trusted reconnect mode missing");
  assert(
    trustedJson.browser_approval_required === false,
    "trusted reconnect still required browser approval"
  );
  assert(
    trustedJson.trusted_device?.created === false,
    "trusted reconnect did not reuse local device key"
  );
  assert(
    trustedJson.trusted_device?.reconnect_status === "approved",
    "trusted reconnect status was not approved"
  );
  assert(trustedServer.state.startBodies.length === 1, "trusted reconnect did not call start once");
  const trustedStartBody = trustedServer.state.startBodies[0];
  assert(
    trustedStartBody.trusted_device?.challenge_signature,
    "trusted reconnect missing challenge signature"
  );
  assert(
    trustedStartBody.trusted_device?.challenge_nonce,
    "trusted reconnect missing challenge nonce"
  );
  assert(
    !JSON.stringify(trustedStartBody.trusted_device).includes("PRIVATE KEY"),
    "trusted reconnect leaked private key"
  );
  assert(!trusted.stdout.includes("/connect/approve"), "trusted reconnect printed approve URL");

  const bootstrapProject = await mkdtemp(join(tmpdir(), "recallant-connect-bootstrap-"));
  const bootstrapHome = await mkdtemp(join(tmpdir(), "recallant-connect-bootstrap-home-"));
  try {
    const bootstrap = await runCli(
      [
        "connect-cloud",
        bootstrapProject,
        "--server-url",
        bootstrapServer.baseUrl,
        "--bootstrap-token",
        "rcl_boot_cli_secret",
        "--poll-timeout-ms",
        "5000",
        "--poll-interval-ms",
        "50",
        "--skip-doctor",
        "--format",
        "json"
      ],
      {
        env: { HOME: bootstrapHome }
      }
    );
    assert(bootstrap.status === 0, `bootstrap connect-cloud failed: ${bootstrap.stderr}`);
    const bootstrapJson = JSON.parse(bootstrap.stdout);
    assert(bootstrapJson.status === "connected", "bootstrap flow did not connect");
    assert(bootstrapJson.approval_mode === "bootstrap_token", "bootstrap approval mode missing");
    assert(
      bootstrapJson.browser_approval_required === false,
      "bootstrap flow still required browser approval"
    );
    assert(
      bootstrapJson.bootstrap_token?.status === "approved",
      "bootstrap token status was not approved"
    );
    assert(
      bootstrapJson.trusted_device?.device_key_prefix === null,
      "bootstrap flow should not create trusted device"
    );
    assert(bootstrapServer.state.startBodies.length === 1, "bootstrap flow did not call start");
    const bootstrapStartBody = bootstrapServer.state.startBodies[0];
    assert(
      bootstrapStartBody.bootstrap_token === "rcl_boot_cli_secret",
      "bootstrap start did not send token"
    );
    assert(!bootstrapStartBody.trusted_device, "bootstrap start sent trusted device");
    assert(!bootstrap.stdout.includes("/connect/approve"), "bootstrap flow printed approve URL");
    await readFile(join(bootstrapHome, ".config", "recallant", "trusted-device.json"), "utf8")
      .then(() => {
        throw new Error("bootstrap flow wrote trusted-device store");
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
  } finally {
    await rm(bootstrapProject, { recursive: true, force: true });
    await rm(bootstrapHome, { recursive: true, force: true });
  }
} finally {
  approvedServer.server.close();
  trustedServer.server.close();
  bootstrapServer.server.close();
  universalServer.server.close();
  await rm(tempProject, { recursive: true, force: true });
  await rm(secondProject, { recursive: true, force: true });
  await rm(tempHome, { recursive: true, force: true });
  await rm(universalProject, { recursive: true, force: true });
  await rm(universalHome, { recursive: true, force: true });
}

for (const mode of ["denied", "expired"]) {
  const server = await connectServer(mode);
  const temp = await mkdtemp(join(tmpdir(), `recallant-connect-${mode}-`));
  const home = await mkdtemp(join(tmpdir(), `recallant-connect-${mode}-home-`));
  try {
    const result = await runCli(
      [
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
      ],
      { env: { HOME: home } }
    );
    assert(result.status !== 0, `${mode} flow unexpectedly succeeded`);
    assert(result.stderr.includes(`remote connect request is ${mode}`), `${mode} error unclear`);
  } finally {
    server.server.close();
    await rm(temp, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

const pendingServer = await connectServer("pending");
const pendingTemp = await mkdtemp(join(tmpdir(), "recallant-connect-timeout-"));
const pendingHome = await mkdtemp(join(tmpdir(), "recallant-connect-timeout-home-"));
try {
  const timeout = await runCli(
    [
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
    ],
    { env: { HOME: pendingHome } }
  );
  assert(timeout.status !== 0, "pending timeout unexpectedly succeeded");
  assert(timeout.stderr.includes("approval timed out"), "timeout error unclear");
} finally {
  pendingServer.server.close();
  await rm(pendingTemp, { recursive: true, force: true });
  await rm(pendingHome, { recursive: true, force: true });
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
        trusted_device: "local_key_created_start_payload_public_only",
        trusted_reconnect: "signed_nonce_without_browser_approval",
        bootstrap_token: "headless_redeem_without_browser_or_trusted_device",
        credential_store: "project_config_ref_local_store_secret",
        consent_receipt: "project_local_non_secret_remote_boundary",
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
