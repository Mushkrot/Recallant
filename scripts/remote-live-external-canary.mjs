#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const forbiddenEnvPattern =
  /(?:RECALLANT_DATABASE_URL|DATABASE_URL|POSTGRES|PGPASSWORD|WORKBENCH|ADMIN|PROVIDER|OPENAI|ANTHROPIC|RAW_ARTIFACT|BACKUP|PRIVATE_KEY|SECRET)/i;

const forbiddenOutputClasses = [
  "database URLs",
  "Postgres credentials",
  "Workbench/admin auth",
  "provider secrets",
  "private keys",
  "raw artifacts",
  "backups",
  "raw scoped credentials",
  "bootstrap tokens",
  "controller auth tokens",
  "private topology"
];

const optionalLiveEnv = [
  "RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL",
  "RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN",
  "RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID",
  "RECALLANT_LIVE_EXTERNAL_CANARY_PROJECT_ID",
  "RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_MODE",
  "RECALLANT_LIVE_EXTERNAL_CANARY_CLIENT_ID",
  "RECALLANT_LIVE_EXTERNAL_CANARY_LABEL",
  "RECALLANT_LIVE_EXTERNAL_CANARY_EXPIRES_AT",
  "RECALLANT_LIVE_EXTERNAL_CANARY_RECALLANT_CMD",
  "RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE",
  "RECALLANT_LIVE_EXTERNAL_CANARY_TARGET",
  "RECALLANT_LIVE_EXTERNAL_CANARY_OUTPUT_DIR",
  "RECALLANT_LIVE_EXTERNAL_CANARY_KEEP_ARTIFACTS_ON_FAIL"
];
const privilegedControllerEnv = [
  "RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN",
  "RECALLANT_AUTH_TOKEN"
];
const controllerModes = ["bootstrap_token", "scoped_credential"];
const cleanupKinds = ["bootstrap_token", "scoped_credential"];

export function parseArgs(argv, env = process.env) {
  const options = {
    mode: "run",
    json: false,
    dryRun: false,
    live: false,
    outputDir: env.RECALLANT_LIVE_EXTERNAL_CANARY_OUTPUT_DIR ?? "",
    keepArtifactsOnFail: env.RECALLANT_LIVE_EXTERNAL_CANARY_KEEP_ARTIFACTS_ON_FAIL === "1",
    serverUrl: env.RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL ?? "",
    controllerUrl:
      env.RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL ??
      env.RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL ??
      "",
    target: env.RECALLANT_LIVE_EXTERNAL_CANARY_TARGET ?? "codex",
    authToken: env.RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN ?? "",
    developerId: env.RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID ?? "",
    projectId: env.RECALLANT_LIVE_EXTERNAL_CANARY_PROJECT_ID ?? "",
    clientId: env.RECALLANT_LIVE_EXTERNAL_CANARY_CLIENT_ID ?? "remote-live-external-canary",
    label: env.RECALLANT_LIVE_EXTERNAL_CANARY_LABEL ?? "Recallant live external canary",
    expiresAt: env.RECALLANT_LIVE_EXTERNAL_CANARY_EXPIRES_AT ?? "",
    recallantCommand: env.RECALLANT_LIVE_EXTERNAL_CANARY_RECALLANT_CMD ?? "recallant",
    validateLive: env.RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE === "1",
    controllerMode: env.RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_MODE ?? "bootstrap_token",
    cleanupKind: env.RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_KIND ?? "",
    cleanupId: env.RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_ID ?? ""
  };
  if (argv[0] === "cleanup") {
    options.mode = "cleanup";
    argv = argv.slice(1);
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--json" || arg === "--format=json") options.json = true;
    else if (arg === "--format") {
      if (next === "json") options.json = true;
      else if (next !== "text") throw new Error("VALIDATION_ERROR: --format must be json or text");
      index += 1;
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--server-url") {
      options.serverUrl = next ?? "";
      index += 1;
    } else if (arg === "--controller-url") {
      options.controllerUrl = next ?? "";
      index += 1;
    } else if (arg === "--target" || arg === "--client") {
      options.target = next ?? "";
      index += 1;
    } else if (arg === "--auth-token") {
      options.authToken = next ?? "";
      index += 1;
    } else if (arg === "--developer-id") {
      options.developerId = next ?? "";
      index += 1;
    } else if (arg === "--project-id") {
      options.projectId = next ?? "";
      index += 1;
    } else if (arg === "--client-id") {
      options.clientId = next ?? "";
      index += 1;
    } else if (arg === "--label") {
      options.label = next ?? "";
      index += 1;
    } else if (arg === "--expires-at") {
      options.expiresAt = next ?? "";
      index += 1;
    } else if (arg === "--recallant-command") {
      options.recallantCommand = next ?? "";
      index += 1;
    } else if (arg === "--validate-live") {
      options.validateLive = true;
    } else if (arg === "--skip-validate-live") {
      options.validateLive = false;
    } else if (arg === "--controller-mode") {
      options.controllerMode = next ?? "";
      index += 1;
    } else if (arg === "--cleanup-kind") {
      options.cleanupKind = next ?? "";
      index += 1;
    } else if (arg === "--cleanup-id") {
      options.cleanupId = next ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = next ?? "";
      index += 1;
    } else if (arg === "--keep-artifacts-on-fail") options.keepArtifactsOnFail = true;
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function usageText() {
  return `Usage: recallant remote-live-external-canary [--live] [--dry-run] [--json] [--output-dir <path>] [--keep-artifacts-on-fail]
       recallant remote-live-external-canary cleanup [--output-dir <path>] [--json]

Runs the Recallant remote live external canary. The canary is a server-controlled fake
external workstation for remote project access. It will create a clean fake HOME/project, install
or update the remote client through the public /connect path, run agent-start, run
remote-acceptance --semantic-proof, validate redacted evidence, and clean up disposable artifacts.

Current command contract:
  --dry-run                  Print the planned live run without network or provisioning changes.
  --live                     Require live inputs; missing inputs fail instead of skipping.
  --server-url <https-url>   Live central Recallant server URL. Env:
                             RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL.
  --controller-url <url>     Optional server-local controller URL for protected provisioning.
                             Defaults to --server-url and is never sent to the external child.
  --auth-token <token>       Privileged controller token for protected provisioning routes.
                             Never sent to the external child or printed.
  --developer-id <id>        Developer scope for disposable live access.
  --project-id <id>          Project scope. Required for scoped_credential mode.
  --client-id <id>           Remote client id for scoped credentials.
  --controller-mode <mode>   bootstrap_token (default) or scoped_credential.
  --recallant-command <cmd>  Recallant CLI command used inside the fake external host.
  --validate-live            Also run privileged server-side evidence validation.
  --target <client>          codex, cursor, claude-code, or generic. Default: codex.
  --output-dir <path>        Directory for canary artifacts and redacted evidence.
  --keep-artifacts-on-fail   Preserve redacted temp artifacts after failure.
  --json                     Print machine-readable JSON.
  cleanup                    Revoke a disposable token/credential with --cleanup-kind and
                             --cleanup-id. Live cleanup also requires server URL and auth token.

Live mode is intentionally opt-in. Without live inputs, the command reports
skipped_live_external_canary and must not be treated as a release pass.

External-child redaction boundary:
  The fake remote child must not receive RECALLANT_DATABASE_URL, Postgres variables,
  Workbench/admin auth, provider secrets, private keys, raw artifact paths, backup paths,
  raw scoped credentials, controller auth tokens, bootstrap tokens, or private topology.
`;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validControllerUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function secretPrefix(value, kind) {
  const parts = String(value ?? "").split("_");
  return parts.length === 4 && parts[0] === "rcl" && parts[1] === kind ? parts[2] : null;
}

function redactControllerText(value, options) {
  let text = String(value ?? "");
  for (const raw of [options.authToken]) {
    if (raw) text = text.replaceAll(raw, "[REDACTED_CONTROLLER_SECRET]");
  }
  return text;
}

function redactRuntimeText(value, options, secretMaterial = {}, paths = {}) {
  let text = redactControllerText(value, options);
  for (const raw of [
    secretMaterial.bootstrapToken,
    secretMaterial.scopedCredential,
    paths.root,
    paths.home,
    paths.project,
    paths.install,
    paths.tmp,
    paths.evidenceDir
  ]) {
    if (raw) text = text.replaceAll(raw, "[REDACTED_CANARY_RUNTIME]");
  }
  return text;
}

function buildExternalChildEnvContract(parentEnv = process.env) {
  const childEnv = {
    PATH: parentEnv.PATH ?? "",
    HOME: "<temp-external-home>",
    TMPDIR: parentEnv.TMPDIR ?? tmpdir()
  };
  if (parentEnv.NODE_EXTRA_CA_CERTS) childEnv.NODE_EXTRA_CA_CERTS = "<inherited-ca-certs-path>";
  const forbiddenKeysPresent = Object.keys(childEnv).filter((key) => forbiddenEnvPattern.test(key));
  const parentForbiddenKeyCount = Object.keys(parentEnv).filter((key) =>
    forbiddenEnvPattern.test(key)
  ).length;
  return {
    allowed_keys: Object.keys(childEnv).sort(),
    forbidden_keys_present: forbiddenKeysPresent,
    parent_forbidden_key_count_filtered: parentForbiddenKeyCount,
    env_values_printed: false
  };
}

async function defaultOutputDir(options) {
  if (options.outputDir) return resolve(options.outputDir);
  const base = await mkdtemp(join(tmpdir(), "recallant-live-external-canary-"));
  return join(base, "artifacts");
}

function baseProofs() {
  return {
    agent_start: { status: "not_run", expected: 'mode: "remote_mcp_ready"' },
    remote_acceptance: { status: "not_run", command: "recallant remote-acceptance --semantic-proof" },
    semantic_marker_recall: { status: "not_run" },
    next_session_recall: { status: "not_run" },
    evidence_validation: { status: "not_run" },
    server_trace_validation: { status: "not_run" },
    no_local_storage: { status: "not_run" }
  };
}

function controllerRequiredEnv(options) {
  const required = [
    "RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL",
    "RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN",
    "RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID"
  ];
  if (options.controllerMode === "scoped_credential") {
    required.push("RECALLANT_LIVE_EXTERNAL_CANARY_PROJECT_ID");
  }
  if (options.mode === "cleanup") {
    required.push("RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_KIND");
    required.push("RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_ID");
  }
  return required;
}

function controllerValueForEnv(key, options) {
  const values = {
    RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL: options.serverUrl,
    RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL: options.controllerUrl,
    RECALLANT_LIVE_EXTERNAL_CANARY_AUTH_TOKEN: options.authToken,
    RECALLANT_LIVE_EXTERNAL_CANARY_DEVELOPER_ID: options.developerId,
    RECALLANT_LIVE_EXTERNAL_CANARY_PROJECT_ID: options.projectId,
    RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_KIND: options.cleanupKind,
    RECALLANT_LIVE_EXTERNAL_CANARY_CLEANUP_ID: options.cleanupId
  };
  return values[key] ?? "";
}

function controllerInputState(options) {
  const required = controllerRequiredEnv(options);
  const providedRequired = Object.fromEntries(
    required.map((key) => [key, String(controllerValueForEnv(key, options)).trim() !== ""])
  );
  const missing = required.filter((key) => !providedRequired[key]);
  const anyProvided = [
    ...required,
    "RECALLANT_LIVE_EXTERNAL_CANARY_CONTROLLER_URL",
    "RECALLANT_LIVE_EXTERNAL_CANARY_PROJECT_ID",
    "RECALLANT_LIVE_EXTERNAL_CANARY_CLIENT_ID",
    "RECALLANT_LIVE_EXTERNAL_CANARY_LABEL",
    "RECALLANT_LIVE_EXTERNAL_CANARY_EXPIRES_AT"
  ].some((key) => String(controllerValueForEnv(key, options)).trim() !== "");
  return {
    required_env: required,
    optional_env: optionalLiveEnv.filter((key) => !required.includes(key)),
    provided_required: providedRequired,
    missing_required: missing,
    any_live_input_provided: anyProvided
  };
}

function baseController(options, inputState) {
  return {
    mode: options.controllerMode,
    provisioning_contract:
      options.controllerMode === "scoped_credential"
        ? "protected controller /api/remote-credential create"
        : "protected controller /api/connect/bootstrap-token create",
    required_env: inputState.required_env,
    optional_env: inputState.optional_env,
    provided_required: inputState.provided_required,
    missing_required: inputState.missing_required,
    privileged_env_provided_to_child: false,
    privileged_env_names: privilegedControllerEnv,
    raw_secret_values_printed: false,
    disposable_access: null,
    cleanup_handles: []
  };
}

function authorizationHeader(options) {
  return { authorization: `Bearer ${options.authToken}` };
}

async function postJson(fetchImpl, url, payload, options) {
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authorizationHeader(options)
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `provisioning request returned non-JSON ${response.status}: ${redactControllerText(
        text.slice(0, 500),
        options
      )}`
    );
  }
  if (!response.ok) {
    throw new Error(
      `provisioning request failed ${response.status}: ${redactControllerText(JSON.stringify(body), options)}`
    );
  }
  if (body && typeof body === "object" && body.ok === false) {
    throw new Error(
      `provisioning request failed ${response.status}: ${redactControllerText(
        JSON.stringify(body),
        options
      )}`
    );
  }
  return body;
}

function cleanupHandle(kind, id, prefix) {
  return {
    kind,
    id,
    prefix,
    action: "revoke",
    status: "planned",
    raw_secret_value_printed: false
  };
}

function redactedArtifacts(outputDir, options) {
  return {
    output_dir: "<canary-output-dir>",
    output_dir_created: Boolean(outputDir),
    preserved_on_failure: options.keepArtifactsOnFail,
    secret_values_written: false
  };
}

async function createDisposableAccess(options, fetchImpl) {
  if (options.controllerMode === "bootstrap_token") {
    const endpoint = new URL("/api/connect/bootstrap-token", options.controllerUrl);
    const payload = {
      action: "create",
      developer_id: options.developerId,
      project_id: options.projectId || undefined,
      allow_project_create: !options.projectId,
      target: options.target,
      label: options.label,
      expires_at: options.expiresAt || undefined
    };
    const body = await postJson(fetchImpl, endpoint, payload, options);
    const rawToken = body.token ?? body.bootstrap_token ?? "";
    const tokenRecord =
      typeof body.bootstrap_token === "object" && body.bootstrap_token !== null
        ? body.bootstrap_token
        : {};
    const id = tokenRecord.id ?? body.token_id ?? null;
    const prefix = body.token_prefix ?? tokenRecord.token_prefix ?? secretPrefix(rawToken, "boot");
    if (!rawToken || !id || !prefix) {
      throw new Error(
        "provisioning request did not return a complete bootstrap token, token id, and prefix"
      );
    }
    return {
      disposable: {
        kind: "bootstrap_token",
        id,
        prefix,
        target: options.target,
        raw_secret_value_printed: false,
        provided_to_external_child: true,
        child_receives: ["server_url", "bootstrap_token"],
        child_secret_value_printed: false
      },
      cleanup_handles: [cleanupHandle("bootstrap_token", id, prefix)].filter((handle) => handle.id),
      secret_material: { bootstrapToken: rawToken }
    };
  }

  const endpoint = new URL("/api/remote-credential", options.controllerUrl);
  const payload = {
    action: "create",
    project_id: options.projectId,
    developer_id: options.developerId,
    client_id: options.clientId,
    label: options.label,
    server_url: options.serverUrl,
    target: options.target,
    bridge_client_id: options.clientId
  };
  const body = await postJson(fetchImpl, endpoint, payload, options);
  const credential = body.credential ?? body.provisioning?.credential ?? {};
  const prefix =
    credential.credential_prefix ??
    body.credential_prefix ??
    secretPrefix(body.one_time_secret, "mcp");
  if (!(body.one_time_secret ?? body.secret) || !(credential.id ?? body.credential_id) || !prefix) {
    throw new Error(
      "provisioning request did not return a complete scoped credential, credential id, and prefix"
    );
  }
  return {
    disposable: {
      kind: "scoped_credential",
      id: credential.id ?? body.credential_id ?? null,
      prefix,
      project_id: options.projectId,
      developer_id: options.developerId,
      client_id: options.clientId,
      raw_secret_value_printed: false,
      provided_to_external_child: true,
      child_receives: ["server_url", "project_id", "developer_id", "client_id", "scoped_credential"],
      child_secret_value_printed: false
    },
    cleanup_handles: [
      cleanupHandle("scoped_credential", credential.id ?? body.credential_id ?? null, prefix)
    ].filter((handle) => handle.id),
    secret_material: { scopedCredential: body.one_time_secret ?? body.secret ?? "" }
  };
}

async function revokeDisposableAccess(options, fetchImpl) {
  if (options.cleanupKind === "bootstrap_token") {
    const endpoint = new URL("/api/connect/bootstrap-token", options.controllerUrl);
    const body = await postJson(
      fetchImpl,
      endpoint,
      { action: "revoke", token_id: options.cleanupId },
      options
    );
    return {
      kind: "bootstrap_token",
      id: options.cleanupId,
      status: body.bootstrap_token?.status ?? body.status ?? "revoked",
      raw_secret_value_printed: false
    };
  }
  const endpoint = new URL("/api/remote-credential", options.controllerUrl);
  const body = await postJson(
    fetchImpl,
    endpoint,
    {
      action: "revoke",
      project_id: options.projectId,
      developer_id: options.developerId,
      client_id: options.clientId,
      credential_id: options.cleanupId,
      server_url: options.serverUrl,
      target: options.target,
      bridge_client_id: options.clientId
    },
    options
  );
  return {
    kind: "scoped_credential",
    id: options.cleanupId,
    prefix: body.credential?.credential_prefix ?? null,
    status: body.credential?.status ?? body.status ?? "revoked",
    raw_secret_value_printed: false
  };
}

function cleanupSucceeded(status) {
  return ["revoked", "deleted", "inactive"].includes(String(status ?? "").toLowerCase());
}

async function cleanupDisposableHandles(options, fetchImpl, handles) {
  if (!Array.isArray(handles) || handles.length === 0) {
    return {
      planned: true,
      status: "failed",
      reason: "no disposable access cleanup handle was returned by provisioning",
      release_pass: false,
      results: []
    };
  }

  const results = [];
  for (const handle of handles) {
    try {
      const result = await revokeDisposableAccess(
        {
          ...options,
          cleanupKind: handle.kind,
          cleanupId: handle.id
        },
        fetchImpl
      );
      results.push({
        ...result,
        prefix: result.prefix ?? handle.prefix ?? null,
        raw_secret_value_printed: false
      });
    } catch (error) {
      results.push({
        kind: handle.kind,
        id: handle.id,
        prefix: handle.prefix ?? null,
        status: "failed",
        exit_code: 1,
        error: redactControllerText(error instanceof Error ? error.message : String(error), options),
        raw_secret_value_printed: false
      });
    }
  }

  const releasePass = results.length > 0 && results.every((result) => cleanupSucceeded(result.status));
  return {
    planned: true,
    status: releasePass ? "revoked" : "failed",
    release_pass: releasePass,
    results
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

async function createExternalSandboxPaths(outputDir) {
  const root = await mkdtemp(join(tmpdir(), "recallant-live-external-child-"));
  const paths = {
    root,
    home: join(root, "home"),
    project: join(root, "project"),
    install: join(root, "install"),
    tmp: join(root, "tmp"),
    evidenceDir: join(outputDir, "recallant-external-evidence")
  };
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.project, { recursive: true }),
    mkdir(paths.install, { recursive: true }),
    mkdir(paths.tmp, { recursive: true })
  ]);
  await writeFile(join(paths.project, "README.md"), "# Recallant live external canary project\n");
  return paths;
}

function buildSandboxEnv(parentEnv, paths) {
  const childEnv = {
    PATH: parentEnv.PATH ?? "",
    HOME: paths.home,
    TMPDIR: paths.tmp
  };
  if (parentEnv.NODE_EXTRA_CA_CERTS) childEnv.NODE_EXTRA_CA_CERTS = parentEnv.NODE_EXTRA_CA_CERTS;
  const forbiddenKeysPresent = Object.keys(childEnv).filter((key) => forbiddenEnvPattern.test(key));
  if (forbiddenKeysPresent.length > 0) {
    throw new Error(`forbidden external child env key: ${forbiddenKeysPresent.join(", ")}`);
  }
  return childEnv;
}

function buildControllerValidationEnv(parentEnv, paths) {
  const env = {
    PATH: parentEnv.PATH ?? "",
    HOME: parentEnv.HOME ?? paths.home,
    TMPDIR: parentEnv.TMPDIR ?? paths.tmp
  };
  if (parentEnv.RECALLANT_DATABASE_URL) env.RECALLANT_DATABASE_URL = parentEnv.RECALLANT_DATABASE_URL;
  if (parentEnv.NODE_EXTRA_CA_CERTS) env.NODE_EXTRA_CA_CERTS = parentEnv.NODE_EXTRA_CA_CERTS;
  return env;
}

function recallantInvocation(options, subcommand, args) {
  if (options.recallantCommand.endsWith(".js")) {
    return {
      command: process.execPath,
      args: [options.recallantCommand, subcommand, ...args]
    };
  }
  return {
    command: options.recallantCommand,
    args: [subcommand, ...args]
  };
}

async function defaultRunCommand(command, args, runOptions) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: runOptions.cwd,
      env: runOptions.env,
      maxBuffer: 1024 * 1024
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: Number(error.code ?? 1),
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? "")
    };
  }
}

function commandSummary(label, invocation, result, options, secretMaterial, paths) {
  return {
    label,
    command: redactRuntimeText(`${invocation.command} ${invocation.args.join(" ")}`, options, secretMaterial, paths),
    exit_code: result.exitCode,
    stdout: redactRuntimeText(result.stdout, options, secretMaterial, paths),
    stderr: redactRuntimeText(result.stderr, options, secretMaterial, paths)
  };
}

function nextDiagnosticCommandForGate(gate) {
  const commands = {
    input_validation: "npm run remote-live-external-canary -- --dry-run --json",
    bootstrap: "npm run remote-live-external-canary -- --live --json",
    remote_acceptance_cleanup: "recallant remote-acceptance cleanup --project-dir <project> --confirm",
    post_agent_start_remote_acceptance_cleanup:
      "recallant remote-acceptance cleanup --project-dir <project> --confirm",
    agent_start: "recallant agent-start --format json",
    remote_acceptance: "recallant remote-acceptance --project-dir . --semantic-proof",
    evidence_validation: "recallant remote-acceptance validate --evidence <redacted>",
    server_trace_validation: "recallant remote-acceptance validate-live --evidence <redacted>",
    cleanup: "npm run remote-live-external-canary -- cleanup --live --json",
    no_local_storage: "recallant remote-acceptance cleanup --project-dir <project> --confirm"
  };
  return commands[gate] ?? "npm run remote-live-external-canary -- --live --json";
}

function failureArtifacts(outputDir) {
  return {
    output_dir: "<canary-output-dir>",
    evidence_dir: "<temp-external-evidence-dir>",
    output_dir_created: Boolean(outputDir)
  };
}

function blockedFailure(reason, outputDir) {
  return {
    failing_gate: "input_validation",
    exit_code: 1,
    reason,
    artifact_paths: failureArtifacts(outputDir),
    next_diagnostic_command: nextDiagnosticCommandForGate("input_validation")
  };
}

function sandboxFailure(sandbox, outputDir) {
  const failedCommand = sandbox.commands?.find((command) => command.exit_code !== 0);
  if (failedCommand) {
    return {
      failing_gate: failedCommand.label,
      exit_code: failedCommand.exit_code,
      reason: failedCommand.stderr || failedCommand.stdout || "command failed",
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate(failedCommand.label)
    };
  }
  if (sandbox.agent_start.mode !== "remote_mcp_ready") {
    return {
      failing_gate: "agent_start",
      exit_code: sandbox.agent_start.exit_code,
      reason: 'agent-start did not report mode: "remote_mcp_ready"',
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("agent_start")
    };
  }
  if (!sandbox.acceptance.semantic_marker_recall || !sandbox.acceptance.next_session_recall) {
    return {
      failing_gate: "remote_acceptance",
      exit_code: sandbox.acceptance.exit_code,
      reason: "remote-acceptance did not prove semantic marker and next-session recall",
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("remote_acceptance")
    };
  }
  if (sandbox.evidence_validation.status !== "pass") {
    return {
      failing_gate: "evidence_validation",
      exit_code: sandbox.evidence_validation.exit_code ?? 1,
      reason: sandbox.evidence_validation.reason ?? "evidence validation failed",
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("evidence_validation")
    };
  }
  if (!Object.values(sandbox.project_after.forbidden).every((value) => value === false)) {
    return {
      failing_gate: "no_local_storage",
      exit_code: 1,
      reason: "external project contains forbidden local storage or database artifacts",
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("no_local_storage")
    };
  }
  return null;
}

function releaseFailure(sandbox, cleanup, outputDir) {
  const sandboxIssue = sandboxFailure(sandbox, outputDir);
  if (sandboxIssue) return sandboxIssue;
  if (!cleanup.release_pass) {
    return {
      failing_gate: "cleanup",
      exit_code: cleanup.results?.find((result) => result.exit_code)?.exit_code ?? 1,
      reason: cleanup.reason ?? "disposable access cleanup did not complete",
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("cleanup")
    };
  }
  if (sandbox.server_trace_validation.status !== "pass") {
    return {
      failing_gate: "server_trace_validation",
      exit_code: sandbox.server_trace_validation.exit_code ?? 1,
      reason: sandbox.server_trace_validation.reason ?? sandbox.server_trace_validation.code,
      artifact_paths: failureArtifacts(outputDir),
      next_diagnostic_command: nextDiagnosticCommandForGate("server_trace_validation")
    };
  }
  return null;
}

async function projectSnapshot(projectDir) {
  const entries = (await readdir(projectDir, { withFileTypes: true })).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
  }));
  const codexConfigPath = join(projectDir, ".codex", "config.toml");
  const codexConfig = (await exists(codexConfigPath))
    ? await readFile(codexConfigPath, "utf8")
    : "";
  const names = entries.map((entry) => entry.name).sort();
  return {
    entries: names,
    codex_config_present: codexConfig !== "",
    recallant_codex_config_entries: (codexConfig.match(/\[mcp_servers\.recallant\]/g) ?? [])
      .length,
    remote_bridge_configured: /remote-bridge/.test(codexConfig),
    uses_credential_ref:
      /RECALLANT_REMOTE_MCP_CREDENTIAL_REF/.test(codexConfig) &&
      /RECALLANT_REMOTE_MCP_CREDENTIAL_STORE/.test(codexConfig),
    raw_credential_in_config: /RECALLANT_REMOTE_MCP_CREDENTIAL\s*=/.test(codexConfig),
    forbidden: {
      recallant_local_storage: names.includes(".recallant"),
      docker_or_postgres_artifacts: names.some((name) => /docker|postgres|pgvector/i.test(name)),
      database_url_hint: /RECALLANT_DATABASE_URL|DATABASE_URL|postgres:\/\//i.test(codexConfig)
    }
  };
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractEvidencePath(text, label) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = String(text ?? "").match(pattern);
  return match?.[1]?.trim() ?? null;
}

async function runExternalSandbox(options, parentEnv, provisioning, outputDir, deps = {}) {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const paths = await createExternalSandboxPaths(outputDir);
  const childEnv = buildSandboxEnv(parentEnv, paths);
  const before = await projectSnapshot(paths.project);
  const secretMaterial = provisioning.secret_material ?? {};
  const commandResults = [];
  try {
    let bootstrapInvocation;
    if (provisioning.disposable.kind === "bootstrap_token") {
      bootstrapInvocation = recallantInvocation(options, "connect-cloud", [
        paths.project,
        "--server-url",
        options.serverUrl,
        "--bootstrap-token",
        secretMaterial.bootstrapToken,
        "--poll-timeout-ms",
        "60000",
        "--poll-interval-ms",
        "1000",
        "--format",
        "json"
      ]);
    } else {
      bootstrapInvocation = recallantInvocation(options, "connect-remote", [
        options.target,
        "--server-url",
        options.serverUrl,
        "--credential",
        secretMaterial.scopedCredential,
        "--project-id",
        options.projectId,
        "--developer-id",
        options.developerId,
        "--client-id",
        options.clientId,
        "--project-dir",
        paths.project,
        "--write",
        "--format",
        "json"
      ]);
    }
    const bootstrap = await runCommand(bootstrapInvocation.command, bootstrapInvocation.args, {
      cwd: paths.project,
      env: childEnv,
      label: "bootstrap"
    });
    commandResults.push(
      commandSummary("bootstrap", bootstrapInvocation, bootstrap, options, secretMaterial, paths)
    );

    const cleanupInvocation = recallantInvocation(options, "remote-acceptance", [
      "cleanup",
      "--project-dir",
      paths.project,
      "--confirm"
    ]);
    const localCleanup = await runCommand(cleanupInvocation.command, cleanupInvocation.args, {
      cwd: paths.project,
      env: childEnv,
      label: "remote_acceptance_cleanup"
    });
    commandResults.push(
      commandSummary(
        "remote_acceptance_cleanup",
        cleanupInvocation,
        localCleanup,
        options,
        secretMaterial,
        paths
      )
    );

    const agentStartInvocation = recallantInvocation(options, "agent-start", ["--format", "json"]);
    const agentStart = await runCommand(agentStartInvocation.command, agentStartInvocation.args, {
      cwd: paths.project,
      env: childEnv,
      label: "agent_start"
    });
    commandResults.push(
      commandSummary("agent_start", agentStartInvocation, agentStart, options, secretMaterial, paths)
    );

    const postAgentStartCleanup = await runCommand(cleanupInvocation.command, cleanupInvocation.args, {
      cwd: paths.project,
      env: childEnv,
      label: "post_agent_start_remote_acceptance_cleanup"
    });
    commandResults.push(
      commandSummary(
        "post_agent_start_remote_acceptance_cleanup",
        cleanupInvocation,
        postAgentStartCleanup,
        options,
        secretMaterial,
        paths
      )
    );

    const acceptanceInvocation = recallantInvocation(options, "remote-acceptance", [
      "--project-dir",
      ".",
      "--semantic-proof",
      "--output-dir",
      paths.evidenceDir
    ]);
    const acceptance = await runCommand(acceptanceInvocation.command, acceptanceInvocation.args, {
      cwd: paths.project,
      env: childEnv,
      label: "remote_acceptance"
    });
    commandResults.push(
      commandSummary(
        "remote_acceptance",
        acceptanceInvocation,
        acceptance,
        options,
        secretMaterial,
        paths
      )
    );

    const after = await projectSnapshot(paths.project);
    const evidenceDirExists = await exists(paths.evidenceDir);
    const agentStartJson = parseJsonOrNull(agentStart.stdout);
    const acceptanceText = `${acceptance.stdout}\n${acceptance.stderr}`;
    const evidenceJsonPath = extractEvidencePath(acceptanceText, "Evidence JSON");
    const evidenceSummaryPath = extractEvidencePath(acceptanceText, "Evidence summary");
    let evidenceValidation = {
      status: "fail",
      reason: "remote-acceptance did not report an evidence JSON path",
      evidence_file: null,
      summary_file: evidenceSummaryPath ? "<temp-external-evidence-summary>" : null,
      command: null
    };
    if (evidenceJsonPath) {
      const validationInvocation = recallantInvocation(options, "remote-acceptance", [
        "validate",
        "--evidence",
        evidenceJsonPath
      ]);
      const validation = await runCommand(
        validationInvocation.command,
        validationInvocation.args,
        {
          cwd: paths.project,
          env: childEnv,
          label: "evidence_validation"
        }
      );
      commandResults.push(
        commandSummary(
          "evidence_validation",
          validationInvocation,
          validation,
          options,
          secretMaterial,
          paths
        )
      );
      const validationJson = parseJsonOrNull(validation.stdout);
      evidenceValidation = {
        status: validation.exitCode === 0 ? "pass" : "fail",
        evidence_file: "<temp-external-evidence-json>",
        summary_file: evidenceSummaryPath ? "<temp-external-evidence-summary>" : null,
        report_status: validationJson?.status ?? null,
        checks: validationJson?.checks ?? [],
        command: "recallant remote-acceptance validate --evidence <redacted>"
      };
    }
    let serverTraceValidation = {
      status: "skipped",
      code: "server_trace_validation_skipped",
      reason: "RECALLANT_LIVE_EXTERNAL_CANARY_VALIDATE_LIVE is not enabled",
      command: null,
      release_pass: false
    };
    if (options.validateLive && evidenceJsonPath) {
      const validateLiveInvocation = recallantInvocation(options, "remote-acceptance", [
        "validate-live",
        "--evidence",
        evidenceJsonPath
      ]);
      const validateLive = await runCommand(
        validateLiveInvocation.command,
        validateLiveInvocation.args,
        {
          cwd: paths.project,
          env: buildControllerValidationEnv(parentEnv, paths),
          label: "server_trace_validation"
        }
      );
      commandResults.push(
        commandSummary(
          "server_trace_validation",
          validateLiveInvocation,
          validateLive,
          options,
          secretMaterial,
          paths
        )
      );
      const validateLiveJson = parseJsonOrNull(validateLive.stdout);
      serverTraceValidation = {
        status: validateLive.exitCode === 0 ? "pass" : "fail",
        code: validateLive.exitCode === 0 ? "server_trace_validation_ok" : "server_trace_validation_failed",
        command: "recallant remote-acceptance validate-live --evidence <redacted>",
        release_pass: validateLive.exitCode === 0,
        checks: validateLiveJson?.checks ?? [],
        evidence_file: validateLiveJson?.evidence_file ?? null
      };
    }
    const semanticMarkerRecall = /Semantic marker recall:\s*true/i.test(acceptanceText);
    const nextSessionRecall = /Next-session recall:\s*true/i.test(acceptanceText);
    const pass =
      bootstrap.exitCode === 0 &&
      localCleanup.exitCode === 0 &&
      agentStart.exitCode === 0 &&
      postAgentStartCleanup.exitCode === 0 &&
      agentStartJson?.mode === "remote_mcp_ready" &&
      acceptance.exitCode === 0 &&
      evidenceValidation.status === "pass" &&
      semanticMarkerRecall &&
      nextSessionRecall &&
      evidenceDirExists &&
      after.remote_bridge_configured &&
      after.uses_credential_ref &&
      !after.raw_credential_in_config &&
      Object.values(after.forbidden).every((value) => value === false);
    return {
      status: pass ? "pass" : "fail",
      paths: {
        home: "<temp-external-home>",
        project: "<temp-external-project>",
        install: "<temp-external-install>",
        tmp: "<temp-external-tmp>",
        evidence_dir: "<temp-external-evidence-dir>"
      },
      env: {
        allowed_keys: Object.keys(childEnv).sort(),
        forbidden_keys_present: Object.keys(childEnv).filter((key) => forbiddenEnvPattern.test(key)),
        privileged_controller_env_present: privilegedControllerEnv.filter((key) =>
          Object.hasOwn(childEnv, key)
        ),
        values_printed: false
      },
      fresh_project_before: before,
      project_after: after,
      agent_start: {
        exit_code: agentStart.exitCode,
        mode: agentStartJson?.mode ?? null,
        json: agentStartJson
          ? {
              ok: agentStartJson.ok,
              mode: agentStartJson.mode,
              recommended_next_call: agentStartJson.recommended_next_call
            }
          : null
      },
      acceptance: {
        exit_code: acceptance.exitCode,
        evidence_dir_exists: evidenceDirExists,
        evidence_json_path: evidenceJsonPath ? "<temp-external-evidence-json>" : null,
        evidence_summary_path: evidenceSummaryPath ? "<temp-external-evidence-summary>" : null,
        semantic_marker_recall: semanticMarkerRecall,
        next_session_recall: nextSessionRecall
      },
      evidence_validation: evidenceValidation,
      server_trace_validation: serverTraceValidation,
      commands: commandResults,
      raw_secret_values_printed: false
    };
  } finally {
    if (!options.keepArtifactsOnFail) {
      await rm(paths.root, { recursive: true, force: true });
    }
  }
}

export async function resultFor(options, env = process.env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const outputDir = await defaultOutputDir(options);
  const childEnv = buildExternalChildEnvContract(env);
  const inputState = controllerInputState(options);
  const invalidUrl =
    (options.live || inputState.any_live_input_provided) && options.serverUrl.trim()
      ? !validHttpsUrl(options.serverUrl.trim())
      : false;
  const invalidControllerUrl =
    (options.live || inputState.any_live_input_provided || options.mode === "cleanup") &&
    options.controllerUrl.trim()
      ? !validControllerUrl(options.controllerUrl.trim())
      : false;
  const invalidControllerMode = !controllerModes.includes(options.controllerMode);
  const invalidCleanupKind =
    options.mode === "cleanup" && options.cleanupKind && !cleanupKinds.includes(options.cleanupKind);

  if (options.mode === "cleanup") {
    if (invalidUrl || invalidControllerUrl || invalidControllerMode || invalidCleanupKind) {
      return {
        status: "blocked_live_external_canary_input",
        mode: "cleanup",
        reason: invalidUrl
          ? "live server URL must be HTTPS and must not include credentials"
          : invalidControllerUrl
            ? "controller URL must be HTTP(S) and must not include credentials"
          : invalidCleanupKind
            ? "cleanup kind must be bootstrap_token or scoped_credential"
            : "controller mode must be bootstrap_token or scoped_credential",
        external_child: {
          env: childEnv,
          action: "no child process for controller cleanup"
        },
        controller: baseController(options, inputState),
        proofs: baseProofs(),
        redaction: {
          status: "pass",
          forbidden_output_classes: forbiddenOutputClasses,
          raw_credentials_printed: false
        },
        failure: blockedFailure(
          invalidUrl
            ? "live server URL must be HTTPS and must not include credentials"
            : invalidControllerUrl
              ? "controller URL must be HTTP(S) and must not include credentials"
            : invalidCleanupKind
              ? "cleanup kind must be bootstrap_token or scoped_credential"
              : "controller mode must be bootstrap_token or scoped_credential",
          outputDir
        ),
        cleanup: { planned: true, status: "blocked", output_dir: "<canary-output-dir>" },
        artifacts: redactedArtifacts(outputDir, options)
      };
    }
    if (options.live || inputState.any_live_input_provided) {
      if (inputState.missing_required.length > 0) {
        return {
          status: "blocked_live_external_canary_input",
          mode: "cleanup",
          reason: `missing required live input: ${inputState.missing_required.join(", ")}`,
          external_child: {
            env: childEnv,
            action: "no child process for controller cleanup"
          },
          controller: baseController(options, inputState),
          proofs: baseProofs(),
          redaction: {
            status: "pass",
            forbidden_output_classes: forbiddenOutputClasses,
            raw_credentials_printed: false
          },
          failure: blockedFailure(
            `missing required live input: ${inputState.missing_required.join(", ")}`,
            outputDir
          ),
          cleanup: { planned: true, status: "blocked", output_dir: "<canary-output-dir>" },
          artifacts: redactedArtifacts(outputDir, options)
        };
      }
      const cleanupResult = await revokeDisposableAccess(options, fetchImpl);
      return {
        status: "cleanup_complete",
        mode: "cleanup",
        external_child: {
          env: childEnv,
          action: "no child process for controller cleanup"
        },
        controller: {
          ...baseController(options, inputState),
          cleanup_handles: [cleanupResult]
        },
        proofs: baseProofs(),
        redaction: {
          status: "pass",
          forbidden_output_classes: forbiddenOutputClasses,
          raw_credentials_printed: false
        },
        cleanup: {
          planned: true,
          status: "revoked",
          output_dir: "<canary-output-dir>",
          result: cleanupResult
        },
        artifacts: redactedArtifacts(outputDir, options)
      };
    }
    return {
      status: "cleanup_planned",
      mode: "cleanup",
      external_child: {
        env: childEnv,
        action: "remove canary temp artifacts and revoke disposable live access when configured"
      },
      controller: baseController(options, inputState),
      proofs: baseProofs(),
      redaction: {
        status: "pass",
        forbidden_output_classes: forbiddenOutputClasses,
        raw_credentials_printed: false
      },
      cleanup: { planned: true, output_dir: "<canary-output-dir>", handles: [] },
      artifacts: redactedArtifacts(outputDir, options)
    };
  }

  if (invalidUrl || invalidControllerUrl || invalidControllerMode) {
    return {
      status: "blocked_live_external_canary_input",
      mode: "live",
      reason: invalidUrl
        ? "live server URL must be HTTPS and must not include credentials"
        : invalidControllerUrl
          ? "controller URL must be HTTP(S) and must not include credentials"
        : "controller mode must be bootstrap_token or scoped_credential",
      external_child: { env: childEnv, target: options.target },
      controller: baseController(options, inputState),
      proofs: baseProofs(),
      redaction: {
        status: "pass",
        forbidden_output_classes: forbiddenOutputClasses,
        raw_credentials_printed: false
      },
      failure: blockedFailure(
        invalidUrl
          ? "live server URL must be HTTPS and must not include credentials"
          : invalidControllerUrl
            ? "controller URL must be HTTP(S) and must not include credentials"
          : "controller mode must be bootstrap_token or scoped_credential",
        outputDir
      ),
      cleanup: { planned: true, status: "not_started" },
      artifacts: redactedArtifacts(outputDir, options)
    };
  }

  if (options.dryRun) {
    const controller = baseController(options, inputState);
    controller.cleanup_handles = [
      {
        kind: options.controllerMode,
        id: "<created-live-id>",
        prefix: "<created-prefix>",
        action: "revoke",
        status: "planned_after_create",
        raw_secret_value_printed: false
      }
    ];
    return {
      status: "dry_run",
      mode: options.live ? "live" : "dry_run",
      required_for_live_pass: inputState.required_env,
      optional_env: inputState.optional_env,
      external_child: {
        env: childEnv,
        target: options.target,
        fake_home: "planned",
        fake_project: "planned",
        install_path: "planned",
        public_connect_bootstrap: "planned",
        privileged_controller_env_provided: false
      },
      controller,
      proofs: baseProofs(),
      redaction: {
        status: "pass",
        forbidden_output_classes: forbiddenOutputClasses,
        raw_credentials_printed: false,
        env_values_printed: false
      },
      cleanup: { planned: true, status: "not_started" },
      artifacts: redactedArtifacts(outputDir, options)
    };
  }

  if (!options.live && !inputState.any_live_input_provided) {
    return {
      status: "skipped_live_external_canary",
      mode: "no_live_inputs",
      reason: "RECALLANT_LIVE_EXTERNAL_CANARY_SERVER_URL not set",
      deterministic_fixture: false,
      required_for_live_pass: inputState.required_env,
      optional_env: inputState.optional_env,
      external_child: { env: childEnv, target: options.target },
      controller: baseController(options, inputState),
      proofs: baseProofs(),
      redaction: {
        status: "pass",
        forbidden_output_classes: forbiddenOutputClasses,
        raw_credentials_printed: false
      },
      cleanup: { planned: true, status: "not_started" },
      artifacts: redactedArtifacts(outputDir, options)
    };
  }

  if (inputState.missing_required.length > 0) {
    return {
      status: "blocked_live_external_canary_input",
      mode: "live",
      reason: `missing required live input: ${inputState.missing_required.join(", ")}`,
      required_for_live_pass: inputState.required_env,
      external_child: { env: childEnv, target: options.target },
      controller: baseController(options, inputState),
      proofs: baseProofs(),
      redaction: {
        status: "pass",
        forbidden_output_classes: forbiddenOutputClasses,
        raw_credentials_printed: false
      },
      failure: blockedFailure(
        `missing required live input: ${inputState.missing_required.join(", ")}`,
        outputDir
      ),
      cleanup: { planned: true, status: "not_started" },
      artifacts: redactedArtifacts(outputDir, options)
    };
  }

  const provisioning = await createDisposableAccess(options, fetchImpl);
  let sandbox;
  let cleanup = null;
  try {
    sandbox = await runExternalSandbox(options, env, provisioning, outputDir, deps);
  } finally {
    cleanup = await cleanupDisposableHandles(options, fetchImpl, provisioning.cleanup_handles);
  }
  const controller = {
    ...baseController(options, inputState),
    disposable_access: provisioning.disposable,
    cleanup_handles: provisioning.cleanup_handles
  };
  const cleanupPass = cleanup?.release_pass === true;
  const releasePass =
    sandbox.status === "pass" && sandbox.server_trace_validation.status === "pass" && cleanupPass;
  const failure = releaseFailure(sandbox, cleanup, outputDir);
  return {
    status:
      sandbox.status !== "pass"
        ? "fail_live_external_canary"
        : !cleanupPass
          ? "fail_live_external_canary_cleanup"
          : releasePass
            ? "pass_live_external_canary"
            : "pass_live_external_canary_server_trace_validation_skipped",
    mode: "live_external_sandbox",
    reason:
      releasePass
        ? "controller provisioning, external sandbox acceptance, server trace validation, and cleanup completed"
        : sandbox.status !== "pass"
          ? "external sandbox acceptance failed"
          : !cleanupPass
            ? "disposable access cleanup failed; not a release pass"
            : "external sandbox passed but server trace validation is skipped; not a release pass",
    external_child: {
      env: childEnv,
      target: options.target,
      receives_privileged_controller_env: false,
      connection_material: provisioning.disposable
        ? {
            kind: provisioning.disposable.kind,
            prefix: provisioning.disposable.prefix,
            value_printed: false
          }
        : null
    },
    controller,
    sandbox,
    proofs: {
      ...baseProofs(),
      agent_start: {
        status: sandbox.agent_start.mode === "remote_mcp_ready" ? "pass" : "fail",
        expected: 'mode: "remote_mcp_ready"'
      },
      remote_acceptance: {
        status: sandbox.acceptance.exit_code === 0 ? "pass" : "fail",
        command: "recallant remote-acceptance --semantic-proof"
      },
      semantic_marker_recall: {
        status: sandbox.acceptance.semantic_marker_recall ? "pass" : "fail"
      },
      next_session_recall: {
        status: sandbox.acceptance.next_session_recall ? "pass" : "fail"
      },
      evidence_validation: {
        status: sandbox.evidence_validation.status
      },
      server_trace_validation: {
        status: sandbox.server_trace_validation.status,
        code: sandbox.server_trace_validation.code
      },
      no_local_storage: {
        status: Object.values(sandbox.project_after.forbidden).every((value) => value === false)
          ? "pass"
          : "fail"
      }
    },
    release_gate: {
      status: releasePass ? "pass" : "not_release_pass",
      reason: releasePass
        ? "server trace validation and cleanup passed"
        : failure?.reason ?? sandbox.server_trace_validation.reason ?? sandbox.server_trace_validation.code
    },
    failure,
    redaction: {
      status: "pass",
      forbidden_output_classes: forbiddenOutputClasses,
      raw_credentials_printed: false
    },
    cleanup: {
      planned: true,
      status: cleanup?.status ?? "failed",
      handles: provisioning.cleanup_handles,
      results: cleanup?.results ?? []
    },
    artifacts: redactedArtifacts(outputDir, options)
  };
}

export function humanReport(result) {
  return [
    "Recallant remote live external canary",
    "",
    `Status: ${result.status}`,
    `Mode: ${result.mode}`,
    result.reason ? `Reason: ${result.reason}` : null,
    `External child env keys: ${result.external_child.env.allowed_keys.join(", ")}`,
    `Forbidden child env keys: ${result.external_child.env.forbidden_keys_present.length}`,
    `Redaction: ${result.redaction.status}`,
    `Output dir: ${result.artifacts.output_dir}`,
    "",
    "Proofs:",
    `- agent-start: ${result.proofs.agent_start.status}`,
    `- remote-acceptance: ${result.proofs.remote_acceptance.status}`,
    `- semantic marker recall: ${result.proofs.semantic_marker_recall.status}`,
    `- next-session recall: ${result.proofs.next_session_recall.status}`,
    `- evidence validation: ${result.proofs.evidence_validation.status}`,
    `- server trace validation: ${result.proofs.server_trace_validation.status}`,
    `- no local storage: ${result.proofs.no_local_storage.status}`,
    `- cleanup: ${result.cleanup.status}`,
    "",
    result.failure ? "Failure:" : null,
    result.failure ? `- gate: ${result.failure.failing_gate}` : null,
    result.failure ? `- exit code: ${result.failure.exit_code}` : null,
    result.failure ? `- artifacts: ${JSON.stringify(result.failure.artifact_paths)}` : null,
    result.failure ? `- next diagnostic: ${result.failure.next_diagnostic_command}` : null,
    ""
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function runCli(
  argv = process.argv.slice(2),
  env = process.env,
  write = process.stdout.write.bind(process.stdout),
  writeError = process.stderr.write.bind(process.stderr)
) {
  try {
    const options = parseArgs(argv, env);
    if (options.help) {
      write(usageText());
      return 0;
    }
    const result = await resultFor(options, env);
    write(options.json ? `${JSON.stringify(result, null, 2)}\n` : humanReport(result));
    return result.status === "blocked_live_external_canary_input" ||
      String(result.status).startsWith("fail_")
      ? 1
      : 0;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  process.exitCode = await runCli();
}
