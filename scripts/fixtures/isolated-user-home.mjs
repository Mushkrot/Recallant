import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import process from "node:process";

if (!process.env.RECALLANT_SMOKE_USER_HOME) throw new Error("Missing isolated smoke home");
os.homedir = () => process.env.RECALLANT_SMOKE_USER_HOME;
syncBuiltinESMExports();
