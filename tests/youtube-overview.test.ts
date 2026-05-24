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
        meta: { title: 'Video Title', channel: 'Channel', durationSec: 5, publishDate: '20260512' },
        transcriptText: 'hello transcript',
        segments: [{ tSec: 0, durationSec: 5, text: 'hello transcript' }],
        frames: null,
        contentHash: 'hash-1',
      }),
      llm: { chat: async () => ({ text: '{}', json: { tldr: 'Useful summary', keyPoints: [], chapters: [], actionItems: [], topics: ['testing'] } }) },
    });

    assert.equal(result.status, 'done');
    assert.equal(result.processed, true);
    assert.equal(result.notesPath, path.join(libraryDir, 'youtube', '2026-05', 'v1.md'));
    assert.match(await fs.readFile(result.notesPath!, 'utf8'), /Useful summary/);
    const indexHtml = await fs.readFile(path.join(libraryDir, 'youtube', 'index.html'), 'utf8');
    assert.match(indexHtml, /Video Title/);
    assert.match(indexHtml, /2026-05\/v1\.md/);
    assert.match(indexHtml, /<aside class="sidebar">/);
    assert.match(indexHtml, /img src="https:\/\/i\.ytimg\.com\/vi\/v1\/hqdefault\.jpg"/);
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

test('processVideo keeps chapter summaries separate from captured slides', async () => {
  await withTempRoots(async () => {
    const result = await processVideo('v1', {
      overview: 'slides',
      force: true,
      fetchVideo: async () => ({
        meta: { title: 'Architecture demo talk', durationSec: 1200 },
        transcriptText: 'short fallback description',
        segments: [{ tSec: 0, durationSec: 1200, text: 'short fallback description with architecture diagram on screen' }],
        frames: null,
        contentHash: 'hash-slides',
      }),
      fetchSlides: async () => [
        { tSec: 10, imagePath: '/tmp/slide-1.png', ocrText: 'Architecture diagram with clear module boundary labels' },
        { tSec: 300, imagePath: '/tmp/slide-2.png', ocrText: 'Tool access terminal commands validation and tests' },
        { tSec: 600, imagePath: '/tmp/slide-3.png', ocrText: 'Context memory compaction subagent delegation summary' },
      ],
      llm: { chat: async () => ({ text: '{}', json: {
        tldr: 'Summary',
        keyPoints: ['Module boundaries matter', 'Tool access needs validation', 'Memory supports long sessions'],
        chapters: [{ tSec: 0, label: 'Generic', summary: 'One generic summary' }],
        actionItems: [],
        topics: [],
      } }) },
    });

    const md = await fs.readFile(result.notesPath!, 'utf8');
    assert.match(md, /\[00:00\]\(https:\/\/youtu\.be\/v1\?t=0\) \*\*Part 1\*\* — Module boundaries matter/);
    // Slides are embedded inline within the chapter timeline, not a detached list.
    assert.doesNotMatch(md, /## Slides/);
    assert.match(md, /  \[!\[Slide at 00:10\]\(\/tmp\/slide-1\.png\)\]\(https:\/\/youtu\.be\/v1\?t=10\)/);
    // Slide at 05:00 (300s) falls under Part 1 [0,400); slide at 10:00 (600s) under Part 2 [400,800).
    assert.match(md, /\*\*Part 2\*\* — Tool access needs validation\n  \[!\[Slide at 10:00\]\(\/tmp\/slide-3\.png\)\]/);
    assert.doesNotMatch(md, /\*\*Slide 1\*\* — Captured slide frame/);
  });
});

test('processVideo does not write slides section for waveform captures with weak OCR', async () => {
  await withTempRoots(async () => {
    const result = await processVideo('v1', {
      overview: 'slides',
      force: true,
      fetchVideo: async () => ({
        meta: { title: 'Podcast explainer', durationSec: 1200 },
        transcriptText: 'short fallback description with architecture mention',
        segments: [{ tSec: 0, durationSec: 1200, text: 'short fallback description with architecture mention' }],
        frames: null,
        contentHash: 'hash-waveform',
      }),
      fetchSlides: async () => [
        { tSec: 10, imagePath: '/tmp/waveform-1.png', ocrText: 'ec a' },
        { tSec: 300, imagePath: '/tmp/waveform-2.png', ocrText: 'oo soe ne —-———-= np dore——-——— tip vee ————' },
        { tSec: 600, imagePath: '/tmp/waveform-3.png' },
      ],
      llm: { chat: async () => ({ text: '{}', json: { videoType: 'explainer', tldr: 'Summary', keyPoints: [], chapters: [{ tSec: 0, label: 'Generic', summary: 'One generic summary' }], actionItems: [], topics: [] } }) },
    });

    const md = await fs.readFile(result.notesPath!, 'utf8');
    assert.doesNotMatch(md, /## Slides/);
    assert.doesNotMatch(md, /Slide 1|waveform|oo soe ne|ec a/);
  });
});

test('processVideo creates approximate chapter summaries for long videos with only one transcript chapter', async () => {
  await withTempRoots(async () => {
    const result = await processVideo('v1', {
      overview: 'none',
      force: true,
      fetchVideo: async () => ({
        meta: { title: 'Long podcast explainer', durationSec: 1200 },
        transcriptText: 'single fallback transcript summary',
        segments: [{ tSec: 0, durationSec: 1200, text: 'single fallback transcript summary' }],
        frames: null,
        contentHash: 'hash-approx-chapters',
      }),
      llm: { chat: async () => ({ text: '{}', json: {
        videoType: 'explainer',
        tldr: 'Summary',
        keyPoints: ['Harness provides repository context', 'Tool access is controlled', 'Memory and compaction support long sessions'],
        chapters: [{ tSec: 0, label: 'Generic', summary: 'One generic summary' }],
        actionItems: [],
        topics: [],
      } }) },
    });

    const md = await fs.readFile(result.notesPath!, 'utf8');
    assert.match(md, /\[00:00\]\(https:\/\/youtu\.be\/v1\?t=0\) \*\*Part 1\*\* — Harness provides repository context/);
    assert.match(md, /\[06:40\]\(https:\/\/youtu\.be\/v1\?t=400\) \*\*Part 2\*\* — Tool access is controlled/);
    assert.match(md, /\[13:20\]\(https:\/\/youtu\.be\/v1\?t=800\) \*\*Part 3\*\* — Memory and compaction support long sessions/);
  });
});

test('processVideo post-validates thin long notes and marks them partial', async () => {
  await withTempRoots(async () => {
    const result = await processVideo('v1', {
      overview: 'none',
      force: true,
      fetchVideo: async () => ({
        meta: { title: 'Thin long tutorial', durationSec: 900 },
        transcriptText: 'intro only',
        segments: [{ tSec: 0, durationSec: 900, text: 'intro only' }],
        frames: null,
        contentHash: 'hash-thin',
      }),
      llm: { chat: async () => ({ text: '{}', json: {
        videoType: 'tutorial',
        tldr: 'The transcript only contains the introduction.',
        keyPoints: ['Intro only', 'No detailed implementation steps'],
        chapters: [{ tSec: 0, label: 'Intro', summary: 'Only introductory material is available' }],
        actionItems: [],
        topics: [],
      } }) },
    });

    assert.equal(result.status, 'partial');
    const md = await fs.readFile(result.notesPath!, 'utf8');
    assert.match(md, /## Quality warnings/);
    assert.match(md, /Transcript coverage is thin/);
    assert.match(md, /Only one source transcript segment was available/);
  });
});

test('processVideo ships single-segment notes as done when transcript coverage is strong', async () => {
  await withTempRoots(async () => {
    const transcriptText = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} carries enough substance to cover the topic in depth.`).join(' ');
    const result = await processVideo('v1', {
      overview: 'none',
      force: true,
      fetchVideo: async () => ({
        meta: { title: 'Long single-segment talk', durationSec: 1200 },
        transcriptText,
        segments: [{ tSec: 0, durationSec: 1200, text: transcriptText }],
        frames: null,
        contentHash: 'hash-single-strong',
      }),
      llm: { chat: async () => ({ text: '{}', json: {
        videoType: 'talk',
        tldr: 'Summary',
        keyPoints: ['Point one', 'Point two', 'Point three'],
        chapters: [
          { tSec: 0, label: 'Open', summary: 'Opening' },
          { tSec: 400, label: 'Middle', summary: 'Body' },
          { tSec: 800, label: 'Close', summary: 'Wrap up' },
        ],
        actionItems: [],
        topics: [],
      } }) },
    });

    // Strong coverage with only a timing-granularity warning stays done.
    assert.equal(result.status, 'done');
    const md = await fs.readFile(result.notesPath!, 'utf8');
    assert.match(md, /## Quality warnings/);
    assert.match(md, /Only one source transcript segment was available/);
    assert.doesNotMatch(md, /Transcript coverage is thin/);
  });
});
