import path from 'node:path';
import { mkdir, open, rm } from 'node:fs/promises';
import { readJson, writeJson, pathExists } from '../fs.js';
import { youtubeStatePath } from '../paths.js';

export interface YoutubePlaylistState {
  lastSyncedAt?: string;
}

export interface YoutubeVideoArtifacts {
  notesPath?: string;
  audioPath?: string;
  videoPath?: string;
  [key: string]: string | undefined;
}

export interface YoutubeVideoState {
  status: string;
  contentHash?: string;
  title?: string;
  channel?: string;
  durationSec?: number;
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
  state.videos[videoId] = {
    ...existing,
    ...patch,
    status: patch.status ?? existing?.status ?? 'pending',
    artifacts: {
      ...(existing?.artifacts ?? {}),
      ...(patch.artifacts ?? {}),
    },
    updatedAt,
  };
  return state;
}

export function shouldProcess(state: YoutubeState, videoId: string, contentHash: string, force = false): boolean {
  if (force) return true;
  const video = state.videos[videoId];
  if (!video) return true;
  return video.status !== 'done' || video.contentHash !== contentHash;
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
      if (Date.now() > deadline) throw new Error(`Timed out waiting for YouTube state lock: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
