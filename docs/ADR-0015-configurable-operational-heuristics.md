# ADR-0015: Configurable operational heuristics

## Status

Accepted refinement

## Context

After replacing fixed context-file size targets with configurable context policy, we reviewed other accepted decisions for the same risk: accidentally turning useful starting values into unnecessary long-term constraints.

The main risky area is not foundational architecture. It is operational heuristics:

- retrieval `top_k`, `max_chars_total`, candidate counts, graph budgets,
- rerank weights and penalties,
- decay halflife and stale thresholds,
- embedding batch size,
- chunk size and overlap,
- default model choices.

These values are useful defaults for v1 implementation and tests, but they should not become architectural invariants.

## Decision

Recallant must distinguish:

1. **Hard invariants**  
   Safety, provenance, and contract requirements that should not be configurable away casually.

2. **Policy defaults**  
   Default values shipped with v1 but configurable by profile, project, deployment, or task.

3. **Examples**  
   Documentation examples that must not be interpreted as required implementation constants.

Operational numeric values should generally be policy defaults, not hard architecture rules.

## Hard Invariants

These remain intentionally strict:

- L0 raw evidence is append-only; derived layers may be rebuilt.
- Agent-facing v1 interface is MCP.
- MCP responses are bounded and must not return the whole memory store.
- Every returned memory/evidence item must preserve provenance/source refs.
- Agent-created memories must not silently become `instruction_grade`.
- No plaintext secrets in memory/bootstrap.
- `recallant init` must not silently import historical material.
- Basic recall must work without cloud providers.
- Cloud/model calls must be auditable.
- Startup must not read all docs/logs/archive files by default.

## Configurable Defaults

These should be controlled by configuration/policy profiles:

- `top_k`, `max_chars_total`, and server hard caps for search/recall,
- `N_lex`, `N_vec`, graph expansion budget,
- rerank weights such as lexical/vector balance,
- supersede/decay penalties,
- project/developer halflife values,
- stale analysis thresholds,
- chunk size and overlap,
- embedding batch size,
- local/cloud model defaults,
- context pack size and item counts.

## Profile Examples

Implementation may ship profiles such as:

- `compact`: smaller response/context budgets, stricter startup.
- `standard`: default one-person project workflow.
- `expanded`: large repository or ops-heavy project.
- `batch`: import/reindex jobs with larger batches and async processing.
- `custom`: explicit project/deployment overrides.

The exact profile names may change, but the implementation must support the concept of policy-based tuning.

## Test Rule

Tests should verify invariants and relative behavior, not hard-code arbitrary tuning values.

Good:

- response length never exceeds the configured cap,
- superseded records rank below active replacements,
- older stale records receive lower score than equivalent fresh records when decay is enabled,
- batch mode uses more than one item per embedding call,
- changing embedding dimensions requires reindex/migration.

Bad:

- asserting `top_k` must always be exactly `8`,
- asserting stale threshold must always be `90d`,
- asserting embedding batch size must always be `32`,
- asserting context pack must always include exactly N memories.

## Consequences

- We keep strong safety/architecture boundaries.
- We avoid overfitting v1 to accidental tuning values.
- Large projects can tune retrieval/context/cleanup without an ADR for every number.
- Documentation examples must clearly say when values are illustrative defaults.

## Open questions

- Should these operational policies live in one `recallant policy` config object or separate retrieval/context/cleanup/model configs?
- Which profiles should ship in v1?
- Which settings require owner confirmation because changing them affects cost, privacy, or quality?
