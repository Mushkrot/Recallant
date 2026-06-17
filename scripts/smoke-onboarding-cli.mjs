import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const repoRoot = process.cwd();
const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();

function runRaw(command, args, options = {}) {
  const env = {
    ...process.env,
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: "",
    RECALLANT_PROJECT_PATH: "",
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "8",
    RECALLANT_SERVER_URL: "http://127.0.0.1:3005",
    ...(options.env ?? {})
  };
  if (options.omitDatabaseUrl) {
    delete env.RECALLANT_DATABASE_URL;
  } else {
    env.RECALLANT_DATABASE_URL = databaseUrl;
  }
  if (options.omitEnvFile) {
    delete env.RECALLANT_ENV_FILE;
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return result;
}

function run(command, args, options = {}) {
  const result = runRaw(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

function runJson(command, args, options = {}) {
  return JSON.parse(run(command, args, options));
}

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

async function projectRowCount(projectPath) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM projects WHERE primary_path = $1",
      [projectPath]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

const prefix = await mkdtemp(join(tmpdir(), "recallant-onboarding-prefix-"));
const projectDir = await mkdtemp(join(tmpdir(), "recallant-onboarding-project-"));
await writeFile(join(projectDir, "README.md"), "# Fresh onboarding smoke\n");

run("bash", ["scripts/install-recallant-cli.sh"], {
  env: {
    PREFIX: prefix
  }
});

const recallant = join(prefix, "recallant");
const lint = runJson(recallant, ["lint-context"], { cwd: projectDir });
assert(lint.ok === true, `installed wrapper did not run lint-context: ${JSON.stringify(lint)}`);

const missingStorageProject = await mkdtemp(
  join(tmpdir(), "recallant-onboarding-missing-storage-")
);
await writeFile(join(missingStorageProject, "README.md"), "# Missing storage onboarding smoke\n");
const missingStorage = runRaw(
  recallant,
  ["onboard", missingStorageProject, "--yes", "--format", "json"],
  {
    cwd: missingStorageProject,
    omitDatabaseUrl: true,
    env: {
      RECALLANT_ENV_FILE: join(missingStorageProject, "missing-recallant.env")
    }
  }
);
assert(
  missingStorage.status === 2,
  `missing storage onboard should exit 2: ${missingStorage.stderr}\n${missingStorage.stdout}`
);
const missingPayload = JSON.parse(missingStorage.stdout);
assert(
  missingPayload.storage?.status === "storage_blocked" &&
    missingPayload.storage?.error_code === "storage_blocked",
  `missing storage did not report storage_blocked: ${JSON.stringify(missingPayload)}`
);
assert(
  missingPayload.attached?.status === "skipped" && missingPayload.connected?.status === "skipped",
  `missing storage should not run attach/connect: ${JSON.stringify(missingPayload)}`
);
assert(
  missingPayload.attached?.command === null && missingPayload.connected?.command === null,
  `missing storage should not expose internal attach/connect command hints: ${JSON.stringify(missingPayload)}`
);
assert(
  String(missingPayload.next_command).startsWith(`recallant onboard ${missingStorageProject}`) &&
    String(missingPayload.next_command).includes("--yes") &&
    !String(missingPayload.next_command).includes("--client") &&
    !String(missingPayload.next_command).includes("--verify") &&
    !String(missingPayload.next_command).includes("--install-local-hooks"),
  `missing storage next command should keep beginner defaults implicit: ${JSON.stringify(missingPayload)}`
);
assert(
  missingPayload.storage?.offline_spool?.role === "fail_soft_capture_fallback" &&
    missingPayload.storage?.offline_spool?.complete_onboarding === false,
  `missing storage did not describe spool as fail-soft fallback: ${JSON.stringify(missingPayload.storage)}`
);
assert(
  !JSON.stringify(missingPayload).includes("recallant_dev_password") &&
    !JSON.stringify(missingPayload).includes(databaseUrl),
  "missing storage output leaked database credentials"
);
const missingStorageText = runRaw(recallant, ["onboard", missingStorageProject], {
  cwd: missingStorageProject,
  omitDatabaseUrl: true,
  env: {
    RECALLANT_ENV_FILE: join(missingStorageProject, "missing-recallant.env")
  }
});
assert(
  missingStorageText.status === 2,
  `missing storage text onboard should exit 2: ${missingStorageText.stderr}\n${missingStorageText.stdout}`
);
assert(
  (missingStorageText.stdout.match(/^Next action:/gm) ?? []).length === 1 &&
    missingStorageText.stdout.includes("Rerun command: recallant onboard") &&
    !missingStorageText.stdout.includes("--client codex") &&
    !missingStorageText.stdout.includes("--verify") &&
    !missingStorageText.stdout.includes("--install-local-hooks") &&
    !missingStorageText.stdout.includes("--yes"),
  `missing storage text output should have one clear next action: ${missingStorageText.stdout}`
);
for (const forbidden of [
  "recallant attach",
  "recallant connect",
  "recallant doctor",
  "agent-start",
  "agent-event",
  "agent-checkpoint",
  "recallant ask",
  "JSON output:"
]) {
  assert(
    !missingStorageText.stdout.includes(forbidden),
    `missing storage text output leaked forbidden command ${forbidden}:\n${missingStorageText.stdout}`
  );
}

const defaultEnvRoot = await mkdtemp(join(tmpdir(), "recallant-onboarding-default-env-"));
const defaultEnvHome = join(defaultEnvRoot, "home");
const defaultEnvDir = join(defaultEnvHome, ".config", "recallant");
await mkdir(defaultEnvDir, { recursive: true });
await writeFile(join(defaultEnvDir, "recallant.env"), `RECALLANT_DATABASE_URL=${databaseUrl}\n`);
const defaultEnvProject = join(defaultEnvRoot, "project");
await mkdir(defaultEnvProject, { recursive: true });
await writeFile(join(defaultEnvProject, "README.md"), "# Default env onboarding smoke\n");
const defaultEnvOnboard = runJson(
  recallant,
  ["onboard", "--client", "codex", "--skip-vcs-safety", "--format", "json"],
  {
    cwd: defaultEnvProject,
    omitDatabaseUrl: true,
    omitEnvFile: true,
    env: {
      HOME: defaultEnvHome
    }
  }
);
assert(
  defaultEnvOnboard.storage?.status === "ready" &&
    defaultEnvOnboard.storage?.env_file_loaded === true &&
    defaultEnvOnboard.storage?.env_source === "default_env_file",
  `onboard did not load default env file: ${JSON.stringify(defaultEnvOnboard.storage)}`
);
assert(
  !JSON.stringify(defaultEnvOnboard).includes("recallant_dev_password") &&
    !JSON.stringify(defaultEnvOnboard).includes(databaseUrl),
  "default env onboard output leaked database credentials"
);

const explicitEnvProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-explicit-env-"));
await writeFile(join(explicitEnvProject, "README.md"), "# Explicit env onboarding smoke\n");
const explicitEnvOnboard = runJson(
  recallant,
  ["onboard", "--client", "codex", "--skip-vcs-safety", "--format", "json"],
  { cwd: explicitEnvProject }
);
assert(
  explicitEnvOnboard.storage?.status === "ready" &&
    explicitEnvOnboard.storage?.env_source === "explicit_env",
  `onboard did not reuse explicit database env: ${JSON.stringify(explicitEnvOnboard.storage)}`
);
assert(
  !JSON.stringify(explicitEnvOnboard).includes("recallant_dev_password") &&
    !JSON.stringify(explicitEnvOnboard).includes(databaseUrl),
  "explicit env onboard output leaked database credentials"
);

const vcsChoiceProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-vcs-choice-"));
await writeFile(join(vcsChoiceProject, "README.md"), "# Version-control safety smoke\n");
const vcsChoice = runRaw(recallant, ["onboard", vcsChoiceProject], {
  cwd: vcsChoiceProject
});
assert(
  vcsChoice.status === 2,
  `vcs choice should exit 2: ${vcsChoice.stderr}\n${vcsChoice.stdout}`
);
assert(
  vcsChoice.stdout.includes("Version-control safety choices") &&
    vcsChoice.stdout.includes("Initialize Git") &&
    vcsChoice.stdout.includes("Continue without Git"),
  `vcs choice output should offer initialize/refuse choices: ${vcsChoice.stdout}`
);
assert(!(await exists(join(vcsChoiceProject, ".recallant", "config"))), "vcs choice wrote config");
assert((await projectRowCount(vcsChoiceProject)) === 0, "vcs choice wrote database row");

const vcsInitProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-vcs-init-"));
await writeFile(join(vcsInitProject, "README.md"), "# Version-control init smoke\n");
const vcsInit = runJson(recallant, ["onboard", vcsInitProject, "--yes", "--format", "json"], {
  cwd: vcsInitProject
});
assert(
  vcsInit.version_control?.status === "initialized" &&
    vcsInit.version_control?.initialized === true &&
    vcsInit.version_control?.writes_files === true,
  `--yes should initialize Git before onboarding writes: ${JSON.stringify(vcsInit.version_control)}`
);
assert(await exists(join(vcsInitProject, ".git")), "--yes vcs init did not create .git");

const productionProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-production-"));
await writeFile(
  join(productionProject, "README.md"),
  "# Production service\n\nThis project deploys a production service through public deployment.\n"
);
await writeFile(
  join(productionProject, "AGENTS.md"),
  "# Existing Agent Notes\n\nKeep deployment notes under review. API_SECRET=super-secret-value\n"
);
await writeFile(join(productionProject, ".env.example"), "API_SECRET=super-secret-value\n");
run("git", ["-C", productionProject, "init"]);

const wizard = runRaw(recallant, ["onboard", productionProject], {
  cwd: productionProject
});
assert(wizard.status === 2, `production wizard should exit 2: ${wizard.stderr}\n${wizard.stdout}`);
for (const marker of [
  "Production-sensitive onboarding review",
  "Project path:",
  "Risk reason:",
  "Planned writes:",
  "Backup behavior:",
  "Import/review behavior:",
  "Continue/cancel prompt:",
  "In automation, use --yes only after approving this plan."
]) {
  assert(wizard.stdout.includes(marker), `wizard output missing ${marker}:\n${wizard.stdout}`);
}
assert(!wizard.stdout.includes("recallant attach"), "wizard leaked attach handoff command");
assert(!(await exists(join(productionProject, ".recallant", "config"))), "wizard wrote config");
assert((await projectRowCount(productionProject)) === 0, "wizard wrote database row");

const cancel = runRaw(recallant, ["onboard", productionProject, "--cancel", "--format", "json"], {
  cwd: productionProject
});
assert(cancel.status === 3, `cancel should exit 3: ${cancel.stderr}\n${cancel.stdout}`);
const cancelPayload = JSON.parse(cancel.stdout);
assert(cancelPayload.status === "cancelled", `cancel did not report cancelled: ${cancel.stdout}`);
assert(
  cancelPayload.attach_details?.writes_files === false &&
    cancelPayload.attach_details?.writes_database === false,
  `cancel should report no writes: ${JSON.stringify(cancelPayload.attach_details)}`
);
assert(!(await exists(join(productionProject, ".recallant", "config"))), "cancel wrote config");
assert((await projectRowCount(productionProject)) === 0, "cancel wrote database row");

const dryRun = runJson(recallant, ["onboard", productionProject, "--dry-run", "--format", "json"], {
  cwd: productionProject
});
assert(
  dryRun.status === "plan_only",
  `dry-run did not return plan_only: ${JSON.stringify(dryRun)}`
);
assert(
  dryRun.attach_details?.writes_files === false &&
    dryRun.attach_details?.writes_database === false &&
    dryRun.attach_details?.migration_summary?.selected_imports >= 1,
  `dry-run did not expose safe attach plan: ${JSON.stringify(dryRun.attach_details)}`
);
assert(!(await exists(join(productionProject, ".recallant", "config"))), "dry-run wrote config");
assert((await projectRowCount(productionProject)) === 0, "dry-run wrote database row");

const productionYes = runJson(
  recallant,
  ["onboard", productionProject, "--yes", "--format", "json"],
  { cwd: productionProject }
);
assert(
  productionYes.attached?.status === "attached" &&
    productionYes.attach_details?.writes_files === true &&
    productionYes.attach_details?.writes_database === true,
  `--yes did not complete production-sensitive attach: ${JSON.stringify(productionYes)}`
);
assert(
  productionYes.attach_details?.migration_summary?.local_backup_created === true &&
    productionYes.attach_details?.migration_summary?.review_needed >= 1,
  `--yes did not preserve backup/review summary: ${JSON.stringify(productionYes.attach_details)}`
);
assert(
  !JSON.stringify(productionYes).includes("super-secret-value") &&
    !JSON.stringify(productionYes).includes(databaseUrl),
  "--yes onboard output leaked secret-like values"
);
assert(await exists(join(productionProject, ".recallant", "config")), "--yes did not write config");
assert((await projectRowCount(productionProject)) === 1, "--yes did not write database row");

const oneCommandProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-one-command-"));
await writeFile(join(oneCommandProject, "README.md"), "# One-command onboarding proof\n");
const oneCommand = runJson(recallant, ["onboard", oneCommandProject, "--yes", "--format", "json"], {
  cwd: oneCommandProject
});
assert(
  oneCommand.client === "codex" &&
    oneCommand.install_local_hooks === true &&
    oneCommand.verify_requested === true,
  `one-command defaults should select Codex hooks and verify: ${JSON.stringify(oneCommand)}`
);
assert(
  oneCommand.connected?.status === "connected" && oneCommand.verify?.status === "passed",
  `one-command onboard did not connect and verify: ${JSON.stringify(oneCommand)}`
);
assert(
  oneCommand.verify?.proof?.demo === "done" &&
    oneCommand.verify?.proof?.doctor === "done" &&
    oneCommand.verify?.proof?.ask === "done",
  `one-command legacy proof statuses incomplete: ${JSON.stringify(oneCommand.verify)}`
);
assert(
  oneCommand.verify?.stages?.capture?.status === "done" &&
    oneCommand.verify?.stages?.readiness?.status === "done" &&
    oneCommand.verify?.stages?.recall?.status === "done" &&
    oneCommand.verify?.capture_active === true,
  `one-command structured proof stages incomplete: ${JSON.stringify(oneCommand.verify)}`
);
assert(
  oneCommand.verify?.evidence?.context_read === true &&
    oneCommand.verify?.evidence?.memory_write === true &&
    oneCommand.verify?.evidence?.checkpoint === true &&
    oneCommand.verify?.evidence?.recall === true,
  `one-command proof evidence incomplete: ${JSON.stringify(oneCommand.verify?.evidence)}`
);
assert(
  ["no_pending", "recovered"].includes(oneCommand.embedding_recovery?.status) &&
    oneCommand.embedding_recovery?.scope?.project_scoped === true &&
    oneCommand.embedding_recovery?.scope?.bounded === true &&
    oneCommand.embedding_recovery?.limit === 50,
  `one-command embedding recovery status incomplete: ${JSON.stringify(
    oneCommand.embedding_recovery
  )}`
);
assert(
  oneCommand.workbench?.available === true &&
    typeof oneCommand.workbench?.url === "string" &&
    oneCommand.workbench.url.includes("/review") &&
    oneCommand.workbench?.auth_required === true &&
    oneCommand.workbench?.project_visible === true,
  `one-command workbench outcome incomplete: ${JSON.stringify(oneCommand.workbench)}`
);

const humanProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-human-success-"));
await writeFile(join(humanProject, "README.md"), "# Human success onboarding proof\n");
const humanSuccess = runRaw(recallant, ["onboard", humanProject, "--yes"], { cwd: humanProject });
assert(
  humanSuccess.status === 0,
  `human success failed: ${humanSuccess.stderr}\n${humanSuccess.stdout}`
);
assert(
  humanSuccess.stdout.includes("Capture active: yes") &&
    humanSuccess.stdout.includes("context read, memory write, checkpoint, and recall proof"),
  `human success output did not explain capture-active proof: ${humanSuccess.stdout}`
);
assert(
  humanSuccess.stdout.includes("Embedding recovery:"),
  `human success output did not include embedding recovery state: ${humanSuccess.stdout}`
);
assert(
  humanSuccess.stdout.includes("Workbench:") &&
    humanSuccess.stdout.includes("auth required") &&
    humanSuccess.stdout.includes("Workbench project visible: yes"),
  `human success output did not include Workbench outcome: ${humanSuccess.stdout}`
);
for (const forbidden of [
  "recallant attach",
  "recallant connect",
  "agent-start",
  "agent-event",
  "agent-checkpoint",
  "doctor",
  "ask"
]) {
  assert(
    !humanSuccess.stdout.includes(forbidden),
    `human success output leaked internal command ${forbidden}:\n${humanSuccess.stdout}`
  );
}

const attach = runJson(recallant, ["attach", ".", "--format", "json"], { cwd: projectDir });
assert(attach.status === "attached", `installed wrapper attach failed: ${JSON.stringify(attach)}`);
assert(
  attach.requested_mode === "autopilot" && attach.effective_mode === "autopilot",
  `installed wrapper attach did not use ordinary autopilot: ${JSON.stringify(attach)}`
);

const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
assert(
  agents.includes("recallant agent-start"),
  "installed wrapper attach did not write capture runtime instructions"
);

const start = runJson(recallant, ["agent-start", "--task-hint", "fresh onboarding smoke"], {
  cwd: projectDir
});
assert(start.session_id, `installed wrapper agent-start failed: ${JSON.stringify(start)}`);

const event = runJson(
  recallant,
  [
    "agent-event",
    "--kind",
    "decision",
    "--text",
    "Fresh onboarding smoke decision: installed recallant wrapper can attach and capture work."
  ],
  { cwd: projectDir }
);
assert(
  event.memory?.status === "accepted",
  `installed wrapper decision was not captured: ${JSON.stringify(event)}`
);

const closeout = runJson(
  recallant,
  ["agent-closeout", "--summary", "Fresh onboarding smoke completed through installed wrapper."],
  { cwd: projectDir }
);
const closeoutWarnings = closeout.closeout?.warnings ?? [];
const onlyModelWarning =
  closeout.closeout?.report_required === true &&
  Array.isArray(closeoutWarnings) &&
  closeoutWarnings.length === 1 &&
  closeoutWarnings[0] === "Recent model/provider errors exist for this project.";
assert(
  closeout.closeout?.report_required === false || onlyModelWarning,
  `installed wrapper closeout warned: ${JSON.stringify(closeout)}`
);

process.stdout.write("Onboarding CLI smoke passed\n");
