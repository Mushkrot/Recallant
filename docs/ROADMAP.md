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
- Clean-host dry-run, CLI-wrapper validation, and opt-in Docker-backed managed install smoke.
- Neutral non-owner migration smoke for sandbox-copy safety and reviewed imports.
- Workbench migration review queue for imported evidence, conflicts, secret references, and stale
  handoffs.
- Context pack startup.
- Decision/action/test/checkpoint capture.
- Later-session recall.
- Private Workbench for review and management.
- Source, capability, and secret-reference foundations.
- Public docs cleanup for OSS review.

## Near Term

- Autonomous attach polish through broader real-world migration pilots across non-owner
  repositories, with attention to report clarity, review ergonomics, and safe handling of stale
  agent files.
- Clean-host install and rollback validation on an independent non-owner environment.
- Public screenshot set with synthetic data only.
- Security review of install, auth, Workbench, backups, and secret handling.
- Reference-backed Workbench polish for review, sources, settings, capture health, and ask/recall
  flows, using the tracked reference projects as comparison points and real migration pilots instead
  of starting from a blank custom UI.
- Deployment-profile and connector/capability guidance that stays generic in public docs while
  supporting private environments.
- Release-candidate tag once the public quickstart is verified end to end.

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
- Richer source connectors.
- Better memory cleanup and conflict workflows.
- Export/import and portable instance migration polish.
- Team/multi-user design after the single-maintainer path is stable.
