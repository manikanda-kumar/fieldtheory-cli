import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchCanonicalBookmarks, upsertYoutubeVideosAsSources } from '../src/canonical-bookmarks-db.js';

async function withIsolatedDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-youtube-canonical-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('upsertYoutubeVideosAsSources indexes YouTube notes into canonical search', async () => {
  await withIsolatedDataDir(async () => {
    await upsertYoutubeVideosAsSources([{
      videoId: 'v1',
      title: 'Vector Databases Explained',
      tldr: 'Embeddings make semantic search practical.',
      topics: ['AI', 'Search'],
      published: '2026-05-01T00:00:00.000Z',
    }]);

    const matches = await searchCanonicalBookmarks({ query: 'semantic', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'Vector Databases Explained');
    assert.deepEqual(matches[0].sources, ['youtube']);
  });
});

test('upsertYoutubeVideosAsSources includes key points in canonical search text', async () => {
  await withIsolatedDataDir(async () => {
    await upsertYoutubeVideosAsSources([{
      videoId: 'v1',
      title: 'Agent Evaluation Talk',
      tldr: 'A practical overview.',
      keyPoints: ['Rubrics catch regressions before shipping.'],
      topics: ['AI'],
    }]);

    const matches = await searchCanonicalBookmarks({ query: 'rubrics', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'Agent Evaluation Talk');
  });
});

test('upsertYoutubeVideosAsSources is idempotent for the same video', async () => {
  await withIsolatedDataDir(async () => {
    await upsertYoutubeVideosAsSources([{ videoId: 'v1', title: 'Original', tldr: 'alpha', topics: [] }]);
    await upsertYoutubeVideosAsSources([{ videoId: 'v1', title: 'Updated', tldr: 'beta', topics: [] }]);

    const matches = await searchCanonicalBookmarks({ query: '', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'Updated');
  });
});
