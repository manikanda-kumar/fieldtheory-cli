/** One subscribed feed in the local RSS roster. */
export interface RssFeedConfig {
  name: string;
  url: string;
  /** Optional homepage / blog root. */
  home?: string;
  /** When false, sync skips this feed. Default true. */
  enabled?: boolean;
  description?: string;
}

export interface RssFeedsFile {
  feeds: RssFeedConfig[];
  /** ISO timestamp when feeds.json was last written. */
  updatedAt?: string;
  source?: string;
}

/** One article/item from an RSS or Atom feed. */
export interface RssItemRecord {
  /** Stable id: sha1(feedUrl + '|' + (guid || link)). */
  id: string;
  feedUrl: string;
  feedName: string;
  title: string;
  link: string;
  /** Publisher guid when present. */
  guid: string | null;
  summary: string | null;
  author: string | null;
  /** Best-effort ISO published time. */
  publishedAt: string | null;
  /** When we first saw / last refreshed this item locally. */
  syncedAt: string;
}

export interface RssFeedStatus {
  url: string;
  name: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  itemCount: number;
  httpStatus?: number | null;
}

export interface RssMeta {
  lastSyncAt: string;
  totalItems: number;
  feedCount: number;
  feeds: RssFeedStatus[];
}
