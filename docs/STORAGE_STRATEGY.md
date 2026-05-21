# Storage strategy

The owner is concerned that "one database for everything" may become fragile or hard to evolve. Recallant should distinguish logical architecture from physical storage.

## 1. Accepted direction

Use one Postgres/pgvector **instance** as the v1 source-of-truth platform, with separate databases for major memory domains. See [ADR-0011-postgres-instance-domain-databases.md](ADR-0011-postgres-instance-domain-databases.md).

The key idea is:

- one storage platform for transactional integrity and operability,
- physical database boundaries for major domains,
- multiple logical boundaries inside each domain database,
- clear path to add specialized storage later only when real scale requires it.

## 2. Logical boundaries

Recommended logical boundaries:

- `agent_work` domain for coding-agent memory,
- future `personal_life` domain,
- future `research` domain,
- project and parent-project boundaries,
- developer-level promoted memory,
- raw L0 vs derived L1/L2/L3 layers,
- raw artifacts / attachments / blob-like payloads separated from relational metadata.

## 3. Physical options

### Option A — One Postgres database, multiple schemas/tables

Pros:

- simplest backup/restore,
- simplest transactions,
- easiest early implementation,
- good SQL debugging.

Cons:

- can feel like "everything in one place",
- later separation requires migration discipline.

### Option B — One Postgres instance, separate databases per domain

Decision status: **accepted target architecture**.

Meaning:

```text
Postgres instance on Recallant server
  ├── recallant_agent_work database
  │   ├── projects
  │   ├── sessions
  │   ├── raw_events
  │   ├── chunks
  │   ├── embeddings
  │   └── agent_memories
  │
  └── recallant_personal_life database
      ├── sources
      ├── events
      ├── chunks
      ├── embeddings
      └── governed_memories
```

Simple analogy: one building, different locked rooms. Same Postgres service, same backup/admin tooling, but each major life/work domain has its own database.

Example:

- coding session transcript goes to `recallant_agent_work`,
- future screenshot/calendar/email import goes to `recallant_personal_life`,
- developer-level memory like "Vadim prefers documentation-first architecture" may eventually be promoted into a shared/global domain or copied with provenance rather than silently mixed.

Pros:

- stronger operational separation between `agent_work` and future `personal_life`,
- easier domain-level backup/restore policies.
- easier to reason about retention: coding memory and personal-life capture can have different cleanup/archival policies,
- easier to prevent accidental cross-domain queries by default.

Cons:

- cross-domain search becomes harder,
- more connection/config complexity,
- fewer cross-domain transactions.
- schema migrations may need to run once per domain database,
- global recall needs a coordinator because one SQL query cannot easily join everything across databases.

When this option is attractive:

- when domains have different privacy/retention needs,
- when future personal-life data becomes large enough that it should not feel like another table inside coding memory,
- when the owner wants psychological and operational separation without running many different database products.

When this option is premature:

- if v1 only has `agent_work`,
- if cross-project/cross-domain retrieval is more important than hard boundaries,
- if one-person operations should stay as simple as possible until data volume proves otherwise.

### Option C — Separate storage systems by layer

Decision status: **rejected as v1 architecture**. It remains an evolution path only if real scale or query patterns require it later.

Example: Postgres for metadata, object storage for raw blobs, vector DB for embeddings, graph DB for relations.

Meaning:

```text
Recallant server
  ├── Postgres
  │   ├── projects, sessions, metadata, policies, provenance
  │   └── pointers to raw/vector/graph records
  │
  ├── Object storage
  │   └── full transcripts, screenshots, PDFs, long raw capture blobs
  │
  ├── Vector DB
  │   └── embeddings and nearest-neighbor search
  │
  └── Graph DB
      └── rich relation graph: topics, people, projects, causes, dependencies
```

Simple analogy: not one building with rooms, but a small campus. Each building is specialized: archive, search index, relation map, accounting ledger.

Example:

- Postgres row says: "session `s123`, project `ZenDesk-AI-Assistance`, raw transcript stored at `s3://recallant-raw/s123.jsonl`, vector ids `v900..v950`, graph node `n123`",
- object storage keeps the full raw transcript cheaply,
- vector DB answers "what memories are semantically close to this question?",
- graph DB answers "show all decisions related to this project, their causes, superseded versions, and affected files".

Pros:

- each subsystem can scale independently,
- specialized tools may perform better at high scale.
- object storage is usually better for huge immutable blobs,
- dedicated vector DB can outperform Postgres/pgvector for very large vector collections,
- graph DB can be stronger for deep relation traversal and visual exploration.

Cons:

- much more operational complexity,
- harder consistency/provenance,
- more moving parts before the core is proven.
- backups/restores become multi-system and must stay consistent,
- every write may need a two-phase or repairable workflow,
- failures become harder to debug because truth is distributed,
- local/offline sync becomes more complicated.

When this option is attractive:

- raw capture becomes very large: screenshots, audio, browser history, PDFs, full conversation archives,
- vector search scale or latency exceeds what pgvector can comfortably handle,
- graph exploration becomes a major product surface rather than a helper relation table,
- multiple clients/services need independent scaling.

When this option is premature:

- before v1 retrieval/writeback behavior is proven,
- before we know real data volume and query patterns,
- if it delays the core memory product.

## 4. Accepted direction

Start with **Option B**: one Postgres instance, separate domain databases.

v1 physical minimum:

```text
Postgres instance
  └── recallant_agent_work
```

Future physical expansion:

```text
Postgres instance
  ├── recallant_agent_work
  ├── recallant_personal_life
  └── recallant_research
```

Inside each domain database, keep strong logical boundaries:

- include `memory_domain`,
- include `project_kind` and `parent_project_id`,
- keep raw artifact and attachment storage abstractable,
- keep provider/model metadata,
- keep migrations disciplined,
- do not couple business logic to one giant table.

Important distinction:

- Option B is mostly an **operational/domain boundary** decision.
- Option C is a **distributed systems** decision.

Option B keeps the same database technology and mostly the same engineering model. Option C introduces several independent storage products and therefore a much higher consistency, backup, deployment, and debugging burden.

Current architecture should remain compatible with future specialized storage only if needed:

- every record has `memory_domain`,
- raw large payloads can later be moved behind blob pointers,
- embeddings are modeled separately enough to move from pgvector to a vector DB later,
- graph relations are explicit enough to move from Postgres tables to a graph DB later,
- retrieval should depend on an internal storage interface, not directly on "one giant table".

Backup/restore policy is separate from storage-engine selection. v1 uses the practical backup policy from [BACKUP_RESTORE.md](BACKUP_RESTORE.md): Postgres backup plus raw artifact backup, backup manifest, encrypted target, and restore verification. Initial backups may live on the Recallant server; the architecture must allow later replication to a second backup server over SSH/Tailscale.

## 5. Open decisions

- Should Recallant ever add a tiny `recallant_control` database for domain registry/server metadata, or keep domain routing in config/env?
- Should raw full transcript blobs live in Postgres JSONB/text or object storage once large?
- Exact retention windows for backups and raw evidence.
