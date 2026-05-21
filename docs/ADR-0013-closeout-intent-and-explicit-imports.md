# ADR-0013: Closeout intent and explicit imports

## Status

Accepted. Detailed import workflow is accepted in [ADR-0039](ADR-0039-v1-import-workflow.md); memory scope/audience is accepted in [ADR-0040](ADR-0040-memory-scope-and-audience-model.md).

## Context

The owner wants agents to understand closeout intent from natural language, not only from one rigid command. At the same time, project onboarding must not silently import every historical file, log, doc, git commit, or external source.

Closeout and import are related but separate actions:

- closeout preserves the current session state,
- import brings historical/external material into AMP.

## Decision

AMP recognizes closeout intent through:

- simple trigger phrases for common cases,
- context-aware interpretation,
- LLM intent classification for ambiguous cases,
- confirmation only when the action is unclear, risky, or would trigger non-routine work.

Examples that should trigger closeout when context supports it:

- "Закрываем сессию"
- "Exit"
- "Сохрани все и выходим"
- "Я делаю паузу"
- "Обнови документацию и заверши"

Closeout must not automatically perform broad historical imports.

Imports are explicit. Accepted v1 import behavior is discovery-first, import-by-confirmation:

```bash
amp discover
amp init
amp import project-log PROJECT_LOG.md
amp import docs docs/architecture/*.md
amp import git --since 2026-01-01 --paths backend/
amp import jsonl export.jsonl
```

Future connector imports may include GitHub, Drive, Gmail, Calendar, browser history, and notes apps, but they require connector-specific design and explicit owner action.

`amp init` must not import all detected history automatically. It may detect import candidates and print suggested commands.

`amp import` must support preview/dry-run before durable writes. Imported material is classified as raw evidence, chunks, candidate memories, environment facts, secret references, capability/account bindings, checkpoint seeds, or repo contracts. It must not silently become `instruction_grade`.

## Consequences

- Agents can close sessions naturally without forcing the owner to remember exact commands.
- Ambiguous phrases can be classified with local/cloud model routing, but basic known triggers should not require cloud.
- Risky or broad actions still require confirmation.
- Project bootstrap stays light and safe.
- Historical context enters AMP through provenance-preserving explicit imports.
- Scope/audience assignment follows ADR-0040.
- Conflict priority follows ADR-0041.

## Open questions

- Should v1 expose a dedicated `amp closeout` CLI command in addition to natural-language closeout?
- Should closeout always produce a human-readable report, or only when there are proposals/conflicts/unsynced data?
- Which future connector, if any, should be promoted into v1 after core architecture is complete?
- Exact CLI flags and preview output format for `amp import --dry-run`.
- Exact dedup strategy for repeated imports.
