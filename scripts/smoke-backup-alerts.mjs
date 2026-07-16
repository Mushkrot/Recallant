import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const rulePath = join(repoRoot, "contrib", "prometheus", "recallant-backup.rules.yml");
const testPath = join(repoRoot, "contrib", "prometheus", "recallant-backup.rules.test.yml");
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A strict-Snap promtool cannot see the host's /tmp or /ai mounts. SNAP_COMMON is shared with the
// host and is the narrowest location where a real rule test can exchange temporary fixtures.
const fixtureBase = (await exists("/snap/bin/promtool"))
  ? "/var/snap/prometheus/common"
  : tmpdir();
const fixtureRoot = await mkdtemp(join(fixtureBase, "recallant-backup-alerts-"));

try {
  await writeFile(join(fixtureRoot, "recallant-backup.rules.yml"), await readFile(rulePath));
  await writeFile(join(fixtureRoot, "recallant-backup.rules.test.yml"), await readFile(testPath));

  let result = null;
  for (const candidate of ["promtool", "/snap/bin/promtool"]) {
    const attempt = spawnSync(
      candidate,
      ["test", "rules", "recallant-backup.rules.test.yml"],
      { cwd: fixtureRoot, encoding: "utf8" }
    );
    if (attempt.error?.code === "ENOENT") continue;
    if (attempt.error) throw attempt.error;
    result = attempt;
    break;
  }

  if (!result) throw new Error("promtool is required to execute backup alert rule tests");
  if (result.status !== 0) {
    throw new Error(`Backup alert rule tests failed:\n${result.stderr}\n${result.stdout}`);
  }
  process.stdout.write("Backup alert rules passed: failed -> firing; healthy -> no alert\n");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
