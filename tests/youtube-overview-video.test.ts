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
        chat: async (options) => String(options.messages[0].content).includes('condensed narration')
          ? { text: '{}', json: { segments: [{ text: 'Video segment', approxSeconds: 5, slideRef: 0 }] } }
          : { text: '{}', json: { videoType: 'tutorial', tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } },
        chatVision: async () => ({ text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'slides' } }),
      },
      tts: { synthesize: async (_text, outPath) => { await fs.writeFile(outPath, 'mp3'); return { engine: 'openai', outPath }; } },
      assembleVideo: async ({ outPath }) => { await fs.writeFile(outPath, 'mp4'); return { outPath, durationSec: 5 }; },
      fetchVideo: async (_videoId, options) => {
        assert.equal(options.wantFrames, true);
        return { meta: { title: 'Video' }, transcriptText: 'Transcript', segments: [{ tSec: 0, durationSec: 1, text: 'show the code on screen' }], frames: null, contentHash: 'hash' };
      },
      fetchSlides: async () => [{ tSec: 0, imagePath: framePath, ocrText: 'Code walkthrough showing src/app.ts handler and routing setup' }, { tSec: 1, imagePath: framePath, ocrText: 'Architecture diagram with repository context and tool calls' }, { tSec: 2, imagePath: framePath, ocrText: 'Terminal command running the build and test pipeline' }],
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
        chat: async () => ({ text: '{}', json: { videoType: 'explainer', tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } }),
        chatVision: async () => ({ text: '{}', json: { isSlides: false, confidence: 0.9, reason: 'talking head' } }),
      },
      fetchVideo: async () => ({ meta: { title: 'Video' }, transcriptText: 'Let me show the screen and walk through the diagram.', segments: [{ tSec: 0, durationSec: 1, text: 'Let me show the screen and walk through the diagram.' }], frames: null, contentHash: 'hash' }),
      fetchSlides: async () => [{ tSec: 0, imagePath: framePath, ocrText: 'Architecture diagram with repository context and tool calls' }, { tSec: 1, imagePath: framePath, ocrText: 'Implementation steps configure harness run tests ship' }, { tSec: 2, imagePath: framePath, ocrText: 'Error handling retries and validation checklist' }],
    });

    assert.equal((await loadYoutubeState()).videos.v1.artifacts.videoOverview, 'skipped-not-slides');
  });
});

test('processVideo reuses synthesized segment audio when video assembly fails', async () => {
  await withTempRoots(async (tmp) => {
    const framePath = path.join(tmp, 'frame.png');
    await fs.writeFile(framePath, 'same');
    const result = await processVideo('v1', {
      overview: 'video',
      llm: {
        chat: async (options) => String(options.messages[0].content).includes('condensed narration')
          ? { text: '{}', json: { segments: [{ text: 'A', approxSeconds: 1, slideRef: 0 }, { text: 'B', approxSeconds: 1, slideRef: 0 }] } }
          : { text: '{}', json: { videoType: 'tutorial', tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } },
        chatVision: async () => ({ text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'slides' } }),
      },
      tts: { synthesize: async (text, outPath) => { await fs.writeFile(outPath, text); return { engine: 'openai', outPath }; } },
      assembleVideo: async () => { throw new Error('ffmpeg failed'); },
      fetchVideo: async () => ({ meta: { title: 'Video' }, transcriptText: 'Transcript', segments: [{ tSec: 0, durationSec: 1, text: 'show the code on screen' }], frames: null, contentHash: 'hash' }),
      fetchSlides: async () => [{ tSec: 0, imagePath: framePath, ocrText: 'Code walkthrough showing src/app.ts handler and routing setup' }, { tSec: 1, imagePath: framePath, ocrText: 'Architecture diagram with repository context and tool calls' }, { tSec: 2, imagePath: framePath, ocrText: 'Terminal command running the build and test pipeline' }],
    });

    assert.equal(result.status, 'partial');
    assert.ok(result.audioPath);
    assert.equal(await fs.readFile(result.audioPath!, 'utf8'), 'AB');
    assert.equal((await loadYoutubeState()).videos.v1.artifacts.videoOverview, 'failed-degraded-to-audio');
  });
});

test('processVideo skips slide extraction for interview videos without visual cues', async () => {
  await withTempRoots(async () => {
    let slideFetches = 0;
    await processVideo('v1', {
      overview: 'video',
      llm: {
        chat: async () => ({ text: '{}', json: { videoType: 'interview', tldr: 'Summary', keyPoints: [], chapters: [], actionItems: [], topics: [] } }),
        chatVision: async () => { throw new Error('vision should not be called'); },
      },
      fetchVideo: async (_videoId, options) => {
        assert.equal(options.wantFrames, true);
        return { meta: { title: 'Founder interview' }, transcriptText: 'Welcome back. Tell me about your company.', segments: [{ tSec: 0, durationSec: 1, text: 'Welcome back. Tell me about your company.' }], frames: null, contentHash: 'hash' };
      },
      fetchSlides: async () => {
        slideFetches += 1;
        return [];
      },
    });

    assert.equal(slideFetches, 0);
    assert.equal((await loadYoutubeState()).videos.v1.artifacts.videoOverview, 'skipped-not-candidate');
  });
});
