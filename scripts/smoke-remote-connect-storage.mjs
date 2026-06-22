import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  remoteConnectApprovePath,
  remoteConnectApprovalUrl,
  remoteConnectBootstrapPath,
  remoteConnectCancelPath,
  remoteConnectPollPath,
  remoteConnectStartPath,
  remoteConnectStatusValues,
  remoteConnectBootstrapTokenDefaultExpiresSeconds,
  remoteTrustedDeviceDefaultExpiresSeconds
} from "../packages/contracts/dist/remote-mcp.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function prefix(secret, kind) {
  const parts = secret.split("_");
  return parts.length >= 4 && parts[0] === "rcl" && parts[1] === kind ? parts[2] : null;
}

function summary(row) {
  const copy = { ...row };
  delete copy.device_code_hash;
  delete copy.poll_token_hash;
  copy.status =
    (copy.status === "pending" || copy.status === "approved") && copy.expires_at <= Date.now()
      ? "expired"
      : copy.status;
  return copy;
}

function deviceSummary(row) {
  const copy = { ...row };
  delete copy.device_public_key_hash;
  copy.status = copy.revoked_at ? "revoked" : copy.expires_at <= Date.now() ? "expired" : "active";
  return copy;
}

function bootstrapSummary(row) {
  const copy = { ...row };
  delete copy.token_hash;
  copy.status = copy.revoked_at
    ? "revoked"
    : copy.redeemed_at
      ? "redeemed"
      : copy.expires_at <= Date.now()
        ? "expired"
        : "active";
  return copy;
}

class RemoteConnectStorageHarness {
  constructor() {
    this.rows = [];
    this.auditRows = [];
    this.counter = 0;
  }

  next(kind) {
    this.counter += 1;
    return `rcl_${kind}_prefix${this.counter}_secret${this.counter}`;
  }

  create({ expiresAt = Date.now() + 600_000, target = "codex" } = {}) {
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
      target,
      project_display_name: "smoke project",
      project_fingerprint: "project-fingerprint-redacted",
      project_path_hint_redacted: "project-path-hash-only",
      repo_remote_hash: "repo-remote-hash",
      requested_by_ip_hash: "ip-hash",
      approved_project_id: null,
      developer_id: null,
      client_id: null,
      credential_id: null,
      expires_at: expiresAt
    };
    this.rows.push(row);
    this.audit("create", row, { result: "created" });
    return { device_code: deviceCode, poll_token: pollToken, request: summary(row) };
  }

  audit(operation, row, metadata = {}) {
    this.auditRows.push({
      surface: "remote_connect_requests",
      operation: `remote_connect_request.${operation}`,
      request_id: row.id,
      device_code_prefix: row.device_code_prefix,
      poll_token_prefix: row.poll_token_prefix,
      credential_id: row.credential_id,
      client_id: row.client_id,
      metadata: {
        audit_policy: "remote_connect_redacted_no_raw_device_secret_no_raw_credential",
        ...metadata
      }
    });
  }

  findByDevice(deviceCode) {
    const devicePrefix = prefix(deviceCode, "conn");
    const deviceHash = hashSecret(deviceCode);
    return this.rows.find(
      (row) => row.device_code_prefix === devicePrefix && row.device_code_hash === deviceHash
    );
  }

  findByPoll(pollToken) {
    const pollPrefix = prefix(pollToken, "poll");
    const pollHash = hashSecret(pollToken);
    return this.rows.find(
      (row) => row.poll_token_prefix === pollPrefix && row.poll_token_hash === pollHash
    );
  }

  effectiveStatus(row) {
    return (row.status === "pending" || row.status === "approved") && row.expires_at <= Date.now()
      ? "expired"
      : row.status;
  }

  approve(deviceCode) {
    const row = this.findByDevice(deviceCode);
    assert(row, "approve target missing");
    const status = this.effectiveStatus(row);
    assert(status === "pending", `approve should reject ${status}`);
    row.status = "approved";
    row.approved_project_id = "project-1";
    row.developer_id = "developer-1";
    row.client_id = "client-1";
    this.audit("approve", row, { result: "approved" });
    return summary(row);
  }

  deny(deviceCode) {
    const row = this.findByDevice(deviceCode);
    assert(row, "deny target missing");
    const status = this.effectiveStatus(row);
    assert(status === "pending", `deny should reject ${status}`);
    row.status = "denied";
    this.audit("deny", row, { result: "denied" });
    return summary(row);
  }

  poll(pollToken) {
    const row = this.findByPoll(pollToken);
    if (!row) return { status: "expired", request: null };
    const status = this.effectiveStatus(row);
    if (status !== "approved") {
      if (status === "expired") row.status = "expired";
      this.audit("poll", row, { result: status });
      return { status, request: summary(row) };
    }
    const secret = `rcl_mcp_credential${this.counter}_secret${this.counter}`;
    row.status = "redeemed";
    row.credential_id = "credential-1";
    this.audit("poll", row, { result: "approved" });
    return {
      status: "approved",
      request: summary(row),
      secret,
      credential: {
        id: row.credential_id,
        credential_prefix: "credential-prefix",
        project_id: row.approved_project_id,
        developer_id: row.developer_id,
        client_id: row.client_id,
        status: "active"
      }
    };
  }
}

class RemoteTrustedDeviceHarness {
  constructor() {
    this.rows = [];
    this.auditRows = [];
    this.counter = 0;
  }

  create({ expiresAt = Date.now() + 600_000, revoked = false } = {}) {
    this.counter += 1;
    const row = {
      id: `device-${this.counter}`,
      developer_id: "developer-1",
      device_key_prefix: `device-prefix-${this.counter}`,
      device_public_key_fingerprint: `fingerprint-${this.counter}`,
      device_public_key_hash: hashSecret(`public-key-${this.counter}`),
      hash_version: "sha256-v1",
      public_key_algorithm: "ed25519-v1",
      device_name: "MacBook Air",
      label: "trusted workstation",
      expires_at: expiresAt,
      revoked_at: revoked ? Date.now() : null
    };
    this.rows.push(row);
    this.audit("create", row, { result: "created" });
    return deviceSummary(row);
  }

  audit(operation, row, metadata = {}) {
    this.auditRows.push({
      surface: "remote_trusted_devices",
      operation: `remote_trusted_device.${operation}`,
      device_id: row.id,
      device_key_prefix: row.device_key_prefix,
      public_key_fingerprint: row.device_public_key_fingerprint,
      metadata: {
        audit_policy: "remote_trusted_device_redacted_no_private_key_no_raw_secret",
        ...metadata
      }
    });
  }

  verify(device) {
    const row = this.rows.find(
      (candidate) =>
        candidate.device_key_prefix === device.device_key_prefix &&
        candidate.device_public_key_fingerprint === device.device_public_key_fingerprint
    );
    assert(row, "trusted device missing");
    const status = deviceSummary(row).status;
    if (status !== "active") return { ok: false, code: status, device: deviceSummary(row) };
    row.last_used_at = Date.now();
    this.audit("verify", row, { result: "success", challenge_nonce_present: true });
    return { ok: true, device: deviceSummary(row) };
  }
}

class RemoteBootstrapTokenHarness {
  constructor() {
    this.rows = [];
    this.auditRows = [];
    this.counter = 0;
  }

  next() {
    this.counter += 1;
    return `rcl_boot_boot${this.counter}_secret${this.counter}`;
  }

  create({ expiresAt = Date.now() + 600_000, revoked = false } = {}) {
    const token = this.next();
    const row = {
      id: `bootstrap-${this.counter}`,
      project_id: "project-1",
      developer_id: "developer-1",
      token_prefix: prefix(token, "boot"),
      token_hash: hashSecret(token),
      hash_version: "sha256-v1",
      target: "codex",
      label: "headless server",
      allow_project_create: false,
      expires_at: expiresAt,
      redeemed_at: null,
      revoked_at: revoked ? Date.now() : null,
      redeemed_client_id: null,
      redeemed_project_id: null
    };
    this.rows.push(row);
    this.audit("create", row, { result: "created" });
    return { token, bootstrap_token: bootstrapSummary(row) };
  }

  audit(operation, row, metadata = {}) {
    this.auditRows.push({
      surface: "remote_connect_bootstrap_tokens",
      operation: `remote_connect_bootstrap_token.${operation}`,
      token_id: row.id,
      token_prefix: row.token_prefix,
      metadata: {
        audit_policy: "remote_connect_bootstrap_redacted_no_raw_token_no_hash",
        ...metadata
      }
    });
  }

  redeem(token) {
    const tokenPrefix = prefix(token, "boot");
    const tokenHash = hashSecret(token);
    const row = this.rows.find(
      (candidate) => candidate.token_prefix === tokenPrefix && candidate.token_hash === tokenHash
    );
    assert(row, "bootstrap token missing");
    const status = bootstrapSummary(row).status;
    assert(status === "active", `bootstrap redeem should reject ${status}`);
    row.redeemed_at = Date.now();
    row.redeemed_client_id = "remote-client-1";
    row.redeemed_project_id = row.project_id;
    this.audit("redeem", row, { result: "redeemed" });
    return bootstrapSummary(row);
  }
}

const expectedPaths = [
  remoteConnectBootstrapPath,
  remoteConnectApprovePath,
  remoteConnectStartPath,
  remoteConnectPollPath,
  remoteConnectCancelPath
];
assert(
  expectedPaths.join("|") ===
    "/connect|/connect/approve|/api/connect/start|/api/connect/poll|/api/connect/cancel",
  "remote connect route constants changed unexpectedly"
);
assert(
  remoteConnectApprovalUrl("https://memory.example.com", "rcl_conn_demo_secret") ===
    "https://memory.example.com/connect/approve?code=rcl_conn_demo_secret",
  "approval URL helper did not render expected URL"
);
assert(
  remoteConnectStatusValues.join("|") === "pending|approved|denied|expired|redeemed",
  "remote connect statuses are incomplete"
);
assert(
  remoteTrustedDeviceDefaultExpiresSeconds === 90 * 24 * 60 * 60,
  "trusted device default expiry changed unexpectedly"
);
assert(
  remoteConnectBootstrapTokenDefaultExpiresSeconds === 15 * 60,
  "bootstrap token default expiry changed unexpectedly"
);

const dbSource = await readFile(new URL("../packages/db/src/index.ts", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../packages/db/migrations/0001_initial.sql", import.meta.url),
  "utf8"
);
for (const source of [dbSource, migration]) {
  assert(source.includes("remote_connect_requests"), "remote_connect_requests schema missing");
  assert(source.includes("remote_trusted_devices"), "remote_trusted_devices schema missing");
  assert(
    source.includes("remote_connect_bootstrap_tokens"),
    "remote_connect_bootstrap_tokens schema missing"
  );
  assert(source.includes("device_code_hash"), "device code hash column missing");
  assert(source.includes("poll_token_hash"), "poll token hash column missing");
  assert(source.includes("device_public_key_hash"), "trusted device hash column missing");
  assert(source.includes("token_hash"), "bootstrap token hash column missing");
  assert(!source.includes("device_code TEXT"), "schema stores raw device code");
  assert(!source.includes("poll_token TEXT"), "schema stores raw poll token");
  assert(!source.includes("device_private_key"), "schema stores private device key");
  assert(!source.includes("raw_private_key"), "schema stores raw private device key");
  assert(!source.includes("private_key TEXT"), "schema stores private device key text");
  assert(!source.includes("bootstrap_token TEXT"), "schema stores raw bootstrap token");
  assert(!source.includes("credential_secret"), "schema stores raw credential secret");
}
for (const method of [
  "createRemoteConnectRequest",
  "approveRemoteConnectRequest",
  "getRemoteConnectRequestForApproval",
  "denyRemoteConnectRequest",
  "pollRemoteConnectRequest",
  "recordRemoteConnectRequestAudit",
  "createRemoteTrustedDevice",
  "verifyRemoteTrustedDevice",
  "revokeRemoteTrustedDevice",
  "createRemoteConnectBootstrapToken",
  "redeemRemoteConnectBootstrapToken",
  "revokeRemoteConnectBootstrapToken",
  "recordRemoteTrustedDeviceAudit",
  "recordRemoteConnectBootstrapTokenAudit"
]) {
  assert(dbSource.includes(method), `${method} missing from DB source`);
}
for (const marker of [
  "ALTER TABLE remote_connect_requests",
  "ADD COLUMN IF NOT EXISTS trusted_device_key_prefix",
  "ADD COLUMN IF NOT EXISTS trusted_device_public_key_fingerprint",
  "ADD COLUMN IF NOT EXISTS trusted_device_public_key_hash",
  "ADD COLUMN IF NOT EXISTS trusted_device_public_key_algorithm",
  "ADD COLUMN IF NOT EXISTS trusted_device_name"
]) {
  assert(dbSource.includes(marker), `remote connect additive schema upgrade missing: ${marker}`);
}

const harness = new RemoteConnectStorageHarness();
const first = harness.create();
assert(first.device_code.startsWith("rcl_conn_"), "device code format mismatch");
assert(first.poll_token.startsWith("rcl_poll_"), "poll token format mismatch");
assert(first.request.status === "pending", "new request was not pending");
assert(!("device_code_hash" in first.request), "summary exposed device_code_hash");
assert(!("poll_token_hash" in first.request), "summary exposed poll_token_hash");

const approved = harness.approve(first.device_code);
assert(approved.status === "approved", "approval did not transition to approved");
const redeemed = harness.poll(first.poll_token);
assert(redeemed.status === "approved", "approved poll did not return provisioning once");
assert(redeemed.secret.startsWith("rcl_mcp_"), "approved poll did not return credential secret");
const replay = harness.poll(first.poll_token);
assert(replay.status === "redeemed", "poll token was redeemable more than once");

const denied = harness.create();
harness.deny(denied.device_code);
assert(harness.poll(denied.poll_token).status === "denied", "denied request did not stay denied");

const expired = harness.create({ expiresAt: Date.now() - 1 });
assert(harness.poll(expired.poll_token).status === "expired", "expired request did not expire");
let rejectedExpiredApprove = false;
try {
  harness.approve(expired.device_code);
} catch {
  rejectedExpiredApprove = true;
}
assert(rejectedExpiredApprove, "approval succeeded after expiry");

const text = JSON.stringify({ rows: harness.rows.map(summary), auditRows: harness.auditRows });
assert(!text.includes(first.device_code), "output leaked raw device code");
assert(!text.includes(first.poll_token), "output leaked raw poll token");
assert(!text.includes(redeemed.secret), "output leaked raw credential secret");
assert(!text.includes(hashSecret(first.device_code)), "output leaked device code hash");
assert(!text.includes(hashSecret(first.poll_token)), "output leaked poll token hash");
assert(!text.includes("device_code_hash"), "output exposed device_code_hash field");
assert(!text.includes("poll_token_hash"), "output exposed poll_token_hash field");

const deviceHarness = new RemoteTrustedDeviceHarness();
const trustedDevice = deviceHarness.create();
assert(trustedDevice.status === "active", "trusted device was not active");
assert(!("device_public_key_hash" in trustedDevice), "trusted device summary exposed hash");
assert(deviceHarness.verify(trustedDevice).ok === true, "trusted device verify failed");
const expiredDevice = deviceHarness.create({ expiresAt: Date.now() - 1 });
assert(deviceHarness.verify(expiredDevice).code === "expired", "expired device stayed active");

const bootstrapHarness = new RemoteBootstrapTokenHarness();
const bootstrap = bootstrapHarness.create();
assert(bootstrap.token.startsWith("rcl_boot_"), "bootstrap token format mismatch");
assert(!("token_hash" in bootstrap.bootstrap_token), "bootstrap summary exposed hash");
const redeemedBootstrap = bootstrapHarness.redeem(bootstrap.token);
assert(redeemedBootstrap.status === "redeemed", "bootstrap token was not redeemed");
let rejectedBootstrapReplay = false;
try {
  bootstrapHarness.redeem(bootstrap.token);
} catch {
  rejectedBootstrapReplay = true;
}
assert(rejectedBootstrapReplay, "bootstrap token was redeemable more than once");
const expiredBootstrap = bootstrapHarness.create({ expiresAt: Date.now() - 1 });
let rejectedExpiredBootstrap = false;
try {
  bootstrapHarness.redeem(expiredBootstrap.token);
} catch {
  rejectedExpiredBootstrap = true;
}
assert(rejectedExpiredBootstrap, "expired bootstrap token redeemed");

const newText = JSON.stringify({
  devices: deviceHarness.rows.map(deviceSummary),
  deviceAudit: deviceHarness.auditRows,
  bootstrap: bootstrapHarness.rows.map(bootstrapSummary),
  bootstrapAudit: bootstrapHarness.auditRows
});
assert(!newText.includes("device_public_key_hash"), "output exposed device_public_key_hash");
assert(!newText.includes("token_hash"), "output exposed token_hash");
assert(!newText.includes(bootstrap.token), "output leaked raw bootstrap token");
assert(!newText.includes(hashSecret(bootstrap.token)), "output leaked bootstrap token hash");

process.stdout.write(
  JSON.stringify(
    {
      remote_connect_storage_smoke: {
        status: "pass",
        routes: expectedPaths,
        statuses: remoteConnectStatusValues,
        trusted_device: {
          default_expiry_seconds: remoteTrustedDeviceDefaultExpiresSeconds,
          verify: "active_only",
          redaction: "public_fingerprint_only"
        },
        bootstrap_token: {
          default_expiry_seconds: remoteConnectBootstrapTokenDefaultExpiresSeconds,
          redeem_once: "enforced",
          replay: "rejected",
          redaction: "raw_token_and_hash_absent"
        },
        transitions: ["pending", "approved", "redeemed", "denied", "expired"],
        replay: "rejected",
        redaction: "raw_device_poll_and_credential_absent",
        tables: [
          "remote_connect_requests",
          "remote_trusted_devices",
          "remote_connect_bootstrap_tokens"
        ]
      }
    },
    null,
    2
  )
);
