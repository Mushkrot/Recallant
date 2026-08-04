/* global console, URL */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const smokeScript = fileURLToPath(new URL("./smoke-review-ui-playwright.mjs", import.meta.url));
const outputDir =
  process.env.RECALLANT_PORTFOLIO_SCREENSHOT_DIR ??
  fileURLToPath(new URL("../docs/assets/workbench/", import.meta.url));

const result = spawnSync(process.execPath, [smokeScript], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    RECALLANT_PORTFOLIO_SCREENSHOT_DIR: outputDir
  },
  stdio: "inherit"
});

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Portfolio screenshot generation stopped by ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
