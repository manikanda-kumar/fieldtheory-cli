import { mkdir } from 'node:fs/promises';
import { pathExists, readJsonLines, writeJson, writeJsonLines } from '../fs.js';
import { retryTransient } from '../net-retry.js';
import { fetchFeed, type FetchFeedOptions } from './client.js';
import { readRssFeeds } from './feeds.js';
import { rssDir, rssItemsCachePath, rssMetaPath } from './paths.js';
import type { RssFeedConfig, RssFeedStatus, RssItemRecord, RssMeta } from './types.js';

export interface SyncRssOptions extends FetchFeedOptions {
  dryRun?: boolean;
  /** Max feeds to fetch (testing). */
  limit?: number;
  /** Only these feed URLs (substring or exact match). */
  only?: string;
  /** Per-feed concurrency. Default 4. */
  concurrency?: number;
  /** Attempts per feed, including the first. Default: 3. */
  attempts?: number;
  /** Test seam for the retry backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Drop cached items older than this many days. Default: keep all. */
  maxItemAgeDays?: number;
  onFeed?: (event: {
    index: number;
    total: number;
    feed: RssFeedConfig;
    ok: boolean;
    itemCount: number;
    error?: string;
  }) => void;
}

export interface SyncRssResult {
  feedsConfigured: number;
  feedsFetched: number;
  feedsFailed: number;
  itemsFetched: number;
  itemsAdded: number;
  itemsUpdated: number;
  totalItems: number;
  cachePath: string;
  metaPath: string;
  failures: Array<{ url: string; name: string; error: string }>;
}

function materialItemChanged(existing: RssItemRecord, incoming: RssItemRecord): boolean {
  return (
    existing.title !== incoming.title
    || existing.link !== incoming.link
    || existing.summary !== incoming.summary
    || existing.author !== incoming.author
    || existing.publishedAt !== incoming.publishedAt
    || existing.feedName !== incoming.feedName
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => run());
  await Promise.all(runners);
  return results;
}

export async function syncRss(options: SyncRssOptions = {}): Promise<SyncRssResult> {
  const cachePath = rssItemsCachePath();
  const metaPath = rssMetaPath();
  let feeds = (await readRssFeeds()).filter((f) => f.enabled !== false);
  if (options.only) {
    const q = options.only.toLowerCase();
    feeds = feeds.filter((f) => f.url.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
  }
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    feeds = feeds.slice(0, Math.floor(options.limit));
  }

  const existing = new Map<string, RssItemRecord>();
  if (await pathExists(cachePath)) {
    for (const record of await readJsonLines<RssItemRecord>(cachePath)) {
      if (record?.id) existing.set(record.id, record);
    }
  }

  const failures: SyncRssResult['failures'] = [];
  const statuses: RssFeedStatus[] = [];
  let itemsFetched = 0;
  let itemsAdded = 0;
  let itemsUpdated = 0;
  let feedsFetched = 0;
  let feedsFailed = 0;

  const concurrency = options.concurrency ?? 4;
  const outcomes = await mapPool(feeds, concurrency, async (feed, index) => {
    try {
      // 2026-08-14: 5/98 feeds died together on `This operation was aborted`
      // (fetch timeout) and every one served fine on a manual retry.
      const result = await retryTransient(() => fetchFeed(feed, options), {
        attempts: options.attempts ?? 3,
        sleep: options.sleep,
      });
      options.onFeed?.({
        index: index + 1,
        total: feeds.length,
        feed: result.feed,
        ok: true,
        itemCount: result.items.length,
      });
      return { ok: true as const, feed: result.feed, items: result.items, httpStatus: result.httpStatus };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onFeed?.({
        index: index + 1,
        total: feeds.length,
        feed,
        ok: false,
        itemCount: 0,
        error: message,
      });
      return { ok: false as const, feed, error: message };
    }
  });

  const now = options.now?.() ?? new Date().toISOString();
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      feedsFailed += 1;
      failures.push({ url: outcome.feed.url, name: outcome.feed.name, error: outcome.error });
      statuses.push({
        url: outcome.feed.url,
        name: outcome.feed.name,
        lastFetchedAt: now,
        lastError: outcome.error,
        itemCount: 0,
        httpStatus: null,
      });
      continue;
    }
    feedsFetched += 1;
    itemsFetched += outcome.items.length;
    let feedItemCount = 0;
    for (const item of outcome.items) {
      feedItemCount += 1;
      const prev = existing.get(item.id);
      if (!prev) {
        itemsAdded += 1;
        existing.set(item.id, item);
      } else if (materialItemChanged(prev, item)) {
        itemsUpdated += 1;
        // Keep earliest syncedAt when first seen; refresh content fields.
        existing.set(item.id, { ...item, syncedAt: prev.syncedAt || item.syncedAt });
      } else {
        existing.set(item.id, { ...prev, syncedAt: prev.syncedAt || item.syncedAt });
      }
    }
    statuses.push({
      url: outcome.feed.url,
      name: outcome.feed.name,
      lastFetchedAt: now,
      lastError: null,
      itemCount: feedItemCount,
      httpStatus: outcome.httpStatus,
    });
  }

  let records = [...existing.values()];
  if (typeof options.maxItemAgeDays === 'number' && options.maxItemAgeDays > 0) {
    const cutoff = Date.now() - options.maxItemAgeDays * 24 * 60 * 60 * 1000;
    records = records.filter((item) => {
      const t = Date.parse(item.publishedAt ?? item.syncedAt);
      return !Number.isFinite(t) || t >= cutoff;
    });
  }

  records.sort((a, b) => {
    const left = a.publishedAt ?? a.syncedAt;
    const right = b.publishedAt ?? b.syncedAt;
    return right.localeCompare(left);
  });

  if (!options.dryRun) {
    await mkdir(rssDir(), { recursive: true });
    await writeJsonLines(cachePath, records);
    const meta: RssMeta = {
      lastSyncAt: now,
      totalItems: records.length,
      feedCount: feeds.length,
      feeds: statuses,
    };
    await writeJson(metaPath, meta);
  }

  return {
    feedsConfigured: feeds.length,
    feedsFetched,
    feedsFailed,
    itemsFetched,
    itemsAdded,
    itemsUpdated,
    totalItems: records.length,
    cachePath,
    metaPath,
    failures,
  };
}
