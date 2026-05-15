import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { hasCommandOnPath } from '../engine.js';
import { runSummarize, type SummarizeResult, type TranscriptSegment } from './summarize-bridge.js';

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
  frames: Array<{ tSec: number; imagePath: string }> | null;
  contentHash: string;
}

export interface FetchVideoOptions {
  wantFrames?: boolean;
  /** Directory to pass as `--slides-dir` so slide images land alongside other per-video artifacts. */
  slidesDir?: string;
  hasCommand?: (command: string) => boolean;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  fetchText?: (url: string) => Promise<string>;
  runSummarize?: (videoUrl: string, options: { withSlides?: boolean; withOcr?: boolean; outDir?: string }) => Promise<SummarizeResult>;
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

  const meta = await fetchMeta(videoId, videoUrl, { hasCommand, runCommand: runCommandImpl, fetchText: fetchTextImpl });
  let segments = parseTimedTextTranscript(await fetchTextImpl(`https://video.google.com/timedtext?lang=en&v=${encodeURIComponent(videoId)}`).catch(() => ''));
  let frames: Array<{ tSec: number; imagePath: string }> | null = null;

  if (!segments.length && hasCommand('yt-dlp')) {
    const subtitleUrl = (await runCommandImpl('yt-dlp', ['--write-auto-sub', '--sub-lang', 'en', '--skip-download', '--print', 'requested_subtitles.en.url', videoUrl]).catch(() => '')).trim();
    const vtt = subtitleUrl.startsWith('http') ? await fetchTextImpl(subtitleUrl).catch(() => '') : subtitleUrl;
    segments = parseVttTranscript(vtt);
  }

  if (!segments.length || options.wantFrames) {
    try {
      const summarized = await (options.runSummarize ?? ((url, opts) => runSummarize(url, opts)))(videoUrl, { withSlides: options.wantFrames, outDir: options.slidesDir });
      if (!segments.length) segments = summarized.transcript.segments;
      meta.title = stringValue(summarized.meta.title) ?? meta.title;
      meta.channel = stringValue(summarized.meta.channel) ?? meta.channel;
      meta.durationSec = numberValue(summarized.meta.durationSec) ?? meta.durationSec;
      if (options.wantFrames) frames = summarized.slides.map((slide) => ({ tSec: slide.tSec, imagePath: slide.imagePath }));
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

async function fetchMeta(videoId: string, videoUrl: string, deps: Required<Pick<FetchVideoOptions, 'hasCommand' | 'runCommand' | 'fetchText'>>): Promise<VideoMeta> {
  if (deps.hasCommand('yt-dlp')) {
    const raw = await deps.runCommand('yt-dlp', ['-J', videoUrl]).catch(() => '');
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
