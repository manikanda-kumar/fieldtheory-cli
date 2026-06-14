import path from 'node:path';
import { dataDir } from '../paths.js';

export function githubStarsDir(): string {
  return path.join(dataDir(), 'github-stars');
}

export function githubStarsCachePath(): string {
  return path.join(githubStarsDir(), 'stars.jsonl');
}

export function githubStarsMetaPath(): string {
  return path.join(githubStarsDir(), 'meta.json');
}
