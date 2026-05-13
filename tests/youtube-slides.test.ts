import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSlides } from '../src/youtube/slides.js';

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
