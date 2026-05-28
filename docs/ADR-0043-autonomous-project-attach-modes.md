# ADR-0043: Autonomous project attach modes

## Status

Accepted

## Context

The owner wants Recallant to become an autonomous memory platform. The normal experience should not
require the owner to manually run discovery, inspect JSON, choose every import, and approve every
safe memory write. At the same time, the owner must be able to switch to more cautious workflows for
production projects, risky migrations, debugging, or early trust-building.

Existing documents already define safe discovery, explicit import, Review UI, context packs, and
governed memory. This ADR adds the product-level attach mode that composes those pieces.

## Decision

Recallant will support **three project attach modes**.

### `manual`

The cautious mode. Recallant performs only the command explicitly requested:

- `recallant discover` is read-only.
- `recallant import --dry-run` writes nothing.
- Confirmed `recallant import` writes only selected sources.
- The owner or agent chooses each durable import/action.

Use this for production-sensitive projects, debugging, or when the owner wants full step-by-step
control.

### `guided`

The preview/confirm mode. Recallant analyzes the project and proposes a complete plan, then waits
for confirmation before durable writes:

- shows the sources it will import or skip;
- explains risks in plain language;
- identifies likely stale/conflicting material;
- proposes default profile/settings;
- asks only for decisions that change durable behavior or risk posture.

Use this as the default early-pilot mode.

### `autopilot`

The target everyday mode. Recallant analyzes, attaches, imports safe material, creates repo-native
bootstrap surfaces, verifies the result, and produces a short owner-readable report.

Autopilot may do the following without separate owner confirmation:

- create or update pointer-only `.recallant/config`;
- create or update thin agent bootstrap instructions;
- create `PROJECT_LOG.md` if missing;
- register the project and ordinary project settings;
- run discovery and lint;
- import low-risk selected project memory surfaces as source-linked evidence/chunks;
- create ordinary `accepted` + `recall_allowed` memories when provenance and risk policy allow;
- leave candidate/high-risk records in Review UI;
- run non-destructive smoke checks and context-pack preview.

Autopilot must not do these silently:

- promote imported or inferred material to `instruction_grade` when broad/risky;
- import raw secret values;
- enable paid API or `auto_with_caps`;
- change public exposure, firewall, Cloudflare, or service bindings;
- perform destructive deletion or permanent erasure;
- apply broad developer/global rules;
- bind connector accounts or capability/secret references as active behavior without policy review;
- attach a known production-critical project when the configured policy requires manual/guided mode.

## User-facing command shape

The target command is:

```bash
recallant attach <project-dir> --mode autopilot --target codex
```

`recallant init` remains valid as the lower-level registration/bootstrap command. `attach` is the
product workflow that can call init, discover, import, lint, context, doctor, and report generation
according to the selected mode.

## Reporting

Every attach mode produces a human-readable report:

- what was changed;
- what was imported;
- what was intentionally left as evidence-only;
- what requires review;
- which agents/config files were prepared;
- how to test the project;
- how to detach/cleanup the attach records later.

The report should be concise by default and link to technical details for agents.

## Consequences

- The old discovery-first/import-by-confirmation workflow remains available as `manual`.
- The first product-grade attach implementation should start with `guided`, then add `autopilot`
  once detach/cleanup and Review UI inspection are safe enough.
- Tests must prove that autopilot does not silently create instruction-grade rules, leak secrets,
  enable paid providers, or modify unrelated projects.
