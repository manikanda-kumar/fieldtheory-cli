# Raindrop.io Bookmarks Integration Plan

## Context & Positioning

Field Theory CLI currently supports three bookmark sources:

| Source | Sync Command | Storage |
|--------|-------------|---------|
| X/Twitter bookmarks | `ft sync` | `twitter-bookmarks.jsonl` → SQLite `bookmarks` + canonical |
| YouTube playlists | `ft sync-youtube` | `youtube/` artifact dirs + canonical |
| Browser bookmarks | `ft sync-browser` | `browsers/<browser>/<profile>/bookmarks.jsonl` → canonical |

The existing `ft sync-browser` command is limited: it only reads local Chromium `Bookmarks` files (Chrome/Vivaldi), requires manually passing `--bookmarks-file`, does not support Safari, and captures only URL + title + folder path — no tags, highlights, notes, or collection metadata.

This plan **replaces** the local file-based browser sync with **Raindrop.io** as the browser bookmark source. Raindrop provides a richer data model (collections, tags, highlights, notes, excerpts) and syncs automatically from the cloud using an API token. The `ft sync-browser` command will be deprecated/removed in favor of `ft sync-raindrop`.

After this change, the three sources become:

| Source | Sync Command |
|--------|-------------|
| X/Twitter bookmarks | `ft sync` |
| YouTube playlists | `ft sync-youtube` |
| Browser bookmarks (via Raindrop) | `ft sync-raindrop` |

## Goals

1. Replace local file-based browser bookmark sync (`sync-browser`) with Raindrop.io API sync (`sync-raindrop`).
2. Flow Raindrop bookmarks through a JSONL cache, then into the canonical `bookmark_sources` table, reusing existing deduplication, classification, markdown export, and wiki pipelines.
3. Deprecate and eventually remove the Chromium bookmark file parser and `sync-browser` CLI surface.
4. Enrich the canonical index with Raindrop-specific metadata: collections (as folder paths), tags, highlights, notes, and excerpts.

---

## Raindrop API Primer

- **Base URL:** `https://api.raindrop.io/rest/v1/`
- **Auth:** `Authorization: Bearer <RAINDROP_TOKEN>` header (token already in env)
- **Key endpoints:**
  - `GET /collections` — list all collections (folders)
  - `GET /raindrops/0` — all bookmarks (collection `0` is the global "All" collection)
  - `GET /raindrops/:collectionId` — bookmarks in a specific collection
  - Pagination via `?page=<n>` (0-indexed, default ~25 per page; use `?perpage=50` to reduce round trips)
- **Rate limits:** 120 requests/minute for authenticated users (generous; no complex backoff needed beyond standard retry)
- **Bookmark object fields we care about:**
  - `_id` (number) — Raindrop bookmark ID
  - `link` (string) — canonical URL
  - `title` (string)
  - `excerpt` (string) — Raindrop's auto-excerpt or user summary
  - `note` (string) — user notes
  - `highlights` (array) — each has `text`, `color`, `note`
  - `tags` (string[])
  - `collection` (object or `$id`) — collection reference
  - `created` (ISO 8601)
  - `lastUpdate` (ISO 8601)
  - `type` — "link" | "article" | "image" | "video" | etc.
  - `cover` (string) — thumbnail URL
  - `media` (array) — extracted media items
  - `domain` (string)
  - `important` (boolean) — starred/favorited
  - `cache` (object) — Raindrop's cached copy status

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/raindrop/types.ts` | TypeScript interfaces for Raindrop API responses and internal normalized records |
| `src/raindrop/client.ts` | API client: fetch collections, paginated bookmarks, error handling |
| `src/raindrop/sync.ts` | JSONL cache read/write, merge/dedup logic, canonical DB bridge |
| `src/raindrop/paths.ts` | Path resolution for Raindrop data files (JSONL, meta, state) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/cli.ts` | Add `sync-raindrop` command; deprecate `sync-browser` (print deprecation notice directing to Raindrop) |
| `src/canonical-bookmarks-db.ts` | Add `raindropSourceFromRecord()`; read Raindrop JSONL in `rebuildCanonicalIndex()`; **remove** browser source discovery/reading logic |
| `src/bookmark-classify.ts` | Optionally extend regex patterns to recognize Raindrop-specific signals (excerpts, tags) |
| `src/paths.ts` | Add `raindropBookmarksJsonlPath()`, `raindropMetaPath()`, `raindropStatePath()`; **remove** `browserBookmarksCachePath()`, `browserBookmarksMetaPath()` |

## Files to Remove / Deprecate

| File | Action | Rationale |
|------|--------|-----------|
| `src/browser-bookmarks.ts` | **Remove** after Raindrop is working | Chromium bookmark parser is no longer needed |
| `tests/browser-bookmarks.test.ts` | **Remove** | Tests for removed code |
| `~/.fieldtheory/browsers/` cache dirs | **Ignore / clean up** | Old browser JSONL caches become orphaned; clean up on `--rebuild` or leave as-is |

---

## Data Models

### Raindrop API Types (`src/raindrop/types.ts`)

```typescript
export interface RaindropCollection {
  _id: number;
  title: string;
  parent?: { $id: number } | null;
  access?: { for: number; level: number };
}

export interface RaindropHighlight {
  _id: string;
  text: string;
  color?: string;
  note?: string;
  created?: string;
}

export interface RaindropBookmark {
  _id: number;
  link: string;
  title: string;
  excerpt?: string;
  note?: string;
  highlights?: RaindropHighlight[];
  tags?: string[];
  collection?: RaindropCollection | { $id: number };
  created: string;
  lastUpdate?: string;
  type?: string;
  cover?: string;
  media?: Array<{ type: string; link: string }>;
  domain?: string;
  important?: boolean;
}

export interface RaindropApiResponse {
  result: boolean;
  count?: number;
  items: RaindropBookmark[];
}

export interface RaindropCollectionsResponse {
  result: boolean;
  items: RaindropCollection[];
}
```

### Internal JSONL Record (`src/raindrop/types.ts`)

```typescript
export interface RaindropRecord {
  id: number;                    // Raindrop _id
  url: string;
  title: string;
  excerpt?: string;
  note?: string;
  highlights?: RaindropHighlight[];
  tags?: string[];
  collectionId?: number;
  collectionName?: string;
  collectionPath?: string[];     // resolved breadcrumb
  createdAt: string;
  updatedAt?: string;
  type?: string;
  cover?: string;
  domain?: string;
  important?: boolean;
  mediaCount?: number;
  links?: string[];              // media links + domain references
  syncedAt: string;              // when we fetched it
  sourceJson?: string;           // optional: raw bookmark JSON for debug
}
```

---

## JSONL Cache Design

### File Locations

- `~/.fieldtheory/bookmarks/raindrop-bookmarks.jsonl` — one line per `RaindropRecord`
- `~/.fieldtheory/bookmarks/raindrop-bookmarks-meta.json` — sync metadata
- `~/.fieldtheory/bookmarks/raindrop-backfill-state.json` — resumable pagination state

### Meta Schema

```typescript
interface RaindropMeta {
  lastSyncedAt?: string;         // ISO timestamp
  totalCount?: number;           // total bookmarks in Raindrop account
  syncedCount?: number;          // rows in JSONL after last sync
  collectionsSyncedAt?: string;
  collectionMap?: Record<number, { title: string; path?: string[] }>;
}
```

### State Schema (for resume)

```typescript
interface RaindropBackfillState {
  lastPageFetched?: number;      // 0-indexed, -1 means done
  perPage?: number;
  completedAt?: string;
}
```

### Merge Strategy (`mergeRecords` in `src/raindrop/sync.ts`)

Identical in spirit to `src/graphql-bookmarks.ts` `mergeRecords()`:

1. Build `Map<number, RaindropRecord>` keyed by `id`.
2. For duplicates, call `mergeRaindropRecord(existing, incoming)`:
   - Keep the record with the later `updatedAt` (or `createdAt` if no `updatedAt`).
   - Merge arrays uniquely: `tags`, `highlights`.
   - Preserve `collectionPath` from either (prefer non-empty).
   - Preserve `note` and `excerpt` if the newer record has empty values but the old one does not.
   - Keep the older `syncedAt` if nothing materially changed? Or always set to `new Date().toISOString()`. Decision: always update `syncedAt` on fetch.
3. Sort by `createdAt` descending.
4. Atomically write JSONL via `writeFileAtomic` (same pattern as Twitter).

---

## Sync Flow (`syncRaindropBookmarks`)

```
1. Load existing JSONL cache → Map<id, RaindropRecord>
2. Fetch /collections → build collectionId → breadcrumb path map
3. Fetch /raindrops/0?page=N per page until exhausted
   a. Normalize each RaindropBookmark → RaindropRecord
   b. Enrich collectionName / collectionPath from map
   c. Merge into Map
4. Write merged JSONL cache
5. Write meta + backfill state
6. (Optional) Upsert into canonical DB immediately
```

### Normalization (`normalizeRaindropBookmark`)

```typescript
function normalizeRaindropBookmark(
  raw: RaindropBookmark,
  collectionMap: Map<number, string[]>
): RaindropRecord {
  const collectionId = typeof raw.collection === 'object'
    ? raw.collection?.$id ?? raw.collection?._id
    : undefined;

  const links: string[] = [];
  if (raw.domain) links.push(`https://${raw.domain}`);
  if (raw.media?.length) {
    for (const m of raw.media) if (m.link) links.push(m.link);
  }

  return {
    id: raw._id,
    url: raw.link,
    title: raw.title,
    excerpt: raw.excerpt || undefined,
    note: raw.note || undefined,
    highlights: raw.highlights?.length ? raw.highlights : undefined,
    tags: raw.tags?.length ? raw.tags : undefined,
    collectionId: collectionId ?? undefined,
    collectionName: collectionId ? collectionMap.get(collectionId)?.[0] : undefined,
    collectionPath: collectionId ? collectionMap.get(collectionId) : undefined,
    createdAt: raw.created,
    updatedAt: raw.lastUpdate || raw.created,
    type: raw.type || undefined,
    cover: raw.cover || undefined,
    domain: raw.domain || undefined,
    important: raw.important || undefined,
    mediaCount: raw.media?.length || 0,
    links: [...new Set(links)],
    syncedAt: new Date().toISOString(),
  };
}
```

---

## Canonical DB Integration

Raindrop replaces browser bookmarks in the canonical index. `rebuildCanonicalIndex()` reads the Raindrop JSONL cache and produces `CanonicalSourceInput` rows alongside X and YouTube sources. The old browser source discovery and JSONL reading loops are removed.

### New Function: `raindropSourceFromRecord` (`src/canonical-bookmarks-db.ts`)

```typescript
export function raindropSourceFromRecord(
  record: RaindropRecord
): CanonicalSourceInput {
  const folderPaths = record.collectionPath?.length
    ? [record.collectionPath.join(' / ')]
    : record.collectionName
      ? [record.collectionName]
      : [];

  // Combine excerpt + note + highlights text for search_text enrichment
  const textParts: string[] = [];
  if (record.excerpt) textParts.push(record.excerpt);
  if (record.note) textParts.push(record.note);
  if (record.highlights?.length) {
    for (const h of record.highlights) {
      textParts.push(h.text);
      if (h.note) textParts.push(h.note);
    }
  }

  return {
    id: `raindrop:${record.id}`,
    source: 'raindrop',
    profile: undefined,
    sourceItemId: String(record.id),
    sourceUrl: record.url,
    targetUrl: undefined,
    dedupeKey: dedupeKeyForUrl(record.url),
    title: record.title,
    text: textParts.join('\n\n') || undefined,
    authorHandle: record.domain || undefined,
    savedAt: record.createdAt,
    createdAt: record.createdAt,
    modifiedAt: record.updatedAt,
    folderPath: folderPaths,
    links: record.links ?? [],
    active: true,
  };
}
```

### Update `rebuildCanonicalIndex()`

1. **Remove** `discoverBrowserSources()` and the `browserSources` loop from `rebuildCanonicalIndex()`.
2. **Remove** `RebuildCanonicalOptions.browserSources` from the interface.
3. After reading X records and YouTube DB sources, add Raindrop JSONL reading:

```typescript
const sourceRows: CanonicalSourceInput[] = [];

// X/Twitter sources
const xRecords = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
sourceRows.push(...xRecords.map(xSourceFromRecord));

// Raindrop sources (replaces browser bookmarks)
const raindropCachePath = raindropBookmarksCachePath();
if (await pathExists(raindropCachePath)) {
  const raindropRecords = await readJsonLines<RaindropRecord>(raindropCachePath);
  sourceRows.push(...raindropRecords.map(raindropSourceFromRecord));
}

// YouTube sources (already in DB)
sourceRows.push(...readYoutubeSourcesFromDb(db));
```

### Deduplication

Raindrop URLs are normalized via `dedupeKeyForUrl()` in `src/url-normalize.ts`, which:
- Strips protocol (`http://` → `https://` normalization already happens)
- Removes tracking params (`utm_*`, `fbclid`, etc.)
- Computes SHA-256 of normalized URL string

This means a Raindrop bookmark to a YouTube video will merge with the YouTube source for that video under one `canonical_bookmarks` row. Same for X links saved in Raindrop.

---

## CLI Design

### New Command: `sync-raindrop`

```
ft sync-raindrop [options]

Options:
  --rebuild          Clear JSONL cache and refetch everything
  --full             Fetch all pages even if state says complete
  --continue         Resume from last fetched page (default behavior)
  --collections      Sync only specified collection IDs (comma-separated)
  --classify         Run regex classification after sync
  --index            Rebuild canonical index after sync (default: true)
  --dry-run          Fetch and show counts without writing JSONL
  --perpage <n>      Items per API page (default: 50, max: 50)
```

### Behavior

- **Default:** resume from `raindrop-backfill-state.json`, fetch new/modified bookmarks, merge into JSONL, then call `rebuildCanonicalIndex()` so Raindrop rows are included alongside X/YouTube sources.
- **`--rebuild`:** delete JSONL + meta + state, start from page 0.
- **`--collections`:** restrict fetch to specific collection IDs. When used, meta stores per-collection state instead of global state.
- **`--dry-run`:** paginate through API, log stats, exit before writing any files.
- After successful sync, print summary:
  ```
  Raindrop sync complete:
    Total bookmarks: 1,247
    New this sync:   12
    Modified:        3
    Collections:     8
    Canonical rows:  1,198 (49 deduplicated with other sources)
  ```

### Deprecation of `sync-browser`

`ft sync-browser` is deprecated and will be removed. When invoked, it should print:

```
Browser bookmark file sync is deprecated.
Use "ft sync-raindrop" to sync browser bookmarks from Raindrop.io.
```

Then exit with code 1. The `--browser`, `--profile`, and `--bookmarks-file` options are no longer advertised in help.

### Integration with existing commands

No changes needed for:
- `ft search` / `ft list` — already queries `canonical_bookmarks_fts`
- `ft classify` — already classifies `canonical_bookmarks`
- `ft md` — `exportBookmarks()` iterates `canonical_bookmarks`; may need small enhancement to handle `source = 'raindrop'` in frontmatter
- `ft wiki` — `compileMd()` groups by category/domain/entity; Raindrop items participate automatically
- `ft viz` — `renderViz()` consumes canonical DB counts

### Optional: `ft sync` umbrella enhancement

Consider adding `--raindrop` flag to `ft sync` that runs `syncBookmarksGraphQL()` then `syncRaindropBookmarks()` in sequence. **Deferred to Phase 5** to avoid scope creep.

---

## Classification Integration

### Regex Classifier (`src/bookmark-classify.ts`)

`classifyCanonicalBookmarks()` already iterates all canonical rows. We should verify that Raindrop-derived `search_text` (title + excerpt + note + highlights) contains enough signal for existing patterns.

**Possible additions:**
- If `record.important === true`, tag with `starred` (could be a pseudo-category or just metadata).
- If `record.type === 'video'`, ensure it gets `video` domain classification.
- If `record.tags` contains known tech terms, treat them as additional text input for regex matching.

No structural changes needed; just enrich `search_text` passed to `classifyBookmarkInput()`.

### LLM Classifier (`src/bookmark-classify-llm.ts`)

Works automatically on `canonical_bookmarks` where `primary_category = 'unclassified'`. No changes.

---

## Markdown Export Integration

### Per-Bookmark Export (`src/md-export.ts`)

Current `exportBookmarks()` generates one `.md` per bookmark from the `bookmarks` table (X-focused). For the canonical path, we need to verify it also handles `canonical_bookmarks` rows where `source = 'raindrop'`.

**Enhancement needed in `renderCanonicalBookmarkMd()` or equivalent:**

Frontmatter additions for Raindrop:
```yaml
---
source: raindrop
raindrop_id: 12345
collection: "Dev / Tools"
tags: ["rust", "cli"]
starred: true
highlights_count: 3
---
```

Body additions:
- If `excerpt` exists, render as a blockquote after the title.
- If `note` exists, render under a "## Note" section.
- If `highlights` exist, render under a "## Highlights" section with color badges.
- Links section includes extracted media/links.

### Wiki Compilation (`src/md.ts`)

No changes. Raindrop items feed into category/domain/entity counts. Collections with ≥5 bookmarks may spawn category pages. Domains with ≥5 bookmarks spawn domain pages.

---

## Error Handling & Resilience

1. **API failures:** Standard retry with exponential backoff (reuse `retryOnRateLimit` pattern from YouTube if generic enough, or write a small `fetchWithRetry` in `src/raindrop/client.ts`).
2. **Token invalid:** Raindrop returns `401` with `result: false`. Print clear error: "RAINDROP_TOKEN invalid or expired. Check your environment variable."
3. **Partial sync:** If page N fails after pages 0..N-1 succeeded, state is saved at N-1. Next `--continue` resumes cleanly.
4. **Empty collections:** Skip gracefully, log at debug level.
5. **Malformed bookmarks:** If a Raindrop item lacks `_id` or `link`, log warning and skip.

---

## Testing Strategy

### Unit Tests

- `tests/raindrop/client.test.ts` — mock Raindrop API, verify pagination, collection fetching, error handling.
- `tests/raindrop/sync.test.ts` — test `normalizeRaindropBookmark`, `mergeRecords`, JSONL read/write.
- `tests/raindrop/dedupe.test.ts` — verify `dedupeKeyForUrl` behavior on Raindrop URLs.
- `tests/canonical-bookmarks-db.test.ts` — verify Raindrop rows are read into `rebuildCanonicalIndex()` and old browser rows are no longer read.

### Integration Tests

- `tests/cli-sync-raindrop.test.ts` — run `ft sync-raindrop --dry-run` against a mock server, verify CLI output.
- `tests/cli-sync-browser-deprecated.test.ts` — verify `ft sync-browser` prints deprecation notice and exits 1.
- Test that `sync-raindrop` followed by `ft search` finds new items.

### Fixtures

Create `tests/fixtures/raindrop/` with:
- `collections.json` — sample /collections response
- `raindrops-page0.json` — sample /raindrops/0 page
- `raindrops-page1.json` — second page
- `bookmark-with-highlights.json` — full bookmark with highlights array

---

## Implementation Phases

### Phase 1: Core Fetch + Cache (MVP)

1. Create `src/raindrop/types.ts` with all interfaces.
2. Create `src/raindrop/client.ts` with `fetchCollections()` and `fetchAllRaindrops()`.
3. Create `src/raindrop/paths.ts` with path helpers.
4. Create `src/raindrop/sync.ts` with `normalizeRaindropBookmark`, `mergeRecords`, and `syncRaindropBookmarks()`.
5. Wire `sync-raindrop` command in `src/cli.ts` with basic `--rebuild`, `--continue`, `--dry-run`.
6. Add unit tests for client and sync logic.

**Acceptance:** `ft sync-raindrop --dry-run` successfully paginates API and reports counts. `ft sync-raindrop` writes JSONL cache.

### Phase 2: Canonical Integration

1. Add `raindropSourceFromRecord()` to `src/canonical-bookmarks-db.ts`.
2. **Remove** browser source discovery and reading from `rebuildCanonicalIndex()`:
   - Delete `discoverBrowserSources()`
   - Delete `browserSourceFromRecord()`
   - Remove `browserSources` from `RebuildCanonicalOptions`
   - Remove browser JSONL reading loop
3. Update `rebuildCanonicalIndex()` to read Raindrop JSONL cache (if present) and append rows to `sourceRows`.
4. Update `sync-raindrop` action to call `rebuildCanonicalIndex()` after JSONL write.
5. Add `--classify` flag to `sync-raindrop` that triggers `classifyCanonicalBookmarks()`.
6. Test deduplication: verify a Raindrop URL that also exists as an X bookmark or YouTube video merges into one canonical row.

**Acceptance:** After sync, `ft search <raindrop title>` returns results. `ft list --source raindrop` works. No `chrome`/`vivaldi` sources appear in canonical DB.

### Phase 4: Markdown & Wiki Enhancements

1. Enhance canonical markdown export to render Raindrop-specific frontmatter and body sections (excerpt blockquote, "## Note", "## Highlights" with color badges).
2. Verify `ft md` produces files for Raindrop bookmarks.
3. Verify `ft wiki` includes Raindrop-derived categories and domains.
4. Test starred/highlights rendering.

**Acceptance:** `~/.fieldtheory/library/bookmarks/` contains `.md` files for Raindrop bookmarks with highlights sections.

### Phase 5: Cleanup & Deprecation

1. **Deprecate `sync-browser`:** Update CLI so `ft sync-browser` prints deprecation notice and exits 1. Remove from help text and alias commands.
2. **Remove `src/browser-bookmarks.ts`:** Delete Chromium parser, `syncBrowserBookmarks()`, and all related types.
3. **Remove browser path helpers:** Delete `browserBookmarksCachePath()` and `browserBookmarksMetaPath()` from `src/paths.ts`.
4. **Remove `tests/browser-bookmarks.test.ts`:** Delete tests for removed code.
5. **Clean up canonical DB helpers:** Delete `browserSourceFromRecord()`, `discoverBrowserSources()`, and `mergeBrowserSources()` from `src/canonical-bookmarks-db.ts`.
6. Verify `npm run test` passes with no references to removed code.

**Acceptance:** `grep -r 'sync-browser\|browser-bookmarks\|BrowserBookmark' src/ tests/` returns zero matches (except in `docs/` history).

---

## Open Questions / Risks

1. **Raindrop API field stability:** The `highlights` array structure has changed subtly across Raindrop versions. We should handle missing fields gracefully.
2. **Large accounts:** 20k+ bookmarks. At 50/page, that's 400 API calls. With 120 req/min rate limit, this takes ~4 minutes. Acceptable, but we should show a progress indicator.
3. **Duplicate detection vs. Raindrop's own duplicates:** Raindrop allows duplicate bookmarks. Our merge by `id` dedupes within Raindrop, but if a user has two Raindrop bookmarks to the same URL with different IDs, they will create two `bookmark_sources` rows with the same `dedupeKey`. This is correct: canonical index will roll them up into one row with `source_count = 2`.
4. **Collection nesting:** Raindrop supports nested collections (folders within folders). We should resolve full breadcrumb paths. The API returns `parent: { $id: N }`. We need to build paths recursively.
5. **Tag explosion:** Users with hundreds of unique tags could bloat categories. The regex classifier may struggle. This is fine: unclassified items get LLM-classified later.
6. **Privacy:** Raindrop bookmarks may contain private URLs. The JSONL cache and markdown library are local-only, consistent with the existing threat model. No changes needed.

---

## Appendix: Raindrop API Sample Response

```json
{
  "result": true,
  "count": 1247,
  "items": [
    {
      "_id": 987654321,
      "link": "https://github.com/some/repo",
      "title": "some/repo: A useful tool",
      "excerpt": "A description extracted by Raindrop",
      "note": "Check this before the migration",
      "highlights": [
        {
          "_id": "abc123",
          "text": "Important paragraph",
          "color": "yellow",
          "note": "Remember this"
        }
      ],
      "tags": ["rust", "tools"],
      "collection": { "$id": 12345 },
      "created": "2025-01-15T10:30:00.000Z",
      "lastUpdate": "2025-01-20T14:00:00.000Z",
      "type": "article",
      "cover": "https://opengraph.githubassets.com/...",
      "domain": "github.com",
      "important": true
    }
  ]
}
```

---

*Plan created: 2026-05-31*
*Status: Ready for implementation*
