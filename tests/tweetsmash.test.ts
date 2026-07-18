import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJsonLines, readJsonLines } from '../src/fs.js';
import {
  applyTweetsmashEnrichment,
  normalizeImportedAt,
  syncTweetsmash,
  tweetsmashCachePath,
  tweetsmashMetaPath,
  type TweetsmashPost,
} from '../src/tweetsmash.js';
import { twitterBookmarksCachePath } from '../src/paths.js';
import type { BookmarkRecord } from '../src/types.js';

function post(overrides: Partial<TweetsmashPost>): TweetsmashPost {
  return {
    post_id: '1',
    imported_at: '2026-07-18T08:21:13.841838',
    tags: [],
    is_read: false,
    is_archived: false,
    ...overrides,
  };
}

function record(overrides: Partial<BookmarkRecord>): BookmarkRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/a/status/1',
    text: 'tweet',
    syncedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  } as BookmarkRecord;
}

function pageResponse(data: TweetsmashPost[], nextCursor?: string): Response {
  return new Response(JSON.stringify({ status: true, data, meta: { next_cursor: nextCursor ?? null, limit: 100 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ft-tweetsmash-'));
  const saved = { data: process.env.FT_DATA_DIR, key: process.env.TWEETSMASH_API_KEY };
  process.env.FT_DATA_DIR = dir;
  process.env.TWEETSMASH_API_KEY = 'test-key';
  try {
    await fn();
  } finally {
    if (saved.data !== undefined) process.env.FT_DATA_DIR = saved.data;
    else delete process.env.FT_DATA_DIR;
    if (saved.key !== undefined) process.env.TWEETSMASH_API_KEY = saved.key;
    else delete process.env.TWEETSMASH_API_KEY;
  }
}

test('normalizeImportedAt treats naive timestamps as UTC and keeps offsets', () => {
  assert.equal(normalizeImportedAt('2026-07-18T08:21:13.841838'), '2026-07-18T08:21:13.841Z');
  assert.equal(normalizeImportedAt('2026-07-17T15:53:17+00:00'), '2026-07-17T15:53:17.000Z');
  assert.equal(normalizeImportedAt('garbage'), null);
  assert.equal(normalizeImportedAt(null), null);
});

test('syncTweetsmash pages until the end and stops at known posts on later runs', async () => {
  await withDataDir(async () => {
    const pages = [
      pageResponse([post({ post_id: 'a' }), post({ post_id: 'b' })], 'c1'),
      pageResponse([post({ post_id: 'c' })]),
    ];
    let calls = 0;
    const first = await syncTweetsmash({ fetchImpl: (async () => pages[calls++]) as typeof fetch });
    assert.equal(first.newPosts, 3);
    assert.equal(first.complete, true);
    const meta = JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8'));
    assert.equal(meta.resumeCursor, undefined);

    // Second run: first page all-known -> stops without following the cursor.
    let secondCalls = 0;
    const second = await syncTweetsmash({
      fetchImpl: (async () => {
        secondCalls += 1;
        return pageResponse([post({ post_id: 'a' }), post({ post_id: 'b' })], 'c1');
      }) as typeof fetch,
    });
    assert.equal(secondCalls, 1);
    assert.equal(second.newPosts, 0);
    assert.equal(second.complete, true);
  });
});

test('syncTweetsmash persists a resume cursor on 429 and clears it after completion', async () => {
  await withDataDir(async () => {
    let calls = 0;
    const limited = await syncTweetsmash({
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) return pageResponse([post({ post_id: 'a' })], 'cursor-next');
        return new Response('', { status: 429 });
      }) as typeof fetch,
    });
    assert.equal(limited.complete, false);
    assert.equal(JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8')).resumeCursor, 'cursor-next');

    // Resume finishes the crawl and clears the cursor.
    const resumed = await syncTweetsmash({
      fetchImpl: (async () => pageResponse([post({ post_id: 'b' })])) as typeof fetch,
    });
    assert.equal(resumed.complete, true);
    assert.equal(resumed.totalStored, 2);
    assert.equal(JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8')).resumeCursor, undefined);
  });
});

test('applyTweetsmashEnrichment sets dates outside the initial burst, merges tags, flags read state', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await mkdir(path.dirname(twitterBookmarksCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [
      // Initial import burst (earliest imported_at anchors the burst window).
      post({ post_id: 'old', imported_at: '2026-07-01T00:00:00' }),
      post({ post_id: 'old2', imported_at: '2026-07-01T05:00:00' }),
      // Genuine go-forward bookmark, > 48h after earliest import.
      post({ post_id: 'fresh', imported_at: '2026-07-10T12:00:00', tags: ['ai-agents'], is_read: true }),
    ]);
    await writeJsonLines(twitterBookmarksCachePath(), [
      record({ id: 'old', tweetId: 'old' }),
      record({ id: 'old2', tweetId: 'old2', bookmarkedAt: '2026-06-30T00:00:00.000Z' }),
      record({ id: 'fresh', tweetId: 'fresh', tags: ['existing'] }),
      record({ id: 'unmatched', tweetId: 'unmatched' }),
    ]);

    const result = await applyTweetsmashEnrichment();
    assert.equal(result.matched, 3);
    assert.equal(result.datesSet, 1);
    assert.equal(result.burstSkipped, 1);
    assert.equal(result.tagsMerged, 1);
    assert.equal(result.flagged, 3);

    const records = await readJsonLines<BookmarkRecord & { tweetsmashRead?: boolean }>(twitterBookmarksCachePath());
    const byId = new Map(records.map((r) => [r.id, r]));
    assert.equal(byId.get('old')!.bookmarkedAt ?? null, null);
    assert.equal(byId.get('old2')!.bookmarkedAt, '2026-06-30T00:00:00.000Z');
    assert.equal(byId.get('fresh')!.bookmarkedAt, '2026-07-10T12:00:00.000Z');
    assert.deepEqual(byId.get('fresh')!.tags, ['existing', 'ai-agents']);
    assert.equal(byId.get('fresh')!.tweetsmashRead, true);
    assert.equal(byId.get('unmatched')!.tweetsmashRead, undefined);

    // Idempotent: rerun changes nothing further.
    const rerun = await applyTweetsmashEnrichment();
    assert.equal(rerun.datesSet, 0);
    assert.equal(rerun.tagsMerged, 0);
    assert.equal(rerun.flagged, 0);
  });
});
