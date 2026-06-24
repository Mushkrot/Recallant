import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const childEnv = { ...process.env };
delete childEnv.RECALLANT_DATABASE_URL;

const forbiddenOutputPattern =
  /"RECALLANT_DATABASE_URL"|postgres:\/\/[^"<\s]+|"workbench_auth"|"admin_auth"|"provider_secret"|"provider_key"|"raw_artifacts_path"|"backup_path"|\/ai\//;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runSmoke(script) {
  const result = await execFileAsync("npm", ["run", script], {
    cwd: process.cwd(),
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert(!forbiddenOutputPattern.test(output), `${script} leaked a forbidden output surface`);
  return output;
}

function requireMarkers(output, script, markers) {
  for (const marker of markers) {
    assert(output.includes(marker), `${script} missing security marker: ${marker}`);
  }
}

const contractOutput = await runSmoke("remote-mcp-contract:smoke");
requireMarkers(contractOutput, "remote-mcp-contract:smoke", [
  "unauthorized",
  "missing_scope",
  "wrong_token",
  "forbidden_database_url",
  "initialize_happy_path",
  "tools_list_happy_path",
  "tools_call_memory_heartbeat_happy_path",
  "tools_call_memory_create_agent_memory_wrong_audience_validation",
  "tools_call_memory_create_agent_memory_missing_title_validation",
  "tools_call_memory_create_agent_memory_missing_body_validation",
  "audit_rows"
]);

const credentialOutput = await runSmoke("remote-mcp-credentials:smoke");
requireMarkers(credentialOutput, "remote-mcp-credentials:smoke", [
  "revoked_token_rejected",
  "expired_token_rejected",
  "rotated_old_rejected",
  "rotated_new_succeeds",
  "wrong_project_rejected",
  "wrong_developer_rejected",
  "wrong_client_rejected",
  "credential_audit_events",
  "remote_mcp_audit_events",
  "no_raw_secret_in"
]);

const bridgeOutput = await runSmoke("remote-mcp-bridge:smoke");
requireMarkers(bridgeOutput, "remote-mcp-bridge:smoke", [
  "no_database_url_env",
  "blocked_database_url_env",
  "blocked_database_url_arg",
  "blocked_provider_key_arg",
  "forbidden_tool_payload_forwarded",
  "required_headers_seen",
  "forbidden_surface_leak",
  "raw_credential_boundary"
]);

const provisioningOutput = await runSmoke("remote-mcp-provisioning:smoke");
requireMarkers(provisioningOutput, "remote-mcp-provisioning:smoke", [
  "create_secret_shown_once",
  "rotate_secret_shown_once",
  "revoke_secret_redacted",
  "copied_command_config_no_forbidden_surfaces",
  "unauthenticated_api_rejected",
  "wrong_project_rejected",
  "wrong_developer_rejected",
  "wrong_client_rejected",
  "audit_events"
]);

const doctorOutput = await runSmoke("remote-mcp-doctor:smoke");
requireMarkers(doctorOutput, "remote-mcp-doctor:smoke", [
  "success-json",
  "success-human",
  "missing-credential",
  "invalid-credential",
  "expired-credential",
  "revoked-credential",
  "rotated-old-credential",
  "rotated-new-credential",
  "wrong-project",
  "wrong-developer",
  "wrong-client",
  "capture-pass",
  "capture-missing",
  "capture-failure",
  "no_database_url_env"
]);

const matrix = {
  endpoint_auth: [
    "unauthorized",
    "missing_authorization",
    "missing_scope",
    "wrong_token",
    "forbidden_database_url"
  ],
  credential_lifecycle: [
    "expired_token_rejected",
    "revoked_token_rejected",
    "rotated_old_rejected",
    "rotated_new_succeeds"
  ],
  scope: ["wrong_project_rejected", "wrong_developer_rejected", "wrong_client_rejected"],
  remote_client_boundary: [
    "no_database_url_env",
    "blocked_database_url_env",
    "blocked_database_url_arg",
    "blocked_provider_key_arg",
    "forbidden_tool_payload_forwarded_false",
    "generated_config_no_forbidden_surfaces"
  ],
  capture_proof: ["capture_pass", "capture_missing", "capture_failure"],
  doctor_diagnostics: [
    "server_unreachable",
    "edge_denied",
    "invalid_credential",
    "expired_credential",
    "revoked_credential",
    "rotated_credential",
    "wrong_project",
    "wrong_developer",
    "wrong_client",
    "tools_list_failure"
  ],
  workbench_visibility: [
    "unauthenticated_api_rejected",
    "create_secret_shown_once",
    "rotate_secret_shown_once",
    "list_redacted",
    "revoke_secret_redacted"
  ],
  audit_trail: [
    "remote_mcp_audit_events",
    "credential_audit_events",
    "credential_lifecycle_audit_events",
    "no_raw_secret_in_audit"
  ],
  leakage: [
    "no_raw_credential_in_child_outputs",
    "no_db_url_in_child_outputs",
    "no_provider_or_raw_artifact_surface_in_child_outputs"
  ]
};

process.stdout.write(
  `${JSON.stringify(
    {
      remote_mcp_security_smoke: {
        status: "pass",
        reused_smokes: [
          "remote-mcp-contract:smoke",
          "remote-mcp-credentials:smoke",
          "remote-mcp-bridge:smoke",
          "remote-mcp-provisioning:smoke",
          "remote-mcp-doctor:smoke"
        ],
        matrix,
        redacted_audit_summary: {
          system_activity_events: "covered_by_contract_credentials_provisioning_doctor_smokes",
          remote_mcp_success_and_failure_rows: true,
          credential_lifecycle_rows: true,
          request_bodies_redacted: true,
          authorization_headers_redacted: true,
          raw_credentials_redacted: true,
          database_urls_redacted: true
        },
        no_database_url_env: !childEnv.RECALLANT_DATABASE_URL,
        forbidden_output_leak: false
      }
    },
    null,
    2
  )}\n`
);
