# Glossary

Terms and stable identifiers. Code and APIs should use the same names defined here.

## Core concepts

| Term | Definition |
|------|------------|
| **Developer** | Owner of one or more projects. Top-level memory hierarchy. Identifier: `developer_id` (UUID). v1 may use one developer per Recallant instance. |
| **Project** | Logical memory isolation unit, usually 1:1 with a git repository root on disk. May have a parent project for subproject/workspace hierarchy. Belongs to `developer_id`. Identifier: `project_id` (UUID). |
| **MemoryDomain** | High-level memory domain: `agent_work` for coding-agent workflow now; future domains can cover broader personal memory. |
| **Workspace** | Physical path on the user's machine associated with `project_id`. It can change; ingest stores it as metadata, not as a primary key. |
| **Session** | Continuous working period of one CLI/client with the user. Identifier: `session_id` (UUID). |
| **Heartbeat** | Lightweight session liveness update for long-running/idle tasks. Updates session metadata only and does not create raw memory events. |
| **Turn** | One user or assistant message inside a `session_id`. Immutable after normal write to the raw layer; explicit erasure is a separate exception. |
| **Event** | Normalized append log record that may wrap a turn, system event, or checkpoint update. Identifier: `event_id` (UUID). |
| **RawEvidence** | Lower factual layer: turns, workflow events, command/tool traces, large-output excerpts, and raw artifact refs. Used for recovery/audit/reprocess, not as direct behavior instruction. |
| **RawArtifact** | Large raw evidence payload stored outside normal event JSONB: terminal/tool output, attachment, media, transcript export, etc. Postgres stores pointer/hash/excerpt/metadata. |
| **Chunk** | Text fragment for indexing/embedding. It has provenance such as `source_event_id` and scope/audience metadata. |
| **ScopeKind** | Where a memory applies: `domain`, `developer`, `environment`, `project`, `repo`, `subproject`, `session`, `connector_account`, `capability`, `client_adapter`. See ADR-0040. |
| **Audience** | Who/what may consume a memory: `all_agents`, `specific_client`, `context_pack`, `background_worker`, `review_ui`, `human_owner`, `import_pipeline`, `connector`. |
| **Scope** | Legacy shorthand for visibility. Older docs using `project`/`developer` should be read as the default subset of the ADR-0040 multi-axis scope model. |
| **Checkpoint** | Small structured record of where work stopped: current task, open questions, and links to recent relevant `event_id` values. |
| **Edge** | Typed graph edge between entities, for example chunk-to-chunk or turn-to-file-path. Uses `relation_type`. |
| **AgentMemory** | Structured governed memory record: decision, constraint, lesson, failure, work_log, preference, artifact reference, etc. Has review/use metadata and provenance except for explicit imported/user-confirmed records. |
| **SourceRef** | AgentMemory link to evidence: event, chunk, edge, checkpoint, raw artifact, or external ref. |
| **ReviewAction** | Human/agent/system action on AgentMemory: accept/approve, reject, supersede, archive, promote, demote, mark stale, edit, merge, forget. |
| **UsePolicy** | Rule for agent use of AgentMemory: evidence-only, recall-allowed, instruction-grade, do-not-use. |
| **RecallTrace** | Audit/observability record of which chunks/AgentMemory records were returned and which ones the agent marked as used or ignored. |
| **ContextBudget** | Limit on how much repo-native instruction and recalled memory an agent loads into the active model window. See `CONTEXT_BUDGET.md`. |
| **ContextPack** | Bounded server-built startup context for an agent session: checkpoint, relevant governed memories/rules, recovery warnings, optional evidence excerpts, and suggested next fetches. |
| **ContextPackBuilder** | Server-side policy engine that constructs ContextPack. CLI/UI previews must call this same logic rather than reimplementing context selection. |
| **ResolverHint** | Declarative hint indicating which doc/skill/memory to load for a task type. Inspired by Journey kit manifests. |
| **ErasureRequest** | Owner-confirmed permanent deletion/redaction workflow for content that must be forgotten. Produces only a redacted receipt and removes derived material. |

## Layers (storage)

| Layer | Name | Mutability |
|-------|------|------------|
| **L0** | Raw append | Normal operation is append-only. Explicit owner-confirmed erasure may hard-delete or redact content through an erasure workflow. |
| **L1** | Derived chunks + embeddings | Generated from L0; versioned; rebuildable; erasure removes derived material. |
| **L2** | Graph edges | Append plus optional soft-delete by policy; erasure removes/redacts edges that expose forgotten content. |
| **L3** | Governed agent memories | Structured memory with provenance, review status, use policy, and recall traces. |

## Retrieval

| Term | Definition |
|------|------------|
| **Hybrid retrieval** | Combination of vector similarity and lexical match such as full-text or BM25-like ranking. |
| **Graph expansion** | Expansion of search results through L2 edges within a configured budget. |
| **Rerank** | Second ordering stage after hybrid recall candidates are built. |

## Model routing

| Term | Definition |
|------|------------|
| **ActiveAgentRoute** | The currently open agent session, such as Codex, performs reasoning and writes the result to Recallant through MCP tools. |
| **SubscriptionWorkerRoute** | A background/local/server worker uses supported OAuth/sign-in subscription mechanisms and existing plan limits. |
| **PaidApiRoute** | Direct token/credit-billed API call to OpenAI, Gemini, Claude, or a compatible paid provider. |
| **Subscription-first/API-last** | Routing rule: use local/active-agent/subscription-backed paths before direct paid API, and never silently fall through to paid API after subscription limits are hit. |

## MCP

| Term | Definition |
|------|------------|
| **Tool** | MCP tool with a fixed name and JSON Schema input/output; see `MCP_SPEC.md`. |
| **Transport** | stdio or streamable HTTP by implementation choice; tool contracts do not depend on transport. |

## Enums (initial)

### `relation_type` (non-exhaustive, extensible by migration)

- `follows`: temporal order or continuation of a topic.
- `references`: reference to an entity such as a file, commit, URL, or text label.
- `duplicates`: semantic duplicate.
- `contradicts`: explicit contradiction, optional in v1.
- `supersedes`: newer chunk/memory replaces older material; older material gets retrieval penalty according to `CLEANUP.md`.

### `client_kind`

- `codex` | `cursor` | `windsurf` | `claude_code` | `unknown` | `other`

### `heartbeat_status`

- `active`: client is alive and actively working.
- `idle`: client is alive but no active memory work is happening.
- `running_tests`: long-running test command.
- `running_command`: long-running shell/tool command.
- `background_job`: import/sync/index/background operation.
- `unknown`: liveness known, specific activity unknown.

### `project_kind`

- `repo`: ordinary git/code project.
- `subproject`: child project inside a larger workspace/product.
- `workspace`: umbrella workspace grouping multiple repos/projects.
- `personal_domain`: future non-coding personal memory domain.
- `other`: explicit extension point.

### `scope_kind`

- `domain`: broad memory domain.
- `developer`: owner-level cross-project scope.
- `environment`: a specific Recallant installation/server/runtime.
- `project`: logical project/workspace.
- `repo`: concrete repository/checkout.
- `subproject`: package/app/module inside a larger project/repo.
- `session`: current/recent session state.
- `connector_account`: external account context such as Google personal/corporate.
- `capability`: permitted operation backed by provider/token/account.
- `client_adapter`: Codex/Claude/Cursor/Windsurf-specific guidance.

### `audience_kind`

- `all_agents`
- `specific_client`
- `context_pack`
- `background_worker`
- `review_ui`
- `human_owner`
- `import_pipeline`
- `connector`

### `memory_domain`

- `agent_work`: coding-agent work, v1 default.
- `personal_life`: future broader personal memory.
- `research`: future research/general knowledge domain.
- `other`: explicit extension point.

### `ingest_source`

- `mcp_append` | `file_import` | `cli_export` | `api` | `system`

### `event_kind`

- `turn_user`: user message.
- `turn_assistant`: assistant message.
- `tool_call`: agent/client tool invocation metadata.
- `tool_result`: tool result metadata/excerpt.
- `terminal_output`: shell/terminal output metadata/excerpt.
- `file_change`: file-change observation or repo-sync evidence.
- `system`: warning, repair, migration, or internal event.
- `import_batch`: explicit import event.
- `checkpoint`: checkpoint update marker.
- `other`: explicit extension point when a client cannot classify the event yet.

### `artifact_kind`

- `tool_output` | `terminal_output` | `attachment` | `transcript_export` | `media` | `other`

### `storage_backend`

- `local_spool` | `server_filesystem` | `postgres_inline` | `object_storage` | `external`

### `route_class`

- `local_model`: local/Ollama/Postgres/self-hosted model work.
- `active_agent`: current MCP-connected agent session performs the reasoning.
- `subscription_worker`: supported OAuth/sign-in subscription worker route.
- `paid_api_provider`: direct paid API call.

### `paid_api_approval_status`

- `pending`: waiting for owner decision.
- `approved`: owner approved the paid API call.
- `denied`: owner rejected the paid API call.
- `expired`: request was not decided before expiry.
- `cancelled`: request is no longer needed because another route handled/deferred the task.

### `agent_memory_type`

- `decision`: accepted decision.
- `constraint`: limitation/rule that must be considered.
- `lesson`: conclusion from past experience.
- `failure`: failure and cause.
- `work_log`: short record of completed work.
- `open_question`: unresolved question.
- `artifact_reference`: reference to a file, commit, PR, document, or URL.
- `preference`: developer/user preference, possibly cross-project.
- `procedure`: repeatable instruction or workflow.

### `agent_memory_status`

- `candidate`: proposed memory; not yet trusted as durable instruction.
- `accepted`: governed memory usable according to `use_policy`.
- `rejected`: reviewed and intentionally excluded; retained for audit/dedup suppression unless erased.
- `archived`: preserved for history, excluded from normal recall.
- `superseded`: replaced by a newer record; lineage is preserved unless erased.
- `stale`: possibly outdated; requires verification before reliance.
- `needs_review`: requires owner or higher-confidence process.

### `use_policy`

- `evidence_only`: may be shown as evidence, not as behavior guidance.
- `recall_allowed`: may be used as ordinary memory.
- `instruction_grade`: may be used as durable instruction/preference.
- `do_not_use`: excluded from ordinary recall.

### `source_kind`

- `event` | `chunk` | `raw_artifact` | `edge` | `checkpoint` | `external`

### `review_action`

- `accept` | `approve` | `reject` | `supersede` | `archive` | `unarchive` | `mark_stale` | `promote_instruction` | `demote_instruction` | `edit` | `merge` | `forget`

`approve` is retained as an API/CLI synonym for `accept` if implementation compatibility needs it; the stored lifecycle status is `accepted`.
