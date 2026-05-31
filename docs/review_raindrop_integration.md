# Raindrop Integration Review

Review of the implementation against [2026-05-31-raindrop-bookmarks-integration.md](file:///Users/manik/Github/fieldtheory-cli/docs/plans/2026-05-31-raindrop-bookmarks-integration.md).

---

## ✅ What's Solid

- **Core data flow works**: Raindrop API → JSONL cache → canonical DB pipeline is correctly wired.
- **Deduplication**: Raindrop URLs go through `dedupeKeyForUrl()` and correctly merge with X/YouTube sources.
- **Malformed URL resilience**: `raindropSourceFromRecord()` catches URL parse errors and returns `null`, filtered before insertion. Test coverage confirms this.
- **Atomic writes**: JSONL, meta, and state files use `writeFileDurable` (tmp → fsync → rename). Crash-safe.
- **Deprecation**: `sync-browser` prints a clear deprecation notice and exits 1. Tests verify this.
- **Browser bookmark code removal**: No references to `browser-bookmarks.ts`, `browserSourceFromRecord`, or `discoverBrowserSources` remain in `src/` or `tests/`.
- **Collection nesting**: `buildCollectionMap` correctly resolves nested parent chains with cycle guard (`parentId !== id`).
- **401 handling**: Non-retryable; throws immediately with a clear token error message.

---

## 🔴 Bugs & Gaps

### 1. `collectionName` extracts the wrong element from the path array

**File**: [sync.ts:65](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L65)

```typescript
collectionName: collectionId ? collectionMap.get(collectionId)?.[0] : undefined,
```

The collection map stores the full breadcrumb path (e.g., `["Dev", "Tools"]`). Index `[0]` gives the **root ancestor** ("Dev"), not the collection's own name ("Tools"). The plan says `collectionName` should be the collection's title.

**Fix**: Use the last element: `collectionMap.get(collectionId)?.at(-1)`.

---

### 2. Resume pagination is broken — always restarts from page 0

**File**: [sync.ts:169](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L169)

```typescript
let page = options.full ? 0 : (state.lastPageFetched ?? -1) + 1;
```

But on completion, `lastPageFetched` is set to **-1** (line 247: `lastPageFetched: -1`), meaning `(-1) + 1 = 0`. Every non-`--full` sync starts from page 0 — there is **no incremental/resume behavior**.

The plan specifies that `--continue` should resume from the last fetched page, and that state tracks progress mid-sync for recovery. Currently:
- State is only written **after** all pages complete (line 246–251).
- If the process crashes mid-pagination, no state is saved.
- After a successful sync, re-running without `--rebuild` re-fetches everything.

> [!IMPORTANT]
> **Fix**: Write state after each page. On completion, set a `completed: true` flag instead of `lastPageFetched: -1`. On resume, skip pages only if not completed.

---

### 3. `important: false` is silently dropped

**File**: [sync.ts:72](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L72)

```typescript
important: raw.important || undefined,
```

`false || undefined` evaluates to `undefined`. A bookmark explicitly marked as **not** important loses that signal. Should use `raw.important ?? undefined` or `raw.important === true ? true : undefined`.

---

### 4. `--collections` doesn't actually restrict to specific collections

**File**: [sync.ts:172–174](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L172-L174)

```typescript
const collectionIds = options.collections?.length
  ? options.collections
  : [0]; // 0 = "All" collection
```

When `--collections` is passed, the code fetches bookmarks from each specified collection **individually**. But collection `0` ("All") already contains every bookmark. If the user passes `--collections 12345`, the intent is to **only** sync that collection's bookmarks. However, the **existing cache** still contains everything from the previous global sync — those records are never removed. The merge just adds new ones on top.

The plan mentions: "When used, meta stores per-collection state instead of global state." This isn't implemented.

---

### 5. `sourceJson` field from plan is absent

The plan specifies `sourceJson?: string` on `RaindropRecord` for storing raw JSON for debugging. It's in the plan's type definition but **not** in the implementation's [types.ts](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/types.ts). This is fine — it's optional — but worth noting it was intentionally omitted or forgotten.

---

### 6. `--full` flag is partially broken

**File**: [sync.ts:169](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L169)

When `--full` is passed, `page` starts at 0 but the existing JSONL is **not cleared** (only `--rebuild` does that). So `--full` re-fetches and merges, which is correct per plan. But since `--continue` (default) also always starts from page 0 (bug #2), there's no functional difference between `--full` and a normal run.

---

### 7. `--index` flag from plan not implemented

The plan specifies `--index` (rebuild canonical index after sync, default: true). The implementation always rebuilds the canonical index after sync. This is actually fine — the flag was meant to allow skipping it, which is a low-priority optimization.

---

## 🟡 Edge Cases

### 8. No pagination guard against infinite loops

**File**: [sync.ts:184–210](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L184-L210)

The `while (hasMore)` loop terminates when `items.length < perPage`. If the API returns exactly `perPage` items on the last page (a perfectly full final page), the next request returns 0 items and terminates correctly. However, if the API ever returns `perPage` items of **identical content** (e.g., a bug or cache issue), this loop runs forever.

> [!TIP]
> Add a max-page safety limit (e.g., 10,000 pages = 500K bookmarks).

---

### 9. `buildCollectionMap` doesn't handle circular parent references

**File**: [sync.ts:115–123](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L115-L123)

The recursion guard `parentId !== id` prevents direct self-loops, but not **indirect cycles** (A → B → A). This would cause a stack overflow.

> [!TIP]
> Add a `visited` set to the recursive `resolvePath` function.

---

### 10. No progress indicator for large accounts

The plan calls this out in Open Question #2 (20K+ bookmarks = ~400 API calls = ~4 minutes). The implementation has no progress callback or spinner. The CLI just hangs silently.

---

### 11. Malformed bookmark items not logged

**File**: [sync.ts:193](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L193)

The plan says: "If a Raindrop item lacks `_id` or `link`, log warning and skip." The implementation doesn't validate these fields — it trusts the API response shape. A missing `_id` would produce `id: undefined`, and a missing `link` would produce `url: undefined`, both of which would create broken records in the JSONL.

---

### 12. `modified` count is over-counted

**File**: [sync.ts:201](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L201)

```typescript
if (merged.updatedAt !== existing.updatedAt || merged.syncedAt !== existing.syncedAt) {
  modifiedCount += 1;
}
```

`syncedAt` is always `new Date().toISOString()`, so it **always** differs from the existing record. Every re-synced bookmark counts as "modified", even if nothing changed. This makes the summary stats misleading.

---

### 13. `totalCount` from API response not used in meta

**File**: [sync.ts:232–242](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/sync.ts#L232-L242)

`RaindropMeta.totalCount` is defined in [types.ts:74](file:///Users/manik/Github/fieldtheory-cli/src/raindrop/types.ts#L74) but never populated. The API response includes `count` which could feed this.

---

## 🔐 Security

### 14. Token is re-read on every request (good)

`getToken()` reads `process.env.RAINDROP_TOKEN` on every call to `fetchWithRetry`. This means the token is never persisted to disk by this code. ✅

### 15. Token appears in error stack traces

When a 401 error is thrown, the error message includes `RAINDROP_TOKEN` in the text (`"error.message.includes('RAINDROP_TOKEN')"`). This is fine for local CLI usage but could leak in CI/server logs. Low severity.

### 16. No token validation before making API calls

The CLI doesn't check token format/length before hitting the API. A misconfigured token (e.g., set to an empty string that passes the truthy check, or a partial paste) will produce a confusing 401 error rather than a clear validation message. The current check `if (!token)` only catches `undefined`/`null`/`""`.

### 17. File permissions are correct

JSONL, meta, and state files are written with mode `0o600` via `writeFileDurable` → `writeJson`/`writeJsonLines`. ✅

---

## 🧪 Testing Gaps

### 18. No unit tests for `src/raindrop/` module

The plan specifies:
- `tests/raindrop/client.test.ts` — mock API, pagination, error handling
- `tests/raindrop/sync.test.ts` — normalize, merge, JSONL read/write
- `tests/raindrop/dedupe.test.ts` — deduplication behavior

**None of these exist.** There are no tests for:
- `normalizeRaindropBookmark` — the core normalization function
- `mergeRaindropRecord` — tag/highlight merging
- `buildCollectionMap` — nested collection resolution
- `fetchWithRetry` — retry/backoff logic
- `syncRaindropBookmarks` — the orchestrator function

The canonical-bookmarks-db tests cover the DB integration end well, but the Raindrop module itself is untested.

### 19. No test fixtures

The plan specifies `tests/fixtures/raindrop/` with sample API responses. These don't exist.

### 20. No integration test for `--dry-run`

The plan specifies `tests/cli-sync-raindrop.test.ts` for running `--dry-run` against a mock server. Not implemented.

---

## 🔧 Plan vs. Implementation Deviations

### 21. Markdown export not enhanced (Phase 4)

The plan calls for Raindrop-specific frontmatter (`raindrop_id`, `collection`, `tags`, `starred`, `highlights_count`) and body sections (excerpt blockquote, "## Note", "## Highlights"). [md-export.ts](file:///Users/manik/Github/fieldtheory-cli/src/md-export.ts) has no Raindrop-specific code.

> [!NOTE]
> This may be intentionally deferred to Phase 4, which isn't part of this PR.

### 22. Classification not enhanced for Raindrop signals

The plan suggests:
- If `important === true`, tag with `starred`
- If `type === 'video'`, ensure video domain classification
- If `tags` contains known tech terms, use as regex input

[bookmark-classify.ts](file:///Users/manik/Github/fieldtheory-cli/src/bookmark-classify.ts) has no Raindrop awareness. The `search_text` enrichment with excerpts/notes/highlights provides **some** signal, but tags and `important` are completely ignored.

### 23. `--unified` flag text still says "browser"

**File**: [cli.ts:1336](file:///Users/manik/Github/fieldtheory-cli/src/cli.ts#L1336), [cli.ts:1381](file:///Users/manik/Github/fieldtheory-cli/src/cli.ts#L1381), [cli.ts:1452](file:///Users/manik/Github/fieldtheory-cli/src/cli.ts#L1452)

The `--unified` option descriptions still read `'Search unified X and browser bookmarks'`. Should say `'Search unified X, Raindrop, and YouTube bookmarks'` or just `'Search unified bookmarks'`.

### 24. `raindropBookmarksCachePath()` in plan vs. implementation

The plan says: `~/.fieldtheory/bookmarks/raindrop-bookmarks.jsonl`
Implementation uses: `~/.fieldtheory/bookmarks/raindrop/bookmarks.jsonl`

The implementation's subdirectory approach is actually **better** (isolates meta/state files), but this is a deviation from the plan.

---

## Summary Table

| # | Severity | Category | Issue |
|---|----------|----------|-------|
| 1 | 🔴 Bug | Logic | `collectionName` extracts root ancestor, not leaf name |
| 2 | 🔴 Bug | Pagination | Resume/incremental sync is broken — always starts page 0 |
| 3 | 🟡 Minor | Logic | `important: false` silently dropped |
| 4 | 🟡 Gap | Feature | `--collections` doesn't scope the cache properly |
| 5 | ⚪ Note | Plan | `sourceJson` debug field omitted |
| 6 | 🟡 Gap | Feature | `--full` has no effect (same as default due to bug #2) |
| 7 | ⚪ Note | Plan | `--index` flag not implemented (acceptable) |
| 8 | 🟡 Edge | Safety | No max-page guard against infinite pagination |
| 9 | 🟡 Edge | Safety | Circular parent collections → stack overflow |
| 10 | 🟡 UX | Missing | No progress indicator during sync |
| 11 | 🟡 Edge | Validation | Missing `_id`/`link` not caught |
| 12 | 🟡 Bug | Stats | Modified count always matches total (syncedAt always differs) |
| 13 | ⚪ Note | Cleanup | `totalCount` field never populated |
| 14 | ✅ Good | Security | Token not persisted to disk |
| 15 | ⚪ Low | Security | Token name in error messages (CI log risk) |
| 16 | ⚪ Low | Security | No token format validation |
| 17 | ✅ Good | Security | File permissions 0o600 |
| 18 | 🔴 Gap | Testing | No unit tests for `src/raindrop/` module |
| 19 | 🟡 Gap | Testing | No test fixtures |
| 20 | 🟡 Gap | Testing | No CLI integration test for `--dry-run` |
| 21 | ⚪ Note | Plan | MD export not enhanced (Phase 4) |
| 22 | ⚪ Note | Plan | Classification not enhanced for Raindrop signals |
| 23 | 🟡 Polish | UX | `--unified` help text still says "browser" |
| 24 | ⚪ Note | Plan | Cache path deviates from plan (improvement) |
