# Contributing

Thanks for considering a contribution to Recallant.

Recallant is pre-release, so the best contributions are focused, well-scoped, and easy to verify.

## Good First Areas

- documentation clarity;
- install and quickstart feedback;
- MCP client compatibility notes;
- smoke-test improvements;
- security review of public defaults;
- bug reports with reproducible commands.

## Development Setup

```bash
npm ci
npm run build
npm run lint
npm run format:check
```

For public documentation changes:

```bash
npm run public-readiness:smoke
npm run public-security:smoke
```

## Pull Requests

- Keep PRs focused.
- Explain the user-visible behavior change.
- Include the checks you ran.
- Do not include secrets, private deployment notes, raw memory exports, or local runtime state.
- If a change affects install, auth, Workbench exposure, paid APIs, or memory governance, call that
  out explicitly.

## Documentation Boundary

Public docs should help users evaluate, install, run, and contribute to Recallant. Internal stage
plans, handoffs, owner-specific deployment notes, and strategy drafts belong outside the public repo.
