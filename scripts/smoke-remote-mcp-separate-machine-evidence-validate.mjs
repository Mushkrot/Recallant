import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEvidence } from "./validate-remote-mcp-separate-machine-evidence.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function baseEvidence(overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-06-19T00:00:00.000Z",
    run_id: "validate-smoke-run",
    trace_id: "validate-smoke-trace",
    session_id: "validate-smoke-session",
    external_host: {
      hostname_hash: "hosthash",
      platform: "darwin",
      os_type: "Darwin",
      os_release: "24.0.0",
      arch: "arm64",
      node: "v20.19.0",
      project_dir_hash: "projecthash"
    },
    project_dir: {
      basename: "clean-project",
      hash: "projecthash"
    },
    clean_project_before: {
      entry_count: 1,
      entries: ["README.md"],
      codex_config_present: false,
      recallant_codex_config_entries: 0,
      recallant_remote_bridge_configured: false,
      forbidden: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    bootstrap: {
      command: "bash install-recallant-client-bootstrap.sh --credential [REDACTED_CREDENTIAL]",
      exit_code: 0,
      stdout: "Config written. Remote doctor passed.",
      stderr: ""
    },
    client_config: {
      entry_count: 2,
      entries: [".codex", "README.md"],
      codex_config_present: true,
      recallant_codex_config_entries: 1,
      recallant_remote_bridge_configured: true,
      forbidden: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    remote_doctor: {
      exit_code: 0,
      json: {
        overall: { status: "pass" },
        stages: [
          { id: "mcp_initialize", status: "pass", code: "mcp_initialize_ok" },
          { id: "tools_list", status: "pass", code: "tools_list_ok" },
          { id: "semantic_memory_proof", status: "pass", code: "semantic_memory_proof_ok" }
        ]
      }
    },
    remote_mcp: {
      status: "pass",
      tools: [
        "memory_start_session",
        "memory_get_context_pack",
        "memory_create_agent_memory",
        "memory_set_checkpoint",
        "memory_recall_agent_memories",
        "memory_heartbeat"
      ],
      required_tools: [
        "memory_start_session",
        "memory_get_context_pack",
        "memory_create_agent_memory",
        "memory_set_checkpoint",
        "memory_recall_agent_memories"
      ],
      marker: "remote acceptance validate-smoke-trace",
      start_session: {
        is_error: false,
        session_id: "validate-smoke-session"
      },
      context_pack: {
        is_error: false,
        context_pack_id: "validate-context-pack"
      },
      memory_write: {
        is_error: false,
        memory_id: "validate-memory",
        status: "accepted"
      },
      checkpoint: {
        is_error: false,
        updated_at: "2026-06-19T00:00:01.000Z"
      },
      recall: {
        is_error: false,
        marker_found: true,
        trace_id: "validate-recall-trace"
      },
      next_session: {
        start_is_error: false,
        session_id: "validate-smoke-next-session",
        context_pack_is_error: false,
        context_pack_id: "validate-next-context-pack",
        recall_is_error: false,
        marker_found: true,
        trace_id: "validate-next-recall-trace"
      },
      call_tool: "memory_recall_agent_memories",
      call_is_error: false,
      stderr: ""
    },
    capture_recall: {
      requested: true,
      doctor_stage: {
        id: "semantic_memory_proof",
        status: "pass",
        code: "semantic_memory_proof_ok"
      }
    },
    forbidden_artifacts: {
      status: "pass",
      checks: {
        recallant_local_storage: false,
        docker_compose: false,
        postgres_hint: false,
        database_url_hint: false
      }
    },
    redaction: {
      status: "pass",
      raw_credential_present: false
    },
    result: {
      status: "pass"
    },
    ...overrides
  };
}

async function runValidator(path, expectExit = 0) {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  try {
    const result = validateEvidence(JSON.parse(raw), raw);
    assert(expectExit === 0, `expected non-zero validator exit for ${path}`);
    return { report: result, stderr: "", exit: 0 };
  } catch (error) {
    const exit = 1;
    assert(
      exit === expectExit,
      `expected exit ${expectExit}, got ${exit}: ${error instanceof Error ? error.message : String(error)}`
    );
    return { report: null, stderr: error instanceof Error ? error.message : String(error), exit };
  }
}

const dir = await mkdtemp(join(tmpdir(), "recallant-evidence-validate-"));
const passPath = join(dir, "pass.evidence.json");
const dirtyPath = join(dir, "dirty.evidence.json");
const transportOnlyPath = join(dir, "transport-only.evidence.json");
const leakedPath = join(dir, "leaked.evidence.json");

await writeFile(passPath, `${JSON.stringify(baseEvidence(), null, 2)}\n`);
await writeFile(
  dirtyPath,
  `${JSON.stringify(
    baseEvidence({
      client_config: {
        ...baseEvidence().client_config,
        forbidden: {
          recallant_local_storage: true,
          docker_compose: false,
          postgres_hint: false,
          database_url_hint: false
        }
      }
    }),
    null,
    2
  )}\n`
);
await writeFile(
  transportOnlyPath,
  `${JSON.stringify(
    baseEvidence({
      capture_recall: {
        requested: true,
        doctor_stage: {
          id: "semantic_memory_proof",
          status: "fail",
          code: "semantic_memory_proof_failed"
        }
      },
      result: { status: "fail" }
    }),
    null,
    2
  )}\n`
);
await writeFile(
  leakedPath,
  `${JSON.stringify(
    baseEvidence({
      bootstrap: {
        command: "bash install --credential abcdefghijklmnopqrstuvwxyz123456",
        exit_code: 0,
        stdout: "",
        stderr: ""
      }
    }),
    null,
    2
  )}\n`
);

const pass = await runValidator(passPath, 0);
assert(pass.report?.status === "pass", "valid evidence did not pass");
const dirty = await runValidator(dirtyPath, 1);
assert(
  dirty.stderr.includes("client_config.forbidden.recallant_local_storage"),
  "dirty evidence reason missing"
);
const transportOnly = await runValidator(transportOnlyPath, 1);
assert(transportOnly.stderr.includes("capture/recall"), "transport-only evidence reason missing");
const leaked = await runValidator(leakedPath, 1);
assert(leaked.stderr.includes("unredacted token"), "leaked token reason missing");

process.stdout.write(
  `${JSON.stringify(
    {
      status: "ok",
      checks: [
        "valid_bundle_passes",
        "dirty_project_rejected",
        "transport_only_rejected",
        "unredacted_token_rejected"
      ]
    },
    null,
    2
  )}\n`
);
