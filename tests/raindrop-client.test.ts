import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRaindropsPage } from '../src/raindrop/client.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function withStubbedNetwork(
  fetchImpl: typeof fetch,
  fn: (delays: number[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const savedToken = process.env.RAINDROP_TOKEN;
  const delays: number[] = [];
  globalThis.fetch = fetchImpl;
  globalThis.setTimeout = (((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    delays.push(timeout ?? 0);
    if (typeof handler === 'function') handler(...args);
    return 0 as any;
  }) as typeof setTimeout);
  process.env.RAINDROP_TOKEN = 'test-token';
  try {
    await fn(delays);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (savedToken !== undefined) process.env.RAINDROP_TOKEN = savedToken;
    else delete process.env.RAINDROP_TOKEN;
  }
}

test('fetchWithRetry honors Retry-After on 429 and then succeeds', async () => {
  let calls = 0;
  await withStubbedNetwork(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('', { status: 429, headers: { 'retry-after': '7' } });
      }
      return jsonResponse({ items: [], count: 0 });
    }) as typeof fetch,
    async (delays) => {
      const result = await fetchRaindropsPage(0, 0, 50);
      assert.equal(calls, 2);
      assert.deepEqual(result, { items: [], count: 0 });
      assert.deepEqual(delays, [7_000]);
    },
  );
});

test('fetchWithRetry caps Retry-After waits and falls back to backoff without the header', async () => {
  let calls = 0;
  await withStubbedNetwork(
    (async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '600' } });
      if (calls === 2) return new Response('', { status: 429 });
      return jsonResponse({ items: [], count: 0 });
    }) as typeof fetch,
    async (delays) => {
      await fetchRaindropsPage(0, 0, 50);
      assert.equal(calls, 3);
      assert.equal(delays[0], 90_000);
      // No header on the second 429: exponential backoff for attempt 1 (2s base + jitter).
      assert.ok(delays[1] >= 2_000 && delays[1] < 2_500, `unexpected backoff ${delays[1]}`);
    },
  );
});

test('fetchWithRetry gives up after six rate-limited attempts', async () => {
  let calls = 0;
  await withStubbedNetwork(
    (async () => {
      calls += 1;
      return new Response('', { status: 429, headers: { 'retry-after': '1' } });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        fetchRaindropsPage(0, 0, 50),
        /rate limited \(429\) after 6 attempts/,
      );
      assert.equal(calls, 6);
    },
  );
});
