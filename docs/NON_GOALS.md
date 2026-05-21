# Non-goals (explicit exclusions)

Следующее **намеренно не входит** в scope текущей спецификации платформы.

## Продукт и аудитория

- Не делаем широкий **primary UI для всего Recallant** как обязательную часть v1. Исключение: owner-facing Review UI для governed memory входит в v1; см. `ADR-0016-review-ui-in-v1.md`. Не делаем marketing/SaaS dashboard, полный observability suite или визуальный редактор всех raw events/chunks.
- Не оптимизируем под **маркетинговый SaaS** (billing, multi-tenant product, self-serve signup).
- Не делаем **скоростной throwaway MVP**, в котором ради быстроты выброшены provenance, review/use policy или governed agent memory. Скорость реализации ниже качества core.
- Не делаем в v1 полноценную систему захвата всей повседневной жизни человека. Но архитектура должна оставить путь к этому OB1-style расширению через domains/scopes/connectors.
- Не начинаем implementation до явного разрешения владельца; текущий deliverable — архитектурная документация.
- Не расширяем первый implementation scope за пределы full coding-agent memory core без отдельного решения владельца; см. `ADR-0025-v1-core-and-expansion-boundary.md`.

## Масштаб и deployment

- Не проектируем **planet-scale** шардирование в v1. Цель — корректная архитектура на одном Postgres instance (single-node), с ясным путём эволюции.
- Не вводим object storage, dedicated vector DB или graph DB как обязательные v1 dependencies. Они остаются future evolution paths when measured data volume/query patterns justify them.
- Не обещаем **полностью автоматический** capture всех чатов из всех CLI без явной спецификации источника; см. `INGESTION.md` — часть каналов остаётся explicit/export.

## Модель данных и AI

- Не делаем **«универсальную БД для чего угодно»** (CRM, биллинг, inventory). Только артефакты памяти агентов и связанный граф.
- Не гарантируем **семантическую корректность** summary без human review: summaries — derived layer с provenance, могут ошибаться; SoT — raw append layer.
- Не делаем **универсальный LLM gateway** для любых внешних приложений. Но Recallant включает local-first model router для собственных memory tasks; см. `MODEL_ROUTING.md` и `ADR-0012`.

## Безопасность (границы)

- Не реализуем **full enterprise compliance** (SOC2 evidence pack) в v1; делаем baseline security в `SECURITY.md`.
- Не храним **plaintext секреты** пользователя в memory store; секреты вне системы.

## Интеграции

- Не поддерживаем **все** существующие IDE и чаты в v1. Минимум: MCP-клиенты + документированный ingest для перечисленных CLI в `INGESTION.md`.
- Не реализуем Gmail/Drive/Calendar/GitHub/browser/screenshot connectors в первом core scope. Архитектура должна позволять их добавить позже.

## Качество «идеально»

- «Идеально» означает **архитектурно выверенный core**, а не «все возможные фичи в первом релизе». Расширения — через ADR и новые фазы.
- Governed agent memory входит в core v1. Не переносить этот слой в future work только ради сокращения объёма реализации.
