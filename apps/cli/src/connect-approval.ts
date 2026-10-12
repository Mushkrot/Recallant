import { spawnSync } from "node:child_process";

export function connectApprovalGuidance(fallbackReason: string | null) {
  if (fallbackReason === "expired") {
    return {
      reason: "device_trust_expired",
      message:
        "Trust for this computer has expired. Approve this connection in your browser to renew it.",
      explanation:
        "After approval, new projects from this computer can connect automatically again."
    };
  }
  return {
    reason: "device_approval_required",
    message: "Approve this computer's connection to Recallant in your browser.",
    explanation: "Sign in on the approval page and select Approve to continue."
  };
}

export function openConnectApprovalPage(url: string) {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return false;
    }
    const command =
      process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
    if (!command) return false;
    const result = spawnSync(command, [url], { stdio: "ignore", timeout: 5000 });
    return result.status === 0 && !result.error;
  } catch {
    return false;
  }
}
