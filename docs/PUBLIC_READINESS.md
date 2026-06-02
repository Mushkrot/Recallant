# Public Readiness

Stage 7 means a new serious user can find the repository, install Recallant, attach a project,
connect an agent, verify capture, and understand the Workbench without reading internal
architecture documents.

## Current Stage 7 Status

First packaging slice implemented:

- installer profiles exist for `single-user`, `managed-server`, and `owner-server`;
- neutral public server installs can use `managed-server`, while the legacy/current
  `owner-server` profile remains owner-specific;
- installer dry-run is side-effect free and no longer requires Docker only to preview the plan;
- root README points to the short install/attach path;
- Quickstart is now the ordinary user path;
- self-hosting details are separated from owner-server operational facts;
- owner-server `/ai` assumptions are documented as one profile, not as the product default;
- installer and onboarding smokes cover dry-run/profile behavior and installed-wrapper attach/capture.

Still pending before a public release claim:

- real public repository URL and release/version policy;
- public-quality screenshots from the final Workbench visual direction;
- broader external-user install run on a clean VM/container;
- final rollback docs tested on a non-owner host;
- complete mandatory startup parity for the supported clients;
- refreshed security review for any public-facing packaging instructions.

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
- installer dry-run for both profiles remains side-effect free;
- managed-server dry-run uses generic Linux paths rather than owner `/ai` paths;
- installer dry-run can print a plan even when Docker is not available in `PATH`.

This smoke does not prove the whole product is public-ready. It prevents the packaging path from
regressing while Stage 7 continues.
