import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLines } from '../src/fs.js';
import {
  classifyCanonicalBookmarks,
  listCanonicalBookmarks,
  rebuildCanonicalIndex,
  searchCanonicalBookmarks,
} from '../src/canonical-bookmarks-db.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterBookmarksIndexPath } from '../src/paths.js';

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

async function writeBrowserBookmarks(dir: string, records: unknown[]): Promise<void> {
  const browserCacheDir = path.join(dir, 'browsers', 'chrome', 'Default');
  await mkdir(browserCacheDir, { recursive: true });
  await writeJsonLines(path.join(browserCacheDir, 'bookmarks.jsonl'), records);
}

test('rebuildCanonicalIndex dedupes X external link with browser bookmark URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Great repo https://github.com/example/tool',
      links: ['https://github.com/example/tool?utm_source=x'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 2);
    assert.deepEqual(matches[0].sources.sort(), ['chrome:Default', 'x']);
  });
});

test('classifyCanonicalBookmarks classifies browser-only GitHub bookmarks as tool', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), []);
    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      folderPath: ['Dev', 'Tools'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    const summary = await classifyCanonicalBookmarks();
    assert.deepEqual(summary, { total: 1, classified: 1 });

    const rows = await listCanonicalBookmarks({ source: 'chrome', limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(rows[0].primaryCategory, 'tool');
    assert.equal(rows[0].categories, 'tool');
    assert.equal(rows[0].primaryDomain, 'github.com');
    assert.equal(rows[0].domains, 'github.com');
    assert.deepEqual(rows[0].sources, ['chrome:Default']);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, rows[0].id);
  });
});

test('rebuildCanonicalIndex does not dedupe X bookmark with multiple external links against browser URL', async () => {
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
    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 2);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 1);
    assert.deepEqual(matches[0].sources, ['chrome:Default']);
  });
});

test('rebuildCanonicalIndex preserves canonical classification metadata across rebuilds', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });

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

    await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });

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
    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://example.com/foo',
      title: 'foo(bar) notes',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
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

    await writeBrowserBookmarks(dir, [{
      id: 'chrome:Default:10',
      browser: 'chrome',
      profile: 'Default',
      sourceItemId: '10',
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      folderPath: ['Dev'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex({ browserSources: [{ browser: 'chrome', profile: 'Default' }] });
    const summary = await classifyCanonicalBookmarks();
    const rows = await listCanonicalBookmarks({ source: 'chrome', limit: 10 });

    assert.deepEqual(summary, { total: 1, classified: 1 });
    assert.equal(rows[0].primaryCategory, 'tool');
  });
});
