# ADR-0039: v1 import workflow

## Status

Accepted

## Context

Question 9 covered how existing project/server/history material should enter Recallant without turning old files into accidental active instructions.

The owner confirmed several real examples from the first deployment environment:

- existing manually maintained agent docs and handoff files under `/ai/*`,
- server-level facts such as `/ai/SECURITY`,
- shared secret references such as `/opt/secure-configs/.env`,
- connector/account ambiguity such as personal vs corporate Google Drive access,
- the need for automatic environment discovery without automatic trust promotion.

ADR-0038 accepted environment discovery and portability. This ADR accepts the v1 import workflow. Memory scope/audience is accepted separately in ADR-0040.

## Decision

Recallant v1 will use a **discovery-first, import-by-confirmation** workflow as the safe foundation.
ADR-0043 adds product-level attach modes on top of this foundation: `manual` keeps this exact
workflow, `guided` previews a complete plan before confirmation, and `autopilot` may execute
low-risk attach/import steps while preserving the promotion and safety rules below.

### Commands and responsibilities

`recallant discover`

- Scans the environment for import/setup candidates.
- May record scan metadata and discovered candidates.
- Must not import historical material as active memory.
- Must not silently promote discovered facts into binding rules.

`recallant init`

- Registers/configures a project with Recallant.
- Creates or updates repo-native adapter surfaces such as `.recallant/config` and thin agent instructions.
- May suggest import candidates.
- Must not perform broad historical import automatically.

`recallant attach`

- Product-level workflow that may coordinate `init`, `discover`, `import`, `lint-context`,
  `context`, `doctor`, and report generation according to `manual`, `guided`, or `autopilot` mode.
- Must not bypass the import result classes or promotion policy in this ADR.

`recallant import`

- Is the explicit path for historical/external/project material.
- Must support preview/dry-run before writing durable import results.
- Must preserve provenance, content hashes, source refs, and selected scope metadata.
- Writes imported material as raw evidence, chunks, candidates, facts, references, bindings, or checkpoint seeds according to import type and review policy.

## v1 import sources

Accepted v1 sources:

- `AGENTS.md`,
- `PROJECT_LOG.md`,
- `.cursor/SESSION_HANDOFF.md`,
- `CLAUDE.md` and other client-specific docs as adapter/client context, not universal truth,
- `Docs/Codex_Context_Index.md`,
- explicitly selected project docs,
- `.env.example` as variable names and meanings only,
- secret-store inventory as names/status/references only, never values,
- server inventory such as `/ai/PORTS.yaml` or equivalent when confirmed as server/environment scope,
- existing Recallant/session JSONL exports when available.

Not automatic in v1:

- whole git history,
- entire `Docs/` trees,
- bulk Gmail/Drive/Calendar connector sync,
- arbitrary large folders,
- shell history,
- `.env.local` values,
- binary documents without explicit selection.

These can be future targeted imports or connector features after separate consent/review policy.

## Import result classes

An import result is not just "a memory." Import should classify findings into structured records:

- `raw_evidence`: original source file/fragment/artifact pointer with hash/provenance,
- `chunk`: bounded searchable text,
- `candidate_memory`: possible decision/rule/lesson/failure/open question/work log,
- `environment_fact`: host, project root, service, runtime, server fact,
- `secret_reference`: secret label/path/variable/status without raw value,
- `capability_binding`: which provider/token/account supports which operation,
- `connector_account_binding`: which connector/account is correct for a project/task,
- `checkpoint_seed`: current state/next step from trusted handoff source,
- `repo_contract`: startup/adapter instructions and fallback contract.

## Promotion policy

- Routine source-linked facts may become searchable immediately.
- Checkpoint seeds may be accepted when the preview confirms the source is current and intended.
- Candidate rules go to Review Inbox unless explicitly confirmed during import.
- Developer/global rules require explicit confirmation or review promotion.
- High-risk records require review: secrets, deployment, security, destructive commands, paid API, server access, and account/capability bindings.
- Client-specific files such as `CLAUDE.md` must not automatically become universal instructions.
- Imported material starts source-linked and reviewable; it does not silently become `instruction_grade`.

## Consequences

- Import is powerful enough to onboard existing projects but controlled enough to avoid stale-doc rule pollution.
- Discovery and import are separate operations.
- `recallant init` remains safe for new and existing projects.
- The Review UI must understand import candidates and source refs.
- Scope/audience assignment follows ADR-0040.
- Conflict handling during import preview follows ADR-0041.

## Open follow-ups

These follow-ups were tracked by [Pre-Pilot Readiness](PRE_PILOT_READINESS.md) and are refined by
Phase 10 autonomous attach:

- Exact CLI flags and preview output format.
- Exact dedup strategy for repeated imports.
- Default scope/audience inference details for import preview, within ADR-0040's accepted model.
- Which import jobs need background workers.
