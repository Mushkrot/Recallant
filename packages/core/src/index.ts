import { recallantContractVersion } from "@recallant/contracts";

export * from "./memory-keeper.js";
export * from "./project-log-sync.js";

export function getRecallantCoreInfo() {
  return {
    name: "recallant-core",
    contractVersion: recallantContractVersion
  };
}
