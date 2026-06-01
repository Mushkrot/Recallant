# ADR-0045: Human-centered memory and professional workbench language

## Status

Accepted

## Context

The owner clarified that Recallant should not be framed only as memory for
coding agents or only as memory attached to folders. The original product
intent is broader: Recallant is an external memory for the owner, accessed and
maintained through AI agents. Coding-agent memory remains the first concrete
domain, but it is a narrower instance of the larger product.

The owner also clarified the expected management experience:

- the UI must be simple, intuitive, modern, and professional;
- default screens must speak human language, not database field names,
  acronyms, variable names, or internal keywords;
- advanced technical details remain available, but they must be collapsed or
  secondary;
- default settings should be chosen automatically, with manual controls as an
  optional layer;
- Recallant should use AI heavily for understanding, analysis, routing,
  recommendations, and answers, while hard policy remains responsible for
  safety.

## Decision

Recallant is a **human-centered external-memory platform accessed through AI
agents**.

### Project means memory space

A Recallant project is a logical memory space around a meaningful area of work
or life. It is not inherently a filesystem folder.

A project may have:

- no folder at all;
- one local folder;
- several local folders;
- server paths;
- repositories;
- documents;
- future connectors such as Drive, Gmail, Calendar, browser, chat exports, or
  other sources.

`recallant attach <folder>` remains the first practical coding workflow, but it
attaches a folder/source to a memory space. It must not become the permanent
definition of what a project is.

### Human-first management language

The management UI must use professional human-readable wording by default.
Internal field names such as `memory_type`, `scope_kind`, `use_policy`,
`embedding_route`, `project_id`, and route-class names may be visible only in
technical details, API output, logs, or advanced panels.

Default screens should explain:

- what Recallant knows;
- what needs the owner's attention;
- what action is recommended;
- what will happen if the owner confirms;
- what is safe, risky, stale, or waiting.

### Interface references

Use the upstream projects as UI references by role:

- **OB1 / Open Brain:** best philosophical reference for a human external
  memory that agents can use.
- **MF0-1984:** best workbench reference for a person working with AI, memory
  views, project profile import/export, and memory-tree style navigation.
- **AgentMemory:** best reference for live capture visibility, session replay,
  and "is the agent actually recording?" feedback.
- **MemPalace:** useful for search/archive/recovery flows, but Recallant should
  not adopt palace metaphors as primary UI language.
- **Journey:** useful for onboarding and guided installation flows.

Recallant's UI should synthesize these into a private management workbench:
plain-language command center, memory spaces, review, activity/replay, settings,
cost, cleanup, and natural-language chat.

### AI-first operation with policy guardrails

Recallant should use AI wherever semantic judgment is the point of the task:

- understanding owner requests;
- deciding which memory space a request belongs to;
- extracting memories, rules, decisions, and open questions;
- explaining conflicts and cleanup proposals;
- planning context packs;
- proposing project attachment and migration steps;
- answering humans and agents in natural language.

Local models should be used first where they are good enough. Stronger external
models may be routed through configured providers or model routers when the task
needs more reasoning quality or local models are too slow/weak.

Deterministic server policy remains authoritative for:

- authentication and access;
- storage and migrations;
- confirmation gates;
- deletion and permanent erasure;
- secrets and connector access;
- public exposure;
- production service changes;
- paid API use and cost limits;
- audit and provenance.

## Consequences

- Product language should shift from "governed memory for AI agents" toward
  "external memory for the owner and their AI agents", while v1 remains focused
  on coding-agent work.
- Data model and UI must not assume one project equals one folder.
- Project source attachment must evolve beyond `primary_path` into multiple
  source bindings.
- Review UI and Management Chat need human-readable summaries before technical
  details.
- Automatic defaults are preferred; manual settings are for inspection,
  override, and safety.
- AI-backed interpretation should be the normal path for plain-language
  requests, with clearly labelled deterministic fallback when models are
  unavailable.

## Non-goals

- This ADR does not add passive personal-life capture to v1.
- This ADR does not allow AI to bypass safety confirmation for risky actions.
- This ADR does not remove the folder-based `recallant attach .` workflow; it
  reframes it as one source-attachment path, not the whole product model.
