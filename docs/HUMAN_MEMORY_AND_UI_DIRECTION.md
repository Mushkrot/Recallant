# Human Memory And UI Direction

This document translates the owner-facing product direction into practical
language for future implementation.

## Plain Product Definition

Recallant is an external memory for a person and their AI agents.

The owner does not usually open Recallant to manually file notes. The owner
works with agents. Agents use Recallant to remember what matters, ask for the
right context, and preserve useful decisions for the future.

The first working domain is software/project work with coding agents. That is
not the final boundary. The same memory model should later support broader
human projects such as server operations, clients, research, personal planning,
documents, email/calendar work, and other long-running life/work areas.

## Project Means Memory Space

In Recallant, a project is a memory space around a meaningful area.

A project can be:

- a code repository;
- a server or infrastructure area;
- a client or business line;
- a research topic;
- a personal-life domain;
- a recurring operational process;
- a virtual topic with no folder;
- a memory space with several folders, repositories, servers, or connectors.

A folder is a source that can be attached to a project. It is not the whole
project definition.

Examples:

| Human label | Possible sources | Meaning |
| --- | --- | --- |
| Recallant | `/ai/recallant`, production service, docs | Product memory for this platform |
| My servers | server facts, security docs, runbooks | Shared infrastructure memory |
| Google Drive integrations | several repos, connector notes, prior fixes | Reusable integration pattern memory |
| Client X | docs, chats, files, tasks | Work memory for one client |
| Personal finance | conversations, files, future connectors | Human external memory domain |
| Agent operating rules | no folder required | Cross-project behavior guidance |

## Interface Language

The UI must speak like a professional assistant, not like a database viewer.

Use this style:

| Instead of showing | Show by default |
| --- | --- |
| `embedding_route` | Local search by meaning |
| `use_policy: instruction_grade` | Active rule |
| `scope_kind: developer` | Applies to all your projects |
| `needs_review` | Needs your decision |
| `agent_memory_type: constraint` | Rule or constraint |
| `project_id` | Project short ID only in a badge or technical details |
| JSON settings blocks | Short explanation, with technical value collapsed |

Technical details are still important, but they should be behind "Technical
details", "Advanced", or API/debug views.

The first screen should answer human questions:

- What needs my attention?
- What is safe and already working?
- Which projects/memory spaces are active?
- Are agents actually recording memory?
- What did Recallant recently capture?
- What action is recommended next?
- What will happen if I confirm this cleanup or rule change?

## Upstream UI Lessons

### OB1 / Open Brain

OB1 is closest to the larger idea of human external memory. It is useful as a
philosophical and workflow reference: a person has one memory layer, and AI
clients can use it.

Take:

- human external-memory framing;
- dashboard sections for memory quality and trust;
- source/provenance visibility;
- review and recall-trace concepts.

Avoid:

- making the UI feel like only a developer database dashboard;
- assuming the human will manually manage every memory item.

### MF0-1984

MF0 is the best reference for a real workbench where a person works with AI.
Its memory tree, project profile, local workspace, context building, and
provider handling are useful product ideas.

Take:

- workbench structure;
- memory/tree navigation ideas;
- project profile import/export thinking;
- context-building flow;
- server-side provider handling.

Avoid:

- copying product-specific modes directly;
- forcing Recallant to become one monolithic chat app.

### AgentMemory

AgentMemory is the best reference for showing whether agents are really
capturing memory. Its live viewer and replay direction are important for trust:
the owner should see that Recallant is not just configured, but active.

Take:

- live activity status;
- session replay/timeline;
- capture-active checks;
- client connection status;
- skills/onboarding language that teaches agents what to do.

Avoid:

- using a raw technical event viewer as the main product interface;
- treating automatic capture as a replacement for governed review.

### MemPalace

MemPalace is useful for archive/search/recovery flows. It is strong when the
question is "what did we say or do before?"

Take:

- search-first recovery;
- transcript/file mining;
- hooks around session end and compaction.

Avoid:

- palace metaphors as required product language;
- showing too much raw archive content on first screens.

### Journey

Journey is useful for simple onboarding and reusable workflows.

Take:

- guided setup;
- preflight checks;
- clear install outcome reports;
- reusable profile/kit thinking.

Avoid:

- making Recallant depend on a separate packaging platform for core memory.

## Recallant UI Template Direction

The target workbench should feel like a private professional control room, not
a marketing page and not a raw admin table.

Use this first-level structure:

1. **Command Center**
   - what needs attention;
   - recent capture status;
   - active projects/memory spaces;
   - safe recommended next step.

2. **Memory Spaces**
   - projects as logical memory areas;
   - attached sources such as folders, repos, servers, documents, connectors;
   - current isolation/sharing policy in plain language.

3. **Review**
   - items needing a human decision;
   - proposed rules;
   - conflicts and duplicates;
   - source evidence before trust-changing actions.

4. **Activity / Replay**
   - recent sessions;
   - whether the agent started from Recallant;
   - what was captured;
   - what context was returned.

5. **Ask Recallant**
   - natural-language management chat;
   - answers in the owner's language;
   - action plans for risky requests;
   - confirmation gates for destructive/cost/security changes.

6. **Settings**
   - plain summaries first;
   - automatic defaults visible;
   - advanced technical values collapsed;
   - dangerous changes confirmation-gated.

## AI-First Operating Model

Recallant should not rely mostly on hard-coded keyword rules for understanding
the owner. It should use AI when meaning matters.

Use AI for:

- understanding plain-language requests;
- choosing the likely memory space;
- finding relevant prior examples;
- extracting decisions, rules, and lessons;
- explaining why something is risky;
- proposing cleanup;
- translating technical state into normal language.

Use deterministic policy for:

- access control;
- irreversible deletion;
- secrets;
- public exposure;
- production service changes;
- paid API calls;
- storage integrity;
- audit records.

The product should feel automatic by default. Settings exist for control, but
ordinary users should not need to tune them before Recallant is useful.
