import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteMcpProvisioningOutput } from "../apps/cli/dist/client-targets.js";
import { buildManagementChatResponse } from "../apps/server/dist/management-chat.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runWithoutExternalEffects(command, cwd, sentinels) {
  process.stderr.write(`command smoke: checking ${command.slice(0, 48)}\n`);
  const syntax = spawnSync("/bin/sh", ["-n", "-c", command], { encoding: "utf8" });
  process.stderr.write("command smoke: syntax returned\n");
  assert(syntax.status === 0, `copyable command is not valid POSIX shell: ${command}`);
  const result = spawnSync("/bin/sh", ["-c", `recallant() { :; }\n${command}`], {
    cwd,
    encoding: "utf8"
  });
  process.stderr.write("command smoke: isolated execution returned\n");
  assert(result.status === 0, `isolated command parse failed: ${command}\n${result.stderr}`);
  for (const sentinel of sentinels) {
    const probe = spawnSync("test", ["-e", join(cwd, sentinel)]);
    assert(probe.status !== 0, `copyable command executed injected shell syntax: ${sentinel}`);
  }
}

function runCli(args, env = process.env) {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`CLI command could not be spawned: ${args.join(" ")}\n${result.error.message}`);
  }
  assert(result.status === 0, `CLI command failed: ${args.join(" ")}\n${result.stderr}`);
  const stdout = result.stdout.trim();
  assert(stdout.length > 0, `CLI command returned no JSON: ${args.join(" ")}\n${result.stderr}`);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `CLI command returned invalid JSON: ${args.join(" ")}\n${error.message}\n${stdout}`
    );
  }
}

const root = await mkdtemp(join(tmpdir(), "recallant-copyable-command-"));
const sentinels = [
  "r5_project_command_injected",
  "r5_spool_command_injected",
  "r5_provisioning_command_injected",
  "r5_attach_command_injected"
];
const projectAttack = "/tmp/r5-$(touch${IFS}r5_project_command_injected)";
const spoolAttack = "/tmp/r5-$(touch${IFS}r5_spool_command_injected)";
const provisioningAttack = "$(touch${IFS}r5_provisioning_command_injected)";

try {
  process.env.RECALLANT_MANAGEMENT_CHAT_AI = "off";
  const dashboard = {
    current_project: {
      project_id: "11111111-1111-4111-8111-111111111111",
      name: "command-safety",
      primary_path: projectAttack
    },
    projects: []
  };
  const onboarding = await buildManagementChatResponse({
    message: `attach project ${projectAttack}`,
    dashboard
  });
  const onboardingCommands = onboarding.proposed_actions
    .map((action) => action.command)
    .filter(Boolean);
  assert(onboardingCommands.length === 3, "management onboarding command matrix is incomplete");
  for (const command of onboardingCommands) runWithoutExternalEffects(command, root, sentinels);
  process.stderr.write("command smoke: management project passed\n");

  const spool = runCli([
    "spool-status",
    "--project-dir",
    spoolAttack,
    "--spool-dir",
    spoolAttack,
    "--format",
    "json"
  ]);
  for (const command of [spool.replay_command, spool.sync_command, spool.prune_command]) {
    assert(command, "spool command matrix is incomplete");
    runWithoutExternalEffects(command, root, sentinels);
  }
  process.stderr.write("command smoke: spool passed\n");

  const credential = {
    id: "33333333-3333-4333-8333-333333333333",
    project_id: "44444444-4444-4444-8444-444444444444",
    developer_id: "55555555-5555-4555-8555-555555555555",
    client_id: provisioningAttack,
    label: null,
    credential_prefix: "r5-command",
    hash_version: "sha256-v1",
    created_by: "smoke",
    rotated_from_credential_id: null,
    created_at: new Date("2026-09-14T00:00:00Z"),
    updated_at: new Date("2026-09-14T00:00:00Z"),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    status: "active"
  };
  const provisioning = remoteMcpProvisioningOutput({
    action: "create",
    target: "codex",
    serverUrl: "https://recallant.example.com",
    credential,
    bridgeClientId: provisioningAttack,
    credentialSecret: provisioningAttack,
    includeSecret: true,
    projectDir: provisioningAttack,
    bootstrapScriptUrl: "https://recallant.example.com/install-recallant-client-bootstrap.sh"
  });
  runWithoutExternalEffects(provisioning.provisioning.doctor_command, root, sentinels);
  runWithoutExternalEffects(provisioning.provisioning.bridge_command, root, sentinels);
  const bootstrapSyntax = spawnSync("/bin/sh", ["-n", "-c", provisioning.provisioning.command], {
    encoding: "utf8"
  });
  assert(bootstrapSyntax.status === 0, "remote provisioning bootstrap command has invalid syntax");
  assert(
    provisioning.provisioning.command.includes(`'${provisioningAttack}'`),
    "remote provisioning values are not shell quoted"
  );
  process.stderr.write("command smoke: provisioning passed\n");

  const attachSegment = "r5-$(touch${IFS}r5_attach_command_injected)";
  const attachProject = join(root, attachSegment);
  await mkdir(attachProject, { recursive: true });
  const attachEnv = { ...process.env };
  for (const key of ["RECALLANT_DATABASE_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGUSER"]) {
    delete attachEnv[key];
  }
  const attachPlan = runCli(
    ["attach", attachProject, "--target", "codex", "--guided", "--format", "json"],
    attachEnv
  );
  process.stderr.write("command smoke: attach plan returned\n");
  assert(attachPlan.owner_report?.next_step, "attach plan did not return a copyable next step");
  const attachNextCommand = String(attachPlan.owner_report.next_step)
    .replace(/^Run\s+/u, "")
    .replace(/\.$/u, "");
  runWithoutExternalEffects(attachNextCommand, root, sentinels);

  const sourceFiles = {
    cli: await readFile("apps/cli/src/index.ts", "utf8"),
    attach: await readFile("apps/cli/src/attach.ts", "utf8"),
    discovery: await readFile("apps/cli/src/discovery.ts", "utf8"),
    client_targets: await readFile("apps/cli/src/client-targets.ts", "utf8"),
    server: await readFile("apps/server/src/index.ts", "utf8"),
    management_chat: await readFile("apps/server/src/management-chat.ts", "utf8"),
    contracts: await readFile("packages/contracts/src/remote-mcp.ts", "utf8"),
    database: await readFile("packages/db/src/index.ts", "utf8")
  };
  assert(sourceFiles.cli.includes("formatCommandHint(["), "CLI command helper is not used");
  assert(
    sourceFiles.attach.includes("shellQuote(options.projectDir)"),
    "attach hints are not quoted"
  );
  assert(
    sourceFiles.discovery.includes("const commandPath = shellQuote"),
    "discovery path is not quoted"
  );
  assert(
    sourceFiles.client_targets.includes(".map((value) => shellArg(value))"),
    "client target argv is not quoted"
  );
  assert(
    sourceFiles.contracts.includes(".map((value) => shellArg(value))"),
    "contract argv is not quoted"
  );
  assert(
    sourceFiles.server.includes("shellSingleQuote(serverUrl)"),
    "server command values are not quoted"
  );
  assert(
    sourceFiles.management_chat.includes("function shellCommand(argv: string[])"),
    "management commands lack centralized quoting"
  );
  assert(
    !sourceFiles.management_chat.includes("`recallant attach ${projectDir}"),
    "unsafe management attach template remains"
  );
  assert(
    !sourceFiles.database.includes("JSON.stringify(localProjectPath)"),
    "unsafe local cleanup quoting remains"
  );

  process.stdout.write(
    `${JSON.stringify({
      status: "pass",
      runtime_surfaces: [
        "management_project_commands",
        "management_source_db_only_no_command",
        "spool_commands",
        "remote_doctor_command",
        "remote_bridge_command",
        "remote_bootstrap_command",
        "attach_next_step"
      ],
      source_generator_groups: Object.keys(sourceFiles),
      shell_injection_executed: false
    })}\n`
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
