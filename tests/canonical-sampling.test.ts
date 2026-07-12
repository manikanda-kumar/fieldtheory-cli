import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLines } from '../src/fs.js';
import {
  getCanonicalCategoryCounts,
  getCanonicalDomainCounts,
  getCanonicalSourceCounts,
  sampleCanonicalByCategory,
  sampleCanonicalByDomain,
  sampleCanonicalBySource,
  rebuildCanonicalIndex,
  classifyCanonicalBookmarks,
} from '../src/canonical-bookmarks-db.js';
import type { RaindropRecord } from '../src/raindrop/types.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-canonical-sample-'));
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

function raindropRecord(overrides: Partial<RaindropRecord> = {}): RaindropRecord {
  return {
    id: 10,
    url: 'https://example.com/article',
    title: 'AI research article',
    excerpt: 'Deep learning breakthroughs',
    note: '',
    tags: ['ai', 'research'],
    important: false,
    collectionPath: ['Research'],
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    syncedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

test('getCanonicalCategoryCounts: empty DB returns empty object', async () => {
  await withIsolatedDataDir(async () => {
    await rebuildCanonicalIndex();
    const counts = await getCanonicalCategoryCounts();
    assert.equal(Object.keys(counts).length, 0);
  });
});

test('getCanonicalCategoryCounts: excludes unclassified', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [
      raindropRecord({ id: 1, url: 'https://example.com/a' }),
      raindropRecord({ id: 2, url: 'https://example.com/b' }),
    ]);
    await writeGitHubStars(dir, [githubStarRecord()]);
    await rebuildCanonicalIndex();
    await classifyCanonicalBookmarks();

    const counts = await getCanonicalCategoryCounts();
    // Unclassified should never appear as a key
    assert.ok(!('unclassified' in counts));
  });
});

test('getCanonicalDomainCounts: empty DB returns empty object', async () => {
  await withIsolatedDataDir(async () => {
    await rebuildCanonicalIndex();
    const counts = await getCanonicalDomainCounts();
    assert.equal(Object.keys(counts).length, 0);
  });
});

test('getCanonicalSourceCounts: counts distinct canonical_ids per source', async () => {
  await withIsolatedDataDir(async (dir) => {
    // Two raindrop bookmarks with different URLs → 2 canonical rows
    await writeRaindropBookmarks(dir, [
      raindropRecord({ id: 1, url: 'https://example.com/a' }),
      raindropRecord({ id: 2, url: 'https://example.com/b' }),
    ]);
    // One GitHub star with same URL as raindrop #1 → dedupes to same canonical row
    await writeGitHubStars(dir, [githubStarRecord({ htmlUrl: 'https://example.com/a' })]);
    await rebuildCanonicalIndex();

    const counts = await getCanonicalSourceCounts();
    assert.ok(counts['raindrop'] >= 2);
    assert.ok(counts['github-stars'] >= 1);
  });
});

test('sampleCanonicalBySource: returns matching rows with correct fields', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [
      raindropRecord({ id: 1, url: 'https://example.com/a', title: 'Alpha' }),
      raindropRecord({ id: 2, url: 'https://example.com/b', title: 'Beta' }),
    ]);
    await rebuildCanonicalIndex();

    const samples = await sampleCanonicalBySource('raindrop', 10);
    assert.ok(samples.length > 0);
    assert.ok(samples.every((s) => s.id.length > 0));
    assert.ok(samples.every((s) => s.sources.includes('raindrop')));
    // Text should include the title
    assert.ok(samples.some((s) => s.text.includes('Alpha') || s.text.includes('Beta')));
  });
});

test('sampleCanonicalByCategory: returns empty for non-existent category', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [raindropRecord()]);
    await rebuildCanonicalIndex();

    const samples = await sampleCanonicalByCategory('nonexistent', 10);
    assert.equal(samples.length, 0);
  });
});

test('sampleCanonicalByDomain: returns empty for non-existent domain', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeRaindropBookmarks(dir, [raindropRecord()]);
    await rebuildCanonicalIndex();

    const samples = await sampleCanonicalByDomain('nonexistent.invalid', 10);
    assert.equal(samples.length, 0);
  });
});
