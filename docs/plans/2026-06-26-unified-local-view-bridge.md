# Unified Local View Bridge Plan

**Date:** 2026-06-26  
**Status:** Proposed implementation plan  
**Goal:** Bridge Field Theory's integrated personal data sources into one readable, searchable, agent-accessible local view without introducing a new database, frontend stack, or over-broad sync surface.

## Executive recommendation

Use the existing canonical SQLite index as the durable unified view, and promote it from a CLI search helper into the shared product model for:

- `ft serve` web Library view
- `ft search --unified`, `ft list --unified`, and `ft show --unified`
- `ft ask` grounding
- a new agent-first `ft research "<topic>" --json` command
- daily/local sync synthesis

Keep X list digests and the X following roster as side-context surfaces rather than canonical bookmarks:

- X list digest = **Today / Sources / Analyze** context
- X following roster = **Experts** context
- X bookmarks, Raindrop/browser bookmarks, GitHub stars, and YouTube playlist notes = **durable Library** items

Do not build a new datastore, vector database, React app, local chat UI, or browser-triggered sync yet. The current repo already has the right primitives; the missing bridge is a consistent unified read model and agent contract.

## Current source map

| Source | Current command | Current storage/index | Current visibility | Bridge gap | Recommendation |
|---|---|---|---|---|---|
| X/Twitter bookmarks | `ft sync` | Raw JSONL + X-only SQLite/FTS + canonical projection | X-only CLI/web; partial unified CLI | Web and `ft ask` still mostly use X-only paths | Make canonical the default Library/search surface; keep X-only APIs for compatibility |
| Raindrop/browser bookmarks | `ft sync-raindrop` | Raindrop JSONL + canonical projection | Unified CLI only | Not visible in web or `ft ask` | Include in `/api/unified`, Library cards, `ft ask`, and `ft research` |
| GitHub stars | `ft sync-github-stars` | GitHub stars JSONL + canonical projection | Unified CLI only | Not visible as first-class web/agent source | Show as repo-kind Library items; expose metadata/provenance in details |
| YouTube playlists | `ft sync-youtube` | Markdown notes + state/artifacts + canonical summary source | Searchable shallowly via canonical; notes separate | Canonical FTS lacks chapter depth and note paths | Add note path/chapter summaries to canonical source metadata; keep full notes as deep context |
| X list digest | `ft x-list <id>` | Latest/date-stamped JSON + HTML | Current web Today/Analyze/Sources lanes | Not available through one agent command | Keep ephemeral; include latest digest hits in `ft research` |
| X following roster | `ft sync-following` | JSONL + `following.db` FTS | `ft experts` CLI | Separate from unified view | Keep as Experts context; include in `ft research`; optional later web Experts lane |
| Markdown Library/wiki | `ft md`, `ft md --canonical`, `ft wiki`, `ft library` | Markdown files + library commands | Agent can grep/search, but not as default | `ft ask` raw grounding is still X-only | Return markdown paths from `ft research`; update `ft ask` to use canonical hits |

## Key current architecture observations

### Canonical projection already exists

The repository already has a canonical projection in `src/canonical-bookmarks-db.ts`:

- `bookmark_sources`
- `canonical_bookmarks`
- `canonical_bookmarks_fts`

Current source mappings cover:

- X bookmarks via `xSourceFromRecord`
- Raindrop via `raindropSourceFromRecord`
- GitHub stars via `githubStarsSourceFromRecord`
- YouTube videos via `youtubeSourceFromVideo`

This should become the durable unified Library model rather than being treated as an optional CLI-only index.

### Current web app is not yet unified

`src/web/server.ts` currently exposes:

- `/api/bookmarks` from X-only `bookmarks-db.ts`
- `/api/bookmarks/:id`
- `/api/stats`
- `/api/media-manifest`
- `/api/link-preview`
- `/api/lists/:id/today`
- `/api/lists/:id/analysis`
- `/api/lists/:id/sources`
- `/api/lists/:id/context`

The web UI is useful, but it is still framed around X bookmarks and the latest X list digest. It does not yet expose Raindrop, GitHub stars, or YouTube notes through the main browse/search path.

### `ft ask` is still X-only at the grounding layer

`src/md-ask.ts` still imports and calls `searchBookmarks` from `bookmarks-db.ts`. That means `ft ask` can miss Raindrop, GitHub stars, and YouTube sources even though they exist in the canonical index.

### X list digest and following roster should not be blindly canonicalized

X list tweets and followed accounts are high-volume context. If all of them are inserted into canonical bookmarks, the Library becomes noisy and loses the distinction between:

- things intentionally saved/imported
- daily situational signals
- people who may be relevant experts

Keep this distinction in the product model.

## Target architecture

```text
Raw source caches
  X bookmarks JSONL / bookmarks.db
  Raindrop JSONL
  GitHub stars JSONL
  YouTube notes + state
        │
        ▼
Durable canonical Library
  canonical_bookmarks
  bookmark_sources
  canonical_bookmarks_fts
        │
        ├── CLI: ft search/list/show --unified
        ├── Web: /api/unified + Library lane
        ├── Agent: ft research canonical group
        └── Ask: canonical grounding for ft ask

Side-context indices
  X list latest digest
  following.db experts FTS
  Library markdown search
        │
        ├── Web: Today / Sources / Analyze / optional Experts
        └── Agent: ft research today + experts + library groups
```

## Product model

### Durable Library item

Use a DTO named `UnifiedItem` at API boundaries. Do not rename database tables yet.

```ts
interface UnifiedItem {
  id: string;
  kind: 'article' | 'tweet' | 'repo' | 'video' | 'bookmark';
  title: string;
  url: string | null;
  snippet: string;
  sources: string[];
  sourceCount: number;
  savedAt: string | null;
  firstSavedAt: string | null;
  categories: string[];
  domains: string[];
  primaryCategory: string | null;
  primaryDomain: string | null;
  paths: Array<{ kind: 'markdown' | 'artifact'; path: string }>;
  sourceRows: UnifiedSource[];
}
```

### Source provenance row

Expose canonical source rows in detail responses so users and agents can cite correctly.

```ts
interface UnifiedSource {
  source: 'x' | 'raindrop' | 'github-stars' | 'youtube';
  profile: string | null;
  sourceItemId: string;
  sourceUrl: string;
  targetUrl: string | null;
  title: string | null;
  text: string | null;
  authorHandle: string | null;
  savedAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  folderPath: string[];
  links: string[];
  contentPath?: string | null;
  metadata?: Record<string, unknown>;
}
```

### Optional schema additions

Add only the small metadata columns that unblock useful web/agent behavior:

```sql
ALTER TABLE bookmark_sources ADD COLUMN content_path TEXT;
ALTER TABLE bookmark_sources ADD COLUMN metadata_json TEXT;
ALTER TABLE canonical_bookmarks ADD COLUMN item_kind TEXT;
```

Use these columns conservatively:

- YouTube: `content_path` points to the markdown note; `metadata_json` can contain video id, channel, duration, topics, and chapter summaries.
- GitHub: `metadata_json` can eventually contain language/stars/forks/topics if useful in the detail drawer.
- X/Raindrop: no immediate need to duplicate extra metadata.

## What to index

Index these in canonical FTS:

- X bookmark tweet text
- X author handle/name
- X outbound URLs and folder names
- X enriched article title/text when available
- Raindrop title, excerpt, notes, highlights, collection names, tags if available
- GitHub full name, owner, description, language, topics, homepage URL
- YouTube title, TLDR, key points, topics, chapter labels, and chapter summaries

Do not index these yet:

- every X list tweet
- every followed account
- raw YouTube transcripts
- audio/video artifacts
- slide images
- raw GraphQL payloads
- arbitrary full web page bodies unless they are already enriched article text owned by Field Theory

## Web UI target shape

Keep the dependency-free web UI. Change the information architecture, not the stack.

### Home

Purpose: source coverage and freshness.

Show:

- total canonical Library items
- counts by source: X, Raindrop, GitHub stars, YouTube
- following roster count
- latest X list digest timestamp/count
- last sync per source where available
- latest saved/imported items
- Today digest preview

### Library

Purpose: the default durable unified browse/search view.

Backed by:

- `GET /api/unified`
- `GET /api/unified/:id`

Capabilities:

- search canonical FTS
- filter by source
- filter by category/domain
- sort by saved date or relevance
- generic cards with source badges
- detail drawer with provenance rows
- links to markdown notes when present

### Today

Purpose: latest X list digest as a situational feed.

Keep current behavior:

- `GET /api/lists/:id/today`
- top/list tweets
- conversation context

Add later:

- quick links to search Library for URL/domain/author

### Analyze

Purpose: local counts over the latest list digest.

Keep current behavior:

- link types
- domains
- authors
- top tweets

### Sources

Purpose: URLs and domains surfaced by the X list digest.

Keep current behavior:

- `GET /api/lists/:id/sources`

Add later:

- “Find in Library” affordance for each URL/domain

### Experts

Purpose: following roster search and domain experts.

This can be deferred until `/api/unified` and `ft research` are stable.

Possible future endpoints:

- `GET /api/experts?query=`
- `GET /api/experts/:handle`

## Agent access contract

Agents need one command to start from, not a pile of source-specific commands.

Add:

```bash
ft research "<topic>" --json --limit 10
```

Expected JSON shape:

```json
{
  "query": "agent memory",
  "generatedAt": "2026-06-26T00:00:00.000Z",
  "canonical": [
    {
      "id": "canonical:...",
      "title": "example/tool",
      "url": "https://github.com/example/tool",
      "snippet": "...",
      "sources": ["github-stars", "raindrop"],
      "score": -4.21,
      "paths": [{ "kind": "markdown", "path": "..." }]
    }
  ],
  "library": [
    {
      "path": "youtube/2026-06/video.md",
      "title": "...",
      "snippet": "..."
    }
  ],
  "today": [
    {
      "kind": "x-list-source",
      "url": "...",
      "domain": "...",
      "authors": ["..."]
    }
  ],
  "experts": [
    {
      "handle": "alice",
      "name": "Alice",
      "expertise": ["agents"],
      "bookmarkOverlap": 12
    }
  ],
  "next": [
    "ft show --unified <id> --json",
    "ft library show <path> --json",
    "ft experts show @handle --json"
  ]
}
```

Human output can be grouped and readable, but JSON should preserve source groups rather than forcing one mega-ranking across unlike data.

## Implementation plan

### Phase 1 — Make canonical fresh and web-readable

**Goal:** One durable unified Library API/view without changing every source.

**Files:**

- `src/canonical-bookmarks-db.ts`
- `src/web/server.ts`
- `src/web/app-shell.ts`
- `src/cli.ts`
- `tests/canonical-bookmarks-db.test.ts`
- `tests/web-server.test.ts`

**Tasks:**

1. Rebuild canonical after X index rebuilds.
   - Update the `rebuildIndex()` helper in `src/cli.ts` to call `rebuildCanonicalIndex()` after `buildIndex()`.
   - Ensure `ft index` performs the same canonical refresh.
   - Output separate status lines for X index and canonical index.

2. Improve X canonical source hydration.
   - Prefer reading X source rows from the `bookmarks` table when available.
   - Include article title/text, folders, links, author, and saved dates.
   - Fall back to raw JSONL if the table is unavailable.

3. Extend canonical list/search filters.
   - Add `query?: string` to canonical list options.
   - Add `source?: string`, `category?: string`, `domain?: string`, `limit`, and `offset` filters.
   - Use canonical FTS when `query` is present.

4. Add unified web endpoints.
   - `GET /api/unified?query=&source=&category=&domain=&limit=&offset=`
   - `GET /api/unified/:id`
   - Detail response includes `bookmark_sources` provenance.

5. Convert the web “Bookmarks” lane into “Library.”
   - Use `/api/unified` as the backing endpoint.
   - Keep `/api/bookmarks` as compatibility/X-specific route.
   - Render generic Library cards: title, URL/domain, snippet, source badges, saved date.
   - Detail drawer shows provenance rows and markdown paths.

**Verification:**

```bash
npm test -- tests/canonical-bookmarks-db.test.ts tests/web-server.test.ts
npm run build
```

**Manual smoke:**

```bash
npm run dev -- serve --host 127.0.0.1 --port 8787
open http://127.0.0.1:8787
```

Success criteria:

- Library search returns X, Raindrop, GitHub stars, and YouTube rows when present.
- Detail drawer shows source provenance.
- X-only bookmark route still works.

### Phase 2 — Add YouTube deep-context bridge

**Goal:** YouTube videos are discoverable beyond TLDR and link to full notes.

**Files:**

- `src/canonical-bookmarks-db.ts`
- `src/youtube/overview.ts`
- `src/youtube/notes.ts` if needed
- `tests/youtube-canonical-index.test.ts`

**Tasks:**

1. Extend `YoutubeSourceVideoInput`.

```ts
interface YoutubeSourceVideoInput {
  videoId: string;
  title: string;
  tldr: string;
  keyPoints?: string[];
  topics: string[];
  published?: string | null;
  notePath?: string;
  chapters?: Array<{ label: string; summary: string }>;
  channel?: string | null;
  durationSec?: number | null;
}
```

2. Add `content_path` and `metadata_json` columns to `bookmark_sources`.

3. Update `youtubeSourceFromVideo()`.
   - Include title, TLDR, key points, topics, chapter labels, and chapter summaries in canonical FTS text.
   - Store `notePath` in `content_path`.
   - Store video metadata in `metadata_json`.

4. Update `processVideo()` in `src/youtube/overview.ts`.
   - Pass `notesPath` to `upsertYoutubeVideosAsSources`.
   - Pass chapter labels/summaries if available.

**Verification:**

```bash
npm test -- tests/youtube-canonical-index.test.ts tests/canonical-bookmarks-db.test.ts
npm run build
```

Success criteria:

- Query matching a YouTube chapter summary finds the video.
- `ft show --unified <id> --json` or `/api/unified/:id` returns a markdown note path.
- Re-upserting the same video remains idempotent.

### Phase 3 — Add `ft research` and fix `ft ask`

**Goal:** Agents have one stable command for all local context, and `ft ask` no longer ignores non-X sources.

**Files:**

- `src/research.ts`
- `src/cli.ts`
- `src/md-ask.ts`
- `src/md-prompts.ts` if prompt shape needs source labels
- `src/skill.ts`
- `tests/research.test.ts`
- existing or new ask tests
- existing or new skill tests

**Tasks:**

1. Add `src/research.ts` aggregator.

Sources:

- canonical FTS via `searchCanonicalBookmarks`
- Library markdown search via existing library helpers or a small shared helper
- latest X list digest via `readLatestXListDigest`, `deriveTodaySources`, and `deriveTodayAnalysis`
- following experts via following DB search helpers

2. Add CLI command.

```bash
ft research "<topic>" --json --limit 10
ft research "<topic>" --limit 10
```

3. Update `ft ask`.
   - In page selection, boost pages with canonical hits as well as X hits.
   - In raw grounding, call `searchCanonicalBookmarks` first.
   - Preserve X-only fallback if canonical DB is empty/missing.
   - Include source labels, canonical URLs, and markdown paths in prompt context.

4. Update installed skill content in `src/skill.ts`.
   - Start local research with `ft research "<query>" --json`.
   - Use `ft show --unified <id> --json` for provenance.
   - Use `ft library show <path> --json` for deep notes.
   - Use `ft experts search/show` for people.

**Verification:**

```bash
npm test -- tests/research.test.ts
npm run build
ft research "agent memory" --json
ft ask "agent memory tools" --json
```

Success criteria:

- `ft research --json` returns grouped canonical/library/today/experts results.
- `ft ask` can cite non-X sources when relevant.
- Agent skill docs point to `ft research` as first step.

### Phase 4 — Daily sync orchestration

**Goal:** Daily freshness for the unified view without turning the web UI into an unsafe control plane.

**Files:**

- `src/sync-all.ts`
- `src/cli.ts`
- `src/preferences.ts` or a small sync config module
- `tests/sync-all.test.ts`
- README updates

**Command:**

```bash
ft sync-all --dry-run
ft sync-all --x-list <id> --playlist <url> --youtube-limit 8
ft sync-all --skip youtube
ft sync-all --only github-stars,raindrop
ft sync-all --no-synthesis
```

**Run order:**

```text
ft sync-following
ft sync
ft x-list <listId> --since-hours 24
ft sync-raindrop --classify
ft sync-github-stars --classify
ft sync-youtube --playlist <url> --limit <N>
ft index
ft md --canonical
optional ft wiki
```

**Properties:**

- sequential execution
- fault isolation per source
- preflight matrix for tokens, binaries, and browser-cookie availability
- YouTube capped by default
- canonical rebuild once at the end even if some sources failed
- no browser sync button yet

**Verification:**

```bash
npm test -- tests/sync-all.test.ts
npm run build
ft sync-all --dry-run
ft sync-all --skip youtube
ft research "agents" --json
```

Success criteria:

- Dry run clearly reports available/missing prerequisites.
- One source failure does not abort the batch.
- Canonical Library remains fresh after sync.

### Phase 5 — Documentation and agent contract

**Goal:** Make the workflow self-explanatory to future agents and future you.

**Files:**

- `README.md`
- `src/skill.ts`
- optional `docs/specs/2026-06-26-unified-local-view.md`
- this plan file

**Tasks:**

1. Update README command tables.
   - `ft serve` serves unified Library + Today.
   - `ft research` is the agent-first local research entrypoint.
   - `ft ask` uses unified local context.
   - `ft sync-all` handles local daily refresh once implemented.

2. Update generated skill content.
   - Start with `ft research`.
   - Fall back to source-specific commands for deep dives.
   - Use web search only after local context is insufficient.

3. Add a short agent-local research contract if needed.

Example contract:

```bash
ft research "<topic>" --json          # start here
ft show --unified <id> --json         # inspect saved item provenance
ft library show <path> --json         # read full markdown context
ft experts search "<topic>" --json    # find trusted people
ft ask "<question>" --json            # synthesize after retrieval
```

## Security and privacy guardrails

### Keep the web server local and read-only

Do not add sync/write endpoints until there is:

- a per-process CSRF token
- explicit localhost binding
- job IDs
- cancellation
- clear status reporting

### Remove external UI dependencies

The current app shell loads Google Fonts. For a private localhost data app, switch to system fonts only.

### Harden link preview before expanding use

`/api/link-preview` server-fetches a user-provided URL. Before exposing it beyond localhost or making it more prominent:

- restrict to `http` and `https`
- block localhost and private IP ranges after redirects
- keep no permissive CORS
- consider disabling link preview when serving on a non-localhost host

### Preserve source provenance

Never flatten away where an item came from. Users and agents need to know if an item came from:

- an X bookmark
- a Raindrop bookmark/highlight
- a GitHub star
- a YouTube note
- multiple sources

## Product guardrails

### Avoid noise in the Library

Do not canonicalize every X list tweet or followed account. Keep them as Today and Experts context.

### Avoid one misleading mega-ranking

`ft research --json` should return grouped results. A GitHub repo, an expert account, a list tweet, and a saved article are different objects with different confidence levels.

### Avoid frontend churn

Keep the current vanilla web UI until interaction complexity requires more. The priority is a stable unified read API and agent contract.

## What not to build yet

- new database
- vector database or embeddings
- React/Vite rewrite
- local chat UI
- browser-triggered sync button
- raw transcript/media indexing
- canonical ingestion of every X list tweet
- canonical ingestion of every followed account
- broad table rename from `canonical_bookmarks` to `unified_items`
- “promote list source to bookmark” write path

## Milestone checklist

### Milestone 1: Unified Library API and web lane

- [ ] Canonical rebuild runs after X index rebuild.
- [ ] X canonical rows include enriched article text where available.
- [ ] `/api/unified` returns canonical items.
- [ ] `/api/unified/:id` returns item detail and provenance.
- [ ] Web “Library” lane uses `/api/unified`.
- [ ] Tests pass: `tests/canonical-bookmarks-db.test.ts`, `tests/web-server.test.ts`.

### Milestone 2: YouTube note bridge

- [ ] YouTube canonical rows include note path.
- [ ] YouTube canonical rows include chapter labels/summaries.
- [ ] YouTube source metadata is available in details.
- [ ] Query matching chapter summary finds the video.

### Milestone 3: Agent research contract

- [ ] `ft research "<topic>" --json` exists.
- [ ] Research output groups canonical, library, today, and experts results.
- [ ] `ft ask` uses canonical hits for grounding.
- [ ] Skill content starts with `ft research`.

### Milestone 4: Daily freshness

- [ ] `ft sync-all --dry-run` reports preflight.
- [ ] `ft sync-all --skip youtube` runs available cheap sources.
- [ ] Canonical rebuild happens at end of sync-all.
- [ ] Logs show per-source result and failures.

### Milestone 5: Documentation

- [ ] README documents unified Library.
- [ ] README documents `ft research`.
- [ ] README documents `ft sync-all` once implemented.
- [ ] Agent contract is documented in generated skill content.

## Suggested first implementation slice

Start with the smallest useful vertical slice:

1. Extend canonical list/search helpers.
2. Add `/api/unified` and `/api/unified/:id`.
3. Change the web Bookmarks lane to Library.
4. Ensure `ft index` refreshes canonical.
5. Add tests and run `npm run build`.

This immediately gives a readable human view over X, Raindrop, GitHub stars, and YouTube canonical rows without touching sync orchestration, `ft ask`, or daily jobs.

After that, add `ft research --json` so agents have one stable entrypoint into the same unified view.
