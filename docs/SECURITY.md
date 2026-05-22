# Security

## 1. Threat model (concise)

| Threat | Mitigation v1 |
|--------|----------------|
| `DATABASE_URL` leak | Store only in env/secret manager; do not log; do not commit. |
| Cross-project data leak | Every query filters by `project_id`; server process can be bound to one `RECALLANT_PROJECT_ID` in simple v1 profiles. |
| Cross-project context contamination | Projects are relevance-scoped by default; cross-project recall requires explicit `scope=all`/developer memory or user/agent intent. |
| Prompt injection through memory | Retrieval returns bounded excerpts, not raw archive dumps; agents treat recalled text as untrusted data. Optional excerpt prefix: `[[memory]]`. |
| Silent promotion of untrusted memory | Agent-created records may be auto-created for recall, but server blocks silent promotion to `instruction_grade` without user/import/review-approved policy. |
| Unauthorized review action through UI | Review UI/admin API must require private network access plus token/session auth and must use the same server-side review policy as MCP/CLI. |
| Natural-language command overreach | Chat can propose actions, but destructive/cost/security/global-rule/connector actions require server-side policy checks and explicit confirmation. |
| Accidental public exposure of management UI | Review UI is private by default. Future Cloudflare/subdomain access must require explicit owner configuration, Cloudflare Access or equivalent edge auth, Recallant auth/session policy, and no unauthenticated public admin surface. |
| DoS through huge turns/tool outputs | Enforce inline text limits on append; large payloads go through raw artifact pointer/hash/excerpt with policy caps. |
| Secret exfiltration into memory | Secret-like/high-entropy input should warn/reject according to ingestion policy when supported. At minimum, agents follow `REPO_CONTRACT.md` guidelines and store secret references, not raw secrets. |
| Backup exposure | Backups are encrypted before leaving Recallant server; manifests must not contain raw secrets; future second-server replication uses private SSH/Tailscale or an explicit secure transport. |
| Incomplete erasure | Permanent erasure must remove/redact active content and derived material; receipts must not contain erased content. |
| Owner-server port conflict | Before service start, check and update `/ai/PORTS.yaml` with port/bind mode; default bind stays localhost/private. |

## 2. Credentials

- Postgres user with minimal privileges: DDL only through migrations; runtime role without `DROP DATABASE`.
- A separate read-only role is not required in v1; adding a read replica requires an ADR.
- Recallant Review UI/admin API require Recallant-level auth even on Tailnet/SSH routes. Private network access alone is not enough.
- MCP/admin API tokens are server-side credentials. Do not put long-lived secrets into project repositories; generated local config may reference secret labels or environment variable names.
- Browser/UI clients must never receive OpenAI/Claude/Gemini/provider API keys.

## 3. PII And Erasure

- The platform does not automatically classify PII in v1.
- `PRD.md` keeps legal hold/compliance as a non-goal. If needed, add a new ADR plus explicit tombstone/legal-hold policy.
- Owner-confirmed permanent erasure is supported for wrong or sensitive memory and must remove/redact active and derived content.

## 4. Transport

- stdio MCP: trust boundary is the local OS user.
- Remote MCP/admin API, when enabled, requires token/session auth and private transport by default.
- Review UI/admin API binds to localhost/Tailnet by default and must not be exposed publicly by default.
- Future Cloudflare access is an expected near-future deployment mode, but must be explicit owner configuration and must preserve authenticated management-only access.
- Cloudflare deployment requires edge auth such as Cloudflare Access or equivalent plus Recallant auth/session. Cloudflare alone does not replace Recallant auth.
- No unauthenticated public Review UI, admin API, MCP endpoint, backup browser, or raw-artifact route is allowed.
- On the owner's server, consult `/ai/SECURITY` before exposure/firewall/Cloudflare/service changes and register ports in `/ai/PORTS.yaml` before service start.

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

- Never log full `payload.text` or raw artifact content at `info` level; `debug` only behind an explicit flag.
- Backup/restore logs may include ids, counts, sizes, hashes, and status, but not raw memory text, raw artifact content, provider API keys, or secret env values.
- Erasure logs may include safe ids/counts/status and redacted receipts only. They must not include the erased content.
