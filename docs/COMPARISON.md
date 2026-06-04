# Comparison

Recallant is inspired by several projects and patterns in the AI memory ecosystem. It is not a fork
of them. The goal is to combine the pieces OSS maintainers need for durable agent work: governed
memory, evidence, scoped recall, review, and private self-hosting.

## Related Approaches

| Approach | Strength | Gap Recallant Targets |
|----------|----------|-----------------------|
| Chat history | Exact conversation context | Hard to search, scope, review, or reuse safely across sessions. |
| Handoff files | Simple and repo-native | Become stale and consume model context. |
| Basic RAG | Finds old text | Often lacks authority, lifecycle, provenance, and instruction policy. |
| AgentMemory-style tools | Client capture and recall | Recallant adds stronger governance, review, and self-hosted Workbench posture. |
| OpenMemory-style systems | User memory and recall | Recallant focuses first on coding-agent project memory and maintainer workflows. |
| MemPalace-style capture | Rich session preservation | Recallant adds public OSS install, policy gates, and project-scoped governed memory. |
| Journey-style kits | Workflow packaging | Recallant uses workflow packaging ideas but stores memory as a durable service. |

## Design Influences

Recallant borrows ideas at the pattern level:

- from memory products: recall traces, salience, lifecycle, and user-visible memory management;
- from agent workflow systems: startup context, closeout, hooks, and reusable client setup;
- from maintainer practice: release gates, security review, source references, and rollback;
- from self-hosted tools: private defaults, explicit install profiles, and local data ownership.

## What Is Different

Recallant treats memory as a governed product surface, not just a retrieval index.

- Memories have source references and status.
- Rules are not silently promoted from agent guesses.
- Context packs are bounded and server-built.
- Cross-project recall is explicit and labeled.
- The Workbench gives humans a place to review conflicts, rules, settings, and capture health.

## Honest Status

Recallant is pre-release. It has a working first coding-agent memory slice, but it still needs
clean-host validation, broader client pilots, security review, and release packaging before it
should be treated as stable infrastructure.
