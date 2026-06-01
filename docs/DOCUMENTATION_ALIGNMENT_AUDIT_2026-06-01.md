# Documentation Alignment Audit - 2026-06-01

This audit records the documentation-only cleanup after the owner asked to
reconcile the full project discussion with the current architecture documents.

No implementation code was changed for this audit.

## Evidence Reviewed

- Current conversation decisions through 2026-06-01.
- `PROJECT_LOG.md`
- Core docs: `README.md`, `docs/README.md`, `docs/WORKING_CONTEXT.md`,
  `docs/SESSION_HANDOFF_CURRENT.md`, `docs/IMPLEMENTATION_STATUS.md`,
  `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/OPERATING_PRINCIPLES.md`,
  `docs/GLOSSARY.md`, `docs/DATA_MODEL.md`, and `docs/TASK_GRAPH.md`.
- Workflow docs: `docs/AUTONOMOUS_ATTACH.md`, `docs/IMPORT_POLICY.md`,
  `docs/QUICKSTART.md`, `docs/CLIENT_SETUP.md`,
  `docs/PRODUCT_ACCEPTANCE_TEST.md`, and `docs/TEST_CONTRACT.md`.
- Architecture decision records, especially ADR-0004, ADR-0007, ADR-0008,
  ADR-0025, ADR-0033, ADR-0042, ADR-0043, ADR-0044, and ADR-0045.
- Upstream docs:
  `docs/UPSTREAM_RESEARCH_2026-05-19.md`,
  `docs/UPSTREAM_IMPLEMENTATION_REVIEW_2026-05-22.md`,
  `docs/UPSTREAM_INTEGRATION.md`, and
  `docs/UPSTREAM_AGENTMEMORY_REVIEW_2026-06-01.md`.
- Current verification evidence from npm scripts and status docs, including
  `TEST_CONTRACT.md` green status and the smoke command inventory in
  `package.json`.

## Confirmed Current Product Frame

Recallant is a governed external-memory platform for the owner and AI agents.

Coding-agent memory remains the first implemented and tested domain. It is not
the final product boundary. The broader product direction is human external
memory accessed through agents.

A Recallant project is a logical memory space. It is not necessarily a folder.
A folder, repository, server path, document set, connector, or virtual/manual
source can be attached to that memory space.

The UI must speak professional human language by default. Technical field names,
raw JSON, route classes, provider ids, and internal schema values belong in
collapsed technical details, API/log output, or advanced/debug views.

Recallant should use AI for semantic work: understanding owner requests,
classifying memory spaces and sources, extracting memories, explaining
conflicts, proposing cleanup, and answering humans/agents in natural language.
Deterministic policy remains authoritative for auth, storage, confirmation
gates, secrets, paid API, public exposure, production operations, audit, and
destructive actions.

## What Was Stale

The main stale pattern was not architecture, but status wording.

Several docs still described Phase 10 as the next work even though the first
Phase 10 attach/detach/cross-project slices and the Product Acceptance loop are
now green for the first production-ready slice.

That means:

- the documentation was stale where it said Phase 10 still needed to be
  implemented before broad next steps;
- the implementation was not wrong for having completed the first Phase 10
  slice;
- the next plan should move to post-acceptance product development: human
  workbench quality, AI-native management behavior, source bindings, client
  connect/hooks, pilots, and broader memory-space support.

## What Remains Specification, Not Stale

Some items are intentionally still future scope or safety constraints:

- Full passive personal-life capture is not v1.
- Gmail/Drive/Calendar/GitHub/browser/screenshot connectors remain future
  explicit connector work.
- Object storage, dedicated vector DBs, and graph DBs remain future evolution
  paths.
- Production-sensitive projects still require guided/confirmed workflows.
- Paid API use still requires confirmation by default.
- Ordinary detach is not permanent erasure; sensitive/wrong memory uses
  separate forget-forever workflows.
- AI suggestions do not bypass server-side policy.

These are not stale simply because the owner wants broader long-term Recallant
scope. They are the current boundary between the working coding-agent core and
future expansion.

## Documentation Changes Made

- Added [ADR-0045](ADR-0045-human-centered-memory-and-workbench.md) to make the
  human-centered product frame explicit.
- Added [HUMAN_MEMORY_AND_UI_DIRECTION.md](HUMAN_MEMORY_AND_UI_DIRECTION.md) to
  translate the owner-facing UI/product direction into plain implementation
  guidance.
- Added [DEVELOPMENT_PLAN_2026-06-01.md](DEVELOPMENT_PLAN_2026-06-01.md) as the
  next development plan after the green acceptance surface.
- Updated canonical docs so "project" means memory space, not only folder.
- Added target `project_sources` direction to the data model.
- Updated status/planning docs so Phase 10 first slice is no longer described
  as future work.
- Updated upstream synthesis so OB1, MF0, AgentMemory, MemPalace, and Journey
  each have a clear UI/product role.
- Updated model-routing language so AI-native management interpretation can use
  local models by default and external paid/model-router routes only through
  explicit policy, cost, privacy, and audit controls.

## Current Clean Position

The current repository documentation now distinguishes three layers:

1. **Implemented first production-ready slice:** v1 coding-agent memory core,
   Product Acceptance smoke, Phase 10 attach/detach/cross-project first slices,
   private Review/Management UI, local model route, backups, and owner-server
   deployment.
2. **Accepted product direction:** human-centered external memory, professional
   plain-language UI, project-as-memory-space, AI-first management with
   deterministic safety.
3. **Future development plan:** deeper workbench, stronger AI interpretation,
   multi-source project bindings, client connect/hooks, additional pilots, and
   broader personal/work memory domains.

## Verification For This Audit

The audit is documentation-only. Required verification is:

- `npm run format:check`
- `npm run lint`
- `git diff --check`
- `git diff --cached --check`

Full runtime smoke is not required unless code or deployment behavior changes.
