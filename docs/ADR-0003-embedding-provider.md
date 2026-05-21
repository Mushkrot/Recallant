# ADR-0003: Embedding provider — local default with cloud fallback

## Status

Accepted, refined by [MODEL_ROUTING.md](MODEL_ROUTING.md), [ADR-0012-local-first-model-router.md](ADR-0012-local-first-model-router.md), [ADR-0015-configurable-operational-heuristics.md](ADR-0015-configurable-operational-heuristics.md), and [ADR-0023-baseline-model-portfolio-and-provider-switching.md](ADR-0023-baseline-model-portfolio-and-provider-switching.md)

## Context

AMP требует преобразования текстовых chunks в векторы для semantic search (pgvector). Нужен выбор между облачным API и локальной моделью.

Целевой deployment: один личный Linux сервер, potentially with 24GB GPU. Требования: локальность по умолчанию, данные не покидают сервер для базового recall, приемлемое качество для coding context, возможность использовать внешний LLM только как optional enrichment path.

## Decision

Использовать **Ollama + local embeddings** как рекомендуемый default provider, while architecture must support cloud embeddings fallback and model routing.

- Initial candidate model/profile default: `nomic-embed-text`
- Initial dims for that model/profile: 768
- Запуск: Docker контейнер Ollama на том же сервере что и Postgres
- Cloud embeddings fallback must be supported through provider adapters. Initial fallback candidates are `openai/text-embedding-3-small`, `gemini/gemini-embedding-001`, and `gemini/gemini-embedding-2`.
- External providers remain allowed for optional enrichment/consolidation/rerank/review assistance, but basic append/search must not depend on them.

The local-first requirement is architectural. The exact embedding model, dimensions, batch size, and warmup behavior are configurable operational defaults. Changing dimensions still requires explicit reindex/migration because stored vectors and indexes depend on dimensionality.

## Consequences

- Положительные: бесплатно, данные локально, нет зависимости от внешних API, работает offline.
- Отрицательные: требует GPU или достаточного CPU/RAM на сервере; холодный старт при первой загрузке модели.

## Performance expectations

| Hardware | Latency per configured batch | Примечание |
|----------|-------------------------------|------------|
| CPU only (4 cores) | ~3–6s | Достаточно для реального времени (1-3 chunks/turn) |
| GPU (любой, даже старый) | ~0.2–0.5s | Рекомендуется при импорте больших объёмов |
| 24GB VRAM server GPU | workload-dependent | Candidate for nightly re-embed, consolidation, local rerank, and review assistance jobs |

`nomic-embed-text` is the initial profile default because it is compact and CPU-friendly. It is not a permanent architecture invariant; if quality or deployment evidence points elsewhere, the model can change through configuration plus explicit reindex.

## Cold start

При первом запуске или после рестарта Ollama-контейнера модель загружается в память (~2–5 секунд). Последующие вызовы — без задержки (модель остаётся в памяти пока контейнер запущен).

AMP server при старте должен поддерживать policy-controlled warmup/probe of the local embedding provider so the first real call does not fail mysteriously. If the local provider is unavailable, server may route to configured cloud fallback or return `UNAVAILABLE` depending on policy.

## Model switching

Смена `AMP_EMBEDDING_MODEL` требует полного reindex всех chunks (см. `INGESTION.md`). Dims при смене модели требуют миграции pgvector-индекса. Не делать без явного `amp reindex`.

## Alternatives considered

- **OpenAI text-embedding-3-small**: выше качество на общих задачах, 1536 dims, но платно и данные уходят во внешний сервис. Допустим как fallback через `AMP_EMBEDDING_MODEL=openai/text-embedding-3-small`.
- **Gemini embeddings**: useful as an alternate cloud profile, especially if Gemini is already enabled for other routes or multimodal retrieval becomes important. Must still follow the same explicit reindex rule when model/dims change.
- **ChromaDB со встроенными embeddings**: скрывает детали, но добавляет второй сервис рядом с Postgres — отклонено в ADR-0001.

## Configuration

```env
AMP_EMBEDDING_MODEL=nomic-embed-text
AMP_EMBEDDING_DIMS=768
AMP_OLLAMA_URL=http://localhost:11434
AMP_CLOUD_EMBEDDING_FALLBACK=disabled|enabled
```
