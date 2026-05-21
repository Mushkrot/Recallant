# ADR-0017: Managed hybrid capture

## Status

Accepted

## Context

The owner chose the hybrid capture approach:

1. Preserve raw evidence broadly where feasible.
2. Derive useful governed memories, checkpoints, decisions, lessons, failures, and rules.
3. Let future agent behavior depend on governed memory and targeted retrieval, not on dumping the raw archive into context.

Different projects need different capture depth. Some important/complex projects need detailed recording. Simpler or lower-risk projects may only need the core decisions and closeout state.

## Decision

AMP v1 must implement **managed hybrid capture**.

The system captures raw evidence and derived memory separately:

- **Raw evidence layer:** broad append-only capture of turns, selected tool metadata, important outputs, errors, and imported sources.
- **Derived memory layer:** structured memories, checkpoints, decisions, constraints, failures, lessons, rules, artifacts, and review proposals.
- **Agent context layer:** bounded recall/context packs that expose only relevant governed memories and selected raw excerpts.

The owner must be able to change capture depth through explicit policy/profile settings. Capture behavior is not one-size-fits-all.

New projects should receive an automatic optimal default instead of forcing the owner to answer during every `amp init`. The owner must be able to adjust that setting later from UI/CLI.

## Capture Profiles

v1 should support configurable profiles such as:

- **light:** mostly closeout/checkpoint, important decisions, failures, and explicit rules. Minimal raw detail.
- **standard:** broad user/assistant turns, important tool metadata, errors, decisions, lessons, closeout, and governed memories.
- **detailed:** more complete raw turn capture, richer tool/output summaries, stronger provenance, and more aggressive derived-memory extraction.
- **custom:** project-specific override with visible reasons.

Profile names may change, but the implementation must support per-project capture policy.

## Policy Controls

The capture policy should control:

- whether to capture user turns fully, summarized, or closeout-only,
- whether to capture assistant turns fully, summarized, or closeout-only,
- how to store tool calls: metadata only, summary, or capped raw excerpts,
- how to handle terminal output: errors/tail only, capped excerpts, or explicit full capture,
- how aggressively to derive governed memories during closeout,
- whether to create review proposals for possible rules,
- how much local spool to keep before server sync/offload,
- secret handling: reject, mask, or warn,
- project-specific overrides and reason text.

These settings are policy/profile defaults, not hard-coded constants.

## Policy Resolution

Capture policy should resolve in this order:

1. explicit task/session override,
2. project policy,
3. developer default policy,
4. server default profile.

The effective policy must be inspectable in UI/CLI so the owner can understand why a project is recording more or less detail.

## Default Selection

`amp init` should assign a sensible default capture profile automatically.

Initial rule:

- default to `standard` for a normal coding project,
- allow `amp init --capture-profile light|standard|detailed|custom` when the owner wants to override immediately,
- allow later changes from Review UI/settings or CLI, for example `amp project set-capture-profile detailed`.

The generated plan/dry-run should show the selected profile and how to change it. The user should not be interrupted with an extra setup question in the normal path.

## Profile Change Semantics

Changing capture profile later affects only:

- the current project,
- future capture after the change.

It does not automatically reprocess old raw evidence, old chunks, old summaries, or old governed memories. Reprocessing/import/re-extraction is a separate explicit command or workflow if needed later.

## Required Behavior

- Raw evidence preservation must never imply that raw evidence is automatically shown to future agents.
- Derived governed memories must keep provenance/source refs back to raw evidence where available.
- Important candidate rules must go to review/inbox rather than silently becoming binding rules.
- Large logs and command outputs must be capped/summarized unless explicit full capture is enabled for the project/session.
- Secrets must be masked/rejected according to security policy before durable storage where feasible.
- Offline/local spool follows the same capture policy, then syncs to the server.

## Consequences

- v1 can serve both high-detail serious projects and lighter projects without separate architecture.
- Storage grows predictably because raw detail is governed by policy and cleanup/offload.
- Future reprocessing remains possible only as an explicit operation because raw evidence is preserved when the selected profile allows it.
- Review UI should expose capture policy/profile per project and show when a memory came from raw evidence versus derived extraction.

## Open questions

- Should detailed/full terminal output capture require temporary session-level confirmation even when project profile is detailed?
