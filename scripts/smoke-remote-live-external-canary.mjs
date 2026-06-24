import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { parseArgs, resultFor, usageText } from "./remote-live-external-canary.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const resultShapeKeys = [
  "status",
  "mode",
  "external_child",
  "proofs",
  "redaction",
  "cleanup",
  "artifacts"
];

function assertResultShape(result) {
  for (const key of resultShapeKeys) {
    assert(Object.hasOwn(result, key), `result missing ${key}`);
  }
  assert(Array.isArray(result.external_child.env.allowed_keys), "external child env keys missing");
  assert(
    Array.isArray(result.external_child.env.forbidden_keys_present),
    "external child forbidden env list missing"
  );
  assert(result.redaction.raw_credentials_printed === false, "redaction status is unsafe");
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function makeProvisioningFetch({ token, tokenId }) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsedUrl = new URL(url);
    const payload = JSON.parse(init.body);
    requests.push({
      url: parsedUrl.pathname,
      origin: parsedUrl.origin,
      authorization: init.headers.authorization,
      payload
    });
    if (parsedUrl.pathname !== "/api/connect/bootstrap-token") {
      return fakeResponse(404, { ok: false, error: "not found" });
    }
    if (payload.action === "create") {
      return fakeResponse(200, {
        ok: true,
        token,
        token_prefix: "canaryprefix",
        bootstrap_token: {
          id: tokenId,
          token_prefix: "canaryprefix",
          status: "active"
        }
      });
    }
    if (payload.action === "revoke") {
      return fakeResponse(200, {
        ok: true,
        bootstrap_token: {
          id: payload.token_id,
          token_prefix: "canaryprefix",
          status: "revoked"
        }
      });
    }
    return fakeResponse(400, { ok: false, error: "bad action" });
  };
  return { fetchImpl, requests };
}

const fakeExternalObservations = {
  noCliInstall: false,
  staleCliUpdated: false
};

async function fakeExternalCommand(command, args, runOptions = {}) {
  const subcommand = args[0];
  if (command !== "recallant") throw new Error(`unexpected fake command: ${command}`);
  if (subcommand === "connect-cloud") {
    const projectDir = args[1];
    const wrapperPath = join(runOptions.env?.HOME ?? projectDir, ".local", "bin", "recallant");
    const hadWrapper = await exists(wrapperPath);
    fakeExternalObservations.noCliInstall ||= !hadWrapper;
    fakeExternalObservations.staleCliUpdated ||= hadWrapper;
    await mkdir(join(wrapperPath, ".."), { recursive: true });
    await writeFile(wrapperPath, "#!/usr/bin/env bash\n# updated recallant client wrapper\n");
    await mkdir(join(projectDir, ".codex"), { recursive: true });
    await mkdir(join(projectDir, ".recallant"), { recursive: true });
    await writeFile(
      join(projectDir, ".codex", "config.toml"),
      [
        "[mcp_servers.recallant]",
        'command = "recallant"',
        'args = ["remote-bridge"]',
        "env = {",
        '  RECALLANT_REMOTE_MCP_URL = "https://recallant.example.com",',
        '  RECALLANT_REMOTE_MCP_CREDENTIAL_REF = "local_file_v1:canaryprefix",',
        '  RECALLANT_REMOTE_MCP_CREDENTIAL_STORE = "<temp-external-home>/credentials.json",',
        '  RECALLANT_PROJECT_ID = "canary-project",',
        '  RECALLANT_DEVELOPER_ID = "canary-developer",',
        '  RECALLANT_REMOTE_MCP_CLIENT_ID = "remote-live-external-canary"',
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      join(projectDir, ".recallant", "remote-consent.json"),
      JSON.stringify({ kind: "recallant_remote_agent_consent" })
    );
    return {
      exitCode: 0,
      stdout: JSON.stringify({ status: "connected", action: "connect_cloud" }),
      stderr: ""
    };
  }
  if (subcommand === "remote-acceptance" && args[1] === "cleanup") {
    const projectDir = args[args.indexOf("--project-dir") + 1];
    await rm(join(projectDir, ".recallant"), { recursive: true, force: true });
    return { exitCode: 0, stdout: "Status: cleaned\nWrites files: yes\n", stderr: "" };
  }
  if (subcommand === "remote-acceptance" && args[1] === "validate") {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        status: "pass",
        evidence_file: "canary.evidence.json",
        checks: ["external_evidence_valid", "redaction_passed"]
      })}\n`,
      stderr: ""
    };
  }
  if (subcommand === "remote-acceptance" && args[1] === "validate-live") {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        status: "pass",
        evidence_file: "canary.evidence.json",
        checks: [
          "external_evidence_valid",
          "workbench_project_visible",
          "audit_rows_successful",
          "audit_rows_redacted"
        ]
      })}\n`,
      stderr: ""
    };
  }
  if (subcommand === "agent-start") {
    await mkdir(join(runOptions.cwd ?? ".", ".recallant"), { recursive: true });
    await writeFile(join(runOptions.cwd ?? ".", ".recallant", "current-session.json"), "{}\n");
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        ok: true,
        action: "agent_start",
        mode: "remote_mcp_ready",
        recommended_next_call: "memory_get_context_pack"
      })}\n`,
      stderr: ""
    };
  }
  if (subcommand === "remote-acceptance") {
    if (await exists(join(runOptions.cwd ?? ".", ".recallant"))) {
      return {
        exitCode: 1,
        stdout: "Result: FAIL\n- Error: before bootstrap: project contains .recallant\n",
        stderr: ""
      };
    }
    const outputDir = args[args.indexOf("--output-dir") + 1];
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "canary.evidence.json"), "{}\n");
    await writeFile(join(outputDir, "canary.summary.md"), "# summary\n");
    return {
      exitCode: 0,
      stdout: [
        "# Recallant Separate-Machine Evidence",
        "",
        "Result: PASS",
        "- Bootstrap exit: 0",
        "- Remote doctor exit: 0",
        "- Remote bridge MCP: pass",
        "- Semantic marker recall: true",
        "- Next-session recall: true",
        "- Codex config written: true",
        "- No .recallant/Docker/Postgres artifacts: pass",
        "- Secrets redacted: pass",
        `Evidence JSON: ${join(outputDir, "canary.evidence.json")}`,
        `Evidence summary: ${join(outputDir, "canary.summary.md")}`,
        ""
      ].join("\n"),
      stderr: ""
    };
  }
  throw new Error(`unexpected fake subcommand: ${subcommand}`);
}

const emptyEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: tmpdir()
};
const outputDir = await mkdtemp(join(tmpdir(), "recallant-live-external-canary-smoke-"));
const help = usageText();
for (const marker of [
  "Usage: recallant remote-live-external-canary",
  "--dry-run",
  "--controller-url",
  "--output-dir",
  "--keep-artifacts-on-fail",
  "cleanup",
  "External-child redaction boundary"
]) {
  assert(help.includes(marker), `help missing marker: ${marker}`);
}

const skippedJson = await resultFor(parseArgs(["--json"], emptyEnv), emptyEnv);
assertResultShape(skippedJson);
assert(
  skippedJson.status === "skipped_live_external_canary",
  "no-live run did not report skipped_live_external_canary"
);

const poisonDb = "poison-database-url-value";
const poisonProvider = "poison-provider-secret-value";
const controllerSecret = "controller-auth-token-secret";
const bootstrapToken = "rcl_boot_canaryprefix_bootstrapsecret";
const bootstrapTokenId = "bootstrap-token-1";
const dryRunEnv = {
  ...emptyEnv,
  RECALLANT_DATABASE_URL: poisonDb,
  OPENAI_API_KEY: poisonProvider,
  RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN: controllerSecret
};
const dryRunJson = await resultFor(
  parseArgs(["--dry-run", "--json", "--output-dir", outputDir, "--keep-artifacts-on-fail"], dryRunEnv),
  dryRunEnv
);
const dryRunOutput = JSON.stringify(dryRunJson);
assert(!dryRunOutput.includes(poisonDb), "dry-run leaked database URL value");
assert(!dryRunOutput.includes(poisonProvider), "dry-run leaked provider secret value");
assert(!dryRunOutput.includes(controllerSecret), "dry-run leaked controller secret value");
assert(!dryRunOutput.includes(outputDir), "dry-run leaked raw output dir path");
assertResultShape(dryRunJson);
assert(dryRunJson.status === "dry_run", "dry-run status mismatch");
assert(
  dryRunJson.controller.required_env.includes("RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN"),
  "dry-run did not list controller auth token requirement"
);
assert(
  dryRunJson.controller.optional_env.includes("RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL"),
  "dry-run did not list optional controller URL"
);
assert(
  dryRunJson.external_child.env.forbidden_keys_present.length === 0,
  "external child env contract includes forbidden keys"
);
assert(
  dryRunJson.external_child.env.parent_forbidden_key_count_filtered >= 2,
  "dry-run did not observe filtered parent forbidden env keys"
);

const blockedJson = await resultFor(parseArgs(["--live", "--json"], emptyEnv), emptyEnv);
assertResultShape(blockedJson);
assert(
  blockedJson.status === "blocked_live_external_canary_input",
  "missing live input did not produce blocked status"
);

const liveEnv = {
  ...emptyEnv,
  RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL: "https://recallant.example.com",
  RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN: controllerSecret,
  RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID: "22222222-2222-4222-8222-222222222222",
  RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE: "1",
  RECALLANT_DATABASE_URL: "controller-only-database-url"
};
const provisioning = makeProvisioningFetch({
  token: bootstrapToken,
  tokenId: bootstrapTokenId
});
const liveJson = await resultFor(parseArgs(["--live", "--json"], liveEnv), liveEnv, {
  fetch: provisioning.fetchImpl,
  runCommand: fakeExternalCommand
});
const liveOutput = JSON.stringify(liveJson);
assertResultShape(liveJson);
assert(
  liveJson.status === "pass_live_external_canary",
  "live canary did not pass external sandbox"
);
assert(
  liveJson.controller.disposable_access?.kind === "bootstrap_token",
  "live controller did not use bootstrap-token contract"
);
assert(
  liveJson.controller.disposable_access?.prefix === "canaryprefix",
  "live controller did not record token prefix"
);
assert(!liveOutput.includes(controllerSecret), "live output leaked controller secret value");
assert(!liveOutput.includes(bootstrapToken), "live output leaked bootstrap token value");
assert(
  liveJson.external_child.receives_privileged_controller_env === false,
  "external child received privileged controller env"
);
assert(liveJson.sandbox.env.forbidden_keys_present.length === 0, "sandbox env leaked forbidden keys");
assert(
  liveJson.sandbox.agent_start.mode === "remote_mcp_ready",
  "sandbox agent-start did not report remote_mcp_ready"
);
assert(
  liveJson.sandbox.acceptance.semantic_marker_recall === true &&
    liveJson.sandbox.acceptance.next_session_recall === true,
  "sandbox acceptance did not prove semantic and next-session recall"
);
assert(liveJson.sandbox.evidence_validation.status === "pass", "evidence validation did not pass");
assert(
  liveJson.sandbox.server_trace_validation.status === "pass",
  "server trace validation did not pass"
);
assert(liveJson.cleanup.status === "revoked", "live canary did not auto-clean disposable access");
assert(liveJson.failure === null, "passing live canary should not include a failure block");
assert(liveJson.release_gate.status === "pass", "release gate did not pass with validate-live");
assert(!liveOutput.includes(outputDir), "live output leaked raw output dir path");
assert(
  liveJson.sandbox.project_after.uses_credential_ref === true &&
    liveJson.sandbox.project_after.raw_credential_in_config === false,
  "sandbox project did not use credential ref safely"
);
assert(
  Object.values(liveJson.sandbox.project_after.forbidden).every((value) => value === false),
  "sandbox project contains forbidden local artifacts"
);
assert(
  provisioning.requests[0]?.authorization === `Bearer ${controllerSecret}`,
  "controller did not use protected route auth"
);
assert(
  provisioning.requests[0]?.origin === "https://recallant.example.com",
  "controller default did not use server URL origin"
);
assert(
  provisioning.requests[0]?.payload.action === "create" &&
    provisioning.requests[0]?.payload.allow_project_create === true,
  "controller did not create a bootstrap token through the existing contract"
);

const splitControllerProvisioning = makeProvisioningFetch({
  token: bootstrapToken,
  tokenId: "bootstrap-token-split-controller"
});
const splitControllerJson = await resultFor(
  parseArgs(["--live", "--json", "--controller-url", "http://127.0.0.1:9988"], liveEnv),
  liveEnv,
  {
    fetch: splitControllerProvisioning.fetchImpl,
    runCommand: fakeExternalCommand
  }
);
assert(
  splitControllerJson.status === "pass_live_external_canary",
  "split controller URL canary did not pass"
);
assert(
  splitControllerProvisioning.requests[0]?.origin === "http://127.0.0.1:9988",
  "controller URL was not used for protected provisioning"
);
const splitControllerCommands = splitControllerJson.sandbox.commands
  .map((commandResult) => commandResult.command)
  .join("\n");
assert(
  splitControllerCommands.includes("https://recallant.example.com"),
  "external child did not keep using public server URL"
);
assert(
  !splitControllerCommands.includes("127.0.0.1"),
  "external child received server-local controller URL"
);

const skipLiveValidationEnv = {
  ...liveEnv,
  RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE: "0"
};
const skipLiveProvisioning = makeProvisioningFetch({
  token: bootstrapToken,
  tokenId: bootstrapTokenId
});
const skippedServerTraceJson = await resultFor(
  parseArgs(["--live", "--json"], skipLiveValidationEnv),
  skipLiveValidationEnv,
  {
    fetch: skipLiveProvisioning.fetchImpl,
    runCommand: fakeExternalCommand
  }
);
assert(
  skippedServerTraceJson.status === "pass_live_external_canary_server_trace_validation_skipped",
  "canary without validate-live should not report release pass"
);
assert(
  skippedServerTraceJson.release_gate.status === "not_release_pass",
  "skipped server trace validation should block release gate"
);
assert(
  skippedServerTraceJson.failure?.failing_gate === "server_trace_validation",
  "skipped server trace validation should identify the failing release gate"
);
assert(
  skippedServerTraceJson.sandbox.server_trace_validation.code === "server_trace_validation_skipped",
  "server trace skip reason missing"
);

async function fakeAgentStartFailureCommand(command, args, runOptions = {}) {
  if (args[0] === "agent-start") {
    return {
      exitCode: 19,
      stdout: "",
      stderr: `agent-start failed without exposing ${bootstrapToken}`
    };
  }
  return fakeExternalCommand(command, args, runOptions);
}

const failureProvisioning = makeProvisioningFetch({
  token: bootstrapToken,
  tokenId: "bootstrap-token-failure"
});
const failedLiveJson = await resultFor(parseArgs(["--live", "--json"], liveEnv), liveEnv, {
  fetch: failureProvisioning.fetchImpl,
  runCommand: fakeAgentStartFailureCommand
});
const failedLiveOutput = JSON.stringify(failedLiveJson);
assertResultShape(failedLiveJson);
assert(
  failedLiveJson.status === "fail_live_external_canary",
  "failed live canary did not report fail status"
);
assert(
  failedLiveJson.failure?.failing_gate === "agent_start" &&
    failedLiveJson.failure?.exit_code === 19,
  "failed live canary did not include gate and exit-code diagnostics"
);
assert(
  failedLiveJson.failure?.next_diagnostic_command === "recallant agent-start --format json",
  "failed live canary did not include next diagnostic command"
);
assert(failedLiveJson.cleanup.status === "revoked", "failed live canary did not run cleanup");
assert(!failedLiveOutput.includes(bootstrapToken), "failed live output leaked bootstrap token");
assert(!failedLiveOutput.includes(outputDir), "failed live output leaked raw output dir path");

const staleHome = await mkdtemp(join(tmpdir(), "recallant-live-external-canary-stale-home-"));
const staleProject = await mkdtemp(join(tmpdir(), "recallant-live-external-canary-stale-project-"));
const staleWrapper = join(staleHome, ".local", "bin", "recallant");
await mkdir(join(staleWrapper, ".."), { recursive: true });
await writeFile(staleWrapper, "#!/usr/bin/env bash\n# stale recallant client wrapper\n");
await fakeExternalCommand("recallant", ["connect-cloud", staleProject], {
  env: { HOME: staleHome, PATH: emptyEnv.PATH, TMPDIR: emptyEnv.TMPDIR }
});
await fakeExternalCommand("recallant", ["connect-cloud", staleProject], {
  env: { HOME: staleHome, PATH: emptyEnv.PATH, TMPDIR: emptyEnv.TMPDIR }
});
const staleConfig = await readFile(join(staleProject, ".codex", "config.toml"), "utf8");
const reconnectEntries = staleConfig.match(/\[mcp_servers\.recallant\]/g) ?? [];

const acceptanceCommand = liveJson.sandbox.commands.find(
  (commandResult) => commandResult.label === "remote_acceptance"
)?.command;
const allCommands = liveJson.sandbox.commands.map((commandResult) => commandResult.command).join("\n");
const regressionCases = [
  {
    id: "no_cli_install",
    status: fakeExternalObservations.noCliInstall ? "pass" : "fail",
    evidence: "fake bootstrap created recallant client wrapper in fresh temp HOME"
  },
  {
    id: "stale_cli_update",
    status: fakeExternalObservations.staleCliUpdated ? "pass" : "fail",
    evidence: "fake bootstrap overwrote pre-existing stale wrapper before acceptance"
  },
  {
    id: "already_connected_credential_ref_acceptance",
    status:
      acceptanceCommand &&
      !acceptanceCommand.includes("--credential") &&
      !acceptanceCommand.includes("--skip-bootstrap") &&
      liveJson.sandbox.project_after.uses_credential_ref
        ? "pass"
        : "fail",
    evidence: "remote-acceptance command used project-local credential refs"
  },
  {
    id: "missing_evidence_dir_auto_created",
    status: liveJson.sandbox.acceptance.evidence_dir_exists ? "pass" : "fail",
    evidence: "remote-acceptance wrote evidence into a previously missing output dir"
  },
  {
    id: "reconnect_update_idempotent",
    status: reconnectEntries.length === 1 ? "pass" : "fail",
    evidence: `recallant MCP config entries after two reconnects: ${reconnectEntries.length}`
  },
  {
    id: "forbidden_local_path_not_used",
    status:
      !/attach --confirm|onboard|import|docker|postgres|RECALLANT_DATABASE_URL/i.test(allCommands) &&
      Object.values(liveJson.sandbox.project_after.forbidden).every((value) => value === false)
        ? "pass"
        : "fail",
    evidence: "canary did not require local attach/onboard/import/Docker/Postgres/local storage"
  },
  {
    id: "incomplete_live_inputs_blocked",
    status: blockedJson.status === "blocked_live_external_canary_input" ? "pass" : "fail",
    evidence: blockedJson.reason
  },
  {
    id: "validate_live_skip_blocks_release",
    status: skippedServerTraceJson.release_gate.status === "not_release_pass" ? "pass" : "fail",
    evidence: skippedServerTraceJson.sandbox.server_trace_validation.code
  }
];
assert(
  regressionCases.every((entry) => entry.status === "pass"),
  `regression matrix failed: ${JSON.stringify(regressionCases)}`
);

const cleanupJson = await resultFor(
  parseArgs(
    [
      "cleanup",
      "--live",
      "--json",
      "--cleanup-kind",
      "bootstrap_token",
      "--cleanup-id",
      bootstrapTokenId
    ],
    liveEnv
  ),
  liveEnv,
  { fetch: provisioning.fetchImpl }
);
const cleanupOutput = JSON.stringify(cleanupJson);
assertResultShape(cleanupJson);
assert(cleanupJson.status === "cleanup_complete", "cleanup did not complete");
assert(cleanupJson.cleanup.status === "revoked", "cleanup did not revoke disposable token");
assert(!cleanupOutput.includes(controllerSecret), "cleanup output leaked controller secret value");
assert(!cleanupOutput.includes(bootstrapToken), "cleanup output leaked bootstrap token value");
assert(
  provisioning.requests.at(-1)?.payload.action === "revoke",
  "cleanup did not call revoke action"
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "ok",
      remote_live_external_canary_smoke: {
        help: "pass",
        no_live_default: skippedJson.status,
        dry_run_contract: dryRunJson.status,
        explicit_live_without_inputs: blockedJson.status,
        live_external_sandbox: liveJson.status,
        server_trace_validation_skipped: skippedServerTraceJson.sandbox.server_trace_validation.code,
        controller_cleanup: cleanupJson.status,
        auto_cleanup: liveJson.cleanup.status,
        failure_diagnostics: {
          status: failedLiveJson.status,
          failing_gate: failedLiveJson.failure.failing_gate,
          exit_code: failedLiveJson.failure.exit_code,
          next_diagnostic_command: failedLiveJson.failure.next_diagnostic_command,
          cleanup_status: failedLiveJson.cleanup.status
        },
        result_shape_keys: resultShapeKeys,
        external_child_forbidden_env_keys: dryRunJson.external_child.env.forbidden_keys_present,
        redaction: dryRunJson.redaction.status,
        disposable_access: {
          kind: liveJson.controller.disposable_access.kind,
          prefix: liveJson.controller.disposable_access.prefix,
          raw_secret_value_printed: liveJson.controller.disposable_access.raw_secret_value_printed
        },
        cleanup_status: cleanupJson.cleanup.status,
        sandbox: {
          env_forbidden_keys: liveJson.sandbox.env.forbidden_keys_present,
          agent_start_mode: liveJson.sandbox.agent_start.mode,
          semantic_marker_recall: liveJson.sandbox.acceptance.semantic_marker_recall,
          next_session_recall: liveJson.sandbox.acceptance.next_session_recall,
          evidence_validation: liveJson.sandbox.evidence_validation.status,
          server_trace_validation: liveJson.sandbox.server_trace_validation.status,
          project_entries: liveJson.sandbox.project_after.entries,
          uses_credential_ref: liveJson.sandbox.project_after.uses_credential_ref
        },
        regression_matrix: regressionCases
      }
    },
    null,
    2
  )}\n`
);
