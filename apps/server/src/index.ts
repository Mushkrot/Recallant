import { getRecallantCoreInfo } from "@recallant/core";
import { recallantDatabasePackage } from "@recallant/db";
import { recallantMcpServerName } from "@recallant/mcp";

export function describeServerBoundary() {
  return {
    core: getRecallantCoreInfo(),
    database: recallantDatabasePackage,
    mcpServerName: recallantMcpServerName
  };
}
