#!/usr/bin/env node

import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";
import { runRecallantStdioServer } from "@recallant/mcp";

export function describeCliBoundary() {
  return {
    core: getRecallantCoreInfo(),
    supportedClientKinds
  };
}

async function main(argv: readonly string[]) {
  const command = argv[2];

  if (command === "mcp-server") {
    await runRecallantStdioServer();
    return;
  }

  if (command === "doctor") {
    process.stdout.write(`${JSON.stringify(describeCliBoundary(), null, 2)}\n`);
    return;
  }

  process.stderr.write("Usage: recallant <mcp-server|doctor>\n");
  process.exitCode = 1;
}

await main(process.argv);
