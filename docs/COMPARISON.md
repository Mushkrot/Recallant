# Comparison

Recallant is inspired by several projects and patterns in the AI memory ecosystem. It is not a fork
of them. The goal is to combine the pieces OSS maintainers need for durable agent work: governed
memory, agent-ready onboarding, evidence, scoped recall, review, and private self-hosting.

## Related Approaches

| Approach | Strength | Gap Recallant Targets |
|----------|----------|-----------------------|
| Chat history | Exact conversation context | Hard to search, scope, review, or reuse safely across sessions. |
| Handoff files | Simple and repo-native | Become stale and consume model context. |
| Agent bootstrap templates | Fast project setup | Usually lack durable memory, review, source provenance, and safety policy. |
| Basic RAG | Finds old text | Often lacks authority, lifecycle, provenance, and instruction policy. |
| AgentMemory-style tools | Client capture and recall | Recallant adds stronger governance, review, and self-hosted Workbench posture. |
| OpenMemory-style systems | User memory and recall | Recallant focuses first on coding-agent project memory and maintainer workflows. |
| MemPalace-style capture | Rich session preservation | Recallant adds public OSS install, policy gates, and project-scoped governed memory. |
| Journey-style kits | Workflow packaging | Recallant uses workflow packaging ideas but stores memory as a durable service. |

## Reference Projects

| Project | What It Shows | Recallant Takeaway |
|---------|---------------|--------------------|
| [Open Brain / OB1](https://github.com/NateBJones-Projects/OB1) | A memory-substrate reference around Postgres/pgvector, MCP, multi-client memory, governed agent-memory sidecars, source refs, review state, and recall traces. | Keep OB1 as the preferred foundation reference for Recallant's memory-core posture, while preserving Recallant-owned project/source isolation, raw evidence, review, and policy contracts. See [Reference Projects](REFERENCE_PROJECTS.md#open-brain--ob1). |
| [MemPalace](https://github.com/MemPalace/mempalace) | A verbatim-first memory/capture reference with search, archive, recovery, hooks/sweep ideas, and temporal knowledge-graph patterns. | Study it for evidence preservation, capture safety nets, temporal/recovery workflows, and search/archive ergonomics. Recallant should keep capture profiles, raw artifact pointers, caps, and governed recall. See [Reference Projects](REFERENCE_PROJECTS.md#mempalace). |
| [AgentMemory](https://github.com/rohitg00/agentmemory) | A practical coding-agent memory reference for client `connect`, lifecycle hooks, live viewer/replay, capture-active diagnostics, native skills, and retrieval evals. | Use it as the strongest implementation reference for proving agents are actually connected and writing memory, without replacing Recallant's attach/source lifecycle or governed Postgres model. See [Reference Projects](REFERENCE_PROJECTS.md#agentmemory). |
| [Journey / Journey Kits](https://www.journeykits.ai/) | A workflow packaging and onboarding reference with target-aware installs, resolver hints, preflight checks, versioning, and install outcome reporting. | Use it for packaging, setup, resolver hints, and future kit/profile ideas; do not make Journey the memory foundation or a required SaaS dependency. See [Reference Projects](REFERENCE_PROJECTS.md#journey--journey-kits). |
| [OpenMemory variants](https://github.com/CaviraOSS/OpenMemory) | User-memory systems with useful prior art around salience, decay, reinforcement, temporal facts, connectors, SDK/server/MCP modes, and explainable recall traces. | Treat them as prior art for lifecycle and recall-trace ideas, not as the core foundation, especially where projects are sunset or being rewritten. See [Reference Projects](REFERENCE_PROJECTS.md#openmemory-variants). |
| [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) | A fast-growing MIT self-hosted AI workspace with chat, agents, MCP tools, local/API model setup, deep research, model comparison, documents, memory/skills, email, notes/tasks, calendar, mobile support, and a screenshot-backed product story. | Use it as a product and UI reference for a useful first screen, familiar chat shell, visible modes, mobile behavior, self-host setup clarity, and screenshot-backed docs. Recallant should not copy the broad all-in-one scope; it should apply the workspace patterns to governed coding-agent memory. See [Reference Projects](REFERENCE_PROJECTS.md#odysseus). |
| [MF0.ai / MF0-1984](https://github.com/PavelMuntyan/MF0-1984) | Pavel Muntyan's local-first multi-provider LLM workspace with Memory Tree, themes, structured purpose areas, AI Opinion, analytics, profile backup/restore, and recent UI work around mobile navigation, sticky scroll, and interface scaling. | Keep it in its earlier accepted role as a first-class workbench/raw-capture/Memory Tree reference, especially for visible memory topology, model comparison, cost awareness, long-answer ergonomics, and mobile controls. The public repository has no visible license at inspection time, so code reuse should wait for license clarity. See [Reference Projects](REFERENCE_PROJECTS.md#mf0ai--mf0-1984). |
| [Kortix / Suna](https://github.com/kortix-ai/suna) | A fast-moving source-available autonomous-agent workspace with self-host and cloud paths, session sandboxes, change requests, connectors, triggers, secrets, desktop/mobile surfaces, and a repo-as-company operating model. | Use it as an OSS-community and product-operations reference for installer proof, visible release cadence, agent workbench UX, connector governance, and review-gated agent changes. Recallant should stay narrower: governed memory for coding agents with provenance, scoped recall, review states, and safe memory promotion. See [Reference Projects](REFERENCE_PROJECTS.md#kortix--suna). |
| [Kortex / Eden](https://www.kortex.co/) | A polished human/team second-brain workspace with capture, search, chat over personal knowledge, writing panes, collaboration, export, and a read-only MCP bridge for external assistants. | Treat it as a product, UX, and integration reference, not an OSS implementation source unless an official source repository is published. Its clear capture-to-create loop and simple chat-like surface are useful examples, while Recallant stays agent-first: governed MCP memory, provenance, review states, and project-scoped policy. See [Reference Projects](REFERENCE_PROJECTS.md#kortex--eden). |

## Design Influences

Recallant borrows ideas at the pattern level:

- from memory products: recall traces, salience, lifecycle, and user-visible memory management;
- from self-hosted AI workspaces: familiar chat shells, visible modes, mobile behavior, and
  screenshot-backed product proof;
- from human second-brain workspaces: low-friction capture, clean retrieval, contextual chat, and
  explicit export/ownership expectations;
- from source-available agent workbenches: self-host packaging, connector governance, sandboxed
  sessions, and review-gated agent changes;
- from agent workflow systems: startup context, closeout, hooks, and reusable client setup;
- from project bootstrap practice: thin local files, compact checkpoints, and migration of old
  handoffs into governed evidence;
- from maintainer practice: release gates, security review, source references, and rollback;
- from self-hosted tools: private defaults, explicit install profiles, and local data ownership.

The product contract is intentionally narrower than the reference projects. From AgentMemory,
Recallant borrows lifecycle hooks, capture-active diagnostics, and the idea that a connected agent
should actually write and recall memory. From OB1, it borrows the Postgres/pgvector, MCP,
source-ref, review-state, and recall-trace posture. From Kortix/Suna, it borrows visible agent
workbench and review-gated change patterns. Recallant does not become a broad autonomous-agent
workspace: it stays focused on governed coding-agent memory, provenance, scoped recall, review, and
safe promotion of agent-authored memories.

## What Is Different

Recallant treats memory as a governed product surface, not just a retrieval index.

- Memories have source references and status.
- Rules are not silently promoted from agent guesses.
- Context packs are bounded and server-built.
- Agent-ready project files stay thin while durable history lives in Recallant.
- Cross-project recall is explicit and labeled.
- The Workbench gives humans a place to review conflicts, rules, settings, and capture health.

## Honest Status

Recallant is pre-release. It has a working first coding-agent memory slice, but it still needs
clean-host validation, broader client pilots, security review, and release packaging before it
should be treated as stable infrastructure.
