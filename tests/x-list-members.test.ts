import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fetchXListMembers,
  syncXListMembers,
} from '../src/x-list-members.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-list-members-'));
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

function memberPage(users: Array<{ id: string; handle: string }>, cursor?: string): string {
  return JSON.stringify({
    data: {
      list: {
        members_timeline: {
          timeline: {
            instructions: [{
              type: 'TimelineAddEntries',
              entries: [
                ...users.map((user) => ({
                  entryId: `user-${user.id}`,
                  content: { itemContent: { user_results: { result: {
                    __typename: 'User', rest_id: user.id,
                    legacy: { screen_name: user.handle, name: user.handle, description: `${user.handle} bio` },
                  } } } },
                })),
                ...(cursor ? [{ entryId: 'cursor-bottom-next', content: { value: cursor } }] : []),
              ],
            }],
          },
        },
      },
    },
  });
}

const session = { csrfToken: 'ct0', cookieHeader: 'ct0=ct0' };

test('fetchXListMembers continues past an empty cursor-bearing page', async () => {
  const responses = [memberPage([], 'after-unavailable'), memberPage([{ id: '1', handle: 'alice' }])];
  let calls = 0;
  const digest = await fetchXListMembers({
    ...session, listId: '123', delayMs: 0,
    fetchImpl: async () => new Response(responses[calls++]),
  });
  assert.equal(calls, 2);
  assert.equal(digest.stats.snapshotComplete, true);
  assert.deepEqual(digest.members.map((member) => member.userId), ['1']);
});

test('fetchXListMembers stops incomplete on a cursor cycle or two empty pages', async () => {
  for (const [responses, reason] of [
    [[memberPage([], 'again'), memberPage([], 'again')], 'cursor cycle'],
    [[memberPage([], 'one'), memberPage([], 'two')], 'too many empty pages'],
  ] as const) {
    let calls = 0;
    const digest = await fetchXListMembers({
      ...session, listId: '123', delayMs: 0,
      fetchImpl: async () => new Response(responses[calls++]),
    });
    assert.equal(calls, 2);
    assert.equal(digest.stats.stopReason, reason);
    assert.equal(digest.stats.snapshotComplete, false);
    assert.ok(digest.stats.nextCursor);
  }
});

test('fetchXListMembers marks rate limits and max-pages exits incomplete', async () => {
  const limited = await fetchXListMembers({
    ...session, listId: '123', delayMs: 0,
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  });
  assert.equal(limited.stats.stopReason, 'rate limited');
  assert.equal(limited.stats.snapshotComplete, false);

  const capped = await fetchXListMembers({
    ...session, listId: '123', maxPages: 1, delayMs: 0,
    fetchImpl: async () => new Response(memberPage([{ id: '1', handle: 'alice' }], 'next')),
  });
  assert.equal(capped.stats.stopReason, 'max-pages');
  assert.equal(capped.stats.snapshotComplete, false);
  assert.equal(capped.stats.nextCursor, 'next');
});

test('syncXListMembers writes diagnostics but only publishes complete stable snapshots', async () => {
  await withIsolatedDataDir(async (dir) => {
    const incomplete = await syncXListMembers({
      ...session, listId: '123', delayMs: 0, now: () => '2026-07-18T10:00:01.000Z',
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
    });
    assert.equal(incomplete.latestStatus, 'unavailable');
    assert.ok(existsSync(incomplete.jsonPath));
    assert.equal(existsSync(incomplete.latestPath), false);

    const complete = await syncXListMembers({
      ...session, listId: '123', delayMs: 0, now: () => '2026-07-18T10:00:02.000Z',
      fetchImpl: async () => new Response(memberPage([{ id: '1', handle: 'alice' }])),
    });
    assert.equal(complete.digest.stats.snapshotComplete, true);
    assert.equal(complete.latestStatus, 'updated');
    assert.deepEqual(JSON.parse(await readFile(complete.latestPath, 'utf8')).stats.snapshotComplete, true);

    const beforeLatest = await readFile(complete.latestPath, 'utf8');
    const partial = await syncXListMembers({
      ...session, listId: '123', maxPages: 1, delayMs: 0, now: () => '2026-07-18T10:00:03.000Z',
      fetchImpl: async () => new Response(memberPage([{ id: '2', handle: 'bob' }], 'next')),
    });
    assert.equal(partial.latestStatus, 'preserved');
    assert.equal(await readFile(partial.latestPath, 'utf8'), beforeLatest);
    const diagnostic = await readFile(partial.jsonPath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(diagnostic));
  });
});

test('syncXListMembers does not call a legacy latest pointer complete', async () => {
  await withIsolatedDataDir(async (dir) => {
    const listsDir = path.join(dir, 'x-lists');
    await mkdir(listsDir, { recursive: true });
    await writeFile(path.join(listsDir, '123-members-latest.json'), JSON.stringify({
      listId: '123', members: [{ userId: '1', handle: 'alice' }],
      stats: { count: 1, pagesFetched: 1, stopReason: 'end of members' },
    }));
    const result = await syncXListMembers({
      ...session, listId: '123', delayMs: 0, now: () => '2026-07-18T10:00:04.000Z',
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
    });
    assert.equal(result.latestStatus, 'unavailable');
  });
});

test('syncXListMembers guards a large shrink unless explicitly accepted', async () => {
  await withIsolatedDataDir(async () => {
    const first = await syncXListMembers({
      ...session, listId: '123', delayMs: 0, now: () => '2026-07-18T10:01:01.000Z',
      fetchImpl: async () => new Response(memberPage([
        { id: '1', handle: 'one' }, { id: '2', handle: 'two' },
        { id: '3', handle: 'three' }, { id: '4', handle: 'four' },
      ])),
    });
    const beforeLatest = await readFile(first.latestPath, 'utf8');

    const guarded = await syncXListMembers({
      ...session, listId: '123', delayMs: 0, now: () => '2026-07-18T10:01:02.000Z',
      fetchImpl: async () => new Response(memberPage([{ id: '1', handle: 'one' }])),
    });
    assert.equal(guarded.digest.stats.snapshotComplete, false);
    assert.equal(guarded.digest.stats.stopReason, 'implausible shrink guard');
    assert.equal(guarded.latestStatus, 'preserved');
    assert.equal(await readFile(guarded.latestPath, 'utf8'), beforeLatest);

    const accepted = await syncXListMembers({
      ...session, listId: '123', acceptLargeShrink: true, delayMs: 0, now: () => '2026-07-18T10:01:03.000Z',
      fetchImpl: async () => new Response(memberPage([{ id: '1', handle: 'one' }])),
    });
    assert.equal(accepted.digest.stats.snapshotComplete, true);
    assert.equal(accepted.latestStatus, 'updated');
    assert.equal(JSON.parse(await readFile(accepted.latestPath, 'utf8')).members.length, 1);
  });
});
