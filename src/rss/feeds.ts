import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathExists, readJson, writeJson } from '../fs.js';
import { rssDir, rssFeedsPath } from './paths.js';
import type { RssFeedConfig, RssFeedsFile } from './types.js';

const DEFAULT_FEEDS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'default-feeds.json');

export async function readDefaultRssFeeds(): Promise<RssFeedConfig[]> {
  try {
    const raw = await readFile(DEFAULT_FEEDS_PATH, 'utf8');
    const file = JSON.parse(raw) as RssFeedsFile;
    return Array.isArray(file.feeds) ? file.feeds.filter((f) => f && typeof f.url === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Load configured feeds. If none exist yet, seed from packaged defaults
 * (unless `seed` is false).
 */
export async function readRssFeeds(options: { seed?: boolean } = {}): Promise<RssFeedConfig[]> {
  const feedsPath = rssFeedsPath();
  if (await pathExists(feedsPath)) {
    try {
      const file = await readJson<RssFeedsFile>(feedsPath);
      const feeds = Array.isArray(file.feeds) ? file.feeds.filter((f) => f && typeof f.url === 'string') : [];
      if (feeds.length || options.seed === false) return feeds;
    } catch {
      if (options.seed === false) return [];
    }
  }
  if (options.seed === false) return [];
  const defaults = await readDefaultRssFeeds();
  if (!defaults.length) return [];
  await writeRssFeeds(defaults, { source: 'packaged default-feeds.json' });
  return defaults;
}

export async function writeRssFeeds(
  feeds: RssFeedConfig[],
  meta: { source?: string } = {},
): Promise<string> {
  await mkdir(rssDir(), { recursive: true });
  const path = rssFeedsPath();
  const file: RssFeedsFile = {
    feeds: dedupeFeeds(feeds),
    updatedAt: new Date().toISOString(),
    source: meta.source,
  };
  await writeJson(path, file);
  return path;
}

/** Merge feeds by URL (case-insensitive); incoming wins on name/home when provided. */
export function dedupeFeeds(feeds: RssFeedConfig[]): RssFeedConfig[] {
  const byUrl = new Map<string, RssFeedConfig>();
  for (const feed of feeds) {
    if (!feed?.url) continue;
    let url = feed.url.trim();
    if (!url) continue;
    try {
      const u = new URL(url);
      u.hash = '';
      url = u.toString();
    } catch {
      // keep raw
    }
    const key = url.toLowerCase();
    const prev = byUrl.get(key);
    byUrl.set(key, {
      name: (feed.name || prev?.name || hostnameOf(url)).trim(),
      url,
      home: feed.home ?? prev?.home,
      enabled: feed.enabled ?? prev?.enabled ?? true,
      description: feed.description ?? prev?.description,
    });
  }
  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
}

export async function upsertRssFeeds(
  incoming: RssFeedConfig[],
  options: { source?: string; replace?: boolean } = {},
): Promise<{ path: string; total: number; added: number }> {
  const existing = options.replace ? [] : await readRssFeeds();
  const before = new Set(existing.map((f) => f.url.toLowerCase()));
  const merged = dedupeFeeds([...existing, ...incoming]);
  const added = merged.filter((f) => !before.has(f.url.toLowerCase())).length;
  const path = await writeRssFeeds(merged, { source: options.source });
  return { path, total: merged.length, added };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
