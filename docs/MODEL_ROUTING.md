# Model routing

AMP uses a **local-first, subscription-first, API-last model router**. Local models are the default for basic memory work. Stronger non-local reasoning first tries the active agent or supported subscription-backed routes. Direct paid API providers are exceptional fallback/escalation paths and require explicit confirmation by default. See [ADR-0012-local-first-model-router.md](ADR-0012-local-first-model-router.md), [ADR-0031-subscription-first-api-last-model-escalation.md](ADR-0031-subscription-first-api-last-model-escalation.md), and [ADR-0032-paid-api-confirmation-and-cost-dashboard.md](ADR-0032-paid-api-confirmation-and-cost-dashboard.md).

## 1. Accepted principle

Model routing is a product feature, not an afterthought.

- Basic append/search must work without cloud APIs.
- Basic lexical search must work even if embeddings are temporarily unavailable.
- Local server/GPU should handle routine embeddings, indexing, cleanup, and background consolidation when practical.
- A ChatGPT/Codex subscription is not a generic API replacement.
- Supported OAuth/sign-in subscription routes may be used as a separate route when available, within limits, and compliant with provider rules.
- Paid API providers are allowed for fallback/escalation where they materially improve quality or keep the pipeline available, but they are API-last and confirmation-first by default.
- Paid API providers are not a dependency for core recall.
- Cost, latency, privacy, and quality must be explicit routing inputs.
- AMP must not use browser automation, scraping, hidden APIs, or limit-bypass behavior.

## 1.1 Route classes

| Route class | Meaning | Cost behavior |
|-------------|---------|---------------|
| `local_model` | Local/Ollama/Postgres/self-hosted model work | no external token bill |
| `active_agent` | The currently open Codex or other agent session reasons and calls AMP tools | consumes the active agent/session subscription or quota |
| `subscription_worker` | Background/local/server worker using supported OAuth/sign-in subscription mechanisms | consumes existing plan limits/credits, not direct API billing |
| `paid_api_provider` | Direct API call to OpenAI/Gemini/Claude/compatible provider | billed separately by provider/token/credit policy |

If a subscription-backed route hits limits, AMP pauses, defers, downgrades to local models, or creates an approval request before using paid API. It never silently falls through to paid API.

## 2. Model task classes

| Task | Default | Fallback / escalation |
|------|---------|-----------------------|
| Embeddings for routine chunks | local Ollama embedding model | cloud embeddings if local unavailable or quality is insufficient |
| Query embedding | local | cloud fallback |
| Lexical search | Postgres | none |
| Hybrid rerank | local/simple scoring | active agent or subscription worker for hard queries; paid API only after approval by default |
| Memory extraction from closeout | active agent when session is open; otherwise local LLM if good enough | subscription worker; paid API only after approval by default |
| Ambiguous closeout/intent detection | local classifier/LLM | active agent/subscription worker; paid API only when ambiguity remains and approval is granted |
| Quality-critical summary/checkpoint | active agent or local LLM if confidence is high | subscription worker; paid API for final quality pass only after approval by default |
| Instruction/policy classification | local first | active agent/subscription worker if low confidence; paid API only after approval by default |
| Long-session consolidation | local overnight job | subscription worker if quota is available; otherwise defer; paid API only after approval by default |
| Personal-life future extraction | not v1 | separate policy required |

## 3. Routing policy dimensions

The router should consider:

- task type,
- project/domain sensitivity,
- expected token/input size,
- latency requirement,
- cost budget,
- subscription quota/limit status,
- local model availability,
- active-agent availability,
- subscription-worker availability,
- confidence threshold,
- user override.

## 4. Provider examples

Local:

- Ollama embeddings,
- local reranker/classifier,
- local LLM on the server GPU for nightly consolidation.

Subscription-backed:

- active Codex session through MCP tools,
- subscription worker through supported OAuth/sign-in mechanisms, if configured.

Paid API:

- OpenAI for baseline paid API embeddings, structured extraction, and high-quality summaries,
- Gemini cheap/balanced Flash routes as optional alternatives,
- Anthropic/Claude Haiku as an optional cheap/fast alternative,
- Claude Sonnet/Opus and expensive Gemini routes only through explicit quality/experiment profiles,
- other providers behind the same adapter contract when explicitly added.

Provider names are examples. The architecture should keep a provider adapter layer so choices can change.

## 5. Baseline model portfolio

See [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md).

Initial default profile: local-first, subscription-first, API-last, paid-API-confirm-each. OpenAI is the baseline **paid API** provider only when paid API use is explicitly approved. Gemini and Claude cheap models are optional switchable paid API routes.

| Purpose | Primary route | Switchable alternatives |
|---------|---------------|-------------------------|
| Routine embeddings | `ollama/nomic-embed-text` | paid API fallback `openai/text-embedding-3-small`; optional `gemini/gemini-embedding-001`, `gemini/gemini-embedding-2` |
| Simple extraction/classification | `ollama/gpt-oss:20b` | active agent / subscription worker before paid API; paid API baseline `openai/gpt-5.4-mini` only after approval; optional cheap `gemini/gemini-2.5-flash-lite`, `gemini/gemini-2.5-flash`, `anthropic/claude-haiku-4-5` |
| Optional local code-heavy assistance | `ollama/qwen3-coder:30b` | active-agent/subscription route; paid API strong model only after approval |
| Complex closeout / quality-critical summary | active agent or subscription worker first; paid API baseline `openai/gpt-5.4` only after approval by default | optional `gemini/gemini-2.5-flash`; Claude Sonnet only by explicit quality profile |
| Highest-quality architecture/recovery work | active agent or subscription worker first; paid API baseline `openai/gpt-5.5` only after approval by default | Claude Opus / Gemini Pro / Gemini 3.5 Flash only by explicit quality/experiment profile |

These are dated operational defaults as of 2026-05-20. Exact models must be configurable and reviewed before implementation/release. Stable exact IDs are preferred for normal use; preview/experimental models require explicit opt-in.

Gemini-specific routing note: use `gemini/gemini-2.5-flash-lite` for price-sensitive fast cloud work and `gemini/gemini-2.5-flash` for balanced Gemini work. Use `gemini/gemini-3.5-flash` only as an explicit stronger/expensive Gemini route, not as a normal default.

Claude-specific routing note: use `anthropic/claude-haiku-4-5` as the cheap/fast Claude option. Sonnet/Opus are not part of the cheap optional profile; they require an explicit quality route.

## 6. Required behavior

- Every model/agent intelligence call must record route class/provider/model/purpose/cost or quota metadata in durable `model_calls` audit records.
- Subscription-backed and paid API use must be separately configurable and disableable.
- Re-embedding with a different embedding model requires explicit reindex.
- The system should degrade gracefully: if cloud is unavailable, basic memory search still works.
- Stronger-model escalation should record a routing reason such as `fallback_unavailable`, `low_confidence`, `quality_critical`, `complex_closeout`, or `user_requested`.
- Provider/model defaults must be settings, not hard-coded business logic.
- The router must expose the effective route and source setting in UI/CLI diagnostics.
- `latest` aliases must not be used as durable production defaults unless the owner explicitly enables them for an experiment.
- The default paid API provider is OpenAI unless project/session settings override it.
- Gemini/Claude cheap routes must be opt-in profiles or fallback entries, not silent replacements for the OpenAI paid API baseline.
- Browser automation, scraping, hidden APIs, and attempts to bypass subscription/provider limits are disallowed routes.
- Default paid API mode is `confirm_each`: every direct paid API call creates an approval request before execution.
- Automatic paid API requires an explicit future `auto_with_caps` project/task/profile setting and active cost dashboard monitoring.
- The AMP management UI must expose near-real-time paid API cost and approval status.

## 7. Open decisions

- What exact cost ceilings should be offered when the owner later enables `auto_with_caps`?
- Which provider adapters are implemented in the first coding slice versus added after the router contract exists?
