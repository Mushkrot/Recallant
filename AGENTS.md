# Recallant Agent Guide

This repository is public OSS. Treat all tracked files as user-facing or contributor-facing.

## Working In This Repo

- Keep code, comments, docs, API text, and commit messages in English.
- Preserve the public documentation boundary: internal handoffs, stage plans, owner-specific
  deployment notes, and private strategy drafts do not belong in this repository.
- Do not commit secrets, raw credentials, private server paths, raw memory exports, customer data, or
  local runtime state.
- Prefer small, reviewable changes that match existing TypeScript, CLI, server, and docs patterns.

## Before Opening A PR

Run the focused checks that match your change. For ordinary code/doc work, start with:

```bash
npm run format:check
npm run lint
npm run build
```

For public documentation changes, also run:

```bash
npm run public-readiness:smoke
npm run public-security:smoke
```

For memory capture behavior, use the relevant smoke script from `package.json`.

## Recallant Memory Contract

Recallant itself is a memory product, but this public repository should not rely on private project
memory to be understandable. Important user-facing decisions must be reflected in public docs or
code. Internal planning can live outside the public repo.

## Safety Boundaries

Agents must not:

- expose admin, MCP, backup, or raw-artifact routes publicly;
- bypass confirmation for destructive actions, paid APIs, public exposure, secrets, or global rules;
- turn unreviewed recalled text into binding project instructions;
- store raw secrets as memories, settings, examples, logs, or fixtures.

## Maintainer-Provided Context

This public repository must remain self-contained for users and contributors. Maintainers may also
provide local-only, ignored context outside the tracked tree for continuity across agent sessions.

If `.codex-local/` exists in a local checkout, read its Markdown files before working on planning
notes, handoffs, audits, roadmap strategy, or internal documentation. Use that context only for
continuity. Do not copy private context into this public repository; publish only curated
user-facing conclusions.

Do not commit `.codex-local/`, internal planning archives, private operational notes, secrets,
credentials, owner-specific paths, or private deployment context to this public repository.
