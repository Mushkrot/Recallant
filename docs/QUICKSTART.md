# Quickstart

Install Recallant and make one project agent-ready with one onboarding command.

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
```

## 2. Make A Project Agent-Ready

From anywhere:

```bash
recallant onboard /path/to/project
```

The one-command flow checks storage readiness, offers local single-user storage setup when needed,
attaches the project, prepares thin local agent configuration for Codex, installs local hooks when
supported, proves capture and recall, and prints the private Workbench outcome. Advanced flags can
opt out of those defaults, but they are not part of the beginner path.

Before changing project files, onboarding also checks version-control safety. If Git is available
but the project is not a usable Git work tree, onboarding offers to initialize Git first or continue
with Recallant local backups only. In approved automation, `--yes` may initialize Git, but Recallant
does not stage or commit project files, secrets, or data automatically.

Expected success:

- `Capture active: yes` after context read, memory write, checkpoint, and recall proof are present;
- a Workbench link with private/auth-required posture;
- project visibility and review queue status.

Maintainers can run the public quickstart smoke to exercise this same path in temporary clean
directories:

```bash
npm run public-quickstart:smoke
```

## 3. If Onboarding Stops

If storage is missing in an interactive terminal, onboarding asks whether to set up local single-user
storage before it touches the project. If the user declines, the environment is non-interactive, or
storage remains unreachable, onboarding reports `storage_blocked` and explains the setup choice.
Local offline spool is a fail-soft capture fallback, not completed onboarding.

If version-control safety needs a decision, onboarding stops before project writes and offers a
plain choice: initialize Git first, install Git if it is missing, or explicitly continue without Git.

If the project looks production-sensitive, onboarding shows the project path, risk reason, planned
writes, backup behavior, import/review behavior, and a continue/cancel prompt before it changes
files. Use `--yes` only in automation that already approved the plan.

## 4. Open The Workbench

The onboarding output includes the private Workbench URL when review state is available. The
Workbench is used to review memories, rules, source context, capture status, migration imports, and
safety gates.

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
- [Client setup](CLIENT_SETUP.md)
- [Self-hosting](SELF_HOSTING.md)
- [Security](SECURITY.md)

## Advanced / Debug CLI

Maintainers and automation can still use lower-level commands such as attach, connect, doctor,
agent capture, demo capture, and ask when they need explicit control. See [Client setup](CLIENT_SETUP.md)
for that advanced path. These commands are not required for the beginner quickstart above.
