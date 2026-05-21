# Import policy

Explicit imports extend v1 memory beyond live agent sessions without turning AMP into "ingest everything automatically."

Decision status: v1 import workflow accepted. See [ADR-0013-closeout-intent-and-explicit-imports.md](ADR-0013-closeout-intent-and-explicit-imports.md), [ADR-0039-v1-import-workflow.md](ADR-0039-v1-import-workflow.md), and historical context in [ADR-0037-import-workflow-and-memory-scope-archive.md](ADR-0037-import-workflow-and-memory-scope-archive.md).

Core rule:

- `amp discover` scans the environment for setup/import candidates, but does not import historical material as active memory.
- `amp init` registers/configures a project and may suggest imports.
- `amp init` does not import historical material automatically.
- `amp closeout` / natural-language closeout preserves current session state.
- `amp import ...` is the explicit path for historical/external material.
- `amp import ...` must support preview/dry-run before writing durable import results.
- Scope/audience assignment follows [ADR-0040](ADR-0040-memory-scope-and-audience-model.md).

## 1. v1 import categories

### Existing project handoff and agent files

Examples:

- `AGENTS.md`
- `PROJECT_LOG.md`
- `.cursor/SESSION_HANDOFF.md`
- `CLAUDE.md` / adapter files as client-specific context, not universal truth
- `Docs/Codex_Context_Index.md`
- selected docs chosen explicitly by the owner/agent

Use when bootstrapping an existing project.

### Environment and server facts

Examples:

- project roots,
- server inventory such as `/ai/PORTS.yaml` or equivalent,
- shared secret store references,
- local model/runtime availability,
- service/process/port candidates.

The current `/ai` server layout and `/opt/secure-configs/.env` are first-deployment facts, not hard-coded AMP assumptions.

### Secret and capability metadata

Examples:

- `.env.example` variable names and meanings,
- secret-store inventory as names/status/references only,
- provider/token capability bindings,
- connector/account bindings such as personal vs corporate Google Drive.

Never import raw secret values into ordinary memory.

### Explicit exports and selected external material

Examples:

- existing AMP/session JSONL exports,
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

## 3. Import commands

Candidate commands:

```bash
amp discover
amp import project-log PROJECT_LOG.md
amp import docs docs/architecture/*.md
amp import git --since 2026-01-01 --paths backend/
amp import jsonl export.jsonl
```

`amp init` should not automatically import large historical material unless the user asks. It may detect candidates and suggest commands.

Example `amp init` output:

```text
Detected import candidates:
- PROJECT_LOG.md
- docs/architecture/*.md
- recent git history

No imports were run.
Suggested commands:
  amp import project-log PROJECT_LOG.md
  amp import docs docs/architecture/*.md
  amp import git --since 2026-01-01
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
