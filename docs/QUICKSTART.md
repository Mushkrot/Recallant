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
attaches the project, analyzes documentation posture, prepares thin local agent configuration for
Codex, installs local hooks when supported, proves capture and recall, and prints the private
Workbench outcome. Advanced flags can opt out of those defaults, but they are not part of the
beginner path.

Before changing project files, onboarding also checks version-control safety. If Git is available
but the project is not a usable Git work tree, onboarding offers to initialize Git first or continue
with Recallant local backups only. In approved automation, `--yes` may initialize Git, but Recallant
does not stage or commit project files, secrets, or data automatically.

Expected success:

- `Capture active: yes` after context read, memory write, checkpoint, and recall proof are present;
- `Embedding recovery: current` or a bounded recovery/waiting status when local embeddings are
  catching up;
- a concise documentation posture summary: `Documentation posture: empty | healthy |
  needs_attention | risky`, followed by `Found:` and `Workbench:` lines that summarize what was
  discovered and what to review next;
- a Workbench link with private/auth-required posture;
- project visibility and review queue status.

Maintainers can run the public quickstart smoke to exercise this same path in temporary clean
directories:

```bash
npm run public-quickstart:smoke
```

That smoke prints an `acceptance_report` for the beginner path. A release-ready run means:

- `status: "pass"`: onboarding, Codex MCP config, hook kit, capture-active doctor, context pack
  recall, checkpoint fallback, Workbench navigation, embedding baseline, and public UI readiness
  fixtures all passed;
- `status: "pass_with_warnings"`: no blocking failure occurred, but a recoverable condition such as
  pending local embeddings needs attention;
- `status: "fail"`: at least one required proof is missing, so the one-command path is not ready.

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
safety gates. When documentation posture needs review, the Workbench shows a documentation strategy
surface with four choices: keep current docs and add a Recallant layer, canonicalize docs for a
Recallant-aware workflow, create starter docs, or discuss first. This surface helps the owner choose
the next documentation posture. Empty projects may receive starter docs during the confirmed
`recallant onboard <project>` write step. Existing-doc canonicalization and broader doc rewriting
remain confirmed Workbench workflows.

The Workbench and startup context packs also show a minimal canon/capability context layer:
environment facts, capability references, secret reference names, server canon link status, and a
documentation authority map. These are guidance and provenance for agents. They do not activate
connectors, reveal secret values, or turn recalled text into binding rules.

## 5. Clean Up Or Reset A Test Project

Recallant has separate cleanup levels so a test run does not turn into accidental data loss.

To remove a project from active Recallant views and search without deleting Recallant records,
preview detach first:

```bash
recallant project-sanitize --project-id <project-id> --mode detach --dry-run
```

Then confirm only after checking the target. Detach closes active Recallant sessions and hides the
project from normal recall, but it does not physically delete Recallant database records.

To start over from a clean Recallant slate for a disposable or wrongly attached project, use purge
mode. Dry-run is still the default:

```bash
recallant project-sanitize --project-id <project-id> --mode purge --dry-run
```

The dry-run prints a receipt with `target`, `database_action`, `local_action`,
`retained_governance_receipt`, and `cleanup_scope`. The `target` block names whether the request
came from `--project-id`, `--project-dir`, or orphan local artifacts, and `cleanup_scope` must say
this is not Recallant product-repo cleanup. Confirmed purge requires the exact token printed in the
dry-run:

```bash
recallant project-sanitize --project-id <project-id> --mode purge --confirm-token "<token>"
```

If local project metadata is stale, Recallant does not stop at the stale id. The dry-run reports the
stale `project_id`, resolves the current managed project by path when it can do so safely, and
prints the confirmation token for the resolved project. Review that target-resolution block before
confirming purge.

If the Recallant database no longer has a matching project but local Recallant bootstrap artifacts
remain, use the explicit local-only cleanup path. It is also dry-run first:

```bash
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --dry-run
```

After reviewing the planned local changes, confirm only the local Recallant artifact cleanup:

```bash
recallant project-sanitize --project-dir <project-dir> --mode purge --allow-orphan-local --confirm
```

That local-only path must report `writes_database: false`; it is not a database purge.

Project sanitization never deletes source files, secrets, downloads, or arbitrary project data. When
local disconnect is enabled, Recallant removes or updates only Recallant-generated artifacts such as
`.recallant/` pointer files, generated hooks, offline spool files, Recallant MCP config, and
generated bootstrap sections. If a previous file can only be restored from a redacted backup,
Recallant reports that limitation instead of guessing.

## What Gets Written

Project attach may create small local pointer/config files such as `.recallant/config`,
client-specific MCP config such as `.codex/config.toml`, `AGENTS.md`, and `PROJECT_LOG.md`.
Durable memory lives in Recallant, not in those bootstrap files.

When onboarding finds no project docs, it may also create starter docs. The base starter set is
`README.md`, `AGENTS.md`, and `PROJECT_LOG.md`. Service or app projects may also get runbook and
architecture docs; product or roadmap projects may get status and decision docs; library or package
projects may get an API or usage surface. Starter docs are not copied old handoffs, and onboarding
must not overwrite existing target files.

`AGENTS.md` should route future agents into Recallant. `PROJECT_LOG.md` is a compact
fallback/checkpoint file. Old handoffs, long history, source notes, and runbook details should be
imported as source-linked evidence or reviewed memories rather than copied into startup context.
The documentation posture summary is stored in Recallant and appears in later context packs so a
new agent can see whether the project is already documented well, needs canon links, or should be
reviewed before docs are rewritten.

## Next

- [Agent-ready projects](AGENT_READY_PROJECTS.md)
- [Client setup](CLIENT_SETUP.md)
- [Self-hosting](SELF_HOSTING.md)
- [Security](SECURITY.md)

## Advanced / Debug CLI

Maintainers and automation can still use lower-level commands such as attach, connect, doctor,
agent capture, demo capture, and ask when they need explicit control. See [Client setup](CLIENT_SETUP.md)
for that advanced path. These commands are not required for the beginner quickstart above.
