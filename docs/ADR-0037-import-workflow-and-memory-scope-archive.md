# ADR-0037: Import workflow and memory scope discussion archive

## Status

Superseded by ADR-0039 and ADR-0040

## Context

Two questions were originally coupled:

1. Import workflow: how old project data enters Recallant.
2. Memory scope/audience: where imported and governed memories are allowed to apply.

Question 9 import workflow is now accepted in [ADR-0039](ADR-0039-v1-import-workflow.md). Question 12 memory scope/audience is now accepted in [ADR-0040](ADR-0040-memory-scope-and-audience-model.md).

Examples include `PROJECT_LOG.md`, selected docs, architecture notes, git history, JSONL/chat exports, and later GitHub/Drive/Gmail/Calendar connectors. This archive remains as historical context for why ADR-0039 and ADR-0040 were split into separate accepted decisions.

Additional owner clarification after inspecting the live server environment:

- The current `/ai/*` project layout, `/ai/SECURITY` control-plane repo, and `/opt/secure-configs/.env` shared secret file are real first-deployment facts, not universal Recallant architecture constants.
- Recallant should support this environment through configurable server/project facts, secret references, and capability/account bindings.
- The same mechanism must support other future layouts, secret stores, and connector/account bindings rather than hard-coding the current server shape.
- `agent-bootstrap` is the owner's earlier personal sketch for the same problem, not a mature external upstream. It may inform repo-native fallback/import ideas, but should not be treated as a finished implementation source.
- Server environment discovery and portable instance migration are accepted in ADR-0038.

## Final guardrails carried forward

- Do not treat the current `/ai` server layout or shared secret path as hard-coded scope semantics; they are deployment-profile facts to model.
- Follow ADR-0039 for v1 import behavior.
- Follow ADR-0040 for scope/audience.

## Superseding decisions

Question 13 conflict resolution / priority is now accepted in [ADR-0041](ADR-0041-conflict-resolution-priority.md):

- precedence between current user instruction, accepted governed memory, imported docs, environment facts, and raw evidence,
- broader/narrower scope conflict handling,
- client-adapter and connector/capability conflict surfacing,
- when to ask the owner versus choosing the narrower/current source.
