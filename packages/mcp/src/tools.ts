import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { isAbsolute, join, relative } from "node:path";
import {
  createRecallantDbFromEnv,
  emptyCanonCapabilityContext,
  type AgentMemorySourceRefInput,
  type ArchiveInput,
  type ContextPackInput,
  type CrossProjectRecallInput,
  type CreateAgentMemoryInput,
  type ForgetInput,
  type AppendEventInput,
  type AppendTurnInput,
  type JsonObject,
  type LinkMemoryInput,
  type ListAgentMemoriesInput,
  type RecallAgentMemoriesInput,
  type ReportRecallUsageInput,
  type ReviewAgentMemoryInput,
  type StartSessionInput
} from "@recallant/db";
import { z } from "zod";

type ToolDb = ReturnType<typeof createRecallantDbFromEnv>;

export type RecallantToolsRuntimeContext = {
  projectId?: string | null;
  projectPath?: string | null;
  developerId?: string | null;
  clientId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  getDatabase?: () => ToolDb;
};

const recallantToolsRuntimeContext = new AsyncLocalStorage<RecallantToolsRuntimeContext>();

const nullableString = z.string().nullable().optional();
const metadata = z.record(z.string(), z.unknown()).default({});
const uuidString = z.string().uuid();

const clientKind = z.enum(["codex", "cursor", "windsurf", "claude_code", "unknown", "other"]);
const scope = z.enum(["project", "developer", "all"]);
const memoryScope = z.enum(["project", "developer"]);
const sourceKind = z.enum(["event", "chunk", "raw_artifact", "edge", "checkpoint", "external"]);
const memoryType = z.enum([
  "decision",
  "constraint",
  "lesson",
  "failure",
  "work_log",
  "open_question",
  "artifact_reference",
  "preference",
  "procedure"
]);

export type RecallantToolName =
  | "memory_start_session"
  | "memory_heartbeat"
  | "memory_get_context_pack"
  | "memory_append_turn"
  | "memory_append_event"
  | "memory_search"
  | "memory_fetch_chunk"
  | "memory_link"
  | "memory_promote"
  | "memory_archive"
  | "memory_forget"
  | "memory_get_checkpoint"
  | "memory_set_checkpoint"
  | "memory_create_agent_memory"
  | "memory_review_agent_memory"
  | "memory_list_agent_memories"
  | "memory_get_agent_memory"
  | "memory_recall_agent_memories"
  | "memory_cross_project_recall"
  | "memory_report_recall_usage"
  | "memory_closeout";

export type RecallantToolDefinition = {
  name: RecallantToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

function currentRecallantToolsContext() {
  return contextAwarePath(recallantToolsRuntimeContext.getStore() ?? {});
}

export function runWithRecallantToolsContext<T>(
  context: RecallantToolsRuntimeContext,
  operation: () => Promise<T> | T
) {
  return recallantToolsRuntimeContext.run(contextAwarePath(context), operation);
}

function db() {
  const context = currentRecallantToolsContext();
  return context.getDatabase();
}

function contextAwarePath(context: RecallantToolsRuntimeContext) {
  return {
    projectId: context.projectId ?? null,
    projectPath: context.projectPath ?? null,
    developerId: context.developerId ?? null,
    clientId: context.clientId ?? null,
    sessionId: context.sessionId ?? null,
    traceId: context.traceId ?? null,
    getDatabase: context.getDatabase ?? (() => createRecallantDbFromEnv())
  };
}

function scopedProjectInput<T extends Record<string, unknown>>(args: T): T {
  const context = currentRecallantToolsContext();
  return {
    ...args,
    project_id: args.project_id ?? context.projectId ?? undefined,
    project_path: args.project_path ?? context.projectPath ?? undefined
  };
}

function remoteAgentSourceRef() {
  const context = currentRecallantToolsContext();
  const sourceId =
    context.traceId ??
    context.sessionId ??
    (context.clientId ? `remote-client:${context.clientId}` : null) ??
    (context.projectId ? `remote-project:${context.projectId}` : "remote-mcp");
  return {
    source_kind: "external",
    source_id: sourceId,
    quote: null,
    metadata: {
      source: "remote_mcp",
      project_id: context.projectId ?? null,
      developer_id: context.developerId ?? null,
      client_id: context.clientId ?? null,
      trace_id: context.traceId ?? null,
      session_id: context.sessionId ?? null
    }
  };
}

function scopedAgentMemoryInput(args: Record<string, unknown>): CreateAgentMemoryInput {
  const scoped = scopedProjectInput(args);
  const sourceRefs = Array.isArray(scoped.source_refs) ? scoped.source_refs : [];
  return {
    ...scoped,
    source_refs:
      scoped.created_by === "agent" && sourceRefs.length === 0
        ? [remoteAgentSourceRef()]
        : sourceRefs
  } as CreateAgentMemoryInput;
}

function syncProjectLogInContext(payload: JsonObject, database?: ToolDb) {
  const context = currentRecallantToolsContext();
  return syncProjectLog(payload, database, context.projectId, context.projectPath);
}

function nowIso() {
  return new Date().toISOString();
}

function stubResponse(tool: RecallantToolName, payload: Record<string, unknown>) {
  return {
    status: "stub",
    tool,
    ...payload
  };
}

function closeoutSourceRefs(rawRefs: unknown[], sessionId: string): AgentMemorySourceRefInput[] {
  const allowed = new Set(["event", "chunk", "raw_artifact", "edge", "checkpoint", "external"]);
  const refs = rawRefs
    .filter((ref): ref is Record<string, unknown> => typeof ref === "object" && ref !== null)
    .filter((ref) => allowed.has(String(ref.source_kind)) && typeof ref.source_id === "string")
    .map((ref) => ({
      source_kind: String(ref.source_kind),
      source_id: String(ref.source_id),
      quote: typeof ref.quote === "string" ? ref.quote : null,
      metadata:
        typeof ref.metadata === "object" && ref.metadata !== null
          ? (ref.metadata as JsonObject)
          : {}
    }));
  if (refs.length > 0) return refs;
  return [
    {
      source_kind: "checkpoint",
      source_id: sessionId,
      quote: null,
      metadata: { fallback_reason: "closeout_candidate_without_source_refs" }
    }
  ];
}

async function resolveProjectPath(
  database?: ToolDb,
  contextProjectId?: string | null,
  contextProjectPath?: string | null
) {
  if (contextProjectPath) return { path: contextProjectPath, source: "context" };
  const databaseProjectPath =
    database && contextProjectId ? await database.projectPrimaryPath(contextProjectId) : null;
  if (databaseProjectPath) return { path: databaseProjectPath, source: "database_primary_path" };
  const envProjectPath = process.env.RECALLANT_PROJECT_PATH;
  if (envProjectPath) return { path: envProjectPath, source: "env" };
  return null;
}

async function syncProjectLog(
  payload: JsonObject,
  database?: ToolDb,
  contextProjectId?: string | null,
  contextProjectPath?: string | null
) {
  const resolvedProjectPath = await resolveProjectPath(
    database,
    contextProjectId,
    contextProjectPath
  );
  if (!resolvedProjectPath) {
    return {
      status: "skipped",
      reason: "No project path is configured and no database primary path was found."
    };
  }
  let projectRoot: string;
  try {
    projectRoot = await realpath(resolvedProjectPath.path);
  } catch {
    return {
      status: "skipped",
      reason: "Configured project path is not present.",
      project_path: resolvedProjectPath.path,
      project_path_source: resolvedProjectPath.source
    };
  }
  const projectLogPath = join(projectRoot, "PROJECT_LOG.md");
  let projectLogRealPath: string;
  try {
    projectLogRealPath = await realpath(projectLogPath);
  } catch {
    return {
      status: "skipped",
      reason: "PROJECT_LOG.md is not present in the attached project.",
      project_path: projectRoot,
      project_path_source: resolvedProjectPath.source,
      path: projectLogPath
    };
  }
  const relativePath = relative(projectRoot, projectLogRealPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return {
      status: "skipped",
      reason: "PROJECT_LOG.md resolved outside the attached project path.",
      project_path: projectRoot,
      project_path_source: resolvedProjectPath.source,
      path: projectLogRealPath
    };
  }
  const openQuestions = Array.isArray(payload.open_questions)
    ? (payload.open_questions as unknown[]).map(String)
    : [];
  const currentSession = `## Current Session

Status: ${String(payload.current_status ?? "checkpoint updated")}
Current focus: ${String(payload.current_focus ?? "")}
Next step: ${String(payload.next_step ?? "")}
`;
  const questions = `## Open Questions

${openQuestions.length > 0 ? openQuestions.map((question) => `- ${question}`).join("\n") : "- None recorded."}
`;
  let rendered = "";
  try {
    const existing = await readFile(projectLogRealPath, "utf8");
    rendered = existing;
    const currentPattern = /## Current Session[\s\S]*?(?=\n## |$)/;
    rendered = currentPattern.test(rendered)
      ? rendered.replace(currentPattern, currentSession)
      : `${rendered.trimEnd()}\n\n${currentSession}`;
    const questionsPattern = /## Open Questions[\s\S]*?(?=\n## |$)/;
    rendered = questionsPattern.test(rendered)
      ? rendered.replace(questionsPattern, questions)
      : `${rendered.trimEnd()}\n\n${questions}`;
  } catch (error) {
    return {
      status: "skipped",
      reason: error instanceof Error ? error.message : String(error),
      project_path: projectRoot,
      project_path_source: resolvedProjectPath.source,
      path: projectLogRealPath
    };
  }
  await writeFile(projectLogRealPath, rendered);
  return {
    status: "updated",
    path: projectLogRealPath,
    project_path: projectRoot,
    project_path_source: resolvedProjectPath.source
  };
}

export const recallantToolsBase: readonly RecallantToolDefinition[] = [
  {
    name: "memory_start_session",
    title: "Start Session",
    description: "Start or resume a Recallant-tracked agent session.",
    inputSchema: z.object({
      client_kind: clientKind,
      client_version: nullableString,
      project_path: nullableString,
      session_label: nullableString,
      resume_policy: z.enum(["normal", "force_new", "recover_previous"]).default("normal")
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.startSession(scopedProjectInput(args) as StartSessionInput);
      return stubResponse("memory_start_session", {
        session_id: randomUUID(),
        project_id:
          currentRecallantToolsContext().projectId ??
          process.env.RECALLANT_PROJECT_ID ??
          randomUUID(),
        checkpoint: { payload: null, updated_at: null },
        previous_unclosed_session: null,
        recommended_next_calls: ["memory_get_context_pack"]
      });
    }
  },
  {
    name: "memory_heartbeat",
    title: "Heartbeat",
    description: "Update session liveness without creating raw memory events.",
    inputSchema: z.object({
      session_id: uuidString,
      status: z.enum([
        "active",
        "idle",
        "running_tests",
        "running_command",
        "background_job",
        "unknown"
      ]),
      note: nullableString,
      metadata
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        const heartbeat = await database.heartbeat(
          args.session_id as string,
          args.status as string,
          args.note as string | null | undefined,
          args.metadata as JsonObject | undefined
        );
        return {
          ok: true,
          session_id: heartbeat?.id ?? args.session_id,
          last_seen_at: heartbeat?.last_seen_at ?? nowIso(),
          last_heartbeat_at: heartbeat?.last_heartbeat_at ?? nowIso()
        };
      }
      return stubResponse("memory_heartbeat", {
        ok: true,
        session_id: args.session_id,
        last_seen_at: nowIso(),
        last_heartbeat_at: nowIso()
      });
    }
  },
  {
    name: "memory_get_context_pack",
    title: "Get Context Pack",
    description: "Build bounded startup context for an agent session.",
    inputSchema: z.object({
      session_id: uuidString,
      task_hint: nullableString,
      project_id: uuidString.nullable().optional(),
      max_chars_total: z.number().int().positive().default(12_000),
      include_raw_evidence: z.enum(["auto", "never", "always"]).default("auto"),
      include_recovery: z.boolean().default(true),
      local_spool_status: z.record(z.string(), z.unknown()).nullable().optional()
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.getContextPack(scopedProjectInput(args) as ContextPackInput);
      return stubResponse("memory_get_context_pack", {
        context_pack_id: randomUUID(),
        project_id:
          args.project_id ??
          currentRecallantToolsContext().projectId ??
          process.env.RECALLANT_PROJECT_ID ??
          randomUUID(),
        session_id: args.session_id,
        profile: "compact",
        sections: {
          checkpoint: {},
          documentation_posture: {
            status: "not_recorded",
            profile: "unknown",
            summary: "No database-backed documentation posture is available in MCP skeleton mode.",
            missing_recommended_docs: [],
            review_options: [
              {
                option: "discuss_first",
                recommended: true,
                reason: "Connect Recallant storage or open Workbench review before changing docs."
              }
            ],
            authority: {
              source: "mcp_skeleton_stub",
              key: "documentation_posture",
              role: "startup_guidance",
              instruction_grade: false,
              notes: [
                "Placeholder only. This stub contains no project docs, secrets, or binding rules."
              ]
            },
            canon_context: {
              needed: false,
              reason: null,
              recommended_reference_kinds: [],
              configured_references: []
            },
            capability_hints: []
          },
          canon_capability_context: emptyCanonCapabilityContext(),
          recovery: {},
          binding_rules: [],
          working_memories: [],
          operational_bindings: [],
          local_spool_status: args.local_spool_status ?? { status: "unknown" },
          evidence_excerpts: [],
          suggested_next_fetches: [],
          warnings: ["MCP skeleton stub: database-backed context pack is not implemented yet."]
        },
        truncated: false,
        budget: {
          max_chars_total: args.max_chars_total,
          used_chars_estimate: 0
        }
      });
    }
  },
  {
    name: "memory_append_turn",
    title: "Append Turn",
    description: "Append a user or assistant turn as raw L0 evidence.",
    inputSchema: z.object({
      session_id: uuidString.nullable().optional(),
      client_kind: clientKind,
      role: z.enum(["user", "assistant"]),
      text: z.string().min(1),
      occurred_at: nullableString,
      dedup_key: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.appendTurn(args as AppendTurnInput);
      return stubResponse("memory_append_turn", { event_id: randomUUID(), status: "created" });
    }
  },
  {
    name: "memory_append_event",
    title: "Append Event",
    description: "Append non-turn workflow evidence and raw artifact refs.",
    inputSchema: z.object({
      session_id: uuidString.nullable().optional(),
      client_kind: clientKind,
      event_kind: z.enum([
        "tool_call",
        "tool_result",
        "terminal_output",
        "file_change",
        "system",
        "other"
      ]),
      text: nullableString,
      metadata,
      raw_artifacts: z
        .array(
          z.object({
            artifact_kind: z.enum([
              "tool_output",
              "terminal_output",
              "attachment",
              "transcript_export",
              "media",
              "other"
            ]),
            storage_backend: z.enum([
              "local_spool",
              "server_filesystem",
              "postgres_inline",
              "object_storage",
              "external"
            ]),
            uri: nullableString,
            sha256: nullableString,
            size_bytes: z.number().int().nonnegative().nullable().optional(),
            content_type: nullableString,
            excerpt: nullableString,
            metadata
          })
        )
        .default([]),
      occurred_at: nullableString,
      dedup_key: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.appendEvent(args as AppendEventInput);
      return stubResponse("memory_append_event", {
        event_id: randomUUID(),
        raw_artifact_ids: Array.from({ length: (args.raw_artifacts as unknown[]).length }, () =>
          randomUUID()
        ),
        status: "created"
      });
    }
  },
  {
    name: "memory_search",
    title: "Search Raw Evidence",
    description: "Search raw chunks with lexical/vector/hybrid retrieval.",
    inputSchema: z.object({
      query: z.string().min(1),
      mode: z.enum(["hybrid", "vector_only", "lexical_only"]).default("hybrid"),
      session_id: uuidString.nullable().optional(),
      source_id: uuidString.nullable().optional(),
      scope: scope.default("project"),
      scope_kind: nullableString,
      audience: nullableString,
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000),
      graph_expand: z.boolean().default(false),
      graph_budget_nodes: z.number().int().nonnegative().default(8),
      include_archived: z.boolean().default(false)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.search({
          query: args.query as string,
          mode: args.mode as string | undefined,
          top_k: args.top_k as number | undefined,
          max_chars_total: args.max_chars_total as number | undefined,
          session_id: args.session_id as string | null | undefined,
          source_id: args.source_id as string | null | undefined,
          scope: args.scope as string | undefined,
          scope_kind: args.scope_kind as string | null | undefined,
          audience: args.audience as string | null | undefined,
          graph_expand: args.graph_expand as boolean | undefined,
          graph_budget_nodes: args.graph_budget_nodes as number | undefined,
          include_archived: args.include_archived as boolean | undefined
        });
      }
      return stubResponse("memory_search", { hits: [], truncated: false });
    }
  },
  {
    name: "memory_fetch_chunk",
    title: "Fetch Chunk",
    description: "Fetch one bounded chunk by id.",
    inputSchema: z.object({
      chunk_id: uuidString,
      max_chars: z.number().int().positive().default(16_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.fetchChunk(args.chunk_id as string, args.max_chars as number | undefined);
      }
      return stubResponse("memory_fetch_chunk", {
        chunk_id: args.chunk_id,
        text: "",
        source_event_id: null,
        metadata: {}
      });
    }
  },
  {
    name: "memory_link",
    title: "Link Memory Records",
    description: "Create a graph edge between chunks, events, or external refs.",
    inputSchema: z.object({
      src_kind: z.enum(["chunk", "event"]),
      src_id: z.string().min(1),
      dst_kind: z.enum(["chunk", "event", "external"]),
      dst_id: z.string().min(1),
      relation_type: z.string().min(1),
      weight: z.number().default(1.0),
      metadata
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.linkMemory(args as LinkMemoryInput);
      return stubResponse("memory_link", { edge_id: randomUUID() });
    }
  },
  {
    name: "memory_promote",
    title: "Promote Memory",
    description: "Compatibility helper for promoting a chunk into broader governed scope.",
    inputSchema: z.object({
      chunk_id: uuidString,
      note: nullableString
    }),
    handler: (args) =>
      stubResponse("memory_promote", {
        ok: true,
        chunk_id: args.chunk_id,
        scope: "developer",
        scope_kind: "developer"
      })
  },
  {
    name: "memory_archive",
    title: "Archive Chunk",
    description: "Archive or unarchive a chunk for ordinary search.",
    inputSchema: z.object({
      chunk_id: uuidString,
      action: z.enum(["archive", "unarchive"])
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.archiveChunk(args as ArchiveInput);
      return stubResponse("memory_archive", {
        ok: true,
        chunk_id: args.chunk_id,
        archived_at: args.action === "archive" ? nowIso() : null
      });
    }
  },
  {
    name: "memory_forget",
    title: "Forget Content",
    description: "Preview or run an owner-confirmed erasure workflow.",
    inputSchema: z.object({
      target: z.object({
        kind: z.enum([
          "event",
          "chunk",
          "agent_memory",
          "raw_artifact",
          "search_query",
          "scope_selector"
        ]),
        id: z.string().nullable().optional(),
        selector: metadata
      }),
      reason: nullableString,
      dry_run: z.boolean().default(true),
      confirmation: z
        .object({
          confirmed: z.boolean().default(false),
          confirmation_token: nullableString
        })
        .default({ confirmed: false })
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.forget(args as ForgetInput);
      return stubResponse("memory_forget", {
        erasure_id: randomUUID(),
        status: "preview",
        requires_confirmation: true,
        affected: {
          events: 0,
          chunks: 0,
          embeddings: 0,
          agent_memories: 0,
          raw_artifacts: 0,
          derived_summaries: 0
        },
        warnings: ["MCP skeleton stub: erasure preview is not database-backed yet."],
        redacted_receipt: {}
      });
    }
  },
  {
    name: "memory_get_checkpoint",
    title: "Get Checkpoint",
    description: "Fetch the current project checkpoint.",
    inputSchema: z.object({}),
    handler: async () => {
      const database = db();
      if (database) {
        return database.getCheckpoint(
          currentRecallantToolsContext().projectId ?? process.env.RECALLANT_PROJECT_ID
        );
      }
      return stubResponse("memory_get_checkpoint", { payload: null, updated_at: null });
    }
  },
  {
    name: "memory_set_checkpoint",
    title: "Set Checkpoint",
    description: "Set the current project checkpoint.",
    inputSchema: z.object({
      payload: z.object({
        current_status: z.string(),
        current_focus: z.string(),
        next_step: z.string(),
        last_event_id: uuidString.nullable().optional(),
        open_questions: z.array(z.string()).default([])
      })
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        const checkpoint = await database.setCheckpoint(
          currentRecallantToolsContext().projectId ?? process.env.RECALLANT_PROJECT_ID,
          args.payload as JsonObject
        );
        try {
          return {
            ok: true,
            updated_at: checkpoint?.updated_at ?? nowIso(),
            repo_sync: await syncProjectLogInContext(args.payload as JsonObject, database)
          };
        } catch (error) {
          return {
            ok: true,
            updated_at: checkpoint?.updated_at ?? nowIso(),
            repo_sync: {
              status: "failed",
              reason: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }
      return stubResponse("memory_set_checkpoint", { ok: true, updated_at: nowIso() });
    }
  },
  {
    name: "memory_create_agent_memory",
    title: "Create Agent Memory",
    description: "Create a governed structured memory record.",
    inputSchema: z.object({
      memory_type: memoryType,
      scope: memoryScope,
      scope_kind: nullableString,
      scope_id: nullableString,
      audience: z
        .array(
          z.object({
            kind: z.enum([
              "all_agents",
              "specific_client",
              "context_pack",
              "background_worker",
              "review_ui",
              "human_owner",
              "import_pipeline",
              "connector"
            ]),
            id: nullableString
          })
        )
        .default([]),
      title: z.string().min(1),
      body: z.string().min(1),
      confidence: z.number().min(0).max(1).nullable().optional(),
      source_refs: z
        .array(
          z.object({
            source_kind: sourceKind,
            source_id: z.string().min(1),
            quote: nullableString
          })
        )
        .default([]),
      created_by: z.enum(["agent", "user", "system", "import"]),
      metadata
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.createAgentMemory(scopedAgentMemoryInput(args));
      return stubResponse("memory_create_agent_memory", {
        memory_id: randomUUID(),
        status: args.created_by === "agent" ? "accepted" : "candidate",
        use_policy: "recall_allowed"
      });
    }
  },
  {
    name: "memory_review_agent_memory",
    title: "Review Agent Memory",
    description: "Update review or use state for a governed memory.",
    inputSchema: z.object({
      memory_id: uuidString,
      action: z.enum([
        "accept",
        "approve",
        "reject",
        "supersede",
        "archive",
        "unarchive",
        "mark_stale",
        "promote_instruction",
        "demote_instruction",
        "edit",
        "merge"
      ]),
      superseded_by: uuidString.nullable().optional(),
      merge_memory_ids: z.array(uuidString).default([]),
      patch: z
        .object({
          title: nullableString,
          body: nullableString,
          scope: memoryScope.nullable().optional(),
          scope_kind: nullableString,
          scope_id: nullableString,
          audience: z.array(z.unknown()).optional(),
          memory_type: nullableString
        })
        .default({}),
      note: nullableString,
      actor_kind: z.enum(["user", "agent", "system"])
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.reviewAgentMemory(args as ReviewAgentMemoryInput);
      return stubResponse("memory_review_agent_memory", {
        ok: true,
        memory_id: args.memory_id,
        status: args.action === "reject" ? "rejected" : "accepted",
        use_policy: args.action === "promote_instruction" ? "instruction_grade" : "recall_allowed"
      });
    }
  },
  {
    name: "memory_list_agent_memories",
    title: "List Agent Memories",
    description: "List governed memories for management surfaces.",
    inputSchema: z.object({
      view: z.enum(["inbox", "rules", "candidates", "duplicates", "conflicts", "all"]),
      project_id: uuidString.nullable().optional(),
      source_id: uuidString.nullable().optional(),
      scope: memoryScope.nullable().optional(),
      scope_kind: nullableString,
      audience_kind: nullableString,
      memory_domain: nullableString,
      status: nullableString,
      use_policy: nullableString,
      limit: z.number().int().positive().max(200).default(50)
    }),
    handler: async (args) => {
      const database = db();
      if (database)
        return database.listAgentMemories(scopedProjectInput(args) as ListAgentMemoriesInput);
      return stubResponse("memory_list_agent_memories", { memories: [] });
    }
  },
  {
    name: "memory_get_agent_memory",
    title: "Get Agent Memory",
    description: "Return one governed memory with source refs and review history.",
    inputSchema: z.object({
      memory_id: uuidString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.getAgentMemory(args.memory_id as string);
      return stubResponse("memory_get_agent_memory", {
        memory: { memory_id: args.memory_id },
        source_refs: [],
        review_actions: [],
        related_memories: []
      });
    }
  },
  {
    name: "memory_recall_agent_memories",
    title: "Recall Agent Memories",
    description: "Return bounded governed memories relevant to the current task.",
    inputSchema: z.object({
      query: z.string().min(1),
      source_id: uuidString.nullable().optional(),
      scope: scope.default("project"),
      scope_kind: nullableString,
      audience_kind: nullableString,
      memory_types: z.array(memoryType).default([]),
      include_candidates: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      include_needs_review: z.boolean().default(false),
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        return database.recallAgentMemories(scopedProjectInput(args) as RecallAgentMemoriesInput);
      }
      return stubResponse("memory_recall_agent_memories", {
        trace_id: randomUUID(),
        memories: [],
        truncated: false
      });
    }
  },
  {
    name: "memory_cross_project_recall",
    title: "Cross-Project Recall",
    description:
      "Explicitly retrieve source-linked governed-memory examples from this project, other projects, developer rules, or environment/capability records without adding them to default context.",
    inputSchema: z.object({
      query: z.string().min(1),
      mode: z
        .enum([
          "same_project",
          "developer_rules",
          "environment",
          "similar_projects",
          "all_projects_review"
        ])
        .default("similar_projects"),
      session_id: uuidString.nullable().optional(),
      scope_kind: nullableString,
      memory_types: z.array(z.string().min(1)).default([]),
      include_candidates: z.boolean().default(false),
      include_stale: z.boolean().default(false),
      include_needs_review: z.boolean().default(false),
      include_detached: z.boolean().default(false),
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000)
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.crossProjectRecall(args as CrossProjectRecallInput);
      return stubResponse("memory_cross_project_recall", {
        trace_id: randomUUID(),
        mode: args.mode ?? "similar_projects",
        results: [],
        truncated: false,
        policy: {
          default_context_pack_includes_cross_project_examples: false,
          cross_project_results_are_binding_rules: false
        }
      });
    }
  },
  {
    name: "memory_report_recall_usage",
    title: "Report Recall Usage",
    description: "Report which recalled memories or chunks were used or ignored.",
    inputSchema: z.object({
      trace_id: uuidString,
      used_memory_ids: z.array(uuidString).default([]),
      ignored_memory_ids: z.array(uuidString).default([]),
      used_chunk_ids: z.array(uuidString).default([]),
      note: nullableString
    }),
    handler: async (args) => {
      const database = db();
      if (database) return database.reportRecallUsage(args as ReportRecallUsageInput);
      return stubResponse("memory_report_recall_usage", { ok: true });
    }
  },
  {
    name: "memory_closeout",
    title: "Close Out Session",
    description: "Run durable closeout for an ending or pausing session.",
    inputSchema: z.object({
      session_id: uuidString,
      closeout_intent: z.enum([
        "manual_exit",
        "pause",
        "task_complete",
        "context_compaction",
        "other"
      ]),
      summary: z.string(),
      checkpoint_payload: z.object({
        current_status: z.string(),
        current_focus: z.string(),
        next_step: z.string(),
        last_event_id: uuidString.nullable().optional(),
        open_questions: z.array(z.string()).default([])
      }),
      governed_memory_candidates: z
        .array(
          z.object({
            memory_type: memoryType,
            title: z.string(),
            body: z.string(),
            confidence: z.number().min(0).max(1).nullable().optional(),
            source_refs: z.array(z.unknown()).default([])
          })
        )
        .default([]),
      artifact_refs: z
        .array(
          z.object({
            kind: z.enum(["file", "commit", "url", "external"]),
            ref: z.string(),
            note: nullableString
          })
        )
        .default([]),
      closeout_diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
      local_spool_status: z.record(z.string(), z.unknown()).nullable().optional()
    }),
    handler: async (args) => {
      const database = db();
      if (database) {
        const checkpoint = await database.closeout(
          args.session_id as string,
          args.checkpoint_payload as JsonObject,
          "closeout",
          args.local_spool_status as JsonObject | null | undefined,
          args.closeout_diagnostics as JsonObject | null | undefined
        );
        const createdMemoryIds: string[] = [];
        const needsReviewIds: string[] = [];
        const warnings = [...(checkpoint?.warnings ?? [])];
        for (const candidate of args.governed_memory_candidates as Array<Record<string, unknown>>) {
          if (typeof candidate.confidence === "number" && candidate.confidence < 0.5) {
            warnings.push(
              `Closeout candidate "${String(candidate.title)}" has low extraction confidence.`
            );
          }
          try {
            const created = await database.createAgentMemory({
              memory_type: String(candidate.memory_type),
              scope: "project",
              title: String(candidate.title),
              body: String(candidate.body),
              confidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
              source_refs: closeoutSourceRefs(
                Array.isArray(candidate.source_refs) ? candidate.source_refs : [],
                String(args.session_id)
              ),
              created_by: "agent",
              metadata: { created_from: "memory_closeout" }
            });
            if (created.memory_id) createdMemoryIds.push(created.memory_id);
            if (created.status === "candidate" || created.status === "needs_review") {
              needsReviewIds.push(created.memory_id);
            }
          } catch (error) {
            warnings.push(
              `Failed to create closeout governed-memory candidate: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
        if (needsReviewIds.length > 0) {
          warnings.push(
            `Closeout created ${needsReviewIds.length} governed-memory candidate(s) requiring review.`
          );
        }
        let projectLogUpdate: Awaited<ReturnType<typeof syncProjectLog>>;
        try {
          projectLogUpdate = await syncProjectLogInContext(
            args.checkpoint_payload as JsonObject,
            database
          );
        } catch (error) {
          projectLogUpdate = {
            status: "failed",
            reason: error instanceof Error ? error.message : String(error)
          };
          warnings.push(`Failed to update PROJECT_LOG.md: ${projectLogUpdate.reason}`);
        }
        return {
          ok: true,
          session_id: args.session_id,
          checkpoint_updated_at: checkpoint?.updated_at ?? nowIso(),
          created_memory_ids: createdMemoryIds,
          needs_review_ids: needsReviewIds,
          spool_sync_status: checkpoint?.spool_sync_status ?? "not_provided",
          report_required:
            checkpoint?.report_required === true ||
            needsReviewIds.length > 0 ||
            warnings.length > 0,
          warnings,
          project_log_update: projectLogUpdate
        };
      }
      return stubResponse("memory_closeout", {
        ok: true,
        session_id: args.session_id,
        checkpoint_updated_at: nowIso(),
        created_memory_ids: [],
        needs_review_ids: [],
        spool_sync_status: "not_applicable",
        report_required: true,
        warnings: ["MCP skeleton stub: closeout is not database-backed yet."],
        project_log_update: {
          required: true,
          suggested_payload: args.checkpoint_payload
        }
      });
    }
  }
];

export function createRecallantTools(
  context: RecallantToolsRuntimeContext = {}
): readonly RecallantToolDefinition[] {
  const runtimeContext = contextAwarePath(context);
  return recallantToolsBase.map((tool) => ({
    ...tool,
    handler: (args) => runWithRecallantToolsContext(runtimeContext, () => tool.handler(args))
  }));
}

export const recallantTools = createRecallantTools();

export const recallantToolNames = recallantTools.map((tool) => tool.name);
