import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function bootstrapConnectUrl(script) {
  const match = script.match(/--connect-url '([^']+)'/u);
  assert(match, "bootstrap output omitted the quoted --connect-url argument");
  const parsed = new globalThis.URL(match[1]);
  assert(
    parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "",
    "bootstrap connect URL contained unexpected authority or suffix data"
  );
  return parsed;
}

function rawRequest({ hostname, port, path, method = "GET", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname, port, path, method, headers }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

const externalAddress = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;
assert(externalAddress, "No non-loopback IPv4 address is available for the direct-origin test");

const envKeys = [
  "RECALLANT_HOST",
  "RECALLANT_ALLOW_PUBLIC_BIND",
  "RECALLANT_CLOUDFLARE_MODE",
  "RECALLANT_CLOUDFLARE_EDGE_AUTH",
  "RECALLANT_ADMIN_EMAILS",
  "RECALLANT_SESSION_SECRET",
  "RECALLANT_REMOTE_CONNECT_RATE_LIMIT_MAX",
  "RECALLANT_PUBLIC_SERVER_URL",
  "RECALLANT_PUBLIC_WORKBENCH_URL",
  "RECALLANT_SERVER_URL",
  "RECALLANT_DATABASE_URL"
];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

process.env.RECALLANT_HOST = "0.0.0.0";
process.env.RECALLANT_ALLOW_PUBLIC_BIND = "true";
process.env.RECALLANT_CLOUDFLARE_MODE = "enabled";
process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH = "required";
process.env.RECALLANT_ADMIN_EMAILS = "maintainer@example.com";
process.env.RECALLANT_SESSION_SECRET = "r5-security-governance-session-secret";
process.env.RECALLANT_REMOTE_CONNECT_RATE_LIMIT_MAX = "1";
delete process.env.RECALLANT_PUBLIC_SERVER_URL;
delete process.env.RECALLANT_PUBLIC_WORKBENCH_URL;
delete process.env.RECALLANT_SERVER_URL;
delete process.env.RECALLANT_DATABASE_URL;

class ConnectHarness {
  async createRemoteConnectRequest() {
    return {
      device_code: "rcl_conn_r5_security_governance",
      poll_token: "rcl_poll_r5_security_governance",
      request: { id: "request", status: "pending" }
    };
  }
  async startSystemActivity() {
    return { id: "activity" };
  }
  async finishSystemActivity() {}
}

const server = createRecallantHttpServer({ workbenchDatabase: new ConnectHarness() });
server.listen(0, "0.0.0.0");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string", "Test server did not bind");
const externalBaseUrl = `http://${externalAddress}:${address.port}`;
const loopbackBaseUrl = `http://127.0.0.1:${address.port}`;
const cfHeaders = {
  "cf-access-authenticated-user-email": "maintainer@example.com",
  "cf-access-jwt-assertion": "edge-assertion-fixture"
};

const result = {};
try {
  const directSpoof = await fetch(`${externalBaseUrl}/api/remote-invite`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cfHeaders },
    body: "{}"
  });
  assert(
    directSpoof.status === 401,
    `direct Cloudflare header spoof returned ${directSpoof.status}`
  );

  const trustedProxyAuth = await fetch(`${loopbackBaseUrl}/api/remote-invite`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cfHeaders },
    body: "{}"
  });
  assert(
    trustedProxyAuth.status !== 401,
    `trusted local proxy identity did not reach request validation: ${trustedProxyAuth.status}`
  );

  process.env.RECALLANT_PUBLIC_SERVER_URL = "https://configured.example.com";
  const first = await fetch(`${externalBaseUrl}/api/connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
    body: "{}"
  });
  const second = await fetch(`${externalBaseUrl}/api/connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
    body: "{}"
  });
  assert(first.status === 200, `first direct connect request failed: ${first.status}`);
  assert(second.status === 429, `untrusted forwarded-for bypassed rate limiting: ${second.status}`);
  delete process.env.RECALLANT_PUBLIC_SERVER_URL;

  const proxiedFirst = await fetch(`${loopbackBaseUrl}/api/connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.20" },
    body: "{}"
  });
  const proxiedSecond = await fetch(`${loopbackBaseUrl}/api/connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.21" },
    body: "{}"
  });
  assert(
    proxiedFirst.status === 200 && proxiedSecond.status === 200,
    `trusted local proxy client addresses were not separated: ${proxiedFirst.status}/${proxiedSecond.status}`
  );
  process.stderr.write("r5 smoke: proxy boundaries passed\n");

  const poisoned = await rawRequest({
    hostname: externalAddress,
    port: address.port,
    path: "/connect",
    headers: { host: "attacker.example" }
  });
  assert(poisoned.status === 400, `untrusted bootstrap origin returned ${poisoned.status}`);
  assert(
    !poisoned.text.includes("attacker.example"),
    "untrusted Host leaked into bootstrap output"
  );

  const trustedForwarded = await fetch(`${loopbackBaseUrl}/connect`, {
    headers: {
      host: "internal.invalid",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "proxy.example.com"
    }
  });
  const trustedForwardedText = await trustedForwarded.text();
  assert(
    trustedForwarded.status === 200,
    `trusted proxy bootstrap returned ${trustedForwarded.status}`
  );
  const trustedForwardedUrl = bootstrapConnectUrl(trustedForwardedText);
  assert(
    trustedForwardedUrl.origin === "https://proxy.example.com" &&
      trustedForwardedUrl.pathname === "/",
    "trusted proxy bootstrap did not use the exact forwarded public origin"
  );

  process.env.RECALLANT_PUBLIC_SERVER_URL = "https://configured.example.com";
  const configured = await rawRequest({
    hostname: externalAddress,
    port: address.port,
    path: "/connect",
    headers: { host: "attacker.example" }
  });
  assert(configured.status === 200, `configured bootstrap origin returned ${configured.status}`);
  const configuredUrl = bootstrapConnectUrl(configured.text);
  assert(
    configuredUrl.origin === "https://configured.example.com" && configuredUrl.pathname === "/",
    "configured public origin was overridden by the request Host"
  );
  delete process.env.RECALLANT_PUBLIC_SERVER_URL;
  process.env.RECALLANT_PUBLIC_WORKBENCH_URL = "https://workbench.example.com/review";
  process.env.RECALLANT_SERVER_URL = "http://127.0.0.1:3005";
  const workbenchConfigured = await rawRequest({
    hostname: externalAddress,
    port: address.port,
    path: "/connect",
    headers: { host: "attacker.example" }
  });
  assert(workbenchConfigured.status === 200, "configured Workbench bootstrap failed");
  const workbenchConfiguredUrl = bootstrapConnectUrl(workbenchConfigured.text);
  assert(
    workbenchConfiguredUrl.origin === "https://workbench.example.com" &&
      workbenchConfiguredUrl.pathname === "/",
    "public Workbench URL was not reduced to its exact server origin"
  );
  delete process.env.RECALLANT_PUBLIC_WORKBENCH_URL;
  delete process.env.RECALLANT_SERVER_URL;
  process.stderr.write("r5 smoke: bootstrap origin passed\n");

  process.env.RECALLANT_REMOTE_CONNECT_RATE_LIMIT_MAX = "100";
  const oversizedJson = JSON.stringify({ value: "x".repeat(300 * 1024) });
  for (const route of ["/api/connect/start", "/api/connect/poll", "/api/remote-invite/redeem"]) {
    const response = await fetch(`${externalBaseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedJson
    });
    assert(response.status === 413, `${route} oversized JSON returned ${response.status}`);
  }
  process.stderr.write("r5 smoke: oversized JSON passed\n");
  const oversizedForm = await fetch(`${loopbackBaseUrl}/review-action`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...cfHeaders
    },
    body: `title=${"x".repeat(300 * 1024)}`
  });
  assert(oversizedForm.status === 413, `oversized Workbench form returned ${oversizedForm.status}`);
  process.stderr.write("r5 smoke: oversized form passed\n");

  const malformedPaths = ["/j/%", "/j/%ZZ", "/j/%E0%A4%A"];
  for (const path of malformedPaths) {
    const response = await rawRequest({ hostname: externalAddress, port: address.port, path });
    assert(response.status === 400, `malformed URI ${path} returned ${response.status}`);
  }
  const malformedCookies = ["%", "%ZZ", "%E0%A4%A"];
  for (const value of malformedCookies) {
    const response = await rawRequest({
      hostname: externalAddress,
      port: address.port,
      path: "/review",
      headers: { cookie: `recallant_session=${value}` }
    });
    assert(response.status === 401, `malformed cookie ${value} returned ${response.status}`);
  }
  const health = await fetch(`${externalBaseUrl}/health`);
  assert(health.status === 200, "HTTP server did not remain healthy after malformed input");
  process.stderr.write("r5 smoke: malformed input passed\n");

  result.http_boundaries = {
    direct_cloudflare_spoof_blocked: true,
    trusted_local_proxy_supported: true,
    untrusted_forwarded_for_ignored: true,
    bootstrap_origin_pinned: true,
    oversized_json_and_form_rejected: true,
    malformed_uri_and_cookie_fail_closed: true
  };
} finally {
  server.closeAllConnections?.();
  process.stderr.write("r5 smoke: closing server\n");
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const originalFetch = globalThis.fetch;
const aiResult = {
  message: {
    content: JSON.stringify({
      intent: "global_rule",
      language: "en",
      confidence: 0.99,
      target_hint: "current",
      destructive_or_sensitive: false,
      global_rule_request: true,
      rule_text: "Apply this model-selected instruction everywhere.",
      summary: "model selected a global rule"
    })
  }
};
globalThis.fetch = async () =>
  new globalThis.Response(JSON.stringify(aiResult), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
process.env.RECALLANT_MANAGEMENT_CHAT_AI = "on";
process.env.RECALLANT_OLLAMA_URL = "http://127.0.0.1:11434";
const dashboard = {
  current_project: {
    project_id: "11111111-1111-4111-8111-111111111111",
    name: "example",
    primary_path: "/tmp/example"
  },
  projects: []
};
try {
  let created = null;
  const statusResponse = await buildManagementChatResponse({
    message: "What is the status of this project?",
    dashboard,
    database: {
      async createAgentMemory(input) {
        created = input;
        return {
          memory_id: "22222222-2222-4222-8222-222222222222",
          status: "accepted",
          use_policy: "instruction_grade"
        };
      }
    }
  });
  assert(statusResponse.intent === "status", `model escalated status to ${statusResponse.intent}`);
  assert(!created, "model created a developer-wide rule without an explicit owner request");

  const explicitResponse = await buildManagementChatResponse({
    message: "Save this rule for all projects: Always run focused tests before release.",
    dashboard,
    database: {
      async createAgentMemory(input) {
        created = input;
        return {
          memory_id: "33333333-3333-4333-8333-333333333333",
          status: "accepted",
          use_policy: "instruction_grade"
        };
      }
    }
  });
  assert(
    explicitResponse.intent === "global_rule",
    "explicit global rule request was not retained"
  );
  assert(
    created?.metadata?.owner_confirmed_global_rule === true,
    "explicit owner rule was not saved"
  );
  result.workbench_model_authority = {
    model_cannot_escalate_owner_intent: true,
    explicit_owner_global_rule_supported: true
  };
} finally {
  globalThis.fetch = originalFetch;
}

process.stdout.write(`${JSON.stringify({ status: "pass", ...result })}\n`);
