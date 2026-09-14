import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Socket } from "node:net";

assert.equal(process.cwd(), "/workspace/project");
assert.equal(process.env.RECALLANT_ENV_FILE, "/dev/null");
for (const key of [
  "DATABASE_URL",
  "RECALLANT_DATABASE_URL",
  "PGHOST",
  "PGPASSWORD",
  "NODE_OPTIONS"
]) {
  assert.equal(process.env[key], undefined, `${key} leaked from the parent`);
}
for (const path of ["/.recallant", "/root", "/ai", "/run", "/etc", "/workspace/.recallant"]) {
  assert.equal(existsSync(path), false, `Host or ancestor state visible: ${path}`);
}
assert.equal(readFileSync("/dev/null", "utf8"), "");
symlinkSync("/root/.config/recallant/recallant.env", "escape");
assert.equal(existsSync("escape"), false);
assert.throws(() => writeFileSync("/candidate/package.json", "unexpected mutation"));

await new Promise((resolve, reject) => {
  const socket = new Socket();
  socket.setTimeout(1000);
  socket.once("connect", () => {
    socket.destroy();
    reject(new Error("Host network was reachable"));
  });
  socket.once("error", () => {
    socket.destroy();
    resolve();
  });
  socket.once("timeout", () => {
    socket.destroy();
    reject(new Error("Network isolation probe timed out"));
  });
  socket.connect(5432, "192.0.2.1");
});

// Exercise the actual CLI in a remote-only project. Its missing remote hook support
// remains a product defect; this fixture proves that it cannot reach a host ancestor.
mkdirSync(".recallant");
writeFileSync(
  ".recallant/remote-consent.json",
  JSON.stringify({
    schema_version: 1,
    project_id: "00000000-0000-4000-8000-000000000001"
  })
);
const result = spawnSync(
  process.execPath,
  ["/candidate/apps/cli/dist/index.js", "codex-hook", "--debug"],
  {
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      cwd: process.cwd(),
      session_id: "fixture-isolation",
      prompt: "Synthetic isolation check"
    }),
    encoding: "utf8",
    timeout: 5000
  }
);
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
assert.equal(existsSync("/.recallant"), false);
assert.equal(existsSync("/workspace/.recallant"), false);
assert.equal(existsSync(".recallant/current-session.json"), false);
assert.equal(existsSync(".recallant/spool/spool.jsonl"), false);
process.stdout.write(
  JSON.stringify({
    status: "pass",
    host_state_hidden: true,
    inherited_environment_removed: true,
    network_isolated: true,
    source_read_only: true,
    actual_cli_ancestor_probe: "no host writes",
    remote_capture_acceptance: "not claimed"
  }) + "\n"
);
