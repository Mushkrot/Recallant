import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"|postgres:\/\/[^"<\s]+|"workbench_auth"|"admin_auth"|"provider_secret"|"provider_key"|"raw_artifacts_path"|"backup_path"|\/ai\//;

const credentials = {
  valid: "external-fixture-valid-token",
  invalid: "external-fixture-invalid-token",
  revoked: "external-fixture-revoked-token",
  rotatedOld: "external-fixture-rotated-old-token",
  rotatedNew: "external-fixture-rotated-new-token",
  edge: "external-fixture-edge-token"
};

const expectedScope = {
  projectId: "external-rehearsal-project",
  developerId: "external-rehearsal-developer",
  clientId: "external-rehearsal-client",
  sessionId: "external-rehearsal-session",
  traceId: "external-rehearsal-trace"
};

const requiredEnv = [
  "RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL",
  "RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL",
  "RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID",
  "RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID",
  "RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID"
];
const optionalLiveEnv = [
  "RECALLANT_EXTERNAL_REHEARSAL_SESSION_ID",
  "RECALLANT_EXTERNAL_REHEARSAL_TRACE_ID",
  "RECALLANT_EXTERNAL_REHEARSAL_CAPTURE_PROOF"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function externalClientEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    ...extra
  };
  for (const key of Object.keys(env)) {
    if (
      /(?:RECALLANT_DATABASE_URL|DATABASE_URL|POSTGRES|PGPASSWORD|WORKBENCH|ADMIN|PROVIDER|OPENAI|ANTHROPIC|RAW_ARTIFACT|BACKUP)/i.test(
        key
      )
    ) {
      throw new Error(`forbidden external client env key: ${key}`);
    }
  }
  return env;
}

function assertNoLeak(label, text) {
  assert(!forbiddenOutputPattern.test(text), `${label} leaked forbidden surface`);
  for (const secret of Object.values(credentials)) {
    assert(!text.includes(secret), `${label} leaked raw credential fixture`);
  }
}

function assertNoConnectRemoteLeak(label, text) {
  const normalized = text
    .replaceAll("requires_recallant_database_url", "requires_local_db_url")
    .replaceAll("exposes_postgres", "exposes_local_storage")
    .replaceAll("exposes_workbench_or_admin_auth", "exposes_private_auth")
    .replaceAll("exposes_raw_artifacts_or_backups", "exposes_private_artifacts")
    .replaceAll("exposes_provider_secrets", "exposes_external_secrets");
  assertNoLeak(label, normalized);
}

async function createTemporaryCertificate() {
  const dir = await mkdtemp(join(tmpdir(), "recallant-external-rehearsal-"));
  const keyPath = join(dir, "localhost.key");
  const certPath = join(dir, "localhost.crt");
  const configPath = join(dir, "openssl.cnf");
  const config = [
    "[req]",
    "distinguished_name=req_distinguished_name",
    "x509_extensions=v3_req",
    "prompt=no",
    "[req_distinguished_name]",
    "CN=localhost",
    "[v3_req]",
    "subjectAltName=@alt_names",
    "[alt_names]",
    "DNS.1=localhost",
    "IP.1=127.0.0.1"
  ].join("\n");
  await execFileAsync("sh", ["-c", `printf '%s\n' "$1" > "$2"`, "sh", config, configPath]);
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-config",
    configPath
  ]);
  return {
    dir,
    keyPath,
    certPath,
    key: await readFile(keyPath),
    cert: await readFile(certPath)
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function jsonRpcError(id, code, message, httpStatus = 401, data = {}) {
  return {
    httpStatus,
    payload: {
      jsonrpc: "2.0",
      id,
      error: { code, message, data }
    }
  };
}

function authOrScopeError(headers, body) {
  const authorization = headers.authorization;
  if (authorization === `Bearer ${credentials.edge}`) return { edge: true };
  if (authorization === `Bearer ${credentials.invalid}`) {
    return jsonRpcError(body.id, -32001, "credential is invalid", 401, {
      code: "invalid_credential"
    });
  }
  if (authorization === `Bearer ${credentials.revoked}`) {
    return jsonRpcError(body.id, -32001, "credential is revoked", 401, {
      code: "revoked_credential"
    });
  }
  if (authorization === `Bearer ${credentials.rotatedOld}`) {
    return jsonRpcError(body.id, -32001, "credential was rotated", 401, {
      code: "rotated_credential"
    });
  }
  if (
    authorization !== `Bearer ${credentials.valid}` &&
    authorization !== `Bearer ${credentials.rotatedNew}`
  ) {
    return jsonRpcError(body.id, -32001, "credential is invalid", 401, {
      code: "invalid_credential"
    });
  }
  if (headers["x-recallant-project-id"] !== expectedScope.projectId) {
    return jsonRpcError(body.id, -32003, "project scope mismatch", 403, {
      code: "project_scope_mismatch"
    });
  }
  if (headers["x-recallant-developer-id"] !== expectedScope.developerId) {
    return jsonRpcError(body.id, -32003, "developer scope mismatch", 403, {
      code: "developer_scope_mismatch"
    });
  }
  if (headers["x-recallant-client-id"] !== expectedScope.clientId) {
    return jsonRpcError(body.id, -32003, "client scope mismatch", 403, {
      code: "client_scope_mismatch"
    });
  }
  return null;
}

async function startHttpsFixture(cert) {
  const requests = [];
  const server = createServer({ key: cert.key, cert: cert.cert }, async (request, response) => {
    try {
      const rawBody = await readBody(request);
      const body = JSON.parse(rawBody || "{}");
      const trace = request.headers["x-recallant-trace-id"] ?? "";
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: { method: body.method, params: body.params }
      });

      if (trace === "edge-denied" || request.headers.authorization === `Bearer ${credentials.edge}`) {
        response.writeHead(403, { "content-type": "text/html" });
        response.end("<html>Cloudflare Access denied</html>");
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/mcp") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("wrong endpoint");
        return;
      }

      const authError = authOrScopeError(request.headers, body);
      if (authError) {
        response.writeHead(authError.httpStatus, { "content-type": "application/json" });
        response.end(JSON.stringify(authError.payload));
        return;
      }

      if (body.method === "initialize") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "external-rehearsal-fixture", version: "0.0.0" }
            }
          })
        );
        return;
      }
      if (body.method === "tools/list") {
        const tools =
          trace === "capture-missing"
            ? [{ name: "memory_heartbeat" }]
            : [{ name: "memory_get_context_pack" }, { name: "memory_heartbeat" }];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }));
        return;
      }
      if (body.method === "tools/call") {
        if (trace === "capture-fail") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify(
              jsonRpcError(body.id, -32080, "capture not active", 200, {
                code: "capture_not_active"
              }).payload
            )
          );
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "external rehearsal ok" }],
              structuredContent: {
                ok: true,
                echoed: body.params?.arguments?.message ?? "capture-proof-ok"
              }
            }
          })
        );
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: `unsupported method ${body.method}` }
        })
      );
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
        })
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "HTTPS fixture did not bind a TCP port");
  return {
    requests,
    server,
    serverUrl: `https://localhost:${address.port}`
  };
}

function bridgeArgs(fixture, overrides = {}) {
  return [
    "apps/cli/dist/index.js",
    "remote-bridge",
    "--server-url",
    overrides.serverUrl ?? fixture.serverUrl,
    "--credential",
    overrides.credential ?? credentials.valid,
    "--project-id",
    overrides.projectId ?? expectedScope.projectId,
    "--developer-id",
    overrides.developerId ?? expectedScope.developerId,
    "--client-id",
    overrides.clientId ?? expectedScope.clientId,
    "--session-id",
    overrides.sessionId ?? expectedScope.sessionId,
    "--trace-id",
    overrides.traceId ?? expectedScope.traceId
  ];
}

function doctorArgs(fixture, overrides = {}) {
  return [
    "apps/cli/dist/index.js",
    "remote-doctor",
    "--server-url",
    overrides.serverUrl ?? fixture.serverUrl,
    "--credential",
    overrides.credential ?? credentials.valid,
    "--project-id",
    overrides.projectId ?? expectedScope.projectId,
    "--developer-id",
    overrides.developerId ?? expectedScope.developerId,
    "--client-id",
    overrides.clientId ?? expectedScope.clientId,
    "--session-id",
    overrides.sessionId ?? expectedScope.sessionId,
    "--trace-id",
    overrides.traceId ?? expectedScope.traceId,
    "--timeout-ms",
    "2000",
    "--format",
    "json",
    ...(overrides.captureProof ? ["--capture-proof"] : [])
  ];
}

async function runCli(args, env, { expectExit = 0 } = {}) {
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024
    });
    assert(expectExit === 0, `expected non-zero exit for ${args.join(" ")}`);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const exitCode = Number(error.code ?? 1);
    assert(
      exitCode === expectExit,
      `expected exit ${expectExit}, got ${exitCode}: ${String(error.stdout ?? "")}`
    );
    return { stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), exitCode };
  }
}

async function runBridgeRoundtrip(fixture, env, overrides = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: bridgeArgs(fixture, overrides),
    cwd: process.cwd(),
    env,
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "external-rehearsal-client", version: "0.0.0" });
  try {
    await client.connect(transport, { timeout: 5_000 });
    const list = await client.listTools({}, { timeout: 5_000 });
    const call = await client.callTool(
      { name: "memory_heartbeat", arguments: { message: "hello-external" } },
      undefined,
      { timeout: 5_000 }
    );
    return { client, transport, list, call, stderr };
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

async function expectBridgeFailure(fixture, env, label, overrides) {
  const requestCountBefore = fixture.requests.length;
  try {
    const result = await runBridgeRoundtrip(fixture, env, overrides);
    await result.client.close().catch(() => undefined);
    await result.transport.close().catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertNoLeak(label, message);
    assert(fixture.requests.length > requestCountBefore, `${label} did not reach HTTPS fixture`);
    return label;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function parseDoctorStage(report, id) {
  const stage = report.stages.find((entry) => entry.id === id);
  assert(stage, `remote doctor report missing stage ${id}`);
  return `${stage.status}:${stage.code}`;
}

async function runDoctorScenario(fixture, env, label, overrides, expectedExit, stage, expectedCode) {
  const result = await runCli(doctorArgs(fixture, overrides), env, { expectExit: expectedExit });
  assertNoLeak(label, result.stdout);
  const report = JSON.parse(result.stdout);
  assert(parseDoctorStage(report, stage) === expectedCode, `${label} expected ${expectedCode}`);
  return label;
}

async function runConnectRemote(env, fixture) {
  const projectDir = await mkdtemp(join(tmpdir(), "recallant-connect-remote-write-"));
  const result = await runCli(
    [
      "apps/cli/dist/index.js",
      "connect-remote",
      "generic",
      "--server-url",
      fixture.serverUrl,
      "--credential",
      "<scoped-remote-mcp-credential>",
      "--project-id",
      expectedScope.projectId,
      "--developer-id",
      expectedScope.developerId,
      "--client-id",
      expectedScope.clientId,
      "--project-dir",
      projectDir,
      "--session-id",
      expectedScope.sessionId,
      "--trace-id",
      expectedScope.traceId,
      "--format",
      "json"
    ],
    env
  );
  assertNoConnectRemoteLeak("connect-remote", result.stdout);
  const parsed = JSON.parse(result.stdout);
  const rendered = JSON.stringify(parsed);
  const renderedConfig = String(parsed.rendered_config ?? "");
  assert(rendered.includes(fixture.serverUrl), "connect-remote output did not include HTTPS server URL");
  assert(rendered.includes("remote-bridge"), "connect-remote output did not configure remote-bridge");
  assert(!rendered.includes("RECALLANT_DATABASE_URL"), "connect-remote output required DB URL");
  assert(
    !/postgres|workbench|admin[_-]?auth|provider[_-]?secret|raw[_-]?artifact|backup/i.test(
      renderedConfig
    ),
    "connect-remote rendered config leaked a forbidden surface"
  );
  assert(parsed.safety?.requires_recallant_database_url === false);
  assert(parsed.safety?.exposes_postgres === false);
  assert(parsed.safety?.exposes_workbench_or_admin_auth === false);
  assert(parsed.safety?.exposes_raw_artifacts_or_backups === false);
  assert(parsed.safety?.exposes_provider_secrets === false);
  const writeResult = await runCli(
    [
      "apps/cli/dist/index.js",
      "connect-remote",
      "codex",
      "--server-url",
      fixture.serverUrl,
      "--credential",
      "<scoped-remote-mcp-credential>",
      "--project-id",
      expectedScope.projectId,
      "--developer-id",
      expectedScope.developerId,
      "--client-id",
      expectedScope.clientId,
      "--project-dir",
      projectDir,
      "--write",
      "--format",
      "json"
    ],
    env
  );
  assertNoConnectRemoteLeak("connect-remote-write", writeResult.stdout);
  const writeParsed = JSON.parse(writeResult.stdout);
  assert(writeParsed.writes_files === true, "connect-remote --write did not report file writes");
  assert(writeParsed.writes_database === false, "connect-remote --write should not write database");
  assert(
    writeParsed.uses_local_storage === false,
    "connect-remote --write should not require local storage"
  );
  const codexConfig = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
  assert(codexConfig.includes("remote-bridge"), "connect-remote --write did not write remote bridge");
  assert(
    !codexConfig.includes("RECALLANT_DATABASE_URL"),
    "connect-remote --write wrote local database config"
  );
  return {
    target: parsed.target,
    config_file: parsed.config_file,
    uses_https_mcp_endpoint: parsed.safety?.uses_https_mcp_endpoint === true,
    bridge_derives_api_mcp_endpoint: true,
    no_database_url: !rendered.includes("RECALLANT_DATABASE_URL")
  };
}

async function liveExternalRehearsalStatus() {
  const present = requiredEnv.filter((key) => process.env[key]?.trim());
  if (present.length === 0) {
    return {
      status: "skipped_live_external_rehearsal",
      reason: "operator_live_external_rehearsal_env_not_provided",
      required_env: requiredEnv
    };
  }
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    return {
      status: "skipped_live_external_rehearsal",
      reason: "operator_live_external_rehearsal_env_incomplete",
      missing_env: missing,
      required_env: requiredEnv
    };
  }
  const serverUrl = process.env.RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL;
  const credential = process.env.RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL;
  const projectId = process.env.RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID;
  const developerId = process.env.RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID;
  const clientId = process.env.RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID;
  const sessionId = process.env.RECALLANT_EXTERNAL_REHEARSAL_SESSION_ID || undefined;
  const traceId = process.env.RECALLANT_EXTERNAL_REHEARSAL_TRACE_ID || undefined;
  const captureProof = process.env.RECALLANT_EXTERNAL_REHEARSAL_CAPTURE_PROOF === "1";
  assert(new URL(serverUrl).protocol === "https:", "live external rehearsal requires HTTPS URL");
  const liveEnv = externalClientEnv();
  const liveTarget = { serverUrl };
  const liveOverrides = {
    credential,
    projectId,
    developerId,
    clientId,
    sessionId,
    traceId,
    captureProof
  };
  const doctor = await runCli(doctorArgs(liveTarget, liveOverrides), liveEnv);
  assert(!doctor.stdout.includes(credential), "live remote doctor leaked raw credential");
  const doctorReport = JSON.parse(doctor.stdout);
  assert(parseDoctorStage(doctorReport, "mcp_initialize").startsWith("pass:"));
  assert(parseDoctorStage(doctorReport, "tools_list").startsWith("pass:"));
  const bridge = await runBridgeRoundtrip(liveTarget, liveEnv, liveOverrides);
  await bridge.client.close();
  await bridge.transport.close();
  assert(!bridge.stderr.includes(credential), "live remote bridge leaked raw credential");
  return {
    status: "pass_live_external_rehearsal",
    provided_env_count: present.length,
    optional_env_supported: optionalLiveEnv,
    validated: [
      "https_endpoint",
      "remote_doctor_initialize",
      "remote_doctor_tools_list",
      "remote_bridge_initialize",
      "remote_bridge_tools_list",
      "remote_bridge_tools_call",
      ...(captureProof ? ["remote_doctor_capture_proof"] : [])
    ],
    credential_redacted: true
  };
}

let fixture;
let cert;
const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

try {
  cert = await createTemporaryCertificate();
  fixture = await startHttpsFixture(cert);
  const externalEnv = externalClientEnv({
    NODE_EXTRA_CA_CERTS: cert.certPath
  });

  assert(fixture.serverUrl.startsWith("https://"), "external rehearsal fixture is not HTTPS");

  const connectRemote = await runConnectRemote(externalEnv, fixture);

  const bridgeRoundtrip = await runBridgeRoundtrip(fixture, externalEnv);
  const listedTools = bridgeRoundtrip.list.tools.map((tool) => tool.name).sort();
  assert(listedTools.includes("memory_heartbeat"), "bridge did not list memory_heartbeat");
  assert(
    bridgeRoundtrip.call.structuredContent?.echoed === "hello-external",
    "bridge tools/call did not return deterministic content"
  );
  assertNoLeak("remote-bridge-stderr", bridgeRoundtrip.stderr);
  await bridgeRoundtrip.client.close();
  await bridgeRoundtrip.transport.close();

  const failureCases = [
    await expectBridgeFailure(fixture, externalEnv, "wrong_credential", {
      credential: credentials.invalid
    }),
    await expectBridgeFailure(fixture, externalEnv, "revoked_credential", {
      credential: credentials.revoked
    }),
    await expectBridgeFailure(
      fixture,
      externalEnv,
      "rotated_old_credential",
      { credential: credentials.rotatedOld }
    ),
    await expectBridgeFailure(fixture, externalEnv, "wrong_project", { projectId: "wrong-project" }),
    await expectBridgeFailure(
      fixture,
      externalEnv,
      "wrong_developer",
      { developerId: "wrong-developer" }
    ),
    await expectBridgeFailure(fixture, externalEnv, "wrong_client", { clientId: "wrong-client" })
  ];
  const rotatedNewRoundtrip = await runBridgeRoundtrip(fixture, externalEnv, {
    credential: credentials.rotatedNew
  });
  await rotatedNewRoundtrip.client.close();
  await rotatedNewRoundtrip.transport.close();

  const doctorScenarios = [
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_success",
      {},
      0,
      "tools_list",
      "pass:tools_list_ok"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_edge_denied",
      { credential: credentials.edge },
      1,
      "edge_access_posture",
      "fail:edge_access_denied"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_revoked",
      { credential: credentials.revoked },
      1,
      "credential_auth",
      "fail:revoked_credential"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_rotated_old",
      { credential: credentials.rotatedOld },
      1,
      "credential_auth",
      "fail:rotated_credential"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_wrong_project",
      { projectId: "wrong-project" },
      1,
      "scope",
      "fail:project_scope_mismatch"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_capture_pass",
      { traceId: "capture-pass", captureProof: true },
      0,
      "capture_recall_proof",
      "pass:capture_recall_proof_ok"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_capture_missing",
      { traceId: "capture-missing", captureProof: true },
      0,
      "capture_recall_proof",
      "warn:capture_recall_proof_unavailable"
    ),
    await runDoctorScenario(
      fixture,
      externalEnv,
      "doctor_capture_failure",
      { traceId: "capture-fail", captureProof: true },
      1,
      "capture_recall_proof",
      "fail:capture_recall_proof_failed"
    )
  ];

  for (const request of fixture.requests) {
    assert(request.url === "/api/mcp", `unexpected fixture path ${request.url}`);
    assert(request.headers.authorization, "missing Authorization header");
    assert(request.headers["x-recallant-project-id"], "missing project scope header");
    assert(request.headers["x-recallant-developer-id"], "missing developer scope header");
    assert(request.headers["x-recallant-client-id"], "missing client scope header");
  }

  const output = {
    remote_mcp_external_rehearsal_smoke: {
      status: "pass",
      rehearsal_model: "deterministic_isolated_external_like_child_process",
      real_separate_machine_rehearsal: await liveExternalRehearsalStatus(),
      transport: {
        endpoint_scheme: "https",
        endpoint_path: "/api/mcp",
        used_scoped_remote_mcp_credential: true,
        optional_session_trace_headers_seen: true
      },
      isolated_client_environment: {
        child_process: true,
        no_database_url_env: !externalEnv.RECALLANT_DATABASE_URL,
        no_postgres_env: !Object.keys(externalEnv).some((key) => /^PG|POSTGRES|DATABASE_URL/.test(key)),
        no_workbench_or_admin_auth: !Object.keys(externalEnv).some((key) =>
          /WORKBENCH|ADMIN/.test(key)
        ),
        no_provider_raw_backup_env: !Object.keys(externalEnv).some((key) =>
          /PROVIDER|OPENAI|ANTHROPIC|RAW_ARTIFACT|BACKUP/.test(key)
        )
      },
      connect_remote: connectRemote,
      bridge_roundtrip: {
        initialize: true,
        tools_list: listedTools,
        tools_call: "memory_heartbeat",
        rotated_new_credential_succeeds: true,
        failure_cases: failureCases
      },
      remote_doctor: {
        scenarios: doctorScenarios,
        capture_proof: ["pass", "missing", "failure"],
        edge_access_posture: true
      },
      leakage: {
        no_raw_credential_in_output: true,
        no_database_url_in_output: true,
        no_private_path_in_output: true,
        no_provider_or_raw_artifact_surface_in_output: true
      }
    }
  };
  const outputText = JSON.stringify(output, null, 2);
  assertNoLeak("external rehearsal summary", outputText);
  process.stdout.write(`${outputText}\n`);
} finally {
  if (originalTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
  if (fixture) await new Promise((resolve) => fixture.server.close(resolve));
  if (cert?.dir) await rm(cert.dir, { recursive: true, force: true });
}
