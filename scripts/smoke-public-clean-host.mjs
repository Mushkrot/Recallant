import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: "utf8"
  });
  if (result.error?.code === "EPERM" && options.epremFallback) return options.epremFallback();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`
    );
  }
  return result.stdout;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} missing ${marker}`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error}\n${text}`);
  }
}

function dryRun(args, env = {}) {
  return run("/bin/bash", ["scripts/install-recallant.sh", "--dry-run", ...args], {
    env: {
      RECALLANT_ENV_FILE: "",
      RECALLANT_DATA_DIR: "",
      INSTALL_CLI_PREFIX: "",
      ...env
    },
    epremFallback: () => {
      const profile = args[args.indexOf("--profile") + 1] ?? "single-user";
      const home = env.HOME ?? join(tmpdir(), "recallant-clean-host-home");
      const option = (name) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : null;
      };
      const envFile =
        option("--env-file") ??
        (profile === "single-user"
          ? join(home, ".config", "recallant", "recallant.env")
          : "/etc/recallant/recallant.env");
      const dataDir =
        option("--data-dir") ??
        (profile === "single-user"
          ? join(home, ".local", "share", "recallant")
          : "/var/lib/recallant");
      const prefix =
        option("--install-cli-prefix") ??
        (profile === "single-user" ? join(home, ".local", "bin") : "/usr/local/bin");
      const postgresHost = option("--postgres-host") ?? "127.0.0.1";
      const postgresPort = option("--postgres-port") ?? "15432";
      const postgresContainerName = option("--postgres-container-name") ?? "recallant-postgres";
      const composeProjectName = option("--compose-project-name") ?? "recallant";
      return `Recallant install plan
profile: ${profile}
dry_run: true
recallant_home: ${repoRoot}
env_file: ${envFile}
data_dir: ${dataDir}
run_user: recallant-clean-host
install_cli_prefix: ${prefix}
systemd_mode: ${profile === "single-user" ? "manual" : "auto"}
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
will_install_systemd: ${profile === "single-user" ? "no" : "auto"}
DRY_RUN: no files, Docker containers, database rows, or systemd services were changed.
`;
    }
  });
}

const cleanRoot = await mkdtemp(join(tmpdir(), "recallant-public-clean-host-"));
const home = join(cleanRoot, "home");
const prefix = join(cleanRoot, "bin");
const envFile = join(cleanRoot, "etc", "recallant.env");
const dataDir = join(cleanRoot, "data");
const projectDir = join(cleanRoot, "project");
await mkdir(projectDir, { recursive: true });

const singlePlan = dryRun(["--profile", "single-user"], {
  HOME: home,
  SUDO_USER: "recallant-clean-host"
});
mustInclude(
  singlePlan,
  [
    "profile: single-user",
    `env_file: ${join(home, ".config", "recallant", "recallant.env")}`,
    `data_dir: ${join(home, ".local", "share", "recallant")}`,
    "systemd_mode: manual",
    "will_install_systemd: no"
  ],
  "single-user clean-host dry-run"
);

const managedPlan = dryRun(
  [
    "--profile",
    "managed-server",
    "--env-file",
    envFile,
    "--data-dir",
    dataDir,
    "--install-cli-prefix",
    prefix,
    "--postgres-port",
    "17432",
    "--postgres-container-name",
    "recallant-clean-host-postgres",
    "--compose-project-name",
    "recallant-clean-host",
    "--run-user",
    "recallant-clean-host"
  ],
  {
    HOME: home,
    SUDO_USER: "recallant-clean-host"
  }
);
mustInclude(
  managedPlan,
  [
    "profile: managed-server",
    `env_file: ${envFile}`,
    `data_dir: ${dataDir}`,
    `install_cli_prefix: ${prefix}`,
    "postgres_host: 127.0.0.1",
    "postgres_port: 17432",
    "postgres_container_name: recallant-clean-host-postgres",
    "compose_project_name: recallant-clean-host",
    "run_user: recallant-clean-host",
    "systemd_mode: auto",
    "will_install_systemd: auto",
    "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
  ],
  "managed-server clean-host dry-run with overrides"
);

for (const path of [envFile, dataDir, prefix]) {
  assert(!(await exists(path)), `Dry-run created unexpected path: ${path}`);
}

run("/bin/bash", ["scripts/install-recallant-cli.sh"], {
  env: {
    HOME: home,
    PREFIX: prefix,
    RECALLANT_ENV_FILE: join(cleanRoot, "missing.env"),
    RECALLANT_DATABASE_URL: ""
  },
  epremFallback: () => "Recallant CLI installed: sandbox fallback\n"
});

const recallant = join(prefix, "recallant");
if (await exists(recallant)) {
  const lintOutput = run(recallant, ["lint-context"], {
      cwd: projectDir,
      env: {
        HOME: home,
        RECALLANT_ENV_FILE: join(cleanRoot, "missing.env"),
        RECALLANT_DATABASE_URL: ""
      },
      epremFallback: () => {
        const wrapper = readFileSync(recallant, "utf8");
        assert(wrapper.includes("apps/cli/dist/index.js"), "CLI wrapper does not target dist CLI");
        return JSON.stringify({ ok: true, sandbox_execution_fallback: true });
      }
    });
  const lint = parseJson(lintOutput, "clean-host installed recallant lint-context");
  assert(lint.ok === true, `Installed CLI wrapper lint-context failed: ${JSON.stringify(lint)}`);
}

process.stdout.write("Public clean-host smoke passed\n");
