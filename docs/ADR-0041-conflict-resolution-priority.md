# ADR-0041: Conflict resolution priority

## Status

Accepted

## Context

Question 13 covered how AMP should resolve conflicts between memories, imports, user instructions, environment facts, connector/account bindings, client-adapter guidance, and raw evidence.

ADR-0040 introduced a multi-axis scope/audience model, so conflict resolution cannot be a simple "newer wins" rule. A conflict is only meaningful when records overlap in domain, scope, audience, authority, and task relevance.

## Decision

AMP resolves conflicts by:

1. applicability,
2. authority,
3. scope specificity,
4. recency,
5. review/owner confirmation when still risky or ambiguous.

### 1. Applicability first

Before comparing priority, AMP must decide whether two records apply to the same situation.

Records do not conflict when:

- their audiences do not overlap, such as Claude-only guidance vs Codex-only guidance,
- one is an environment fact for a different AMP instance,
- one is a broader rule and the other is a compatible narrower elaboration,
- they relate to different connector accounts, capabilities, repos, or projects.

### 2. Authority ladder

When records do overlap, use this priority order:

1. Current explicit user instruction in the current session, unless safety/security/confirmation gates apply.
2. Safety/system/developer hard constraints, including secrets, destructive operations, public exposure, and paid API confirmation policy.
3. Accepted `instruction_grade` memory in the narrowest applicable scope.
4. Accepted environment, capability, and connector/account bindings.
5. Accepted `recall_allowed` decisions, lessons, and facts.
6. Current checkpoint for current state and next-step continuity.
7. Imported source-linked candidates or `needs_review` records.
8. Raw evidence/chunks as factual support, not direct instruction.
9. Agent inference or summary.

### 3. Scope specificity

Within the same authority tier:

- narrower applicable scope beats broader scope,
- project/repo/subproject scope beats developer scope for that project,
- connector_account scope beats generic connector guidance for access tasks,
- capability scope beats generic provider guidance for operation/token questions,
- client_adapter scope applies only to that client,
- environment scope applies to the current instance and must be remapped during migration,
- session scope may guide current task facts but does not create durable policy by itself.

### 4. Recency

Within the same authority and scope:

- later explicit accepted decisions supersede older accepted decisions,
- stale/superseded records lose by default,
- newer imported docs do not automatically beat older accepted governed memory unless imported as trusted/confirmed,
- source-linked raw evidence may justify a review action but does not silently rewrite binding memory.

### 5. Review instead of silent choice

AMP must surface the conflict for Review UI / owner confirmation when:

- both sides are active accepted `instruction_grade`,
- the conflict affects secrets, deployment, public exposure, destructive commands, paid API, server access, account bindings, or connector/capability use,
- the conflict would change developer/global behavior,
- the conflict crosses personal/corporate or similarly distinct accounts,
- restore/remapping creates ambiguity,
- applicability or authority is unclear.

Low-risk conflicts may be resolved by choosing the narrower/later accepted source and creating a conflict/supersedes edge for audit.

## Consequences

- Conflict detection must understand ADR-0040 scope/audience, not just text similarity.
- Review UI must show why a record won or why owner confirmation is required.
- Retrieval/Context Pack Builder must exclude losing stale/superseded records by default and warn about unresolved high-risk conflicts.
- Import preview must highlight conflicts before write when it proposes broad, high-risk, or instruction-grade records.

## Follow-up decisions

- Exact conflict scoring and explanation format.
- Whether low-risk auto-supersede is allowed in v1 or only suggested.
- UI layout for conflict comparison and source evidence.
