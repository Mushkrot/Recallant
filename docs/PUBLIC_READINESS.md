# Public Readiness

Stage 7 means a new serious user can find the repository, install Recallant, attach a project,
connect an agent, verify capture, and understand the Workbench without reading internal
architecture documents.

## Current Stage 7 Status

First packaging slice implemented:

- installer profiles exist for `single-user`, `managed-server`, and `owner-server`;
- neutral public server installs can use `managed-server`, while the legacy/current
  `owner-server` profile remains owner-specific;
- production compose and backup scripts honor the selected profile env/data paths;
- managed-server install planning supports explicit Postgres port/container/Compose-project isolation for
  clean-host or side-by-side validation;
- clean-host preflight smoke verifies isolated HOME/PREFIX/DATA install planning plus installed CLI
  wrapper execution without touching owner-server paths;
- Docker-backed managed install smoke passed on the current owner host in an isolated temporary
  managed-server install on 2026-06-02;
- installer dry-run is side-effect free and no longer requires Docker only to preview the plan;
- root README points to the short install/attach path;
- README and Quickstart now use the canonical repository URL instead of placeholder clone commands;
- release/version policy and release-candidate gates are recorded in [RELEASE.md](RELEASE.md);
- public screenshot/redaction policy is recorded in [PUBLIC_SCREENSHOTS.md](PUBLIC_SCREENSHOTS.md);
- public-facing security review checklist is recorded in
  [PUBLIC_SECURITY_REVIEW.md](PUBLIC_SECURITY_REVIEW.md);
- latest Workbench Playwright screenshot QA generated synthetic desktop/mobile candidates under
  `/ai/playwright/reports` on 2026-06-02;
- Quickstart is now the ordinary user path;
- self-hosting details are separated from owner-server operational facts;
- owner-server `/ai` assumptions are documented as one profile, not as the product default;
- installer and onboarding smokes cover dry-run/profile behavior and installed-wrapper attach/capture.

Still pending before a public release claim:

- final manual approval of public-quality screenshots from the latest Workbench visual direction;
- repeat `RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 npm run public-managed-install:smoke` on a clean
  non-owner host or approved isolated container/VM before public release;
- final rollback docs tested on a non-owner host;
- complete mandatory startup parity for the supported clients;
- final manual security review after real clean-host install and screenshot approval.

## Public Acceptance Path

The public path is:

```text
README
  -> Quickstart
  -> installer dry-run
  -> install
  -> recallant doctor
  -> recallant attach .
  -> recallant connect <client>
  -> recallant doctor --require-capture
  -> Workbench confirms capture active
```

The user should not need to understand table names, internal ids, JSON schema names, owner-server
paths, or architecture ADRs to complete this path.

## Automated Guardrail

`npm run public-readiness:smoke` checks that:

- the README links to the public Quickstart;
- the Quickstart contains install, attach, connect, capture-proof, Workbench, Ask Recallant, and
  safe detach steps;
- self-hosting and owner-server documentation are separate;
- public screenshot policy exists and blocks owner paths, private hostnames, emails, tokens, real
  project names, and real memory excerpts;
- installer dry-run for both profiles remains side-effect free;
- managed-server dry-run uses generic Linux paths rather than owner `/ai` paths;
- compose and backup wrappers use profile-driven paths rather than only owner `/ai` paths;
- installer dry-run can print a plan even when Docker is not available in `PATH`.

`npm run public-clean-host:smoke` checks an isolated clean-host-style preflight:

- single-user dry-run uses a temporary HOME;
- managed-server dry-run accepts explicit env/data/prefix overrides;
- managed-server dry-run accepts non-default Postgres port/container/Compose-project overrides;
- dry-run creates no env, data, or CLI paths;
- the CLI wrapper can be installed into a temporary prefix and run a safe command.

`RECALLANT_RUN_MANAGED_INSTALL_SMOKE=1 npm run public-managed-install:smoke` performs the
Docker-backed release-candidate install validation. It uses temporary env/data/prefix paths, a
non-conflicting Postgres port, a unique Postgres container, a unique Compose project, `--no-systemd`,
and cleanup after the run. It is opt-in because it starts Docker. The current-host run passed on
2026-06-02 by installing into `/tmp`, attaching a temporary project, running connect dry-run,
capturing an agent session, and proving capture with `doctor --require-capture`.

`npm run public-security:smoke` checks that normal public onboarding docs do not expose owner
hostnames, owner emails, owner runtime paths, secure env paths, raw database URLs, or raw secret-like
assignments.

This smoke does not prove the whole product is public-ready. It prevents the packaging path from
regressing while Stage 7 continues.
