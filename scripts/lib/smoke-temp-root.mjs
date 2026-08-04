import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createManagedSmokeTempRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    rmSync(root, { recursive: true, force: true });
  };

  process.once("exit", cleanup);
  return {
    root,
    cleanup() {
      process.removeListener("exit", cleanup);
      cleanup();
    }
  };
}
