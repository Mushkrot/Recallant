# ADR-0029: Private-by-default access with AMP auth and Cloudflare-ready path

## Status

Accepted

## Context

AMP stores sensitive project memory, raw workflow evidence, governed memories, settings, model-provider metadata, and future personal-memory-adjacent data. The owner runs a Linux server that already hosts public real-time applications, but wants AMP protected by SSH/Tailscale now.

The owner selected the v1 security posture:

- use private network access through Tailscale and/or SSH tunnel,
- add AMP-level authentication even inside the private network,
- keep future Cloudflare access in mind because a Cloudflare-managed subdomain is likely in the near future.

## Decision

AMP v1 uses **Option B**:

- bind AMP server, Review UI, and admin API to localhost or Tailnet by default,
- do not expose AMP directly to the public internet in the default deployment,
- require AMP-level auth for Review UI/admin API even inside Tailscale/SSH access,
- require tokens or equivalent credentials for remote MCP/admin API calls,
- keep Postgres reachable only by the AMP server/runtime or explicitly trusted admin operations,
- store secrets in environment variables or a secret store, not in project repos, settings tables, backup manifests, or logs.

AMP must be **Cloudflare-ready**:

- routing/session/auth design must not assume "Tailnet only forever",
- future Cloudflare-managed subdomain access is an expected near-future deployment mode,
- Cloudflare access must be explicit owner configuration, not default,
- future Cloudflare mode must use Cloudflare Access or equivalent edge auth plus AMP auth,
- no unauthenticated public Review UI/admin API is allowed.

## Practical v1 default

Default v1 deployment:

```text
Workstation
  -> Tailscale or SSH tunnel
  -> AMP Review UI/admin API on AMP server
  -> AMP auth/session/token
  -> Postgres/model providers behind AMP only
```

Future Cloudflare-ready deployment:

```text
Browser
  -> Cloudflare-managed AMP subdomain
  -> Cloudflare Access or equivalent policy
  -> AMP auth/session
  -> AMP server private origin
```

## Consequences

- v1 security is stronger than "network trust only".
- The UI/API implementation must include auth/session/token behavior early enough that Cloudflare does not require redesign.
- Public routes must be opt-in and fail closed.
- Health checks and local diagnostics must distinguish private/local access from future public-subdomain access.
- Secrets and API keys must remain server-side; browser clients never receive provider keys.

## Follow-up decisions

- Exact AMP auth mechanism for v1: single admin password, magic link, local admin token, session cookie, or another simple single-user model.
- Exact Cloudflare mode: Cloudflare Tunnel vs proxied subdomain vs another reverse-proxy setup.
- Exact subdomain naming.
- Whether remote MCP uses streamable HTTP behind auth or a local wrapper that forwards over private network.
