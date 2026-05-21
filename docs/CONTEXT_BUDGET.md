# Context budget and lazy loading

Recallant must improve agent behavior without filling the model context window with duplicated instructions and historical logs.

## 1. Principle

Project files are **routing and bootstrap surfaces**, not the long-term knowledge base.

- `AGENTS.md` tells the agent how to use Recallant and what local conventions must always be obeyed.
- `PROJECT_LOG.md` gives the human-readable current resume point.
- Recallant stores raw history, raw workflow evidence/artifact refs, derived memories, decisions, failures, lessons, artifacts, and searchable context.

Plain-language model:

- Repo files are the **front door**: they tell the agent where it is and how to use memory.
- Governed memories are the **working shelf**: compact rules, decisions, constraints, and current lessons.
- Raw chunks/docs/artifacts are the **archive**: fetch only when evidence is needed.

The agent should not carry the archive in its active context window. Full raw artifacts are not startup context; only bounded excerpts/source refs may appear in a Context Pack.

## 2. Startup budget

At session start, the agent should load context through the server-side Context Pack Builder.

Normal startup flow:

1. the thin repo contract (`AGENTS.md` and local adapter files),
2. `memory_start_session`,
3. `memory_get_context_pack`,
4. additional targeted `memory_search` only if the context pack explicitly says more evidence is needed or the task changes.

The agent should not read large historical docs at startup unless a resolver hint or current task requires it.

Startup is not "understand the whole project". Startup is "recover enough state to choose the next correct action".

Recommended startup target:

```text
always-loaded repo files       <= small bootstrap only
checkpoint                     <= compact current state
governed memories              <= top relevant rules/decisions
raw evidence search            <= zero or one targeted call
full docs/files                <= none unless task requires it
```

If the task is trivial, the context pack may contain only checkpoint and active rules. If the task is complex, the server includes relevant governed memories and narrow evidence excerpts while preserving budget.

## 3. Thin file rules

Repo-native agent files are controlled by a **configurable context policy**, not fixed universal KB limits. See [ADR-0014-configurable-context-budget-policy.md](ADR-0014-configurable-context-budget-policy.md).

- Root `AGENTS.md`: compact stable rules and Recallant usage only.
- Adapter files such as `CLAUDE.md`, `.windsurfrules`, `.cursor/rules/*.md`: thin pointers to the canonical contract.
- `PROJECT_LOG.md`: current state only; archive or move detailed history into Recallant when it grows.
- Long design docs may stay in the repo if they are true project artifacts, but agents should retrieve them by need, not at every session start.

The policy may define different profiles such as:

- `compact`: minimal startup files, aggressive warnings.
- `standard`: normal single-repo workflow.
- `expanded`: large repo / operational project / monorepo.
- `custom`: explicit project-specific policy.

These profiles may include concrete token/size thresholds in implementation, but those numbers are configurable lint thresholds, not architecture invariants.

Hard failures are content-shape problems, not simple size problems:

- duplicated long history in startup files,
- adapter files copying canonical rules instead of linking to them,
- secrets in bootstrap files,
- active `PROJECT_LOG.md` used as an archive,
- startup flow reading broad docs/logs by default.

Large files are warnings unless they violate one of those hard rules or exceed project policy without an explicit override.

## 3.1 Policy mechanism

Context policy should be resolved in this order:

1. explicit task/client override,
2. project-level Recallant setting,
3. optional small committed policy file if added later,
4. Recallant default profile.

The policy should consider:

- effective model/client context window when known,
- project size and shape,
- task type,
- whether the project is a monorepo or ops-heavy repo,
- how much working room must remain for code, diffs, tool output, and reasoning.

Example policy shape:

```yaml
context_policy:
  profile: expanded
  reason: "Large ops-heavy repo; extra bootstrap routing is justified."
  startup:
    repo_files_budget: project_configured
    context_pack_budget: project_configured
    min_working_room_ratio: project_configured
  lint:
    size_excess: warn
    duplicated_history: error
    secrets: error
```

The exact field names can change during implementation. The required property is explicit, inspectable configuration rather than hidden hard-coded numbers.

## 4. Lazy loading

Recallant should support context routing through:

- task-specific governed memories,
- retrieval filters by `memory_type`, `scope`, `project_id`, and optional subproject,
- ADR-0040 scope/audience filters such as environment, connector_account, capability, and client_adapter,
- resolver hints inspired by Journey kit manifests,
- source refs that let agents fetch exact evidence only when needed.

Journey's resolver-hint idea is especially useful here: task patterns should point agents at the smallest relevant docs/skills/memories instead of making all rules always-on.

## 4.1 Context ladder

Agents should climb this ladder only as needed:

1. **Checkpoint:** current focus, next step, blockers, open questions.
2. **Binding rules:** active `instruction_grade` memories relevant to the task.
3. **Working memories:** recent/relevant decisions, constraints, lessons, failures, procedures.
4. **Operational bindings:** relevant environment facts, secret references, capability bindings, connector/account bindings, and client-adapter rules.
5. **Evidence excerpts:** bounded `memory_search` hits with source refs.
6. **Full evidence:** `memory_fetch_chunk`, specific docs, commits, logs, imported source material, or explicit raw artifact inspection.
7. **Explicit import:** only when needed material is outside Recallant.

Do not jump from step 1 to "read every doc in the repo".

## 4.2 Context Pack Builder

Recallant exposes a server-side **Context Pack Builder**. This is the canonical startup context mechanism, not a manual UI button. See [ADR-0024-automatic-startup-context-pack-builder.md](ADR-0024-automatic-startup-context-pack-builder.md).

Illustrative logical input:

```json
{
  "task": "fix multilingual summary caching",
  "project_id": "current",
  "session_id": "current",
  "max_chars_total": 12000,
  "include_raw_evidence": "auto"
}
```

Illustrative logical output:

```text
Context Pack
1. Checkpoint: compact current state
2. Binding rules: policy-bounded relevant instruction-grade memories
3. Working memories: policy-bounded decisions/constraints/lessons
4. Operational bindings: relevant environment/capability/connector/client-adapter facts
5. Evidence excerpts: optional policy-bounded chunks/artifact excerpts if needed
6. Suggested next fetches: exact docs/chunks/files only if evidence is missing
```

The important property is server-side budgeting: the tool or workflow enforces size and relevance before the agent sees the text.

Accepted interface: implement this as MCP tool `memory_get_context_pack`. The tool may internally compose checkpoint, governed memory recall, retrieval, recovery warnings, and resolver hints. CLI/UI context preview must call the same server logic.

Manual surfaces:

- `recallant context` / `recallant context --project ...` can preview what an agent would receive.
- Future Review/Management UI can expose "Preview agent context".

These are diagnostics, not the normal workflow. In normal work the agent calls `memory_get_context_pack` automatically after `memory_start_session`.

## 5. Context quality

The goal is not merely fewer tokens. The goal is the **right context at the right time**:

- stable rules should be easy to recall,
- project-specific facts should not leak into other projects,
- stale/superseded guidance should be penalized or excluded,
- unresolved high-risk conflicts should be surfaced rather than hidden,
- raw evidence should be fetchable when a derived memory is questionable.

Bad context budget:

- loads all project docs at startup,
- repeats the same rule in `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, and `PROJECT_LOG.md`,
- reads old archive logs before checking checkpoint,
- asks broad memory queries like "tell me everything about this project",
- returns many hits but no source refs or next action.

Good context budget:

- small bootstrap files,
- one compact checkpoint,
- a few relevant governed memories,
- exact evidence only when needed,
- clear source refs and next fetches.

## 6. Test expectations

Implementation should include a context-lint command or test that checks:

- generated `AGENTS.md` contains the Recallant section,
- generated adapters are thin,
- no bootstrap file embeds large historical logs,
- startup flow can restore a project from checkpoint + governed memories without reading all docs.
- broad startup queries are rejected or warned about by lint/tests,
- MCP recall/search responses respect `max_chars_total`,
- `recallant lint-context` applies the configured context policy,
- size excess without an override is a warning or error depending on policy,
- duplicated history, secrets, and adapter rule duplication are hard errors regardless of size.
