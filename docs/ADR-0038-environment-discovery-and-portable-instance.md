# ADR-0038: Environment discovery and portable Recallant instance

## Status

Accepted

## Context

The current first deployment target is the owner's Linux server where projects live under `/ai`, server operations are documented in `/ai/SECURITY`, and shared secrets are currently referenced from `/opt/secure-configs/.env`.

The owner clarified that this layout is only a particular current environment. Recallant must be a universal memory platform that can run on other servers, discover where it is, understand what is available, discuss the user's goals and operating model, remember those decisions, and then rely on them in future sessions.

Recallant also must remain portable. If a user works with Recallant for years and accumulates a large memory corpus, moving to another server must be practical and must not lose memory, provenance, settings, raw artifacts, review state, or project bindings.

## Decision

Recallant will treat environment discovery and instance portability as first-class architecture requirements.

### Environment discovery

On first server setup, and later on explicit rescan, Recallant should run a bounded discovery process that can inspect non-secret server facts such as:

- host identity and OS/runtime capabilities,
- available GPU/CPU/storage characteristics where relevant,
- project roots and candidate repositories,
- existing agent config/handoff files,
- service/process/port inventory where allowed,
- available local tools and model runtimes,
- existing configured local model services such as Ollama, including endpoint/status/model availability, without starting duplicate stacks by default,
- server port inventories or equivalent deployment registries where available,
- server security baselines such as `/ai/SECURITY` in the owner's first deployment profile,
- known secret stores by path/label/status, without reading or storing raw secret values,
- existing connector/account capabilities when configured,
- backup targets and local spool locations.

Discovery is not silent policy creation. Recallant should turn findings into an onboarding conversation with the user:

- what was found,
- what appears to be project/server/global scope,
- which secret references or connector accounts are available,
- which candidates should be accepted, ignored, or reviewed,
- what the user's goals and operating preferences are.

Accepted discovery results become structured environment facts, project registry records, capability bindings, secret references, settings, checkpoints, or governed memory candidates according to scope and review policy.

### Portability

A Recallant instance must be movable between servers through an explicit export/backup/restore path that covers:

- Postgres domain database(s),
- raw artifact storage and manifests,
- embeddings/chunks or enough source text and metadata to rebuild them,
- governed memories and review state,
- project registry, environment facts, capability bindings, and non-secret settings,
- repo adapter metadata such as `.recallant/config` pointers,
- audit/recall traces according to retention policy,
- backup manifests with schema and migration version.

Secrets themselves should not be embedded in ordinary memory exports. Portable exports may include secret reference labels, expected variable names, provider/account bindings, and "configured/missing" status, but the target server must rebind or import secret values through an explicit secure path.

The restore flow must support environment remapping:

- old project root to new project root,
- old server paths to new paths,
- old secret store references to new secret store references,
- old connector/account bindings to newly authorized accounts,
- old local model/runtime availability to the new server's capabilities.
- old port assignments to new available ports.
- old security baseline references to the new server's operational documentation.

## Consequences

- `/ai` and `/opt/secure-configs/.env` must be modeled as environment facts for the owner's first deployment, not as hard-coded defaults in Recallant core.
- `/ai/SECURITY` and `/ai/PORTS.yaml` must be modeled as owner-server operational facts. They guide the first deployment but are not universal product constants.
- Existing Ollama is a capability binding. Recallant should reuse it when available and degrade/reconfigure when unavailable.
- `recallant init` and server setup need a discovery/onboarding layer, not only a repo file generator.
- Backup/restore from ADR-0028 remains required, but portability adds remapping, rebinding, and instance migration semantics.
- Context Pack Builder must use accepted environment facts and capability bindings, not filesystem assumptions.
- Review UI/Settings should eventually expose environment facts, project registry, secret reference status, connector/account bindings, and migration/restore health.

## Non-goals

- Discovery must not scan arbitrary sensitive file contents by default.
- Discovery must not store raw secret values in Postgres, logs, memory exports, or ordinary backup manifests.
- Discovery must not automatically promote every found file or historical artifact into active instruction memory.
- Portability does not require every external connector account to remain valid after a move; rebinding may be required.

## Follow-up decisions

- Exact `recallant setup` / `recallant discover` CLI shape.
- Which discovery checks are automatic by default and which require explicit approval.
- Portable export package format and encryption mechanism.
- Restore/remap UX in CLI and Review UI.
- Exact environment-fact SQL/API mapping after ADR-0039 and ADR-0040.
