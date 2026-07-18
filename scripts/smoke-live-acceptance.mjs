import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const runner = "scripts/live-acceptance.mjs";
const secretFixtures = {
  RECALLANT_DATABASE_URL: "postgres://user:super-secret-password@db.example.invalid:5432/prod",
  RECALLANT_AUTH_TOKEN: "live-acceptance-token-secret",
  RECALLANT_SESSION_COOKIE: "sessionid=live-acceptance-cookie-secret",
  RECALLANT_ADMIN_EMAILS: "owner@example.invalid",
  RECALLANT_PUBLIC_WORKBENCH_URL: "https://recallant.example.invalid/review",
  RECALLANT_WORKBENCH_ORIGIN_URL: "http://127.0.0.1:3005/review",
  RECALLANT_SERVICE_ENV_FILE: "/tmp/recallant-live-acceptance.env",
  RECALLANT_CLOUDFLARE_MODE: "enabled",
  RECALLANT_CLOUDFLARE_EDGE_AUTH: "required",
  RECALLANT_LIVE_CLEANUP_MODE: "purge-dry-run",
  RECALLANT_LIVE_PROJECT_DIR: "/tmp/recallant-live-acceptance-project"
};
const forbiddenOutputValues = [
  secretFixtures.RECALLANT_DATABASE_URL,
  "super-secret-password",
  secretFixtures.RECALLANT_AUTH_TOKEN,
  "live-acceptance-token-secret",
  secretFixtures.RECALLANT_SESSION_COOKIE,
  "live-acceptance-cookie-secret",
  secretFixtures.RECALLANT_ADMIN_EMAILS,
  "owner@example.invalid"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    env: { ...process.env, ...secretFixtures, ...extraEnv },
    encoding: "utf8"
  });
}

function parseOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Expected JSON for ${label}: ${String(error)}\n${result.stdout}`);
  }
}

function assertNoLeaks(raw, label) {
  for (const value of forbiddenOutputValues) {
    assert(!raw.includes(value), `${label} leaked fixture secret/value: ${value}`);
  }
  assert(!/postgres(?:ql)?:\/\/[^ <>"')]+:[^ <>"')]+@/i.test(raw), `${label} leaked DSN`);
  assert(!raw.includes("owner@example.invalid"), `${label} leaked admin email`);
  assert(!raw.includes("live-acceptance-token-secret"), `${label} leaked token`);
  assert(!raw.includes("live-acceptance-cookie-secret"), `${label} leaked cookie`);
}

function reportForFixture(mode) {
  const result = run({
    RECALLANT_LIVE_ACCEPTANCE: "1",
    RECALLANT_LIVE_ACCEPTANCE_FIXTURE: mode
  });
  const payload = parseOutput(result, mode);
  assert(payload.acceptance_report, `${mode} did not produce acceptance_report`);
  assertNoLeaks(result.stdout, mode);
  return { result, report: payload.acceptance_report };
}

const refused = run({ RECALLANT_LIVE_ACCEPTANCE: "" });
const refusedJson = parseOutput(refused, "refusal");
assert(refused.status === 2, `refusal exit should be 2, got ${refused.status}`);
assert(refusedJson.status === "refused", "refusal did not report refused status");
assert(
  refusedJson.accepted_env.includes("RECALLANT_PUBLIC_WORKBENCH_URL") &&
    refusedJson.accepted_env.includes("RECALLANT_WORKBENCH_ORIGIN_URL") &&
    refusedJson.accepted_env.includes("RECALLANT_LIVE_PROJECT_DIR") &&
    refusedJson.accepted_env.includes("RECALLANT_SERVICE_ENV_FILE") &&
    refusedJson.accepted_env.includes("RECALLANT_CLOUDFLARE_MODE") &&
    refusedJson.accepted_env.includes("RECALLANT_LIVE_CLEANUP_MODE"),
  "refusal did not advertise generic accepted env"
);
assertNoLeaks(refused.stdout, "refusal");

const pass = reportForFixture("pass");
assert(pass.result.status === 0, `pass fixture exit should be 0, got ${pass.result.status}`);
assert(pass.report.status === "pass", "pass fixture did not pass");
assert(pass.report.accepted_inputs.public_url === true, "pass fixture did not accept public URL");
assert(pass.report.accepted_inputs.origin_url === true, "pass fixture did not accept origin URL");
assert(pass.report.accepted_inputs.project_dir === true, "pass fixture did not accept project dir");
assert(
  pass.report.accepted_inputs.service_env_file === true,
  "pass fixture did not accept service env file"
);
assert(
  pass.report.accepted_inputs.cloudflare_mode === "configured",
  "pass fixture did not accept Cloudflare mode"
);
assert(
  pass.report.accepted_inputs.cleanup_mode === "purge-dry-run",
  "pass fixture did not accept cleanup mode"
);
assert(pass.report.redaction.raw_env === "not_printed", "pass fixture printed raw env");

const warning = reportForFixture("warning");
assert(
  warning.result.status === 0,
  `warning fixture exit should be 0, got ${warning.result.status}`
);
assert(warning.report.status === "pass_with_warnings", "warning fixture did not warn");

const fail = reportForFixture("fail");
assert(fail.result.status === 1, `fail fixture exit should be 1, got ${fail.result.status}`);
assert(fail.report.status === "fail", "fail fixture did not fail");
for (const expectedFailure of [
  "public_route_auth_ready",
  "private_origin_auth_ready",
  "service_env_aligned",
  "memory_loop_recall_proof",
  "workbench_project_visible",
  "pending_embeddings_recovered"
]) {
  assert(
    fail.report.blocking_failures.some((item) => item.name === expectedFailure),
    `fail fixture missing blocking failure: ${expectedFailure}`
  );
}
const failEvidence = Object.fromEntries(
  fail.report.blocking_failures.map((item) => [item.name, item.evidence])
);
assert(failEvidence.public_route_auth_ready === "public_502", "fail fixture missed public 502");
assert(
  failEvidence.private_origin_auth_ready === "anonymous_origin",
  "fail fixture missed anonymous origin"
);
assert(failEvidence.service_env_aligned === "mismatch", "fail fixture missed env mismatch");
assert(
  failEvidence.memory_loop_recall_proof === "missing_memory_loop",
  "fail fixture missed memory-loop gap"
);
assert(
  failEvidence.pending_embeddings_recovered === "unrecovered_pending_embeddings",
  "fail fixture missed pending embeddings gap"
);

process.stdout.write(
  `${JSON.stringify(
    {
      live_acceptance: {
        refusal: {
          exit: refused.status,
          status: refusedJson.status,
          accepted_env: refusedJson.accepted_env
        },
        pass: {
          exit: pass.result.status,
          status: pass.report.status,
          checks: pass.report.checks.map((item) => item.name)
        },
        warning: {
          exit: warning.result.status,
          status: warning.report.status,
          warnings: warning.report.warnings
        },
        fail: {
          exit: fail.result.status,
          status: fail.report.status,
          blocking_failures: fail.report.blocking_failures.map((item) => item.name)
        },
        redaction: {
          raw_env: "not_printed",
          secret_fixtures: "not_present_in_output"
        }
      }
    },
    null,
    2
  )}\n`
);
