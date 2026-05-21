# ADR-0032: Paid API confirmation and cost dashboard

## Status

Accepted

## Context

AMP is designed to reduce repeated context loss without creating a new uncontrolled cost center.

The owner expects most work to be handled by:

1. local models,
2. the currently active paid agent subscription,
3. supported subscription-backed workers,
4. only then direct paid API if really necessary.

If this architecture works well, direct API calls may rarely be needed at all. Therefore paid API usage must be treated as exceptional and visible, not a hidden automatic fallback.

## Decision

Use **Option C** as the v1 default for direct paid API:

```text
Every paid API request requires explicit confirmation by default.
```

AMP should first try:

1. local route,
2. active-agent route,
3. subscription-worker route,
4. downgrade/defer/pending queue.

Only if direct paid API is still needed, AMP creates an approval request instead of calling the API silently.

The owner can later enable automatic paid API for selected projects/tasks only after the cost dashboard shows that actual usage is zero or acceptably small. That future relaxation must be explicit, scoped, and budgeted.

## Required v1 behavior

- Default `paid_api_mode` is `confirm_each`.
- Background/night jobs must not call paid API automatically by default.
- Paid API fallback after subscription limit exhaustion is never silent.
- Paid API approval must show purpose, project, provider/model, estimated tokens/cost, routing reason, and fallback alternatives already attempted.
- If the owner denies or ignores approval, AMP defers the task or downgrades to local/subscription routes according to policy.
- Paid API keys remain server-side and are never exposed to browser clients.

## Cost dashboard

AMP v1 must include a cost dashboard in the AMP management UI.

The dashboard should show near-real-time operational cost visibility from AMP audit data:

- current day paid API estimate,
- current month paid API estimate,
- cost by project,
- cost by provider/model,
- cost by purpose,
- pending paid API approval requests,
- denied/approved paid API requests,
- subscription-worker limit status when available,
- recent model calls and route class breakdown.

Provider billing portals remain the billing source of truth. AMP's dashboard is an operational safety view based on `model_calls`, approval records, and provider cost metadata when available.

## Future relaxation

After observing real usage, the owner may enable automatic paid API under strict caps:

```text
paid_api_mode = auto_with_caps
scope = project/task/profile
budget = explicit
dashboard = required
audit = required
```

This is not the v1 default. It is an explicit owner-controlled mode.

## Consequences

- AMP is financially conservative by default.
- The platform may pause or defer some background tasks instead of spending money.
- The management UI must include cost visibility early, not as a later analytics add-on.
- Tests must prove that paid API is not invoked without approval in the default profile.

## Non-goals

- This ADR does not remove paid API support.
- This ADR does not require exact provider invoice reconciliation in v1.
- This ADR does not allow browser scraping, hidden API use, or limit bypass as a substitute for paid API.
