# Quickstart

Install Recallant, attach one project, connect Codex, and prove the project is capture active.

## 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
```

Preview first:

```bash
git clone https://github.com/Mushkrot/Recallant.git recallant
cd recallant
./scripts/install-recallant.sh --dry-run --profile single-user
```

Verify the CLI:

```bash
recallant --version
recallant doctor
```

## 2. Make A Project Agent-Ready

From a project directory:

```bash
recallant onboard --client codex --install-local-hooks --verify
```

The one-command flow attaches the project, prepares thin local agent configuration, installs
optional local hooks, and verifies whether capture is active.

For step-by-step onboarding:

```bash
recallant attach .
recallant connect codex --project-dir . --dry-run
recallant connect codex --project-dir .
```

## 3. Prove Capture

Do not stop at "configured". Prove that Recallant has captured project memory:

```bash
recallant demo-capture --project-dir .
recallant doctor --project-dir . --require-capture
recallant ask "what did the agent remember?" --project-dir .
```

Expected result: `doctor --require-capture` reports the project as capture active, and `ask` can
summarize the test memory that was written.

## 4. Open The Workbench

Run:

```bash
recallant doctor
```

The doctor output shows the private Workbench URL for your install profile. The Workbench is used to
review memories, rules, source context, capture status, and safety gates.

## 5. Clean Up A Test Project

For a disposable sandbox project, preview detach first:

```bash
recallant detach --project-id <project-id> --mode sandbox --dry-run
```

Then confirm only after checking the target. Detach removes the project from active Recallant views;
it should not delete your source files.

## What Gets Written

Project attach may create small local pointer/config files such as `.recallant/config`,
client-specific MCP config, `AGENTS.md`, and `PROJECT_LOG.md`. Durable memory lives in Recallant,
not in those bootstrap files.

`AGENTS.md` should route future agents into Recallant. `PROJECT_LOG.md` is a compact
fallback/checkpoint file. Old handoffs, long history, source notes, and runbook details should be
imported as source-linked evidence or reviewed memories rather than copied into startup context.

## Next

- [Agent-ready projects](AGENT_READY_PROJECTS.md)
- [Self-hosting](SELF_HOSTING.md)
- [Client setup](CLIENT_SETUP.md)
- [Security](SECURITY.md)
