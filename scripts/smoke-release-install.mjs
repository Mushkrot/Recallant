import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const repoRoot = process.cwd();
const expectedVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
const expectedTag = `v${expectedVersion}`;
const smokeRoot = await mkdtemp(join(tmpdir(), "recallant-release-install-"));
const externalRepository = process.env.RECALLANT_RELEASE_REPO_URL?.trim() || null;
const externalRef = process.env.RECALLANT_RELEASE_REF?.trim() || null;
const externalExpectedRevision =
  process.env.RECALLANT_EXPECTED_REVISION?.trim().toLowerCase() || null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 240_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

try {
  const fakeBin = join(smokeRoot, "fake-bin");
  const home = join(smokeRoot, "home");
  let origin = join(smokeRoot, "origin");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });
  const fakeDocker = join(fakeBin, "docker");
  await writeFile(
    fakeDocker,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "info" ]]; then exit 0; fi
if [[ "\${1:-}" == "compose" && "\${2:-}" == "version" ]]; then exit 0; fi
echo "unexpected docker command: $*" >&2
exit 2
`
  );
  await chmod(fakeDocker, 0o755);

  let sourceHead;
  if (externalRepository || externalRef || externalExpectedRevision) {
    assert(
      externalRepository && externalRef && /^[0-9a-f]{40}$/.test(externalExpectedRevision ?? ""),
      "External release install proof requires RECALLANT_RELEASE_REPO_URL, RECALLANT_RELEASE_REF, and a full RECALLANT_EXPECTED_REVISION"
    );
    origin = externalRepository;
    sourceHead = externalExpectedRevision;
  } else {
    await cp(repoRoot, origin, {
      recursive: true,
      filter: (source) => {
        const parts = relative(repoRoot, source).split(sep);
        return !parts.some((part) => part === ".git" || part === "node_modules" || part === "dist");
      }
    });
    run("git", ["init", "--initial-branch=main"], { cwd: origin });
    run("git", ["add", "-A"], { cwd: origin });
    run(
      "git",
      [
        "-c",
        "user.name=Recallant Release Smoke",
        "-c",
        "user.email=maintainer@example.com",
        "commit",
        "-m",
        "Recallant release install fixture"
      ],
      { cwd: origin }
    );
    sourceHead = run("git", ["rev-parse", "HEAD"], { cwd: origin });
    run(
      "git",
      [
        "-c",
        "user.name=Recallant Release Smoke",
        "-c",
        "user.email=maintainer@example.com",
        "tag",
        "-a",
        expectedTag,
        "-m",
        `Recallant ${expectedTag}`
      ],
      { cwd: origin }
    );
  }

  const commonEnv = {
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`
  };
  const repositoryUrl = externalRepository ?? `file://${origin}`;
  const exactShaInstall = join(smokeRoot, "exact-sha-source");
  const exactShaOutput = run(
    "/bin/bash",
    [
      "scripts/install-recallant-bootstrap.sh",
      "--profile",
      "single-user",
      "--repo-url",
      repositoryUrl,
      "--ref",
      externalRef ?? sourceHead,
      "--install-dir",
      exactShaInstall,
      "--dry-run"
    ],
    { env: commonEnv }
  );
  assert(
    run("git", ["-C", exactShaInstall, "rev-parse", "HEAD"]) === sourceHead,
    "Bootstrap exact-SHA install did not resolve the requested candidate commit"
  );
  assert(
    exactShaOutput.includes(`Source ref: ${externalRef ?? sourceHead}`),
    "Bootstrap omitted exact source ref"
  );

  let cliSource = exactShaInstall;
  let taggedRef = null;
  if (!externalRef) {
    const taggedInstall = join(smokeRoot, "tagged-source");
    run(
      "/bin/bash",
      [
        "scripts/install-recallant-bootstrap.sh",
        "--profile",
        "single-user",
        "--repo-url",
        `file://${origin}`,
        "--ref",
        expectedTag,
        "--install-dir",
        taggedInstall,
        "--dry-run"
      ],
      { env: commonEnv }
    );
    assert(
      run("git", ["-C", taggedInstall, "describe", "--tags", "--exact-match", "HEAD"]) ===
        expectedTag,
      "Tagged install did not retain the requested release tag"
    );
    cliSource = taggedInstall;
    taggedRef = expectedTag;
  } else if (externalRef === expectedTag) {
    assert(
      run("git", ["-C", exactShaInstall, "describe", "--tags", "--exact-match", "HEAD"]) ===
        expectedTag,
      "Published tagged install did not retain the requested release tag"
    );
    taggedRef = expectedTag;
  }

  const prefix = join(smokeRoot, "bin");
  run("/bin/bash", [join(cliSource, "scripts", "install-recallant-cli.sh")], {
    cwd: cliSource,
    env: { ...commonEnv, PREFIX: prefix, RECALLANT_HOME: cliSource }
  });
  const installedVersion = run(join(prefix, "recallant"), ["--version"], {
    cwd: cliSource,
    env: commonEnv
  });
  assert(
    new RegExp(
      `^recallant ${expectedVersion.replaceAll(".", "\\.")}\\+${sourceHead.slice(0, 8)}$`
    ).test(installedVersion),
    `Tagged CLI reported inconsistent release identity: ${installedVersion}`
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        release_install: {
          status: "pass",
          exact_sha: sourceHead,
          source_ref: externalRef ?? sourceHead,
          tagged_ref: taggedRef,
          source_persistence: "verified",
          installed_version: installedVersion
        }
      },
      null,
      2
    )}\n`
  );
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}
