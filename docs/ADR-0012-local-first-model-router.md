# ADR-0012: Local-first model router

## Status

Accepted, refined by [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md), [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md), and [ADR-0032-paid-api-confirmation-and-cost-dashboard.md](ADR-0032-paid-api-confirmation-and-cost-dashboard.md)

## Context

Recallant must not depend on one model or one provider for all memory work. The owner has a Linux server with local compute/GPU capacity, but also wants access to stronger non-local reasoning for tasks where quality matters.

Basic memory append/search must work without external providers. Stronger non-local reasoning is escalation/fallback, not a dependency for core recall. Escalation is subscription-first and API-last: a ChatGPT/Codex subscription is not a generic API replacement, but supported OAuth/sign-in subscription routes may be used as a separate subscription-backed route when available and compliant with provider rules.

## Decision

Design Recallant with a **local-first model router**.

Routing defaults:

- local embeddings/search by default,
- cloud embeddings fallback when local embeddings are unavailable or quality policy requires it,
- local LLM for simple extraction, classification, cleanup, and consolidation when good enough,
- stronger model route for complex closeout, ambiguous intent, quality-critical summaries, difficult extraction, or low-confidence local results, ordered as active agent / subscription-backed worker before paid API where possible,
- Postgres lexical search remains available without any embedding or external provider.

Every model call must be logged with:

- provider,
- model,
- purpose,
- project/domain/session context where available,
- input/output token estimates or actuals where available,
- estimated or actual cost where available,
- latency,
- success/failure status,
- routing reason.

The router must distinguish these route classes:

- `local_model`,
- `active_agent`,
- `subscription_worker`,
- `paid_api_provider`.

If subscription-backed routes hit limits, Recallant must pause, defer, downgrade to local models, or create an explicit approval request before using paid API. It must not silently convert subscription exhaustion into paid API spend.

Baseline dated defaults are defined in [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md). Model IDs are operational settings, not architecture invariants.

## Consequences

- Recallant remains useful offline or when cloud APIs fail.
- Subscription-backed and paid API usage can be audited, disabled, budgeted, and reasoned about separately.
- Model routing is part of Recallant's memory runtime, not a generic all-purpose LLM gateway.
- Implementation needs provider adapters and a durable model call audit table.
- The router can begin rule-based; an LLM-based router is optional later and must not be required for basic recall.

## Non-goal

This ADR does not turn Recallant into a universal provider gateway for unrelated applications. Routing is for Recallant memory tasks: embedding, retrieval/rerank, extraction, consolidation, closeout, review assistance, cleanup, and similar memory lifecycle operations.

## Open questions

- What exact daily/job/project cost ceilings should be offered if the owner later enables `auto_with_caps`?
- Which task categories should be allowed to request paid API approval in v1 versus always defer?
