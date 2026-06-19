import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { remoteMcpEndpointPath } from "../packages/contracts/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function safeHashEquals(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function extractPrefix(secret) {
  const parts = secret.split("_");
  return parts.length === 4 && parts[0] === "rcl" && parts[1] === "mcp" ? parts[2] : null;
}

function withoutHash(row) {
  const summary = { ...row };
  delete summary.credential_hash;
  summary.status = row.revoked_at
    ? "revoked"
    : row.expires_at && row.expires_at.getTime() <= Date.now()
      ? "expired"
      : "active";
  return summary;
}

class CredentialHarness {
  constructor() {
    this.rows = [];
    this.auditRows = [];
    this.counter = 0;
  }

  nextSecret() {
    this.counter += 1;
    return ["rcl", "mcp", `smoke${this.counter}`, `secret${this.counter}`].join("_");
  }

  audit(operation, status, row, metadata = {}) {
    this.auditRows.push({
      surface: "remote_mcp_credentials",
      operation: `remote_mcp_credential.${operation}`,
      status,
      project_id: row?.project_id ?? metadata.project_id ?? null,
      developer_id: row?.developer_id ?? metadata.developer_id ?? null,
      credential_id: row?.id ?? metadata.credential_id ?? null,
      credential_prefix: row?.credential_prefix ?? metadata.credential_prefix ?? null,
      client_id: row?.client_id ?? metadata.client_id ?? null,
      redacted_metadata: metadata
    });
  }

  create({ projectId, developerId, clientId = null, label = null, expiresAt = null }) {
    const secret = this.nextSecret();
    const row = {
      id: `credential-${this.counter}`,
      project_id: projectId,
      developer_id: developerId,
      client_id: clientId,
      label,
      credential_prefix: extractPrefix(secret),
      credential_hash: hashSecret(secret),
      hash_version: "sha256-v1",
      created_by: "smoke",
      rotated_from_credential_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null
    };
    this.rows.push(row);
    this.audit("create", "success", row, { result: "created" });
    return { secret, credential: withoutHash(row) };
  }

  list({ projectId, developerId, includeRevoked = true }) {
    return this.rows
      .filter((row) => row.project_id === projectId && row.developer_id === developerId)
      .filter((row) => includeRevoked || !row.revoked_at)
      .map((row) => withoutHash(row));
  }

  rotate(credentialId) {
    const previous = this.rows.find((row) => row.id === credentialId);
    assert(previous, "rotate target missing");
    previous.revoked_at = new Date();
    previous.updated_at = new Date();
    const next = this.create({
      projectId: previous.project_id,
      developerId: previous.developer_id,
      clientId: previous.client_id,
      label: previous.label
    });
    const nextRow = this.rows.find((row) => row.id === next.credential.id);
    nextRow.rotated_from_credential_id = previous.id;
    this.audit("rotate", "success", nextRow, { rotated_from_credential_id: previous.id });
    return { previous: withoutHash(previous), ...next };
  }

  revoke(credentialId) {
    const row = this.rows.find((candidate) => candidate.id === credentialId);
    assert(row, "revoke target missing");
    row.revoked_at = new Date();
    row.updated_at = new Date();
    this.audit("revoke", "success", row, { result: "revoked" });
    return withoutHash(row);
  }

  async verifyRemoteMcpCredential(input) {
    const prefix = input.bearerToken ? extractPrefix(input.bearerToken) : null;
    const presentedHash = input.bearerToken ? hashSecret(input.bearerToken) : null;
    const row = this.rows.find(
      (candidate) =>
        candidate.credential_prefix === prefix &&
        presentedHash &&
        safeHashEquals(candidate.credential_hash, presentedHash)
    );
    if (!row) {
      this.audit("verify", "skipped", null, {
        result: "invalid_token",
        project_id: input.projectId,
        developer_id: input.developerId,
        client_id: input.clientId,
        credential_prefix: prefix
      });
      return {
        ok: false,
        code: "invalid_token",
        message: "Remote MCP credential is not valid."
      };
    }
    const summary = withoutHash(row);
    let failure = null;
    if (row.project_id !== input.projectId) failure = "wrong_project";
    else if (row.developer_id !== input.developerId) failure = "wrong_developer";
    else if (row.client_id && row.client_id !== input.clientId) failure = "wrong_client";
    else if (row.expires_at && row.expires_at.getTime() <= Date.now()) failure = "expired";
    else if (row.revoked_at) {
      failure = this.rows.some((candidate) => candidate.rotated_from_credential_id === row.id)
        ? "rotated"
        : "revoked";
    }
    if (failure) {
      this.audit("verify", "skipped", row, { result: failure });
      return {
        ok: false,
        code: failure,
        message: `Remote MCP credential rejected: ${failure}.`,
        credential: summary
      };
    }
    row.last_used_at = new Date();
    row.updated_at = new Date();
    this.audit("verify", "success", row, { result: "success" });
    return { ok: true, credential: withoutHash(row) };
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine remote MCP credential smoke server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error?.code === "ERR_SERVER_NOT_RUNNING") resolve();
      else if (error) reject(error);
      else resolve();
    });
  });
}

const projectId = "11111111-1111-4111-8111-111111111111";
const developerId = "22222222-2222-4222-8222-222222222222";
const clientId = "remote-credential-client";
const sessionId = "33333333-3333-4333-8333-333333333333";
const harness = new CredentialHarness();
const remoteAuditRows = [];

const endpointCredential = harness.create({
  projectId,
  developerId,
  clientId,
  label: "endpoint smoke"
});
const revokedCredential = harness.create({ projectId, developerId, clientId });
harness.revoke(revokedCredential.credential.id);
const expiredCredential = harness.create({
  projectId,
  developerId,
  clientId,
  expiresAt: new Date("2020-01-01T00:00:00.000Z")
});
const rotateTarget = harness.create({ projectId, developerId, clientId });
const rotatedCredential = harness.rotate(rotateTarget.credential.id);

const fakeDb = {
  verifyRemoteMcpCredential: (input) => harness.verifyRemoteMcpCredential(input),
  async getProjectBinding(requestProjectId) {
    if (requestProjectId !== projectId) return null;
    return {
      project_id: projectId,
      developer_id: developerId,
      name: "Remote credential smoke",
      primary_path: "/tmp/recallant-remote-credential-smoke"
    };
  },
  async projectPrimaryPath(requestProjectId) {
    return requestProjectId === projectId ? "/tmp/recallant-remote-credential-smoke" : null;
  },
  async startSystemActivity(input) {
    const row = {
      id: `remote-audit-${remoteAuditRows.length + 1}`,
      surface: input.surface,
      operation: input.operation,
      status: "started",
      project_id: input.project_id ?? null,
      developer_id: input.developer_id ?? null,
      related_ids: input.related_ids ?? {},
      redacted_metadata: input.metadata ?? {},
      error_code: null
    };
    remoteAuditRows.push(row);
    return row;
  },
  async finishSystemActivity(input) {
    const row = remoteAuditRows.find((candidate) => candidate.id === input.id);
    if (!row) return null;
    row.status = input.status;
    row.error_code = input.error_code ?? null;
    row.redacted_metadata = { ...row.redacted_metadata, ...(input.metadata ?? {}) };
    return row;
  },
  async heartbeat(requestSessionId, status, note, metadata) {
    return {
      id: requestSessionId,
      status,
      note: note ?? null,
      metadata: metadata ?? {},
      last_seen_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    };
  }
};

function headers(secret, overrides = {}) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
    "x-recallant-project-id": projectId,
    "x-recallant-developer-id": developerId,
    "x-recallant-client-id": clientId,
    "x-recallant-session-id": sessionId,
    ...overrides
  };
}

async function rpc(baseUrl, body, requestHeaders = headers(endpointCredential.secret)) {
  const response = await fetch(`${baseUrl}${remoteMcpEndpointPath}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}

function assertError(result, code, label) {
  assert(result.status >= 400, `${label} expected failure HTTP status`);
  assert(result.body?.error?.data?.code === code, `${label} expected ${code}`);
}

const server = createRecallantHttpServer({ remoteMcpDatabase: fakeDb });
const cases = [];
try {
  const baseUrl = await listen(server);

  let result = await rpc(baseUrl, { jsonrpc: "2.0", id: "init", method: "initialize" });
  assert(result.status === 200, "active credential initialize failed");
  cases.push("valid_initialize");

  result = await rpc(baseUrl, { jsonrpc: "2.0", id: "list", method: "tools/list" });
  assert(result.status === 200, "active credential tools/list failed");
  assert(
    result.body?.result?.tools?.some((tool) => tool.name === "memory_heartbeat"),
    "tools/list missing deterministic heartbeat tool"
  );
  cases.push("valid_tools_list");

  result = await rpc(baseUrl, {
    jsonrpc: "2.0",
    id: "call",
    method: "tools/call",
    params: {
      name: "memory_heartbeat",
      arguments: { session_id: sessionId, status: "active", metadata: { smoke: true } }
    }
  });
  assert(result.status === 200, "active credential tools/call failed");
  assert(result.body?.result?.structuredContent?.ok === true, "heartbeat result missing ok");
  cases.push("valid_tools_call");

  assert(
    harness.rows.find((row) => row.id === endpointCredential.credential.id)?.last_used_at,
    "valid credential did not update last_used_at"
  );

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "revoked", method: "initialize" },
    headers(revokedCredential.secret)
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "revoked credential");
  cases.push("revoked_token_rejected");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "expired", method: "initialize" },
    headers(expiredCredential.secret)
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "expired credential");
  cases.push("expired_token_rejected");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "rotated-old", method: "initialize" },
    headers(rotateTarget.secret)
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "rotated old credential");
  cases.push("rotated_old_rejected");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "rotated-new", method: "initialize" },
    headers(rotatedCredential.secret)
  );
  assert(result.status === 200, "rotated new credential failed");
  cases.push("rotated_new_succeeds");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "wrong-project", method: "initialize" },
    headers(endpointCredential.secret, {
      "x-recallant-project-id": "99999999-9999-4999-8999-999999999999"
    })
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "wrong project");
  cases.push("wrong_project_rejected");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "wrong-developer", method: "initialize" },
    headers(endpointCredential.secret, {
      "x-recallant-developer-id": "99999999-9999-4999-8999-999999999999"
    })
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "wrong developer");
  cases.push("wrong_developer_rejected");

  result = await rpc(
    baseUrl,
    { jsonrpc: "2.0", id: "wrong-client", method: "initialize" },
    headers(endpointCredential.secret, { "x-recallant-client-id": "wrong-client" })
  );
  assertError(result, "INVALID_SCOPE_TOKEN", "wrong client");
  cases.push("wrong_client_rejected");
} finally {
  await close(server);
}

const listOutput = JSON.stringify(harness.list({ projectId, developerId }));
const storedRows = JSON.stringify(harness.rows);
const credentialAudit = JSON.stringify(harness.auditRows);
const remoteAudit = JSON.stringify(remoteAuditRows);
const docs = [
  await readFile("README.md", "utf8"),
  await readFile("docs/MCP_SPEC.md", "utf8"),
  await readFile("docs/CLIENT_SETUP.md", "utf8")
].join("\n");

for (const secret of [
  endpointCredential.secret,
  revokedCredential.secret,
  expiredCredential.secret,
  rotateTarget.secret,
  rotatedCredential.secret
]) {
  assert(!storedRows.includes(secret), "stored credential rows leaked raw secret");
  assert(!credentialAudit.includes(secret), "credential audit leaked raw secret");
  assert(!remoteAudit.includes(secret), "remote MCP audit leaked raw secret");
  assert(!listOutput.includes(secret), "list output leaked raw secret");
  assert(!docs.includes(secret), "docs leaked raw smoke secret");
}

assert(!listOutput.includes("credential_hash"), "list output exposed credential_hash");
assert(!credentialAudit.includes("credential_hash"), "credential audit exposed credential_hash");
assert(!remoteAudit.includes("credential_hash"), "remote MCP audit exposed credential_hash");
for (const operation of ["create", "rotate", "revoke", "verify"]) {
  assert(
    harness.auditRows.some((row) => row.operation === `remote_mcp_credential.${operation}`),
    `credential audit missing ${operation}`
  );
}
assert(
  remoteAuditRows.some(
    (row) =>
      row.surface === "remote_mcp" &&
      row.status === "success" &&
      row.related_ids?.credential_id &&
      row.related_ids?.credential_prefix
  ),
  "remote MCP use audit missing redacted credential metadata"
);
assert(
  harness.auditRows.some((row) => row.status === "skipped" && row.redacted_metadata?.result),
  "credential failure audit missing skipped result"
);

process.stdout.write(
  JSON.stringify(
    {
      remote_mcp_credentials_smoke: {
        cases,
        credentials_created: harness.rows.length,
        credential_audit_events: harness.auditRows.length,
        remote_mcp_audit_events: remoteAuditRows.length,
        no_raw_secret_in: ["stored_rows", "credential_audit", "remote_mcp_audit", "list_output", "docs"],
        package_script: "remote-mcp-credentials:smoke"
      }
    },
    null,
    2
  ) + "\n"
);

process.stdout.write("Remote MCP credentials smoke passed\n");
