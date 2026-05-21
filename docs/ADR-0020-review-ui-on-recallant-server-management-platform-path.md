# ADR-0020: Review UI runs on Recallant server with management platform path

## Status

Accepted, refined by [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md)

## Context

Recallant v1 requires a Review UI for governed-memory hygiene. The owner clarified where this UI should live:

- it should run on the Recallant server,
- v1 starts as a compact private workbench rather than a simple approval page,
- the long-term direction is a fuller management platform,
- future access may be through a dedicated Cloudflare-managed subdomain because the owner's Linux server already hosts several Cloudflare-managed projects,
- exact Cloudflare routing/auth details will be provided later,
- the owner has now confirmed that Cloudflare access should be considered near-future, while v1 still starts private-by-default.

## Decision

The Review UI is a Recallant-server-hosted surface.

For v1:

- run the Review UI on the Recallant server,
- make the first implementation a compact private workbench, not an approval-only table,
- keep it connected to the same server-side policy path as MCP/CLI review actions,
- keep it private by default through localhost/Tailscale/SSH tunnel or equivalent private access,
- require Recallant-level auth/session even on private access.

For evolution:

- design the Review UI as the first step toward a full Recallant management platform,
- allow the UI to grow into broader management views for projects, capture profiles, review queues, rules, sessions, sync state, model routing, cost, and later domain expansion,
- include a paid API cost dashboard in v1 because paid API is confirmation-first and must be financially visible,
- include a top-level project list/selector so a Cloudflare/subdomain entrypoint can manage multiple Recallant projects,
- support future deployment behind a dedicated Cloudflare-managed subdomain when the owner provides details,
- design routing/auth/session boundaries so Cloudflare can be added without rewriting the Review UI/admin API,
- do not make Cloudflare a hard dependency for local/private v1 use.

## Consequences

- Review UI is not a Codex UI and not a per-project static page. It is part of the Recallant server product surface.
- The UI can be implemented as a separate web process or bundled web app, but operationally it belongs to the Recallant server deployment.
- The initial UI should avoid becoming a full admin platform, but it must include the compact v1 workbench areas accepted in ADR-0033 and its routing/API shape should not block future management-platform expansion.
- Public/subdomain access must not be enabled by default. Cloudflare access is a near-future deployment mode requiring explicit owner configuration, edge auth such as Cloudflare Access, and Recallant auth.

## Open questions

- Which Cloudflare mode should be used later: regular proxied subdomain, Cloudflare Tunnel, Cloudflare Access, or another setup?
- What subdomain naming convention should be used?
- Which simple Recallant auth model should v1 use: single admin password, local admin token, session cookie, or another single-user mechanism?
- Should v1 use a separate UI process such as `recallant-review-ui`, or serve the UI from the same HTTP service as the admin API?
- Which management-platform sections follow after governed-memory review and the required paid API cost dashboard: capture profiles, sessions/recovery, sync/spool state, or broader model routing?
