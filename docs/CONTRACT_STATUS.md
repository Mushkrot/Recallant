# Product Contract Status

This page tracks how the public Recallant product contract maps to implementation and smoke-test
evidence. It is intentionally public and generic: owner-specific server inventories, private access
provider settings, secret locations, and internal handoffs belong outside this repository.

Recallant is still pre-release. A status of "working slice" means the behavior exists and has smoke
coverage, but may still need broader client pilots, UI polish, screenshots, repeat rehearsals, or
release packaging before it should be treated as stable infrastructure.

## Contract Coverage

| Contract Area | Current Status | Evidence | Remaining Work |
|---------------|----------------|----------|----------------|
| Agent-ready project onboarding | Working slice with installed-host one-command MVP | `recallant onboard <project>`, `npm run product-acceptance:smoke`, `npm run onboarding:smoke`, `npm run public-clean-host:smoke`, `npm run public-quickstart:smoke`, `npm run public-install-rollback:smoke`, `npm run public-managed-install:smoke`, `npm run live-acceptance:smoke` | Broader external-host and client pilots before release candidate. |
| Thin bootstrap files | Working slice | Attach/init create `.recallant/config`, `AGENTS.md`, `PROJECT_LOG.md`, client MCP config, and `.gitignore`; `connect --install-local-hooks --dry-run` is idempotent and reports ready/no-write when MCP config and hooks already match; `npm run repo-contract:smoke`, `npm run connect:smoke` | Keep generated files compact as more clients are added. |
| Existing-project migration | Working slice | Discovery/import classify old agent files, handoffs, `.env.example`, runbooks, secret references, risky content, backups, and migration summaries; `npm run prepilot:smoke:discovery`, `npm run prepilot:smoke:import`, `npm run phase10:smoke`, `npm run non-owner-migration:smoke`, opt-in `npm run real-project-pilots:smoke` one-command sandbox-copy pilots | More real-world pilots before release candidate. |
| Capture-active proof | Working slice with quickstart proof | Onboard verify reports structured capture/readiness/recall stages; `public-quickstart:smoke` proves installed-wrapper onboarding, capture active evidence, recall proof, and Workbench outcome; `npm run product-acceptance:smoke`, `npm run demo-capture:smoke`, `npm run agent-capture:smoke` | Keep proof visible in Workbench and docs. |
| Context-pack startup and closeout | Working slice | MCP/CLI startup, checkpoint, closeout, recovery, and local spool paths; `npm run phase3:smoke`, `npm run spool:smoke`, `npm run product-acceptance:smoke` | Improve closeout extraction and reporting quality. |
| Documentation posture + context routing | Working slice with Workbench strategy surface, empty-project starter docs, and minimal canon/capability context | Onboarding analyzes docs presence, missing surfaces, stale handoffs, production/server hints, Recallant workflow coverage, and canon/capability-link needs; human onboard output summarizes this as `empty`, `healthy`, `needs_attention`, or `risky`; confirmed attach stores `documentation_posture` and compact `starter_docs` plan/outcome; context packs expose `sections.documentation_posture` and `sections.canon_capability_context`; Workbench shows documentation strategy choices plus environment facts, capability references, secret reference names, server canon link status, and documentation authority labels; empty projects can receive base starter docs plus profile-specific service/product/library docs during confirmed onboarding; `npm run documentation-posture:smoke`, `npm run onboarding:smoke`, `npm run mcp:smoke`, `npm run review-ui:smoke` | Workbench-confirmed existing-doc rewriting, full external resource registry, connector activation, and broader real-project posture pilots remain future work. |
| Governed memory and review | Working slice | Source refs, statuses, rule promotion gates, conflict views, Review UI, Workbench migration review queue, and browser-level Workbench QA; `npm run phase6:smoke:governed`, `npm run review-ui:smoke`, `npm run review-ui:playwright` | More real-world review ergonomics after broader migration pilots. |
| Governed graph tree contract | Contract slice with typed public vocabulary; runtime remains compatible with the current bounded edge graph | `docs/GRAPH_TREE_CONTRACT.md` defines graph node kinds, relation types, lifecycle states, governance requirements, and the no-implementation phase boundary; `packages/contracts` exports the typed graph vocabulary; current graph-expanded search remains a bounded retrieval surface rather than a visualization-only feature; `npm run build`, `npm run format:check`, `npm run lint`, `npm run public-readiness:smoke`, `npm run public-security:smoke` | Keeper automation, graph retrieval profiles, first-class graph nodes, graph storage migration decisions, richer review workflows, optional Obsidian/vault bridges, and Workbench topology views remain future work. |
| System activity ledger and audit reports | Working slice | Redacted `system_activity_events` schema, CLI/MCP/Workbench HTTP audit envelopes, `recallant audit`, Workbench Audit view, bounded report filters, model/capture summary, project-sanitize de-identification policy, and backup inclusion; `npm run system-audit:schema-smoke`, `npm run system-audit:mcp-smoke`, `npm run system-audit:cli-smoke`, `npm run system-audit:http-smoke`, `npm run system-audit:report-smoke`, `npm run review-ui:smoke`, `npm run review-ui:playwright`, `npm run phase8:smoke:backup`, `npm run project-sanitize:smoke` | Broader live-host audit review, operator polish, and external monitoring/export integrations remain future work. |
| Project sanitization and purge | Working slice | `recallant project-sanitize`, DB dry-run planner, stale local config target resolution, token-confirmed project purge, redacted receipts, explicit orphan local-only cleanup, local Recallant artifact disconnect, Workbench/API dry-run and confirmation flow; `local-cleanup` uses the same path fallback after detach/sandbox cleanup so stale local project ids do not block removal of generated local artifacts; `npm run project-sanitize:smoke`, `npm run local-cleanup:smoke`, `npm run onboarding:smoke` | Broader real-project dry-run pilots and UI polish before release candidate. |
| Source, capability, and secret references | Working slice | `project_sources`, import candidates, secret-reference detection, connector/server source policies; `npm run project-sources:smoke`, `npm run prepilot:smoke:discovery`, `npm run phase10:smoke` | Live connector ingestion remains governed future work. |
| Cross-project examples | Working slice | Explicit cross-project recall returns source-linked examples and blocks silent rule adoption; `npm run phase10:smoke` | More UI affordances for adopting examples into the current project. |
| Private deployment profiles | Documented and genericized | Self-hosting profiles, `doctor` deployment profile output, `production_readiness.service_runtime` status checks, public route readiness checks, latest backup verification, capability references, private-by-default server posture; public defaults use generic paths and env-provided inventory/security/backup references | Deployment-specific overlays stay private. |
| Remote project access to a central server | Working endpoint, scoped credential, provisioning UX, stdio-to-HTTPS bridge, CLI-first diagnostics, trusted-device reconnect, headless bootstrap tokens, local credential-store references, agent-start remote_mcp_ready consent handoff, invite fallback, external-machine acceptance evidence, strict Capture/Recall Acceptance validator, remote-client cleanup/retry gate, aggregate security smoke, deterministic isolated external-client rehearsal, remote live external canary, opt-in central-server live readiness gate, and universal `curl .../connect \| bash` beginner UX are present | `docs/MCP_SPEC.md` defines the remote MCP contract (`/api/mcp`); `docs/REMOTE_CONNECT_PLAN.md` defines the universal connect contract; `GET /connect`, `/api/connect/start`, `/api/connect/poll`, `/api/connect/cancel`, protected `/connect/approve`, and `recallant connect-cloud` implement browser-approved pairing, trusted-device registration/reconnect, bootstrap-token redemption, local credential-store refs, non-secret consent receipts, and remote-doctor handoff; `recallant remote-credential <create\|list\|rotate\|revoke>` manages project/developer scoped, optionally client-scoped credentials with hash-only storage and one-time create/rotate secrets; protected Workbench/API provisioning routes expose the same scoped lifecycle without unauthenticated public admin access; `recallant remote-bridge` forwards stdio MCP calls to HTTPS `/api/mcp`; `recallant connect-remote` previews Codex, Cursor, Claude Code, and generic MCP configs without `RECALLANT_DATABASE_URL`; `recallant invite` and `/j/<token>` remain the advanced/admin one-time onboarding fallback; `recallant remote-cleanup` safely removes only generated remote client config entries and optional Recallant CLI wrappers without touching source files, `.recallant`, Docker/Postgres, or central records; `recallant remote-doctor` distinguishes network reachability, edge/access posture, scoped credential auth, project/developer/client scope, MCP initialize/tools-list readiness, session/context readiness proof, checkpoint state proof, and opt-in governed semantic marker proof; `recallant agent-start` returns `remote_mcp_ready` for remote-only projects and reports remote destination, credential scope, consent scope, redaction boundary, prohibited secret classes, context-pack startup guidance, and semantic proof call guidance; local `recallant doctor` reports remote-only projects as `remote-ready, local storage not attached` instead of a local attach failure; `recallant remote-acceptance` proves external-machine bootstrap, remote-doctor, remote MCP first-session session/context/write/checkpoint/recall, next-session recall, no local storage install, and redacted evidence; `recallant remote-acceptance validate-live` verifies the same evidence on the central server against Workbench readiness and redacted `system_activity_events` rows without exposing DB/Workbench/admin access to the external machine; `remote-live-external-canary:smoke` runs the automated regression gate for no-CLI/stale-CLI bootstrap, credential refs, missing evidence dirs, reconnect idempotency, forbidden local paths, evidence validation, and server trace validation before asking users for manual remote-client checks; external-host rehearsal results are represented in public docs only as redacted summaries without owner-specific device names, project paths, trace ids, raw evidence ids, or private topology; existing remote smokes validate provisioning, bridge, doctor, security, isolated external rehearsal, cleanup, live readiness, connect storage, connect server routes, connect CLI pairing, connect security, connect external rehearsal, remote live external canary, and agent consent. | Repeat canary-backed external-host rehearsal with universal connect on more client types, broaden old-CLI/no-CLI client pilots after the canary gate, and continue release hardening without exposing Postgres, internal server paths, raw artifacts, backups, or unauthenticated admin routes. |
| CLI version reporting | Working slice | Installed `recallant --version` reports the CLI package version plus git build metadata from checkout installs; `npm run cli-version:smoke` and `npm run public-quickstart:smoke` reject `recallant 0.0.0`. | Versioned release tags and final packaging remain pre-release work. |
| Safety gates | Working slice with security smoke | Raw-secret redaction, paid API confirmation posture, public exposure warnings, destructive-operation confirmation paths, install/auth/Workbench/backups/secrets security smoke, owner-only marker scans across public docs and public runtime/install code; `npm run public-security:smoke`, `npm run security-review:smoke`, `npm run phase10:smoke` | Independent release hardening review. |
| Public OSS surface | Working slice | Public docs boundary, readiness smoke, forbidden private marker checks across docs and public code; `npm run public-readiness:smoke`, `npm run public-security:smoke` | Public screenshots and final release packaging. |

## Recent Verification

Recent verification across the current public checkpoint sequence includes:

- `npm run build`
- `npm run format:check`
- `npm run lint`
- `npm run cli-version:smoke`
- `npm run documentation-posture:smoke`
- `npm run public-readiness:smoke`
- `npm run public-security:smoke`
- `npm run security-review:smoke`
- `npm run public-clean-host:smoke`
- `npm run public-quickstart:smoke`
- `npm run public-install-rollback:smoke`
- `RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 npm run public-managed-install:smoke`
- `npm run installer:smoke`
- `npm run phase7:smoke`
- `npm run phase10:smoke`
- `npm run project-sanitize:smoke`
- `npm run local-cleanup:smoke`
- `npm run connect:smoke`
- `npm run system-audit:schema-smoke`
- `npm run system-audit:mcp-smoke`
- `npm run system-audit:cli-smoke`
- `npm run system-audit:http-smoke`
- `npm run system-audit:report-smoke`
- `npm run phase8:smoke:backup`
- `npm run non-owner-migration:smoke`
- `RECALLANT_REAL_PROJECT_PILOTS=<comma-separated paths> npm run real-project-pilots:smoke`
- `npm run review-ui:smoke`
- `npm run review-ui:playwright`
- `npm run pilot-report:smoke`
- `npm run remote-mcp-contract:smoke`
- `npm run remote-mcp-credentials:smoke`
- `npm run remote-mcp-bridge:smoke`
- `npm run remote-mcp-provisioning:smoke`
- `npm run remote-mcp-doctor:smoke`
- `npm run remote-mcp-security:smoke`
- `npm run remote-mcp-external-rehearsal:smoke`
- `npm run remote-connect-storage:smoke`
- `npm run remote-connect-server:smoke`
- `npm run remote-connect-cli:smoke`
- `npm run remote-connect-security:smoke`
- `npm run remote-connect-external-rehearsal:smoke`
- `npm run remote-connect-live-readiness:smoke`
- `npm run remote-live-external-canary:smoke`
- `git diff --check`

Those checks cover the public docs boundary, attach migration summaries, capture-active proof,
cross-project recall behavior, clean-host install planning, fresh public quickstart onboarding,
rollback dry-run and marked-artifact cleanup, Docker-backed managed install smoke, genericized
deployment-profile defaults, neutral non-owner migration safety, opt-in real-project pilot safety on
sandbox copies through one-command onboarding, original-file integrity checks, Workbench browser QA,
and lifecycle cleanup that hides temp memory spaces without deleting records. Public readiness smoke
also covers service-runtime branches for active, inactive, disabled, wrong bind, missing service env,
private health failure, public 502, and anonymous public exposure. Project sanitize smoke
adds disposable-project purge rehearsal with dry-run counts, wrong-token no-op behavior, redacted
receipt retention, local Recallant artifact disconnect, and an explicit no-confirmed-purge guard
when a real project path is detected. System audit smokes cover the redacted ledger schema, CLI/MCP
and Workbench HTTP instrumentation, storage-blocked CLI audit spool, owner-readable audit reports,
Workbench Audit view, model/capture summaries, and backup/verify inclusion of ledger rows. The
checks also cover
Workbench migration review ergonomics, autonomous browser QA with synthetic screenshots, pilot
report scenarios, and production-sensitive dry-run safety, plus install/auth/Workbench/backups/secrets
security review smoke.

A live self-host server audit on 2026-06-24 also verified the installed CLI against six
server-local, attached workspaces without publishing owner-specific paths or identifiers. Each
workspace reported `agent-start` mode `server`, `doctor --require-capture` status
`capture_active`, client connection `mcp_and_hooks_ready`, local hook readiness, zero pending
embeddings, and idempotent `connect --install-local-hooks --dry-run` with `writes_files: false`.
The same audit found a disposable stale local fixture; after sandbox detach, `local-cleanup`
resolved the current project by path fallback and removed only generated local Recallant pointers.

## Current Remote Existing-Project Findings

A 2026-06-23 remote existing-project pilot confirmed that the remote MCP path can reach
`mode: "remote_mcp_ready"`, write and read checkpoint state, create a governed project memory through
`memory_create_agent_memory`, and recall that memory through `memory_recall_agent_memories` without
local Postgres or `RECALLANT_DATABASE_URL` on the remote workstation.

The same pilot drove the release gates now used for remote existing-project readiness:

- local `doctor` now reports remote-only projects as
  `remote-ready, local storage not attached`, while local attach/onboard failures remain distinct;
- `remote-doctor --capture-proof` proves session/context readiness, while
  `remote-doctor --semantic-proof` adds checkpoint state proof plus a governed synthetic marker
  memory write and recall;
- checkpoint readback and governed semantic recall are separate surfaces, and the docs/CLI should not
  let operators confuse them;
- `memory_get_readiness_status` now exposes persistent bounded readiness evidence, so a repeated
  remote `agent-start` stays `configured` after checkpoint-only/capture proof and reports
  `semantic_memory_ready` only after the governed semantic marker proof;
- the baseline checkpoint parity contract is state-only: `memory_set_checkpoint` writes checkpoint
  state and reports no searchable memory id; normal closeout uses `memory_closeout` / CLI
  `agent-closeout`, while searchable checkpoint memory uses the explicit
  `memory_agent_checkpoint` / CLI `agent-checkpoint` path;
- remote existing-project migration needs a guided, review-first path that inventories safe docs and
  risky paths, groups entries as `summarize_to_memory`, `keep_as_reference`, `skip`, or `ask_owner`,
  then writes concise governed memories only after approval; risky output is path/class/count based
  and secret references are names-only;
- MCP tool validation now makes required fields such as `title`, `body`, and object-shaped
  `audience` easier for agents to satisfy on the first call.

These are UX and acceptance-flow improvements rather than evidence that the scoped remote MCP core is
broken. The release gate should still require repeat external-host rehearsals and strict
capture/recall evidence with redacted outputs.

## Remote Existing-Project Release Gate Matrix

Remote existing-project readiness is a sequence of proof surfaces, not one boolean:

| Gate | Required For Release Readiness | Proof Surface | Notes |
|------|--------------------------------|---------------|-------|
| Remote MCP ready | Yes | `recallant agent-start --format json` reports `mode: "remote_mcp_ready"` | Confirms remote consent/config and scoped bridge guidance. |
| Session/context ready | Yes | `memory_start_session` + `memory_get_context_pack`, or `recallant remote-doctor --capture-proof` | Proves startup context, not checkpoint state or semantic recall. |
| Checkpoint state | Optional diagnostic | `memory_set_checkpoint` + `memory_get_checkpoint` | State-only parity check; not semantic recall proof. |
| Governed semantic recall | Yes | synthetic `memory_create_agent_memory` marker + `memory_recall_agent_memories` | Must use non-secret marker content and project scope. |
| Existing-project migration | Yes before importing old history | read-only inventory, risk classification, owner approval, concise governed memories/imports, recall verification | Risk output is path/class/count oriented and secret references are names-only. |
| External-machine evidence | Yes before release-candidate remote claims | `recallant remote-acceptance` evidence bundle plus validator or equivalent server-side trace verification | The remote machine must not receive Postgres, `RECALLANT_DATABASE_URL`, Workbench/admin auth, raw artifacts, backups, or provider secrets. |
| Remote live external canary | Yes before manual remote-client checks | `npm run remote-live-external-canary:smoke`, and for operator live checks `remote-live-external-canary --live --json` with server trace validation enabled or an equivalent server-side trace gate | Release pass requires `server_trace_validation: pass`, cleanup revoked/deleted, semantic marker recall, next-session recall, evidence validation, and redaction all passing. Server trace validation uses the redacted remote MCP audit envelope plus central DB facts; skipped validation is `not_release_pass`. Public docs use placeholder server URLs only. |
| Searchable checkpoint memory | Optional checkpoint memory | `memory_agent_checkpoint` or CLI `agent-checkpoint` | Use only when the checkpoint itself should become governed searchable memory. Normal closeout uses `memory_closeout` or CLI `agent-closeout`. |
| Live central-server readiness smoke | Optional operator gate | `remote-mcp-live-readiness:smoke` / `remote-connect-live-readiness:smoke` with operator env vars | Skips safely without live inputs and must not be treated as a deterministic fixture. |
| Local `attach --confirm` | Not a remote-next-step | explicit local/server-local attach or import path only | Do not tell remote-only clients to run local attach after `remote_mcp_ready`. |

## What Is Not Ready Yet

- Recallant should not be treated as stable team-wide infrastructure.
- Browser-first project attachment from the Workbench is future work. The current beginner MVP is an
  installed-host flow where the user runs one command: `recallant onboard <project>`.
- Beginner onboarding is not complete unless `recallant onboard <project>` reports storage
  readiness, project attach, client connection, capture proof, recall proof, and Workbench outcome.
  `Database not configured` is a blocker, not a successful onboarding result.
- `attach`, `connect`, `doctor`, and `agent-*` are still useful advanced/debug APIs, but the public
  beginner path should not require users to know those commands.
- Live connector ingestion is not the default; connector records are governed references until setup,
  consent, and policy allow capture.
- Documentation posture is a reported and reviewed context layer. Empty projects can receive
  starter docs during confirmed onboarding, but Recallant does not automatically rewrite canonical
  docs for existing projects, generate starter docs for every project, or promote recalled
  discussion into binding documentation without review.
- Project purge is not a substitute for source repository cleanup. It removes Recallant-controlled
  project memory and disconnects Recallant-generated local artifacts, including generated hooks and
  offline spool files; it must not delete source files, secrets, downloads, or arbitrary project
  data. System activity rows are retained only as de-identified governance evidence after purge, not
  as a project recall source.
- The system activity ledger is an owner-readable Recallant audit report, not a full SIEM, metrics
  platform, or external monitoring export.
- Public exposure of Workbench, admin APIs, MCP, backups, or raw artifacts is not a default mode.
- Protected public Workbench access is not the same as remote project access. The default agent
  connection path is local stdio MCP on an installed host.
- Remote MCP/agent access now has a first authenticated `POST /api/mcp` endpoint slice, scoped
  remote MCP credential lifecycle with CLI/Workbench provisioning output, stdio-to-HTTPS remote
  bridge, CLI-first diagnostics, aggregate security smoke, deterministic isolated external-client
  rehearsal, universal `curl -fsSL https://memory.example.com/connect | bash` pairing, and a redacted
  `recallant remote-acceptance` evidence gate for bootstrap, remote-doctor, remote MCP
  session/context/write/checkpoint/recall, and forbidden local-artifact checks. External-host
  rehearsal outcomes are public only as redacted summaries without owner-specific device names,
  project paths, trace ids, raw evidence ids, or private topology. Local stdio MCP remains the default
  client workflow for installed-host self-host projects; universal connect is the beginner remote
  existing-server path, while broader remote-client polish and repeat release rehearsals remain
  near-term release work.
- The external-workstation invite path has a live external-host PASS, but it is now an
  advanced/admin fallback. The broad remote beginner path is
  `curl -fsSL https://memory.example.com/connect | bash`, implemented through public bootstrap,
  pending connection storage, protected approval, trusted-device registration/reconnect, headless
  bootstrap-token redemption, local credential-store references, and `recallant connect-cloud`. A
  user should not be told that the local self-host installer connects a project to an existing
  central Recallant server; that installer creates local storage and may require Docker/Postgres.
- A remote client bootstrap also exists for server-generated invite onboarding packages with live
  endpoint/credential/scope. It installs only the remote bridge CLI, writes project-local client
  config, and runs `remote-doctor`; `recallant remote-acceptance` is now the acceptance follow-up
  gate, and one real external-host evidence bundle has passed. A separate human-written report file
  is optional audit context, not a blocker.
- Private deployment overlays are intentionally not published in this repository.
- Broader personal-life memory, team/multi-user workflows, and richer connector ecosystems remain
  future expansion after the coding-agent core is stable.
- The disposable clean-host smokes are not a substitute for repeatable external-host release
  rehearsals before tagging.

## Release-Candidate Bar

Before a release-candidate tag, the project should have:

- external-host release rehearsal that repeats the public quickstart and rollback path;
- remote live external canary pass, then repeat remote project access rehearsal from at least one
  real separate machine with universal `curl .../connect | bash` pairing, producing either a
  validated `recallant remote-acceptance` evidence bundle or equivalent server-side trace
  verification that proves authenticated agent capture and recall against a central Recallant
  server;
- broader remote-client invite rehearsal from separate machines and clients, including
  `remote-doctor` and capture/recall readiness against the central server;
- existing-project migration proof with backup and review behavior on broader real-world projects;
- autonomous Workbench browser QA and public screenshots with synthetic data only;
- independent hardening after the install/auth/Workbench/backups/secrets security smoke;
- passing public readiness and security smokes.
