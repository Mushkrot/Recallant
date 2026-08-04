# Recallant Domain Language

Recallant provides governed project memory that can be shared by agent clients and, over time,
people. These terms keep memory, document knowledge, and work handoff distinct.

## Language

**Project Memory**:
The durable, project-scoped body of evidence, governed memories, checkpoints, and source links that
belongs to Recallant rather than to one agent client.
_Avoid_: Client memory, chat memory

**Agent Client**:
A coding or AI tool, such as Codex or Claude Code, that reads and writes Project Memory through a
Recallant integration.
_Avoid_: Memory owner, model memory

**Cross-Client Continuity**:
The ability for one Agent Client to continue project work recorded by another without a human
reconstructing the working context.
_Avoid_: Transcript transfer, client sync

**Project Continuity Pack**:
A bounded, source-backed view of the current objective, accepted decisions, constraints, relevant
artifacts, verification, blockers, checkpoint, and next action.
_Avoid_: Full transcript, handoff prompt

**Document Source**:
An owner-approved file or document set whose identity, version, provenance, and lifecycle remain
distinct from memories derived from it.
_Avoid_: Memory file, imported truth

**Human Document Memory**:
The governed query-and-answer experience in which people and agents use the same permitted Document
Sources and receive source-cited answers.
_Avoid_: Folder dump, generic RAG

**Task Handoff Record**:
A Recallant-owned, evidence-linked record of a bounded unit of work that can be claimed, paused,
resumed, and completed by agents or people.
_Avoid_: Linear issue, chat summary

**External Task Adapter**:
An optional projection or integration between a Task Handoff Record and an external task-management
interface. The external system does not own Project Memory.
_Avoid_: Task source of truth, required task backend

**Governed Memory**:
A durable fact, decision, constraint, lesson, rule, or checkpoint with scope, provenance, lifecycle,
and review semantics.
_Avoid_: Retrieved text, raw evidence

**Raw Evidence**:
A bounded record of source material or observed work from which governed conclusions may be derived.
_Avoid_: Accepted memory, instruction

**Workbench**:
Recallant's human control surface for asking, reviewing, inspecting provenance, and managing memory
and sources.
_Avoid_: Agent runtime, task authority
