function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const {
  prepareProjectLogSync,
  projectLogCheckpointEndMarker,
  projectLogCheckpointStartMarker,
  validateProjectIdentity
} = await import("../packages/core/dist/index.js");

const before = "# Owner log\n\nKeep this byte-for-byte.\n\n";
const after = "\n\n## Owner history\n\nNever replace this.\n";
const existing = `${before}${projectLogCheckpointStartMarker}\nold checkpoint\n${projectLogCheckpointEndMarker}${after}`;

const disabled = prepareProjectLogSync({
  mode: undefined,
  existingContent: existing,
  payload: { current_focus: "ignored" }
});
assert(
  disabled.status === "disabled" && disabled.reason === "project_log_sync_disabled",
  `disabled policy failed: ${JSON.stringify(disabled)}`
);

const invalid = prepareProjectLogSync({
  mode: "always",
  existingContent: existing,
  payload: { current_focus: "ignored" }
});
assert(invalid.status === "disabled", `invalid policy failed: ${JSON.stringify(invalid)}`);

const updated = prepareProjectLogSync({
  mode: "managed_block",
  existingContent: existing,
  payload: {
    current_status: "ready",
    current_focus: "safe mirror",
    next_step: "verify identity",
    open_questions: ["Is the block enabled?"],
    updated_at: "2026-07-13T00:00:00.000Z"
  }
});
assert(updated.status === "updated" && updated.next_content, `update failed: ${JSON.stringify(updated)}`);
assert(updated.next_content.startsWith(before), "content before marker changed");
assert(updated.next_content.endsWith(after), "content after marker changed");
assert(
  updated.next_content.includes("Current focus: safe mirror") &&
    updated.next_content.includes("- Is the block enabled?"),
  `checkpoint rendering failed: ${updated.next_content}`
);

for (const [label, content] of [
  ["missing", "# Owner log\n"],
  ["duplicate-start", `${projectLogCheckpointStartMarker}\n${projectLogCheckpointStartMarker}\n${projectLogCheckpointEndMarker}`],
  ["duplicate-end", `${projectLogCheckpointStartMarker}\n${projectLogCheckpointEndMarker}\n${projectLogCheckpointEndMarker}`],
  ["reversed", `${projectLogCheckpointEndMarker}\n${projectLogCheckpointStartMarker}`]
]) {
  const result = prepareProjectLogSync({
    mode: "managed_block",
    existingContent: content,
    payload: { current_focus: label }
  });
  assert(
    result.status === "skipped" && result.reason === "migration_required" && !result.next_content,
    `${label} did not fail closed: ${JSON.stringify(result)}`
  );
}

const identityMatch = validateProjectIdentity({
  requestedProjectId: "project-a",
  attachedProjectId: "project-a",
  bindingProjectId: "project-a",
  projectPath: "/tmp/project-a/../project-a",
  bindingPrimaryPath: "/tmp/project-a"
});
assert(identityMatch.status === "validated", `matching identity failed: ${JSON.stringify(identityMatch)}`);

const identityMismatch = validateProjectIdentity({
  requestedProjectId: "project-a",
  attachedProjectId: "project-b",
  bindingProjectId: "project-a",
  projectPath: "/tmp/project-a",
  bindingPrimaryPath: "/tmp/project-b"
});
assert(
  identityMismatch.status === "mismatch" &&
    identityMismatch.error_code === "PROJECT_ID_PATH_MISMATCH" &&
    identityMismatch.reason === "project_id_path_mismatch",
  `mismatched identity was not rejected: ${JSON.stringify(identityMismatch)}`
);

process.stdout.write(
  `${JSON.stringify(
    {
      project_log_sync_smoke: "passed",
      results: {
        disabled: { status: disabled.status, reason: disabled.reason },
        updated: { status: updated.status, project_log_sync: updated.project_log_sync },
        migration_required: "passed",
        identity_mismatch: {
          status: identityMismatch.status,
          error_code: identityMismatch.error_code
        }
      }
    },
    null,
    2
  )}\n`
);
