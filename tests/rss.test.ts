import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFeedXml, toRssItemRecord } from '../src/rss/parse.js';
import { dedupeFeeds, upsertRssFeeds } from '../src/rss/feeds.js';
import { syncRss } from '../src/rss/sync.js';
import { rssSourceFromRecord } from '../src/canonical-bookmarks-db.js';
import type { RssItemRecord } from '../src/rss/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-rss-'));
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

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <item>
      <title>Hello World</title>
      <link>https://example.com/hello</link>
      <guid>https://example.com/hello</guid>
      <pubDate>Mon, 01 Aug 2026 12:00:00 GMT</pubDate>
      <description>A short post.</description>
      <author>ada@example.com</author>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom-entry" rel="alternate"/>
    <id>urn:uuid:1234</id>
    <updated>2026-08-01T10:00:00Z</updated>
    <summary>Summary text</summary>
    <author><name>Grace</name></author>
  </entry>
</feed>`;

test('parseFeedXml parses RSS 2.0 items', () => {
  const feed = parseFeedXml(SAMPLE_RSS);
  assert.equal(feed.title, 'Example Blog');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]?.title, 'Hello World');
  assert.equal(feed.items[0]?.link, 'https://example.com/hello');
  assert.equal(feed.items[0]?.publishedAt, '2026-08-01T12:00:00.000Z');
});

test('parseFeedXml parses Atom entries', () => {
  const feed = parseFeedXml(SAMPLE_ATOM);
  assert.equal(feed.title, 'Atom Blog');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]?.link, 'https://example.com/atom-entry');
  assert.equal(feed.items[0]?.author, 'Grace');
  assert.equal(feed.items[0]?.publishedAt, '2026-08-01T10:00:00.000Z');
});

test('dedupeFeeds merges by URL case-insensitively', () => {
  const feeds = dedupeFeeds([
    { name: 'A', url: 'https://Example.com/feed' },
    { name: 'B', url: 'https://example.com/feed' },
    { name: 'C', url: 'https://other.dev/rss.xml' },
  ]);
  assert.equal(feeds.length, 2);
  assert.equal(feeds.find((f) => f.url.includes('example.com'))?.name, 'B');
});

test('rssSourceFromRecord maps into canonical source shape', () => {
  const record: RssItemRecord = {
    id: 'abc',
    feedUrl: 'https://blog.example/feed',
    feedName: 'Example',
    title: 'Post',
    link: 'https://blog.example/post',
    guid: null,
    summary: 'Hi',
    author: 'Ada',
    publishedAt: '2026-08-01T00:00:00.000Z',
    syncedAt: '2026-08-01T01:00:00.000Z',
  };
  const source = rssSourceFromRecord(record);
  assert.ok(source);
  assert.equal(source.source, 'rss');
  assert.equal(source.sourceUrl, record.link);
  assert.equal(source.savedAt, record.publishedAt);
  assert.deepEqual(source.folderPath, ['RSS', 'Example']);
});

test('syncRss fetches, caches items, and is idempotent', async () => {
  await withIsolatedDataDir(async (dir) => {
    await upsertRssFeeds([{ name: 'Example', url: 'https://example.com/feed.rss' }], { replace: true });

    const fetchImpl: typeof fetch = async () =>
      new Response(SAMPLE_RSS, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      });

    const first = await syncRss({
      fetchImpl,
      now: () => '2026-08-01T12:00:00.000Z',
      concurrency: 1,
    });
    assert.equal(first.feedsFetched, 1);
    assert.equal(first.itemsAdded, 1);
    assert.equal(first.totalItems, 1);

    const cache = path.join(dir, 'rss', 'items.jsonl');
    const lines = (await readFile(cache, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);

    const second = await syncRss({
      fetchImpl,
      now: () => '2026-08-01T13:00:00.000Z',
      concurrency: 1,
    });
    assert.equal(second.itemsAdded, 0);
    assert.equal(second.totalItems, 1);
  });
});

test('syncRss retries a feed that aborts once and counts it as fetched', async () => {
  await withIsolatedDataDir(async () => {
    await upsertRssFeeds([{ name: 'Example', url: 'https://example.com/feed.rss' }], { replace: true });

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('This operation was aborted');
      return new Response(SAMPLE_RSS, { status: 200 });
    };

    const result = await syncRss({
      fetchImpl,
      now: () => '2026-08-15T12:00:00.000Z',
      concurrency: 1,
      sleep: async () => {},
    });

    assert.equal(calls, 2);
    assert.equal(result.feedsFetched, 1);
    assert.equal(result.feedsFailed, 0);
    assert.equal(result.itemsAdded, 1);
  });
});

test('syncRss stops retrying a feed at the attempt budget', async () => {
  await withIsolatedDataDir(async () => {
    await upsertRssFeeds([{ name: 'Example', url: 'https://example.com/feed.rss' }], { replace: true });

    let calls = 0;
    const result = await syncRss({
      fetchImpl: async () => { calls += 1; throw new Error('This operation was aborted'); },
      now: () => '2026-08-15T12:00:00.000Z',
      concurrency: 1,
      sleep: async () => {},
    });

    assert.equal(calls, 3);
    assert.equal(result.feedsFailed, 1);
    assert.match(result.failures[0].error, /aborted/);
  });
});

test('syncRss does not retry a deterministic HTTP error', async () => {
  await withIsolatedDataDir(async () => {
    await upsertRssFeeds([{ name: 'Example', url: 'https://example.com/feed.rss' }], { replace: true });

    let calls = 0;
    const result = await syncRss({
      fetchImpl: async () => { calls += 1; return new Response('nope', { status: 404 }); },
      now: () => '2026-08-15T12:00:00.000Z',
      concurrency: 1,
      sleep: async () => {},
    });

    assert.equal(calls, 1);
    assert.equal(result.feedsFailed, 1);
  });
});

test('syncRss dry-run does not write cache', async () => {
  await withIsolatedDataDir(async (dir) => {
    await upsertRssFeeds([{ name: 'Example', url: 'https://example.com/feed.rss' }], { replace: true });
    await syncRss({
      dryRun: true,
      fetchImpl: async () => new Response(SAMPLE_RSS, { status: 200 }),
      concurrency: 1,
    });
    await assert.rejects(() => readFile(path.join(dir, 'rss', 'items.jsonl'), 'utf8'));
  });
});
