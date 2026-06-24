#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { hostname, platform, release, tmpdir, type as osType } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const requiredFlags = ["serverUrl", "projectId", "developerId", "clientId"];
const inferableRemoteConfigKeys = [
  ...requiredFlags,
  "credential",
  "credentialRef",
  "credentialStorePath"
];
const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"\s*[:=]|RECALLANT_DATABASE_URL\s*=|DATABASE_URL\s*=|postgres:\/\/|pgvector|recallant-postgres|\/ai\//i;
const remoteConfigEnvMap = {
  serverUrl: "RECALLANT_REMOTE_MCP_URL",
  credential: "RECALLANT_REMOTE_MCP_CREDENTIAL",
  credentialRef: "RECALLANT_REMOTE_MCP_CREDENTIAL_REF",
  credentialStorePath: "RECALLANT_REMOTE_MCP_CREDENTIAL_STORE",
  projectId: "RECALLANT_PROJECT_ID",
  developerId: "RECALLANT_DEVELOPER_ID",
  clientId: "RECALLANT_REMOTE_MCP_CLIENT_ID"
};

function parseArgs(argv) {
  const values = {
    mode: "run",
    serverUrl: process.env.RECALLANT_EXTERNAL_REHEARSAL_SERVER_URL ?? "",
    credential: process.env.RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL ?? "",
    credentialRef: process.env.RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL_REF ?? "",
    credentialStorePath: process.env.RECALLANT_EXTERNAL_REHEARSAL_CREDENTIAL_STORE ?? "",
    projectId: process.env.RECALLANT_EXTERNAL_REHEARSAL_PROJECT_ID ?? "",
    developerId: process.env.RECALLANT_EXTERNAL_REHEARSAL_DEVELOPER_ID ?? "",
    clientId: process.env.RECALLANT_EXTERNAL_REHEARSAL_CLIENT_ID ?? "",
    sessionId: process.env.RECALLANT_EXTERNAL_REHEARSAL_SESSION_ID ?? "",
    traceId: process.env.RECALLANT_EXTERNAL_REHEARSAL_TRACE_ID ?? randomUUID(),
    projectDir: process.env.RECALLANT_EXTERNAL_REHEARSAL_PROJECT_DIR ?? ".",
    target: process.env.RECALLANT_EXTERNAL_REHEARSAL_TARGET ?? "codex",
    outputDir: process.env.RECALLANT_EXTERNAL_REHEARSAL_OUTPUT_DIR ?? "recallant-external-evidence",
    bootstrapScript: process.env.RECALLANT_EXTERNAL_REHEARSAL_BOOTSTRAP_SCRIPT ?? "",
    bootstrapMode: process.env.RECALLANT_EXTERNAL_REHEARSAL_BOOTSTRAP_MODE ?? "scoped_credential",
    recallantCommand: process.env.RECALLANT_EXTERNAL_REHEARSAL_RECALLANT_CMD ?? "recallant",
    captureProof: process.env.RECALLANT_EXTERNAL_REHEARSAL_CAPTURE_PROOF === "1",
    semanticProof: process.env.RECALLANT_EXTERNAL_REHEARSAL_SEMANTIC_PROOF === "1",
    skipBootstrap: false,
    confirm: false
  };
  if (argv[0] === "cleanup") {
    values.mode = "cleanup";
    argv = argv.slice(1);
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--server-url") values.serverUrl = next ?? "";
    else if (arg === "--credential") values.credential = next ?? "";
    else if (arg === "--credential-ref") values.credentialRef = next ?? "";
    else if (arg === "--credential-store") values.credentialStorePath = next ?? "";
    else if (arg === "--project-id") values.projectId = next ?? "";
    else if (arg === "--developer-id") values.developerId = next ?? "";
    else if (arg === "--client-id") values.clientId = next ?? "";
    else if (arg === "--session-id") values.sessionId = next ?? "";
    else if (arg === "--trace-id") values.traceId = next ?? "";
    else if (arg === "--project-dir") values.projectDir = next ?? "";
    else if (arg === "--target") values.target = next ?? "";
    else if (arg === "--output-dir") values.outputDir = next ?? "";
    else if (arg === "--bootstrap-script") values.bootstrapScript = next ?? "";
    else if (arg === "--bootstrap-mode") values.bootstrapMode = next ?? "";
    else if (arg === "--recallant-command") values.recallantCommand = next ?? "";
    else if (arg === "--capture-proof") values.captureProof = true;
    else if (arg === "--semantic-proof") values.semanticProof = true;
    else if (arg === "--skip-bootstrap") values.skipBootstrap = true;
    else if (arg === "--confirm") values.confirm = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (
      arg.startsWith("--") &&
      ![
        "--capture-proof",
        "--semantic-proof",
        "--skip-bootstrap",
        "--confirm",
        "--help",
        "-h"
      ].includes(arg)
    ) {
      index += 1;
    }
  }
  return values;
}

function usage() {
  process.stdout
    .write(`Usage: node scripts/remote-mcp-separate-machine-evidence.mjs --project-dir <path> [--semantic-proof] [options]

Manual override:
  node scripts/remote-mcp-separate-machine-evidence.mjs --server-url <https-url> (--credential <token> | --credential-ref <ref> [--credential-store <path>]) --project-id <id> --developer-id <id> --client-id <id> --project-dir <path> [options]

Runs the external-host Recallant remote onboarding rehearsal and writes redacted evidence.
This runner does not install Docker, Postgres, or local Recallant storage.
If project-local remote MCP config already exists, scoped connection values are inferred from it.
Credential-ref configs skip bootstrap automatically because the raw credential is intentionally not stored in the project.
Use --bootstrap-mode connect_cloud when the project was provisioned through universal browser-approved remote connect.
Use --semantic-proof to make remote-doctor create and recall a governed diagnostic marker memory.

Cleanup stale local storage artifacts before retrying:
  node scripts/remote-mcp-separate-machine-evidence.mjs cleanup --project-dir <path> --confirm\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redact(text, input) {
  let output = String(text ?? "");
  const replacements = [
    [input.credential, "[REDACTED_CREDENTIAL]"],
    [input.credentialRef, "[REDACTED_CREDENTIAL_REF]"],
    [input.credentialStorePath, "[REDACTED_CREDENTIAL_STORE]"],
    [input.projectDir, "[PROJECT_DIR]"],
    [resolve(input.projectDir), "[PROJECT_DIR]"],
    [process.cwd(), "[REPO_ROOT]"]
  ];
  const host = hostname();
  if (host.length >= 4) replacements.push([host, "[HOSTNAME]"]);
  for (const [raw, replacement] of replacements) {
    if (raw) output = output.replaceAll(raw, replacement);
  }
  return output;
}

function redactJson(value, input) {
  return JSON.parse(redact(JSON.stringify(value), input));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
  const recallantConfigCount = (codexConfig.match(/\[mcp_servers\.recallant\]/g) ?? []).length;
  const names = entries.map((entry) => entry.name);
  const forbidden = {
    recallant_local_storage: names.includes(".recallant"),
    docker_compose: names.some((name) => /^docker-compose(?:\..+)?\.ya?ml$/i.test(name)),
    postgres_hint: /postgres|pgvector|recallant-postgres/i.test(
      `${names.join("\n")}\n${codexConfig}`
    ),
    database_url_hint: /RECALLANT_DATABASE_URL|DATABASE_URL|postgres:\/\//i.test(codexConfig)
  };
  return {
    entry_count: entries.length,
    entries: entries.map((entry) => entry.name).sort(),
    codex_config_present: codexConfig !== "",
    recallant_codex_config_entries: recallantConfigCount,
    recallant_remote_bridge_configured: /remote-bridge/.test(codexConfig),
    forbidden
  };
}

function parseTomlStringValue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readRemoteConfigValues(projectDir) {
  const codexConfigPath = join(projectDir, ".codex", "config.toml");
  if (!(await exists(codexConfigPath))) return {};
  const config = await readFile(codexConfigPath, "utf8");
  const sectionMatch = config.match(/\[mcp_servers\.recallant\]([\s\S]*?)(?=\n\[[^\]]+\]|\s*$)/);
  if (!sectionMatch) return {};
  const section = sectionMatch[1] ?? "";
  const envBlockMatch = section.match(/env\s*=\s*\{([\s\S]*?)\}/);
  if (!envBlockMatch) return {};
  const envBlock = envBlockMatch[1] ?? "";
  const found = {};
  for (const [key, envName] of Object.entries(remoteConfigEnvMap)) {
    const match = envBlock.match(new RegExp(`${envName}\\s*=\\s*("[^"]*"|'[^']*'|[^,\\n]+)`));
    if (match?.[1]) found[key] = parseTomlStringValue(match[1]);
  }
  return found;
}

async function hydrateInputFromProjectConfig(input) {
  const configValues = await readRemoteConfigValues(input.projectDir);
  const inferred = [];
  for (const key of inferableRemoteConfigKeys) {
    if (!String(input[key] ?? "").trim() && String(configValues[key] ?? "").trim()) {
      input[key] = configValues[key];
      inferred.push(key);
    }
  }
  return inferred;
}

async function runCleanup(input) {
  const projectDir = resolve(input.projectDir);
  const target = join(projectDir, ".recallant");
  const present = await exists(target);
  const result = {
    ok: true,
    action: "remote_acceptance_cleanup",
    dry_run: !input.confirm,
    project_dir: redact(projectDir, { ...input, projectDir }),
    writes_files: input.confirm && present,
    planned_changes: present
      ? [
          {
            action: "remove_path",
            path: ".recallant",
            reason:
              "Stale local Recallant storage artifact blocks remote existing-server acceptance."
          }
        ]
      : [],
    removed_paths: [],
    preserved: [
      ".codex/config.toml and other client configs",
      "source files",
      "AGENTS.md",
      "PROJECT_LOG.md",
      "Docker/Postgres files"
    ],
    warnings: [
      "This cleanup removes only the project-local .recallant directory.",
      "It does not delete source files or central Recallant server records."
    ]
  };
  if (input.confirm && present) {
    await rm(target, { recursive: true, force: true });
    result.removed_paths.push(".recallant");
  }
  process.stdout.write(
    [
      "Recallant remote-acceptance cleanup",
      "",
      `Status: ${present ? (input.confirm ? "cleaned" : "ready_for_confirmation") : "already_clean"}`,
      `Writes files: ${result.writes_files ? "yes" : "no"}`,
      `Planned changes: ${result.planned_changes.length}`,
      result.planned_changes.length ? "- remove .recallant" : "- none",
      "",
      "Preserved:",
      ...result.preserved.map((item) => `- ${item}`),
      "",
      `JSON: ${JSON.stringify(result)}`,
      ""
    ].join("\n")
  );
}

function assertCleanSnapshot(snapshot, label) {
  assert(!snapshot.forbidden.recallant_local_storage, `${label}: project contains .recallant`);
  assert(!snapshot.forbidden.docker_compose, `${label}: project contains docker compose artifact`);
  assert(!snapshot.forbidden.postgres_hint, `${label}: project contains Postgres artifact`);
  assert(!snapshot.forbidden.database_url_hint, `${label}: project config contains database URL`);
}

async function runProcess(command, args, options, input) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 1024 * 1024
    });
    return {
      command: redact(`${basename(command)} ${args.join(" ")}`, input),
      exit_code: 0,
      stdout: redact(result.stdout, input),
      stderr: redact(result.stderr, input)
    };
  } catch (error) {
    return {
      command: redact(`${basename(command)} ${args.join(" ")}`, input),
      exit_code: Number(error.code ?? 1),
      stdout: redact(error.stdout ?? "", input),
      stderr: redact(error.stderr ?? error.message ?? "", input)
    };
  }
}

function recallantInvocation(input, subcommand, extraArgs) {
  const command = input.recallantCommand;
  if (command.endsWith(".js")) {
    return {
      command: process.execPath,
      args: [command, subcommand, ...extraArgs]
    };
  }
  return {
    command,
    args: [subcommand, ...extraArgs]
  };
}

function clientEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? "",
    ...extra
  };
  for (const key of Object.keys(env)) {
    if (
      /(?:RECALLANT_DATABASE_URL|DATABASE_URL|POSTGRES|PGPASSWORD|WORKBENCH|ADMIN|PROVIDER|OPENAI|ANTHROPIC|RAW_ARTIFACT|BACKUP)/i.test(
        key
      )
    ) {
      throw new Error(`forbidden external client env key: ${key}`);
    }
  }
  return env;
}

function remoteArgs(input) {
  const args = [
    "--server-url",
    input.serverUrl,
    "--project-id",
    input.projectId,
    "--developer-id",
    input.developerId,
    "--client-id",
    input.clientId
  ];
  if (input.credential) {
    args.splice(2, 0, "--credential", input.credential);
  } else if (input.credentialRef) {
    args.splice(2, 0, "--credential-ref", input.credentialRef);
    if (input.credentialStorePath)
      args.splice(4, 0, "--credential-store", input.credentialStorePath);
  }
  if (input.traceId) args.push("--trace-id", input.traceId);
  return args;
}

async function runBootstrap(input, env) {
  if (input.skipBootstrap) {
    return {
      command: "skipped",
      exit_code: 0,
      stdout: input.skipBootstrapReason ?? "bootstrap skipped by operator",
      stderr: ""
    };
  }
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const script =
    input.bootstrapScript || join(repoRoot, "scripts", "install-recallant-client-bootstrap.sh");
  const args = [
    script,
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
    "--project-dir",
    input.projectDir,
    "--target",
    input.target
  ];
  if (input.traceId) args.push("--trace-id", input.traceId);
  if (input.captureProof) args.push("--capture-proof");
  return runProcess("bash", args, { cwd: process.cwd(), env }, input);
}

async function runDoctor(input, env) {
  const semanticProof = input.semanticProof || input.captureProof;
  const invocation = recallantInvocation(input, "remote-doctor", [
    ...remoteArgs(input),
    "--timeout-ms",
    "5000",
    "--format",
    "json",
    ...(semanticProof ? ["--semantic-proof"] : input.captureProof ? ["--capture-proof"] : [])
  ]);
  const result = await runProcess(
    invocation.command,
    invocation.args,
    { cwd: process.cwd(), env },
    input
  );
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return {
    ...result,
    json: parsed ? redactJson(parsed, input) : null
  };
}

async function runBridgeProbe(input, env) {
  const invocation = recallantInvocation(input, "remote-bridge", remoteArgs(input));
  const transport = new StdioClientTransport({
    command: invocation.command,
    args: invocation.args,
    cwd: process.cwd(),
    env,
    stderr: "pipe"
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "recallant-separate-machine-evidence", version: "0.0.0" });
  try {
    await client.connect(transport, { timeout: 5_000 });
    const list = await client.listTools({}, { timeout: 5_000 });
    const toolNames = list.tools.map((tool) => tool.name).sort();
    const requiredTools = [
      "memory_start_session",
      "memory_get_context_pack",
      "memory_create_agent_memory",
      "memory_set_checkpoint",
      "memory_recall_agent_memories"
    ];
    const missingTools = requiredTools.filter((tool) => !toolNames.includes(tool));
    assert(
      missingTools.length === 0,
      `remote MCP missing required tools: ${missingTools.join(", ")}`
    );
    const marker = `remote acceptance ${input.traceId}`;
    const start = await client.callTool(
      {
        name: "memory_start_session",
        arguments: {
          client_kind: "codex",
          client_version: "0.0.0",
          project_path: null,
          session_label: `remote acceptance ${input.traceId}`,
          resume_policy: "force_new"
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const startStructured = start.structuredContent ?? {};
    const sessionId =
      typeof startStructured.session_id === "string" ? startStructured.session_id : input.sessionId;
    const context = await client.callTool(
      {
        name: "memory_get_context_pack",
        arguments: {
          session_id: sessionId,
          task_hint: marker,
          project_id: null,
          max_chars_total: 4000,
          include_raw_evidence: "never",
          include_recovery: false
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const created = await client.callTool(
      {
        name: "memory_create_agent_memory",
        arguments: {
          memory_type: "work_log",
          scope: "project",
          scope_kind: null,
          scope_id: null,
          audience: [{ kind: "all_agents", id: null }],
          title: "Remote acceptance marker",
          body: marker,
          confidence: 1,
          source_refs: [],
          created_by: "agent",
          metadata: {
            trace_id: input.traceId,
            session_id: sessionId,
            acceptance: "remote_external"
          }
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const checkpoint = await client.callTool(
      {
        name: "memory_set_checkpoint",
        arguments: {
          payload: {
            current_status: "remote acceptance running",
            current_focus: marker,
            next_step: "Verify recall of the remote acceptance marker.",
            open_questions: []
          }
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const recall = await client.callTool(
      {
        name: "memory_recall_agent_memories",
        arguments: {
          query: marker,
          scope: "project",
          scope_kind: null,
          audience_kind: null,
          memory_types: ["work_log"],
          include_candidates: true,
          include_stale: false,
          include_needs_review: true,
          top_k: 5,
          max_chars_total: 4000
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const nextStart = await client.callTool(
      {
        name: "memory_start_session",
        arguments: {
          client_kind: "codex",
          client_version: "0.0.0",
          project_path: null,
          session_label: `remote acceptance follow-up ${input.traceId}`,
          resume_policy: "force_new"
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const nextStartStructured = nextStart.structuredContent ?? {};
    const nextSessionId =
      typeof nextStartStructured.session_id === "string" ? nextStartStructured.session_id : null;
    const nextContext = await client.callTool(
      {
        name: "memory_get_context_pack",
        arguments: {
          session_id: nextSessionId,
          task_hint: `Recall remote acceptance marker ${input.traceId}`,
          project_id: null,
          max_chars_total: 4000,
          include_raw_evidence: "never",
          include_recovery: false
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    const nextRecall = await client.callTool(
      {
        name: "memory_recall_agent_memories",
        arguments: {
          query: marker,
          scope: "project",
          scope_kind: null,
          audience_kind: null,
          memory_types: ["work_log"],
          include_candidates: true,
          include_stale: false,
          include_needs_review: true,
          top_k: 5,
          max_chars_total: 4000
        }
      },
      undefined,
      { timeout: 5_000 }
    );
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    const recalledText = JSON.stringify(recall.structuredContent ?? recall.content ?? {});
    const recallFound = recalledText.includes(marker);
    const nextRecalledText = JSON.stringify(
      nextRecall.structuredContent ?? nextRecall.content ?? {}
    );
    const nextRecallFound = nextRecalledText.includes(marker);
    return redactJson(
      {
        status: "pass",
        command: `${basename(invocation.command)} ${invocation.args.join(" ")}`,
        tools: toolNames,
        required_tools: requiredTools,
        marker,
        start_session: {
          is_error: start.isError === true,
          session_id: sessionId
        },
        context_pack: {
          is_error: context.isError === true,
          context_pack_id: context.structuredContent?.context_pack_id ?? null
        },
        memory_write: {
          is_error: created.isError === true,
          memory_id: created.structuredContent?.memory_id ?? null,
          status: created.structuredContent?.status ?? null
        },
        checkpoint: {
          is_error: checkpoint.isError === true,
          updated_at: checkpoint.structuredContent?.updated_at ?? null
        },
        recall: {
          is_error: recall.isError === true,
          marker_found: recallFound,
          trace_id: recall.structuredContent?.trace_id ?? null
        },
        next_session: {
          start_is_error: nextStart.isError === true,
          session_id: nextSessionId,
          context_pack_is_error: nextContext.isError === true,
          context_pack_id: nextContext.structuredContent?.context_pack_id ?? null,
          recall_is_error: nextRecall.isError === true,
          marker_found: nextRecallFound,
          trace_id: nextRecall.structuredContent?.trace_id ?? null
        },
        call_tool: "memory_recall_agent_memories",
        call_is_error:
          start.isError === true ||
          context.isError === true ||
          created.isError === true ||
          checkpoint.isError === true ||
          recall.isError === true ||
          nextStart.isError === true ||
          nextContext.isError === true ||
          nextRecall.isError === true ||
          !recallFound ||
          !nextRecallFound,
        stderr
      },
      input
    );
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    return redactJson(
      {
        status: "fail",
        command: `${basename(invocation.command)} ${invocation.args.join(" ")}`,
        error: error instanceof Error ? error.message : String(error),
        stderr
      },
      input
    );
  }
}

function validateInput(input) {
  const missing = requiredFlags.filter((key) => !String(input[key] ?? "").trim());
  if (!String(input.credential ?? "").trim() && !String(input.credentialRef ?? "").trim()) {
    missing.push("credential or credential-ref");
  }
  if (
    !input.skipBootstrap &&
    !String(input.credential ?? "").trim() &&
    !String(input.credentialRef ?? "").trim()
  ) {
    missing.push("credential (required unless --skip-bootstrap)");
  }
  assert(
    missing.length === 0,
    `missing required inputs: ${missing.map((key) => `--${key}`).join(", ")}`
  );
  const url = new URL(input.serverUrl);
  assert(url.protocol === "https:", "server URL must be HTTPS");
}

function assertNoEvidenceLeaks(evidence, input) {
  const serialized = JSON.stringify(evidence);
  if (input.credential)
    assert(!serialized.includes(input.credential), "evidence leaked raw credential");
  const forbiddenMatch = serialized.match(forbiddenOutputPattern);
  assert(
    !forbiddenMatch,
    `evidence leaked forbidden local surface: ${redact(forbiddenMatch?.[0] ?? "", input)}`
  );
}

function summaryText(evidence) {
  const status = evidence.result.status === "pass" ? "PASS" : "FAIL";
  return [
    `# Recallant Separate-Machine Evidence`,
    "",
    `Result: ${status}`,
    `Run id: [REDACTED_RUN_ID]`,
    `Trace id: [REDACTED_TRACE_ID]`,
    `Session id: [REDACTED_SESSION_ID]`,
    "",
    `- Bootstrap exit: ${evidence.bootstrap?.exit_code ?? "not-run"}`,
    `- Remote doctor exit: ${evidence.remote_doctor?.exit_code ?? "not-run"}`,
    `- Remote bridge MCP: ${evidence.remote_mcp?.status ?? "not-run"}`,
    `- Session/context ready: ${evidence.remote_mcp?.context_pack?.is_error === false}`,
    `- Checkpoint state proof: ${evidence.remote_mcp?.checkpoint?.is_error === false}`,
    `- Semantic marker recall: ${evidence.remote_mcp?.recall?.marker_found === true}`,
    `- Next-session recall: ${evidence.remote_mcp?.next_session?.marker_found === true}`,
    `- Codex config written: ${evidence.client_config?.codex_config_present ?? false}`,
    `- Recallant config entries: ${evidence.client_config?.recallant_codex_config_entries ?? 0}`,
    `- No .recallant/Docker/Postgres artifacts: ${evidence.forbidden_artifacts?.status ?? "not-run"}`,
    `- Secrets redacted: ${evidence.redaction?.status ?? "unknown"}`,
    ...(evidence.result.error ? [`- Error: ${evidence.result.error}`] : []),
    ""
  ].join("\n");
}

const input = parseArgs(process.argv.slice(2));
if (input.mode === "cleanup") {
  await runCleanup(input);
  process.exit(0);
}
const runId = randomUUID();
const outputDir = resolve(input.outputDir);
const projectDir = resolve(input.projectDir);
input.projectDir = projectDir;
await mkdir(outputDir, { recursive: true });

let evidence;
let exitCode = 0;

try {
  const inferredInputs = await hydrateInputFromProjectConfig(input);
  if (
    !input.skipBootstrap &&
    !String(input.credential ?? "").trim() &&
    String(input.credentialRef ?? "").trim()
  ) {
    input.skipBootstrap = true;
    input.skipBootstrapReason =
      "bootstrap skipped: using existing project remote config credential reference";
  }
  validateInput(input);
  const projectStat = await stat(projectDir);
  assert(projectStat.isDirectory(), "project-dir must be a directory");
  const projectRealpath = await realpath(projectDir);
  const env = clientEnv();
  if (input.recallantCommand.endsWith(".js") && !isAbsolute(input.recallantCommand)) {
    input.recallantCommand = resolve(input.recallantCommand);
  }
  const before = await projectSnapshot(projectDir);
  assertCleanSnapshot(before, "before bootstrap");
  const bootstrap = await runBootstrap(input, env);
  const afterBootstrap = await projectSnapshot(projectDir);
  assertCleanSnapshot(afterBootstrap, "after bootstrap");
  assert(
    afterBootstrap.codex_config_present && afterBootstrap.recallant_remote_bridge_configured,
    "bootstrap did not write remote Codex MCP config"
  );
  assert(
    afterBootstrap.recallant_codex_config_entries === 1,
    "remote Codex MCP config is not idempotent"
  );
  const remoteDoctor = await runDoctor(input, env);
  const remoteMcp = await runBridgeProbe(input, env);
  const actualSessionId =
    typeof remoteMcp.start_session?.session_id === "string"
      ? remoteMcp.start_session.session_id
      : input.sessionId || "not-created";
  evidence = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_id: runId,
    trace_id: input.traceId,
    session_id: actualSessionId,
    external_host: {
      hostname_hash: sha256(hostname()),
      platform: platform(),
      os_type: osType(),
      os_release: release(),
      arch: process.arch,
      node: process.version,
      project_dir_hash: sha256(projectRealpath)
    },
    project_dir: {
      basename: basename(projectRealpath),
      hash: sha256(projectRealpath)
    },
    inferred_inputs: inferredInputs,
    bootstrap_mode: input.bootstrapMode === "connect_cloud" ? "connect_cloud" : "scoped_credential",
    bootstrap,
    client_config: afterBootstrap,
    clean_project_before: before,
    remote_doctor: remoteDoctor,
    remote_mcp: remoteMcp,
    capture_recall: {
      requested: input.captureProof || input.semanticProof,
      doctor_stage:
        remoteDoctor.json?.stages?.find?.((stage) => stage.id === "semantic_memory_proof") ??
        remoteDoctor.json?.stages?.find?.((stage) => stage.id === "session_context_readiness") ??
        null
    },
    forbidden_artifacts: {
      status: Object.values(afterBootstrap.forbidden).every((value) => value === false)
        ? "pass"
        : "fail",
      checks: afterBootstrap.forbidden
    },
    redaction: {
      status: "pass",
      raw_credential_present: false
    },
    result: {
      status: "pending"
    }
  };
  const doctorPassed = remoteDoctor.exit_code === 0;
  const bridgePassed = remoteMcp.status === "pass" && remoteMcp.call_is_error === false;
  const capturePassed =
    !(input.captureProof || input.semanticProof) ||
    evidence.capture_recall.doctor_stage?.status === "pass" ||
    evidence.capture_recall.doctor_stage?.code === "semantic_memory_proof_ok" ||
    evidence.capture_recall.doctor_stage?.code === "session_context_readiness_ok";
  const allPassed =
    bootstrap.exit_code === 0 &&
    doctorPassed &&
    bridgePassed &&
    capturePassed &&
    evidence.forbidden_artifacts.status === "pass";
  evidence.result = {
    status: allPassed ? "pass" : "fail",
    criteria: {
      bootstrap: bootstrap.exit_code === 0,
      remote_doctor: doctorPassed,
      remote_mcp_tools_list_and_call: bridgePassed,
      capture_recall: capturePassed,
      no_forbidden_artifacts: evidence.forbidden_artifacts.status === "pass"
    }
  };
  assertNoEvidenceLeaks(evidence, input);
  exitCode = allPassed ? 0 : 1;
} catch (error) {
  evidence = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_id: runId,
    trace_id: input.traceId,
    session_id: input.sessionId || "not-created",
    result: {
      status: "fail",
      error: redact(error instanceof Error ? error.message : String(error), input)
    }
  };
  exitCode = 1;
}

const redactedEvidence = redactJson(evidence, input);
const evidencePath = join(outputDir, `${runId}.evidence.json`);
const summaryPath = join(outputDir, `${runId}.summary.md`);
await mkdir(outputDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(redactedEvidence, null, 2)}\n`);
await writeFile(summaryPath, summaryText(redactedEvidence));

process.stdout.write(summaryText(redactedEvidence));
process.stdout.write(`Evidence JSON: ${evidencePath}\n`);
process.stdout.write(`Evidence summary: ${summaryPath}\n`);
process.exit(exitCode);
