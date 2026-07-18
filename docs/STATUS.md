# Current Status

Recallant is pre-release. The current checkout provides a working self-hosted coding-agent memory
slice with local and authenticated remote project paths, governed capture and recall, Workbench
review, project-scoped safety checks, production backup/restore evidence, and required product/public
smoke gates. It should not yet be treated as stable team-wide infrastructure.

## What Works Now

- `recallant connect <project>` is the primary project connection path.
- Local managed installs can prove service, capture, recall, Workbench, backup, and isolated restore
  readiness through `recallant doctor` and the documented acceptance gates.
- Authenticated remote MCP and universal existing-server connection paths are implemented with
  scoped credentials, redacted evidence, and no client-side Postgres access.
- Project identity binding, exact managed log markers, optional mirroring boundaries, diagnostic
  memory conflict policy, Review UI acceptance, and required CI product gates have regression
  coverage.
- The Workbench now opens on a task-oriented Home screen with five primary destinations; Ask &
  Search, list-first Review, health-first Sources, Activity, and secondary Project controls are
  covered by focused smoke and desktop/mobile browser checks.
- Activity now provides run-oriented agent observability: bounded replay, grouped errors and
  recovery, completeness checks, and adapter coverage. Local Codex connection now installs a native
  project hook adapter by default, safely preserving user hooks and reporting configured versus
  fresh observed capture truthfully. An optional, separately transported Codex OpenTelemetry lane
  reconciles safe control facts with native hooks, exposes gaps without storing another transcript,
  and retains/purges/restores its project-scoped evidence. Errors now show automatically correlated
  error, retry, remediation, verification, and regression chains with confidence and reasons. MCP,
  CLI, helper-hook, retention, targeted forget, project purge, and native backup/restore paths remain
  covered by focused smoke tests.
- Local Ollama embeddings are fail-soft; embedding requests ask the runtime to retain the embedding
  model, while bounded recovery handles temporary unavailability.

## Release Position

The product remains pre-release because repeat external-host rehearsals, broader client/project
pilots, public screenshots with synthetic data, independent hardening, and final packaging still
remain. A host reporting `production_readiness.ready: true` proves that deployment's current
operational contract; it does not by itself promote the whole project to a stable release.

## Required Verification

For ordinary changes, run the focused test plus:

```bash
npm run format:check
npm run lint
npm run build
npm test
npm run public-readiness:smoke
npm run public-security:smoke
```

Managed runtime changes also require install, service restart, live `doctor`, and the relevant
consumer smoke. Production dependency checks use `npm audit --omit=dev` without advisory
suppression.

## Documentation Authority

- [Operations Runbook](RUNBOOK.md) is the routine health, deployment, incident, backup, and rollback
  path.
- [Product Contract Status](CONTRACT_STATUS.md) maps implemented slices to detailed evidence and
  remaining work.
- [Roadmap](ROADMAP.md) describes future direction and release milestones.
- [Self-hosting](SELF_HOSTING.md) defines installation profiles, configuration boundaries, backup
  semantics, and rollback details.
