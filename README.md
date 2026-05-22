# Recallant

**Governed memory for AI agents.**

Recallant is a source-backed memory and context continuity platform for AI coding agents. It preserves decisions, working context, evidence, checkpoints, and project-specific operating knowledge across sessions, tools, and agent clients.

## Documentation

The implementation-oriented specification lives in **[docs/](docs/README.md)**.

Start with [docs/README.md](docs/README.md); it defines the canonical reading order.

## Status

This repository currently contains **documentation only**: PRD, architecture, data model, MCP contract, and implementation guidance for agents. Implementation code is created as a separate step according to [docs/AGENT_IMPLEMENTATION_GUIDE.md](docs/AGENT_IMPLEMENTATION_GUIDE.md).

Historical note: this project was originally drafted under the working name **Agent Memory Platform (AMP)**. Active specifications now use **Recallant** for the product, CLI, server, and repository-facing contracts.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Related Materials

- `agent-bootstrap` is the owner's earlier personal sketch for the same problem. It is useful for repo-contract ideas such as `AGENTS.md` / `PROJECT_LOG.md`, but it is not a mature external upstream. The adjacent folder is not required for normal work: the relevant conclusions are captured in [docs/REPO_CONTRACT.md](docs/REPO_CONTRACT.md), [docs/UPSTREAM_INTEGRATION.md](docs/UPSTREAM_INTEGRATION.md), and [docs/UPSTREAM_RESEARCH_2026-05-19.md](docs/UPSTREAM_RESEARCH_2026-05-19.md).
