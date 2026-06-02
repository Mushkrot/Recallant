# Recallant

**Governed external memory for the owner and AI agents.**

Recallant is a source-backed memory and context continuity platform for AI-assisted work. It
preserves decisions, working context, evidence, checkpoints, and operating knowledge across
sessions, tools, agent clients, projects, and broader memory spaces.

In Recallant, a project is a logical memory space. It may be backed by a folder, repository, server
path, document set, connector, or no folder at all.

## Quick Start

Preview the install:

```bash
git clone <recallant-repo-url> recallant
cd recallant
./scripts/install-recallant.sh --dry-run --profile single-user
```

Install on a private server or workstation:

```bash
git clone <recallant-repo-url> recallant
cd recallant
./scripts/install-recallant.sh --profile single-user
```

Attach a project:

```bash
cd /path/to/project
recallant attach .
```

Connect an agent client and prove capture:

```bash
recallant connect codex --project-dir . --dry-run
recallant connect codex --project-dir .
recallant doctor --project-dir . --require-capture
```

The target state is not just "configured"; it is **capture active**.

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the complete first-user path,
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for install profiles and rollback notes, and
[docs/CLIENT_SETUP.md](docs/CLIENT_SETUP.md) for Codex, Cursor, Claude Code, Windsurf, and generic
MCP clients.

## Documentation

The implementation-oriented specification lives in **[docs/](docs/README.md)**.

Start with [docs/README.md](docs/README.md); it defines the canonical reading order.

## Status

Recallant has a first production-ready coding-agent memory slice and an owner-server production
deployment for the private Workbench UI, Postgres/pgvector, local Ollama, automated local backups,
autonomous project attach/detach, controlled cross-project recall, AI-backed management chat with
deterministic safety gates, and first public-packaging/onboarding guardrails. Current product work
is tracked in [docs/DEVELOPMENT_PLAN_2026-06-01.md](docs/DEVELOPMENT_PLAN_2026-06-01.md) and
[docs/PUBLIC_READINESS.md](docs/PUBLIC_READINESS.md).

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Related Materials

- `agent-bootstrap` is the owner's earlier personal sketch for the same problem. It is useful for repo-contract ideas such as `AGENTS.md` / `PROJECT_LOG.md`, but it is not a mature external upstream. The adjacent folder is not required for normal work: the relevant conclusions are captured in [docs/REPO_CONTRACT.md](docs/REPO_CONTRACT.md), [docs/UPSTREAM_INTEGRATION.md](docs/UPSTREAM_INTEGRATION.md), and [docs/UPSTREAM_RESEARCH_2026-05-19.md](docs/UPSTREAM_RESEARCH_2026-05-19.md).
