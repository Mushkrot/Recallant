# ADR-0007: Local server first with personal-memory expansion path

## Status

Working direction

## Context

The owner expects to run Recallant on a personal Linux server with a capable GPU. The same system may later expand beyond AI coding-agent memory into broader human external memory, closer to the original OB1 vision.

## Decision

Recallant should be **local/server-first** and **personal-memory extensible**.

For v1:

- The core store runs on the owner's server.
- Postgres/pgvector remains the source of truth.
- Local/self-hosted embeddings are the default.
- External LLM providers are optional for consolidation, review assistance, rerank, extraction, or harder analysis.
- Coding-agent memory remains the first product domain.

For future expansion:

- The data model should avoid hard-coding assumptions that every memory is a coding artifact.
- Projects may represent repositories, subprojects, workspaces, or later personal domains.
- Memory records should retain scope, provenance, review/use policy, and source refs so personal-life memory can use the same safety model.

## Consequences

- The system should support background/nightly jobs that can use local GPU capacity.
- Local capture/spool and server offload are valid ingestion patterns.
- External provider usage must be configurable and not required for basic recall.
- Personal memory is not v1 scope, but it is an explicit architectural expansion path.

## Open questions

- Should personal-life memory share the same Postgres instance with separate `memory_domain`, or live in a separate Recallant deployment?
- What connectors are first for personal memory: browser history, notes, email, calendar, files, chat transcripts, or manual capture?
- How much automatic observation is acceptable before explicit review/consent is required?
