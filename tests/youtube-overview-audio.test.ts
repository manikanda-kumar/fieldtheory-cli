import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processVideo } from '../src/youtube/overview.js';

async function withTempRoots<T>(fn: (roots: { dataDir: string; libraryDir: string }) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-youtube-audio-'));
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

test('processVideo audio overview writes mp3 artifact and links it from notes', async () => {
  await withTempRoots(async ({ dataDir }) => {
    const result = await processVideo('v1', {
      overview: 'audio',
      force: false,
      fetchVideo: async () => ({
        meta: { title: 'Audio Video' },
        transcriptText: 'hello transcript',
        segments: [{ tSec: 0, durationSec: 5, text: 'hello transcript' }],
        frames: null,
        contentHash: 'hash-audio',
      }),
      llm: { chat: async (options) => options.messages[0].content.toString().includes('condensed narration')
        ? { text: '{}', json: { segments: [{ text: 'Segment one', approxSeconds: 1, slideRef: null }] } }
        : { text: '{}', json: { tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } } },
      tts: { synthesize: async (_text, outPath) => { await fs.writeFile(outPath, Buffer.from([7])); return { engine: 'openai', outPath }; } },
    });

    const audioPath = path.join(dataDir, 'youtube', 'artifacts', 'v1', 'v1.overview.mp3');
    assert.equal(result.audioPath, audioPath);
    assert.deepEqual([...await fs.readFile(audioPath)], [7]);
    assert.match(await fs.readFile(result.notesPath!, 'utf8'), /Audio overview/);
  });
});

test('processVideo keeps notes when audio overview synthesis fails', async () => {
  await withTempRoots(async () => {
    const result = await processVideo('v1', {
      overview: 'audio',
      force: false,
      fetchVideo: async () => ({
        meta: { title: 'Audio Video' },
        transcriptText: 'hello transcript',
        segments: [{ tSec: 0, durationSec: 5, text: 'hello transcript' }],
        frames: null,
        contentHash: 'hash-audio',
      }),
      llm: { chat: async (options) => options.messages[0].content.toString().includes('condensed narration')
        ? { text: '{}', json: { segments: [{ text: 'Segment one', approxSeconds: 1, slideRef: null }] } }
        : { text: '{}', json: { tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } } },
      tts: { synthesize: async () => { throw new Error('tts failed'); } },
    });

    assert.equal(result.status, 'partial');
    assert.ok(result.notesPath);
    assert.equal(result.audioPath, undefined);
  });
});
