# ADR-0029: Private-by-default access with Recallant auth and Cloudflare-ready path

## Status

Accepted

## Context

Recallant stores sensitive project memory, raw workflow evidence, governed memories, settings, model-provider metadata, and future personal-memory-adjacent data. The owner runs a Linux server that already hosts public real-time applications, but wants Recallant protected by SSH/Tailscale now.

The owner selected the v1 security posture:

- use private network access through Tailscale and/or SSH tunnel,
- add Recallant-level authentication even inside the private network,
- keep future Cloudflare access in mind because a Cloudflare-managed subdomain is likely in the near future.

## Decision

Recallant v1 uses **Option B**:

- bind Recallant server, Review UI, and admin API to localhost or Tailnet by default,
- do not expose Recallant directly to the public internet in the default deployment,
- require Recallant-level auth for Review UI/admin API even inside Tailscale/SSH access,
- require tokens or equivalent credentials for remote MCP/admin API calls,
- keep Postgres reachable only by the Recallant server/runtime or explicitly trusted admin operations,
- store secrets in environment variables or a secret store, not in project repos, settings tables, backup manifests, or logs.

Recallant must be **Cloudflare-ready**:

- routing/session/auth design must not assume "Tailnet only forever",
- future Cloudflare-managed subdomain access is an expected near-future deployment mode,
- Cloudflare access must be explicit owner configuration, not default,
- future Cloudflare mode must use Cloudflare Access or equivalent edge auth plus Recallant auth,
- no unauthenticated public Review UI/admin API is allowed.

Owner-server production refinement, accepted on 2026-05-27:

- human Review UI access uses `https://recallant.unicloud.ca`,
- Cloudflare Tunnel `mainserver` routes the hostname to the private origin
  `http://127.0.0.1:3005`,
- Cloudflare Access allows the human owner email `highmac@gmail.com`,
- Recallant validates Cloudflare Access identity/JWT and then issues its own secure browser
  session cookie,
- Recallant does not send a second magic-link email and does not require a second UI password in
  this deployment,
- `Authorization: Bearer <RECALLANT_AUTH_TOKEN>` remains available for API, automation, smoke
  checks, and non-browser admin calls,
- agent MCP access uses the existing local stdio `recallant mcp-server` path; remote MCP over the
  Cloudflare hostname is not enabled in the first production deployment.

## Practical v1 default

Default v1 deployment:

```text
Workstation
  -> Tailscale or SSH tunnel
  -> Recallant Review UI/admin API on Recallant server
  -> Recallant auth/session/token
  -> Postgres/model providers behind Recallant only
```

Future Cloudflare-ready deployment:

```text
Browser
  -> recallant.unicloud.ca
  -> Cloudflare Access allow policy
  -> Recallant validates Cloudflare Access identity/JWT
  -> Recallant secure session cookie
  -> Recallant server private origin
```

## Consequences

- v1 security is stronger than "network trust only".
- The UI/API implementation must include auth/session/token behavior early enough that Cloudflare does not require redesign.
- Public routes must be opt-in and fail closed.
- Health checks and local diagnostics must distinguish private/local access from future public-subdomain access.
- Secrets and API keys must remain server-side; browser clients never receive provider keys.

## Follow-up decisions

- Whether future remote MCP uses streamable HTTP behind auth or remains local stdio/wrapper only.
- Whether a password login is added later as an optional fallback if Cloudflare Access is
  unavailable. It is not required for the first production deployment.
