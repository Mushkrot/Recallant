# Test contract

No phase in [AGENT_IMPLEMENTATION_GUIDE.md](AGENT_IMPLEMENTATION_GUIDE.md) is complete until the matching checks below pass.

## Phase 0

- [ ] Linter is configured and `npm run lint` / `ruff check` or equivalent exits 0.

## Phase 1

- [ ] `migrate up` succeeds on an empty Postgres database.
- [ ] Extension `vector` exists.
- [ ] `projects` table includes `parent_project_id`, `project_kind`, and `memory_domain`.
- [ ] `raw_artifacts` table exists and links large raw evidence to `events`.
- [ ] `sessions` table includes heartbeat fields: `last_heartbeat_at`, `heartbeat_status`, and `heartbeat_metadata`.
- [ ] Tables for governed memory exist: `agent_memories`, `agent_memory_source_refs`, `agent_memory_review_actions`, `recall_traces`.
- [ ] Erasure workflow storage exists: `erasure_requests` or equivalent redacted receipt storage.
- [ ] Chunk/governed-memory/import-result storage can represent ADR-0040 `scope_kind`, `scope_id`, and audience metadata; `project|developer` remains only the compatibility/default subset.
- [ ] Settings tables exist: `system_settings`, `developer_settings`, `project_settings`, `session_overrides`, `client_adapter_settings`, `settings_audit_events`.

## Phase 2

- [ ] MCP handshake: server returns a tool list with names exactly as in [MCP_SPEC.md](MCP_SPEC.md).
- [ ] Tool list includes universal session lifecycle tools: `memory_start_session` and `memory_closeout`.
- [ ] Tool list includes automatic startup context tool: `memory_get_context_pack`.
- [ ] Tool list includes raw workflow evidence tool: `memory_append_event`.
- [ ] Tool list includes optional liveness tool: `memory_heartbeat`.
- [ ] Tool list includes explicit erasure tool: `memory_forget`.

## Phase 3

- [ ] `memory_start_session(client_kind="codex")` creates an active `sessions` row and returns `session_id`.
- [ ] `memory_start_session` recommends `memory_get_context_pack` as the normal next startup call.
- [ ] `memory_start_session(client_kind="cursor"|"claude_code"|"windsurf")` uses the same server contract and differs only by `client_kind`.
- [ ] Session-scoped tool calls update `sessions.last_seen_at`.
- [ ] `memory_heartbeat` updates `sessions.last_seen_at`, `last_heartbeat_at`, and bounded heartbeat metadata.
- [ ] `memory_heartbeat` does not create `events`, chunks, embeddings, or governed memories.
- [ ] `memory_append_turn` creates exactly one `events` row and at least one `chunks` row for long text.
- [ ] `memory_append_turn` stores ordinary captured user/assistant turn text in L0 according to the active capture profile.
- [ ] `memory_append_event(event_kind="terminal_output"|"tool_result")` creates an `events` row with bounded text/excerpt and raw artifact refs when large evidence is present.
- [ ] Repeating the same `dedup_key` does not create a new `event_id`.
- [ ] Effective capture policy resolves in order: session override → project policy → developer default → server default.
- [ ] `light`, `standard`, and `detailed` fixture policies produce different raw/tool-output capture depth while preserving the same governed-memory path.
- [ ] Large terminal/tool output is capped/summarized in event payload and stored as raw artifact metadata/pointer unless explicit full inline capture is enabled by policy.
- [ ] Changing a project's capture profile affects only new events in that project; existing events/chunks/governed memories are unchanged unless an explicit reprocess workflow is run.
- [ ] A new `memory_start_session` detects a previous unclosed session in the same project and returns recovery metadata instead of hiding the interruption.
- [ ] Stale/interrupted-session detection uses configurable thresholds rather than hard-coded universal numbers.

## Phase 4

- [ ] After appending fixture text long enough to enter the chunk/embed path, each chunk has an `embeddings` row or an explicit `pending` flag if that schema is selected. Fixture size is defined by the test profile.
- [ ] Default embedding route resolves to local `ollama/nomic-embed-text` unless project/session settings override it.
- [ ] Cloud embedding fallback candidates include OpenAI and Gemini routes in settings, even if provider calls are stubbed in early tests.
- [ ] Switching embedding model/dims is blocked unless an explicit reindex/migration workflow is requested.
- [ ] Every embedding/model call writes a `model_calls` audit row with route class/provider/model/purpose/routing reason/status.
- [ ] Default-profile paid API route creates a `paid_api_approval_requests` row and does not call the provider until approved.

## Phase 5 — Golden retrieval (minimal)

Prepare a fixture of three synthetic events with overlapping lexical and semantic content.

- [ ] Rare-token query returns the correct chunk through lexical path.
- [ ] Paraphrase query returns the semantically nearest chunk through vector path.
- [ ] With configured fixture cap such as `max_chars_total=2000`, total excerpts + metadata in the tool response never exceed that configured cap.
- [ ] Scope/audience fixture excludes unrelated project/environment/client-adapter/connector memories before ranking.

## Phase 6

- [ ] `memory_create_agent_memory(created_by="agent")` with valid source refs creates a governed memory without requiring user confirmation for that write.
- [ ] Ordinary valid agent-created memories become recallable (`accepted` + `recall_allowed`) or explicitly marked `candidate` / `needs_review` by deterministic risk/confidence policy.
- [ ] Agent-created memory without `source_refs` returns `VALIDATION_ERROR`.
- [ ] `memory_review_agent_memory(action="accept")` changes status to `accepted` and ordinary policy to `recall_allowed`; `approve` may work as a compatibility alias.
- [ ] `instruction_grade` is allowed only for direct explicit user instruction or user/import/review-approved flow and does not silently pass for raw agent-created inferred/candidate/needs-review records.
- [ ] `memory_list_agent_memories(view="inbox")` returns `candidate`/`needs_review`/high-risk items and excludes ordinary low-risk recall memories by default.
- [ ] Review Inbox default includes important, conflicting, and long-term records: candidate rules, scope-changing candidates, conflicts, duplicates, high-risk guidance, low-confidence behavior guidance, and promotion/demotion/archive/supersede candidates.
- [ ] Review Inbox default excludes raw events, ordinary evidence chunks, routine work logs, routine project facts, and low-risk source-linked memories that do not affect future behavior.
- [ ] `memory_list_agent_memories(view="rules")` returns active `instruction_grade` records by default.
- [ ] `memory_get_agent_memory` returns source refs and review action history.
- [ ] Duplicate/candidate report can flag two semantically similar rule memories without auto-deleting either.
- [ ] Conflict report can flag an older instruction/decision contradicted by a newer accepted decision.
- [ ] Conflict report explains ADR-0041 applicability/authority/scope-specificity/recency for at least one high-risk conflict.
- [ ] Two client-adapter records with non-overlapping audiences are not treated as a conflict.
- [ ] High-risk equal-authority conflict is returned as needs review instead of being silently resolved.
- [ ] `memory_review_agent_memory(action="edit")` preserves source refs and records previous values in review action metadata.
- [ ] `memory_review_agent_memory(action="merge")` leaves one canonical memory active and marks merged duplicates as superseded/archived.
- [ ] `memory_recall_agent_memories` does not return `candidate`, `needs_review`, `stale`, `rejected`, `archived`, `superseded`, or `do_not_use` records by default.
- [ ] `memory_recall_agent_memories` returns `trace_id`, and `memory_report_recall_usage` updates the matching `recall_traces` row.
- [ ] `memory_link` creates an edge; `memory_search` with `graph_expand=true` pulls a neighbor within `graph_budget_nodes`.
- [ ] `memory_set_checkpoint` followed by `memory_get_checkpoint` returns equivalent JSON by semantic equality.
- [ ] `memory_get_context_pack` returns checkpoint, relevant binding rules, working memories, recovery warnings when present, optional bounded evidence, and suggested next fetches under configured context budget.
- [ ] `memory_get_context_pack` distinguishes `instruction_grade` binding rules from ordinary working memories.
- [ ] `memory_get_context_pack` does not import historical docs or read all project files.
- [ ] `memory_get_context_pack` does not return full raw artifact content; it returns only bounded excerpts/source refs when evidence is included.
- [ ] `memory_forget(..., dry_run=true)` returns affected counts and warnings without changing data.
- [ ] `memory_forget` without required confirmation does not erase content and returns `pending_confirmation` or equivalent.
- [ ] Confirmed `memory_forget` removes/redacts target content from chunks, embeddings, governed memory body/source quotes, derived summaries/indexes, context-pack output, and UI/list responses.
- [ ] Erasure receipt contains safe ids/counts/status only and does not contain the erased content.

## Phase 6.5 — Review UI

- [ ] Review UI is served from the Recallant server deployment or a sibling `recallant-review-ui` process behind the same Recallant private boundary.
- [ ] First screen is Review Inbox / Command Center, not a raw memory list or metrics dashboard.
- [ ] v1 UI is a compact workbench, not an approval-only table: it includes project navigation, Review Inbox, Rules, detail panel, action controls, Cost / Paid API, and Settings entrypoint.
- [ ] Management UI includes a natural-language chat/command surface for memory questions, context-pack explanation, cleanup requests, and action proposals.
- [ ] Chat answers in the user's language by default in a fixture where the user asks in Russian.
- [ ] Chat-driven destructive, cost-affecting, security, global-scope, connector/account, or public-exposure actions require explicit confirmation and execute through the same server policy path as UI/CLI actions.
- [ ] First screen shows current project/scope/domain/capture profile.
- [ ] Management UI can list all managed projects and navigate into one project's Review Inbox and Settings.
- [ ] Project Settings UI can edit capture profile, context budget profile, review sensitivity, model route enablement, paid API mode, enabled clients, and project paths/aliases.
- [ ] Settings UI shows effective value and source for at least one project setting inherited from developer/global default.
- [ ] Settings UI writes `settings_audit_events` for every setting change.
- [ ] Dangerous settings changes require explicit confirmation: paid API enablement, future `auto_with_caps`, subscription worker enablement, developer/global edits, major capture/context increases, preview models, and quality-critical route changes.
- [ ] Settings UI shows secret status/reference only and never raw provider API keys, database URLs, backup encryption keys, auth secrets, or Cloudflare secret values.
- [ ] First screen shows critical status when present: unclosed/interrupted session, unsynced spool, high-risk conflicts.
- [ ] First screen has priority lanes or equivalent grouping for Conflicts, Candidate Rules, Important/Needs Review, and Duplicates.
- [ ] Selecting an item shows source refs/evidence, status/use policy/confidence, related records, and available actions.
- [ ] Review UI shows inbox records: `candidate`, `needs_review`, important, high-risk, duplicate, and conflict candidates.
- [ ] Review UI does not make ordinary low-risk memories mandatory review work.
- [ ] Review UI shows active `instruction_grade` rules with scope/type/project/domain filters.
- [ ] Management UI includes a Cost / Paid API view showing current day/month estimated paid API cost, cost by project/provider/model/purpose, and pending approvals.
- [ ] Management UI does not expose a full raw memory browser, graph explorer, broad analytics suite, or public SaaS dashboard in v1.
- [ ] Browser/UI clients cannot read provider API keys or raw prompts from cost/model-call records.
- [ ] Memory detail view shows body, status, use policy, confidence, source refs, related records, and review action history.
- [ ] UI accept/reject/archive/unarchive/mark-stale/promote/demote/edit/merge/supersede actions update the same database state as `memory_review_agent_memory`; approve may remain as a UI label/alias if needed.
- [ ] UI permanent-forget flow performs dry-run, shows affected counts/scope, requires confirmation, and writes a redacted erasure receipt.
- [ ] UI promotion to `instruction_grade` requires visible source refs and writes a review action.
- [ ] Duplicate view allows choosing a canonical memory and marking the others merged/superseded/archived.
- [ ] Conflict view shows old/new records and can apply a supersede/demote/archive resolution.
- [ ] Ordinary auto-created recallable memories do not appear as mandatory approval work unless policy marks them important/risky/conflicting.
- [ ] Review UI/admin API is not publicly exposed by default in the local/server test profile.
- [ ] Review UI/admin API requires Recallant auth/session/token even when bound to localhost/Tailnet.
- [ ] Browser/UI clients cannot read provider API keys or secret env values.

## Phase 7

- [ ] `recallant init --target codex --dry-run` in a folder without `.recallant/config` prints a plan and changes no files.
- [ ] `recallant init --target codex` creates `.recallant/config` with valid UUID `project_id` and a `projects` table record.
- [ ] `recallant init --target codex` assigns `capture_profile=standard` by default and prints it in the plan/output.
- [ ] `recallant init --target codex --capture-profile detailed` stores the override and prints it in the plan/output.
- [ ] `recallant init` stores authoritative project settings on the Recallant server; `.recallant/config` contains only pointer data such as `project_id` and `recallant_server_url`.
- [ ] `recallant init --target codex` creates or updates thin `AGENTS.md` with a `Memory (Recallant)` section.
- [ ] `recallant init --target codex` creates `PROJECT_LOG.md` if missing.
- [ ] `recallant init --target codex` prints the ready MCP config block for Codex.
- [ ] `recallant init --target codex` may print import candidates, but does not create `events.kind=import_batch` and does not run import without explicit `recallant import ...`.
- [ ] `recallant discover --dry-run` shows project/server/secret-reference/import candidates without creating active memories or instruction-grade records.
- [ ] `recallant import --dry-run` shows source refs, hashes, result classes, provisional scope/audience, high-risk assignments, and conflicts without writing durable import rows.
- [ ] `recallant import` of `.env.example` stores variable names/meanings only and never raw secret values.
- [ ] `recallant import` of client-specific docs such as `CLAUDE.md` defaults to client-adapter/specific-client audience rather than universal all-agent instruction.
- [ ] Closeout intent recognizer treats configured Russian/English closeout phrases and "Exit" as closeout triggers when context supports it.
- [ ] `memory_closeout` marks the session closed, updates checkpoint, creates/updates governed-memory candidates, and returns a `PROJECT_LOG.md` update payload.
- [ ] Successful warning-free `memory_closeout` returns `report_required=false`.
- [ ] `memory_closeout` returns `report_required=true` and warnings when spool is unsynced, conflicts exist, `candidate`/`needs_review` records are created, writes fail, repo sync is incomplete, extraction confidence is low, or server/model/provider errors occur.
- [ ] Ambiguous closeout wording uses model routing or asks for confirmation; risky/non-routine actions require confirmation.
- [ ] `recallant lint-context` passes on fresh bootstrap and fails on a fixture with a large duplicated historical log in `AGENTS.md`.
- [ ] `recallant lint-context` applies configured context policy/profile rather than hard-coded universal file-size limits.
- [ ] `recallant lint-context` accepts an explicit large-project override with reason, but still fails on duplicated history, secrets, or adapter rule duplication.
- [ ] Startup fixture restores context through checkpoint + governed memories without reading long docs or archive logs.
- [ ] Startup fixture uses `memory_start_session` followed by `memory_get_context_pack` as the normal automatic path.
- [ ] `recallant context` or equivalent preview returns the same core pack sections as `memory_get_context_pack` for the same project/session policy.
- [ ] Startup broad query fixture such as `memory_search(query="project")` is warned/rejected by context-budget lint or policy tests.
- [ ] `recallant doctor` returns OK when Postgres and configured Ollama/local provider are available and returns a specific error/status when each is unavailable.
- [ ] `recallant doctor` reports the configured Ollama/local-model endpoint, reachability, expected/missing models, and fallback route without starting a duplicate Ollama stack.
- [ ] Owner-server deployment check verifies planned Recallant service ports are registered in `/ai/PORTS.yaml` before daemon/service start.
- [ ] Owner-server deployment check warns that `/ai/SECURITY` must be consulted before exposure/firewall/Cloudflare/service/secret changes.
- [ ] `recallant doctor` or equivalent diagnostics shows effective model routes for `local_model`, `active_agent`, `subscription_worker`, and `paid_api_provider`, and marks disabled routes clearly.
- [ ] Default powerful-model escalation is subscription-first/API-last: active agent or supported subscription worker before paid API where available.
- [ ] Default paid API profile routes through OpenAI unless project/session settings explicitly select Gemini or Claude.
- [ ] If subscription route reports `rate_limited` or `exhausted`, Recallant defers/downgrades/asks according to policy and does not silently fall through to paid API.
- [ ] Default `paid_api_mode=confirm_each`; every direct paid API request requires explicit approval before provider call.
- [ ] Denied/expired paid API approval defers or downgrades the task according to policy without creating a paid provider call.
- [ ] `auto_with_caps` is rejected unless explicitly enabled for the project/task/profile and visible in settings/cost dashboard.
- [ ] Browser automation, scraping, hidden API routes, and limit-bypass route configs are rejected or fail policy checks.
- [ ] Preview/experimental model IDs are rejected or warned unless the project/session explicitly enables preview use.
- [ ] Default Gemini cost/speed profiles route to `gemini-2.5-flash-lite` or `gemini-2.5-flash`, not `gemini-3.5-flash`.
- [ ] `gemini-3.5-flash` requires explicit project/session opt-in or an experiment/quality profile.
- [ ] Default cheap Claude profile routes to Haiku; Sonnet/Opus require explicit quality profile.

## Offline spool

- [ ] When the server is unavailable, local spool append creates a JSONL/NDJSON record with stable dedup key.
- [ ] Local spool can include raw artifact pointer/hash/metadata records for large evidence and sync them to server `raw_artifacts`.
- [ ] `recallant sync-spool --dry-run` shows unsynced records without writing to the server.
- [ ] `recallant sync-spool` uploads records, creates server `event_id`, and stores local-to-server mapping.
- [ ] Re-running `recallant sync-spool` does not create duplicates.
- [ ] `recallant prune-spool --synced` deletes/archives only confirmed synced records.

## Phase 8

- [ ] Appending text larger than the configured limit returns `VALIDATION_ERROR` without writing to DB.
- [ ] `memory_search` on a representative fixture DB finishes below the configured p95 budget. Example profiles such as 10k chunks / 1500ms on dev hardware may be local CI profiles, not hard production SLOs.
- [ ] Backup command/job creates a backup manifest with backup id, timestamp, Recallant version, schema version, included DBs, artifact roots, hash manifest, target, encryption status, and job status.
- [ ] Backup includes `recallant_agent_work` Postgres data and raw artifact storage metadata/files required by `raw_artifacts`.
- [ ] Restore verification restores backup into temporary database/location without overwriting production.
- [ ] Restore verification checks schema/migration version, raw artifact pointers, artifact hashes according to policy, project list, latest checkpoint, governed memory recall, and bounded search.
- [ ] Backup target config can represent current local Recallant-server storage and a future second server over SSH/Tailscale.
- [ ] Portable restore/remap fixture can map old project roots, secret references, connector/account bindings, and environment facts to new values without editing raw memories by hand.
- [ ] Backup manifests/logs do not include provider API keys or raw secrets.
- [ ] Default HTTP bind config is localhost/Tailnet/private interface, not public `0.0.0.0`, unless explicit owner config enables another mode.
- [ ] Remote MCP/admin API rejects unauthenticated requests.
- [ ] Future Cloudflare mode exists as explicit config but is disabled by default.
- [ ] Cloudflare mode requires both edge-auth metadata/config and Recallant auth/session; tests must reject unauthenticated public access.
- [ ] No unauthenticated public route exposes Review UI, admin API, MCP tools, backups, or raw artifacts.
- [ ] Natural-language management cannot bypass confirmation for erasure, paid API, global settings, connector/account bindings, public exposure, or security-sensitive operations.

## Phase 9

- [ ] `memory_search` returns an older fixture chunk with lower score than an identical fresh chunk when decay is enabled. The exact age gap is defined by the test profile.
- [ ] A chunk with `archived_at IS NOT NULL` does not appear in `memory_search` unless `include_archived=true`.
- [ ] Ordinary cleanup can archive/delete derived chunks/embeddings but does not delete L0 events or raw artifact records by default.
- [ ] Spool pruning deletes only records confirmed synced to server.
- [ ] Governed-memory cleanup changes lifecycle status (`archived`, `superseded`, `rejected`, or `stale`) rather than hard-deleting by default.
- [ ] After `memory_link(relation_type="supersedes", src=new, dst=old)`, the old chunk gets score penalty: `S_final < S_base * decay`.
- [ ] Chunk `access_count` increases after a `memory_search` that returned it.
- [ ] `recallant analyze --dry-run` does not change data and prints a report.
- [ ] `recallant cleanup --archive --not-accessed <configured-threshold> --dry-run` does not change data and prints candidate list.
- [ ] Self-cleaning reports can identify duplicate/stale/superseded/low-value/poor-provenance/conflicting-connector candidates without auto-deleting them.
- [ ] `recallant cleanup` does not execute permanent erasure without routing through `memory_forget` confirmation.

## Cross-client smoke

- [ ] Two MCP clients, for example Cursor plus another client, with the same `RECALLANT_PROJECT_ID`: append in A, search in B finds the same fact by query.

## Repo contract sync

- [ ] After `memory_set_checkpoint`, fields `current_focus` and `next_step` are reflected in `PROJECT_LOG.md` according to [REPO_CONTRACT.md](REPO_CONTRACT.md) within the configured repo-sync freshness budget, or async reason is documented and test-profile polling is allowed.

## Fixtures location

Implementation must store golden fixtures under `tests/fixtures/` relative to the implementation repo, created by the agent in Phase 3+.
