# Roadmap

Recallant is pre-release. Its defining goal is not to become a larger Codex activity system; it is
to make governed Project Memory continue across agent clients and, after that, become useful to
people working with permitted documents.

The normal beginner path remains:

```bash
recallant onboard <project>
```

The published baseline is `v0.1.0-dev.0`. It includes the pinned install path, synthetic-data
Workbench screenshots, release gates, CodeQL, rollback, and managed-runtime proof. The milestones
below describe product maturity beyond that development prerelease.

## Current Baseline

Recallant already provides a working Codex-first memory slice:

- self-hosted Postgres/pgvector storage and scoped project identity;
- MCP sessions, Context Packs, governed memories, source refs, checkpoints, and closeout;
- automatic native Codex capture with truthful freshness diagnostics;
- authenticated remote MCP, offline spool, backup/restore, erasure, and audit paths;
- Workbench ask, review, source, activity, and project-management surfaces;
- bounded graph relations, candidate review, promotion, and one-hop retrieval;
- public install, onboarding, security, browser, and product acceptance gates.

This baseline is real, but it does not yet prove the original multi-client product promise. Claude
Code, Cursor, Windsurf, and generic MCP clients can receive configuration, but Recallant does not
yet have native lifecycle/capture parity or a real Codex -> Claude Code -> Codex acceptance gate.
Broad document-folder ingestion and human document question answering are also not delivered.

## Sequencing Rule

The milestones below are ordered. Additional graph depth, observability features, broad
orchestration, team workflows, and connector expansion are not roadmap drivers unless they are
required to pass the active milestone's user scenario.

Operational hardening, security, backup, erasure, project isolation, public readiness, and the
shipped portfolio evidence remain continuous obligations rather than competing product milestones.

## Milestone 1: Cross-Client Continuity v1

Deliver one Project Memory that real Codex and Claude Code sessions can both read and extend.

Required product work:

- add a native, fail-soft Claude Code adapter with the same project identity and governance
  boundaries as the Codex adapter;
- produce a bounded Project Continuity Pack containing the current objective, accepted decisions,
  constraints, relevant artifacts, verification, blockers, checkpoint, and next action;
- make client and adapter capability explicit: configured, context-ready, memory-loop-ready, and
  capture-active must remain separate facts;
- reuse proven adapter patterns from AgentMemory and MemPalace without adopting their storage or
  project-identity assumptions as Recallant's authority;
- keep local and authenticated remote paths within the same lifecycle contract.

Acceptance requires an automated, inspectable real-client journey:

1. Codex starts a project task and writes meaningful project memory.
2. Claude Code opens the same project without a pasted recap, receives the continuity pack, and
   continues the work.
3. Claude Code records its decisions, evidence, checkpoint, and next action.
4. Codex resumes from that state without a human reconstructing context.
5. Restart, same-name project isolation, offline/spool recovery, and deletion boundaries remain
   correct.

Generic MCP subprocesses labeled as different clients are useful protocol tests, but they do not
satisfy this milestone.

## Milestone 2: Human Document Memory MVP

Let an owner explicitly attach a permitted folder and ask questions over the same governed source
layer used by agents.

Initial source types:

- Markdown;
- plain text;
- PDF;
- DOCX.

The MVP must include:

- explicit folder selection and consent; no broad filesystem crawl by default;
- stable source identity, version/hash, extraction status, and provenance;
- incremental add, update, rename, and delete behavior;
- extracted text and chunks kept distinct from original source bytes, generated synthesis,
  governed memories, and instruction-grade rules;
- source-cited answers with inspectable document and location references;
- secret/risk classification, project/domain isolation, export, erasure, backup, and restore;
- one governed query-and-answer contract for Workbench users and agent clients.

MemPalace is the primary implementation reference for document extraction and backend breadth.
Recallant keeps its own governance, source authority, project identity, review, and lifecycle model.

## Milestone 3: Task Handoff Record

After real cross-client continuity works, add a first-class Recallant-owned Task Handoff Record
inspired by the useful process layer of Open Engine.

The record should include:

- objective, status, owner/current actor, and allowed actions;
- boundaries and acceptance checks;
- source refs, relevant decisions, artifacts, and verification evidence;
- checkpoint, blockers, open questions, and next action;
- claim, pause, resume, finish, and evidence-backed receipt semantics.

Recallant will not depend on Linear or another hosted task system. Project Memory and the Task
Handoff Record remain authoritative in Recallant. Plane or another self-hosted task manager may be
evaluated later as an optional External Task Adapter or human board; it must not become a required
backend or a second memory authority.

Recallant is not building a full Jira/Linear replacement. The scope is only the task state needed
to move governed work safely between agents and people.

## Milestone 4: Broader Human Memory

Only after the document MVP is reliable, expand through separately governed sources and interfaces:

- Obsidian and other Markdown vaults;
- links and web sources;
- email and messaging;
- audio, images, and video;
- broader personal or team knowledge domains;
- richer connectors and optional human workflow integrations.

Each source class needs explicit consent, provenance, update/deletion semantics, retention, and
review boundaries. A connector never grants permission to turn source text into accepted memory or
binding instructions automatically.

## Deprioritized Until Required

- new graph databases, automatic graph promotion, or multi-hop graph expansion;
- additional observability and replay depth beyond what continuity diagnosis needs;
- broad autonomous-agent orchestration;
- a full task-management suite;
- passive two-way vault synchronization;
- team/multi-user permissions before the single-owner cross-client and document loops work.

Existing graph and observability capabilities remain supported and tested. Deprioritized means no
new expansion by default, not removal of the shipped safety or diagnostic foundation.

## Release-Candidate Bar

Before a release-candidate tag, Recallant should have:

- the real Codex -> Claude Code -> Codex continuity gate;
- repeat external-host onboarding, remote access, rollback, and recovery rehearsal;
- broader real-project migration and same-name project-isolation pilots;
- the shipped autonomous Workbench browser QA and synthetic-data screenshot set kept reproducible;
- independent security hardening and passing public readiness/security gates;
- stable versioned packaging and an operator-visible upgrade path.

A first release candidate may be cut after Cross-Client Continuity if the existing safety and
operations contract is stable enough. Human Document Memory remains the next product milestone even
if it ships in a later version.

## Codex For OSS Use

If selected for Codex for OSS support, Recallant will use Codex/API credits primarily to improve:

- native multi-client adapters and real-client acceptance;
- Project Continuity Pack quality and evaluation;
- document extraction, citation, update, and deletion tests;
- security, onboarding, recovery, and release hardening;
- concise public documentation and reproducible product proof.
