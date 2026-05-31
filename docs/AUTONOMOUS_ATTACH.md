# Autonomous Project Attach

This document describes the target product workflow for connecting a project to Recallant.

## Purpose

The owner should be able to open a folder, run one command or ask Recallant in natural language, and
have the project become part of Recallant memory without hand-building agent docs, copying handoff
files, or manually choosing every safe import.

Autonomous attach is the target everyday path, but Recallant must keep cautious modes available.

If no mode is provided, the default mode is `autopilot`, except when production-sensitive detection
forces a safer workflow.

## Modes

| Mode | Best for | Behavior |
|------|----------|----------|
| `manual` | production-sensitive projects, debugging, early audits | Run only explicit commands. Discovery and dry-run write nothing. Imports require selected commands. |
| `guided` | first real projects, migrations, owner review | Build a full attach plan and wait for confirmation before durable writes. |
| `autopilot` | normal daily use after trust is established | Analyze, attach, import safe evidence, create bootstrap files, verify, and report. |

The same project can be re-run in a different mode. Modes are workflow policies, not different data
models.

The first implementation slice should implement all three modes. `manual` and `guided` are not
temporary scaffolding; they are permanent safety controls.

## Target commands

```bash
recallant attach .
recallant attach . --sandbox
recallant attach <project-dir> --target codex --mode autopilot
recallant attach <project-dir> --target codex --mode guided
recallant attach <project-dir> --target codex --mode manual
recallant attach <project-dir> --target codex
```

`recallant init`, `discover`, `import`, `lint-context`, `context`, and `doctor` remain lower-level
commands. `attach` coordinates them.

The operator-facing product path must not require manually invoking `node apps/cli/dist/index.js` or
sourcing the server env file. On an installed server, `recallant` is a global command and the CLI
auto-loads the configured env file when present.

## Autopilot pipeline

1. Identify the project root and existing `.recallant/config`.
2. Register or update the project row.
3. Select a capture/context profile, normally `standard` for ordinary projects.
4. Create or update pointer-only `.recallant/config`.
5. Create or update thin agent instructions for the selected target.
6. Create `PROJECT_LOG.md` if missing.
7. Run safe discovery for project docs, handoffs, `.env.example`, repo contracts, and selected
   runbooks.
8. Classify findings into evidence, chunks, candidate memories, checkpoint seeds, environment facts,
   secret references, capability bindings, connector-account bindings, and repo contracts.
9. Import low-risk source-linked evidence according to policy.
10. Keep risky/broad records as `needs_review` or candidates.
11. Run context lint and a context-pack preview.
12. Run diagnostics such as Postgres/Ollama/model route checks.
13. Run a local MCP session smoke when the configured environment allows it.
14. Verify the project appears in the Review UI/API with imported items and pending review records.
15. Produce an owner-readable report.

For a new empty project, attach should also create a starter project-local memory that records:

- the project was attached to Recallant;
- the selected attach mode;
- which bootstrap files were created or updated;
- Recallant is the main source of truth for project memory;
- `PROJECT_LOG.md` is a compact fallback/checkpoint file;
- agents should start with `recallant agent-start --task-hint "<current task>"`, which uses
  `memory_start_session` and `memory_get_context_pack` when direct MCP is available and local spool
  fallback when it is not.

This starter memory is ordinary `accepted` + `recall_allowed` memory unless a stronger
owner-confirmed rule path applies.

If the project is already attached, `attach` must be idempotent:

- reuse the existing `project_id`;
- validate `.recallant/config`;
- update stale bootstrap sections when needed;
- import only new safe source/hash combinations;
- avoid duplicate records;
- report what was already current and what changed.

## Agent file migration

Attach must treat agent startup files as a migration problem, not a simple "project rules versus
Recallant defaults" conflict.

Autopilot should find and analyze all relevant agent startup/config/handoff files, including:

- `AGENTS.md`;
- compact/current `PROJECT_LOG.md`;
- `CLAUDE.md`;
- `.cursor/rules/*`;
- `.cursor/SESSION_HANDOFF.md` when current;
- equivalent client-specific startup or handoff files.

The analyzer should classify content into:

- important project rules;
- safety, deployment, security, and destructive-operation rules;
- client-specific instructions;
- old startup flow instructions;
- history, logs, and handoff material;
- environment facts;
- secret references and capability hints;
- stale, duplicated, conflicting, or risky text.

Important project rules must not be deleted merely because Recallant has defaults. They should be
migrated into Recallant as project-local governed memories or review candidates, while local startup
files are normalized so future agents use Recallant for memory and history.

Startup files after attach should be thin:

- `AGENTS.md` remains the primary agent entrypoint and router.
- `PROJECT_LOG.md` remains a compact agent-readable fallback/checkpoint.
- client-specific files remain only for clients that read them and should point toward the same
  Recallant workflow.
- long history/handoff sections should move to Recallant as historical evidence.

After a local backup, autopilot may normalize files when confidence is high:

- add or update `Memory (Recallant)` sections;
- replace old "read all local history at startup" flows with the Recallant capture runtime:
  `recallant agent-start`, meaningful `agent-event` calls, `agent-checkpoint`, and
  `agent-closeout`;
- shrink or remove history/handoff sections that were imported as evidence;
- update `PROJECT_LOG.md` to the compact fallback/checkpoint format;
- keep project-specific rules that agents still need locally;
- report every changed file.

Autopilot must not silently remove important project rules, resolve high-risk conflicts, or erase
local content irreversibly.

## Local backup before file changes

Before changing any existing agent startup/config/handoff file, attach must create a local backup.
If no existing file is changed, a backup is not required for newly created files.

The backup should include all discovered agent files, not only files that will be modified, so the
old startup mode can be reconstructed:

```text
.recallant/backups/attach-<timestamp>/
  manifest.json
  AGENTS.md
  PROJECT_LOG.md
  CLAUDE.md
  .cursor/rules/...
  .cursor/SESSION_HANDOFF.md
```

`manifest.json` should include:

- attach mode;
- timestamp;
- detected project sensitivity;
- discovered agent files;
- changed and unchanged files;
- hashes before/after where available;
- redaction notices;
- rollback instructions.

Backups are local project safety artifacts. They are not imported into Recallant as raw memory and
must remain gitignored.

If a source file contains raw secrets, the backup copy must be redacted too. Rollback may restore
the old structure, but not the secret value.

## PROJECT_LOG.md role

`PROJECT_LOG.md` remains required, but its role changes:

- Recallant is the main source of truth.
- `PROJECT_LOG.md` is a compact agent-readable fallback/checkpoint.
- It should contain current state, current focus, next step, active constraints, open questions,
  recent decisions, and Recallant fallback instructions.
- It should not contain long history, old chats, or archival handoffs.

Recallant updates `PROJECT_LOG.md` during attach, `memory_set_checkpoint`, and `memory_closeout`.
If Recallant is unavailable, agents may write minimal fallback state there and sync it back later.

## Historical files and structured extraction

Old archives such as `PROJECT_LOG_*.md`, old session handoffs, and historical agent files should be
imported as `historical evidence-only` by default:

- not loaded at startup;
- not promoted to rules;
- available through targeted search;
- risky findings routed to Review.

Autopilot should still attempt structured extraction from imported material when confidence is high:

- ordinary memories;
- project-local decisions;
- lessons;
- failures;
- artifact references;
- current checkpoint candidates.

Low-confidence, stale, broad, risky, conflicting, security/deploy/destructive/paid-API,
connector/account, and capability-binding findings go to Review or remain evidence-only.

## Secret references

Recallant must not store raw secrets. When attach sees `.env.example` or similar safe example files,
it may import variable names and purpose as secret/capability references without values.

If a likely raw secret appears in an agent/startup/config-doc file:

- do not import the secret;
- create a warning and Review item;
- redact the local backup copy;
- redact or remove the secret in sandbox/test projects when policy permits;
- in live/production-sensitive projects, do not modify the source file without confirmation.

## Safety gates

Autopilot may create useful memory automatically, but it must preserve governance:

- no raw secret values;
- no silent paid API enablement;
- no public exposure changes;
- no destructive cleanup/erasure;
- no broad developer/global rule without explicit confirmation or review;
- no instruction-grade promotion for stale/imported/inferred material unless a strong policy path
  exists;
- no whole-repo, whole-git-history, bulk Drive/Gmail/Calendar/GitHub import by default.
- no raw-secret masking in live projects without confirmation;
- no service restart, deployment change, firewall/security change, or public exposure change.

## Production-sensitive projects

Attach must support both explicit and automatic production-sensitive detection.

Explicit signals:

- `--production`;
- `--live`;
- project setting;
- `--production-approved`.

Automatic signals:

- production docs;
- deploy configs;
- systemd units;
- production Docker Compose files;
- public domains;
- payment/billing references;
- real env/secret references;
- Cloudflare/DNS/security/deploy references;
- public app/service hints.

If a project is detected as production-sensitive and the requested mode is `autopilot`, Recallant
must switch to `guided` unless the user explicitly passes a production approval flag.

With explicit production approval, Recallant may run **production-safe autopilot**, but the hard
safety gates still apply: no raw secrets, destructive actions, service restarts, firewall/security
changes, public exposure changes, deploy changes, paid API enablement, deletion/erasure, or active
connector/capability binding without separate confirmation.

## Report shape

The default attach report should be very short. It should answer these questions in human language:

- Is the project attached?
- What was done?
- What requires attention?
- How can the owner check it?
- What is the next step?

Detailed technical JSON/details may exist behind a flag, a file, or Review UI. The default should not
force the owner to read ids, source refs, counts, or internal policy fields.

## Detach and cleanup

Autonomous attach requires a matching governed cleanup path:

- dry-run detach report with affected counts;
- remove or archive project records from active UI/search according to policy;
- optionally offer local `.recallant` pointer/bootstrap/sandbox-copy cleanup after a dry-run;
- never affect the original project when testing a copied sandbox;
- preserve audit/provenance unless explicit erasure is confirmed.

The first implementation slice is `recallant detach`. It records project lifecycle state in
Recallant, hides detached projects from active Review UI project lists, and blocks active search for
the detached project. It does not delete project files or physical database rows.

Detach policy:

- live project default: hide/archive/detach in Recallant only; do not delete physical records or
  touch project files by default.
- sandbox/test cleanup: after dry-run and explicit confirmation, hide the sandbox project from
  active UI/search and archive active chunks so it no longer participates in normal retrieval. The
  report offers separate local cleanup for `.recallant/config`, generated MCP hints, and runtime
  session pointers. Bootstrap files and backups are not removed automatically because backups may be
  redacted and human review is safer.
- sensitive/wrong memory: use the separate `forget forever` erasure workflow, not ordinary detach.

Local cleanup command:

```bash
recallant local-cleanup --project-dir <project> --dry-run
recallant local-cleanup --project-dir <project> --confirm
```

Confirmed local cleanup is blocked until the project is already `detached` or `sandbox_cleaned` in
Recallant. The first slice removes only local Recallant pointer/runtime files:
`.recallant/config`, `.recallant/codex-mcp.json`, and `.recallant/current-session.json`.
`AGENTS.md`, `PROJECT_LOG.md`, `.gitignore`, source files, local attach backups, and the sandbox
copy directory are preserved unless a later explicit workflow handles them separately.
