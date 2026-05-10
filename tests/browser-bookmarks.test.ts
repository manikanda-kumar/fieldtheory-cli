import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromiumWebkitTimeToIso, parseChromiumBookmarks, syncBrowserBookmarks } from '../src/browser-bookmarks.js';

test('chromiumWebkitTimeToIso converts Chromium microseconds since 1601', () => {
  assert.equal(chromiumWebkitTimeToIso('0'), null);
  assert.equal(chromiumWebkitTimeToIso(undefined), null);
  assert.equal(chromiumWebkitTimeToIso('not-a-number'), null);
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
          {
            type: 'folder',
            id: '11',
            name: 'Dev',
            children: [
              { type: 'url', id: '12', name: 'Repo', url: 'https://github.com/acme/tool' },
            ],
          },
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

test('parseChromiumBookmarks defaults missing title to URL and ignores non-url nodes', () => {
  const parsed = parseChromiumBookmarks({
    roots: {
      other: {
        type: 'folder',
        name: 'Other Bookmarks',
        children: [
          { type: 'url', id: '20', url: 'https://example.org' },
          { type: 'folder', id: '21', name: 'Empty' },
          { type: 'url', id: '22', name: 'Missing URL' },
        ],
      },
    },
  }, { browser: 'vivaldi', profile: 'Profile 1', syncedAt: '2026-05-10T00:00:00.000Z' });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'vivaldi:Profile 1:20');
  assert.equal(parsed[0].title, 'https://example.org');
});

test('syncBrowserBookmarks writes Chromium bookmarks to browser cache and metadata', async () => {
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
    }), 'utf8');

    const result = await syncBrowserBookmarks({ browser: 'chrome', profile: 'Default', bookmarksPath });
    const raw = await readFile(result.cachePath, 'utf8');
    const records = raw.trim().split('\n').map((line) => JSON.parse(line));
    const metaRaw = await readFile(path.join(dir, 'browsers', 'chrome', 'Default', 'meta.json'), 'utf8');
    const meta = JSON.parse(metaRaw);

    assert.equal(result.synced, 2);
    assert.equal(result.cachePath, path.join(dir, 'browsers', 'chrome', 'Default', 'bookmarks.jsonl'));
    assert.equal(records[0].browser, 'chrome');
    assert.equal(records[0].syncedAt, meta.syncedAt);
    assert.equal(meta.synced, 2);
    assert.equal(meta.sourcePath, bookmarksPath);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncBrowserBookmarks fails clearly for Safari until plist parsing exists', async () => {
  await assert.rejects(
    syncBrowserBookmarks({ browser: 'safari', profile: 'default', bookmarksPath: '/tmp/Bookmarks.plist' }),
    /Safari bookmark sync is not supported yet/,
  );
});
