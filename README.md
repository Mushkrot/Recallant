# Recallant

**Governed external memory for the owner and AI agents.**

Recallant is a source-backed memory and context continuity platform for AI-assisted work. It preserves decisions, working context, evidence, checkpoints, and operating knowledge across sessions, tools, agent clients, projects, and future memory spaces.

## Documentation

The implementation-oriented specification lives in **[docs/](docs/README.md)**.

Start with [docs/README.md](docs/README.md); it defines the canonical reading order.

## Quick Start

Install on a server:

```bash
git clone <recallant-repo-url> recallant
cd recallant
sudo ./scripts/install-recallant.sh
```

Attach a project:

```bash
cd /path/to/project
recallant attach .
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for cautious modes, sandbox attach, and production
notes.

## Status

Recallant has a working local v1 implementation slice and an owner-server production deployment for
the private Review UI, Postgres/pgvector, local Ollama, automated local backups, autonomous project
attach/detach, controlled cross-project recall, and AI-backed management chat with deterministic
safety gates.

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Related Materials

- `agent-bootstrap` is the owner's earlier personal sketch for the same problem. It is useful for repo-contract ideas such as `AGENTS.md` / `PROJECT_LOG.md`, but it is not a mature external upstream. The adjacent folder is not required for normal work: the relevant conclusions are captured in [docs/REPO_CONTRACT.md](docs/REPO_CONTRACT.md), [docs/UPSTREAM_INTEGRATION.md](docs/UPSTREAM_INTEGRATION.md), and [docs/UPSTREAM_RESEARCH_2026-05-19.md](docs/UPSTREAM_RESEARCH_2026-05-19.md).
