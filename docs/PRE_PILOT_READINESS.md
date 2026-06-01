# Pre-Pilot Readiness

Last updated: 2026-06-01.

This was the active plan for preparing Recallant for its first real project pilot. The first copied
project pilot has now completed, and the first Phase 10 autonomous attach, controlled
cross-project recall, and cleanup slices have passed. The current product-readiness work is the
post-acceptance development plan in
[DEVELOPMENT_PLAN_2026-06-01.md](DEVELOPMENT_PLAN_2026-06-01.md).

The owner wants Recallant to be as close as practical to a finished working product before attaching it to an existing working project. Do not connect a live project as the next step. First complete this readiness plan, then run a pilot on a duplicated project copy, then decide whether to onboard a real project.

## Baseline

Already done:

- Recallant production service is deployed on the owner server.
- Human Review UI is reachable at `https://recallant.unicloud.ca` behind Cloudflare Access.
- Browser access is restricted to `highmac@gmail.com`.
- Agent/API access uses bearer token auth and local stdio MCP.
- Postgres/pgvector runs as the dedicated `recallant-postgres` Docker Compose service.
- The HTTP app runs as `recallant.service` on `127.0.0.1:3005`.
- The existing single Ollama service runs on `127.0.0.1:11434`.
- Local backup and restore verification run daily through `recallant-backup.timer`.
- The first production Review UI cleanup removed duplicate empty project rows and fixed structured setting display.

Known boundary:

- Paid APIs remain disabled.
- Remote MCP over Cloudflare is not part of the first deployment.
- External productivity connectors are future work.
- Second-server backup replication is future work because no second server is available.
- Real working projects should not be attached until this plan reaches the exit gate.

## Goal

Make Recallant safe and useful enough that an existing project with older manually maintained agent memory can be copied into a sandbox, discovered, imported through explicit reviewable paths, exercised through MCP, and detached without polluting real project work.

## Workstream R0 - Documentation And Handoff Readiness

Status: complete for this checkpoint.

Deliverables:

- Create this `Pre-Pilot Readiness` plan as the current next implementation plan.
- Update the documentation reading order so future agents see this plan before starting new work.
- Create a current handoff file that tells the next session exactly where to resume.
- Archive obsolete handoff material that should not remain in the normal reading path.
- Remove or correct stale "Phase 0 only" status language.

Gate:

- `docs/README.md`, `docs/WORKING_CONTEXT.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/TASK_GRAPH.md`, `docs/AGENT_IMPLEMENTATION_GUIDE.md`, and `docs/TEST_CONTRACT.md` point to this plan or reflect the current state.
- `git status --short --branch` is clean after commit and push.

## Workstream R1 - Existing Project Discovery And Preflight

Status: complete for the first pre-pilot checkpoint.

Purpose:

Recallant must inspect an existing project safely before writing anything. Many existing projects already have manually maintained agent memory files; discovery must classify them without trusting stale text as active behavior.

Implement or harden:

- `recallant discover --project-dir <path>` and related preflight output for existing projects.
- Detection of common manual memory and handoff surfaces:
  - `AGENTS.md`
  - `PROJECT_LOG.md`
  - `.cursor/SESSION_HANDOFF.md`
  - `CLAUDE.md`
  - `README.md`
  - project docs and runbooks selected by policy
  - `.env.example` and other secret-reference examples without values
- Classification of findings into:
  - repo contract
  - startup instruction
  - handoff checkpoint
  - import source
  - environment fact
  - secret reference names only
  - capability binding
  - connector/account binding
  - possible conflict
  - possible duplicate
  - stale history
  - oversized context risk
- Human-readable summary plus machine-readable JSON output.
- Clear planned changes section showing that discovery is read-only.
- Context-budget warnings for agent files that have become history dumps.
- Secret handling that records variable names or references only, never raw secret values.

Gate:

- A dry-run discovery on a fixture project writes nothing and reports candidates with source paths, result classes, provisional scope/audience, risk, and import suggestions.
- A fixture containing duplicated old logs or secrets is reported as risky without leaking secret values.

Implemented checkpoint:

- `recallant discover --project-dir <path>` now emits a read-only preflight JSON report by default and a human summary with `--format text`.
- Discovery scans common manual memory surfaces, selected runbook/doc surfaces, and root secret-reference example files.
- Findings include source refs, hashes, result classes, provisional scope/audience, bounded redacted excerpts, risk flags, context-budget warnings, and explicit import suggestions.
- Secret-like values are redacted from discovery/import preview output; `.env.example` and related files expose variable names/status only.
- `recallant import --dry-run <path>` reuses the discovery candidate model so R2 can add confirmed writes without changing preview semantics.
- `npm run prepilot:smoke:discovery` covers the fixture project gate.

## Workstream R2 - Durable Explicit Import

Status: complete for the first pre-pilot checkpoint.

Purpose:

`recallant import --dry-run` already previews, but pre-pilot readiness requires a safe write path for explicitly selected material. Import must create evidence and candidates, not silent binding rules.

Implement or harden:

- `recallant import ... --dry-run` with complete preview output.
- Confirmed import write mode for explicitly selected sources.
- `import_batch` event records with source refs and content hashes.
- Raw evidence/chunk creation for selected material.
- Candidate governed memories for possible decisions, rules, lessons, failures, and open questions.
- Checkpoint seeds only when the selected source is intended as current handoff.
- Environment facts, secret references, capability bindings, and connector/account bindings with high-risk review handling.
- Repeat-import deduplication based on source path, content hash, project, and result class.
- No automatic `instruction_grade` promotion.
- No universal all-agent instruction from client-specific files such as `CLAUDE.md` unless explicitly reviewed/promoted.

Gate:

- Confirmed import writes durable records for a fixture project.
- Re-running the same import is idempotent.
- Imported candidates appear in Review UI/API with source refs.
- Secret fixtures store names/references only.
- Broad or high-risk candidates require review.

Implemented checkpoint:

- `recallant import <path> --project-dir <path>` now requires `RECALLANT_DATABASE_URL` and writes through a dedicated DB transaction.
- Confirmed import creates an `import_batch` event, raw artifact pointer, scoped searchable chunks, embeddings when the active route supports them, and one source-linked governed memory candidate.
- Import deduplication is based on project, source path, content hash, and result classes.
- Imported governed memories are `candidate` or `needs_review`; they never become `instruction_grade` without review promotion.
- Secret-reference imports store variable names/status only and use redacted text for chunks, source quotes, and output.
- `npm run prepilot:smoke:import` covers confirmed import, duplicate re-run, source refs, chunks, raw artifact pointer, no secret leakage, and reviewable candidate policy.

## Workstream R3 - Review UI Import And Action Readiness

Status: complete for the first pre-pilot checkpoint.

Purpose:

Before a real pilot, the owner should be able to inspect imported candidates and resolve obvious issues from the private UI without writing SQL or using one-off scripts.

Implement or harden:

- Import candidate lane or filter in Review Inbox.
- Selected-item detail panel with source path, bounded quote, hash/provenance, status, use policy, scope, audience, confidence, and review history.
- Visible distinction between accepted rules, ordinary recallable memories, candidates, stale records, duplicates, conflicts, and imported evidence.
- Actions for accept, reject, promote instruction, demote instruction, archive, unarchive, mark stale, edit, merge, and supersede where the backend policy path already supports them.
- Duplicate/conflict views good enough for imported project memory.
- Cleanup/forget entrypoint with dry-run and explicit confirmation for permanent erasure.
- Cost / Paid API view remains visible and confirms that paid API mode is disabled or `confirm_each`.
- Minimal management chat readiness for read-only memory questions and action proposals. Destructive, cost, security, global-scope, connector/account, and public-exposure actions must still require explicit confirmation through deterministic policy.

Gate:

- Review UI smoke covers imported candidate listing, detail/source display, at least one normal review action, and confirmation rejection for a dangerous action.

Implemented checkpoint:

- Review dashboard/API now exposes `import_candidates`, `selected_detail`, `duplicate_conflicts`, and `available_review_actions`.
- The private Review UI shows an Import Candidates lane, selected memory detail with source refs/review history/provenance/status/use policy/scope/audience/confidence, a conflicts/duplicates lane, and a cleanup/forget confirmation entrypoint.
- Imported candidates created by confirmed import appear in the dashboard/API with source refs and remain reviewable before any instruction-grade promotion.
- Existing `/api/review-action` continues to route accept/reject/promote/demote/archive/stale/edit/merge/supersede actions through the same DB policy path.
- `npm run review-ui:smoke` now creates an import candidate through the DB import path and verifies import listing, selected detail/source display, conflict lane, a normal review action, dangerous setting confirmation rejection, and auth/Cloudflare readiness.
- Follow-up management UI/chat slice: the Review Command Center now includes a functional
  natural-language management chat API/form, Russian-language answer coverage, confirmation-gated
  destructive cleanup proposals, a plain-language attention summary, project action guidance, and
  human-readable setting summaries.

## Workstream R4 - Pilot Sandbox Workflow

Status: complete for the first pre-pilot checkpoint.

Purpose:

The first pilot should use a copy of an existing project, not the original working project.

Implement or document:

- A repeatable operator workflow for duplicating one existing project into a pilot sandbox path.
- Recommended sandbox root, for example `/ai/recallant-pilots/<project-name>`, unless the owner chooses another path.
- `recallant discover --project-dir <sandbox>` preflight.
- Explicit import dry-run and confirmed import of selected sources.
- MCP startup smoke:
  - `memory_start_session`
  - `memory_get_context_pack`
  - one small append/search/recall path
  - `memory_closeout`
- Rollback/detach procedure for pilot data that does not affect the original project.
- A short pilot report template: what was imported, what was rejected, what the context pack contained, what the agent missed, and what needs fixing.

Gate:

- A fixture or local sandbox pilot can complete the workflow without touching a real working project.

Implemented checkpoint:

- [PILOT_SANDBOX_WORKFLOW.md](PILOT_SANDBOX_WORKFLOW.md) documents the copied-project pilot workflow, recommended sandbox root, detach/rollback notes, and pilot report template.
- `npm run prepilot:smoke:sandbox` copies the fixture project into a temporary sandbox, runs discovery, import dry-run, confirmed import, MCP `memory_start_session`, `memory_get_context_pack`, append/search/recall, closeout, and DB verification.
- The sandbox smoke verifies the original fixture project is not modified.

## Workstream R5 - Agent Onboarding Contract

Status: complete for the first pre-pilot checkpoint.

Purpose:

Agents must know how to use Recallant consistently once a project is connected.

Implement or harden:

- Thin `AGENTS.md` Memory section generated by `recallant init` for Codex.
- Startup contract:
  - read project instructions
  - call `memory_start_session`
  - call `memory_get_context_pack`
  - work normally
  - write meaningful events/memories/checkpoints
  - call `memory_closeout` on closeout or pause
- Clear examples for existing-project onboarding versus new-project onboarding.
- `recallant lint-context` checks for duplicated memory dumps in generated project files.
- Operator docs that explain which files should be committed to the project and which `.recallant` pointer files stay local/ignored.

Gate:

- A new sandbox project can be initialized and opened by a new agent without requiring chat history.

Implemented checkpoint:

- [AGENT_ONBOARDING_CONTRACT.md](AGENT_ONBOARDING_CONTRACT.md) documents the startup contract, existing-project onboarding, new-project onboarding, file ownership, and context lint expectations.
- `recallant init --target codex` now generates a thin Memory section that references real MCP tools: `memory_start_session`, `memory_get_context_pack`, `memory_append_event`, `memory_create_agent_memory`, `memory_set_checkpoint`, and `memory_closeout`.
- The generated Memory section no longer references the nonexistent `memory_promote` tool.
- `npm run phase7:smoke` checks the generated onboarding contract and confirms fresh init/lint/context still work without chat history.

## Workstream R6 - Operational Readiness Check

Status: complete for the first pre-pilot checkpoint.

Purpose:

Before attaching a real project, the server should prove that the current deployment and recovery path are healthy.

Check:

- `recallant doctor` with production env.
- Local stdio MCP smoke with production env.
- Review UI public access through Cloudflare Access.
- Unauthenticated public request redirects to Cloudflare Access.
- Origin remains bound to localhost.
- `recallant-backup.timer` is enabled.
- Latest backup manifest verifies.
- No duplicate project rows for `/ai/recallant`.
- No paid API calls or pending paid API approvals unless explicitly created by a test and cleaned up.

Gate:

- Operational checks are documented in `docs/IMPLEMENTATION_STATUS.md` or a dated run note.

Recovery checkpoint:

- On 2026-05-28, `https://recallant.unicloud.ca` returned Cloudflare `502` because the
  production Postgres container was absent and `127.0.0.1:15432` refused connections. The HTTP
  service crashed on the first DB-backed Review UI request, then systemd restarted it.
- Production Postgres was restored with `make prod-db-up`; `recallant-postgres` returned healthy
  on `127.0.0.1:15432`, the HTTP service remained active on `127.0.0.1:3005`, local `/health`
  returned `200`, unauthenticated `/review` returned `401`, and public unauthenticated
  `https://recallant.unicloud.ca/` returned a Cloudflare Access `302`.
- Post-recovery DB checks found one `/ai/recallant` project row, zero pending paid API approvals,
  zero paid-provider model calls in the last 30 days, and a current `latest-manifest.json` backup
  pointer from 2026-05-28.
- The owner refreshed the real browser session after recovery and confirmed the authenticated
  Cloudflare Access path loads the Recallant Review Command Center for project `84eda3bf`.
- Production `recallant doctor`, local stdio MCP smoke, and backup restore verification passed with
  production env. `backup-verify` now supports the `latest-manifest.json` symlink directly.
- Root cause prevention: dev database Make targets now use an explicit `recallant-dev` Docker
  Compose project name so `make db-down` and `make db-reset` cannot remove the production
  `recallant-postgres` container managed by the production compose target.

## First Copied-Project Pilot - GutenDocx

Status: complete for the first real-project sandbox checkpoint.

Run note:

- Report: [PILOT_REPORT_GUTENDOCX_2026-05-28.md](PILOT_REPORT_GUTENDOCX_2026-05-28.md)
- Sandbox copy: `/ai/recallant-pilots/gutendocx-20260528T161238Z`
- Sandbox project id: `29bc4ee3-cac8-4c3f-9634-ef47d0401ae9`
- Imported sources: `.cursor/SESSION_HANDOFF.md`, `AGENTS.md`, `Docs/README.md`,
  `PROJECT_LOG.md`, and `README.md`
- Review result: all five imports are `needs_review` / `evidence_only`; no instruction-grade
  promotion occurred.
- MCP result: session startup, context pack, append, search, recall, and closeout completed against
  the sandbox project.
- Safety result: original `/ai/gutendocx` remained untouched except for its pre-existing
  `config.yaml` runtime diff; no `.recallant` or spool directory was created in the original.
- Production result: GutenDocx and Recallant health checks passed after the pilot.

Follow-ups before attaching a live project:

- Add a safe way to inspect non-current projects in the Review UI, such as a project selector or a
  localhost-only sandbox UI runbook. First project-row selection is now available in the Review UI;
  keep improving it toward a human-first management surface.
- Keep the production local embedding route healthy. Follow-up on 2026-05-28 installed
  `nomic-embed-text`, implemented the Ollama embedding adapter, and verified
  `memory_search mode=vector_only` on the GutenDocx sandbox.
- Governed project-level detach is now available through `recallant detach` / `recallant
  project-detach`; copied-project cleanup no longer requires manual SQL for Recallant-side hiding
  and sandbox retrieval archiving.
- Autonomous project attach modes (`manual`, `guided`, `autopilot`) and controlled
  cross-project recall now have first implementation slices before broad live-project onboarding. See
  [AUTONOMOUS_ATTACH.md](AUTONOMOUS_ATTACH.md) and
  [CROSS_PROJECT_RECALL.md](CROSS_PROJECT_RECALL.md).

## Exit Gate

Pre-Pilot Readiness is complete when all of the following are true:

- Existing-project discovery is safe, useful, and read-only by default.
- Explicit import can write durable source-linked records without silent instruction promotion.
- Imported candidates can be reviewed from UI/API.
- A sandbox copy of a project can be initialized, discovered, imported, exercised through MCP, closed out, and detached.
- Backup/restore verification and production health checks pass.
- Documentation tells the next agent exactly how to run the first pilot.
- The repo is committed, pushed, and clean.

Only after this exit gate should Recallant be connected to an existing real working project.

The first copied-project pilot has now completed, and the first Phase 10 autonomous attach,
controlled cross-project recall, and cleanup slices have passed. The current product-readiness work
is post-acceptance product development: a clearer human workbench, stronger AI-native management,
client connection/capture proof, and broader memory-space/source support, with manual/guided modes
preserved for cautious operation.

## Explicitly Postponed Until After First Pilot

These are not part of Pre-Pilot Readiness unless the owner explicitly changes scope:

- Bulk Gmail/Drive/Calendar/GitHub/browser/screenshot connectors.
- Paid API enablement or `auto_with_caps`.
- Remote MCP over Cloudflare.
- Second-server backup replication.
- Public packaging, Journey kit distribution, or SaaS/multi-user expansion.
- Full Memory Tree/graph workbench.
- Broad analytics dashboards beyond operational safety and paid API visibility.
- Arbitrary whole-repo or whole-git-history imports.
