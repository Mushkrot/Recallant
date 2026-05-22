#!/usr/bin/env node

import { supportedClientKinds } from "@recallant/adapters";
import { getRecallantCoreInfo } from "@recallant/core";

export function describeCliBoundary() {
  return {
    core: getRecallantCoreInfo(),
    supportedClientKinds
  };
}
