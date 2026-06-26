import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { parseBoundedInteger, safeRoutePath } from '../src/web/http.js';
import { loadWebMediaIndex, resolveMediaFile } from '../src/web/media.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterBookmarksIndexPath, xListsDir } from '../src/paths.js';
import { createBookmarkWebServer } from '../src/web/server.js';
import { renderAppShell, appCss, appJs } from '../src/web/app-shell.js';

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
  assert.equal(safeRoutePath('not a url'), '/not a url');
});

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

async function withTempFieldTheoryData<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const previous = process.env.FT_DATA_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-data-'));
  process.env.FT_DATA_DIR = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
}

async function seedBookmarks(root: string): Promise<void> {
  await writeFile(path.join(root, 'bookmarks.jsonl'), `${JSON.stringify({
    id: 'b1',
    tweetId: '100',
    url: 'https://x.com/alice/status/100',
    text: 'Machine learning systems note',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-06-20T00:00:00.000Z',
    bookmarkedAt: '2026-06-21T00:00:00.000Z',
    syncedAt: '2026-06-21T00:00:00.000Z',
    links: ['https://example.com/article'],
    folderIds: ['f1'],
    folderNames: ['Research'],
    tags: [],
    ingestedVia: 'graphql',
  })}\n`);
  await buildIndex();

  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    db.run(
      `UPDATE bookmarks SET categories = ?, primary_category = ?, domains = ?, primary_domain = ? WHERE id = ?`,
      [JSON.stringify(['AI']), 'AI', JSON.stringify(['ml']), 'ml', 'b1'],
    );
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
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
  await withTempFieldTheoryData(async () => {
    await seedBookmarks(process.env.FT_DATA_DIR!);
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
  await withTempFieldTheoryData(async () => {
    await seedBookmarks(process.env.FT_DATA_DIR!);
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

test('app shell includes root element and static asset links', () => {
  const html = renderAppShell();
  assert.match(html, /<div id="app" class="site-shell">/);
  assert.match(html, /class="nav-link active"/);
  assert.match(appCss, /\.nav-link/);
  assert.match(html, /\/styles\.css/);
  assert.match(html, /\/app\.js/);
  assert.match(appCss, /\.bookmark-card/);
  assert.match(appCss, /\.results-feed/);
  assert.match(appCss, /\.tweet-card/);
  assert.match(appCss, /\.link-preview/);
  assert.match(appJs, /renderMediaObjects/);
  assert.match(appJs, /fetchBookmarks/);
  assert.doesNotMatch(html, /<script>.*bookmark/s);
  for (const lane of ['home', 'today', 'analyze', 'map', 'sources', 'discuss']) {
    assert.match(html, new RegExp(`data-lane="${lane}"`));
  }
  assert.match(appJs, /renderTodayLane/);
  assert.match(appJs, /renderSourcesLane/);
  assert.match(appJs, /renderDiscussLane/);
});

test('web API validates link preview requests', async () => {
  await withTempFieldTheoryData(async () => {
    const server = await startTestServer();
    try {
      assert.equal((await fetch(`${server.baseUrl}/api/link-preview`)).status, 400);
      assert.equal((await fetch(`${server.baseUrl}/api/link-preview?url=not-a-url`)).status, 400);
    } finally {
      await server.close();
    }
  });
});

test('web API serves list-backed today digest surfaces', async () => {
  await withTempFieldTheoryData(async () => {
    const xListDir = xListsDir();
    await mkdir(xListDir, { recursive: true });
    await writeFile(path.join(xListDir, '197-latest.json'), JSON.stringify({
      listId: '197',
      fetchedAt: '2026-06-24T12:00:00.000Z',
      tweets: [{
        id: '1',
        timelineKind: 'list-tweet',
        url: 'https://x.com/alice/status/1',
        author: 'alice',
        authorName: 'Alice',
        postedAt: '2026-06-24T10:00:00.000Z',
        text: 'Agents paper https://arxiv.org/abs/1234.5678',
        links: ['https://arxiv.org/abs/1234.5678'],
        engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
      }],
      stats: { count: 1, fetchedCount: 1, timeFilteredCount: 0, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'no-cursor', sinceHours: 24 },
    }));

    const server = await startTestServer();
    try {
      const today = await fetch(`${server.baseUrl}/api/lists/197/today`);
      assert.equal(today.status, 200);
      assert.equal(((await today.json()) as { tweets: unknown[] }).tweets.length, 1);

      const analysis = await fetch(`${server.baseUrl}/api/lists/197/analysis`);
      assert.equal(analysis.status, 200);
      assert.equal(((await analysis.json()) as { totalTweets: number }).totalTweets, 1);

      const sources = await fetch(`${server.baseUrl}/api/lists/197/sources`);
      assert.equal(sources.status, 200);
      assert.equal(((await sources.json()) as { sources: unknown[] }).sources.length, 1);

      const context = await fetch(`${server.baseUrl}/api/lists/197/context`);
      assert.equal(context.status, 200);
      assert.match(await context.text(), /X List 197 Today Context/);
    } finally {
      await server.close();
    }
  });
});