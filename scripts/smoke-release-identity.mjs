import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { recallantContractVersion } from "../packages/contracts/dist/index.js";

const repoRoot = process.cwd();
const expectedVersion = "0.1.0-dev.0";
const expectedTag = `v${expectedVersion}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readPackage(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const packagePaths = ["package.json"];
for (const workspaceRoot of ["apps", "packages"]) {
  for (const entry of await readdir(join(repoRoot, workspaceRoot), { withFileTypes: true })) {
    if (entry.isDirectory()) packagePaths.push(join(workspaceRoot, entry.name, "package.json"));
  }
}
packagePaths.sort();

const packageVersions = {};
for (const path of packagePaths) {
  const manifest = await readPackage(join(repoRoot, path));
  packageVersions[path] = manifest.version;
  assert(
    manifest.version === expectedVersion,
    `${path} must use release version ${expectedVersion}; found ${manifest.version}`
  );
}

assert(
  recallantContractVersion === expectedVersion,
  `Runtime contract version must be ${expectedVersion}; found ${recallantContractVersion}`
);

const versionResult = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--version"], {
  cwd: repoRoot,
  encoding: "utf8"
});
assert(versionResult.status === 0, `recallant --version failed: ${versionResult.stderr}`);
const cliVersion = versionResult.stdout.trim();
assert(
  new RegExp(
    `^recallant ${expectedVersion.replaceAll(".", "\\.")}\\+[0-9a-f]{8}(?:\\.dirty)?$`
  ).test(cliVersion),
  `CLI release identity is inconsistent: ${cliVersion}`
);

const releaseNotesPath = join(repoRoot, "docs", "releases", `${expectedTag}.md`);
const releaseNotes = await readFile(releaseNotesPath, "utf8");
for (const marker of [expectedTag, `--ref ${expectedTag}`, "development prerelease", "Rollback"]) {
  assert(releaseNotes.includes(marker), `Release notes missing ${marker}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      release_identity: {
        status: "pass",
        version_source: "root package.json",
        version: expectedVersion,
        tag: expectedTag,
        cli_version: cliVersion,
        package_versions: packageVersions,
        release_notes: `docs/releases/${expectedTag}.md`
      }
    },
    null,
    2
  )}\n`
);
