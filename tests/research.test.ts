import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';
import { writeJsonLines } from '../src/fs.js';
import { reindexLibraryDocs } from '../src/library-index-db.js';
import { researchLocalContext } from '../src/research.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';

async function withIsolatedRoots(fn: (dataDir: string, libraryDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-research-'));
  const previousData = process.env.FT_DATA_DIR;
  const previousLibrary = process.env.FT_LIBRARY_DIR;
  process.env.FT_DATA_DIR = path.join(root, 'data');
  process.env.FT_LIBRARY_DIR = path.join(root, 'library');
  try {
    await mkdir(process.env.FT_DATA_DIR, { recursive: true });
    await mkdir(process.env.FT_LIBRARY_DIR, { recursive: true });
    await fn(process.env.FT_DATA_DIR, process.env.FT_LIBRARY_DIR);
  } finally {
    if (previousData === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previousData;
    if (previousLibrary === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = previousLibrary;
    await rm(root, { recursive: true, force: true });
  }
}

function githubStarRecord(): GitHubStarRecord {
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
  };
}

test('researchLocalContext retains portable fallback without a library index', async () => {
  await withIsolatedRoots(async (dataDir, libraryDir) => {
    await mkdir(path.join(dataDir, 'github-stars'), { recursive: true });
    await writeJsonLines(path.join(dataDir, 'github-stars', 'stars.jsonl'), [githubStarRecord()]);
    await writeFile(path.join(libraryDir, 'memory.md'), '# Agent memory\n\nNotes about agent memory systems.\n');
    await mkdir(path.join(libraryDir, 'bookmarks'));
    await writeFile(path.join(libraryDir, 'bookmarks', 'export.md'), '# Agent memory bookmark export\n');
    await rebuildCanonicalIndex();

    const result = await researchLocalContext('agent memory', { limit: 5, tweetsmash: false });
    assert.equal(result.query, 'agent memory');
    assert.equal(result.canonical.length, 1);
    assert.equal(result.canonical[0].title, 'example/tool');
    assert.deepEqual(result.canonical[0].sources, ['github-stars']);
    assert.equal(result.library.length, 1);
    assert.equal(result.library[0].relPath, 'memory.md');
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.tweetsmash.length, 0);
    assert.deepEqual(result.truncated, { canonical: false, library: false, today: false, experts: false, tweetsmash: false });
    assert.ok(result.next.includes('ft show --unified <id> --json'));
    await assert.rejects(access(path.join(dataDir, 'library.db')));
  });
});

test('researchLocalContext uses ranked library FTS for notes without duplicating bookmark exports', async () => {
  await withIsolatedRoots(async (dataDir, libraryDir) => {
    await mkdir(path.join(dataDir, 'github-stars'), { recursive: true });
    await writeJsonLines(path.join(dataDir, 'github-stars', 'stars.jsonl'), [githubStarRecord()]);
    await mkdir(path.join(libraryDir, 'concepts'), { recursive: true });
    await mkdir(path.join(libraryDir, 'youtube', '2026-06'), { recursive: true });
    await mkdir(path.join(libraryDir, 'bookmarks'), { recursive: true });
    await writeFile(path.join(libraryDir, 'concepts', 'memory.md'), '# Agent memory\n\nA practical guide.\n');
    await writeFile(path.join(libraryDir, 'youtube', '2026-06', 'talk.md'), '# A talk\n\nThe speaker explains agent memory once.\n');
    await writeFile(path.join(libraryDir, 'bookmarks', 'export.md'), '# Agent memory bookmark export\n');
    await rebuildCanonicalIndex();
    await reindexLibraryDocs();
    const indexPath = path.join(dataDir, 'library.db');
    const before = await readFile(indexPath);

    const result = await researchLocalContext('agent memory', { limit: 5, tweetsmash: false });
    assert.deepEqual(result.canonical.map((hit) => hit.title), ['example/tool']);
    assert.deepEqual(result.library.map((hit) => hit.relPath), [
      'concepts/memory.md',
      'youtube/2026-06/talk.md',
    ]);
    assert.deepEqual(Object.keys(result.library[0]).sort(), ['path', 'relPath', 'size', 'snippet', 'title', 'updatedAt']);
    assert.equal(result.library[0].path, path.join(libraryDir, 'concepts', 'memory.md'));
    assert.match(result.library[1].snippet, /agent memory/);

    // A newly written, unindexed file must not turn a genuine FTS miss into a broad scan.
    await writeFile(path.join(libraryDir, 'fresh.md'), '# uniquefreshword\n');
    const miss = await researchLocalContext('uniquefreshword', { tweetsmash: false });
    assert.deepEqual(miss.library, []);
    assert.deepEqual(await readFile(indexPath), before); // Recall does not refresh the index.
  });
});

test('researchLocalContext appends Tweetsmash hits that local FTS missed', async () => {
  await withIsolatedRoots(async (dataDir, libraryDir) => {
    await mkdir(path.join(dataDir, 'github-stars'), { recursive: true });
    await writeJsonLines(path.join(dataDir, 'github-stars', 'stars.jsonl'), [githubStarRecord()]);
    await writeFile(path.join(libraryDir, 'memory.md'), '# Agent memory\n\nNotes about agent memory systems.\n');
    await rebuildCanonicalIndex();

    const previousKey = process.env.TWEETSMASH_API_KEY;
    process.env.TWEETSMASH_API_KEY = 'test-key';
    try {
      const result = await researchLocalContext('agent memory', {
        limit: 5,
        fetchImpl: (async () => new Response(JSON.stringify({
          status: true,
          data: [{
            post_id: '999',
            author_username: 'swyx',
            tweet_details: {
              text: 'closing the agent memory loop',
              link: 'https://x.com/swyx/status/999',
            },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
      });
      assert.equal(result.tweetsmash.length, 1);
      assert.equal(result.tweetsmash[0].id, '999');
      assert.equal(result.tweetsmash[0].title, '@swyx');
      assert.deepEqual(result.tweetsmash[0].sources, ['tweetsmash']);
    } finally {
      if (previousKey === undefined) delete process.env.TWEETSMASH_API_KEY;
      else process.env.TWEETSMASH_API_KEY = previousKey;
    }
  });
});
