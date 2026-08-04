import { recallantContractVersion } from "@recallant/contracts";

export * from "./agent-observability.js";
export * from "./codex-otel.js";
export * from "./memory-keeper.js";
export * from "./project-log-sync.js";

export function getRecallantCoreInfo() {
  return {
    name: "recallant-core",
    contractVersion: recallantContractVersion
  };
}
