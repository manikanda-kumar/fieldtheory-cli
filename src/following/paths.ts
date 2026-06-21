import path from 'node:path';
import fs from 'node:fs';
import { dataDir } from '../paths.js';

/** Root for all following roster data: ~/.fieldtheory/bookmarks/following/ */
export function followingDir(): string {
  return path.join(dataDir(), 'following');
}

export function ensureFollowingDir(): string {
  const dir = followingDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/** JSONL cache of raw following records. */
export function followingCachePath(): string {
  return path.join(followingDir(), 'following.jsonl');
}

/** SQLite FTS5 index for following search. */
export function followingIndexPath(): string {
  return path.join(followingDir(), 'following.db');
}

/** Sync metadata (cursor, lastUpdated, count). */
export function followingMetaPath(): string {
  return path.join(followingDir(), 'meta.json');
}
