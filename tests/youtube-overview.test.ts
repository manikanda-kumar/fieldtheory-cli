import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processVideo } from '../src/youtube/overview.js';
import { NoTranscriptError } from '../src/youtube/fetch.js';

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
    const richSummary = Array.from({ length: 45 }, (_, i) => `Detailed evidence sentence ${i + 1} explains a concrete claim from the talk with enough specificity to avoid boilerplate.`).join(' ');
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
        tldr: richSummary,
        keyPoints: [richSummary, richSummary, richSummary],
        chapters: [
          { tSec: 0, label: 'Open', summary: richSummary },
          { tSec: 400, label: 'Middle', summary: richSummary },
          { tSec: 800, label: 'Close', summary: richSummary },
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

function watchedNotes(overrides: Partial<{ tldr: string }> = {}) {
  return {
    notes: {
      videoType: 'talk' as const,
      tldr: overrides.tldr ?? 'Gemini watched the video',
      keyPoints: ['Slide showed a 3x speedup table.'],
      chapters: [{ tSec: 0, label: 'Intro', summary: 'Opens with the problem.' }],
      actionItems: [],
      topics: ['gemini'],
    },
    model: 'Gemini 3.7 Flash (High)',
    usage: { totalTokens: 4200 },
  };
}

test('processVideo auto-skips interview video notes and uses the transcript', async () => {
  await withTempRoots(async ({ dataDir }) => {
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    let geminiCalls = 0;
    try {
      const result = await processVideo('g-skip', {
        overview: 'none',
        fetchVideo: async () => ({
          meta: { title: 'Founder interview', channel: 'No Priors', durationSec: 180, publishDate: '20260901' },
          transcriptText: 'welcome back tell me about the company',
          segments: [{ tSec: 0, durationSec: 180, text: 'welcome back tell me about the company' }],
          frames: null,
          contentHash: 'hash-skip',
        }),
        llm: { chat: async () => ({ text: '{}', json: { tldr: 'transcript notes', keyPoints: [], chapters: [], actionItems: [], topics: [] } }) },
        videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { geminiCalls += 1; return watchedNotes(); } },
        videoNotesMode: 'auto',
      });
      assert.equal(result.status, 'done');
      assert.equal(geminiCalls, 0);
      assert.match(await fs.readFile(result.notesPath!, 'utf8'), /transcript notes/);
      assert.ok(logs.some((line) => /Video notes: skip \(interview; transcript is enough\)/.test(line)));
      const state = JSON.parse(await fs.readFile(path.join(dataDir, 'youtube', 'state.json'), 'utf8'));
      assert.equal(state.videos['g-skip'].artifacts.notesSource, 'transcript');
    } finally {
      console.log = originalLog;
    }
  });
});

test('processVideo auto-watches tutorials and captionless interviews; on watches talking-heads', async () => {
  await withTempRoots(async () => {
    let tutorialCalls = 0;
    let captionlessCalls = 0;
    let interviewOnCalls = 0;
    const llm = { chat: async () => ({ text: '{}', json: { tldr: 'transcript notes', keyPoints: [], chapters: [], actionItems: [], topics: [] } }) };

    const tutorial = await processVideo('g-tut', {
      overview: 'none',
      fetchVideo: async () => ({
        meta: { title: 'Full Tutorial: Build with Codex', durationSec: 180, publishDate: '20260901' },
        transcriptText: 'step one',
        segments: [{ tSec: 0, durationSec: 180, text: 'step one' }],
        frames: null,
        contentHash: 'hash-tut',
      }),
      llm,
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { tutorialCalls += 1; return watchedNotes(); } },
      videoNotesMode: 'auto',
    });
    assert.equal(tutorial.status, 'done');
    assert.equal(tutorialCalls, 1);
    assert.match(await fs.readFile(tutorial.notesPath!, 'utf8'), /Gemini watched the video/);

    const captionless = await processVideo('g-cap', {
      overview: 'none',
      fetchVideo: async () => { throw new NoTranscriptError('g-cap', { title: 'Founder interview', channel: 'No Priors', durationSec: 300, publishDate: '20260815' }); },
      llm,
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { captionlessCalls += 1; return watchedNotes(); } },
      videoNotesMode: 'auto',
    });
    assert.equal(captionless.status, 'done');
    assert.equal(captionlessCalls, 1);

    const forced = await processVideo('g-on', {
      overview: 'none',
      fetchVideo: async () => ({
        meta: { title: 'Founder interview', channel: 'No Priors', durationSec: 180, publishDate: '20260901' },
        transcriptText: 'welcome back',
        segments: [{ tSec: 0, durationSec: 180, text: 'welcome back' }],
        frames: null,
        contentHash: 'hash-on',
      }),
      llm,
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { interviewOnCalls += 1; return watchedNotes(); } },
      videoNotesMode: 'on',
    });
    assert.equal(forced.status, 'done');
    assert.equal(interviewOnCalls, 1);
  });
});

test('processVideo prefers video notes (agy) over the transcript LLM and records the source', async () => {
  await withTempRoots(async ({ dataDir }) => {
    let transcriptLlmCalls = 0;
    let geminiCalls = 0;
    const result = await processVideo('g1', {
      overview: 'none',
      force: false,
      fetchVideo: async () => ({
        meta: { title: 'Gemini talk', durationSec: 1800, publishDate: '20260901' },
        transcriptText: 'short',
        segments: [{ tSec: 0, durationSec: 1800, text: 'short' }],
        frames: null,
        contentHash: 'hash-g1',
      }),
      llm: { chat: async () => { transcriptLlmCalls += 1; return { text: '{}', json: { tldr: 'transcript notes', keyPoints: [], chapters: [], actionItems: [], topics: [] } }; } },
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { geminiCalls += 1; return watchedNotes(); } },
    });

    assert.equal(geminiCalls, 1);
    assert.equal(transcriptLlmCalls, 0);
    const markdown = await fs.readFile(result.notesPath!, 'utf8');
    assert.match(markdown, /^notesSource: "?agy-video"?$/m);
    assert.match(markdown, /Gemini watched the video/);
    // Thin-transcript warnings do not apply when the model read the video itself.
    assert.doesNotMatch(markdown, /Transcript coverage is thin/);
    assert.doesNotMatch(markdown, /Only one source transcript segment/);
    const state = JSON.parse(await fs.readFile(path.join(dataDir, 'youtube', 'state.json'), 'utf8'));
    assert.equal(state.videos.g1.artifacts.notesSource, 'agy-video');
    assert.equal(state.videos.g1.artifacts.notesModel, 'Gemini 3.7 Flash (High)');
    assert.equal(state.videos.g1.artifacts.notesTokens, '4200');
  });
});

test('processVideo falls back to transcript notes when video notes fail', async () => {
  await withTempRoots(async ({ dataDir }) => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      const result = await processVideo('g2', {
        overview: 'none',
        force: false,
        fetchVideo: async () => ({
          meta: { title: 'Fallback talk', durationSec: 60 },
          transcriptText: 'hello transcript',
          segments: [{ tSec: 0, durationSec: 60, text: 'hello transcript' }],
          frames: null,
          contentHash: 'hash-g2',
        }),
        llm: { chat: async () => ({ text: '{}', json: { tldr: 'transcript notes', keyPoints: [], chapters: [], actionItems: [], topics: [] } }) },
        videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { throw new Error('quota exceeded'); } },
      });
      assert.equal(result.status, 'done');
      assert.match(await fs.readFile(result.notesPath!, 'utf8'), /transcript notes/);
      assert.ok(warnings.some((line) => /falling back to transcript notes: quota exceeded/.test(line)));
      const state = JSON.parse(await fs.readFile(path.join(dataDir, 'youtube', 'state.json'), 'utf8'));
      assert.equal(state.videos.g2.artifacts.notesSource, 'transcript');
      assert.equal(state.videos.g2.artifacts.notesModel, undefined);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test('processVideo rescues a video with no transcript when video notes are available', async () => {
  await withTempRoots(async ({ dataDir, libraryDir }) => {
    // Under 10 minutes so the length-based "notes too thin" check does not downgrade the fixture.
    const meta = { title: 'No captions here', durationSec: 300, publishDate: '20260815' };
    const fetchVideo = async () => { throw new NoTranscriptError('g3', meta); };
    let transcriptLlmCalls = 0;
    const llm = { chat: async () => { transcriptLlmCalls += 1; return { text: '{}', json: {} }; } };

    const withoutGemini = await processVideo('g3', { overview: 'none', fetchVideo, llm });
    assert.equal(withoutGemini.status, 'skipped-no-transcript');

    const withGemini = await processVideo('g3', {
      overview: 'none',
      fetchVideo,
      llm,
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async (videoId, gotMeta) => { assert.equal(videoId, 'g3'); assert.equal(gotMeta.title, 'No captions here'); return watchedNotes(); } },
    });
    assert.equal(withGemini.status, 'done');
    assert.equal(transcriptLlmCalls, 0);
    assert.equal(withGemini.notesPath, path.join(libraryDir, 'youtube', '2026-08', 'g3.md'));
    const state = JSON.parse(await fs.readFile(path.join(dataDir, 'youtube', 'state.json'), 'utf8'));
    assert.equal(state.videos.g3.status, 'done');
    assert.equal(state.videos.g3.artifacts.notesSource, 'agy-video');

    // Same video, same metadata: change detection still works without a transcript.
    const again = await processVideo('g3', { overview: 'none', fetchVideo, llm, videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => watchedNotes() } });
    assert.equal(again.status, 'skipped-unchanged');

    // No transcript and the video client fails: nothing to summarize.
    const failed = await processVideo('g4', {
      overview: 'none',
      fetchVideo: async () => { throw new NoTranscriptError('g4', meta); },
      llm,
      videoNotes: { model: 'Gemini 3.7 Flash (High)', label: 'agy', generateNotes: async () => { throw new Error('private video'); } },
    });
    assert.equal(failed.status, 'skipped-no-transcript');
    const state2 = JSON.parse(await fs.readFile(path.join(dataDir, 'youtube', 'state.json'), 'utf8'));
    assert.match(state2.videos.g4.error, /video notes failed: private video/);
  });
});
