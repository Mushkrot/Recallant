# Phase 10 owner decisions - 2026-05-28

This file records owner-confirmed product decisions for Phase 10 before implementation.

## Attach defaults and modes

- Default attach mode is `autopilot` for ordinary projects.
- First implementation includes all three modes: `manual`, `guided`, and `autopilot`.
- `manual` is the cautious explicit workflow.
- `guided` builds a plan and waits for confirmation.
- `autopilot` executes safe steps, sends risky findings to Review, and reports.
- Existing project files are safe-imported by default: safe parts are imported as evidence or ordinary
  memories; risky parts go to Review.
- Autopilot may update `.recallant/config`, `AGENTS.md`, `PROJECT_LOG.md`, `.gitignore`, and local
  MCP/config hints according to policy.
- If a project is already attached, attach is idempotent and must not create a new `project_id`.

## Existing project migration

- Attach must analyze all agent startup/config/handoff files, not only `AGENTS.md` and
  `PROJECT_LOG.md`.
- `AGENTS.md` remains the main agent entrypoint. It should become a router to Recallant, while
  important project rules are preserved.
- `PROJECT_LOG.md` remains mandatory as a compact agent-readable fallback/checkpoint.
- Recallant is the main source of truth; local startup files should not remain long memory stores.
- Old archives and handoff files import as historical evidence-only by default and are not startup
  reads.
- Autopilot can create ordinary structured memories and project-local decisions from imported
  material when confidence is high and source refs exist.
- Candidate rules, broad/global/developer scope, security/deploy/destructive/paid API,
  connector/account/capability bindings, low-confidence conclusions, and conflicts go to Review.

## Agent-file backups and cleanup

- Before changing existing agent files, attach creates a local backup.
- Backup includes all discovered agent files, not only changed files.
- Backup path is `.recallant/backups/attach-<timestamp>/`.
- Backup is local/gitignored and is not imported into Recallant as raw memory.
- If a file contains raw secrets, backup must be redacted too.
- After backup, autopilot may normalize startup files when confidence is high.
- It may replace old local-history startup flows with Recallant startup flow and shrink history or
  handoff sections.
- It must not silently remove important project rules or perform irreversible cleanup.

## Secrets and examples

- Recallant stores secret references and capability maps, not raw secrets.
- `.env.example` and similar files may be imported as variable names/purpose only.
- Live project raw secret findings create warnings/review/cleanup plans and do not modify source
  files automatically.
- Sandbox/test raw secret findings may be masked automatically after redacted backup when policy
  permits.

## Production-sensitive projects

- Production sensitivity is detected by explicit flags/settings and automatic hints.
- Hints include production docs, deploy configs, systemd, production compose, public domains,
  billing, real env refs, Cloudflare/DNS/security/deploy references, and public service hints.
- If production-sensitive and requested mode is `autopilot`, attach switches to `guided`.
- `--production-approved` permits production-safe autopilot only.
- Production-safe autopilot still cannot silently perform raw-secret handling, destructive actions,
  service restarts, firewall/security/public exposure/deploy changes, paid API enablement, erasure,
  or active connector/capability binding.

## Reports and ready state

- Default attach report is very short: ready status, what was done, what needs attention, how to
  check, and next step.
- Detailed technical report can exist separately.
- Done means project bootstrap is ready, safe memory is imported, context pack works, MCP smoke runs
  when possible, and Review UI/API shows the project, imported items, pending review, and
  detach/cleanup entrypoint.

## Detach and forget

- Live project detach defaults to hide/archive in Recallant and does not touch files or physically
  delete records.
- Sandbox/test cleanup can remove Recallant records and offer removal of local Recallant artifacts
  after dry-run and confirmation.
- Sensitive/wrong memory uses separate `forget forever`, not ordinary detach.

## Cross-project recall

- Default cross-project recall posture is narrow.
- Agents may initiate explicit cross-project recall when the task clearly needs a prior pattern.
- Cross-project results are source-linked examples/evidence unless already applicable by
  scope/status/use policy.
- If a pattern from another project is actually applied, the agent creates current-project memory
  with source refs.
- Unrelated project memory is not added to ordinary context packs by default.

## Phase 10 implementation order

1. Implement `recallant attach --mode manual|guided|autopilot`.
2. Implement governed detach/cleanup.
3. Implement controlled cross-project recall.

## Documentation-before-code decision

Before Phase 10 implementation, these decisions must be reflected in docs, ADRs, and
`TEST_CONTRACT.md`.
