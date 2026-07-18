import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertIncludesAll(actual, expected, label) {
  for (const value of expected) {
    assert(actual.includes(value), `${label} missing ${value}; got ${actual.join(", ")}`);
  }
}

function agentReadyPlannedPaths(output) {
  return output.agent_ready_files?.plan?.planned_files?.map((file) => file.path) ?? [];
}

function agentReadyGeneratedPaths(output) {
  return output.agent_ready_files?.outcome?.generated_files ?? [];
}

function agentReadyUpdatedPaths(output) {
  return output.agent_ready_files?.outcome?.updated_files ?? [];
}

function agentReadySkippedPaths(output) {
  return (
    output.agent_ready_files?.outcome?.skipped_files?.map((file) => file.path) ??
    output.agent_ready_files?.plan?.skipped_files?.map((file) => file.path) ??
    []
  );
}

function agentReadyConflictPaths(output) {
  return output.agent_ready_files?.outcome?.conflict_files?.map((file) => file.path) ?? [];
}

function proofPassedOrWarned(proof) {
  return proof?.status === "passed" || proof?.status === "warning";
}

function assertRemoteStartupContract(output, label) {
  const contract = output.startup_contract;
  const mcpCalls = contract?.direct_mcp_sequence?.map((entry) => entry.call).join(" ") ?? "";
  const cliFallback = contract?.cli_fallback_sequence?.join(" ") ?? "";
  assert(
    contract?.primary_path === "configured_remote_mcp" &&
      mcpCalls.includes("memory_start_session") &&
      mcpCalls.includes("memory_get_context_pack") &&
      mcpCalls.includes("memory_closeout") &&
      String(contract?.advanced_pause_checkpoint ?? "").includes("not semantic memory proof") &&
      String(contract?.project_log_role ?? "").includes("compact current-state fallback") &&
      cliFallback.includes("recallant agent-start --format json") &&
      cliFallback.includes("recallant agent-event") &&
      cliFallback.includes("recallant agent-closeout") &&
      !cliFallback.includes("agent-checkpoint"),
    `${label} missing remote startup contract: ${JSON.stringify(contract)}`
  );
}

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1;
}

const CHECKPOINT_ONLY_AT = "2026-06-27T00:00:00.000Z";
const CONTEXT_READ_AT = "2026-06-27T00:30:00.000Z";
const MEMORY_WRITE_AT = "2026-06-27T01:01:00.000Z";
const SEMANTIC_PROOF_AT = "2026-06-27T01:02:03.000Z";

function stageCode(report, id) {
  const stage = report.stages?.find((entry) => entry.id === id);
  return stage ? `${stage.status}:${stage.code}` : "missing";
}

function readinessContract(state = {}) {
  const semanticProofAt = state.semanticProofAt ?? null;
  const lastContextReadAt = state.lastContextReadAt ?? null;
  const lastMemoryWriteAt = state.lastMemoryWriteAt ?? null;
  const lastCheckpointAt = state.lastCheckpointAt ?? CHECKPOINT_ONLY_AT;
  const memoryLoopReady = Boolean(lastContextReadAt && lastMemoryWriteAt && lastCheckpointAt);
  return {
    version: 2,
    invariant:
      "Configuration proves access. Recall proves memory. Memory-loop-ready proves the governed workflow. Capture-active proves fresh automatic agent telemetry.",
    primary_state: memoryLoopReady
      ? "memory_loop_ready"
      : semanticProofAt
        ? "semantic_memory_ready"
      : lastContextReadAt
        ? "context_ready"
        : "configured",
    configured: true,
    context_ready: Boolean(lastContextReadAt),
    semantic_memory_ready: Boolean(semanticProofAt),
    memory_loop_ready: memoryLoopReady,
    capture_active: false,
    capture_fresh: false,
    capture_freshness_hours: 24,
    ingestion_approved: false,
    remote_mcp_ready: true,
    evidence: {
      last_context_read_at: lastContextReadAt,
      last_memory_write_at: lastMemoryWriteAt,
      last_checkpoint_at: lastCheckpointAt,
      last_semantic_recall_proof_at: semanticProofAt,
      last_automatic_capture_at: null,
      automatic_capture_source: null,
      ingestion_approval_ref: null
    },
    notes: {
      remote_mcp_ready:
        "remote_mcp_ready means scoped remote MCP access is configured; it is not semantic memory proof.",
      ingestion_approved:
        "ingestion_approved is separate owner approval for import or bulk summarization; agent-authored work memory does not imply ingestion approval."
    }
  };
}

function readinessStatus(state = {}) {
  const contract = readinessContract(state);
  return {
    ok: true,
    project_id: "11111111-1111-4111-8111-111111111111",
    configured: contract.configured,
    context_ready: contract.context_ready,
    semantic_memory_ready: contract.semantic_memory_ready,
    capture_active: contract.capture_active,
    ingestion_approved: contract.ingestion_approved,
    remote_mcp_ready: contract.remote_mcp_ready,
    readiness_status: contract.primary_state,
    evidence: contract.evidence,
    readiness_contract: contract,
    last_context_read_at: contract.evidence.last_context_read_at,
    last_memory_write_at: contract.evidence.last_memory_write_at,
    checkpoint_updated_at: contract.evidence.last_checkpoint_at,
    last_semantic_recall_proof_at: contract.evidence.last_semantic_recall_proof_at,
    review_state_counts: {
      pending_review: 0,
      accepted: contract.semantic_memory_ready ? 1 : 0,
      rejected: 0,
      stale: 0,
      conflict: 0
    }
  };
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function connectServer(mode) {
  let pollCount = 0;
  const startBodies = [];
  const serverState = {
    startBodies,
    semanticProofAt: null,
    lastContextReadAt: null,
    lastMemoryWriteAt: null,
    lastCheckpointAt: CHECKPOINT_ONLY_AT,
    checkpointPayload: {
      current_status: "checkpoint-only proof exists before semantic governed memory proof",
      current_focus: "checkpoint-only-proof",
      next_step: "Run governed semantic marker create/recall before semantic_memory_ready.",
      open_questions: []
    },
    agentMemories: []
  };
  const listener = listen(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/mcp") {
      const body = await readJson(request);
      if (body.method === "initialize") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              serverInfo: { name: "recallant-connect-cli-smoke", version: "0.0.0" }
            }
          })
        );
        return;
      }
      if (body.method === "tools/list") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "memory_start_session" },
                { name: "memory_get_context_pack" },
                { name: "memory_set_checkpoint" },
                { name: "memory_get_checkpoint" },
                { name: "memory_create_agent_memory" },
                { name: "memory_recall_agent_memories" },
                { name: "memory_get_readiness_status" },
                { name: "memory_heartbeat" }
              ]
            }
          })
        );
        return;
      }
      if (body.method === "tools/call") {
        const toolName = body.params?.name;
        const args = body.params?.arguments ?? {};
        let structuredContent;
        if (toolName === "memory_get_readiness_status") {
          structuredContent = readinessStatus(serverState);
        } else if (toolName === "memory_start_session") {
          structuredContent = {
            ok: true,
            session_id: "00000000-0000-4000-8000-000000000001"
          };
        } else if (toolName === "memory_get_context_pack") {
          serverState.lastContextReadAt = CONTEXT_READ_AT;
          structuredContent = {
            ok: true,
            context_pack_id: "connect-cli-context-pack",
            session_id: args.session_id ?? "00000000-0000-4000-8000-000000000001"
          };
        } else if (toolName === "memory_set_checkpoint") {
          serverState.checkpointPayload = args.payload ?? null;
          serverState.lastCheckpointAt = CHECKPOINT_ONLY_AT;
          structuredContent = { ok: true, updated_at: serverState.lastCheckpointAt };
        } else if (toolName === "memory_get_checkpoint") {
          structuredContent = {
            payload: serverState.checkpointPayload,
            updated_at: serverState.lastCheckpointAt
          };
        } else if (toolName === "memory_create_agent_memory") {
          const memory = {
            memory_id: `connect-cli-memory-${serverState.agentMemories.length + 1}`,
            memory_type: args.memory_type,
            title: args.title,
            body: args.body,
            metadata: args.metadata ?? {},
            status: "accepted",
            use_policy: "recall_allowed"
          };
          serverState.agentMemories.push(memory);
          serverState.lastMemoryWriteAt = MEMORY_WRITE_AT;
          if (memory.metadata?.diagnostic_marker === true) {
            serverState.semanticProofAt = SEMANTIC_PROOF_AT;
          }
          structuredContent = {
            memory_id: memory.memory_id,
            status: memory.status,
            use_policy: memory.use_policy
          };
        } else if (toolName === "memory_recall_agent_memories") {
          structuredContent = {
            trace_id: "connect-cli-recall-trace",
            memories: serverState.agentMemories.filter((memory) =>
              String(memory.body).includes(String(args.query ?? ""))
            ),
            truncated: false
          };
        } else {
          structuredContent = { ok: true };
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(structuredContent) }],
              structuredContent
            }
          })
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: `unsupported method ${body.method}` }
        })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/connect/start") {
      startBodies.push(await readJson(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          request_id: `${mode}-request`,
          device_code: `rcl_conn_${mode}_device`,
          poll_token: `rcl_poll_${mode}_token`,
          approve_url: `http://127.0.0.1/approve/${mode}`,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          interval_seconds: 1,
          approval_mode:
            mode === "trusted-approved"
              ? "trusted_device"
              : mode === "bootstrap-approved"
                ? "bootstrap_token"
                : "human_approval",
          bootstrap_token:
            mode === "bootstrap-approved"
              ? {
                  status: "approved",
                  approval_mode: "bootstrap_token",
                  browser_approval_required: false,
                  token_prefix: "bootprefix"
                }
              : null,
          trusted_device:
            mode === "bootstrap-approved"
              ? null
              : mode === "trusted-approved"
                ? {
                    status: "approved",
                    approval_mode: "trusted_device",
                    browser_approval_required: false,
                    device_key_prefix: startBodies.at(-1)?.trusted_device?.device_key_prefix,
                    public_key_fingerprint:
                      startBodies.at(-1)?.trusted_device?.public_key_fingerprint
                  }
                : {
                    status: "fallback",
                    reason: "invalid_device",
                    browser_approval_required: true,
                    device_key_prefix: startBodies.at(-1)?.trusted_device?.device_key_prefix,
                    public_key_fingerprint:
                      startBodies.at(-1)?.trusted_device?.public_key_fingerprint
                  }
        })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/connect/poll") {
      await readJson(request);
      const requestOrigin = `http://${request.headers.host}`;
      pollCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      if (mode === "pending" || (mode === "approved-after-pending" && pollCount === 1)) {
        response.end(
          JSON.stringify({ ok: true, status: "pending", request_id: `${mode}-request` })
        );
        return;
      }
      if (mode === "denied" || mode === "expired") {
        response.end(JSON.stringify({ ok: true, status: mode, request_id: `${mode}-request` }));
        return;
      }
      response.end(
        JSON.stringify({
          ok: true,
          status: "approved",
          approval_mode:
            mode === "trusted-approved"
              ? "trusted_device"
              : mode === "bootstrap-approved"
                ? "bootstrap_token"
                : "human_approval",
          request_id: `${mode}-request`,
          one_time_secret: "rcl_mcp_connect_secret",
          bootstrap: {
            server_url: requestOrigin,
            credential: "rcl_mcp_connect_secret",
            project_id: "11111111-1111-4111-8111-111111111111",
            developer_id: "22222222-2222-4222-8222-222222222222",
            client_id: "remote-cli-smoke",
            target: "codex"
          }
        })
      );
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  return listener.then((value) => ({ ...value, state: serverState }));
}

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

const cliSource = await readFile(new URL("../apps/cli/src/index.ts", import.meta.url), "utf8");
assert(cliSource.includes("Universal remote beginner flow"), "help missing beginner flow copy");
assert(
  cliSource.includes("registers a local trusted device key"),
  "help missing trusted device copy"
);
assert(cliSource.includes("invite"), "help did not distinguish invite fallback");

const tempProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-"));
const secondProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-second-"));
const dryRunProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-dry-run-"));
const skipAgentFilesProject = await mkdtemp(
  join(tmpdir(), "recallant-connect-cloud-skip-agent-files-")
);
const existingDocsProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-existing-"));
const conflictDocsProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-conflict-"));
const nonAsciiProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-проект-"));
const staleConfigProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-stale-config-"));
const contextProofProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-context-"));
const semanticProofProject = await mkdtemp(join(tmpdir(), "recallant-connect-cloud-semantic-"));
const tempHome = await mkdtemp(join(tmpdir(), "recallant-connect-home-"));
const dryRunHome = await mkdtemp(join(tmpdir(), "recallant-connect-dry-run-home-"));
const existingDocsHome = await mkdtemp(join(tmpdir(), "recallant-connect-existing-home-"));
const safetyHome = await mkdtemp(join(tmpdir(), "recallant-connect-safety-home-"));
const proofHome = await mkdtemp(join(tmpdir(), "recallant-connect-proof-home-"));
const approvedServer = await connectServer("approved-after-pending");
const trustedServer = await connectServer("trusted-approved");
const reconnectServer = await connectServer("trusted-approved");
const dryRunServer = await connectServer("approved-after-pending");
const skipAgentFilesServer = await connectServer("approved-after-pending");
const existingDocsServer = await connectServer("approved-after-pending");
const conflictDocsServer = await connectServer("approved-after-pending");
const nonAsciiServer = await connectServer("approved-after-pending");
const staleConfigServer = await connectServer("approved-after-pending");
const contextProofServer = await connectServer("approved-after-pending");
const semanticProofServer = await connectServer("approved-after-pending");
const bootstrapServer = await connectServer("bootstrap-approved");
const universalServer = await connectServer("universal-approved");
const schemelessServer = await connectServer("schemeless-approved");
const universalProject = await mkdtemp(join(tmpdir(), "recallant-connect-universal-"));
const schemelessProject = await mkdtemp(join(tmpdir(), "recallant-connect-schemeless-"));
const universalHome = await mkdtemp(join(tmpdir(), "recallant-connect-universal-home-"));
try {
  const universal = await runCli(
    [
      "connect",
      universalProject,
      "--server-url",
      universalServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: universalHome }
    }
  );
  assert(universal.status === 0, `universal connect failed: ${universal.stderr}`);
  const universalJson = JSON.parse(universal.stdout);
  assert(universalJson.action === "connect_cloud", "universal connect did not route to remote");
  assert(universalJson.status === "connected", "universal connect did not finish remote connect");
  assert(
    universalServer.state.startBodies.length === 1,
    "universal connect did not start remote request once"
  );
  const universalConfig = await readFile(join(universalProject, ".codex", "config.toml"), "utf8");
  assert(
    universalConfig.includes("remote-bridge") &&
      universalConfig.includes("RECALLANT_REMOTE_MCP_CREDENTIAL_REF"),
    "universal connect did not write remote bridge config"
  );
  const schemelessUrl = schemelessServer.baseUrl.replace(/^http:\/\//, "");
  const schemeless = await runCli(
    [
      "connect-cloud",
      schemelessProject,
      "--server-url",
      schemelessUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: universalHome }
    }
  );
  assert(schemeless.status === 0, `schemeless connect-cloud failed: ${schemeless.stderr}`);
  const schemelessJson = JSON.parse(schemeless.stdout);
  assert(
    schemelessServer.state.startBodies.length === 1 &&
      schemelessJson.approve_url === "http://127.0.0.1/approve/schemeless-approved",
    `schemeless localhost URL did not reach the intended server: ${schemeless.stdout}`
  );

  const dryRun = await runCli(
    [
      "connect-cloud",
      dryRunProject,
      "--server-url",
      dryRunServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--dry-run",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: dryRunHome }
    }
  );
  assert(dryRun.status === 0, `dry-run connect-cloud failed: ${dryRun.stderr}`);
  const dryRunJson = JSON.parse(dryRun.stdout);
  assert(dryRunJson.status === "dry_run", "dry-run did not report dry_run status");
  assert(dryRunJson.writes_files === false, "dry-run reported file writes");
  assertIncludesAll(
    agentReadyPlannedPaths(dryRunJson),
    ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
    "dry-run planned agent-ready files"
  );
  assert(
    dryRunJson.agent_ready_files?.outcome === null,
    "dry-run should not report an applied starter-doc outcome"
  );
  for (const path of ["README.md", "AGENTS.md", "PROJECT_LOG.md"]) {
    assert(!(await exists(join(dryRunProject, path))), `dry-run unexpectedly wrote ${path}`);
  }

  const skipAgentFiles = await runCli(
    [
      "connect-cloud",
      skipAgentFilesProject,
      "--server-url",
      skipAgentFilesServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--dry-run",
      "--skip-agent-files",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: dryRunHome }
    }
  );
  assert(skipAgentFiles.status === 0, `skip-agent-files dry-run failed: ${skipAgentFiles.stderr}`);
  const skipAgentFilesJson = JSON.parse(skipAgentFiles.stdout);
  assert(
    skipAgentFilesJson.agent_ready_files?.skipped_by_flag === true &&
      skipAgentFilesJson.agent_ready_files?.plan?.status === "skipped_by_flag" &&
      agentReadyPlannedPaths(skipAgentFilesJson).length === 0,
    "skip-agent-files did not suppress agent-ready file planning"
  );
  assert(
    !(await exists(join(skipAgentFilesProject, "AGENTS.md"))),
    "skip-agent-files unexpectedly wrote AGENTS.md"
  );

  await writeFile(join(existingDocsProject, "README.md"), "# Existing Project\n");
  await writeFile(
    join(existingDocsProject, "AGENTS.md"),
    "# Existing Agent Notes\n\nKeep the project-specific notes intact.\n"
  );
  const existingDocs = await runCli(
    [
      "connect-cloud",
      existingDocsProject,
      "--server-url",
      existingDocsServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: existingDocsHome }
    }
  );
  assert(existingDocs.status === 0, `existing-docs connect-cloud failed: ${existingDocs.stderr}`);
  const existingDocsJson = JSON.parse(existingDocs.stdout);
  assertIncludesAll(
    agentReadyPlannedPaths(existingDocsJson),
    ["AGENTS.md", "PROJECT_LOG.md"],
    "existing-docs planned agent-ready files"
  );
  assert(
    !agentReadyPlannedPaths(existingDocsJson).includes("README.md"),
    "existing-docs flow should not plan README overwrite"
  );
  assertIncludesAll(
    agentReadyGeneratedPaths(existingDocsJson),
    ["PROJECT_LOG.md"],
    "existing-docs generated agent-ready files"
  );
  assertIncludesAll(
    agentReadyUpdatedPaths(existingDocsJson),
    ["AGENTS.md"],
    "existing-docs updated agent-ready files"
  );
  assert(
    (await readFile(join(existingDocsProject, "README.md"), "utf8")) === "# Existing Project\n",
    "existing README was overwritten"
  );
  const existingDocsAgents = await readFile(join(existingDocsProject, "AGENTS.md"), "utf8");
  assert(
    existingDocsAgents.includes("Keep the project-specific notes intact.") &&
      existingDocsAgents.includes("central Recallant server through remote MCP") &&
      occurrenceCount(existingDocsAgents, "central Recallant server through remote MCP") === 1,
    "existing AGENTS.md was not preserved and upserted safely"
  );

  const brokenAgents = [
    "# Existing Agent Notes",
    "",
    "Keep this hand-authored guidance.",
    "",
    "<!-- recallant:remote-agent-ready:start -->",
    "partial previous managed section",
    ""
  ].join("\n");
  const brokenProjectLog = [
    "# Existing Project Log",
    "",
    "Owner notes stay intact.",
    "",
    "<!-- recallant:remote-project-log:start -->",
    "partial previous managed section",
    ""
  ].join("\n");
  await writeFile(join(conflictDocsProject, "README.md"), "# Existing Project\n");
  await writeFile(join(conflictDocsProject, "AGENTS.md"), brokenAgents);
  await writeFile(join(conflictDocsProject, "PROJECT_LOG.md"), brokenProjectLog);
  const conflictDocs = await runCli(
    [
      "connect-cloud",
      conflictDocsProject,
      "--server-url",
      conflictDocsServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: safetyHome }
    }
  );
  assert(conflictDocs.status === 0, `conflict-docs connect-cloud failed: ${conflictDocs.stderr}`);
  const conflictDocsJson = JSON.parse(conflictDocs.stdout);
  assertIncludesAll(
    agentReadyConflictPaths(conflictDocsJson),
    ["AGENTS.md", "PROJECT_LOG.md"],
    "conflict-docs conflict files"
  );
  assert(
    conflictDocsJson.agent_ready_files?.outcome?.status === "partial" &&
      agentReadyGeneratedPaths(conflictDocsJson).length === 0 &&
      agentReadyUpdatedPaths(conflictDocsJson).length === 0,
    `conflict-docs should not edit broken managed sections: ${conflictDocs.stdout}`
  );
  assert(
    (await readFile(join(conflictDocsProject, "AGENTS.md"), "utf8")) === brokenAgents &&
      (await readFile(join(conflictDocsProject, "PROJECT_LOG.md"), "utf8")) === brokenProjectLog,
    "conflict-docs changed files with incomplete managed markers"
  );

  const nonAscii = await runCli(
    [
      "connect-cloud",
      nonAsciiProject,
      "--server-url",
      nonAsciiServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: safetyHome }
    }
  );
  assert(nonAscii.status === 0, `non-ASCII connect-cloud failed: ${nonAscii.stderr}`);
  const nonAsciiJson = JSON.parse(nonAscii.stdout);
  assert(nonAsciiJson.project_dir === nonAsciiProject, "non-ASCII project path changed in output");
  assertIncludesAll(
    agentReadyGeneratedPaths(nonAsciiJson),
    ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
    "non-ASCII generated agent-ready files"
  );
  assert(
    (await readFile(join(nonAsciiProject, "AGENTS.md"), "utf8")).includes(
      "central Recallant server through remote MCP"
    ),
    "non-ASCII project did not receive valid AGENTS.md"
  );

  await mkdir(join(staleConfigProject, ".codex"), { recursive: true });
  await writeFile(
    join(staleConfigProject, ".codex", "config.toml"),
    [
      "[mcp_servers.recallant]",
      'command = "recallant"',
      'args = ["remote-bridge"]',
      'env = { RECALLANT_REMOTE_MCP_URL = "https://old.example.com", RECALLANT_REMOTE_MCP_CREDENTIAL_REF = "old-ref", RECALLANT_PROJECT_ID = "old-project", RECALLANT_DEVELOPER_ID = "old-developer", RECALLANT_REMOTE_MCP_CLIENT_ID = "old-client" }',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      'args = ["serve"]',
      "",
      "[mcp_servers.recallant]",
      'command = "recallant"',
      'args = ["remote-bridge"]',
      'env = { RECALLANT_REMOTE_MCP_URL = "https://stale.example.com", RECALLANT_REMOTE_MCP_CREDENTIAL_REF = "stale-ref", RECALLANT_PROJECT_ID = "stale-project", RECALLANT_DEVELOPER_ID = "stale-developer", RECALLANT_REMOTE_MCP_CLIENT_ID = "stale-client" }',
      ""
    ].join("\n")
  );
  const staleConfig = await runCli(
    [
      "connect-cloud",
      staleConfigProject,
      "--server-url",
      staleConfigServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: safetyHome }
    }
  );
  assert(staleConfig.status === 0, `stale-config connect-cloud failed: ${staleConfig.stderr}`);
  const staleConfigToml = await readFile(join(staleConfigProject, ".codex", "config.toml"), "utf8");
  assert(
    occurrenceCount(staleConfigToml, "[mcp_servers.recallant]") === 1 &&
      staleConfigToml.includes("[mcp_servers.other]") &&
      staleConfigToml.includes("remote-bridge") &&
      !staleConfigToml.includes("old.example.com") &&
      !staleConfigToml.includes("stale.example.com"),
    `stale duplicate Codex config was not rewritten idempotently:\n${staleConfigToml}`
  );

  const contextProof = await runCli(
    [
      "connect-cloud",
      contextProofProject,
      "--server-url",
      contextProofServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--allow-insecure-localhost",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: proofHome }
    }
  );
  assert(contextProof.status === 0, `context-proof connect-cloud failed: ${contextProof.stderr}`);
  const contextProofJson = JSON.parse(contextProof.stdout);
  assert(contextProofJson.doctor_status === "passed", "context proof doctor did not pass");
  assert(
    contextProofJson.remote_proof?.requested_level === "context" &&
      proofPassedOrWarned(contextProofJson.remote_proof) &&
      contextProofJson.remote_proof?.remote_mcp_ready === true &&
      contextProofJson.remote_proof?.context_ready === true &&
      contextProofJson.remote_proof?.semantic_memory_ready === false &&
      contextProofJson.remote_proof?.capture_active === false &&
      contextProofJson.remote_proof?.readiness_state === "context_ready",
    `context proof did not expose honest proof states: ${contextProof.stdout}`
  );
  assert(
    String(contextProofJson.remote_proof?.next_action ?? "").includes("semantic"),
    "context proof next action did not point to semantic proof"
  );
  const contextAgentStart = await runCli(
    ["agent-start", "--project-dir", contextProofProject, "--format", "json"],
    { env: { HOME: proofHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(contextAgentStart.status === 0, `context agent-start failed: ${contextAgentStart.stderr}`);
  const contextAgentStartJson = JSON.parse(contextAgentStart.stdout);
  assert(
    contextAgentStartJson.readiness_state === "context_ready" &&
      contextAgentStartJson.proof_status?.context_ready === true &&
      contextAgentStartJson.proof_status?.semantic_memory_ready === false &&
      contextAgentStartJson.proof_status?.capture_active === false,
    `agent-start after context proof did not expose context_ready: ${contextAgentStart.stdout}`
  );

  const connectSemanticProof = await runCli(
    [
      "connect-cloud",
      semanticProofProject,
      "--server-url",
      semanticProofServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--allow-insecure-localhost",
      "--semantic-proof",
      "--yes",
      "--format",
      "json"
    ],
    {
      env: { HOME: proofHome }
    }
  );
  assert(
    connectSemanticProof.status === 0,
    `semantic-proof connect-cloud failed: ${connectSemanticProof.stderr}`
  );
  const connectSemanticProofJson = JSON.parse(connectSemanticProof.stdout);
  assert(
    connectSemanticProofJson.remote_proof?.requested_level === "semantic" &&
      proofPassedOrWarned(connectSemanticProofJson.remote_proof) &&
      connectSemanticProofJson.remote_proof?.context_ready === true &&
      connectSemanticProofJson.remote_proof?.semantic_memory_ready === true &&
      connectSemanticProofJson.remote_proof?.capture_active === false &&
      connectSemanticProofJson.remote_proof?.readiness_state === "semantic_memory_ready",
    `semantic proof did not expose honest proof states: ${connectSemanticProof.stdout}`
  );
  assert(
    semanticProofServer.state.semanticProofAt === SEMANTIC_PROOF_AT,
    "connect-cloud semantic proof did not persist semantic readiness evidence"
  );
  const semanticAgentStart = await runCli(
    ["agent-start", "--project-dir", semanticProofProject, "--format", "json"],
    { env: { HOME: proofHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(
    semanticAgentStart.status === 0,
    `semantic agent-start failed: ${semanticAgentStart.stderr}`
  );
  const semanticAgentStartJson = JSON.parse(semanticAgentStart.stdout);
  assert(
    semanticAgentStartJson.readiness_state === "memory_loop_ready" &&
      semanticAgentStartJson.proof_status?.memory_loop_ready === true &&
      semanticAgentStartJson.proof_status?.semantic_memory_ready === true &&
      semanticAgentStartJson.proof_status?.capture_active === false,
    `agent-start after semantic proof did not expose memory_loop_ready: ${semanticAgentStart.stdout}`
  );

  const approved = await runCli(
    [
      "connect-cloud",
      tempProject,
      "--server-url",
      approvedServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ],
    {
      env: { HOME: tempHome }
    }
  );
  assert(approved.status === 0, `approved connect-cloud failed: ${approved.stderr}`);
  const approvedJson = JSON.parse(approved.stdout);
  assert(approvedJson.status === "connected", "approved flow did not connect");
  assert(approvedJson.doctor_status === "skipped", "skip doctor was not honored");
  assert(
    approvedJson.remote_proof?.status === "skipped" &&
      approvedJson.remote_proof?.remote_mcp_ready === false &&
      approvedJson.remote_proof?.next_action?.includes("remote-doctor"),
    "skip doctor did not report explicit skipped proof state"
  );
  assert(
    approvedJson.trusted_device?.store_path?.includes(".config/recallant/trusted-device.json"),
    "trusted device store path missing"
  );
  assert(
    approvedJson.trusted_device?.private_key_printed === false,
    "private key print flag wrong"
  );
  assert(!approved.stdout.includes("PRIVATE KEY"), "connect-cloud printed private key material");
  assert(approvedServer.state.startBodies.length === 1, "connect-cloud did not call start once");
  const startBody = approvedServer.state.startBodies[0];
  assert(
    startBody.trusted_device_registration?.device_key_prefix,
    "start body missing trusted device prefix"
  );
  assert(
    startBody.trusted_device_registration?.public_key_fingerprint,
    "start body missing trusted device fingerprint"
  );
  assert(
    startBody.trusted_device_registration?.public_key_material?.includes("BEGIN PUBLIC KEY"),
    "start body missing trusted device public key"
  );
  assert(
    !JSON.stringify(startBody.trusted_device_registration).includes("PRIVATE KEY"),
    "start body leaked private key"
  );
  assert(startBody.trusted_device?.challenge_nonce, "start body missing trusted challenge nonce");
  assert(
    startBody.trusted_device?.challenge_signature,
    "start body missing trusted challenge signature"
  );
  assert(
    startBody.trusted_device?.public_key_material?.includes("BEGIN PUBLIC KEY"),
    "start body missing trusted challenge public key"
  );
  assert(
    !JSON.stringify(startBody.trusted_device).includes("PRIVATE KEY"),
    "trusted challenge body leaked private key"
  );
  const trustedDeviceStore = await readFile(
    join(tempHome, ".config", "recallant", "trusted-device.json"),
    "utf8"
  );
  assert(trustedDeviceStore.includes("PRIVATE KEY"), "local trusted device private key missing");
  const config = await readFile(join(tempProject, ".codex", "config.toml"), "utf8");
  assert(config.includes("remote-bridge"), "connect-cloud did not write remote bridge config");
  assert(
    config.includes("RECALLANT_REMOTE_MCP_CREDENTIAL_REF"),
    "remote config did not use credential ref"
  );
  assert(
    !config.includes("rcl_mcp_connect_secret"),
    "remote config embedded raw scoped credential"
  );
  assert(!config.includes("RECALLANT_DATABASE_URL"), "remote config requires database URL");
  const remoteCredentialStore = await readFile(
    join(tempHome, ".config", "recallant", "remote-mcp-credentials.json"),
    "utf8"
  );
  assert(
    remoteCredentialStore.includes("rcl_mcp_connect_secret"),
    "local credential store missing scoped credential"
  );
  const consentReceipt = await readFile(
    join(tempProject, ".recallant", "remote-consent.json"),
    "utf8"
  );
  const parsedConsentReceipt = JSON.parse(consentReceipt);
  assert(
    parsedConsentReceipt.kind === "recallant_remote_agent_consent",
    "connect-cloud did not write remote consent receipt"
  );
  assert(
    parsedConsentReceipt.no_raw_credentials_or_private_keys === true,
    "remote consent receipt missing no-secret assertion"
  );
  assert(
    parsedConsentReceipt.consent_scope?.destination?.endpoint_path === "/api/mcp",
    "remote consent receipt missing MCP endpoint"
  );
  assert(
    parsedConsentReceipt.consent_scope?.recommended_next_proof_call ===
      "memory_create_agent_memory" &&
      parsedConsentReceipt.consent_scope?.recommended_next_proof_followup_call ===
        "memory_recall_agent_memories",
    "remote consent receipt missing semantic proof call guidance"
  );
  for (const secretClass of [
    ".env",
    "private keys",
    "raw credentials",
    "customer data",
    "provider secrets",
    "database URLs",
    "raw artifacts",
    "backups"
  ]) {
    assert(
      parsedConsentReceipt.consent_scope?.not_sent?.includes(secretClass),
      `remote consent receipt missing ${secretClass}`
    );
  }
  assert(
    !consentReceipt.includes("rcl_mcp_connect_secret"),
    "remote consent receipt leaked raw credential"
  );
  assert(!consentReceipt.includes("PRIVATE KEY"), "remote consent receipt leaked private key text");
  assert(
    approvedJson.agent_ready_files?.skipped_by_flag === false,
    "approved flow unexpectedly skipped agent-ready files"
  );
  assertIncludesAll(
    agentReadyPlannedPaths(approvedJson),
    ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
    "approved planned agent-ready files"
  );
  assertIncludesAll(
    agentReadyGeneratedPaths(approvedJson),
    ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
    "approved generated agent-ready files"
  );
  const approvedAgents = await readFile(join(tempProject, "AGENTS.md"), "utf8");
  const approvedProjectLog = await readFile(join(tempProject, "PROJECT_LOG.md"), "utf8");
  const approvedReadme = await readFile(join(tempProject, "README.md"), "utf8");
  assert(
    approvedAgents.includes("central Recallant server through remote MCP") &&
      approvedAgents.includes(
        "do not set up local Postgres, Docker, or `RECALLANT_DATABASE_URL`"
      ) &&
      approvedAgents.includes("memory_start_session") &&
      approvedAgents.includes("memory_closeout") &&
      approvedAgents.includes("checkpoint state; it is not semantic recall proof") &&
      approvedAgents.includes("recallant agent-start --format json") &&
      approvedAgents.includes("recallant agent-closeout") &&
      approvedAgents.includes("memory_get_context_pack"),
    "approved AGENTS.md missing remote MCP agent-ready wording"
  );
  assert(
    approvedProjectLog.includes("central Recallant server through remote MCP") &&
      approvedProjectLog.includes("memory_start_session") &&
      approvedProjectLog.includes("memory_closeout") &&
      approvedProjectLog.includes("checkpoint-only state separate from semantic memory proof") &&
      approvedProjectLog.includes("recallant agent-start --format json") &&
      approvedProjectLog.includes("memory_get_context_pack"),
    "approved PROJECT_LOG.md missing remote MCP agent-ready wording"
  );
  for (const generatedDoc of [approvedAgents, approvedProjectLog, approvedReadme]) {
    assert(
      !generatedDoc.includes("rcl_mcp_connect_secret") &&
        !generatedDoc.includes("PRIVATE KEY") &&
        !generatedDoc.includes("postgres://") &&
        !generatedDoc.includes("/ai/") &&
        !generatedDoc.includes("RECALLANT_DATABASE_URL="),
      "generated agent-ready docs leaked forbidden private surface"
    );
  }
  assert(!approved.stdout.includes("credential_hash"), "approved output exposed credential hash");
  const remoteStart = await runCli(
    ["agent-start", "--project-dir", tempProject, "--format", "json"],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(remoteStart.status === 0, `remote agent-start failed: ${remoteStart.stderr}`);
  const remoteStartJson = JSON.parse(remoteStart.stdout);
  assert(
    remoteStartJson.mode === "remote_mcp_ready",
    `remote agent-start did not report remote_mcp_ready: ${remoteStart.stdout}`
  );
  assert(
    remoteStartJson.remote_readiness_status === "read" &&
      remoteStartJson.readiness_state === "configured" &&
      remoteStartJson.proof_status?.remote_mcp_ready === true &&
      remoteStartJson.proof_status?.context_ready === false &&
      remoteStartJson.proof_status?.semantic_memory_ready === false &&
      remoteStartJson.proof_status?.capture_active === false &&
      remoteStartJson.readiness_contract?.primary_state === "configured" &&
      remoteStartJson.readiness_contract?.semantic_memory_ready === false &&
      remoteStartJson.readiness_contract?.capture_active === false &&
      remoteStartJson.readiness_contract?.evidence?.last_checkpoint_at === CHECKPOINT_ONLY_AT &&
      remoteStartJson.readiness_contract?.evidence?.last_semantic_recall_proof_at === null,
    `remote agent-start did not keep checkpoint-only readiness non-semantic: ${remoteStart.stdout}`
  );
  assert(
    remoteStartJson.recommended_next_call === "memory_get_context_pack",
    "remote agent-start did not recommend context pack startup"
  );
  assertRemoteStartupContract(remoteStartJson, "remote agent-start");
  assert(
    remoteStartJson.recommended_next_proof_call === "memory_create_agent_memory" &&
      remoteStartJson.recommended_next_proof_followup_call === "memory_recall_agent_memories",
    "remote agent-start did not recommend governed semantic proof calls"
  );
  assert(
    !String(remoteStartJson.recommended_next_action ?? "").includes("attach --confirm"),
    "remote agent-start should not point to local attach"
  );
  const captureProof = await runCli(
    [
      "remote-doctor",
      "--project-dir",
      tempProject,
      "--capture-proof",
      "--allow-insecure-localhost",
      "--format",
      "json"
    ],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(captureProof.status === 0, `remote capture proof failed: ${captureProof.stderr}`);
  const captureProofJson = JSON.parse(captureProof.stdout);
  assert(
    stageCode(captureProofJson, "session_context_readiness") ===
      "pass:session_context_readiness_ok" &&
      stageCode(captureProofJson, "checkpoint_state_proof") === "skipped:not_requested" &&
      stageCode(captureProofJson, "semantic_memory_proof") === "skipped:not_requested",
    `remote capture proof should not imply checkpoint or semantic proof: ${captureProof.stdout}`
  );
  const remoteStartAfterCaptureProof = await runCli(
    ["agent-start", "--project-dir", tempProject, "--format", "json"],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(
    remoteStartAfterCaptureProof.status === 0,
    `post-capture-proof remote agent-start failed: ${remoteStartAfterCaptureProof.stderr}`
  );
  const remoteStartAfterCaptureProofJson = JSON.parse(remoteStartAfterCaptureProof.stdout);
  assert(
    remoteStartAfterCaptureProofJson.readiness_state === "context_ready" &&
      remoteStartAfterCaptureProofJson.proof_status?.context_ready === true &&
      remoteStartAfterCaptureProofJson.proof_status?.semantic_memory_ready === false &&
      remoteStartAfterCaptureProofJson.proof_status?.capture_active === false &&
      remoteStartAfterCaptureProofJson.readiness_contract?.semantic_memory_ready === false &&
      remoteStartAfterCaptureProofJson.readiness_contract?.capture_active === false &&
      remoteStartAfterCaptureProofJson.readiness_contract?.evidence
        ?.last_semantic_recall_proof_at === null,
    `capture proof should not become semantic or capture-active readiness: ${remoteStartAfterCaptureProof.stdout}`
  );
  const semanticProof = await runCli(
    [
      "remote-doctor",
      "--project-dir",
      tempProject,
      "--semantic-proof",
      "--allow-insecure-localhost",
      "--format",
      "json"
    ],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(semanticProof.status === 0, `remote semantic proof failed: ${semanticProof.stderr}`);
  const semanticProofJson = JSON.parse(semanticProof.stdout);
  assert(
    stageCode(semanticProofJson, "session_context_readiness") ===
      "pass:session_context_readiness_ok" &&
      stageCode(semanticProofJson, "checkpoint_state_proof") === "pass:checkpoint_state_proof_ok" &&
      stageCode(semanticProofJson, "semantic_memory_proof") === "pass:semantic_memory_proof_ok",
    `remote semantic proof did not pass all proof stages: ${semanticProof.stdout}`
  );
  assert(
    approvedServer.state.semanticProofAt === SEMANTIC_PROOF_AT,
    "remote semantic proof did not persist semantic readiness evidence"
  );
  const remoteStartAfterProof = await runCli(
    ["agent-start", "--project-dir", tempProject, "--format", "json"],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(
    remoteStartAfterProof.status === 0,
    `post-proof remote agent-start failed: ${remoteStartAfterProof.stderr}`
  );
  const remoteStartAfterProofJson = JSON.parse(remoteStartAfterProof.stdout);
  assert(
    remoteStartAfterProofJson.mode === "remote_mcp_ready" &&
      remoteStartAfterProofJson.readiness_state === "memory_loop_ready" &&
      remoteStartAfterProofJson.proof_status?.memory_loop_ready === true &&
      remoteStartAfterProofJson.proof_status?.semantic_memory_ready === true &&
      remoteStartAfterProofJson.proof_status?.capture_active === false &&
      remoteStartAfterProofJson.readiness_contract?.primary_state === "memory_loop_ready" &&
      remoteStartAfterProofJson.readiness_contract?.memory_loop_ready === true &&
      remoteStartAfterProofJson.readiness_contract?.semantic_memory_ready === true &&
      remoteStartAfterProofJson.readiness_contract?.capture_active === false &&
      remoteStartAfterProofJson.readiness_contract?.ingestion_approved === false &&
      remoteStartAfterProofJson.readiness_contract?.evidence?.last_semantic_recall_proof_at ===
        SEMANTIC_PROOF_AT,
    `post-proof remote agent-start did not read semantic readiness: ${remoteStartAfterProof.stdout}`
  );
  assert(
    !String(remoteStartAfterProofJson.recommended_next_action ?? "").includes("attach") &&
      !String(remoteStartAfterProofJson.recommended_next_action ?? "").includes("import") &&
      !String(remoteStartAfterProofJson.recommended_next_action ?? "").includes("onboard"),
    "post-proof remote agent-start should not recommend attach/import/onboard"
  );
  const remoteStartAfterProofText = await runCli(
    ["agent-start", "--project-dir", tempProject, "--format", "text"],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(
    remoteStartAfterProofText.status === 0,
    `post-proof remote agent-start text failed: ${remoteStartAfterProofText.stderr}`
  );
  assert(
    remoteStartAfterProofText.stdout.includes("semantic_memory_ready") &&
      remoteStartAfterProofText.stdout.includes("memory_start_session") &&
      remoteStartAfterProofText.stdout.includes("memory_closeout") &&
      remoteStartAfterProofText.stdout.includes(SEMANTIC_PROOF_AT) &&
      !remoteStartAfterProofText.stdout.includes("semantic memory is not proven yet"),
    `post-proof text output did not describe semantic readiness: ${remoteStartAfterProofText.stdout}`
  );
  const remoteDoctor = await runCli(["doctor", "--project-dir", tempProject, "--format", "json"], {
    env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" }
  });
  assert(remoteDoctor.status === 0, `remote local doctor failed: ${remoteDoctor.stderr}`);
  const remoteDoctorJson = JSON.parse(remoteDoctor.stdout);
  assert(
    remoteDoctorJson.owner_summary?.status === "remote_ready_local_storage_not_attached" &&
      remoteDoctorJson.owner_summary?.local_storage_status ===
        "remote-ready, local storage not attached",
    `local doctor did not report remote-ready local-storage status: ${remoteDoctor.stdout}`
  );
  assert(
    remoteDoctorJson.remote_project?.status === "remote_mcp_ready",
    "local doctor did not expose remote_project readiness"
  );
  assert(
    !String(remoteDoctorJson.owner_summary?.next_step ?? "").includes("attach --confirm"),
    "remote-ready local doctor should not recommend attach --confirm"
  );
  const remoteDoctorText = await runCli(
    ["doctor", "--project-dir", tempProject, "--format", "text"],
    { env: { HOME: tempHome, RECALLANT_DATABASE_URL: "" } }
  );
  assert(
    remoteDoctorText.status === 0,
    `remote local doctor text failed: ${remoteDoctorText.stderr}`
  );
  assert(
    remoteDoctorText.stdout.includes("remote-ready, local storage not attached") &&
      remoteDoctorText.stdout.includes("Remote MCP: ready"),
    `local doctor text missing remote-ready wording: ${remoteDoctorText.stdout}`
  );
  assert(
    !remoteDoctorText.stdout.includes("Project is not attached to Recallant yet."),
    "local doctor text still reports standalone not-attached headline"
  );

  const reconnect = await runCli(
    [
      "connect-cloud",
      tempProject,
      "--server-url",
      reconnectServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ],
    {
      env: { HOME: tempHome }
    }
  );
  assert(reconnect.status === 0, `same-project reconnect failed: ${reconnect.stderr}`);
  const reconnectJson = JSON.parse(reconnect.stdout);
  assert(reconnectJson.status === "connected", "same-project reconnect did not connect");
  assert(
    reconnectJson.approval_mode === "trusted_device" &&
      reconnectJson.browser_approval_required === false,
    "same-project reconnect should use trusted device approval"
  );
  assert(
    agentReadyGeneratedPaths(reconnectJson).length === 0,
    "same-project reconnect regenerated agent-ready files"
  );
  assertIncludesAll(
    agentReadySkippedPaths(reconnectJson),
    ["AGENTS.md", "PROJECT_LOG.md"],
    "same-project reconnect skipped agent-ready files"
  );
  const reconnectedAgents = await readFile(join(tempProject, "AGENTS.md"), "utf8");
  assert(
    occurrenceCount(reconnectedAgents, "central Recallant server through remote MCP") === 1,
    "same-project reconnect duplicated AGENTS.md remote MCP section"
  );

  const trusted = await runCli(
    [
      "connect-cloud",
      secondProject,
      "--server-url",
      trustedServer.baseUrl,
      "--poll-timeout-ms",
      "5000",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ],
    {
      env: { HOME: tempHome }
    }
  );
  assert(trusted.status === 0, `trusted reconnect failed: ${trusted.stderr}`);
  const trustedJson = JSON.parse(trusted.stdout);
  assert(trustedJson.status === "connected", "trusted reconnect did not connect");
  assert(trustedJson.approval_mode === "trusted_device", "trusted reconnect mode missing");
  assert(
    trustedJson.browser_approval_required === false,
    "trusted reconnect still required browser approval"
  );
  assert(
    trustedJson.trusted_device?.created === false,
    "trusted reconnect did not reuse local device key"
  );
  assert(
    trustedJson.trusted_device?.reconnect_status === "approved",
    "trusted reconnect status was not approved"
  );
  assert(trustedServer.state.startBodies.length === 1, "trusted reconnect did not call start once");
  const trustedStartBody = trustedServer.state.startBodies[0];
  assert(
    trustedStartBody.trusted_device?.challenge_signature,
    "trusted reconnect missing challenge signature"
  );
  assert(
    trustedStartBody.trusted_device?.challenge_nonce,
    "trusted reconnect missing challenge nonce"
  );
  assert(
    !JSON.stringify(trustedStartBody.trusted_device).includes("PRIVATE KEY"),
    "trusted reconnect leaked private key"
  );
  assert(!trusted.stdout.includes("/connect/approve"), "trusted reconnect printed approve URL");

  const connectRemoteTextProject = await mkdtemp(join(tmpdir(), "recallant-connect-remote-text-"));
  const connectRemoteTextHome = await mkdtemp(
    join(tmpdir(), "recallant-connect-remote-text-home-")
  );
  try {
    const connectRemoteText = await runCli(
      [
        "connect-remote",
        "codex",
        "--server-url",
        "https://recallant.example.com",
        "--credential",
        "rcl_mcp_connect_text_secret",
        "--project-id",
        "11111111-1111-4111-8111-111111111111",
        "--developer-id",
        "22222222-2222-4222-8222-222222222222",
        "--client-id",
        "remote-cli-smoke-text",
        "--project-dir",
        connectRemoteTextProject,
        "--write",
        "--format",
        "text"
      ],
      { env: { HOME: connectRemoteTextHome, RECALLANT_DATABASE_URL: "" } }
    );
    assert(
      connectRemoteText.status === 0,
      `connect-remote text failed: ${connectRemoteText.stderr}`
    );
    assert(
      connectRemoteText.stdout.includes("Next agent steps:") &&
        connectRemoteText.stdout.includes("memory_get_context_pack") &&
        connectRemoteText.stdout.includes("remote-doctor --semantic-proof") &&
        connectRemoteText.stdout.includes("memory_create_agent_memory") &&
        connectRemoteText.stdout.includes("memory_recall_agent_memories"),
      `connect-remote text did not name context pack and semantic proof: ${connectRemoteText.stdout}`
    );
    assert(
      !connectRemoteText.stdout.includes("attach --confirm"),
      "connect-remote success text should not point to attach --confirm"
    );
  } finally {
    await rm(connectRemoteTextProject, { recursive: true, force: true });
    await rm(connectRemoteTextHome, { recursive: true, force: true });
  }

  const bootstrapProject = await mkdtemp(join(tmpdir(), "recallant-connect-bootstrap-"));
  const bootstrapHome = await mkdtemp(join(tmpdir(), "recallant-connect-bootstrap-home-"));
  try {
    const bootstrap = await runCli(
      [
        "connect-cloud",
        bootstrapProject,
        "--server-url",
        bootstrapServer.baseUrl,
        "--bootstrap-token",
        "rcl_boot_cli_secret",
        "--poll-timeout-ms",
        "5000",
        "--poll-interval-ms",
        "50",
        "--skip-doctor",
        "--format",
        "json"
      ],
      {
        env: { HOME: bootstrapHome }
      }
    );
    assert(bootstrap.status === 0, `bootstrap connect-cloud failed: ${bootstrap.stderr}`);
    const bootstrapJson = JSON.parse(bootstrap.stdout);
    assert(bootstrapJson.status === "connected", "bootstrap flow did not connect");
    assert(bootstrapJson.approval_mode === "bootstrap_token", "bootstrap approval mode missing");
    assert(
      bootstrapJson.browser_approval_required === false,
      "bootstrap flow still required browser approval"
    );
    assert(
      bootstrapJson.bootstrap_token?.status === "approved",
      "bootstrap token status was not approved"
    );
    assert(
      bootstrapJson.trusted_device?.device_key_prefix === null,
      "bootstrap flow should not create trusted device"
    );
    assert(bootstrapServer.state.startBodies.length === 1, "bootstrap flow did not call start");
    const bootstrapStartBody = bootstrapServer.state.startBodies[0];
    assert(
      bootstrapStartBody.bootstrap_token === "rcl_boot_cli_secret",
      "bootstrap start did not send token"
    );
    assert(!bootstrapStartBody.trusted_device, "bootstrap start sent trusted device");
    assert(!bootstrap.stdout.includes("/connect/approve"), "bootstrap flow printed approve URL");
    await readFile(join(bootstrapHome, ".config", "recallant", "trusted-device.json"), "utf8")
      .then(() => {
        throw new Error("bootstrap flow wrote trusted-device store");
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
  } finally {
    await rm(bootstrapProject, { recursive: true, force: true });
    await rm(bootstrapHome, { recursive: true, force: true });
  }
} finally {
  approvedServer.server.close();
  trustedServer.server.close();
  reconnectServer.server.close();
  dryRunServer.server.close();
  skipAgentFilesServer.server.close();
  existingDocsServer.server.close();
  conflictDocsServer.server.close();
  nonAsciiServer.server.close();
  staleConfigServer.server.close();
  contextProofServer.server.close();
  semanticProofServer.server.close();
  bootstrapServer.server.close();
  universalServer.server.close();
  schemelessServer.server.close();
  await rm(tempProject, { recursive: true, force: true });
  await rm(secondProject, { recursive: true, force: true });
  await rm(dryRunProject, { recursive: true, force: true });
  await rm(skipAgentFilesProject, { recursive: true, force: true });
  await rm(existingDocsProject, { recursive: true, force: true });
  await rm(conflictDocsProject, { recursive: true, force: true });
  await rm(nonAsciiProject, { recursive: true, force: true });
  await rm(staleConfigProject, { recursive: true, force: true });
  await rm(contextProofProject, { recursive: true, force: true });
  await rm(semanticProofProject, { recursive: true, force: true });
  await rm(tempHome, { recursive: true, force: true });
  await rm(dryRunHome, { recursive: true, force: true });
  await rm(existingDocsHome, { recursive: true, force: true });
  await rm(safetyHome, { recursive: true, force: true });
  await rm(proofHome, { recursive: true, force: true });
  await rm(universalProject, { recursive: true, force: true });
  await rm(schemelessProject, { recursive: true, force: true });
  await rm(universalHome, { recursive: true, force: true });
}

for (const mode of ["denied", "expired"]) {
  const server = await connectServer(mode);
  const temp = await mkdtemp(join(tmpdir(), `recallant-connect-${mode}-`));
  const home = await mkdtemp(join(tmpdir(), `recallant-connect-${mode}-home-`));
  try {
    const result = await runCli(
      [
        "connect-cloud",
        temp,
        "--server-url",
        server.baseUrl,
        "--poll-timeout-ms",
        "500",
        "--poll-interval-ms",
        "50",
        "--skip-doctor",
        "--format",
        "json"
      ],
      { env: { HOME: home } }
    );
    assert(result.status !== 0, `${mode} flow unexpectedly succeeded`);
    assert(result.stderr.includes(`remote connect request is ${mode}`), `${mode} error unclear`);
  } finally {
    server.server.close();
    await rm(temp, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

const pendingServer = await connectServer("pending");
const pendingTemp = await mkdtemp(join(tmpdir(), "recallant-connect-timeout-"));
const pendingHome = await mkdtemp(join(tmpdir(), "recallant-connect-timeout-home-"));
try {
  const timeout = await runCli(
    [
      "connect-cloud",
      pendingTemp,
      "--server-url",
      pendingServer.baseUrl,
      "--poll-timeout-ms",
      "150",
      "--poll-interval-ms",
      "50",
      "--skip-doctor",
      "--format",
      "json"
    ],
    { env: { HOME: pendingHome } }
  );
  assert(timeout.status !== 0, "pending timeout unexpectedly succeeded");
  assert(timeout.stderr.includes("approval timed out"), "timeout error unclear");
} finally {
  pendingServer.server.close();
  await rm(pendingTemp, { recursive: true, force: true });
  await rm(pendingHome, { recursive: true, force: true });
}

const script = await readFile(
  new URL("../scripts/install-recallant-client-bootstrap.sh", import.meta.url),
  "utf8"
);
assert(script.includes("--connect-url"), "bootstrap script missing --connect-url");
assert(script.includes("connect-cloud"), "bootstrap script does not invoke connect-cloud");
assert(script.includes("RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD"), "bootstrap lacks CLI override");
assert(!script.includes("RECALLANT_DATABASE_URL="), "bootstrap sets local database URL");

process.stdout.write(
  JSON.stringify(
    {
      remote_connect_cli_smoke: {
        status: "pass",
        command: "recallant connect-cloud <project-dir> --server-url <https-url>",
        approved_flow: "config_written",
        trusted_device: "local_key_created_start_payload_public_only",
        trusted_reconnect: "signed_nonce_without_browser_approval",
        bootstrap_token: "headless_redeem_without_browser_or_trusted_device",
        credential_store: "project_config_ref_local_store_secret",
        consent_receipt: "project_local_non_secret_remote_boundary",
      agent_start_readiness:
        "configured_checkpoint_only_then_capture_proof_non_semantic_then_memory_loop_ready_without_capture_active",
        regression_matrix: {
          old_mac_test_failure_mode:
            "remote connect must produce agent-ready thin files, not only MCP config",
          empty_remote_project: "README.md, AGENTS.md, and PROJECT_LOG.md generated",
          existing_doc_remote_project:
            "existing README preserved, existing AGENTS.md safely upserted, PROJECT_LOG.md generated",
          existing_agents_md: "hand-authored AGENTS.md notes preserved",
          credential_ref_only_safety: "project config uses credential ref, not raw scoped secret",
          no_local_storage: "remote-only project does not require local database storage",
          dry_run: "reports planned files without writing them",
          idempotent_reconnect: "trusted reconnect does not duplicate agent-ready sections",
          non_ascii_path: "non-ASCII project path connects and receives valid thin files",
          remote_proof_status: "skipped/context/semantic proof states are explicit",
          cleanup_retry: "covered by remote-client-cleanup:smoke"
        },
        doctor: "runs_by_default_skip_flag_honored",
        denied: "clear_error",
        expired: "clear_error",
        timeout: "clear_error",
        bootstrap: "connect_url_supported",
        safety: "no_local_storage_or_database_url_required"
      }
    },
    null,
    2
  )
);
