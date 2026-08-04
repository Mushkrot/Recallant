import { resolve } from "node:path";

export const projectLogSyncManagedBlock = "managed_block" as const;
export const projectLogCheckpointStartMarker = "<!-- recallant:checkpoint:start -->" as const;
export const projectLogCheckpointEndMarker = "<!-- recallant:checkpoint:end -->" as const;

export type ProjectLogSyncMode = typeof projectLogSyncManagedBlock;
export type ProjectLogSyncStatus = "disabled" | "skipped" | "updated";

export type ProjectLogSyncResult = {
  status: ProjectLogSyncStatus;
  reason: "project_log_sync_disabled" | "migration_required" | null;
  project_log_sync: ProjectLogSyncMode | null;
  next_content?: string;
};

export type ProjectLogCheckpointPayload = {
  current_status?: string | null;
  status?: string | null;
  current_focus?: string | null;
  next_step?: string | null;
  open_questions?: readonly string[] | null;
  updated_at?: string | null;
};

export type ProjectIdentityProofInput = {
  requestedProjectId?: string | null;
  attachedProjectId?: string | null;
  bindingProjectId?: string | null;
  projectPath?: string | null;
  bindingPrimaryPath?: string | null;
};

export type ProjectIdentityProof = {
  status: "validated" | "not_applicable" | "mismatch";
  error_code: "PROJECT_ID_PATH_MISMATCH" | null;
  reason: "project_id_path_mismatch" | null;
  project_id: string | null;
  project_path: string | null;
  binding_primary_path: string | null;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function markerPositions(content: string, marker: string) {
  const positions: number[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const exactLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (exactLine === marker) positions.push(offset);
    offset += line.length + 1;
  }
  return positions;
}

function normalizedPath(path: string | null | undefined) {
  const value = asNonEmptyString(path);
  return value ? resolve(value) : null;
}

export function projectLogSyncMode(value: unknown): ProjectLogSyncMode | null {
  return value === projectLogSyncManagedBlock ? projectLogSyncManagedBlock : null;
}

export function renderProjectLogCheckpoint(payload: ProjectLogCheckpointPayload) {
  const openQuestions = Array.isArray(payload.open_questions)
    ? payload.open_questions.map(String)
    : [];
  const lines = [
    "## Current Session",
    "",
    `Status: ${asNonEmptyString(payload.current_status) ?? asNonEmptyString(payload.status) ?? "checkpoint updated"}`,
    `Current focus: ${asNonEmptyString(payload.current_focus) ?? ""}`,
    `Next step: ${asNonEmptyString(payload.next_step) ?? ""}`
  ];
  const updatedAt = asNonEmptyString(payload.updated_at);
  if (updatedAt) lines.push(`Last updated: ${updatedAt}`);
  lines.push(
    "",
    "## Open Questions",
    "",
    ...(openQuestions.length > 0
      ? openQuestions.map((question) => `- ${question}`)
      : ["- None recorded."])
  );
  return lines.join("\n");
}

export function prepareProjectLogSync(input: {
  mode: unknown;
  existingContent: string;
  payload: ProjectLogCheckpointPayload;
}): ProjectLogSyncResult {
  const mode = projectLogSyncMode(input.mode);
  if (!mode) {
    return {
      status: "disabled",
      reason: "project_log_sync_disabled",
      project_log_sync: null
    };
  }

  const starts = markerPositions(input.existingContent, projectLogCheckpointStartMarker);
  const ends = markerPositions(input.existingContent, projectLogCheckpointEndMarker);
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    return {
      status: "skipped",
      reason: "migration_required",
      project_log_sync: mode
    };
  }

  const start = starts[0]! + projectLogCheckpointStartMarker.length;
  const end = ends[0]!;
  return {
    status: "updated",
    reason: null,
    project_log_sync: mode,
    next_content: `${input.existingContent.slice(0, start)}\n${renderProjectLogCheckpoint(input.payload)}\n${input.existingContent.slice(end)}`
  };
}

export function validateProjectIdentity(input: ProjectIdentityProofInput): ProjectIdentityProof {
  const requestedProjectId = asNonEmptyString(input.requestedProjectId);
  const attachedProjectId = asNonEmptyString(input.attachedProjectId);
  const bindingProjectId = asNonEmptyString(input.bindingProjectId);
  const projectPath = normalizedPath(input.projectPath);
  const bindingPrimaryPath = normalizedPath(input.bindingPrimaryPath);
  const projectId = requestedProjectId ?? attachedProjectId ?? bindingProjectId;
  const idMismatch =
    (requestedProjectId && attachedProjectId && requestedProjectId !== attachedProjectId) ||
    (projectId && bindingProjectId && projectId !== bindingProjectId);
  const pathMismatch = Boolean(
    projectPath && bindingPrimaryPath && projectPath !== bindingPrimaryPath
  );

  if (idMismatch || pathMismatch) {
    return {
      status: "mismatch",
      error_code: "PROJECT_ID_PATH_MISMATCH",
      reason: "project_id_path_mismatch",
      project_id: projectId,
      project_path: projectPath,
      binding_primary_path: bindingPrimaryPath
    };
  }

  return {
    status: projectId && projectPath ? "validated" : "not_applicable",
    error_code: null,
    reason: null,
    project_id: projectId,
    project_path: projectPath,
    binding_primary_path: bindingPrimaryPath
  };
}
