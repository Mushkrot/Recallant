# Upstream AgentMemory Review - 2026-06-01

This document records the supplemental review of
[`rohitg00/agentmemory`](https://github.com/rohitg00/agentmemory) as a
Recallant reference project.

AgentMemory was added after the original upstream research pass because it is
very close to Recallant's owner-facing promise: AI coding agents should stop
forgetting previous sessions and should not require the owner to re-explain the
same project facts.

## Local Snapshot

| Field | Value |
| --- | --- |
| Repository | `https://github.com/rohitg00/agentmemory` |
| Local path | `.upstream/agentmemory` |
| Revision inspected | `fd9e3bd42d6208a33f0ee9de1442fdbb60eab106` |
| Package version | `@agentmemory/agentmemory` `0.9.24` |
| License | Apache-2.0 |
| Runtime | TypeScript/Node package on top of pinned `iii-engine` `0.11.2` |

Files inspected for this review include:

- `README.md`
- `package.json`
- `src/cli.ts`
- `src/cli/onboarding.ts`
- `src/cli/connect/*.ts`
- `plugin/hooks/hooks.codex.json`
- `src/hooks/*.ts`
- `src/functions/observe.ts`
- `src/functions/context.ts`
- `src/functions/smart-search.ts`
- `src/functions/privacy.ts`
- `src/functions/governance.ts`
- `src/functions/retention.ts`
- `src/state/hybrid-search.ts`
- `src/state/search-index.ts`
- `src/state/vector-index.ts`
- `eval/README.md`
- `docs/benchmarks/2026-05-20-coding-agent-life-v1.md`
- `integrations/filesystem-watcher/README.md`
- `SECURITY.md`
- `GOVERNANCE.md`
- `ROADMAP.md`

No AgentMemory source file is selected for direct copy into Recallant. This is
an architectural and product workflow review.

## Positioning For Recallant

AgentMemory is now a strong subsystem reference for:

- agent/client connection UX;
- hook-based automatic capture;
- plugin and skill packaging;
- session replay and live viewer;
- sandboxed retrieval benchmarks;
- practical diagnostics and self-healing commands.

AgentMemory should not replace Recallant's foundation. Recallant remains an
OB1/MF0 synthesis with Postgres/pgvector as source of truth, governed memory,
project attach/detach lifecycle, Review UI, strict scope/audience policy,
portable backup/restore, and owner-confirmed destructive operations.

The short version:

- **AgentMemory is stronger today at making many agents actually capture data.**
- **Recallant is stronger in governed project lifecycle, durable server-side
  memory policy, cleanup safety, and cross-project isolation.**

## How AgentMemory Connects New Agents And Projects

AgentMemory setup is mostly client/global, not project-attach oriented.

The main install path is:

```bash
npm install -g @agentmemory/agentmemory
agentmemory
agentmemory connect claude-code
agentmemory connect codex --with-hooks
npx skills add rohitg00/agentmemory -y
```

The `connect` adapters write MCP and hook configuration into each agent's native
user-level config. Examples:

- Codex MCP config in `~/.codex/config.toml`;
- Codex hook workaround in `~/.codex/hooks.json`;
- Claude Code hooks and MCP through plugin install or config merge;
- Cursor, Windsurf, Gemini CLI, Cline, Warp, Kiro, Zed, Continue, Droid,
  Copilot CLI, OpenClaw, Hermes, and others through adapter-specific config
  writes or documented manual steps.

The connect adapters are idempotent and preserve user config:

- existing files are backed up under `~/.agentmemory/backups`;
- user entries are preserved;
- previous AgentMemory hook entries are stripped and replaced on reinstall;
- `--dry-run`, `--force`, and detection logic are available.

Project identity is lighter than Recallant's model. Hooks derive the project
from `AGENTMEMORY_PROJECT_NAME`, otherwise from the Git root basename, otherwise
from the current directory basename. This is easy to install, but weaker than
Recallant's durable `project_id`, project registry, path aliases, attach modes,
detach lifecycle, and portable remapping model.

## How AgentMemory Captures Context

AgentMemory's strongest mechanism is hook capture.

Observed Codex hook set:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PreCompact`
- `Stop`

Claude Code has a broader hook set; OpenCode has an even larger plugin hook
bus. The hooks send REST events to a running AgentMemory server and can also
return bounded context to stdout when context injection is explicitly enabled.

The main pipeline is:

1. A hook fires with session/project/cwd/tool/prompt data.
2. `mem::observe` validates, deduplicates, and privacy-filters the payload.
3. The observation is stored and streamed to the viewer.
4. By default, a zero-LLM synthetic compression is generated so search works
   without spending model tokens.
5. Optional LLM compression, summarization, graph extraction, lessons, and
   profile updates enrich later recall.
6. Search uses BM25, optional vector embeddings, graph expansion, RRF fusion,
   session diversification, and optional rerank.
7. Startup context uses project profile, lessons, recent summaries, important
   observations, and token budget fitting.

This is important for Recallant because it demonstrates a practical answer to
the owner's hard requirement: the agent should not need to remember to call a
memory tool manually for every important event.

## What AgentMemory Does Better Than Recallant Today

### 1. Client connection layer

AgentMemory has a broad `connect <agent>` adapter set. Recallant currently has
project onboarding and target-aware MCP config generation, but the agent/client
global hook wiring layer should become more complete.

Borrow:

- `recallant connect <client>` as a separate layer from `recallant attach .`;
- idempotent user-config merge with local backups;
- adapter detection and `--dry-run`;
- clear "MCP only" versus "MCP plus hooks" reporting;
- a Codex Desktop global hooks fallback while plugin-local hooks are unreliable.

### 2. Hook-first automatic capture

AgentMemory treats hooks as the normal capture path. This is exactly the layer
that prevents "registered but not actually recording" behavior.

Borrow:

- SessionStart registers a session;
- UserPromptSubmit captures the owner's request;
- PostToolUse captures command/tool result evidence;
- PreCompact re-injects bounded context before compaction;
- Stop summarizes/closes the session;
- hooks must fail quietly and never block the agent for long.

### 3. Skills that teach agents when to use memory

AgentMemory ships native skills such as recall, remember, recap, handoff,
forget, commit-context, commit-history, and session-history.

Recallant should borrow the packaging idea, but the content should map to
Recallant's governed MCP tools and safety rules.

### 4. Viewer, replay, and observability

AgentMemory's live viewer and replay model are useful because they make memory
capture visible. Recallant's Review UI is more governed, but it should also
show capture readiness, recent session evidence, replay-like timelines, and
"why this context was included" traces more clearly.

### 5. Sandboxed benchmark discipline

AgentMemory's `coding-agent-life-v1` and LongMemEval harness are useful because
they test recall quality in isolated data stores. The explicit warning not to
pollute a real store during evals matches Recallant's sandbox-first habit.

Borrow:

- isolated benchmark runner;
- grep/BM25 baseline versus hybrid retrieval;
- per-query gold labels;
- published scorecards tied to a commit/version;
- no benchmark against live owner memory.

### 6. Cost-aware defaults

AgentMemory changed per-observation LLM compression and pre-tool enrichment to
opt-in because automatic model calls and hidden context injection can burn user
quota. Recallant already has paid API confirmation and context budgets; this is
good external evidence for keeping those controls strict.

## What Recallant Does Better Or Must Keep Different

### 1. Durable project registry and lifecycle

AgentMemory's project identity is a string derived from environment or path.
Recallant needs durable project IDs, path aliases, attach/detach modes,
production-sensitive detection, sandbox cleanup, project settings, and
portable remapping.

Do not replace `recallant attach` with AgentMemory-style basename detection.
Borrow detection as a convenience only.

### 2. Governed memory policy

AgentMemory has audit, deletion tools, retention scoring, lessons, and memories,
but it does not appear to enforce Recallant's full L0/L1/L2/L3 model:

- every governed memory has source refs;
- `candidate` and `needs_review` are distinct from `accepted`;
- `instruction_grade` requires direct owner/trusted import/review path;
- context packs distinguish binding rules from ordinary working memories;
- Review UI owns promotion/demotion/archive/supersede/forget workflows.

Recallant should keep the stricter governance model.

### 3. Conservative retention and erasure

AgentMemory has `auto-forget`, TTL deletion, governance delete, and low-value
observation removal. Recallant intentionally uses conservative retention:
archive, reject, stale, supersede, and explicit owner-confirmed permanent
erasure. Do not copy automatic hard deletion semantics.

### 4. Source of truth and portability

AgentMemory is local-first and powered by iii KV/state. That gives low-friction
installation, but Recallant's target is a durable private server platform with
Postgres/pgvector, backups, restore verification, raw artifact handling,
project portability, and future multi-domain memory.

Do not replace Recallant storage with AgentMemory's KV model.

### 5. Tool surface size

AgentMemory exposes a very large MCP surface. Recallant should stay smaller and
policy-driven. Add tools only when they support the accepted session lifecycle,
context pack, governed memory, cleanup, settings, or cross-project recall
contracts.

### 6. Cross-project recall

AgentMemory's default story is one shared memory server across agents, with
optional `AGENT_ID` isolation. Recallant's accepted model is "library, not
soup": current-project memory by default, developer/environment/capability
facts when applicable, and explicit source-linked cross-project examples.

Borrow the `AGENT_ID` role tagging idea, but map it into Recallant's
scope/audience/client-adapter model.

## Concrete Ideas To Borrow

### High priority

1. Add a dedicated `recallant connect <client>` command family.
2. Add hook installers for Codex and Claude Code before claiming full automatic
   capture across external agents.
3. Add `recallant doctor --require-capture` or equivalent that verifies:
   session start, context read, event write, checkpoint write, closeout, and
   later recall.
4. Make Review UI show "project registered" versus "capture active" versus
   "last hook event seen" as separate states.
5. Add a replay/timeline view for recent sessions, starting with bounded
   evidence rather than a full raw-memory browser.
6. Add isolated retrieval benchmark fixtures similar to `coding-agent-life-v1`.

### Medium priority

1. Add native skills/kit packaging for Recallant agents.
2. Add a filesystem watcher as an optional connector, with strict ignore rules,
   content caps, and secret redaction.
3. Add JSONL transcript import/backfill for supported clients, keeping
   Recallant's explicit import and review policy.
4. Add local embedding dimension guards and batch embedding repair tests.
5. Add explicit provider cost warnings for high-cost local/subscription/paid
   routes, not only paid API calls.

### Do not copy

1. Do not adopt iii-engine as Recallant's runtime dependency.
2. Do not replace Recallant's Postgres data model with AgentMemory KV scopes.
3. Do not expose a 50+ tool MCP surface as the default Recallant API.
4. Do not use filesystem basename as authoritative project identity.
5. Do not hard-delete memory through TTL/auto-forget without Recallant's
   explicit erasure workflow.
6. Do not enable hidden per-tool context injection by default.

## Implications For Recallant Documentation

Existing direction remains valid:

- OB1 is still the governance backbone.
- MF0 is still the workbench/raw-capture/Memory Tree donor.
- MemPalace remains important for verbatim capture and recovery posture.
- Journey remains the packaging/onboarding reference.

AgentMemory adds a sharper implementation reference for the layer that sits
between "project is attached" and "agent actually remembers":

- client connector installers;
- lifecycle hooks;
- capture-active diagnostics;
- skills;
- viewer/replay;
- benchmark harnesses.

This should inform future work on the mandatory startup/capture layer without
weakening Recallant's stronger governance and project-lifecycle model.
