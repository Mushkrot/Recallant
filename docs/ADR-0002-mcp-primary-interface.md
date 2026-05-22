# ADR-0002: MCP as primary agent interface (v1)

## Status

Accepted, refined by [ADR-0016-review-ui-in-v1.md](ADR-0016-review-ui-in-v1.md)

## Context

The target users of the system are **coding agents** in Codex, Cursor, Windsurf, Claude Code, and compatible MCP clients. They need a stable memory-call mechanism without custom HTTP integrations per client.

## Decision

In v1, **all** agent-facing memory read/write operations go through **MCP tools** with the contract in [MCP_SPEC.md](MCP_SPEC.md).

Owner-facing governed-memory review is a separate surface: ADR-0016 requires a Review UI/admin API in v1. This does not make REST/HTTP the primary agent interface.

## Consequences

- Clients get a uniform connection mechanism.
- Testing depends on an MCP harness, usually stdio first.
- Native plugins for every editor are not required in v1.

## Alternatives considered

- REST first: more work for each client and different auth models.
- File-only memory: does not scale to hybrid/graph retrieval with bounded context controls.
