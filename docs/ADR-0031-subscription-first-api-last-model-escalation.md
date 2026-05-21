# ADR-0031: Subscription-first, API-last model escalation

## Status

Accepted, refined by [ADR-0032-paid-api-confirmation-and-cost-dashboard.md](ADR-0032-paid-api-confirmation-and-cost-dashboard.md)

## Context

The owner already pays for intensive vibe-coding subscriptions such as Codex and may also use other agent subscriptions. AMP must not become a hidden second source of high token/API spend.

OpenAI API usage is a separate paid token-based route and is billed separately from ChatGPT/Codex subscriptions. A ChatGPT subscription must not be treated as a generic API replacement.

However, subscription-backed agent usage is different from generic API usage. Codex can be used through supported clients and OAuth/sign-in flows tied to an existing ChatGPT/Codex plan. Other agent tools may expose similar provider-supported subscription routes. If such a route works within subscription limits and provider rules, AMP may treat it as a distinct model route.

## Decision

Refine the model-router decision from "cloud escalation" to **subscription-first, API-last escalation**.

AMP model routing has four route classes:

1. `local_model`: self-hosted/local models for embeddings, search, extraction, cleanup, and simple consolidation.
2. `active_agent`: the currently open agent session, such as Codex, performs reasoning using its already active subscription/session and writes results to AMP through MCP tools.
3. `subscription_worker`: a background/local/server worker using supported OAuth/sign-in subscription mechanisms and existing plan limits, when available and compliant with current provider rules.
4. `paid_api_provider`: direct token-billed API usage such as OpenAI API, Gemini API, Claude API, or compatible paid gateways.

Variant B remains accepted, but with this stricter meaning:

```text
Variant B = subscription-first, API-last
```

Automatic use of stronger models should prefer this order:

1. current active agent, if a session is already open and suitable;
2. subscription worker, if configured, authenticated, and within limits;
3. local downgrade or defer/pending queue if the subscription route is unavailable or rate-limited;
4. paid API only after explicit confirmation by default, unless a future scoped `auto_with_caps` policy is explicitly enabled.

If subscription limits are exhausted, AMP must not silently fall through to paid API. It should pause, defer, downgrade to local models, or create an explicit paid API approval request according to policy.

AMP must explicitly avoid:

- browser automation against ChatGPT as a hidden API,
- scraping ChatGPT output,
- using undocumented/private endpoints,
- attempts to bypass provider limits,
- hiding paid API usage behind a generic "cloud" label.

## Routing examples

Session closeout:

```text
active_agent
  -> local_model
  -> subscription_worker if available
  -> paid_api_provider only after explicit approval by default
```

Nightly consolidation:

```text
local_model
  -> subscription_worker if quota is available
  -> defer/pending if quota is exhausted
  -> paid_api_provider only after explicit approval by default
```

Important conflict review:

```text
active_agent if session is open
  -> subscription_worker
  -> paid_api_provider with explicit approval, budget guard, and review/audit visibility
```

## Audit requirements

Every routed model/agent intelligence call must record enough metadata to explain cost and behavior later:

- `route_class`: `local_model`, `active_agent`, `subscription_worker`, or `paid_api_provider`,
- provider/client identity where safe,
- model where known,
- purpose,
- routing reason,
- subscription/limit status when available,
- estimated/actual paid API cost when applicable,
- confirmation/budget decision when paid API is used,
- status and error code.

Subscription-backed usage may have no direct API dollar cost, but it still consumes plan limits/credits and must be visible in audit and diagnostics.

## Consequences

- AMP remains financially aligned with the owner's workflow: already-paid agent subscriptions are used before extra API spend.
- "Cloud escalation" no longer means "paid API by default."
- Paid API remains available for quality-critical cases, but default v1 behavior requires explicit approval. Future unattended paid API requires scoped `auto_with_caps` policy and dashboard-backed monitoring.
- Implementation needs provider/worker capability detection: not every client can provide an `active_agent` or `subscription_worker` route.
- Subscription OAuth/sign-in integration must stay on supported mechanisms and must be revisited if provider policies change.

## Non-goals

- This ADR does not make ChatGPT subscription a universal API.
- This ADR does not require implementing any specific third-party subscription worker in v1, but the model router must leave a clean route class for supported subscription-backed workers.
- This ADR does not permit scraping, browser automation, hidden endpoints, or limit bypass.

## Sources checked

- OpenAI Codex with ChatGPT plan: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/
- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- OpenAI Codex rate card: https://help.openai.com/en/articles/20001106
- OpenAI Terms of Use: https://openai.com/policies/terms-of-use/
