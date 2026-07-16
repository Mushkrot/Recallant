# Product Contract Status

This page tracks how the public Recallant product contract maps to implementation and smoke-test
evidence. It is intentionally public and generic: owner-specific server inventories, private access
provider settings, secret locations, and internal handoffs belong outside this repository.

For a concise current maturity and release summary, see [Current Status](STATUS.md). For routine
operations and incident handling, see the [Operations Runbook](RUNBOOK.md).

Recallant is still pre-release. A status of "working slice" means the behavior exists and has smoke
coverage, but may still need broader client pilots, UI polish, screenshots, repeat rehearsals, or
release packaging before it should be treated as stable infrastructure.

## Contract Coverage

### Governed Graph Tree B11

The working B11 endpoint-kind slice explicitly promotes accepted edge candidates across the existing
edges endpoint kinds: chunk, event, and external. Promotion remains review-separated, explicit,
project-scoped, provenance-preserving, and confirmation-gated in CLI/Workbench paths. Every active
edge is not necessarily retrieval-active: only chunk-to-chunk edges participate in the current
one-hop chunk-neighbor retrieval. Conceptual graph kinds, first-class graph storage, automatic
promotion, and new traversal semantics remain future work.

| Contract Area | Current Status | Evidence | Remaining Work |
|---------------|----------------|----------|----------------|
| Agent-ready project onboarding | Working slice with universal CLI one-command MVP | `recallant connect <project>`, `npm run product-acceptance:smoke`, `npm run onboarding:smoke`, `npm run public-clean-host:smoke`, `npm run public-quickstart:smoke`, `npm run public-install-rollback:smoke`, `npm run public-managed-install:smoke`, `npm run live-acceptance:smoke` | Broader external-host and client pilots before release candidate. |
| Thin bootstrap files | Working slice | Attach/init create `.recallant/config`, `AGENTS.md`, a missing-only `PROJECT_LOG.md`, client MCP config, and `.gitignore`; automatic log mirroring is disabled unless `project_log_sync: "managed_block"` and exact markers are present; `connect --install-local-hooks --dry-run` is idempotent and reports ready/no-write when MCP config and hooks already match; `npm run repo-contract:smoke`, `npm run project-log-sync:smoke`, `npm run connect:smoke` | Keep generated files compact as more clients are added. |
| Existing-project migration | Working slice | Discovery/import classify old agent files, handoffs, `.env.example`, runbooks, secret references, risky content, backups, and migration summaries; `npm run prepilot:smoke:discovery`, `npm run prepilot:smoke:import`, `npm run phase10:smoke`, `npm run non-owner-migration:smoke`, opt-in `npm run real-project-pilots:smoke` one-command sandbox-copy pilots | More real-world pilots before release candidate. |
| Capture-active proof | Working slice with quickstart proof | Onboard verify reports structured capture/readiness/recall stages; `public-quickstart:smoke` proves installed-wrapper onboarding, capture active evidence, recall proof, and Workbench outcome; `npm run product-acceptance:smoke` and `npm run agent-capture:smoke` prove agent closeout readiness, accepted closeout memory, semantic recall, and next-session context; `npm run agent-lifecycle-gate:smoke` keeps degraded lifecycle paths not ready; `npm run demo-capture:smoke` | Keep proof visible in Workbench and docs. |
| Context-pack startup and closeout | Working slice with lifecycle readiness gate and project-binding regression gate | MCP/CLI startup, checkpoint, closeout, recovery, and local spool paths; project binding stays session/config scoped across context packs, closeout, demo capture, spool sync, `project_dir` compatibility aliasing, and duplicate path ambiguity handling; `npm run phase3:smoke`, `npm run spool:smoke`, `npm run agent-lifecycle-gate:smoke`, `npm run product-acceptance:smoke`, `npm run project-binding-regressions:smoke`, `npm run project-binding-regressions:strict` | Improve closeout extraction and reporting quality. |
| Documentation posture + context routing | Working slice with Workbench strategy surface, empty-project starter docs, and minimal canon/capability context | Onboarding analyzes docs presence, missing surfaces, stale handoffs, production/server hints, Recallant workflow coverage, and canon/capability-link needs; human onboard output summarizes this as `empty`, `healthy`, `needs_attention`, or `risky`; confirmed attach stores `documentation_posture` and compact `starter_docs` plan/outcome; context packs expose `sections.documentation_posture` and `sections.canon_capability_context`; Workbench shows documentation strategy choices plus environment facts, capability references, secret reference names, server canon link status, and documentation authority labels; empty projects can receive base starter docs plus profile-specific service/product/library docs during confirmed onboarding; `npm run documentation-posture:smoke`, `npm run onboarding:smoke`, `npm run mcp:smoke`, `npm run review-ui:smoke` | Workbench-confirmed existing-doc rewriting, full external resource registry, connector activation, and broader real-project posture pilots remain future work. |
| Governed memory and review | Working slice | Source refs, statuses, rule promotion gates, conflict views, Review UI, Workbench migration review queue, and browser-level Workbench QA; `npm run phase6:smoke:governed`, `npm run review-ui:smoke`, `npm run review-ui:playwright` | More real-world review ergonomics after broader migration pilots. |
| Scoped content erasure | Working slice | Current-project direct event/chunk/memory/artifact targets, bounded search and exact scope selectors, no-write previews, content-free selection digests and receipts, stale-token rejection, transactional dependent cleanup, external-object boundary warnings, and Workbench confirmation UX; `npm run phase6:smoke:graph`, `npm run review-ui:smoke`, `npm run build`, `npm run lint`, `npm run public-readiness:smoke`, `npm run public-security:smoke` | Broader real-project erasure pilots before release candidate. |
| Governed graph tree contract | Working B11 endpoint-kind slice over B10 keeper source integration, B9 review ergonomics, B8 governed graph maintenance, B7 read-only Workbench topology, B6 explicit graph promotion, B5 Workbench graph review, B4 named one-hop graph retrieval profiles, B3 storage/review, Markdown vault bridge, deterministic memory keeper candidate coverage, and runtime compatibility with the current bounded edge graph | `docs/GRAPH_TREE_CONTRACT.md` defines graph node kinds, relation types, lifecycle states, candidate lifecycle, retrieval profiles, read-only hygiene buckets, explicit promotion rules, governed graph maintenance workflows, Workbench graph review fields/actions, B9 review workload and decision guidance, B10 source-selected keeper source contract, B11 endpoint-kind activation capabilities, read-only topology nodes/links/groups/summary, governance requirements, the dry-run/default vault bridge contract, and `recallant keeper candidates`; `packages/contracts` exports the typed graph vocabulary, retrieval profile names, promotion result types, hygiene report types, topology result types, graph endpoint promotion capability types, and graph maintenance plan/apply result types; `graph_candidates`, `graph_candidate_source_refs`, and `graph_candidate_review_actions` store project-scoped staged proposals and maintenance review history; compatible promoted candidates create or reuse `edges` rows; MCP exposes `memory_search.graph_retrieval_profile`, legacy `graph_expand`, `memory_keeper_candidates`, `memory_create_graph_candidate`, `memory_list_graph_candidates`, `memory_get_graph_candidate`, `memory_review_graph_candidate`, `memory_promote_graph_candidate`, `memory_graph_hygiene`, and `memory_graph_maintenance`; the Workbench review dashboard exposes a `graph_candidates` payload with filters, derived priority and next-action cues, grouped counts, hygiene counts, topology, maintenance counts/lanes/recommendations, node/edge queue rows, selected-candidate source refs, review history, promotion readiness, available actions, and retrieval-inactive governance flags; `/review?view=review` renders `Graph review workload`, `Graph review filters`, `Next graph action`, `Recommended graph decision`, `Open candidate detail`, `Graph topology` with `Active promoted links`, `Candidate links`, `Blocked states`, `Source-backed evidence`, empty topology state, `Graph maintenance` with `No graph maintenance actions are recommended for this project.`, graph candidate lanes, selected detail, promotion readiness, hygiene counts, source evidence, review history, review action forms, and `Promote candidate` only for accepted compatible unpromoted edge candidates; topology is derived from existing candidates, source refs, promotion readiness, and active `edges`, and it does not create first-class graph nodes, auto-promote candidates, mutate graph candidates or `edges`, or change retrieval semantics; graph maintenance previews are read-only by default, apply actions require explicit confirmation, append bounded review history, preserve source refs, do not delete candidates, do not mutate `edges`, do not auto-promote candidates, and do not change retrieval semantics; `/api/review-action` and `/review-action` keep `accept` review-only, route explicit graph activation through `target_kind=graph_candidate` with `action=promote`, and route explicit maintenance through `action=maintenance`; CLI exposes `recallant graph hygiene`, `recallant graph maintenance`, `recallant graph maintenance apply <action> <graph-candidate-id> [--target-graph-candidate-id <id>] --confirm`, `recallant graph promote-candidate <graph-candidate-id> --confirm`, `recallant vault inventory`, `recallant vault candidates`, `recallant vault export`, `recallant keeper candidates`, and `recallant keeper candidates --from-source <project-source-id>`; keeper candidates are dry-run by default, text/file dry-runs remain database-free, source-selected dry-runs require database-backed project-source resolution, persist only with `--write-candidates --confirm`, consume bounded governed Recallant source evidence without raw-reading connectors, arbitrary URIs, server paths, local paths, raw artifacts, backups, passive vault sync, or raw media, preserve source refs, extraction method `keeper`, lifecycle/confidence/reason/provenance metadata, redact unsafe input as `needs_review`, and stay out of default retrieval until explicit compatible promotion; graph-expanded search remains edge-based and one-hop, preserves project/developer/scope/audience/archive/source filters, returns compact graph trace metadata, keeps unpromoted graph candidates out of retrieval, can include explicitly promoted chunk-to-chunk neighbors, and leaves active event/external edges retrieval-inactive; `npm run graph-topology:smoke`, `npm run graph-promotion:smoke`, `npm run graph-retrieval-profiles:smoke`, `npm run graph-candidates:smoke`, `npm run vault-bridge:smoke`, `npm run memory-keeper:smoke`, `npm run phase6:smoke:graph`, `npm run review-ui:smoke`, `npm run review-ui:playwright`, `npm run mcp:smoke`, `npm run build`, `npm run format:check`, `npm run lint`, `npm run public-readiness:smoke`, `npm run public-security:smoke` | First-class graph nodes, graph storage migration decisions, human-memory expansion, conceptual endpoint storage, passive vault sync, raw media ingestion, automatic promotion policies, and retrieval traversal semantics beyond current chunk-to-chunk expansion remain future work; additional Workbench polish after real-world pilots is tracked separately. |
| System activity ledger and audit reports | Working slice | Redacted `system_activity_events` schema, CLI/MCP/Workbench HTTP audit envelopes, `recallant audit`, Workbench Audit view, bounded report filters, model/capture summary, project-sanitize de-identification policy, and backup inclusion; `npm run system-audit:schema-smoke`, `npm run system-audit:mcp-smoke`, `npm run system-audit:cli-smoke`, `npm run system-audit:http-smoke`, `npm run system-audit:report-smoke`, `npm run review-ui:smoke`, `npm run review-ui:playwright`, `npm run phase8:smoke:backup`, `npm run project-sanitize:smoke` | Broader live-host audit review, operator polish, and external monitoring/export integrations remain future work. |
| Project sanitization and purge | Working slice | `recallant project-sanitize`, DB dry-run planner, stale local config target resolution, token-confirmed project purge, redacted receipts, explicit orphan local-only cleanup, local Recallant artifact disconnect, Workbench/API dry-run and confirmation flow; `local-cleanup` uses the same path fallback after detach/sandbox cleanup so stale local project ids do not block removal of generated local artifacts; `npm run project-sanitize:smoke`, `npm run local-cleanup:smoke`, `npm run onboarding:smoke` | Broader real-project dry-run pilots and UI polish before release candidate. |
| Source, capability, and secret references | Working slice | `project_sources`, import candidates, secret-reference detection, connector/server source policies; `npm run project-sources:smoke`, `npm run prepilot:smoke:discovery`, `npm run phase10:smoke` | Live connector ingestion remains governed future work. |
| Cross-project examples | Working slice | Explicit cross-project recall returns source-linked examples and blocks silent rule adoption; `npm run phase10:smoke` | More UI affordances for adopting examples into the current project. |
| Private deployment profiles | Documented and genericized | Self-hosting profiles, `doctor` deployment profile output, `production_readiness.service_runtime` status checks, public route readiness checks, latest backup verification, capability references, private-by-default server posture; public defaults use generic paths and env-provided inventory/security/backup references | Deployment-specific overlays stay private. |
| Remote project access to a central server | Working endpoint, scoped credential, provisioning UX, stdio-to-HTTPS bridge, CLI-first diagnostics, trusted-device reconnect, headless bootstrap tokens, local credential-store references, agent-start remote_mcp_ready consent handoff, invite fallback, external-machine acceptance evidence, strict Capture/Recall Acceptance validator, remote-client cleanup/retry gate, aggregate security smoke, deterministic isolated external-client rehearsal, remote live external canary, opt-in central-server live readiness gate, and universal `curl .../connect \| bash` beginner UX are present | `docs/MCP_SPEC.md` defines the remote MCP contract (`/api/mcp`); `docs/REMOTE_CONNECT_PLAN.md` defines the universal connect contract; `GET /connect`, `/api/connect/start`, `/api/connect/poll`, `/api/connect/cancel`, protected `/connect/approve`, and `recallant connect-cloud` implement browser-approved pairing, trusted-device registration/reconnect, bootstrap-token redemption, local credential-store refs, non-secret consent receipts, and remote-doctor handoff; `recallant remote-credential <create\|list\|rotate\|revoke>` manages project/developer scoped, optionally client-scoped credentials with hash-only storage and one-time create/rotate secrets; protected Workbench/API provisioning routes expose the same scoped lifecycle without unauthenticated public admin access; `recallant remote-bridge` forwards stdio MCP calls to HTTPS `/api/mcp`; `recallant connect-remote` previews Codex, Cursor, Claude Code, and generic MCP configs without `RECALLANT_DATABASE_URL`; `recallant invite` and `/j/<token>` remain the advanced/admin one-time onboarding fallback; `recallant remote-cleanup` safely removes only generated remote client config entries and optional Recallant CLI wrappers without touching source files, `.recallant`, Docker/Postgres, or central records; `recallant remote-doctor` distinguishes network reachability, edge/access posture, scoped credential auth, project/developer/client scope, MCP initialize/tools-list readiness, session/context readiness proof, checkpoint state proof, and opt-in governed semantic marker proof; `recallant agent-start` returns `remote_mcp_ready` for remote-only projects and reports remote destination, credential scope, consent scope, redaction boundary, prohibited secret classes, context-pack startup guidance, and semantic proof call guidance; local `recallant doctor` reports remote-only projects as `remote-ready, local storage not attached` instead of a local attach failure; `recallant remote-acceptance` proves external-machine bootstrap, remote-doctor, remote MCP first-session session/context/write/checkpoint/recall, next-session recall, no local storage install, and redacted evidence; `recallant remote-acceptance validate-live` verifies the same evidence on the central server against Workbench readiness and redacted `system_activity_events` rows without exposing DB/Workbench/admin access to the external machine; `remote-live-external-canary:smoke` runs the automated regression gate for no-CLI/stale-CLI bootstrap, credential refs, missing evidence dirs, reconnect idempotency, forbidden local paths, evidence validation, and server trace validation before asking users for manual remote-client checks; external-host rehearsal results are represented in public docs only as redacted summaries without owner-specific device names, project paths, trace ids, raw evidence ids, or private topology; existing remote smokes validate provisioning, bridge, doctor, security, isolated external rehearsal, cleanup, live readiness, connect storage, connect server routes, connect CLI pairing, connect security, connect external rehearsal, remote live external canary, and agent consent. | Repeat canary-backed external-host rehearsal with universal connect on more client types, broaden old-CLI/no-CLI client pilots after the canary gate, and continue release hardening without exposing Postgres, internal server paths, raw artifacts, backups, or unauthenticated admin routes. |
| CLI version reporting | Working slice | Installed `recallant --version` reports the CLI package version plus git build metadata from checkout installs; `npm run cli-version:smoke` and `npm run public-quickstart:smoke` reject `recallant 0.0.0`. | Versioned release tags and final packaging remain pre-release work. |
| Safety gates | Working slice with required CI and security smoke | Raw-secret redaction, paid API confirmation posture, public exposure warnings, destructive-operation confirmation paths, exact project ID/path preflight before session or spool mutation, exact-line opt-in project-log mirroring, diagnostic-marker conflict exclusion, install/auth/Workbench/backups/secrets security smoke, and owner-only marker scans across public docs and public runtime/install code; pull-request CI runs format/lint/build/public security plus DB-backed onboarding, lifecycle, binding, project-log, diagnostic conflict, Review UI, public readiness, and Playwright gates through `npm test` and explicit browser acceptance; `npm run public-security:smoke`, `npm run security-review:smoke`, `npm run project-binding-regressions:strict`, `npm run project-log-sync:smoke`, `npm run diagnostic-memory-conflicts:smoke`, `npm run phase10:smoke`, `npm run review-ui:playwright` | Independent release hardening review and repeat live operator evidence. |
| Public OSS surface | Working slice | Public docs boundary, readiness smoke, forbidden private marker checks across docs and public code; `npm run public-readiness:smoke`, `npm run public-security:smoke` | Public screenshots and final release packaging. |

## Recent Verification

Recent verification across the current public checkpoint sequence includes:

- `npm run build`
- `npm run format:check`
- `npm run lint`
- `npm run project-binding-regressions:smoke`
- `npm run project-binding-regressions:strict`
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
- `npm run graph-candidates:smoke`
- `npm run graph-retrieval-profiles:smoke`
- `npm run graph-promotion:smoke`
- `npm run graph-topology:smoke`
- `npm run vault-bridge:smoke`
- `npm run memory-keeper:smoke`
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
- `npm run remote-client-cleanup:smoke`
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
report scenarios, production-sensitive dry-run safety, project-binding regressions across
session-derived context/closeout writes and config-derived CLI writes, plus
install/auth/Workbench/backups/secrets security review smoke.

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
- `recallant connect-cloud` runs session/context proof by default after approval, reports the
  normalized proof booleans under `remote_proof`, and keeps governed semantic marker proof explicit
  through `--proof semantic` / `--semantic-proof`;
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

## Deterministic Remote Agent-Ready Gate

The normal repository gate must catch the core remote beginner regression without owner laptop
access or a live central server. `smoke:core` therefore includes `npm run remote-connect-cli:smoke`
and `npm run remote-client-cleanup:smoke`.

That deterministic gate covers the failure mode where remote connect writes only MCP config but does
not leave the project agent-ready. It exercises empty remote projects, existing-doc projects,
existing `AGENTS.md`, credential-ref-only config, no local database storage, dry-run no-write
planning, trusted-device reconnect idempotency, non-ASCII project paths, explicit remote proof
states, and cleanup/retry preservation of source docs and `.recallant` state.

Live external canary and live central-server readiness checks remain release evidence. They must
skip or block safely without explicit live environment variables and must not be hidden dependencies
of normal repository tests.

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
- Browser-first project attachment from the Workbench is future work. The current beginner MVP is a
  universal CLI flow where the user runs one command: `recallant connect <project>`.
- Beginner onboarding is not complete unless `recallant connect <project>` reports storage
  readiness or remote scoped credential readiness, project attach or remote config, client
  connection, capture proof, recall proof, and Workbench outcome.
  `Database not configured` is a blocker, not a successful onboarding result.
- `onboard`, `attach`, client-specific `connect`, `doctor`, and `agent-*` are still useful
  advanced/debug APIs, but the public beginner path should not require users to know those commands.
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
