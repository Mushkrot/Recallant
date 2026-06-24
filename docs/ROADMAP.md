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
  and invite provisioning kept as the advanced/admin fallback.
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
- Public docs cleanup for OSS review.

## Near Term

- One-command beginner onboarding hardening: keep rehearsing `recallant onboard <project>` across
  clean hosts, real-project sandbox copies, and more client profiles, with storage readiness,
  production-sensitive confirmation, attach/connect orchestration, capture proof, recall proof,
  Workbench outcome, and cleanup in one public beginner flow.
- Visible onboarding progress after confirmation: once `recallant onboard <project>` has received
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
- Documentation posture follow-through: expand Workbench-confirmed canonicalization plans, harden
  empty-project starter-doc generation across more real-world profiles, and broaden posture pilots
  without turning recalled discussion into binding instructions automatically.
- Autonomous attach polish through broader real-world migration pilots across non-owner
  repositories, with attention to report clarity, review ergonomics, and safe handling of stale
  agent files.
- External-host release rehearsal beyond the disposable clean-host smokes, repeating the public
  quickstart, managed install, rollback, and security checks on a non-owner environment.
- Remote connect release hardening: repeat real separate-machine rehearsal using universal
  `curl -fsSL https://memory.example.com/connect | bash` plus the `recallant remote-acceptance`
  redacted evidence gate, broaden old-CLI and no-CLI bootstrap coverage, exercise trusted-device
  reconnect and headless bootstrap-token paths, and expand client transport polish without requiring
  Docker/Postgres, `RECALLANT_DATABASE_URL`, Workbench/admin auth, internal paths, raw artifacts,
  backups, provider secrets, raw scoped credentials, or private overlays on remote machines.
- Remote existing-project diagnostics polish: make remote `connect`, local `doctor`, and agent
  startup consistently distinguish `remote_mcp_ready`, checkpoint readback, and governed
  semantic-memory recall; keep successful remote connect output pointed at context packs and
  semantic marker proof; explain when local `attach --confirm` is the wrong next step for a remote
  project; improve MCP tool schema hints for required `title`, `body`, and object-shaped
  `audience`; and report raw-secret findings as paths/classes without implying that secret values
  should be imported.
- Checkpoint parity: keep MCP `memory_set_checkpoint` state-only by default and use the explicit
  high-level `memory_agent_checkpoint` / CLI `agent-checkpoint` path for searchable checkpoint
  memory; make the Workbench, doctor, context packs, and docs use the same terms so operators do not
  treat checkpoint readback as semantic recall.
- Guided existing-project context migration: after remote semantic proof, provide a review-first flow
  that inventories docs and risky paths, proposes `summarize_to_memory`, `keep_as_reference`, `skip`,
  or `ask_owner`, then writes concise governed memories only after approval. The inventory must
  distinguish safe sources, useful docs, historical handoffs, large archives/logs, raw artifacts,
  backups, credential-bearing files, customer data, private keys, and environment/config risk while
  printing secret references by name only. Remote-only projects use governed MCP memory creation
  without local Postgres; server-local projects reuse `importSource` review semantics. Recall proof
  and checkpoint update remain separate acceptance steps.
- Public screenshot set with synthetic data only, generated by autonomous browser QA rather than
  owner-only manual inspection.
- Independent release hardening after the install/auth/Workbench/backups/secrets security smoke.
- Reference-backed Workbench polish for review, sources, settings, capture health, and ask/recall
  flows, using the tracked reference projects as comparison points and real migration pilots instead
  of starting from a blank custom UI.
- Deployment-profile and connector/capability guidance that stays generic in public docs while
  supporting private environments.
- Release-candidate tag once repeat external-host rehearsals, screenshot docs, and release packaging
  are complete.

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
- Universal remote-client onboarding packages, live separate-machine rehearsal, and transport
  polish for projects that use scoped credentials against a central Recallant server from another
  machine.
- Richer source connectors.
- Better memory conflict workflows and portable retention/export policy.
- Export/import and portable instance migration polish.
- Team/multi-user design after the single-maintainer path is stable.
