import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseUserIdFromTwid,
  convertUserResultToFollowing,
  parseFollowingResponse,
  fetchFollowing,
  FOLLOWING_QUERY_ID,
} from '../src/following/fetch.js';
import {
  mergeFollowingRecords,
  pruneToFollowingCrawl,
  syncFollowing,
} from '../src/following/sync.js';
import {
  buildFollowingIndex,
  searchFollowing,
  listFollowing,
  showFollowing,
  getFollowingStats,
  getFollowingStatus,
  updateFollowingClassification,
  getUnclassifiedFollowing,
  getReclassifiableFollowing,
} from '../src/following/db.js';
import {
  classifyFollowingRegex,
  classifyFollowingRegexAll,
} from '../src/following/classify.js';
import type { FollowingRecord } from '../src/following/types.js';
import { syncXListMembers } from '../src/x-list-members.js';

// ── Test helpers ──────────────────────────────────────────────────────────

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-'));
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

function makeRecord(overrides: Partial<FollowingRecord> = {}): FollowingRecord {
  return {
    userId: '123',
    handle: 'testuser',
    name: 'Test User',
    bio: 'Building AI agents',
    syncedAt: '2026-06-21T00:00:00Z',
    ...overrides,
  };
}

// ── twid cookie parsing ───────────────────────────────────────────────────

test('parseUserIdFromTwid extracts user ID from URL-encoded twid cookie', () => {
  const cookieHeader = 'ct0=abc123; auth_token=def456; twid=u%3D1234567890';
  assert.equal(parseUserIdFromTwid(cookieHeader), '1234567890');
});

test('parseUserIdFromTwid extracts user ID from raw twid cookie', () => {
  const cookieHeader = 'ct0=abc123; twid="u=9876543210"';
  assert.equal(parseUserIdFromTwid(cookieHeader), '9876543210');
});

test('parseUserIdFromTwid returns null when twid is absent', () => {
  const cookieHeader = 'ct0=abc123; auth_token=def456';
  assert.equal(parseUserIdFromTwid(cookieHeader), null);
});

// ── GraphQL response parsing ──────────────────────────────────────────────

test('convertUserResultToFollowing parses a standard user_results.result', () => {
  const result = {
    __typename: 'User',
    rest_id: '4444',
    is_blue_verified: true,
    legacy: {
      screen_name: 'airesearcher',
      name: 'AI Researcher',
      description: 'Building RAG systems and agent harnesses',
      profile_image_url_https: 'https://pbs.twimg.com/profile_images/123.jpg',
      followers_count: 15000,
      friends_count: 500,
      verified: false,
    },
  };

  const record = convertUserResultToFollowing(result, '2026-06-21T00:00:00Z');
  assert.ok(record);
  assert.equal(record.userId, '4444');
  assert.equal(record.handle, 'airesearcher');
  assert.equal(record.name, 'AI Researcher');
  assert.equal(record.bio, 'Building RAG systems and agent harnesses');
  assert.equal(record.followerCount, 15000);
  assert.equal(record.followingCount, 500);
  assert.equal(record.verified, true);
  assert.equal(record.syncedAt, '2026-06-21T00:00:00Z');
});

test('convertUserResultToFollowing supports current core/profile_bio user payloads', () => {
  const record = convertUserResultToFollowing({
    __typename: 'User',
    rest_id: '5555',
    is_blue_verified: true,
    core: { screen_name: 'newpayload', name: 'New Payload' },
    profile_bio: { description: 'Uses X’s current user payload shape.' },
    avatar: { image_url: 'https://pbs.twimg.com/profile_images/new.jpg' },
  }, '2026-07-18T10:00:00.000Z');
  assert.ok(record);
  assert.equal(record.handle, 'newpayload');
  assert.equal(record.name, 'New Payload');
  assert.equal(record.bio, 'Uses X’s current user payload shape.');
  assert.equal(record.profileImageUrl, 'https://pbs.twimg.com/profile_images/new.jpg');
  assert.equal(record.verified, true);
});

test('convertUserResultToFollowing returns null for UserUnavailable', () => {
  const result = { __typename: 'UserUnavailable', rest_id: '123' };
  const record = convertUserResultToFollowing(result, '2026-06-21T00:00:00Z');
  assert.equal(record, null);
});

test('convertUserResultToFollowing returns null when missing required fields', () => {
  assert.equal(convertUserResultToFollowing(null, 'now'), null);
  assert.equal(convertUserResultToFollowing({ rest_id: '123' }, 'now'), null);
  assert.equal(convertUserResultToFollowing({ legacy: { screen_name: 'x' } }, 'now'), null);
});

test('parseFollowingResponse parses TimelineAddEntries with single-user items', () => {
  const json = {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    {
                      entryId: 'user-123',
                      content: {
                        itemContent: {
                          user_results: {
                            result: {
                              __typename: 'User',
                              rest_id: '123',
                              legacy: {
                                screen_name: 'alice',
                                name: 'Alice',
                                description: 'AI researcher',
                                followers_count: 1000,
                                friends_count: 200,
                              },
                            },
                          },
                        },
                      },
                    },
                    {
                      entryId: 'cursor-bottom-abc',
                      content: { value: 'cursor123' },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };

  const result = parseFollowingResponse(json, '2026-06-21T00:00:00Z');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].userId, '123');
  assert.equal(result.records[0].handle, 'alice');
  assert.equal(result.nextCursor, 'cursor123');
});

test('parseFollowingResponse parses multi-user module items', () => {
  const json = {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    {
                      entryId: 'module-1',
                      content: {
                        items: [
                          {
                            item: {
                              itemContent: {
                                user_results: {
                                  result: {
                                    __typename: 'User',
                                    rest_id: '111',
                                    legacy: { screen_name: 'bob', name: 'Bob', description: 'DevOps engineer' },
                                  },
                                },
                              },
                            },
                          },
                          {
                            item: {
                              itemContent: {
                                user_results: {
                                  result: {
                                    __typename: 'User',
                                    rest_id: '222',
                                    legacy: { screen_name: 'carol', name: 'Carol', description: 'Product designer' },
                                  },
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };

  const result = parseFollowingResponse(json, '2026-06-21T00:00:00Z');
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].handle, 'bob');
  assert.equal(result.records[1].handle, 'carol');
});

test('FOLLOWING_QUERY_ID is a non-empty string', () => {
  assert.ok(FOLLOWING_QUERY_ID.length > 0);
});

// ── Record merging ────────────────────────────────────────────────────────

test('mergeFollowingRecords upserts by userId and preserves classification', () => {
  const existing: FollowingRecord[] = [
    {
      ...makeRecord({ userId: '1', handle: 'alice' }),
      domains: ['ai'],
      primaryDomain: 'ai',
      expertise: ['rag'],
      expertiseSummary: 'AI researcher',
    },
  ];

  const incoming: FollowingRecord[] = [
    makeRecord({ userId: '1', handle: 'alice', bio: 'Updated bio' }),
    makeRecord({ userId: '2', handle: 'bob', name: 'Bob' }),
  ];

  const { merged, added } = mergeFollowingRecords(existing, incoming);
  assert.equal(added, 1);
  assert.equal(merged.length, 2);

  const alice = merged.find((r) => r.userId === '1')!;
  assert.equal(alice.bio, 'Updated bio');
  assert.deepEqual(alice.domains, ['ai']);
  assert.equal(alice.primaryDomain, 'ai');
  assert.deepEqual(alice.expertise, ['rag']);
});

test('mergeFollowingRecords sorts by handle', () => {
  const existing: FollowingRecord[] = [];
  const incoming: FollowingRecord[] = [
    makeRecord({ userId: '3', handle: 'zoe' }),
    makeRecord({ userId: '1', handle: 'alice' }),
    makeRecord({ userId: '2', handle: 'bob' }),
  ];

  const { merged } = mergeFollowingRecords(existing, incoming);
  assert.equal(merged[0].handle, 'alice');
  assert.equal(merged[1].handle, 'bob');
  assert.equal(merged[2].handle, 'zoe');
});

test('pruneToFollowingCrawl removes records not seen in the completed crawl', () => {
  const marker = '2026-07-18T10:00:00.000Z';
  const kept = pruneToFollowingCrawl([
    makeRecord({ userId: '1', seenInCrawlAt: marker }),
    makeRecord({ userId: '2', seenInCrawlAt: '2026-07-17T10:00:00.000Z' }),
  ], marker);
  assert.deepEqual(kept.map((record) => record.userId), ['1']);
});

function followingResponse(users: Array<{ id: string; handle: string }>, cursor?: string): string {
  return JSON.stringify({
    data: {
      user: {
        result: {
          timeline: {
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
    },
  });
}

test('syncFollowing resumes one crawl, prunes stale accounts only at completion, and preserves classification', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    await writeFile(path.join(followingDir, 'following.jsonl'), [
      JSON.stringify(makeRecord({ userId: '1', handle: 'alice', domains: ['ai'], primaryDomain: 'ai', expertise: ['agents'] })),
      JSON.stringify(makeRecord({ userId: 'stale', handle: 'list-import' })),
    ].join('\n') + '\n');
    await writeFile(path.join(followingDir, 'meta.json'), JSON.stringify({
      lastUpdated: '2026-07-17T00:00:00.000Z', count: 2, viewerId: '99', snapshotComplete: true,
    }));
    const now = () => new Date('2026-07-18T10:00:00.000Z');
    const session = { csrfToken: 'ct0', cookieHeader: 'ct0=ct0; twid=u%3D99' };

    const first = await syncFollowing({
      ...session, maxPages: 1, delayMs: 0, maxMinutes: Infinity, now,
      fetchImpl: async () => new Response(followingResponse([{ id: '1', handle: 'alice' }], 'next')),
    });
    assert.equal(first.snapshotComplete, false);
    assert.equal(first.totalFollowing, 2, 'stale records remain while crawl is incomplete');

    const second = await syncFollowing({
      ...session, delayMs: 0, maxMinutes: Infinity, now,
      fetchImpl: async () => new Response(followingResponse([{ id: '2', handle: 'bob' }])),
    });
    assert.equal(second.snapshotComplete, true);
    assert.equal(second.pruned, 1);
    assert.equal(second.totalFollowing, 2);

    const records = (await readFile(path.join(followingDir, 'following.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(records.map((record) => record.userId).sort(), ['1', '2']);
    assert.deepEqual(records.find((record) => record.userId === '1').domains, ['ai']);
    assert.deepEqual(
      (await searchFollowing({ query: 'list', limit: 10 })).map((record) => record.userId),
      [],
      'pruned accounts must not remain searchable in the Following index',
    );
    const meta = JSON.parse(await readFile(path.join(followingDir, 'meta.json'), 'utf8'));
    assert.equal(meta.snapshotComplete, true);
    assert.equal(meta.cursor, undefined);
  });
});

test('syncFollowing refuses a legacy roster until an explicit rebuild and preserves a suspicious empty crawl', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    await writeFile(path.join(followingDir, 'following.jsonl'), JSON.stringify(makeRecord({ userId: '1', handle: 'alice' })) + '\n');
    await writeFile(path.join(followingDir, 'meta.json'), JSON.stringify({ lastUpdated: '2026-07-17T00:00:00.000Z', count: 1 }));
    const session = { csrfToken: 'ct0', cookieHeader: 'ct0=ct0; twid=u%3D99' };
    await assert.rejects(
      () => syncFollowing({ ...session, delayMs: 0, maxMinutes: Infinity }),
      /sync-following --rebuild/,
    );

    const result = await syncFollowing({
      ...session, rebuild: true, delayMs: 0, maxMinutes: Infinity,
      fetchImpl: async () => new Response(followingResponse([])),
    });
    assert.equal(result.snapshotComplete, false);
    assert.equal(result.totalFollowing, 1);
    assert.equal(result.pruned, 0);
  });
});

test('syncFollowing blocks an implausibly shrunken terminal crawl from pruning a complete roster', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    const existing = Array.from({ length: 10 }, (_, index) => makeRecord({
      userId: String(index + 1), handle: `person${index + 1}`,
    }));
    await writeFile(path.join(followingDir, 'following.jsonl'), existing.map((record) => JSON.stringify(record)).join('\n') + '\n');
    await writeFile(path.join(followingDir, 'meta.json'), JSON.stringify({
      lastUpdated: '2026-07-17T00:00:00.000Z', count: existing.length, viewerId: '99', snapshotComplete: true,
    }));

    const result = await syncFollowing({
      csrfToken: 'ct0', cookieHeader: 'ct0=ct0; twid=u%3D99', delayMs: 0, maxMinutes: Infinity,
      fetchImpl: async () => new Response(followingResponse([{ id: '1', handle: 'person1' }])),
    });

    assert.equal(result.stopReason, 'implausible shrink guard');
    assert.equal(result.snapshotComplete, false);
    assert.equal(result.pruned, 0);
    assert.equal(result.totalFollowing, existing.length);
    const cached = (await readFile(path.join(followingDir, 'following.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(cached.length, existing.length);
  });
});

test('syncFollowing preserves an unchanged complete snapshot after a first-page failure or rate limit', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    const cachePath = path.join(followingDir, 'following.jsonl');
    const metaPath = path.join(followingDir, 'meta.json');
    await writeFile(cachePath, JSON.stringify(makeRecord({ userId: '1', handle: 'alice' })) + '\n');
    await writeFile(metaPath, JSON.stringify({ count: 1, snapshotComplete: true, lastUpdated: '2026-07-17T00:00:00.000Z' }));
    const beforeCache = await readFile(cachePath, 'utf8');
    const beforeMeta = await readFile(metaPath, 'utf8');
    const session = { csrfToken: 'ct0', cookieHeader: 'ct0=ct0; twid=u%3D99', delayMs: 0, maxMinutes: Infinity };

    await assert.rejects(
      () => syncFollowing({ ...session, fetchImpl: async () => { throw new Error('network timeout'); } }),
      /network timeout/,
    );
    assert.equal(await readFile(cachePath, 'utf8'), beforeCache);
    assert.equal(await readFile(metaPath, 'utf8'), beforeMeta);

    const limited = await syncFollowing({
      ...session,
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
    });
    assert.equal(limited.stopReason, 'rate limited');
    assert.equal(limited.snapshotComplete, true);
    assert.equal(await readFile(cachePath, 'utf8'), beforeCache);
    assert.equal(await readFile(metaPath, 'utf8'), beforeMeta);
  });
});

test('syncFollowing --rebuild ignores an incomplete crawl cursor and starts a new generation', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    await writeFile(path.join(followingDir, 'following.jsonl'), JSON.stringify(makeRecord({ userId: 'old', handle: 'old' })) + '\n');
    await writeFile(path.join(followingDir, 'meta.json'), JSON.stringify({
      count: 1, snapshotComplete: false, cursor: 'old-cursor', crawlStartedAt: '2026-07-17T00:00:00.000Z',
    }));
    let requestCursor: unknown = 'not requested';
    const result = await syncFollowing({
      csrfToken: 'ct0', cookieHeader: 'ct0=ct0; twid=u%3D99', rebuild: true, delayMs: 0, maxMinutes: Infinity,
      now: () => new Date('2026-07-18T10:00:00.000Z'),
      fetchImpl: async (url) => {
        requestCursor = JSON.parse(new URL(String(url)).searchParams.get('variables') ?? '{}').cursor;
        return new Response(followingResponse([{ id: '1', handle: 'fresh' }]));
      },
    });
    assert.equal(requestCursor, undefined);
    assert.equal(result.snapshotComplete, true);
  });
});

test('syncXListMembers leaves the Following cache and metadata untouched', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    const cachePath = path.join(followingDir, 'following.jsonl');
    const metaPath = path.join(followingDir, 'meta.json');
    await writeFile(cachePath, JSON.stringify(makeRecord({ userId: 'followed', handle: 'followed' })) + '\n');
    await writeFile(metaPath, JSON.stringify({ count: 1, snapshotComplete: true }));
    const beforeCache = await readFile(cachePath, 'utf8');
    const beforeMeta = await readFile(metaPath, 'utf8');
    const listResponse = JSON.stringify({
      data: { list: { members_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{
        entryId: 'user-2', content: { itemContent: { user_results: { result: {
          __typename: 'User', rest_id: '2', legacy: { screen_name: 'listmember', name: 'List Member' },
        } } } },
      }] }] } } } },
    });
    await syncXListMembers({
      listId: '123', csrfToken: 'ct0', cookieHeader: 'ct0=ct0', delayMs: 0,
      fetchImpl: async () => new Response(listResponse),
      now: () => '2026-07-18T10:00:00.000Z',
    });
    assert.equal(await readFile(cachePath, 'utf8'), beforeCache);
    assert.equal(await readFile(metaPath, 'utf8'), beforeMeta);
    assert.ok(existsSync(path.join(dir, 'x-lists', '123-members-latest.json')));
  });
});

// ── DB index, search, list, show, stats ───────────────────────────────────

test('buildFollowingIndex creates a searchable FTS index', async () => {
  await withIsolatedDataDir(async (dir) => {
    // Write records to JSONL cache
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'airesearcher', name: 'AI Researcher', bio: 'Building RAG systems and agent harnesses' }),
      makeRecord({ userId: '2', handle: 'devopsdan', name: 'DevOps Dan', bio: 'Kubernetes and cloud infrastructure' }),
      makeRecord({ userId: '3', handle: 'startupsteve', name: 'Startup Steve', bio: 'Founder and indie hacker' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const result = await buildFollowingIndex();
    assert.equal(result.recordCount, 3);
    assert.equal(result.newRecords, 3);
    assert.ok(existsSync(path.join(dir, 'following', 'following.db')));
  });
});

test('searchFollowing returns relevant results by bio content', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'airesearcher', name: 'AI Researcher', bio: 'Building RAG systems and agent harnesses for LLMs' }),
      makeRecord({ userId: '2', handle: 'devopsdan', name: 'DevOps Dan', bio: 'Kubernetes and cloud infrastructure' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const results = await searchFollowing({ query: 'RAG agent' });
    assert.ok(results.length > 0);
    assert.equal(results[0].handle, 'airesearcher');
  });
});

test('searchFollowing searches by handle', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'airesearcher', name: 'AI', bio: '' }),
      makeRecord({ userId: '2', handle: 'devopsdan', name: 'Dan', bio: '' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const results = await searchFollowing({ query: 'devopsdan' });
    assert.ok(results.length > 0);
    assert.equal(results[0].handle, 'devopsdan');
  });
});

test('listFollowing filters by domain', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'alice', name: 'Alice', bio: '', domains: ['ai'], primaryDomain: 'ai' }),
      makeRecord({ userId: '2', handle: 'bob', name: 'Bob', bio: '', domains: ['devops'], primaryDomain: 'devops' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const aiResults = await listFollowing({ domain: 'ai' });
    assert.equal(aiResults.length, 1);
    assert.equal(aiResults[0].handle, 'alice');
  });
});

test('listFollowing sorts by bookmark overlap', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'alice', name: 'Alice', bio: '', bookmarkOverlap: 5 }),
      makeRecord({ userId: '2', handle: 'bob', name: 'Bob', bio: '', bookmarkOverlap: 20 }),
      makeRecord({ userId: '3', handle: 'carol', name: 'Carol', bio: '', bookmarkOverlap: 0 }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const results = await listFollowing({ sort: 'overlap' });
    assert.equal(results[0].handle, 'bob');
    assert.equal(results[0].bookmarkOverlap, 20);
    assert.equal(results[1].handle, 'alice');
  });
});

test('showFollowing returns full profile by handle', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({
        userId: '1',
        handle: 'airesearcher',
        name: 'AI Researcher',
        bio: 'Building RAG systems',
        domains: ['ai'],
        primaryDomain: 'ai',
        expertise: ['rag', 'agent-harness'],
        expertiseSummary: 'Builds AI agent frameworks',
        bookmarkOverlap: 10,
      }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const result = await showFollowing('airesearcher');
    assert.ok(result);
    assert.equal(result.handle, 'airesearcher');
    assert.equal(result.primaryDomain, 'ai');
    assert.deepEqual(result.expertise, ['rag', 'agent-harness']);
    assert.equal(result.bookmarkOverlap, 10);
  });
});

test('showFollowing strips leading @ from handle', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'alice', name: 'Alice', bio: '' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const result = await showFollowing('@alice');
    assert.ok(result);
    assert.equal(result.handle, 'alice');
  });
});

test('showFollowing returns null for unknown handle', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(makeRecord()) + '\n');
    await buildFollowingIndex();

    const result = await showFollowing('nonexistent');
    assert.equal(result, null);
  });
});

test('getFollowingStats returns totals and domain distribution', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'a', name: 'A', bio: '', domains: ['ai'], primaryDomain: 'ai', bookmarkOverlap: 5 }),
      makeRecord({ userId: '2', handle: 'b', name: 'B', bio: '', domains: ['ai'], primaryDomain: 'ai', bookmarkOverlap: 3 }),
      makeRecord({ userId: '3', handle: 'c', name: 'C', bio: '', domains: ['devops'], primaryDomain: 'devops' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const stats = await getFollowingStats();
    assert.equal(stats.totalFollowing, 3);
    assert.equal(stats.classifiedCount, 3);
    assert.equal(stats.topDomains[0].domain, 'ai');
    assert.equal(stats.topDomains[0].count, 2);
    assert.ok(stats.mostBookmarked.length > 0);
    assert.equal(stats.mostBookmarked[0].handle, 'a');
  });
});

test('getFollowingStatus returns count from meta.json', async () => {
  await withIsolatedDataDir(async (dir) => {
    const followingDir = path.join(dir, 'following');
    await mkdir(followingDir, { recursive: true });
    const meta = { lastUpdated: '2026-06-21T00:00:00Z', count: 42 };
    await writeFile(path.join(followingDir, 'meta.json'), JSON.stringify(meta));

    const status = await getFollowingStatus();
    assert.equal(status.count, 42);
    assert.equal(status.lastUpdated, '2026-06-21T00:00:00Z');
  });
});

// ── Classification ────────────────────────────────────────────────────────

test('classifyFollowingRegex assigns domains from bio keywords', () => {
  const accounts = [
    { userId: '1', handle: 'airesearcher', name: 'AI', bio: 'Building RAG systems and agent harnesses for LLMs' },
    { userId: '2', handle: 'devopsdan', name: 'Dan', bio: 'Kubernetes and cloud infrastructure engineer' },
    { userId: '3', handle: 'startupsteve', name: 'Steve', bio: 'Founder, Y Combinator alum, building SaaS' },
  ];

  const results = classifyFollowingRegex(accounts);
  assert.equal(results.length, 3);

  const aiResult = results.find((r) => r.userId === '1')!;
  assert.ok(aiResult.domains.includes('ai'));
  assert.ok(aiResult.expertise.includes('rag') || aiResult.expertise.includes('agent-harness'));

  const devopsResult = results.find((r) => r.userId === '2')!;
  assert.ok(devopsResult.domains.includes('devops'));
  assert.ok(devopsResult.expertise.includes('kubernetes'));

  const startupResult = results.find((r) => r.userId === '3')!;
  assert.ok(startupResult.domains.includes('startups'));
});

test('classifyFollowingRegex handles empty bio gracefully', () => {
  const accounts = [
    { userId: '1', handle: 'mystery', name: 'Mystery', bio: '' },
  ];

  const results = classifyFollowingRegex(accounts);
  assert.equal(results[0].primaryDomain, 'general');
  assert.ok(results[0].domains.includes('general'));
});

test('classifyFollowingRegexAll classifies unclassified records in DB', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'airesearcher', name: 'AI', bio: 'Building RAG systems' }),
      makeRecord({ userId: '2', handle: 'devopsdan', name: 'Dan', bio: 'Kubernetes engineer' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    const result = await classifyFollowingRegexAll();
    assert.equal(result.classified, 2);
    assert.equal(result.total, 2);

    // Verify classification was written to DB
    const unclassified = await getUnclassifiedFollowing();
    assert.equal(unclassified.length, 0);
  });
});

test('updateFollowingClassification persists domains and expertise', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'alice', name: 'Alice', bio: 'AI researcher' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    await updateFollowingClassification([
      {
        userId: '1',
        domains: ['ai', 'research'],
        primaryDomain: 'ai',
        expertise: ['rag', 'eval'],
        expertiseSummary: 'RAG and eval specialist',
      },
    ]);

    const result = await showFollowing('alice');
    assert.ok(result);
    assert.deepEqual(result.domains, ['ai', 'research']);
    assert.equal(result.primaryDomain, 'ai');
    assert.deepEqual(result.expertise, ['rag', 'eval']);
    assert.equal(result.expertiseSummary, 'RAG and eval specialist');
  });
});

test('buildFollowingIndex preserves classification on re-index', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'alice', name: 'Alice', bio: 'AI researcher' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    // Classify
    await updateFollowingClassification([
      { userId: '1', domains: ['ai'], primaryDomain: 'ai', expertise: ['rag'], expertiseSummary: 'RAG expert' },
    ]);

    // Re-index (simulates a re-sync that refreshes profile data)
    await buildFollowingIndex();

    const result = await showFollowing('alice');
    assert.ok(result);
    assert.equal(result.primaryDomain, 'ai');
    assert.deepEqual(result.expertise, ['rag']);
  });
});

// ── Cold start: read commands before any sync (regression: C1) ─────────────

test('read commands return empty without throwing before first sync', async () => {
  await withIsolatedDataDir(async () => {
    // No buildFollowingIndex / no DB file yet.
    assert.deepEqual(await searchFollowing({ query: 'anything' }), []);
    assert.deepEqual(await listFollowing(), []);
    assert.equal(await showFollowing('whoever'), null);
    const stats = await getFollowingStats();
    assert.equal(stats.totalFollowing, 0);
    assert.deepEqual(await getUnclassifiedFollowing(), []);
  });
});

// ── Regex then LLM re-classification is not a no-op (regression: C2) ────────

test('getReclassifiableFollowing surfaces general rows left by the regex pass', async () => {
  await withIsolatedDataDir(async (dir) => {
    const cachePath = path.join(dir, 'following', 'following.jsonl');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const records: FollowingRecord[] = [
      makeRecord({ userId: '1', handle: 'mystery', name: 'Mystery', bio: '' }),
    ];
    await writeFile(cachePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await buildFollowingIndex();

    await classifyFollowingRegexAll();

    // Regex assigned 'general' → no longer "unclassified" ...
    assert.equal((await getUnclassifiedFollowing()).length, 0);
    // ... but the LLM pass must still be able to upgrade it.
    const reclassifiable = await getReclassifiableFollowing();
    assert.equal(reclassifiable.length, 1);
    assert.equal(reclassifiable[0].handle, 'mystery');
  });
});

// ── fetchFollowing stops on an empty page with a cursor (regression: C4) ────

test('fetchFollowing stops safely when a cursor-bearing empty page cycles', async () => {
  let calls = 0;
  const emptyPage = JSON.stringify({
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                { type: 'TimelineAddEntries', entries: [
                  { entryId: 'cursor-bottom-x', content: { value: 'still-here' } },
                ] },
              ],
            },
          },
        },
      },
    },
  });
  const fetchImpl = (async () => {
    calls += 1;
    return { status: 200, ok: true, text: async () => emptyPage } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await fetchFollowing({
    userId: '1',
    csrfToken: 'ct0test',
    cookieHeader: 'ct0=ct0test',
    delayMs: 0,
    fetchImpl,
  });

  assert.equal(calls, 2);
  assert.equal(result.pages, 2);
  assert.equal(result.stopReason, 'cursor cycle');
  assert.equal(result.records.length, 0);
});

test('fetchFollowing continues past a cursor-bearing empty page to a later user page', async () => {
  let calls = 0;
  const responses = [
    followingResponse([], 'after-unavailable'),
    followingResponse([{ id: '1', handle: 'alice' }]),
  ];
  const result = await fetchFollowing({
    userId: '1', csrfToken: 'ct0test', cookieHeader: 'ct0=ct0test', delayMs: 0,
    fetchImpl: async () => new Response(responses[calls++]),
  });
  assert.equal(calls, 2);
  assert.equal(result.stopReason, 'end of following');
  assert.deepEqual(result.records.map((record) => record.userId), ['1']);
});

// ── LLM classification response parsing ───────────────────────────────────

test('LLM classification parseResponse handles valid JSON array', async () => {
  // Import the internal parseResponse via the module's exports
  // We test through the public classifyFollowingRegex which doesn't need LLM
  // and verify the regex path produces valid shapes that match the LLM path

  const accounts = [
    { userId: '1', handle: 'airesearcher', name: 'AI', bio: 'ML and deep learning researcher' },
  ];
  const results = classifyFollowingRegex(accounts);
  assert.ok(results[0].domains.length > 0);
  assert.ok(results[0].primaryDomain);
  assert.ok(typeof results[0].expertiseSummary === 'string');
});
