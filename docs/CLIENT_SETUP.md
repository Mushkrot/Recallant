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

Use the generic target:

```bash
recallant attach . --target generic
```

From the project root, register Recallant as a local stdio server:

```bash
claude mcp add --transport stdio \
  --env RECALLANT_PROJECT_ID=<project-id> \
  --env RECALLANT_DEVELOPER_ID=<developer-id> \
  --env 'RECALLANT_DATABASE_URL=${RECALLANT_DATABASE_URL}' \
  recallant -- recallant mcp-server
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
