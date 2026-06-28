import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--version"], {
  cwd: process.cwd(),
  encoding: "utf8"
});

if (result.error) throw result.error;
assert(result.status === 0, `CLI version command failed: ${result.stderr}\n${result.stdout}`);

const version = result.stdout.trim();
assert(
  /^recallant \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version),
  `Unexpected CLI version format: ${version}`
);
assert(!/^recallant 0\.0\.0(?:$|[-+])/.test(version), `CLI version must not be 0.0.0: ${version}`);
assert(
  /\+[0-9a-f]{7,}(?:\.dirty)?$/i.test(version),
  `CLI version should include git build metadata in a checkout: ${version}`
);

process.stdout.write(`${JSON.stringify({ status: "pass", version }, null, 2)}\n`);
