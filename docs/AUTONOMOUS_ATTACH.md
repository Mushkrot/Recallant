# Autonomous Project Attach

This document describes the target product workflow for connecting a project to Recallant.

## Purpose

The owner should be able to open a folder, run one command or ask Recallant in natural language, and
have the project become part of Recallant memory without hand-building agent docs, copying handoff
files, or manually choosing every safe import.

Autonomous attach is the target everyday path, but Recallant must keep cautious modes available.

## Modes

| Mode | Best for | Behavior |
|------|----------|----------|
| `manual` | production-sensitive projects, debugging, early audits | Run only explicit commands. Discovery and dry-run write nothing. Imports require selected commands. |
| `guided` | first real projects, migrations, owner review | Build a full attach plan and wait for confirmation before durable writes. |
| `autopilot` | normal daily use after trust is established | Analyze, attach, import safe evidence, create bootstrap files, verify, and report. |

The same project can be re-run in a different mode. Modes are workflow policies, not different data
models.

## Target commands

```bash
recallant attach <project-dir> --target codex --mode autopilot
recallant attach <project-dir> --target codex --mode guided
recallant attach <project-dir> --target codex --mode manual
```

`recallant init`, `discover`, `import`, `lint-context`, `context`, and `doctor` remain lower-level
commands. `attach` coordinates them.

## Autopilot pipeline

1. Identify the project root and existing `.recallant/config`.
2. Register or update the project row.
3. Select a capture/context profile, normally `standard` for ordinary projects.
4. Create or update pointer-only `.recallant/config`.
5. Create or update thin agent instructions for the selected target.
6. Create `PROJECT_LOG.md` if missing.
7. Run safe discovery for project docs, handoffs, `.env.example`, repo contracts, and selected
   runbooks.
8. Classify findings into evidence, chunks, candidate memories, checkpoint seeds, environment facts,
   secret references, capability bindings, connector-account bindings, and repo contracts.
9. Import low-risk source-linked evidence according to policy.
10. Keep risky/broad records as `needs_review` or candidates.
11. Run context lint and a context-pack preview.
12. Run diagnostics such as Postgres/Ollama/model route checks.
13. Produce an owner-readable report.

## Safety gates

Autopilot may create useful memory automatically, but it must preserve governance:

- no raw secret values;
- no silent paid API enablement;
- no public exposure changes;
- no destructive cleanup/erasure;
- no broad developer/global rule without explicit confirmation or review;
- no instruction-grade promotion for stale/imported/inferred material unless a strong policy path
  exists;
- no whole-repo, whole-git-history, bulk Drive/Gmail/Calendar/GitHub import by default.

## Report shape

The attach report should answer these questions in human language:

- Is the project attached?
- What changed in the project folder?
- What was imported?
- What is available only as evidence?
- What needs review?
- What will agents do automatically at startup?
- How can the owner inspect, rollback, or detach this project?

Technical JSON may exist, but the default report must be readable by the owner.

## Detach and cleanup

Autonomous attach requires a matching governed cleanup path:

- dry-run detach report;
- remove or archive project records from active UI/search according to policy;
- optionally remove local `.recallant` pointer files from sandbox copies;
- never affect the original project when testing a copied sandbox;
- preserve audit/provenance unless explicit erasure is confirmed.

Full project delete/detach is a required follow-up before broad live-project attach.
