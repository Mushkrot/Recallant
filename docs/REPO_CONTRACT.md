# Repository contract (Recallant repo-native fallback)

Goal: every target git project that uses Recallant has a thin on-disk contract that any CLI agent can understand even without MCP access.

This contract exists to prevent context loss without recreating the old problem of huge startup files. Long history belongs in Recallant; repo files route the agent to the right memory.

The owner's earlier `agent-bootstrap` project inspired this file-based contract, but Recallant owns the final repo contract and generated adapters.

## 1. Required files in the application repository

After running `recallant init` in a project directory:

| File | Role |
|------|------|
| `.recallant/config` | Local project pointer: `project_id`, `recallant_server_url`. Do not commit to git. |
| `AGENTS.md` | Canonical thin agent entrypoint; must include the `Memory (Recallant)` section below. |
| `PROJECT_LOG.md` | Human-readable checkpoint mirroring the meaning of `memory_get_checkpoint`. |

`.recallant/config` may be YAML or JSON:

```yaml
project_id: "550e8400-e29b-41d4-a716-446655440000"
recallant_server_url: "http://localhost:3005"
```

Add `.recallant/` to the target project's `.gitignore`; it contains local pointers and should not be committed.

`.recallant/config` is only a pointer. It must not become the source of truth for capture profile, context budget, model routing, review behavior, or other Recallant policies. Authoritative settings live on the Recallant server; see [SETTINGS.md](SETTINGS.md).

`recallant init` must be idempotent and target-aware. The default near-term target is Codex, but the same bootstrap should support Cursor, Claude Code, Windsurf, and other targets through generated adapters rather than duplicated manual setup.

## 2. Canonical `Memory (Recallant)` section for `AGENTS.md`

The implementing agent inserts the following block into each target repository. Wording may be adjusted locally, but the structure is mandatory:

```markdown
## Memory (Recallant)

- At session start: call `memory_start_session`; if it reports an unclosed previous session, recover from checkpoint/captured events before asking the owner to repeat context.
- Before non-trivial work after session start: call `memory_get_context_pack` with the current task hint.
- Use `memory_search` for raw evidence/chunks only when the context pack says more evidence is needed or the task changes.
- Use specific queries in `memory_search`, not broad ones. One call per session start is usually enough.
- After meaningful progress: update checkpoint via `memory_set_checkpoint` and update `PROJECT_LOG.md` to match fields `current_focus` and `next_step`.
- On clear pause/exit/closeout intent: call `memory_closeout` and update `PROJECT_LOG.md` from the closeout payload.
- To share a pattern across projects: call `memory_promote` on the relevant chunk or create a governed memory proposal.
- Never paste secrets into memory tools.
- If MCP is unavailable: update `PROJECT_LOG.md` and, when available, write local spool.
```

## 3. Field mapping

| `memory_set_checkpoint.payload` | `PROJECT_LOG.md` section |
|-------------------------------|---------------------------|
| `current_status` | `## Current Session` status line |
| `current_focus` | `Current focus` |
| `next_step` | `Next step` / `## Next Steps` |
| `open_questions` | `## Risks / Open Questions` |

The deterministic sync procedure is tested in `TEST_CONTRACT.md`.

## 4. MCP client configuration (per project)

After `recallant init`, the command prints ready blocks for client config.

### Codex

Codex is the first target for v1 ergonomics. `recallant init --target codex` must generate the exact MCP config block for the implementation's supported Codex config path and set `client_kind=codex` for sessions.

`AGENTS.md` remains the canonical project instruction surface for Codex.

### Claude Code

Config path: `~/.claude/settings.json` globally or `.claude/settings.json` in the project.

```json
{
  "mcpServers": {
    "recallant": {
      "command": "recallant",
      "args": ["mcp-server"],
      "cwd": "/path/to/project",
      "env": {
        "RECALLANT_PROJECT_ID": "<project_id from .recallant/config>",
        "RECALLANT_DEVELOPER_ID": "<developer_id>",
        "RECALLANT_DATABASE_URL": "postgresql://recallant:secret@localhost:5432/recallant"
      }
    }
  }
}
```

### Cursor

Config path: `.cursor/mcp.json` in the project directory.

```json
{
  "mcpServers": {
    "recallant": {
      "command": "recallant",
      "args": ["mcp-server"],
      "env": {
        "RECALLANT_PROJECT_ID": "<project_id from .recallant/config>",
        "RECALLANT_DEVELOPER_ID": "<developer_id>",
        "RECALLANT_DATABASE_URL": "postgresql://recallant:secret@localhost:5432/recallant"
      }
    }
  }
}
```

`recallant init` generates these blocks automatically with real values.

## 5. Agent session flow

Canonical action order for each new session:

```text
1. Read AGENTS.md; most clients do this automatically at startup.
2. Call memory_start_session and get session_id, checkpoint, and recovery warnings.
3. Call memory_get_context_pack(session_id, task_hint=<current task>).
4. If there is an unclosed previous session, recover from context pack and mark gaps/warnings.
5. Call memory_search(query=<current task>) only if context pack is insufficient or task changed.
6. Work while periodically calling memory_append_turn / memory_create_agent_memory / memory_set_checkpoint.
6a. During long commands, tests, import/sync, or idle gaps without memory tools, use memory_heartbeat for liveness.
7. After meaningful progress, call memory_set_checkpoint.
8. Update PROJECT_LOG.md from checkpoint fields current_focus and next_step.
```

The agent should not ask the owner to explain context when steps 2-3 were completed.

## 5.1 Manual session closeout flow

When the owner explicitly closes/pauses a session, the agent should perform a full durable closeout rather than a minimal checkpoint.

Closeout intent is natural-language aware. Configured Russian/English phrases and "Exit" should trigger closeout when context supports it. Ambiguous cases may use model routing for intent classification; ask for confirmation only when unclear or risky.

1. Ensure recent raw work is appended or spooled.
2. Create/update governed memories for decisions, constraints, lessons, failures, procedures, artifact references, work log, and open questions.
3. Link important memories/chunks to files, commits, PRs, docs, or external refs where available.
4. Call `memory_closeout` with closeout summary, checkpoint payload, governed-memory candidates, and artifact refs.
5. Update `PROJECT_LOG.md` with returned/current status, current focus, next step, blockers, and open questions.
6. Sync local spool if server is reachable; otherwise leave clear unsynced state.
7. Keep repo files compact; long narrative belongs in Recallant.

This flow is intentionally heavier than normal incremental work because manual session closeout is where context loss is most expensive.

Normal successful closeout should be quiet. The agent should show a short report only when `memory_closeout.report_required=true`, such as unsynced spool, conflicts, pending review items, failed writes, incomplete repo sync, low-confidence extraction, or server/model/provider errors.

Closeout does not import historical docs/git/exports automatically. Use explicit `recallant import ...` commands for that.

## 6. Token efficiency guidelines

Recallant intentionally returns bounded context so it does not overload the agent window.

**Use specific `memory_search` calls, not broad ones.**

The query should match the current task, not "tell me everything about the project".

```text
Bad:  memory_search(query="project")
Good: memory_search(query="how JWT authorization is implemented")
```

**Use startup results first; do not repeat calls unnecessarily.**

`memory_start_session` + `memory_get_context_pack` is the normal startup path. Repeat `memory_search` mid-session only when the task changes or the Context Pack explicitly suggests fetching more evidence.

**Do not add all hits to context.**

`text_excerpt` is enough for most tasks. `memory_fetch_chunk` or raw artifact inspection is only for cases where the excerpt is clearly insufficient.

**Tune `max_chars_total` to the task.**

The standard profile may default around 12000 characters, but the real limit comes from configured retrieval/context policy. For quick reference queries, use a lower budget.

**Prompt caching for agents on Claude API.**

If an agent embeds `memory_search` results into a system prompt, place the memory block before dynamic instructions so it can be cached when the provider supports it.

## 7. Duplication policy

- `AGENTS.md` is the canonical thin agent entrypoint.
- Adapter files must point to canonical rules instead of duplicating long sections.
- `PROJECT_LOG.md` should contain current resume state, not months of detailed history.
- Detailed history, decisions, failures, lessons, and source evidence should be stored in Recallant.
- If a project already has large legacy logs, `recallant init` / `recallant analyze` should suggest archiving or importing them rather than appending more duplicated content.

## 8. Journey-style packaging path

Recallant's own bootstrap may later be distributed as a Journey-style kit/skill in addition to the local CLI. Any such kit must preserve this repo contract:

- thin installed files,
- target-aware adapters,
- preflight checks,
- verification command,
- resolver hints instead of always-loaded long context,
- no silent overwrite of user-maintained project files.
