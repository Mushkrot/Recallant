import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { URL } from "node:url";
import { promisify } from "node:util";
import { remoteMcpBridgeEndpointUrl } from "../packages/contracts/dist/remote-mcp.js";

const execFileAsync = promisify(execFile);

const primaryEnv = {
  serverUrl: "RECALLANT_LIVE_REMOTE_MCP_SERVER_URL",
  credential: "RECALLANT_LIVE_REMOTE_MCP_CREDENTIAL",
  projectId: "RECALLANT_LIVE_REMOTE_MCP_PROJECT_ID",
  developerId: "RECALLANT_LIVE_REMOTE_MCP_DEVELOPER_ID",
  clientId: "RECALLANT_LIVE_REMOTE_MCP_CLIENT_ID",
  sessionId: "RECALLANT_LIVE_REMOTE_MCP_SESSION_ID",
  traceId: "RECALLANT_LIVE_REMOTE_MCP_TRACE_ID",
  captureProof: "RECALLANT_LIVE_REMOTE_MCP_CAPTURE_PROOF"
};

const legacyEnv = {
  serverUrl: "RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL",
  credential: "RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL",
  projectId: "RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID",
  developerId: "RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID",
  clientId: "RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID",
  sessionId: "RECALLANT_EXTERNAL_REHEARSAL_SESSION_ID",
  traceId: "RECALLANT_EXTERNAL_REHEARSAL_TRACE_ID",
  captureProof: "RECALLANT_EXTERNAL_REHEARSAL_CAPTURE_PROOF"
};

const requiredKeys = ["serverUrl", "credential", "projectId", "developerId", "clientId"];
const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"|postgres:\/\/[^"<\s]+|"workbench_auth"|"admin_auth"|"provider_secret"|"provider_key"|"raw_artifacts_path"|"backup_path"|\/ai\//;

function valueFor(key) {
  return process.env[primaryEnv[key]]?.trim() || process.env[legacyEnv[key]]?.trim() || "";
}

function envNameFor(key) {
  return primaryEnv[key];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stageCode(report, id) {
  const stage = report.stages.find((entry) => entry.id === id);
  assert(stage, `remote doctor report missing stage ${id}`);
  return `${stage.status}:${stage.code}`;
}

function redactedExternalEnv(extra = {}) {
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
      throw new Error(`forbidden live remote client env key: ${key}`);
    }
  }
  return env;
}

function doctorArgs(input) {
  const args = [
    "apps/cli/dist/index.js",
    "remote-doctor",
    "--server-url",
    input.serverUrl,
    "--credential",
    input.credential,
    "--project-id",
    input.projectId,
    "--developer-id",
    input.developerId,
    "--client-id",
    input.clientId,
    "--timeout-ms",
    "5000",
    "--format",
    "json",
    ...(input.captureProof ? ["--capture-proof"] : [])
  ];
  if (input.sessionId) args.push("--session-id", input.sessionId);
  if (input.traceId) args.push("--trace-id", input.traceId);
  return args;
}

function bridgeArgs(input) {
  const args = [
    "apps/cli/dist/index.js",
    "remote-bridge",
    "--server-url",
    input.serverUrl,
    "--credential",
    input.credential,
    "--project-id",
    input.projectId,
    "--developer-id",
    input.developerId,
    "--client-id",
    input.clientId
  ];
  if (input.sessionId) args.push("--session-id", input.sessionId);
  if (input.traceId) args.push("--trace-id", input.traceId);
  return args;
}

async function runCli(args, env, expectExit = 0) {
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024
    });
    assert(expectExit === 0, `expected command to fail: ${args.join(" ")}`);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const exitCode = Number(error.code ?? 1);
    assert(exitCode === expectExit, `expected exit ${expectExit}, got ${exitCode}`);
    return { stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), exitCode };
  }
}

async function runBridgeRoundtrip(input, env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: bridgeArgs(input),
    cwd: process.cwd(),
    env,
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "recallant-live-readiness-smoke", version: "0.0.0" });
  try {
    await client.connect(transport, { timeout: 8_000 });
    const list = await client.listTools({}, { timeout: 8_000 });
    const toolNames = list.tools.map((tool) => tool.name).sort();
    assert(toolNames.length > 0, "live remote bridge tools/list returned no tools");
    await client.close();
    await transport.close();
    return { toolNames, stderr };
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function outputAndExit(output, exitCode = 0, secrets = []) {
  const text = JSON.stringify(output, null, 2);
  assert(!forbiddenOutputPattern.test(text), "live readiness output leaked forbidden surface");
  for (const secret of secrets.filter(Boolean)) {
    assert(!text.includes(secret), "live readiness output leaked raw credential");
  }
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}

const provided = requiredKeys.filter((key) => valueFor(key));
if (provided.length === 0) {
  outputAndExit({
    remote_mcp_live_readiness_smoke: {
      status: "skipped_live_remote_mcp_readiness",
      reason: "operator_live_remote_mcp_env_not_provided",
      coverage_model: "operator_live_central_server",
      deterministic_fixture: false,
      required_env: requiredKeys.map(envNameFor),
      optional_env: [primaryEnv.sessionId, primaryEnv.traceId, primaryEnv.captureProof],
      legacy_env_aliases_supported: requiredKeys.map((key) => legacyEnv[key])
    }
  });
} else {
  const missing = requiredKeys.filter((key) => !valueFor(key));
  if (missing.length > 0) {
    outputAndExit(
      {
        remote_mcp_live_readiness_smoke: {
          status: "failed_live_remote_mcp_readiness_input",
          reason: "operator_live_remote_mcp_env_incomplete",
          coverage_model: "operator_live_central_server",
          deterministic_fixture: false,
          provided_env_count: provided.length,
          missing_env: missing.map(envNameFor),
          required_env: requiredKeys.map(envNameFor)
        }
      },
      1
    );
  }
}

const input = {
  serverUrl: valueFor("serverUrl"),
  credential: valueFor("credential"),
  projectId: valueFor("projectId"),
  developerId: valueFor("developerId"),
  clientId: valueFor("clientId"),
  sessionId: valueFor("sessionId"),
  traceId: valueFor("traceId") || `recallant-live-readiness-${Date.now()}`,
  captureProof: valueFor("captureProof") === "1"
};

let endpointUrl;
try {
  endpointUrl = remoteMcpBridgeEndpointUrl(input.serverUrl);
  assert(new URL(input.serverUrl).protocol === "https:", "live readiness requires HTTPS server URL");
} catch (error) {
  outputAndExit(
    {
      remote_mcp_live_readiness_smoke: {
        status: "failed_live_remote_mcp_readiness_input",
        reason: "invalid_or_non_https_server_url",
        coverage_model: "operator_live_central_server",
        deterministic_fixture: false,
        error: error instanceof Error ? error.message : String(error)
      }
    },
    1,
    [input.credential]
  );
}

const childEnv = redactedExternalEnv();
const doctor = await runCli(doctorArgs(input), childEnv, 0);
assert(!doctor.stdout.includes(input.credential), "remote doctor leaked live credential");
assert(!doctor.stderr.includes(input.credential), "remote doctor stderr leaked live credential");
const doctorReport = JSON.parse(doctor.stdout);
assert(stageCode(doctorReport, "mcp_initialize") === "pass:initialize_ok", "live initialize did not pass");
assert(stageCode(doctorReport, "tools_list") === "pass:tools_list_ok", "live tools/list did not pass");
if (input.captureProof) {
  assert(
    stageCode(doctorReport, "capture_recall_proof") === "pass:capture_recall_proof_ok",
    "live capture proof did not pass"
  );
}

const bridge = await runBridgeRoundtrip(input, childEnv);
assert(!bridge.stderr.includes(input.credential), "remote bridge leaked live credential");

outputAndExit(
  {
    remote_mcp_live_readiness_smoke: {
      status: "pass_live_remote_mcp_readiness",
      coverage_model: "operator_live_central_server",
      deterministic_fixture: false,
      endpoint: {
        scheme: "https",
        path: new URL(endpointUrl).pathname,
        derived_by_contract_helper: true
      },
      validated: [
        "https_server_url",
        "remote_doctor_initialize",
        "remote_doctor_tools_list",
        "remote_bridge_initialize",
        "remote_bridge_tools_list",
        ...(input.captureProof ? ["remote_doctor_capture_proof"] : [])
      ],
      doctor: {
        initialize: stageCode(doctorReport, "mcp_initialize"),
        tools_list: stageCode(doctorReport, "tools_list"),
        capture_recall_proof: input.captureProof
          ? stageCode(doctorReport, "capture_recall_proof")
          : "skipped:not_requested"
      },
      bridge: {
        tools_list_count: bridge.toolNames.length,
        required_memory_tool_seen: bridge.toolNames.includes("memory_get_context_pack")
      },
      isolated_client_environment: {
        no_database_url_env: true,
        no_postgres_env: true,
        no_workbench_or_admin_auth: true,
        no_provider_raw_backup_env: true
      },
      leakage: {
        credential_redacted: true,
        no_database_url_in_output: true,
        no_private_path_in_output: true,
        no_provider_or_raw_artifact_surface_in_output: true
      }
    }
  },
  0,
  [input.credential]
);
