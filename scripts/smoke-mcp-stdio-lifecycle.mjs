import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cliPath = resolve("apps/cli/dist/index.js");

const child = spawn(process.execPath, [cliPath, "mcp-server"], {
  cwd: process.cwd(),
  env: { ...process.env, RECALLANT_DATABASE_URL: "" },
  stdio: ["pipe", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const startedAt = Date.now();
child.stdin.end();
const result = await Promise.race([
  new Promise((resolveResult) => {
    child.once("exit", (code, signal) =>
      resolveResult({ exited: true, code, signal, elapsedMs: Date.now() - startedAt })
    );
  }),
  new Promise((resolveResult) =>
    setTimeout(() => resolveResult({ exited: false, elapsedMs: Date.now() - startedAt }), 1_500)
  )
]);

if (!result.exited) {
  child.kill("SIGTERM");
  await new Promise((resolveResult) => child.once("exit", resolveResult));
}

assert.equal(result.exited, true, "MCP server remained alive after its client closed stdin");
assert.equal(result.code, 0, `MCP server exited unsuccessfully: ${JSON.stringify(result)}`);
assert.equal(
  result.signal,
  null,
  `MCP server was terminated by a signal: ${JSON.stringify(result)}`
);
assert.equal(stdout, "", `MCP server wrote unexpected stdout: ${stdout}`);
assert.equal(stderr, "", `MCP server wrote unexpected stderr: ${stderr}`);

const inFlightChild = spawn(process.execPath, [cliPath, "mcp-server"], {
  cwd: process.cwd(),
  env: { ...process.env, RECALLANT_DATABASE_URL: "" },
  stdio: ["pipe", "pipe", "pipe"]
});
let inFlightStdout = "";
let inFlightStderr = "";
inFlightChild.stdout.on("data", (chunk) => {
  inFlightStdout += chunk;
});
inFlightChild.stderr.on("data", (chunk) => {
  inFlightStderr += chunk;
});
inFlightChild.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: "eof-in-flight",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" }
    }
  })}\n`
);
inFlightChild.stdin.end();
const inFlightResult = await Promise.race([
  new Promise((resolveResult) => {
    inFlightChild.once("exit", (code, signal) => resolveResult({ exited: true, code, signal }));
  }),
  new Promise((resolveResult) => setTimeout(() => resolveResult({ exited: false }), 1_500))
]);
if (!inFlightResult.exited) {
  inFlightChild.kill("SIGTERM");
  await new Promise((resolveResult) => inFlightChild.once("exit", resolveResult));
}
assert.equal(inFlightResult.exited, true, "MCP server remained alive after in-flight EOF");
assert.equal(
  inFlightResult.code,
  0,
  `MCP server in-flight EOF exit failed: ${JSON.stringify(inFlightResult)}`
);
assert.equal(
  inFlightResult.signal,
  null,
  `MCP server in-flight EOF used a signal: ${JSON.stringify(inFlightResult)}`
);
assert.equal(inFlightStderr, "", `MCP server in-flight EOF wrote stderr: ${inFlightStderr}`);
assert.ok(
  inFlightStdout.trim(),
  "MCP server did not acknowledge the in-flight initialize before EOF"
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      stdin_close: "clean_exit",
      in_flight_eof: "clean_exit_after_initialize",
      elapsed_ms: result.elapsedMs
    },
    null,
    2
  )}\n`
);
