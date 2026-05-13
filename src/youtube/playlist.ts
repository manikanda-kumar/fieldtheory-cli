import { spawn } from 'node:child_process';
import { hasCommandOnPath } from '../engine.js';

export interface YoutubePlaylistVideo {
  videoId: string;
  title: string;
}

export interface YoutubePlaylist {
  playlistId: string;
  videos: YoutubePlaylistVideo[];
}

export interface ResolvePlaylistOptions {
  hasCommand?: (command: string) => boolean;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  fetchText?: (url: string) => Promise<string>;
}

export async function resolvePlaylist(input: string, options: ResolvePlaylistOptions = {}): Promise<YoutubePlaylist> {
  const playlistId = extractPlaylistId(input);
  const url = playlistUrl(playlistId);
  const hasCommand = options.hasCommand ?? ((command: string) => hasCommandOnPath(command));

  if (hasCommand('yt-dlp')) {
    const output = await (options.runCommand ?? runCommand)('yt-dlp', [
      '--flat-playlist',
      '--print',
      '%(id)s\t%(title)s',
      url,
    ]);
    const videos = parseYtDlpFlatOutput(output);
    if (videos.length) return { playlistId, videos };
  }

  const html = await (options.fetchText ?? fetchText)(url);
  const videos = parsePlaylistHtml(html);
  if (!videos.length) throw new Error(`No public videos found for playlist ${playlistId}. It may be private or unavailable.`);
  return { playlistId, videos };
}

function extractPlaylistId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Playlist URL or ID is required');
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get('list');
    if (list) return list;
  } catch {
    // Bare playlist ID.
  }
  return trimmed;
}

function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

function parseYtDlpFlatOutput(output: string): YoutubePlaylistVideo[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [videoId, ...titleParts] = line.split('\t');
      return { videoId, title: titleParts.join('\t') || videoId };
    })
    .filter((video) => Boolean(video.videoId));
}

function parsePlaylistHtml(html: string): YoutubePlaylistVideo[] {
  const initialData = extractYtInitialData(html);
  if (!initialData) return [];
  const videos: YoutubePlaylistVideo[] = [];
  walkJson(initialData, (value) => {
    const renderer = value.playlistVideoRenderer;
    if (renderer && typeof renderer === 'object' && !Array.isArray(renderer)) {
      const record = renderer as Record<string, unknown>;
      const videoId = getString(record.videoId);
      if (videoId) videos.push({ videoId, title: extractTitle(record.title) ?? videoId });
    }
  });
  return dedupeVideos(videos);
}

function extractYtInitialData(html: string): unknown | null {
  const marker = 'ytInitialData';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = html.indexOf('{', markerIndex);
  if (start === -1) return null;
  const json = extractBalancedObject(html, start);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractBalancedObject(input: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function walkJson(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const item of Object.values(record)) walkJson(item, visit);
}

function extractTitle(value: unknown): string | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const simple = getString(record.simpleText);
  if (simple) return simple;
  const runs = record.runs;
  if (!Array.isArray(runs)) return undefined;
  return runs.map((run) => getString((run as Record<string, unknown>)?.text)).filter(Boolean).join('') || undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function dedupeVideos(videos: YoutubePlaylistVideo[]): YoutubePlaylistVideo[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (seen.has(video.videoId)) return false;
    seen.add(video.videoId);
    return true;
  });
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist page: HTTP ${res.status}`);
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
