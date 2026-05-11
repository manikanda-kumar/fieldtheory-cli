# Browser Bookmarks Unified Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Safari, Chrome, and Vivaldi bookmark sync with separate raw caches and a unified deduped search/classification index, while making sync media fetching opt-in by default.

**Architecture:** Keep the existing X bookmark cache and `bookmarks` table intact. Add browser-specific raw JSONL caches, additive canonical SQLite tables, conservative URL-based dedupe, and explicit unified CLI surfaces before making unified search the default.

**Tech Stack:** TypeScript, Commander.js, Node.js filesystem APIs, `sql.js`/FTS5, Node test runner via `tsx --test`.

---

## File structure

- Create `src/url-normalize.ts`: URL normalization, tracking-param stripping, dedupe key helpers.
- Create `src/browser-bookmarks.ts`: browser bookmark types, Chromium/Safari parsing, profile discovery, raw sync orchestration.
- Modify `src/browsers.ts`: add Vivaldi browser definition, if needed by shared browser lookup.
- Modify `src/paths.ts`: browser cache path helpers.
- Create `src/canonical-bookmarks-db.ts`: canonical schema, source-row rebuild, FTS search/list/show, canonical classification update.
- Modify `src/bookmark-classify.ts`: add provider-neutral classifier input while preserving `classifyBookmark()` compatibility.
- Modify `src/cli.ts`: add `sync-browser`; add unified search/list/show/classify flags; change `ft sync` media default to opt-in.
- Modify `README.md`: document browser bookmark sync, unified search, and opt-in media behavior.
- Add tests in `tests/url-normalize.test.ts`, `tests/browser-bookmarks.test.ts`, `tests/canonical-bookmarks-db.test.ts`, and update relevant CLI/status tests if needed.

---

### Task 1: URL normalization and dedupe keys

**Files:**
- Create: `src/url-normalize.ts`
- Test: `tests/url-normalize.test.ts`

- [x] **Step 1: Write failing URL normalization tests**

Create `tests/url-normalize.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookmarkUrl, dedupeKeyForUrl, dedupeKeyForXBookmark } from '../src/url-normalize.js';

test('normalizeBookmarkUrl lowercases scheme and host, removes fragments and default ports', () => {
  assert.equal(
    normalizeBookmarkUrl('HTTPS://Example.COM:443/Path?q=1#section'),
    'https://example.com/Path?q=1'
  );
});

test('normalizeBookmarkUrl strips tracking params but preserves meaningful params', () => {
  assert.equal(
    normalizeBookmarkUrl('https://example.com/a?utm_source=x&gclid=abc&id=42&fbclid=z'),
    'https://example.com/a?id=42'
  );
});

test('dedupeKeyForUrl prefixes normalized URLs', () => {
  assert.equal(
    dedupeKeyForUrl('https://Example.com/a?utm_campaign=nope&id=1'),
    'url:https://example.com/a?id=1'
  );
});

test('dedupeKeyForXBookmark uses one external link when unambiguous', () => {
  assert.equal(
    dedupeKeyForXBookmark({ tweetId: '123', links: ['https://github.com/acme/tool'] }),
    'url:https://github.com/acme/tool'
  );
});

test('dedupeKeyForXBookmark falls back to tweet id when links are ambiguous', () => {
  assert.equal(
    dedupeKeyForXBookmark({ tweetId: '123', links: ['https://a.test', 'https://b.test'] }),
    'x:123'
  );
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- tests/url-normalize.test.ts
```

Expected: FAIL because `src/url-normalize.ts` does not exist.

- [x] **Step 3: Implement URL normalization**

Create `src/url-normalize.ts`:

```ts
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

export function normalizeBookmarkUrl(input: string): string {
  const url = new URL(input);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.append(key, value);
  }
  kept.sort();
  url.search = kept.toString();
  return url.toString();
}

export function dedupeKeyForUrl(url: string): string {
  return `url:${normalizeBookmarkUrl(url)}`;
}

export function dedupeKeyForXBookmark(input: { tweetId: string; links?: string[] | null }): string {
  const links = [...new Set(input.links ?? [])].filter((link) => {
    try {
      const parsed = new URL(link);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      return host !== 'x.com' && host !== 'twitter.com' && host !== 't.co';
    } catch {
      return false;
    }
  });
  return links.length === 1 ? dedupeKeyForUrl(links[0]) : `x:${input.tweetId}`;
}
```

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- tests/url-normalize.test.ts
```

Expected: PASS for all URL normalization tests.

- [x] **Step 5: Commit**

```bash
git add src/url-normalize.ts tests/url-normalize.test.ts
git commit -m "feat: add bookmark URL dedupe keys"
```

---

### Task 2: Browser bookmark paths and Vivaldi registry

**Files:**
- Modify: `src/paths.ts`
- Modify: `src/browsers.ts`
- Test: `tests/browsers.test.ts`

- [x] **Step 1: Add failing tests for browser cache paths and Vivaldi**

Append to `tests/browsers.test.ts`:

```ts
test('getBrowser: supports Vivaldi', () => {
  const browser = getBrowser('vivaldi');
  assert.equal(browser.id, 'vivaldi');
  assert.equal(browser.displayName, 'Vivaldi');
  assert.equal(browser.cookieBackend, 'chromium');
  assert.match(browser.macPath!, /Application Support\/Vivaldi$/);
});
```

Create or extend a path test with dynamic import so `FT_DATA_DIR` is isolated:

```ts
test('browser bookmark cache paths are scoped by browser and profile', async () => {
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = '/tmp/fieldtheory-test';
  const paths = await import(`../src/paths.js?browser-cache-${Date.now()}`);
  assert.equal(
    paths.browserBookmarksCachePath('chrome', 'Default'),
    '/tmp/fieldtheory-test/browsers/chrome/Default/bookmarks.jsonl'
  );
  assert.equal(
    paths.browserBookmarksMetaPath('safari', 'default'),
    '/tmp/fieldtheory-test/browsers/safari/default/meta.json'
  );
  if (previous === undefined) delete process.env.FT_DATA_DIR;
  else process.env.FT_DATA_DIR = previous;
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- tests/browsers.test.ts tests/paths-migration.test.ts
```

Expected: FAIL because Vivaldi and path helpers do not exist.

- [x] **Step 3: Add path helpers**

Add to `src/paths.ts` near the bookmark path helpers:

```ts
export function browserBookmarksDir(browser: string, profile: string): string {
  return path.join(dataDir(), 'browsers', browser, profile);
}

export function browserBookmarksCachePath(browser: string, profile: string): string {
  return path.join(browserBookmarksDir(browser, profile), 'bookmarks.jsonl');
}

export function browserBookmarksMetaPath(browser: string, profile: string): string {
  return path.join(browserBookmarksDir(browser, profile), 'meta.json');
}
```

- [x] **Step 4: Add Vivaldi browser definition**

Add to the `BROWSERS` array in `src/browsers.ts`:

```ts
{
  id: 'vivaldi',
  displayName: 'Vivaldi',
  cookieBackend: 'chromium',
  keychainEntries: [
    { service: 'Vivaldi Safe Storage', account: 'Vivaldi' },
  ],
  macPath: 'Library/Application Support/Vivaldi',
  linuxPath: '.config/vivaldi',
  winPath: 'AppData/Local/Vivaldi/User Data',
},
```

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
npm run test -- tests/browsers.test.ts tests/paths-migration.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/paths.ts src/browsers.ts tests/browsers.test.ts tests/paths-migration.test.ts
git commit -m "feat: add browser bookmark cache paths"
```

---

### Task 3: Chromium and Safari bookmark extraction

**Files:**
- Create: `src/browser-bookmarks.ts`
- Test: `tests/browser-bookmarks.test.ts`

- [x] **Step 1: Write failing parser tests**

Create `tests/browser-bookmarks.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChromiumBookmarks, chromiumWebkitTimeToIso } from '../src/browser-bookmarks.js';

test('chromiumWebkitTimeToIso converts Chromium microseconds since 1601', () => {
  assert.equal(chromiumWebkitTimeToIso('0'), null);
  assert.equal(chromiumWebkitTimeToIso('13253760000000000'), '2020-12-30T00:00:00.000Z');
});

test('parseChromiumBookmarks extracts URL nodes with folder paths', () => {
  const parsed = parseChromiumBookmarks({
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks Bar',
        children: [
          { type: 'url', id: '10', name: 'Example', url: 'https://example.com', date_added: '13253760000000000' },
          { type: 'folder', id: '11', name: 'Dev', children: [
            { type: 'url', id: '12', name: 'Repo', url: 'https://github.com/acme/tool' },
          ]},
        ],
      },
    },
  }, { browser: 'chrome', profile: 'Default', syncedAt: '2026-05-10T00:00:00.000Z' });

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    id: 'chrome:Default:10',
    browser: 'chrome',
    profile: 'Default',
    sourceItemId: '10',
    url: 'https://example.com',
    title: 'Example',
    folderPath: ['Bookmarks Bar'],
    dateAdded: '2020-12-30T00:00:00.000Z',
    dateModified: null,
    syncedAt: '2026-05-10T00:00:00.000Z',
  });
  assert.deepEqual(parsed[1].folderPath, ['Bookmarks Bar', 'Dev']);
});
```

- [x] **Step 2: Run parser tests to verify failure**

Run:

```bash
npm run test -- tests/browser-bookmarks.test.ts
```

Expected: FAIL because `src/browser-bookmarks.ts` does not exist.

- [x] **Step 3: Implement browser bookmark types and Chromium parser**

Create `src/browser-bookmarks.ts` with:

```ts
export type BrowserBookmarkProvider = 'chrome' | 'vivaldi' | 'safari';

export interface BrowserBookmarkRecord {
  id: string;
  browser: BrowserBookmarkProvider;
  profile: string;
  sourceItemId: string;
  url: string;
  title: string;
  folderPath: string[];
  dateAdded?: string | null;
  dateModified?: string | null;
  syncedAt: string;
}

interface ChromiumNode {
  type?: string;
  id?: string;
  name?: string;
  url?: string;
  date_added?: string;
  date_modified?: string;
  children?: ChromiumNode[];
}

interface ChromiumBookmarkFile {
  roots?: Record<string, ChromiumNode>;
}

export function chromiumWebkitTimeToIso(value: string | undefined): string | null {
  if (!value) return null;
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return null;
  const unixMs = Math.round(micros / 1000 - 11644473600000);
  return new Date(unixMs).toISOString();
}

export function parseChromiumBookmarks(
  file: ChromiumBookmarkFile,
  options: { browser: BrowserBookmarkProvider; profile: string; syncedAt: string },
): BrowserBookmarkRecord[] {
  const records: BrowserBookmarkRecord[] = [];
  const visit = (node: ChromiumNode, folderPath: string[]) => {
    if (node.type === 'url' && node.url) {
      const sourceItemId = node.id ?? `${node.url}:${folderPath.join('/')}`;
      records.push({
        id: `${options.browser}:${options.profile}:${sourceItemId}`,
        browser: options.browser,
        profile: options.profile,
        sourceItemId,
        url: node.url,
        title: node.name ?? node.url,
        folderPath,
        dateAdded: chromiumWebkitTimeToIso(node.date_added),
        dateModified: chromiumWebkitTimeToIso(node.date_modified),
        syncedAt: options.syncedAt,
      });
      return;
    }
    if (node.type === 'folder') {
      const nextPath = node.name ? [...folderPath, node.name] : folderPath;
      for (const child of node.children ?? []) visit(child, nextPath);
    }
  };

  for (const root of Object.values(file.roots ?? {})) visit(root, []);
  return records;
}
```

- [x] **Step 4: Run parser tests to verify pass**

Run:

```bash
npm run test -- tests/browser-bookmarks.test.ts
```

Expected: PASS.

- [x] **Step 5: Add extraction orchestration tests**

Extend `tests/browser-bookmarks.test.ts` with temp directory tests for reading a Chromium `Bookmarks` file and writing browser JSONL cache through a public `syncBrowserBookmarks()` function:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('syncBrowserBookmarks writes Chromium bookmarks to browser cache', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-browser-sync-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    const sourceDir = path.join(dir, 'source');
    await mkdir(sourceDir, { recursive: true });
    const bookmarksPath = path.join(sourceDir, 'Bookmarks');
    await writeFile(bookmarksPath, JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks Bar',
          children: [
            { type: 'url', id: '10', name: 'Example', url: 'https://example.com' },
            { type: 'url', id: '11', name: 'Repo', url: 'https://github.com/acme/tool' },
          ],
        },
      },
    }));

    const { syncBrowserBookmarks } = await import(`../src/browser-bookmarks.js?sync-${Date.now()}`);
    const result = await syncBrowserBookmarks({ browser: 'chrome', profile: 'Default', bookmarksPath });
    const raw = await readFile(result.cachePath, 'utf8');
    const records = raw.trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(result.synced, 2);
    assert.equal(result.cachePath.endsWith('/browsers/chrome/Default/bookmarks.jsonl'), true);
    assert.equal(records[0].browser, 'chrome');
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [x] **Step 6: Implement extraction orchestration**

Add functions to `src/browser-bookmarks.ts`:

```ts
export interface BrowserBookmarkSyncResult {
  browser: BrowserBookmarkProvider;
  profile: string;
  synced: number;
  cachePath: string;
}
```

Implement `syncBrowserBookmarks()` to read a provided bookmark file path, parse it, write JSONL to `browserBookmarksCachePath(browser, profile)`, and write metadata to `browserBookmarksMetaPath(browser, profile)`. Copy source files to a temp file before parsing.

- [x] **Step 7: Run browser bookmark tests**

Run:

```bash
npm run test -- tests/browser-bookmarks.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/browser-bookmarks.ts tests/browser-bookmarks.test.ts
git commit -m "feat: parse browser bookmarks"
```

---

### Task 4: Canonical bookmark schema and rebuild

**Files:**
- Create: `src/canonical-bookmarks-db.ts`
- Test: `tests/canonical-bookmarks-db.test.ts`

- [x] **Step 1: Write failing canonical rebuild test**

Create `tests/canonical-bookmarks-db.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeJsonLines } from '../src/fs.js';

test('rebuildCanonicalIndex dedupes X external link with browser bookmark URL', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-canonical-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Great repo https://github.com/acme/tool',
      links: ['https://github.com/acme/tool?utm_source=x'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    const browserCacheDir = path.join(dir, 'browsers', 'chrome', 'Default');
    await mkdir(browserCacheDir, { recursive: true });
    await writeFile(path.join(browserCacheDir, 'bookmarks.jsonl'), [JSON.stringify({
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/acme/tool',
      title: 'Acme Tool',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    })].join('\n') + '\n');

    const { rebuildCanonicalIndex, searchCanonicalBookmarks } = await import(`../src/canonical-bookmarks-db.js?${Date.now()}`);
    const result = await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);
    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 2);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [x] **Step 2: Run canonical test to verify failure**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
```

Expected: FAIL because canonical DB module does not exist.

- [x] **Step 3: Implement canonical schema and rebuild**

Create `src/canonical-bookmarks-db.ts` with exports:

```ts
export interface CanonicalRebuildResult {
  dbPath: string;
  sourceCount: number;
  canonicalCount: number;
}

export interface CanonicalSearchResult {
  id: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sourceCount: number;
  sources: string[];
  score: number;
}
```

Implement:

- `initCanonicalSchema(db)` creates `bookmark_sources`, `canonical_bookmarks`, and `canonical_bookmarks_fts`.
- `rebuildCanonicalIndex({ browserSources })` reads X JSONL and selected browser JSONL files.
- X source rows use `dedupeKeyForXBookmark()`.
- Browser source rows use `dedupeKeyForUrl(record.url)`.
- Group source rows by `dedupe_key` and create one canonical row per group.
- Build `search_text` from title, text, URL, folder path, and links.
- Rebuild canonical FTS.

- [x] **Step 4: Add canonical search implementation**

Add `searchCanonicalBookmarks({ query, limit })` that queries `canonical_bookmarks_fts` and returns canonical rows with BM25 scores.

- [x] **Step 5: Run canonical tests to verify pass**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
```

Expected: PASS.

- [x] **Step 6: Run existing X DB regression tests**

Run:

```bash
npm run test -- tests/bookmarks-service.test.ts tests/bookmarks-status.test.ts tests/graphql-bookmarks.test.ts
```

Expected: PASS; existing X index behavior unchanged.

- [x] **Step 7: Commit**

```bash
git add src/canonical-bookmarks-db.ts tests/canonical-bookmarks-db.test.ts
git commit -m "feat: build canonical bookmark index"
```

---

### Task 5: Provider-neutral regex classification

**Files:**
- Modify: `src/bookmark-classify.ts`
- Modify: `src/canonical-bookmarks-db.ts`
- Test: `tests/canonical-bookmarks-db.test.ts`

- [x] **Step 1: Add failing classification tests**

Append to `tests/canonical-bookmarks-db.test.ts`:

```ts
test('classifyCanonicalBookmarks classifies browser-only GitHub bookmarks as tools', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-canonical-classify-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    const browserCacheDir = path.join(dir, 'browsers', 'chrome', 'Default');
    await mkdir(browserCacheDir, { recursive: true });
    await writeFile(path.join(browserCacheDir, 'bookmarks.jsonl'), [JSON.stringify({
      id: 'chrome:Default:22',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '22',
      url: 'https://github.com/acme/cli',
      title: 'Acme CLI',
      folderPath: ['Dev', 'Tools'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    })].join('\n') + '\n');

    const db = await import(`../src/canonical-bookmarks-db.js?classify-${Date.now()}`);
    await db.rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    const result = await db.classifyCanonicalBookmarks();
    const rows = await db.listCanonicalBookmarks({ source: 'chrome', limit: 10 });

    assert.equal(result.total, 1);
    assert.equal(rows[0].primaryCategory, 'tool');
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
```

Expected: FAIL because canonical classification does not exist.

- [x] **Step 3: Refactor classifier input**

In `src/bookmark-classify.ts`, add:

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

Add `classifyBookmarkInput(input: ClassifiableBookmarkInput)` and make existing `classifyBookmark(bookmark: BookmarkRecord)` call it with existing X fields. Build classifier text by joining `title`, `text`, `url`, `links`, and `folderPath` with newlines.

- [x] **Step 4: Implement canonical classification**

In `src/canonical-bookmarks-db.ts`, add `classifyCanonicalBookmarks()`:

```ts
export async function classifyCanonicalBookmarks(): Promise<{ total: number; classified: number }> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    initCanonicalSchema(db);
    const rows = db.exec(`SELECT id, canonical_url, display_title, search_text FROM canonical_bookmarks`)[0]?.values ?? [];
    let classified = 0;
    db.run('BEGIN TRANSACTION');
    try {
      for (const row of rows) {
        const result = classifyBookmarkInput({
          id: row[0] as string,
          url: (row[1] as string) ?? undefined,
          title: (row[2] as string) ?? undefined,
          text: (row[3] as string) ?? undefined,
        });
        if (result.categories.length > 0) classified++;
        db.run(
          `UPDATE canonical_bookmarks SET categories = ?, primary_category = ? WHERE id = ?`,
          [result.categories.join(','), result.primary, row[0] as string]
        );
      }
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
    saveDb(db, dbPath);
    return { total: rows.length, classified };
  } finally {
    db.close();
  }
}
```

Use URL hostnames and `ClassifyResult.extractedUrls` to fill `domains` and `primary_domain` consistently with existing behavior.

- [x] **Step 5: Run classification tests**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
```

Expected: PASS.

- [x] **Step 6: Run existing classifier regression tests if present, otherwise broad tests**

Run:

```bash
npm run test -- tests/**/*.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/bookmark-classify.ts src/canonical-bookmarks-db.ts tests/canonical-bookmarks-db.test.ts
git commit -m "feat: classify canonical bookmarks"
```

---

### Task 6: `ft sync-browser` CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/browser-bookmarks.ts`
- Modify: `src/canonical-bookmarks-db.ts`
- Test: `tests/browser-bookmarks.test.ts`

- [x] **Step 1: Add sync orchestration test**

Add a test that calls a public function rather than shelling out to Commander:

```ts
test('syncBrowserBookmarks writes raw cache and rebuilds canonical index when requested', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-browser-canonical-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    const sourceDir = path.join(dir, 'source');
    await mkdir(sourceDir, { recursive: true });
    const bookmarksPath = path.join(sourceDir, 'Bookmarks');
    await writeFile(bookmarksPath, JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks Bar',
          children: [
            { type: 'url', id: '10', name: 'Acme Tool', url: 'https://github.com/acme/tool' },
            { type: 'url', id: '11', name: 'Docs', url: 'https://example.com/docs' },
          ],
        },
      },
    }));

    const browser = await import(`../src/browser-bookmarks.js?browser-canonical-${Date.now()}`);
    const result = await browser.syncBrowserBookmarks({
      browser: 'chrome',
      profile: 'Default',
      bookmarksPath,
      rebuildCanonical: true,
    });
    const canonical = await import(`../src/canonical-bookmarks-db.js?browser-canonical-${Date.now()}`);
    const matches = await canonical.searchCanonicalBookmarks({ query: 'Acme', limit: 10 });

    assert.equal(result.synced, 2);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].canonicalUrl, 'https://github.com/acme/tool');
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- tests/browser-bookmarks.test.ts
```

Expected: FAIL until orchestration supports canonical rebuild.

- [x] **Step 3: Implement sync orchestration option**

Update `syncBrowserBookmarks()` to accept:

```ts
export interface SyncBrowserBookmarksOptions {
  browser: BrowserBookmarkProvider;
  profile: string;
  bookmarksPath?: string;
  rebuildCanonical?: boolean;
}
```

When `rebuildCanonical` is true, call `rebuildCanonicalIndex({ browserSources: [{ browser, profile }] })` after writing raw cache.

- [x] **Step 4: Add CLI command**

In `src/cli.ts`, add a top-level command:

```ts
program
  .command('sync-browser')
  .description('Sync browser bookmarks into the unified bookmark index')
  .option('--browser <name>', 'Browser to sync (chrome, vivaldi, safari)')
  .option('--profile <name>', 'Browser profile name', 'Default')
  .option('--bookmarks-file <path>', 'Explicit browser bookmarks file path')
  .option('--all', 'Sync all supported installed browsers', false)
  .option('--all-profiles', 'Sync all discovered profiles for selected browser(s)', false)
  .action(safe(async (options) => {
    ensureDataDir();
    const browser = options.browser ? String(options.browser) : undefined;
    if (!browser && !options.all) {
      console.error('  Error: pass --browser <name> or --all');
      process.exitCode = 1;
      return;
    }
    if (options.all) {
      console.error('  Error: --all is not supported in the first cut. Run one browser at a time.');
      process.exitCode = 1;
      return;
    }
    const result = await syncBrowserBookmarks({
      browser,
      profile: String(options.profile ?? 'Default'),
      bookmarksPath: options.bookmarksFile ? String(options.bookmarksFile) : undefined,
      rebuildCanonical: true,
    });
    console.log(`  ✓ ${result.synced} ${result.browser} bookmarks synced (${result.profile})`);
    console.log(`  ✓ Cache: ${result.cachePath}`);
  }));
```

For the first pass, support one browser/profile plus `--bookmarks-file`; add `--all` and `--all-profiles` behavior in Task 7 if needed to keep this task small.

- [x] **Step 5: Run targeted tests and typecheck**

Run:

```bash
npm run test -- tests/browser-bookmarks.test.ts tests/canonical-bookmarks-db.test.ts
npm run build
```

Expected: PASS and TypeScript build succeeds.

- [x] **Step 6: Commit**

```bash
git add src/cli.ts src/browser-bookmarks.ts src/canonical-bookmarks-db.ts tests/browser-bookmarks.test.ts
git commit -m "feat: add browser bookmark sync command"
```

---

### Task 7: Unified search/list/show CLI surfaces

**Files:**
- Modify: `src/canonical-bookmarks-db.ts`
- Modify: `src/cli.ts`
- Test: `tests/canonical-bookmarks-db.test.ts`

- [x] **Step 1: Add canonical list/show tests**

Add tests for:

```ts
listCanonicalBookmarks({ source: 'chrome', limit: 10 })
getCanonicalBookmarkById(id)
```

Assertions:

```ts
assert.equal(list.length, 1);
assert.equal(list[0].sources.includes('chrome'), true);
assert.equal(shown.sourceCount, 2);
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
```

Expected: FAIL because list/show helpers are missing.

- [x] **Step 3: Implement canonical list/show helpers**

Add to `src/canonical-bookmarks-db.ts`:

```ts
export async function listCanonicalBookmarks(options: { source?: string; limit?: number; offset?: number }) {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const limit = options.limit ?? 25;
    const offset = options.offset ?? 0;
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (options.source) {
      conditions.push(`sources_json LIKE ?`);
      params.push(`%"${options.source}"%`);
    }
    params.push(limit, offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.exec(
      `SELECT id, canonical_url, display_title, search_text, source_count, sources_json,
              categories, primary_category, domains, primary_domain
       FROM canonical_bookmarks
       ${where}
       ORDER BY COALESCE(last_saved_at, first_saved_at, '') DESC
       LIMIT ? OFFSET ?`,
      params,
    )[0]?.values ?? [];
    return rows.map(mapCanonicalRow);
  } finally {
    db.close();
  }
}

export async function getCanonicalBookmarkById(id: string) {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const row = db.exec(
      `SELECT id, canonical_url, display_title, search_text, source_count, sources_json,
              categories, primary_category, domains, primary_domain
       FROM canonical_bookmarks WHERE id = ? LIMIT 1`,
      [id],
    )[0]?.values[0];
    return row ? mapCanonicalRow(row) : null;
  } finally {
    db.close();
  }
}

export function formatCanonicalSearchResults(results: CanonicalSearchResult[]): string {
  if (results.length === 0) return 'No unified bookmarks found.';
  return results.map((result, index) => {
    const sources = result.sources.length ? ` [${result.sources.join(', ')}]` : '';
    const title = result.displayTitle ?? result.canonicalUrl ?? result.id;
    const url = result.canonicalUrl ? `\n    ${result.canonicalUrl}` : '';
    return `${index + 1}. ${title}${sources}${url}`;
  }).join('\n\n');
}
```

Keep formatting compact and source-aware: title, URL, source badges, category/domain if present.

- [x] **Step 4: Wire explicit unified flags into CLI**

Modify existing commands:

```ts
program
  .command('search')
  .argument('<query>')
  .option('--unified', 'Search the unified canonical bookmark index', false)

program
  .command('list')
  .option('--unified', 'List unified canonical bookmarks', false)

program
  .command('show')
  .argument('<id>')
  .option('--unified', 'Show a unified canonical bookmark', false)
```

When `--unified` is passed, call canonical helpers. Without `--unified`, keep current X-only behavior.

- [x] **Step 5: Run targeted tests and build**

Run:

```bash
npm run test -- tests/canonical-bookmarks-db.test.ts
npm run build
```

Expected: PASS and TypeScript build succeeds.

- [x] **Step 6: Commit**

```bash
git add src/canonical-bookmarks-db.ts src/cli.ts tests/canonical-bookmarks-db.test.ts
git commit -m "feat: add unified bookmark search"
```

---

### Task 8: Make sync media fetching opt-in by default

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Test: existing CLI behavior tests if present; otherwise `npm run build`

- [x] **Step 1: Inspect current sync option handling**

Read the `sync` command in `src/cli.ts` and confirm current behavior:

```ts
.option('--no-media', 'Skip downloading media assets after syncing (default: media is downloaded)')
```

and:

```ts
const downloadMedia = options.media !== false;
```

- [x] **Step 2: Change sync options**

Update the sync options to include explicit opt-in media:

```ts
.option('--media', 'Download media assets after syncing (default: off)', false)
.option('--no-media', 'Skip downloading media assets after syncing (default)', false)
```

Change media resolution to:

```ts
const downloadMedia = Boolean(options.media);
```

Keep the existing `ft fetch-media` command unchanged.

- [x] **Step 3: Update first-run and README copy**

In `README.md`, update sync command descriptions:

```md
| `ft sync` | Download and sync bookmarks. Media is skipped by default. |
| `ft sync --media` | Sync bookmarks and then download media assets |
| `ft fetch-media` | Backfill/download X media assets for existing bookmarks |
```

Remove or reword any statement saying default sync downloads media.

- [x] **Step 4: Run build and relevant tests**

Run:

```bash
npm run build
npm run test -- tests/bookmark-media.test.ts tests/graphql-bookmarks.test.ts
```

Expected: PASS. Media fetch helper tests should remain valid because `ft fetch-media` behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts README.md
git commit -m "feat: make sync media opt-in"
```

---

### Task 9: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: command help text in `src/cli.ts` if any help output still says media downloads by default

- [ ] **Step 1: Document browser bookmark sync**

Add README rows:

```md
| `ft sync-browser --browser chrome` | Sync Chrome bookmarks into the unified bookmark index |
| `ft sync-browser --browser vivaldi` | Sync Vivaldi bookmarks into the unified bookmark index |
| `ft sync-browser --browser safari` | Sync Safari bookmarks into the unified bookmark index on macOS |
| `ft search --unified <query>` | Search deduped X and browser bookmarks |
```

- [ ] **Step 2: Document data layout**

Add to README data section:

```text
~/.fieldtheory/bookmarks/browsers/
  chrome/Default/bookmarks.jsonl   # raw Chrome bookmark snapshot
  vivaldi/Default/bookmarks.jsonl  # raw Vivaldi bookmark snapshot
  safari/default/bookmarks.jsonl   # raw Safari bookmark snapshot
```

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run build
npm run test
```

Expected: both commands pass.

- [ ] **Step 4: Manual smoke test with fixture browser file**

Run against a local fixture or copied Chromium `Bookmarks` file:

```bash
FT_DATA_DIR=$(mktemp -d) npm run dev -- sync-browser --browser chrome --profile Default --bookmarks-file /path/to/Bookmarks
FT_DATA_DIR=<same-dir> npm run dev -- search --unified github
```

Expected: sync reports imported bookmarks; unified search returns browser bookmark rows with source badges.

- [ ] **Step 5: Confirm media default manually**

Run:

```bash
npm run dev -- sync --help
```

Expected: help says media download is opt-in via `--media`; no help text says media downloads by default.

- [ ] **Step 6: Commit docs**

```bash
git add README.md src/cli.ts
git commit -m "docs: document browser bookmark sync"
```

---

## DONE checklist

Mark the feature DONE only when all of these are true:

- [ ] `ft sync-browser --browser chrome --bookmarks-file <fixture>` writes a raw JSONL cache.
- [ ] `ft sync-browser --browser vivaldi --bookmarks-file <fixture>` writes a raw JSONL cache.
- [ ] Safari sync either imports bookmarks on macOS or fails with a clear platform/path error.
- [ ] Canonical rebuild dedupes an X bookmark with one external URL and a browser bookmark of that same URL.
- [ ] Canonical rebuild does not dedupe an X bookmark with multiple external URLs.
- [ ] `ft search --unified <query>` returns canonical rows with source information.
- [ ] `ft list --unified` and `ft show --unified <id>` work for canonical rows.
- [ ] `ft classify --unified --regex` classifies browser-only and merged canonical bookmarks.
- [ ] Existing X-only `ft search`, `ft list`, `ft show`, `ft sync --gaps`, and `ft fetch-media` behavior is not intentionally changed.
- [ ] `ft sync` does not fetch media by default.
- [ ] `ft sync --media` fetches media after sync.
- [ ] `npm run build` passes.
- [ ] `npm run test` passes.

## Execution handoff

Plan complete and saved to `docs/plans/2026-05-10-browser-bookmarks-unified-index.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach should we use when you are ready to implement?
