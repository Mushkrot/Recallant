import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

class SecurityHarness {
  constructor() {
    this.requests = [];
  }

  async startSystemActivity(input) {
    return { id: `activity-${this.requests.length + 1}`, ...input };
  }

  async finishSystemActivity() {}

  async createRemoteConnectRequest() {
    const deviceCode = "rcl_conn_security_device";
    const pollToken = "rcl_poll_security_token";
    const request = {
      id: "security-request",
      device_code_prefix: "security",
      poll_token_prefix: "security",
      hash_version: "sha256-v1",
      status: "pending",
      target: "codex",
      project_display_name: "security project",
      project_fingerprint: "fingerprint-redacted",
      project_path_hint_redacted: "path-hash-only",
      repo_remote_hash: null,
      requested_by_ip_hash: null,
      created_by: "remote-connect",
      approved_by: null,
      approved_project_id: null,
      developer_id: null,
      client_id: null,
      credential_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 600_000),
      approved_at: null,
      denied_at: null,
      redeemed_at: null
    };
    this.requests.push(request);
    return { device_code: deviceCode, poll_token: pollToken, request };
  }

  async pollRemoteConnectRequest({ pollToken }) {
    if (pollToken !== "rcl_poll_security_token") return { status: "expired", request: null };
    return { status: "pending", request: this.requests.at(-1) ?? null };
  }

  async getRemoteConnectRequestForApproval() {
    return this.requests.at(-1) ?? null;
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, text, body: parsed };
}

process.env.RECALLANT_REMOTE_CONNECT_RATE_LIMIT_MAX = "2";
const harness = new SecurityHarness();
const server = createRecallantHttpServer({ workbenchDatabase: harness });
const baseUrl = await listen(server);

try {
  const bootstrap = await fetch(`${baseUrl}/connect`);
  assert(bootstrap.status === 200, "/connect was not public");

  const startOne = await postJson(
    baseUrl,
    "/api/connect/start",
    { project_display_name: "security project" },
    { "x-forwarded-for": "198.51.100.10" }
  );
  assert(startOne.status === 200, "first start failed");
  const startTwo = await postJson(
    baseUrl,
    "/api/connect/start",
    { project_display_name: "security project" },
    { "x-forwarded-for": "198.51.100.10" }
  );
  assert(startTwo.status === 200, "second start failed before rate limit");
  const startThree = await postJson(
    baseUrl,
    "/api/connect/start",
    { project_display_name: "security project", bootstrap_token: "rcl_boot_security_token" },
    { "x-forwarded-for": "198.51.100.10" }
  );
  assert(startThree.status === 409, "rate-limited start did not fail");
  assert(startThree.text.includes("RATE_LIMITED"), "rate limit error did not name RATE_LIMITED");
  assert(
    !startThree.text.includes(startOne.body.device_code),
    "rate limit error echoed device code"
  );

  const oversizedSecret = `rcl_poll_${"x".repeat(20_000)}`;
  const oversized = await postJson(
    baseUrl,
    "/api/connect/poll",
    { poll_token: oversizedSecret },
    { "x-forwarded-for": "198.51.100.11" }
  );
  assert(oversized.status === 409, "oversized poll did not fail");
  assert(!oversized.text.includes(oversizedSecret), "oversized error echoed raw poll token");

  const wrongPoll = await postJson(
    baseUrl,
    "/api/connect/poll",
    { poll_token: "rcl_poll_wrong_secret" },
    { "x-forwarded-for": "198.51.100.12" }
  );
  assert(wrongPoll.status === 200, "wrong poll should return safe terminal state");
  assert(wrongPoll.body.status === "expired", "wrong poll did not return safe expired state");
  assert(!wrongPoll.text.includes("one_time_secret"), "wrong poll exposed credential");

  for (const path of [
    "/connect/approve?code=rcl_conn_security_device",
    "/",
    "/review",
    "/api/review-dashboard"
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert(response.status === 401, `${path} was not protected`);
  }
  for (const path of [
    "/api/remote-credential",
    "/api/remote-invite",
    "/api/connect/bootstrap-token"
  ]) {
    const response = await postJson(baseUrl, path, {});
    assert(response.status === 401, `${path} was not protected`);
  }

  const mcp = await postJson(baseUrl, "/api/mcp", {});
  assert(
    [400, 401, 503].includes(mcp.status),
    "/api/mcp did not return a bounded remote MCP auth/scope/unavailable error"
  );
  assert(mcp.text.includes("jsonrpc"), "/api/mcp did not return a JSON-RPC error envelope");

  const docs = await readFile(new URL("../docs/REMOTE_CONNECT_PLAN.md", import.meta.url), "utf8");
  for (const marker of [
    "/connect",
    "/api/connect/start",
    "/api/connect/poll",
    "/api/connect/cancel",
    "/api/connect/bootstrap-token",
    "/j/*",
    "/api/remote-invite/redeem",
    "/api/mcp*",
    "Rollback"
  ]) {
    assert(docs.includes(marker), `edge guidance missing ${marker}`);
  }

  const combined = [
    startOne.text,
    startTwo.text,
    startThree.text,
    oversized.text,
    wrongPoll.text,
    JSON.stringify(harness.requests)
  ].join("\n");
  assert(!combined.includes(hashSecret(startOne.body.device_code)), "output leaked device hash");
  assert(!combined.includes(hashSecret(startOne.body.poll_token)), "output leaked poll hash");
  assert(!combined.includes("device_code_hash"), "output exposed device_code_hash");
  assert(!combined.includes("poll_token_hash"), "output exposed poll_token_hash");
  assert(!combined.includes("credential_hash"), "output exposed credential_hash");

  process.stdout.write(
    JSON.stringify(
      {
        remote_connect_security_smoke: {
          status: "pass",
          public_routes: [
            "/connect",
            "/api/connect/start",
            "/api/connect/poll",
            "/j/*",
            "/api/remote-invite/redeem",
            "/api/mcp*"
          ],
          protected_routes: [
            "/connect/approve",
            "/",
            "/review",
            "/api/review-dashboard",
            "/api/remote-credential",
            "/api/remote-invite",
            "/api/connect/bootstrap-token"
          ],
          rate_limit: "start_route_guarded",
          payload_limit: "poll_payload_guarded",
          wrong_code_poll: "no_credential",
          redaction: "raw_device_poll_hash_and_credential_absent",
          edge_guidance: "documented_with_rollback"
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
