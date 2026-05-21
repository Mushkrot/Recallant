# Pain points and product requirements snapshot — 2026-05-19

This file captures the owner's unstructured pain points from the current architecture discussion and translates them into durable product requirements.

## 1. Current agent usage reality

The original problem involved switching between multiple coding agents: Cursor, Windsurf, Claude Code, Codex, and similar MCP clients. The immediate daily workflow is now mostly **Codex-first**.

This changes priority, not architecture:

- Cross-client continuity is less urgent today.
- Same-agent continuity across sessions is still critical.
- Multi-client support must remain in the design because the workflow may return to multiple agents later.

## 2. Repeated instruction loss

The owner repeatedly has to explain working rules to agents and edit project configuration files so agents behave correctly. The same guidance is repeated across sessions because agent context and user instructions are lost.

Requirement:

- Stable developer-level rules must live outside any single chat session.
- Agents must be able to retrieve the right rules when needed instead of asking the user to repeat them.
- Some rules are global across all projects; some are project-specific; some are task-specific.

## 3. Project bootstrap friction

The owner already built a file-based configuration structure that helps agents restore project context at session start and write future handoff state. The pain is that every new project currently needs manual or agent-assisted setup.

Requirement:

- A new project should be connected to AMP in one simple action: CLI command, skill, kit, or repository bootstrap.
- The bootstrap must create the thin project files and MCP config needed for the selected agent harness.
- The bootstrap must not copy large duplicated documentation into every project.

Current target:

- `amp init` remains the canonical local command.
- A Journey-style installable kit/skill may become an additional distribution path.
- A command is acceptable for the owner now; if the project becomes a public repo, a more polished kit/skill/bootstrap experience should be revisited.

## 4. Context window overload

The current file-based approach can create duplicated information across configuration files and can make agents read too many large files at session start, quickly consuming the context window.

Requirement:

- Project files must be thin adapters, not large knowledge dumps.
- Startup context must be a compact capsule: rules for how to use memory, current checkpoint, and a small number of relevant recalled items.
- Long-lived knowledge belongs in AMP storage and should be loaded lazily through retrieval, resolver hints, and governed memory recall.
- The system needs explicit context budget rules and tests.

## 5. Contextual retrieval, not keyword-only search

The owner expects the memory store to grow very large over time. Keyword search alone will not be enough.

Requirement:

- Retrieval must combine semantic/contextual search, lexical search, graph/source expansion, governed memory recall, recency/decay/salience, and bounded responses.
- Embeddings are required for semantic search, but raw text and provenance must remain available.
- Agents must be able to search by task context and meaning, not only exact words.

## 6. Local server first, external LLMs when useful

The owner expects to run AMP on a personal Linux server with a capable GPU (24GB VRAM). Local compute should handle the default memory workload. External LLMs such as OpenAI, Claude, Gemini, or similar providers should remain available for harder analysis.

Requirement:

- Core storage and retrieval should run on the user's server.
- Embeddings should default to local/self-hosted where practical.
- Nightly or background consolidation jobs can use local GPU.
- External LLM providers are optional enrichment/consolidation/rerank paths, not the only way the system works.

## 7. Layered memory architecture

The owner needs multiple memory layers:

- global developer-level rules and preferences,
- project-specific context and decisions,
- possibly nested projects/subprojects,
- task/session-level raw evidence,
- derived governed memories,
- future personal-life memory domains.

Requirement:

- AMP must preserve strict scoping so one project's private context does not pollute another project.
- Developer-level knowledge must be intentionally promoted and reusable across projects.
- The data model should support project hierarchy or parent/child project relationships.
- Projects are not secret-isolated from each other in the owner's workflow. Agents are often allowed to inspect another project to reuse configuration or implementation patterns. The problem is context contamination, not confidentiality.
- Cross-project search/reuse should be explicit or driven by developer-level promoted memory, not accidental background mixing.

## 8. Repo files should become thin, memory becomes the main store

Today each project contains project logs and documentation files where agents write everything they do. Some repo-native files should remain, especially agent configuration and human-readable checkpoints. But most long historical narrative should move into AMP.

Requirement:

- `AGENTS.md` stays as the thin entrypoint for agents.
- `PROJECT_LOG.md` stays as a human-readable checkpoint/resume file.
- Long session history, detailed decisions, failures, lessons, and evidence should live in AMP, not be duplicated endlessly in repo files.

## 9. Compaction resilience and raw capture

When an LLM context window fills, the provider compacts the chat and older details may disappear. AMP should protect against that loss.

Requirement:

- Store raw conversation/event evidence before compaction whenever possible.
- Support local capture/spooling on the working machine if direct server writes are unavailable.
- Sync/offload local captured data to the main server.
- Preserve enough raw evidence that future derived memories can be rebuilt.
- After successful server sync, local spool data should be pruned/offloaded so the working machine does not accumulate unnecessary copies forever.

Open question:

- Whether to capture every turn verbatim by default, or capture all local raw events while deriving only selected governed memories.

Current leaning:

- Preserve broad raw evidence where feasible, but make only selected reviewed/governed records influential for future agent behavior.

Settled v1 direction:

- Use hybrid capture: preserve raw evidence broadly where capture allows; future behavior is based on governed memories, checkpoint, scoring, review/override, and scope.
- Governed records should be created automatically when valid. Manual review is for later correction/curation, not a required approval step for every record.
- Manual session closeout should perform a full durable update because the owner does not close sessions often and wants context preserved when it happens.

## 10. Human external memory expansion

OB1 started closer to a human external memory: a system that observes and stores a person's thoughts and daily context, not only agent coding sessions. The owner does not want to lose that direction.

Requirement:

- AMP v1 stays focused on AI-assisted coding work.
- The architecture should leave a clear expansion path toward broader personal memory.
- The same core ideas should be reusable: owner-controlled store, scopes, provenance, bounded retrieval, review/use policy, and optional connectors.

Open question:

- Whether agent memory and human life memory should become two platforms or one platform with separate domains and policies.

Settled v1 direction:

- Follow the recommendation: make the architecture ready for personal memory through domains/scopes/connectors, but do not implement passive human-life capture in v1.

Future expansion variants:

- explicit import of selected project docs/git/issues/links,
- codebase semantic maps,
- personal research memory,
- manual personal notes capture,
- controlled connectors for email/calendar/files/browser/notes,
- ambient capture only after separate consent, review, privacy, and noise-control design.

## 11. Matthew Berman / Journey

The owner trusts Matthew Berman as a high-signal source similar to the trust placed in OB1's author. His current relevant project appears to be **Journey / Journey Kits**: an agent workflow registry and packaging system.

Requirement:

- Add Journey to upstream research as a reference for packaging reusable agent workflows, project bootstrap, skills/tools/memory contracts, resolver hints, install targets, versioning, preflight checks, and outcome/learning feedback loops.
- Treat Journey as a packaging/onboarding/workflow distribution reference, not as the primary memory engine.
