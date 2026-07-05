import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  planStarterDocs,
  type DocumentationPosture,
  type StarterDocsOutcome,
  type StarterDocsPlan,
  type StarterDocsPlanFile
} from "./documentation-posture.js";

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function applyStarterDocs(input: {
  projectDir: string;
  plan: StarterDocsPlan;
}): Promise<StarterDocsOutcome> {
  if (!input.plan.eligible_for_apply) {
    return {
      status: "skipped",
      reason: input.plan.reason,
      generated_files: [] as string[],
      skipped_files: input.plan.skipped_files
    };
  }
  const generatedFiles: string[] = [];
  const skippedFiles = [...input.plan.skipped_files];
  const skippedFilePaths = new Set(skippedFiles.map((file) => file.path));
  for (const file of input.plan.files) {
    const targetPath = join(input.projectDir, file.path);
    const existing = await readOptional(targetPath);
    if (existing !== null) {
      if (!skippedFilePaths.has(file.path)) {
        skippedFiles.push({ path: file.path, reason: "Target file already exists." });
        skippedFilePaths.add(file.path);
      }
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
    generatedFiles.push(file.path);
  }
  return {
    status: skippedFiles.length > 0 ? "partial" : "generated",
    reason: generatedFiles.length
      ? "Starter docs were generated for an empty project."
      : "No starter docs were generated.",
    generated_files: generatedFiles,
    skipped_files: skippedFiles
  };
}

const remoteAgentReadyBasePaths = new Set(["README.md", "AGENTS.md", "PROJECT_LOG.md"]);
const remoteAgentReadyAgentsStart = "<!-- recallant:remote-agent-ready:start -->";
const remoteAgentReadyAgentsEnd = "<!-- recallant:remote-agent-ready:end -->";
const remoteAgentReadyProjectLogStart = "<!-- recallant:remote-project-log:start -->";
const remoteAgentReadyProjectLogEnd = "<!-- recallant:remote-project-log:end -->";

function withFinalNewline(content: string) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function remoteAgentReadyAgentsSection() {
  return `${remoteAgentReadyAgentsStart}
## Recallant Remote MCP

- This project uses a central Recallant server through remote MCP; do not set up local Postgres, Docker, or \`RECALLANT_DATABASE_URL\` just to work in this project.
- Start each session through the configured remote Recallant MCP/client integration. Call \`memory_start_session\`, then \`memory_get_context_pack\` with the current task hint before making changes.
- During work, write concise non-secret decisions, actions, tests, and governed memories with \`memory_append_event\` or \`memory_create_agent_memory\` when useful.
- Use \`memory_set_checkpoint\` only for checkpoint state; it is not semantic recall proof.
- On pause or finish, call \`memory_closeout\`. This is the normal MCP closeout path and includes checkpoint state, searchable memory, recall verification, and next-session readiness semantics.
- If MCP is unavailable, use the CLI fallback against the configured remote project: \`recallant agent-start --format json\`, \`recallant agent-event\`, and \`recallant agent-closeout\`. Use \`recallant agent-checkpoint\` only as an advanced pause/compaction state helper.
- \`PROJECT_LOG.md\` is a compact current-state fallback. Durable session history belongs in Recallant memory.
- Do not store secrets, credentials, tokens, private keys, raw customer data, or local deployment details in docs or memory.
${remoteAgentReadyAgentsEnd}`;
}

function remoteAgentReadyProjectLogSection() {
  return `${remoteAgentReadyProjectLogStart}
## Recallant Remote MCP

- Status: connected to a central Recallant server through remote MCP.
- Next agent should start with the configured MCP client, call \`memory_start_session\`, then read \`memory_get_context_pack\` with the current task hint.
- CLI fallback: \`recallant agent-start --format json\`, \`recallant agent-event\`, and \`recallant agent-closeout\`.
- Keep checkpoint-only state separate from semantic memory proof.
- Keep this file compact; durable session history belongs in Recallant memory.
${remoteAgentReadyProjectLogEnd}`;
}

function remoteAgentReadyProjectLog(projectName: string) {
  return `# Project Log

Project: ${projectName}

## Current State

- Recallant remote MCP starter documentation was created for this project.
- The next agent should use the configured remote MCP client, call \`memory_start_session\`, then read \`memory_get_context_pack\` with the current task hint.

## Next Step

- Start work through Recallant, record concise non-secret actions/decisions/tests, and close with \`memory_closeout\` or the CLI fallback \`recallant agent-closeout\`.
- CLI fallback: \`recallant agent-start --format json\`, \`recallant agent-event\`, and \`recallant agent-closeout\`.

## Notes

- This project uses a central Recallant server through remote MCP.
- Do not add local Postgres, Docker, or \`RECALLANT_DATABASE_URL\` setup just to work in this project.
- Keep checkpoint-only state separate from semantic memory proof. Use \`memory_set_checkpoint\` or \`recallant agent-checkpoint\` only for checkpoint/pause state.
- Keep this file compact. Durable session history belongs in Recallant memory.
`;
}

function remoteAgentReadyFileContent(file: StarterDocsPlanFile, projectName: string) {
  if (file.path === "AGENTS.md") {
    return `# Agent Instructions

${remoteAgentReadyAgentsSection()
  .replace(`${remoteAgentReadyAgentsStart}\n`, "")
  .replace(`\n${remoteAgentReadyAgentsEnd}`, "")}

## Project Docs

- Treat local docs as concise canonical pointers.
- Treat recalled memories as evidence until they are reviewed or promoted into project docs.
- Keep \`PROJECT_LOG.md\` compact; it is a fallback, not the source of truth.
`;
  }
  if (file.path === "PROJECT_LOG.md") return remoteAgentReadyProjectLog(projectName);
  return file.content;
}

function upsertMarkedSection(input: {
  existing: string;
  startMarker: string;
  endMarker: string;
  section: string;
}) {
  const section = withFinalNewline(input.section);
  const markerState = managedSectionMarkerState(input);
  if (markerState.status === "conflict") {
    return markerState;
  }
  if (markerState.status === "complete") {
    const afterEndIndex = markerState.endIndex + input.endMarker.length;
    const updated = `${input.existing.slice(0, markerState.startIndex).trimEnd()}\n\n${section}${input.existing
      .slice(afterEndIndex)
      .trimStart()}`;
    return { status: "updated" as const, content: withFinalNewline(updated) };
  }
  return {
    status: "updated" as const,
    content: withFinalNewline(`${input.existing.trimEnd()}\n\n${section}`)
  };
}

function countOccurrences(input: string, needle: string) {
  return input.split(needle).length - 1;
}

function managedSectionMarkerState(input: {
  existing: string;
  startMarker: string;
  endMarker: string;
}):
  | { status: "absent" }
  | { status: "complete"; startIndex: number; endIndex: number }
  | { status: "conflict"; reason: string } {
  const startCount = countOccurrences(input.existing, input.startMarker);
  const endCount = countOccurrences(input.existing, input.endMarker);
  if (startCount === 0 && endCount === 0) return { status: "absent" };
  if (startCount !== 1 || endCount !== 1) {
    return {
      status: "conflict",
      reason:
        "Existing Recallant-managed section markers are missing or duplicated; not editing automatically."
    };
  }
  const startIndex = input.existing.indexOf(input.startMarker);
  const endIndex = input.existing.indexOf(input.endMarker);
  if (endIndex <= startIndex) {
    return {
      status: "conflict",
      reason:
        "Existing Recallant-managed section markers are incomplete or out of order; not editing automatically."
    };
  }
  return { status: "complete", startIndex, endIndex };
}

function remoteAgentReadyAlreadyPresent(path: string, existing: string) {
  if (path === "AGENTS.md") {
    return (
      existing.includes("central Recallant server through remote MCP") &&
      existing.includes("recallant agent-start --format json") &&
      existing.includes("memory_get_context_pack") &&
      existing.includes("memory_start_session") &&
      existing.includes("memory_closeout")
    );
  }
  if (path === "PROJECT_LOG.md") {
    return (
      existing.includes("central Recallant server through remote MCP") &&
      existing.includes("memory_get_context_pack") &&
      existing.includes("memory_start_session") &&
      existing.includes("memory_closeout")
    );
  }
  return false;
}

function remoteAgentReadyManagedConflictReason(path: string, existing: string) {
  if (path === "AGENTS.md") {
    const markerState = managedSectionMarkerState({
      existing,
      startMarker: remoteAgentReadyAgentsStart,
      endMarker: remoteAgentReadyAgentsEnd
    });
    return markerState.status === "conflict" ? markerState.reason : null;
  }
  if (path === "PROJECT_LOG.md") {
    const markerState = managedSectionMarkerState({
      existing,
      startMarker: remoteAgentReadyProjectLogStart,
      endMarker: remoteAgentReadyProjectLogEnd
    });
    return markerState.status === "conflict" ? markerState.reason : null;
  }
  return null;
}

function remoteAgentReadyUpsertedContent(path: string, existing: string) {
  if (path === "AGENTS.md") {
    return upsertMarkedSection({
      existing,
      startMarker: remoteAgentReadyAgentsStart,
      endMarker: remoteAgentReadyAgentsEnd,
      section: remoteAgentReadyAgentsSection()
    });
  }
  if (path === "PROJECT_LOG.md") {
    return upsertMarkedSection({
      existing,
      startMarker: remoteAgentReadyProjectLogStart,
      endMarker: remoteAgentReadyProjectLogEnd,
      section: remoteAgentReadyProjectLogSection()
    });
  }
  return null;
}

export async function applyRemoteAgentReadyFiles(input: {
  projectDir: string;
  projectName: string;
  plan: StarterDocsPlan;
}): Promise<StarterDocsOutcome> {
  if (!input.plan.eligible_for_apply) {
    return {
      status: "skipped",
      reason: input.plan.reason,
      generated_files: [],
      updated_files: [],
      skipped_files: input.plan.skipped_files,
      conflict_files: []
    };
  }
  const generatedFiles: string[] = [];
  const updatedFiles: string[] = [];
  const skippedFiles: StarterDocsOutcome["skipped_files"] = [];
  const conflictFiles: NonNullable<StarterDocsOutcome["conflict_files"]> = [];
  const skippedFilePaths = new Set<string>();
  const conflictFilePaths = new Set<string>();
  function skip(path: string, reason: string) {
    if (!skippedFilePaths.has(path)) {
      skippedFiles.push({ path, reason });
      skippedFilePaths.add(path);
    }
  }
  function conflict(path: string, reason: string) {
    if (!conflictFilePaths.has(path)) {
      conflictFiles.push({ path, reason });
      conflictFilePaths.add(path);
    }
  }
  for (const file of input.plan.files) {
    const targetPath = join(input.projectDir, file.path);
    const existing = await readOptional(targetPath);
    if (existing === null) {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(
        targetPath,
        withFinalNewline(remoteAgentReadyFileContent(file, input.projectName))
      );
      generatedFiles.push(file.path);
      continue;
    }
    if (file.path === "README.md") {
      skip(file.path, "Target file already exists.");
      continue;
    }
    const conflictReason = remoteAgentReadyManagedConflictReason(file.path, existing);
    if (conflictReason) {
      conflict(file.path, conflictReason);
      continue;
    }
    if (remoteAgentReadyAlreadyPresent(file.path, existing)) {
      skip(file.path, "Remote MCP agent-ready section already exists.");
      continue;
    }
    const updated = remoteAgentReadyUpsertedContent(file.path, existing);
    if (updated === null) {
      conflict(file.path, "Existing file is not eligible for remote agent-ready upsert.");
      continue;
    }
    if (updated.status === "conflict") {
      conflict(file.path, updated.reason);
      continue;
    }
    if (updated.content === existing) {
      skip(file.path, "Remote MCP agent-ready section already exists.");
      continue;
    }
    await writeFile(targetPath, updated.content);
    updatedFiles.push(file.path);
  }
  const changed = generatedFiles.length + updatedFiles.length;
  const hasConflicts = conflictFiles.length > 0;
  return {
    status:
      changed === 0
        ? hasConflicts
          ? "partial"
          : "skipped"
        : skippedFiles.length > 0 || updatedFiles.length > 0 || hasConflicts
          ? "partial"
          : "generated",
    reason: hasConflicts
      ? changed === 0
        ? "Remote agent-ready thin files need manual review before Recallant can edit them."
        : "Remote agent-ready thin files were generated or updated; some existing files need manual review."
      : changed === 0
        ? "Remote agent-ready thin files were already present."
        : "Remote agent-ready thin files were generated or updated.",
    generated_files: generatedFiles,
    updated_files: updatedFiles,
    skipped_files: skippedFiles,
    conflict_files: conflictFiles
  };
}

function remoteAgentReadyFileAllowed(input: {
  file: StarterDocsPlanFile;
  posture: Pick<DocumentationPosture, "status">;
}) {
  if (!remoteAgentReadyBasePaths.has(input.file.path)) return false;
  if (input.file.path === "README.md") return input.posture.status === "docs_absent";
  return true;
}

export function planRemoteAgentReadyFiles(input: {
  projectName: string;
  posture: Pick<DocumentationPosture, "status" | "profile" | "existing_docs">;
  existingTargetPaths?: readonly string[];
}): StarterDocsPlan {
  const basePlan = planStarterDocs({
    projectName: input.projectName,
    posture: input.posture,
    existingTargetPaths: input.existingTargetPaths,
    agentMode: "remote_mcp"
  });
  const files = basePlan.files
    .filter((file) => remoteAgentReadyFileAllowed({ file, posture: input.posture }))
    .map((file) => ({
      ...file,
      content: remoteAgentReadyFileContent(file, input.projectName)
    }));
  const existingTargets = new Set(input.existingTargetPaths ?? []);
  const skippedFiles = files
    .filter((file) => file.path === "README.md" && existingTargets.has(file.path))
    .map((file) => ({
      path: file.path,
      reason: "Target file already exists."
    }));
  const eligibleFiles = files.filter(
    (file) => file.path !== "README.md" || !existingTargets.has(file.path)
  );
  const missingFiles = eligibleFiles.filter((file) => !existingTargets.has(file.path));
  if (
    eligibleFiles.length === 0 ||
    (missingFiles.length === 0 && files.length === skippedFiles.length)
  ) {
    return {
      schema_version: 1,
      status: "targets_exist",
      profile: basePlan.profile,
      reason: "Remote agent-ready thin files already exist.",
      eligible_for_apply: false,
      writes_files: false,
      files,
      skipped_files: skippedFiles
    };
  }
  return {
    schema_version: 1,
    status: "ready",
    profile: basePlan.profile,
    reason:
      input.posture.status === "docs_absent"
        ? "No project documentation was discovered; remote agent-ready thin files can be created safely."
        : "Remote agent-ready AGENTS.md and PROJECT_LOG.md can be created without rewriting existing project docs.",
    eligible_for_apply: true,
    writes_files: false,
    files,
    skipped_files: skippedFiles
  };
}
