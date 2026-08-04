import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const helperUrl = pathToFileURL(resolve(process.cwd(), "scripts/lib/smoke-temp-root.mjs")).href;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runChild(mode) {
  const prefix = `recallant-onboarding-cleanup-proof-${randomUUID()}-`;
  const source = `
    import { createManagedSmokeTempRoot } from ${JSON.stringify(helperUrl)};
    await createManagedSmokeTempRoot(${JSON.stringify(prefix)});
    if (${JSON.stringify(mode)} === "failure") throw new Error("forced cleanup proof");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8"
  });
  const residue = readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix));
  return { result, residue };
}

const success = runChild("success");
assert(success.result.status === 0, `success cleanup child failed: ${success.result.stderr}`);
assert(success.residue.length === 0, `success cleanup left ${JSON.stringify(success.residue)}`);

const failure = runChild("failure");
assert(failure.result.status !== 0, "forced-failure cleanup child unexpectedly passed");
assert(
  failure.residue.length === 0,
  `forced-failure cleanup left ${JSON.stringify(failure.residue)}`
);

process.stdout.write(
  `${JSON.stringify({ status: "pass", success_cleanup: true, failure_cleanup: true })}\n`
);
process.stdout.write("Onboarding temp cleanup smoke passed\n");
