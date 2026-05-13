import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hasCommandOnPath } from '../engine.js';
import type { ScriptSegment } from './script.js';
import type { FrameRef } from './slides.js';

export interface AssembleVideoInput {
  slides: FrameRef[];
  segments: ScriptSegment[];
  audioSegmentPaths: string[];
  srtPath: string;
  outPath: string;
}

export interface AssembleVideoOptions {
  kenBurns?: boolean;
  hasCommand?: (command: string) => boolean;
  runCommand?: (command: string, args: string[]) => Promise<void>;
}

export class FfmpegUnavailableError extends Error {
  constructor(message = 'ffmpeg is required to assemble video overviews') {
    super(message);
    this.name = 'FfmpegUnavailableError';
  }
}

export class MissingSlideError extends Error {
  constructor(message = 'Cannot assemble a video overview without at least one slide frame') {
    super(message);
    this.name = 'MissingSlideError';
  }
}

export async function assembleVideo(input: AssembleVideoInput, options: AssembleVideoOptions = {}): Promise<{ outPath: string; durationSec: number }> {
  const hasCommand = options.hasCommand ?? ((command: string) => hasCommandOnPath(command));
  if (!hasCommand('ffmpeg')) throw new FfmpegUnavailableError();
  const runCommand = options.runCommand ?? runCommandDefault;
  await mkdir(path.dirname(input.outPath), { recursive: true });
  await writeSrt(input.segments, input.srtPath);

  const segmentPaths: string[] = [];
  for (let i = 0; i < input.segments.length; i += 1) {
    const segment = input.segments[i];
    const slide = pickSlide(input.slides, segment, i);
    const segmentPath = path.join(path.dirname(input.outPath), `segment-${i}.mp4`);
    segmentPaths.push(segmentPath);
    await runCommand('ffmpeg', [
      '-y', '-loop', '1', '-i', slide.imagePath,
      '-i', input.audioSegmentPaths[i],
      '-c:v', 'libx264', '-tune', 'stillimage',
      '-c:a', 'aac', '-pix_fmt', 'yuv420p',
      '-shortest', segmentPath,
    ]);
  }

  const concatList = path.join(path.dirname(input.outPath), 'concat.txt');
  await writeFile(concatList, segmentPaths.map((segmentPath) => `file ${escapeConcatPath(segmentPath)}`).join('\n') + '\n', 'utf8');
  const concatPath = path.join(path.dirname(input.outPath), 'concat.mp4');
  await runCommand('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', concatPath]);
  await runCommand('ffmpeg', ['-y', '-i', concatPath, '-vf', `subtitles=${escapeFilterPath(input.srtPath)}`, input.outPath]);

  return { outPath: input.outPath, durationSec: input.segments.reduce((sum, segment) => sum + segment.approxSeconds, 0) };
}

export async function writeSrt(segments: ScriptSegment[], srtPath: string): Promise<void> {
  await mkdir(path.dirname(srtPath), { recursive: true });
  let cursor = 0;
  const blocks = segments.map((segment, index) => {
    const start = cursor;
    cursor += Math.max(1, segment.approxSeconds);
    return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(cursor)}\n${segment.text}\n`;
  });
  await writeFile(srtPath, blocks.join('\n'), 'utf8');
}

function pickSlide(slides: FrameRef[], segment: ScriptSegment, index: number): FrameRef {
  if (segment.slideRef != null && slides[segment.slideRef]) return slides[segment.slideRef];
  if (slides.length) return slides[index % slides.length];
  throw new MissingSlideError();
}

function escapeConcatPath(filePath: string): string {
  return `'${filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function escapeFilterPath(filePath: string): string {
  return `'${filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/]/g, '\\]')}'`;
}

function formatSrtTime(totalSeconds: number): string {
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function runCommandDefault(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}
