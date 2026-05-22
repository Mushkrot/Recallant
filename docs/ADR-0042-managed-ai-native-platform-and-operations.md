# ADR-0042: Managed AI-native platform and operations

## Status

Accepted

## Context

The owner confirmed several cross-cutting requirements after the core memory/governance architecture had already been drafted:

- memory must be easy to manage, including permanent removal when something should not have been stored;
- the system needs self-cleaning mechanisms as the corpus grows;
- the primary management experience should be natural-language chat, with UI controls as supporting surfaces;
- Recallant should lean heavily on AI/LLM capabilities while retaining deterministic safety boundaries;
- implementation should learn from upstream projects before rebuilding known patterns;
- code, docs, comments, and public artifacts must be English and professionally structured;
- the owner's server already has shared infrastructure such as Ollama, `/ai/SECURITY`, `/ai/PORTS.yaml`, and `/opt/secure-configs/.env`;
- existing services should be reused through configurable capability bindings rather than duplicated or hard-coded.

## Decision

Recallant is a **managed AI-native memory platform**.

### Managed memory

Recallant must support both ordinary governance and explicit erasure.

Normal governance actions are archive, reject, supersede, stale, edit, merge, and demote/promote. They keep provenance and make memory safer without destroying history.

Permanent erasure is a separate owner-confirmed workflow. It must remove target content from active memory, chunks, embeddings, derived summaries, context packs, search indexes, and UI surfaces. If a minimal audit receipt is retained, it must be redacted and must not contain the erased content.

### Self-cleaning

Recallant must include cleanup analysis that identifies stale, duplicate, conflicting, low-value, or poorly sourced memory. AI may cluster and explain candidates, but risky cleanup or erasure requires owner confirmation unless an explicit configured policy permits it.

### Natural-language management

The Review UI/management platform must include a natural-language command/chat surface. The owner can ask questions, inspect memory, request cleanup, change scope, and trigger review workflows in plain language. Recallant should respond in the user's language by default.

Actions that affect deletion, secrets, public exposure, model cost, global rules, or long-term behavior still require policy checks and confirmation.

### AI-native but governed

Recallant should use AI for extraction, review suggestions, cleanup clustering, conflict explanation, context planning, and intent classification. Deterministic code remains authoritative for storage, auth, migrations, policy enforcement, caps, audit, and destructive operations.

### Upstream study before implementation

Before implementation, selected upstream repositories should be locally inspected where practical. Agents should document what is reused, adapted, rejected, or rewritten. Recallant owns the final contracts, schema, and safety model.

### Engineering quality

Implementation must be modular, low-coupling, readable, and testable. Files should not grow without clear responsibility; refactor when boundaries become unclear. Commits should be scoped and meaningful.

All repository artifacts must be English: code, identifiers, comments, documentation, commit messages, API messages, and public materials. Conversation with the owner may remain Russian when the owner writes in Russian.

### Existing services and server inventories

Recallant should use an existing configured Ollama instance when available instead of starting duplicate local-model stacks. Provider endpoints are settings/capability bindings, so another server can use a different Ollama endpoint or no Ollama at all.

On the owner's current server:

- `/ai/SECURITY` is the server security baseline and must be consulted for exposure/auth/firewall/secret-related changes;
- `/ai/PORTS.yaml` is the port inventory and must be updated before Recallant starts any long-running port-bound service;
- `/opt/secure-configs/.env` is a shared secret location represented by secret references, not raw memory content.

## Consequences

- Data model and MCP/API design need an explicit erasure/forget workflow, not only archive/reject.
- Review UI expands from memory review into the first surface of a private management platform with chat, settings, cost, health, and cleanup flows.
- Cleanup is not just retrieval score decay; it is an ongoing product workflow.
- Model routing and settings must represent existing/local provider capabilities and diagnostics.
- Implementation planning must include upstream code study and explicit repo quality standards.
- The first server deployment must follow `/ai/PORTS.yaml` and `/ai/SECURITY` instead of choosing ports or exposure casually.

## Non-goals

- AI suggestions do not bypass deterministic policy or owner confirmation for risky actions.
- Permanent erasure is not the default cleanup behavior.
- Recallant does not store raw secrets just because it knows where secrets live.
- The owner's `/ai` layout, existing Ollama path, and shared env file are not universal product defaults.
