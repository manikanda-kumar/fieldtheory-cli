import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLines } from '../src/fs.js';
import {
  classifyCanonicalBookmarks,
  formatCanonicalSearchResults,
  getCanonicalBookmarkById,
  listCanonicalBookmarks,
  rebuildCanonicalIndex,
  searchCanonicalBookmarks,
} from '../src/canonical-bookmarks-db.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterBookmarksIndexPath } from '../src/paths.js';
import type { RaindropRecord } from '../src/raindrop/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-canonical-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeRaindropBookmarks(dir: string, records: RaindropRecord[]): Promise<void> {
  const raindropDir = path.join(dir, 'raindrop');
  await mkdir(raindropDir, { recursive: true });
  await writeJsonLines(path.join(raindropDir, 'bookmarks.jsonl'), records);
}

test('rebuildCanonicalIndex dedupes X external link with raindrop bookmark URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Great repo https://github.com/example/tool',
      links: ['https://github.com/example/tool?utm_source=x'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 2);
    assert.deepEqual(matches[0].sources.sort(), ['raindrop', 'x']);

    const listed = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(listed[0].displayTitle, 'Acme Tool');
    assert.equal(listed[0].sourceCount, 2);
    assert.deepEqual(listed[0].sources.sort(), ['raindrop', 'x']);

    const byId = await getCanonicalBookmarkById(listed[0].id);
    assert.ok(byId);
    assert.equal(byId.sourceCount, 2);
  });
});

test('rebuildCanonicalIndex stores raindrop source rows with null target_url', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();

    const db = await openDb(twitterBookmarksIndexPath());
    try {
      const row = db.exec(
        `SELECT source_url, target_url
         FROM bookmark_sources
         WHERE id = ?`,
        ['raindrop:10'],
      )[0]?.values?.[0];
      assert.deepEqual(row, ['https://github.com/example/tool', null]);
    } finally {
      db.close();
    }
  });
});

test('formatCanonicalSearchResults includes title, source badges, url, and empty message', () => {
  const formatted = formatCanonicalSearchResults([{
    id: 'canonical:1',
    canonicalUrl: 'https://github.com/example/tool',
    displayTitle: 'Acme Tool',
    searchText: 'Acme Tool',
    sourceCount: 2,
    sources: ['raindrop', 'x'],
    categories: 'tool',
    primaryCategory: 'tool',
    domains: 'github.com',
    primaryDomain: 'github.com',
  }]);

  assert.match(formatted, /Acme Tool/);
  assert.match(formatted, /\[raindrop\]/);
  assert.match(formatted, /\[x\]/);
  assert.match(formatted, /https:\/\/github\.com\/example\/tool/);
  assert.match(formatted, /tool/);
  assert.match(formatted, /github\.com/);
  assert.equal(formatCanonicalSearchResults([]), 'No unified bookmarks found.');
});

test('classifyCanonicalBookmarks classifies raindrop-only GitHub bookmarks as tool', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), []);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev', 'Tools'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const summary = await classifyCanonicalBookmarks();
    assert.deepEqual(summary, { total: 1, classified: 1 });

    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(rows[0].primaryCategory, 'tool');
    assert.equal(rows[0].categories, 'tool');
    assert.equal(rows[0].primaryDomain, 'github.com');
    assert.equal(rows[0].domains, 'github.com');
    assert.deepEqual(rows[0].sources, ['raindrop']);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, rows[0].id);
  });
});

test('rebuildCanonicalIndex does not dedupe X bookmark with multiple external links against raindrop URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Two useful links',
      links: [
        'https://github.com/example/tool',
        'https://example.com/other',
      ],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 2);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 1);
    assert.deepEqual(matches[0].sources, ['raindrop']);
  });
});

test('rebuildCanonicalIndex skips malformed raindrop URLs without crashing', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [
      {
        id: 10,
        url: 'https://example.com/ok',
        title: 'Good',
        createdAt: '2026-05-10T00:00:00.000Z',
        syncedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        id: 11,
        url: 'not a valid url',
        title: 'Bad',
        createdAt: '2026-05-10T00:00:00.000Z',
        syncedAt: '2026-05-10T00:00:00.000Z',
      },
    ]);

    const result = await rebuildCanonicalIndex();
    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });

    assert.equal(result.sourceCount, 1);
    assert.equal(result.canonicalCount, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://example.com/ok');
  });
});

test('rebuildCanonicalIndex preserves canonical classification metadata across rebuilds', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();

    const dbPath = twitterBookmarksIndexPath();
    const db = await openDb(dbPath);
    try {
      db.run(
        `UPDATE canonical_bookmarks
         SET categories = ?, primary_category = ?, domains = ?, primary_domain = ?`,
        ['tool,launch', 'tool', 'github.com', 'github.com'],
      );
      saveDb(db, dbPath);
    } finally {
      db.close();
    }

    await rebuildCanonicalIndex();

    const after = await openDb(dbPath);
    try {
      const row = after.exec(
        `SELECT categories, primary_category, domains, primary_domain
         FROM canonical_bookmarks`,
      )[0]?.values[0];
      assert.deepEqual(row, ['tool,launch', 'tool', 'github.com', 'github.com']);
    } finally {
      after.close();
    }
  });
});

test('searchCanonicalBookmarks treats FTS punctuation as literal query text', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://example.com/foo',
      title: 'foo(bar) notes',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const matches = await searchCanonicalBookmarks({ query: 'foo(bar)', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'foo(bar) notes');
  });
});

test('rebuildCanonicalIndex migrates older canonical tables without classification columns', async () => {
  await withIsolatedDataDir(async (dir) => {
    const dbPath = twitterBookmarksIndexPath();
    const db = await openDb(dbPath);
    try {
      db.run(`CREATE TABLE canonical_bookmarks (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT UNIQUE NOT NULL,
        canonical_url TEXT,
        display_title TEXT,
        search_text TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        first_saved_at TEXT,
        last_saved_at TEXT,
        sources_json TEXT
      )`);
      db.run(`CREATE TABLE bookmark_sources (
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
      )`);
      saveDb(db, dbPath);
    } finally {
      db.close();
    }

    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const summary = await classifyCanonicalBookmarks();
    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });

    assert.deepEqual(summary, { total: 1, classified: 1 });
    assert.equal(rows[0].primaryCategory, 'tool');
  });
});
