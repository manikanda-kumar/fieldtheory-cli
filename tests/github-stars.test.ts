import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLines } from '../src/fs.js';
import {
  fetchGitHubStars,
  fetchGitHubStarsPage,
  normalizeGitHubStarItem,
} from '../src/github-stars/client.js';
import { syncGitHubStars } from '../src/github-stars/sync.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';

function apiItem(id: number, fullName: string, starredAt: string, overrides: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/');
  return {
    starred_at: starredAt,
    repo: {
      id,
      full_name: fullName,
      name,
      owner: { login: owner },
      html_url: `https://github.com/${fullName}`,
      description: 'Repository description',
      homepage: '',
      language: 'TypeScript',
      topics: ['cli', 'knowledge-management'],
      stargazers_count: 123,
      forks_count: 4,
      open_issues_count: 2,
      archived: false,
      fork: false,
      default_branch: 'main',
      pushed_at: '2026-05-20T10:00:00Z',
      updated_at: '2026-05-25T09:00:00Z',
      ...overrides,
    },
  };
}

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-github-stars-'));
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

test('normalizeGitHubStarItem maps starred REST response to cache record', () => {
  const record = normalizeGitHubStarItem(
    apiItem(1, 'owner/repo', '2026-05-31T12:34:56Z'),
    '2026-05-31T13:00:00Z',
  );

  assert.ok(record);
  assert.equal(record.fullName, 'owner/repo');
  assert.equal(record.owner, 'owner');
  assert.equal(record.name, 'repo');
  assert.equal(record.htmlUrl, 'https://github.com/owner/repo');
  assert.equal(record.starredAt, '2026-05-31T12:34:56Z');
  assert.deepEqual(record.topics, ['cli', 'knowledge-management']);
  assert.equal(record.syncedAt, '2026-05-31T13:00:00Z');
});

test('fetchGitHubStarsPage prefers gh api when available', async () => {
  const { records } = await fetchGitHubStarsPage(1, 100, {
    now: () => '2026-05-31T13:00:00Z',
    runGhApi: async (pathWithQuery) => {
      assert.equal(pathWithQuery, 'user/starred?per_page=100&page=1&sort=created&direction=desc');
      return [apiItem(1, 'owner/repo', '2026-05-31T12:34:56Z')];
    },
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].fullName, 'owner/repo');
});

test('fetchGitHubStarsPage counts skipped malformed records', async () => {
  const { records, skipped } = await fetchGitHubStarsPage(1, 100, {
    now: () => '2026-05-31T13:00:00Z',
    runGhApi: async () => [
      apiItem(1, 'owner/repo', '2026-05-31T12:34:56Z'),
      { starred_at: '2026-05-30T00:00:00Z', repo: { id: 0, full_name: '', html_url: '' } },
      { not: 'a repo' },
    ],
  });

  assert.equal(records.length, 1);
  assert.equal(skipped, 2);
});

test('fetchGitHubStarsPage falls back to token auth and sends star accept header', async () => {
  let acceptHeader = '';
  let authorization = '';
  const { records } = await fetchGitHubStarsPage(2, 50, {
    token: 'token-123',
    now: () => '2026-05-31T13:00:00Z',
    runGhApi: async () => {
      throw new Error('gh unavailable');
    },
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      acceptHeader = headers.Accept;
      authorization = headers.Authorization;
      return new Response(JSON.stringify([apiItem(2, 'owner/second', '2026-05-30T12:34:56Z')]), { status: 200 });
    }) as typeof fetch,
  });

  assert.equal(acceptHeader, 'application/vnd.github.star+json');
  assert.equal(authorization, 'Bearer token-123');
  assert.equal(records[0].fullName, 'owner/second');
});

test('fetchGitHubStars paginates until incremental cutoff', async () => {
  const pages = new Map<number, unknown[]>([
    [1, [
      apiItem(3, 'owner/newer', '2026-05-31T12:34:56Z'),
      apiItem(2, 'owner/existing', '2026-05-30T12:34:56Z'),
    ]],
    [2, [apiItem(1, 'owner/old', '2026-05-29T12:34:56Z')]],
  ]);

  const result = await fetchGitHubStars({
    lastStarredAt: '2026-05-30T12:34:56Z',
    perPage: 2,
    runGhApi: async (pathWithQuery) => {
      const page = Number(new URLSearchParams(pathWithQuery.split('?')[1]).get('page'));
      return pages.get(page) ?? [];
    },
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].fullName, 'owner/newer');
  assert.equal(result.newestStarredAt, '2026-05-31T12:34:56Z');
});

test('syncGitHubStars upserts records and honors dry-run', async () => {
  await withIsolatedDataDir(async (dir) => {
    const existing: GitHubStarRecord = {
      id: 1,
      fullName: 'owner/existing',
      owner: 'owner',
      name: 'existing',
      htmlUrl: 'https://github.com/owner/existing',
      description: 'Old',
      homepageUrl: null,
      language: 'TypeScript',
      topics: [],
      stargazersCount: 1,
      forksCount: 0,
      openIssuesCount: 0,
      isArchived: false,
      isFork: false,
      defaultBranch: 'main',
      pushedAt: null,
      updatedAt: '2026-05-20T00:00:00Z',
      starredAt: '2026-05-20T00:00:00Z',
      syncedAt: '2026-05-20T00:00:00Z',
    };
    await mkdir(path.join(dir, 'github-stars'), { recursive: true });
    await writeJsonLines(path.join(dir, 'github-stars', 'stars.jsonl'), [existing]);

    const dryRun = await syncGitHubStars({
      dryRun: true,
      runGhApi: async () => [apiItem(2, 'owner/new', '2026-05-31T12:34:56Z')],
    });
    assert.equal(dryRun.added, 1);
    assert.equal(dryRun.total, 2);
    assert.equal(dryRun.skipped, 0);

    const result = await syncGitHubStars({
      runGhApi: async () => [
        apiItem(1, 'owner/existing', '2026-05-20T00:00:00Z', { description: 'Updated' }),
        apiItem(2, 'owner/new', '2026-05-31T12:34:56Z'),
      ],
    });
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);

    const cache = await readFile(path.join(dir, 'github-stars', 'stars.jsonl'), 'utf8');
    assert.match(cache, /owner\/new/);
    assert.match(cache, /owner\/existing/);
  });
});
