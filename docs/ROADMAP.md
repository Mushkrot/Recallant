# Roadmap

Recallant is pre-release. The roadmap is intentionally practical: make the agent-ready project path
dependable before expanding the product surface.

## Current

- Self-hosted CLI/server shape.
- Codex-first MCP workflow.
- Project attach/connect flow.
- Agent-ready project bootstrap with thin local files.
- Existing-project migration reports with local backups, source import counts, review-needed counts,
  and raw-secret signals.
- Documentation posture analyzer for onboarding, context packs, and Workbench review choices, with
  missing surfaces, stale handoffs, production/server hints, Recallant workflow coverage, and
  canon/capability-link needs reported as guidance.
- Protected public Workbench readiness for human review and management access.
- Remote project access to a central Recallant server / universal remote connect, with first authenticated `POST /api/mcp`, public
  `curl -fsSL https://memory.example.com/connect | bash` bootstrap, protected browser approval,
  pending connection storage, `recallant connect-cloud`, scoped remote MCP config, remote doctor,
  opt-in governed semantic marker proof, deterministic pairing/security/external-rehearsal smokes,
  remote live external canary coverage, and invite provisioning kept as the advanced/admin
  fallback.
- Remote existing-project readiness gates that keep `remote_mcp_ready`, session/context readiness,
  checkpoint state, governed semantic marker recall, guided migration approval, and redacted
  external-machine evidence as separate release surfaces.
- Smoke-backed agent lifecycle closeout gate: normal MCP/CLI closeout updates event/checkpoint
  state, creates or verifies searchable closeout memory, proves semantic recall and next-session
  context, and reports next-agent readiness only when that proof is complete.
- Clean-host dry-run, CLI-wrapper validation, rollback smoke, and opt-in Docker-backed managed
  install smoke.
- Public quickstart smoke for installed-wrapper onboarding, capture-active proof, and ask recall in
  temporary clean directories.
- Neutral non-owner migration smoke for sandbox-copy safety and reviewed imports.
- Opt-in real-project pilot smoke for one-command onboarding on sandbox copies of
  maintainer-provided paths, with original-file integrity checks and lifecycle cleanup.
- Token-confirmed project sanitization for disposable or wrongly attached projects, with dry-run DB
  counts, redacted receipts, local Recallant artifact disconnect, and no source-file deletion.
- Workbench migration review queue for imported evidence, conflicts, secret references, and stale
  handoffs.
- Security review smoke for install/auth/Workbench/backups/secrets.
- Generic public/private deployment defaults, with owner-specific server inventory, security
  baseline, backup verification, and production project paths supplied by private overlays.
- Context pack startup.
- Decision/action/test/checkpoint capture.
- Later-session recall.
- Private Workbench for review and management.
- Source, capability, and secret-reference foundations.
- Governed graph candidate storage and review lifecycle, with project-scoped candidate records,
  source refs, review history, MCP create/list/get/review tools, policy smoke coverage, and no
  implicit promotion into default retrieval.
- Workbench graph candidate review, with dashboard/API graph filters, grouped counts, node and edge
  review lanes, selected candidate source refs and review history, promotion readiness, read-only
  hygiene counts, form/API review actions, explicit Promote candidate controls for compatible
  accepted edges, browser smoke coverage, and an explicit accept-is-review-only boundary.
- Workbench graph review ergonomics, with `Graph review workload`, active `Graph review filters`,
  candidate priority and `Next graph action` cues, selected `Recommended graph decision` guidance,
  safer maintenance/topology `Open candidate detail` links, source evidence/history context,
  public-safe focused Review screenshots, no-horizontal-overflow checks, and non-intersecting
  desktop/mobile panel bounds.
- Explicit graph candidate promotion for accepted chunk-to-chunk edge candidates through
  `memory_promote_graph_candidate`, `recallant graph promote-candidate <graph-candidate-id>
  --confirm`, and Workbench `Promote candidate`, with `memory_graph_hygiene` and `recallant graph
  hygiene` for read-only readiness reporting.
- Deterministic memory keeper graph candidate generation through `recallant keeper candidates`,
  with dry-run defaults, confirm-gated candidate persistence, text/file inputs, B10
  source-selected `--from-source <project-source-id>` inputs over bounded governed Recallant
  evidence, source refs, keeper extraction metadata, unsafe-input redaction to `needs_review`, MCP
  `memory_keeper_candidates`, and retrieval-isolation smoke coverage.
- Named one-hop graph retrieval profiles on `memory_search`, with profile-specific relation
  allowlists, legacy `graph_expand` compatibility through `edge_neighborhood`, trace metadata,
  scope/source/archive guard coverage, and graph candidate isolation.
- Read-only Workbench graph topology visualization, with the `graph_candidates.topology` payload,
  exact lanes `Graph topology`, `Active promoted links`, `Candidate links`, `Blocked states`, and
  `Source-backed evidence`, empty-state copy, project isolation, public-safe labels, and
  `graph-topology:smoke` coverage.
- Public readiness and security smokes that guard the OSS-facing documentation boundary.
- Project-bound scoped content erasure for direct event, chunk, governed-memory, and artifact
  targets plus bounded search and exact scope selectors, with no-write previews, digest-bound
  confirmation, transactional dependent cleanup, content-free receipts, and an explicit boundary
  that leaves owner-controlled external files or objects untouched.

## Near Term

- One-command beginner onboarding hardening: keep rehearsing `recallant connect <project>` across
  clean hosts, real-project sandbox copies, and more client profiles, with storage readiness,
  production-sensitive confirmation, attach/connect orchestration, capture proof, recall proof,
  Workbench outcome, and cleanup in one public beginner flow.
- Visible onboarding progress after confirmation: once `recallant connect <project>` has received
  user confirmation and starts longer-running work, keep the terminal visibly alive with clear stage
  labels, bounded progress messages, and current operation status so a new user does not mistake a
  slow setup step for a hung process.
- Interactive terminal-first CLI: make plain `recallant` a guided entry point that detects the
  current directory, explains whether it is inside an attached or unattached project, and offers
  contextual actions such as onboard, check, repair, connect a client, inspect capture readiness, or
  open the Workbench. The interactive flow should use a polished modern terminal UI with structured
  panels, progress indicators, readable status graphics, and accessible fallbacks instead of a
  plain text-only command list.
- Active agent feedback reports for Recallant audits: define an explicit contract that lets agents
  working inside attached projects report Recallant-specific problems, confusing behavior, failed
  attempts, unexpected outputs, and suggested fixes back to Recallant as structured, redacted
  diagnostic messages. A dedicated audit mode should read those reports together with the existing
  system activity ledger and capture evidence, summarize what is happening across connected
  projects, identify likely Recallant product or integration gaps, and help maintainers prepare
  repair or improvement plans. This should turn agent participation from passive logging into an
  active, governed conversation channel without allowing agents to bypass review, expose secrets, or
  convert unreviewed complaints into binding instructions.
- Open Engine task handoff analysis: study Nate Jones's Open Engine as the primary process
  reference for shared task lists, portable task records, one-loop audits, receipts, and work moving
  between multiple AI tools. Translate the valuable parts into a Recallant-owned task handoff
  contract layered over context packs, governed memories, checkpoints, source refs, Workbench review,
  and system activity events, without replacing governed memory with copy-paste templates or
  expanding Recallant into a broad personal workflow OS.
- Documentation posture follow-through: expand Workbench-confirmed canonicalization plans, harden
  empty-project starter-doc generation across more real-world profiles, and broaden posture pilots
  without turning recalled discussion into binding instructions automatically.
- Governed graph next slices after the shipped candidate storage, Workbench review surface,
  explicit chunk-to-chunk promotion, read-only hygiene report, Markdown vault bridge, memory keeper
  candidate pipeline, named one-hop retrieval profiles, read-only Workbench topology visualization,
  governed graph maintenance workflows, B9 review ergonomics, B10 keeper source integration, and
  B11 active-edge endpoint expansion across chunk, event, and external references: first-class
  graph storage decisions, human-memory expansion, conceptual endpoint storage, passive vault sync,
  raw media ingestion, and automatic promotion policy decisions. Current retrieval remains limited
  to chunk-to-chunk active edges.
- Autonomous attach polish through broader real-world migration pilots across non-owner
  repositories, with attention to report clarity, review ergonomics, and safe handling of stale
  agent files.
- External-host release rehearsal beyond the disposable clean-host smokes, repeating the public
  quickstart, managed install, rollback, and security checks on a non-owner environment.
- Remote connect release hardening: run the remote live external canary before manual remote-client
  checks, then repeat real separate-machine rehearsal using universal
  `curl -fsSL https://memory.example.com/connect | bash` plus the `recallant remote-acceptance`
  redacted evidence gate or equivalent server-side trace gate. Broaden old-CLI and no-CLI bootstrap
  coverage, exercise trusted-device reconnect and headless bootstrap-token paths, and expand client
  transport polish without requiring Docker/Postgres, `RECALLANT_DATABASE_URL`, Workbench/admin auth,
  internal paths, raw artifacts, backups, provider secrets, raw scoped credentials, or private
  overlays on remote machines.
- Remote existing-project pilot hardening: repeat the shipped proof sequence on more old projects
  and clients, using read-only inventory, risk classification, owner approval, concise governed
  memories/imports, recall verification, redacted audit rows, and external-machine evidence bundles
  while keeping `memory_set_checkpoint` state-only by default, preventing checkpoint readback as semantic recall,
  and reserving searchable checkpoint memory for `memory_agent_checkpoint` / CLI `agent-checkpoint`.
- Public screenshot set with synthetic data only, generated by autonomous browser QA rather than
  owner-only manual inspection.
- Independent release hardening after the install/auth/Workbench/backups/secrets security smoke.
- Reference-backed Workbench polish for review, sources, settings, capture health, and ask/recall
  flows, using the tracked reference projects as comparison points and real migration pilots instead
  of starting from a blank custom UI.
- Deployment-profile and connector/capability guidance that stays generic in public docs while
  supporting private environments.
- Release-candidate tag once the remote live external canary, repeat external-host rehearsals,
  screenshot docs, and release packaging are complete.

## Codex For OSS Use

If selected for Codex for OSS support, Recallant will use Codex/API credits to improve:

- maintainer session closeout and memory extraction;
- context-pack generation and evaluation;
- PR/release readiness summaries;
- security review workflows;
- autonomous project bootstrap and existing-project migration;
- documentation and install hardening;
- cross-client MCP compatibility checks.

## Later

- Broader client pilot matrix.
- Universal remote-client onboarding packages, canary-backed live separate-machine rehearsal, and
  transport polish for projects that use scoped credentials against a central Recallant server from
  another machine.
- Richer source connectors.
- Better memory conflict workflows and portable retention/export policy.
- Export/import and portable instance migration polish.
- Team/multi-user design after the single-maintainer path is stable.
