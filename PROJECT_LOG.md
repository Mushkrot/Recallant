# Project Log

## Current Session

Status: Recallant product-UX checkpoint deployed and closeout handoff refreshed.
Current focus: preserve a clean resume point after one-command onboarding, AI-backed Management
Chat, and developer-wide global-rule workflow.
Next step: start the next session from `docs/SESSION_HANDOFF_CURRENT.md`, verify `git status`, then
continue with richer owner-facing Management UI actions or optional sandbox local cleanup.

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

## Verification

- `npm run build`
- `npm run lint`
- `npm run format:check`
- `npm run review-ui:smoke`
- `npm run phase10:smoke`
- production `recallant doctor`
- production `/health`
- live Management Chat API using local `mistral-small:24b`

## Open Questions

- Whether to implement local sandbox file cleanup after confirmed detach next.
- How far to deepen Management UI action flows before attaching a live production-sensitive project.

## Recallant

- Project: recallant
- Project id: 84eda3bf-cb72-4bcf-aeec-2f2b84ebd6ce
- Server URL: https://recallant.unicloud.ca
