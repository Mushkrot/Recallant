import { URL } from "node:url";

const env = process.env;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<invalid-url>";
  }
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "manual" });
  return { response, text: await response.text() };
}

function assertNotCloudflareAccess(response, text, label) {
  const location = response.headers.get("location") ?? "";
  const authenticate = response.headers.get("www-authenticate") ?? "";
  const accessRedirect =
    response.status >= 300 &&
    response.status < 400 &&
    /cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(location);
  const accessBody = /cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(text);
  const accessChallenge = /Cloudflare-Access/i.test(authenticate);
  assert(
    !(accessRedirect || accessBody || accessChallenge),
    `${label} is still protected by Cloudflare Access; public agent routes must bypass Access while /connect/approve stays protected`
  );
}

const keys = ["RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL", "RECALLANT_LIVE_REMOTE_CONNECT_TARGET"];
const present = keys.filter((key) => env[key]?.trim());

if (present.length === 0) {
  process.stdout.write(
    JSON.stringify(
      {
        remote_connect_live_readiness_smoke: {
          status: "skipped_live_remote_connect_readiness",
          reason: "RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL not set",
          required_for_live_pass: ["RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL"],
          redacted: true
        }
      },
      null,
      2
    )
  );
  process.exit(0);
}

const serverUrl = env.RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL?.trim() ?? "";
if (!serverUrl) {
  throw new Error(
    "partial live remote connect inputs: missing RECALLANT_LIVE_REMOTE_CONNECT_SERVER_URL"
  );
}

const url = new URL(serverUrl);
assert(url.protocol === "https:", "live remote connect server URL must use https");
url.search = "";
url.hash = "";
url.pathname = url.pathname.replace(/\/+$/, "");
const baseUrl = url.toString().replace(/\/$/, "");

const { response: bootstrap, text: bootstrapText } = await fetchText(`${baseUrl}/connect`);
assertNotCloudflareAccess(bootstrap, bootstrapText, "GET /connect");
assert(bootstrap.status === 200, `GET /connect failed with ${bootstrap.status}`);
assert(bootstrapText.includes("--connect-url"), "live /connect bootstrap missing --connect-url");
assert(
  !/RECALLANT_DATABASE_URL|postgres:\/\/|provider_secret|raw_artifacts?|backup_path/i.test(
    bootstrapText
  ),
  "live /connect bootstrap leaked forbidden surface"
);

const { response: start, text: startText } = await fetchText(`${baseUrl}/api/connect/start`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    target: env.RECALLANT_LIVE_REMOTE_CONNECT_TARGET?.trim() || "codex",
    project_display_name: "live remote connect readiness",
    project_fingerprint: "live-readiness-redacted",
    project_path_hint_redacted: "live-readiness-path-hash"
  })
});
assertNotCloudflareAccess(start, startText, "POST /api/connect/start");
assert(start.status === 200, `POST /api/connect/start failed with ${start.status}`);
const startJson = JSON.parse(startText);
assert(
  String(startJson.approve_url ?? "").includes("/connect/approve?code="),
  "start did not return approval URL"
);
assert(
  String(startJson.device_code ?? "").startsWith("rcl_conn_"),
  "start did not return device code"
);
assert(
  String(startJson.poll_token ?? "").startsWith("rcl_poll_"),
  "start did not return poll token"
);
assert(!startText.includes("device_code_hash"), "start exposed device hash");
assert(!startText.includes("poll_token_hash"), "start exposed poll hash");

process.stdout.write(
  JSON.stringify(
    {
      remote_connect_live_readiness_smoke: {
        status: "pass",
        server_url: redactUrl(baseUrl),
        connect_bootstrap: "reachable",
        start_endpoint: "reachable",
        approval_url: "returned_redacted",
        device_code_prefix: String(startJson.device_code).split("_").slice(0, 3).join("_"),
        poll_token_prefix: String(startJson.poll_token).split("_").slice(0, 3).join("_"),
        redacted: true
      }
    },
    null,
    2
  )
);
