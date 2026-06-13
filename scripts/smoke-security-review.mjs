import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { redactSecretValues } from "../apps/cli/dist/discovery.js";
import { createRecallantHttpServer, getRecallantHttpConfig } from "../apps/server/dist/index.js";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} is missing required marker: ${marker}`);
  }
}

function assertThrowsValidation(fn, expectedText) {
  try {
    fn();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    assert(message.includes("VALIDATION_ERROR"), `Expected validation error, got: ${message}`);
    assert(message.includes(expectedText), `Validation error missing marker: ${expectedText}`);
    return;
  }
  throw new Error(`Expected validation error: ${expectedText}`);
}

function assertSecurityHeaders(response, label) {
  assert(response.headers.get("cache-control") === "no-store", `${label} must be no-store`);
  assert(
    response.headers.get("x-content-type-options") === "nosniff",
    `${label} must set nosniff`
  );
  assert(response.headers.get("x-frame-options") === "DENY", `${label} must deny framing`);
  assert(
    response.headers.get("referrer-policy") === "no-referrer",
    `${label} must disable referrers`
  );
  assert(
    response.headers.get("permissions-policy")?.includes("geolocation=()"),
    `${label} must restrict browser permissions`
  );
  assert(
    response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"),
    `${label} must set a private Workbench CSP`
  );
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const envKeys = [
  "RECALLANT_AUTH_TOKEN",
  "RECALLANT_SESSION_SECRET",
  "RECALLANT_HOST",
  "RECALLANT_PORT",
  "RECALLANT_ALLOW_PUBLIC_BIND",
  "RECALLANT_CLOUDFLARE_MODE",
  "RECALLANT_CLOUDFLARE_EDGE_AUTH",
  "RECALLANT_ADMIN_EMAILS",
  "RECALLANT_ADMIN_EMAIL",
  "RECALLANT_DATABASE_URL"
];
const envSnapshot = snapshotEnv(envKeys);

try {
  process.env.RECALLANT_AUTH_TOKEN = `security-review-${randomUUID()}`;
  process.env.RECALLANT_SESSION_SECRET = `security-review-session-${randomUUID()}`;
  delete process.env.RECALLANT_HOST;
  delete process.env.RECALLANT_PORT;
  delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;
  delete process.env.RECALLANT_ADMIN_EMAIL;
  delete process.env.RECALLANT_DATABASE_URL;

  const defaultConfig = getRecallantHttpConfig();
  assert(defaultConfig.host === "127.0.0.1", "HTTP server must default to localhost");
  assert(defaultConfig.private_by_default === true, "HTTP server must be private by default");
  assert(defaultConfig.recallant_auth_required === true, "Recallant auth must be required");
  assert(defaultConfig.cloudflare.mode === "disabled", "Cloudflare mode must be explicit");

  process.env.RECALLANT_HOST = "0.0.0.0";
  assertThrowsValidation(
    () => getRecallantHttpConfig(),
    "public HTTP bind requires explicit RECALLANT_ALLOW_PUBLIC_BIND=true"
  );
  process.env.RECALLANT_ALLOW_PUBLIC_BIND = "true";
  assert(
    getRecallantHttpConfig().public_bind_allowed === true,
    "Public bind should require explicit opt-in"
  );

  process.env.RECALLANT_HOST = "127.0.0.1";
  delete process.env.RECALLANT_ALLOW_PUBLIC_BIND;
  process.env.RECALLANT_CLOUDFLARE_MODE = "enabled";
  assertThrowsValidation(
    () => getRecallantHttpConfig(),
    "Cloudflare mode requires RECALLANT_CLOUDFLARE_EDGE_AUTH=required"
  );
  process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH = "required";
  assertThrowsValidation(
    () => getRecallantHttpConfig(),
    "Cloudflare mode requires RECALLANT_ADMIN_EMAILS"
  );
  process.env.RECALLANT_ADMIN_EMAILS = "admin@example.invalid";
  const cloudflareConfig = getRecallantHttpConfig();
  assert(
    cloudflareConfig.cloudflare.edge_auth_required === true &&
      cloudflareConfig.cloudflare.admin_email_count === 1,
    "Cloudflare mode must require edge auth and admin email allowlist"
  );

  delete process.env.RECALLANT_CLOUDFLARE_MODE;
  delete process.env.RECALLANT_CLOUDFLARE_EDGE_AUTH;
  delete process.env.RECALLANT_ADMIN_EMAILS;

  const server = createRecallantHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to bind test server");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert(health.status === 200, `Health check failed: ${health.status}`);
    assertSecurityHeaders(health, "health response");

    const unauthorized = await fetch(`${baseUrl}/review`);
    assert(unauthorized.status === 401, `Workbench must require auth: ${unauthorized.status}`);
    assertSecurityHeaders(unauthorized, "unauthorized Workbench response");

    const wrongBearer = await fetch(`${baseUrl}/api/review-dashboard`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    assert(wrongBearer.status === 401, `API must reject wrong bearer: ${wrongBearer.status}`);
    assertSecurityHeaders(wrongBearer, "unauthorized API response");

    const authorizedNoDb = await fetch(`${baseUrl}/review`, {
      headers: { authorization: `Bearer ${process.env.RECALLANT_AUTH_TOKEN}` }
    });
    assert(
      authorizedNoDb.status === 503,
      `Authenticated Workbench without DB should stop at DB gate: ${authorizedNoDb.status}`
    );
    assertSecurityHeaders(authorizedNoDb, "authorized Workbench response");
    const body = await authorizedNoDb.text();
    assert(!body.includes(process.env.RECALLANT_AUTH_TOKEN), "Workbench response leaked auth token");
    assert(
      !body.includes(process.env.RECALLANT_SESSION_SECRET),
      "Workbench response leaked session secret"
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
} finally {
  restoreEnv(envSnapshot);
}

const rawApiKey = `sk-security-review-${randomUUID().replaceAll("-", "")}`;
const rawPassword = `security-review-password-${randomUUID()}`;
const redacted = redactSecretValues(
  [
    `OPENAI_API_KEY=${rawApiKey}`,
    `DATABASE_URL=postgres://app:${rawPassword}@localhost/app`,
    `postgres://app:${rawPassword}@localhost/app`
  ].join("\n")
);
assert(!redacted.includes(rawApiKey), "Secret redaction left raw API key value");
assert(!redacted.includes(rawPassword), "Secret redaction left raw database password");
mustInclude(
  redacted,
  ["OPENAI_API_KEY=<redacted>", "DATABASE_URL=<redacted>", "postgres://<redacted>:<redacted>@"],
  "redacted secret fixture"
);

const serverSource = await read("apps/server/src/index.ts");
mustInclude(
  serverSource,
  [
    "RECALLANT_ALLOW_PUBLIC_BIND",
    "RECALLANT_CLOUDFLARE_EDGE_AUTH=required",
    "function safeSettingValue",
    "function sanitizeDashboardForClient",
    '"x-content-type-options": "nosniff"',
    '"x-frame-options": "DENY"',
    '"content-security-policy"'
  ],
  "server security contract"
);

const reviewSmoke = await read("scripts/smoke-review-ui.mjs");
mustInclude(
  reviewSmoke,
  [
    "Review UI did not require auth",
    "Unauthenticated route was exposed",
    "Review UI HTML leaked raw secret setting values",
    "Cloudflare mode allowed browser without edge auth",
    "Cloudflare edge-auth browser session failed"
  ],
  "Workbench runtime smoke"
);

const attachSource = await read("apps/cli/src/attach.ts");
mustInclude(
  attachSource,
  [
    "function createLocalBackup",
    "redactSecretValues(content)",
    "Raw secret values are intentionally not recoverable from this backup.",
    "Live/production-sensitive attach never edits source files for secret cleanup during preflight.",
    "Sandbox/test attach may mask changed bootstrap files only after a redacted local backup exists."
  ],
  "attach backup and secret contract"
);

const installSource = await read("scripts/install-recallant.sh");
mustInclude(
  installSource,
  [
    'RECALLANT_HOST=127.0.0.1',
    'RECALLANT_AUTH_TOKEN=$auth_token',
    'RECALLANT_SESSION_SECRET=$session_secret',
    'chmod 600 "$ENV_FILE"',
    'chmod 600 "$install_marker"'
  ],
  "installer secret contract"
);

const rollbackSource = await read("scripts/rollback-recallant-install.sh");
mustInclude(
  rollbackSource,
  [
    "Confirmed rollback requires --confirm-token rollback-recallant-install",
    "Refusing to remove unmarked data dir",
    "dangerous_path",
    'rm -rf "$DATA_DIR"'
  ],
  "rollback safety contract"
);

process.stdout.write("Security review smoke passed\n");
