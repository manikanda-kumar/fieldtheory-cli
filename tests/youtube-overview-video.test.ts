import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processVideo } from '../src/youtube/overview.js';
import { loadYoutubeState } from '../src/youtube/state.js';

async function withTempRoots<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-youtube-video-'));
  const previous = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR };
  process.env.FT_DATA_DIR = path.join(tmp, 'data');
  process.env.FT_LIBRARY_DIR = path.join(tmp, 'library');
  try { return await fn(tmp); }
  finally {
    if (previous.FT_DATA_DIR === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous.FT_DATA_DIR;
    if (previous.FT_LIBRARY_DIR === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = previous.FT_LIBRARY_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('processVideo video branch writes mp4 artifact for slide-heavy videos', async () => {
  await withTempRoots(async (tmp) => {
    const framePath = path.join(tmp, 'frame.png');
    await fs.writeFile(framePath, 'same');
    const result = await processVideo('v1', {
      overview: 'video',
      llm: {
        chat: async () => ({ text: '{}', json: { tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [], segments: [{ text: 'Video segment', approxSeconds: 5, slideRef: 0 }] } }),
        chatVision: async () => ({ text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'slides' } }),
      },
      tts: { synthesize: async (_text, outPath) => { await fs.writeFile(outPath, 'mp3'); return { engine: 'openai', outPath }; } },
      assembleVideo: async ({ outPath }) => { await fs.writeFile(outPath, 'mp4'); return { outPath, durationSec: 5 }; },
      fetchVideo: async () => ({ meta: { title: 'Video' }, transcriptText: 'Transcript', segments: [{ tSec: 0, durationSec: 1, text: 'Transcript' }], frames: [{ tSec: 0, imagePath: framePath }, { tSec: 1, imagePath: framePath }, { tSec: 2, imagePath: framePath }], contentHash: 'hash' }),
    });

    assert.ok(result.videoPath);
    assert.deepEqual(await fs.readFile(result.videoPath!, 'utf8'), 'mp4');
    assert.equal((await loadYoutubeState()).videos.v1.artifacts.videoPath, result.videoPath);
  });
});

test('processVideo video branch records skipped state for non-slide-heavy videos', async () => {
  await withTempRoots(async (tmp) => {
    const framePath = path.join(tmp, 'frame.png');
    await fs.writeFile(framePath, 'same');
    await processVideo('v1', {
      overview: 'video',
      llm: {
        chat: async () => ({ text: '{}', json: { tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } }),
        chatVision: async () => ({ text: '{}', json: { isSlides: false, confidence: 0.9, reason: 'talking head' } }),
      },
      fetchVideo: async () => ({ meta: { title: 'Video' }, transcriptText: 'Transcript', segments: [{ tSec: 0, durationSec: 1, text: 'Transcript' }], frames: [{ tSec: 0, imagePath: framePath }, { tSec: 1, imagePath: framePath }, { tSec: 2, imagePath: framePath }], contentHash: 'hash' }),
    });

    assert.equal((await loadYoutubeState()).videos.v1.artifacts.videoOverview, 'skipped-not-slides');
  });
});
