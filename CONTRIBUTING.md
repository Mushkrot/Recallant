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

Use Node.js 20.19 or later and npm 10 or later. CI uses Node.js 24.
The following checks do not require a database:

```bash
npm ci
npm run build
npm run lint
npm run format:check
```

### Product and browser tests

Product tests need PostgreSQL with pgvector. The development Compose file provides an isolated
database on port 15433. Start it and apply its schema:

```bash
npm run db:up
npm run db:migrate
```

Set `RECALLANT_DATABASE_URL` to this development database using the connection settings in
[the CI workflow](.github/workflows/ci.yml). Never point tests at a database containing project
memory you want to keep. Configure the deterministic integration embedding route, then run:

```bash
npm run integration-embedding-route:configure
npm test
npx playwright install chromium
npm run review-ui:playwright
```

`npm run db:reset:integration` recreates the development database and deletes its existing data;
use it only for a disposable test database. `npm run db:down` stops the development stack.

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

Public documentation should help users evaluate, install, run, and contribute to Recallant.
