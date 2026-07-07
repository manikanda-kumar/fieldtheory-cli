import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { rebuildCanonicalIndex, relatedSeedTerms } from '../src/canonical-bookmarks-db.js';
import { collectDaily } from '../src/daily/collect.js';
import { connectDailyItems } from '../src/daily/connect.js';
import { dailyDigestPath, dailyMetaPath, ensureDailyDir } from '../src/daily/paths.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';
import type { ProjectRecord } from '../src/projects/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-daily-'));
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

function starRecord(overrides: Partial<GitHubStarRecord> & { id: number; fullName: string; starredAt: string }): GitHubStarRecord {
  const [owner, name] = overrides.fullName.split('/');
  return {
    owner,
    name,
    htmlUrl: `https://github.com/${overrides.fullName}`,
    description: null,
    homepageUrl: null,
    language: null,
    topics: [],
    stargazersCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: null,
    updatedAt: null,
    createdAt: null,
    syncedAt: overrides.starredAt,
    ...overrides,
  } as GitHubStarRecord;
}

async function writeStars(dir: string, records: GitHubStarRecord[]): Promise<void> {
  const githubDir = path.join(dir, 'github-stars');
  await mkdir(githubDir, { recursive: true });
  await writeJsonLines(path.join(githubDir, 'stars.jsonl'), records);
}

function projectRecord(overrides: Partial<ProjectRecord> & { repo: string }): ProjectRecord {
  return {
    path: `/tmp/${overrides.repo}`,
    pendingFiles: 0,
    unpushedCommits: 0,
    recentCommits: [],
    scannedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  } as ProjectRecord;
}

test('daily: collect windows on first_saved_at and gathers project deltas', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/fresh-agent-memory', starredAt: '2026-07-06T12:00:00.000Z', description: 'agent memory toolkit' }),
      starRecord({ id: 2, fullName: 'b/old-agent-memory', starredAt: '2026-06-01T00:00:00.000Z', description: 'older agent memory library' }),
    ]);
    const projectsDir = path.join(dir, 'projects');
    await mkdir(projectsDir, { recursive: true });
    await writeJsonLines(path.join(projectsDir, 'projects.jsonl'), [
      projectRecord({
        repo: 'active-repo',
        recentCommits: [
          { hash: 'aaa', date: '2026-07-06T10:00:00.000Z', subject: 'inside window' },
          { hash: 'bbb', date: '2026-06-20T10:00:00.000Z', subject: 'outside window' },
        ],
        recentPrompts: [
          { timestamp: '2026-07-06T11:00:00.000Z', text: 'how do I wire the daily digest?' },
        ],
      }),
      projectRecord({ repo: 'idle-repo' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });

    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].canonicalUrl, 'https://github.com/a/fresh-agent-memory');
    assert.equal(collection.projectDeltas.length, 1);
    assert.equal(collection.projectDeltas[0].repo, 'active-repo');
    assert.equal(collection.projectDeltas[0].commits.length, 1);
    assert.equal(collection.projectDeltas[0].prompts.length, 1);
  });
});

test('daily: collect uses watermark when no date given and caps at 7 days', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/new-tool', starredAt: '2026-07-06T12:00:00.000Z' }),
      starRecord({ id: 2, fullName: 'b/ancient-tool', starredAt: '2026-05-01T00:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    ensureDailyDir();
    await writeJson(dailyMetaPath(), { lastRunAt: '2026-05-01T00:00:00.000Z' });

    const collection = await collectDaily({ now: new Date('2026-07-07T00:00:00.000Z') });

    // Watermark is older than the 7-day cap, so the window is clamped.
    assert.equal(collection.sinceIso, '2026-06-30T00:00:00.000Z');
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].canonicalUrl, 'https://github.com/a/new-tool');
  });
});

test('daily: connect links new items to older related items only', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/vector-search-engine', starredAt: '2026-07-06T12:00:00.000Z', description: 'blazing vector search embeddings engine' }),
      starRecord({ id: 2, fullName: 'b/vector-search-primer', starredAt: '2026-06-10T00:00:00.000Z', description: 'a primer on vector search embeddings' }),
      starRecord({ id: 3, fullName: 'c/unrelated-css-thing', starredAt: '2026-06-11T00:00:00.000Z', description: 'css layout helpers' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    assert.equal(collection.items.length, 1);

    const connected = await connectDailyItems(collection);
    assert.equal(connected.length, 1);
    const relatedUrls = connected[0].related.map((ref) => ref.url);
    assert.ok(relatedUrls.includes('https://github.com/b/vector-search-primer'));
    assert.ok(!relatedUrls.includes('https://github.com/a/vector-search-engine'), 'must exclude the new item itself');
  });
});

test('daily: relatedSeedTerms drops stopwords, short words, and numbers', () => {
  const terms = relatedSeedTerms('This is about Vector Search with 12345 embeddings from GitHub http links');
  assert.deepEqual(terms, ['vector', 'search', 'embeddings', 'links']);
});

test('daily: digest path validates date shape', () => {
  assert.throws(() => dailyDigestPath('not-a-date'));
  assert.match(dailyDigestPath('2026-07-07'), /daily[/\\]2026-07-07\.md$/);
});
