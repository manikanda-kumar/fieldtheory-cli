import test from 'node:test';
import assert from 'node:assert/strict';
import { runSummarize, SummarizeUnavailableError } from '../src/youtube/summarize-bridge.js';

test('runSummarize parses transcript, slides, OCR, and metadata from JSON output', async () => {
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
  assert.deepEqual(capturedArgs, ['https://youtu.be/v1', '--extract', '--json', '--timestamps', '--no-color', '--slides', '--slides-debug', '--slides-ocr', '--slides-dir', '/tmp/out']);
});

test('runSummarize throws typed unavailable error when summarize is absent', async () => {
  await assert.rejects(
    runSummarize('https://youtu.be/v1', {}, { hasCommand: () => false }),
    SummarizeUnavailableError,
  );
});
