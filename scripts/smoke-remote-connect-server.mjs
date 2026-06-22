import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function trustedDeviceChallengePayload({
  target,
  projectFingerprint,
  projectPathHintRedacted,
  challengeNonce
}) {
  return [
    "recallant-connect-trusted-device-v1",
    `target:${target}`,
    `project_fingerprint:${projectFingerprint ?? ""}`,
    `project_path_hint_redacted:${projectPathHintRedacted ?? ""}`,
    `challenge_nonce:${challengeNonce}`
  ].join("\n");
}

function prefix(secret, kind) {
  const parts = secret.split("_");
  return parts.length === 4 && parts[0] === "rcl" && parts[1] === kind ? parts[2] : null;
}

function withoutHashes(row) {
  const copy = { ...row };
  delete copy.device_code_hash;
  delete copy.poll_token_hash;
  delete copy.trusted_device_public_key_hash;
  delete copy.token_hash;
  if ((copy.status === "pending" || copy.status === "approved") && copy.expires_at <= Date.now()) {
    copy.status = "expired";
  }
  return copy;
}

class RemoteConnectServerHarness {
  constructor() {
    this.rows = [];
    this.trustedDevices = [];
    this.trustedDeviceChallenges = new Set();
    this.bootstrapTokens = [];
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
      trusted_device_key_prefix: input.trustedDeviceKeyPrefix ?? null,
      trusted_device_public_key_fingerprint: input.trustedDevicePublicKeyFingerprint ?? null,
      trusted_device_public_key_hash: input.trustedDevicePublicKeyHash ?? null,
      trusted_device_public_key_algorithm: input.trustedDevicePublicKeyAlgorithm ?? null,
      trusted_device_name: input.trustedDeviceName ?? null,
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

  async getRemoteConnectTrustedDeviceRegistrationForApproval({ deviceCode }) {
    const row = this.findByDevice(deviceCode);
    if (
      !row?.trusted_device_key_prefix ||
      !row.trusted_device_public_key_fingerprint ||
      !row.trusted_device_public_key_hash
    ) {
      return null;
    }
    return {
      device_key_prefix: row.trusted_device_key_prefix,
      public_key_fingerprint: row.trusted_device_public_key_fingerprint,
      public_key_hash: row.trusted_device_public_key_hash,
      public_key_algorithm: row.trusted_device_public_key_algorithm,
      device_name: row.trusted_device_name
    };
  }

  async createMemorySpace(input) {
    this.counter += 1;
    return {
      project_id: `11111111-1111-4111-8111-${String(this.counter).padStart(12, "0")}`,
      developer_id: "22222222-2222-4222-8222-222222222222",
      name: input.name,
      project_kind: input.projectKind ?? "workspace",
      memory_domain: input.memoryDomain ?? "agent_work",
      primary_path: input.primaryPath ?? null
    };
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

  async createRemoteTrustedDevice(input) {
    const row = {
      id: `trusted-device-${this.trustedDevices.length + 1}`,
      developer_id: input.developerId,
      device_key_prefix: input.deviceKeyPrefix,
      device_public_key_fingerprint: input.publicKeyFingerprint,
      device_public_key_hash: input.publicKeyHash,
      hash_version: "sha256-v1",
      public_key_algorithm: input.publicKeyAlgorithm ?? "unknown",
      device_name: input.deviceName ?? null,
      label: null,
      created_by: input.createdBy ?? "workbench",
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      status: "active"
    };
    this.trustedDevices.push(row);
    this.auditRows.push({
      surface: "remote_trusted_devices",
      operation: "remote_trusted_device.create",
      device_key_prefix: row.device_key_prefix,
      public_key_fingerprint: row.device_public_key_fingerprint,
      metadata: {
        audit_policy: "remote_trusted_device_redacted_no_private_key_no_raw_secret"
      }
    });
    const copy = { ...row };
    delete copy.device_public_key_hash;
    return copy;
  }

  async verifyRemoteTrustedDeviceChallenge(input) {
    const presentedHash = createHash("sha256").update(input.publicKeyMaterial).digest("hex");
    const device = this.trustedDevices.find(
      (row) =>
        row.device_key_prefix === input.deviceKeyPrefix &&
        row.device_public_key_fingerprint === input.publicKeyFingerprint &&
        row.device_public_key_hash === presentedHash
    );
    if (!device) {
      return {
        ok: false,
        code: "invalid_device",
        message: "Trusted device was not recognized."
      };
    }
    const status = device.revoked_at
      ? "revoked"
      : device.expires_at && device.expires_at.getTime() <= Date.now()
        ? "expired"
        : "active";
    const summary = { ...device, status };
    delete summary.device_public_key_hash;
    if (status !== "active") {
      return {
        ok: false,
        code: status,
        message: `Trusted device is ${status}.`,
        device: summary
      };
    }
    const challengeHash = hashSecret(input.challengeNonce);
    const challengeKey = `${device.id}:${challengeHash}`;
    if (this.trustedDeviceChallenges.has(challengeKey)) {
      return {
        ok: false,
        code: "replayed",
        message: "Trusted device challenge was already used.",
        device: summary
      };
    }
    this.trustedDeviceChallenges.add(challengeKey);
    device.last_used_at = new Date();
    return { ok: true, device: summary };
  }

  bootstrapStatus(row) {
    if (row.revoked_at) return "revoked";
    if (row.redeemed_at) return "redeemed";
    if (row.expires_at.getTime() <= Date.now()) return "expired";
    return "active";
  }

  summarizeBootstrapToken(row) {
    const copy = { ...row, status: this.bootstrapStatus(row) };
    delete copy.token_hash;
    return copy;
  }

  async createRemoteConnectBootstrapToken(input) {
    const token = this.next("boot");
    const row = {
      id: `bootstrap-${this.bootstrapTokens.length + 1}`,
      project_id: input.projectId ?? null,
      developer_id: input.developerId,
      token_prefix: prefix(token, "boot"),
      token_hash: hashSecret(token),
      hash_version: "sha256-v1",
      target: input.target ?? "codex",
      label: input.label ?? null,
      allow_project_create: input.allowProjectCreate === true,
      created_by: input.createdBy ?? "workbench",
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 600_000),
      redeemed_at: null,
      revoked_at: null,
      redeemed_client_id: null,
      redeemed_project_id: null
    };
    this.bootstrapTokens.push(row);
    this.auditRows.push({
      surface: "remote_connect_bootstrap_tokens",
      operation: "remote_connect_bootstrap_token.create",
      token_prefix: row.token_prefix,
      metadata: {
        audit_policy: "remote_connect_bootstrap_redacted_no_raw_token_no_hash"
      }
    });
    return { token, bootstrap_token: this.summarizeBootstrapToken(row) };
  }

  async redeemRemoteConnectBootstrapToken(input) {
    const tokenPrefix = prefix(input.token, "boot");
    if (!tokenPrefix)
      throw new Error("VALIDATION_ERROR: remote connect bootstrap token is invalid");
    const tokenHash = hashSecret(input.token);
    const row = this.bootstrapTokens.find(
      (candidate) => candidate.token_prefix === tokenPrefix && candidate.token_hash === tokenHash
    );
    if (!row) throw new Error("VALIDATION_ERROR: remote connect bootstrap token not found");
    const status = this.bootstrapStatus(row);
    if (status !== "active") {
      throw new Error(`VALIDATION_ERROR: remote connect bootstrap token is ${status}`);
    }
    const requestedProjectId = input.projectId ?? null;
    if (row.project_id && requestedProjectId && row.project_id !== requestedProjectId) {
      throw new Error("VALIDATION_ERROR: remote connect bootstrap project scope mismatch");
    }
    let projectId = row.project_id ?? requestedProjectId;
    if (!projectId && row.allow_project_create !== true) {
      throw new Error(
        "VALIDATION_ERROR: remote connect bootstrap token requires an existing project scope"
      );
    }
    if (!projectId) {
      this.counter += 1;
      projectId = `11111111-1111-4111-8111-${String(this.counter).padStart(12, "0")}`;
    }
    row.redeemed_at = new Date();
    row.redeemed_client_id = input.clientId ?? `remote-bootstrap-${this.counter}`;
    row.redeemed_project_id = projectId;
    this.auditRows.push({
      surface: "remote_connect_bootstrap_tokens",
      operation: "remote_connect_bootstrap_token.redeem",
      token_prefix: row.token_prefix,
      metadata: {
        audit_policy: "remote_connect_bootstrap_redacted_no_raw_token_no_hash"
      }
    });
    return {
      bootstrap_token: this.summarizeBootstrapToken(row),
      project_id: projectId,
      developer_id: row.developer_id,
      client_id: row.redeemed_client_id,
      target: row.target
    };
  }

  async revokeRemoteConnectBootstrapToken(input) {
    const row = this.bootstrapTokens.find((candidate) => candidate.id === input.tokenId);
    assert(row, "bootstrap token missing");
    row.revoked_at = new Date();
    return this.summarizeBootstrapToken(row);
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
const trustedDeviceKeyPair = generateKeyPairSync("ed25519");
const trustedDevicePublicKey = trustedDeviceKeyPair.publicKey
  .export({ format: "pem", type: "spki" })
  .toString();
const trustedDeviceFingerprint = createHash("sha256").update(trustedDevicePublicKey).digest("hex");
const trustedDevicePrefix = trustedDeviceFingerprint.slice(0, 16);

function signedTrustedDeviceRequest({
  nonce,
  target = "codex",
  projectFingerprint = "second-fingerprint-redacted",
  projectPathHintRedacted = "second-path-hash-only"
}) {
  const payload = trustedDeviceChallengePayload({
    target,
    projectFingerprint,
    projectPathHintRedacted,
    challengeNonce: nonce
  });
  return {
    target,
    project_fingerprint: projectFingerprint,
    project_path_hint_redacted: projectPathHintRedacted,
    trusted_device: {
      device_key_prefix: trustedDevicePrefix,
      public_key_fingerprint: trustedDeviceFingerprint,
      public_key_material: trustedDevicePublicKey,
      challenge_nonce: nonce,
      challenge_signature: signPayload(
        null,
        Buffer.from(payload, "utf8"),
        trustedDeviceKeyPair.privateKey
      ).toString("base64url"),
      signature_algorithm: "ed25519-v1"
    }
  };
}

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
  const unauthorizedBootstrapToken = await requestJson(baseUrl, "/api/connect/bootstrap-token", {
    action: "create"
  });
  assert(unauthorizedBootstrapToken.status === 401, "bootstrap token API was not protected");

  const start = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "New Mac project",
    project_fingerprint: "fingerprint-redacted",
    project_path_hint_redacted: "path-hash-only",
    trusted_device_registration: {
      device_name: "Vadim MacBook Air",
      device_key_prefix: trustedDevicePrefix,
      public_key_fingerprint: trustedDeviceFingerprint,
      public_key_material: trustedDevicePublicKey,
      public_key_algorithm: "ed25519-v1"
    }
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
  assert(approvalHtml.includes("Vadim MacBook Air"), "approval page did not show device name");
  assert(approvalHtml.includes("up to 90 days"), "approval page did not show trust duration");
  assert(
    approvalHtml.includes("does not grant Workbench, admin"),
    "approval page did not explain trusted-device boundary"
  );
  assert(!approvalHtml.includes("Project UUID"), "approval page still asks for project UUID");
  assert(!approvalHtml.includes("Developer UUID"), "approval page still asks for developer UUID");
  assert(!approvalHtml.includes("trusted-device-public"), "approval page exposed public key body");

  const approved = await requestJson(
    baseUrl,
    "/connect/approve",
    {
      action: "approve",
      code: start.body.device_code,
      client_id: "macbook-air"
    },
    authHeaders
  );
  assert(approved.status === 200, "approval action failed");
  assert(harness.trustedDevices.length === 1, "approval did not register trusted device");
  assert(
    harness.trustedDevices[0].device_public_key_hash,
    "trusted device was not stored as public key hash"
  );
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

  const secondStart = await requestJson(baseUrl, "/api/connect/start", {
    ...signedTrustedDeviceRequest({ nonce: "trusted-second-nonce" }),
    project_display_name: "Second trusted project"
  });
  assert(secondStart.status === 200, "trusted-device second start failed");
  assert(secondStart.body.approval_mode === "trusted_device", "second start was not trusted");
  assert(
    secondStart.body.trusted_device?.browser_approval_required === false,
    "trusted second start still required browser approval"
  );
  assert(
    secondStart.body.trusted_device?.status === "approved",
    "trusted second start did not auto-approve"
  );
  const secondRedeemed = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: secondStart.body.poll_token
  });
  assert(secondRedeemed.status === 200, "trusted second poll failed");
  assert(secondRedeemed.body.status === "approved", "trusted second poll was not approved");
  assert(
    secondRedeemed.body.approval_mode === "trusted_device",
    "trusted second poll did not report trusted_device mode"
  );
  assert(
    secondRedeemed.body.bootstrap.client_id === `remote-${trustedDevicePrefix}`,
    "trusted second bootstrap client id mismatch"
  );

  const replayedTrustedStart = await requestJson(baseUrl, "/api/connect/start", {
    ...signedTrustedDeviceRequest({ nonce: "trusted-second-nonce" }),
    project_display_name: "Replay trusted project"
  });
  assert(replayedTrustedStart.status === 200, "trusted replay start failed");
  assert(
    replayedTrustedStart.body.trusted_device?.status === "fallback",
    "trusted replay did not fall back"
  );
  assert(
    replayedTrustedStart.body.trusted_device?.reason === "replayed",
    "trusted replay did not report replayed"
  );
  assert(
    replayedTrustedStart.body.trusted_device?.browser_approval_required === true,
    "trusted replay did not require browser fallback"
  );
  const replayedTrustedPoll = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: replayedTrustedStart.body.poll_token
  });
  assert(replayedTrustedPoll.body.status === "pending", "trusted replay was auto-approved");
  assert(!replayedTrustedPoll.text.includes("one_time_secret"), "trusted replay exposed secret");

  harness.trustedDevices[0].revoked_at = new Date();
  const revokedTrustedStart = await requestJson(baseUrl, "/api/connect/start", {
    ...signedTrustedDeviceRequest({ nonce: "trusted-revoked-nonce" }),
    project_display_name: "Revoked trusted project"
  });
  assert(
    revokedTrustedStart.body.trusted_device?.reason === "revoked",
    "revoked trusted device did not fall back"
  );
  assert(!revokedTrustedStart.text.includes("one_time_secret"), "revoked fallback exposed secret");

  harness.trustedDevices[0].revoked_at = null;
  harness.trustedDevices[0].expires_at = new Date(Date.now() - 1000);
  const expiredTrustedStart = await requestJson(baseUrl, "/api/connect/start", {
    ...signedTrustedDeviceRequest({ nonce: "trusted-expired-nonce" }),
    project_display_name: "Expired trusted project"
  });
  assert(
    expiredTrustedStart.body.trusted_device?.reason === "expired",
    "expired trusted device did not fall back"
  );
  assert(!expiredTrustedStart.text.includes("one_time_secret"), "expired fallback exposed secret");

  const bootstrapCreate = await requestJson(
    baseUrl,
    "/api/connect/bootstrap-token",
    {
      action: "create",
      developer_id: "22222222-2222-4222-8222-222222222222",
      allow_project_create: true,
      target: "codex",
      label: "headless server"
    },
    authHeaders
  );
  assert(bootstrapCreate.status === 200, "bootstrap token create failed");
  assert(
    bootstrapCreate.body.token?.startsWith("rcl_boot_"),
    "bootstrap token create did not return token once"
  );
  assert(!bootstrapCreate.text.includes("token_hash"), "bootstrap create exposed token hash");
  assert(
    bootstrapCreate.body.command?.includes("--bootstrap-token"),
    "bootstrap create did not return headless command"
  );

  const bootstrapStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Headless server project",
    project_fingerprint: "bootstrap-fingerprint-redacted",
    project_path_hint_redacted: "bootstrap-path-hash-only",
    bootstrap_token: bootstrapCreate.body.token
  });
  assert(bootstrapStart.status === 200, "bootstrap start failed");
  assert(bootstrapStart.body.approval_mode === "bootstrap_token", "bootstrap start mode wrong");
  assert(
    bootstrapStart.body.bootstrap_token?.browser_approval_required === false,
    "bootstrap start required browser approval"
  );
  const bootstrapRedeemed = await requestJson(baseUrl, "/api/connect/poll", {
    poll_token: bootstrapStart.body.poll_token
  });
  assert(bootstrapRedeemed.status === 200, "bootstrap poll failed");
  assert(bootstrapRedeemed.body.status === "approved", "bootstrap poll was not approved");
  assert(bootstrapRedeemed.body.approval_mode === "bootstrap_token", "bootstrap poll mode wrong");
  assert(
    bootstrapRedeemed.body.one_time_secret?.startsWith("rcl_mcp_"),
    "bootstrap poll missing credential"
  );

  const bootstrapReplay = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Headless replay project",
    bootstrap_token: bootstrapCreate.body.token
  });
  assert(bootstrapReplay.status === 409, "bootstrap replay was not rejected");
  assert(bootstrapReplay.text.includes("redeemed"), "bootstrap replay reason missing");
  assert(!bootstrapReplay.text.includes("one_time_secret"), "bootstrap replay exposed credential");

  const malformedBootstrap = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Malformed bootstrap project",
    bootstrap_token: "not-a-bootstrap-token"
  });
  assert(malformedBootstrap.status === 409, "malformed bootstrap token was not rejected");
  assert(!malformedBootstrap.text.includes("one_time_secret"), "malformed token exposed secret");

  const expiredBootstrapCreate = await requestJson(
    baseUrl,
    "/api/connect/bootstrap-token",
    {
      action: "create",
      developer_id: "22222222-2222-4222-8222-222222222222",
      allow_project_create: true,
      expires_at: "2000-01-01T00:00:00.000Z"
    },
    authHeaders
  );
  const expiredBootstrapStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Expired bootstrap project",
    bootstrap_token: expiredBootstrapCreate.body.token
  });
  assert(expiredBootstrapStart.status === 409, "expired bootstrap token was not rejected");
  assert(expiredBootstrapStart.text.includes("expired"), "expired bootstrap reason missing");

  const revokedBootstrapCreate = await requestJson(
    baseUrl,
    "/api/connect/bootstrap-token",
    {
      action: "create",
      developer_id: "22222222-2222-4222-8222-222222222222",
      allow_project_create: true
    },
    authHeaders
  );
  const revokedBootstrap = await requestJson(
    baseUrl,
    "/api/connect/bootstrap-token",
    { action: "revoke", token_id: revokedBootstrapCreate.body.bootstrap_token.id },
    authHeaders
  );
  assert(revokedBootstrap.status === 200, "bootstrap revoke failed");
  const revokedBootstrapStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_display_name: "Revoked bootstrap project",
    bootstrap_token: revokedBootstrapCreate.body.token
  });
  assert(revokedBootstrapStart.status === 409, "revoked bootstrap token was not rejected");
  assert(revokedBootstrapStart.text.includes("revoked"), "revoked bootstrap reason missing");

  const scopedBootstrapCreate = await requestJson(
    baseUrl,
    "/api/connect/bootstrap-token",
    {
      action: "create",
      developer_id: "22222222-2222-4222-8222-222222222222",
      project_id: "11111111-1111-4111-8111-000000000001"
    },
    authHeaders
  );
  const wrongScopeBootstrapStart = await requestJson(baseUrl, "/api/connect/start", {
    target: "codex",
    project_id: "11111111-1111-4111-8111-000000000002",
    project_display_name: "Wrong scope bootstrap project",
    bootstrap_token: scopedBootstrapCreate.body.token
  });
  assert(wrongScopeBootstrapStart.status === 409, "wrong-scope bootstrap was not rejected");
  assert(wrongScopeBootstrapStart.text.includes("scope mismatch"), "wrong-scope reason missing");

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
    secondStart.text,
    secondRedeemed.text,
    replayedTrustedStart.text,
    replayedTrustedPoll.text,
    revokedTrustedStart.text,
    expiredTrustedStart.text,
    bootstrapCreate.text,
    bootstrapStart.text,
    bootstrapRedeemed.text,
    bootstrapReplay.text,
    malformedBootstrap.text,
    expiredBootstrapStart.text,
    revokedBootstrap.text,
    revokedBootstrapStart.text,
    wrongScopeBootstrapStart.text,
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
          trusted_device_reconnect: "second_project_without_browser_approval",
          trusted_device_replay: "fallback_without_secret",
          trusted_device_revoked_expired: "fallback_without_secret",
          bootstrap_token: "created_redeemed_once_without_browser_approval",
          bootstrap_token_failures: "replay_malformed_expired_revoked_wrong_scope_without_secret",
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
