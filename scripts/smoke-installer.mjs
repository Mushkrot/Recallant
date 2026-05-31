import { spawnSync } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();

function run(args, env = {}) {
  const result = spawnSync("bash", ["scripts/install-recallant.sh", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Installer smoke command failed: ${args.join(" ")}\n${result.stderr}\n${result.stdout}`
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

process.stdout.write("Installer dry-run/profile smoke passed\n");
