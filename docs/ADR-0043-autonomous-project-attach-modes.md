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

If the owner does not provide a mode, `autopilot` is the default. Production-sensitive detection may
still downgrade the workflow to `guided` unless production-safe autopilot is explicitly approved.

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
- create a starter project-local memory for new empty projects;
- update already-attached projects idempotently without creating a new `project_id`;
- extract structured ordinary memories/decisions from imported material when confidence and source
  refs are strong.

Autopilot must not do these silently:

- promote imported or inferred material to `instruction_grade` when broad/risky;
- import raw secret values;
- enable paid API or `auto_with_caps`;
- change public exposure, firewall, Cloudflare, or service bindings;
- perform destructive deletion or permanent erasure;
- apply broad developer/global rules;
- bind connector accounts or capability/secret references as active behavior without policy review;
- attach a known production-critical project when the configured policy requires manual/guided mode.

### Production-sensitive behavior

Production-sensitive projects can be declared by flags/settings or detected from deployment,
security, service, public-domain, paid/billing, real-env-reference, Cloudflare/DNS, or similar hints.

If a production-sensitive project is requested with `autopilot`, Recallant must switch to `guided`
unless the owner explicitly supplies a production approval flag. Production-approved autopilot is
still production-safe only: it cannot silently perform destructive actions, service restarts, deploy
changes, public/security/firewall changes, paid API enablement, raw-secret handling, erasure, or
active connector/capability binding.

## User-facing command shape

The target command is:

```bash
recallant attach <project-dir> --mode autopilot --target codex
```

`recallant init` remains valid as the lower-level registration/bootstrap command. `attach` is the
product workflow that can call init, discover, import, lint, context, doctor, and report generation
according to the selected mode.

The first implementation slice should include all three modes. `manual` and `guided` are permanent
safety controls, not temporary scaffolding.

## Agent startup file migration

Attach must migrate the project from local-file memory to Recallant-backed memory intelligently. It
does not mechanically choose between "project rules win" and "Recallant defaults win."

Required behavior:

- discover all relevant agent startup/config/handoff files;
- locally back up all discovered agent files before changing any existing one;
- classify project rules, client-specific instructions, old startup flows, history/handoff text,
  environment facts, secret/capability hints, stale text, and conflicts;
- preserve important project rules and migrate them into Recallant as project-local memories or
  review candidates;
- import old history/handoff sections as evidence-only;
- normalize startup files so future agents route through `memory_start_session` and
  `memory_get_context_pack`;
- keep `PROJECT_LOG.md` as a compact agent-readable fallback/checkpoint file;
- avoid silent deletion of important project rules or irreversible cleanup.

Backups live under `.recallant/backups/attach-<timestamp>/`, are local, must be gitignored, and are
not imported into Recallant as raw memory. If an original file contains raw secrets, the backup copy
must be redacted too.

## Secret and `.env.example` handling

Recallant stores secret references and capability maps, not raw secrets. `.env.example` and similar
safe example files may be imported as variable names/purpose only. Likely raw secrets must not enter
Recallant.

For live/production-sensitive projects, autopilot may warn and create review items for raw secrets
but must not modify the source file without confirmation. For sandbox/test projects, policy may allow
automatic masking after a redacted local backup.

## PROJECT_LOG.md role

`PROJECT_LOG.md` remains part of the repo contract, but it is no longer the full project memory. It
is a compact agent-readable fallback/checkpoint updated during attach, checkpoint writes, and
closeout. Long history and archived handoffs belong in Recallant as evidence.

## Reporting

Every attach mode produces a human-readable report:

- what was changed;
- what was imported;
- what was intentionally left as evidence-only;
- what requires review;
- which agents/config files were prepared;
- how to test the project;
- how to detach/cleanup the attach records later.

The report should be concise by default: ready status, what was done, what needs attention, how to
check, and next step. Technical details can be available separately for agents.

## Detach policy

Detach has three different meanings:

- live project detach defaults to hiding/archiving the project in Recallant without touching project
  files or physically deleting records;
- sandbox/test cleanup may delete/archive Recallant records and offer to remove local Recallant
  files after dry-run and confirmation;
- sensitive/wrong memory requires a separate `forget forever` erasure workflow, not ordinary detach.

## Consequences

- The old discovery-first/import-by-confirmation workflow remains available as `manual`.
- The first product-grade attach implementation should include `manual`, `guided`, and `autopilot`,
  with `autopilot` as default and production-sensitive downgrade to `guided`.
- Tests must prove that autopilot does not silently create instruction-grade rules, leak secrets,
  enable paid providers, or modify unrelated projects.
