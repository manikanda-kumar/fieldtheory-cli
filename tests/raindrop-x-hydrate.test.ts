import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLines, readJsonLines } from '../src/fs.js';
import {
  hydrateRaindropXBookmarks,
  isPlaceholderXTitle,
  raindropXHydrationCandidates,
  type RaindropXHydration,
} from '../src/raindrop/x-hydrate.js';
import { raindropSourceFromRecord } from '../src/canonical-bookmarks-db.js';
import type { RaindropRecord } from '../src/raindrop/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-x-hydrate-'));
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

function raindropRecord(overrides: Partial<RaindropRecord> = {}): RaindropRecord {
  return {
    id: 1,
    url: 'https://twitter.com/tferriss/status/1731035921657577883',
    title: '1731035921657577883',
    createdAt: '2026-08-17T03:44:03.931Z',
    domain: 'twitter.com',
    syncedAt: '2026-08-17T05:25:58.263Z',
    ...overrides,
  };
}

test('raindrop x-hydrate: placeholder titles are the bare tweet id, an empty title, or an x.com stub', () => {
  assert.equal(isPlaceholderXTitle('1731035921657577883', '1731035921657577883'), true);
  assert.equal(isPlaceholderXTitle('', '1731035921657577883'), true);
  assert.equal(isPlaceholderXTitle('   ', '1731035921657577883'), true);
  assert.equal(isPlaceholderXTitle('x.com/i/article/2088…', '2088779299667272150'), true);
  assert.equal(isPlaceholderXTitle('Kun Chen on X: "first day impression"', '2080823426261115075'), false);
  // A number short enough to be a real title is left alone.
  assert.equal(isPlaceholderXTitle('1984', '1731035921657577883'), false);
});

test('raindrop x-hydrate: candidates skip X bookmarks, settled attempts, and already-titled saves', () => {
  const records: RaindropRecord[] = [
    raindropRecord({ id: 1, url: 'https://twitter.com/a/status/111', title: '111' }),
    // Already a rich X bookmark: index-time folding covers it.
    raindropRecord({ id: 2, url: 'https://x.com/b/status/222', title: '222' }),
    // Raindrop scraped a real title and excerpt.
    raindropRecord({ id: 3, url: 'https://x.com/c/status/333', title: 'C on X: "hello"', excerpt: 'hello' }),
    // Permanently gone — not worth another fetch.
    raindropRecord({ id: 4, url: 'https://x.com/d/status/444', title: '444' }),
    // Transient failure last time: retry it.
    raindropRecord({ id: 5, url: 'https://x.com/e/status/555', title: '555' }),
    // Not an X link at all.
    raindropRecord({ id: 6, url: 'https://example.com/post', title: 'A post' }),
    // Duplicate save of the same tweet.
    raindropRecord({ id: 7, url: 'https://twitter.com/a/status/111', title: '111' }),
  ];
  const hydration = new Map<string, RaindropXHydration>([
    ['444', { tweetId: '444', status: 'not_found', fetchedAt: '2026-08-17T00:00:00.000Z' }],
    ['555', { tweetId: '555', status: 'rate_limited', fetchedAt: '2026-08-17T00:00:00.000Z' }],
  ]);

  const candidates = raindropXHydrationCandidates(records, hydration, new Set(['222']));
  assert.deepEqual(candidates.map((candidate) => candidate.tweetId), ['111', '555']);
});

test('raindrop x-hydrate: fetched tweet text is cached once and failures are not refetched', async () => {
  await withIsolatedDataDir(async (dir) => {
    await mkdir(path.join(dir, 'raindrop'), { recursive: true });
    await writeJsonLines(path.join(dir, 'raindrop', 'bookmarks.jsonl'), [
      raindropRecord({ id: 1, url: 'https://twitter.com/a/status/111', title: '111' }),
      raindropRecord({ id: 2, url: 'https://x.com/b/status/222', title: '222' }),
    ]);

    const fetched: string[] = [];
    const result = await hydrateRaindropXBookmarks({
      delayMs: 0,
      tweetFetcher: async (tweetId) => {
        fetched.push(tweetId);
        if (tweetId === '111') {
          return {
            status: 'ok',
            source: 'syndication',
            snapshot: {
              id: '111',
              text: 'tweet body',
              authorHandle: 'a',
              authorName: 'A',
              postedAt: 'Sat Dec 02 19:41:39 +0000 2023',
              url: 'https://x.com/a/status/111',
            },
          };
        }
        return { snapshot: null, status: 'not_found', source: 'graphql' };
      },
    });

    assert.deepEqual(fetched, ['111', '222']);
    assert.deepEqual(
      { candidates: result.candidates, hydrated: result.hydrated, failed: result.failed, remaining: result.remaining },
      { candidates: 2, hydrated: 1, failed: 1, remaining: 0 },
    );

    const cached = await readJsonLines<RaindropXHydration>(path.join(dir, 'raindrop', 'x-hydrated.jsonl'));
    assert.equal(cached.length, 2);
    assert.equal(cached.find((row) => row.tweetId === '111')?.text, 'tweet body');

    // Both outcomes are permanent, so a second run fetches nothing.
    const second = await hydrateRaindropXBookmarks({ delayMs: 0, tweetFetcher: async () => {
      throw new Error('should not fetch');
    } });
    assert.equal(second.candidates, 0);
  });
});

test('raindrop x-hydrate: --limit leaves the rest queued', async () => {
  await withIsolatedDataDir(async (dir) => {
    await mkdir(path.join(dir, 'raindrop'), { recursive: true });
    await writeJsonLines(path.join(dir, 'raindrop', 'bookmarks.jsonl'), [
      raindropRecord({ id: 1, url: 'https://x.com/a/status/111', title: '111' }),
      raindropRecord({ id: 2, url: 'https://x.com/b/status/222', title: '222' }),
      raindropRecord({ id: 3, url: 'https://x.com/c/status/333', title: '333' }),
    ]);

    const result = await hydrateRaindropXBookmarks({
      delayMs: 0,
      limit: 1,
      tweetFetcher: async (tweetId) => ({
        status: 'ok',
        source: 'syndication',
        snapshot: { id: tweetId, text: 'body', authorHandle: 'a', url: `https://x.com/a/status/${tweetId}` },
      }),
    });
    assert.deepEqual(
      { attempted: result.attempted, remaining: result.remaining },
      { attempted: 1, remaining: 2 },
    );
  });
});

test('raindrop x-hydrate: transient failures stay queued for the next run', async () => {
  await withIsolatedDataDir(async (dir) => {
    await mkdir(path.join(dir, 'raindrop'), { recursive: true });
    await writeJsonLines(path.join(dir, 'raindrop', 'bookmarks.jsonl'), [
      raindropRecord({ id: 1, url: 'https://x.com/a/status/111', title: '111' }),
      raindropRecord({ id: 2, url: 'https://x.com/b/status/222', title: '222' }),
      raindropRecord({ id: 3, url: 'https://x.com/c/status/333', title: '333' }),
    ]);

    const result = await hydrateRaindropXBookmarks({
      delayMs: 0,
      limit: 2,
      tweetFetcher: async () => ({ snapshot: null, status: 'rate_limited', source: 'syndication' }),
    });
    // 1 skipped by the limit + 2 rate-limited attempts that are not settled.
    assert.deepEqual(
      { attempted: result.attempted, failed: result.failed, remaining: result.remaining },
      { attempted: 2, failed: 2, remaining: 3 },
    );

    const second = await hydrateRaindropXBookmarks({
      dryRun: true,
      tweetFetcher: async () => { throw new Error('should not fetch'); },
    });
    assert.equal(second.candidates, 3);
  });
});

test('raindrop x-hydrate: dry run reports candidates without writing the cache', async () => {
  await withIsolatedDataDir(async (dir) => {
    await mkdir(path.join(dir, 'raindrop'), { recursive: true });
    await writeJsonLines(path.join(dir, 'raindrop', 'bookmarks.jsonl'), [
      raindropRecord({ id: 1, url: 'https://x.com/a/status/111', title: '111' }),
    ]);
    const result = await hydrateRaindropXBookmarks({ dryRun: true, tweetFetcher: async () => {
      throw new Error('should not fetch');
    } });
    assert.equal(result.candidates, 1);
    assert.equal(result.attempted, 0);
    assert.deepEqual(await readJsonLines<RaindropXHydration>(path.join(dir, 'raindrop', 'x-hydrated.jsonl')), []);
  });
});

test('raindrop x-hydrate: hydration gives the canonical source a title, handle, text, and post date', () => {
  const record = raindropRecord({ url: 'https://twitter.com/tferriss/status/111', title: '111' });
  const source = raindropSourceFromRecord(record, {
    tweetId: '111',
    status: 'ok',
    fetchedAt: '2026-08-18T02:52:10.034Z',
    authorHandle: 'tferriss',
    authorName: 'Tim Ferriss',
    text: 'What benefit do I get from the conditions I say I don’t want?',
    postedAt: 'Sat Dec 02 19:41:39 +0000 2023',
  });

  assert.equal(source?.title, '@tferriss: What benefit do I get from the conditions I say I don’t want?');
  assert.equal(source?.authorHandle, '@tferriss');
  assert.equal(source?.text?.startsWith('What benefit do I get'), true);
  assert.equal(source?.createdAt, '2023-12-02T19:41:39.000Z');
  // The save date is what digest windows use, so it stays the Raindrop date.
  assert.equal(source?.savedAt, '2026-08-17T03:44:03.931Z');
});

test('raindrop x-hydrate: an un-hydrated X save drops the bare id rather than inventing a title', () => {
  // The title must stay empty: a Raindrop title outranks the X source in
  // buildCanonicalGroup, so a synthetic one would hide real tweet text when the
  // same tweet is also an X bookmark. The handle-only title is applied there.
  const source = raindropSourceFromRecord(raindropRecord({ url: 'https://x.com/emollick/status/222', title: '222' }));
  assert.equal(source?.title, null);
  assert.equal(source?.authorHandle, '@emollick');
  assert.equal(source?.createdAt, '2026-08-17T03:44:03.931Z');

  // A tweet id title long enough to be a real title is left untouched, as is a
  // non-X save.
  const real = raindropSourceFromRecord(raindropRecord({
    url: 'https://example.com/post',
    title: 'A real title',
    domain: 'example.com',
  }));
  assert.equal(real?.title, 'A real title');
  assert.equal(real?.authorHandle, 'example.com');
});

test('raindrop x-hydrate: a long tweet is trimmed for the title but kept whole in the text', () => {
  const body = 'x'.repeat(400);
  const source = raindropSourceFromRecord(
    raindropRecord({ url: 'https://x.com/a/status/333', title: '333' }),
    { tweetId: '333', status: 'ok', fetchedAt: '2026-08-18T00:00:00.000Z', authorHandle: 'a', text: body },
  );
  assert.equal(source?.title?.length, '@a: '.length + 121);
  assert.equal(source?.title?.endsWith('…'), true);
  assert.equal(source?.text?.includes(body), true);
});

test('raindrop x-hydrate: a not_found tweet keeps no title and the Raindrop date', () => {
  const source = raindropSourceFromRecord(
    raindropRecord({ url: 'https://x.com/gone/status/444', title: '444' }),
    { tweetId: '444', status: 'not_found', fetchedAt: '2026-08-18T00:00:00.000Z' },
  );
  assert.equal(source?.title, null);
  assert.equal(source?.createdAt, '2026-08-17T03:44:03.931Z');
});

test('raindrop x-hydrate: X bookmark records are unaffected by hydration plumbing', () => {
  // Guard against the canonical fold regressing: a raindrop save whose tweet is
  // also an X bookmark keeps Raindrop's own title when Raindrop had a real one.
  const record = raindropRecord({
    url: 'https://x.com/kunchenguid/status/2080823426261115075',
    title: 'Kun Chen on X: "first day impression for Opus 5"',
    excerpt: 'first day impression',
  });
  const source = raindropSourceFromRecord(record);
  assert.equal(source?.title, 'Kun Chen on X: "first day impression for Opus 5"');
  assert.equal(source?.authorHandle, '@kunchenguid');
});
