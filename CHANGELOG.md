# Changelog

## Unreleased

### Session continuity and recovery

- Store checkpoints per session so parallel chats keep independent recovery state. Legacy project
  checkpoints retain an explicit ambiguous-owner status instead of being assigned to a new chat.
- Preserve task checkpoints during context compaction and recover known sessions after a restart.
- Retain first and repeated checkpoints during a remote outage, then replay them in order.
- Reconcile local session state after offline replay, including closeout and newly started chats.
  Quarantined spool records stay excluded while permitted records continue to sync.
- Bind remote workspace paths through the authenticated project scope and reject mismatched owners
  or project identities.

### Memory and client compatibility

- Preserve factual closeout summaries as recallable memory while keeping instruction-like or
  sensitive candidates subject to review. Closeout reports checkpoint, memory and next-session
  readiness separately.
- Prioritize explicit identifiers in bounded startup context; report omissions instead of silently
  exceeding the requested budget.
- Normalize supported tool-schema and empty-artifact inputs across local MCP and remote bridges.
- Refresh dependency resolutions, including the Zod and body-parser advisory fixes.

These changes do not establish capture parity across native clients. Review holds and bounded-pack
omissions remain part of the memory contract.

## v0.1.0-dev.4 — 2026-10-12

Guided device-trust renewal, configured public-server discovery and dependency updates.
See the [release notes](docs/releases/v0.1.0-dev.4.md).

## Earlier releases

- [v0.1.0-dev.3](docs/releases/v0.1.0-dev.3.md): HTTP, filesystem and governance hardening.
- [v0.1.0-dev.1](docs/releases/v0.1.0-dev.1.md): pinned installation and release verification.
- [v0.1.0-dev.0](docs/releases/v0.1.0-dev.0.md): initial development prerelease.
