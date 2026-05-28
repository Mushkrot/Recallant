# Local Model Readiness

Date: 2026-05-28 UTC.

## Summary

Recallant local model readiness was verified on the owner server without paid API use and without
service restarts.

Ollama is active on `127.0.0.1:11434`. The production expected model list is now:

- `nomic-embed-text`
- `qwen2.5-coder:7b`
- `qwen2.5-coder:14b`
- `mistral-small:24b`

`recallant doctor` reports Ollama reachable and `missing_models: []`.

## Architecture Choice

Use this local-first model structure:

- **Always-available embedding route:** `nomic-embed-text`
  - Required for Recallant vector/hybrid retrieval.
  - Small enough to keep warm.
  - Produces 768-dimensional embeddings.
- **Light local code/extraction fallback:** `qwen2.5-coder:7b`
  - Useful when a smaller local LLM is enough.
  - Do not use for quality-critical summaries by default.
- **Default local code-heavy model:** `qwen2.5-coder:14b`
  - Better quality/code tradeoff than 7B.
  - Good candidate for future local extraction/classification once that route is wired.
- **Highest-quality installed local general model:** `mistral-small:24b`
  - Use when quality matters more than load time.
  - Load on demand and unload after use.

Do not add another large local model merely because it exists in docs. `gpt-oss:20b` remains a
future route candidate, not a current requirement, because current Recallant production code uses
only embeddings directly. The installed `qwen2.5-coder:14b` and `mistral-small:24b` already cover
local code-heavy and quality-general fallback needs for the next pilot.

## Changes Made

- Pulled `nomic-embed-text`.
- Re-pulled existing installed models to verify manifests:
  - `qwen2.5-coder:7b`
  - `qwen2.5-coder:14b`
  - `mistral-small:24b`
- Updated `/opt/secure-configs/recallant.env` so
  `RECALLANT_EXPECTED_OLLAMA_MODELS` includes `nomic-embed-text`.
- Implemented the production Ollama embedding adapter in `@recallant/db`.
- Updated `recallant doctor` model detection so `model` and `model:latest` are treated as the
  same installed Ollama tag.

## Verification

Direct Ollama embedding test:

- Model: `nomic-embed-text`
- Endpoint: `/api/embeddings`
- Result: success
- Dimensions: `768`

Recallant production sandbox MCP test:

- Project: GutenDocx sandbox `29bc4ee3-cac8-4c3f-9634-ef47d0401ae9`
- `memory_append_turn` returned:
  - `status=embedded`
  - `provider=ollama`
  - `model=nomic-embed-text`
  - `dims=768`
- `memory_search` with `mode=vector_only` returned the appended sandbox chunk through `path=vector`.
- `memory_closeout` returned `report_required=false`.
- Existing GutenDocx sandbox chunks created before the adapter fix were re-embedded with
  `nomic-embed-text`.
- A follow-up `memory_search mode=vector_only` query for GutenDocx `config.yaml` runtime state
  returned imported document chunks through `path=vector`.

Large local LLM generation smoke with `keep_alive=0s`:

| Model | Result | Total elapsed | Load duration | Output |
|-------|--------|---------------|---------------|--------|
| `qwen2.5-coder:7b` | ok | 54,969 ms | 54,879 ms | `OK` |
| `qwen2.5-coder:14b` | ok | 22,917 ms | 22,835 ms | `OK` |
| `mistral-small:24b` | ok | 53,246 ms | 53,088 ms | `OK` |

Post-test `ollama ps` showed only `nomic-embed-text` still loaded. The large LLMs unloaded after
the smoke because they were invoked with `keep_alive=0s`.

## Operational Notes

- Keep `nomic-embed-text` warm; its footprint is small and it is the normal Recallant vector path.
- Load large LLMs on demand. The observed load times are significant enough that switching among
  many large models would make interactive work worse.
- Prefer `qwen2.5-coder:14b` for future local code/extraction routes unless there is a clear reason
  to use the 7B model.
- Prefer `mistral-small:24b` when the task is quality-sensitive and not code-specific.
- Paid APIs remain disabled/confirmation-gated.
- The GutenDocx sandbox now has vector-ready chunks, but this was a one-time sandbox repair. A
  first-class `recallant reindex` / project detach command is still the right product follow-up.
