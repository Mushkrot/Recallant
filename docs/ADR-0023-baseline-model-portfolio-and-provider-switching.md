# ADR-0023: Baseline model portfolio and provider switching

## Status

Accepted, refined by [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md) and [ADR-0032-paid-api-confirmation-and-cost-dashboard.md](ADR-0032-paid-api-confirmation-and-cost-dashboard.md)

## Context

AMP should not depend on one provider route or one "best" model. Model quality, latency, pricing, subscription limits, and availability change quickly. The owner wants local models, active-agent/subscription-backed routes, OpenAI, Gemini, and Claude available in perspective, with a practical baseline now and the ability to switch by project/task later.

Accepted provider hierarchy:

1. Local models remain the default for core memory work where quality is sufficient.
2. Active agent reasoning and supported subscription-backed routes should be used before paid API where possible.
3. OpenAI is the baseline paid API provider/profile when paid API fallback or quality escalation is explicitly approved.
4. Gemini and Claude cheap/fast models are optional alternate paid API routes.
5. Expensive Gemini/Claude models are explicit quality/experiment opt-ins, not defaults.

Current public provider state checked on 2026-05-20:

- OpenAI docs list `gpt-5.5` as the latest flagship model, with `gpt-5.4` and `gpt-5.4-mini` as lower-cost/lower-latency options.
- OpenAI docs list `text-embedding-3-small` and `text-embedding-3-large` as embedding options.
- Google Gemini docs list `gemini-3.5-flash` as a stable current Flash model, but current pricing makes it a stronger/expensive route rather than the default Gemini route.
- Google Gemini docs/pricing also list `gemini-2.5-flash` and `gemini-2.5-flash-lite`; these are better default Gemini candidates when the goal is speed/cost balance.
- Google Gemini docs list `gemini-3.1-pro-preview` as a preview Pro model and Gemini embedding models as embedding options.
- Anthropic docs list Claude Opus/Sonnet/Haiku tiers, currently `claude-opus-4-7`, `claude-sonnet-4-6`, and `claude-haiku-4-5`.
- Ollama exposes local candidates such as `nomic-embed-text`, `gpt-oss:20b`, and `qwen3-coder:30b`.

These model IDs are dated operational defaults, not permanent architecture invariants.

Important Gemini cost interpretation: `gemini-3.5-flash` is a strong current Flash model, but it should not be treated as the cheap/default Gemini route. Price-sensitive Gemini routing should prefer `gemini-2.5-flash-lite`; balanced Gemini routing should prefer `gemini-2.5-flash`. `gemini-3.5-flash` belongs only in explicit stronger/quality or experiment routes.

## Decision

Use a configurable model router with a baseline model portfolio.

The normal default is **local-first + subscription-first + OpenAI API baseline only after paid API approval**. Gemini and Claude are kept available as optional providers, primarily through their cheaper/faster models. The router must not silently choose paid API, or expensive non-OpenAI models, just because they are available.

### Baseline route profile

This is the initial recommended profile for the owner's server:

| Purpose | Primary route | Fallback / optional alternate |
|---------|---------------|-------------------------------|
| Lexical search | Postgres `tsvector`/`pg_trgm` | none |
| Routine embeddings | `ollama/nomic-embed-text` | paid API fallback: `openai/text-embedding-3-small`; optional Gemini embeddings only by setting |
| Query embeddings | same as indexed chunks | same provider family as the index; changing provider/dims requires reindex |
| Simple extraction/classification | `ollama/gpt-oss:20b` | active-agent/subscription-backed route before paid API; paid API fallback: `openai/gpt-5.4-mini`; optional cheap routes: `gemini/gemini-2.5-flash-lite`, `gemini/gemini-2.5-flash`, `anthropic/claude-haiku-4-5` |
| Local code-heavy assistance | optional `ollama/qwen3-coder:30b` | active-agent/subscription route; paid API strong model only after approval |
| Complex closeout / quality-critical summary | active agent or `subscription_worker` when available; otherwise paid API baseline: `openai/gpt-5.4` only after approval | optional cheap/balanced paid alternate: `gemini/gemini-2.5-flash`; Claude Sonnet only by explicit quality profile |
| Highest-quality architecture/recovery work | active agent or `subscription_worker` first; otherwise paid API baseline: `openai/gpt-5.5` only after approval | Claude Opus / Gemini Pro or Gemini 3.5 Flash only by explicit quality/experiment profile |
| Long-context or multimodal cloud tasks | task-specific; subscription-backed route first when suitable; paid OpenAI baseline only after approval | optional Gemini route when its context/multimodal/tool profile is the reason |

### Provider switching

The router must support provider switching at server, developer, project, and session/task levels through settings:

- provider enabled/disabled,
- baseline paid API provider selection, default `openai`,
- model per purpose,
- allowed preview/experimental models,
- local-first/subscription-first/API-last mode,
- paid API mode: default `confirm_each`; optional future `auto_with_caps`,
- cost ceilings for future `auto_with_caps`,
- quality/confidence thresholds,
- fallback order.

Project settings may choose a different profile without changing other projects.

### Preview and latest aliases

Stable exact model IDs are preferred for normal operation. Preview/experimental models are allowed only when explicitly enabled for a project/session or through a named experiment profile.

Avoid using `latest` aliases as durable production defaults because they can change under the same name. They may be used in explicit evaluation jobs.

### Embedding compatibility

Embeddings from different models or dimensions are not interchangeable. Switching embedding model/dims requires explicit reindex/migration and must not silently mix incompatible vectors in the same search index.

### Audit

Every model call, local/subscription-backed or paid API, must be logged in `model_calls` with route class, provider, model, purpose, routing reason, cost or quota metadata when available, latency, and status.

## Consequences

- AMP has a practical starting point while keeping provider choice flexible.
- OpenAI is the baseline paid API profile when direct API fallback/escalation is explicitly approved.
- Gemini Flash/Flash-Lite and Claude Haiku are first-class optional cheap/fast router candidates, not afterthoughts.
- Gemini 2.5 Flash is the default balanced Gemini route.
- Gemini 2.5 Flash-Lite is the default cheap/fast Gemini route.
- Gemini 3.5 Flash is not a normal default because its current price is much higher; use it only through explicit opt-in.
- Claude Sonnet/Opus remain available only as explicit quality routes, not cheap/default routes.
- Paid API model use remains an approval-gated escalation path, not a dependency for core append/search.
- Model names and prices must be revisited before implementation and periodically after release.

## Non-goals

- This ADR does not create a universal model gateway for unrelated applications.
- This ADR does not require all providers to be implemented in the first implementation slice. It requires the router/contracts/settings to make provider addition and switching straightforward.
- This ADR does not freeze exact model IDs forever.

## Sources checked

- OpenAI models: https://developers.openai.com/api/docs/models
- OpenAI latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI embeddings: https://developers.openai.com/api/docs/guides/embeddings
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini 2.5 Flash: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
- Gemini 3.5 Flash: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini Embedding 2: https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2
- Claude models: https://platform.claude.com/docs/en/about-claude/models/overview
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Ollama `nomic-embed-text`: https://ollama.com/library/nomic-embed-text
- Ollama `gpt-oss`: https://ollama.com/library/gpt-oss
- Ollama `qwen3-coder`: https://ollama.com/library/qwen3-coder
