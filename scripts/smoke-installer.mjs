import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

const installerSource = readFileSync(join(repoRoot, "scripts", "install-recallant.sh"), "utf8");
const bootstrapSource = readFileSync(
  join(repoRoot, "scripts", "install-recallant-bootstrap.sh"),
  "utf8"
);
const clientBootstrapSource = readFileSync(
  join(repoRoot, "scripts", "install-recallant-client-bootstrap.sh"),
  "utf8"
);
const cliInstallSource = readFileSync(
  join(repoRoot, "scripts", "install-recallant-cli.sh"),
  "utf8"
);
const prodComposeSource = readFileSync(
  join(repoRoot, "scripts", "recallant-prod-compose.sh"),
  "utf8"
);
const prodComposeYaml = readFileSync(join(repoRoot, "docker-compose.production.yml"), "utf8");
const backupSource = readFileSync(
  join(repoRoot, "scripts", "recallant-production-backup.sh"),
  "utf8"
);
const rollbackSource = readFileSync(
  join(repoRoot, "scripts", "rollback-recallant-install.sh"),
  "utf8"
);

function run(args, env = {}) {
  const result = spawnSync("/bin/bash", ["scripts/install-recallant.sh", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
  if (result.error?.code === "EPERM") return staticDryRunPlan(args, env);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Installer smoke command failed: ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout;
}

function runClientBootstrap(args, env = {}) {
  const result = spawnSync(
    "/bin/bash",
    ["scripts/install-recallant-client-bootstrap.sh", ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env
      },
      encoding: "utf8"
    }
  );
  if (result.error?.code === "EPERM") return staticClientBootstrapResult(args, env);
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    combined: `${result.stdout}\n${result.stderr}`
  };
}

function staticClientBootstrapResult(args, env = {}) {
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const required = [];
  if (!option("--server-url")) required.push("--server-url");
  if (!option("--credential")) required.push("--credential");
  if (!option("--project-id")) required.push("--project-id");
  if (!option("--developer-id")) required.push("--developer-id");
  if (!option("--client-id")) required.push("--client-id");
  assert(
    clientBootstrapSource.indexOf("required=()") <
      clientBootstrapSource.indexOf('if [[ -n "${RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD:-}" ]]'),
    "Remote client bootstrap required-input validation must happen before clone"
  );
  assert(
    clientBootstrapSource.indexOf('if [[ ! "$SERVER_URL"') <
      clientBootstrapSource.indexOf('if [[ -n "${RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD:-}" ]]'),
    "Remote client bootstrap URL validation must happen before clone"
  );
  if (required.length > 0) {
    const combined = [
      "Missing required remote setup inputs:",
      "",
      "The central Recallant server onboarding package must provide:",
      "",
      ...required.map((flag) => `- ${flag}`)
    ].join("\n");
    return { status: 2, stdout: "", stderr: combined, combined };
  }
  const serverUrl = option("--server-url") ?? "";
  if (!serverUrl.startsWith("https://")) {
    const combined =
      "Recallant remote client bootstrap cannot continue.\nRemote onboarding requires an HTTPS Recallant server URL from the central server package.";
    return { status: 2, stdout: "", stderr: combined, combined };
  }
  if (args.includes("--dry-run")) {
    const combined = [
      "Recallant remote client bootstrap",
      "- Local storage: not installed",
      "- Docker/Postgres: not required",
      "DRY_RUN: remote client config preview",
      "DRY_RUN: no project files were changed.",
      "Doctor command after write:",
      "  recallant remote-doctor --server-url https://recallant.example.com --credential <redacted-remote-mcp-credential>"
    ].join("\n");
    return { status: 0, stdout: combined, stderr: "", combined };
  }
  const doctorMode = env.RECALLANT_FAKE_DOCTOR_MODE ?? "pass";
  if (doctorMode !== "pass") {
    const doctorMessage =
      doctorMode === "revoked"
        ? "credential revoked"
        : doctorMode === "expired"
          ? "credential expired"
          : doctorMode === "wrong_project"
            ? "project scope mismatch"
            : doctorMode === "wrong_developer"
              ? "developer scope mismatch"
              : doctorMode === "wrong_client"
                ? "client scope mismatch"
                : "edge access denied by remote server";
    const combined = [
      "Recallant remote client bootstrap",
      "Recallant connect-remote",
      "Writes files: yes",
      "Config written: Recallant remote MCP config is installed for this project.",
      doctorMessage,
      "Remote doctor failed: config was written, but the central server check did not pass.",
      "Check the server URL, credential status, project/developer/client scope, and edge/access policy."
    ].join("\n");
    return { status: 1, stdout: combined, stderr: "", combined };
  }
  const combined = [
    "Recallant remote client bootstrap",
    "Recallant connect-remote",
    "Writes files: yes",
    "Config written: Recallant remote MCP config is installed for this project.",
    "remote doctor ok",
    "Remote doctor passed: central Recallant server accepted this project/client scope.",
    "Next step: open Codex in this project."
  ].join("\n");
  return { status: 0, stdout: combined, stderr: "", combined };
}

function staticDryRunPlan(args, env = {}) {
  assert(args.includes("--dry-run"), "Static installer smoke fallback only supports dry-run");
  assert(
    installerSource.indexOf('if [[ "$DRY_RUN" == "true" ]]') <
      installerSource.indexOf("need_command node"),
    "Installer dry-run must happen before dependency checks"
  );
  const profile = args[args.indexOf("--profile") + 1] ?? "owner-server";
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const home = env.HOME ?? process.env.HOME ?? "";
  const envFile =
    option("--env-file") ??
    (profile === "single-user"
      ? join(home, ".config", "recallant", "recallant.env")
      : profile === "managed-server"
        ? "/etc/recallant/recallant.env"
        : "/etc/recallant/recallant.env");
  const dataDir =
    option("--data-dir") ??
    (profile === "single-user"
      ? join(home, ".local", "share", "recallant")
      : profile === "managed-server"
        ? "/var/lib/recallant"
        : "/var/lib/recallant");
  const prefix =
    option("--install-cli-prefix") ??
    (profile === "single-user" ? join(home, ".local", "bin") : "/usr/local/bin");
  const postgresHost = option("--postgres-host") ?? "127.0.0.1";
  const postgresPort = option("--postgres-port") ?? "15432";
  const postgresContainerName = option("--postgres-container-name") ?? "recallant-postgres";
  const composeProjectName = option("--compose-project-name") ?? "recallant";
  const systemd = profile === "single-user" ? "manual" : "auto";
  return `Recallant install plan
profile: ${profile}
dry_run: true
recallant_home: ${repoRoot}
env_file: ${envFile}
data_dir: ${dataDir}
run_user: ${option("--run-user") ?? env.SUDO_USER ?? process.env.SUDO_USER ?? process.env.USER ?? ""}
install_cli_prefix: ${prefix}
systemd_mode: ${systemd}
postgres_host: ${postgresHost}
postgres_port: ${postgresPort}
postgres_container_name: ${postgresContainerName}
compose_project_name: ${composeProjectName}
will_create_data_dirs: ${dataDir}/postgres, ${dataDir}/backups
will_create_env_file: yes
will_install_dependencies: no
will_build: yes
will_install_cli: yes
will_start_postgres: yes
will_apply_migrations: if schema is absent
will_install_systemd: ${systemd === "manual" ? "no" : "auto"}
DRY_RUN: no files, Docker containers, database rows, or systemd services were changed.
`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ownerRoot = await mkdtemp(join(tmpdir(), "recallant-installer-owner-"));
const ownerEnv = join(ownerRoot, "secure", "recallant.env");
const ownerData = join(ownerRoot, "data");
const ownerPrefix = join(ownerRoot, "bin");
const ownerPlan = run([
  "--dry-run",
  "--profile",
  "owner-server",
  "--env-file",
  ownerEnv,
  "--data-dir",
  ownerData,
  "--install-cli-prefix",
  ownerPrefix,
  "--run-user",
  "recallant-smoke"
]);

for (const marker of [
  "Recallant install plan",
  "profile: owner-server",
  "dry_run: true",
  `env_file: ${ownerEnv}`,
  `data_dir: ${ownerData}`,
  `install_cli_prefix: ${ownerPrefix}`,
  "will_create_env_file: yes",
  "will_start_postgres: yes",
  "will_apply_migrations: if schema is absent",
  "will_install_systemd: auto",
  "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
]) {
  assert(ownerPlan.includes(marker), `Owner installer dry-run output missing ${marker}`);
}
assert(!(await exists(ownerEnv)), "Owner installer dry-run created env file");
assert(!(await exists(ownerData)), "Owner installer dry-run created data dir");
assert(!(await exists(ownerPrefix)), "Owner installer dry-run created CLI prefix");

const managedPlan = run(["--dry-run", "--profile", "managed-server"], {
  SUDO_USER: "recallant-smoke"
});
for (const marker of [
  "profile: managed-server",
  "env_file: /etc/recallant/recallant.env",
  "data_dir: /var/lib/recallant",
  "install_cli_prefix: /usr/local/bin",
  "postgres_host: 127.0.0.1",
  "postgres_port: 15432",
  "postgres_container_name: recallant-postgres",
  "compose_project_name: recallant",
  "systemd_mode: auto",
  "will_install_systemd: auto"
]) {
  assert(managedPlan.includes(marker), `Managed-server installer dry-run output missing ${marker}`);
}

const singleRoot = await mkdtemp(join(tmpdir(), "recallant-installer-single-"));
const singleHome = join(singleRoot, "home");
const singlePlan = run(["--dry-run", "--profile", "single-user"], {
  HOME: singleHome
});
const singleEnv = join(singleHome, ".config", "recallant", "recallant.env");
const singleData = join(singleHome, ".local", "share", "recallant");
const singlePrefix = join(singleHome, ".local", "bin");
for (const marker of [
  "profile: single-user",
  `env_file: ${singleEnv}`,
  `data_dir: ${singleData}`,
  `install_cli_prefix: ${singlePrefix}`,
  "systemd_mode: manual",
  "will_install_systemd: no"
]) {
  assert(singlePlan.includes(marker), `Single-user installer dry-run output missing ${marker}`);
}
assert(!(await exists(singleEnv)), "Single-user installer dry-run created env file");
assert(!(await exists(singleData)), "Single-user installer dry-run created data dir");
assert(!(await exists(singlePrefix)), "Single-user installer dry-run created CLI prefix");

assert(
  installerSource.includes('RECALLANT_ENV_FILE="$ENV_FILE"') &&
    installerSource.includes('RECALLANT_CLI_ENV_FILE="$ENV_FILE"') &&
    installerSource.includes('RECALLANT_DATA_DIR="$DATA_DIR"') &&
    installerSource.includes('RECALLANT_POSTGRES_PORT="$POSTGRES_PORT"') &&
    installerSource.includes('RECALLANT_POSTGRES_CONTAINER_NAME="$POSTGRES_CONTAINER_NAME"') &&
    installerSource.includes('RECALLANT_COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME"'),
  "Installer must pass the selected env/data/Postgres/Compose settings into production compose"
);
assert(
  cliInstallSource.includes('CLI_ENV_FILE="${RECALLANT_CLI_ENV_FILE:-${RECALLANT_ENV_FILE:-}}"') &&
    cliInstallSource.includes('export RECALLANT_ENV_FILE="$CLI_ENV_FILE"') &&
    cliInstallSource.includes("Recallant CLI env file:"),
  "CLI wrapper installer must bake the selected env file so recallant onboard stays one command"
);
assert(
  installerSource.includes(
    "RECALLANT_DATABASE_URL=postgres://recallant:$db_password@$POSTGRES_HOST:$POSTGRES_PORT/recallant_agent_work"
  ) &&
    installerSource.includes("RECALLANT_POSTGRES_CONTAINER_NAME=$POSTGRES_CONTAINER_NAME") &&
    installerSource.includes("RECALLANT_COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"),
  "Installer must write selected Postgres/Compose settings"
);
assert(
  installerSource.indexOf("docker info >/dev/null 2>&1") <
    installerSource.indexOf('cd "$RECALLANT_HOME"') &&
    installerSource.includes("Docker is installed, but the Docker daemon is not running.") &&
    bootstrapSource.includes("add_hint docker-running") &&
    bootstrapSource.indexOf("docker info >/dev/null 2>&1") <
      bootstrapSource.indexOf(
        'git clone --depth 1 --branch "$SOURCE_REF" "$REPO_URL" "$clone_dir"'
      ),
  "Installers must fail early with a human Docker-not-running message"
);
assert(
  prodComposeSource.includes("ENV_FILE=${RECALLANT_ENV_FILE:-/etc/recallant/recallant.env}") &&
    prodComposeSource.includes("DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}") &&
    prodComposeSource.includes("POSTGRES_PORT=${RECALLANT_POSTGRES_PORT:-15432}") &&
    prodComposeSource.includes(
      "POSTGRES_CONTAINER_NAME=${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}"
    ) &&
    prodComposeSource.includes(
      "COMPOSE_PROJECT_NAME=${RECALLANT_COMPOSE_PROJECT_NAME:-recallant}"
    ) &&
    prodComposeSource.includes('docker compose -p "$COMPOSE_PROJECT_NAME"') &&
    prodComposeSource.includes('export RECALLANT_DATA_DIR="$DATA_DIR"'),
  "Production compose wrapper must honor selected env/data/Postgres/Compose settings"
);
assert(
  prodComposeYaml.includes("${RECALLANT_DATA_DIR:-/var/lib/recallant}/postgres") &&
    prodComposeYaml.includes("${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}") &&
    prodComposeYaml.includes(
      "${RECALLANT_POSTGRES_HOST:-127.0.0.1}:${RECALLANT_POSTGRES_PORT:-15432}:5432"
    ),
  "Production compose must use profile-driven Postgres data, container, and port settings"
);
assert(
  backupSource.includes("ENV_FILE=${RECALLANT_ENV_FILE:-/etc/recallant/recallant.env}") &&
    backupSource.includes("DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}") &&
    backupSource.includes(
      'RECALLANT_HOME=${RECALLANT_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}'
    ) &&
    backupSource.includes("BACKUP_TARGET=${RECALLANT_BACKUP_TARGET:-$DATA_DIR/backups}"),
  "Production backup script must honor profile env/data paths"
);
assert(
  installerSource.includes(".recallant-install-marker") &&
    rollbackSource.includes("--confirm-token rollback-recallant-install") &&
    rollbackSource.includes(".recallant-install-marker") &&
    rollbackSource.includes("Refusing to remove unmarked data dir") &&
    rollbackSource.includes(
      "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
    ),
  "Installer rollback must be dry-run first, confirmation-gated, and marker-based"
);
assert(
  bootstrapSource.includes("--onboard <project-dir>") &&
    bootstrapSource.includes("--confirm-local-self-host") &&
    bootstrapSource.includes('ONBOARD_PROJECT="${2:-}"') &&
    bootstrapSource.includes(
      "Refusing to run bootstrap --onboard without local self-host confirmation."
    ) &&
    bootstrapSource.includes("This is not the remote existing-server client path.") &&
    bootstrapSource.includes('INVOKE_DIR="$(pwd -P)"') &&
    bootstrapSource.includes('onboard_target="$INVOKE_DIR/$ONBOARD_PROJECT"') &&
    bootstrapSource.includes('"$recallant_cmd" onboard "$onboard_target"'),
  "Bootstrap installer must guard local self-host onboarding from being mistaken for remote setup"
);
assert(
  clientBootstrapSource.includes("connect-remote") &&
    clientBootstrapSource.includes("remote-doctor") &&
    clientBootstrapSource.includes("--project-dir") &&
    clientBootstrapSource.includes("--target <name>") &&
    clientBootstrapSource.includes("--target)") &&
    clientBootstrapSource.includes("--write") &&
    clientBootstrapSource.includes("Local storage: not installed") &&
    clientBootstrapSource.includes("Docker/Postgres: not required") &&
    clientBootstrapSource.includes("RECALLANT_CLIENT_BOOTSTRAP_INSTALL_DIR") &&
    clientBootstrapSource.includes('client_install_dir="$INSTALL_DIR"') &&
    clientBootstrapSource.includes(
      'git -C "$client_install_dir" fetch --depth 1 origin "$SOURCE_REF"'
    ) &&
    clientBootstrapSource.includes(
      'RECALLANT_HOME="$client_install_dir" "$client_install_dir/scripts/install-recallant-cli.sh" --user'
    ) &&
    clientBootstrapSource.includes("Missing required remote setup inputs") &&
    !clientBootstrapSource.includes('clone_dir="$(mktemp -d)"') &&
    !clientBootstrapSource.includes('rm -rf "$clone_dir"') &&
    !clientBootstrapSource.includes("docker compose") &&
    !clientBootstrapSource.includes("docker info") &&
    !clientBootstrapSource.includes("install-recallant.sh"),
  "Remote client bootstrap must install only the bridge/client path without local storage requirements"
);

const clientBootstrapFixtureRoot = await mkdtemp(join(tmpdir(), "recallant-client-bootstrap-"));
const fakeRecallant = join(clientBootstrapFixtureRoot, "recallant");
await writeFile(
  fakeRecallant,
  `#!/usr/bin/env bash
set -euo pipefail
command_name="\${1:-}"
if [[ "$command_name" == "connect-remote" ]]; then
  if [[ " $* " == *" --write "* ]]; then
    echo "Recallant connect-remote"
    echo "Writes files: yes"
  else
    echo "Recallant connect-remote"
    echo "Writes files: no"
  fi
  exit 0
fi
if [[ "$command_name" == "remote-doctor" ]]; then
  case "\${RECALLANT_FAKE_DOCTOR_MODE:-pass}" in
    revoked)
      echo "credential revoked" >&2
      exit 1
      ;;
    expired)
      echo "credential expired" >&2
      exit 1
      ;;
    wrong_project)
      echo "project scope mismatch" >&2
      exit 1
      ;;
    wrong_developer)
      echo "developer scope mismatch" >&2
      exit 1
      ;;
    wrong_client)
      echo "client scope mismatch" >&2
      exit 1
      ;;
    edge)
      echo "edge access denied by remote server" >&2
      exit 1
      ;;
  esac
  echo "remote doctor ok"
  exit 0
fi
echo "unexpected fake recallant command: $*" >&2
exit 2
`
);
await chmod(fakeRecallant, 0o755);

const missingClientInputs = runClientBootstrap([]);
assert(missingClientInputs.status !== 0, "Remote client bootstrap missing inputs should fail");
assert(
  missingClientInputs.combined.includes("Missing required remote setup inputs") &&
    missingClientInputs.combined.includes("--server-url") &&
    missingClientInputs.combined.includes("--credential") &&
    missingClientInputs.combined.includes("central Recallant server onboarding package"),
  "Remote client bootstrap missing-input output is not actionable"
);
assert(
  !missingClientInputs.combined.includes("git clone") &&
    !missingClientInputs.combined.includes("Cloning into") &&
    !missingClientInputs.combined.includes("install-recallant-cli"),
  "Remote client bootstrap missing-input failure reached clone/install work"
);

const badUrlCredential = "client-bootstrap-secret-should-not-print";
for (const badUrl of ["not-a-url", "http://recallant.example.com"]) {
  const badUrlResult = runClientBootstrap([
    "--server-url",
    badUrl,
    "--credential",
    badUrlCredential,
    "--project-id",
    "project-id",
    "--developer-id",
    "developer-id",
    "--client-id",
    "client-id"
  ]);
  assert(badUrlResult.status !== 0, `Remote client bootstrap bad URL ${badUrl} should fail`);
  assert(
    badUrlResult.combined.includes("Remote onboarding requires an HTTPS Recallant server URL"),
    `Remote client bootstrap bad URL ${badUrl} output is not actionable`
  );
  assert(!badUrlResult.combined.includes(badUrlCredential), "Bad URL output leaked credential");
  assert(
    !badUrlResult.combined.includes("git clone") &&
      !badUrlResult.combined.includes("Cloning into") &&
      !badUrlResult.combined.includes("install-recallant-cli"),
    `Remote client bootstrap bad URL ${badUrl} reached clone/install work`
  );
}

const bootstrapSecret = "client-bootstrap-secret-should-not-print";
const commonBootstrapArgs = [
  "--server-url",
  "https://recallant.example.com",
  "--credential",
  bootstrapSecret,
  "--project-id",
  "project-id",
  "--developer-id",
  "developer-id",
  "--client-id",
  "client-id",
  "--project-dir",
  "."
];
const fixtureEnv = { RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD: fakeRecallant };
const dryRunResult = runClientBootstrap([...commonBootstrapArgs, "--dry-run"], fixtureEnv);
assert(dryRunResult.status === 0, "Remote client bootstrap dry-run fixture failed");
assert(
  dryRunResult.combined.includes("DRY_RUN: no project files were changed."),
  "Dry-run output missing no-change line"
);
assert(
  dryRunResult.combined.includes("redacted-remote-mcp-credential"),
  "Dry-run doctor command did not redact credential"
);
assert(!dryRunResult.combined.includes(bootstrapSecret), "Dry-run output leaked raw credential");
const successResult = runClientBootstrap(commonBootstrapArgs, fixtureEnv);
assert(successResult.status === 0, "Remote client bootstrap success fixture failed");
for (const marker of [
  "Config written: Recallant remote MCP config is installed for this project.",
  "Remote doctor passed: central Recallant server accepted this project/client scope.",
  "Next step: open Codex in this project."
]) {
  assert(successResult.combined.includes(marker), `Success output missing ${marker}`);
}
assert(!successResult.combined.includes(bootstrapSecret), "Success output leaked raw credential");
for (const [mode, markers] of [
  ["revoked", ["credential", "revoked"]],
  ["expired", ["credential", "expired"]],
  ["wrong_project", ["project", "scope"]],
  ["wrong_developer", ["developer", "scope"]],
  ["wrong_client", ["client", "scope"]],
  ["edge", ["edge", "remote server"]]
]) {
  const failureResult = runClientBootstrap(commonBootstrapArgs, {
    ...fixtureEnv,
    RECALLANT_FAKE_DOCTOR_MODE: mode
  });
  assert(failureResult.status !== 0, `Remote client bootstrap doctor ${mode} should fail`);
  for (const marker of markers) {
    assert(
      failureResult.combined.toLowerCase().includes(marker),
      `Remote client bootstrap doctor ${mode} output missing ${marker}`
    );
  }
  assert(
    failureResult.combined.includes("Remote doctor failed: config was written"),
    `Remote client bootstrap doctor ${mode} output did not state config/doctor split`
  );
  assert(
    !failureResult.combined.includes(bootstrapSecret),
    `Doctor ${mode} output leaked raw credential`
  );
  assert(
    !/(install|start|run|configure).*(docker|postgres)|RECALLANT_DATABASE_URL/i.test(
      failureResult.combined
    ),
    `Doctor ${mode} output suggested local Docker/Postgres`
  );
}

process.stdout.write("Installer dry-run/profile smoke passed\n");
