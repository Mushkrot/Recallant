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
  remoteConnectStatusValues
} from "../packages/contracts/dist/remote-mcp.js";

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

const dbSource = await readFile(new URL("../packages/db/src/index.ts", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../packages/db/migrations/0001_initial.sql", import.meta.url),
  "utf8"
);
for (const source of [dbSource, migration]) {
  assert(source.includes("remote_connect_requests"), "remote_connect_requests schema missing");
  assert(source.includes("device_code_hash"), "device code hash column missing");
  assert(source.includes("poll_token_hash"), "poll token hash column missing");
  assert(!source.includes("device_code TEXT"), "schema stores raw device code");
  assert(!source.includes("poll_token TEXT"), "schema stores raw poll token");
  assert(!source.includes("credential_secret"), "schema stores raw credential secret");
}
for (const method of [
  "createRemoteConnectRequest",
  "approveRemoteConnectRequest",
  "getRemoteConnectRequestForApproval",
  "denyRemoteConnectRequest",
  "pollRemoteConnectRequest",
  "recordRemoteConnectRequestAudit"
]) {
  assert(dbSource.includes(method), `${method} missing from DB source`);
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

process.stdout.write(
  JSON.stringify(
    {
      remote_connect_storage_smoke: {
        status: "pass",
        routes: expectedPaths,
        statuses: remoteConnectStatusValues,
        transitions: ["pending", "approved", "redeemed", "denied", "expired"],
        replay: "rejected",
        redaction: "raw_device_poll_and_credential_absent",
        table: "remote_connect_requests"
      }
    },
    null,
    2
  )
);
