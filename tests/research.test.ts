import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';
import { writeJsonLines } from '../src/fs.js';
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

test('researchLocalContext returns grouped canonical and library results with next commands', async () => {
  await withIsolatedRoots(async (dataDir, libraryDir) => {
    await mkdir(path.join(dataDir, 'github-stars'), { recursive: true });
    await writeJsonLines(path.join(dataDir, 'github-stars', 'stars.jsonl'), [githubStarRecord()]);
    await writeFile(path.join(libraryDir, 'memory.md'), '# Agent memory\n\nNotes about agent memory systems.\n');
    await rebuildCanonicalIndex();

    const result = await researchLocalContext('agent memory', { limit: 5 });
    assert.equal(result.query, 'agent memory');
    assert.equal(result.canonical.length, 1);
    assert.equal(result.canonical[0].title, 'example/tool');
    assert.deepEqual(result.canonical[0].sources, ['github-stars']);
    assert.equal(result.library.length, 1);
    assert.equal(result.library[0].relPath, 'memory.md');
    assert.ok(result.next.includes('ft show --unified <id> --json'));
  });
});
