import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildIndex, updateArticleContent } from '../src/bookmarks-db.js';
import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';
import { writeJsonLines } from '../src/fs.js';
import { exportBookmarks, exportCanonicalBookmarks } from '../src/md-export.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>, fixtures: any[]): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ft-md-export-'));
  const jsonl = fixtures.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(path.join(dir, 'bookmarks.jsonl'), jsonl);

  const saved = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (saved !== undefined) process.env.FT_DATA_DIR = saved;
    else delete process.env.FT_DATA_DIR;
  }
}

test('exportBookmarks: writes ISO dates for legacy postedAt in filenames and frontmatter', async () => {
  const fixtures = [
    {
      id: '1908170645818536087',
      tweetId: '1908170645818536087',
      url: 'https://x.com/Thom_Wolf/status/1908170645818536087',
      text: 'Test md export dates',
      authorHandle: 'Thom_Wolf',
      authorName: 'Thomas Wolf',
      syncedAt: '2026-04-18T00:00:00.000Z',
      postedAt: 'Fri Apr 04 19:53:15 +0000 2026',
      bookmarkedAt: '2026-04-17T08:07:48.007Z',
      language: 'en',
      engagement: { likeCount: 61, repostCount: 12 },
      mediaObjects: [],
      links: [],
      tags: [],
      ingestedVia: 'graphql',
    },
  ];

  await withIsolatedDataDir(async (dir) => {
    await buildIndex();

    const result = await exportBookmarks({ force: true });
    assert.equal(result.exported, 1);

    const bookmarksDir = path.join(dir, 'md', 'bookmarks');
    const files = await readdir(bookmarksDir);
    assert.deepEqual(files, ['2026-04-04-thom-wolf-test-md-export-dates.md']);

    const content = await readFile(path.join(bookmarksDir, files[0]), 'utf8');
    assert.match(content, /^posted_at: 2026-04-04$/m);
    assert.match(content, /^bookmarked_at: 2026-04-17$/m);
  }, fixtures);
});

test('exportBookmarks: includes enriched article content for X Article bookmarks', async () => {
  const fixtures = [
    {
      id: '2042685676949270724',
      tweetId: '2042685676949270724',
      url: 'https://x.com/danveloper/status/2042685676949270724',
      text: 'x.com/i/article/2042...',
      authorHandle: 'danveloper',
      authorName: 'Dan Woods',
      syncedAt: '2026-04-20T00:00:00.000Z',
      postedAt: 'Fri Apr 10 19:26:31 +0000 2026',
      mediaObjects: [],
      links: ['http://x.com/i/article/2042676487711584257'],
      tags: [],
      ingestedVia: 'graphql',
    },
  ];

  await withIsolatedDataDir(async (dir) => {
    await buildIndex();
    await updateArticleContent([
      {
        id: '2042685676949270724',
        articleTitle: 'How agents should use context',
        articleText: 'The article body is the useful content. It should not be lost behind an X Article link.',
        articleSite: 'X Articles',
      },
    ]);

    const result = await exportBookmarks({ force: true });
    assert.equal(result.exported, 1);

    const bookmarksDir = path.join(dir, 'md', 'bookmarks');
    const files = await readdir(bookmarksDir);
    assert.equal(files.length, 1);

    const content = await readFile(path.join(bookmarksDir, files[0]), 'utf8');
    assert.match(content, /x\.com\/i\/article\/2042\.\.\./);
    assert.match(content, /## Article/);
    assert.match(content, /### How agents should use context/);
    assert.match(content, /The article body is the useful content/);
    assert.match(content, /## Links\n- http:\/\/x\.com\/i\/article\/2042676487711584257/);
  }, fixtures);
});

test('exportBookmarks: changed mode rewrites only stale enriched markdown', async () => {
  const fixtures = [
    {
      id: '2042685676949270724',
      tweetId: '2042685676949270724',
      url: 'https://x.com/danveloper/status/2042685676949270724',
      text: 'x.com/i/article/2042...',
      authorHandle: 'danveloper',
      authorName: 'Dan Woods',
      syncedAt: '2026-04-20T00:00:00.000Z',
      postedAt: 'Fri Apr 10 19:26:31 +0000 2026',
      mediaObjects: [],
      links: ['http://x.com/i/article/2042676487711584257'],
      tags: [],
      ingestedVia: 'graphql',
    },
    {
      id: '1908170645818536087',
      tweetId: '1908170645818536087',
      url: 'https://x.com/Thom_Wolf/status/1908170645818536087',
      text: 'Already exported note',
      authorHandle: 'Thom_Wolf',
      authorName: 'Thomas Wolf',
      syncedAt: '2026-04-18T00:00:00.000Z',
      postedAt: 'Fri Apr 04 19:53:15 +0000 2026',
      mediaObjects: [],
      links: [],
      tags: [],
      ingestedVia: 'graphql',
    },
  ];

  await withIsolatedDataDir(async (dir) => {
    await buildIndex();
    const initial = await exportBookmarks({ force: true });
    assert.equal(initial.exported, 2);

    await updateArticleContent([
      {
        id: '2042685676949270724',
        articleTitle: 'How agents should use context',
        articleText: 'The article body was added after the first markdown export.',
        articleSite: 'X Articles',
      },
    ]);

    const bookmarksDir = path.join(dir, 'md', 'bookmarks');
    const files = await readdir(bookmarksDir);
    const articleFile = files.find((file) => file.includes('danveloper'));
    assert.ok(articleFile);
    const articlePath = path.join(bookmarksDir, articleFile);
    await utimes(articlePath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));

    const result = await exportBookmarks({ changed: true });
    assert.equal(result.exported, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.total, 2);

    const content = await readFile(articlePath, 'utf8');
    assert.match(content, /## Article/);
    assert.match(content, /The article body was added after the first markdown export/);
  }, fixtures);
});

test('exportCanonicalBookmarks: writes GitHub repository metadata markdown', async () => {
  await withIsolatedDataDir(async (dir) => {
    const githubDir = path.join(dir, 'github-stars');
    await mkdir(githubDir, { recursive: true });
    await writeJsonLines(path.join(githubDir, 'stars.jsonl'), [{
      id: 123456789,
      fullName: 'owner/repo',
      owner: 'owner',
      name: 'repo',
      htmlUrl: 'https://github.com/owner/repo',
      description: 'Repository description from GitHub.',
      homepageUrl: 'https://example.com',
      language: 'TypeScript',
      topics: ['cli', 'markdown', 'knowledge-management'],
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
    }]);

    await rebuildCanonicalIndex();
    const out = path.join(dir, 'out');
    await mkdir(path.join(dir, 'domains'), { recursive: true });
    await writeFile(path.join(dir, 'domains', 'github-com.md'), '# GitHub\n');
    const result = await exportCanonicalBookmarks({
      outputDir: out,
      source: 'github-stars',
      onProgress: () => {},
    });

    assert.equal(result.exported, 1);
    const files = (await readdir(out)).filter((file) => file.endsWith('.md'));
    assert.equal(files.length, 1);
    const content = await readFile(path.join(out, files[0]), 'utf8');

    assert.match(content, /^source: github-stars$/m);
    assert.match(content, /^item_type: github_repository$/m);
    assert.match(content, /^repo: "owner\/repo"$/m);
    assert.match(content, /^github_id: "123456789"$/m);
    assert.match(content, /^topics:\n  - "cli"\n  - "markdown"\n  - "knowledge-management"/m);
    assert.match(content, /^subject_topics: \["eng\/devtools"\]$/m);
    assert.match(content, /^date: 2026-05-31$/m);
    assert.match(content, /^# owner\/repo$/m);
    assert.match(content, /> Repository description from GitHub\./);
    assert.match(content, /## Repository context/);
    assert.match(content, /- Repository: \[owner\/repo\]\(https:\/\/github\.com\/owner\/repo\)/);
    assert.match(content, /## Signals/);
    assert.match(content, /- Stars: 12,345/);
    assert.match(content, /## Related/);
    assert.match(content, /\[\[domains\/github-com\]\]/);
    assert.doesNotMatch(content, /\[\[entities\//);
    assert.match(content, /^canonical_id: "canonical:[a-f0-9]{64}"$/m);
    await rm(path.join(dir, 'domains', 'github-com.md'));
    await exportCanonicalBookmarks({ outputDir: out, source: 'github-stars', onProgress: () => {} });
    const withoutPage = await readFile(path.join(out, files[0]), 'utf8');
    assert.match(withoutPage, /^domain: github\.com$/m);
    assert.doesNotMatch(withoutPage, /\[\[domains\/github-com\]\]/);
  }, []);
});

test('canonical export uses full identity, updates in place, and marks filtered runs partial without cleanup', async () => {
  const makeTweet = (id: string, text: string, bookmarkedAt: string) => ({
    id, tweetId: id, url: `https://x.com/alice/status/${id}`, text,
    authorHandle: 'alice', syncedAt: '2026-09-14T00:00:00.000Z',
    postedAt: '2026-09-13T10:00:00.000Z', bookmarkedAt,
    mediaObjects: [], links: [], tags: [], ingestedVia: 'graphql',
  });
  const first = makeTweet('111', 'Same title', '2026-09-14T00:00:00Z');
  const second = makeTweet('222', 'Same title', '2026-09-14T00:00:00Z');

  await withIsolatedDataDir(async (dir) => {
    await rebuildCanonicalIndex();
    const out = path.join(dir, 'md', 'bookmarks');
    const manifestPath = path.join(out, 'canonical-export-manifest.json');
    await exportCanonicalBookmarks({ outputDir: out, onProgress: () => {} });
    const initial = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(initial.version, 1);
    assert.equal(initial.scope, 'full');
    assert.equal(initial.source, null);
    assert.equal(initial.limit, null);
    assert.equal(initial.entries.length, 2);
    assert.equal(new Set(initial.entries.map((e: any) => e.path)).size, 2);
    for (const entry of initial.entries) {
      assert.match(entry.canonicalId, /^canonical:[a-f0-9]{64}$/);
      assert.equal(entry.path, `${entry.canonicalId.replace(':', '-')}.md`);
      const content = await readFile(path.join(out, entry.path), 'utf8');
      assert.match(content, new RegExp(`^canonical_id: "${entry.canonicalId}"$`, 'm'));
      assert.equal(entry.sha256, createHash('sha256').update(content).digest('hex'));
      for (const [, target] of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        await readFile(path.join(dir, 'md', `${target}.md`), 'utf8');
      }
    }

    const updated = makeTweet('111', 'Renamed title', '2026-10-15T00:00:00Z');
    await writeFile(path.join(dir, 'bookmarks.jsonl'), [updated, second].map(JSON.stringify).join('\n') + '\n');
    await rebuildCanonicalIndex();
    await exportCanonicalBookmarks({ outputDir: out, onProgress: () => {} });
    const next = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(next.entries.map((e: any) => e.path).sort(), initial.entries.map((e: any) => e.path).sort());
    assert.equal((await readdir(out)).filter((f) => f.endsWith('.md')).length, 2);
    assert.ok(next.entries.some((e: any) => e.sha256 !== initial.entries.find((old: any) => old.canonicalId === e.canonicalId)?.sha256));
    assert.match((await Promise.all(next.entries.map((e: any) => readFile(path.join(out, e.path), 'utf8')))).join('\n'), /Renamed title/);

    const fullSnapshot = await readFile(manifestPath, 'utf8');
    await exportCanonicalBookmarks({ outputDir: out, source: 'x', limit: 1, onProgress: () => {} });
    assert.equal(await readFile(manifestPath, 'utf8'), fullSnapshot, 'filtered runs preserve the last full snapshot');
    const partial = JSON.parse(await readFile(path.join(out, 'canonical-export-partial-manifest.json'), 'utf8'));
    assert.equal(partial.scope, 'partial');
    assert.equal(partial.source, 'x');
    assert.equal(partial.limit, 1);
    assert.equal(partial.entries.length, 1);
    assert.deepEqual((await readdir(out)).filter((f) => f.endsWith('.md')).sort(), next.entries.map((e: any) => e.path).sort());
    for (const entry of next.entries) {
      assert.equal(createHash('sha256').update(await readFile(path.join(out, entry.path))).digest('hex'), entry.sha256);
    }
    assert.equal((await exportCanonicalBookmarks({ outputDir: out, limit: 0, onProgress: () => {} })).exported, 0);
    assert.equal(await readFile(manifestPath, 'utf8'), fullSnapshot);
  }, [first, second]);
});

test('bookmark exports preserve ingested Tweetsmash labels', async () => {
  const fixtures = [{
    id: 'tagged',
    tweetId: 'tagged',
    url: 'https://x.com/alice/status/tagged',
    text: 'A bookmark whose text does not contain its topic.',
    authorHandle: 'alice',
    syncedAt: '2026-09-14T00:00:00.000Z',
    tags: ['agent-memory'],
    tweetsmashTags: ['agent-memory'],
    ingestedVia: 'graphql',
  }];

  await withIsolatedDataDir(async (dir) => {
    await buildIndex();
    await rebuildCanonicalIndex();

    await exportBookmarks({ force: true });
    const localFiles = await readdir(path.join(dir, 'md', 'bookmarks'));
    const local = await readFile(path.join(dir, 'md', 'bookmarks', localFiles[0]), 'utf8');
    assert.match(local, /^tags: \["agent-memory"\]$/m);

    const out = path.join(dir, 'canonical-out');
    await exportCanonicalBookmarks({ outputDir: out, source: 'x', onProgress: () => {} });
    const canonicalFiles = await readdir(out);
    const canonical = await readFile(path.join(out, canonicalFiles[0]), 'utf8');
    assert.match(canonical, /^tags: \["agent-memory"\]$/m);
  }, fixtures);
});
