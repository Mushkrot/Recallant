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

The owner's target environment is a personal Linux server. Access normally happens through SSH
and Tailscale for operations, while the owner-facing Recallant UI is deployed through the same
Cloudflare Tunnel + Cloudflare Access pattern already used by private owner applications on the
server.

Important assumptions:

- The server already hosts public real-time applications.
- The server has shared operational documentation and inventory: `/ai/SECURITY` for security posture and `/ai/PORTS.yaml` for port assignments.
- The server may already provide local-model services such as Ollama; Recallant should reuse configured existing services instead of creating duplicate stacks.
- Recallant should not increase public attack surface unnecessarily.
- Even when the client machine is on the local network, the owner prefers connecting through Tailscale for security.
- Recallant should keep its origin private and reachable only through localhost/private server
  paths. The owner-facing UI may be exposed through Cloudflare Access at an explicit hostname.
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
  | local stdio MCP process with server/env/secret bindings
  v
Recallant server on Linux
  |
  +-- Postgres / pgvector
  +-- raw artifact storage
  +-- model router
  +-- existing localhost-only Ollama/local GPU service when configured
  +-- background jobs
  +-- private Management UI/chat/admin API
  +-- future management platform UI
  +-- local encrypted backup target
        |
        +-- future SSH/Tailscale replication to second backup server
```

## 4. Network posture

Accepted first production deployment:

```text
Human owner:
  https://recallant.unicloud.ca
    -> Cloudflare Access allow policy for highmac@gmail.com
    -> Cloudflare Tunnel mainserver
    -> http://127.0.0.1:3005
    -> Recallant validates Cloudflare Access identity/JWT
    -> Recallant secure session cookie

Agents:
  Codex / future MCP clients
    -> local stdio MCP command: recallant mcp-server
    -> Recallant Postgres/server secrets through server-side env bindings
```

Operational rules:

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
Review UI/admin API origin: 127.0.0.1:3005
Cloudflare hostname: recallant.unicloud.ca
Cloudflare ingress: Tunnel mainserver -> http://127.0.0.1:3005
Cloudflare Access: required; allowed human owner email highmac@gmail.com
Recallant browser auth: validate Cloudflare Access identity/JWT and issue a secure session cookie
Recallant API/automation auth: Authorization: Bearer <RECALLANT_AUTH_TOKEN>
Recallant admin allowlist: RECALLANT_ADMIN_EMAILS=highmac@gmail.com
Agent MCP access: local stdio MCP; remote MCP over Cloudflare is not enabled in this deployment
```

The port is an owner-server inventory choice, not a universal product invariant. Other servers may use another port through settings.

Cloudflare path:

- The owner-facing management UI is deployed through the dedicated Cloudflare-managed subdomain
  `recallant.unicloud.ca`.
- Cloudflare access is explicit owner configuration, not an unauthenticated public default.
- Cloudflare mode uses Cloudflare Tunnel `mainserver`, Cloudflare Access, and Recallant auth/session.
- Browser UI auth validates Cloudflare Access identity headers/JWT assertion at the private origin
  against `RECALLANT_ADMIN_EMAILS`, then issues a signed `recallant_session` cookie. Do not add a
  second password or second email magic-link layer for the first deployment.
- API and automation auth uses `Authorization: Bearer <RECALLANT_AUTH_TOKEN>` and does not depend
  on browser session state.
- No unauthenticated public management UI is allowed.
- No public MCP/raw-artifact route is allowed. Admin/API calls exposed through the UI origin still
  require Cloudflare Access and Recallant auth/session/token.

## 4.1 Runtime and data layout

Accepted first production layout:

```text
Code:
  /ai/recallant

Persistent runtime data:
  /ai/recallant-data

Secrets:
  /opt/secure-configs/recallant.env

Recallant app:
  systemd service on the host
  cwd=/ai/recallant
  bind=127.0.0.1:3005

Recallant Postgres/pgvector:
  Docker Compose service
  compose file=/ai/recallant/docker-compose.production.yml
  host bind=127.0.0.1:15432
  container port=5432
  database=recallant_agent_work
  data=/ai/recallant-data/postgres

Local model provider:
  existing shared Ollama service
  url=http://127.0.0.1:11434
  no duplicate Ollama stack
```

`/opt/secure-configs/recallant.env` is the single production secret/env file for the app and
database stack. It contains the Postgres password, `RECALLANT_DATABASE_URL`,
`RECALLANT_AUTH_TOKEN`, session secret material, Cloudflare mode flags, and the Ollama URL. Do not
copy these values into git, docs, settings tables, backup manifests, or chat.

The production Postgres compose file must not use `/opt/secure-configs/recallant.env` as a raw
`env_file`, because that would inject unrelated app/session/API secrets into the database container
and can print resolved values during compose inspection. Production database commands go through
`scripts/recallant-prod-compose.sh`, which sources the single env file locally and passes only
`POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` into the Postgres service.

## 5. Local/offline behavior

When the workstation cannot reach Recallant server:

- local capture writes to spool,
- user/agent can continue work,
- `recallant sync-spool` uploads later,
- synced local records can be pruned/offloaded.

The server remains the canonical source of truth after sync.

## 6. Backup topology

Initial v1 backup placement:

- automated backups are written to local backup storage under `/ai/recallant-data/backups`,
- backups must include Postgres domain databases and raw artifact storage,
- restore verification must be possible without overwriting production.

Future target:

- second-server replication remains an architecture-ready future option,
- no second backup server is available or expected in the near term,
- keep future replication as a backup target, not as another live source of truth.

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) and [ADR-0028-practical-backup-restore-policy.md](ADR-0028-practical-backup-restore-policy.md).

## 7. Open decisions

- Whether future remote MCP should be added as authenticated streamable HTTP. It is not part of
  the first production deployment.
- Exact backup schedule/retention values after observing real data volume.
- Whether future second-server backup replication is added when a second server exists.
