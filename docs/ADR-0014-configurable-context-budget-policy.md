# ADR-0014: Configurable context budget policy

## Status

Accepted refinement

## Context

Earlier drafts used concrete file-size targets for `AGENTS.md`, adapter files, and active `PROJECT_LOG.md`. The owner correctly pointed out that fixed universal numbers are too rigid: large projects may legitimately need more startup guidance, and different agents/models have different context windows.

The real architectural requirement is not a specific KB number. The requirement is that startup context remains intentional, bounded, relevant, and free of duplicated history.

## Decision

AMP must use a **configurable context policy** instead of hard-coded universal file-size limits.

Policy inputs:

- effective model/client context window when known,
- project size and shape,
- project kind: small repo, large repo, monorepo, regulated/ops-heavy project, etc.,
- task type,
- configured profile: `compact`, `standard`, `expanded`, or `custom`,
- explicit project override with reason.

The policy controls:

- startup repo-file budget,
- context-pack budget,
- recall/search `max_chars_total`,
- warning/error severity for large files,
- whether a project override is accepted.

Concrete size numbers may exist as implementation defaults, but they are not architecture invariants.

## Hard Rules

Some issues are hard failures regardless of configured size:

- duplicated long history copied into `AGENTS.md` or adapter files,
- adapter files duplicating canonical rules instead of pointing to them,
- secrets in startup files or memory bootstrap,
- `PROJECT_LOG.md` becoming a months-long archive instead of current resume state,
- startup flow reading all docs/logs/archive files by default.

## Flexible Rules

These are configurable warnings, not universal failures:

- `AGENTS.md` length,
- adapter file length,
- active `PROJECT_LOG.md` length,
- context pack size,
- number of governed memories returned at startup,
- whether a large project needs a larger repo-file budget.

## Override Model

Overrides must be explicit and inspectable.

Example:

```yaml
context_policy:
  profile: expanded
  reason: "Large monorepo with several agent entrypoints and operational runbooks."
  expires_at: null
  startup:
    allow_larger_repo_files: true
  lint:
    severity_for_size_excess: warn
    severity_for_history_dump: error
```

Policy may live in AMP project settings first. A small committed policy file can be added later if portability requires it, but it must stay declarative and must not become another long instruction dump.

## Consequences

- Large projects can intentionally increase budgets without fighting the tool.
- `amp lint-context` becomes policy-aware instead of enforcing one fixed size.
- The core discipline remains: repo files route to memory; they do not become the memory store.
- Server-side context pack remains the preferred long-term mechanism for central budget enforcement.

## Open questions

- Should project-level context policy live only in AMP DB, or also support a committed `amp.context.yml`?
- What default profiles should ship in v1?
- Should the context pack budget be derived automatically from detected model context window, or set explicitly per project/client?
