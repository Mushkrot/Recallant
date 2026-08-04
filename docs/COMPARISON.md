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
| AgentMemory-style tools | Native Codex/Claude Code plugins, hooks, shared-server capture, and recall | Recallant adds stronger project identity, governance, review, and source authority. |
| OpenMemory-style systems | User memory and recall | Recallant focuses first on coding-agent project memory and maintainer workflows. |
| MemPalace-style capture | Multi-client capture, verbatim recovery, document extraction, and several vector backends | Recallant adds governed source/memory separation, review, policy, and durable project identity. |
| Journey-style kits | Workflow packaging | Recallant uses workflow packaging ideas but stores memory as a durable service. |
| Open Engine-style task records | Portable work handoff | Recallant should make task records and receipts first-class on top of governed memory, not replace memory with copy-paste templates. |
| Linear/Plane-style task managers | Mature issue lists, boards, and human workflow UI | Recallant needs only a governed handoff record. External task systems stay optional adapters, never required memory backends. |
| LLM-maintained Markdown wiki | Transparent, portable, compounding synthesis over curated sources | Recallant adds structured provenance, scope, lifecycle, review, audit, retention, and safe multi-client recall while keeping Markdown as an optional companion surface. |

## Reference Projects

| Project | What It Shows | Recallant Takeaway |
|---------|---------------|--------------------|
| [Open Brain / OB1](https://github.com/NateBJones-Projects/OB1) | A memory-substrate reference around Postgres/pgvector, MCP, multi-client memory, governed agent-memory sidecars, source refs, review state, and recall traces. | Keep OB1 as the preferred foundation reference for Recallant's memory-core posture, while preserving Recallant-owned project/source isolation, raw evidence, review, and policy contracts. See [Reference Projects](research/REFERENCE_PROJECTS.md#open-brain--ob1). |
| [Open Engine](https://natesnewsletter.substack.com/p/ai-agent-handoffs) | Nate Jones's process reference for shared task lists, seven-part task records, one-loop audits, receipts, and work moving between multiple AI tools, agents, and people. | Use it as the strongest handoff/receipt reference: make claimable, pausable, resumable, finishable task records a first-class layer over Recallant's context packs, governed memories, checkpoints, source refs, Workbench review, and audit. Do not confuse it with OB1 or OpenClaw, and do not replace governed memory with copy-paste templates. See [Reference Projects](research/REFERENCE_PROJECTS.md#open-engine). |
| [MemPalace](https://github.com/MemPalace/mempalace) | A verbatim-first memory/capture system with Codex, Claude Code, and Cursor integrations; project/conversation mining; document extraction; and multiple vector backends. | Use it as the primary document-ingestion and client-adapter implementation reference. Keep Recallant's governed source/memory separation, identity, review, and policy. See [Reference Projects](research/REFERENCE_PROJECTS.md#mempalace). |
| [AgentMemory](https://github.com/rohitg00/agentmemory) | A practical coding-agent memory system with separate native Claude Code and Codex plugins/hooks, MCP, a shared server, viewer, provenance, audit, and retrieval evaluation. | Use it as the strongest adapter reference for real client capture and recall. Do not replace Recallant's durable project identity, source lifecycle, or governed Postgres model with basename/path defaults. See [Reference Projects](research/REFERENCE_PROJECTS.md#agentmemory). |
| [Journey / Journey Kits](https://www.journeykits.ai/) | A workflow packaging and onboarding reference with target-aware installs, resolver hints, preflight checks, versioning, and install outcome reporting. | Use it for packaging, setup, resolver hints, and future kit/profile ideas; do not make Journey the memory foundation or a required SaaS dependency. See [Reference Projects](research/REFERENCE_PROJECTS.md#journey--journey-kits). |
| [OpenMemory variants](https://github.com/CaviraOSS/OpenMemory) | User-memory systems with useful prior art around salience, decay, reinforcement, temporal facts, connectors, SDK/server/MCP modes, and explainable recall traces. | Treat them as prior art for lifecycle and recall-trace ideas, not as the core foundation, especially where projects are sunset or being rewritten. See [Reference Projects](research/REFERENCE_PROJECTS.md#openmemory-variants). |
| [Odysseus](https://github.com/odysseus-dev/odysseus) | A broad AGPL-3.0 self-hosted AI workspace with chat, agents, tools, documents, memory, and human productivity surfaces. | Use it as a human-workspace and UI reference, not as the memory substrate or a permissive code donor. Recallant should not copy the broad all-in-one scope. See [Reference Projects](research/REFERENCE_PROJECTS.md#odysseus). |
| [OpenHuman](https://github.com/tinyhumansai/openhuman) | A GPL-3.0 personal AI harness with UI-first onboarding, local Memory Tree / Obsidian-style vault, SuperContext preparation, documents and integrations, plus an optional AgentMemory backend shared with coding clients. | Use it as a product/lifecycle reference for human-facing memory and shared-backend UX. Do not copy its broad personal-agent scope or code without license review. See [Reference Projects](research/REFERENCE_PROJECTS.md#openhuman). |
| [Chase AI Jarvis / Karpathy LLM Wiki](https://www.chaseai.io/blog/voice-driven-agentic-os-claude-code) | A product example of Claude Code reading and generating Obsidian reports, grounded in the broader pattern of immutable raw sources, an LLM-maintained Markdown wiki, and a schema file. No public Jarvis implementation or retrieval benchmark was linked in the inspected first-party material. | Use it as a transparency and portability reference for an optional human-readable vault projection over Recallant. Keep Postgres-backed governed memory authoritative, send vault changes through review, and do not copy unsupported claims that every answer is saved or that the whole system is database-free. See [Reference Projects](research/REFERENCE_PROJECTS.md#chase-ai-jarvis--karpathy-llm-wiki) and the [focused comparison](research/JARVIS_OBSIDIAN_COMPARISON.md). |
| [MF0.ai / MF0-1984](https://github.com/PavelMuntyan/MF0-1984) | Pavel Muntyan's local-first multi-provider LLM workspace with Memory Tree, themes, structured purpose areas, AI Opinion, analytics, profile backup/restore, and recent UI work around mobile navigation, sticky scroll, and interface scaling. | Keep it in its earlier accepted role as a first-class workbench/raw-capture/Memory Tree reference, especially for visible memory topology, model comparison, cost awareness, long-answer ergonomics, and mobile controls. The public repository has no visible license at inspection time, so code reuse should wait for license clarity. See [Reference Projects](research/REFERENCE_PROJECTS.md#mf0ai--mf0-1984). |
| [Kortix / Suna](https://github.com/kortix-ai/suna) | A fast-moving source-available autonomous-agent workspace with self-host and cloud paths, session sandboxes, change requests, connectors, triggers, secrets, desktop/mobile surfaces, and a repo-as-company operating model. | Use it as an OSS-community and product-operations reference for installer proof, visible release cadence, agent workbench UX, connector governance, and review-gated agent changes. Recallant should stay narrower: governed memory for coding agents with provenance, scoped recall, review states, and safe memory promotion. See [Reference Projects](research/REFERENCE_PROJECTS.md#kortix--suna). |
| [Kortex / Eden](https://www.kortex.co/) | A polished human/team second-brain workspace with capture, search, chat over personal knowledge, writing panes, collaboration, export, and a read-only MCP bridge for external assistants. | Treat it as a product, UX, and integration reference, not an OSS implementation source unless an official source repository is published. Its clear capture-to-create loop and simple chat-like surface are useful examples, while Recallant stays agent-first: governed MCP memory, provenance, review states, and project-scoped policy. See [Reference Projects](research/REFERENCE_PROJECTS.md#kortex--eden). |

## Design Influences

Recallant borrows ideas at the pattern level:

- from memory products: recall traces, salience, lifecycle, and user-visible memory management;
- from self-hosted AI workspaces: familiar chat shells, visible modes, mobile behavior, and
  screenshot-backed product proof;
- from human second-brain workspaces: low-friction capture, clean retrieval, contextual chat, and
  explicit export/ownership expectations;
- from source-available agent workbenches: self-host packaging, connector governance, sandboxed
  sessions, and review-gated agent changes;
- from agent workflow systems: startup context, closeout, hooks, reusable client setup, task
  records, and receipt-style handoff;
- from project bootstrap practice: thin local files, compact checkpoints, and migration of old
  handoffs into governed evidence;
- from maintainer practice: release gates, security review, source references, and rollback;
- from self-hosted tools: private defaults, explicit install profiles, and local data ownership.

The product contract is intentionally narrower than the reference projects. From AgentMemory,
Recallant borrows native multi-client adapter patterns, lifecycle hooks, capture-active diagnostics,
and the idea that a connected agent should actually write and recall memory. From MemPalace, it
borrows document extraction and multi-backend ingestion patterns while keeping Recallant-owned
source identity and governance. From OB1, it borrows the Postgres/pgvector, MCP, source-ref,
review-state, and recall-trace posture. From Open Engine, it borrows the lesson that work should
travel as a task record with sources, limits, next actions, and receipts, while Recallant keeps the
authoritative state in governed memory rather than a pasted template.

From OpenHuman, Recallant borrows the no-cold-start context-preparation lesson, visible memory
topology, and durable goal/task lifecycle at the pattern level. From Kortix/Suna, it borrows visible
agent workbench and review-gated change patterns. Recallant does not become a broad autonomous-agent
workspace: it stays focused on governed coding-agent memory, provenance, scoped recall, review, and
safe promotion of agent-authored memories.

From Karpathy's LLM Wiki pattern, Recallant should borrow the clarity of immutable sources,
human-readable compiled knowledge, an explicit schema, simple indexes and logs, and Git-friendly
portability. Chase AI's Jarvis is a product example of that pattern, not a code-verified memory
dependency. Recallant's existing Obsidian-compatible vault bridge should remain a governed companion
surface: exported Markdown does not replace authoritative memory state, and vault edits return as
reviewable candidates rather than silent truth.

After real cross-client continuity, Recallant plans to extend the same governed platform to
AI-mediated human document memory over explicitly permitted sources. This does not mean broad
ingestion or synchronization exists today; see the
[focused discussion record](research/JARVIS_OBSIDIAN_COMPARISON.md#accepted-future-direction).

## What Is Different

Recallant treats memory as a governed product surface, not just a retrieval index.

- Memories have source references and status.
- Rules are not silently promoted from agent guesses.
- Context packs are bounded and server-built.
- Agent-ready project files stay thin while durable history lives in Recallant.
- Cross-project recall is explicit and labeled.
- The Workbench gives humans a place to review conflicts, rules, settings, and capture health.

## Honest Status

Recallant is pre-release. It has a working Codex-first coding-agent memory slice, but it has not yet
proved native Codex -> Claude Code -> Codex continuity or Human Document Memory. Those product gaps,
along with repeat external-host validation, independent hardening, and release packaging, must be
closed before it should be treated as stable infrastructure.
