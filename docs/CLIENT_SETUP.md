# Client Setup

Recallant connects to agents through local MCP stdio. The Workbench is for humans; agents normally
call `recallant mcp-server` locally.

Remote project access is planned but not part of the current default client setup. Today, a protected
public Workbench URL lets humans review and manage Recallant; it does not by itself make an external
workstation or server an agent client. Projects outside the Recallant host need a future
authenticated remote MCP/agent path before they can attach to one central Recallant server without
local storage bindings.

## Beginner Flow

For ordinary project setup, use onboarding:

```bash
recallant onboard <project>
```

Onboarding defaults to the Codex beginner flow: attach, client connection, local hooks when
supported, capture proof, readiness proof, and recall proof. The project is not capture active until
context read, memory write, checkpoint, and recall evidence are present.

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

Generated project-local Codex config:

```toml
[mcp_servers.recallant]
command = "recallant"
args = ["mcp-server"]
env = { RECALLANT_PROJECT_ID = "<project-id>", RECALLANT_DEVELOPER_ID = "<developer-id>" }
env_vars = ["RECALLANT_DATABASE_URL"]
```

Codex reads `.codex/config.toml` only for trusted projects, so onboarding writes the project-local
config and then the next Codex session can launch the Recallant MCP server automatically. If your
Codex build supports `codex mcp add`, global registration remains an advanced alternative rather
than the beginner path.

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

## Remote Project Access (Planned)

The near-term remote-client goal is to support projects on another server or workstation while a
single managed Recallant server remains the memory source of truth. That path should:

- authenticate each remote agent/client before any memory tool call;
- scope every request to an attached project and developer;
- avoid direct remote Postgres exposure;
- keep Workbench/admin, raw artifacts, backups, and provider settings private;
- provide diagnostics that distinguish auth failure, network failure, project-not-attached, and
  capture-not-active states;
- preserve the same startup contract: `memory_start_session`, `memory_get_context_pack`, meaningful
  evidence/checkpoints, and closeout.

Until that work lands, use the local stdio setup above on the installed host.

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
