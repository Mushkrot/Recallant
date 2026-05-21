# ADR-0010: Controlled hybrid runtime

## Status

Accepted

## Context

The owner asked whether Recallant should choose one implementation language or use a hybrid stack where each language is used where it is strongest.

Upstream projects show different patterns:

- OB1 is TypeScript/Deno/Supabase Edge Function oriented for core memory/MCP/API surfaces.
- MF0 is JavaScript/Node/Vite/SQLite oriented.
- MemPalace is Python-first for CLI/MCP/memory mining.
- OpenMemory is intentionally Python + Node/TypeScript.
- Journey is a workflow packaging/API layer, not a memory runtime foundation.

## Decision

Use a **controlled hybrid** architecture:

- TypeScript is the preferred primary runtime for Recallant core.
- Python may be used for optional worker jobs when it clearly improves implementation quality.
- Core contracts remain language-neutral and must not be duplicated across runtimes.

Primary TypeScript ownership:

- MCP server,
- Review UI/admin API,
- CLI/bootstrap,
- JSON Schema and tool contracts,
- governance policy enforcement,
- model router interface,
- Postgres access for core transactions.

Optional Python ownership:

- heavy import/consolidation jobs,
- local ML/rerank experiments,
- batch analysis,
- repair/migration utilities where Python is materially better.

## Consequences

- Hybrid is allowed, but not as uncontrolled mixing.
- The TypeScript core must be useful without Python workers.
- Python workers communicate through explicit process/queue/API boundaries.
- The database schema and MCP spec remain the contract between runtimes.
- Core business logic must not be duplicated across TypeScript and Python.

## Open questions

- Which concrete Python workers, if any, should exist in v1 implementation?
- Should worker communication use subprocess, local queue, HTTP, or CLI command execution?
- Should the first implementation repo be monorepo with `apps/server`, `apps/cli`, `workers/python`, or a simpler single package first?
