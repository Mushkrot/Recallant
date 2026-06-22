import { createHash } from "node:crypto";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function prefix(secret, kind) {
  const parts = secret.split("_");
  return parts.length === 4 && parts[0] === "rcl" && parts[1] === kind ? parts[2] : null;
}

function withoutHashes(row) {
  const copy = { ...row };
  delete copy.device_code_hash;
  delete copy.poll_token_hash;
  if ((copy.status === "pending" || copy.status === "approved") && copy.expires_at <= Date.now()) {
    copy.status = "expired";
  }
  return copy;
}

class RemoteConnectServerHarness {
  constructor() {
    this.rows = [];
    this.counter = 0;
    this.auditRows = [];
  }

  async startSystemActivity(input) {
    const row = { id: `activity-${this.auditRows.length + 1}`, ...input };
    this.auditRows.push(row);
    return row;
  }

  async finishSystemActivity(input) {
    this.auditRows.push({ finish: true, ...input });
  }

  next(kind) {
    this.counter += 1;
    return `rcl_${kind}_server${this.counter}_secret${this.counter}`;
  }

  async createRemoteConnectRequest(input = {}) {
    const deviceCode = this.next("conn");
    const pollToken = this.next("poll");
    const row = {
      id: `connect-${this.counter}`,
      device_code_prefix: prefix(deviceCode, "conn"),
      device_code_hash: hashSecret(deviceCode),
      poll_token_prefix: prefix(pollToken, "poll"),
      poll_token_hash: hashSecret(pollToken),
      hash_version: "sha256-v1",
      status: "pending",
      target: input.target ?? "codex",
      project_display_name: input.projectDisplayName ?? "server smoke project",
      project_fingerprint: input.projectFingerprint ?? "fingerprint-redacted",
      project_path_hint_redacted: input.projectPathHintRedacted ?? "path-hash-only",
      repo_remote_hash: input.repoRemoteHash ?? null,
      requested_by_ip_hash: input.requestedByIpHash ?? null,
      created_by: "remote-connect",
      approved_by: null,
      approved_project_id: null,
      developer_id: null,
      client_id: null,
      credential_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 600_000),
      approved_at: null,
      denied_at: null,
      redeemed_at: null
    };
    this.rows.push(row);
    return { device_code: deviceCode, poll_token: pollToken, request: withoutHashes(row) };
  }

  findByDevice(deviceCode) {
    const codePrefix = prefix(deviceCode, "conn");
    const codeHash = hashSecret(deviceCode);
    return this.rows.find(
      (row) => row.device_code_prefix === codePrefix && row.device_code_hash === codeHash
    );
  }

  findByPoll(pollToken) {
    const tokenPrefix = prefix(pollToken, "poll");
    const tokenHash = hashSecret(pollToken);
    return this.rows.find(
      (row) => row.poll_token_prefix === tokenPrefix && row.poll_token_hash === tokenHash
    );
  }

  status(row) {
    return (row.status === "pending" || row.status === "approved") &&
      row.expires_at.getTime() <= Date.now()
      ? "expired"
      : row.status;
  }

  async getRemoteConnectRequestForApproval({ deviceCode }) {
    const row = this.findByDevice(deviceCode);
    return row ? withoutHashes(row) : null;
  }

  async approveRemoteConnectRequest({ deviceCode, projectId, developerId, clientId, approvedBy }) {
    const row = this.findByDevice(deviceCode);
    assert(row, "approval request missing");
    const status = this.status(row);
    assert(status === "pending", `cannot approve ${status}`);
    row.status = "approved";
    row.approved_by = approvedBy;
    row.approved_project_id = projectId;
    row.developer_id = developerId;
    row.client_id = clientId ?? "remote-connect-smoke";
    row.approved_at = new Date();
    return withoutHashes(row);
  }

  async denyRemoteConnectRequest({ deviceCode, deniedBy }) {
    const row = this.findByDevice(deviceCode);
    assert(row, "deny request missing");
    const status = this.status(row);
    assert(status === "pending", `cannot deny ${status}`);
    row.status = "denied";
    row.approved_by = deniedBy;
    row.denied_at = new Date();
    return withoutHashes(row);
  }

  async pollRemoteConnectRequest({ pollToken }) {
    const row = this.findByPoll(pollToken);
    if (!row) return { status: "expired", request: null };
    const status = this.status(row);
    if (status !== "approved") {
      if (status === "expired") row.status = "expired";
      return { status, request: withoutHashes(row) };
    }
    const secret = `rcl_mcp_connect${this.counter}_secret${this.counter}`;
    row.status = "redeemed";
    row.credential_id = `credential-${this.counter}`;
    row.redeemed_at = new Date();
    return {
      status: "approved",
      request: withoutHashes(row),
      secret,
      credential: {
        id: row.credential_id,
        project_id: row.approved_project_id,
        developer_id: row.developer_id,
        client_id: row.client_id,
        label: row.project_display_name,
        status: "active",
        credential_prefix: "connect-prefix",
        created_at: new Date(),
        updated_at: new Date(),
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        rotated_from_credential_id: null
      },
      project_id: row.approved_project_id,
      developer_id: row.developer_id,
      client_id: row.client_id,
      target: row.target
    };
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function requestJson(baseUrl, path, body, headers = {}) {
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

const harness = new RemoteConnectServerHarness();
process.env.RECALLANT_AUTH_TOKEN = "remote-connect-server-smoke-token";
const server = createRecallantHttpServer({ workbenchDatabase: harness });
const baseUrl = await listen(server);
const authHeaders = { authorization: "Bearer remote-connect-server-smoke-token" };

try {
  const bootstrap = await fetch(`${baseUrl}/connect`);
  const bootstrapText = await bootstrap.text();
  assert(bootstrap.status === 200, "GET /connect failed");
  assert(bootstrapText.includes("--connect-url"), "bootstrap did not pass connect URL");
  assert(!bootstrapText.includes("RECALLANT_DATABASE_URL"), "bootstrap leaked database URL");

  const unauthorizedApproval = await fetch(
    `${baseUrl}/connect/approve?code=rcl_conn_missing_secret`
  );
  assert(unauthorizedApproval.status === 401, "approval page was not protected");

  const start = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "New Mac project",
    project_fingerprint: "fingerprint-redacted",
    project_path_hint_redacted: "path-hash-only"
  });
  assert(start.status === 200, "connect start failed");
  assert(start.body.device_code?.startsWith("rcl_conn_"), "start did not return device code");
  assert(start.body.poll_token?.startsWith("rcl_poll_"), "start did not return poll token");
  assert(start.body.approve_url?.includes("/connect/approve?code="), "approve URL missing");
  assert(!start.text.includes("device_code_hash"), "start exposed device hash");
  assert(!start.text.includes("poll_token_hash"), "start exposed poll hash");

  const pending = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: start.body.poll_token
  });
  assert(pending.status === 200, "pending poll failed");
  assert(pending.body.status === "pending", "pending poll was not pending");
  assert(!pending.text.includes("one_time_secret"), "pending poll exposed credential secret");

  const approvalPage = await fetch(`${baseUrl}/connect/approve?code=${start.body.device_code}`, {
    headers: authHeaders
  });
  const approvalHtml = await approvalPage.text();
  assert(approvalPage.status === 200, "authenticated approval page failed");
  assert(approvalHtml.includes("New Mac project"), "approval page did not show project metadata");

  const approved = await requestJson(
    baseUrl,
    "/connect/approve",
    {
      action: "approve",
      code: start.body.device_code,
      project_id: "11111111-1111-4111-8111-111111111111",
      developer_id: "22222222-2222-4222-8222-222222222222",
      client_id: "macbook-air"
    },
    authHeaders
  );
  assert(approved.status === 200, "approval action failed");
  assert(approved.body.request.status === "approved", "request not approved");

  const redeemed = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: start.body.poll_token
  });
  assert(redeemed.status === 200, "approved poll failed");
  assert(redeemed.body.status === "approved", "approved poll did not return approved");
  assert(redeemed.body.one_time_secret?.startsWith("rcl_mcp_"), "approved poll missing secret");
  assert(redeemed.body.bootstrap.client_id === "macbook-air", "bootstrap client id mismatch");
  assert(!redeemed.text.includes("credential_hash"), "approved poll exposed credential hash");

  const replay = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: start.body.poll_token
  });
  assert(replay.status === 200, "replay poll failed");
  assert(replay.body.status === "redeemed", "poll replay was redeemable more than once");

  const deniedStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Denied project"
  });
  const denied = await requestJson(
    baseUrl,
    "/connect/approve",
    { action: "deny", code: deniedStart.body.device_code },
    authHeaders
  );
  assert(denied.status === 200, "deny action failed");
  const deniedPoll = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: deniedStart.body.poll_token
  });
  assert(deniedPoll.body.status === "denied", "denied poll did not stay denied");
  assert(!deniedPoll.text.includes("one_time_secret"), "denied poll exposed secret");

  const expiredStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    expires_at: "2000-01-01T00:00:00.000Z"
  });
  const expiredPoll = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: expiredStart.body.poll_token
  });
  assert(expiredPoll.body.status === "expired", "expired poll did not expire");

  const publicRemoteCredential = await requestJson(baseUrl, "/api/remote-credential", {
    action: "create"
  });
  assert(publicRemoteCredential.status === 401, "remote credential API was public");

  const allText = [
    start.text,
    pending.text,
    approved.text,
    redeemed.text,
    replay.text,
    denied.text,
    deniedPoll.text,
    expiredPoll.text,
    JSON.stringify(harness.auditRows)
  ].join("\n");
  assert(!allText.includes(hashSecret(start.body.device_code)), "output leaked device hash");
  assert(!allText.includes(hashSecret(start.body.poll_token)), "output leaked poll hash");
  assert(!allText.includes("device_code_hash"), "output exposed device_code_hash field");
  assert(!allText.includes("poll_token_hash"), "output exposed poll_token_hash field");

  process.stdout.write(
    JSON.stringify(
      {
        remote_connect_server_smoke: {
          status: "pass",
          public_routes: ["/connect", "/api/connect/start", "/api/connect/poll"],
          protected_routes: ["/connect/approve", "/api/remote-credential"],
          replay: "redeemed_without_second_secret",
          denied: "denied_without_secret",
          expired: "expired_without_secret",
          redaction: "raw_hash_fields_absent"
        }
      },
      null,
      2
    )
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
