import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const credential = "separate-machine-fixture-secret";
const expected = {
  projectId: "separate-machine-project",
  developerId: "separate-machine-developer",
  clientId: "separate-machine-client",
  sessionId: "separate-machine-session",
  traceId: "separate-machine-trace"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createTemporaryCertificate() {
  const dir = await mkdtemp(join(tmpdir(), "recallant-separate-machine-cert-"));
  const keyPath = join(dir, "localhost.key");
  const certPath = join(dir, "localhost.crt");
  const configPath = join(dir, "openssl.cnf");
  const config = [
    "[req]",
    "distinguished_name=req_distinguished_name",
    "x509_extensions=v3_req",
    "prompt=no",
    "[req_distinguished_name]",
    "CN=localhost",
    "[v3_req]",
    "subjectAltName=@alt_names",
    "[alt_names]",
    "DNS.1=localhost",
    "IP.1=127.0.0.1"
  ].join("\n");
  await writeFile(configPath, config);
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-config",
    configPath
  ]);
  return {
    dir,
    keyPath,
    certPath,
    key: await readFile(keyPath),
    cert: await readFile(certPath)
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startFixture(cert) {
  const requests = [];
  const server = createServer({ key: cert.key, cert: cert.cert }, async (request, response) => {
    const raw = await readBody(request);
    const body = JSON.parse(raw || "{}");
    requests.push({
      url: request.url,
      method: body.method,
      tool: body.params?.name,
      trace: request.headers["x-recallant-trace-id"]
    });
    if (request.method !== "POST" || request.url !== "/api/mcp") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("wrong endpoint");
      return;
    }
    if (request.headers.authorization !== `Bearer ${credential}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32001, message: "invalid", data: { code: "invalid_credential" } }
        })
      );
      return;
    }
    if (
      request.headers["x-recallant-project-id"] !== expected.projectId ||
      request.headers["x-recallant-developer-id"] !== expected.developerId ||
      request.headers["x-recallant-client-id"] !== expected.clientId
    ) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32003, message: "scope mismatch", data: { code: "scope_mismatch" } }
        })
      );
      return;
    }
    if (body.method === "initialize") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "separate-machine-fixture", version: "0.0.0" }
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
              { name: "memory_create_agent_memory" },
              { name: "memory_set_checkpoint" },
              { name: "memory_recall_agent_memories" },
              { name: "memory_heartbeat" }
            ]
          }
        })
      );
      return;
    }
    if (body.method === "tools/call") {
      const toolName = body.params?.name;
      if (toolName === "memory_start_session") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "started" }],
              structuredContent: {
                session_id: expected.sessionId,
                project_id: expected.projectId,
                recommended_next_calls: ["memory_get_context_pack"]
              }
            }
          })
        );
        return;
      }
      if (toolName === "memory_get_context_pack") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "context" }],
              structuredContent: {
                context_pack_id: "fixture-context-pack",
                session_id: expected.sessionId,
                project_id: expected.projectId
              }
            }
          })
        );
        return;
      }
      if (toolName === "memory_create_agent_memory") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "created" }],
              structuredContent: {
                memory_id: "fixture-memory-id",
                status: "accepted"
              }
            }
          })
        );
        return;
      }
      if (toolName === "memory_set_checkpoint") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "checkpoint" }],
              structuredContent: {
                ok: true,
                updated_at: "2026-06-20T00:00:00.000Z"
              }
            }
          })
        );
        return;
      }
      if (toolName === "memory_recall_agent_memories") {
        const marker = body.params?.arguments?.query ?? "";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `recalled ${marker}` }],
              structuredContent: {
                trace_id: "fixture-recall-trace",
                memories: [{ memory_id: "fixture-memory-id", body: marker }]
              }
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
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { ok: true, trace: request.headers["x-recallant-trace-id"] }
          }
        })
      );
      return;
    }
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "fixture did not start");
  return {
    requests,
    server,
    serverUrl: `https://localhost:${address.port}`
  };
}

let fixture;
let cert;
const temp = await mkdtemp(join(tmpdir(), "recallant-separate-machine-evidence-"));

try {
  cert = await createTemporaryCertificate();
  fixture = await startFixture(cert);
  const projectDir = join(temp, "project");
  const outputDir = join(temp, "evidence");
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "README.md"), "# External rehearsal project\n");
  const wrapper = join(temp, "recallant-wrapper.sh");
  await writeFile(
    wrapper,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `exec ${process.execPath} ${join(process.cwd(), "apps/cli/dist/index.js")} "$@"`,
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_EXTRA_CA_CERTS: cert.certPath,
    RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD: wrapper
  };
  const runId = randomUUID();
  const result = await execFileAsync(
    process.execPath,
    [
      "scripts/remote-mcp-separate-machine-evidence.mjs",
      "--server-url",
      fixture.serverUrl,
      "--credential",
      credential,
      "--project-id",
      expected.projectId,
      "--developer-id",
      expected.developerId,
      "--client-id",
      expected.clientId,
      "--session-id",
      expected.sessionId,
      "--trace-id",
      expected.traceId,
      "--project-dir",
      projectDir,
      "--output-dir",
      outputDir,
      "--recallant-command",
      join(process.cwd(), "apps/cli/dist/index.js"),
      "--capture-proof"
    ],
    { cwd: process.cwd(), env, maxBuffer: 1024 * 1024 }
  );
  assert(!result.stdout.includes(credential), "human summary leaked raw credential");
  const evidenceFiles = (await import("node:fs/promises")).readdir(outputDir);
  const files = await evidenceFiles;
  const evidenceFile = files.find((file) => file.endsWith(".evidence.json"));
  assert(evidenceFile, "evidence JSON was not written");
  const evidenceText = await readFile(join(outputDir, evidenceFile), "utf8");
  assert(!evidenceText.includes(credential), "evidence JSON leaked raw credential");
  assert(
    !/"RECALLANT_DATABASE_URL"|RECALLANT_DATABASE_URL\s*=|DATABASE_URL\s*=|postgres:\/\/|pgvector|recallant-postgres|\/ai\//i.test(
      evidenceText
    )
  );
  const evidence = JSON.parse(evidenceText);
  assert(evidence.result.status === "pass", `evidence did not pass: ${evidenceText}`);
  assert(evidence.bootstrap.exit_code === 0, "bootstrap did not pass");
  assert(evidence.remote_doctor.exit_code === 0, "remote doctor did not pass");
  assert(evidence.remote_mcp.status === "pass", "remote MCP bridge did not pass");
  assert(evidence.capture_recall.requested === true, "capture proof was not requested");
  assert(evidence.forbidden_artifacts.status === "pass", "forbidden artifact check failed");
  assert(evidence.client_config.recallant_codex_config_entries === 1, "Codex config not idempotent");
  assert(
    fixture.requests.some((request) => request.method === "tools/call"),
    "evidence runner did not call a remote MCP tool"
  );
  const failingProject = join(temp, "failing-project");
  const failingOutput = join(temp, "failing-evidence");
  await mkdir(join(failingProject, ".recallant"), { recursive: true });
  await writeFile(join(failingProject, "README.md"), "# Dirty project\n");
  try {
    await execFileAsync(
      process.execPath,
      [
        "scripts/remote-mcp-separate-machine-evidence.mjs",
        "--server-url",
        fixture.serverUrl,
        "--credential",
        credential,
        "--project-id",
        expected.projectId,
        "--developer-id",
        expected.developerId,
        "--client-id",
        expected.clientId,
        "--project-dir",
        failingProject,
        "--output-dir",
        failingOutput,
        "--recallant-command",
        join(process.cwd(), "apps/cli/dist/index.js"),
        "--skip-bootstrap"
      ],
      { cwd: process.cwd(), env, maxBuffer: 1024 * 1024 }
    );
    throw new Error("dirty project rehearsal unexpectedly passed");
  } catch (error) {
    assert(Number(error.code ?? 0) !== 0, "dirty project did not exit non-zero");
    assert(!String(error.stdout ?? "").includes(credential), "dirty project output leaked credential");
  }
  const cleanup = await execFileAsync(
    process.execPath,
    [
      "scripts/remote-mcp-separate-machine-evidence.mjs",
      "cleanup",
      "--project-dir",
      failingProject,
      "--confirm"
    ],
    { cwd: process.cwd(), env, maxBuffer: 1024 * 1024 }
  );
  assert(cleanup.stdout.includes("Status: cleaned"), "remote acceptance cleanup did not clean");
  assert(!(await exists(join(failingProject, ".recallant"))), "cleanup left .recallant behind");
  assert(await exists(join(failingProject, "README.md")), "cleanup removed source file");
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        run_id: runId,
        checks: [
          "redacted_evidence_json",
          "redacted_human_summary",
          "bootstrap_config_written",
          "remote_doctor_capture_proof",
          "remote_bridge_tools_call",
          "forbidden_artifact_failure"
        ]
      },
      null,
      2
    ) + "\n"
  );
} finally {
  fixture?.server.close();
  if (cert?.dir) await rm(cert.dir, { recursive: true, force: true });
  await rm(temp, { recursive: true, force: true });
}
