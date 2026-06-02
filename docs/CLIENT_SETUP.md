# Client Setup

Recallant onboarding has two layers:

1. Project attach: run `recallant attach .` in the project folder. This creates the local project
   pointer, Recallant startup instructions, and the MCP config hint for the selected target.
2. Client connection: point the agent client at the generated Recallant MCP server config if that
   client does not auto-import it.

The generated Recallant MCP server is a local stdio process:

```json
{
  "mcpServers": {
    "recallant": {
      "command": "recallant",
      "args": ["mcp-server"],
      "env": {
        "RECALLANT_PROJECT_ID": "<project-id>",
        "RECALLANT_DEVELOPER_ID": "<developer-id>",
        "RECALLANT_DATABASE_URL": "${RECALLANT_DATABASE_URL}"
      }
    }
  }
}
```

Keep `.recallant/` out of git. It stores local project binding files, not source code.

## Codex

Official reference:

- [OpenAI Docs MCP quickstart for Codex](https://platform.openai.com/docs/docs-mcp)
- [OpenAI Codex CLI getting started](https://help.openai.com/en/articles/11096431)

Default Recallant target:

```bash
recallant attach . --target codex
```

Recallant writes `.recallant/codex-mcp.json`. For Codex CLI builds with `codex mcp add`, register
the server from the project root:

```bash
codex mcp add recallant \
  --env RECALLANT_PROJECT_ID=<project-id> \
  --env RECALLANT_DEVELOPER_ID=<developer-id> \
  --env 'RECALLANT_DATABASE_URL=${RECALLANT_DATABASE_URL}' \
  -- recallant mcp-server
```

Then verify:

```bash
codex mcp list
```

If a Codex build uses direct config editing instead, translate the generated
`.recallant/codex-mcp.json` server block into that Codex config format and keep the same command,
args, and env values.

## Cursor

Official reference:

- [Cursor MCP documentation](https://docs.cursor.com/context/mcp)

Use the generic target until a dedicated Cursor writer is added:

```bash
recallant attach . --target generic
```

Copy the generated `.recallant/generic-mcp.json` `mcpServers.recallant` block into
`.cursor/mcp.json` for project-specific setup. Keep the same `command`, `args`, and `env` values.
Open or reload the folder after saving the config.

## Claude Code

Official reference:

- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

Use the dedicated project-local target:

```bash
recallant connect claude-code --project-dir .
```

Recallant writes or merges `.mcp.json` in the project root. It preserves existing MCP servers,
adds only `mcpServers.recallant`, and creates a local backup before changing an existing file.
Preview the exact change first:

```bash
recallant connect claude-code --project-dir . --dry-run
```

Then verify in Claude Code with:

```bash
claude mcp list
/mcp
```

## Windsurf

Official reference:

- [Windsurf Cascade MCP documentation](https://docs.windsurf.com/windsurf/cascade/mcp)

Use the generic target:

```bash
recallant attach . --target generic
```

Copy the generated `.recallant/generic-mcp.json` `mcpServers.recallant` block into Windsurf's MCP
config, normally `~/.codeium/windsurf/mcp_config.json` on macOS/Linux. Reload Cascade after saving
the config.

## Generic MCP Clients

For any MCP client that accepts a JSON `mcpServers` block:

```bash
recallant attach . --target generic
```

Use `.recallant/generic-mcp.json` as the canonical local stdio server config. The client must launch
`recallant mcp-server` with the project/developer/database env values from that file.

## Optional Local Hook Kit

For clients that support local hook commands, Recallant can write project-local helper scripts
without touching global client config:

```bash
recallant connect codex --install-local-hooks
```

This creates `.recallant/hooks/`. The scripts are fail-soft: if `recallant` is unavailable or the
hook times out, they exit `0` so normal agent work is not interrupted. If the primary capture path
cannot reach Recallant while the CLI is available, the scripts try to write a local spool record
under `.recallant/spool/` before exiting. Client-specific global hook installation is still
separate; the local hook kit only provides safe targets that adapters can call.

## Startup Smoke

After connecting a client, the first agent session should do this without owner prompting:

1. Read `AGENTS.md`.
2. Call `memory_start_session`.
3. Call `memory_get_context_pack`.
4. Capture meaningful decisions/actions/tests/checkpoints through Recallant MCP tools or the CLI
   fallback commands.

If the client cannot load MCP tools, keep working through the CLI fallback:

```bash
recallant agent-start --task-hint "<current task>"
recallant agent-event --kind decision --text "<important decision>"
recallant agent-checkpoint --summary "<current state>"
recallant agent-closeout --summary "<what changed and what is next>"
```

For clients that can run project-local hooks, `recallant connect --install-local-hooks` installs
fail-soft wrappers under `.recallant/hooks/`:

- `start-session.sh` records the session start and reads a Context Pack.
- `user-prompt.sh` records owner prompts as prompt capture events.
- `tool-result.sh` records meaningful tool or command results.
- `capture-event.sh` remains the generic decision/action/test capture target.
- `pre-compaction.sh` writes a checkpoint before context compaction.
- `stop-session.sh` and `closeout.sh` close out a session and leave an explicit closeout event.

These hooks exit 0 when Recallant is unavailable or times out. They are safe local integration
targets, not global client config writers.
