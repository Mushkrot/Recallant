import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"|postgres:\/\/|"workbench_auth"|"admin_auth"|"provider_secret"|"provider_key"|"raw_artifacts_path"|"backup_path"|\/ai\//;

const credentials = {
  valid: "doctor-fixture-valid-token",
  invalid: "doctor-fixture-invalid-token",
  expired: "doctor-fixture-expired-token",
  revoked: "doctor-fixture-revoked-token",
  rotatedOld: "doctor-fixture-rotated-old-token",
  rotatedNew: "doctor-fixture-rotated-new-token",
  edge: "doctor-fixture-edge-token"
};

const expectedScope = {
  projectId: "doctor-project",
  developerId: "doctor-developer",
  clientId: "doctor-client"
};

const originalDatabaseUrl = process.env.RECALLANT_DATABASE_URL;
delete process.env.RECALLANT_DATABASE_URL;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  if (authorization === `Bearer ${credentials.edge}`) {
    return { edge: true };
  }
  if (authorization === `Bearer ${credentials.invalid}`) {
    return jsonRpcError(body.id, -32001, "credential is invalid", 401, {
      code: "invalid_credential"
    });
  }
  if (authorization === `Bearer ${credentials.expired}`) {
    return jsonRpcError(body.id, -32001, "credential is expired", 401, {
      code: "expired_credential"
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

async function startFixture() {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const rawBody = await readBody(request);
      const body = JSON.parse(rawBody || "{}");
      const trace = request.headers["x-recallant-trace-id"] ?? "";
      requests.push({ url: request.url, method: body.method, trace });

      if (trace === "edge-denied") {
        response.writeHead(403, { "content-type": "text/html" });
        response.end("<html>Cloudflare Access denied</html>");
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/mcp") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("wrong endpoint");
        return;
      }
      if (trace === "invalid-json") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("not json");
        return;
      }

      const authError = authOrScopeError(request.headers, body);
      if (authError?.edge) {
        response.writeHead(403, { "content-type": "text/html" });
        response.end("<html>Access denied</html>");
        return;
      }
      if (authError) {
        response.writeHead(authError.httpStatus, { "content-type": "application/json" });
        response.end(JSON.stringify(authError.payload));
        return;
      }

      if (body.method === "initialize") {
        if (trace === "initialize-fail") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify(
              jsonRpcError(body.id, -32060, "initialize failed", 200, {
                code: "initialize_failed"
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
              protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
              capabilities: { tools: {} }
            }
          })
        );
        return;
      }
      if (body.method === "tools/list") {
        if (trace === "tools-fail") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify(
              jsonRpcError(body.id, -32061, "tools failed", 200, {
                code: "tools_list_failed"
              }).payload
            )
          );
          return;
        }
        const tools =
          trace === "capture-missing"
            ? [{ name: "memory_heartbeat" }]
            : [
                { name: "memory_start_session" },
                { name: "memory_get_context_pack" },
                { name: "memory_heartbeat" }
              ];
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
              content: [{ type: "text", text: "capture proof ok" }],
              structuredContent: {
                ok: true,
                session_id: "00000000-0000-4000-8000-000000000001",
                redaction_fixture: "Bearer should-not-appear"
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
  assert(address && typeof address === "object", "fixture server did not bind");
  return {
    requests,
    server,
    serverUrl: `http://127.0.0.1:${address.port}`
  };
}

async function runDoctor(args, { expectExit = 0 } = {}) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ["apps/cli/dist/index.js", "remote-doctor", ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env }
      }
    );
    assert(expectExit === 0, `expected non-zero exit for ${args.join(" ")}`);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const exitCode = Number(error.code ?? 1);
    assert(
      exitCode === expectExit,
      `expected exit ${expectExit}, got ${exitCode}: ${error.stdout}`
    );
    return { stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), exitCode };
  }
}

function baseArgs(fixture, overrides = {}) {
  return [
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
    "--timeout-ms",
    "1000",
    "--allow-insecure-localhost",
    "--format",
    overrides.format ?? "json",
    ...(overrides.traceId ? ["--trace-id", overrides.traceId] : []),
    ...(overrides.captureProof ? ["--capture-proof"] : [])
  ];
}

function parseJsonOutput(result) {
  return JSON.parse(result.stdout);
}

function stageCode(report, id) {
  const stage = report.stages.find((entry) => entry.id === id);
  assert(stage, `missing stage ${id}`);
  return `${stage.status}:${stage.code}`;
}

function assertNoLeak(name, output) {
  assert(!forbiddenOutputPattern.test(output), `${name} leaked forbidden surface`);
  for (const secret of Object.values(credentials)) {
    assert(!output.includes(secret), `${name} leaked fixture credential`);
  }
  assert(!output.includes("Bearer should-not-appear"), `${name} leaked raw proof fixture`);
}

const fixture = await startFixture();
const summary = [];

try {
  const success = parseJsonOutput(await runDoctor(baseArgs(fixture)));
  assert(stageCode(success, "mcp_initialize") === "pass:initialize_ok", "initialize did not pass");
  assert(stageCode(success, "tools_list") === "pass:tools_list_ok", "tools/list did not pass");
  assert(
    success.stages.find((stage) => stage.id === "tools_list").metadata.tool_names.length === 3
  );
  assertNoLeak("success-json", JSON.stringify(success));
  summary.push({ scenario: "success-json", ok: true });

  const human = await runDoctor(baseArgs(fixture, { format: "text" }));
  assert(human.stdout.includes("Recallant remote-doctor"));
  assert(human.stdout.includes("tools_list: pass tools_list_ok"));
  assertNoLeak("success-human", human.stdout);
  summary.push({ scenario: "success-human", ok: true });

  const nonHttps = parseJsonOutput(
    await runDoctor(
      [
        "--server-url",
        "http://example.invalid",
        "--credential",
        credentials.valid,
        "--project-id",
        expectedScope.projectId,
        "--developer-id",
        expectedScope.developerId,
        "--client-id",
        expectedScope.clientId,
        "--format",
        "json"
      ],
      { expectExit: 1 }
    )
  );
  assert(stageCode(nonHttps, "url_validation") === "fail:non_https_url");
  assertNoLeak("non-https", JSON.stringify(nonHttps));
  summary.push({ scenario: "non-https", ok: true });

  const missingCredential = parseJsonOutput(
    await runDoctor(
      [
        "--server-url",
        "https://recallant.example.test",
        "--project-id",
        expectedScope.projectId,
        "--developer-id",
        expectedScope.developerId,
        "--client-id",
        expectedScope.clientId,
        "--format",
        "json"
      ],
      { expectExit: 1 }
    )
  );
  assert(stageCode(missingCredential, "url_validation") === "fail:missing_required_input");
  assertNoLeak("missing-credential", JSON.stringify(missingCredential));
  summary.push({ scenario: "missing-credential", ok: true });

  const unreachable = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { serverUrl: "http://127.0.0.1:9" }), { expectExit: 1 })
  );
  assert(stageCode(unreachable, "network_reachability") === "fail:endpoint_unreachable");
  summary.push({ scenario: "unreachable", ok: true });

  const wrongEndpoint = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { serverUrl: `${fixture.serverUrl}/wrong` }), {
      expectExit: 1
    })
  );
  assert(stageCode(wrongEndpoint, "endpoint_shape") === "fail:wrong_endpoint");
  summary.push({ scenario: "wrong-endpoint", ok: true });

  const invalidJson = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "invalid-json" }), { expectExit: 1 })
  );
  assert(stageCode(invalidJson, "endpoint_shape") === "fail:wrong_endpoint");
  summary.push({ scenario: "invalid-json", ok: true });

  const edgeDenied = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { credential: credentials.edge }), { expectExit: 1 })
  );
  assert(stageCode(edgeDenied, "edge_access_posture") === "fail:edge_access_denied");
  summary.push({ scenario: "edge-denied", ok: true });

  for (const [scenario, credential, expected] of [
    ["invalid-credential", credentials.invalid, "fail:invalid_credential"],
    ["expired-credential", credentials.expired, "fail:expired_credential"],
    ["revoked-credential", credentials.revoked, "fail:revoked_credential"],
    ["rotated-old-credential", credentials.rotatedOld, "fail:rotated_credential"]
  ]) {
    const report = parseJsonOutput(
      await runDoctor(baseArgs(fixture, { credential }), { expectExit: 1 })
    );
    assert(stageCode(report, "credential_auth") === expected, `${scenario} mismatch`);
    assertNoLeak(scenario, JSON.stringify(report));
    summary.push({ scenario, ok: true });
  }

  const rotatedNew = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { credential: credentials.rotatedNew }))
  );
  assert(stageCode(rotatedNew, "credential_auth") === "pass:credential_ok");
  assert(stageCode(rotatedNew, "tools_list") === "pass:tools_list_ok");
  summary.push({ scenario: "rotated-new-credential", ok: true });

  for (const [scenario, overrides, expected] of [
    ["wrong-project", { projectId: "wrong-project" }, "fail:project_scope_mismatch"],
    ["wrong-developer", { developerId: "wrong-developer" }, "fail:developer_scope_mismatch"],
    ["wrong-client", { clientId: "wrong-client" }, "fail:client_scope_mismatch"]
  ]) {
    const report = parseJsonOutput(
      await runDoctor(baseArgs(fixture, overrides), { expectExit: 1 })
    );
    assert(stageCode(report, "scope") === expected, `${scenario} mismatch`);
    summary.push({ scenario, ok: true });
  }

  const initializeFailure = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "initialize-fail" }), { expectExit: 1 })
  );
  assert(stageCode(initializeFailure, "mcp_initialize") === "fail:initialize_failed");
  summary.push({ scenario: "initialize-failure", ok: true });

  const toolsFailure = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "tools-fail" }), { expectExit: 1 })
  );
  assert(stageCode(toolsFailure, "tools_list") === "fail:tools_list_failed");
  summary.push({ scenario: "tools-list-failure", ok: true });

  const capturePass = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "capture-pass", captureProof: true }))
  );
  assert(stageCode(capturePass, "capture_recall_proof") === "pass:capture_recall_proof_ok");
  assertNoLeak("capture-pass", JSON.stringify(capturePass));
  summary.push({ scenario: "capture-pass", ok: true });

  const captureMissing = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "capture-missing", captureProof: true }))
  );
  assert(
    stageCode(captureMissing, "capture_recall_proof") === "warn:capture_recall_proof_unavailable"
  );
  assert(stageCode(captureMissing, "tools_list") === "pass:tools_list_ok");
  summary.push({ scenario: "capture-missing", ok: true });

  const captureFailure = parseJsonOutput(
    await runDoctor(baseArgs(fixture, { traceId: "capture-fail", captureProof: true }), {
      expectExit: 1
    })
  );
  assert(stageCode(captureFailure, "capture_recall_proof") === "fail:capture_recall_proof_failed");
  assert(stageCode(captureFailure, "tools_list") === "pass:tools_list_ok");
  summary.push({ scenario: "capture-failure", ok: true });

  assert(!process.env.RECALLANT_DATABASE_URL, "remote doctor smoke restored DB env too early");

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        scenario_count: summary.length,
        scenarios: summary,
        no_database_url_env: !process.env.RECALLANT_DATABASE_URL,
        fixture_request_count: fixture.requests.length
      },
      null,
      2
    )}\n`
  );
} finally {
  fixture.server.close();
  if (originalDatabaseUrl !== undefined) process.env.RECALLANT_DATABASE_URL = originalDatabaseUrl;
}
