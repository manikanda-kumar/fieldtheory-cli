import { parseFeedXml, toRssItemRecord, type ParsedFeed } from './parse.js';
import type { RssFeedConfig, RssItemRecord } from './types.js';

export interface FetchFeedOptions {
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

export interface FetchFeedResult {
  feed: RssFeedConfig;
  parsed: ParsedFeed;
  items: RssItemRecord[];
  httpStatus: number;
  finalUrl: string;
}

const DEFAULT_UA = 'fieldtheory-cli/rss (+https://fieldtheory.dev; feed sync)';

export async function fetchFeed(
  feed: RssFeedConfig,
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch is not available');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(feed.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'User-Agent': options.userAgent ?? DEFAULT_UA,
      },
    });
    const finalUrl = response.url || feed.url;
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${feed.url}`);
    }
    const xml = await response.text();
    const parsed = parseFeedXml(xml);
    const syncedAt = options.now?.() ?? new Date().toISOString();
    const feedName = feed.name || parsed.title || new URL(feed.url).hostname;
    const items = parsed.items.map((item) => toRssItemRecord(item, feed.url, feedName, syncedAt));
    return {
      feed: { ...feed, name: feedName },
      parsed,
      items,
      httpStatus: response.status,
      finalUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}
