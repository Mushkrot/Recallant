import { randomUUID } from "node:crypto";
import { z } from "zod";

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
  | "memory_report_recall_usage"
  | "memory_closeout";

export type RecallantToolDefinition = {
  name: RecallantToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Record<string, unknown>;
};

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

export const recallantTools: readonly RecallantToolDefinition[] = [
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
    handler: () =>
      stubResponse("memory_start_session", {
        session_id: randomUUID(),
        project_id: process.env.RECALLANT_PROJECT_ID ?? randomUUID(),
        checkpoint: { payload: null, updated_at: null },
        previous_unclosed_session: null,
        recommended_next_calls: ["memory_get_context_pack"]
      })
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
    handler: (args) =>
      stubResponse("memory_heartbeat", {
        ok: true,
        session_id: args.session_id,
        last_seen_at: nowIso(),
        last_heartbeat_at: nowIso()
      })
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
      include_recovery: z.boolean().default(true)
    }),
    handler: (args) =>
      stubResponse("memory_get_context_pack", {
        context_pack_id: randomUUID(),
        project_id: args.project_id ?? process.env.RECALLANT_PROJECT_ID ?? randomUUID(),
        session_id: args.session_id,
        profile: "compact",
        sections: {
          checkpoint: {},
          recovery: {},
          binding_rules: [],
          working_memories: [],
          operational_bindings: [],
          evidence_excerpts: [],
          suggested_next_fetches: [],
          warnings: ["MCP skeleton stub: database-backed context pack is not implemented yet."]
        },
        truncated: false,
        budget: {
          max_chars_total: args.max_chars_total,
          used_chars_estimate: 0
        }
      })
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
    handler: () => stubResponse("memory_append_turn", { event_id: randomUUID(), status: "created" })
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
    handler: (args) =>
      stubResponse("memory_append_event", {
        event_id: randomUUID(),
        raw_artifact_ids: Array.from({ length: (args.raw_artifacts as unknown[]).length }, () =>
          randomUUID()
        ),
        status: "created"
      })
  },
  {
    name: "memory_search",
    title: "Search Raw Evidence",
    description: "Search raw chunks with lexical/vector/hybrid retrieval.",
    inputSchema: z.object({
      query: z.string().min(1),
      mode: z.enum(["hybrid", "vector_only", "lexical_only"]).default("hybrid"),
      scope: scope.default("project"),
      scope_kind: nullableString,
      audience: nullableString,
      top_k: z.number().int().positive().default(8),
      max_chars_total: z.number().int().positive().default(12_000),
      graph_expand: z.boolean().default(false),
      graph_budget_nodes: z.number().int().nonnegative().default(8)
    }),
    handler: () => stubResponse("memory_search", { hits: [], truncated: false })
  },
  {
    name: "memory_fetch_chunk",
    title: "Fetch Chunk",
    description: "Fetch one bounded chunk by id.",
    inputSchema: z.object({
      chunk_id: uuidString,
      max_chars: z.number().int().positive().default(16_000)
    }),
    handler: (args) =>
      stubResponse("memory_fetch_chunk", {
        chunk_id: args.chunk_id,
        text: "",
        source_event_id: null,
        metadata: {}
      })
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
    handler: () => stubResponse("memory_link", { edge_id: randomUUID() })
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
    handler: (args) =>
      stubResponse("memory_archive", {
        ok: true,
        chunk_id: args.chunk_id,
        archived_at: args.action === "archive" ? nowIso() : null
      })
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
    handler: () =>
      stubResponse("memory_forget", {
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
      })
  },
  {
    name: "memory_get_checkpoint",
    title: "Get Checkpoint",
    description: "Fetch the current project checkpoint.",
    inputSchema: z.object({}),
    handler: () => stubResponse("memory_get_checkpoint", { payload: null, updated_at: null })
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
    handler: () => stubResponse("memory_set_checkpoint", { ok: true, updated_at: nowIso() })
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
    handler: (args) =>
      stubResponse("memory_create_agent_memory", {
        memory_id: randomUUID(),
        status: args.created_by === "agent" ? "accepted" : "candidate",
        use_policy: "recall_allowed"
      })
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
    handler: (args) =>
      stubResponse("memory_review_agent_memory", {
        ok: true,
        memory_id: args.memory_id,
        status: args.action === "reject" ? "rejected" : "accepted",
        use_policy: args.action === "promote_instruction" ? "instruction_grade" : "recall_allowed"
      })
  },
  {
    name: "memory_list_agent_memories",
    title: "List Agent Memories",
    description: "List governed memories for management surfaces.",
    inputSchema: z.object({
      view: z.enum(["inbox", "rules", "candidates", "duplicates", "conflicts", "all"]),
      project_id: uuidString.nullable().optional(),
      scope: memoryScope.nullable().optional(),
      scope_kind: nullableString,
      audience_kind: nullableString,
      memory_domain: nullableString,
      status: nullableString,
      use_policy: nullableString,
      limit: z.number().int().positive().max(200).default(50)
    }),
    handler: () => stubResponse("memory_list_agent_memories", { memories: [] })
  },
  {
    name: "memory_get_agent_memory",
    title: "Get Agent Memory",
    description: "Return one governed memory with source refs and review history.",
    inputSchema: z.object({
      memory_id: uuidString
    }),
    handler: (args) =>
      stubResponse("memory_get_agent_memory", {
        memory: { memory_id: args.memory_id },
        source_refs: [],
        review_actions: [],
        related_memories: []
      })
  },
  {
    name: "memory_recall_agent_memories",
    title: "Recall Agent Memories",
    description: "Return bounded governed memories relevant to the current task.",
    inputSchema: z.object({
      query: z.string().min(1),
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
    handler: () =>
      stubResponse("memory_recall_agent_memories", {
        trace_id: randomUUID(),
        memories: [],
        truncated: false
      })
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
    handler: () => stubResponse("memory_report_recall_usage", { ok: true })
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
        .default([])
    }),
    handler: (args) =>
      stubResponse("memory_closeout", {
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
      })
  }
];

export const recallantToolNames = recallantTools.map((tool) => tool.name);
