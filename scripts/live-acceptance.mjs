import { spawnSync } from "node:child_process";

const requiredOptIn = "RECALLANT_LIVE_ACCEPTANCE";
const fixtureMode = process.env.RECALLANT_LIVE_ACCEPTANCE_FIXTURE ?? "";
const acceptedEnv = [
  "RECALLANT_LIVE_PROJECT_DIR",
  "RECALLANT_PUBLIC_WORKBENCH_URL",
  "RECALLANT_WORKBENCH_ORIGIN_URL",
  "RECALLANT_SERVICE_ENV_FILE",
  "RECALLANT_CLOUDFLARE_MODE",
  "RECALLANT_CLOUDFLARE_EDGE_AUTH",
  "RECALLANT_LIVE_CLEANUP_MODE"
];
const sensitiveKeyPattern =
  /(?:database_url|dsn|token|secret|password|cookie|session|admin_email|admin_emails|email)/i;

function redactString(value) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^"'\s]+/gi, "postgres://<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(
      /\b(token|secret|password|cookie|session|admin_email|admin_emails|email)=([^&\s"'<>]+)/gi,
      "$1=<redacted>"
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>");
}

function redact(value, key = "") {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sensitiveKeyPattern.test(key) ? "<redacted>" : redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, key));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey)
      ])
    );
  }
  return value;
}

function check(name, pass, evidence = null) {
  return { name, status: pass ? "pass" : "fail", evidence };
}

function acceptanceStatus(checks, warnings) {
  return checks.every((item) => item.status === "pass")
    ? warnings.length > 0
      ? "pass_with_warnings"
      : "pass"
    : "fail";
}

function acceptedInputSummary() {
  return {
    public_url: Boolean(process.env.RECALLANT_PUBLIC_WORKBENCH_URL),
    origin_url: Boolean(process.env.RECALLANT_WORKBENCH_ORIGIN_URL),
    project_dir: Boolean(process.env.RECALLANT_LIVE_PROJECT_DIR),
    service_env_file: Boolean(process.env.RECALLANT_SERVICE_ENV_FILE),
    cloudflare_mode: process.env.RECALLANT_CLOUDFLARE_MODE ? "configured" : "not_configured",
    cleanup_mode: process.env.RECALLANT_LIVE_CLEANUP_MODE ?? "none"
  };
}

function makeReport({ checks, warnings = [], evidence = {} }) {
  const blockingFailures = checks.filter((item) => item.status === "fail");
  return redact({
    action: "live_acceptance",
    status: acceptanceStatus(checks, warnings),
    blocking_failures: blockingFailures,
    checks,
    warnings,
    accepted_env: acceptedEnv,
    accepted_inputs: acceptedInputSummary(),
    evidence,
    redaction: {
      database_urls: "redacted",
      tokens: "redacted",
      session_cookies: "redacted",
      admin_emails: "redacted",
      raw_env: "not_printed"
    }
  });
}

function emit(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(redact(payload), null, 2)}\n`);
  process.exitCode = exitCode;
}

function fixtureReport(mode) {
  if (mode === "pass") {
    return makeReport({
      checks: [
        check("public_route_auth_ready", true, "auth_required"),
        check("private_origin_auth_ready", true, "auth_required"),
        check("service_env_aligned", true, "aligned"),
        check("service_runtime_ready", true, "ready"),
        check("one_command_onboard", true, "completed"),
        check("memory_loop_recall_proof", true, "memory_loop_ready"),
        check("workbench_project_visible", true, true),
        check("pending_embeddings_recovered", true, "no_pending"),
        check("optional_cleanup_preview", true, "skipped")
      ],
      evidence: { fixture: "pass" }
    });
  }
  if (mode === "warning") {
    return makeReport({
      checks: [
        check("public_route_auth_ready", true, "auth_required"),
        check("private_origin_auth_ready", true, "auth_required"),
        check("service_env_aligned", true, "aligned"),
        check("service_runtime_ready", true, "ready"),
        check("one_command_onboard", true, "completed"),
        check("memory_loop_recall_proof", true, "memory_loop_ready"),
        check("workbench_project_visible", true, true),
        check("pending_embeddings_recovered", true, "recovered"),
        check("optional_cleanup_preview", true, "skipped")
      ],
      warnings: [{ code: "cleanup_skipped", message: "Cleanup preview was not requested." }],
      evidence: { fixture: "warning" }
    });
  }
  return makeReport({
    checks: [
      check("public_route_auth_ready", false, "public_502"),
      check("private_origin_auth_ready", false, "anonymous_origin"),
      check("service_env_aligned", false, "mismatch"),
      check("service_runtime_ready", false, "service_inactive"),
      check("one_command_onboard", true, "completed"),
      check("memory_loop_recall_proof", false, "missing_memory_loop"),
      check("workbench_project_visible", false, false),
      check("pending_embeddings_recovered", false, "unrecovered_pending_embeddings"),
      check("optional_cleanup_preview", true, "skipped")
    ],
    evidence: { fixture: "fail" }
  });
}

function parseJsonResult(result, label) {
  if (result.status !== 0) {
    return {
      ok: false,
      label,
      status: result.status,
      signal: result.signal ?? null,
      error: result.error?.message ?? null
    };
  }
  try {
    return { ok: true, label, json: JSON.parse(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      label,
      status: "invalid_json",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function productionReadinessStatus(doctorJson) {
  return doctorJson?.production_readiness ?? {};
}

function privateOriginReady(publicReadiness) {
  return ["auth_required", "redirect"].includes(publicReadiness?.origin?.status);
}

function pendingEmbeddingCount(doctorJson) {
  return Number(doctorJson?.pending_embeddings?.pending_chunks ?? 0);
}

function runRealAcceptance(projectDir) {
  const entrypoint = process.env.RECALLANT_LIVE_CLI_ENTRYPOINT ?? "apps/cli/dist/index.js";
  const runCli = (args) =>
    spawnSync(process.execPath, [entrypoint, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: "utf8",
      timeout: 180000
    });
  const onboard = parseJsonResult(
    runCli(["onboard", projectDir, "--yes", "--format", "json"]),
    "onboard"
  );
  const doctor = parseJsonResult(
    runCli([
      "doctor",
      "--project-dir",
      projectDir,
      "--require-memory-loop",
      "--format",
      "json"
    ]),
    "doctor"
  );
  const cleanupMode = process.env.RECALLANT_LIVE_CLEANUP_MODE ?? "none";
  let cleanupPreview = null;
  if (cleanupMode === "purge-dry-run") {
    cleanupPreview = parseJsonResult(
      runCli([
        "project-sanitize",
        "--project-dir",
        projectDir,
        "--mode",
        "purge",
        "--dry-run",
        "--format",
        "json"
      ]),
      "project-sanitize"
    );
  }
  const onboardJson = onboard.ok ? onboard.json : null;
  const doctorJson = doctor.ok ? doctor.json : null;
  const production = productionReadinessStatus(doctorJson);
  const publicReadiness = production.public_workbench_readiness ?? {};
  const pending = pendingEmbeddingCount(doctorJson);
  const cleanupJson = cleanupPreview?.ok ? cleanupPreview.json : null;
  const checks = [
    check(
      "public_route_auth_ready",
      publicReadiness.ready === true,
      publicReadiness.status ?? "not_checked"
    ),
    check(
      "private_origin_auth_ready",
      privateOriginReady(publicReadiness),
      publicReadiness.origin?.status ?? "not_checked"
    ),
    check(
      "service_env_aligned",
      doctorJson?.service_env_profile?.ok === true,
      doctorJson?.service_env_profile?.status ?? "not_checked"
    ),
    check(
      "service_runtime_ready",
      production.service_runtime?.ok === true,
      production.service_runtime?.status ?? "not_checked"
    ),
    check("one_command_onboard", onboardJson?.status === "completed", onboardJson?.status ?? onboard.status),
    check(
      "memory_loop_recall_proof",
      doctorJson?.capture_readiness?.ready === true,
      doctorJson?.capture_readiness?.status ?? "not_checked"
    ),
    check(
      "workbench_project_visible",
      onboardJson?.workbench?.project_visible === true,
      onboardJson?.workbench?.project_visible ?? null
    ),
    check("pending_embeddings_recovered", pending === 0, { pending_chunks: pending }),
    check(
      "optional_cleanup_preview",
      cleanupMode === "none" || cleanupJson?.dry_run === true,
      cleanupMode === "none" ? "skipped" : cleanupJson?.status ?? cleanupPreview?.status
    )
  ];
  return makeReport({
    checks,
    warnings:
      cleanupMode === "none"
        ? [{ code: "cleanup_skipped", message: "Cleanup preview was not requested." }]
        : [],
    evidence: {
      project_dir_supplied: Boolean(projectDir),
      command_results: {
        onboard: { ok: onboard.ok, status: onboard.status ?? 0 },
        doctor: { ok: doctor.ok, status: doctor.status ?? 0 },
        cleanup: cleanupPreview ? { ok: cleanupPreview.ok, status: cleanupPreview.status ?? 0 } : null
      },
      onboard: {
        status: onboardJson?.status ?? null,
        embedding_recovery: onboardJson?.embedding_recovery?.status ?? null
      },
      doctor: {
        capture_status: doctorJson?.capture_readiness?.status ?? null,
        pending_embeddings: pending,
        public_readiness: publicReadiness.status ?? null,
        service_runtime: production.service_runtime?.status ?? null
      },
      cleanup: cleanupJson?.receipt ?? null
    }
  });
}

if (process.env[requiredOptIn] !== "1") {
  emit(
    {
      action: "live_acceptance",
      status: "refused",
      reason: "Explicit opt-in is required before running live host acceptance.",
      required_env: requiredOptIn,
      accepted_env: acceptedEnv,
      redaction: {
        database_urls: "redacted",
        tokens: "redacted",
        session_cookies: "redacted",
        admin_emails: "redacted",
        raw_env: "not_printed"
      }
    },
    2
  );
} else if (fixtureMode) {
  const report = fixtureReport(fixtureMode);
  emit({ acceptance_report: report }, report.status === "fail" ? 1 : 0);
} else if (!process.env.RECALLANT_LIVE_PROJECT_DIR) {
  emit(
    {
      action: "live_acceptance",
      status: "refused",
      reason: "RECALLANT_LIVE_PROJECT_DIR is required for live acceptance.",
      accepted_env: acceptedEnv
    },
    2
  );
} else {
  const report = runRealAcceptance(process.env.RECALLANT_LIVE_PROJECT_DIR);
  emit({ acceptance_report: report }, report.status === "fail" ? 1 : 0);
}
