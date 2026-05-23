import { spawn } from 'node:child_process';
import path from 'node:path';
import { hasCommandOnPath } from '../engine.js';
import type { YtDlpAccessOptions } from './yt-dlp.js';

export interface TranscriptSegment {
  tSec: number;
  durationSec: number;
  text: string;
}

export interface SummarizeSlide {
  tSec: number;
  imagePath: string;
  ocrText?: string;
}

export interface SummarizeResult {
  transcript: { text: string; segments: TranscriptSegment[] };
  slides: SummarizeSlide[];
  meta: Record<string, unknown>;
}

export interface RunSummarizeOptions {
  withSlides?: boolean;
  withOcr?: boolean;
  outDir?: string;
  youtubeMode?: 'yt-dlp';
  slidesMax?: number;
  slidesSceneThreshold?: number;
  debugSlides?: boolean;
  ytDlp?: Pick<YtDlpAccessOptions, 'cookiesFromBrowser'>;
}

export interface SummarizeDeps {
  hasCommand?: (command: string) => boolean;
  runCommand?: (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>;
}

export class SummarizeUnavailableError extends Error {
  constructor(message = 'summarize CLI is not available on PATH') {
    super(message);
    this.name = 'SummarizeUnavailableError';
  }
}

export function hasSummarize(deps: Pick<SummarizeDeps, 'hasCommand'> = {}): boolean {
  return (deps.hasCommand ?? ((command: string) => hasCommandOnPath(command)))('summarize');
}

export async function runSummarize(videoUrl: string, options: RunSummarizeOptions = {}, deps: SummarizeDeps = {}): Promise<SummarizeResult> {
  if (!hasSummarize(deps)) throw new SummarizeUnavailableError();

  const args = [videoUrl, '--extract', '--json', '--timestamps', '--no-color'];
  if (options.youtubeMode) args.push('--youtube', options.youtubeMode);
  if (options.withSlides) args.push('--slides');
  if (options.debugSlides) args.push('--slides-debug');
  if (options.withOcr) args.push('--slides-ocr');
  if (options.outDir) args.push('--slides-dir', options.outDir);
  if (options.slidesMax != null) args.push('--slides-max', String(options.slidesMax));
  if (options.slidesSceneThreshold != null) args.push('--slides-scene-threshold', String(options.slidesSceneThreshold));
  const env = summarizeEnv(options.ytDlp);
  const output = await (deps.runCommand ?? runCommand)('summarize', args, env);
  return parseSummarizeJson(output);
}

function summarizeEnv(ytDlp: RunSummarizeOptions['ytDlp']): NodeJS.ProcessEnv | undefined {
  if (!ytDlp?.cookiesFromBrowser) return undefined;
  return { SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER: ytDlp.cookiesFromBrowser };
}

function parseSummarizeJson(output: string): SummarizeResult {
  const parsed = JSON.parse(output) as Record<string, unknown>;
  const extracted = parsed.extracted != null && typeof parsed.extracted === 'object' && !Array.isArray(parsed.extracted)
    ? parsed.extracted as Record<string, unknown>
    : undefined;
  const transcriptMetadata = extracted?.transcriptMetadata != null && typeof extracted.transcriptMetadata === 'object' && !Array.isArray(extracted.transcriptMetadata)
    ? extracted.transcriptMetadata as Record<string, unknown>
    : undefined;
  const transcript = parsed.transcript as Record<string, unknown> | undefined;
  const rawSegments = Array.isArray(transcript?.segments) ? transcript.segments : Array.isArray(transcriptMetadata?.segments) ? transcriptMetadata.segments : [];
  const segments = rawSegments.length
    ? rawSegments.map(normalizeSegment).filter((segment): segment is TranscriptSegment => segment != null)
    : [];
  const slideContainer = parsed.slides != null && typeof parsed.slides === 'object' && !Array.isArray(parsed.slides)
    ? parsed.slides as Record<string, unknown>
    : undefined;
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : Array.isArray(slideContainer?.slides) ? slideContainer.slides : [];
  const slidesDir = typeof slideContainer?.slidesDir === 'string' ? slideContainer.slidesDir : undefined;
  const transcriptText = typeof transcript?.text === 'string'
    ? transcript.text
    : typeof extracted?.content === 'string'
      ? extracted.content.replace(/^Transcript:\s*/i, '').trim()
      : segments.map((segment) => segment.text).join(' ');
  return {
    transcript: {
      text: transcriptText,
      segments,
    },
    slides: rawSlides.map((slide) => normalizeSlide(slide, slidesDir)).filter((slide): slide is SummarizeSlide => slide != null),
    meta: normalizeMeta(parsed, extracted, transcriptMetadata),
  };
}

function normalizeSegment(value: unknown): TranscriptSegment | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const start = numberValue(record.tSec) ?? numberValue(record.start) ?? msToSeconds(record.startMs);
  const end = numberValue(record.end) ?? msToSeconds(record.endMs);
  const duration = numberValue(record.durationSec) ?? numberValue(record.dur) ?? msToSeconds(record.durationMs) ?? (start != null && end != null ? end - start : undefined);
  const text = typeof record.text === 'string' ? record.text : '';
  if (start == null || duration == null || !text) return null;
  return { tSec: start, durationSec: duration, text };
}

function normalizeSlide(value: unknown, slidesDir?: string): SummarizeSlide | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tSec = numberValue(record.tSec) ?? numberValue(record.timestampSec) ?? numberValue(record.timestamp);
  const rawImagePath = typeof record.imagePath === 'string' ? record.imagePath : undefined;
  const imagePath = normalizeSlidePath(rawImagePath, slidesDir, record, tSec);
  if (tSec == null || !imagePath) return null;
  const ocrText = typeof record.ocrText === 'string' ? record.ocrText : typeof record.ocr === 'string' ? record.ocr : undefined;
  return { tSec, imagePath, ...(ocrText ? { ocrText } : {}) };
}

function normalizeSlidePath(imagePath: string | undefined, slidesDir: string | undefined, record: Record<string, unknown>, tSec: number | undefined): string | undefined {
  if (imagePath) return slidesDir && !path.isAbsolute(imagePath) ? path.join(slidesDir, imagePath) : imagePath;
  const index = numberValue(record.index);
  if (!slidesDir || index == null || tSec == null) return undefined;
  return path.join(slidesDir, `slide_${String(index).padStart(4, '0')}_${tSec.toFixed(2)}s.png`);
}

function normalizeMeta(parsed: Record<string, unknown>, extracted?: Record<string, unknown>, transcriptMetadata?: Record<string, unknown>): Record<string, unknown> {
  const explicit = (parsed.meta != null && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)) ? parsed.meta as Record<string, unknown> : {};
  return {
    ...explicit,
    ...(typeof extracted?.title === 'string' ? { title: extracted.title } : {}),
    ...(typeof extracted?.siteName === 'string' ? { siteName: extracted.siteName } : {}),
    ...(typeof transcriptMetadata?.durationSeconds === 'number' ? { durationSec: transcriptMetadata.durationSeconds } : {}),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function msToSeconds(value: unknown): number | undefined {
  const ms = numberValue(value);
  return ms == null ? undefined : ms / 1000;
}

function runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
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
