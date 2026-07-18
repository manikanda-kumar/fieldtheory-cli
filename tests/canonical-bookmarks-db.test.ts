import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJson, writeJsonLines } from '../src/fs.js';
import {
  classifyCanonicalBookmarks,
  formatCanonicalSearchResults,
  getCanonicalBookmarksSince,
  getCanonicalBookmarkById,
  listCanonicalBookmarks,
  rebuildCanonicalIndex,
  searchCanonicalBookmarks,
} from '../src/canonical-bookmarks-db.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterBookmarksIndexPath } from '../src/paths.js';
import type { RaindropRecord } from '../src/raindrop/types.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';
import type { ProjectRecord } from '../src/projects/types.js';
import type { FollowingRecord } from '../src/following/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-canonical-'));
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

async function writeRaindropBookmarks(dir: string, records: RaindropRecord[]): Promise<void> {
  const raindropDir = path.join(dir, 'raindrop');
  await mkdir(raindropDir, { recursive: true });
  await writeJsonLines(path.join(raindropDir, 'bookmarks.jsonl'), records);
}

async function writeGitHubStars(dir: string, records: GitHubStarRecord[]): Promise<void> {
  const githubDir = path.join(dir, 'github-stars');
  await mkdir(githubDir, { recursive: true });
  await writeJsonLines(path.join(githubDir, 'stars.jsonl'), records);
}

async function writeProjects(dir: string, records: ProjectRecord[]): Promise<void> {
  const projectsDir = path.join(dir, 'projects');
  await mkdir(projectsDir, { recursive: true });
  await writeJsonLines(path.join(projectsDir, 'projects.jsonl'), records);
}

async function writeFollowing(dir: string, records: FollowingRecord[]): Promise<void> {
  const followingDir = path.join(dir, 'following');
  await mkdir(followingDir, { recursive: true });
  await writeJsonLines(path.join(followingDir, 'following.jsonl'), records);
}

async function writeXListMembers(dir: string, listId: string, members: Array<Record<string, unknown>>): Promise<void> {
  const listsDir = path.join(dir, 'x-lists');
  await mkdir(listsDir, { recursive: true });
  await writeJson(path.join(listsDir, `${listId}-members-latest.json`), {
    listId,
    fetchedAt: '2026-07-18T10:00:00.000Z',
    members,
    stats: { count: members.length, pagesFetched: 1, stopReason: 'end of members' },
  });
}

function githubStarRecord(overrides: Partial<GitHubStarRecord> = {}): GitHubStarRecord {
  return {
    id: 123,
    fullName: 'example/tool',
    owner: 'example',
    name: 'tool',
    htmlUrl: 'https://github.com/example/tool',
    description: 'Agent memory command line tool',
    homepageUrl: 'https://example.com',
    language: 'TypeScript',
    topics: ['agents', 'memory'],
    stargazersCount: 12345,
    forksCount: 678,
    openIssuesCount: 12,
    isArchived: false,
    isFork: false,
    defaultBranch: 'main',
    pushedAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-25T09:00:00Z',
    starredAt: '2026-05-31T12:34:56Z',
    syncedAt: '2026-05-31T13:00:00Z',
    ...overrides,
  };
}

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    repo: 'tool',
    path: '/tmp/tool',
    description: 'Local project for agent memory',
    goalNowNext: {
      goal: 'Build project source indexing',
      now: 'Testing canonical integration',
      next: 'Wire CLI',
    },
    lastCommitAt: '2026-07-06T12:00:00.000Z',
    pendingFiles: 2,
    unpushedCommits: 1,
    recentCommits: [
      { hash: 'abc123', date: '2026-07-06T12:00:00.000Z', subject: 'add project canonical source' },
    ],
    recentPrompts: [
      { timestamp: '2026-07-06T13:00:00.000Z', text: 'How should project prompts feed search?' },
    ],
    scannedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

test('rebuildCanonicalIndex dedupes X external link with raindrop bookmark URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Great repo https://github.com/example/tool',
      links: ['https://github.com/example/tool?utm_source=x'],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 2);
    assert.deepEqual(matches[0].sources.sort(), ['raindrop', 'x']);

    const listed = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(listed[0].displayTitle, 'Acme Tool');
    assert.equal(listed[0].sourceCount, 2);
    assert.deepEqual(listed[0].sources.sort(), ['raindrop', 'x']);

    const byId = await getCanonicalBookmarkById(listed[0].id);
    assert.ok(byId);
    assert.equal(byId.sourceCount, 2);
  });
});

test('rebuildCanonicalIndex folds cached enrichment summaries into FTS and tolerates an absent cache table', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeGitHubStars(dir, [githubStarRecord({ id: 990, fullName: 'a/summary-index', htmlUrl: 'https://github.com/a/summary-index', description: 'brief' })]);
    // The first rebuild runs against a database with no link_enrichment table.
    await rebuildCanonicalIndex();
    const db = await openDb(twitterBookmarksIndexPath());
    try {
      const url = 'https://github.com/a/summary-index';
      db.run('UPDATE canonical_bookmarks SET search_text = canonical_url || \' brief\'');
      db.run(`CREATE TABLE link_enrichment (url TEXT PRIMARY KEY, summary TEXT, status TEXT NOT NULL, enriched_at TEXT NOT NULL)`);
      db.run(`INSERT INTO link_enrichment VALUES (?, ?, 'ok', ?)`, [url, 'Zephyrquartz is a summary-only discovery term.', '2026-07-10T00:00:00.000Z']);
      saveDb(db, twitterBookmarksIndexPath());
    } finally {
      db.close();
    }
    await rebuildCanonicalIndex();
    const found = await searchCanonicalBookmarks({ query: 'Zephyrquartz' });
    assert.equal(found.length, 1);
    assert.match(found[0].searchText, /summary: Zephyrquartz/);
  });
});

test('rebuildCanonicalIndex stores raindrop source rows with null target_url', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();

    const db = await openDb(twitterBookmarksIndexPath());
    try {
      const row = db.exec(
        `SELECT source_url, target_url
         FROM bookmark_sources
         WHERE id = ?`,
        ['raindrop:10'],
      )[0]?.values?.[0];
      assert.deepEqual(row, ['https://github.com/example/tool', null]);
    } finally {
      db.close();
    }
  });
});

test('rebuildCanonicalIndex indexes GitHub stars and searches repo metadata', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeGitHubStars(dir, [githubStarRecord()]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 1);
    assert.equal(result.canonicalCount, 1);

    const listed = await listCanonicalBookmarks({ source: 'github-stars', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(listed[0].displayTitle, 'example/tool');
    assert.deepEqual(listed[0].sources, ['github-stars']);

    const matches = await searchCanonicalBookmarks({ query: 'agent memory TypeScript example', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, listed[0].id);
  });
});

test('rebuildCanonicalIndex creates project source rows and indexes project context', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeProjects(dir, [projectRecord()]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 1);
    assert.equal(result.canonicalCount, 1);

    const listed = await listCanonicalBookmarks({ source: 'project', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].displayTitle, 'tool');
    assert.equal(listed[0].canonicalUrl, '/tmp/tool');
    assert.deepEqual(listed[0].sources, ['project']);

    const matches = await searchCanonicalBookmarks({ query: 'canonical prompts', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, listed[0].id);
  });
});

test('rebuildCanonicalIndex indexes following and latest X-list members as merged people sources', async () => {
  await withIsolatedDataDir(async (dir) => {
    const person = {
      userId: '42',
      handle: 'alice_ai',
      name: 'Alice AI',
      bio: 'Researches agent memory and retrieval systems.',
      followerCount: 1000,
      followingCount: 200,
      verified: true,
      syncedAt: '2026-07-18T10:00:00.000Z',
    };
    await writeFollowing(dir, [{
      ...person,
      domains: ['AI'],
      primaryDomain: 'AI',
      expertise: ['agents', 'retrieval'],
      expertiseSummary: 'Agent-memory researcher',
      bookmarkOverlap: 3,
    }]);
    await writeXListMembers(dir, '12345', [person]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const following = await listCanonicalBookmarks({ source: 'x-following', limit: 10 });
    const listMembers = await listCanonicalBookmarks({ source: 'x-list-members', limit: 10 });
    assert.equal(following.length, 1);
    assert.equal(listMembers.length, 1);
    assert.equal(following[0].canonicalUrl, 'https://x.com/alice_ai');
    assert.equal(following[0].firstSavedAt, null);
    assert.deepEqual(following[0].sources.sort(), ['x-following', 'x-list-members:12345']);

    const found = await searchCanonicalBookmarks({ query: 'agent retrieval', limit: 10 });
    assert.equal(found.length, 1);
    assert.match(found[0].searchText, /Alice AI/);

    const daily = await getCanonicalBookmarksSince('2026-07-18T00:00:00.000Z');
    assert.equal(daily.length, 0);
  });
});

test('rebuildCanonicalIndex merges GitHub-remote project with matching GitHub star', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeGitHubStars(dir, [githubStarRecord()]);
    await writeProjects(dir, [projectRecord({
      repo: 'tool',
      remoteUrl: 'https://github.com/example/tool',
    })]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const listed = await listCanonicalBookmarks({ source: 'project', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(listed[0].sourceCount, 2);
    assert.deepEqual(listed[0].sources.sort(), ['github-stars', 'project']);
  });
});

test('rebuildCanonicalIndex uses stable project dedupe key for projects without remote URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeProjects(dir, [projectRecord({ repo: 'local-only', path: '/tmp/local-only', remoteUrl: undefined })]);

    await rebuildCanonicalIndex();

    const db = await openDb(twitterBookmarksIndexPath());
    try {
      const row = db.exec(
        `SELECT dedupe_key, source_url
         FROM bookmark_sources
         WHERE id = ?`,
        ['project:local-only'],
      )[0]?.values?.[0];
      assert.deepEqual(row, ['project:local-only', '/tmp/local-only']);
    } finally {
      db.close();
    }
  });
});

test('rebuildCanonicalIndex caps project prompt text contribution', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeProjects(dir, [projectRecord({
      recentPrompts: [
        { timestamp: '2026-07-06T13:00:00.000Z', text: `${'x'.repeat(4500)}AFTER-CAP` },
      ],
    })]);

    await rebuildCanonicalIndex();

    const listed = await listCanonicalBookmarks({ source: 'project', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].searchText.includes('AFTER-CAP'), false);
  });
});

test('listCanonicalBookmarks filters by query, source, category, and domain', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeGitHubStars(dir, [githubStarRecord()]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://example.com/article',
      title: 'Readable systems essay',
      excerpt: 'Long-form architecture notes for personal knowledge systems',
      collectionPath: ['Writing'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    await classifyCanonicalBookmarks();

    const queryRows = await listCanonicalBookmarks({ query: 'agent memory', limit: 10 });
    assert.equal(queryRows.length, 1);
    assert.deepEqual(queryRows[0].sources, ['github-stars']);

    const sourceRows = await listCanonicalBookmarks({ source: 'raindrop', query: 'architecture', limit: 10 });
    assert.equal(sourceRows.length, 1);
    assert.equal(sourceRows[0].displayTitle, 'Readable systems essay');

    const categoryRows = await listCanonicalBookmarks({ category: 'tool', limit: 10 });
    assert.equal(categoryRows.length, 1);
    assert.deepEqual(categoryRows[0].sources, ['github-stars']);

    const domainRows = await listCanonicalBookmarks({ domain: 'github.com', limit: 10 });
    assert.equal(domainRows.length, 1);
    assert.deepEqual(domainRows[0].sources, ['github-stars']);
  });
});

test('listCanonicalBookmarks filters by author and populates authorHandle', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [
      {
        id: 'x-1',
        tweetId: '101',
        url: 'https://x.com/alice/status/101',
        text: 'Great post about AI agents',
        links: ['https://example.com/ai-post'],
        authorHandle: 'alice',
        syncedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        id: 'x-2',
        tweetId: '102',
        url: 'https://x.com/bob/status/102',
        text: 'Post about databases',
        links: ['https://example.com/db-post'],
        authorHandle: 'bob',
        syncedAt: '2026-05-11T00:00:00.000Z',
      },
    ]);

    await rebuildCanonicalIndex();

    // Filter by author=alice should return only alice's bookmark
    const aliceRows = await listCanonicalBookmarks({ author: 'alice', limit: 10 });
    assert.equal(aliceRows.length, 1);
    assert.equal(aliceRows[0].authorHandle, 'alice');

    // Filter by author=bob should return only bob's bookmark
    const bobRows = await listCanonicalBookmarks({ author: 'bob', limit: 10 });
    assert.equal(bobRows.length, 1);
    assert.equal(bobRows[0].authorHandle, 'bob');

    // No filter should return both
    const allRows = await listCanonicalBookmarks({ limit: 10 });
    assert.equal(allRows.length, 2);

    // Case-insensitive matching
    const upperRows = await listCanonicalBookmarks({ author: 'ALICE', limit: 10 });
    assert.equal(upperRows.length, 1);

    // Non-existent author returns empty
    const none = await listCanonicalBookmarks({ author: 'nobody', limit: 10 });
    assert.equal(none.length, 0);
  });
});

test('rebuildCanonicalIndex dedupes GitHub star with raindrop bookmark URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeGitHubStars(dir, [githubStarRecord()]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool?utm_source=raindrop',
      title: 'Example Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 1);

    const listed = await listCanonicalBookmarks({ source: 'github-stars', limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].sourceCount, 2);
    assert.deepEqual(listed[0].sources.sort(), ['github-stars', 'raindrop']);
  });
});

test('formatCanonicalSearchResults includes title, source badges, url, and empty message', () => {
  const formatted = formatCanonicalSearchResults([{
    id: 'canonical:1',
    canonicalUrl: 'https://github.com/example/tool',
    displayTitle: 'Acme Tool',
    searchText: 'Acme Tool',
    sourceCount: 2,
    sources: ['raindrop', 'x'],
    categories: 'tool',
    primaryCategory: 'tool',
    domains: 'github.com',
    primaryDomain: 'github.com',
  }]);

  assert.match(formatted, /Acme Tool/);
  assert.match(formatted, /\[raindrop\]/);
  assert.match(formatted, /\[x\]/);
  assert.match(formatted, /https:\/\/github\.com\/example\/tool/);
  assert.match(formatted, /tool/);
  assert.match(formatted, /github\.com/);
  assert.equal(formatCanonicalSearchResults([]), 'No unified bookmarks found.');
});

test('classifyCanonicalBookmarks classifies raindrop-only GitHub bookmarks as tool', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), []);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev', 'Tools'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const summary = await classifyCanonicalBookmarks();
    assert.deepEqual(summary, { total: 1, classified: 1 });

    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://github.com/example/tool');
    assert.equal(rows[0].primaryCategory, 'tool');
    assert.equal(rows[0].categories, 'tool');
    assert.equal(rows[0].primaryDomain, 'github.com');
    assert.equal(rows[0].domains, 'github.com');
    assert.deepEqual(rows[0].sources, ['raindrop']);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, rows[0].id);
  });
});

test('rebuildCanonicalIndex does not dedupe X bookmark with multiple external links against raindrop URL', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'x-1',
      tweetId: '1',
      url: 'https://x.com/alice/status/1',
      text: 'Two useful links',
      links: [
        'https://github.com/example/tool',
        'https://example.com/other',
      ],
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    const result = await rebuildCanonicalIndex();
    assert.equal(result.sourceCount, 2);
    assert.equal(result.canonicalCount, 2);

    const matches = await searchCanonicalBookmarks({ query: 'Acme', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceCount, 1);
    assert.deepEqual(matches[0].sources, ['raindrop']);
  });
});

test('rebuildCanonicalIndex skips malformed raindrop URLs without crashing', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [
      {
        id: 10,
        url: 'https://example.com/ok',
        title: 'Good',
        createdAt: '2026-05-10T00:00:00.000Z',
        syncedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        id: 11,
        url: 'not a valid url',
        title: 'Bad',
        createdAt: '2026-05-10T00:00:00.000Z',
        syncedAt: '2026-05-10T00:00:00.000Z',
      },
    ]);

    const result = await rebuildCanonicalIndex();
    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });

    assert.equal(result.sourceCount, 1);
    assert.equal(result.canonicalCount, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://example.com/ok');
  });
});

test('rebuildCanonicalIndex preserves canonical classification metadata across rebuilds', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();

    const dbPath = twitterBookmarksIndexPath();
    const db = await openDb(dbPath);
    try {
      db.run(
        `UPDATE canonical_bookmarks
         SET categories = ?, primary_category = ?, domains = ?, primary_domain = ?`,
        ['tool,launch', 'tool', 'github.com', 'github.com'],
      );
      saveDb(db, dbPath);
    } finally {
      db.close();
    }

    await rebuildCanonicalIndex();

    const after = await openDb(dbPath);
    try {
      const row = after.exec(
        `SELECT categories, primary_category, domains, primary_domain
         FROM canonical_bookmarks`,
      )[0]?.values[0];
      assert.deepEqual(row, ['tool,launch', 'tool', 'github.com', 'github.com']);
    } finally {
      after.close();
    }
  });
});

test('searchCanonicalBookmarks treats FTS punctuation as literal query text', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://example.com/foo',
      title: 'foo(bar) notes',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const matches = await searchCanonicalBookmarks({ query: 'foo(bar)', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'foo(bar) notes');
  });
});

test('rebuildCanonicalIndex migrates older canonical tables without classification columns', async () => {
  await withIsolatedDataDir(async (dir) => {
    const dbPath = twitterBookmarksIndexPath();
    const db = await openDb(dbPath);
    try {
      db.run(`CREATE TABLE canonical_bookmarks (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT UNIQUE NOT NULL,
        canonical_url TEXT,
        display_title TEXT,
        search_text TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        first_saved_at TEXT,
        last_saved_at TEXT,
        sources_json TEXT
      )`);
      db.run(`CREATE TABLE bookmark_sources (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        profile TEXT,
        source_item_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        target_url TEXT,
        dedupe_key TEXT NOT NULL,
        title TEXT,
        text TEXT,
        author_handle TEXT,
        saved_at TEXT,
        created_at TEXT,
        modified_at TEXT,
        folder_path_json TEXT,
        links_json TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        canonical_id TEXT
      )`);
      saveDb(db, dbPath);
    } finally {
      db.close();
    }

    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://github.com/example/tool',
      title: 'Acme Tool',
      collectionPath: ['Dev'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);

    await rebuildCanonicalIndex();
    const summary = await classifyCanonicalBookmarks();
    const rows = await listCanonicalBookmarks({ source: 'raindrop', limit: 10 });

    assert.deepEqual(summary, { total: 1, classified: 1 });
    assert.equal(rows[0].primaryCategory, 'tool');
  });
});

// ── classifyCanonicalBookmarksWithLlm ──────────────────────────────────

test('classifyCanonicalBookmarksWithLlm writes LLM categories back to canonical rows', async () => {
  await withIsolatedDataDir(async (dir) => {
    // One raindrop row (regex won't categorize) + one github-stars row (regex tags 'tool')
    await writeRaindropBookmarks(dir, [{
      id: 10,
      url: 'https://blog.example.com/some-essay',
      title: 'Opinionated rant about energy policy',
      collectionPath: ['Energy'],
      createdAt: '2026-05-10T00:00:00.000Z',
      syncedAt: '2026-05-10T00:00:00.000Z',
    }]);
    await writeGitHubStars(dir, [githubStarRecord()]);

    await rebuildCanonicalIndex();

    // First run the regex sweep — the gh-stars row gets primary_category='tool',
    // the raindrop essay is left null (regex finds no match).
    await classifyCanonicalBookmarks();

    const postRegex = await listCanonicalBookmarks({ limit: 50 });
    const raindropRow = postRegex.find((r) => r.canonicalUrl?.includes('blog.example.com'));
    // regex classifier leaves rows without a match as 'unclassified' (its default placeholder)
    assert.ok(
      raindropRow?.primaryCategory === null || raindropRow?.primaryCategory === 'unclassified',
      `expected null or 'unclassified', got ${JSON.stringify(raindropRow?.primaryCategory)}`,
    );

    // Now run the LLM classifier with a fake engine. /bin/true spawns cleanly
    // but returns empty output — the batch should fail gracefully; failed ===
    // totalUnclassified and the raindrop row stays null.
    const { classifyCanonicalBookmarksWithLlm } = await import('../src/canonical-bookmarks-db.js');
    const result = await classifyCanonicalBookmarksWithLlm({
      engine: {
        name: 'fake',
        config: {
          bin: '/bin/true',
          args: () => [],
        },
        label: 'fake',
      } as any,
      onBatch: () => {},
    });

    assert.equal(result.engine, 'fake');
    assert.equal(result.totalUnclassified, 1);
    assert.equal(result.classified, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.batches, 1);

    // State preserved — the gh-stars row stays classified from the regex pass
    const finalRows = await listCanonicalBookmarks({ limit: 50 });
    const ghRow = finalRows.find((r) => r.canonicalUrl?.includes('github.com'));
    assert.equal(ghRow?.primaryCategory, 'tool');
  });
});
