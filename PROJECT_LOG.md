# Project Log

## Current Session

Status: test_project_1 autonomous E2E validation complete; product gaps fixed.
Current focus: keep the new-project onboarding path reliable through real MCP/context/capture
smoke coverage.
Next step: commit/push the E2E fixes, restart Recallant service, then continue with richer
Management UI action flows or real-agent manual inspection if desired.

## Active Constraints

- Recallant is the main source of truth for durable project memory.
- This file is a compact fallback/checkpoint, not the full project history.
- Do not store secrets in repo docs or Recallant memories.
- Production-sensitive, destructive, paid API, public exposure, firewall, and secret-handling
  changes still require owner participation.
- On the owner server, consult `/ai/SECURITY` and `/ai/PORTS.yaml` before exposure/service/security
  changes.

## Recent Decisions

- The operator path must be human-friendly: install with `scripts/install-recallant.sh`, then attach
  a normal project with `recallant attach .`.
- Management Chat must use a local AI model for natural-language interpretation when available,
  while deterministic policy remains authoritative for risky actions.
- Explicit owner requests to save low-risk rules for all projects create developer-scope
  `instruction_grade` memories that future Context Packs include across projects.
- Installed CLI attach must treat an explicit project path as authoritative. It must not reuse the
  server's configured `RECALLANT_PROJECT_ID` for `/ai/recallant` when attaching another project.
- Existing `.recallant/config` must be validated against the DB project binding. If it points to a
  different path, attach treats it as stale/foreign and rewrites it for the current project.
- Do not ask the owner to perform basic attach validation before the agent has independently run an
  equivalent real command path.

## Verification

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run review-ui:smoke`
- `npm run phase10:smoke`
- real installed-wrapper attach from `/tmp/recallant-new-project-smoke` against isolated dev
  Postgres with production-like host project env binding
- real installed-wrapper attach of `/ai/test_project_1`, resulting in sandbox project
  `9f7bca40-f763-4cb2-846b-909729882c51`
- production `recallant doctor`
- production `/health`
- live Management Chat API using local `mistral-small:24b`

## Open Questions

- Whether to keep or later clean up the sandbox E2E memories/events in `/ai/test_project_1`.
- Whether to implement local sandbox file cleanup after confirmed detach next.
- How far to deepen Management UI action flows before attaching a live production-sensitive project.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
