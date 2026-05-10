# Browser Bookmarks Unified Index Design

## Summary

Add Safari, Chrome, and Vivaldi bookmark sync using a hybrid architecture: keep each provider's raw bookmark cache separate, then build a unified, deduped canonical index for search, list, show, and classification. The existing X/Twitter bookmark pipeline remains intact because its current data model is tweet-centric.

Also change sync media behavior so media fetching is opt-in: default sync should not fetch media unless the user asks for it.

This spec follows the repo documentation convention of storing specs in `docs/specs/` and plans in `docs/plans/`.

## Goals

- Sync browser bookmarks from Safari, Chrome, and Vivaldi into local Field Theory storage.
- Preserve raw source data separately per browser/profile.
- Build a unified canonical index that dedupes overlap between X bookmarks and browser bookmarks.
- Reuse existing search/classification concepts for the canonical index.
- Keep existing X-only flows stable: GraphQL sync, OAuth sync, gap fill, X folders, media fetching, and existing raw X cache.
- Make media fetching opt-in by default for sync commands.

## Non-goals for the first implementation

- Do not fetch webpage content for browser bookmarks.
- Do not perform network canonicalization with `rel=canonical` or redirects.
- Do not make `ft md`, `ft wiki`, `ft viz`, seeds, X folder sync, or media download fully unified in the first cut.
- Do not merge browser bookmarks into `BookmarkRecord` or the existing `bookmarks` SQL table.
- Do not support browser bookmark write-back or deletion from browsers.

## Current constraints

The existing bookmark model is X-shaped:

- `BookmarkRecord` requires `tweetId`.
- The SQLite `bookmarks` table requires `tweet_id TEXT NOT NULL`.
- Current downstream flows assume tweet fields such as author handle, posted time, quoted tweet, folder IDs, media, and engagement counts.

Because of this, browser bookmarks should not be inserted directly into the existing X raw cache or X table. The safe design is additive: preserve X storage and add a provider-neutral canonical layer.

## Architecture

```diagram
╭────────────────────╮       ╭──────────────────────╮
│ X bookmarks JSONL  │──────▶│ existing X bookmarks │
╰────────────────────╯       │ table / X flows      │
                             ╰──────────┬───────────╯
                                        │ normalized source rows
╭────────────────────╮                  ▼
│ Chrome bookmarks   │       ╭──────────────────────╮
│ Vivaldi bookmarks  │──────▶│ bookmark_sources     │
│ Safari bookmarks   │       │ provenance layer     │
╰────────────────────╯       ╰──────────┬───────────╯
                                        │ dedupe_key
                                        ▼
                             ╭──────────────────────╮
                             │ canonical_bookmarks  │
                             │ deduped search/class │
                             ╰──────────┬───────────╯
                                        ▼
                             ╭──────────────────────╮
                             │ canonical FTS        │
                             ╰──────────────────────╯
```

### Storage layout

Keep the existing X paths unchanged and add browser caches under `browsers/`:

```text
~/.fieldtheory/bookmarks/
  bookmarks.jsonl
  bookmarks.db
  bookmarks-meta.json
  bookmarks-backfill-state.json

  browsers/
    chrome/Default/bookmarks.jsonl
    chrome/Default/meta.json
    vivaldi/Default/bookmarks.jsonl
    vivaldi/Default/meta.json
    safari/default/bookmarks.jsonl
    safari/default/meta.json
```

Browser caches are snapshots of current browser state. A later sync may mark missing source rows inactive in the unified source table, but raw snapshot files can be rewritten to reflect the current browser bookmark tree.

### Browser raw record

Add a browser-specific type instead of extending `BookmarkRecord`:

```ts
export interface BrowserBookmarkRecord {
  id: string;
  browser: 'chrome' | 'vivaldi' | 'safari';
  profile: string;
  sourceItemId: string;
  url: string;
  title: string;
  folderPath: string[];
  dateAdded?: string | null;
  dateModified?: string | null;
  syncedAt: string;
}
```

`id` should be stable across syncs when the browser exposes a stable ID. For Chromium bookmarks, use browser/profile/node ID. For Safari, derive from URL plus folder path when no stable ID is available.

### Unified SQL tables

Add new tables to the existing `bookmarks.db`:

```sql
CREATE TABLE IF NOT EXISTS bookmark_sources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  profile TEXT,
  source_item_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT,
  dedupe_key TEXT NOT NULL,
  title TEXT,
  text TEXT,
  author_handle TEXT,
  saved_at TEXT,
  created_at TEXT,
  modified_at TEXT,
  folder_path_json TEXT,
  links_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  canonical_id TEXT
);

CREATE TABLE IF NOT EXISTS canonical_bookmarks (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT UNIQUE NOT NULL,
  canonical_url TEXT,
  display_title TEXT,
  search_text TEXT NOT NULL,
  categories TEXT,
  primary_category TEXT,
  domains TEXT,
  primary_domain TEXT,
  source_count INTEGER NOT NULL,
  first_saved_at TEXT,
  last_saved_at TEXT,
  sources_json TEXT
);
```

Create a canonical FTS table over `display_title` and `search_text`.

### Dedupe strategy

Use a conservative `dedupe_key`:

- Browser bookmark: `url:<normalized bookmark URL>`
- X bookmark with exactly one clear external link: `url:<normalized external link>`
- X bookmark with no clear external link or multiple ambiguous external links: `x:<tweetId>`

This handles the common overlap where a user bookmarked a tweet about a URL and also bookmarked the URL in a browser.

URL normalization rules for v1:

- Lowercase scheme and host.
- Remove default ports.
- Remove URL fragment.
- Remove known tracking query params: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`.
- Preserve all other query parameters.
- Do not perform network requests or redirect resolution.

### Classification

Refactor the regex classifier to accept a provider-neutral input:

```ts
export interface ClassifiableBookmarkInput {
  id: string;
  text?: string;
  title?: string;
  url?: string;
  links?: string[];
  folderPath?: string[];
}
```

For canonical bookmarks, build classification text from merged evidence:

- Browser title
- Browser folder path
- URL/domain
- X tweet text
- Enriched X article title/text, if present

Store classification on `canonical_bookmarks`, not on each source row, so a deduped item has one category/domain assignment.

### Browser extraction

#### Chrome and Vivaldi

Use Chromium bookmark files:

- Chrome macOS root: `~/Library/Application Support/Google/Chrome`
- Vivaldi macOS root: `~/Library/Application Support/Vivaldi`
- Per-profile bookmark file: `<profile>/Bookmarks`

Parse bookmark tree nodes with `type: "url"`; collect node ID, `name`, `url`, `date_added`, `date_modified`, and folder path.

Read browser bookmark files by copying them to a temporary file first, then parse the copy. This avoids partial reads while the browser is writing.

#### Safari

Safari is macOS-only for this feature. Use a dedicated extractor instead of shoehorning Safari into the existing cookie-oriented browser registry.

Initial implementation should support Safari bookmark plist parsing with platform-native tools available on macOS. If the plist cannot be parsed, fail with a helpful error that includes the expected Safari bookmarks path.

### CLI design

Add a browser-specific sync command first:

```bash
ft sync-browser --browser chrome
ft sync-browser --browser vivaldi
ft sync-browser --browser safari
ft sync-browser --all
ft sync-browser --all-profiles
```

After browser sync, rebuild the canonical index. Browser bookmark sync does not fetch media.

Also change current X sync media behavior:

- `ft sync` should skip media by default.
- Add `ft sync --media` to fetch media after sync.
- Keep `ft sync --no-media` accepted for compatibility, but make it redundant.
- Keep `ft fetch-media` as the explicit backfill command.

Update help text and README so users are not surprised by the default.

### Initial unified commands

Start with a narrow unified surface:

- `ft search --unified <query>` or make `ft search` read canonical rows when the canonical index exists.
- `ft list --unified`
- `ft show --unified <canonical-id>`
- `ft classify --unified --regex`

The safest first implementation is to add explicit `--unified` flags rather than silently changing existing command behavior. Once stable, unified search can become the default.

## Error handling

- Missing browser bookmark file: report browser/profile/path and continue for `--all`; fail for a single requested browser/profile.
- Invalid bookmark JSON/plist: report path and parser error.
- Unsupported platform for Safari: report that Safari bookmark sync is macOS-only.
- No browser bookmarks found: write an empty cache and report zero imported, not an error.
- Canonical rebuild failure: leave raw caches intact and exit nonzero.

## Testing strategy

- Unit-test URL normalization and dedupe key selection.
- Unit-test Chromium bookmark tree parsing with nested folders.
- Unit-test Safari parser with a small fixture or parser seam.
- Unit-test raw browser cache path generation.
- Unit-test canonical index build from mixed X/browser records.
- Unit-test canonical classification with browser-only and merged X/browser inputs.
- CLI smoke-test `sync-browser` with fixture paths or parser injection where practical.
- Regression-test that current `buildIndex()` and X search paths still pass.

## Rollout sequence

1. Add URL normalization and browser bookmark types/paths.
2. Add Chromium and Safari extractors.
3. Add raw browser sync command and caches.
4. Add canonical SQL schema and index builder.
5. Add canonical search/list/show helpers and CLI flags.
6. Refactor regex classification for provider-neutral input and add canonical classification.
7. Change `ft sync` media default to no media and add `--media`.
8. Update README and command help.

## Open decisions resolved

- Architecture: hybrid, not fully merged raw storage.
- Dedupe: conservative URL-based canonicalization with `x:<tweetId>` fallback.
- Browser sync media: no media fetching.
- Existing X sync media: no media fetching by default; explicit `--media` or `ft fetch-media` required.
