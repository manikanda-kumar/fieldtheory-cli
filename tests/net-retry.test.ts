import assert from 'node:assert/strict';
import test from 'node:test';

import { isTransientNetworkError, retryTransient } from '../src/net-retry.js';

const noSleep = async () => {};

test('isTransientNetworkError matches the faults seen in nightly sync-all runs', () => {
  assert.equal(isTransientNetworkError(new TypeError('terminated')), true);
  assert.equal(isTransientNetworkError(new Error('This operation was aborted')), true);
  assert.equal(isTransientNetworkError(new Error('fetch failed')), true);
  assert.equal(isTransientNetworkError(new Error('socket hang up')), true);
  assert.equal(isTransientNetworkError(new Error('HTTP 503 for https://example.com/feed.xml')), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error('read'), { code: 'ECONNRESET' })), true);
});

test('isTransientNetworkError leaves deterministic failures alone', () => {
  assert.equal(isTransientNetworkError(new Error('No transcript available for YouTube video abc')), false);
  assert.equal(isTransientNetworkError(new Error('HTTP 404 for https://example.com/feed.xml')), false);
  assert.equal(isTransientNetworkError(new Error('engine returned no markdown sections')), false);
});

test('retryTransient replays a transient failure and returns the later success', async () => {
  let calls = 0;
  const waits: number[] = [];
  const value = await retryTransient(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('terminated');
    return 'ok';
  }, { sleep: async (ms) => { waits.push(ms); } });

  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 1_000 && waits[0] < 1_250, `first backoff ${waits[0]}`);
  assert.ok(waits[1] >= 3_000 && waits[1] < 3_250, `second backoff ${waits[1]}`);
});

test('retryTransient rethrows non-transient errors without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryTransient(async () => { calls += 1; throw new Error('HTTP 404 for https://example.com'); }, { sleep: noSleep }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});

test('retryTransient gives up after the attempt budget', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryTransient(async () => { calls += 1; throw new TypeError('terminated'); }, { attempts: 2, sleep: noSleep }),
    /terminated/,
  );
  assert.equal(calls, 2);
});
