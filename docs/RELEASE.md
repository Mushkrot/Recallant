# Release And Version Policy

Recallant is not public-release ready yet, but Stage 7 now has a concrete release-readiness
contract.

## Repository URL

Canonical repository URL for public instructions:

```text
https://github.com/Mushkrot/Recallant.git
```

Use this URL in README and Quickstart examples. Do not use placeholder clone URLs in public-facing
docs.

## Versioning

Before the first public release:

- keep `package.json` at `0.0.0` while the repository is still pre-release;
- use dated documentation checkpoints and git commits for internal progress;
- do not tag `v1.0.0` until the public acceptance path is verified on a clean non-owner host.

After first public release:

- use semantic versioning for CLI/server/API-visible behavior;
- patch version for compatible bug fixes and documentation corrections;
- minor version for compatible new CLI/API/UI capabilities;
- major version for breaking CLI, MCP, data-model, or install-profile changes.

## Release Candidate Gate

A release candidate must prove:

- README and Quickstart use the canonical repository URL;
- installer dry-run works for `single-user` and `managed-server`;
- `npm run public-clean-host:smoke` passes as the local clean-host preflight;
- managed-server clean-host validation uses non-conflicting Postgres port/container settings when
  run beside another Recallant instance;
- install succeeds on a clean non-owner Linux host or container;
- `recallant doctor` runs through the installed CLI;
- a clean project can attach, connect, record, checkpoint, close out, and later recall;
- Workbench opens privately and shows capture active;
- public screenshots follow [PUBLIC_SCREENSHOTS.md](PUBLIC_SCREENSHOTS.md) and contain no private
  paths, tokens, project names, hostnames, or owner email addresses;
- rollback instructions have been tested on a non-owner host;
- `npm run public-security:smoke` passes;
- security docs have been manually reviewed for public-facing instructions.

## What Must Not Be Released As Public Defaults

- owner-server `/ai` paths;
- Cloudflare hostname `recallant.unicloud.ca`;
- private owner email addresses;
- raw env values, database passwords, session secrets, auth tokens, API keys, or connector secrets;
- public MCP/admin/raw-artifact/backup endpoints;
- paid API routes without explicit confirmation gates.
