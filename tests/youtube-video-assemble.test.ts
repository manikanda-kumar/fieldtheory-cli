import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleVideo, FfmpegUnavailableError, writeSrt } from '../src/youtube/video-assemble.js';

test('writeSrt builds cumulative subtitle timings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-srt-'));
  try {
    const srtPath = path.join(dir, 'out.srt');
    await writeSrt([{ text: 'One', approxSeconds: 2, slideRef: 0 }, { text: 'Two', approxSeconds: 3, slideRef: 0 }], srtPath);
    const srt = await fs.readFile(srtPath, 'utf8');
    assert.match(srt, /00:00:00,000 --> 00:00:02,000/);
    assert.match(srt, /00:00:02,000 --> 00:00:05,000/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('assembleVideo builds ffmpeg segment, concat, and subtitle commands', async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-assemble-'));
  try {
    const outPath = path.join(dir, 'final.mp4');
    const result = await assembleVideo({
      slides: [{ tSec: 0, imagePath: '/slides/0.png' }],
      segments: [{ text: 'One', approxSeconds: 2, slideRef: 0 }],
      audioSegmentPaths: ['/audio/0.mp3'],
      srtPath: path.join(dir, 'out.srt'),
      outPath,
    }, {
      hasCommand: () => true,
      runCommand: async (command, args) => { commands.push({ command, args }); },
    });

    assert.equal(result.outPath, outPath);
    assert.equal(result.durationSec, 2);
    assert.equal(commands.length, 3);
    assert.deepEqual(commands[0].args.slice(0, 6), ['-y', '-loop', '1', '-i', '/slides/0.png', '-i']);
    assert.ok(commands[1].args.includes('-f'));
    assert.ok(commands[2].args.includes(outPath));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('assembleVideo throws typed error when ffmpeg is unavailable', async () => {
  await assert.rejects(
    assembleVideo({ slides: [], segments: [], audioSegmentPaths: [], srtPath: '/tmp/out.srt', outPath: '/tmp/out.mp4' }, { hasCommand: () => false }),
    FfmpegUnavailableError,
  );
});
