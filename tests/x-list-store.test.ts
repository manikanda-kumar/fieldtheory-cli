import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  buildTodayContextPack,
  deriveTodayAnalysis,
  deriveTodaySources,
  readLatestXListDigest,
} from '../src/x-list-store.js';
import { xListsDir } from '../src/paths.js';

async function withTempRoot<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.FT_DATA_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-x-list-store-'));
  process.env.FT_DATA_DIR = root;
  try {
    await mkdir(xListsDir(), { recursive: true });
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
}

const digest = {
  listId: '197',
  fetchedAt: '2026-06-24T12:00:00.000Z',
  tweets: [
    {
      id: '1',
      timelineKind: 'list-tweet',
      url: 'https://x.com/alice/status/1',
      author: 'alice',
      authorName: 'Alice',
      postedAt: '2026-06-24T10:00:00.000Z',
      text: 'New agents paper https://arxiv.org/abs/1234.5678',
      links: ['https://arxiv.org/abs/1234.5678'],
      engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
    },
    {
      id: '2',
      timelineKind: 'conversation-context',
      url: 'https://x.com/bob/status/2',
      author: 'bob',
      authorName: 'Bob',
      postedAt: '2026-06-24T11:00:00.000Z',
      text: 'Repo release https://github.com/example/repo',
      links: ['https://github.com/example/repo'],
      engagement: { likeCount: 3, repostCount: 1, replyCount: 0, quoteCount: 0, viewCount: 200 },
    },
  ],
  stats: { count: 2, fetchedCount: 2, timeFilteredCount: 0, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'no-cursor', sinceHours: 24 },
};

test('readLatestXListDigest reads stable latest JSON for a list', async () => {
  await withTempRoot(async () => {
    await writeFile(path.join(xListsDir(), '197-latest.json'), JSON.stringify(digest));
    const result = await readLatestXListDigest('197');
    assert.equal(result?.listId, '197');
    assert.equal(result?.tweets.length, 2);
  });
});

test('deriveTodayAnalysis returns domains, authors, link types, and top tweets', () => {
  const analysis = deriveTodayAnalysis(digest);
  assert.equal(analysis.totalTweets, 2);
  assert.equal(analysis.linkTypes[0]?.type, 'arxiv');
  assert.equal(analysis.domains[0]?.domain, 'arxiv.org');
  assert.equal(analysis.authors[0]?.handle, 'alice');
  assert.equal(analysis.topTweets[0]?.id, '1');
});

test('deriveTodaySources groups links by URL and keeps author/tweet provenance', () => {
  const sources = deriveTodaySources(digest);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.url, 'https://arxiv.org/abs/1234.5678');
  assert.deepEqual(sources[0]?.authors, ['alice']);
  assert.deepEqual(sources[0]?.tweetIds, ['1']);
});

test('buildTodayContextPack produces compact digest text', () => {
  const pack = buildTodayContextPack(digest);
  assert.match(pack, /X List 197/);
  assert.match(pack, /Top tweets/);
  assert.match(pack, /Sources/);
  assert.match(pack, /arxiv.org/);
});