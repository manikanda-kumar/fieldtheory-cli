import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeLocalAndTweetsmashHits,
  searchTweetsmashBookmarks,
  tweetIdFromStatusUrl,
  tweetsmashHitToSearchResult,
  type TweetsmashSearchHit,
} from '../src/tweetsmash-search.js';

function smashPost(overrides: Record<string, unknown> = {}) {
  return {
    post_id: '1938682607145034084',
    author_username: 'gregisenberg',
    author_details: { name: 'GREG ISENBERG', username: 'gregisenberg' },
    tags: ['ai-agents'],
    tweet_details: {
      text: 'productizing AI agents is the biggest zero-to-one play',
      link: 'https://twitter.com/gregisenberg/status/1938682607145034084',
      posted_at: '2025-06-27T19:35:27+00:00',
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('tweetIdFromStatusUrl reads x.com and twitter.com status ids', () => {
  assert.equal(tweetIdFromStatusUrl('https://x.com/a/status/123'), '123');
  assert.equal(tweetIdFromStatusUrl('https://twitter.com/gregisenberg/status/1938682607145034084'), '1938682607145034084');
  assert.equal(tweetIdFromStatusUrl('https://github.com/example/tool'), null);
  assert.equal(tweetIdFromStatusUrl(null), null);
});

test('searchTweetsmashBookmarks skips when no API key is set', async () => {
  const result = await searchTweetsmashBookmarks({
    query: 'agent memory',
    apiKey: null,
    fetchImpl: (async () => {
      throw new Error('should not fetch');
    }) as typeof fetch,
  });
  assert.deepEqual(result, { hits: [], skipped: true, reason: 'no-api-key' });
});

test('searchTweetsmashBookmarks sends keyword plus semantic query params', async () => {
  let requested: URL | undefined;
  const result = await searchTweetsmashBookmarks({
    query: 'agent memory',
    limit: 5,
    author: '@swyx',
    after: '2026-01-01',
    before: '2026-08-01',
    apiKey: 'test-key',
    fetchImpl: (async (input) => {
      requested = new URL(String(input));
      return jsonResponse({ status: true, data: [smashPost()] });
    }) as typeof fetch,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].postId, '1938682607145034084');
  assert.equal(result.hits[0].authorHandle, 'gregisenberg');
  assert.equal(requested?.searchParams.get('q'), 'agent memory');
  assert.equal(requested?.searchParams.get('vector_search_term'), 'agent memory');
  assert.equal(requested?.searchParams.get('limit'), '5');
  assert.equal(requested?.searchParams.get('author'), 'swyx');
  assert.equal(requested?.searchParams.get('posted_from'), '2026-01-01T00:00:00Z');
  assert.equal(requested?.searchParams.get('posted_to'), '2026-08-01T23:59:59Z');
});

test('searchTweetsmashBookmarks soft-fails on 429 and network errors', async () => {
  const limited = await searchTweetsmashBookmarks({
    query: 'agents',
    apiKey: 'test-key',
    fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch,
  });
  assert.deepEqual(limited, { hits: [], skipped: true, reason: 'rate-limited' });

  const down = await searchTweetsmashBookmarks({
    query: 'agents',
    apiKey: 'test-key',
    fetchImpl: (async () => {
      throw new Error('offline');
    }) as typeof fetch,
  });
  assert.deepEqual(down, { hits: [], skipped: true, reason: 'network' });
});

test('mergeLocalAndTweetsmashHits keeps local rank and appends unseen remote hits', () => {
  const local = [
    { id: 'local-1', url: 'https://x.com/a/status/1' },
    { id: '1938682607145034084', url: 'https://x.com/g/status/1938682607145034084' },
  ];
  const remote: TweetsmashSearchHit[] = [
    {
      postId: '1938682607145034084',
      url: 'https://twitter.com/gregisenberg/status/1938682607145034084',
      text: 'already local',
      tags: [],
    },
    {
      postId: '999',
      url: 'https://x.com/b/status/999',
      text: 'semantic only',
      authorHandle: 'b',
      tags: ['agents'],
    },
  ];
  const merged = mergeLocalAndTweetsmashHits(local, remote, tweetsmashHitToSearchResult, 10);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'local-1');
  assert.equal(merged[2].id, '999');
  assert.equal(merged[2].authorHandle, 'b');
});

test('mergeLocalAndTweetsmashHits can skip remote hits already present under another id', () => {
  const local = [{ id: 'canon-hash', url: 'https://x.com/a/status/111' }];
  const remote: TweetsmashSearchHit[] = [
    { postId: '111', url: 'https://x.com/a/status/111', text: 'same tweet', tags: [] },
    { postId: '222', url: 'https://x.com/b/status/222', text: 'new tweet', tags: [] },
  ];
  const merged = mergeLocalAndTweetsmashHits(
    local,
    remote,
    (hit) => ({ id: hit.postId, url: hit.url }),
    10,
    new Set(['111']),
  );
  assert.deepEqual(merged.map((row) => row.id), ['canon-hash', '222']);
});

test('mergeLocalAndTweetsmashHits reserves slots so a full local page still shows semantic hits', () => {
  const local = [
    { id: 'a', url: 'https://x.com/a/status/1' },
    { id: 'b', url: 'https://x.com/b/status/2' },
    { id: 'c', url: 'https://x.com/c/status/3' },
  ];
  const remote: TweetsmashSearchHit[] = [
    { postId: '999', url: 'https://x.com/z/status/999', text: 'paraphrase hit', tags: [] },
  ];
  const merged = mergeLocalAndTweetsmashHits(local, remote, tweetsmashHitToSearchResult, 3);
  assert.deepEqual(merged.map((row) => row.id), ['a', 'b', '999']);
});
