# GutenDocx Sandbox Pilot Report

Date: 2026-05-28 UTC.

## Summary

Recallant was tested against a copied GutenDocx project, not the live `/ai/gutendocx` tree.

- Original project: `/ai/gutendocx`
- Sandbox copy: `/ai/recallant-pilots/gutendocx-20260528T161238Z`
- Sandbox source branch: `exp/libreoffice-toc`
- Sandbox source commit: `fe756d4`
- Recallant sandbox project id: `29bc4ee3-cac8-4c3f-9634-ef47d0401ae9`

The original project remained untouched. After the pilot, `/ai/gutendocx` still had only the
pre-existing `config.yaml` working-tree modification, and no `.recallant` or spool directory was
created there.

## Safety Boundaries

- The sandbox was created with `git clone --no-hardlinks /ai/gutendocx`.
- Runtime/user state was not copied because ignored runtime directories such as `Uploads/` and
  `output/` were absent from the sandbox clone.
- `config.yaml` was not imported because it is runtime/user-editable state in GutenDocx.
- No production GutenDocx service commands were run beyond read-only health checks.
- No Cloudflare, firewall, systemd, or production GutenDocx configuration changes were made.
- No destructive cleanup was performed.

## Sources

Discovery found five import candidates:

- `.cursor/SESSION_HANDOFF.md`
- `AGENTS.md`
- `Docs/README.md`
- `PROJECT_LOG.md`
- `README.md`

All five were dry-run previewed, then explicitly imported. Each source imported as
`needs_review` with `use_policy=evidence_only`. No source was promoted to `instruction_grade`, and
no secret references were detected.

Imported record counts:

- `5` import events
- `5` raw artifacts
- `16` imported chunks, plus `1` MCP append-turn chunk
- `5` governed memory records
- `5` source refs

## MCP Checks

The sandbox project was exercised through local stdio MCP:

- `memory_start_session` created sandbox sessions.
- `memory_get_context_pack` returned the sandbox project id.
- `memory_append_event` wrote workflow evidence and closed cleanly.
- `memory_append_turn` created a searchable sandbox marker.
- `memory_search` found the appended marker and found GutenDocx `config.yaml` context from imported
  chunks.
- `memory_recall_agent_memories` returned `Imported AGENTS.md` and `Imported PROJECT_LOG.md` when
  `include_needs_review=true`.
- `memory_closeout` completed with `report_required=false` and no warnings.

Important behavior: `memory_append_event` stores workflow evidence but does not create searchable
chunks by itself. Searchable conversational evidence came from `memory_append_turn`.

## Review Dashboard

The Review Dashboard data path was checked with the sandbox project env:

- Pending review: `5`
- Import candidates: `5`
- Inbox items: `5`
- Interrupted sessions: `0`
- Pending paid approvals: `0`

The existing production browser UI was not switched to the sandbox project because that would be a
service/env change. To inspect this sandbox visually without disturbing the current production UI,
use a temporary localhost-only Review UI with the sandbox env, or add a project selector to the
production Review UI.

## Model Route

The pilot did not use paid APIs.

The local embedding route attempted `ollama/nomic-embed-text` for chunk embeddings and recorded
six `UNAVAILABLE` local-model failures with estimated cost `0`. Therefore this pilot verified
lexical retrieval on real imported project data, but not vector retrieval in the production
sandbox environment.

## Post-Test Health

Post-test checks:

- `gutendocx`, `cloudflared`, `server-firewall`, `tailscaled`, and `ssh` were active.
- GutenDocx remained bound to `127.0.0.1:8000`.
- `http://127.0.0.1:8000/health` returned ok.
- `https://gutendocx.unicloud.ca/` returned Cloudflare Access `302`.
- `http://127.0.0.1:3005/health` returned Recallant ok.

## Delete Readiness

Current sandbox DB rows selected by project id:

- `projects`: 1
- `sessions`: 2
- `events`: 7
- `raw_artifacts`: 5
- `chunks`: 17
- `embeddings`: 0
- `checkpoints`: 1
- `agent_memories`: 5
- `agent_memory_source_refs`: 5
- `recall_traces`: 4
- `ingest_dedup_keys`: 7
- `model_calls`: 6
- `project_settings`: 1
- `settings_audit_events`: 1

Recommended confirmed cleanup, only after owner approval and a fresh backup/verify:

1. Verify the project id still maps to
   `/ai/recallant-pilots/gutendocx-20260528T161238Z`.
2. Delete explicit project-linked audit/cost tables that have `ON DELETE SET NULL` or no FK:
   `model_calls`, `recall_traces`, `paid_api_approval_requests`, `erasure_requests`,
   `settings_audit_events`.
3. Delete the `projects` row for `29bc4ee3-cac8-4c3f-9634-ef47d0401ae9`; normal cascades remove
   sessions, events, chunks, raw artifacts, checkpoints, project settings, client adapter settings,
   agent memories, source refs, review actions, and ingest dedup keys.
4. Remove the sandbox directory.

## Fixes Before A Real Project

- Add a first-class project switcher or temporary sandbox UI runbook so the owner can inspect a
  copied project without changing the production Review UI project env.
- Either make `nomic-embed-text` reliably available in the production environment or document that
  the first real pilot is lexical-only until embeddings are healthy.
- Consider a built-in `recallant project-delete --dry-run/--confirm` command so sandbox deletion is
  a governed operation instead of manual SQL.
