import { execFileSync } from "node:child_process";

const checks = [
  ["project-sources:smoke", ["npm", ["run", "project-sources:smoke"]]],
  ["stage6:personal-isolation", ["npm", ["run", "stage6:personal-isolation"]]],
  ["stage6:manual-workflow", ["npm", ["run", "stage6:manual-workflow"]]],
  ["review-ui:smoke", ["npm", ["run", "review-ui:smoke"]]]
];

for (const [label, [command, args]] of checks) {
  process.stdout.write(`\n[stage6] ${label}\n`);
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
}

process.stdout.write("\nStage 6 acceptance smoke passed\n");
