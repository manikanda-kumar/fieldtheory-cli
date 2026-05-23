import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hasCommandOnPath } from '../engine.js';
import { youtubeArtifactsDir } from '../paths.js';
import { runSummarize, type RunSummarizeOptions, type SummarizeResult, type TranscriptSegment } from './summarize-bridge.js';
import type { FrameRef } from './slides.js';
import { ytDlpAccessArgs, type YtDlpAccessOptions } from './yt-dlp.js';

export type { TranscriptSegment } from './summarize-bridge.js';

export interface VideoMeta {
  title: string;
  channel?: string;
  durationSec?: number;
  publishDate?: string;
}

export interface VideoFetchResult {
  meta: VideoMeta;
  transcriptText: string;
  segments: TranscriptSegment[];
  frames: FrameRef[] | null;
  contentHash: string;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchVideoOptions {
  wantFrames?: boolean;
  ytDlp?: YtDlpAccessOptions;
  /** Directory to pass as `--slides-dir` so slide images land alongside other per-video artifacts. */
  slidesDir?: string;
  hasCommand?: (command: string) => boolean;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  fetchText?: (url: string) => Promise<string>;
  runSummarize?: (videoUrl: string, options: RunSummarizeOptions) => Promise<SummarizeResult>;
  retry?: RetryOptions;
}

export class NoTranscriptError extends Error {
  constructor(videoId: string) {
    super(`No transcript available for YouTube video ${videoId}`);
    this.name = 'NoTranscriptError';
  }
}

export async function fetchVideo(videoId: string, options: FetchVideoOptions = {}): Promise<VideoFetchResult> {
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const hasCommand = options.hasCommand ?? ((command: string) => hasCommandOnPath(command));
  const runCommandImpl = options.runCommand ?? runCommand;
  const fetchTextImpl = options.fetchText ?? fetchText;

  // YouTube rate-limits (HTTP 429) aggressively. Retry transient 429s with
  // exponential backoff so a momentary throttle does not collapse the lead rung
  // straight through to the thin summarize fallback.
  const runCommandWithRetry = (command: string, args: string[]) => retryOnRateLimit(() => runCommandImpl(command, args), options.retry);

  const meta = await fetchMeta(videoId, videoUrl, { hasCommand, runCommand: runCommandWithRetry, fetchText: fetchTextImpl }, options.ytDlp);
  let segments: TranscriptSegment[] = [];
  let frames: FrameRef[] | null = null;

  // Rung 1: cookie/impersonation-armed yt-dlp captions (manual subs first, then auto).
  // This leads the ladder because it carries auth that the bare timedtext endpoint cannot.
  if (hasCommand('yt-dlp')) {
    const vtt = await fetchYtDlpTranscript(videoId, videoUrl, runCommandWithRetry, options.ytDlp).catch(() => '');
    segments = parseVttTranscript(vtt);
  }

  // Rung 2: legacy timedtext endpoint (no auth; cheap but commonly 429s).
  if (!segments.length) {
    segments = parseTimedTextTranscript(await fetchTextImpl(`https://video.google.com/timedtext?lang=en&v=${encodeURIComponent(videoId)}`).catch(() => ''));
  }

  // Rung 3: summarize bridge transcript/slides.
  if (!segments.length || options.wantFrames) {
    try {
      const summarized = await (options.runSummarize ?? ((url, opts) => runSummarize(url, opts)))(videoUrl, { withSlides: options.wantFrames, withOcr: options.wantFrames, outDir: options.slidesDir, ytDlp: options.ytDlp });
      if (!segments.length) segments = summarized.transcript.segments;
      meta.title = stringValue(summarized.meta.title) ?? meta.title;
      meta.channel = stringValue(summarized.meta.channel) ?? meta.channel;
      meta.durationSec = numberValue(summarized.meta.durationSec) ?? meta.durationSec;
      if (!segments.length && summarized.transcript.text.trim()) {
        // A text-only transcript with no timing would otherwise become a single
        // segment, which collapses chapters and forces partial notes. Chunk it
        // into approximate timestamped segments spread across the duration.
        segments = chunkTextIntoSegments(summarized.transcript.text.trim(), meta.durationSec);
      }
      if (options.wantFrames) frames = summarized.slides.map((slide) => ({ tSec: slide.tSec, imagePath: slide.imagePath, ...(slide.ocrText ? { ocrText: slide.ocrText } : {}) }));
    } catch {
      if (!segments.length) throw new NoTranscriptError(videoId);
      if (options.wantFrames) frames = null;
    }
  }

  if (!segments.length) throw new NoTranscriptError(videoId);
  const transcriptText = segments.map((segment) => segment.text).join(' ').trim();
  return {
    meta,
    transcriptText,
    segments,
    frames,
    contentHash: crypto.createHash('sha256').update(`${videoId}\n${meta.title}\n${meta.durationSec ?? ''}\n${transcriptText}`).digest('hex'),
  };
}

export async function fetchSlidesForVideo(videoId: string, options: {
  outDir?: string;
  slidesMax?: number;
  slidesSceneThreshold?: number;
  ytDlp?: YtDlpAccessOptions;
  runSummarize?: FetchVideoOptions['runSummarize'];
} = {}): Promise<FrameRef[]> {
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const summarized = await (options.runSummarize ?? ((url, opts) => runSummarize(url, opts)))(videoUrl, {
    withSlides: true,
    withOcr: true,
    outDir: options.outDir ?? youtubeArtifactsDir(videoId),
    youtubeMode: 'yt-dlp',
    ytDlp: options.ytDlp,
    slidesMax: options.slidesMax,
    slidesSceneThreshold: options.slidesSceneThreshold,
  });
  return summarized.slides.map((slide) => ({ tSec: slide.tSec, imagePath: slide.imagePath, ...(slide.ocrText ? { ocrText: slide.ocrText } : {}) }));
}

/**
 * Split an untimestamped transcript blob into approximate timestamped segments
 * spread evenly across the video duration. Avoids collapsing a full transcript
 * into a single segment, which would force approximate-chapter / partial notes.
 */
export function chunkTextIntoSegments(text: string, durationSec: number | undefined): TranscriptSegment[] {
  const clean = text.trim();
  if (!clean) return [];
  const duration = durationSec && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  // Roughly one chunk per 90s of video, capped, and never more than the
  // number of available units (sentences/words) to keep chunks non-empty.
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const units = sentences.length >= 2 ? sentences : clean.split(/\s+/);
  const targetChunks = Math.max(1, Math.min(12, duration ? Math.round(duration / 90) : 1, units.length));
  if (targetChunks <= 1) return [{ tSec: 0, durationSec: duration, text: clean }];

  const perChunk = Math.ceil(units.length / targetChunks);
  const chunks: string[] = [];
  for (let i = 0; i < units.length; i += perChunk) {
    const chunk = units.slice(i, i + perChunk).join(' ').trim();
    if (chunk) chunks.push(chunk);
  }
  const span = duration ? duration / chunks.length : 0;
  return chunks.map((chunk, index) => ({
    tSec: Math.round(index * span),
    durationSec: Math.round(span),
    text: chunk,
  }));
}

export function parseTimedTextTranscript(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(xml)) !== null) {
    const start = attrNumber(match[1], 'start');
    const duration = attrNumber(match[1], 'dur') ?? 0;
    const text = decodeXml(match[2].replace(/<[^>]+>/g, '')).trim();
    if (start != null && text) segments.push({ tSec: start, durationSec: duration, text });
  }
  return segments;
}

export function parseVttTranscript(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = vtt.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    const text = lines.slice(timingIndex + 1).join(' ').trim();
    if (start != null && end != null && text) segments.push({ tSec: start, durationSec: Math.max(0, end - start), text });
  }
  return segments;
}

async function fetchMeta(videoId: string, videoUrl: string, deps: Required<Pick<FetchVideoOptions, 'hasCommand' | 'runCommand' | 'fetchText'>>, ytDlp?: YtDlpAccessOptions): Promise<VideoMeta> {
  if (deps.hasCommand('yt-dlp')) {
    const raw = await deps.runCommand('yt-dlp', [...ytDlpAccessArgs(ytDlp), '-J', videoUrl]).catch(() => '');
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      return { title: stringValue(json.title) ?? videoId, channel: stringValue(json.channel), durationSec: numberValue(json.duration), publishDate: stringValue(json.upload_date) };
    } catch {
      // Fall through to oEmbed.
    }
  }
  const raw = await deps.fetchText(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`).catch(() => '');
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    return { title: stringValue(json.title) ?? videoId, channel: stringValue(json.author_name) };
  } catch {
    return { title: videoId };
  }
}

function attrNumber(attrs: string, name: string): number | undefined {
  const match = attrs.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) return '';
  return res.text();
}

async function fetchYtDlpTranscript(videoId: string, videoUrl: string, runCommandImpl: (command: string, args: string[]) => Promise<string>, ytDlp?: YtDlpAccessOptions): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ft-youtube-subs-'));
  try {
    const outputTemplate = path.join(tempDir, '%(id)s.%(ext)s');
    const stdout = await runCommandImpl('yt-dlp', [
      ...ytDlpAccessArgs(ytDlp),
      '--write-subs',
      '--write-auto-sub',
      '--sub-langs',
      'en.*,en-orig,en',
      '--sub-format',
      'vtt',
      '--skip-download',
      '--output',
      outputTemplate,
      videoUrl,
    ]).catch(() => '');
    if (parseVttTranscript(stdout).length) return stdout;

    const files = await readdir(tempDir).catch(() => []);
    const subtitleFile = files.find((file) => file.endsWith('.vtt') && (file.startsWith(videoId) || files.length === 1));
    return subtitleFile ? await readFile(path.join(tempDir, subtitleFile), 'utf8') : '';
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|too many requests|rate.?limit/i.test(message);
}

async function retryOnRateLimit<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === attempts - 1) throw error;
      const backoff = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * (baseDelayMs / 2));
      await sleep(backoff);
    }
  }
  throw lastError;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}
