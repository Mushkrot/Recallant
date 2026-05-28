# Import policy

Explicit imports extend v1 memory beyond live agent sessions without turning Recallant into "ingest everything automatically."

Autonomous attach refines this rule. In `autopilot` mode, Recallant may import low-risk
source-linked evidence and create ordinary recallable memories according to policy, but it still must
not silently trust stale documents as binding instructions. Manual and guided modes remain available
for cautious operation.

Decision status: v1 import workflow accepted. See [ADR-0013-closeout-intent-and-explicit-imports.md](ADR-0013-closeout-intent-and-explicit-imports.md), [ADR-0039-v1-import-workflow.md](ADR-0039-v1-import-workflow.md), and historical context in [ADR-0037-import-workflow-and-memory-scope-archive.md](ADR-0037-import-workflow-and-memory-scope-archive.md).

Attach modes are accepted in [ADR-0043-autonomous-project-attach-modes.md](ADR-0043-autonomous-project-attach-modes.md).

Current implementation note: Pre-Pilot Readiness and the first copied-project pilot are complete.
Phase 10 should implement attach modes before broad live-project onboarding.

Core rule:

- `recallant discover` scans the environment for setup/import candidates, but does not import historical material as active memory.
- `recallant init` registers/configures a project and may suggest imports.
- `recallant init` does not import historical material automatically.
- `recallant closeout` / natural-language closeout preserves current session state.
- `recallant import ...` is the explicit path for historical/external material.
- `recallant import ...` must support preview/dry-run before writing durable import results.
- Scope/audience assignment follows [ADR-0040](ADR-0040-memory-scope-and-audience-model.md).
- `recallant attach --mode manual|guided|autopilot` composes init/discover/import/lint/context/doctor/report according to the selected workflow mode. It does not bypass the promotion policy below.

## 1. v1 import categories

### Existing project handoff and agent files

Examples:

- `AGENTS.md`
- `PROJECT_LOG.md`
- `PROJECT_LOG_*.md` archives as historical evidence-only
- `.cursor/SESSION_HANDOFF.md`
- `CLAUDE.md` / adapter files as client-specific context, not universal truth
- `Docs/Codex_Context_Index.md`
- selected docs chosen explicitly by the owner/agent

Use when bootstrapping an existing project.

Autopilot may extract high-confidence ordinary project-local memories and decisions from these
sources when source refs exist. Risky, broad, stale, low-confidence, security/deploy/destructive,
paid-API, connector/account, and capability-binding findings remain evidence-only or go to Review.

### Environment and server facts

Examples:

- project roots,
- server inventory such as `/ai/PORTS.yaml` or equivalent,
- shared secret store references,
- local model/runtime availability,
- service/process/port candidates.

The current `/ai` server layout and `/opt/secure-configs/.env` are first-deployment facts, not hard-coded Recallant assumptions.

### Secret and capability metadata

Examples:

- `.env.example` variable names and meanings,
- secret-store inventory as names/status/references only,
- provider/token capability bindings,
- connector/account bindings such as personal vs corporate Google Drive.

Never import raw secret values into ordinary memory.

If `.env.example` or similar safe example files are imported, store only variable names, purpose, and
service/capability hints. If a likely raw secret is present, do not import it; route warning/review
according to attach mode and production sensitivity.

### Explicit exports and selected external material

Examples:

- existing Recallant/session JSONL exports,
- selected Markdown/JSON exports,
- source-linked external notes.

Store source URL/path and import timestamp.

## 2. Not automatic in v1

Do not automatically import:

- whole git history,
- entire `Docs/` trees,
- bulk Gmail/Drive/Calendar connector sync,
- arbitrary large folders,
- shell history,
- `.env.local` values,
- binary documents without explicit selection.

These may become future targeted imports or connector features after separate consent/review policy.

## 3. Import and attach commands

Candidate commands:

```bash
recallant attach <project-dir> --mode autopilot
recallant attach <project-dir> --mode guided
recallant attach <project-dir> --mode manual
recallant discover
recallant import project-log PROJECT_LOG.md
recallant import docs docs/architecture/*.md
recallant import git --since 2026-01-01 --paths backend/
recallant import jsonl export.jsonl
```

`recallant init` should not automatically import large historical material unless the user asks. It may detect candidates and suggest commands.

`recallant attach --mode autopilot` may import selected low-risk evidence automatically, but the same
high-risk and promotion rules apply. It is not permission for whole-repo import, whole-git-history
import, raw secret import, broad developer/global rule promotion, connector/account binding
activation, or paid API enablement.

Example `recallant init` output:

```text
Detected import candidates:
- PROJECT_LOG.md
- docs/architecture/*.md
- recent git history

No imports were run.
Suggested commands:
  recallant import project-log PROJECT_LOG.md
  recallant import docs docs/architecture/*.md
  recallant import git --since 2026-01-01
```

## 4. Import result classes

Import results should be classified rather than stored as one generic memory type:

- `raw_evidence`
- `chunk`
- `candidate_memory`
- `environment_fact`
- `secret_reference`
- `capability_binding`
- `connector_account_binding`
- `checkpoint_seed`
- `repo_contract`

## 5. Promotion policy

- Routine source-linked facts may become searchable immediately.
- Checkpoint seeds may be accepted when preview confirms the source is current and intended.
- Candidate rules go to Review Inbox unless explicitly confirmed during import.
- Developer/global rules require explicit confirmation or review promotion.
- High-risk records require review: secrets, deployment, security, destructive commands, paid API, server access, and account/capability bindings.
- Client-specific files such as `CLAUDE.md` must not automatically become universal instructions.
- Imported material starts source-linked and reviewable; it does not silently become `instruction_grade`.

## 6. Provenance requirements

Every imported item must record:

- source path/URL/type,
- project/developer scope,
- import timestamp,
- content hash,
- source refs for derived governed memories.

## 7. Future connector path

Future connectors may import:

- GitHub,
- Google Drive,
- Gmail,
- Calendar,
- browser history,
- notes apps,
- chat exports.

These belong after v1 core unless the owner explicitly promotes one connector into scope.

Connector import must be explicit and provenance-preserving. A future connector may offer sync modes, but each connector needs its own consent/review/noise policy before it can run automatically.
