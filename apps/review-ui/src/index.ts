import { getRecallantCoreInfo } from "@recallant/core";

export function describeReviewUiBoundary() {
  return {
    core: getRecallantCoreInfo(),
    firstScreen: "review-inbox"
  };
}
