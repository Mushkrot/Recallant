import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRecallantRemoteBridgeServer,
  runRecallantRemoteBridge
} from "../packages/mcp/dist/remote-bridge.js";
import {
  storeRemoteMcpCredential,
  validateRemoteMcpBridgeConfig
} from "../packages/contracts/dist/index.js";
import {
  remoteClientTargetConfig,
  renderRemoteClientTargetConfig
} from "../apps/cli/dist/client-targets.js";

const forbiddenPattern =
  /RECALLANT_DATABASE_URL|postgres|workbench|admin[_-]?auth|raw[_-]?artifact|backup|provider[_-]?secret/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const validCredential = "bridge-fixture-valid-token";
const rotatedNewCredential = "bridge-fixture-rotated-new-token";
const revokedCredential = "bridge-fixture-revoked-token";
const rotatedOldCredential = "bridge-fixture-rotated-old-token";
const wrongCredential = "bridge-fixture-wrong-token";
const expectedScope = {
  projectId: "remote-bridge-project",
  developerId: "remote-bridge-developer",
  clientId: "remote-bridge-client",
  sessionId: "remote-bridge-session",
  traceId: "remote-bridge-trace"
};

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

function jsonRpcError(id, code, message, httpStatus = 401) {
  return {
    httpStatus,
    payload: {
      jsonrpc: "2.0",
      id,
      error: { code, message }
    }
  };
}

function authErrorFor(headers, body) {
  const authorization = headers.authorization;
  if (authorization === `Bearer ${revokedCredential}`) {
    return jsonRpcError(body.id, -32001, "INVALID_SCOPE_TOKEN: credential is revoked");
  }
  if (authorization === `Bearer ${rotatedOldCredential}`) {
    return jsonRpcError(body.id, -32001, "INVALID_SCOPE_TOKEN: credential was rotated");
  }
  if (
    authorization !== `Bearer ${validCredential}` &&
    authorization !== `Bearer ${rotatedNewCredential}`
  ) {
    return jsonRpcError(body.id, -32001, "INVALID_SCOPE_TOKEN: credential is invalid");
  }
  if (headers["x-recallant-project-id"] !== expectedScope.projectId) {
    return jsonRpcError(body.id, -32003, "PROJECT_SCOPE_MISMATCH: project scope mismatch", 403);
  }
  if (headers["x-recallant-developer-id"] !== expectedScope.developerId) {
    return jsonRpcError(body.id, -32003, "PROJECT_SCOPE_MISMATCH: developer scope mismatch", 403);
  }
  if (headers["x-recallant-client-id"] !== expectedScope.clientId) {
    return jsonRpcError(body.id, -32003, "PROJECT_SCOPE_MISMATCH: client scope mismatch", 403);
  }
  return null;
}

async function startCentralMcpFixture() {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const rawBody = await readBody(request);
      const body = JSON.parse(rawBody);
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      response.setHeader("content-type", "application/json");
      if (request.method !== "POST" || request.url !== "/api/mcp") {
        response.statusCode = 404;
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id ?? null,
            error: { code: -32004, message: "not found" }
          })
        );
        return;
      }
      const authError = authErrorFor(request.headers, body);
      if (authError) {
        response.statusCode = authError.httpStatus;
        response.end(JSON.stringify(authError.payload));
        return;
      }
      if (body.method === "initialize") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "central-recallant-fixture", version: "0.0.0" }
            }
          })
        );
        return;
      }
      if (body.method === "tools/list") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "memory_heartbeat",
                  title: "Memory heartbeat",
                  description: "Deterministic remote bridge smoke tool.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      message: { type: "string" }
                    },
                    additionalProperties: false
                  }
                }
              ]
            }
          })
        );
        return;
      }
      if (body.method === "tools/call") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    tool: body.params?.name,
                    echoed: body.params?.arguments?.message
                  })
                }
              ],
              structuredContent: {
                ok: true,
                echoed: body.params?.arguments?.message
              }
            }
          })
        );
        return;
      }
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: `unsupported method ${body.method}` }
        })
      );
    } catch (error) {
      response.statusCode = 500;
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
  assert(address && typeof address === "object", "fixture server did not bind a TCP port");
  return {
    server,
    requests,
    serverUrl: `http://127.0.0.1:${address.port}`
  };
}

const originalDatabaseUrl = process.env.RECALLANT_DATABASE_URL;
delete process.env.RECALLANT_DATABASE_URL;

const fixture = await startCentralMcpFixture();
const credentialStoreDir = await mkdtemp(join(tmpdir(), "recallant-bridge-credential-store-"));
const credentialStore = storeRemoteMcpCredential({
  credential: validCredential,
  serverUrl: fixture.serverUrl,
  projectId: expectedScope.projectId,
  developerId: expectedScope.developerId,
  clientId: expectedScope.clientId,
  credentialPrefix: "bridge-fixture",
  storePath: join(credentialStoreDir, "remote-mcp-credentials.json")
});
function bridgeConfig(overrides = {}) {
  return {
    serverUrl: fixture.serverUrl,
    endpointUrl: `${fixture.serverUrl}/api/mcp`,
    credential: validCredential,
    projectId: expectedScope.projectId,
    developerId: expectedScope.developerId,
    clientId: expectedScope.clientId,
    sessionId: expectedScope.sessionId,
    traceId: expectedScope.traceId,
    ...overrides
  };
}

async function runBridgeRoundtrip(overrides = {}) {
  let bridgeServer;
  let mcpClient;
  try {
    bridgeServer = await createRecallantRemoteBridgeServer(bridgeConfig(overrides));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: "remote-bridge-smoke-client", version: "0.0.0" });
    await bridgeServer.connect(serverTransport);
    await mcpClient.connect(clientTransport, { timeout: 5_000 });

    const list = await mcpClient.listTools({}, { timeout: 5_000 });
    const call = await mcpClient.callTool(
      { name: "memory_heartbeat", arguments: { message: "hello-bridge" } },
      undefined,
      { timeout: 5_000 }
    );
    return { bridgeServer, mcpClient, list, call };
  } catch (error) {
    await mcpClient?.close().catch(() => undefined);
    await bridgeServer?.close().catch(() => undefined);
    throw error;
  }
}

async function expectStartupFailure(label, overrides, expectedCode) {
  const before = fixture.requests.length;
  try {
    const server = await createRecallantRemoteBridgeServer(bridgeConfig(overrides));
    await server.close().catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedCode), `${label} did not surface ${expectedCode}`);
    assert(fixture.requests.length === before + 1, `${label} should fail during remote initialize`);
    return label;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function expectConfigBlocked(label, argv, env) {
  try {
    await runRecallantRemoteBridge(argv, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes("POLICY_BLOCKED"), `${label} did not produce POLICY_BLOCKED`);
    assert(!forbiddenPattern.test(message), `${label} leaked forbidden field names`);
    return label;
  }
  throw new Error(`${label} unexpectedly started`);
}

async function assertNoCredentialLeakOutsideAllowedBoundary(outputText) {
  const generatedConfig = renderRemoteClientTargetConfig(
    null,
    remoteClientTargetConfig("generic", {
      ...bridgeConfig(),
      credential: null,
      credentialRef: credentialStore.key,
      credentialStorePath: credentialStore.display_path
    })
  );
  assert(
    generatedConfig.includes("RECALLANT_REMOTE_MCP_CREDENTIAL_REF"),
    "generated config did not use credential ref"
  );
  assert(!generatedConfig.includes(validCredential), "generated config embedded raw credential");
  const docs = await Promise.all(
    ["docs/MCP_SPEC.md", "docs/CLIENT_SETUP.md", "docs/CONTRACT_STATUS.md"].map((path) =>
      readFile(path, "utf8")
    )
  );
  const sanitizedRequests = fixture.requests.map((request) => ({
    ...request,
    headers: {
      ...request.headers,
      authorization: request.headers.authorization ? "[AUTHORIZATION_HEADER_PRESENT]" : undefined
    }
  }));
  const surfaces = {
    output: outputText,
    generated_config_preview: generatedConfig,
    docs: docs.join("\n"),
    fake_audit_capture_without_authorization: JSON.stringify(sanitizedRequests)
  };
  for (const [surface, text] of Object.entries(surfaces)) {
    for (const secret of [
      validCredential,
      rotatedNewCredential,
      revokedCredential,
      rotatedOldCredential,
      wrongCredential
    ]) {
      assert(!text.includes(secret), `${surface} leaked raw credential fixture`);
    }
  }
}

let bridgeServer;
let mcpClient;
try {
  ({ bridgeServer, mcpClient } = await runBridgeRoundtrip());

  const list = await mcpClient.listTools({}, { timeout: 5_000 });
  const call = await mcpClient.callTool(
    { name: "memory_heartbeat", arguments: { message: "hello-bridge" } },
    undefined,
    { timeout: 5_000 }
  );

  const methods = fixture.requests.map((request) => request.body.method);
  assert(methods.includes("initialize"), "bridge did not initialize the central MCP endpoint");
  assert(methods.includes("tools/list"), "bridge did not list tools from the central MCP endpoint");
  assert(methods.includes("tools/call"), "bridge did not call a central MCP tool");
  assert(
    list.tools.some((tool) => tool.name === "memory_heartbeat"),
    "tools/list did not expose memory_heartbeat through bridge"
  );
  assert(
    call.structuredContent?.echoed === "hello-bridge",
    "tools/call did not return deterministic structured content"
  );

  const callsBeforeForbiddenPayload = fixture.requests.filter(
    (request) => request.body.method === "tools/call"
  ).length;
  const blockedPayload = await mcpClient.callTool(
    {
      name: "memory_heartbeat",
      arguments: {
        message: "blocked",
        nested: { RECALLANT_DATABASE_URL: "postgres://should-not-forward" },
        raw_artifacts_path: "/tmp/raw"
      }
    },
    undefined,
    { timeout: 5_000 }
  );
  const blockedText = JSON.stringify(blockedPayload);
  assert(blockedPayload.isError === true, "forbidden tool payload was not rejected locally");
  assert(!forbiddenPattern.test(blockedText), "forbidden tool payload error leaked blocked fields");
  assert(
    fixture.requests.filter((request) => request.body.method === "tools/call").length ===
      callsBeforeForbiddenPayload,
    "forbidden tool payload was forwarded to central MCP"
  );

  await mcpClient.close();
  mcpClient = undefined;
  await bridgeServer.close();
  bridgeServer = undefined;

  const failureCases = [
    await expectStartupFailure(
      "wrong_credential",
      { credential: wrongCredential },
      "INVALID_SCOPE_TOKEN"
    ),
    await expectStartupFailure(
      "revoked_credential",
      { credential: revokedCredential },
      "INVALID_SCOPE_TOKEN"
    ),
    await expectStartupFailure(
      "rotated_old_credential",
      { credential: rotatedOldCredential },
      "INVALID_SCOPE_TOKEN"
    ),
    await expectStartupFailure(
      "wrong_project",
      { projectId: "wrong-project" },
      "PROJECT_SCOPE_MISMATCH"
    ),
    await expectStartupFailure(
      "wrong_developer",
      { developerId: "wrong-developer" },
      "PROJECT_SCOPE_MISMATCH"
    ),
    await expectStartupFailure(
      "wrong_client",
      { clientId: "wrong-client" },
      "PROJECT_SCOPE_MISMATCH"
    )
  ];

  const rotatedNewRoundtrip = await runBridgeRoundtrip({ credential: rotatedNewCredential });
  await rotatedNewRoundtrip.mcpClient.close();
  await rotatedNewRoundtrip.bridgeServer.close();

  const storedConfig = validateRemoteMcpBridgeConfig({
    serverUrl: fixture.serverUrl,
    credentialRef: credentialStore.key,
    credentialStorePath: credentialStore.display_path,
    projectId: expectedScope.projectId,
    developerId: expectedScope.developerId,
    clientId: expectedScope.clientId,
    sessionId: expectedScope.sessionId,
    traceId: expectedScope.traceId
  });
  assert(storedConfig.credential === validCredential, "credential store lookup failed");
  const storedCredentialRoundtrip = await runBridgeRoundtrip(storedConfig);
  await storedCredentialRoundtrip.mcpClient.close();
  await storedCredentialRoundtrip.bridgeServer.close();

  const blockedConfigCases = [
    await expectConfigBlocked("blocked_database_url_env", ["node", "recallant", "remote-bridge"], {
      RECALLANT_DATABASE_URL: "postgres://blocked"
    }),
    await expectConfigBlocked(
      "blocked_database_url_arg",
      [
        "node",
        "recallant",
        "remote-bridge",
        "--server-url",
        fixture.serverUrl,
        "--credential",
        validCredential,
        "--project-id",
        expectedScope.projectId,
        "--developer-id",
        expectedScope.developerId,
        "--client-id",
        expectedScope.clientId,
        "--database-url",
        "postgres://blocked"
      ],
      {}
    ),
    await expectConfigBlocked(
      "blocked_provider_key_arg",
      [
        "node",
        "recallant",
        "remote-bridge",
        "--server-url",
        fixture.serverUrl,
        "--credential",
        validCredential,
        "--project-id",
        expectedScope.projectId,
        "--developer-id",
        expectedScope.developerId,
        "--client-id",
        expectedScope.clientId,
        "--provider-key",
        "blocked"
      ],
      {}
    )
  ];

  for (const request of fixture.requests) {
    assert(request.url === "/api/mcp", `unexpected central path ${request.url}`);
    assert(
      request.headers.authorization === `Bearer ${validCredential}` ||
        request.headers.authorization === `Bearer ${rotatedNewCredential}` ||
        request.headers.authorization === `Bearer ${revokedCredential}` ||
        request.headers.authorization === `Bearer ${rotatedOldCredential}` ||
        request.headers.authorization === `Bearer ${wrongCredential}`,
      "missing bridge Authorization header"
    );
    assert(
      request.headers["x-recallant-session-id"] === expectedScope.sessionId,
      "missing bridge session header"
    );
    assert(
      request.headers["x-recallant-trace-id"] === expectedScope.traceId,
      "missing bridge trace header"
    );
  }

  const output = {
    remote_mcp_bridge_smoke: {
      status: "pass",
      no_database_url_env: !process.env.RECALLANT_DATABASE_URL,
      methods,
      listed_tools: list.tools.map((tool) => tool.name).sort(),
      called_tool: "memory_heartbeat",
      structured_content: call.structuredContent,
      failure_cases: failureCases,
      rotated_new_credential_succeeds: true,
      credential_store_lookup_succeeds: true,
      generated_config_uses_credential_ref: true,
      blocked_config_cases: blockedConfigCases,
      forbidden_tool_payload_forwarded: false,
      required_headers_seen: true,
      forbidden_surface_leak: false,
      raw_credential_boundary:
        "raw credential appears only as local operator-provided Authorization/env material, never in smoke output, docs, generated placeholder config, or sanitized captures"
    }
  };
  const outputText = JSON.stringify(output, null, 2);
  assert(
    !forbiddenPattern.test(outputText),
    "smoke output leaked a forbidden remote bridge surface"
  );
  await assertNoCredentialLeakOutsideAllowedBoundary(outputText);
  process.stdout.write(`${outputText}\n`);
} finally {
  await mcpClient?.close().catch(() => undefined);
  await bridgeServer?.close().catch(() => undefined);
  await new Promise((resolve) => fixture.server.close(resolve));
  if (originalDatabaseUrl !== undefined) process.env.RECALLANT_DATABASE_URL = originalDatabaseUrl;
}
