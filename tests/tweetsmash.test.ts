import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJsonLines, readJsonLines } from '../src/fs.js';
import {
  applyTweetsmashEnrichment,
  normalizeImportedAt,
  syncTweetsmash,
  tweetsmashCachePath,
  tweetsmashMetaPath,
  tweetsmashRebuildSeenPath,
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
    assert.equal(first.updatedPosts, 0);
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
    assert.equal(second.updatedPosts, 0);
    assert.equal(second.complete, true);
  });
});

test('syncTweetsmash follows changed known pages until label updates reach stable data', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [
      post({ post_id: 'a', tags: [] }),
      post({ post_id: 'b', tags: [] }),
    ]);

    const pages = [
      pageResponse([post({ post_id: 'a', tags: ['agents'] })], 'c1'),
      pageResponse([post({ post_id: 'b', tags: [] })], 'c2'),
    ];
    let calls = 0;
    const result = await syncTweetsmash({ fetchImpl: (async () => pages[calls++]) as typeof fetch });

    assert.equal(calls, 2);
    assert.equal(result.newPosts, 0);
    assert.equal(result.updatedPosts, 1);
    assert.equal(result.complete, true);
    const stored = await readJsonLines<TweetsmashPost>(tweetsmashCachePath());
    assert.deepEqual(stored.find((item) => item.post_id === 'a')?.tags, ['agents']);
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

test('syncTweetsmash rebuild keeps the cache and continues across rate-limited runs', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [
      post({ post_id: 'a', tags: ['stale'] }),
      post({ post_id: 'b', tags: ['stale'] }),
      post({ post_id: 'c', tags: ['stale'] }),
    ]);

    const urls: string[] = [];
    let calls = 0;
    const first = await syncTweetsmash({
      rebuild: true,
      fetchImpl: (async (url: URL) => {
        urls.push(url.searchParams.get('cursor') ?? '');
        calls += 1;
        if (calls === 1) return pageResponse([post({ post_id: 'a', tags: ['agent'] })], 'cursor-2');
        return new Response('', { status: 429 });
      }) as typeof fetch,
    });
    assert.equal(first.rebuildPending, true);
    assert.equal(first.rateLimited, true);
    // The partial rebuild must not drop posts it has not refetched yet.
    const cached = await readJsonLines<TweetsmashPost>(tweetsmashCachePath());
    assert.deepEqual(cached.map((p) => [p.post_id, p.tags]), [['a', ['agent']], ['b', ['stale']], ['c', ['stale']]]);
    const meta = JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8'));
    assert.equal(meta.resumeCursor, 'cursor-2');
    assert.ok(meta.rebuildStartedAt);

    // Repeating --rebuild continues from the cursor instead of restarting,
    // and known unchanged pages do not trigger the incremental stop.
    const pages: Record<string, Response> = {
      'cursor-2': pageResponse([post({ post_id: 'b', tags: ['stale'] })], 'cursor-3'),
      'cursor-3': pageResponse([post({ post_id: 'c' })]),
    };
    const second = await syncTweetsmash({
      rebuild: true,
      fetchImpl: (async (url: URL) => {
        const cursor = url.searchParams.get('cursor') ?? '';
        urls.push(cursor);
        return pages[cursor];
      }) as typeof fetch,
    });
    assert.equal(second.complete, true);
    assert.equal(second.rebuildPending, false);
    assert.deepEqual(urls, ['', 'cursor-2', 'cursor-2', 'cursor-3']);
    const finalMeta = JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8'));
    assert.equal(finalMeta.resumeCursor, undefined);
    assert.equal(finalMeta.rebuildStartedAt, undefined);
    const final = await readJsonLines<TweetsmashPost>(tweetsmashCachePath());
    assert.deepEqual(final.find((p) => p.post_id === 'c')?.tags, []);
  });
});

test('syncTweetsmash rebuild keeps its cursor on a page-capped stop', async () => {
  await withDataDir(async () => {
    const result = await syncTweetsmash({
      rebuild: true,
      maxPages: 1,
      fetchImpl: (async () => pageResponse([post({ post_id: 'a' })], 'cursor-2')) as typeof fetch,
    });
    assert.equal(result.rebuildPending, true);
    assert.equal(JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8')).resumeCursor, 'cursor-2');

    // A plain incremental page-capped stop still clears it.
    await syncTweetsmash({
      maxPages: 1,
      fetchImpl: (async () => pageResponse([post({ post_id: 'b' })])) as typeof fetch,
    });
    const meta = JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8'));
    assert.equal(meta.resumeCursor, undefined);
  });
});

test('syncTweetsmash waits through 429s when asked and honors Retry-After', async () => {
  await withDataDir(async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await syncTweetsmash({
      waitOnRateLimit: true,
      sleep: async (ms) => {
        slept.push(ms);
        // The cursor is saved before sleeping so an interrupted wait resumes.
        assert.equal(JSON.parse(await readFile(tweetsmashMetaPath(), 'utf8')).resumeCursor, 'cursor-2');
      },
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) return pageResponse([post({ post_id: 'a' })], 'cursor-2');
        if (calls === 2) return new Response('', { status: 429, headers: { 'retry-after': '90' } });
        return pageResponse([post({ post_id: 'b' })]);
      }) as typeof fetch,
    });
    assert.deepEqual(slept, [90_000]);
    assert.equal(result.complete, true);
    assert.equal(result.rateLimited, false);
    assert.equal(result.totalStored, 2);
  });
});

test('applyTweetsmashEnrichment sets dates, mirrors labels, and flags read state', async () => {
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
    assert.equal(result.tagsUpdated, 1);
    assert.equal(result.flagged, 3);

    const records = await readJsonLines<BookmarkRecord & { tweetsmashRead?: boolean }>(twitterBookmarksCachePath());
    const byId = new Map(records.map((r) => [r.id, r]));
    assert.equal(byId.get('old')!.bookmarkedAt ?? null, null);
    assert.equal(byId.get('old2')!.bookmarkedAt, '2026-06-30T00:00:00.000Z');
    assert.equal(byId.get('fresh')!.bookmarkedAt, '2026-07-10T12:00:00.000Z');
    assert.equal(byId.get('fresh')!.bookmarkedAtSource, 'tweetsmash');
    assert.equal(byId.get('old2')!.bookmarkedAtSource ?? null, null);
    assert.deepEqual(byId.get('fresh')!.tags, ['existing', 'ai-agents']);
    assert.deepEqual(byId.get('fresh')!.tweetsmashTags, ['ai-agents']);
    assert.equal(byId.get('fresh')!.tweetsmashRead, true);
    assert.equal(byId.get('unmatched')!.tweetsmashRead, undefined);

    // Idempotent: rerun changes nothing further.
    const rerun = await applyTweetsmashEnrichment();
    assert.equal(rerun.datesSet, 0);
    assert.equal(rerun.tagsUpdated, 0);
    assert.equal(rerun.flagged, 0);
  });
});

test('applyTweetsmashEnrichment removes stale Tweetsmash labels but preserves other tags', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await mkdir(path.dirname(twitterBookmarksCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [
      post({ post_id: 'changed', tags: ['prompting'] }),
      post({ post_id: 'cleared', tags: [] }),
    ]);
    await writeJsonLines(twitterBookmarksCachePath(), [
      record({
        id: 'changed',
        tweetId: 'changed',
        tags: ['favorite', 'agents'],
        tweetsmashTags: ['agents'],
      }),
      record({
        id: 'cleared',
        tweetId: 'cleared',
        tags: ['favorite', 'agents'],
        tweetsmashTags: ['agents'],
      }),
    ]);

    const result = await applyTweetsmashEnrichment();
    assert.equal(result.tagsUpdated, 2);

    const records = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
    const byId = new Map(records.map((item) => [item.id, item]));
    assert.deepEqual(byId.get('changed')?.tags, ['favorite', 'prompting']);
    assert.deepEqual(byId.get('changed')?.tweetsmashTags, ['prompting']);
    assert.deepEqual(byId.get('cleared')?.tags, ['favorite']);
    assert.deepEqual(byId.get('cleared')?.tweetsmashTags, []);
  });
});

test('applyTweetsmashEnrichment adopts legacy Tweetsmash labels so removals mirror', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await mkdir(path.dirname(twitterBookmarksCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [
      post({ post_id: 'kept', tags: ['agent'] }),
      post({ post_id: 'cleared', tags: [] }),
    ]);
    // Pre-ownership records: labels merged into `tags` with no tweetsmashTags.
    await writeJsonLines(twitterBookmarksCachePath(), [
      record({ id: 'kept', tweetId: 'kept', tags: ['agent'] }),
      record({ id: 'cleared', tweetId: 'cleared', tags: ['agent', 'favorite'] }),
    ]);

    await applyTweetsmashEnrichment();

    const byId = new Map((await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath())).map((item) => [item.id, item]));
    assert.deepEqual(byId.get('kept')?.tags, ['agent']);
    assert.deepEqual(byId.get('kept')?.tweetsmashTags, ['agent']);
    assert.deepEqual(byId.get('cleared')?.tags, ['favorite']);
    assert.deepEqual(byId.get('cleared')?.tweetsmashTags, []);
  });
});

test('syncTweetsmash prunes posts a completed rebuild no longer sees, across resumed runs', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [post({ post_id: 'a' }), post({ post_id: 'b' }), post({ post_id: 'gone' })]);

    let calls = 0;
    await syncTweetsmash({
      rebuild: true,
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) return pageResponse([post({ post_id: 'a' })], 'cursor-2');
        return new Response('', { status: 429 });
      }) as typeof fetch,
    });
    // Partial rebuild prunes nothing and records what it has seen.
    assert.equal((await readJsonLines<TweetsmashPost>(tweetsmashCachePath())).length, 3);
    assert.deepEqual(JSON.parse(await readFile(tweetsmashRebuildSeenPath(), 'utf8')), ['a']);

    const done = await syncTweetsmash({
      fetchImpl: (async () => pageResponse([post({ post_id: 'b' })])) as typeof fetch,
    });
    assert.equal(done.complete, true);
    assert.equal(done.pruned, 1);
    const ids = (await readJsonLines<TweetsmashPost>(tweetsmashCachePath())).map((p) => p.post_id).sort();
    assert.deepEqual(ids, ['a', 'b']);
    await assert.rejects(readFile(tweetsmashRebuildSeenPath(), 'utf8'));
  });
});

test('syncTweetsmash skips pruning when a continued rebuild has no seen-id record', async () => {
  await withDataDir(async () => {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [post({ post_id: 'a' }), post({ post_id: 'old' })]);
    await writeFile(tweetsmashMetaPath(), JSON.stringify({ resumeCursor: 'cursor-2', rebuildStartedAt: '2026-09-14T00:00:00.000Z' }));

    const result = await syncTweetsmash({
      fetchImpl: (async () => pageResponse([post({ post_id: 'a' })])) as typeof fetch,
    });
    assert.equal(result.complete, true);
    assert.equal(result.pruned, 0);
    assert.equal(result.totalStored, 2);
  });
});
