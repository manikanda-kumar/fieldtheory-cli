import path from 'node:path';
import { dataDir } from '../paths.js';

export function rssDir(): string {
  return path.join(dataDir(), 'rss');
}

export function rssFeedsPath(): string {
  return path.join(rssDir(), 'feeds.json');
}

export function rssItemsCachePath(): string {
  return path.join(rssDir(), 'items.jsonl');
}

export function rssMetaPath(): string {
  return path.join(rssDir(), 'meta.json');
}
