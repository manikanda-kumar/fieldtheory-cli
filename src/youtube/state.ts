import path from 'node:path';
import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { readJson, writeJson, pathExists } from '../fs.js';
import { youtubeLibraryDir, youtubeStatePath } from '../paths.js';

const LOCK_STALE_MS = 10 * 60 * 1000;

export interface YoutubePlaylistState {
  lastSyncedAt?: string;
  videoIds?: string[];
}

export interface YoutubeVideoArtifacts {
  notesPath?: string;
  audioPath?: string;
  videoPath?: string;
  thumbnailPath?: string;
  [key: string]: string | undefined;
}

export interface YoutubeVideoState {
  status: string;
  contentHash?: string;
  title?: string;
  channel?: string;
  durationSec?: number;
  published?: string | null;
  videoType?: string;
  tldr?: string;
  topics?: string[];
  artifacts: YoutubeVideoArtifacts;
  error?: string;
  updatedAt: string;
}

export interface YoutubeState {
  version: 1;
  playlists: Record<string, YoutubePlaylistState>;
  videos: Record<string, YoutubeVideoState>;
}

export type YoutubeVideoPatch = Partial<Omit<YoutubeVideoState, 'updatedAt' | 'artifacts'>> & {
  artifacts?: Partial<YoutubeVideoArtifacts>;
};

export function emptyYoutubeState(): YoutubeState {
  return { version: 1, playlists: {}, videos: {} };
}

export async function loadYoutubeState(): Promise<YoutubeState> {
  const statePath = youtubeStatePath();
  if (!(await pathExists(statePath))) return emptyYoutubeState();

  const state = await readJson<Partial<YoutubeState>>(statePath);
  if (state.version !== 1) {
    throw new Error(`Unsupported YouTube state version: ${String(state.version)}`);
  }

  const videos: Record<string, YoutubeVideoState> = {};
  for (const [videoId, video] of Object.entries(state.videos ?? {})) {
    videos[videoId] = {
      ...video,
      status: video.status,
      artifacts: video.artifacts ?? {},
      updatedAt: video.updatedAt,
    };
  }

  return {
    version: 1,
    playlists: state.playlists ?? {},
    videos,
  };
}

export async function saveYoutubeState(state: YoutubeState): Promise<void> {
  const statePath = youtubeStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeJson(statePath, state);
}

export async function updateYoutubeState<T>(mutate: (state: YoutubeState) => T | Promise<T>): Promise<T> {
  const release = await acquireYoutubeStateLock();
  try {
    const state = await loadYoutubeState();
    const result = await mutate(state);
    await saveYoutubeState(state);
    return result;
  } finally {
    await release();
  }
}

export function markVideo(
  state: YoutubeState,
  videoId: string,
  patch: YoutubeVideoPatch,
  updatedAt = new Date().toISOString(),
): YoutubeState {
  const existing = state.videos[videoId];
  const next: YoutubeVideoState = {
    ...existing,
    ...patch,
    status: patch.status ?? existing?.status ?? 'pending',
    artifacts: {
      ...(existing?.artifacts ?? {}),
      ...(patch.artifacts ?? {}),
    },
    updatedAt,
  };
  // Clear stale error from prior failed attempts when the video reaches a
  // successful terminal status, unless the patch explicitly carries one.
  if ((next.status === 'done' || next.status === 'partial') && !('error' in patch)) {
    delete next.error;
  }
  state.videos[videoId] = next;
  return state;
}

export function shouldProcess(state: YoutubeState, videoId: string, contentHash: string, force = false): boolean {
  if (force) return true;
  const video = state.videos[videoId];
  if (!video) return true;
  return video.status !== 'done' || video.contentHash !== contentHash;
}

/**
 * Walk the YouTube library and re-insert any video that has an on-disk notes
 * file but is missing from state. Recovers from state.json wipes, manual edits,
 * or syncs that ran with a different FT_DATA_DIR; without this the index would
 * only list videos touched in the most recent sync.
 */
export async function reconcileYoutubeStateFromLibrary(): Promise<number> {
  const files = await listMarkdownFiles(youtubeLibraryDir());
  if (!files.length) return 0;
  const parsedEntries: ParsedNotes[] = [];
  for (const filePath of files) {
    const parsed = await parseYoutubeNotesFile(filePath);
    if (parsed) parsedEntries.push({ ...parsed, notesPath: filePath });
  }
  if (!parsedEntries.length) return 0;
  return await updateYoutubeState((state) => {
    let added = 0;
    for (const parsed of parsedEntries) {
      const filePath = parsed.notesPath!;
      const existing = state.videos[parsed.videoId];
      if (existing?.artifacts?.notesPath) continue;
      const updatedAt = parsed.synced ?? existing?.updatedAt ?? new Date().toISOString();
      state.videos[parsed.videoId] = {
        ...existing,
        status: 'done',
        title: parsed.title ?? existing?.title,
        channel: parsed.channel ?? existing?.channel,
        durationSec: parsed.durationSec ?? existing?.durationSec,
        published: parsed.published ?? existing?.published,
        videoType: parsed.videoType ?? existing?.videoType,
        tldr: parsed.tldr ?? existing?.tldr,
        topics: parsed.topics ?? existing?.topics,
        artifacts: {
          ...(existing?.artifacts ?? {}),
          notesPath: filePath,
        },
        updatedAt,
      };
      added += 1;
    }
    return added;
  });
}

interface ParsedNotes {
  videoId: string;
  title?: string;
  channel?: string;
  durationSec?: number;
  published?: string | null;
  videoType?: string;
  synced?: string;
  tldr?: string;
  topics?: string[];
  notesPath?: string;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  await walk(root);
  return out;
}

async function parseYoutubeNotesFile(filePath: string): Promise<ParsedNotes | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fm = parseFrontmatter(match[1]);
  if (fm.source !== 'youtube' || !fm.videoId) return null;
  const body = match[2];
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const tldr = extractTldr(body);
  const topics = extractTopics(body);
  const durationSec = fm.duration ? Number(fm.duration) : undefined;
  return {
    videoId: fm.videoId,
    title: titleMatch?.[1]?.trim() ?? fm.videoId,
    channel: fm.channel || undefined,
    durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
    published: fm.published || undefined,
    videoType: fm.videoType || undefined,
    synced: fm.synced || undefined,
    tldr,
    topics,
  };
}

function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

function extractTldr(body: string): string | undefined {
  const after = body.replace(/^#\s+.+\n+/m, '');
  const para = after.split(/\n\s*\n/, 1)[0]?.trim();
  return para && !para.startsWith('#') ? para : undefined;
}

function extractTopics(body: string): string[] | undefined {
  const m = body.match(/##\s+Topics\s*\n([\s\S]*?)(?:\n##\s|\n*$)/);
  if (!m) return undefined;
  const items = m[1].split('\n').map((line) => line.replace(/^[-*]\s+/, '').trim()).filter((line) => line && line !== 'None');
  return items.length ? items : undefined;
}

export function markPlaylistSynced(
  state: YoutubeState,
  playlistId: string,
  videoIds: string[],
  syncedAt = new Date().toISOString(),
): YoutubeState {
  state.playlists[playlistId] = {
    ...(state.playlists[playlistId] ?? {}),
    lastSyncedAt: syncedAt,
    videoIds,
  };
  return state;
}

async function acquireYoutubeStateLock(): Promise<() => Promise<void>> {
  const lockPath = `${youtubeStatePath()}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      await handle.close();
      return async () => { await rm(lockPath, { force: true }); };
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      if (await isStaleLock(lockPath)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for YouTube state lock: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const [raw, lockStat] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)]);
    if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) return true;
    const pid = Number(raw.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 && !isPidAlive(pid);
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}
