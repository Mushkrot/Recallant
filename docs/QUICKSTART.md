# Quickstart - install Recallant, connect one project, prove capture

This is the normal path for a serious self-hosted user who wants Recallant to remember work across
AI agent sessions.

The goal is simple:

1. install Recallant on a private server or workstation;
2. attach a project folder;
3. connect an agent client;
4. prove that Recallant is actually recording, not merely configured.

For deployment profiles, rollback notes, and advanced operations, see
[SELF_HOSTING.md](SELF_HOSTING.md). The owner-specific `/ai` production layout is documented
separately in [OWNER_SERVER.md](OWNER_SERVER.md).

## 1. Preview the install

Clone the repository and preview the install plan first:

```bash
git clone <recallant-repo-url> recallant
cd recallant
./scripts/install-recallant.sh --dry-run --profile single-user
```

Dry-run prints what would be created and then exits. It must not create files, start Docker,
modify a database, or install a service.

Use `owner-server` only when installing a managed server profile with systemd and shared data
paths:

```bash
./scripts/install-recallant.sh --dry-run --profile owner-server
```

## 2. Install

Single-user private install:

```bash
./scripts/install-recallant.sh --profile single-user
```

Managed Linux server install:

```bash
sudo ./scripts/install-recallant.sh --profile owner-server
```

The installer builds Recallant, creates a private environment file if one does not exist, starts the
local Postgres service, installs the `recallant` CLI wrapper, applies migrations when needed, and
starts `recallant.service` when the selected profile uses systemd.

After install:

```bash
recallant doctor
```

The important line is the owner summary. It should tell you whether Recallant is installed, whether
Postgres is reachable, and what the next step is.

## 3. Attach a project

Open the project folder and attach it:

```bash
cd /path/to/project
recallant attach .
```

For a disposable test folder:

```bash
recallant attach . --sandbox
```

For an existing production-sensitive project, preview or guided mode is safer:

```bash
recallant attach /path/to/live-project --mode guided
```

Attach creates a Recallant memory-space binding for the project and writes thin local startup files:

```text
project/
├── .recallant/
│   ├── config
│   └── codex-mcp.json or generic-mcp.json
├── AGENTS.md
└── PROJECT_LOG.md
```

These files are bootstrap pointers, not the full project memory. The durable memory lives in
Recallant.

## 4. Connect an agent client

Attach prepares the project. Connect configures the agent client.

Codex first path:

```bash
recallant connect codex --project-dir . --dry-run
recallant connect codex --project-dir .
```

Cursor:

```bash
recallant connect cursor --project-dir . --dry-run
recallant connect cursor --project-dir .
```

Claude Code:

```bash
recallant connect claude-code --project-dir . --dry-run
recallant connect claude-code --project-dir .
```

Optional local hook kit:

```bash
recallant connect codex --project-dir . --install-local-hooks --dry-run
recallant connect codex --project-dir . --install-local-hooks
```

Hooks are fail-soft. If Recallant is unavailable or times out, they exit successfully so normal
agent work is not broken. When possible, they spool local capture records for later sync.

Detailed client notes are in [CLIENT_SETUP.md](CLIENT_SETUP.md).

## 5. Prove capture is active

Do not stop at "project attached". Prove that Recallant has observed real work:

```bash
recallant doctor --project-dir . --require-capture
```

The healthy state is:

```text
Recallant capture is active for this project.
```

Capture-active means Recallant has evidence of:

- a session start;
- a Context Pack read;
- a memory write;
- a checkpoint.

If the client integration is not ready yet, the CLI fallback can prove the same loop:

```bash
recallant agent-start --task-hint "quickstart smoke"
recallant agent-event --kind decision --text "Quickstart decision: Recallant captured this project."
recallant agent-checkpoint --summary "Quickstart checkpoint captured through Recallant."
recallant agent-closeout --summary "Quickstart smoke complete."
recallant doctor --project-dir . --require-capture
```

## 6. Open the Workbench

Open the private Recallant Workbench URL configured for your install, normally:

```text
http://127.0.0.1:3005/review
```

The Workbench should show:

- the memory space for your project;
- whether capture is active;
- recent Activity / Replay events;
- Review items that need a decision;
- Ask Recallant as the natural-language control surface;
- technical details only in collapsed sections.

## 7. Ask Recallant

Examples:

```text
What should the next agent know before it starts?
Show what this project remembered today.
Why is this rule not applying?
Find how I connected Google Drive in another project.
Remove this sandbox project from Recallant.
Save this rule for all projects.
```

Recallant may interpret the request with local AI, but execution is still governed by server policy.
Deletion, forget, paid API, public exposure, connector/account binding, production service changes,
and broad global rules require dry-run and/or explicit confirmation.

## 8. Detach a test project

Detach removes a project from active Recallant views and search without deleting project files:

```bash
recallant detach --project-id <project-id> --mode sandbox --dry-run
recallant detach --project-id <project-id> --mode sandbox --confirm
```

Ordinary detach is not permanent erasure. Sensitive or wrong memory must use the separate
forget-forever workflow.
