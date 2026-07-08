import { recallantContractVersion } from "@recallant/contracts";

export * from "./memory-keeper.js";

export function getRecallantCoreInfo() {
  return {
    name: "recallant-core",
    contractVersion: recallantContractVersion
  };
}
