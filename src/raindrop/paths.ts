import path from 'node:path';
import { dataDir } from '../paths.js';

export function raindropBookmarksDir(): string {
  return path.join(dataDir(), 'raindrop');
}

export function raindropBookmarksCachePath(): string {
  return path.join(raindropBookmarksDir(), 'bookmarks.jsonl');
}

export function raindropMetaPath(): string {
  return path.join(raindropBookmarksDir(), 'meta.json');
}

export function raindropBackfillStatePath(): string {
  return path.join(raindropBookmarksDir(), 'backfill-state.json');
}
