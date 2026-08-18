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

/**
 * Tweet text fetched for Raindrop-only X saves. Raindrop stores those with the
 * tweet id as the title and no excerpt, so the digest would otherwise render a
 * bare number with no description.
 */
export function raindropXHydrationPath(): string {
  return path.join(raindropBookmarksDir(), 'x-hydrated.jsonl');
}
