# Decision rigidity audit — 2026-05-20

Purpose: identify accepted decisions that might accidentally create unnecessary constraints, similar to the earlier fixed `8 KB / 3 KB / 12 KB` context-file targets.

## Summary

The architecture decisions are mostly healthy. The risky area is not foundational direction; it is numeric heuristics and default tuning values that were written too concretely.

We should keep hard invariants for safety, provenance, bounded recall, and explicit owner control. We should make operational values configurable through profiles/policies.

## Keep strict

These are intentionally strict and should stay strict unless a future ADR changes them:

- Documentation-first before implementation.
- Postgres/pgvector as v1 source-of-truth platform.
- One Postgres instance with separate domain databases for major memory domains.
- MCP as the primary v1 agent-facing interface.
- Local-first model routing; cloud is escalation/fallback, not core dependency.
- No silent broad import from `amp init` or closeout.
- Agent-created memory cannot silently become `instruction_grade`.
- Source refs/provenance are required for generated governed memories.
- Startup must not read all docs/logs/archive files by default.
- Repo bootstrap files route to AMP; they do not become the long-term memory store.
- No plaintext secrets in memory/bootstrap.

## Refine to configurable policy

These should be implementation defaults or policy profile values, not architecture invariants:

- retrieval `top_k`, `max_chars_total`, and hard caps,
- lexical/vector candidate counts,
- graph expansion budget,
- vector/lexical rerank weights,
- decay halflife, stale thresholds, and penalties,
- cleanup thresholds such as not-accessed days,
- chunk size and overlap,
- embedding batch size,
- default embedding model and dims,
- context pack item counts,
- context pack size.

These refinements are captured in [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md).

## Watch list

These are stronger architectural choices, not arbitrary numbers, but should be revisited if real evidence changes:

- **TypeScript-first core:** accepted for MCP/CLI/contracts and OB1/Journey alignment; Python workers remain allowed.
- **Review UI in v1:** updated by ADR-0016. This is now a deliberate scope commitment for governed-memory hygiene, not a broad dashboard requirement.
- **One Postgres instance:** correct for current operations; specialized stores require measured need and ADR.
- **Codex-first:** correct for owner workflow, but multi-client fields and MCP transport neutrality must remain.

## Documentation cleanup completed

- Replaced fixed context-file sizes with configurable context policy in ADR-0014.
- Added ADR-0015 for configurable operational heuristics.
- Retrieval, cleanup, ingestion, MCP, test, repo-contract, embedding-provider, and working-context docs now treat numeric values as profile defaults unless explicitly marked as hard invariants.
- Reworded default embedding model/dims, embedding batch size, recall caps, test fixture sizes, cleanup thresholds, and repo-sync freshness as configurable policy/profile values.

## Remaining explicit choices

The following are not accidental numeric rigidity, but deliberate product/architecture commitments. They can be changed by future ADR if evidence changes, but should not be silently softened during implementation:

- MCP tool names and schemas are stable contracts.
- `memory_append_turn` creates one L0 event per accepted append call.
- L0 content is append-only.
- `instruction_grade` promotion remains gated.
- Basic recall must remain available without cloud providers.
- Specialized vector/object/graph stores remain outside v1 unless measured need justifies them.
