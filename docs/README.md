# Recallant Documentation

Start with the product path that matches what you are trying to do. Current behavior, setup, and
operating contracts come first. Design comparisons and source research are kept separately.

## Evaluate Recallant

- [Quickstart](QUICKSTART.md): install Recallant and prove one project can remember.
- [Current status](STATUS.md): what works now and why the project remains a development prerelease.
- [Product contract status](CONTRACT_STATUS.md): shipped slices, evidence, and remaining release work.
- [v0.1.0-dev.0 release notes](releases/v0.1.0-dev.0.md): pinned install, verification, limits, and rollback.
- [Why Recallant](WHY_RECALLANT.md): the problem, trust model, and community value.

## Use Recallant

- [Agent-ready projects](AGENT_READY_PROJECTS.md): onboarding, thin project files, source references,
  and safety gates.
- [Client setup](CLIENT_SETUP.md): Codex, Claude Code, Cursor, Windsurf, and generic MCP clients.
- [Workbench UI](WORKBENCH_UI.md): Home, Ask & Search, Review, Sources, Activity, and controls.
- [Agent observability](AGENT_OBSERVABILITY.md): run replay, recovery chains, capture coverage,
  retention, and removal.

## Operate Recallant

- [Self-hosting](SELF_HOSTING.md): installation profiles, verification, rollback, and private defaults.
- [Operations runbook](RUNBOOK.md): routine health, deployment, backup, incidents, and recovery.
- [Security](SECURITY.md): threat model and safe defaults.
- [Remote MCP contract](MCP_SPEC.md): authenticated scoped access through `POST /api/mcp`.

## Understand and Contribute

- [Architecture](ARCHITECTURE.md): system overview, data flow, governance, and deployment shape.
- [Domain language](../CONTEXT.md): canonical terms for project memory, cross-client continuity,
  document memory, and task handoff.
- [Governed graph tree contract](GRAPH_TREE_CONTRACT.md): review-first relation vocabulary and
  retrieval behavior.
- [Roadmap](ROADMAP.md): current priorities and later milestones.
- [Contributing](../CONTRIBUTING.md): development workflow and checks.

## Secondary Research

- [Comparison](COMPARISON.md): a concise product-level comparison with related approaches.
- [Research notes](research/README.md): deeper project surveys and design-source analysis. These
  notes preserve context and do not define shipped behavior.

## Documentation Boundary

Private stage plans, internal handoffs, deployment topology, owner-specific paths, and historical
scratch work do not belong in this public repository. Public behavior must remain understandable
from the files above without private project memory.
