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

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function excerptFrom(text, marker, lineCount) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  if (start < 0) return [];
  return lines.slice(start, start + lineCount);
}

function assertSameStringSet(actual, expected, message) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${message}: expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`
  );
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

async function projectSettingCount(projectPath, key) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT count(*)::int AS count
        FROM project_settings settings
        JOIN projects project ON project.id = settings.project_id
        WHERE project.primary_path = $1 AND settings.key = $2
      `,
      [projectPath, key]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function projectSettingValueByPath(projectPath, key) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT settings.value
        FROM project_settings settings
        JOIN projects project ON project.id = settings.project_id
        WHERE project.primary_path = $1 AND settings.key = $2
        LIMIT 1
      `,
      [projectPath, key]
    );
    return result.rows[0]?.value ?? null;
  } finally {
    await client.end();
  }
}

async function assertFileIncludes(path, marker, message) {
  const content = await readFile(path, "utf8");
  assert(content.includes(marker), `${message}: ${content}`);
  return content;
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
  missingPayload.storage?.setup_choices?.some(
    (choice) => choice.id === "connect_existing_server"
  ) &&
    missingPayload.storage?.remote_connect?.command ===
      "curl -fsSL http://127.0.0.1:3005/connect | bash",
  `missing storage did not offer remote central-server connect: ${JSON.stringify(missingPayload.storage)}`
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
    missingStorageText.stdout.includes("curl -fsSL http://127.0.0.1:3005/connect | bash") &&
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

const universalMissingStorage = runRaw(
  recallant,
  ["connect", missingStorageProject, "--yes", "--format", "json"],
  {
    cwd: missingStorageProject,
    omitDatabaseUrl: true,
    env: {
      RECALLANT_ENV_FILE: join(missingStorageProject, "missing-recallant.env"),
      RECALLANT_CONNECT_SERVER_URL: "",
      RECALLANT_REMOTE_CONNECT_SERVER_URL: "",
      RECALLANT_REMOTE_MCP_URL: "",
      RECALLANT_PUBLIC_WORKBENCH_URL: "",
      RECALLANT_SERVER_URL: ""
    }
  }
);
assert(
  universalMissingStorage.status === 2,
  `universal missing storage should exit 2: ${universalMissingStorage.stderr}\n${universalMissingStorage.stdout}`
);
const universalMissingPayload = JSON.parse(universalMissingStorage.stdout);
assert(
  universalMissingPayload.action === "connect" &&
    universalMissingPayload.status === "choice_required" &&
    universalMissingPayload.choices?.some((choice) => choice.id === "existing_central_server") &&
    universalMissingPayload.choices?.some((choice) => choice.id === "local_storage"),
  `universal missing storage should require explicit route choice: ${JSON.stringify(
    universalMissingPayload
  )}`
);
assert(
  String(universalMissingPayload.remote_command).includes("--server-url <https-url>") &&
    String(universalMissingPayload.local_command).includes("--local"),
  `universal missing storage did not print both route commands: ${JSON.stringify(
    universalMissingPayload
  )}`
);

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

const wrapperEnvRoot = await mkdtemp(join(tmpdir(), "recallant-onboarding-wrapper-env-"));
const wrapperEnvPrefix = join(wrapperEnvRoot, "bin");
const wrapperEnvFile = join(wrapperEnvRoot, "recallant.env");
await writeFile(wrapperEnvFile, `RECALLANT_DATABASE_URL=${databaseUrl}\n`);
run("bash", ["scripts/install-recallant-cli.sh"], {
  env: {
    PREFIX: wrapperEnvPrefix,
    RECALLANT_CLI_ENV_FILE: wrapperEnvFile
  }
});
const wrapperEnvRecallant = join(wrapperEnvPrefix, "recallant");
const wrapperEnvProject = join(wrapperEnvRoot, "project");
await mkdir(wrapperEnvProject, { recursive: true });
await writeFile(join(wrapperEnvProject, "README.md"), "# Wrapper env onboarding smoke\n");
const wrapperEnvOnboard = runJson(
  wrapperEnvRecallant,
  ["onboard", wrapperEnvProject, "--skip-vcs-safety", "--format", "json"],
  {
    cwd: wrapperEnvProject,
    omitDatabaseUrl: true,
    omitEnvFile: true
  }
);
assert(
  wrapperEnvOnboard.storage?.status === "ready" &&
    wrapperEnvOnboard.storage?.env_file_loaded === true &&
    wrapperEnvOnboard.storage?.env_source === "explicit_env_file" &&
    wrapperEnvOnboard.attached?.status === "attached" &&
    wrapperEnvOnboard.connected?.status === "connected" &&
    wrapperEnvOnboard.verify?.status === "passed",
  `installed wrapper env file did not keep onboarding one-command: ${JSON.stringify(
    wrapperEnvOnboard
  )}`
);
assert(
  !JSON.stringify(wrapperEnvOnboard).includes("recallant_dev_password") &&
    !JSON.stringify(wrapperEnvOnboard).includes(databaseUrl),
  "wrapper env onboard output leaked database credentials"
);

const emptyStarterProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-empty-starter-"));
const emptyStarterDryRun = runJson(
  recallant,
  ["onboard", emptyStarterProject, "--skip-vcs-safety", "--dry-run", "--format", "json"],
  { cwd: emptyStarterProject }
);
assert(
  emptyStarterDryRun.documentation_posture?.status === "docs_absent" &&
    emptyStarterDryRun.attach_details?.starter_docs?.plan?.status === "ready" &&
    emptyStarterDryRun.attach_details?.starter_docs?.plan?.writes_files === false &&
    emptyStarterDryRun.attach_details?.starter_docs?.outcome === null,
  `empty starter dry-run did not expose read-only starter plan: ${JSON.stringify(emptyStarterDryRun)}`
);
for (const file of ["README.md", "AGENTS.md", "PROJECT_LOG.md"]) {
  assert(!(await exists(join(emptyStarterProject, file))), `dry-run wrote ${file}`);
}
const emptyStarter = runJson(
  recallant,
  ["onboard", emptyStarterProject, "--skip-vcs-safety", "--yes", "--format", "json"],
  { cwd: emptyStarterProject }
);
assert(
  emptyStarter.attach_details?.starter_docs?.outcome?.status === "generated" &&
    emptyStarter.attach_details?.starter_docs?.outcome?.generated_files.includes("README.md") &&
    emptyStarter.attach_details?.starter_docs?.outcome?.generated_files.includes("AGENTS.md") &&
    emptyStarter.attach_details?.starter_docs?.outcome?.generated_files.includes("PROJECT_LOG.md"),
  `empty starter onboard did not generate base docs: ${JSON.stringify(
    emptyStarter.attach_details?.starter_docs
  )}`
);
assertSameStringSet(
  emptyStarter.attach_details?.starter_docs?.outcome?.generated_files ?? [],
  ["README.md", "AGENTS.md", "PROJECT_LOG.md"],
  "empty unknown starter should generate exactly base docs"
);
await assertFileIncludes(
  join(emptyStarterProject, "README.md"),
  "Recallant is attached",
  "empty starter README missing Recallant guidance"
);
await assertFileIncludes(
  join(emptyStarterProject, "AGENTS.md"),
  "recallant agent-start",
  "empty starter AGENTS missing CLI fallback"
);
await assertFileIncludes(
  join(emptyStarterProject, "AGENTS.md"),
  "memory_start_session",
  "empty starter AGENTS missing MCP workflow guidance"
);
const emptyStarterAgents = await readFile(join(emptyStarterProject, "AGENTS.md"), "utf8");
assert(
  countOccurrences(emptyStarterAgents.toLowerCase(), "normal mcp closeout path") === 1,
  `empty starter AGENTS should have exactly one normal MCP closeout path: ${emptyStarterAgents}`
);
assert(
  emptyStarterAgents.includes("memory_closeout") &&
    emptyStarterAgents.includes("searchable memory, recall verification") &&
    emptyStarterAgents.includes("next-session readiness semantics"),
  `empty starter AGENTS missing high-level MCP closeout semantics: ${emptyStarterAgents}`
);
assert(
  emptyStarterAgents.includes("recallant agent-closeout") &&
    emptyStarterAgents.includes("CLI fallback closeout path"),
  `empty starter AGENTS missing CLI fallback closeout path: ${emptyStarterAgents}`
);
assert(
  emptyStarterAgents.includes("memory_set_checkpoint") &&
    emptyStarterAgents.includes("checkpoint state; it is not semantic recall proof") &&
    emptyStarterAgents.includes("recallant agent-checkpoint") &&
    emptyStarterAgents.includes("advanced pause/compaction state helper"),
  `empty starter AGENTS did not keep checkpoint wording state-only: ${emptyStarterAgents}`
);
const emptyStarterDocsCombined = [
  await readFile(join(emptyStarterProject, "README.md"), "utf8"),
  emptyStarterAgents,
  await readFile(join(emptyStarterProject, "PROJECT_LOG.md"), "utf8")
].join("\n");
for (const marker of ["old handoff", "super-secret-value", "raw old handoff"]) {
  assert(
    !emptyStarterDocsCombined.toLowerCase().includes(marker),
    `generated starter docs leaked disallowed marker ${marker}`
  );
}
assert(
  await exists(join(emptyStarterProject, "PROJECT_LOG.md")),
  "empty starter PROJECT_LOG missing"
);

async function onboardProfileStarter(name, envText, expectedFiles) {
  const profileProject = await mkdtemp(join(tmpdir(), `recallant-onboarding-${name}-starter-`));
  await writeFile(join(profileProject, ".env.example"), envText);
  const result = runJson(
    recallant,
    ["onboard", profileProject, "--skip-vcs-safety", "--yes", "--format", "json"],
    { cwd: profileProject }
  );
  const generated = result.attach_details?.starter_docs?.outcome?.generated_files ?? [];
  assertSameStringSet(generated, expectedFiles, `${name} starter generated unexpected file set`);
  for (const file of expectedFiles) {
    assert(await exists(join(profileProject, file)), `${name} starter did not write ${file}`);
    assert(
      generated.includes(file),
      `${name} starter outcome missing ${file}: ${JSON.stringify(result)}`
    );
  }
  return { project: profileProject, result };
}

const serviceStarter = await onboardProfileStarter("service", "SERVICE=\nPORT=\n", [
  "README.md",
  "AGENTS.md",
  "PROJECT_LOG.md",
  "docs/RUNBOOK.md",
  "docs/ARCHITECTURE.md"
]);
assert(
  serviceStarter.result.documentation_posture?.profile === "service_app",
  `service starter profile failed: ${JSON.stringify(serviceStarter.result.documentation_posture)}`
);

const productStarter = await onboardProfileStarter("product", "PRODUCT=\nMILESTONE=\n", [
  "README.md",
  "AGENTS.md",
  "PROJECT_LOG.md",
  "docs/STATUS.md",
  "docs/DECISIONS.md"
]);
assert(
  productStarter.result.documentation_posture?.profile === "product_roadmap",
  `product starter profile failed: ${JSON.stringify(productStarter.result.documentation_posture)}`
);

const libraryStarter = await onboardProfileStarter("library", "PACKAGE=\nSDK=\n", [
  "README.md",
  "AGENTS.md",
  "PROJECT_LOG.md",
  "docs/API.md"
]);
assert(
  libraryStarter.result.documentation_posture?.profile === "library_package",
  `library starter profile failed: ${JSON.stringify(libraryStarter.result.documentation_posture)}`
);

const vcsChoiceProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-vcs-choice-"));
await writeFile(join(vcsChoiceProject, "README.md"), "# Version-control safety smoke\n");
const vcsChoice = runRaw(recallant, ["onboard", vcsChoiceProject], {
  cwd: vcsChoiceProject,
  env: { GIT_CEILING_DIRECTORIES: tmpdir() }
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

const parentWorktree = await mkdtemp(join(tmpdir(), "recallant-onboarding-parent-worktree-"));
run("git", ["init", parentWorktree], { cwd: parentWorktree });
const nestedProject = join(parentWorktree, "nested-project");
await mkdir(nestedProject, { recursive: true });
await writeFile(join(nestedProject, "README.md"), "# Nested project VCS safety smoke\n");
const nestedChoice = runRaw(recallant, ["onboard", nestedProject], { cwd: nestedProject });
assert(
  nestedChoice.status === 2 && nestedChoice.stdout.includes("Version-control safety choices"),
  `nested project should require its own VCS choice: ${nestedChoice.stderr}\n${nestedChoice.stdout}`
);
assert(!(await exists(join(nestedProject, ".recallant", "config"))), "nested VCS choice wrote config");
assert((await projectRowCount(nestedProject)) === 0, "nested VCS choice wrote database row");

const vcsInitProject = await mkdtemp(join(tmpdir(), "recallant-onboarding-vcs-init-"));
await writeFile(join(vcsInitProject, "README.md"), "# Version-control init smoke\n");
const vcsInit = runJson(recallant, ["onboard", vcsInitProject, "--yes", "--format", "json"], {
  cwd: vcsInitProject,
  env: { GIT_CEILING_DIRECTORIES: tmpdir() }
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
  "Documentation posture: risky",
  "Found:",
  "Workbench:",
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
assert(
  wizard.stdout.indexOf("Documentation posture:") <
    wizard.stdout.indexOf("Continue/cancel prompt:"),
  `wizard posture should appear before confirmation prompt:\n${wizard.stdout}`
);
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
assert(
  (await projectSettingCount(productionProject, "documentation_posture")) === 0,
  "cancel wrote documentation posture setting"
);
assert(
  (await projectSettingCount(productionProject, "starter_docs")) === 0,
  "cancel wrote starter docs setting"
);

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
assert(
  dryRun.documentation_posture?.status === "needs_review" &&
    dryRun.documentation_posture?.writes_files === false &&
    dryRun.documentation_posture?.writes_database === false &&
    dryRun.attach_details?.documentation_posture?.status === "needs_review",
  `dry-run did not expose read-only documentation posture: ${JSON.stringify(dryRun)}`
);
assert(!(await exists(join(productionProject, ".recallant", "config"))), "dry-run wrote config");
assert((await projectRowCount(productionProject)) === 0, "dry-run wrote database row");
assert(
  (await projectSettingCount(productionProject, "documentation_posture")) === 0,
  "dry-run wrote documentation posture setting"
);
assert(
  (await projectSettingCount(productionProject, "starter_docs")) === 0,
  "dry-run wrote starter docs setting"
);

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
assert(
  productionYes.documentation_posture?.status === "needs_review" &&
    productionYes.documentation_posture?.review_options?.some(
      (option) => option.option === "canonicalize_for_recallant"
    ),
  `--yes onboard did not preserve documentation posture: ${JSON.stringify(
    productionYes.documentation_posture
  )}`
);
assert(await exists(join(productionProject, ".recallant", "config")), "--yes did not write config");
assert((await projectRowCount(productionProject)) === 1, "--yes did not write database row");
const storedPosture = await projectSettingValueByPath(productionProject, "documentation_posture");
assert(
  storedPosture?.status === "needs_review" && storedPosture?.authority?.instruction_grade === false,
  `documentation posture setting was not stored compactly: ${JSON.stringify(storedPosture)}`
);
assert(
  !JSON.stringify(storedPosture).includes("super-secret-value") &&
    !JSON.stringify(storedPosture).includes(databaseUrl),
  "documentation posture setting leaked secret-like values"
);
const contextPack = runJson(
  recallant,
  ["context", "--project-dir", productionProject, "--task-hint", "documentation posture startup"],
  { cwd: productionProject }
);
const contextPosture = contextPack.sections?.documentation_posture;
const contextCanon = contextPack.sections?.canon_capability_context;
assert(
  contextPosture?.status === "needs_review" &&
    contextPosture?.profile === "service_app" &&
    Array.isArray(contextPosture?.missing_recommended_docs) &&
    contextPosture.missing_recommended_docs.length > 0 &&
    contextPosture?.authority?.key === "documentation_posture" &&
    Array.isArray(contextPosture?.capability_hints),
  `context pack did not include documentation posture: ${JSON.stringify(contextPack.sections)}`
);
assert(
  contextCanon?.schema_version === 1 &&
    Array.isArray(contextCanon?.environment_facts) &&
    Array.isArray(contextCanon?.capability_references) &&
    Array.isArray(contextCanon?.secret_references) &&
    Array.isArray(contextCanon?.server_canon_links) &&
    Array.isArray(contextCanon?.documentation_authority_map) &&
    contextCanon?.authority?.instruction_grade === false,
  `context pack did not include canon/capability context: ${JSON.stringify(contextPack.sections)}`
);
assert(
  contextCanon.server_canon_links.some((item) => item.status === "needed") &&
    contextCanon.environment_facts.length > 0 &&
    contextCanon.capability_references.length > 0 &&
    contextCanon.secret_references.length > 0 &&
    contextCanon.documentation_authority_map.length > 0 &&
    contextCanon.server_canon_links.length <= 8 &&
    contextCanon.documentation_authority_map.length <= 8,
  `context pack canon/capability section is not bounded or lacks canon links: ${JSON.stringify(
    contextCanon
  )}`
);
assert(
  Array.isArray(contextPack.sections?.binding_rules) &&
    Array.isArray(contextPack.sections?.working_memories) &&
    contextPack.sections?.checkpoint !== undefined &&
    contextPack.sections?.local_spool_status !== undefined,
  `context pack compatibility sections changed: ${JSON.stringify(contextPack.sections)}`
);
assert(
  !JSON.stringify(contextPack).includes("super-secret-value") &&
    !JSON.stringify(contextPack).includes(databaseUrl),
  "context pack documentation/canon context leaked secret-like values"
);

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

const universalLocalProject = await mkdtemp(join(tmpdir(), "recallant-universal-local-"));
await writeFile(join(universalLocalProject, "README.md"), "# Universal local connect proof\n");
const universalLocal = runJson(
  recallant,
  ["connect", universalLocalProject, "--yes", "--format", "json"],
  {
    cwd: universalLocalProject
  }
);
assert(
  universalLocal.action === "onboard" &&
    universalLocal.status === "completed" &&
    universalLocal.connected?.status === "connected" &&
    universalLocal.verify?.status === "passed",
  `universal connect did not route same-host project through onboarding: ${JSON.stringify(
    universalLocal
  )}`
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
assert(
  oneCommand.attach_details?.starter_docs?.plan?.status === "not_empty" &&
    oneCommand.attach_details?.starter_docs?.outcome?.status === "skipped",
  `one-command README project should not auto-generate starter docs: ${JSON.stringify(
    oneCommand.attach_details?.starter_docs
  )}`
);
assert(
  (await readFile(join(oneCommandProject, "README.md"), "utf8")) ===
    "# One-command onboarding proof\n",
  "one-command README project was overwritten by starter docs"
);
for (const file of ["docs/RUNBOOK.md", "docs/ARCHITECTURE.md", "docs/API.md"]) {
  assert(
    !(await exists(join(oneCommandProject, file))),
    `one-command README project unexpectedly generated ${file}`
  );
}

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
  countOccurrences(humanSuccess.stdout, "Documentation posture:") === 1 &&
    humanSuccess.stdout.includes("Found:") &&
    humanSuccess.stdout.includes("Workbench:"),
  `human success output did not include exactly one concise posture summary: ${humanSuccess.stdout}`
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

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      production_preconfirmation_posture_excerpt: excerptFrom(
        wizard.stdout,
        "Documentation posture:",
        5
      ),
      dry_run_posture_json_excerpt: {
        status: dryRun.documentation_posture?.status,
        profile: dryRun.documentation_posture?.profile,
        source: dryRun.documentation_posture?.analysis_source,
        writes_files: dryRun.documentation_posture?.writes_files,
        writes_database: dryRun.documentation_posture?.writes_database,
        workbench_options: dryRun.documentation_posture?.review_options?.map(
          (option) => option.option
        ),
        attach_status: dryRun.attach_details?.documentation_posture?.status
      },
      stored_posture_setting_excerpt: {
        key: "documentation_posture",
        status: storedPosture?.status,
        profile: storedPosture?.profile,
        instruction_grade: storedPosture?.authority?.instruction_grade,
        raw_secret_leaked: JSON.stringify(storedPosture).includes("super-secret-value")
      },
      context_pack_posture_excerpt: {
        status: contextPosture?.status,
        profile: contextPosture?.profile,
        authority_key: contextPosture?.authority?.key,
        missing_count: contextPosture?.missing_recommended_docs?.length ?? 0,
        capability_hint_count: contextPosture?.capability_hints?.length ?? 0
      },
      context_pack_canon_capability_excerpt: {
        status: contextCanon?.status,
        categories: {
          environment_facts: contextCanon?.environment_facts?.length ?? 0,
          capability_references: contextCanon?.capability_references?.length ?? 0,
          secret_references: contextCanon?.secret_references?.length ?? 0,
          server_canon_links: contextCanon?.server_canon_links?.map((item) => ({
            kind: item.kind,
            status: item.status,
            reference: item.reference
          })),
          documentation_authority_map: contextCanon?.documentation_authority_map?.map((item) => ({
            path: item.path,
            role: item.role
          }))
        },
        instruction_grade: contextCanon?.authority?.instruction_grade,
        bounded_max: 8,
        raw_secret_leaked: JSON.stringify(contextCanon).includes("super-secret-value")
      },
      starter_docs_excerpt: {
        dry_run: {
          status: emptyStarterDryRun.attach_details?.starter_docs?.plan?.status,
          writes_files: emptyStarterDryRun.attach_details?.starter_docs?.plan?.writes_files,
          outcome: emptyStarterDryRun.attach_details?.starter_docs?.outcome
        },
        empty_base: emptyStarter.attach_details?.starter_docs?.outcome?.generated_files,
        service: serviceStarter.result.attach_details?.starter_docs?.outcome?.generated_files,
        product: productStarter.result.attach_details?.starter_docs?.outcome?.generated_files,
        library: libraryStarter.result.attach_details?.starter_docs?.outcome?.generated_files,
        readme_only: oneCommand.attach_details?.starter_docs?.plan?.status,
        no_overwrite_readme_preserved: true
      },
      human_success: {
        documentation_posture_blocks: countOccurrences(
          humanSuccess.stdout,
          "Documentation posture:"
        ),
        lower_level_commands_hidden: true
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("Onboarding CLI smoke passed\n");
