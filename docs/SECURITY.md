# Security

## 1. Threat model (concise)

| Threat | Mitigation v1 |
|--------|----------------|
| Утечка `DATABASE_URL` | Хранить только в env/secret manager; не логировать; не коммитить. |
| Cross-project data leak | Каждый query фильтрует `project_id`; server process bound to single `RECALLANT_PROJECT_ID` (рекомендация v1). |
| Cross-project context contamination | Projects are relevance-scoped by default; cross-project recall requires explicit `scope=all`/developer memory or user/agent intent. |
| Prompt injection через память | Retrieval возвращает **excerpts**, not raw archive dumps; агент обязан трактовать как недоверенные данные; опционально префикс в excerpt `[[memory]]`. |
| Silent promotion of untrusted memory | Agent-created records may be auto-created for recall, but server blocks silent promotion to `instruction_grade` without user/import/review-approved policy. |
| Unauthorized review action through UI | Review UI/admin API must require private network access plus token/session auth and must use the same server-side review policy as MCP/CLI. |
| Accidental public exposure of management UI | Review UI is private by default. Future Cloudflare/subdomain access must require explicit owner configuration, Cloudflare Access or equivalent edge auth, Recallant auth/session policy, and no unauthenticated public admin surface. |
| DoS через огромные turns/tool outputs | Лимит размера inline `text` на append; большие payloads идут через raw artifact pointer/hash/excerpt с policy caps. |
| Secret exfiltration в память | Запрет паттернов в `INGESTION.md` policy: если `text` содержит высокоэнтропийные токены — warn/reject (опционально фаза 2); минимум — документированный guideline для агентов в `REPO_CONTRACT.md`. |
| Backup exposure | Backups are encrypted before leaving Recallant server; manifests must not contain raw secrets; future second-server replication uses private SSH/Tailscale or an explicit secure transport. |

## 2. Credentials

- Postgres user с минимальными правами: DDL только миграциями; runtime role без DROP DATABASE.
- Отдельный read-only role **не обязателен** v1; если добавляется read replica — ADR.
- Recallant Review UI/admin API require Recallant-level auth even on Tailnet/SSH routes. Private network access alone is not enough.
- MCP/admin API tokens are server-side credentials. Do not put long-lived secrets into project repositories; generated local config may reference secret labels or environment variable names.
- Browser/UI clients must never receive OpenAI/Claude/Gemini/provider API keys.

## 3. PII

- Платформа не классифицирует PII автоматически в v1.
- В `PRD.md` non-goal: нет legal hold pipeline. При необходимости — новый ADR + `events` tombstone policy.

## 4. Transport

- stdio MCP: доверие к локальному пользователю OS.
- Remote MCP/admin API, when enabled, requires token/session auth and private transport by default.
- Review UI/admin API binds to localhost/Tailnet by default and must not be exposed publicly by default.
- Future Cloudflare access is an expected near-future deployment mode, but must be explicit owner configuration and must preserve authenticated management-only access.
- Cloudflare deployment requires edge auth such as Cloudflare Access or equivalent plus Recallant auth/session. Cloudflare alone does not replace Recallant auth.
- No unauthenticated public Review UI, admin API, MCP endpoint, backup browser, or raw-artifact route is allowed.

## 4.1 Default and Cloudflare-ready modes

Default v1 mode:

```text
Tailscale/SSH -> Recallant auth -> Review UI/admin API
```

Cloudflare-ready future mode:

```text
Cloudflare-managed subdomain -> edge auth -> Recallant auth -> Review UI/admin API
```

The v1 implementation should not hard-code Tailnet-only assumptions into sessions, cookies, allowed origins, API route layout, or reverse-proxy handling. It should remain private by default while allowing future Cloudflare configuration without rewriting auth.

## 5. Logging

- Никогда не логировать полный `payload.text` или raw artifact content на `info` уровне; `debug` только за флагом.
- Backup/restore logs may include ids, counts, sizes, hashes, and status, but not raw memory text, raw artifact content, provider API keys, or secret env values.
