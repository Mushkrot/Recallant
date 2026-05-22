# Non-goals (explicit exclusions)

The following items are intentionally outside the current platform specification.

## Product and audience

- Do not build a broad primary UI for all of Recallant as a required v1 feature. Exception: the owner-facing Review/Management UI for governed memory, settings, cost, cleanup, and natural-language management is part of v1. Do not build a marketing/SaaS dashboard, full observability suite, or visual editor for all raw events/chunks in v1.
- Do not optimize for marketing SaaS features such as billing, multi-tenant self-serve signup, or public product operations.
- Do not build a throwaway MVP that drops provenance, review/use policy, or governed agent memory to move faster. Core quality matters more than initial speed.
- Do not build full passive personal-life capture in v1. The architecture should leave an OB1-style path through domains, scopes, and connectors.
- Do not start implementation before the owner explicitly authorizes it; the current deliverable is architecture documentation.
- Do not expand the first implementation scope beyond the full coding-agent memory core without a separate owner decision; see `ADR-0025-v1-core-and-expansion-boundary.md`.

## Scale and deployment

- Do not design planet-scale sharding in v1. The target is a correct single-node Postgres architecture with a clear evolution path.
- Do not introduce object storage, a dedicated vector DB, or a graph DB as required v1 dependencies. They remain future evolution paths when measured data volume or query patterns justify them.
- Do not promise fully automatic capture of every chat from every CLI without a specified source. Some channels remain explicit/export-based; see `INGESTION.md`.

## Data model and AI

- Do not build a universal database for arbitrary CRM, billing, or inventory use. Recallant stores agent-memory artifacts and their related graph.
- Do not guarantee semantic correctness of summaries without review. Summaries are derived layers with provenance and can be wrong; raw append evidence remains the source of truth except where explicit erasure applies.
- Do not build a universal LLM gateway for unrelated applications. Recallant includes a local-first model router for its own memory tasks; see `MODEL_ROUTING.md` and ADR-0012.
- Do not let AI suggestions bypass deterministic policy, confirmation, audit, or safety checks.

## Security boundaries

- Do not implement full enterprise compliance such as SOC2 evidence packs in v1. Implement the baseline security posture in `SECURITY.md`.
- Do not store plaintext user secrets in the memory store. Secrets live outside Recallant; Recallant stores safe references and capability/account bindings.
- Do not expose the Review/Management UI, admin API, MCP endpoint, backups, or raw artifacts publicly by default.

## Integrations

- Do not support every IDE and chat client in v1. Minimum: MCP clients plus documented ingest for the clients listed in `INGESTION.md`.
- Do not implement Gmail/Drive/Calendar/GitHub/browser/screenshot connectors in the first core scope. The architecture must allow them later.

## "Perfect" quality

- "Perfect" means an architecturally coherent core, not every possible feature in the first release. Extensions go through ADRs and new phases.
- Governed agent memory is part of core v1. Do not move it to future work just to reduce implementation scope.
