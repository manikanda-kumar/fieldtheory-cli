import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSlides, filterUsableSlideFrames, hasUsableSlideFrames, planSlideCapture } from '../src/youtube/slides.js';

async function withFrames(contents: string[], fn: (frames: Array<{ tSec: number; imagePath: string }>) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-slides-'));
  try {
    const frames = [];
    for (let i = 0; i < contents.length; i += 1) {
      const imagePath = path.join(dir, `${i}.png`);
      await fs.writeFile(imagePath, contents[i]);
      frames.push({ tSec: i * 10, imagePath });
    }
    await fn(frames);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('detectSlides returns slide-heavy for stable frames and positive vision result', async () => {
  await withFrames(['slide aaa', 'slide aab', 'slide aac'], async (frames) => {
    const result = await detectSlides(frames, {
      chatVision: async () => ({ text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'deck' } }),
    });

    assert.equal(result.isSlideHeavy, true);
    assert.equal(result.sceneCount, 3);
    assert.equal(result.slides.length, 3);
  });
});

test('detectSlides returns false when vision says the frames are not slides', async () => {
  await withFrames(['slide aaa', 'slide aab', 'slide aac'], async (frames) => {
    const result = await detectSlides(frames, {
      chatVision: async () => ({ text: '{}', json: { isSlides: false, confidence: 0.95, reason: 'talking head' } }),
    });

    assert.equal(result.isSlideHeavy, false);
  });
});

test('detectSlides returns false for too few scenes even with positive vision', async () => {
  await withFrames(['slide aaa', 'slide aab'], async (frames) => {
    const result = await detectSlides(frames, {
      chatVision: async () => ({ text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'deck' } }),
    }, { minScenes: 3 });

    assert.equal(result.isSlideHeavy, false);
  });
});

test('planSlideCapture skips interviews without visual transcript cues', () => {
  const plan = planSlideCapture({
    meta: { title: 'Founder interview' },
    videoType: 'interview',
    segments: [{ tSec: 0, durationSec: 5, text: 'Welcome back. Tell me about your company.' }],
  });

  assert.equal(plan.shouldAttempt, false);
  assert.equal(plan.reason, 'interview-without-visual-cues');
});

test('planSlideCapture attempts tutorials and chooses a larger slide budget', () => {
  const plan = planSlideCapture({
    meta: { title: 'Full tutorial' },
    videoType: 'tutorial',
    segments: [{ tSec: 0, durationSec: 5, text: 'Open the terminal and let me show the code on screen.' }],
  });

  assert.equal(plan.shouldAttempt, true);
  assert.equal(plan.slidesMax, 18);
});

test('detectSlides accepts strong OCR evidence without calling vision', async () => {
  await withFrames(['a', 'b', 'c'], async (frames) => {
    let visionCalls = 0;
    const result = await detectSlides(frames.map((frame) => ({ ...frame, ocrText: 'Architecture diagram with bullet list and code path src/app.ts' })), {
      chatVision: async () => {
        visionCalls += 1;
        return { text: '{}', json: { isSlides: false, confidence: 0, reason: 'should not be called' } };
      },
    }, { videoType: 'tutorial', transcriptCueScore: 2 });

    assert.equal(result.isSlideHeavy, true);
    assert.equal(result.reason, 'ocr-slide-evidence');
    assert.equal(visionCalls, 0);
  });
});

test('detectSlides rejects weak OCR and weak cues without calling vision', async () => {
  await withFrames(['a', 'b', 'c'], async (frames) => {
    let visionCalls = 0;
    const result = await detectSlides(frames, {
      chatVision: async () => {
        visionCalls += 1;
        return { text: '{}', json: { isSlides: true, confidence: 1, reason: 'should not be called' } };
      },
    }, { videoType: 'explainer', transcriptCueScore: 0 });

    assert.equal(result.isSlideHeavy, false);
    assert.equal(result.reason, 'weak-ocr-and-transcript-evidence');
    assert.equal(visionCalls, 0);
  });
});

test('detectSlides calls vision for ambiguous OCR evidence', async () => {
  await withFrames(['a', 'b', 'c'], async (frames) => {
    let visionCalls = 0;
    const result = await detectSlides(frames.map((frame, index) => ({ ...frame, ocrText: index === 1 ? 'Short label' : '' })), {
      chatVision: async () => {
        visionCalls += 1;
        return { text: '{}', json: { isSlides: true, confidence: 0.9, reason: 'vision deck' } };
      },
    }, { videoType: 'other', transcriptCueScore: 1 });

    assert.equal(result.isSlideHeavy, true);
    assert.equal(result.reason, 'vision deck');
    assert.equal(visionCalls, 1);
  });
});

test('hasUsableSlideFrames rejects waveform captures with weak OCR', () => {
  const frames = [
    { tSec: 3, imagePath: '/tmp/waveform-1.png', ocrText: 'ec a' },
    { tSec: 307, imagePath: '/tmp/waveform-2.png', ocrText: 'oo soe ne —-———-= np dore——-——— tip vee ————' },
    { tSec: 622, imagePath: '/tmp/waveform-3.png', ocrText: '' },
  ];

  assert.equal(hasUsableSlideFrames(frames, { videoType: 'explainer', transcriptCueScore: 1 }), false);
});

test('hasUsableSlideFrames accepts tutorial frames with readable OCR', () => {
  const frames = [
    { tSec: 10, imagePath: '/tmp/slide-1.png', ocrText: 'Architecture diagram with repository context and tool calls' },
    { tSec: 120, imagePath: '/tmp/slide-2.png', ocrText: 'Implementation steps configure harness run tests ship' },
    { tSec: 240, imagePath: '/tmp/slide-3.png', ocrText: 'Error handling retries and validation checklist' },
  ];

  assert.equal(hasUsableSlideFrames(frames, { videoType: 'tutorial', transcriptCueScore: 2 }), true);
});

test('filterUsableSlideFrames drops talking-head and garbled captures while keeping readable screens', () => {
  const frames = [
    { tSec: 1, imagePath: '/tmp/talking-head.png', ocrText: 'j [a - be ae = a \\ & tS a i Pm 2 one he' },
    { tSec: 105, imagePath: '/tmp/module-slide.png', ocrText: 'Module Anything with an interface and an implementation. Interface Everything a caller must know to use the module correctly.' },
    { tSec: 340, imagePath: '/tmp/terminal.png', ocrText: 'EXPLORER COURSE-VIDEO-MANAGER PROBLEMS OUTPUT DEBUG CONSOLE TERMINAL TEST RESULTS PORTS' },
    { tSec: 565, imagePath: '/tmp/blank.png', ocrText: 'Th ~~ AN' },
  ];

  assert.deepEqual(filterUsableSlideFrames(frames).map((frame) => frame.imagePath), [
    '/tmp/module-slide.png',
    '/tmp/terminal.png',
  ]);
});
