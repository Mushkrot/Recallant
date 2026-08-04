# Chase AI Jarvis, Karpathy LLM Wiki, And Recallant

Snapshot date: 2026-07-20.

## Verdict

The screenshots describe **Chase AI's custom Jarvis**, not a public standalone project with a
verifiable source repository. The identification is high-confidence because the first-party Chase
AI article repeats the screenshots' distinctive combination of Fable 5, Claude Code, Obsidian,
Faster Whisper, Kokoro, a customizable web UI, and client/team distribution.

Jarvis's “second brain” is an adaptation of **Andrej Karpathy's LLM Wiki pattern**: immutable raw
sources, an LLM-maintained Markdown wiki, index files used as maps, and derived outputs viewed in
Obsidian. This is a useful product and information-architecture reference. It is not code-level
evidence for a tested graph-memory engine, and it is not equivalent to Recallant's governed agent
memory.

Reference classification:

- **Chase AI Jarvis:** product/concept reference; public implementation not available for audit.
- **Karpathy LLM Wiki:** upstream architecture/prompt reference; intentionally abstract, not a
  packaged implementation.

## Identity Evidence

| Screenshot fingerprint | First-party evidence | Assessment |
| --- | --- | --- |
| Built with Fable 5 but intended to run without it | Chase AI says Jarvis was built with Fable 5 but can use Opus, Sonnet, or local models | Exact match |
| Voice layer over Claude Code and Obsidian | Chase AI calls Jarvis a visual, voice-first layer over Claude Code and describes reports stored in an Obsidian vault | Exact match |
| Faster Whisper and Kokoro | Chase AI names Faster Whisper for local speech-to-text and Kokoro for local text-to-speech | Exact match |
| `raw`, `wiki`, and outputs | Chase AI describes this as the Karpathy Obsidian setup; Karpathy's primary note defines raw sources, an LLM-owned wiki, and derived answers/artifacts | Exact architectural match |
| Modular UI that can be adapted for clients or teams | Chase AI describes replaceable metrics, skills as buttons, and a web app that can be handed to clients or teammates | Exact match at the claim level |

The screenshot phrase translated as a “Cartography system” should be read as **Karpathy system**.
The primary upstream source is Karpathy's `LLM Wiki` note.

## What Is Actually Verified

### The upstream LLM Wiki pattern

Karpathy's note defines three logical layers:

1. Raw sources are immutable and remain the source of truth.
2. The wiki contains LLM-generated Markdown pages, summaries, entities, concepts, comparisons, and
   cross-references.
3. A schema file such as `CLAUDE.md` or `AGENTS.md` defines structure and ingest, query, and
   maintenance workflows.

The proposed ingest flow reads one source, writes or updates multiple wiki pages, updates
`index.md`, and appends to `log.md`. Query reads the index first, opens relevant pages, and
synthesizes a cited answer. Useful answers **can** be filed back into the wiki. Lint looks for
contradictions, stale claims, orphan pages, missing links, and gaps.

Karpathy reports that index-first navigation works at roughly 100 sources and hundreds of pages,
but labels the document an abstract idea rather than a specific implementation. He recommends a
local hybrid-search tool such as `qmd` when the wiki grows. The note provides no benchmark, test
suite, reliability measurement, access-control model, or conflict-resolution implementation.

### Chase AI's Jarvis description

The first-party routing description is more nuanced than the carousel:

- speech is transcribed locally;
- routing can use deterministic regular expressions, Haiku, or a local model;
- a requested report is first checked on disk in Obsidian;
- only when generation is needed does Jarvis spawn headless Claude Code with `claude -p`, write the
  report to Obsidian, read it back, and summarize it;
- the resulting summary can be spoken by local Kokoro TTS.

Chase AI's later explanation says the real value of Obsidian is the folder hierarchy and index
files, not the visual knowledge graph. It also says the author's actual vault contains more than the
three illustrative folders. Therefore `raw/wiki/outputs` is a transferable mental model, not proof
of Jarvis's complete production schema.

## Screenshot Claims That Are Unverified Or Overstated

| Claim | Evidence-based status |
| --- | --- |
| “All routes go through Claude Code” | **Contradicted by the first-party description.** Regex, Haiku, and local-model routing occur before Claude Code; an existing Obsidian report can be read without generating a new one. |
| “Every answer is saved as Markdown” | **Not established.** First-party sources describe generated reports and useful answers being saved, not an unconditional write of every response. |
| “The linked graph makes answers fast and accurate without a database” | **Unsupported as a measured claim.** The author later says graph view is mainly visual and the folder/index map is the useful part. No accuracy, latency, scale, or corruption benchmark is public. |
| “100% local” | **True only for the voice components as described.** Default reasoning and headless execution still use Claude Code/Anthropic models unless explicitly replaced. |
| “Model-independent and modular” | **Plausible design claim, not audited portability.** No public Jarvis source, adapters, compatibility matrix, or tests were found in the first-party material. |
| “Easy client/team forks” | **Product claim only.** Chase AI describes the intended distribution pattern, but no public package, release, license, or upgrade path is available to verify it. |

## Comparison With Recallant

| Dimension | Jarvis / LLM Wiki | Recallant |
| --- | --- | --- |
| Primary state | Human-readable Markdown files in a vault | Project-scoped governed memory in Postgres + pgvector |
| Human browsing | Excellent: ordinary files, Obsidian links, graph view, Git | Workbench plus bounded Markdown export; less naturally file-native |
| Retrieval | Folder and `index.md` navigation; optional external search as scale grows | Scoped lexical/vector/hybrid retrieval, context packs, and bounded graph expansion |
| Knowledge links | LLM-written `[[wikilinks]]`; graph view reflects those links | Provenance-aware graph candidates and edges with lifecycle and review state |
| Write authority | The LLM is expected to own and edit the wiki directly | Agent memories and graph candidates carry source refs, confidence, scope, policy, and review state |
| Provenance | Immutable raw sources and citations are recommended conventions | Source references and audit are part of the product contract |
| Conflict and staleness | Prompted lint is expected to detect problems | Review states, supersession/conflict relations, lifecycle policy, and human review surfaces |
| Isolation and policy | Vault/folder boundary; no public Jarvis security contract | Project/developer/audience scoping, retention/erasure policy, redacted audit, and capability gates |
| Multi-client continuity | Centered on Claude Code in the demonstrated setup | MCP-first service intended for multiple agent clients |
| Verifiability | Karpathy note is a design prompt; Jarvis source is not public | Public code, contracts, migrations, smoke tests, and documented current limitations |

### Where the Obsidian approach is genuinely better

- It is immediately legible, editable, portable, and inspectable by a human.
- Markdown and Git make backup, diff, and export simple.
- The `index.md`-as-map pattern is cheap and understandable before more elaborate retrieval is
  needed.
- Obsidian provides a strong personal knowledge-reading experience without becoming the inference
  or storage server.
- Separating immutable sources, compiled knowledge, and outputs is an excellent mental model.

### Where it is weaker for Recallant's job

- Direct LLM edits can silently turn inference into apparent fact.
- Wikilinks show declared connections but do not prove that a claim is supported, current, or safe
  to use as instruction.
- A file map does not supply project identity, audience policy, review state, retention, erasure,
  audit, or capture/readiness proof.
- Rewriting compiled pages can erase historical state unless every consumer understands Git history
  and provenance conventions.
- Index-first retrieval eventually needs disciplined maintenance and a real search layer; the
  public claims do not prove behavior at large scale or under concurrent writers.

## Recallant Product Implications

The best direction is **hybrid, not replacement**:

- keep Recallant as the authoritative governed memory and evidence service;
- treat an Obsidian-compatible vault as a human-readable projection, review surface, and optional
  curated knowledge workspace;
- preserve the simple source -> curated wiki -> output mental model in user-facing workflows;
- make index/map exports compact enough for both agents and humans to navigate;
- preserve source refs, review state, confidence, and supersession metadata in exported Markdown;
- require explicit confirmation before vault-derived candidates become retrieval-active memory;
- do not let passive two-way file sync bypass project scope, provenance, review, or erasure policy.

Recallant already has the correct foundation for this direction: its documented Markdown vault
bridge is dry-run by default, ignores `.obsidian/` internals, can inventory notes and propose
source-linked graph candidates, requires explicit confirmation to persist candidates, and exports
bounded review files. It is deliberately not yet a passive sync daemon or broad import path. Jarvis
and the LLM Wiki strengthen the case for making this bridge easier to discover and more useful as a
readable “second brain”; they do not justify replacing governed storage with a mutable vault.

## Accepted Future Direction

Decision status: accepted product direction. Human Document Memory is now the milestone after
Cross-Client Continuity v1. This section records the trust and ownership contract; the current
runtime still does not provide broad folder ingestion or passive vault synchronization.

The accepted direction is:

- Recallant may grow from coding-agent memory into a shared second-memory platform for AI agents and
  people while preserving different consent, scope, retention, and review policies for each domain.
- The primary human experience should be AI-mediated. A person asks a question; the system plans
  searches, retrieves from the allowed sources, evaluates freshness and conflicts, and returns a
  readable answer with inspectable provenance. Manual file browsing is not a required primary
  workflow, although source inspection, correction, export, and erasure remain necessary control
  paths.
- Large local-disk and server corpora are future source domains. Recallant should eventually be able
  to register, incrementally analyze, extract, chunk, index, and retrieve permitted notes and files
  for both human and agent queries.
- Original source artifacts, extracted evidence, derived knowledge candidates, governed memory, and
  instruction-grade rules remain distinct. Indexing an artifact must not silently promote its text
  into accepted memory or agent instructions.
- Recallant's governed database remains authoritative for source identity, derived indexes,
  provenance, lifecycle, policy, and accepted memory. Original files remain authoritative for their
  own bytes and versions. This is a division of responsibility, not two competing memory databases.
- Obsidian remains optional. It may serve as a source adapter, a human capture/editing surface, or a
  generated projection of selected governed knowledge. It is not a peer authoritative database and
  must not introduce an independent silent truth or bypass review through passive two-way sync.
- Human and agent clients should ultimately share one governed query and answer layer rather than
  receiving separate storage-specific search implementations.

### Current implementation boundary

The first Human Document Memory MVP is limited to explicit owner attachment of Markdown, text, PDF,
and DOCX sources; stable source identity and update/delete behavior; and answers with inspectable
citations. It does not authorize passive vault synchronization, unrestricted filesystem crawling,
raw-media processing, email ingestion, or a new storage service. The existing dry-run-first vault
and governed-candidate contracts remain unchanged until that milestone explicitly scopes runtime
work.

## Primary Sources

- Chase AI, [How to Build a Voice-Driven Agentic OS on Claude Code](https://www.chaseai.io/blog/voice-driven-agentic-os-claude-code), 2026-06-14.
- Chase AI, [How to Build Your Own Agentic OS with Claude Code](https://www.chaseai.io/blog/build-your-own-agentic-os-claude-code), 2026-06-25.
- Chase AI, [How to Turn Claude Into Your Personal Assistant](https://www.chaseai.io/blog/turn-claude-into-personal-assistant), 2026-07-15.
- Andrej Karpathy, [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), created 2026-04-04; one public revision at inspection time.
- Andrej Karpathy, [version-pinned raw note](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/ac46de1ad27f92b28ac95459c782c07f6b8c964a/llm-wiki.md), revision `ac46de1ad27f92b28ac95459c782c07f6b8c964a`.
- Recallant, [Architecture](../ARCHITECTURE.md) and
  [Governed Graph Tree Contract](../GRAPH_TREE_CONTRACT.md#markdown-vault-bridge).

No public Jarvis repository, tag, release, license, issue tracker, or implementation test suite was
linked from the first-party Chase AI material inspected. Accordingly, this document treats Jarvis
as a product/concept reference and the Karpathy note as its inspectable upstream pattern.
