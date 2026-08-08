# Bookmarks Web Interface Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ft serve`, a localhost-only HTTP API, and a dependency-free browser UI for browsing, searching, filtering, and inspecting local X bookmarks.

**Architecture:** Keep the existing bookmark SQLite/sql.js read layer as the source of truth. Add a small `src/web/` module that serves JSON endpoints and an inline static app shell with vanilla browser JavaScript. Wire only a thin Commander command into `src/cli.ts`.

**Tech Stack:** Node built-in `http`, TypeScript NodeNext, existing `bookmarks-db.ts` APIs, existing media manifest paths, no React/Vite for MVP.

---

## File Structure

- Create `src/web/http.ts` for small HTTP helpers: JSON responses, plain text errors, request URL parsing, integer option parsing, and safe route matching.
- Create `src/web/media.ts` for media manifest loading, safe filename mapping, `/media/:filename` traversal protection, and public media asset enrichment.
- Create `src/web/app-shell.ts` for the HTML shell, CSS string, and dependency-free browser JavaScript string.
- Create `src/web/server.ts` for route handling and server lifecycle.
- Modify `src/cli.ts` only to import and register `ft serve`.
- Add `tests/web-server.test.ts` for API, media safety, and app shell smoke coverage.
- Add or update a CLI test only if an existing CLI command-registration test already has a suitable pattern; otherwise rely on `ft serve --help` during verification.

## Non-goals for MVP

- No React, Vite, TanStack Router, or asset build pipeline.
- No browser-triggered sync endpoint yet.
- No process-global sql.js connection cache yet.
- No unified/canonical bookmarks tab yet.

---

### Task 1: Add HTTP helper primitives

**Files:**
- Create: `src/web/http.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing helper tests inside `tests/web-server.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBoundedInteger, safeRoutePath } from '../src/web/http.js';

test('parseBoundedInteger clamps defaults and rejects invalid values', () => {
  assert.equal(parseBoundedInteger(null, { defaultValue: 30, min: 1, max: 100 }), 30);
  assert.equal(parseBoundedInteger('5', { defaultValue: 30, min: 1, max: 100 }), 5);
  assert.equal(parseBoundedInteger('500', { defaultValue: 30, min: 1, max: 100 }), 100);
  assert.throws(() => parseBoundedInteger('abc', { defaultValue: 30, min: 1, max: 100 }), /Invalid integer/);
  assert.throws(() => parseBoundedInteger('-1', { defaultValue: 30, min: 0, max: 100 }), /Invalid integer/);
});

test('safeRoutePath normalizes URL paths without query strings', () => {
  assert.equal(safeRoutePath('/api/bookmarks?limit=5'), '/api/bookmarks');
  assert.equal(safeRoutePath('/media/a%20b.jpg'), '/media/a b.jpg');
  assert.equal(safeRoutePath('not a url'), '/');
});
```

- [ ] **Step 2: Run the new tests and confirm they fail because the module does not exist**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: TypeScript/module resolution failure for `../src/web/http.js`.

- [ ] **Step 3: Implement `src/web/http.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function safeRoutePath(rawUrl: string | undefined): string {
  try {
    return decodeURIComponent(new URL(rawUrl ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    return '/';
  }
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

export function parseBoundedInteger(
  value: string | null,
  options: { defaultValue: number; min: number; max: number },
): number {
  if (value == null || value.trim() === '') return options.defaultValue;
  if (!/^\d+$/.test(value.trim())) throw new HttpError(400, `Invalid integer: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min) throw new HttpError(400, `Invalid integer: ${value}`);
  return Math.min(parsed, options.max);
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(res, 500, { error: 'Internal server error' });
}
```

- [ ] **Step 4: Run the helper tests and typecheck**

Run:

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: helper tests pass; build passes.

- [ ] **Step 5: Commit**

```bash
git add src/web/http.ts tests/web-server.test.ts
git commit -m "feat: add web http helpers"
```

---

### Task 2: Add safe media manifest support

**Files:**
- Create: `src/web/media.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add media helper tests**

Append to `tests/web-server.test.ts`:

```ts
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { loadWebMediaIndex, resolveMediaFile } from '../src/web/media.js';

test('loadWebMediaIndex exposes media URLs without absolute local paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-media-'));
  const mediaDir = path.join(root, 'bookmarks', 'media');
  await mkdir(mediaDir, { recursive: true });
  const localPath = path.join(mediaDir, 'one.jpg');
  await writeFile(localPath, 'image');
  const manifestPath = path.join(root, 'bookmarks', 'media-manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-06-24T00:00:00.000Z',
    limit: 1,
    maxBytes: 100,
    processed: 1,
    downloaded: 1,
    skippedTooLarge: 0,
    failed: 0,
    entries: [{
      bookmarkId: 'b1',
      tweetId: 't1',
      tweetUrl: 'https://x.com/a/status/t1',
      sourceUrl: 'https://example.com/one.jpg',
      localPath,
      contentType: 'image/jpeg',
      bytes: 5,
      status: 'downloaded',
      fetchedAt: '2026-06-24T00:00:00.000Z',
    }],
  }));

  const index = await loadWebMediaIndex({ mediaDir, manifestPath });
  assert.deepEqual(index.assetsByBookmarkId.get('b1'), [{
    url: '/media/one.jpg',
    sourceUrl: 'https://example.com/one.jpg',
    contentType: 'image/jpeg',
    bytes: 5,
  }]);
});

test('resolveMediaFile rejects traversal and unknown files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-media-'));
  const mediaDir = path.join(root, 'media');
  await mkdir(mediaDir, { recursive: true });
  const localPath = path.join(mediaDir, 'one.jpg');
  await writeFile(localPath, 'image');
  const index = await loadWebMediaIndex({
    mediaDir,
    manifestPath: path.join(root, 'missing-manifest.json'),
  });
  index.filesByName.set('one.jpg', { path: localPath, contentType: 'image/jpeg' });

  assert.equal(resolveMediaFile(index, 'one.jpg')?.path, localPath);
  assert.throws(() => resolveMediaFile(index, '../one.jpg'), /Invalid media path/);
  assert.equal(resolveMediaFile(index, 'missing.jpg'), null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail for the missing media module**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: module resolution failure for `../src/web/media.js`.

- [ ] **Step 3: Implement `src/web/media.ts`**

```ts
import path from 'node:path';
import { pathExists, readJson } from '../fs.js';
import type { MediaFetchManifest } from '../bookmark-media.js';
import { bookmarkMediaDir, bookmarkMediaManifestPath } from '../paths.js';
import { HttpError } from './http.js';

export interface WebMediaAsset {
  url: string;
  sourceUrl: string;
  contentType?: string;
  bytes?: number;
}

export interface WebMediaIndex {
  assetsByBookmarkId: Map<string, WebMediaAsset[]>;
  filesByName: Map<string, { path: string; contentType?: string }>;
}

export async function loadWebMediaIndex(options: {
  mediaDir?: string;
  manifestPath?: string;
} = {}): Promise<WebMediaIndex> {
  const mediaDir = options.mediaDir ?? bookmarkMediaDir();
  const manifestPath = options.manifestPath ?? bookmarkMediaManifestPath();
  const assetsByBookmarkId = new Map<string, WebMediaAsset[]>();
  const filesByName = new Map<string, { path: string; contentType?: string }>();

  if (!(await pathExists(manifestPath))) return { assetsByBookmarkId, filesByName };
  const manifest = await readJson<MediaFetchManifest>(manifestPath);

  for (const entry of manifest.entries) {
    if (entry.status !== 'downloaded' || !entry.localPath) continue;
    const resolved = path.resolve(entry.localPath);
    const resolvedMediaDir = path.resolve(mediaDir);
    if (!resolved.startsWith(`${resolvedMediaDir}${path.sep}`)) continue;
    const filename = path.basename(resolved);
    const asset = {
      url: `/media/${encodeURIComponent(filename)}`,
      sourceUrl: entry.sourceUrl,
      contentType: entry.contentType,
      bytes: entry.bytes,
    };
    assetsByBookmarkId.set(entry.bookmarkId, [...(assetsByBookmarkId.get(entry.bookmarkId) ?? []), asset]);
    filesByName.set(filename, { path: resolved, contentType: entry.contentType });
  }

  return { assetsByBookmarkId, filesByName };
}

export function resolveMediaFile(index: WebMediaIndex, filename: string): { path: string; contentType?: string } | null {
  if (filename.includes('/') || filename.includes('\\')) throw new HttpError(403, 'Invalid media path');
  return index.filesByName.get(filename) ?? null;
}
```

- [ ] **Step 4: Run media tests and build**

Run:

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/media.ts tests/web-server.test.ts
git commit -m "feat: add safe bookmark media index"
```

---

### Task 3: Add bookmark API server routes

**Files:**
- Create: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add API integration tests**

Append to `tests/web-server.test.ts`:

```ts
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { buildIndex } from '../src/bookmarks-db.js';
import { createBookmarkWebServer } from '../src/web/server.js';

async function withTempFieldTheoryData<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const previous = process.env.FIELD_THEORY_HOME;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-data-'));
  process.env.FIELD_THEORY_HOME = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FIELD_THEORY_HOME;
    else process.env.FIELD_THEORY_HOME = previous;
  }
}

async function seedBookmarks(root: string): Promise<void> {
  const bookmarksDir = path.join(root, 'bookmarks');
  await mkdir(bookmarksDir, { recursive: true });
  await writeFile(path.join(bookmarksDir, 'bookmarks.jsonl'), `${JSON.stringify({
    id: 'b1',
    tweetId: '100',
    url: 'https://x.com/alice/status/100',
    text: 'Machine learning systems note',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-06-20T00:00:00.000Z',
    bookmarkedAt: '2026-06-21T00:00:00.000Z',
    categories: ['AI'],
    primaryCategory: 'AI',
    domains: ['ml'],
    primaryDomain: 'ml',
    links: ['https://example.com/article'],
    folderIds: ['f1'],
    folderNames: ['Research'],
  })}\n`);
  await buildIndex();
}

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createBookmarkWebServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('bookmark web API lists, filters, shows, and reports stats', async () => {
  await withTempFieldTheoryData(async (root) => {
    await seedBookmarks(root);
    const server = await startTestServer();
    try {
      const listResponse = await fetch(`${server.baseUrl}/api/bookmarks?query=machine&limit=1`);
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('access-control-allow-origin'), null);
      const list = await listResponse.json() as { items: Array<{ id: string; mediaAssets: unknown[] }>; total: number };
      assert.equal(list.total, 1);
      assert.equal(list.items[0]?.id, 'b1');
      assert.deepEqual(list.items[0]?.mediaAssets, []);

      const showResponse = await fetch(`${server.baseUrl}/api/bookmarks/b1`);
      assert.equal(showResponse.status, 200);
      const show = await showResponse.json() as { id: string; text: string };
      assert.equal(show.id, 'b1');

      const statsResponse = await fetch(`${server.baseUrl}/api/stats`);
      assert.equal(statsResponse.status, 200);
      const stats = await statsResponse.json() as { stats: { total: number }; categories: Array<{ category: string; count: number }> };
      assert.equal(stats.stats.total, 1);
      assert.equal(stats.categories[0]?.category, 'AI');
    } finally {
      await server.close();
    }
  });
});

test('bookmark web API returns status errors for invalid requests', async () => {
  await withTempFieldTheoryData(async (root) => {
    await seedBookmarks(root);
    const server = await startTestServer();
    try {
      assert.equal((await fetch(`${server.baseUrl}/api/bookmarks?limit=abc`)).status, 400);
      assert.equal((await fetch(`${server.baseUrl}/api/bookmarks/missing`)).status, 404);
      assert.equal((await fetch(`${server.baseUrl}/api/nope`)).status, 404);
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run API tests and confirm they fail for missing server exports**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: module resolution failure for `../src/web/server.js`.

- [ ] **Step 3: Implement `src/web/server.ts` API routes**

```ts
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { getBookmarkStatusView } from '../bookmarks-service.js';
import {
  countBookmarks,
  getBookmarkById,
  getCategoryCounts,
  getDomainCounts,
  getFolderCounts,
  getStats,
  listBookmarks,
  type BookmarkTimelineFilters,
  type BookmarkTimelineItem,
} from '../bookmarks-db.js';
import { HttpError, parseBoundedInteger, requestUrl, safeRoutePath, sendError, sendJson, sendText } from './http.js';
import { loadWebMediaIndex, resolveMediaFile, type WebMediaAsset } from './media.js';
import { renderAppShell, appCss, appJs } from './app-shell.js';

export type BookmarkWebItem = BookmarkTimelineItem & { mediaAssets: WebMediaAsset[] };

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseBookmarkFilters(url: URL): BookmarkTimelineFilters {
  const sortValue = url.searchParams.get('sort');
  if (sortValue && sortValue !== 'asc' && sortValue !== 'desc') throw new HttpError(400, 'Invalid sort');
  return {
    query: optionalParam(url, 'query'),
    category: optionalParam(url, 'category'),
    domain: optionalParam(url, 'domain'),
    folder: optionalParam(url, 'folder'),
    author: optionalParam(url, 'author'),
    after: optionalParam(url, 'after'),
    before: optionalParam(url, 'before'),
    sort: sortValue === 'asc' ? 'asc' : 'desc',
    limit: parseBoundedInteger(url.searchParams.get('limit'), { defaultValue: 30, min: 1, max: 100 }),
    offset: parseBoundedInteger(url.searchParams.get('offset'), { defaultValue: 0, min: 0, max: 1_000_000 }),
  };
}

async function enrichBookmark(item: BookmarkTimelineItem): Promise<BookmarkWebItem> {
  const mediaIndex = await loadWebMediaIndex();
  return { ...item, mediaAssets: mediaIndex.assetsByBookmarkId.get(item.id) ?? [] };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const url = requestUrl(req);
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

  if (pathname === '/api/bookmarks') {
    const filters = parseBookmarkFilters(url);
    const [items, total] = await Promise.all([listBookmarks(filters), countBookmarks(filters)]);
    const mediaIndex = await loadWebMediaIndex();
    sendJson(res, 200, {
      items: items.map((item): BookmarkWebItem => ({ ...item, mediaAssets: mediaIndex.assetsByBookmarkId.get(item.id) ?? [] })),
      total,
      limit: filters.limit,
      offset: filters.offset,
    });
    return;
  }

  const bookmarkMatch = pathname.match(/^\/api\/bookmarks\/([^/]+)$/);
  if (bookmarkMatch) {
    const item = getBookmarkById(bookmarkMatch[1]);
    if (!item) throw new HttpError(404, 'Bookmark not found');
    sendJson(res, 200, await enrichBookmark(item));
    return;
  }

  if (pathname === '/api/stats') {
    sendJson(res, 200, {
      stats: getStats(),
      status: getBookmarkStatusView(),
      categories: getCategoryCounts(50),
      domains: getDomainCounts(50),
      folders: getFolderCounts(),
    });
    return;
  }

  if (pathname === '/api/media-manifest') {
    const mediaIndex = await loadWebMediaIndex();
    sendJson(res, 200, { files: mediaIndex.filesByName.size, bookmarkCount: mediaIndex.assetsByBookmarkId.size });
    return;
  }

  throw new HttpError(404, 'Not found');
}

async function handleMedia(res: ServerResponse, filename: string): Promise<void> {
  const mediaIndex = await loadWebMediaIndex();
  const mediaFile = resolveMediaFile(mediaIndex, filename);
  if (!mediaFile) throw new HttpError(404, 'Media not found');
  res.writeHead(200, {
    'content-type': mediaFile.contentType ?? 'application/octet-stream',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(mediaFile.path).pipe(res);
}

export function createBookmarkWebServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const pathname = safeRoutePath(req.url);
      if (pathname === '/') return sendText(res, 200, renderAppShell(), 'text/html; charset=utf-8');
      if (pathname === '/styles.css') return sendText(res, 200, appCss, 'text/css; charset=utf-8');
      if (pathname === '/app.js') return sendText(res, 200, appJs, 'text/javascript; charset=utf-8');
      if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
      if (pathname.startsWith('/media/')) return handleMedia(res, pathname.slice('/media/'.length));
      throw new HttpError(404, 'Not found');
    })().catch((error: unknown) => sendError(res, error));
  });
}

export async function runBookmarkWebServer(options: { host: string; port: number }): Promise<void> {
  const server = createBookmarkWebServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const host = options.host;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn(`Warning: serving private bookmarks on non-localhost host ${host}`);
  }
  console.log(`Field Theory web interface: http://${host}:${port}`);
  await new Promise<void>((resolve) => {
    const close = () => server.close(() => resolve());
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}
```

- [ ] **Step 4: Run tests and fix import/name drift**

Run:

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: fails only because `src/web/app-shell.ts` is not implemented yet. If it fails for bookmark fixture shape, inspect `tests/bookmarks-db.test.ts` and adjust `seedBookmarks()` to match the existing fixture pattern.

- [ ] **Step 5: Commit after app shell exists in Task 4**

Do not commit this task alone if build is failing because `app-shell.ts` does not exist.

---

### Task 4: Add dependency-free browser UI

**Files:**
- Create: `src/web/app-shell.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add app shell smoke test**

Append to `tests/web-server.test.ts`:

```ts
import { renderAppShell, appCss, appJs } from '../src/web/app-shell.js';

test('app shell includes root element and static asset links', () => {
  const html = renderAppShell();
  assert.match(html, /<div id="app">/);
  assert.match(html, /\/styles\.css/);
  assert.match(html, /\/app\.js/);
  assert.match(appCss, /\.bookmark-card/);
  assert.match(appJs, /fetchBookmarks/);
  assert.doesNotMatch(html, /<script>.*bookmark/s);
});
```

- [ ] **Step 2: Run tests and confirm missing app shell failure**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: module resolution failure for `../src/web/app-shell.js`.

- [ ] **Step 3: Implement `src/web/app-shell.ts`**

Use DOM APIs in browser JS. Avoid inserting bookmark text with `innerHTML`.

```ts
export function renderAppShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Field Theory Bookmarks</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app">
    <aside class="sidebar">
      <p class="eyebrow">Field Theory</p>
      <h1>X Bookmarks</h1>
      <div id="stats" class="stats">Loading stats…</div>
      <div id="filters" class="filters"></div>
    </aside>
    <main class="main">
      <form id="searchForm" class="search">
        <input id="query" name="query" type="search" autocomplete="off" placeholder="Search bookmarks, articles, links…">
        <button type="submit">Search</button>
      </form>
      <div id="activeFilters" class="active-filters"></div>
      <div id="status" class="status">Loading bookmarks…</div>
      <section id="results" class="results" aria-live="polite"></section>
      <button id="loadMore" class="load-more" type="button" hidden>Load more</button>
    </main>
    <aside id="detail" class="detail" hidden></aside>
  </div>
  <script src="/app.js" type="module"></script>
</body>
</html>`;
}

export const appCss = `
:root { color-scheme: dark; --bg:#0d1117; --panel:#111827; --card:#172033; --line:#263247; --text:#f5f7fb; --muted:#9aa8bd; --accent:#7dd3fc; --accent2:#fbbf24; }
* { box-sizing: border-box; }
body { margin:0; background: radial-gradient(circle at top left, #1f3151, var(--bg) 40%); color:var(--text); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: var(--accent); }
#app { min-height:100vh; display:grid; grid-template-columns: 290px minmax(0, 1fr) minmax(320px, 420px); gap: 1px; background: var(--line); }
.sidebar,.main,.detail { background: color-mix(in oklab, var(--panel) 96%, transparent); }
.sidebar { padding: 28px 20px; position: sticky; top:0; height:100vh; overflow:auto; }
.main { padding: 28px; min-width:0; }
.detail { padding: 24px; height:100vh; position:sticky; top:0; overflow:auto; border-left:1px solid var(--line); }
.eyebrow { color:var(--accent2); text-transform:uppercase; letter-spacing:.18em; font-size:12px; margin:0 0 8px; }
h1 { font-size:32px; line-height:1; margin:0 0 24px; }
.stats { display:grid; gap:8px; margin-bottom:22px; color:var(--muted); }
.stat strong { color:var(--text); font-size:22px; display:block; }
.filters { display:flex; flex-wrap:wrap; gap:8px; }
.chip,.filter-chip { border:1px solid var(--line); border-radius:999px; background:#101827; color:var(--text); padding:6px 10px; cursor:pointer; }
.chip.active,.filter-chip:hover { border-color:var(--accent); color:var(--accent); }
.search { display:flex; gap:10px; margin-bottom:18px; }
.search input { flex:1; border:1px solid var(--line); background:#0b1220; color:var(--text); border-radius:14px; padding:14px 16px; font:inherit; }
.search button,.load-more { border:0; background:var(--accent); color:#07111f; border-radius:14px; padding:0 18px; font-weight:700; cursor:pointer; }
.active-filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.status { color:var(--muted); margin:12px 0; }
.results { display:grid; gap:14px; }
.bookmark-card { border:1px solid var(--line); background:linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, white 6%), var(--card)); border-radius:22px; padding:18px; box-shadow: 0 18px 50px rgb(0 0 0 / .18); }
.bookmark-card header { display:flex; justify-content:space-between; gap:16px; color:var(--muted); font-size:13px; }
.bookmark-card h2 { font-size:16px; margin:2px 0 10px; }
.bookmark-text { white-space:pre-wrap; margin:0 0 14px; }
.meta-row,.links,.media-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.pill { border:1px solid var(--line); color:var(--muted); border-radius:999px; padding:3px 8px; font-size:12px; }
.actions { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:14px; }
.details-btn { background:#23314a; color:var(--text); border:1px solid var(--line); border-radius:12px; padding:8px 12px; cursor:pointer; }
.media-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:8px; margin-top:12px; }
.media-grid img { width:100%; border-radius:14px; display:block; }
.detail-close { float:right; }
.article-text { white-space:pre-wrap; color:var(--muted); }
@media (max-width: 1050px) { #app { grid-template-columns:1fr; } .sidebar,.detail { position:static; height:auto; } .detail[hidden] { display:none; } }
`;

export const appJs = `
const state = { query:'', category:'', domain:'', folder:'', offset:0, limit:30, total:0, loading:false };
const results = document.querySelector('#results');
const statusEl = document.querySelector('#status');
const loadMore = document.querySelector('#loadMore');
const detail = document.querySelector('#detail');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(text) { statusEl.textContent = text; }

function params(resetOffset = false) {
  if (resetOffset) state.offset = 0;
  const p = new URLSearchParams({ limit:String(state.limit), offset:String(state.offset) });
  for (const key of ['query','category','domain','folder']) if (state[key]) p.set(key, state[key]);
  return p;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.json();
}

function renderStats(payload) {
  const stats = document.querySelector('#stats');
  stats.replaceChildren(
    Object.assign(el('div', 'stat'), { innerHTML: '<strong>' + payload.stats.total + '</strong>Total bookmarks' }),
    el('div', 'stat', (payload.status?.lastSyncedAt ? 'Last sync ' + payload.status.lastSyncedAt : 'Not synced yet')),
  );
  const filters = document.querySelector('#filters');
  filters.replaceChildren();
  for (const [kind, rows, labelKey] of [['category', payload.categories, 'category'], ['domain', payload.domains, 'domain'], ['folder', payload.folders, 'folder']]) {
    for (const row of rows.slice(0, 12)) {
      const button = el('button', 'filter-chip', row[labelKey] + ' · ' + row.count);
      button.type = 'button';
      button.addEventListener('click', () => { state[kind] = state[kind] === row[labelKey] ? '' : row[labelKey]; fetchBookmarks(true); });
      filters.append(button);
    }
  }
}

function renderCard(item) {
  const card = el('article', 'bookmark-card');
  const header = el('header');
  header.append(el('div', '', [item.authorName, item.authorHandle && '@' + item.authorHandle].filter(Boolean).join(' · ') || 'Unknown author'));
  header.append(el('time', '', item.bookmarkedAt || item.postedAt || ''));
  const text = el('p', 'bookmark-text', item.text || '');
  const meta = el('div', 'meta-row');
  for (const value of [...(item.categories || []), ...(item.domains || []), ...(item.folderNames || [])]) meta.append(el('span', 'pill', value));
  const links = el('div', 'links');
  for (const href of item.links || []) { const a = el('a', 'pill', href); a.href = href; a.target = '_blank'; a.rel = 'noreferrer'; links.append(a); }
  const media = el('div', 'media-grid');
  for (const asset of item.mediaAssets || []) { const img = el('img'); img.src = asset.url; img.alt = 'Downloaded bookmark media'; img.loading = 'lazy'; media.append(img); }
  const actions = el('div', 'actions');
  const open = el('a', '', 'Open on X'); open.href = item.url; open.target = '_blank'; open.rel = 'noreferrer';
  const details = el('button', 'details-btn', 'Details'); details.type = 'button'; details.addEventListener('click', () => showDetail(item.id));
  actions.append(details, open);
  card.append(header, text, meta, links, media, actions);
  return card;
}

async function fetchBookmarks(reset = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    setStatus('Loading…');
    const data = await fetchJson('/api/bookmarks?' + params(reset));
    if (reset) results.replaceChildren();
    for (const item of data.items) results.append(renderCard(item));
    state.total = data.total;
    state.offset = results.children.length;
    loadMore.hidden = state.offset >= state.total;
    setStatus('Showing ' + state.offset + ' of ' + state.total + ' bookmarks');
  } catch (error) {
    setStatus(error.message || 'Failed to load bookmarks');
  } finally {
    state.loading = false;
  }
}

async function showDetail(id) {
  const item = await fetchJson('/api/bookmarks/' + encodeURIComponent(id));
  detail.hidden = false;
  detail.replaceChildren();
  const close = el('button', 'detail-close', 'Close'); close.addEventListener('click', () => { detail.hidden = true; });
  detail.append(close, el('h2', '', item.authorName || item.authorHandle || 'Bookmark'), el('p', 'bookmark-text', item.text || ''));
  if (item.quotedTweet) detail.append(el('h3', '', 'Quoted tweet'), el('p', 'bookmark-text', item.quotedTweet.text || ''));
  if (item.articleTitle || item.articleText) detail.append(el('h3', '', item.articleTitle || 'Article text'), el('p', 'article-text', item.articleText || ''));
}

let debounce;
document.querySelector('#searchForm').addEventListener('submit', (event) => { event.preventDefault(); state.query = document.querySelector('#query').value.trim(); fetchBookmarks(true); });
document.querySelector('#query').addEventListener('input', (event) => { clearTimeout(debounce); debounce = setTimeout(() => { state.query = event.target.value.trim(); fetchBookmarks(true); }, 300); });
loadMore.addEventListener('click', () => fetchBookmarks(false));

fetchJson('/api/stats').then(renderStats).catch((error) => setStatus(error.message));
fetchBookmarks(true);
`;
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: web tests and build pass.

- [ ] **Step 5: Commit Task 3 and Task 4 together**

```bash
git add src/web/server.ts src/web/app-shell.ts tests/web-server.test.ts
git commit -m "feat: add bookmark web API and app shell"
```

---

### Task 5: Wire `ft serve`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add import near other local imports in `src/cli.ts`**

```ts
import { runBookmarkWebServer } from './web/server.js';
```

- [ ] **Step 2: Add serve command near other top-level commands in `src/cli.ts`**

Use existing local helper style for parsing options. If no reusable parser fits cleanly, keep the parser local to the command.

```ts
program
  .command('serve')
  .description('Serve a local web interface for X bookmarks')
  .option('--host <host>', 'Host interface to bind', process.env.FT_SERVE_HOST ?? '127.0.0.1')
  .option('--port <port>', 'TCP port (0 selects an available port)', process.env.FT_SERVE_PORT ?? '3000')
  .action(async (options: { host: string; port: string }) => {
    const host = String(options.host).trim();
    const port = Number(options.port);
    if (!host) {
      console.error('  --host must not be empty');
      process.exitCode = 1;
      return;
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error('  --port must be an integer from 0 to 65535');
      process.exitCode = 1;
      return;
    }
    if (!fs.existsSync(twitterBookmarksIndexPath())) {
      console.error('  No bookmark index found. Run `ft sync` or `ft index` first.');
      process.exitCode = 1;
      return;
    }
    await runBookmarkWebServer({ host, port });
  });
```

- [ ] **Step 3: Run build and command help**

Run:

```bash
npm run build
node dist/cli.js serve --help
```

Expected: build passes and help output shows `--host` and `--port`.

- [ ] **Step 4: Smoke test server startup**

Run in one terminal:

```bash
node dist/cli.js serve --port 0
```

Expected: output includes `Field Theory web interface: http://127.0.0.1:<port>`. Press Ctrl-C and confirm the process exits.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add ft serve command"
```

---

### Task 6: Final verification and browser QA

**Files:**
- Modify only if verification reveals bugs in `src/web/*` or `src/cli.ts`.

- [ ] **Step 1: Run full automated verification**

```bash
npm run build
npm test
```

Expected: both commands pass.

- [ ] **Step 2: Manual API verification with real or seeded data**

Start the server:

```bash
node dist/cli.js serve --port 3000
```

In another terminal:

```bash
curl -s http://127.0.0.1:3000/api/stats | head -c 300
curl -s 'http://127.0.0.1:3000/api/bookmarks?limit=5' | head -c 300
curl -i 'http://127.0.0.1:3000/api/bookmarks?limit=abc'
curl -i 'http://127.0.0.1:3000/media/..%2F..%2Fsecret'
```

Expected: stats/bookmarks return JSON; invalid limit returns `400`; traversal returns `403` or `404`.

- [ ] **Step 3: Manual browser verification**

Open `http://127.0.0.1:3000` and verify:

- The page loads without console errors.
- Initial bookmarks render.
- Search filters results after a short debounce.
- Category/domain/folder chips filter results.
- Load more appends results.
- Details opens and closes.
- Bookmark text containing HTML-like characters is displayed as text.
- Media images load if a media manifest exists.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git status --short
git add src/web src/cli.ts tests/web-server.test.ts
git commit -m "fix: harden bookmark web interface"
```

---

## Follow-up Phases

1. Add `POST /api/sync` with a per-process CSRF token, job IDs, progress polling, and cancellation.
2. Add a process-local read cache or shared sql.js DB handle only after measuring slow API calls.
3. Replace the vanilla UI with React/Vite only when UI complexity requires it; preserve the JSON API.
4. Add canonical/unified source views after canonical filters support query/category/domain/folder.
