# Operating principles

This document records cross-cutting product and engineering principles that should guide Recallant implementation. It is intentionally plain and practical: future agents should use it to avoid rebuilding these decisions from chat history.

## 1. Product mission in plain language

Recallant exists so AI agents remember where they are working, what is already known, which rules apply, where important settings live, and how to continue without forcing the owner to repeat the same context every session.

The platform is a shared memory and work navigator for agents, projects, servers, and future clients. It should make agents long-running participants in the owner's work, not one-off executors.

## 2. Core product functions

Recallant must:

- remember project context, decisions, rules, files, environment facts, and session handoffs;
- share that context across Codex, Claude Code, Cursor, Windsurf, and future MCP-compatible agents;
- preserve important owner explanations as governed memory;
- retrieve only the relevant context for the current task instead of reading all memory or all docs;
- model secret locations, connector/account bindings, GitHub/GDrive choices, and other capability facts without storing raw secrets;
- start a new agent session with a bounded context pack that explains where the project stands;
- distinguish facts, decisions, hypotheses, stale information, rejected information, and binding instructions;
- expose a private management UI and natural-language management chat for review, correction, cleanup, and diagnosis;
- support backup/export/restore/remapping so an accumulated memory corpus can move to another server;
- remain universal: the owner's `/ai` server layout is the first real deployment profile, not a hard-coded product assumption.

## 3. Managed memory

Memory must be actively manageable.

The owner must be able to inspect, correct, demote, supersede, archive, reject, merge, and permanently erase memory through intuitive UI/CLI/chat workflows.

Two modes are different:

- **Archive / reject / supersede:** normal governance actions that keep provenance and history while excluding old records from active use.
- **Forget forever:** explicit owner-confirmed erasure that removes the target content and derived material from active memory, search, embeddings, summaries, context packs, and UI. If an audit record is retained, it must be redacted and contain no original sensitive content.

The default posture remains conservative retention. Automatic cleanup should prefer archive/rebuild/supersede over hard deletion. Permanent erasure is a deliberate owner action or an explicit high-confidence retention policy, never a silent background behavior.

## 4. Self-cleaning

Recallant must not become a pile of stale notes.

The system should periodically identify and propose cleanup for:

- duplicates and near-duplicates;
- stale decisions and superseded guidance;
- abandoned experiments;
- low-value temporary records;
- unreferenced derived chunks, embeddings, or summaries;
- old local spool records after confirmed sync;
- conflicting rules or connector/account bindings;
- records without adequate provenance.

AI can help cluster and explain cleanup candidates, but risky cleanup actions should route through Review UI/chat confirmation unless policy explicitly allows the action.

## 5. Natural-language control

The main management interface should be conversational. The owner should be able to say things such as:

- "Delete everything connected to the wrong Google account for this project."
- "Show what the next agent needs to know before it starts."
- "Make this rule global."
- "Find stale GitHub access information."
- "Forget this permanently."

Recallant should understand the user's language and answer in that language by default. Code, API contracts, comments, and documentation remain English.

The chat interface must understand context, not only keywords. It may use LLM reasoning heavily, but all write/delete/security/cost-affecting operations still go through server-side policy, provenance, and confirmation gates.

## 6. AI-native, policy-governed

Recallant should use AI capabilities wherever they materially improve the product:

- memory extraction;
- cleanup clustering;
- conflict explanation;
- context-pack planning;
- intent detection;
- source summarization;
- review suggestions;
- connector/account binding explanations.

Deterministic code remains necessary for storage, auth, migrations, routing, caps, validation, audit, deletion, and safety. The product should feel intelligent, but its trust boundaries must be enforced by clear contracts.

## 7. Upstream reuse

Recallant should not reimplement solved ideas blindly.

Before implementation, selected upstream repositories should be cloned or otherwise inspected locally when practical. Agents should study their architecture, data model, memory retrieval, context packing, governance, deletion/cleanup behavior, and UI workflows.

Borrow patterns when they fit Recallant's contracts. Do not copy code or architecture just because it exists. Recallant owns its public contracts, schema, safety model, and product direction.

## 8. Modular engineering

Implementation should be professional, modular, and easy to debug:

- small cohesive modules;
- clear package boundaries;
- low coupling between storage, routing, UI, CLI, MCP, adapters, and workers;
- refactor when files grow beyond a clear responsibility;
- tests near the behavior they verify;
- no broad rewrites unrelated to the task;
- no hidden global state where explicit settings/capabilities should be used.

Use short comments only where they clarify non-obvious logic.

## 9. Language and public quality

All code, identifiers, comments, docs, commit messages, API text, and public-facing project material must be in English.

The owner may continue speaking Russian. Agents should answer the owner in Russian when the owner writes in Russian, while writing repository artifacts in English.

The project should look like work produced by a senior engineering team and should be suitable for public release and professional review.

## 10. Commit discipline

Development should use meaningful commits at natural checkpoints. Commits should be scoped, easy to read, and useful for rollback.

Agents should commit autonomously when a coherent checkpoint is complete and verified, especially at phase gates, after substantial documentation decisions, and before starting work that would be harder to roll back. Do not wait for a separate owner prompt just to commit a well-scoped verified checkpoint.

Do not bundle unrelated runtime state or accidental local files into commits. Documentation and tests should be updated with the code when behavior or contracts change.

## 10.1 Recallant implementation autonomy

Recallant is the project that changes how future projects are worked on, so implementation agents have a broader autonomy mandate here than in ordinary application repositories.

Agents working on Recallant should:

- read the documentation and phase plan first, then follow it without asking the owner to restate settled decisions;
- continue autonomously through the next reasonable implementation step when the task graph and specs are clear;
- make conservative technical decisions from the docs and upstream review when no owner-only decision is required;
- stop only for genuinely owner-dependent choices, security/public-exposure changes, destructive operations, paid API use, secrets, server/firewall/service changes, or contradictions in the specification;
- write concise progress reports at meaningful checkpoints rather than stopping just to announce routine progress.

This autonomy does not weaken safety gates. It removes unnecessary confirmation prompts for ordinary implementation, verification, documentation updates, and scoped commits.

## 11. Existing local services and portability

If the server already provides a useful service, such as an existing Ollama installation, Recallant should use that configured instance instead of creating duplicate service stacks.

The same product must also run where Ollama is missing, disabled, remote, or installed differently. Local model providers are capability bindings and settings, not hard-coded paths.

`recallant doctor` must clearly report whether Ollama/local models are reachable, which endpoint is being used, and which fallback route applies.

## 12. Server safety and shared inventories

On the owner's server, Recallant must respect existing infrastructure documentation:

- `/ai/SECURITY` owns server security principles and should be consulted before exposure, auth, firewall, Cloudflare, service, or secret-handling changes.
- `/ai/PORTS.yaml` owns port inventory for `/ai` projects. Any Recallant service port must be checked for conflicts and registered before the service is started.
- `/opt/secure-configs/.env` is a known shared secret location in the first deployment profile, but Recallant should store only a secret reference/capability binding, not raw secrets.

If Recallant changes server behavior that other projects or operators need to know, update the relevant `/ai/SECURITY` documentation with concise, necessary information only.
