# Product Contract Status

This page tracks how the public Recallant product contract maps to implementation and smoke-test
evidence. It is intentionally public and generic: owner-specific server inventories, private access
provider settings, secret locations, and internal handoffs belong outside this repository.

Recallant is still pre-release. A status of "working slice" means the behavior exists and has smoke
coverage, but may still need external-host rehearsal, broader client pilots, UI polish, screenshots,
or release packaging before it should be treated as stable infrastructure.

## Contract Coverage

| Contract Area | Current Status | Evidence | Remaining Work |
|---------------|----------------|----------|----------------|
| Agent-ready project onboarding | Working slice with one-command beginner path | `recallant onboard <project>`, `npm run product-acceptance:smoke`, `npm run onboarding:smoke`, `npm run public-clean-host:smoke`, `npm run public-quickstart:smoke`, `npm run public-install-rollback:smoke`, `npm run public-managed-install:smoke` | External-host release rehearsal and broader client pilots before release candidate. |
| Thin bootstrap files | Working slice | Attach/init create `.recallant/config`, `AGENTS.md`, `PROJECT_LOG.md`, client MCP config, and `.gitignore`; `npm run repo-contract:smoke`, `npm run connect:smoke` | Keep generated files compact as more clients are added. |
| Existing-project migration | Working slice | Discovery/import classify old agent files, handoffs, `.env.example`, runbooks, secret references, risky content, backups, and migration summaries; `npm run prepilot:smoke:discovery`, `npm run prepilot:smoke:import`, `npm run phase10:smoke`, `npm run non-owner-migration:smoke`, opt-in `npm run real-project-pilots:smoke` one-command sandbox-copy pilots | More real-world pilots before release candidate. |
| Capture-active proof | Working slice with quickstart proof | Onboard verify reports structured capture/readiness/recall stages; `public-quickstart:smoke` proves installed-wrapper onboarding, capture active evidence, recall proof, and Workbench outcome; `npm run product-acceptance:smoke`, `npm run demo-capture:smoke`, `npm run agent-capture:smoke` | Keep proof visible in Workbench and docs. |
| Context-pack startup and closeout | Working slice | MCP/CLI startup, checkpoint, closeout, recovery, and local spool paths; `npm run phase3:smoke`, `npm run spool:smoke`, `npm run product-acceptance:smoke` | Improve closeout extraction and reporting quality. |
| Governed memory and review | Working slice | Source refs, statuses, rule promotion gates, conflict views, Review UI, Workbench migration review queue, and browser-level Workbench QA; `npm run phase6:smoke:governed`, `npm run review-ui:smoke`, `npm run review-ui:playwright` | More real-world review ergonomics after broader migration pilots. |
| Source, capability, and secret references | Working slice | `project_sources`, import candidates, secret-reference detection, connector/server source policies; `npm run project-sources:smoke`, `npm run prepilot:smoke:discovery`, `npm run phase10:smoke` | Live connector ingestion remains governed future work. |
| Cross-project examples | Working slice | Explicit cross-project recall returns source-linked examples and blocks silent rule adoption; `npm run phase10:smoke` | More UI affordances for adopting examples into the current project. |
| Private deployment profiles | Documented and genericized | Self-hosting profiles, `doctor` deployment profile output, production-readiness checks, capability references, private-by-default server posture; public defaults use generic paths and env-provided inventory/security references | Deployment-specific overlays stay private. |
| Safety gates | Working slice with security smoke | Raw-secret redaction, paid API confirmation posture, public exposure warnings, destructive-operation confirmation paths, install/auth/Workbench/backups/secrets security smoke, owner-only marker scans across public docs and public runtime/install code; `npm run public-security:smoke`, `npm run security-review:smoke`, `npm run phase10:smoke` | Independent release hardening review. |
| Public OSS surface | Working slice | Public docs boundary, readiness smoke, forbidden private marker checks across docs and public code; `npm run public-readiness:smoke`, `npm run public-security:smoke` | Public screenshots and final release packaging. |

## Recent Verification

Recent verification across the current public checkpoint sequence includes:

- `npm run build`
- `npm run format:check`
- `npm run lint`
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
- `npm run non-owner-migration:smoke`
- `RECALLANT_REAL_PROJECT_PILOTS=<comma-separated paths> npm run real-project-pilots:smoke`
- `npm run review-ui:smoke`
- `npm run review-ui:playwright`
- `npm run pilot-report:smoke`
- `git diff --check`

Those checks cover the public docs boundary, attach migration summaries, capture-active proof,
cross-project recall behavior, clean-host install planning, fresh public quickstart onboarding,
rollback dry-run and marked-artifact cleanup, Docker-backed managed install smoke, genericized
deployment-profile defaults, neutral non-owner migration safety, opt-in real-project pilot safety on
sandbox copies through one-command onboarding, original-file integrity checks, Workbench browser QA,
and lifecycle cleanup that hides temp memory spaces without deleting records. They also cover
Workbench migration review ergonomics, autonomous browser QA with synthetic screenshots, pilot
report scenarios, and production-sensitive dry-run safety, plus install/auth/Workbench/backups/secrets
security review smoke.

## What Is Not Ready Yet

- Recallant should not be treated as stable team-wide infrastructure.
- Beginner onboarding is not complete unless `recallant onboard <project>` reports storage
  readiness, project attach, client connection, capture proof, recall proof, and Workbench outcome.
  `Database not configured` is a blocker, not a successful onboarding result.
- `attach`, `connect`, `doctor`, and `agent-*` are still useful advanced/debug APIs, but the public
  beginner path should not require users to know those commands.
- Live connector ingestion is not the default; connector records are governed references until setup,
  consent, and policy allow capture.
- Public exposure of Workbench, admin APIs, MCP, backups, or raw artifacts is not a default mode.
- Private deployment overlays are intentionally not published in this repository.
- Broader personal-life memory, team/multi-user workflows, and richer connector ecosystems remain
  future expansion after the coding-agent core is stable.
- The disposable clean-host smokes are not a substitute for one final external-host release
  rehearsal before tagging.

## Release-Candidate Bar

Before a release-candidate tag, the project should have:

- external-host release rehearsal that repeats the public quickstart and rollback path;
- existing-project migration proof with backup and review behavior on broader real-world projects;
- autonomous Workbench browser QA and public screenshots with synthetic data only;
- independent hardening after the install/auth/Workbench/backups/secrets security smoke;
- passing public readiness and security smokes.
