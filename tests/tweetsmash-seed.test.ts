import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonLines, writeJsonLines } from '../src/fs.js';
import { raindropBookmarksCachePath } from '../src/raindrop/paths.js';
import { seedTweetsmashLabelsFromRaindrop } from '../src/tweetsmash-seed.js';
import { tweetsmashCachePath, type TweetsmashPost } from '../src/tweetsmash.js';

function post(id: string, tags: string[] = []): TweetsmashPost {
  return { post_id: id, imported_at: '2026-07-18T08:21:13', tags, is_read: false, is_archived: false };
}

function raindrop(id: string, tags: string[]) {
  return { id: Number(id), url: `https://x.com/someone/status/${id}`, title: id, tags, createdAt: '2026-07-01T00:00:00Z' };
}

async function withData(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ft-tweetsmash-seed-'));
  const saved = { data: process.env.FT_DATA_DIR, key: process.env.TWEETSMASH_API_KEY };
  process.env.FT_DATA_DIR = dir;
  process.env.TWEETSMASH_API_KEY = 'test-key';
  try {
    await mkdir(path.dirname(tweetsmashCachePath()), { recursive: true });
    await mkdir(path.dirname(raindropBookmarksCachePath()), { recursive: true });
    await writeJsonLines(tweetsmashCachePath(), [post('1', ['AI']), post('2'), post('3')]);
    await writeJsonLines(raindropBookmarksCachePath(), [
      raindrop('1', ['ai', 'x-bookmark', 'coding']),
      raindrop('2', ['ai', 'x-bookmark']),
      raindrop('3', ['coding', 'rare']),
      raindrop('99', ['ai']), // not in Tweetsmash
    ]);
    await fn();
  } finally {
    if (saved.data !== undefined) process.env.FT_DATA_DIR = saved.data;
    else delete process.env.FT_DATA_DIR;
    if (saved.key !== undefined) process.env.TWEETSMASH_API_KEY = saved.key;
    else delete process.env.TWEETSMASH_API_KEY;
  }
}

test('seed plan skips bookkeeping tags, rare tags, unknown posts, and existing labels', async () => {
  await withData(async () => {
    const result = await seedTweetsmashLabelsFromRaindrop({ minCount: 2, dryRun: true });
    assert.deepEqual(result.plan, [
      { label: 'ai', total: 2, pending: 1 },
      { label: 'coding', total: 2, pending: 2 },
    ]);
    assert.equal(result.requests, 0);
  });
});

test('seed writes one request per label, mirrors the cache, and resumes after 429', async () => {
  await withData(async () => {
    const bodies: Array<{ tweet_ids: string[]; label_name: string }> = [];
    let calls = 0;
    const limited = await seedTweetsmashLabelsFromRaindrop({
      minCount: 2,
      fetchImpl: (async (_url: URL, init?: RequestInit) => {
        calls += 1;
        if (calls === 2) return new Response('', { status: 429 });
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ status: true }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(limited.rateLimited, true);
    assert.equal(limited.complete, false);
    assert.deepEqual(bodies, [{ tweet_ids: ['2'], label_name: 'ai' }]);
    const cached = new Map((await readJsonLines<TweetsmashPost>(tweetsmashCachePath())).map((p) => [p.post_id, p.tags]));
    assert.deepEqual(cached.get('2'), ['ai']);

    const resumed = await seedTweetsmashLabelsFromRaindrop({
      minCount: 2,
      fetchImpl: (async (_url: URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ status: true }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(resumed.complete, true);
    assert.equal(resumed.requests, 1);
    assert.deepEqual(bodies.at(-1), { tweet_ids: ['1', '3'], label_name: 'coding' });
  });
});
