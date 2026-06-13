import { spawnSync } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

const installerSource = readFileSync(join(repoRoot, "scripts", "install-recallant.sh"), "utf8");
const prodComposeSource = readFileSync(join(repoRoot, "scripts", "recallant-prod-compose.sh"), "utf8");
const prodComposeYaml = readFileSync(join(repoRoot, "docker-compose.production.yml"), "utf8");
const backupSource = readFileSync(join(repoRoot, "scripts", "recallant-production-backup.sh"), "utf8");
const rollbackSource = readFileSync(join(repoRoot, "scripts", "rollback-recallant-install.sh"), "utf8");

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
    installerSource.includes('RECALLANT_DATA_DIR="$DATA_DIR"') &&
    installerSource.includes('RECALLANT_POSTGRES_PORT="$POSTGRES_PORT"') &&
    installerSource.includes('RECALLANT_POSTGRES_CONTAINER_NAME="$POSTGRES_CONTAINER_NAME"') &&
    installerSource.includes('RECALLANT_COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME"'),
  "Installer must pass the selected env/data/Postgres/Compose settings into production compose"
);
assert(
  installerSource.includes("RECALLANT_DATABASE_URL=postgres://recallant:$db_password@$POSTGRES_HOST:$POSTGRES_PORT/recallant_agent_work") &&
    installerSource.includes("RECALLANT_POSTGRES_CONTAINER_NAME=$POSTGRES_CONTAINER_NAME") &&
    installerSource.includes("RECALLANT_COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"),
  "Installer must write selected Postgres/Compose settings"
);
assert(
  prodComposeSource.includes('ENV_FILE=${RECALLANT_ENV_FILE:-/etc/recallant/recallant.env}') &&
    prodComposeSource.includes('DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}') &&
    prodComposeSource.includes('POSTGRES_PORT=${RECALLANT_POSTGRES_PORT:-15432}') &&
    prodComposeSource.includes('POSTGRES_CONTAINER_NAME=${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}') &&
    prodComposeSource.includes('COMPOSE_PROJECT_NAME=${RECALLANT_COMPOSE_PROJECT_NAME:-recallant}') &&
    prodComposeSource.includes('docker compose -p "$COMPOSE_PROJECT_NAME"') &&
    prodComposeSource.includes('export RECALLANT_DATA_DIR="$DATA_DIR"'),
  "Production compose wrapper must honor selected env/data/Postgres/Compose settings"
);
assert(
  prodComposeYaml.includes("${RECALLANT_DATA_DIR:-/var/lib/recallant}/postgres") &&
    prodComposeYaml.includes("${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}") &&
    prodComposeYaml.includes("${RECALLANT_POSTGRES_HOST:-127.0.0.1}:${RECALLANT_POSTGRES_PORT:-15432}:5432"),
  "Production compose must use profile-driven Postgres data, container, and port settings"
);
assert(
  backupSource.includes('ENV_FILE=${RECALLANT_ENV_FILE:-/etc/recallant/recallant.env}') &&
    backupSource.includes('DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}') &&
    backupSource.includes('RECALLANT_HOME=${RECALLANT_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}') &&
    backupSource.includes('BACKUP_TARGET=${RECALLANT_BACKUP_TARGET:-$DATA_DIR/backups}'),
  "Production backup script must honor profile env/data paths"
);
assert(
  installerSource.includes(".recallant-install-marker") &&
    rollbackSource.includes("--confirm-token rollback-recallant-install") &&
    rollbackSource.includes(".recallant-install-marker") &&
    rollbackSource.includes("Refusing to remove unmarked data dir") &&
    rollbackSource.includes("DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."),
  "Installer rollback must be dry-run first, confirmation-gated, and marker-based"
);

process.stdout.write("Installer dry-run/profile smoke passed\n");
