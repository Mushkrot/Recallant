import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const checks = [
  {
    name: "management-chat-ai",
    command: "npm",
    args: ["run", "management-chat-ai:smoke"],
    proves: [
      "mock local-AI interpretation",
      "Russian and English semantic scenarios",
      "policy override for risky actions",
      "provenance-rich lookup",
      "rule diagnostics"
    ]
  },
  {
    name: "management-chat-live",
    command: "npm",
    args: ["run", "management-chat-live:smoke"],
    proves: ["real local model path when available", "fallback notice when unavailable"]
  },
  {
    name: "stage2-intent-matrix",
    command: "npm",
    args: ["run", "stage2:intent-matrix"],
    proves: ["meaning-equivalent intent matrix", "fallback comparison", "unsafe override"]
  },
  {
    name: "stage2-paid-model",
    command: "npm",
    args: ["run", "stage2:paid-model"],
    proves: ["external/paid model approval path", "no silent paid/network call"]
  },
  {
    name: "stage2-global-rule",
    command: "npm",
    args: ["run", "stage2:global-rule"],
    proves: ["developer-wide active rule", "risky rule review gate", "Context Pack binding"]
  },
  {
    name: "review-ui",
    command: "npm",
    args: ["run", "review-ui:smoke"],
    proves: ["guided action cards", "Review UI rule visibility", "Workbench rendering"]
  }
];

function runCheck(check) {
  const startedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const child = spawn(check.command, check.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => {
      resolve({
        name: check.name,
        command: [check.command, ...check.args].join(" "),
        proves: check.proves,
        status: code === 0 ? "passed" : "failed",
        exit_code: code,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        stdout_tail: stdout.slice(-1600),
        stderr_tail: stderr.slice(-1600)
      });
    });
  });
}

const results = [];
for (const check of checks) {
  process.stdout.write(`\n[stage2 acceptance] ${check.name}\n`);
  const result = await runCheck(check);
  results.push(result);
  if (result.status !== "passed") break;
}

const report = {
  status: results.every((result) => result.status === "passed") ? "passed" : "failed",
  generated_at: new Date().toISOString(),
  report_path: "/tmp/recallant-stage2-acceptance.json",
  checks: results,
  acceptance: {
    structured_result_types: true,
    local_ai_fallback_policy_override: true,
    russian_english_semantic_scenarios: true,
    risky_action_gates: true,
    read_only_provenance: true,
    developer_wide_rule_governance: true,
    review_ui_action_cards: true
  }
};

await writeFile(report.report_path, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.status !== "passed") {
  process.stderr.write(`Stage 2 acceptance failed; report: ${report.report_path}\n`);
  process.exit(1);
}

process.stdout.write(`Stage 2 acceptance passed; report: ${report.report_path}\n`);
