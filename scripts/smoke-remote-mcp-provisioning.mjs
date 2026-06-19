import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL, URLSearchParams } from "node:url";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { remoteMcpProvisioningOutput } from "../apps/cli/dist/client-targets.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function extractPrefix(secret) {
  const parts = secret.split("_");
  return parts.length === 4 && parts[0] === "rcl" && parts[1] === "mcp" ? parts[2] : null;
}

function withoutHash(row) {
  const summary = { ...row };
  delete summary.credential_hash;
  summary.status = row.revoked_at ? "revoked" : "active";
  return summary;
}

class ProvisioningHarness {
  constructor() {
    this.rows = [];
    this.auditRows = [];
    this.counter = 0;
  }

  nextSecret() {
    this.counter += 1;
    return ["rcl", "mcp", `provision${this.counter}`, `secret${this.counter}`].join("_");
  }

  audit(operation, row, metadata = {}) {
    this.auditRows.push({
      surface: "remote_mcp_credentials",
      operation: `remote_mcp_credential.${operation}`,
      status: "success",
      project_id: row.project_id,
      developer_id: row.developer_id,
      credential_id: row.id,
      credential_prefix: row.credential_prefix,
      client_id: row.client_id,
      metadata
    });
  }

  create({ projectId, developerId, clientId = null, label = null }) {
    this.assertScope(projectId, developerId);
    const secret = this.nextSecret();
    const now = new Date(`2026-06-19T00:00:${String(this.counter).padStart(2, "0")}Z`);
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
      created_at: now,
      updated_at: now,
      last_used_at: null,
      expires_at: null,
      revoked_at: null
    };
    this.rows.push(row);
    this.audit("create", row, { result: "created" });
    return { secret, credential: withoutHash(row) };
  }

  list({ projectId, developerId, includeRevoked = false }) {
    this.assertScope(projectId, developerId);
    this.auditRows.push({
      surface: "remote_mcp_credentials",
      operation: "remote_mcp_credential.list",
      status: "success",
      project_id: projectId,
      developer_id: developerId,
      credential_id: null,
      credential_prefix: null,
      client_id: null,
      metadata: { include_revoked: includeRevoked }
    });
    return this.rows
      .filter((row) => row.project_id === projectId && row.developer_id === developerId)
      .filter((row) => includeRevoked || !row.revoked_at)
      .map((row) => withoutHash(row));
  }

  rotate(credentialId) {
    const previous = this.rows.find((row) => row.id === credentialId);
    assert(previous, "rotate target missing");
    previous.revoked_at = new Date("2026-06-19T00:01:00Z");
    previous.updated_at = previous.revoked_at;
    const next = this.create({
      projectId: previous.project_id,
      developerId: previous.developer_id,
      clientId: previous.client_id,
      label: previous.label
    });
    const nextRow = this.rows.find((row) => row.id === next.credential.id);
    nextRow.rotated_from_credential_id = previous.id;
    this.audit("rotate", nextRow, { rotated_from_credential_id: previous.id });
    return { previous: withoutHash(previous), ...next, credential: withoutHash(nextRow) };
  }

  revoke(credentialId) {
    const row = this.rows.find((candidate) => candidate.id === credentialId);
    assert(row, "revoke target missing");
    row.revoked_at = new Date("2026-06-19T00:02:00Z");
    row.updated_at = row.revoked_at;
    this.audit("revoke", row, { result: "revoked" });
    return withoutHash(row);
  }

  assertScope(projectId, developerId) {
    if (projectId !== expectedProjectId) throw new Error("VALIDATION_ERROR: wrong project");
    if (developerId !== expectedDeveloperId) throw new Error("VALIDATION_ERROR: wrong developer");
  }

  assertClientScope(credential, clientId) {
    if (clientId && credential.client_id && credential.client_id !== clientId) {
      throw new Error("VALIDATION_ERROR: wrong client");
    }
  }

  async createRemoteMcpCredential(input) {
    return this.create({
      projectId: input.projectId,
      developerId: input.developerId,
      clientId: input.clientId ?? null,
      label: input.label ?? null
    });
  }

  async listRemoteMcpCredentials(input) {
    const rows = this.list({
      projectId: input.projectId,
      developerId: input.developerId,
      includeRevoked: input.includeRevoked === true
    });
    return input.clientId ? rows.filter((row) => row.client_id === input.clientId) : rows;
  }

  async rotateRemoteMcpCredential(input) {
    return this.rotate(input.credentialId);
  }

  async revokeRemoteMcpCredential(input) {
    return this.revoke(input.credentialId);
  }

  async getReviewDashboard(input = {}) {
    return {
      current_project_id: input.project_id ?? expectedProjectId,
      projects: [
        {
          project_id: expectedProjectId,
          developer_id: expectedDeveloperId,
          name: "Provisioning smoke project",
          primary_path: null,
          project_kind: "software_project",
          memory_domain: "agent_work",
          updated_at: new Date("2026-06-19T00:00:00Z"),
          session_count: 0,
          active_sessions: 0,
          interrupted_sessions: 0,
          event_count: 0,
          memory_count: 0,
          checkpoint_updated_at: null,
          last_context_read_at: null,
          last_memory_write_at: null,
          memory_profile: {},
          sources: []
        }
      ],
      inbox: [],
      rules: [],
      import_candidates: [],
      duplicate_conflicts: [],
      cross_project_recall: { results: [], policy: {} },
      selected_detail: null,
      available_review_actions: [],
      recent_activity: [],
      settings: [],
      costs: [],
      cleanup: {},
      source_filters: [],
      current_source_filter: null,
      starter_docs: null,
      canon_capability_context: null
    };
  }
}

const expectedProjectId = "11111111-1111-4111-8111-111111111111";
const expectedDeveloperId = "22222222-2222-4222-8222-222222222222";
const projectId = expectedProjectId;
const developerId = expectedDeveloperId;
const clientId = "remote-provisioning-client";
const serverUrl = "https://recallant.example.com";
const forbiddenCopiedSurfacePattern =
  /RECALLANT_DATABASE_URL|DATABASE_URL|postgres:\/\/|workbench_auth|admin_auth|provider_secret|provider_key|raw_artifacts_path|backup_path|\/ai\//i;

function copiedProvisioningText(output) {
  return JSON.stringify({
    command: output.provisioning.command,
    argv: output.provisioning.argv,
    rendered_config: output.provisioning.rendered_config,
    mcp_config: output.provisioning.mcp_config
  });
}

function assertCopiedSurfaceSafe(output, label) {
  const copied = copiedProvisioningText(output);
  assert(!forbiddenCopiedSurfacePattern.test(copied), `${label} copied command/config leaks a forbidden surface`);
}

function assertNoSecretOrHash(value, secret, label) {
  const text = JSON.stringify(value);
  assert(!text.includes(secret), `${label} leaked raw secret`);
  assert(!text.includes(hashSecret(secret)), `${label} leaked credential hash`);
  assert(!text.includes("credential_hash"), `${label} exposed credential_hash field`);
}

const harness = new ProvisioningHarness();
const created = harness.create({ projectId, developerId, clientId, label: "create smoke" });
const createOutput = remoteMcpProvisioningOutput({
  action: "create",
  target: "codex",
  serverUrl,
  credential: created.credential,
  bridgeClientId: clientId,
  credentialSecret: created.secret,
  includeSecret: true,
  sessionId: "provisioning-session",
  traceId: "provisioning-trace"
});

assert(createOutput.one_time_secret.shown, "create output did not show one-time secret");
assert(createOutput.one_time_secret.value === created.secret, "create output secret mismatch");
assert(createOutput.provisioning.command.includes(created.secret), "create command missing one-time secret");
assert(createOutput.provisioning.rendered_config.includes(created.secret), "create config missing one-time secret");
assertCopiedSurfaceSafe(createOutput, "create");

const rotated = harness.rotate(created.credential.id);
const rotateOutput = remoteMcpProvisioningOutput({
  action: "rotate",
  target: "cursor",
  serverUrl,
  credential: rotated.credential,
  previousCredential: rotated.previous,
  bridgeClientId: clientId,
  credentialSecret: rotated.secret,
  includeSecret: true
});

assert(rotated.previous.status === "revoked", "rotate did not revoke old credential");
assert(rotateOutput.one_time_secret.value === rotated.secret, "rotate output secret mismatch");
assert(!rotateOutput.provisioning.command.includes(created.secret), "rotate command leaked old secret");
assert(rotateOutput.previous_credential.id === created.credential.id, "rotate output missing previous credential");
assertCopiedSurfaceSafe(rotateOutput, "rotate");

const listed = harness.list({ projectId, developerId, includeRevoked: true });
const listOutputs = listed.map((credential) =>
  remoteMcpProvisioningOutput({
    action: "list",
    target: "codex",
    serverUrl,
    credential,
    bridgeClientId: credential.client_id ?? clientId,
    credentialSecret: rotated.secret,
    includeSecret: false
  })
);

for (const [index, output] of listOutputs.entries()) {
  assert(!output.one_time_secret.shown, `list output ${index} showed secret`);
  assert(output.one_time_secret.value === null, `list output ${index} included secret value`);
  assertNoSecretOrHash(output, created.secret, `list output ${index}`);
  assertNoSecretOrHash(output, rotated.secret, `list output ${index}`);
  assertCopiedSurfaceSafe(output, `list output ${index}`);
}

const revoked = harness.revoke(rotated.credential.id);
const revokeOutput = remoteMcpProvisioningOutput({
  action: "revoke",
  target: "generic",
  serverUrl,
  credential: revoked,
  bridgeClientId: clientId,
  credentialSecret: rotated.secret,
  includeSecret: false
});

assert(revoked.status === "revoked", "revoke did not mark credential revoked");
assert(!revokeOutput.one_time_secret.shown, "revoke output showed secret");
assertNoSecretOrHash(revokeOutput, rotated.secret, "revoke output");
assertCopiedSurfaceSafe(revokeOutput, "revoke");

const auditText = JSON.stringify(harness.auditRows);
assert(harness.auditRows.some((row) => row.operation === "remote_mcp_credential.create"), "missing create audit");
assert(harness.auditRows.some((row) => row.operation === "remote_mcp_credential.rotate"), "missing rotate audit");
assert(harness.auditRows.some((row) => row.operation === "remote_mcp_credential.revoke"), "missing revoke audit");
assert(harness.auditRows.some((row) => row.operation === "remote_mcp_credential.list"), "missing list audit");
assert(!auditText.includes(created.secret), "audit leaked create secret");
assert(!auditText.includes(rotated.secret), "audit leaked rotate secret");
assert(!auditText.includes("credential_hash"), "audit exposed credential hash field");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      assert(address && typeof address === "object", "provisioning smoke server did not bind");
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

async function requestJson(baseUrl, path, payload, token = "provisioning-smoke-token") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

async function requestForm(baseUrl, path, payload, token = "provisioning-smoke-token") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Bearer ${token}`
    },
    body: new URLSearchParams(payload).toString()
  });
  return { status: response.status, text: await response.text() };
}

const originalAuthToken = process.env.RECALLANT_AUTH_TOKEN;
process.env.RECALLANT_AUTH_TOKEN = "provisioning-smoke-token";
const server = createRecallantHttpServer({ workbenchDatabase: harness });
const apiBaseUrl = await listen(server);
const apiFailureMatrix = [];
try {
  const unauthorized = await fetch(
    `${apiBaseUrl}/api/remote-credentials?project_id=${projectId}&developer_id=${developerId}`
  );
  assert(unauthorized.status === 401, "remote credential API was not protected by Workbench auth");
  apiFailureMatrix.push("unauthenticated_api_rejected");

  const apiCreate = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "create",
    project_id: projectId,
    developer_id: developerId,
    client_id: clientId,
    label: "api create smoke",
    server_url: serverUrl,
    target: "codex",
    bridge_client_id: clientId
  });
  assert(apiCreate.status === 200, "API create failed");
  assert(apiCreate.body.one_time_secret, "API create did not return one-time secret");
  assert(
    apiCreate.body.provisioning.provisioning.command.includes(apiCreate.body.one_time_secret),
    "API create provisioning command missing one-time secret"
  );
  assert(!apiCreate.text.includes("credential_hash"), "API create exposed credential hash");

  const apiListResponse = await fetch(
    `${apiBaseUrl}/api/remote-credentials?project_id=${projectId}&developer_id=${developerId}&client_id=${clientId}&include_revoked=true&server_url=${encodeURIComponent(serverUrl)}&target=codex&bridge_client_id=${clientId}`,
    { headers: { authorization: `Bearer ${"provisioning-smoke-token"}` } }
  );
  const apiListText = await apiListResponse.text();
  const apiList = JSON.parse(apiListText);
  assert(apiListResponse.status === 200, "API list failed");
  assert(!apiListText.includes(apiCreate.body.one_time_secret), "API list leaked create secret");
  assert(!apiListText.includes("credential_hash"), "API list exposed credential hash");
  assert(
    apiList.provisioning_by_credential.every((output) => output.one_time_secret.value === null),
    "API list provisioning was not redacted"
  );

  const apiRotate = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "rotate",
    project_id: projectId,
    developer_id: developerId,
    client_id: clientId,
    credential_id: apiCreate.body.credential.id,
    server_url: serverUrl,
    target: "cursor",
    bridge_client_id: clientId
  });
  assert(apiRotate.status === 200, "API rotate failed");
  assert(apiRotate.body.one_time_secret, "API rotate did not return one-time secret");
  assert(!apiRotate.text.includes(apiCreate.body.one_time_secret), "API rotate leaked old secret");

  const apiRevoke = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "revoke",
    project_id: projectId,
    developer_id: developerId,
    client_id: clientId,
    credential_id: apiRotate.body.credential.id,
    server_url: serverUrl,
    target: "generic",
    bridge_client_id: clientId
  });
  assert(apiRevoke.status === 200, "API revoke failed");
  assert(apiRevoke.body.one_time_secret === undefined, "API revoke returned a raw secret");
  assert(apiRevoke.body.provisioning.one_time_secret.value === null, "API revoke provisioning leaked secret");
  assert(!apiRevoke.text.includes(apiRotate.body.one_time_secret), "API revoke leaked rotate secret");

  const wrongProject = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "list",
    project_id: "99999999-9999-4999-8999-999999999999",
    developer_id: developerId,
    server_url: serverUrl
  });
  assert(wrongProject.status === 409, "wrong project API case did not fail");
  apiFailureMatrix.push("wrong_project_rejected");
  const wrongDeveloper = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "list",
    project_id: projectId,
    developer_id: "88888888-8888-4888-8888-888888888888",
    server_url: serverUrl
  });
  assert(wrongDeveloper.status === 409, "wrong developer API case did not fail");
  apiFailureMatrix.push("wrong_developer_rejected");
  const wrongClient = await requestJson(apiBaseUrl, "/api/remote-credential", {
    action: "rotate",
    project_id: projectId,
    developer_id: developerId,
    client_id: "wrong-client",
    credential_id: apiRevoke.body.credential.id,
    server_url: serverUrl
  });
  assert(wrongClient.status === 409, "wrong client API case did not fail");
  apiFailureMatrix.push("wrong_client_rejected");

  const workbenchCreate = await requestForm(apiBaseUrl, "/remote-credential", {
    action: "create",
    project_id: projectId,
    developer_id: developerId,
    client_id: clientId,
    label: "workbench create smoke",
    server_url: serverUrl,
    target: "codex",
    bridge_client_id: clientId
  });
  assert(workbenchCreate.status === 200, "Workbench create form failed");
  assert(workbenchCreate.text.includes("One-time credential secret"), "Workbench create did not show one-time result");
  assert(!workbenchCreate.text.includes("credential_hash"), "Workbench create exposed credential hash");

  const workbenchList = await requestForm(apiBaseUrl, "/remote-credential", {
    action: "list",
    project_id: projectId,
    developer_id: developerId,
    client_id: clientId,
    include_revoked: "true",
    server_url: serverUrl,
    target: "codex",
    bridge_client_id: clientId
  });
  assert(workbenchList.status === 200, "Workbench list form failed");
  assert(!workbenchList.text.includes(apiCreate.body.one_time_secret), "Workbench list leaked API create secret");
  assert(!workbenchList.text.includes(apiRotate.body.one_time_secret), "Workbench list leaked API rotate secret");
  assert(!workbenchList.text.includes("credential_hash"), "Workbench list exposed credential hash");
} finally {
  await close(server);
  if (originalAuthToken === undefined) delete process.env.RECALLANT_AUTH_TOKEN;
  else process.env.RECALLANT_AUTH_TOKEN = originalAuthToken;
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert(
  packageJson.scripts?.["remote-mcp-provisioning:smoke"] ===
    "node scripts/smoke-remote-mcp-provisioning.mjs",
  "package script remote-mcp-provisioning:smoke is not wired"
);
const self = await readFile(new URL(import.meta.url), "utf8");
assert(!self.includes(["preflight", "placeholder"].join("_")), "provisioning smoke still contains placeholder marker");

process.stdout.write(
  `${JSON.stringify(
    {
      remote_mcp_provisioning_smoke: {
        status: "pass",
        create_secret_shown_once: createOutput.one_time_secret.shown,
        rotate_secret_shown_once: rotateOutput.one_time_secret.shown,
        list_outputs: listOutputs.length,
        revoke_secret_redacted: revokeOutput.one_time_secret.value === null,
        old_credential_revoked_by_rotate: rotated.previous.status === "revoked",
        copied_command_config_no_forbidden_surfaces: true,
        api_failure_matrix: apiFailureMatrix,
        audit_events: harness.auditRows.map((row) => row.operation),
        package_script: packageJson.scripts["remote-mcp-provisioning:smoke"]
      }
    },
    null,
    2
  )}\n`
);
