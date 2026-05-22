import { recallantContractVersion } from "@recallant/contracts";

export function getRecallantCoreInfo() {
  return {
    name: "recallant-core",
    contractVersion: recallantContractVersion
  };
}
