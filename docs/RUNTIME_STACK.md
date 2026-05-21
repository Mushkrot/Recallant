# Runtime stack

AMP can use more than one language, but it should not become an uncontrolled polyglot system.

## 1. Principle

Use one **primary runtime** for core contracts and one optional **worker runtime** where it clearly pays off.

Core contracts include:

- MCP tools,
- CLI commands,
- JSON Schemas,
- auth/scope enforcement,
- migrations orchestration,
- model routing API,
- project bootstrap.

Worker/runtime extension areas include:

- heavy import jobs,
- model/rerank experiments,
- local ML pipelines,
- offline analysis,
- one-off data repair tools.

## 2. Option A — TypeScript-first

Use TypeScript/Node as the primary server/CLI/MCP runtime.

Pros:

- Closest to OB1's core MCP/Supabase Edge Function style.
- Closest to Journey's workflow/package/install ecosystem.
- Strong fit for MCP, JSON Schema, CLI, config generation, and required Review UI.
- Easier to share types between MCP server, CLI, admin API, and Review UI.

Cons:

- Some ML/retrieval/data tooling is stronger in Python.
- Python workers may still be needed for advanced local model workflows.

## 3. Option B — Python-first

Use Python as the primary server/CLI/MCP runtime.

Pros:

- Strong fit for MemPalace-style memory mining and backend/plugin architecture.
- Strong ecosystem for ML, embeddings, rerankers, batch processing, and data repair.
- Good for offline import/consolidation workers.

Cons:

- Less aligned with OB1/Journey and many MCP/agent packaging examples.
- Required Review UI likely needs TypeScript anyway.

## 4. Option C — Controlled hybrid

Use TypeScript for the core runtime and Python for optional workers.

Recommended shape:

```text
TypeScript core:
  - MCP server
  - CLI
  - config/bootstrap
  - JSON Schema/tool contracts
  - model router interface
  - Postgres access and policy enforcement

Python workers, optional:
  - batch import/consolidation
  - advanced rerank/model experiments
  - heavy offline analysis
  - migration/repair utilities where Python is clearly better
```

Pros:

- Lets each language do what it is best at.
- Matches the pattern seen across upstream projects: a primary runtime plus targeted secondary tooling.
- Keeps core contracts in one place.

Cons:

- Requires strict process/API boundaries.
- More packaging, deployment, and testing complexity than one language.
- Easy to overuse unless the boundary is enforced.

## 5. Upstream comparison

Observed current upstream stack patterns:

- **Open Brain / OB1:** TypeScript/Deno/Supabase Edge Functions for core MCP/API surfaces, SQL schemas, plus JavaScript/Python/supporting assets in integrations and tooling.
- **MF0-1984:** JavaScript/Node/Express/Vite single-language app with SQLite; no Python runtime in the core.
- **MemPalace:** Python-first package and MCP server, with a small website/frontend layer.
- **CaviraOSS/OpenMemory:** explicit Python + Node/TypeScript SDK/server ecosystem.
- **Journey / Journey Kits:** workflow registry/API/kit format; relevant as packaging/onboarding layer rather than memory runtime. Public docs expose target-aware install and `kit.md`, not a memory-core runtime to copy.

Reference evidence:

- OB1 `server/deno.json` imports `@hono/mcp`, `@modelcontextprotocol/sdk`, `hono`, `zod`, and `@supabase/supabase-js`.
- MF0 `package.json` runs `node --env-file=.env server/api.mjs`, Vite, and SQLite/Postgres-related Node packages.
- MemPalace `pyproject.toml` defines Python package entrypoints `mempalace` and `mempalace-mcp`, with Chroma as backend plugin.
- OpenMemory has both `packages/openmemory-js/package.json` and `packages/openmemory-py/pyproject.toml`.
- Journey public site/API positions kits as installable agent workflows, not as a memory server runtime.

## 6. Accepted decision

Use **controlled hybrid**:

- TypeScript-first for AMP core.
- Python allowed for workers only when a concrete task clearly benefits from Python.
- No duplicated business logic across TypeScript and Python.
- Postgres schema, MCP tool contracts, and governance policy remain authoritative and language-neutral.

## 7. Open decisions

- Which Python workers, if any, should be part of v1 implementation?
- Should migrations be owned by TypeScript tooling, SQL files, or a language-neutral migration runner?
- How should TypeScript core call Python workers: subprocess, queue, HTTP, or direct separate CLI?
