# Project Log

## Current Session

Status: QA-found attach identity bug fixed and verified.
Current focus: make the one-command project onboarding path trustworthy without using the owner as
manual QA.
Next step: commit/push this fix, then continue with either safe repair/detach of the bad
`/ai/test_project_1` attachment record or richer owner-facing Management UI actions.

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
- production `recallant doctor`
- production `/health`
- live Management Chat API using local `mistral-small:24b`

## Open Questions

- Whether to repair or detach the incorrect `/ai/test_project_1` sandbox record created before this
  fix.
- Whether to implement local sandbox file cleanup after confirmed detach next.
- How far to deepen Management UI action flows before attaching a live production-sensitive project.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
