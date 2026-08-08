# Second-Brain Repo Lessons

**Date:** 2026-07-18  
**Status:** Research note / design input  
**Goal:** Capture comparable open-source projects for Field Theory CLI, with `tobi/qmd` as the closest retrieval reference, and turn the findings into concrete features we can reuse or adapt.

---

## Summary

Field Theory CLI is already shaped like a local-first second brain: source sync, canonical SQLite index, Markdown library exports, and agent-facing commands. The strongest next step is not a larger app surface; it is a better retrieval core.

The closest repo is [`tobi/qmd`](https://github.com/tobi/qmd). It is especially useful as a model for:

- local Markdown ingestion;
- SQLite-backed BM25 search;
- optional vector and hybrid retrieval;
- bounded agent-facing result shapes;
- CLI / SDK / MCP sharing one core;
- stable virtual document references;
- retrieval benchmarks and path-fidelity tests.

Field Theory should borrow qmd's retrieval architecture, but avoid copying its weaker choices: short content-hash IDs, ambiguous score semantics, permissive MCP inputs, large core modules, and native-model complexity in the minimum path.

---

## Closest comparable repos

| Repo | What it does | Field Theory lesson |
|------|--------------|---------------------|
| [`tobi/qmd`](https://github.com/tobi/qmd) | Local Markdown search with SQLite, BM25, optional vectors/hybrid search, MCP, and SDK. | Closest retrieval architecture. Model `ft search`, `ft research`, `ft get`, bounded context, and future MCP around this style. |
| [`basicmachines-co/basic-memory`](https://github.com/basicmachines-co/basic-memory) | Markdown-first persistent memory for people and agents, with graph/search/MCP. | Treat Markdown as durable memory, not just export. Support human and agent write paths separately. |
| [`iamtouchskyer/memex`](https://github.com/iamtouchskyer/memex) | Lean local agent-memory CLI using Markdown cards, wikilinks, search, and optional Git sync. | Consider atomic knowledge cards derived from sources while preserving source evidence. |
| [`karakeep-app/karakeep`](https://github.com/karakeep-app/karakeep) | Self-hosted capture/archival system for links, notes, images, PDFs, highlights, RSS, and videos. | Strong ingestion and enrichment reference; heavier storage/product model than Field Theory needs. |
| [`ArchiveBox/ArchiveBox`](https://github.com/ArchiveBox/ArchiveBox) | Durable web archiving into HTML, WARC, PDF, PNG, TXT, JSON, media, and SQLite. | Preserve raw source artifacts separately from synthesized Markdown and search indexes. |
| [`go-shiori/shiori`](https://github.com/go-shiori/shiori) | Compact CLI/web bookmark manager with SQLite and readable webpage archives. | Useful small-core reference for bookmark ingestion, search, import/export, and offline archives. |
| [`sissbruecker/linkding`](https://github.com/sissbruecker/linkding) + [`linkding-mcp`](https://github.com/chickenzord/linkding-mcp) | Minimal bookmark manager plus thin agent/MCP adapter. | Keep Field Theory's CLI/JSON core stable and layer MCP over it. |
| [`khoj-ai/khoj`](https://github.com/khoj-ai/khoj) | Self-hostable AI second brain over local docs and web research. | Reference for the broader `ft ask` / `ft research` direction, not the minimal core. |
| [`silverbulletmd/silverbullet`](https://github.com/silverbulletmd/silverbullet) | Programmable Markdown knowledge base with queries, backlinks, objects, tasks, and Lua automation. | Make Markdown pages queryable and composable, not static output. |
| [`readwiseio/readwise-cli`](https://github.com/readwiseio/readwise-cli) | Official CLI for Reader documents and Readwise highlights. | Good connector ergonomics: JSON output, incremental exports, read-only agent mode, explicit document/highlight commands. |

---

## Relevant repos from my GitHub stars

### Memory and second-brain systems

| Starred repo | Why it matters |
|--------------|----------------|
| [`rohitg00/agentmemory`](https://github.com/rohitg00/agentmemory) | Persistent memory for coding agents; useful benchmark and agent-memory framing. |
| [`MemPalace/mempalace`](https://github.com/MemPalace/mempalace) | Open-source AI memory system with MCP/vector-memory emphasis. |
| [`plastic-labs/honcho`](https://github.com/plastic-labs/honcho) | Memory library for stateful agents; useful if Field Theory exposes programmable memory APIs. |
| [`PCIRCLE-AI/memesh-llm-memory`](https://github.com/PCIRCLE-AI/memesh-llm-memory) | SQLite, MCP, HTTP, CLI, semantic search, and memory evolution; close in spirit. |
| [`Siddhant-K-code/distill`](https://github.com/Siddhant-K-code/distill) | Context intelligence: dedup, sensitivity tagging, conflict detection, and decay. Useful for memory hygiene. |
| [`supermemoryai/openclaw-supermemory`](https://github.com/supermemoryai/openclaw-supermemory) | Long-term memory integration for agents. |
| [`supermemoryai/supermemory-mcp`](https://github.com/supermemoryai/supermemory-mcp) | Universal memory MCP; useful thin-protocol reference. |
| [`jackccrawford/Geniuz`](https://github.com/jackccrawford/Geniuz) | Local-first personal AI memory, no cloud. |
| [`EliaAlberti/cpr-compress-preserve-resume`](https://github.com/EliaAlberti/cpr-compress-preserve-resume) | Persistent Claude Code context save/search/restore. |
| [`zackbrooks84/continuum`](https://github.com/zackbrooks84/continuum) | Async task queue plus persistent memory for agents. |

### Knowledge graph and retrieval analogues

| Starred repo | Why it matters |
|--------------|----------------|
| [`neo4j-labs/create-context-graph`](https://github.com/neo4j-labs/create-context-graph) | Graph-based reasoning memory scaffold. |
| [`1st1/lat.md`](https://github.com/1st1/lat.md) | Markdown knowledge graph for codebases. Good `.md` graph inspiration. |
| [`tirth8205/code-review-graph`](https://github.com/tirth8205/code-review-graph) | Persistent codebase map for agents and context reduction. |
| [`Egonex-AI/Understand-Anything`](https://github.com/Egonex-AI/Understand-Anything) | Interactive knowledge graph over code/business knowledge. |
| [`microsoft/graphrag`](https://github.com/microsoft/graphrag) | Larger graph-RAG architecture reference. |
| [`qhjqhj00/MemoRAG`](https://github.com/qhjqhj00/MemoRAG) | Memory-based data interface for RAG. |

### Capture and Markdown conversion

| Starred repo | Why it matters |
|--------------|----------------|
| [`agentpilled/ClipBrain`](https://github.com/agentpilled/ClipBrain) | Low-friction capture UX: save what you read quickly. |
| [`cabinetai/cabinet`](https://github.com/cabinetai/cabinet) | AI-first knowledge base / startup OS product reference. |
| [`readwiseio/readwise-skills`](https://github.com/readwiseio/readwise-skills) | Agent workflows over Readwise data. |
| [`Michaelliv/markit`](https://github.com/Michaelliv/markit) | Convert arbitrary input into Markdown. Useful ingestion primitive. |
| [`zcaceres/markdownify-mcp`](https://github.com/zcaceres/markdownify-mcp) | MCP for converting files/web content to Markdown. |
| [`microsoft/markitdown`](https://github.com/microsoft/markitdown) | Strong general-purpose document-to-Markdown converter. |
| [`kbravh/tweet-to-markdown`](https://github.com/kbravh/tweet-to-markdown) | Tweet-to-Markdown CLI; relevant to X/bookmark ingestion. |
| [`hrescak/transcribe-md`](https://github.com/hrescak/transcribe-md) | Audio transcription to Markdown; relevant for media capture. |

### Full personal AI / RAG products

| Starred repo | Why it matters |
|--------------|----------------|
| [`khoj-ai/khoj`](https://github.com/khoj-ai/khoj) | Personal AI second brain with local docs, web research, agents, and scheduled work. |
| [`Mintplex-Labs/anything-llm`](https://github.com/Mintplex-Labs/anything-llm) | Local-first agent/RAG workspace. Heavier product reference. |
| [`onyx-dot-app/onyx`](https://github.com/onyx-dot-app/onyx) | Enterprise-search/RAG connector ideas; not a CLI peer. |
| [`Cinnamon/kotaemon`](https://github.com/Cinnamon/kotaemon) | Open-source RAG document chat. |
| [`BruceMacD/chatd`](https://github.com/BruceMacD/chatd) | Chat with local documents using local AI. |

---

## qmd is the closest reference

qmd's most transferable pipeline is:

```text
literal source files
  → content-addressed SQLite index
  → section/chunk metadata
  → cheap lexical retrieval
  → optional semantic retrieval
  → rank fusion
  → bounded optional reranking
  → compact hits with canonical IDs and exact source lines
  → explicit follow-up retrieval
```

For Field Theory, this maps naturally to:

```text
source syncs + Markdown Library
  → canonical documents + chunks
  → FTS5/BM25 search
  → optional embeddings
  → `ft research` hybrid fan-out
  → agent-safe snippets and line ranges
  → `ft show` / `ft library show` / future MCP get
```

### qmd ideas to bring over

#### 1. One typed retrieval core shared by CLI, SDK, and MCP

Field Theory should avoid separate retrieval logic in CLI commands, `ft ask`, `ft research`, and future MCP tools.

Recommended shape:

```text
domain types
  ├── document repository
  ├── index repository
  ├── search service
  └── ingestion service
          ↑
      public SDK
       ↑       ↑
      CLI     MCP
```

Commands should parse flags, call the same core methods, and format output. They should not own search algorithms.

#### 2. Markdown/source artifacts as truth, SQLite as a rebuildable index

Keep local files durable and human-readable. SQLite should be a fast projection that can be rebuilt from source caches and Markdown Library content.

Field Theory already has this direction with:

- source-specific raw caches;
- canonical `bookmarks.db`;
- Markdown library pages under `~/.fieldtheory/library`;
- `ft index`, `ft md`, `ft library`, `ft search --unified`.

The next improvement is to make document/chunk identity explicit rather than treating canonical bookmark rows as the only search unit.

#### 3. Separate document ID, URI, and content hash

Do not copy qmd's short content-hash IDs. Use three different identities:

```ts
type DocumentId = string;     // stable opaque identity
type DocumentUri = string;    // current locator, e.g. fieldtheory://library/youtube/...
type ContentHash = string;    // immutable content identity for dedupe/change detection
```

Recommended behavior:

- `DocumentId`: persisted stable ID, not derived from content or path.
- `DocumentUri`: canonical virtual locator such as `fieldtheory://<collection>/<encoded-path>`.
- `ContentHash`: SHA-256 or BLAKE3 over normalized source content.
- Short display IDs: adaptive unique prefixes only.

This protects against edits, moved files, path punctuation, and collisions.

#### 4. Chunk-level line ranges and bounded retrieval

Search should return compact hits, not full documents. Every result should support this loop:

```text
search → compact hit + line range
get(id, aroundLine, maxLines)
get(id, fromLine, maxLines)
get-many(ids, maxTotalBytes, maxBytesPerDocument)
```

Recommended result defaults:

- 5-10 hits;
- 300-800 character snippets;
- absolute line numbers where a Markdown file exists;
- `truncated` flags;
- per-document and total byte budgets;
- no ANSI in JSON output.

This makes Field Theory safer for Claude Code, Codex, Amp, and MCP clients because agents can retrieve progressively instead of dumping the whole Library.

#### 5. FTS5 first, semantic search later

qmd's strongest pragmatic lesson is to keep lexical search useful even when vectors or local model dependencies are absent.

Field Theory should stage retrieval like this:

1. **Lexical v1**: FTS5/BM25 over title, headings, tags, frontmatter, body, source labels, and snippets.
2. **Chunk v1**: Markdown-section chunks with line ranges and stable chunk IDs.
3. **Semantic optional**: pluggable embeddings with capability detection.
4. **Hybrid optional**: rank fusion over lexical and semantic result lists.
5. **Rerank optional**: bounded chunk reranking only after evaluation shows it helps.

This avoids making model downloads or vector extensions part of the minimum viable experience.

#### 6. Rank fusion instead of pretending scores are comparable

BM25 and vector similarity scores do not mean the same thing. qmd uses Reciprocal Rank Fusion style ranking, which is a better default than score averaging.

Field Theory should expose score metadata clearly:

```json
{
  "score": {
    "value": 0.82,
    "kind": "hybrid-v1",
    "lexicalRank": 2,
    "semanticRank": 7,
    "rerank": 0.71
  }
}
```

Avoid treating one `score` field as universal confidence across lexical, semantic, hybrid, and reranked modes.

#### 7. Strict machine contracts

qmd's compact JSON is useful, but Field Theory should use a versioned envelope:

```ts
interface SearchResponseV1 {
  schemaVersion: 1;
  query: {
    text: string;
    mode: "lexical" | "semantic" | "hybrid";
    collections: string[];
  };
  results: SearchHitV1[];
  truncated: boolean;
}
```

Keep:

- JSON on stdout;
- progress and diagnostics on stderr;
- stable field names across CLI and MCP;
- strict validation of unknown MCP/tool inputs;
- generated or tested docs for examples.

#### 8. Retrieval benchmarks and path-fidelity tests

qmd's best tests cover path round trips, structured search parsing, output formats, concurrency, and benchmark fixtures.

Field Theory should add tests for:

- filenames with `#`, `&`, spaces, brackets, parentheses, Unicode, and `@`;
- source path → URI → get round trips;
- `search --json` contract stability;
- collection/source filtering before top-K limiting;
- search during indexing;
- moved/deleted Markdown notes;
- fake embedding provider for deterministic semantic tests;
- exact names, aliases, topical queries, and paraphrase queries.

---

## qmd choices to avoid or change

| Area | qmd choice | Field Theory choice |
|------|------------|---------------------|
| Public ID | Short content-hash prefix | Persisted stable opaque ID with adaptive short display prefix. |
| Content identity | Content hash | Keep, but separate from document identity. |
| External locator | `qmd://collection/path` | Adopt as `fieldtheory://collection/path`. |
| JSON output | Compact top-level arrays | Versioned response envelopes. |
| Scores | Single mode-dependent `score` | Score policy/version and optional components. |
| Config ownership | YAML plus DB mirror | One authoritative source with explicit revisioned snapshot. |
| Core implementation | Large store module | Separate ingestion, storage, search, SDK, CLI, and MCP modules. |
| Unknown tool args | Can be permissive | Strict rejection with actionable errors. |
| Advanced retrieval | Native-model-heavy path | Lexical-first baseline; advanced retrieval by capability. |
| Hooks | Arbitrary shell update hooks | Omit initially, or make opt-in, visible, and isolated. |

---

## What Field Theory can bring on better

### Better retrieval model

Move from row-level bookmark search toward document/chunk retrieval:

```text
canonical source row
  → generated/source Markdown document
  → parsed headings/frontmatter/tags/links
  → section chunks with line ranges
  → FTS/vector indexes
```

This lets `ft search`, `ft research`, `ft ask`, and future MCP tools cite exact Markdown sections rather than only canonical bookmark rows.

### Better agent contract

Create a stable agent-facing retrieval contract:

```bash
ft research "agent memory" --json
ft library search "agent memory" --json
ft library get fieldtheory://library/bookmarks/... --from-line 40 --max-lines 80 --json
ft library get-many <ids...> --max-total-bytes 50000 --json
```

Key property: every command should be bounded, structured, and composable.

### Better source preservation

Borrow ArchiveBox's principle: keep raw evidence and derived synthesis separate.

Recommended artifact classes:

```text
~/.fieldtheory/bookmarks/<source>/raw/      # API JSON, HTML, transcripts, media metadata
~/.fieldtheory/bookmarks/<source>/state/    # cursors, sync metadata, failures
~/.fieldtheory/library/<source>/            # generated Markdown notes
~/.fieldtheory/library/synthesis/           # daily digests, research briefs, wiki pages
~/.fieldtheory/indexes/                     # rebuildable SQLite/vector indexes
```

### Better connector contract

Generalize X, Raindrop, GitHub stars, YouTube, following, and future Readwise sources behind a shared connector interface:

```ts
interface SourceConnector {
  readonly id: string;
  preflight(): Promise<SourcePreflight>;
  sync(options: SyncOptions): AsyncIterable<SourceEvent>;
  toCanonical(record: unknown): CanonicalSourceRecord;
  toMarkdown?(record: unknown): SourceMarkdownDocument;
}
```

This should make `ft sync-all`, source-specific commands, tests, and future MCP/status output simpler.

### Better memory hygiene

Borrow from memory systems in the starred list:

- deduplicate facts and sources;
- preserve contradictory evidence instead of overwriting it;
- mark sensitivity/private data;
- separate raw capture, summary, and durable insight;
- track stale or superseded notes;
- support lightweight decay or review queues for old items.

This should happen after retrieval is stable; otherwise hygiene layers will sit on a weak index.

---

## Proposed adoption roadmap

### Milestone 1 — Agent-safe lexical retrieval

Deliver a reliable local retrieval layer with no model dependency.

- Add document/chunk tables for Markdown Library files.
- Parse title, headings, frontmatter, tags, links, body, and line ranges.
- Add stable document IDs and `fieldtheory://` URIs.
- Add FTS5 over chunks with weighted title/headings/body/tags fields.
- Add bounded `search`, `get`, and `get-many` JSON contracts.
- Route `ft research` and `ft ask` through this retrieval service where possible.
- Add path-fidelity and JSON-contract tests.

### Milestone 2 — Source connector cleanup

Make source syncs easier to extend.

- Define a connector interface.
- Adapt GitHub stars and Raindrop first because they are API-shaped and headless.
- Keep X and YouTube special cases until the interface proves itself.
- Move preflight/result summaries into shared types used by `ft sync-all`.

### Milestone 3 — Optional semantic search

Add semantic retrieval without making it required.

- Add embedding provider interface.
- Add capability detection and `ft status` reporting.
- Store embedding-set fingerprints: model, dimensions, chunker version, formatter version.
- Add fake provider tests.
- Add `ft search --mode semantic` and `--mode hybrid` only when indexes are present.

### Milestone 4 — Hybrid retrieval and evaluation

Only after lexical and semantic modes are tested independently:

- Add rank fusion with explain traces.
- Add fixture-based benchmark queries.
- Compare lexical, semantic, and hybrid recall/latency.
- Keep collection/source filtering before top-K limiting.

### Milestone 5 — Optional reranking and query expansion

Only if benchmarks show value:

- Rerank bounded chunks, not full documents.
- Cache by query, model, prompt version, chunk hash, and chunker version.
- Preserve exact-match lexical results from being drowned by expansion.
- Add timeout/fallback so search remains useful without reranking.

---

## Open questions

- Should Field Theory use one global user index, one project-local index, or both?
- Should `fieldtheory://` URIs point at canonical source records, Markdown Library files, or both with different schemes?
- Should generated Markdown become the primary retrieval unit, or should raw canonical records stay searchable independently?
- What is the first MCP surface: read-only search/get/status, or include capture/write tools?
- Which source should be the first connector-interface migration: GitHub stars, Raindrop, or Readwise when added?
- Should semantic search use local embeddings by default, remote embeddings by config, or no default provider?

---

## Bottom line

Field Theory should become a qmd-like retrieval system wrapped around a richer second-brain source pipeline.

The near-term win is not to clone qmd. It is to bring over the parts that make agents effective:

- stable document references;
- chunked Markdown retrieval;
- exact source lines;
- bounded JSON results;
- lexical-first search;
- optional semantic/hybrid search;
- one core shared by CLI, SDK, and future MCP;
- tests that protect path fidelity and machine contracts.

That would make Field Theory's local Library much more reusable by agents while preserving the local-first, source-preserving design that differentiates it from generic RAG apps.
