# ADR-0025: v1 core and expansion boundary

## Status

Accepted

## Context

The owner wants a full-quality product, not a quick demo. At the same time, AMP has a broad possible future: coding-agent memory, personal external memory, passive capture, connectors, visual memory management, public packaging, and specialized storage.

If all future directions are implemented at once, the project risks becoming infrastructure-heavy before the core daily workflow is reliable. If v1 is cut too aggressively, it will not solve the owner's real context-loss problem.

## Decision

Define v1 as a **full working core for coding-agent memory**, not a throwaway MVP.

v1 includes everything required for the owner's real agent workflow:

- AMP server on the owner's Linux server,
- `amp_agent_work` Postgres database in the accepted one-instance / domain-database architecture,
- project separation through `project_id` plus developer-level shared memory where intentionally promoted,
- raw conversation/event capture according to capture profiles,
- raw workflow evidence and raw artifact metadata/pointers for large tool/terminal/media/transcript evidence,
- local spool/offline sync and interruption recovery,
- sessions, hybrid heartbeat, checkpoints, and closeout,
- server-side Context Pack Builder,
- hybrid retrieval with bounded responses,
- governed memories with provenance, review state, use policy, source refs, and recall traces,
- owner-facing Review UI,
- centralized settings,
- local-first, subscription-first, API-last model router with OpenAI paid API baseline and optional Gemini/Claude cheap routes,
- Codex adapter as the first working scenario,
- universal MCP contracts so Cursor, Claude Code, Windsurf, and future clients can attach later without redesign,
- explicit imports of important project artifacts.

Future expansion is designed for but not implemented in the first scope:

- broader personal-life memory,
- passive always-on capture of browser/email/calendar/files/screenshots,
- Gmail/Drive/Calendar/GitHub and similar connectors,
- object storage for very large raw blobs beyond v1 local/server filesystem or spool-backed raw artifacts,
- dedicated vector DB or graph DB,
- rich visual Memory Tree/workbench beyond the required Review UI,
- public product packaging, marketplace distribution, or Journey kit as a polished installer,
- multi-user/SaaS/billing/enterprise security model.

Architecture must leave extension points for those future areas through domains, scopes, settings, provider adapters, import/connectors, and storage evolution. Implementation should not pull them into the first build unless the owner explicitly reopens scope.

## Consequences

- v1 remains substantial and useful: it solves the immediate Codex/agent context-loss problem end to end.
- Future personal memory and broader capture remain compatible with the architecture.
- Implementation agents have a clear stopping boundary and should not expand into unrelated connectors/storage/UI before the core is working.
- Review UI is still v1 because governed memory hygiene is part of the core, not a future luxury.
- Specialized storage systems are future evolution paths, not v1 dependencies.

## Non-goal

This ADR does not lower the quality bar. It limits the first implementation scope while preserving the architecture for later expansion.
