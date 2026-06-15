# Recallant

**Self-hosted governed memory for Codex and MCP AI agents.**

Recallant gives AI coding agents a durable memory layer and a project onboarding contract for real
work. It records decisions, checkpoints, evidence, reviewable rules, and source-backed context so a
later session can resume without asking maintainers to rebuild the same background over and over.

Recallant is private by default, Apache-2.0 licensed, and designed for OSS maintainers who use
Codex, Cursor, Claude Code, Windsurf, or any MCP-compatible client.

## Why It Matters

AI-assisted development often loses the thread between sessions. Project decisions live in chat
history, local notes, PR comments, terminal output, and human memory. Generic logs or basic RAG can
recover fragments, but they usually miss authority, provenance, review state, and scope.

Recallant is built around governed memory:

- **Evidence first:** raw workflow evidence, source references, and bounded excerpts stay attached to
  remembered facts.
- **Rules need authority:** durable guidance cannot silently become an instruction just because an
  agent inferred it.
- **Project context stays scoped:** current-project memory is the default; cross-project examples are
  explicit and labeled.
- **Maintainers keep control:** destructive actions, paid API use, public exposure, secrets, and
  global rules stay behind policy gates.

The result is a memory system that helps agents work faster without turning old context into an
unreviewed pile of instructions.

Recallant also aims to make projects **agent-ready**. A new or existing repository should be able to
attach to Recallant, get thin startup files, migrate useful old handoffs as evidence, prove capture
is active, and let future agents continue from governed context instead of a long manual prompt.

## What You Can Try Today

Recallant is pre-release, but the first coding-agent memory slice is working: onboard a project,
prove capture, and get a private Workbench review link from one command.

Install:

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
```

Onboard a project for Codex:

```bash
recallant onboard /path/to/project
```

Onboarding defaults to the beginner Codex path: project attach, local client connection, optional
hooks, capture proof, recall proof, and the Workbench outcome. If storage is missing in an
interactive terminal, it offers to run the local single-user storage setup first; in automation it
stops with `storage_blocked` and a plain setup choice. `Database not configured` is not a successful
onboarding state. If the project looks production-sensitive, onboarding shows the planned writes,
backup behavior, import/review behavior, and an interactive continue/cancel prompt before changing
files.

The important state is not "installed" or "configured". The important state is **capture active**:
Recallant has observed real context reads, memory writes, checkpoints, and recall proof for the
project. The success output also includes a private Workbench link for review.

Lower-level CLI commands such as attach, connect, doctor, project-sanitize, agent capture, demo
capture, and ask remain available for maintainers and automation. They are advanced/debug APIs, not
the normal beginner path. See [Client setup](docs/CLIENT_SETUP.md).

## Product Shape

Recallant runs as a local or self-hosted memory service:

- CLI for install, attach, connect, doctor, capture proof, project sanitization, and cleanup.
- MCP server for agent clients.
- Postgres/pgvector-backed storage.
- Private Workbench UI for review, rules, source context, settings, and management chat.
- Local-first model routing with explicit approval gates for paid APIs.
- Source, capability, and secret-reference model for agent-ready project setup without storing raw
  secrets.

See [Architecture](docs/ARCHITECTURE.md) for the public system overview.

## Documentation

- [Quickstart](docs/QUICKSTART.md): install Recallant and prove one project can remember.
- [Agent-ready projects](docs/AGENT_READY_PROJECTS.md): autonomous attach, thin bootstrap files,
  source references, and safety gates.
- [Product contract status](docs/CONTRACT_STATUS.md): current coverage, evidence, and remaining
  release work.
- [Why Recallant](docs/WHY_RECALLANT.md): problem statement and community value.
- [Comparison](docs/COMPARISON.md): inspirations, alternatives, and the gap Recallant fills.
- [Reference projects](docs/REFERENCE_PROJECTS.md): external projects Recallant studies, what to
  borrow, and what not to copy.
- [Self-hosting](docs/SELF_HOSTING.md): profiles, rollback, verification, and security defaults.
- [Client setup](docs/CLIENT_SETUP.md): Codex and other MCP clients.
- [Security](docs/SECURITY.md): public threat model and safe defaults.
- [Roadmap](docs/ROADMAP.md): pre-release status and next milestones.
- [Contributing](CONTRIBUTING.md): how to work on the project.

## Status

Recallant is **pre-release**. It is suitable for local evaluation and development, not for
unreviewed team-wide production rollout.

Current strengths:

- first end-to-end coding-agent memory loop;
- first agent-ready project onboarding path;
- existing-project migration reports with local backups, import counts, review-needed counts, and
  raw-secret signals;
- clean-host dry-run, fresh public quickstart validation, CLI-wrapper validation, and opt-in
  Docker-backed managed install smoke;
- neutral non-owner migration smoke with original-project safety checks;
- Workbench migration review queue for imported evidence, conflicts, secret references, and stale
  handoffs;
- Codex-first MCP workflow with generic MCP client posture;
- private-by-default Workbench and server defaults;
- explicit security and cost governance design;
- public/private boundary guards across docs and runtime/install defaults;
- smoke coverage for the core capture/recall path.

Known pre-release work:

- external-host release rehearsal beyond the disposable clean-host smokes;
- more public screenshots and docs polish;
- broader client pilot matrix;
- broader real-world existing-project migration pilots;
- independent release hardening;
- packaging and versioned release tags.

## License

Apache License 2.0. See [LICENSE](LICENSE).
