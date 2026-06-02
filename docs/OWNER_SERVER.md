# Owner Server Profile

This file records the current owner's `/ai` production profile. It is operational evidence for this
server, not the generic quickstart for outside users.

## Current Layout

```text
Recallant repo: /ai/recallant
Data: /ai/recallant-data
Env file: /opt/secure-configs/recallant.env
CLI: /usr/local/bin/recallant
Service: recallant.service
Private origin: http://127.0.0.1:3005
Public human URL: https://recallant.unicloud.ca behind Cloudflare Access
Postgres: Docker Compose pgvector, localhost only
Production DB port: 127.0.0.1:15432
Development DB port: 127.0.0.1:15433
```

## Owner-Specific Safety Rules

Before changing public exposure, firewall, ports, service lifecycle, secrets, Cloudflare, or
production bindings on this host:

- consult `/ai/SECURITY`;
- update `/ai/PORTS.yaml` when a long-running listener is added or changed;
- keep Recallant private by default;
- do not expose MCP, backups, raw artifacts, or admin APIs publicly.

These rules are stricter than the public quickstart because the owner server also runs other
production applications.

## Production Commands

Use production-specific targets for the production Postgres service:

```bash
make prod-db-up
make prod-db-migrate
make prod-db-status
```

Use development DB targets only for isolated local smoke tests:

```bash
make db-up
make db-reset
make db-down
```

The development database uses the separate Docker Compose project name `recallant-dev` and port
`127.0.0.1:15433` so it does not collide with production Postgres.

## Backup Baseline

The owner-server backup timer writes to:

```text
/ai/recallant-data/backups
/ai/recallant-data/backups/latest-manifest.json
```

Each backup must be verified before it is trusted.

## Playwright QA

Server-wide Playwright is installed as an on-demand QA tool:

```text
CLI: /usr/local/bin/playwright
Browsers: /ai/playwright/browsers
Reports: /ai/playwright/reports
```

It is not a service and should not have an open port. It runs only when a project invokes browser QA.
