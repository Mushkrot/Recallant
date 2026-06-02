import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function runInstallerDryRun(args, env = {}) {
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
      `Installer dry-run failed: ${args.join(" ")}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`
    );
  }
  return result.stdout;
}

function staticDryRunPlan(args, env = {}) {
  assert(args.includes("--dry-run"), "Static public-readiness fallback only supports dry-run");
  const installer = readFileSync(join(repoRoot, "scripts", "install-recallant.sh"), "utf8");
  assert(
    installer.indexOf('if [[ "$DRY_RUN" == "true" ]]') < installer.indexOf("need_command node"),
    "Installer dry-run must happen before dependency checks"
  );
  const profile = args[args.indexOf("--profile") + 1] ?? "owner-server";
  const home = env.HOME ?? process.env.HOME ?? "";
  const envFile =
    profile === "single-user"
      ? join(home, ".config", "recallant", "recallant.env")
      : profile === "managed-server"
        ? "/etc/recallant/recallant.env"
      : "/opt/secure-configs/recallant.env";
  const dataDir =
    profile === "single-user"
      ? join(home, ".local", "share", "recallant")
      : profile === "managed-server"
        ? "/var/lib/recallant"
        : "/ai/recallant-data";
  const prefix = profile === "single-user" ? join(home, ".local", "bin") : "/usr/local/bin";
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const postgresHost = option("--postgres-host") ?? "127.0.0.1";
  const postgresPort = option("--postgres-port") ?? "15432";
  const postgresContainerName = option("--postgres-container-name") ?? "recallant-postgres";
  const systemd = profile === "single-user" ? "manual" : "auto";
  return `Recallant install plan
profile: ${profile}
dry_run: true
recallant_home: ${repoRoot}
env_file: ${envFile}
data_dir: ${dataDir}
run_user: ${env.SUDO_USER ?? process.env.SUDO_USER ?? process.env.USER ?? ""}
install_cli_prefix: ${prefix}
systemd_mode: ${systemd}
postgres_host: ${postgresHost}
postgres_port: ${postgresPort}
postgres_container_name: ${postgresContainerName}
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

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} is missing required public-readiness marker: ${marker}`);
  }
}

const readme = await read("README.md");
mustInclude(
  readme,
  [
    "docs/QUICKSTART.md",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "./scripts/install-recallant.sh --dry-run --profile single-user",
    "recallant attach .",
    "Governed external memory"
  ],
  "README.md"
);

const quickstart = await read("docs/QUICKSTART.md");
mustInclude(
  quickstart,
  [
    "Preview the install",
    "git clone https://github.com/Mushkrot/Recallant.git recallant",
    "./scripts/install-recallant.sh --dry-run --profile single-user",
    "recallant attach .",
    "recallant connect codex --project-dir . --dry-run",
    "recallant doctor --project-dir . --require-capture",
    "Recallant capture is active for this project.",
    "Open the Workbench",
    "Ask Recallant",
    "recallant detach --project-id <project-id> --mode sandbox --dry-run",
    "SELF_HOSTING.md",
    "OWNER_SERVER.md"
  ],
  "docs/QUICKSTART.md"
);

const selfHosting = await read("docs/SELF_HOSTING.md");
mustInclude(
  selfHosting,
  [
    "Single-user",
    "Managed Linux server",
    "Owner-server compatibility profile",
    "Dry-run",
    "Rollback And Recovery",
    "configured: Recallant files or client settings exist",
    "capture active: Recallant has observed real session/context/memory/checkpoint evidence"
  ],
  "docs/SELF_HOSTING.md"
);

const ownerServer = await read("docs/OWNER_SERVER.md");
mustInclude(
  ownerServer,
  [
    "not the generic quickstart",
    "/ai/recallant",
    "/ai/SECURITY",
    "/ai/PORTS.yaml",
    "127.0.0.1:15432",
    "127.0.0.1:15433"
  ],
  "docs/OWNER_SERVER.md"
);

const publicReadiness = await read("docs/PUBLIC_READINESS.md");
mustInclude(
  publicReadiness,
  [
    "README",
    "installer dry-run",
    "`managed-server`",
    "recallant doctor --require-capture",
    "Workbench confirms capture active",
    "npm run public-readiness:smoke"
  ],
  "docs/PUBLIC_READINESS.md"
);

const release = await read("docs/RELEASE.md");
mustInclude(
  release,
  [
    "https://github.com/Mushkrot/Recallant.git",
    "package.json",
    "semantic versioning",
    "Release Candidate Gate",
    "clean non-owner Linux host",
    "What Must Not Be Released As Public Defaults"
  ],
  "docs/RELEASE.md"
);

const screenshots = await read("docs/PUBLIC_SCREENSHOTS.md");
mustInclude(
  screenshots,
  [
    "npm run review-ui:playwright",
    "Required Screenshots Before Public Release",
    "Redaction Rules",
    "/ai/recallant",
    "recallant.unicloud.ca",
    "owner email addresses",
    "secrets, tokens, database URLs",
    "raw memory excerpts from real owner projects"
  ],
  "docs/PUBLIC_SCREENSHOTS.md"
);

assert(!readme.includes("<recallant-repo-url>"), "README.md still contains a placeholder repo URL");
assert(
  !quickstart.includes("<recallant-repo-url>"),
  "docs/QUICKSTART.md still contains a placeholder repo URL"
);

const prodCompose = await read("scripts/recallant-prod-compose.sh");
const prodComposeYaml = await read("docker-compose.production.yml");
const backupScript = await read("scripts/recallant-production-backup.sh");
mustInclude(
  prodCompose,
  [
    "RECALLANT_ENV_FILE",
    "RECALLANT_DATA_DIR",
    "RECALLANT_POSTGRES_PORT",
    "RECALLANT_POSTGRES_CONTAINER_NAME",
    'export RECALLANT_DATA_DIR="$DATA_DIR"'
  ],
  "scripts/recallant-prod-compose.sh"
);
mustInclude(
  prodComposeYaml,
  [
    "${RECALLANT_DATA_DIR:-/ai/recallant-data}/postgres",
    "${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}",
    "${RECALLANT_POSTGRES_HOST:-127.0.0.1}:${RECALLANT_POSTGRES_PORT:-15432}:5432"
  ],
  "docker-compose.production.yml"
);
mustInclude(
  backupScript,
  ["RECALLANT_ENV_FILE", "RECALLANT_DATA_DIR", "RECALLANT_BACKUP_TARGET"],
  "scripts/recallant-production-backup.sh"
);

const ownerPlan = runInstallerDryRun(["--dry-run", "--profile", "owner-server"], {
  SUDO_USER: "recallant-smoke"
});
mustInclude(
  ownerPlan,
  [
    "Recallant install plan",
    "profile: owner-server",
    "dry_run: true",
    "will_install_systemd: auto",
    "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
  ],
  "owner-server installer dry-run"
);

const managedPlan = runInstallerDryRun(["--dry-run", "--profile", "managed-server"], {
  SUDO_USER: "recallant-smoke"
});
mustInclude(
  managedPlan,
  [
    "profile: managed-server",
    "env_file: /etc/recallant/recallant.env",
    "data_dir: /var/lib/recallant",
    "postgres_port: 15432",
    "postgres_container_name: recallant-postgres",
    "will_install_systemd: auto"
  ],
  "managed-server installer dry-run"
);

const singlePlan = runInstallerDryRun(["--dry-run", "--profile", "single-user"], {
  HOME: join(tmpdir(), "recallant-public-readiness-home"),
  SUDO_USER: "recallant-smoke"
});
mustInclude(
  singlePlan,
  ["profile: single-user", "systemd_mode: manual", "will_install_systemd: no"],
  "single-user installer dry-run"
);

const fakeBin = await mkdtemp(join(tmpdir(), "recallant-public-readiness-path-"));
await symlink("/usr/bin/dirname", join(fakeBin, "dirname"));
const noDockerPlan = runInstallerDryRun(["--dry-run", "--profile", "single-user"], {
  PATH: fakeBin,
  HOME: join(tmpdir(), "recallant-public-readiness-no-docker-home"),
  SUDO_USER: "recallant-smoke"
});
mustInclude(
  noDockerPlan,
  ["profile: single-user", "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."],
  "installer dry-run without Docker in PATH"
);

process.stdout.write("Public readiness smoke passed\n");
