# Deployment topology

This file defines the intended deployment shape for Recallant.

## 1. Recallant server definition

In Recallant, **Recallant server** means the always-available backend process that owns the memory runtime:

- exposes MCP tools and the private Review UI/admin API,
- validates requests and enforces project/developer/domain scope,
- writes raw L0 events and governed memories,
- runs or queues chunking, embedding, retrieval, recall traces, and cleanup,
- talks to Postgres/pgvector and model providers,
- receives sync from local spool/offline capture.

It is not the same thing as the user's working laptop and it is not a public SaaS service.

Decision status: accepted by owner.

The Review UI is part of the Recallant server deployment. v1 starts as a compact private workbench, not a simple approval page, and it is the beginning of a fuller Recallant management platform. See [ADR-0020-review-ui-on-recallant-server-management-platform-path.md](ADR-0020-review-ui-on-recallant-server-management-platform-path.md) and [ADR-0033-compact-review-ui-workbench-in-v1.md](ADR-0033-compact-review-ui-workbench-in-v1.md).

## 2. Target environment

The owner's target environment is a personal Linux server. Access should normally happen through SSH and Tailscale.

Important assumptions:

- The server already hosts public real-time applications.
- The server has shared operational documentation and inventory: `/ai/SECURITY` for security posture and `/ai/PORTS.yaml` for port assignments.
- The server may already provide local-model services such as Ollama; Recallant should reuse configured existing services instead of creating duplicate stacks.
- Recallant should not increase public attack surface unnecessarily.
- Even when the client machine is on the local network, the owner prefers connecting through Tailscale for security.
- Recallant should be private-by-default and reachable over Tailnet/VPN rather than exposed to the public internet.
- Recallant should still use its own auth/session/token layer inside the private network.
- Future Cloudflare access is expected soon enough that the routing/auth design must stay Cloudflare-ready.
- The current server layout and paths are deployment-profile facts, not universal product assumptions.

## 3. Recommended topology

```text
Codex / CLI on workstation
  |
  | MCP stdio or local CLI wrapper
  v
local recallant client / spool
  |
  | Tailscale private address / SSH tunnel
  v
Recallant server on Linux
  |
  +-- Postgres / pgvector
  +-- raw artifact storage
  +-- model router
  +-- existing Ollama/local GPU workers when configured
  +-- background jobs
  +-- private Management UI/chat/admin API
  +-- future management platform UI
  +-- local encrypted backup target
        |
        +-- future SSH/Tailscale replication to second backup server
```

## 4. Network posture

Default recommendation:

- Bind Recallant server, Review UI, and admin services to localhost or Tailnet interface only.
- Do not expose Recallant directly on public internet.
- Use SSH/Tailscale for remote access.
- Keep public apps on separate reverse-proxy routes from Recallant.
- Use explicit tokens/keys even inside Tailnet for defense in depth.
- Require Recallant-level auth for Review UI/admin API even when reached over Tailnet or SSH tunnel.
- Before starting any long-running service that binds a port on the owner's server, check `/ai/PORTS.yaml` and register the selected port/bind mode there.
- Consult `/ai/SECURITY` before changing firewall, public exposure, Cloudflare, service, or secret-handling behavior.

Current owner-server planning profile:

```text
Review UI/admin API: 127.0.0.1:3005
Remote access: SSH/Tailscale only by default
Cloudflare: disabled until explicitly configured
```

The port is an owner-server inventory choice, not a universal product invariant. Other servers may use another port through settings.

Cloudflare-ready path:

- The owner may later expose the management UI through a dedicated Cloudflare-managed subdomain, and this is a likely near-future deployment mode.
- Cloudflare access is an explicit deployment mode, not the v1 private default.
- Details are a future deployment-profile decision: subdomain, Cloudflare Tunnel vs proxied route, Access policy, Recallant session model, and reverse-proxy layout.
- Future Cloudflare access must use Cloudflare Access or equivalent edge authentication plus Recallant auth/session.
- No unauthenticated public management UI is allowed.
- No public MCP/admin/raw-artifact route is allowed without explicit owner configuration and auth.

## 5. Local/offline behavior

When the workstation cannot reach Recallant server:

- local capture writes to spool,
- user/agent can continue work,
- `recallant sync-spool` uploads later,
- synced local records can be pruned/offloaded.

The server remains the canonical source of truth after sync.

## 6. Backup topology

Initial v1 backup placement:

- automated backups may be written to encrypted local backup storage on the same Recallant server,
- backups must include Postgres domain databases and raw artifact storage,
- restore verification must be possible without overwriting production.

Future target:

- replicate encrypted backups to a second server on the owner's network,
- connect through SSH/Tailscale or another explicit private transport,
- keep this as a backup target, not as another live source of truth.

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) and [ADR-0028-practical-backup-restore-policy.md](ADR-0028-practical-backup-restore-policy.md).

## 7. Open decisions

- Whether the MCP server itself runs remotely over streamable HTTP, or Codex uses a local wrapper that forwards to the remote Recallant server.
- Whether SSH tunnel is required for all server operations or Tailnet address is sufficient.
- Whether Postgres is reachable only from the Recallant server container/process or also from trusted admin CLI.
- Whether Review UI is served by the same Recallant HTTP service or as a separate `recallant-review-ui` process behind the same private network boundary.
- Exact future Cloudflare deployment mode, subdomain, Access policy, and Recallant session mechanism.
- Exact backup tool and future second-server path.
- Whether the production Review UI/admin API stays on port `3005` for the first owner-server deployment or is remapped before service start.
