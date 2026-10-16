import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCanonicalBookmarksSince, searchCanonicalBookmarks, upsertYoutubeVideosAsSources } from '../src/canonical-bookmarks-db.js';
import { collectDaily } from '../src/daily/collect.js';

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

test('upsertYoutubeVideosAsSources includes chapter summaries in canonical search text', async () => {
  await withIsolatedDataDir(async () => {
    await upsertYoutubeVideosAsSources([{
      videoId: 'v1',
      title: 'Agent Memory Walkthrough',
      tldr: 'A practical overview.',
      topics: ['AI'],
      chapters: [{
        tSec: 125,
        label: 'Retrieval plan',
        summary: 'Durable recall uses episodic checkpoints and latent scratchpads for long-running agents.',
      }],
      notePath: '/tmp/youtube-notes/v1.md',
    }]);

    const matches = await searchCanonicalBookmarks({ query: 'episodic checkpoints', limit: 10 });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'Agent Memory Walkthrough');
  });
});

test('upsertYoutubeVideosAsSources refreshes content without making existing videos newly saved', async (t) => {
  const originalSavedAt = '2026-07-08T12:00:00.000Z';
  const backfilledAt = '2026-10-16T06:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: new Date(originalSavedAt) });
  await withIsolatedDataDir(async () => {
    await upsertYoutubeVideosAsSources([{ videoId: 'v1', title: 'Original', tldr: 'alpha', topics: [] }]);
    t.mock.timers.setTime(new Date(backfilledAt).getTime());
    await upsertYoutubeVideosAsSources([
      { videoId: 'v1', title: 'Updated', tldr: 'beta', topics: [] },
      { videoId: 'v2', title: 'New video', tldr: 'gamma', topics: [] },
    ]);

    const matches = await searchCanonicalBookmarks({ query: 'beta', limit: 10 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].displayTitle, 'Updated');
    assert.equal((await searchCanonicalBookmarks({ query: 'alpha', limit: 10 })).length, 0);

    const indexed = await getCanonicalBookmarksSince('2026-01-01T00:00:00.000Z');
    assert.equal(indexed.length, 2);
    const updated = indexed.find((item) => item.displayTitle === 'Updated')!;
    assert.equal(updated.firstSavedAt, originalSavedAt);
    assert.equal(updated.lastSavedAt, originalSavedAt);
    assert.equal(indexed.find((item) => item.displayTitle === 'New video')!.firstSavedAt, backfilledAt);

    const daily = await collectDaily({ date: '2026-10-16' });
    assert.deepEqual(daily.items.map((item) => item.displayTitle), ['New video']);
  });
});
