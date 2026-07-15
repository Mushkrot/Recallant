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

Recallant is pre-release, but the first installed-host coding-agent memory loop is working:
onboard a project, prove capture, close out through the lifecycle readiness gate, and get a
private Workbench review link.

For a local self-host evaluation, first install Recallant on the machine that will run the local
storage stack:

```bash
curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
```

Then connect a project from anywhere:

```bash
recallant connect /path/to/project
```

After install or update, the CLI should report the CLI package version plus checkout metadata:

```bash
recallant --version
# recallant 0.1.0-dev.0+<git-sha>
```

The root monorepo package version is not the installed CLI version.

The same `recallant connect` command is the beginner entry point for local self-host projects and
projects that should connect to an existing central Recallant server. With reachable local storage it
runs local onboarding. Without local storage, it asks for an existing central server URL or local
storage setup before changing project files.

Local onboarding defaults to the beginner Codex path: project attach, local client connection, optional
hooks, capture proof, recall proof, and the Workbench outcome. If storage is missing in an
interactive terminal, it offers to run the local single-user storage setup first; in automation it
stops with `storage_blocked` and a plain setup choice. `Database not configured` is not a successful
onboarding state. If the project looks production-sensitive, onboarding shows the planned writes,
backup behavior, import/review behavior, and an interactive continue/cancel prompt before changing
files.

The important state is not just "installed" or "configured". Recallant uses one public readiness
contract:

> Configuration proves access. Proof proves memory. Capture-active proves Recallant is doing its job.

Status is intentionally split:

- `configured`: client/MCP access exists, but memory is not proven yet.
- `context_ready`: an agent read the startup Context Pack.
- `semantic_memory_ready`: a safe governed memory marker or agent-authored memory was created and
  recalled.
- `capture active`: Recallant has observed context reads, memory writes, checkpoints, and semantic
  proof for the project.
- `ingestion_approved`: the owner separately approved import or summarization of existing project
  files/history.

The success output also includes a private Workbench link showing last context read, last memory
write, last semantic proof, last checkpoint, and review-state counts.

Lower-level CLI commands such as attach, connect, doctor, project-sanitize, agent capture, demo
capture, and ask remain available for maintainers and automation. They are advanced/debug APIs, not
the normal beginner path. See [Client setup](docs/CLIENT_SETUP.md).

Remote project access to an existing central Recallant server is a separate path. `remote_mcp_ready`
maps to `configured`: scoped access exists, but memory is not proven by access alone.
The remote connect path prepares scoped remote MCP access plus missing-only thin agent-ready files
(`README.md`, `AGENTS.md`, and `PROJECT_LOG.md`) without installing local storage. Existing logs
stay untouched unless an owner explicitly opts into managed-block synchronization.
`recallant remote-doctor --semantic-proof` creates and recalls one safe governed marker; the server
persists readiness evidence, and a later `recallant agent-start` reads that evidence through the
bounded readiness status. Checkpoint-only readback and capture-proof do not imply
`semantic_memory_ready`, and semantic proof does not imply `capture_active` without the full capture
loop; see [Client setup](docs/CLIENT_SETUP.md#remote-project-access).

## Product Shape

Recallant runs as a local or self-hosted memory service:

- CLI for install, attach, connect, doctor, capture proof, project sanitization, and cleanup.
- MCP server for agent clients.
- Postgres/pgvector-backed storage.
- Private Workbench UI for review, rules, source context, settings, and management chat.
- System activity ledger for owner-readable audit reports across CLI, MCP, Workbench HTTP, capture,
  model, and cleanup paths.
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
- [Remote MCP contract](docs/MCP_SPEC.md): authenticated `POST /api/mcp` endpoint contract for
  scoped remote agent clients.
- [Roadmap](docs/ROADMAP.md): pre-release status and next milestones.
- [Contributing](CONTRIBUTING.md): how to work on the project.

## Status

Recallant is **pre-release**. It is suitable for local evaluation and development, not for
unreviewed team-wide production rollout.

Current strengths:

- first end-to-end coding-agent memory loop;
- smoke-backed lifecycle closeout gate: `agent-lifecycle-gate:smoke`, `agent-capture:smoke`, and
  `product-acceptance:smoke` prove `agent-closeout` / `memory_closeout` only report
  next-agent readiness after event, checkpoint, accepted closeout memory, semantic recall, and
  next-session context proof;
- project-binding regression coverage for session-derived context/closeout writes, config-derived
  CLI writes, `project_dir` compatibility aliasing, and duplicate path ambiguity handling;
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
- redacted system activity audit reports in the CLI and Workbench;
- installed CLI version reporting with git build metadata and smoke coverage that rejects
  `recallant 0.0.0`;
- explicit security and cost governance design;
- public/private boundary guards across docs and runtime/install defaults;
- smoke coverage for the core capture/recall path.

Known pre-release work:

- external-host release rehearsal beyond the disposable clean-host smokes;
- remote project access release hardening: authenticated `/api/mcp`, scoped credentials,
  provisioning output, universal connect, stdio-to-HTTPS bridge, remote diagnostics, security
  matrix, deterministic isolated external-client rehearsal, and canary coverage exist, but repeat
  external-host rehearsals with operator-provided live credentials and broader client transport
  pilots are still unfinished;
- more public screenshots and docs polish;
- broader client pilot matrix;
- broader real-world existing-project migration pilots;
- independent release hardening;
- packaging and versioned release tags.

## License

Apache License 2.0. See [LICENSE](LICENSE).
