import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processVideo } from '../src/youtube/overview.js';

async function withTempRoots<T>(fn: (roots: { dataDir: string; libraryDir: string }) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-youtube-overview-'));
  const previous = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR };
  process.env.FT_DATA_DIR = path.join(tmp, 'data');
  process.env.FT_LIBRARY_DIR = path.join(tmp, 'library');
  try {
    return await fn({ dataDir: process.env.FT_DATA_DIR, libraryDir: process.env.FT_LIBRARY_DIR });
  } finally {
    if (previous.FT_DATA_DIR === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous.FT_DATA_DIR;
    if (previous.FT_LIBRARY_DIR === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = previous.FT_LIBRARY_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('processVideo notes-only path writes markdown, indexes, and marks state done', async () => {
  await withTempRoots(async ({ libraryDir }) => {
    const result = await processVideo('v1', {
      overview: 'none',
      force: false,
      fetchVideo: async () => ({
        meta: { title: 'Video Title', channel: 'Channel', durationSec: 5 },
        transcriptText: 'hello transcript',
        segments: [{ tSec: 0, durationSec: 5, text: 'hello transcript' }],
        frames: null,
        contentHash: 'hash-1',
      }),
      llm: { chat: async () => ({ text: '{}', json: { tldr: 'Useful summary', keyPoints: [], chapters: [], actionItems: [], topics: ['testing'] } }) },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.processed, true);
    assert.equal(result.notesPath, path.join(libraryDir, 'youtube', 'v1.md'));
    assert.match(await fs.readFile(result.notesPath!, 'utf8'), /Useful summary/);
  });
});

test('processVideo skips unchanged done videos unless forced', async () => {
  await withTempRoots(async () => {
    const common = {
      overview: 'none' as const,
      fetchVideo: async () => ({
        meta: { title: 'Video Title' },
        transcriptText: 'hello transcript',
        segments: [{ tSec: 0, durationSec: 5, text: 'hello transcript' }],
        frames: null,
        contentHash: 'hash-1',
      }),
      llm: { chat: async () => ({ text: '{}', json: { tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } }) },
    };
    await processVideo('v1', { ...common, force: false });
    const second = await processVideo('v1', { ...common, force: false });

    assert.equal(second.processed, false);
    assert.equal(second.status, 'skipped-unchanged');
  });
});
