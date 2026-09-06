# Current Status

Recallant is pre-release. The current checkout provides a working self-hosted, Codex-first
coding-agent memory slice with local and authenticated remote project paths, governed capture and
recall, Workbench review, project-scoped safety checks, production backup/restore evidence, and
required product/public smoke gates. It should not yet be treated as stable multi-client or
team-wide infrastructure.

The versioned prerelease target is `v0.1.0-dev.1`. Its annotated tag and GitHub prerelease are
published only after the exact candidate SHA passes release gates, CodeQL, three consecutive CI
runs, pinned installation, update-channel, rollback, security, and route verification.

## What Works Now

- `recallant onboard <project>` is the primary universal project connection path.
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
- Three 1440 x 900 public portfolio screenshots are generated from the real Workbench with
  synthetic data through `npm run portfolio-screenshots:generate`. Public readiness checks enforce
  the exact image set and dimensions.
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
- Startup Context Packs are aggregate-bounded and expose omission metadata; task-specific working
  memories can be ranked ahead of older closeout records without weakening project or review scope.
- Generated starter instructions carry a client-neutral delivery-verification rule: the owner is not
  the default QA, user-visible claims require target verification when feasible, and bounded retry
  statuses remain explicit.

## Product Gap And Active Priority

The shared store and MCP lifecycle can be used by more than one configured client, but native
automatic capture is currently Codex-specific. Claude Code setup writes project-local MCP
configuration; it does not yet install a native Claude Code lifecycle adapter or prove equivalent
capture. The existing cross-client smoke proves a shared protocol/store seam with generic
subprocesses, not a real Codex -> Claude Code -> Codex continuation.

The active product milestone is therefore **Cross-Client Continuity v1**. The next delivered proof
must let real Codex and Claude Code sessions read and extend the same Project Memory without a human
pasting a recap. Human Document Memory follows that proof. A first-class Task Handoff Record follows
the document MVP; Linear is not a dependency, and an external task board can only be an optional
adapter.

Broad folder attachment, PDF/DOCX extraction, incremental document synchronization, and
source-cited human question answering are planned but not implemented today.

## Release Position

The product remains a development prerelease because real cross-client continuity, broader
client/project pilots, and stable support guarantees still remain. A host reporting
`production_readiness.ready: true` proves that deployment's current operational contract; it does
not prove native client parity or promote the whole project to a stable release.

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
- [Domain Language](../CONTEXT.md) defines continuity, document-memory, and task-handoff terms.
- [Self-hosting](SELF_HOSTING.md) defines installation profiles, configuration boundaries, backup
  semantics, and rollback details.
