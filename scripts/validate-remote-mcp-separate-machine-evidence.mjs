#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const forbiddenEvidencePattern =
  /"RECALLANT_DATABASE_URL"\s*[:=]|RECALLANT_DATABASE_URL\s*=|DATABASE_URL\s*=|postgres:\/\/|pgvector|recallant-postgres|\/ai\//i;
const explicitSecretPattern = /\bBearer\s+[A-Za-z0-9._-]+|\bsk-[A-Za-z0-9_-]{12,}|--credential\s+(?!\[REDACTED_CREDENTIAL\])[^\s"']+/i;

function usage() {
  process.stdout.write(`Usage: node scripts/validate-remote-mcp-separate-machine-evidence.mjs --evidence <path>

Validates a redacted evidence JSON bundle produced by the separate-machine rehearsal runner.
This script performs no network calls and prints no secrets.\n`);
}

function parseArgs(argv) {
  const input = { evidencePath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") {
      input.evidencePath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!input.evidencePath) throw new Error("missing required --evidence path");
  return input;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function stringValue(value, label) {
  assert(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
  return value;
}

function booleanFalse(value, label) {
  assert(value === false, `${label} must be false`);
}

function redactForOutput(text) {
  return String(text)
    .replaceAll(process.cwd(), "[REPO_ROOT]")
    .replace(explicitSecretPattern, "[REDACTED_TOKEN]");
}

function stageStatus(evidence, id) {
  const stages = Array.isArray(evidence.remote_doctor?.json?.stages)
    ? evidence.remote_doctor.json.stages
    : [];
  return stages.find((stage) => stage?.id === id) ?? null;
}

function findUnredactedSecretValue(value, path = "$") {
  if (typeof value === "string") {
    const match = value.match(explicitSecretPattern);
    return match ? { path, match: match[0] } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nested = findUnredactedSecretValue(item, `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    const nested = findUnredactedSecretValue(nestedValue, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export function validateEvidence(evidence, rawText) {
  object(evidence, "evidence");
  assert(evidence.schema_version === 1, "schema_version must be 1");
  stringValue(evidence.generated_at, "generated_at");
  stringValue(evidence.run_id, "run_id");
  stringValue(evidence.trace_id, "trace_id");
  stringValue(evidence.session_id, "session_id");
  assert(!rawText.includes("[object Object]"), "evidence contains stringified object placeholder");
  assert(!forbiddenEvidencePattern.test(rawText), "evidence contains forbidden local surface");
  const unredactedSecret = findUnredactedSecretValue(evidence);
  assert(
    !unredactedSecret,
    `evidence appears to contain an unredacted token at ${unredactedSecret?.path}`
  );

  const host = object(evidence.external_host, "external_host");
  stringValue(host.hostname_hash, "external_host.hostname_hash");
  stringValue(host.project_dir_hash, "external_host.project_dir_hash");
  stringValue(host.platform, "external_host.platform");
  stringValue(host.node, "external_host.node");

  const before = object(evidence.clean_project_before, "clean_project_before");
  const config = object(evidence.client_config, "client_config");
  const forbiddenBefore = object(before.forbidden, "clean_project_before.forbidden");
  const forbiddenAfter = object(config.forbidden, "client_config.forbidden");
  for (const [key, value] of Object.entries(forbiddenBefore)) {
    booleanFalse(value, `clean_project_before.forbidden.${key}`);
  }
  for (const [key, value] of Object.entries(forbiddenAfter)) {
    booleanFalse(value, `client_config.forbidden.${key}`);
  }
  assert(config.codex_config_present === true, "Codex config must be present");
  assert(config.recallant_codex_config_entries === 1, "Codex config must contain one Recallant MCP server");
  assert(config.recallant_remote_bridge_configured === true, "Codex config must point to remote-bridge");

  const bootstrap = object(evidence.bootstrap, "bootstrap");
  assert(bootstrap.exit_code === 0, "bootstrap must exit 0");
  assert(String(bootstrap.command ?? "").includes("[REDACTED_CREDENTIAL]"), "bootstrap command must redact credential");
  const doctor = object(evidence.remote_doctor, "remote_doctor");
  assert(doctor.exit_code === 0, "remote_doctor must exit 0");
  assert(doctor.json?.overall?.status === "pass" || doctor.json?.status === "pass", "remote_doctor JSON must pass");
  assert(stageStatus(evidence, "mcp_initialize")?.status === "pass", "remote_doctor initialize stage must pass");
  assert(stageStatus(evidence, "tools_list")?.status === "pass", "remote_doctor tools_list stage must pass");

  const remoteMcp = object(evidence.remote_mcp, "remote_mcp");
  assert(remoteMcp.status === "pass", "remote MCP bridge must pass");
  assert(Array.isArray(remoteMcp.tools) && remoteMcp.tools.length > 0, "remote MCP tools/list must include tools");
  assert(remoteMcp.call_is_error === false, "remote MCP tools/call must not be an error");
  stringValue(remoteMcp.call_tool, "remote_mcp.call_tool");

  const capture = object(evidence.capture_recall, "capture_recall");
  assert(capture.requested === true, "capture proof must be requested");
  const captureStage = capture.doctor_stage;
  assert(captureStage?.status === "pass", "capture/recall doctor stage must pass");

  const forbiddenArtifacts = object(evidence.forbidden_artifacts, "forbidden_artifacts");
  assert(forbiddenArtifacts.status === "pass", "forbidden artifact check must pass");
  const redaction = object(evidence.redaction, "redaction");
  assert(redaction.status === "pass", "redaction status must pass");
  assert(redaction.raw_credential_present === false, "raw credential must not be present");
  const result = object(evidence.result, "result");
  assert(result.status === "pass", "evidence result must pass");

  return {
    status: "pass",
    run_id: evidence.run_id,
    trace_id: evidence.trace_id,
    session_id: evidence.session_id,
    checks: [
      "external_host_facts_present",
      "clean_project_before_after",
      "bootstrap_passed",
      "remote_doctor_passed",
      "codex_remote_bridge_configured",
      "remote_mcp_tools_list_and_call",
      "capture_recall_passed",
      "redaction_passed"
    ]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = parseArgs(process.argv.slice(2));

  try {
    const rawText = await readFile(input.evidencePath, "utf8");
    const evidence = JSON.parse(rawText);
    const report = validateEvidence(evidence, rawText);
    process.stdout.write(
      `${JSON.stringify(
        {
          evidence_file: basename(input.evidencePath),
          ...report
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    process.stderr.write(
      `Recallant separate-machine evidence validation failed: ${redactForOutput(
        error instanceof Error ? error.message : String(error)
      )}\n`
    );
    process.exit(1);
  }
}
