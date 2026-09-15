import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve("apps/cli/dist/index.js");
const projectId = "11111111-1111-4111-8111-111111111111";
const developerId = "22222222-2222-4222-8222-222222222222";
const projectDir = await mkdtemp(join(tmpdir(), "recallant-r2-remote-only-"));
const parentDir = await mkdtemp(join(tmpdir(), "recallant-r2-parent-"));

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      RECALLANT_ENV_FILE: "/dev/null",
      RECALLANT_DATABASE_URL: ""
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, "", result.stderr);
  return JSON.parse(result.stdout);
}

try {
  await mkdir(join(projectDir, ".recallant"), { recursive: true });
  await writeFile(
    join(projectDir, ".recallant", "remote-consent.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        kind: "recallant_remote_agent_consent",
        created_at: "2026-09-09T00:00:00.000Z",
        approval_mode: "scoped_credential",
        consent_scope: {
          destination: { server_url: "https://recallant.example.test", endpoint_path: "/api/mcp" },
          credential_scope: {
            project_id: projectId,
            developer_id: developerId,
            client_id: "remote-r2-fixture",
            credential_prefix: "rcl_test"
          },
          allowed_context: [],
          redaction_boundary: [],
          not_sent: [],
          recommended_next_call: "memory_get_context_pack",
          recommended_next_proof_call: "memory_create_agent_memory",
          recommended_next_proof_followup_call: "memory_recall_agent_memories"
        },
        credential_ref: "fixture-ref",
        credential_store_path: "/tmp/fixture-credentials.json",
        no_raw_credentials_or_private_keys: true
      },
      null,
      2
    )}\n`
  );
  const dryRun = run([
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert.equal(dryRun.connection_status, "mcp_and_hooks_planned");
  assert.equal(dryRun.project_id, projectId);
  assert.equal(dryRun.writes_files, false);
  assert.equal(dryRun.writes_global_config, false);

  const connected = run([
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--format",
    "json"
  ]);
  assert.equal(connected.connection_status, "mcp_and_hooks_ready");
  assert.equal(connected.developer_id, developerId);
  const remoteConfig = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
  assert.match(remoteConfig, /remote-bridge/);
  assert.match(remoteConfig, /RECALLANT_REMOTE_MCP_CREDENTIAL_REF/);
  assert.doesNotMatch(remoteConfig, /RECALLANT_DATABASE_URL/);

  const before = await readFile(join(projectDir, ".codex", "config.toml"), "utf8");
  const reconnect = run([
    "connect",
    "codex",
    "--project-dir",
    projectDir,
    "--install-local-hooks",
    "--dry-run",
    "--format",
    "json"
  ]);
  assert.equal(reconnect.connection_status, "mcp_and_hooks_ready");
  assert.ok(reconnect.planned_changes.every((change) => change.action === "no_change"));
  assert.equal(await readFile(join(projectDir, ".codex", "config.toml"), "utf8"), before);

  await writeFile(join(parentDir, ".recallant", "config"), "{}\n").catch(() => undefined);
  const nestedDir = join(projectDir, "nested");
  await mkdir(nestedDir);
  const nested = spawnSync(process.execPath, [cliPath, "codex-hook", "--debug"], {
    cwd: nestedDir,
    env: { ...process.env, RECALLANT_ENV_FILE: "/dev/null", RECALLANT_DATABASE_URL: "" },
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      cwd: nestedDir,
      session_id: "r2-boundary-check",
      prompt: "boundary check"
    }),
    encoding: "utf8"
  });
  assert.equal(nested.status, 0);
  assert.match(nested.stderr, /project_not_connected/);
  process.stdout.write(
    `${JSON.stringify(
      {
        r2_remote_only_connect: "passed",
        remote_only_without_local_database: "passed",
        protected_credential_reference: "passed",
        reconnect_idempotency: "passed",
        native_hook_boundary: "passed"
      },
      null,
      2
    )}\n`
  );
} finally {
  await rm(projectDir, { recursive: true, force: true });
  await rm(parentDir, { recursive: true, force: true });
}
