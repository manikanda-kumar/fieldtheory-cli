import test from 'node:test';
import assert from 'node:assert/strict';
import { runSummarize, SummarizeUnavailableError } from '../src/youtube/summarize-bridge.js';

test('runSummarize parses transcript, slides, OCR, and metadata from a single invocation', async () => {
  let capturedArgs: string[] = [];
  const result = await runSummarize('https://youtu.be/v1', { withSlides: true, withOcr: true, outDir: '/tmp/out' }, {
    hasCommand: () => true,
    runCommand: async (_command, args) => {
      capturedArgs = args;
      return JSON.stringify({
        extracted: {
          title: 'Talk',
          siteName: 'YouTube',
          content: 'Transcript:\nhello world',
          transcriptMetadata: {
            durationSeconds: 9,
            segments: [{ startMs: 1000, endMs: 3000, text: 'hello' }],
          },
        },
        slides: {
          slidesDir: '/tmp/out/youtube-v1',
          slides: [{ index: 1, timestamp: 5, imagePath: 'slide_0001_5.00s.png', ocr: 'Slide OCR' }],
        },
      });
    },
  });

  assert.deepEqual(result, {
    transcript: { text: 'hello world', segments: [{ tSec: 1, durationSec: 2, text: 'hello' }] },
    slides: [{ tSec: 5, imagePath: '/tmp/out/youtube-v1/slide_0001_5.00s.png', ocrText: 'Slide OCR' }],
    meta: { title: 'Talk', siteName: 'YouTube', durationSec: 9 },
  });
  assert.deepEqual(capturedArgs, [
    'https://youtu.be/v1',
    '--extract',
    '--youtube', 'auto',
    '--format', 'md',
    '--markdown-mode', 'llm',
    '--timestamps',
    '--json',
    '--slides',
    '--slides-max', '16',
    '--slides-ocr',
    '--slides-dir', '/tmp/out',
    '--timeout', '15m',
  ]);
});

test('runSummarize uses a shorter timeout and skips slide flags when slides are not requested', async () => {
  let capturedArgs: string[] = [];
  await runSummarize('https://youtu.be/v1', {}, {
    hasCommand: () => true,
    runCommand: async (_command, args) => {
      capturedArgs = args;
      return JSON.stringify({ extracted: { title: 'x', content: '' } });
    },
  });
  assert.ok(!capturedArgs.includes('--slides'));
  assert.equal(capturedArgs[capturedArgs.indexOf('--timeout') + 1], '5m');
});

test('runSummarize respects slidesMax and timeout overrides', async () => {
  let capturedArgs: string[] = [];
  await runSummarize('https://youtu.be/v1', { withSlides: true, slidesMax: 24, timeout: '20m' }, {
    hasCommand: () => true,
    runCommand: async (_command, args) => {
      capturedArgs = args;
      return JSON.stringify({ extracted: { title: 'x', content: '' }, slides: { slides: [] } });
    },
  });
  assert.equal(capturedArgs[capturedArgs.indexOf('--slides-max') + 1], '24');
  assert.equal(capturedArgs[capturedArgs.indexOf('--timeout') + 1], '20m');
});

test('runSummarize prefers slides.json on disk over stdout slide paths', async () => {
  const result = await runSummarize('https://youtu.be/v1', { withSlides: true, outDir: '/tmp/out' }, {
    hasCommand: () => true,
    runCommand: async () => JSON.stringify({
      extracted: { title: 'Talk', content: '' },
      slides: {
        slidesDir: '/tmp/out/youtube-v1',
        slides: [
          { index: 1, timestamp: 1.5, imagePath: 'slide_0001_1.50s.png' },
          // Pre-adjust path that doesn't match what's actually on disk.
          { index: 2, timestamp: 224.23, imagePath: 'slide_0002_224.23s.png' },
        ],
      },
    }),
    readFile: async (filePath: string) => {
      assert.equal(filePath, '/tmp/out/youtube-v1/slides.json');
      return JSON.stringify({
        slidesDir: '/tmp/out/youtube-v1',
        slides: [
          { index: 1, timestamp: 1.5, imagePath: 'slide_0001_1.50s.png' },
          { index: 2, timestamp: 216.25, imagePath: 'slide_0002_216.25s.png' },
        ],
      });
    },
  });

  // The on-disk manifest wins, so slide 2 gets the post-adjust filename/timestamp.
  assert.deepEqual(result.slides, [
    { tSec: 1.5, imagePath: '/tmp/out/youtube-v1/slide_0001_1.50s.png' },
    { tSec: 216.25, imagePath: '/tmp/out/youtube-v1/slide_0002_216.25s.png' },
  ]);
});

test('runSummarize falls back to stdout slides when slides.json is unreadable', async () => {
  const result = await runSummarize('https://youtu.be/v1', { withSlides: true, outDir: '/tmp/out' }, {
    hasCommand: () => true,
    runCommand: async () => JSON.stringify({
      extracted: { title: 'Talk', content: '' },
      slides: {
        slidesDir: '/tmp/out/youtube-v1',
        slides: [{ index: 1, timestamp: 1.5, imagePath: 'slide_0001_1.50s.png' }],
      },
    }),
    readFile: async () => { throw new Error('ENOENT'); },
  });
  assert.deepEqual(result.slides, [
    { tSec: 1.5, imagePath: '/tmp/out/youtube-v1/slide_0001_1.50s.png' },
  ]);
});

test('runSummarize throws typed unavailable error when summarize is absent', async () => {
  await assert.rejects(
    runSummarize('https://youtu.be/v1', {}, { hasCommand: () => false }),
    SummarizeUnavailableError,
  );
});
