# Quickstart - install Recallant and connect a project

Current operator note: [PRE_PILOT_READINESS.md](PRE_PILOT_READINESS.md), the first copied-project
pilot, first product-level attach slice, and first governed detach slice are complete. `autopilot`
is the default for ordinary projects, while production-sensitive projects downgrade to `guided`
unless production-safe autopilot is explicitly approved.

## Install on a server

The intended operator path is short:

```bash
git clone <recallant-repo-url> recallant
cd recallant
sudo ./scripts/install-recallant.sh
```

The installer builds Recallant, creates a private env file if one does not exist, starts the
localhost-only Postgres service, installs the `recallant` command, and starts
`recallant.service` when systemd is available.

Preview the server install without changing files, Docker, the database, or systemd:

```bash
./scripts/install-recallant.sh --dry-run --profile owner-server
```

For a non-root single-user preview:

```bash
./scripts/install-recallant.sh --dry-run --profile single-user
```

For an already configured server where only the CLI wrapper is missing:

```bash
cd /ai/recallant
sudo ./scripts/install-recallant-cli.sh
```

After that, operators should not need to run `node apps/cli/dist/index.js` or manually source
`/opt/secure-configs/recallant.env`. The CLI auto-loads the server env file when present.

## Prerequisite: server is running

On a Linux server, Recallant needs Postgres/pgvector and the Recallant server. A local model provider such as Ollama is used when configured and reachable; use an existing installation instead of starting a duplicate stack by default.

Owner-server production profile:

```text
Human UI:
  https://recallant.unicloud.ca
    -> Cloudflare Access (highmac@gmail.com)
    -> Cloudflare Tunnel mainserver
    -> http://127.0.0.1:3005
    -> Recallant session cookie

Agents:
  recallant mcp-server over local stdio MCP

Postgres:
  Docker Compose pgvector service
  docker-compose.production.yml
  127.0.0.1:15432 -> container 5432

Secrets:
  /opt/secure-configs/recallant.env

Data:
  /ai/recallant-data
```

The production env file must include stable `RECALLANT_PROJECT_ID` and
`RECALLANT_PROJECT_PATH=/ai/recallant`; otherwise short-lived server/CLI processes can create
duplicate project rows for the same path.

Check:

```bash
recallant doctor
# OK Postgres reachable
# OK configured Ollama/local-model endpoint reachable, or clear fallback/missing status
# OK Recallant server version 1.x.x
```

On the owner's server, the production HTTP process runs as `recallant.service` and starts with:

```bash
npm run server:start
```

Production local backups are automated by `recallant-backup.timer`. Each run creates a backup under
`/ai/recallant-data/backups`, verifies it with `recallant backup-verify`, and updates
`/ai/recallant-data/backups/latest-manifest.json`. The `backup-verify --manifest` command accepts
that latest-manifest symlink directly.

On the owner's server, any long-running port-bound service must be registered in `/ai/PORTS.yaml` before start, and security/exposure changes must consult `/ai/SECURITY`.

Use `make prod-db-up`, `make prod-db-migrate`, and `make prod-db-status` for the production
Postgres service. These targets call `scripts/recallant-prod-compose.sh`, which sources
`/opt/secure-configs/recallant.env` without printing it and passes only the database variables to
the Postgres container. Do not inspect production compose with resolved real secrets.

The development database targets (`make db-up`, `make db-reset`, `make db-down`) use the separate
Docker Compose project name `recallant-dev`. They are for local smoke-test databases only and must
not be used as production lifecycle commands. The dev Postgres container is published only on
`127.0.0.1:15433` so smoke tests do not collide with unrelated local Postgres services.

For the first production deployment, do not expose remote MCP through Cloudflare. The Cloudflare
hostname is for the human Review/Management UI and same-origin admin API. Agents use the local
stdio MCP command printed by `recallant init`.

## Step 1 - Attach or register a project

Target product workflow from inside any project folder:

```bash
recallant attach .
```

`--target codex` and `--mode autopilot` are the defaults for the current v1 operator workflow. A
normal new project should not require additional flags.

After attach, generated `AGENTS.md` and `PROJECT_LOG.md` tell agents to start real work through the
capture runtime:

```bash
recallant agent-start --task-hint "<current task>"
recallant agent-event --kind decision --text "<important owner/project decision>"
recallant agent-checkpoint --summary "<where the project stands>"
recallant agent-closeout --summary "<what changed and what is next>"
```

Agents normally use MCP tools directly when available. These CLI commands are the fallback path that
keeps a normal installed `recallant` command useful even before every client integration is polished.

For a disposable test/sandbox project:

```bash
recallant attach . --sandbox
```

Attach modes:

- `manual`: cautious mode; only explicit commands write durable data.
- `guided`: Recallant creates a complete plan and waits for confirmation.
- `autopilot`: Recallant runs safe setup/import/check steps and produces a report.

If no mode is specified, `autopilot` is used unless production-sensitive detection switches the run
to `guided`.

For production-sensitive projects:

```bash
recallant attach /ai/buddhisthelp --target codex --mode autopilot
# Production-sensitive project detected.
# Switching to guided mode.
```

Production-safe autopilot requires explicit approval and still keeps hard safety gates:

```bash
recallant attach /ai/buddhisthelp --target codex --mode autopilot --production-approved
```

The lower-level `init`, `discover`, and `import` commands remain available for manual or diagnostic
work.

### Detach a copied sandbox or live project

Always start with dry-run:

```bash
recallant detach --project-id <project-id> --mode sandbox --dry-run
recallant detach --project-id <project-id> --mode live --dry-run
```

Confirmed sandbox detach hides the sandbox from active Review UI/search and archives active chunks,
but does not delete database rows or local files:

```bash
recallant detach --project-id <project-id> --mode sandbox --confirm
```

Confirmed live detach hides the project in Recallant without touching files, physically deleting
records, or archiving chunks:

```bash
recallant detach --project-id <project-id> --mode live --confirm
```

Ordinary detach is not permanent erasure. Sensitive or wrong memory must use the separate confirmed
forget workflow.

After detach, optional local cleanup can remove Recallant pointer/runtime files from a sandbox copy
without touching project source files:

```bash
recallant local-cleanup --project-dir /path/to/sandbox --dry-run
recallant local-cleanup --project-dir /path/to/sandbox --confirm
```

Confirmed local cleanup is blocked until the project is already detached or sandbox-cleaned in
Recallant. It removes only `.recallant/config`, `.recallant/codex-mcp.json`, and
`.recallant/current-session.json`; `AGENTS.md`, `PROJECT_LOG.md`, source files, and attach backups
remain in place.

### Ask for examples from other projects

Agents use normal context packs for the current project. When a task needs a known pattern from
another project, call the explicit MCP tool:

```json
{
  "tool": "memory_cross_project_recall",
  "arguments": {
    "query": "Google Drive connector setup",
    "mode": "similar_projects"
  }
}
```

Returned items are source-linked examples, not current-project rules. If the pattern is applied,
write a current-project memory with source refs.

### Lower-level new-project path

```bash
mkdir ~/projects/my-new-project
cd ~/projects/my-new-project
recallant init --target codex
```

The command:

1. creates a DB record in `projects` and generates `project_id`;
2. assigns the default capture profile, normally `standard`, unless overridden;
3. writes `.recallant/config` into the project directory;
4. creates `AGENTS.md` with a `Memory (Recallant)` section;
5. adds `.recallant/` to `.gitignore`;
6. prints MCP config blocks for the target client;
7. may show detected import candidates, but does not import them automatically.

Override capture depth at init time:

```bash
recallant init --target codex --capture-profile detailed
```

Or change it later through the management UI, project settings, or CLI.

`--target codex` is the near-term default path because the owner's current workflow is Codex-first. Other targets remain supported by architecture: `cursor`, `claude-code`, `windsurf`, and `generic`.

Example output:

```text
OK Project registered: my-new-project
   project_id: 550e8400-e29b-41d4-a716-446655440000
   capture_profile: standard

OK Created: .recallant/config
OK Created: AGENTS.md

Detected import candidates:
  PROJECT_LOG.md
  docs/architecture/*.md

No imports were run.
Suggested commands:
  recallant import project-log PROJECT_LOG.md
  recallant import docs docs/architecture/*.md

--- Codex (paste into project/local Codex MCP config) ---
{
  "mcpServers": {
    "recallant": {
      "command": "recallant",
      "args": ["mcp-server"],
      "env": {
        "RECALLANT_PROJECT_ID": "550e8400-e29b-41d4-a716-446655440000",
        "RECALLANT_DEVELOPER_ID": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "RECALLANT_DATABASE_URL": "postgresql://recallant:secret@127.0.0.1:15432/recallant_agent_work"
      }
    }
  }
}
```

## Step 2 - Add MCP config to the client

Use the block generated by `recallant init`.

**Codex:** use the generated Codex MCP config from `recallant init --target codex`.

**Claude Code:** `.claude/settings.json` globally or `<project>/.claude/settings.json` locally.

**Cursor:** `.cursor/mcp.json` in the project directory.

After that, the client connects to Recallant the next time the folder is opened.

## Step 3 - Start work

Open the project folder in any supported MCP client. At startup, the agent:

1. reads `AGENTS.md`;
2. calls `memory_start_session`;
3. calls `memory_get_context_pack` and receives checkpoint, relevant governed memories, recovery warnings, and suggested next fetches;
4. starts work.

Meaningful work is captured through Recallant tools. Live capture/full transcript capture depends on the connected client and ingest mode. If the live MCP write path is unavailable, local spool/offload preserves raw evidence for later sync. Large tool/terminal outputs are stored as raw artifact metadata/pointers/excerpts, not as startup context dumps.

## Switching agents or sessions

Context should not be lost when switching clients or after a session interruption.

```text
Cursor morning                  Claude Code evening
------------------------------  ------------------------------
work on task                    open same folder
agent writes memory             agent reads AGENTS.md
agent sets checkpoint           agent calls memory_start_session
                                agent calls memory_get_context_pack
                                continues from same point
```

The owner should not need to re-explain context to the new agent.

## Cross-project recall

If an agent needs to find a solution already used in another project:

```text
memory_search(query="how did I connect Google Drive in another project", scope="all")
```

Cross-project hits are examples/evidence unless their scope/use policy says they are already an
applicable developer/environment/capability record. They should show source project, source path/ref,
scope, status, and whether the result is directly applicable.

To save a pattern as reusable for the current project, create a governed memory proposal with source
refs:

```text
memory_create_agent_memory(
  memory_type="procedure",
  body="This project uses the Google Drive connector pattern adapted from <source project>.",
  source_refs=[...]
)
```

To make a pattern reusable across projects, promote it through review/owner-confirmed policy instead
of silently treating one project's memory as a global rule.

## Natural-language management

The owner can use the management UI/chat for questions and actions:

```text
Show what the next agent needs before starting.
Find stale GitHub access memories.
Archive duplicate rules about documentation updates.
Forget the wrong Google Drive account binding for this project.
```

Destructive, cost-affecting, security-sensitive, connector/account, public-exposure, or global-rule actions require explicit confirmation.

## Files after `recallant init`

```text
my-new-project/
├── .recallant/
│   └── config          # project_id + recallant_server_url; ignored by git
├── .gitignore          # .recallant/ added automatically
├── AGENTS.md           # thin agent instructions; commit to git
└── PROJECT_LOG.md      # human-readable checkpoint; commit to git
```

Generated files must stay thin. They should not copy old project logs, long architecture docs, or all historical memory into the new project. That content belongs in Recallant and is recalled on demand.
