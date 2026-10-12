import "./isolated-user-home.mjs";
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (["open", "xdg-open"].includes(command)) {
    writeFileSync(process.env.RECALLANT_SMOKE_BROWSER_RECEIPT, JSON.stringify({ command, args }));
    return { status: process.env.RECALLANT_SMOKE_BROWSER_FAIL === "1" ? 1 : 0 };
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
