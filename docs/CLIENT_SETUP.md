# Client Setup

Recallant connects to agents through local MCP stdio. The Workbench is for humans; agents normally
call `recallant mcp-server` locally.

## Beginner Flow

For ordinary project setup, use onboarding:

```bash
recallant onboard <project> --client codex --install-local-hooks --verify
```

Onboarding owns attach, client connection, capture proof, readiness proof, and recall proof. The
project is not capture active until context read, memory write, checkpoint, and recall evidence are
present.

## Advanced Client Setup

Maintainers and automation can still use the lower-level client setup path when they need explicit
control over each step:

```bash
recallant attach .
recallant connect codex --project-dir .
recallant doctor --project-dir . --require-capture
```

Attach creates the memory space and small project-local pointers. Connect writes or prints the client
configuration. Doctor verifies whether the client has produced capture evidence.

Project-local files stay thin. The client setup should point agents to Recallant, not copy long
handoffs or private deployment details into prompt-visible files.

## Codex

Default target:

```bash
recallant connect codex --project-dir . --dry-run
recallant connect codex --project-dir .
```

Generated MCP shape:

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

If your Codex build supports `codex mcp add`, register the same command, args, and env values from
the generated project-local config.

## Cursor

```bash
recallant connect cursor --project-dir . --dry-run
recallant connect cursor --project-dir .
```

Recallant merges a project-local MCP config while preserving existing servers.

## Claude Code

```bash
recallant connect claude-code --project-dir . --dry-run
recallant connect claude-code --project-dir .
```

Recallant writes a local MCP config that Claude Code can load from the project root.

## Windsurf And Generic MCP Clients

```bash
recallant connect generic --project-dir . --dry-run
recallant connect generic --project-dir .
```

Use the generated `mcpServers.recallant` block in any MCP client that accepts stdio server config.

## Optional Local Hooks

For clients that can call local hook scripts:

```bash
recallant connect codex --project-dir . --install-local-hooks --dry-run
recallant connect codex --project-dir . --install-local-hooks
```

Hooks are fail-soft. If Recallant is unavailable, they should not block normal agent work. When
possible, they write local spool records for later sync.

## Agent Startup Contract

The first agent session after connect should:

1. read project instructions;
2. call `memory_start_session`;
3. call `memory_get_context_pack`;
4. work normally;
5. write meaningful decisions, actions, tests, and checkpoints;
6. close out with `memory_closeout`.

That startup contract is what turns a registered project into an agent-ready project. If the loop is
not visible in Recallant, the project is configured but not yet capture active.

If MCP tools are unavailable, use CLI fallback commands:

```bash
recallant agent-start --task-hint "<current task>"
recallant agent-event --kind decision --text "<important decision>"
recallant agent-checkpoint --summary "<current state>"
recallant agent-closeout --summary "<what changed and what is next>"
```
