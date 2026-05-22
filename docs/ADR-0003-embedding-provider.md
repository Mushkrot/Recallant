# ADR-0003: Embedding provider — local default with cloud fallback

## Status

Accepted, refined by [MODEL_ROUTING.md](MODEL_ROUTING.md), [ADR-0012-local-first-model-router.md](ADR-0012-local-first-model-router.md), [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md), and [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md)

## Context

Recallant needs to convert text chunks into vectors for semantic search through pgvector. The architecture needs a choice between cloud APIs and local models.

Target deployment is one personal Linux server, potentially with a 24GB GPU. Requirements: local by default, data does not leave the server for basic recall, acceptable quality for coding context, and external LLMs only as optional enrichment paths.

## Decision

Use **Ollama + local embeddings** as the recommended default provider, while the architecture supports cloud embedding fallback and model routing.

- Initial candidate model/profile default: `nomic-embed-text`
- Initial dims for that model/profile: 768
- Runtime: use an existing configured Ollama service when available; do not start a duplicate stack by default.
- Cloud embeddings fallback must be supported through provider adapters. Initial fallback candidates are `openai/text-embedding-3-small`, `gemini/gemini-embedding-001`, and `gemini/gemini-embedding-2`.
- External providers remain allowed for optional enrichment/consolidation/rerank/review assistance, but basic append/search must not depend on them.

The local-first requirement is architectural. The exact embedding model, dimensions, batch size, and warmup behavior are configurable operational defaults. Changing dimensions still requires explicit reindex/migration because stored vectors and indexes depend on dimensionality.

## Consequences

- Positive: no external token bill, data stays local, no dependency on external APIs, offline-capable.
- Negative: requires GPU or enough CPU/RAM; first model load can have cold-start latency.

## Performance expectations

| Hardware | Latency per configured batch | Note |
|----------|-------------------------------|------------|
| CPU only (4 cores) | ~3-6s | Enough for real-time 1-3 chunks/turn work |
| GPU | ~0.2-0.5s | Recommended for large imports |
| 24GB VRAM server GPU | workload-dependent | Candidate for nightly re-embed, consolidation, local rerank, and review assistance jobs |

`nomic-embed-text` is the initial profile default because it is compact and CPU-friendly. It is not a permanent architecture invariant; if quality or deployment evidence points elsewhere, the model can change through configuration plus explicit reindex.

## Cold start

On first call or after restarting the local provider, the model may take a few seconds to load into memory. Later calls are faster while the model remains warm.

On startup, Recallant server should support policy-controlled warmup/probe of the local embedding provider so the first real call does not fail mysteriously. If the local provider is unavailable, server may route to configured cloud fallback or return `UNAVAILABLE` depending on policy.

## Model switching

Changing `RECALLANT_EMBEDDING_MODEL` requires full reindex of all chunks; see `INGESTION.md`. Dimension changes require a pgvector index migration. Do not do this without explicit `recallant reindex`.

## Alternatives considered

- **OpenAI text-embedding-3-small**: higher quality for some general tasks and 1536 dimensions, but paid and sends data to an external service. Allowed as fallback through `RECALLANT_EMBEDDING_MODEL=openai/text-embedding-3-small`.
- **Gemini embeddings**: useful as an alternate cloud profile, especially if Gemini is already enabled for other routes or multimodal retrieval becomes important. Must still follow the same explicit reindex rule when model/dims change.
- **ChromaDB with built-in embeddings**: hides details but adds a second storage service next to Postgres; rejected in ADR-0001.

## Configuration

```env
RECALLANT_EMBEDDING_MODEL=nomic-embed-text
RECALLANT_EMBEDDING_DIMS=768
RECALLANT_OLLAMA_URL=http://localhost:11434
RECALLANT_CLOUD_EMBEDDING_FALLBACK=disabled|enabled
```
